# S00 单文件使用合同 · single-file-first-1.1

权威来源：[9856db3 的交接](../single-file-first/HANDOFF.md)、[完整方案](../single-file-first/PLAN.md) 和 [任务清单](../single-file-first/TASKS.json)。本合同覆盖旧 html-first-1.0 中冲突的入口、命名、保存推荐与 Skill 描述；非冲突要求继续生效。

- 默认交付恰好一个 `作品.ppte.html`，默认入口 **file://**。同一文件包含作品、编辑器、放映器与所需资源；读者只需支持的浏览器，不需 Node、PPTe 安装、网络或常驻服务。Node/NPM/原生 Skill 用于制作。
- 旧 `.html` 继续读取，显式生成 `.html` 仍可兼容；不自动改名、升级、重写用户文件。这不是恢复旧 `.ppte` ZIP/IR。PDF 仅由用户显式输出。
- HTML/CSS 是创作表示；最小增强标记为 `data-ppte-slide` 与稳定 `data-ppte-id`，缺失 ID 确定性补齐。原生 table、SVG、Grid/Flex 不转为旧槽位。
- 元数据仅存身份、版本、保存 revision、备注、来源和编辑约束；不存完整内容/几何/样式镜像。
- 默认链路：写 HTML → 一次增强 → 静态检查 → 可选视觉检查 → 交付 `.ppte.html`。模型字节不绕经旧核心。
- 原文件自动保存要求浏览器实际授予可写句柄权限；API 存在不等于已授权。完成写入、close 和读回确认后才可称“已保存到文件”。取消、拒绝、写入失败、冲突均保留修改；旧回执不能清除新修改。
- 无 API/拒绝授权时仍完整编辑，提供包含修改、媒体及同一运行时的完整 `.ppte.html` 下载。草稿不是原文件保存，下载不是写文件适配器的假成功；下载发起仅表述“已生成更新文件；原文件未覆盖”，不承诺落盘或覆盖下载目录中的文件。
- 旧 PLAN §5 的 loopback 推荐策略显式退休，不能作为主入口或权限不足时的必需降级。`ppte edit` 的目标语义是打开本文件并退出；可选历史服务不得成为读者依赖。
- 不增加 MCP stdio、第二个模型账号、Office/PPTX/PPT/ODP/Keynote、QuickJS、Electron、常驻服务或扩展要求；旧 `.ppte`、CAS、Portable profiles、Presentation IR、Recipe 仍退休。审美不增加配方、字数/卡片数或评分门禁。

**实现边界：** S00 是合同冻结，不是 S01/S02 功能验收。`ppte edit` 已改为打开文件后退出；`ppte serve` 是显式开发工具。直开入口已实现，分级保存与真实浏览器验收仍待完成。S01/S02/S07 负责实际文件、浏览器和权限旅程；Safari、真实选择器、人工评审、低性能设备和模型遥测均不可由本合同升级判定通过。F01 映射到 S01 的新证据；F02–F05 仍在 S03 待修复。

机器合同在 `scripts/html-benchmark.mjs`：`CONTRACT` 为 1.1，`H00_CONTRACT` 保留 1.0。`validateContract` 默认严格验证当前版本；验证旧版必须显式指定版本。历史 `evaluate`/命令默认仍验证 H00，禁止自动重标基线；新证据须显式选择新合同并重新绑定摘要。两版均执行相同的完整测量、遥测、失败与文件校验。

[旧合同原文快照](../single-file-first/evidence/s00/CONTRACT.html-first-1.0.md)、[合同差异](../single-file-first/evidence/s00/contract-diff.md)、[新旧验收映射](../single-file-first/evidence/s00/old-new-criteria-map.md)。H00 manifest、基线、样稿、旧审查记录不变；旧任务 done 不构成新验收。安全隔离、序列化和 CSP 要求继续有效；旧性能目标继续保留，缺遥测保持 pending。

## H01 封装实测后的局部冻结

持久文稿采用一个 inert template 内的转义 HTML 文本，保留完整 head/body、CSS 与嵌套模板；不再附内容 JSON 镜像。parse5 在 Node 与可信浏览器 runtime 中共用 inert 解析和清理；同源 iframe 仅授予 `allow-same-origin`，不给脚本权限，并在 head 首节点注入拒绝内容脚本/网络的 CSP。可信父运行时使用脚本哈希 CSP。资源由 Node 按授权真实目录内嵌，异常和不支持形式明确失败。

实测依据见 [H01 报告](evidence/h01/README.md)：增强前后实际像素/布局相等；100 次生产序列化、测试程序写回原路径、关页重开不累积模板和临时编辑状态。这不替代 H02 保存适配器或真实浏览器授权/自动保存验收。
