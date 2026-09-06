# S07 直开路径整体验证与轻量分发

状态：**partial**。主验收文件：[review.ppte.html](review.ppte.html)，直接下载并用浏览器打开。它是两页工程验证样本，不是用户审美验收稿。PDF、tarball 和截图仅为开发证据，不是默认交付附件。

基线：`2c5329d`。依照指定提交 `9856db3cef4da0d6ea6aca5a46b7039a166b995c` 的 HANDOFF、PLAN 和 ea260ce 审查保留既有实现及历史失败。实现提交在 TASKS.json 绑定。

|状态层|本轮结果|
|---|---|
|代码实现|发布检查覆盖全部现行 HTML / single-file 测试；新增连续文件旅程及独立 PDF 检查；安装的 Skill 与仓库字节一致断言。|
|自动化|见 verification 的 typecheck/build/test/release 日志；新增 1 项测试、加强 1 项既有测试，未删除或弱化断言。|
|真实浏览器|实际安装 Chrome 152.0.7977.76 headless，通过 file:// 离线连续旅程；Safari 26.6.2 WebDriver 启动受阻，不能算通过。|
|人工确认|pending：原生 picker 授权/撤销/再授权、系统中文 IME、原生打印对话框、无人为工具辅助的下载目录操作、无 Node 目标机和人工视觉评审未执行。|

## 逐项验收

|acceptance|自动化证据与结果|尚缺的验收|
|---|---|---|
|1 阅读→编辑→保存/明确下载→关闭重开→放映→PDF|journey.json：真实 Chrome 下载事件、saveAs 落盘，原文件摘要不变，整个浏览器进程关闭后新进程/新存储上下文重开修改；随后放映、Esc、按需 PDF。tests/single-file-journey.test.ts。|Safari 全旅程、人工 GUI 路径 pending。未把下载称为原文件保存。|
|2 黑屏/全屏拒绝/Esc/视频/演讲者/步骤|player/ 的截图、pdf.json 及全量日志；tests/html-player.test.ts 的逐像素全黑、真实视频播放/点击不翻步、真实 popup、全屏 API 成功与拒绝注入、Esc 恢复均复验。|Safari 与人工原生全屏交互 pending；拒绝场景是故障注入。|
|3 PDF 每页/步骤/无 UI/文字/图片|pdf-inspection.json：PDFKit 独立解析两页、720×405 pt、可提取关键文字及全部步骤、无工具栏/私密备注；栅格化 PDF 后红蓝图像两半均超过 4000 像素。journey.json 另有打印 DOM 图片边缘像素，journey.pdf / print.png 可复查。S06 真实混合照片语义审核继续待验。|Safari 原生打印、人工关键内容可读及任意作者裁切完整性 pending。合成双色图不冒充真实照片。|
|4 原生 picker/IME/打印与合同分开|native-records.json + safari.json；S02 write bridge 真实磁盘哈希记录在 save/，明确是 Node bindings 模拟 handle。IME 合成事件测试仍仅合同。|所有原生授权、IME、系统打印操作未实测。|
|5 无 Node 目标/单文件交付|journey.json 仅两个 file 请求、offline=true、无服务请求；delivery 目录断言只有作品.ppte.html；package/node-only.json 是制作侧工具隔离测试，不能当读者无 Node 实机。|独立无 Node / 未安装 PPTe 的目标设备 pending。|
|6 体积预算/媒体单列|package/sizes.json：3 份 12 页轻稿最大 321127 bytes，runtime gzip 89784 bytes；均低于门槛。媒体字节单列（轻稿为 0），media-size.json 保留 S06 大媒体表/历史测量。|未将合成媒体及参考开发机推定为真实低性能设备表现。|

## Required evidence 与浏览器能力矩阵

- actual-browser-journeys：journey.json、review.ppte.html、verification/test.log；Chrome 通过自动化，Safari pending。
- native-permission-and-ime-records：native-records.json、safari.json、save/original-file-hashes.json。记录缺口，不伪造通过。
- pdf-and-media-verification：journey.pdf、pdf-inspection.json、print.png、player/、media-size.json。
- tarball-and-no-service-checks：package/candidate.tgz、pack.json、dependency-graph.json、node-only.json、recovery.json、sizes.json；新旧 Skill 字节一致、离线安装/重装、原用户文件保持、归档旧测试哈希、退休依赖排除继续通过。journey.json 证明浏览器未请求 HTTP。

|能力|Chrome 实测|Safari 实测|
|---|---|---|
|文件阅读/编辑/下载重开/放映/PDF|安装版 headless 自动化通过|pending：WebDriver session not created，需 Safari 设置 Allow remote automation|
|file 上 File System Access|API 为 function，安全上下文 true；没有据此推断权限成功|未取得页面能力，unknown|
|原文件授权写回|合同桥接通过，原生 pending|pending|
|系统输入法/打印对话框|pending|pending|

Safari 原始错误来自本轮重跑的既有 H02 探针；它在建立会话前被阻止，未执行任何 Safari 页面。该探针若将来成功，旧服务保存分支也不能替代 S07 的 file 全旅程。测试总数包含“记录 Safari 受阻”测试，不能当跨浏览器通过率。

F01 对应 tests/single-file-entry.test.ts；F02–F05 对应 tests/single-file-editing.test.ts；本轮完整复跑。R01/R02/R05/R06 对应放映、编辑、PDF、候选包与安装恢复回归；R03 人评和 R04 遥测/低性能缺口不由此关闭。S02/S03/S04/S06 的 partial 原因继续保留。

复现：`pnpm typecheck && pnpm build && pnpm test`，以及 `pnpm release:check`。Chrome 与 macOS Swift/PDFKit 是开发验证依赖，不进入发布 tarball 或单文件浏览器运行图。全量发布检查包含可选开发服务的旧回归，但主验收旅程完全使用 file://。

首次独立 PDF 像素检查失败记录保留于 verification/pdf-first-failure.log：PDFKit 缩略图的原始 calibrated RGB 像素为纯红/纯蓝，额外转换到设备/sRGB 改变分量。修复检查器直接读取栅格原始颜色后，两半各 6320 像素；没有降低 >4000 的断言或更改 PDF 产品实现。
