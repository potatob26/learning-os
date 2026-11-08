/**
 * 第三方透明玻璃库没有提供 CSS 导出的类型声明，这里补上。
 * 运行时由 Vite 处理样式导入，类型必须显式声明。
 */
declare module '@dpawlikowski/liquid-glass/css' {
  const css: string;
  export default css;
}

declare module '@dpawlikowski/liquid-glass/filter.svg' {
  const svg: string;
  export default svg;
}
