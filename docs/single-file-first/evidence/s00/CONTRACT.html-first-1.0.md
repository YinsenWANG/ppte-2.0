# H00 HTML 合同冻结

权威来源是提交 `bbcd46bde2c608b5a56e617f316c5dcb5534857e` 的 README、PLAN、TASKS 和 REVIEW_DISPOSITION；本文只把已确认决定落实为可测试合同，没有重新制定阶段计划。机器合同在 [manifest.json](evidence/h00/manifest.json) 的 `contract`，测试在 `tests/html-first-baseline.test.ts`。

- 默认交付恰好一个 `.html`；PDF 仅按需输出。
- HTML/CSS 是创作表示；最小增强标记为 `data-ppte-slide` 与稳定 `data-ppte-id`，缺失 ID 由 H01 确定性补齐。原生 table、SVG、Grid/Flex 不转换成旧槽位。
- 元数据仅存身份、版本、保存 revision、备注、来源和编辑约束；不保存完整内容/几何/样式镜像。
- 默认链路是写 HTML、增强、静态检查、可选视觉检查、交付 HTML。模型字节不绕经旧核心。
- 只有原文件写入确认才是“已保存”；缓存草稿不是落盘证据。原文件保存实现属于 H02。
- 新核心和默认交付不要求 PPTX/PPT/Office/ODP/Keynote、`.ppte`、CAS、Portable profiles、Presentation IR 或 Recipe。机器合同中的 `retired` 是禁止进入新目标的范围，不是新格式要求，也不是当前代码已删除的声明。

PLAN §4.2 的隔离、安全序列化和 CSP 要求继续有效，具体封装仍由 H01 实测后冻结；本轮没有提前选定未经验证的 runtime 结构。PLAN §5 的保存协议及 §8 性能目标不变。

## H01 封装实测后的局部冻结

持久文稿采用一个 inert template 内的转义 HTML 文本，保留完整 head/body、CSS 与嵌套模板；不再附内容 JSON 镜像。parse5 在 Node 与可信浏览器 runtime 中共用 inert 解析和清理；同源 iframe 仅授予 `allow-same-origin`，不给脚本权限，并在 head 首节点注入拒绝内容脚本/网络的 CSP。可信父运行时使用脚本哈希 CSP。资源由 Node 按授权真实目录内嵌，异常和不支持形式明确失败。

实测依据见 [H01 报告](evidence/h01/README.md)：增强前后实际像素/布局相等；100 次生产序列化、测试程序写回原路径、关页重开不累积模板和临时编辑状态。这不替代 H02 保存适配器或真实浏览器授权/自动保存验收。
