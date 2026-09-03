# PPTe 2.0 v2.3 全量 Code Review（功能视角）

审计对象：`/tmp/ppte2/review-copy`，提交 `35f384b`，包版本 `0.4.0-rc.1`  
审计标尺：`docs/PPTe_2.0_完整研发方案_v2.3.md`，重点为 §2、§5、§7、§11～13、§16～18、§22、§24～25、§27～28、§36、§40～41，以及 ADR、开发启动清单。  
结论先行：**当前实现是一组有价值的底层 reference-runtime primitives，但不是方案所称的 GA-C 产品。不能按“PPTe 2.0 完整实现”对外试用。** 真实用户没有可进入的 Host；Portable Quick Fix/Light Edit 文件不可编辑；PDF/PNG 会丢主要内容；Agent 局部编辑、重生成、修订回流和崩溃恢复均存在正常使用下的数据完整性问题。

## 审计方法与实跑结果

除源码/规范逐章对照外，本次实际构造并运行了中文、emoji、字面量 `</script>`、长文本、RichText、多页、Group、Fact、Chart、Widget、Portable、PDF/PNG/PPTX、Patch、并发 revision 和真实 `SIGKILL` 输入。临时脚本和产物只写入 `/tmp/ppte2/scratch/`，仓库工作树审计前后均为 clean。

主要复现入口：

```bash
cd /tmp/ppte2/review-copy

node /tmp/ppte2/scratch/core_journey/core-journey.mjs
node /tmp/ppte2/scratch/root/functional-probes.mjs
node /tmp/ppte2/scratch/agent_editing/probe-agent-editing.mjs
node /tmp/ppte2/scratch/portable_export_recovery/generate-artifacts.mjs
node /tmp/ppte2/scratch/portable_export_recovery/crash-parent.mjs
```

官方命令的真实结果：

- `npm test`：61 passed，0 failed，0 skipped。
- `npm run e2e:ga-c`：exit 0，输出 `status: ok`。
- 六档脚本 `e2e:vertical-slice / milestone / beta / ga-a / ga-b / ga-c` 均 exit 0。
- 但六档 E2E 全部只是 `package.json:14-19` 调同一个 Node CLI 的不同分支，不含真实 Host、浏览器编辑、文件双击、Office 打开或导出像素对比；详见 Finding 31。

优先级口径：P0 为阻断 GA/主要旅程，或正常操作会导致用户内容丢失；P1 为高频功能错误、承诺不可达或需要开发者级绕路；P2 为中等影响的功能/诊断/可维护性缺陷；P3 为轻微问题。本报告没有收录纯攻击面问题；唯一与过滤规则有关的条目也是普通正文和官方 Code Widget 被阻断的正常使用缺陷。

## Findings

### 产品入口与核心编辑路径

1. **P0 | `package.json:9-21`、`packages/editor-react/src/index.ts:1-66`、`apps/contract-deck/index.ts:825-831`、`packages/agent-tools/src/index.ts:55-83,566-590` | 用户没有可启动的编辑器，也没有“上传资料→Mock Agent 生成演示”的产品/API 闭环；只能手写 Document 和 Transaction 调底层库，§41 A 以及题目中的整条新用户旅程从第一步就无法开始 | 最小修复建议：交付最薄可运行 Host（新建/打开、画布、页栏、双击文字、拖图、多选、备注、演示、保存）和 `PresentationIR → compilePresentation → 初始化多页 Transaction` orchestrator，并以浏览器用户动作 E2E 验收。**

   实测 `apps/` 只有 `contract-deck`；`editor-react` 没有 React/UI 依赖或组件，只提供 selection overlay、单元素 drag transient 和 IME helper；唯一 app 默认动作只是把一个手工 fixture 写成静态 HTML。`MockAgent` 只有单个 Text replace，没有 create/generate presentation 工具。

