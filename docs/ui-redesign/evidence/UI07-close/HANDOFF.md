# PPTe pipeline v7 — closing handoff

交付包已整理；整体产品验收仍为 **partial**。UI01–UI05 的 done 仅表示代码/自动化完成，不能解释为四层均已通过。UI07 A4 与 S06 当前页面媒体生命周期未完成，UI06 依赖仍未闭合。未 push。

## 提交

基线 `0e6b1e3`；下列提交签名均已检查为 G，均有 DCO Signed-off-by。closing 提交自身由 `git log -1 --show-signature` 定位，避免自引用哈希。

|提交|内容|
|---|---|
|`5ad4f2c6e1b70ecca10e24993559b47aa2bebc58`|UI01: implement reading shell contextual editing and clean presentation|
|`e9e31a6365b7b94fca99886e6584ebd931945dc4`|UI01: record acceptance layers verification and offline sample|
|`abe467c87347cb6c8c52b0ecaff16968cba1a168`|UI04: implement bounded autosave queue and truthful file saving controls|
|`5a13265797212c031c0ec85b1762c6a75d9948ee`|UI04: record saving acceptance layers and offline verification evidence|
|`a8d9039f7e028a13dd892de84d0d5b3b3d086c35`|UI07: implement portable HTML checkpoints and version management|
|`cf497105d324b8c96fc04ab6fb6830ff2062185c`|UI07: record portable history evidence and remaining media gap|
|`dbd7ed643f07de02793a406c9ad84304b7d97515`|UI02: unify native object insertion and contextual properties|
|`dd79fede619ceeac038fea39d8365f8d1536c7b9`|UI02: record acceptance evidence and offline product sample|
|`e340d48392ae06080f72ec51ec7ea6880aed90c9`|UI03: preserve native page layout and add accessible page ordering|
|`8976071b7c46ca83406b69873c54893dec22cfbb`|UI03: record acceptance evidence and offline page-layout samples|
|`6fca967b968327f5f7f730fd23bb260dd2376116`|UI05: adapt shell layout and complete keyboard accessibility|
|`3a4c6895b9193886ee0cee7eae1d667daa79721f`|UI05: record responsive accessibility acceptance evidence|
|`536674af1cbb4163434761804d487a57aae9982a`|UI06: verify portable four-object journey and deduplicate small history media|
|`b2b3ba02e0066391877aa932d8533fde030150b0`|UI06: record full journey evidence and honest acceptance gaps|

## UI01–UI07 逐项四层

来源是各任务 verification/result.json 与本轮全量回归。passed 仅适用于列明的测试边界；Chrome 指安装版 headless、通过真实 DOM 控件操作，不是原生系统弹窗。接口桥接不是原生授权；合成 composition 不是系统 IME。完整来源路径、解释见 [acceptance.json](acceptance.json)。

