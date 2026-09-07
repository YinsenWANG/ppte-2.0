# R8 最终回交：交付包完成，整体验收 partial

已回交 R1–R6 修复、GAPS 证据和可离线操作单文件。**不宣称四层全部通过：S04 无头输入门槛仍失败；原生/Safari/人工待验。** 历史 REPORT、探针与认可原型均未改写。

- [离线样稿](../delivery/r8-same-prototype.ppte.html) · [SHA-256 清单](../delivery/r8-SHA256SUMS) · [生产 CLI 清单](../delivery/r8-manifest.json)
- [1440/1024/390 原型 vs 产品对照](COMPARE.html) · [实际页面几何与离线旅程](verification/delivery-journey.json)
- [完整四层验收矩阵](acceptance.json) · [命令、时间、commit、原始 probe 前后全文](verification/result.json) · [全部实现及证据提交/GPG/DCO](commits.json)

## 逐项结果

|项|历史验收 before|本次 after（code/automated 范围）|实现提交 / 真实路径测试|
|---|---|---|---|
|R1|普通 div 文本无控件、不可输入；fontControls=0|div contenteditable=true；fontControls=1；真实输入/样式/撤销/下载重开测试通过|`8862954a0fed1e2f65a9d38a21b4094dcc5548a5` · [r8-r1-text.test.ts](../../../../tests/r8-r1-text.test.ts)|
|R2|插图左上遮挡标题，Alt+右键无位移|overlap=false；Alt+右键 Δx=8px；文本/图片/形状/表格及流式布局测试通过|`a142e4798f6a54b8f573b33233a116902fc47ab5` · [r8-r2-insertion.test.ts](../../../../tests/r8-r2-insertion.test.ts)|
|R3|全文滚动，多页同时显示且当前页超出可用宽度|三尺寸仅当前页可见并完整位于工作区；响应式保真与缩放/翻页测试通过|`3a53166363a3b9092f8e004954138db186a1711f` · [r8-r3-canvas.test.ts](../../../../tests/r8-r3-canvas.test.ts)|
|R4|控件平铺，属性行冗长，每页排序按钮常驻|文档栏/工具条/属性/导航/底栏分区、紧凑样式与页面操作菜单通过；见同内容截图|`74ffb0fab5987815cc3b95b6bdce7311eb0a9b80` · [r8-r4-hierarchy.test.ts](../../../../tests/r8-r4-hierarchy.test.ts)|
|R5|390px 属性覆盖整个画布|390px 限高属性区与画布无交叠；鼠标修改样式、关闭、导航互斥测试通过|`47912553bbf596acd7e6eb854e5607e7e91891e9` · [r8-r5-mobile.test.ts](../../../../tests/r8-r5-mobile.test.ts)|
|R6|命名 prompt；容量两个 prompt 加 confirm|产品表单、验证/取消/焦点、容量审阅、恢复/删除范围和历史重开测试通过；无浏览器输入弹窗|`5da92d185ed694d469fad1d0b3916631c2130727` · [r8-r6-versions.test.ts](../../../../tests/r8-r6-versions.test.ts)|

保存、版本历史：当前完整套件包含队列/旧修订写回/失败保留/容量/损坏降级、真实下载和新进程重开。最终交付文件另测鼠标选中文本、键盘修改、产品命名版本、下载副本、新进程重开查看内容及历史、放映翻页/Esc。下载不是原文件授权写回。

媒体 UI07 A4/S06：当前页按需挂载和离页 URL 释放、快照内容保真及打印按需准备在自动化范围通过；GAPS 留存 12 张作者图仅 1 张活动、离页 naturalWidth=0。浏览器内部 GPU/解码缓存释放字节不可观测，仍为 null。

PDF N04：历史失败 PDF 的源流实际保留红/蓝矢量。原 thumbnail/Generic RGB 检测未固定栅格颜色空间；改为明确 sRGB RGBA8 CGContext 渲染，保留红/蓝各 >4000 的原门槛。历史文件各 6320，缺红/缺蓝/全缺图负样本被拒绝。历史显示配置未知，原生打印与 Safari 仍 pending。详见 [GAPS 根因与证据](../r8-GAPS/IMPLEMENTATION.md)。

S04：保留 GAPS 同环境真实事件数据：无头输入/翻页 p95 143.9/52.3ms（50/100ms 门槛，输入失败）；前台 15.3/29.1ms。无头空白页 rAF 143.1ms，支持主要为帧调度等待的判断，但不能以前台数据替代无头门槛或冻结参考机。测试通过仅表示测量完整性，不表示性能验收通过。本轮并发完整套件中的最新实测见 [current-suite-performance.json](verification/current-suite-performance.json)，输入/翻页 p95 127.4/133.4ms，门槛均失败。该负载与 GAPS 单独测量不同，不把重跑波动包装成性能优化。

## 原始探针与补证边界

先运行原 probe/followup，再构建验证，最后顺序复跑，均正常完成。历史原始 JSON 与本轮初始/最终 JSON 全文嵌入 result.json。历史 fontControls 0 → 1、div editable null → true；图片 overlap true → false、Δx 0 → 8；新增页始终为 13。放映 editable=0、visibleButtons=[]，无 HTTP 请求/页面错误。保存选择取消只说明未授权，不算保存通过。

