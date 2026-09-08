# U01 FULL：九页完整稿待最终签收

当前状态：`full-deck-awaiting-user-acceptance`。用户 2026-09-08 20:13「可以，先这么做吧」已授权从三页扩展；不等于最终九页签收。code passed；automated passed（179 passed / 0 failed / 16 既有 skips）；real-browser/human pending。旧稿拒收及三页停机历史保留在下文。

## 本轮交付与叙事

唯一当前 `.ppte.html` 为 `Cherry-Studio-开源之路.ppte.html`，九页、406666 bytes，原生可编辑 HTML/CSS，内嵌一张 SVG 概念图与当前 PPTe 运行时。已签收三页在第 1/4/7 页保留正文与构图，只更新页码。新增第 2/3/5/6/8/9 页由本轮撰写；不是旧拒收稿换日期。封面大字、产品概述双栏、非对称观点页、图文页、反馈示例、分步协作、密集表格与收尾形成阅读变化，统一纸白/墨色/少量朱红与系统中文字体。没有改编辑器 UI 或恢复旧格式/PDF。

事实仍依据项目固定 README 67ca175，逐页出处见 `verification/full-deck/sources.json`；无实时数字、新版本或增长推断。新增行动细节明确为作者建议；反馈示例明确虚构，不虚构产品缺陷。复查了概念图素材与最终第 4 页，三条路径、汇合节点、全部端点完整，contain 裁切适当；没有使用未查看图片或整页截图。Skill 已符合轻量提醒要求，本轮不添加规则，既有源码/包/安装一致性测试继续执行。

## 一次生成与实测

本轮完整稿增强 **1 次，75.815417 ms；成稿局部修复 0 次**。增强日志含真实时间戳、参数与返回值；没有为门禁反复生成。作者构建是编译运行时，不是第二次成稿增强。九页均在真实 Chrome headless file:// 离线运行时逐页截图，Agent 已逐张查看，未见文字截断、重叠或主体裁切；不是目标机人工体验确认。

新增两项 FULL 回归：九页全部页面及文字 Range 边界（含 h3/dt/dd/a）、统一背景、离线图片解码、无控件放映、无网络/脚本错误；真实文本编辑→撤销重做→下载内容与编辑源逐字一致→关闭浏览器进程→重开九页并确认修改与图片。下载副本只在 ignored artifacts 中，交付文件哈希始终不变。首次 FULL 测试错误沿用三页导航位置，图片不在激活页导致解码断言失败；修正为第 4 页后通过。初始/修正日志都保留；无成稿修复、无断言弱化。

原六项三页/安装回归完整保留，原三页增强文件逐字节移至 `verification/representative-snapshot.html`，历史截图不变，三页断言未改成更宽松的页数检查。历史停机断言仍从 d51c729 读取；当前状态断言按真实签收阶段更新，并新增完整稿页数与 pending 检查。两项 FULL 回归加入同一仓库测试文件，随 `pnpm test` 执行。

全仓库门禁：`pnpm typecheck`、`pnpm build`、`pnpm test` 均 RC=0；179 passed / 0 failed / 16 既有 skips。签名提交使用 U01 前缀、YinsenW 作者及 signoff，不 push。

## 证据与未决项

`verification/full-deck/` 保存增强、事实映射、初始及修正测试日志、全门禁、布局与重开证据；`screenshots/full-present-1.png` 至 `9.png` 为全稿放映截图。`present-1/2/3.png` 仍是原三页开发证据。`verification/full-deck/previous-result.json` 保存先前结果原字节，当前结果见 `verification/result.json`。SHA256SUMS 覆盖本目录证据（自身除外）。

目标桌面缺少可调用物理桌面通道，原生输入法、file:// 真实人工操作及最终视觉签收仍 pending；自动化不能替用户签收。最终用户需打开九页文件评审连贯性、留白与可读性，给出认可或具体修改。TASKS.json 不标 done；U02/U03/U04/U05 不在本轮关闭范围。

---