2. **P1 | `packages/renderer-react/src/index.ts:43-55,113-168,255-262`；复现 `/tmp/ppte2/scratch/core_journey/out/contract-deck-entry.png` | 用户打开唯一 reference preview 会看到空白页；浏览器不识别 `du` CSS，实测 Slide 高度为 `0px`、标题回落到 `(0,0)/16px`，Widget wrapper 还缺 `position:absolute` | 最小修复建议：Renderer 在序列化层把 slide-space `du` 映射为合法 CSS/统一缩放变量，并给所有元素类型一致的绝对定位；增加 Chromium computed-style 和 screenshot golden。**

   `contract-deck.html` 的实测 computed style 为 `slide.width=800px, height=0px`、`title.left=0px, top=0px, fontSize=16px`。当前测试反而把 `4du` 等字符串当正确输出断言，未验证浏览器布局。`renderer-react/src/index.ts:424` 的 ASCII 白名单还会把合法字体名“思源黑体 SC”变成“ SC”，造成静默字体回落。

3. **P1 | `packages/schema/src/operations.ts:117-170`、`packages/operations/src/index.ts:107-111`、`packages/semantic-identity/src/index.ts:49-60` | 高频“复制页”没有 operation/builder；只改新 Slide ID 的直觉式深拷贝会被四个 `ELEMENT_ID_DUPLICATE` 拒绝，Host 必须自行重写 element/paragraph/run/group/reading-order/anchor 引用 | 最小修复建议：提供 canonical `duplicateSlide` operation/builder，集中完成实例 ID 深度 rekey、页内引用重写与 semanticKey 保留，并测试两页分别编辑互不串。**

4. **P1 | `packages/schema/src/operations.ts:48-59,117-170`、`packages/change-contract/src/index.ts:138-142`、`packages/renderer-react/src/index.ts:113-121`、`packages/portable-runtime/src/index.ts:292-319,477-478` | 备注和动画权限是空壳：没有 typed notes/transition/appearStep/animation operation；用唯一可行的 `slide.update` 又被要求 `structure` 权限；即使过度授权保存成功，fade/slide/push/时长都不执行 | 最小修复建议：增加精确的 notes、transition、appearStep、animation operations 与 unset 语义，并让 Presenter/Portable 执行同一白名单动画状态机。**

   实测 `permissions:['notes']` 和 `permissions:['animation']` 均返回 `SCOPE_VIOLATION`。Renderer 只输出 `data-ppte-appear-step`，不读 animation/transition。步骤为 2、5 时公开 Presenter class 还会走 `0→1→2→3→4→5` 的空点击，而 HTML Next 又采用不同算法。

5. **P1 | `packages/core/src/index.ts:163-171`、`packages/change-contract/src/index.ts:461-470`；复现 `node .../probe-agent-editing.mjs | jq '.lockUndo'` | 用户执行“锁定对象”后立即 Undo 会被刚设置的 locked policy 拦截，历史仍在但对象无法恢复 | 最小修复建议：对已校验历史生成的 system inverse 提供受控 policy 豁免，或在锁操作逆向路径中先恢复锁状态。**

6. **P2 | `packages/schema/src/document.ts:250-257`、`packages/operations/src/index.ts:491-536`、`packages/change-contract/src/index.ts:461-470` | 用户锁定 LogicalGroup 后仍可移动/缩放整组，提交成功且无 Issue，锁定状态与实际行为相反 | 最小修复建议：所有 `group.*` 在解析成员前检查 group 自身的 `locked/editPolicy`，并补正向、逆向和锁冲突测试。**

### Agent、Compiler 与内容一致性

7. **P0 | `packages/schema/src/operations.ts:203-206`、`packages/operations/src/index.ts:128-135`、`packages/change-contract/src/index.ts:138-142,378-385,461-470`；复现 `node .../probe-agent-editing.mjs | jq '.slideUpdateScopeBypass'` | 用户只选标题授权 Agent 修改时，Agent 可用 `slide.update({elements: ...})` 改正文；Preview 和 Commit 都成功且 Issues 为空，Selection Scope、allowedElementIds 和 locked/editPolicy 对实际被改对象全部失效 | 最小修复建议：把 `slide.update` 白名单限制为真正的 slide metadata，禁止 patch `elements/rootOrder/groups`；同时按 Actual Diff 解析实际被改 Element，再与 Scope/Contract/Policy 比对。**

   复现事务声明唯一允许 `text_title`、`maxChangedElements=1`，实际只改 `text_body`，仍通过。这不是恶意攻击场景，而是 generic operation 在正常 Agent 编排中会造成非目标修改的核心功能缺陷。

