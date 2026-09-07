# R5 · 小屏属性与当前页各自保留空间

基线为 R1–R4 承接提交 5be4539；权威审计 f5ba190 的 REPORT、样稿、探针和认可原型均未修改。

- 580px 以下导航/属性改为底部独立区域，高度取 310px 与剩余工作区一半中的较小值。工作台 fit/阅读视口扣除此高度；当前页不被覆盖，也不再被 inert / aria-hidden 排除。
- 属性关闭按钮置于滚动区 sticky 标题。鼠标关闭与 Esc 返回页面设置焦点；页面导航与属性保持互斥。
- 文档栏保留 R4 的稳定主操作；小屏低频缩放按钮收进有名称、可关闭的缩放面板。属性常用字号/字体仍在首屏，布局细节继续折叠。没有以隐藏关键控件或强制点击规避遮挡。

## 实测

同一审计 source.html，无新增作者专属标记。真实 Chrome、headless、离线 file://。

390×844 修复前：工作区和属性区均为 (0,152,390,644)，当前页实际被全遮挡，iframe inert=true。新测试在未修产品上失败，记录 baseline-test.log / geometry-before.json。

修复后：工作区 (0,152,390,334)，属性区 (0,486,390,310)；实际页矩形 (12,216.0625,366,205.875)，完整位于独立工作区内，inert=false。几何断言同时覆盖 390×600，并真实点击画布标题、字号加二、鼠标关闭、Esc、导航第二页、属性互斥和缩放弹出区。UI05 旧 inert 断言更新为新合同，不删除测试；该套件继续验证大字体、44px、焦点、主操作边界。

原始 probe/followup 均执行成功；它们没有 R5 几何布尔断言，不能把退出码说成 R5 自动判绿。R5 fail→pass 来自新增仓库 node --test on dist 几何与交互测试，并提交原探针的前后结果/截图。followup 仍记录 R6 的原生 prompt，留待后续轮次。

[1440/1024/390 对照](COMPARE.html) · [生产 CLI 样稿](sample.ppte.html) · [验证记录](verification/result.json)。样稿由生产 enhance CLI 从审计 source.html 构建，compare.mjs 实际离线打开进入编辑并选中标题；sha256 见 result.json。

code：R5 implemented。automated：见验证记录。real-browser：Chrome headless file:// passed，物理触控、Safari、原生保存授权、系统 IME、屏幕阅读器未获取，均 pending。human：未收到真人审美评审，pending。R6 与保存/历史/性能/媒体/PDF 既有 GAPS 未在本轮声明关闭。
