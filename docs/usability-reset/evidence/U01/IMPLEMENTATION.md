# U01：新代表页与 Skill 源头修正

状态：**awaiting-user-decision**。先前成稿美学被用户拒收，human 继续 reopened；新方向已形成三个可操作代表页，等待用户视觉签收。完整稿未生成，不能称 U01 全部完成。

本任务从 `2000def` 承接 U02/U03，核对了权威提交 `bad07df`。按序读取本轮 PLAN/TASKS、focused-product PLAN/TASKS/PDF-AND-CORE-REVIEW、UI DESIGN 与 README-AGENT。仓库及父目录未找到 AGENTS.md。调用工具目录未发现可操作物理桌面的工具，故 native/human 不冒充通过。原始管道 brief 原字节保存为 REQUEST.md。

## 实现与设计

- `source/representatives.html` 为重新编写的三页原生 HTML/CSS；Grid 封面、图文分栏和语义表格使用同一字体/色彩体系。旧稿及历史证据均未修改。封面的大字主次、图文页的关系解释、密集页的具体行动，分别承担不同叙事任务。
- `source/confluence.svg` 是本轮原创矢量概念图，三路汇合解释反馈、代码、文档共同完善产品，不是项目流程或贡献量可视化。已通过本地浏览器渲染并实际查看 `screenshots/material-confluence.png`，主体为三条完整路径与汇合节点；最终使用 contain，保留所有端点。页面图注明确“原创概念图 · 非产品截图”；图外的标题、标签、表格均为可编辑文字。没有外部图片、字体、整页截图或测试占位素材。
- 事实只继承 `docs/html-first/evidence/h00/materials/cherry-readme.md` 固定提交 `67ca175cc833ba6a286464343f64ec1e426d443a` 的项目定位、Contributing 与 Getting Started；没有新时效事实、实时数字、版本年表或增长推断。密集页为作者建议，不伪装官方流程。
- `skills/ppte/SKILL.md` 保留轻量美学提醒，补充用户指定代表页签收时先停下；拒收需要新构图与叙事。未加入固定色板、字数、布局配方或审美评分。
- 修正 Skill、README-AGENT、README 的旧 PDF 宣称：现有直接入口禁用、路线未合格、无系统打印兜底、外部架构须用户决策。未修改 PDF 产品代码或集成路线。
- 真实 stage → npm pack → 隔离 offline install → skill-install，核对源码、包内和安装 Skill 字节一致，包 README 等于 README-AGENT。未替换已有个人安装或发布 NPM。

## 生成记录与检查边界

唯一交付 `Cherry-Studio-开源之路.ppte.html` 包含当前运行时、三页正文和内嵌图片，离线直接打开。增强 1 次，约 61 ms；必要局部修正 1 次，确切耗时和前后哈希见 `verification/enhancement.json`、`local-repair.json`。修正仅调整标题行距、概念图标签对齐，没有重写/再生成全稿。开发测试生成的编辑下载副本留在 ignored artifacts，不污染交付正文。

初查标题 scrollHeight 大于行框；进一步核验确认是中文字体可见溢出度量，并非已证明截断。局部增大行距后保留新节奏，最终测试同时记录盒/字形边界与 overflow：裁切容器检查滚动尺寸，所有字形检查页面边界。没有降低既有断言或修改旧测试。截图使用 `caret:'initial'`，并断言截图前后正文相同，避免 Playwright 隐藏光标污染作者样式。

四个新增仓库测试 `tests/usability-reset-u01.test.ts`，通过 `node --test dist/tests/*.test.js` 执行：

|验收项|自动化证据|仍待验|
|---|---|---|
|三新代表页、单 HTML、可编辑|A1/A2：3 页完整页面和字形边界、图片离线解码、阅读/放映翻页、无控件放映、无联网或脚本异常；A1：实际点击/文本输入、撤销重做、明确下载、关闭 Chrome headless 进程再重开|目标桌面打开、真实输入法、用户美学签收 pending|
|不复用旧设计冒充提升|新 source/artwork 与旧 source 哈希及结构/内容对照；A1/A2 检查新三种构图与旧装饰缺席；三页截图 Agent 实际查看|是否达到用户所需美感继续 reopened；自动化不是审美评分|
|完整稿|未生成；A3/full-deck 检查决定门、pending 原因及三截图可读|待用户明确确认代表页后才能生成和测完整稿|
|用户视觉确认|A3 只测试停机状态，不能代签|human reopened；新稿 humanRevalidation pending；见 DECISIONS.md|
|源码与安装说明一致|A4 实际打包/离线安装/安装 Skill 的字节比对；实际运行时 PDF 禁用断言|已完成此实现/自动化项，无个人全局安装替换声明|

原生步骤：在目标桌面直接打开唯一 HTML → 阅读三页 → 切编辑选中正文并修改/撤销 → 放映翻页 → 返回；由用户评价封面留白、图文比例、密集页可读性。保存与图片新交互的原生验收仍由 U03/U02 承接，本任务下载能力覆盖测试不是原文件保存证明。没有原生输入通道/用户评审结果，暂记 pending + 具体缺口，不关闭先前拒收。

开发期失败如实保留：首次 TS NodeList/DOMRectList 迭代需 Array.from；初始测试误将 data-ppte-slide 的输入标签当作稳定 ID（增强器规范化为节点 ID），改为实际构图结构验证；Esc 会退出整个编辑模式；逐字 keyboard.type 产生多个输入事务，改用一次 keyboard.insertText 验证一次文本事务并点击属性关闭提交。保留 initial/repair/fixed 日志，未删除或弱化历史测试。门禁结果、时间、平台、提交和文件哈希见 verification/result.json 与 SHA256SUMS。