8. **P1 | `packages/agent-tools/src/index.ts:404-408`、`packages/design-compiler/src/index.ts:282-300`；复现 `jq '.regenerateSelectionDirection'` | “重新生成所选”行为与名称完全相反：选中标题后标题被当作 protected anchor，未选中的背景、正文、图片被删除并重建，事务作用域升为整页 | 最小修复建议：Selection 应是替换目标；若需要“保护所选、重做其余页面”，另设明确命名的 Visual Redesign 操作并在 UI 展示保护清单。**

   现有 `tests/week7-13-contract.test.ts:149-154` 只断言所选标题没有被删除，正好把反向行为固化为成功测试，没有断言“非目标变化为 0”。

9. **P1 | `packages/design-compiler/src/index.ts:282-298`、`packages/agent-tools/src/index.ts:626-641`、`packages/change-contract/src/index.ts:499-543` | regenerate 的 semanticKey/Lineage 只保住了表面身份，`preserveOnRegenerate:true`、EditPolicy、Fact/Source semanticRefs 和局部属性会丢；改用正式 Protected Anchor 时，相同可见文字又会因 paragraph/run ID 变化被误报为 content 冲突 | 最小修复建议：把 `preserveOnRegenerate/protected` 纳入 keep/anchor 解析，定义各元素的完整语义投影并重应用受保护局部属性；Anchor 内容比较应忽略内部 RichText 节点身份。**

   干净部分是普通标题的文字、semanticKey、`replacesElementId/sourceSemanticKey` 能保留；核心卖点的问题在于用户真正的局部策略和引用关系没有被继承。

10. **P1 | `packages/agent-tools/src/index.ts:411-428,626-641`、`packages/design-compiler/src/index.ts:105-132`；复现 `jq '.regenerateIgnoresAgentIR,.mixedContentAgentLayout'` | 用户的重新设计意图没有输入通路：传入含新标题的 `slideIR` 被忽略，工具总是从当前页反推旧 IR；官方 GA-B 的 title/body/image/chart/metric 混合页又因缺槽位直接 `RECIPE_SLOT_UNAVAILABLE`，重排和重生成都无 Transaction | 最小修复建议：公开并验证 Agent-produced Slide IR；当前页反推只作为明确的 preserve-content reflow；补覆盖 GA-B/GA-C 常见混合对象的 Recipe 或保留未匹配对象。**

11. **P1 | `packages/layout-recipes/src/index.ts:83-85,131-168`、`packages/design-compiler/src/index.ts:171-184`、`packages/schema/src/slide-ir-validation.ts:117-207`；复现 `node /tmp/ppte2/scratch/root/functional-probes.mjs` 的 `designCompilerOverflow` | Compiler 接受会产生关键文字溢出的 AI 输入并返回 0 error/0 warning，尽管每个内置 Recipe 声明 `max-overflow:0`；物化成文档后才出现 `TEXT_OVERFLOW` | 最小修复建议：在 candidate materialize 后按真实 theme/font metrics 执行 L2/L3 质量规则，关键 overflow 未清零就拒绝或换 Recipe；让 slot 的 maxChars/质量约束真正参与内置配置。**

12. **P1 | `packages/operations/src/index.ts:328-337`、`packages/core/src/index.ts:223-279`、`packages/agent-tools/src/index.ts:382-387,593-608`；复现 `functional-probes.mjs` 的 `textFit` | “Fit”只校验调用者给的字号更小，不校验是否真正消除溢出；64→63 可成功提交但 overflow 仍在。同时 Commit 把 Preview 的 `TEXT_OVERFLOW` warning 清空，Agent 的 content-only 合同又固定免确认，因此明显溢出的文案可以无提示自动落库 | 最小修复建议：Fit 应由文本测量器求解并验证目标约束；成功 Commit 必须传播 Preview warnings，有 warning 时动态要求确认或返回 `committedWarnings`。**

13. **P1 | `packages/diff/src/index.ts:22-44,82-93`、`packages/design-compiler/src/index.ts:286-308`；复现 `jq '.replacementAssetBudget'` | 图片在 semantic replacement 时从 `asset_pixel` 换为 `asset_second`，合同明明是 `maxReplacedAssets=0`，实际统计仍为 0 并通过；用户设置“不可换图”没有效果 | 最小修复建议：沿 Structural Diff 已识别的 semanticKey/Lineage replacement 比较前后 Image Asset，并纳入同一 mutation budget。**

