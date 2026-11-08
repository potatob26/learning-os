import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useStore } from './lib/store';
import { startClock, shouldResync, useTimeStore } from './lib/netTime';
import { useThemeEngine } from './hooks/useTheme';
import { useAutoDim } from './hooks/useAutoDim';
import { useAdaptiveText } from './hooks/useAdaptiveText';
import { useGlassFilter } from './lib/glass';
import { installWidgetSync } from './lib/widgetBridge';
import { AppShell } from './components/layout/AppShell';
import { BackgroundLayer } from './components/background/BackgroundLayer';
import { Home } from './pages/Home';
import { Splash } from './components/layout/Splash';
import { TimeCalibrationNotice } from './components/layout/TimeCalibrationNotice';
import { StorageNotice } from './components/layout/StorageNotice';
import { FirstRun } from './components/onboarding/FirstRun';
import { ReleaseNotes } from './components/updates/ReleaseNotes';
import { UpdateNotice } from './components/updates/UpdateNotice';
import { useUpdateStore } from './lib/updateStore';

/* 首页保持同步（第一屏要立刻可交互）；其余路由懒加载，
   把单包拆开，手机 PWA 首访不用解析全部代码再进入首屏 */
const Goals = lazy(() => import('./pages/Goals').then((m) => ({ default: m.Goals })));
const Checklist = lazy(() => import('./pages/Checklist').then((m) => ({ default: m.Checklist })));
const Timer = lazy(() => import('./pages/Timer').then((m) => ({ default: m.Timer })));
const Stats = lazy(() => import('./pages/Stats').then((m) => ({ default: m.Stats })));
const Calendar = lazy(() => import('./pages/Calendar').then((m) => ({ default: m.Calendar })));
const Streak = lazy(() => import('./pages/Streak').then((m) => ({ default: m.Streak })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));

export function App() {
  const hydrate = useStore((s) => s.hydrate);
  const hydrated = useStore((s) => s.hydrated);
  const onboarded = useStore((s) => s.settings.onboarded);
  const sessions = useStore((s) => s.sessions);
  const goals = useStore((s) => s.goals);
  const streakRescues = useStore((s) => s.streakRescues);
  const reconcileAchievements = useStore((s) => s.reconcileAchievements);
  const sync = useTimeStore((s) => s.sync);
  const [ready, setReady] = useState(false);

  useThemeEngine();
  useGlassFilter();
  // 背景图暗化强度的自动重算（用户手动调过就以用户为准）
  useAutoDim();
  useAdaptiveText();

  // 读取本地数据
  useEffect(() => {
    let alive = true;
    void hydrate().finally(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [hydrate]);

  // 时钟 + 网络时间校准
  useEffect(() => {
    const stop = startClock();
    if (shouldResync()) void sync();
    const onOnline = () => {
      if (shouldResync()) void sync();
    };
    window.addEventListener('online', onOnline);
    return () => {
      stop();
      window.removeEventListener('online', onOnline);
    };
  }, [sync]);

  /*
   * 桌面小组件的数据推送。必须在 hydrate 之后装 ——
   * 装早了会把「还没读到本地数据」的空状态推给原生，
   * 桌面上就会先闪一下 0%，再被正确值覆盖。
   * 非安卓平台（Web / PWA）里这个函数自己会直接返回。
   */
  useEffect(() => {
    if (hydrated) installWidgetSync();
  }, [hydrated]);

  /*
   * 成就对账：学习记录 / 目标 / 接回账本变化后，把新达成的成就补进账本。
   * hydrate 里已经按旧数据补记过一次；这里是实时路径（新学完一段、勾完目标）。
   * reconcileAchievements 幂等：没有新增时不会 set、也不会 commit。
   */
  useEffect(() => {
    if (!hydrated) return;
    reconcileAchievements();
  }, [hydrated, sessions, goals, streakRescues, reconcileAchievements]);

  /*
   * 进入程序自动检测新版本（1.3.0）。
   *
   * 三条硬要求，缺一不可：
   *   ① **不阻塞首屏**：只在 hydrate 完成后发起，而且**不 await** ——
   *      这个 effect 立刻返回，渲染照常进行。检测内部还有 5 秒超时兜底。
   *   ② **失败静默**：离线/超时/500/坏数据一律什么都不做（checkForUpdate 自己吞掉），
   *      不弹错误、不打扰用户。
   *   ③ **不打扰**：有新版但要先过 shouldNotify（同一个版本点过"以后再说"就不再提）。
   *
   * 用 requestIdleCallback 让位给首屏：有就等浏览器空闲，没有就退化成 setTimeout。
   */
  useEffect(() => {
    if (!hydrated) return;
    /*
     * ⚠️ 必须用 checkForUpdateOnce（幂等），不能直接用 checkForUpdate：
     * StrictMode 在开发期会把 effect 跑两次，第一次的请求会写下节流时间戳、
     * 结果却被丢弃，第二次就只剩 skipped → 开发期永远看不到更新提示。
     * 也正因为幂等，这里不需要 alive 守卫（写入的是全局状态，重复写无害）。
     */
    const run = async () => {
      const { checkForUpdateOnce, shouldNotify } = await import('./lib/updateCheck');
      const r = await checkForUpdateOnce();
      if (r.status === 'available' && r.manifest && shouldNotify(r.manifest)) {
        useUpdateStore.getState().setPending(r.manifest, r.required === true);
      }
    };
    const idle = (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }).requestIdleCallback;
    const handle = idle
      ? idle(() => void run(), { timeout: 4000 })
      : window.setTimeout(() => void run(), 1200);
    return () => {
      const cancel = (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
      if (idle && cancel) cancel(handle);
      else clearTimeout(handle);
    };
  }, [hydrated]);

  if (!ready || !hydrated) return <Splash />;

  if (!onboarded) {
    return (
      <>
        <BackgroundLayer />
        <FirstRun />
      </>
    );
  }

  return (
    <>
      <BackgroundLayer />
      <AppShell>
        <Suspense fallback={<Splash />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/goals" element={<Goals />} />
        <Route path="/checklist" element={<Checklist />} />
            <Route path="/timer" element={<Timer />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/streak" element={<Streak />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/:tab" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AppShell>
      <TimeCalibrationNotice />
      <StorageNotice />
      <ReleaseNotes />
      <UpdateNotice />
    </>
  );
}
