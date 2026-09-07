# R8 R1 — 原生作者文本编辑

实现提交：`8862954a0fed1e2f65a9d38a21b4094dcc5548a5`（GPG 签名、Signed-off-by / DCO）。基线：`f5ba1900cb1467126cc3edd911ce762413280cdb`。只承接本轮 R1；R2–R6、GAPS 和 CLOSING 继续由后续轮处理，历史 audit REPORT 与认可原型未改写。

## 实现与安全边界

`commands.ts` 的 `isTextObject` / `textObject` 统一命令、鼠标选择、键盘 Tab、输入事务及属性栏的判断。原生 div/span 不需产品类型标记。文本宿主可包含 span、strong、em、br 等行内格式；点击嵌套格式节点归属完整宿主，只有宿主开放 contenteditable，内部格式继承编辑状态。范围着色仍保留作者 DOM，整体属性不重写行内内容。

页面、显式内容容器、形状、含媒体/链接/控件/块级子节点或绝对定位子对象的容器不整块开放文本输入。既有 `data-ppte-kind=text` 是候选声明，不越过安全检查。混合容器内独立文本仍可选择编辑。不支持整体编辑的结构显示“内容容器”和明确说明，而不是标题“文字”下的空外观区。受保护后代亦阻止整体编辑。瞬态编辑标记不进入保存内容；无新增作者样稿标记。

## 验收映射

`tests/r8-r1-text.test.ts` 由仓库 `node --test dist/tests/*.test.js` 执行，使用安装版 Chrome、headless、离线 file://：

1. 原审计 `sample/source.html` 不修改地经生产增强函数生成。真实点击/双击标题、键盘输入、字号/颜色/粗体、撤销重做、产品下载按钮导出、全新 Chrome 进程重开并继续输入；检查文字、样式和瞬态数据清理。
2. 原生 span、div + 嵌套 span/strong、显式文本声明：鼠标选择、Tab 宿主导航、真实范围着色、输入、撤销、下载重开；检查作者行内结构和颜色保持。
3. 媒体/块级/定位子对象及不安全文本声明：真实鼠标点击容器边缘，检查整体不可编辑、无误导文字控件且有解释；再点击内部独立文字，键盘输入仍有效。

所有产品动作通过真实 Playwright 鼠标/键盘/按钮；没有 force click、内部 Commands 驱动、样稿类型补标或隐藏控件。补充测试的 SVG 是结构边界夹具，不替代审计样稿。下载是下载兜底证据，不能当成原生授权写回。

## 探针对照与交付

未修改的 `probe.mjs` 和 `followup.mjs` 分别在基线构建、实现构建上执行，原始 JSON 和标题截图在 `verification/before/` 与 `verification/after/`。R1 从 `nativeText.contenteditable=null / fontControls=0` 变为 `true / 1`；语义 h1 对照仍为 1。脚本本身不为每个审计问题输出布尔 verdict，因此本轮只将上述 R1 指标及新增测试判为通过，不把进程退出 0 解释成 R1–R6 全部通过。R2 图片重叠/移动错误、R3 视图、R4/R5 UI、R6 prompt 保留原始实测结果。

`sample.ppte.html` 是生产 CLI 从原审计源稿生成的未编辑可操作样稿；`edited.ppte.html` 是真实测试点击产品下载按钮得到的编辑后样稿。两者 SHA-256 见 `verification/result.json`。最终全流水线 delivery/ 样稿与三个宽度原型对照仍属 CLOSING。

## 四层状态

- code：R1 实现完成。
- automated：详细命令、退出码和测试数量见 `verification/result.json` 与日志。
- real-browser：安装版 Chrome headless 离线 file:// 的自动化路径通过；原生 picker 写回、Safari、系统 IME、物理触控为 pending（本轮没有相应系统操作证据）。
- human：pending；没有负责人/目标用户、屏幕阅读器及人工视觉评审。

即便本机 S07 PDF 像素断言通过，也不能据此宣称 N04 色彩/检测差异根因已解决。性能门槛和 A4 媒体按需解码亦不在 R1 关闭范围。

工作区入场已有未跟踪的 supervisor/pipeline 脚本与日志；未删除、提交或改动这些用户/监督进程文件。实现及证据提交后受版本控制的工作树干净，未 push。