14. **P1 | `packages/operations/src/index.ts:829-865`、`packages/agent-tools/src/index.ts:487-491`；复现 `functional-probes.mjs` 的 `factSync` | Fact 同步找不到旧显示值时，会把首个 run 改成 Fact 值并清空其余 runs；实测“Revenue was 41% last year; target is 50%.”被整个改成“42%” | 最小修复建议：必须携带并匹配 previousValue/明确标注的数值区间；无法唯一安全替换时返回可理解冲突，绝不能退化成覆盖整段。**

### Portable 文件体验

15. **P0 | `packages/portable-runtime/src/index.ts:148-345,349-353,477-478`；复现对生成的 `quick-fix.ppte.html`/`light-edit.ppte.html` 搜索 `contenteditable|editText|cropImage|saveAsProject` | 用户双击 Quick Fix 或 Light Edit 文件后只能 Previous/Next/Fullscreen；无法改文字、换图、裁图、改 Chart、移动、Undo 或保存。真正编辑方法只存在于 Node class，完全没有打包进 HTML | 最小修复建议：把 Session/Operation、选择和编辑 UI、Undo、文件导入与下载保存真正打入相应 profile；增加从 `file://` 打开产物、点击输入、保存并重开的浏览器 E2E。**

   生成物中无 `contenteditable`、输入控件或保存 handler，公开的 `globalThis.PPTEPortable` 也只有读取与翻页。`tests/week11-16.test.ts:29-47` 和 GA-C E2E 实例化的是 Node `PortableRuntime`，从未操作生成文件。

16. **P1 | `packages/portable-runtime/src/index.ts:148-160,186-204` | 即使开发者绕过 HTML 直接调用 Node Quick Fix，“替换图片”也只能选已经存在于 Document 且构造器预注入字节的 assetId；选择本机新图片返回 `ASSET_MISSING` | 最小修复建议：增加校验字节后原子执行 `asset.upsert + image.replaceAsset` 的导入 API 和文件选择 UI，并用不同 hash/bytes 验证 revision 和保存重开。**

   现有测试用 `asset_pixel` 替换它自己，返回 `ok:true` 但 revision 不变，因此没有测试到用户所理解的“换一张图”。

17. **P1 | `packages/portable-runtime/src/index.ts:279-290,356-441`；复现 `generate-artifacts.mjs` 的 Fact Quick Fix case | GA-B Fact Quick Fix 修改成功后，默认“保存为新项目”失败，报 Chart 文档需要 `ppte-2.0-ga-b.1`；只有调用者知道并显式传内部 compatibilityProfile 才能保存 | 最小修复建议：从当前文档推断并保留最低兼容 Profile；合并 Portable 与 file-format 的重复 checkpoint/profile 逻辑，避免两套默认值继续漂移。**

18. **P1 | `packages/portable-runtime/src/index.ts:349-353`；复现 `/tmp/ppte2/scratch/core_journey/out/portable-du-text.png` | 为修复无效 CSS，Portable 对整段完成 HTML 做 `.replaceAll('du','px')`，会改普通正文/ID/路径；实测 `Product education module` 显示为 `Propxct epxcation mopxle`。同时 1920×1080 子画布未等比缩放，笔记本窗口会裁掉右/下内容 | 最小修复建议：只在 CSS 数值 serializer 转换单位；用固定 inner canvas + 单一 transform/viewBox 适配 viewport，禁止全 HTML 替换。**

19. **P2 | `packages/portable-runtime/src/index.ts:65-67,99-105,156-188`、规范 §24.7 | Profile 与预算实现漂移：合法 GA-C Area 文档的 Viewer/Quick Fix 固定按 GA-B 拒绝；Light Edit 反而不能执行 Quick Fix 的文字/换图且误报 Viewer；Light Edit 用 2 MB 而非规范 3 MB，并把重复嵌入的 Asset/Font 计入规范明确“不含资源”的 runtime 预算 | 最小修复建议：将文档兼容 runtime 与编辑 surface 解耦，明确 Light Edit 为 Quick Fix 超集；runtime 和资源分开统计且资源只嵌一次。**

