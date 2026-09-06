# 原方案完成度独立验收

结论：**尚未全部完成，不通过最终验收。** 主要编辑、设计系统、表格、媒体、动画和增量性能代码已有实现，大部分自动检查通过；但两处真实界面缺陷仍可复现，四项必需任务尚未收口。下一步应修复并完成当前方案，不宜进入下一阶段规划。

- 被审查 main：[`4aee9da597ceef29df30f22a65f5bafc9f2bc354`](https://github.com/YinsenWANG/ppte-2.0/commit/4aee9da597ceef29df30f22a65f5bafc9f2bc354)。提交报告前再次查询远程，main 未变化。
- 原实施方案提交：[`b8c6d00fa3e0acec47db8d9c4f3d16f3719c25f4`](https://github.com/YinsenWANG/ppte-2.0/commit/b8c6d00fa3e0acec47db8d9c4f3d16f3719c25f4)。其中 IMPLEMENTATION_PLAN.md 与 ACCEPTANCE.md 在本次 main 中没有差异。本次针对这份下一阶段方案，不重新定义最早 2.3 产品范围。
- 隔离工作树构建和测试；本提交只包含验收材料和复现探针，没有修改产品代码或 TASKS.json。
- 应用版本 `0.9.0-next.0`，实际生成 runtimeBuildId `be2a4f326d318e1e5e9e4ee977bb45cd61a7e9ce89283e621b36fba93f526e3f`，与已记录候选版本一致。

## 完成度的准确说法

32 项必需任务中，仓库自报 28 项 done，D07、P01、Q01、Q02 四项 partial。X01 QuickJS、X02 多人协作属于条件式扩展，deferred 符合原方案，不能算成必须补齐的功能。

**28/32 只是任务状态统计，不能解释成产品完成度 87.5%。** C05/E07/F06 的放映体验和 E04/F05 的属性面板存在本次新发现，因此 done 也不能直接视为最终验收通过。逐任务映射见 [TASK_MATRIX.md](TASK_MATRIX.md)。

原先要求的 NPM + 原生 Skill 路径已保留：分发脚本提供 CLI 和可选 MCP 入口，MCP stdio 不是 CLI/Skill 的启动依赖。独立运行的 C06 干净安装测试通过，覆盖在无 MCP、无模型密钥、离线条件下编译、预览、提交、重开、撤销／重做和交付。保留可选 MCP 适配器本身不违反原则。

## 本次独立执行结果

|检查|结果及边界|
|---|---|
|锁文件安装、Core/Portable build、Host build、typecheck|通过|
|完整测试首轮|392 项，387 通过、5 失败；失败涉及调用不可用的 `python`，并产生误导性的断言错误|
|补齐 Python 环境后复跑受影响的四个文件|40/40 通过，包含上述全部 5 项失败；未重跑整套 392 项，不隐去首轮失败|
|validate|通过：15 个 schema/example、语义、操作一致性和源码守卫|
|final blackbox|72 green / 0 red|
|两个新增真实 Chromium 探针|复现 R01、R02；现有绿色测试未覆盖这些实际体验缺陷|
|release-check|退出 1，明确 blocked；这是正确阻断发布，不能视为已经发布验收通过|

运行环境是 macOS arm64、Node v26.5.0、pnpm 11.22.0，浏览器版本及原始测量见 evidence 中的 JSON。没有把 Playwright Chromium 当作已完成真实 Safari、Google Chrome 或 Office 客户端验收。没有在争用资源的测试期间新做性能认证。

## R01 · P1 · 观众放映画面常驻工具栏，黑屏后仍可见

关联：C05、E07、F06；原方案 §5.1 / A06。

定位：[presenter-tools.ts](../../../packages/editor-dom/src/presenter-tools.ts) 第 21–24、51–56、83–94 行。共享适配器无条件向观众根节点插入固定定位工具栏，层级 150；黑幕层级 140。更新逻辑仅隐藏下一页预览，没有隐藏工具栏或实现闲置收起。

复现：构建 full-portable → 进入 present（即使浏览器拒绝全屏）→ 将焦点移回 BODY、鼠标移离控件 → 等待 3.2 秒；然后点黑屏，再次移除焦点与悬停并等待。两次工具栏都是 display:flex、visibility:visible、opacity:1，1440×1000 视口下宽 1424、高 48，包含 8 个按钮。黑屏时仍覆盖在黑幕上。已排除“按钮仍聚焦所以应显示”的因素。此时 contenteditable 数量为 0，问题是放映界面污染，不能误报成仍允许文本编辑。

原方案要求 present 的退出控件悬停／聚焦出现，演讲者模式承载备注、计时与下一页预览。当前常驻整排控制不满足该合同。共享代码影响 Host 和 Portable；独立最小探针使用 Portable，Host 集成测试生成的观众截图也出现相同工具栏。

修复验收：共享实现明确区分观众与演讲者控制；无悬停／焦点时观众画面无常驻工具栏，黑屏覆盖观众内容。保留可发现且键盘可达的退出／恢复入口；校验单屏、双屏、弹窗被拒绝、全屏被拒绝、Esc 返回及黑屏恢复。新增断言必须检查实际可见性和截图，不能只检查 contenteditable=0 或按钮存在。

证据：[闲置放映](evidence/present-idle.png)、[黑屏](evidence/present-blackout.png)、[测量 JSON](evidence/presentation-probe.json)、[复现脚本](probe-presentation.mjs)。

## R02 · P2 · Host 属性面板部分文字白底白字

关联：E04、E07、F05。

定位：[object-properties.ts](../../../packages/editor-dom/src/object-properties.ts) 第 22 行给整个属性面板设置浅底色但没有统一前景色；[host.css](../../../apps/host/src/host.css) 第 17 行的白色被外层标题与 [animation-controls.ts](../../../packages/editor-dom/src/animation-controls.ts) 第 11–29、43 行标签继承。内部对象属性子树有深色文字，不能保护它之外的标题和动画区。

复现：构建 Host → 打开构建产物 → 新建文稿。对象属性、选区格式、动画、翻页效果、翻页方向、翻页时长以及说明文字的实际前景是 rgb(248,250,252)，背景 rgb(246,247,250)，对比度约 **1.024:1**，肉眼几乎不可读。

修复验收：统一属性面板与 Host 主题的前景／背景配对，覆盖标题、说明、空选区、单选、多选、禁用状态和动画配置；在 Host 与 Portable 中检查 computed style 与截图，普通文本达到至少 4.5:1 的验收目标。不能仅修改某份导出的 HTML。

证据：[截图](evidence/host-properties-contrast.png)、[测量 JSON](evidence/host-contrast-probe.json)、[复现脚本](probe-host-contrast.mjs)。该探针只取可见直系文本和实色继承背景，不能替代全站无障碍审查。

## R03 · 必需未完成 · D07 成稿质量及人工任务

依据：[authoring-benchmark.md](../../evolution/quality/authoring-benchmark.md)、[benchmark-report.json](../../evolution/quality/benchmark-report.json)。协议与验证器已实现，但 reviewers、runs、humanReviews 为空，不能证明“生成结果已经好看且好改”。

收口条件：按原协议保存 5 类材料 × 演示／阅读 × 基线／候选 × 2 seeds 的 40 份生成结果、首轮失败与人工修改记录；项目负责人加至少两位目标用户执行适用脚本，记录修正时间、协助次数与评价。G2 完成 M2 适用项目，最终 Q01 完成全部 A21 十项任务。不得用合成评审记录或只挑成功页面代替。

## R04 · 必需未完成 · P01 真实性能与预算

依据：[P01.md](../../evolution/quality/P01.md)。现有参考是单机 Chromium、合成 12/30/100 页、full-portable 离线入口；文档明确 12 页不是 Cherry、30 页不是 50 MiB。候选阈值未完成真实产品预算校准。

收口条件：补齐原 Cherry 语料、30 页 50 MiB 真资源、Host 与 Portable、物理低性能设备、Safari、真实 IME／指针反馈以及至少 20 次内存与释放循环；分设备保留原始样本、资源／字体／产物哈希和 p95，再冻结预算。不要将整段拖动耗时与单次反馈预算比较，也不要用 CPU 节流宣称已经覆盖另一台物理设备。

## R05 · 必需未完成 · Q01 真实客户端与交付闭环

依据：[Q01.md](../../evolution/quality/Q01.md)、[client-matrix.json](../../evolution/quality/client-matrix.json)。observations 为空，状态 unverified。

收口条件：在声明必需的实际 Safari、Google Chrome 上验证 Host、单 HTML 和离线目录入口；在实际 LibreOffice Impress 验证原生 PPTX 文本、形状、图片、图表、表格的打开、编辑、另存、重开、阅读顺序与视觉表现。绑定确切版本和交付物身份，保留截图／记录，再完成 A21 人工面板。没有声明支持的 PowerPoint／Keynote 不应临时扩大成此次必须支持的客户端。

## R06 · 必需未完成 · Q02 发布及回滚证据可恢复性

依据：[release-manifest.json](../../evolution/quality/release-manifest.json)、[本次 release-check](evidence/release.log)。本地候选安装和合成旧 HTML 升级演练已有记录，但 criterion 1 未通过，最终发布仍被 D07/P01/Q01 阻断。

此外，新检出中缺少 `artifacts/q02-drill-final/source.retained` 等被清单引用的保留产物，release-check 报 ENOENT。旧记录本身不能让另一台设备复验回滚保全链。这是证据交付缺口，不据此断言升级实现会损坏用户文件。

收口条件：先解决前述缺陷和门禁；提供可取回、可校验的候选包、旧包、源文件及升级副本归档和恢复说明，或明确保留路径重新执行完整演练并生成同一批产物的清单／收据。接收设备应能从干净检出恢复证据并通过 release-check。Git 推送、候选包、npm 正式发布、持久 Skill 安装、用户文件升级分别记录真实状态，不把代码已推送说成全部发布完成。

## 交给远程开发的执行顺序

1. 修复 R01、R02，并在共享源码上增加对应浏览器回归检查，保持 NPM + 原生 Skill 原则。
2. 完成 R03、R04 的真实数据与人工工作；无法访问真实用户或设备时明确提交待协作项，保持 partial，不能编造通过。
3. 使用修复后的确切交付物完成 R05；如果产物变化，重新确认原证据是否仍适用。
4. 补齐 R06 证据恢复与发布回滚，运行完整测试、黑盒、原方案门禁；提交修复提交 ID、可取得的证据及逐项回应。
5. 交回独立复验。全部问题关闭后，再讨论下一阶段，不以补文档代替运行证据。

## 复现与证据说明

先按仓库要求安装锁文件依赖和 Playwright Chromium，提供有 jsonschema／python-pptx 的 Python 环境并确保 `python` 与 `python3` 可调用。根目录执行 build、host:build 后可运行本目录两个 `.mjs` 探针。探针生成新的截图／JSON，会覆盖本目录同名证据；复验请在新目录或新审查提交中保留原证据。

本次命令与原始输出分别为：build → build.log；host:build → host-build.log；typecheck → typecheck.log；validate → validate.log；`node --test dist/tests/*.test.js` → tests.log；补齐环境后复跑 design-system-contract、pptx-table-native、table-v2-contract、text-run-style-profile 四文件 → retest.log；`node scripts/blackbox-gates.mjs --milestone final` → blackbox.log；`node scripts/release-check.mjs` → release.log。

证据位于 [evidence](evidence)，文件摘要位于 [SHA256SUMS.json](SHA256SUMS.json)。截图证明已复现的具体问题，不代表全产品逐屏视觉评测完成。
