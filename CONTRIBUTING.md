# 参与贡献

谢谢你看这个项目。它是按个人学习习惯做出来的，欢迎 issue、PR，也欢迎 fork 成你自己的版本。

## 开发环境

- Node.js **20+**（推荐 22，见 `.nvmrc`）
- npm（仓库带 `package-lock.json`）
- 只做 Web：不需要 Android SDK
- 构建 APK：JDK 21 + Android SDK（compileSdk 36），见 README

```bash
npm ci
npm run dev        # http://localhost:5173
npx tsc -b         # 类型检查，必须 0 错
```

## 提交前请自测

```bash
npx tsc -b
node scripts/check-quotes.mjs   # 纯 Node，CI 会跑
```

涉及界面的改动，建议至少跑相关测试；大部分测试需要本机 Chrome 与三个服务器
（详见 `docs/还有啥没做.md` 附录 A）。完整回归约 21 分钟，比较重，PR 里说明跑了哪些即可。

## 代码约定（重要）

这个项目有几条硬约束，违反会被测试或审计挡住：

1. **不写死颜色**：一律用 `src/styles/index.css` 里的语义令牌（`--text`、`--accent-text`、`--ok-soft`…）。
   新增颜色先加令牌，再在组件里引用。
2. **不造假数据/假按钮**：所有数字必须来自真实记录；没有数据就给引导，不要填示例值。
3. **学习时长只来自计时器或手动补录**；成果目标、成绩录入等不能写时长。
4. **不做排行榜/竞争**：成就与统计只跟自己的记录比。
5. **本地优先**：数据默认只在本机；任何联网能力都必须是可选的，未配置时静默关闭并在文档里说明。
6. **文案克制**：不用感叹号、不吹、不说教；产品不确定时先问，不擅自加功能。

## 提交与 PR

- commit message 用中文或英文都可以，**说明「为什么」而不是只写「改了什么」**。
- 一个 PR 尽量只做一件事；UI 改动附截图（亮/暗各一张更好）。
- 新增测试请加进 `scripts/run-regression.mjs` 的 BASELINE，并在 `交接文档.md` 的基线表补一行。
- 大的产品决策（新模块、同步、通知等）先开 issue 讨论，不要直接写。

## 报告问题

- 功能/Bug：用 issue 模板，附版本号（`设置 → 数据` 里可看）、机型、复现步骤、截图。
- 安全问题：**不要开 public issue**，见 [SECURITY.md](SECURITY.md)。