### 导出体验

20. **P0 | `packages/exporter-pdf/src/index.ts:41-50,71-136`、`packages/capability/src/index.ts:122-130`；产物 `/tmp/ppte2/scratch/portable_export_recovery/audit-pdf.png` | PDF 不使用 Reference Renderer：中文/emoji/换行变成 `?`，图片从不读取 asset bytes，只输出灰框和 `[image]`，Chart/Component 也是占位；某些最简输入仍返回 `ok:true,degraded:false` 并把 Image 报为 `native` | 最小修复建议：在固定浏览器/字体环境由同一 Reference Renderer 生成页面并嵌入真实字体/图片；实现前至少把占位输出标为 unsupported/degraded，禁止 clean/native 结果。**

21. **P0 | `packages/exporter-pdf/src/index.ts:56-66,160-171`；产物 `/tmp/ppte2/scratch/portable_export_recovery/audit.png` | PNG renderer 只画背景和 Shape，Text、Image、Chart、Component 一个像素都不画；实测只有背景/Text/Image 的 320×180 页面导出为单一颜色，但 API 返回 `ok:true` 并声称对象已 rasterized | 最小修复建议：真正栅格化 Reference SVG/HTML；用像素/golden/感知 diff 验收，而不是只检查 PNG signature 和 degraded 标志。**

22. **P1 | `packages/exporter-pptx/src/index.ts:175-192,207-221,225-300`、`packages/capability/src/index.ts:122-130` | Semantic PPTX 能生成结构有效的 Text Box/Picture/Shape，但静默丢页面背景、rotation、opacity、段落数、run 级 italic/underline/color；两段富文本被压成一个 paragraph/run。两种 PPTX 还会引用未嵌入字体，Image PPTX 的 SVG 保留 live `<text>`，收件机可替换字体/重排，而报告仍称 native | 最小修复建议：映射常用属性和 RichText runs；无法映射/嵌字体时逐属性报告 `font-replacement/layout-risk/static`，图片版文字轮廓化或真正栅格化，并增加 Python-pptx/Office 属性断言与视觉 golden。**

   实测 Semantic PPTX 返回 `ok:true,degraded:false,issues:[]`；Python-pptx 只读到 1 paragraph/1 run，第二段的 italic/underline/blue 全失。缺 asset bytes 时，返回值已失败，但包内 `ppt/ppte/capability-report.json` 仍是检查资源前的 `ok:true,issues:[]`，说明内外能力报告也会自相矛盾。

### Save/Open 与崩溃恢复

23. **P0 | `packages/file-format/src/index.ts:48-74,172-218`、`packages/recovery-journal/src/index.ts:159-200`；复现 `node /tmp/ppte2/scratch/portable_export_recovery/crash-parent.mjs` | 真实独立子进程完成 3 次 durable Commit 后被 `SIGKILL`，普通 `PpteFileService.open()` 只打开旧 checkpoint，不检测 Journal；用户重开会看到三步都“丢了”，只有知道私有 journal 路径并手工调用 read/replay 才能 3/3 恢复 | 最小修复建议：提供 Host 级 open/recover API，按 documentId+baseRevision 自动发现 Journal，在隔离 draft 校验后提示恢复/放弃/另存，并在成功 checkpoint 后清理。**

24. **P1 | `packages/core/src/index.ts:37-44,69-97,163-170`、`packages/file-format/src/index.ts:89-96,214-218`、`packages/recovery-journal/src/index.ts:18-23` | 正常保存重开和崩溃恢复后 Undo 栈都必为空：checkpoint 虽带 recent forward transactions，但 Session 没有装载 history 的入口，Journal replay 也不返回可恢复 inverse | 最小修复建议：增加受校验的 Session restore factory，从 checkpoint tail 与 journal transactions 重建精确 inverse history；否则不要声称 Standard Working 的最近 200 步可逐步 Undo。**

   实测 checkpoint 存有 1 条 recent transaction，但 `new PpteSession(opened.document).undo()` 返回 `UNDO_EMPTY`；手工恢复 3 条 committed journal 后同样 `UNDO_EMPTY`。