R3–R5 不能用旧 probe 的截图或 iframe 外框单独判定：当前测试测量变换后的作者页与工作区边界，三尺寸均完整可见；390 属性区不与画布重叠。对照未删控件、未改作者专属类型、未 force click。[源稿完整性](verification/source-integrity.json) 确认未改原型及探针抽出的完整三页源稿与历史源稿逐字节一致。原型与产品均选中同封面标题，1440×960 / 1024×960 / 390×844。截图供真人审查，不等于审美批准。

旧 followup 仅会回答 prompt，R6 修复后 namingDialog 字段缺失只代表未发生浏览器 prompt，不能代表完成命名。R6 真实 UI 测试及新增 CLOSING 测试填写产品表单并验证跨进程历史，容量与确认范围沿用 R6 测试。

## 验证与使用

`pnpm typecheck && pnpm build && pnpm test` 全绿，127/127（新增 tests/r8-closing-delivery.test.ts 经 dist 运行）。完整日志保留。新增测试最初的 TypeScript NodeList 可迭代类型错误已修复，首次日志不删除；test-first.log 保留新增测试错误地将更多 summary 作为 button 查找的失败，改为真实可见文本点击后通过。没有改变产品实现或放宽既有断言。

双击交付 `.ppte.html` 即阅读；点击编辑后选中/双击文字，更多可打开版本历史；修改后可下载更新文件，放映后 Esc 返回。文件通过 file://、offline:true、新 Chrome 进程验证；不要求启动 HTTP 服务。原文件授权仍由浏览器系统选择器处理。

## 仍待验与原因

- **S04 default headless input p95 <=50ms**：Final installed Chrome headless input p95 is 143.9ms; blank-page rAF p95 143.1ms. Headed passes do not replace this environment or frozen reference acceptance.（结果 null，pending）
- **Native file picker authorization and durable write permission**：Headless download / disk-bridge tests are not native authorization evidence.（结果 null，pending）
- **Safari, native print dialog, operating-system IME**：No Safari, native print or operating-system IME session was collected. PDF API and synthetic composition do not substitute.（结果 null，pending）
- **Physical touch, screen reader, owner and two target-user reviews**：No physical-device, assistive-technology or human review sessions.（结果 null，pending）
- **Independent low-performance/no-Node machine and same-model generation telemetry**：This host has Node and is the development machine. Controlled model-call/token and nine-pair human aesthetic evidence is unavailable.（结果 null，pending）
- **Actual browser GPU/decoder cache reclamation bytes**：Inactive URLs and naturalWidth=0 are measured; Chrome cache/GPU residency is not observable from these page-level tests.（结果 null，pending）
- **S04 closing concurrent suite input and page-turn gates**：Latest full-suite performance observation exceeds both 50ms input and 100ms turn limits; raw observations in current-suite-performance.json, distinct from GAPS standalone measurements.（结果 null，pending）
- **Real user media batches and semantic crop review; complex author CSS, 200% zoom/system fonts and assistive technology**：No new human or independent device sessions; S08 carry-forward human/fidelity scope remains. Automated geometry and synthetic fixtures do not provide this evidence.（结果 null，pending）

所有 15 个 R1–R6/GAPS 提交（含证据提交）如下，逐个 GPG 验证通过并有 Signed-off-by/DCO：

- `8862954a0fed1e2f65a9d38a21b4094dcc5548a5` — fix(R1): recognize safe native text objects and preserve inline editing
- `0e9d978a224c8e2a526be006d10c94cb999ebc42` — fix(R1): record audit comparison and offline text editing evidence
- `a142e4798f6a54b8f573b33233a116902fc47ab5` — fix(R2): place new objects in native layouts and enable real keyboard adjustment
- `37bb675ddb950df7429f5bf335461000d100a5f2` — fix(R2): record insertion audit comparison and offline object evidence
- `3a53166363a3b9092f8e004954138db186a1711f` — fix(R3): fit the current edit page in an isolated scrollable canvas
- `3a8314412d70f70a20bffe7ac71396a5be99a200` — fix(R3): record audit geometry and offline prototype comparisons
- `74ffb0fab5987815cc3b95b6bdce7311eb0a9b80` — fix(R4): implement prototype control hierarchy and contextual page actions
- `5be4539876a3d7e9844ef797e04442050ba70753` — fix(R4): record audit comparisons and offline CLI sample evidence
- `47912553bbf596acd7e6eb854e5607e7e91891e9` — fix(R5): reserve visible mobile canvas above bounded property drawers
- `28619997dcd2d2fd14c4a2b836d98950f5dfca71` — fix(R5): record mobile geometry regression and offline prototype comparisons
- `5da92d185ed694d469fad1d0b3916631c2130727` — fix(R6): unify version naming quota and recovery dialogs
- `00dd9d99fbc4796666632bcaf580aded2081e7e0` — fix(R6): record dialog audit evidence and offline prototype sample
- `86c8ce3669047e5de14575f0d515f04cc387e285` — fix(GAPS): defer off-page media and stabilize PDF color verification
- `ec20d5054fc11c9906590b8d334acf896849d5c7` — fix(GAPS): record media PDF and performance gap evidence
- `b00acc5531a7fce75b73412cf5cf5985cfecf2e2` — fix(GAPS): include offline CLI sample and reproducible performance fixtures

CLOSING 的签名提交由最终 verification/result.json 及后续签名记录引用；不 push。预先存在的流水线 brief/output 文件仅作本地输入保留，不纳入交付；精确文件名本地排除，非删除。

CLOSING 实现/交付提交：`adc7d1f66fe23a503134bde54e2a7d12aa8b65c7`，GPG 验证通过，Signed-off-by/DCO 已附。后续提交只记录该签名与 hash，不改测试或样稿。
