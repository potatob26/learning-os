import { setGlassBackdropDim } from '../glass';

interface Entry { root: HTMLElement; panel: HTMLElement; close: () => void; trigger: HTMLElement | null }
const stack: Entry[] = [];
const saved = new Map<HTMLElement, boolean>();
let overflow = '';
let observer: MutationObserver | null = null;

function refresh() {
  const top = stack.at(-1);
  for (const child of document.body.children) {
    if (!(child instanceof HTMLElement)) continue;
    if (!saved.has(child)) saved.set(child, child.inert);
    child.inert = top ? child !== top.root : saved.get(child)!;
  }
  for (const entry of stack) {
    // 同一时刻只展示最上层弹窗，避免两份内容透过玻璃重叠。
    entry.root.style.visibility = entry === top ? '' : 'hidden';
  }
  setGlassBackdropDim(top ? 0.42 : 0);
}

function onKey(event: KeyboardEvent) {
  const top = stack.at(-1);
  if (!top) return;
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopImmediatePropagation(); top.close();
  } else if (event.key === 'Tab') {
    const items = [...top.panel.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
      .filter((el) => el.getClientRects().length && !el.closest('[inert]') && getComputedStyle(el).visibility !== 'hidden');
    const first = items[0]; const last = items.at(-1);
    if (!first) { event.preventDefault(); top.panel.focus(); }
    else if (event.shiftKey && (document.activeElement === first || !items.includes(document.activeElement as HTMLElement))) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !items.includes(document.activeElement as HTMLElement))) {
      event.preventDefault(); first.focus();
    }
  }
}

/** Portal 弹窗共同管理滚动、焦点和 inert；关闭内层不会解锁底层。 */
export function mountModal(root: HTMLElement, panel: HTMLElement, close: () => void, trigger: HTMLElement | null) {
  if (!stack.length) {
    overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey, true);
    observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true });
  }
  const entry: Entry = { root, panel, close, trigger };
  stack.push(entry);
  refresh();
  panel.focus({ preventScroll: true });
  return () => {
    const wasTop = stack.at(-1) === entry;
    stack.splice(stack.indexOf(entry), 1);
    refresh();
    if (!stack.length) {
      observer?.disconnect(); observer = null;
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', onKey, true);
      for (const [el, inert] of saved) el.inert = inert;
      saved.clear();
    }
    if (wasTop) {
      const target = entry.trigger?.isConnected && !entry.trigger.closest('[inert]') ? entry.trigger : stack.at(-1)?.panel;
      target?.focus({ preventScroll: true });
    }
  };
}