25. **P1 | `packages/recovery-journal/src/index.ts:159-184`、`packages/operations/src/index.ts:72-74`、`packages/validation/src/index.ts:68-69` | Journal 对两类正常 GA 操作无法恢复：checkpoint 后新导入图片即使字节仍在 CAS，也因只查 base document 的 asset table 报 `ASSET_MISSING`；GA-C Widget 的 `component.updateProps` 又固定按默认 GA-B replay，报 `UNSUPPORTED_OPERATION` | 最小修复建议：replay 接受按 hash 的 CAS/blob resolver，先验证/恢复资源；Journal/header 或恢复入口携带并全程使用 checkpoint compatibility/runtime profile。**

### Revised Copy 与 Patch

26. **P0 | `packages/reviewer/src/index.ts:208-215,394-397`；复现 `node .../probe-agent-editing.mjs | jq '.reviewerDeleteVsLocalEdit'` | Base 有标题、本地后来修改标题、修订副本删除标题时，Reviewer 错误标为 `deleted`、冲突数 0；接受后直接删掉本地新文字，属于正常修订回流中的数据丢失 | 最小修复建议：存在性比较必须考虑完整 Base→Local/Base→Revised 变化；delete-vs-any-modify 一律生成可人工选择的冲突单元。**

27. **P1 | `packages/reviewer/src/index.ts:266-272,318-378`；复现 `functional-probes.mjs` 的 `revisedCopy` 或 `jq '.reviewerOmittedDomains'` | Reviewer 对 slideOrder、notes、transition、visualStrategy、protectedAnchors、rootOrder、appearStep、animation、opacity、tags、description 等持久化字段完全无感；paragraphStyle/boxStyle 虽形成 style unit，却附 0 operations，接受时报 `REVIEW_EMPTY` | 最小修复建议：为所有持久化领域建立 Review Unit 和 typed operation；暂不支持的字段必须显式标 capability gap，不能当作 unchanged 或给出不可执行的接受项。**

28. **P1 | `packages/core/src/index.ts:202-215`、`packages/patch-format/src/index.ts:102-158`、`packages/reviewer/src/index.ts:163-196` | Patch 生命周期没有闭环：base 不匹配只报错而不进入三方 Compare；篡改 `headRevision` 为全零仍 validate/apply 成功；GA-C Widget Patch 默认标 GA-B，两个公开应用入口又一边失败一边成功 | 最小修复建议：Patch 携带/解析共同 Base 或由调用者提供 Base 并返回 CompareResult；完整应用后校验 headRevision；从内容推导 Profile，所有入口按 manifest 选择并校验同一 runtime。**

29. **P2 | `packages/patch-format/src/index.ts:281-296`；复现 `functional-probes.mjs` 的 `patchLiteralText` 和 `jq '.codeWidgetPatchRejected'` | 普通标题包含字面量 `</script>` 就无法进入 Patch；官方一等 `core/code` Widget 的必需 `props.code` 也仅因字段名叫 code 被拒绝 | 最小修复建议：按 Operation/Schema 字段类型验证数据；RichText 和受控 Code Widget 字符串允许作为数据传输，禁止用全局字符串/键名正则替代边界模型。**

### 诊断、测试可信度与工程边界

30. **P2 | `packages/validation/src/index.ts:405-440`；复现 `functional-probes.mjs` 的 `overrideDebt` | Style Override Debt 只统计 preset 中已经存在的字段；关键标题新增合法 `letterSpacing:7` 时实际 override 存在，但报告 `overriddenFields:0`，主题债务诊断漏报 | 最小修复建议：按该元素类型所有受支持样式字段统计 override，分母使用可控字段全集，并测试 preset 原先缺失的新增 override。**

