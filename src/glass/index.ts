/** 玻璃模块的统一出口，避免各处从深层路径导入 */
export {
  setBackgroundCanvas,
  configureBackground,
  setGlassBackdropDim,
  scheduleRefresh,
  refreshNow,
  useGlassSurface,
  useGlassSupport,
  useLiquidCards,
} from './glass-manager';
export { paintBackground, loadImage, cssColor, type BgInput } from './background-canvas';
export { DEFAULT_GLASS, type GlassOptions } from './webgl-glass';