|项|验收|code|automated|real-browser|human|
|---|---|---|---|---|---|
|UI01 A1|默认阅读与重开默认阅读|passed|passed|partial: installed Chrome headless passed; Safari/native/physical touch pending|pending|
|UI01 A2|编辑按上下文展开|passed|passed|partial: installed Chrome headless passed; Safari/native/physical touch pending|pending|
|UI01 A3|放映无菜单和鼠标召回|passed|passed|partial: installed Chrome headless passed; Safari/native/physical touch pending|pending|
|UI01 A4|Esc/全屏失败返回正确模式|passed|passed|partial: installed Chrome headless passed; Safari/native/physical touch pending|pending|
|UI02 A1|四类对象可插入和调整|passed|passed|partial: installed Chrome headless file:// UI passed; Safari, native permissions, OS IME and physical touch pending|pending|
|UI02 A2|真实作者布局不被强制绝对化|passed|passed|partial: installed Chrome headless file:// UI passed; Safari, native permissions, OS IME and physical touch pending|pending|
|UI02 A3|保护范围和历史正确|passed|passed|partial: installed Chrome headless file:// UI passed; Safari, native permissions, OS IME and physical touch pending|pending|
|UI02 A4|图标/控件/焦点一致|passed|passed|partial: installed Chrome headless file:// UI passed; Safari, native permissions, OS IME and physical touch pending|pending|
|UI03 A1|添加页无控制条遮挡|passed|passed|partial: installed Chrome headless file:// passed; Safari/native/system IME/physical touch pending|pending|
|UI03 A2|响应式新页保真|passed|passed|partial: installed Chrome headless file:// passed; Safari/native/system IME/physical touch pending|pending|
|UI03 A3|图片不被标题挡住且可调整|passed|passed|partial: installed Chrome headless file:// passed; Safari/native/system IME/physical touch pending|pending|
|UI03 A4|页面排序具备键盘等效|passed|passed|partial: installed Chrome headless file:// passed; Safari/native/system IME/physical touch pending|pending|
|UI04 A1|无关联可进入编辑|passed|passed|passed: Chrome headless|pending|
|UI04 A2|原生授权后实际写回|passed|passed: mocked/interface bridge or synthetic transaction; native outcome pending|pending|pending|
|UI04 A3|未写回文案准确|passed|passed|passed: Chrome headless|pending|
|UI04 A4|失败/权限撤销/外部修改可恢复|passed|passed: mocked/interface bridge or synthetic transaction; native outcome pending|pending|pending|
|UI04 A5|防抖和持续输入调度，原生授权后自动写回|passed|passed: mocked/interface bridge or synthetic transaction; native outcome pending|pending|pending|
|UI04 A6|写入队列与修订号防止旧快照覆盖新修改|passed|passed|passed: Chrome headless|pending|
|UI04 A7|同名不同文档、外部改动和权限失效正确处理|passed|passed: mocked/interface bridge or synthetic transaction; native outcome pending|pending|pending|
|UI04 A8|IME完整事务与新进程重开实测|passed|passed: mocked/interface bridge or synthetic transaction; native outcome pending|pending|pending|
|UI05 A1|1440/1024/820/390窗口|passed|passed|partial: installed Chrome headless offline file://; native zoom, system font, physical touch, Safari and screen reader pending|pending|
|UI05 A2|200%缩放和触控目标|passed|passed|partial: installed Chrome headless offline file://; native zoom, system font, physical touch, Safari and screen reader pending|pending|
|UI05 A3|菜单键盘与焦点恢复|passed|passed|partial: installed Chrome headless offline file://; native zoom, system font, physical touch, Safari and screen reader pending|pending|
|UI05 A4|图标标签和重要文字对比|passed|passed|partial: installed Chrome headless offline file://; native zoom, system font, physical touch, Safari and screen reader pending|pending|
|UI06 A1|离线阅读编辑保存重开放映PDF|passed|passed|partial: installed Chrome headless; Safari/native pending|pending|
|UI06 A2|四类对象历史持久化|passed|passed|partial: installed Chrome headless; Safari/native pending|pending|
|UI06 A3|真实Chrome/Safari与原生权限|passed|partial|partial: installed Chrome headless; Safari/native pending|pending|
|UI06 A4|用户UI反馈与样稿审美分别记录|passed|passed: collection record contract only; reviews absent|not-applicable: collection records|pending|
|UI07 A1|命名、预览、恢复并保留恢复前内容|passed|passed|partial: Chrome headless; native and Safari pending|pending|
|UI07 A2|历史随唯一HTML复制并在无原缓存环境恢复|passed|passed|partial: Chrome headless; native and Safari pending|pending|
|UI07 A3|版本数量/历史容量控制，不静默删除命名版本|passed|passed|partial: Chrome headless; native and Safari pending|pending|
|UI07 A4|资源去重、差量依赖/检查点和按需解码正确|partial|partial|partial: Chrome headless; native and Safari pending|pending|
|UI07 A5|历史损坏安全降级，提供不含历史的按需下载|passed|passed|partial: Chrome headless; native and Safari pending|pending|
|UI07 A6|真实保存/预览/恢复与文件体积性能证据|passed|passed|partial: Chrome headless; native and Safari pending|pending|

## S06–S08 承接

逐 acceptance 原始状态与路径完整收录 [single-file-status.json](single-file-status.json)，未提升历史状态。

|任务|总体|code|automated|real-browser|human|
|---|---|---|---|---|---|
|S06|partial|媒体生命周期/按需解码未完成|现有回归通过；性能缺口保留|Chrome headless；Safari/原生 pending|真实混合图批、主体/裁切评审 pending|
|S07|partial|离线交付/旅程代码 implemented|现有回归通过|Chrome headless；原生授权/打印/IME/Safari pending|独立无 Node 设备与使用确认 pending|
|S08|partial|闭环记录 implemented；上游限制保留|记录与文件探针通过|Chrome headless；其他真实环境 pending|九对、负责人及两名目标用户、低性能实机 pending|

