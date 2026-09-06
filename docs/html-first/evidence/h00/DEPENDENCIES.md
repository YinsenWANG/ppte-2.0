# H00 依赖盘点与处置

扫描基线：`bbcd46bde2c608b5a56e617f316c5dcb5534857e`。运行 `node scripts/html-import-inventory.mjs` 可重新生成 JSON；输出提交号会反映运行时 HEAD。保留的 [import-graph.json](import-graph.json) 是基线快照，不随未来迁移静默覆盖。

扫描 117 个 apps/packages 源文件，得到 624 条静态边，旧 `apps/cli/index.ts` 非直接 type-only 可达 86 个文件；0 个计算型 import/require 表达式。使用 TypeScript AST 与模块解析器，覆盖静态 import、再导出、字面量动态 import 和 require，并标注直接 type-only。逐成员 `import { type X }`、构建生成的代码、资源、条件执行和 tree shaking 仍需发行包检查，不能把可达集当作精确执行图。

| 范围 | 当前事实 | 后续处置 |
|---|---|---|
| apps/cli、core、schema、agent-tools、authoring、layout-recipes、design-compiler | 旧 CLI 仍连到旧核心与生成链 | H01 建立独立入口；H05 移出新发行包；禁止在新核心重建内容镜像 |
| exporter-pptx、compatibility、importer-legacy | 旧格式适配仍在源码；exporter-pptx 在旧 CLI 可达集 | H05 删除新分发中的入口、依赖及旧格式专属验收；本轮不修旧格式问题 |
| archive、file-format、recovery-journal、portable-runtime、patch-format | 旧包、日志及交付链仍存活 | 退出新版运行依赖；不得为新工作新增旧格式义务 |
| editor-dom、richtext-adapter、editor-react、renderer-react | 交互与渲染大量依赖旧 document/core 类型 | 只复用经过剥离的 IME、选择、变换、媒体离页经验；不直接复用整套控制器 |
| exporter-pdf 与浏览器测量/截图设施 | 可用于可选工具链，但旧导出器依赖旧表示 | H04 改为 HTML 打印；基础生成不导入、不安装浏览器 |
| canonical-json、geometry、semantic-identity | 存在可参考的摘要、几何与身份逻辑 | 按需审查复用；稳定 DOM ID 和 expected hash 不等于恢复旧 IR |
| skills/ppte、NPM staging、README-AGENT | 原生 Skill/NPM 接入理念保留 | H01/H05 缩短新流程、检查实际 tarball |

所有已跟踪 package.json 的完整快照也在 JSON。根开发依赖含 `fflate`（旧归档）、React/React DOM（旧界面）、ProseMirror 三件套（富文本）、Playwright（浏览器验证）及 TypeScript/esbuild/Vite（构建）。单个包大多没有声明 dependency 字段，直接相对源码 import 才揭示真实耦合，不能仅凭 package.json 判断轻量化或依赖退出。

H00 新工具仅使用 Node 标准库；单独的扫描脚本使用现有开发依赖 TypeScript。它们不导入任何 PPTe 产品包。本次没有删除现有模块、既有断言或发布门禁，也没有宣布任何仍在调用链上的代码已“范围退休”。H05 仍须双重检查新静态图与实际 npm tarball。