# 以下为三页阶段与门禁修复历史（非当前状态）

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

前轮门禁（历史结果）：pnpm typecheck、pnpm build、pnpm test 均 RC=0；168 passed / 0 failed / 16 existing skipped。实现提交 `7b2666570653c9ffbef056e4e907124b4708a2be`（签名有效，含 signoff）。后续仅补充验证状态与证据，未再修改产品、Skill、样稿或测试。


## 管道修复轮：npm pack 回执兼容

管道报告 A4 的 `undefined.filename` 故障。本轮从 `5bbcc09` 接续，未改样稿、Skill 或产品运行时。原始修复请求与失败日志原字节移入 `verification/fix-round/REQUEST.md`、`pipeline-failure.log`，不删除输入证据。

已在本机真实复现原因：默认 PATH 的 npm 10.9.8 返回数组，旧测试单独和完整门禁均通过；将 `/opt/homebrew/bin` 放到 PATH 首位后，npm 12.0.2 返回以包名为键的对象，旧测试稳定产生相同 TypeError。实际输出保存于 `npm12-pack.json`，失败保存于 `reproduce-npm12.log`。两环境分别使用 Node 22.23.2 与 24.19.0，版本及平台见 `environment.json`。这属于打包测试回执兼容问题，不是已证明的产品保存故障。

修复提交 `e419e2028cc57dda65c483f83cb7fc5f623616bc`：用 Object.values 读取集合，并新增断言要求恰好一个 ppte-html 包及合法 tarball 文件名。真实 stage → pack → offline install → skill-install → 源码/包/安装内容逐字节一致性检查全部保留。新增 node --test 回归测试覆盖两类回执和空、多个、错误包名、缺失/越界文件名；不通过跳过、硬编码产物路径或削弱原断言绕过错误。

本轮仅修自动化兼容；已有干净三页 HTML 和截图哈希保持不变。U01 仍 awaiting-user-decision，code partial、human reopened；完整稿、目标桌面和新视觉签收仍有明确 pending 原因，见 result.json 和 DECISIONS.md。完整门禁和两版 npm 实际安装结果将在本轮 result.json 中记录；截图不重新包装为原生证据。

本轮最终结果：pnpm typecheck、pnpm build、pnpm test 均 RC=0；169 passed / 0 failed / 16 existing skipped。npm 10 和 npm 12 的 A4 回归与真实离线安装均 RC=0（各 2 项通过）。命令时间、平台、日志、打包回执与安装字节哈希见 verification/fix-round/ 和 verification/result.json。

## FULL 修复轮 1：裁决后的 U04 门禁

在 `4d256e4` 上定向复现管道失败：U04 当前状态已按 20:35 授权裁决改为 `decided-option-1-pdf-incomplete`，旧测试仍要求 `awaiting-user-decision`。保留原停机断言，读取裁决前提交 `24f489bdd3e983ff8ed280ae21a39d1ceec78e35` 的 TASKS；另对当前状态、裁决证据链接、选项 1 正文、禁止完成/集成和真机待验作严格断言。没有将当前状态改回等待裁决，没有放宽 PDF 几何/文字/质量要求，也未删除或跳过既有断言。

本修复轮成稿增强 0 次、成稿局部修复 0 次；继承 FULL 的一次增强耗时 75.815417 ms。交付、源码、三代表页及全部旧证据的既有 SHA256 清单核验全部匹配。无需为测试重新生成成稿。复现及门禁日志保存于 `verification/decision-gate-fix/`，最新门禁结果写入 `verification/result.json`。code/automated 与 real-browser/human 分层保持；最终完整稿未经用户认可，U01 不标 done。

本轮最终门禁：`pnpm typecheck`、`pnpm build`、`pnpm test` 全部退出 0；179 passed / 0 failed / 16 既有 skips。定向复现退出 1，修复后定向回归退出 0。既有 supervisor 脚本与日志原地保留，仅在本地 `.git/info/exclude` 排除，未纳入交付或删除。
