# UI 设计交接

请在最新 main 上结合本目录的 [DESIGN.md](DESIGN.md)、[TASKS.json](TASKS.json) 与 [UI_PROTOTYPE.html](UI_PROTOTYPE.html) 落地 PPTe 界面。原型为设计评审交付，尚未成为产品实现；用户若提出新反馈，先更新对应规格。

承接 `c139730` 人工反馈和 `b1ceb6a` 独立验收；保留 `9856db3` / `ea260ce` 非冲突要求。最新 UI 规范优先于旧的冲突 UI 描述。N01–N04、性能/媒体与真实环境证据缺口不得取消。

默认阅读、编辑上下文工具、纯净放映；统一插入文本框/形状/图片/表格；保存文案与真实权限一致。先看三种模式与交互，再按 UI01–UI07 接入已有模式、Commands、保存和资源管线。禁止用原型的固定坐标数据模型替换作者 HTML/CSS，禁止重引入必需 HTTP 服务、Office 或 MCP stdio。

回交实现 commit、逐项状态、真实 UI 操作证据、单个离线可打开样稿。设计原型验证通过不等于产品验收通过。

## 保存与版本补充（新增执行范围）

同时执行 [SAVING-VERSIONS.md](SAVING-VERSIONS.md)：UI04 明确首次关联授权、原文件保存与默认自动保存；UI07 新增跨会话、随唯一 HTML 携带的版本历史，含命名/预览/恢复、资源去重、容量管理与故障处理。UI06 依赖 UI07，不能只实现会话撤销或浏览器缓存就宣称历史版本完成。旧原型仍只演示下载；新能力必须由生产实现与原生验证回交。

## 本次设计验证

本机 Chrome headless，离线打开；无 HTTP 请求和脚本错误。验证了默认阅读、上下文面板、四类对象插入、文本输入、撤销重做、真实下载与新页面重开、纯净放映及退出，查看1440/1024/390窗口截图。没有声称原生文件权限、系统 IME、屏幕阅读器、跨浏览器或正式产品已通过。

可在已装 Chrome 和项目依赖的仓库根运行 `node docs/ui-redesign/verify-prototype.mjs`；输出到忽略的 artifacts/ui-redesign。测试只操作原型副本。本次结果见 [prototype-verification.json](prototype-verification.json)。

[阅读预览](preview/reading.png) · [编辑预览](preview/editing.png) · [插入菜单](preview/insert-menu.png) · [较窄桌面](preview/compact.png) · [手机宽度](preview/mobile.png)