31. **P1 | `package.json:14-19`、`apps/contract-deck/index.ts:259-302,552-592,707-738`、`tests/week7-13-contract.test.ts:136-155`、`tests/week11-16.test.ts:29-47,119-127`、`docs/PROGRESS.md:3,29-52` | 61 tests 和六档 E2E 大量属于“实现自证”，使文档的“GA-C complete/全部里程碑完成”结论失真：所谓 open-to-interactive 只构造 Session，page-switch 只拼 HTML，Portable first screen 只生成字符串，Quick Fix/Light Edit 操作 Node class，PDF/PNG 只查文件头，PPTX 只查 ZIP/XML 标签 | 最小修复建议：把 §41 A～J 转为独立黑盒验收：真实 Host 浏览器操作、`file://` Portable 编辑保存、真实 kill/reopen、像素 golden、Python-pptx/LibreOffice/PowerPoint 打开和内容属性断言；PROGRESS/CHANGELOG 在这些通过前降级为 reference-core prototype。**

## §41 验收场景覆盖与测试可信度

| 场景 | 本次实跑结论 | 现有自动化的真实覆盖 |
|---|---|---|
| A AI 新建 | **不通**：无上传/目标输入、生成 orchestrator 或 Host；Compiler 还接受关键 overflow | 只有手写一页 IR/fixture 的 API 测试；无 10 页生成用户任务 |
| B 人工小改 | **底层部分通**：IME helper、特殊文字 Transaction、Journal append、checkpoint 内容 round-trip 正确；无双击 UI，Commit 隐藏 warning，重开 Undo 丢失 | adapter/core 单测，无浏览器双击/IME/save/reopen/undo E2E |
| C Flat Group | **普通 core happy path 通**：create→move→resize→undo 精确、默认不缩字号、ungroup 只删关系；locked group 失效 | core operation/property 测试；无多选 UI/锁组测试 |
| D Agent 局部修改 | **受限路径通、边界不通**：标准 text op preview/commit/undo 正确；`slide.update` 可改非目标，warning 可自动落库 | 测到标准 allowed op/out-of-scope helper，没测 generic slide patch 与 Actual Diff |
| E 页面重排 | **简单页 API 通，常见混合页不通**：reflow 为 preview-only 且基本 invariant 可保；GA-B 混合页无 Recipe | 一页 API/内部 hash；无真实用户接受/拒绝和 mixed content |
| F 视觉重设计 | **不符合语义**：regenerate_selection 方向反了，preserveOnRegenerate/refs 丢失，Anchor 可假冲突 | 测试把“所选未删除”当成功，没断言非目标为 0 或局部修改继承 |
| G 崩溃恢复 | **库级手工重放部分通，产品重开不通**：纯文本 3/3 可手工恢复；无自动发现、Undo，资源/Widget replay 失败 | fault injection/manual replay；无真实启动检测。本次补做真实 `SIGKILL` |
| H Portable Quick Fix | **生成文件不通**：HTML 只读；Node class 可改预注入文字/旧图片并 undo | 只测 Node class 和静态 HTML audit，从未在生成文件输入/保存 |
| I 修订副本回流 | **简单同字段路径通，完整流程不通**：基础 Text/Chart、独立字段和同字段冲突可识别；删除-修改会丢数据，多领域遗漏，Patch 生命周期不闭环 | happy-path Text/Chart/asset round-trip；无 delete-vs-edit、字段全集、head/profile 测试 |
| J 导出 | **不通**：PDF 图片/Unicode 丢失，PNG 可为纯背景，Semantic PPTX 常用格式静默丢失 | PDF/PNG signature；PPTX ZIP/正则/XML 结构。无像素/字体/Office 内容验证 |

## 已查且干净的路径

以下不是“整项能力已完成”，而是本次用真实输入确认可靠的具体边界：

