import { useEffect, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, Home, ListChecks, Settings as SettingsIcon, Timer as TimerIcon } from 'lucide-react';
import { cx } from '../../lib/utils';
import { Logo as SharedLogo } from '../ui/Logo';
import { GlassSurface } from '../ui/GlassSurface';
import { LiquidGlassLayer } from '../glass/LiquidGlassLayer';
import { useIsRefractTheme } from '../../lib/material';
import { useStore } from '../../lib/store';
import { useTimeStore } from '../../lib/netTime';
import { elapsedMs } from '../../lib/time';
import { fmtClock } from '../../lib/time';
import { SlidingGlass } from './SlidingGlass';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

const NAV: NavItem[] = [
  { to: '/', label: '首页', icon: <Home /> },
  { to: '/goals', label: '目标', icon: <ListChecks /> },
  { to: '/timer', label: '计时', icon: <TimerIcon /> },
  { to: '/stats', label: '统计', icon: <BarChart3 /> },
  { to: '/settings', label: '设置', icon: <SettingsIcon /> },
];

/**
 * 每页的 document.title。
 * 读屏与浏览器标签页靠它区分页面；之前全站一个标题，切页后读屏不会播报。
 */
function pageTitle(pathname: string): string {
  if (pathname === '/') return '首页';
  if (pathname.startsWith('/streak')) return '火花';
  if (pathname.startsWith('/calendar')) return '日历';
  if (pathname.startsWith('/goals')) return '目标';
  if (pathname.startsWith('/checklist')) return '作业清单';
  if (pathname.startsWith('/timer')) return '计时';
  if (pathname.startsWith('/stats')) return '统计';
  if (pathname.startsWith('/settings')) return '设置';
  return '学习 OS';
}

/**
 * 应用外壳
 * ──────────────────────────────────────────────
 * 手机 / 平板：底部固定导航（拇指可达，避开安全区域）
 * 桌面：左侧边栏
 * 内容区为底部导航预留 padding，保证不遮挡内容
 */
export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const refract = useIsRefractTheme();
  const selectedIndex = Math.max(0, NAV.findIndex((item) => location.pathname === item.to || (item.to !== '/' && location.pathname.startsWith(`${item.to}/`))));

  useEffect(() => {
    document.title = `学习 OS · ${pageTitle(location.pathname)}`;
  }, [location.pathname]);

  return (
    // relative：给随内容滚动的折射层（absolute inset-0）提供定位祖先。
    // 该层必须是 absolute 才能跟着内容一起滚 —— 见 LiquidGlassLayer 的说明。
    <div className="relative min-h-dvh-safe flex">
      {/* 键盘用户第一个 Tab 就能跳过导航；聚焦前视觉隐藏。
          HashRouter 下 href="#main" 会被当成路由，所以用 onClick 直接移焦。 */}
      <a
        href="#main"
        className="skip-link"
        onClick={(e) => {
          e.preventDefault();
          const main = document.getElementById('main');
          main?.focus();
          main?.scrollIntoView({ block: 'start' });
        }}
      >
        跳到主要内容
      </a>
      {/*
        液态玻璃层：固定覆盖视口，为登记的「重点容器」用 WebGL 画真实折射。
        它必须在内容**之下**（z-0）而在背景画布（z-index:-1）之上，
        因此内容统一包在 relative z-[1] 里，文字永远在玻璃上方、保持清晰。
      */}
      <LiquidGlassLayer enabled={refract} />

      <div className="relative z-[1] flex min-h-dvh-safe w-full">
        {/* 桌面侧边导航 */}
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-1 border-r border-[var(--line)] bg-[var(--surface-soft)] px-3 py-5 backdrop-blur-xl lg:flex">
        <div className="mb-5 px-2">
          <div className="flex items-center gap-2">
            <Logo />
            <span className="text-[1.05rem] font-semibold tracking-tight">学习 OS</span>
          </div>
        </div>
        {NAV.map((item) => {
          const active = location.pathname === item.to || (item.to !== '/' && location.pathname.startsWith(`${item.to}/`));
          return (
            <button
              key={item.to}
              type="button"
              onClick={() => navigate(item.to)}
                  aria-current={active ? 'page' : undefined}
              className={cx(
                'flex min-h-11 items-center gap-3 rounded-xl px-3 text-[0.95rem] font-medium transition-colors duration-200',
                '[&>span>svg]:size-[1.15rem]',
                active
                  ? 'bg-[var(--accent-soft)] text-[var(--accent-on-soft)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text)]',
              )}
            >
              <span className="grid place-items-center">{item.icon}</span>
              {item.label}
            </button>
          );
        })}
        <div className="mt-auto px-3 text-[0.7rem] leading-relaxed text-tertiary">
          <ClockFootnote />
        </div>
      </aside>

      {/* 主内容区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <main
          id="main"
          tabIndex={-1}
          className="page-x mx-auto w-full max-w-2xl flex-1 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-3 outline-none lg:max-w-3xl lg:pb-12 lg:pt-8"
        >
          {children}
        </main>
      </div>

      {/* 手机 / 平板底部导航 */}
      <nav
        className="app-bottom-nav fixed inset-x-0 bottom-0 z-40 lg:hidden"
        aria-label="主导航"
      >
        <GlassSurface
          tier="mica"
          radius={32}
          className="app-nav-material"
          contentClassName="p-[5px]"
        >
          <SlidingGlass index={selectedIndex} count={NAV.length} onSelect={(index) => navigate(NAV[index].to)}>
          {NAV.map((item) => {
            const active = location.pathname === item.to || (item.to !== '/' && location.pathname.startsWith(`${item.to}/`));
            return (
              <button
                key={item.to}
                type="button"
                onClick={() => navigate(item.to)}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'nav-tab relative z-[1] flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-full',
                  'transition-colors duration-200',
                  '[&>svg]:size-[1.375rem]',
                  active ? 'text-[var(--accent-on-soft)]' : 'text-[var(--text-secondary)]',
                )}
              >
                {item.icon}
                <span className="nav-tab-label text-[0.7rem] font-semibold leading-none">{item.label}</span>
                {/* 计时中：在计时页签上显示实时时长，切页面也能看到 */}
                <TimerBadge to={item.to} />
              </button>
            );
          })}
          </SlidingGlass>
        </GlassSurface>
      </nav>
      </div>
    </div>
  );
}

function TimerBadge({ to }: { to: string }) {
  const timer = useStore((s) => s.timer);
  const ts = useTimeStore((s) => s.ts);
  if (to !== '/timer' || !timer) return null;
  const running = timer.phase === 'running';
  const ms = elapsedMs(timer, ts);
  return (
    <span
      className={cx(
        'nav-timer-badge absolute rounded-full px-1.5 py-px text-[0.7rem] font-semibold tnum',
        running ? 'bg-[var(--primary-bg)] text-[var(--on-accent)]' : 'bg-[var(--warn-soft)] text-[var(--warn-text)]',
      )}
    >
      {running ? fmtClock(ms / 1000) : '暂停'}
    </span>
  );
}

function ClockFootnote() {
  const source = useTimeStore((s) => s.source);
  const status = useTimeStore((s) => s.status);
  const label = status === 'ok' ? '已校准' : status === 'failed' ? '未校准' : '校准中';
  return (
    <>
      时间来源：{label}
      {source === 'local' ? '（本机时间）' : ''}
    </>
  );
}

export function Logo({ className }: { className?: string }) {
  return <SharedLogo className={className} />;
}
