# H03 验证记录

实现说明：[IMPLEMENTATION.md](IMPLEMENTATION.md)。所有截图来自实际新运行时，非 UI_PROTOTYPE。

| Acceptance | 仓库测试（node --test on dist） | 证据 |
|---|---|---|
| 1. 三类对象、空选、多选、混合值统一 UI | `dist/tests/html-editor.test.js` — `H03 acceptance 1` | 文字/图片/形状/表格、empty、mixed 截图 |
| 2. 正文对比度 ≥4.5:1、键盘可达、清晰焦点 | 同上 — `H03 acceptance 2` | computed contrast.json；Tab、Enter 格式、对象 Tab 与退出画布；keyboard-focus.png |
| 3. 改一句话不重建页、Grid/Flex 保持布局 | 同上 — `H03 acceptance 3`；native typing history；guarded SVG / hash race | 节点引用恒等断言、局部撤销/重做、Grid/Flex order/gap/轨道、绝对定位鼠标拖动和键盘移动、Agent 旧摘要与保护对象拒绝 |
| 4. 原文件重开保持内容/格式/布局/资源/锁定，失败不假成功 | 同上 — `H03 acceptance 4`；original-file persisted range；guarded SVG | 替换为不同图片字节后逐字节重开核对、选区 span 字重保留、表格与背景、锁定；真实阻断保存请求，磁盘不变且保留修改；failed.png |

共新增 7 个 H03 测试，既有测试断言未删减。完整门禁数量、提交号和 SHA-256 清单见 [verification/result.json](verification/result.json)。全量日志见 [verification/test.log](verification/test.log)。原文件保存重开的体验样例为 [example.html](example.html)。

## 证据边界

本轮通过已安装 Chrome 的 headless channel 操作真实 DOM、键盘、鼠标、本地文件与 loopback 保存服务。它不代替真实用户盲评、真实中文输入法、Safari 手工验证或原生文件选择器授权旅程。H02 的对应 partial 状态不变；H00/H06 控制变量测量不变。H04 仅接入了当前页干净预览和 Escape 返回，其余放映/PDF 验收保持 planned。

复杂 SVG 作为整体替换，单个基础图元支持填充；不承诺任意插画都可通用拆解。原生 Grid/Flex 重排通过 CSS order 保持流式，普通文档流重排明确拒绝；不把无法完成的操作伪装成成功。历史栈为本次会话，保存文件保留最终内容而不嵌入历史镜像。

本轮没有修改 blackbox 或发布脚本，也没有新增旧格式工作；全量测试按仓库当前 `pnpm test` 执行，历史测试的通过不作为新版旧格式支持声明。