- Session Preview 是纯函数：中文、emoji、字面量 `</script>` 的 Preview 不改变 Document、Revision、History、Redo 或 Save State；stale revision Commit 原子拒绝并给 `REVISION_CONFLICT`。
- IME helper 在 composition 中不提前提交，composition end 只形成一个 `text.replaceContent`；特殊文字在 Document 和 checkpoint 中逐字 round-trip，HTML 正确转义。
- 单图片 drag transient 在 pointer move 阶段不改 revision，pointer up 后只形成一个 `element.move`。
- 同一 Session 内，多步“内容→图片几何→文档标题”Undo/Redo 交叉可精确恢复各 revision；`document.updateMetadata` 不改 slides hash。
- 未锁定的 Flat Group create/move/resize/undo 几何精确，默认不会隐式缩 Text 字号；ungroup 只删除关系。
- 手工完整 rekey 后，复制出的两页可分别编辑且互不串；这证明模型能承载结果，缺的是可靠公开复制能力。
- checkpoint 原子替换和旧文件可读边界通过；正常 save/open 的 canonical revision、页序、特殊文字、备注和 animation 字段值可保持。
- 真实 `SIGKILL` 下，三个纯文本 committed Journal record 的 checksum/sequence 完整，手工 replay 3/3 恢复，旧 checkpoint 仍可打开。
- 标准 Agent text-only transaction 的 Scope/Contract、preview-only、确认、commit、undo 正常；基础 mutation budget（同 ID 的真实 theme/asset 变化）会拒绝并返回 summary。
- 普通 regenerate 的标题可见文字、semanticKey 和 Replacement Lineage 能继承；问题集中在 Selection 方向、策略/引用/局部属性以及 Agent IR 输入。
- 显式 Fact 更新 builder 在携带可匹配 previousValue 的官方 fixture 上能以一个事务同步跨页 Text/Chart，并可整体 Undo。
- Revised Copy 对已实现的 Text content/Chart field 可做三方比较；独立字段可选择接受，同字段冲突不会自动覆盖；新 asset payload 的简单 round-trip 通过。
- Portable Viewer 产物确实自包含、无外链、含 origin/capability metadata，并有翻页、click-step、全屏和备注逻辑。直接调用 Node `PortableRuntime` 时，预注入资源范围内的 Quick Fix/Light Edit 操作及 Undo 基本正确，特殊文字也能保存 round-trip。
- Image PPTX 与基础 Semantic PPTX 都是结构可解析的 OOXML ZIP；前者每页有独立 SVG，后者确有可编辑 Text Box、Picture、Shape，简单 Chart 以 SVG Picture 而非整页截图输出。缺陷是视觉/字体/属性忠实度和报告真实性，不是 ZIP 完全不可打开。

## 总体判断

**不建议当前版本以 PPTe 2.0 GA-C 产品身份进行外部试用。** 如果把范围明确改名为“开发者用 semantic document/reference-core prototype”，底层 Session、Operation、checkpoint、基础 diff、部分 Agent contract 和 OOXML 结构已有可复用价值；但这与 `docs/PROGRESS.md` 的“全部里程碑完成”不是同一交付物。

外部用户第一天最可能按以下顺序踩坑：

1. 找不到能创建/打开/编辑演示的应用，也无法从资料生成 10 页演示；唯一 preview 打开为空白。
2. 收到 Quick Fix/Light Edit 文件后发现只能翻页，无法进行任何承诺的修改和保存。
3. 即使由开发者代为走 API，重新生成所选会改反范围，局部策略/Fact 引用可能丢，溢出 warning 又在 Commit 后消失。
4. 导出 PDF 会把中文变问号、图片变灰框；PNG 可能只剩背景；Semantic PPTX 看似可编辑但常用格式和字体会静默变化。
5. 崩溃重开看不到已 Commit 步骤；手工恢复后也不能 Undo，导入图片或 Widget 编辑甚至无法 replay。
6. 修订副本的删除与本地修改不报冲突，接受时会删掉本地后来写的内容。

离方案 GA 验收至少还差七件功能性实事：

1. 交付真实 Host 和 AI 新建/多页生成 orchestrator，而不是继续扩充仅可编程调用的 primitives。
2. 把 Portable 编辑引擎和 UI 真正打入派生 HTML，并用文件双击的浏览器黑盒测试验收。
3. 让 PDF/PNG 共用 Reference Renderer，建立字体、图片和像素 golden；补齐 Semantic PPTX 的属性/字体降级真相。
4. 封死 `slide.update` 的元素旁路，修正 regenerate_selection、Agent IR 输入、protected/preserve 继承和 replacement budget。
5. 建立自动 Journal 发现/恢复/另存流程，恢复 Standard History，并支持 CAS 资源和 GA-C runtime replay。
6. 完成 Revised Copy/Patch 的字段全集、delete-vs-modify、stale-base Compare、headRevision 和 Profile 一致性。
7. 让 Compiler 真正执行文本/布局质量门禁，补齐页面复制、备注、动画和锁定等高频编辑闭环，再把 §41 A～J 变成独立黑盒发布门禁。