## 产品操作证据

- UI01：`docs/ui-redesign/evidence/UI01/{reading,context,audience,transitions}.json`。
- UI02：`docs/ui-redesign/evidence/UI02/{objects,layout,protection,focus}.json`。
- UI03：`docs/ui-redesign/evidence/UI03/{rail,responsive,image,sorting,audit}.png` 与对应 JSON。
- UI04：`docs/ui-redesign/evidence/UI04/journey.json`；`file-interface-bridge.json` 单列为磁盘接口桥接。
- UI05：`docs/ui-redesign/evidence/UI05/{windows,zoom-touch,keyboard,contrast}.json`。
- UI07：`docs/ui-redesign/evidence/UI07/journey.json`、`media-performance.json`、`history-restored.png`。
- UI06：`docs/ui-redesign/evidence/UI06/journey.json`、`restore-preview.png`、`pdf-inspection.json`、`journey.pdf`；两次完整退出、唯一文件复制、四类对象历史恢复。
- 本次样稿：[离线检查](../delivery/open-check.json)、[阅读](../delivery/reading.png)、[四类对象](../delivery/content.png)、[历史预览](../delivery/history.png)。无 force click；没有授权桥接。

## 唯一离线样稿

[把作品带走.ppte.html](../delivery/把作品带走.ppte.html)，368304 bytes。下载后双击，以 file:// 直接打开；读者不需要 Node、服务器、Office 或旁边的证据文件。

SHA-256：`1b01007e5f752822ce1b904338818b1709a7672b94f6ffa6537918609c1fc591`。

源 [authored.html](authored.html) 为 UI06 作者 HTML/CSS 经产品编辑后的当前内容，含四类对象；提取自先前样稿，未移植设计原型坐标模型。使用构建后的 CLI enhance，再通过产品控件创建两个命名版本、恢复第一稿、保留恢复前版本并下载。最终文件没有手工改写。旧 UI06 样稿的 manifest 保存在 previous-delivery-manifest.json，其历史哈希不冒充本次新文件。

复现：`pnpm build && node scripts/verify-ui-delivery.mjs`。该脚本会重新生成 delivery 中的样稿和截图，文档 ID/时间/哈希会变化；复现后需同步 manifest/SHA256SUMS。

Chrome 152 headless，offline context，file://，完整退出后全新进程及空 localStorage；版本预览与当前内容独立，四类对象可读，放映隐藏产品 UI，Esc 返回阅读；页面网络请求与脚本错误均为 0。离线断网验证不等于操作系统级进程网络抓包。生成 PNG 只做功能演示，不是用户真实图片或审美证明。代理检查截图内容可见，不算真人评价。

## 验证与剩余工作

`pnpm typecheck`、`pnpm build`、`pnpm test` 均 exit 0；104/104 node --test dist 测试通过，0 skip/0 fail。日志、时间、平台和验证代码提交见 [verification/result.json](verification/result.json)。本次仅补充交付与可复现探针，未改产品代码或任何测试断言。

- UI07 A4/S06：当前 DOM 仍展开 data URL，当前媒体按需解码与内存生命周期未完成；历史去重/惰性解码通过不能替代它。
- S04/R04：输入与翻页 p95 原门槛未达标；受控同模型端到端/tokens 遥测和真实低性能设备缺失。本轮全绿不关闭性能门槛。
- Safari、原生 picker 允许/取消/撤销/重授权/跨会话、系统 IME、原生打印、200% 原生缩放/大字体、物理触控、屏幕阅读器、独立无 Node 设备没有等价真实操作证据。Safari 历史会话受远程自动化未启用阻塞；其他环境未提供操作会话。
- UI 和样稿审美分开记录：负责人及两位目标用户、九对盲评、事实/裁切/保存否决均未采集，值保持 null+原因；真实授权混合图批及主体/关键数据核对缺失。
- N01–N04、R01–R06/F01–F05 不取消，完整承接见 [UI06 carry-forward](../UI06/carry-forward.md) 与 `docs/single-file-first/evidence/s08/feedback-closure-matrix.md`。原生与人评操作协议见 `docs/ui-redesign/evidence/UI06/environment-matrix.json`、`ui-feedback.json`、`sample-aesthetics.json`。

预存 brief7-CLOSING.md/out7-UI06.txt 未改动，已仅在本地 .git/info/exclude 排除；不是产品提交内容。
