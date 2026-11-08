# 第三方依赖与许可

本项目以 MIT 许可证开源（见根目录 `LICENSE`）。运行时分发的主要第三方依赖如下；
它们各自的版权与许可条款仍然有效，MIT 不改变这一点。

## 运行时依赖

| 依赖 | 许可证 | 项目 |
|---|---|---|
| react / react-dom | MIT | https://github.com/facebook/react |
| react-router-dom | MIT | https://github.com/remix-run/react-router |
| zustand | MIT | https://github.com/pmndrs/zustand |
| lucide-react | ISC | https://github.com/lucide-icons/lucide |
| @capacitor/core / android / cli | MIT | https://github.com/ionic-team/capacitor |
| @dpawlikowski/liquid-glass | MIT | https://github.com/dpawlikowski/liquid-glass |
| liquid-glass-react | MIT | npm: liquid-glass-react |
| idb-keyval | Apache-2.0 | https://github.com/jakearchibald/idb-keyval |

Apache-2.0 依赖（idb-keyval）的分发需保留其 LICENSE 与 NOTICE（若有）；详见对应
`node_modules/idb-keyval/LICENSE`。

## 内置/改编代码

- `src/vendor/liquid-glass.js`、`src/vendor/liquid-glass.original.js`：
  文件内注明 "dependency-free Web Component, MIT license"，并保留原注释头。
  **原始仓库地址待补充**（开源前需要补上来源与作者，或改成直接依赖 npm 包）。
- `src/glass/*` 的玻璃渲染代码为本项目实现；其中折射思路参考了上述 MIT 组件与 Apple 视觉语言，
  但不包含 Apple 的私有代码或素材。

## 字体与图标

- 界面图标：lucide（ISC），随依赖分发。
- 字体使用系统字体栈（不内嵌字体文件），不涉及字体授权。

## 素材

- 背景、渐变、网格、火星等视觉元素均由代码程序化生成，不包含第三方图片素材。
- `Promo/`（宣传片素材）不随仓库分发。

---

如果你发现遗漏或归属错误，欢迎开 issue 指正。
