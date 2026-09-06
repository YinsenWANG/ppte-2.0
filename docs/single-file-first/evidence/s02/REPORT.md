# S02 保存与完整下载：partial

实现与自动化已覆盖本轮可执行路径；原生文件选择器、Safari 保存和人工 IME 没有通过，不标 done。主验收文件为 [sample.ppte.html](sample.ppte.html)，它是本轮 Chrome 实际下载件，直接用浏览器打开。

## 实现

- 同一保存按钮和 Ctrl/Cmd+S 在无 API 或权限被拒时下载完整 HTML；取消选择不丢修改，不触发假写入确认。已绑定句柄可重新请求权限，自动保存仍串行写入、close 后读回 SHA-256。
- 文件绑定比较规范化内容、文档身份及持久化版本。修复增强文件无 doctype、浏览器内容带 doctype 导致同一文件被误判不匹配的问题。完整磁盘字节摘要继续用于覆盖前和写入后检查。
- dirtyRevision、confirmedFileRevision、exportedRevision 分开记录。导出不清 dirty、不删除草稿、不宣称原文件写入；下载使用控制器当前持久化版本。明确另存为下载产生符合现有合同的新文档身份，普通下载保留身份。
- file:// 草稿键包含文件上下文与文档身份，恢复基准包含规范化内容及持久化版本。直开时不自动挂载草稿，必须明确选择恢复。存储不可用/配额满独立提示。绑定后的恢复摘要和重新打开时一致，不再混用磁盘字节摘要与内容摘要。
- 冲突在继续输入后保持，避免迟到回执或新按键静默解除冲突。保存/输入法组合期间阻止重新读取或恢复草稿，读取期间有新修改则保留当前内容。
- 下载与写入使用相同清理及内嵌运行时。未引入必需服务、Office、旧 IR 或额外编辑器。

## 四层状态

|层|状态|证据与限制|
|---|---|---|
|代码|implemented|三个目标源码文件；原生权限可用性仍依赖浏览器|
|自动化|passed|[最终测试日志](verification/test.log)，63/63；新增三个 S02 测试，未删改原有断言|
|真实浏览器|partial|[实际下载重开](actual-download-reopen.json) 使用已安装 Chrome、file://、离线、headless；[Safari](safari.json) 无法创建会话|
|人工|pending|无人操作系统文件选择器、原生 IME 或私密浏览会话；无低性能设备或模型遥测声明|

## acceptance 逐项映射

|条目|当前证据|结论/缺口|
|---|---|---|
|1 file:// 授权自动写回、原路径重开|[原文件摘要](original-file-hashes.json)、`tests/single-file-save.test.ts` 第三个测试|partial：真实磁盘 I/O + 浏览器文件入口，但句柄和选择器为合同模拟；原生授权旅程 pending|
|2 无 API/拒绝权限完整下载并重开|[下载记录](actual-download-reopen.json)、第一个测试、[实际下载文件](sample.ppte.html)|Chrome 自动化通过内容、样式、保护及媒体解码和继续编辑；API 缺失/拒绝是故障注入，Safari 原生降级 pending|
|3 下载/草稿不称原文件已保存|第一个及第二个测试；原有 `tests/html-save.test.ts` 的直开限制与配额测试|自动化通过：下载回执与文件确认独立，dirty 保留；无草稿能力提示|
|4 移动/复制/同名/双窗口/外部改动/配额/私密|[故障恢复映射](failure-recovery-results.md)，三个新增测试及原有 H02 回归|partial：复制隔离、同名不同版本拒绝、外部冲突、配额模拟及既有双窗口测试通过；真实移动/同名原生选择、私密浏览、浏览器间组合仍 pending|
|5 按键/IME/保存中输入/迟到回执|新增第三个测试与原有 H02 组合输入、迟到回执、双窗口草稿测试|Ctrl+S 和在途修改通过；Cmd 条件分支保留，原生 IME 与实际 macOS Cmd 旅程 pending。composition 合成事件不冒充 IME|
|6 不依赖 HTTP 服务补偿|第一个测试离线且无 HTTP 请求，第三个测试通过 Node binding 注入测试句柄；S01 文件入口回归|自动化通过；测试夹具的 Node I/O 不在作品中，不能冒充独立无 Node 机器或原生 API|

## requiredEvidence

- [browser-version-capability-matrix](browser-version-capability-matrix.json)：Chrome 实测能力与 Safari 受阻，API 存在不表示授权通过。
- [native-picker-journey](native-picker-journey.json)：明确 pending 与待执行步骤，无虚构 OS 操作。
- [original-file-hashes](original-file-hashes.json)：实际文件字节摘要与模拟句柄边界。
- [actual-download-reopen](actual-download-reopen.json)：浏览器 download 事件、实际落盘、file:// 重开及媒体断言。
- [failure-recovery-results](failure-recovery-results.md)：逐项故障与测试对应。

## 边界与剩余风险

浏览器无法可靠获知当前 file:// 与所选句柄是否为同一绝对路径；内容和身份完全相同的副本可由用户选中，UI 因此明确写到“所选文件”，不以文件名证明原路径。尚未绑定时不能读取任意原路径字节，首次比较的是规范化内容/身份/版本；绑定后比较完整文件字节。Web Locks 只协调可共享该锁域的窗口；摘要检查与覆盖不是针对任意外部进程的原子 CAS，极窄竞争窗口仍存在。

未改变 S04 的每键草稿序列化和约 800ms 防抖策略，也未声称完成性能测量。F01 由 S01 的本轮全量回归继续覆盖；F02–F05 仍归 S03，未关闭。R05/R06 的原生浏览器与恢复验收缺口保留；其他用户反馈与 R01–R04 不借本任务关闭。历史审查未改写。

开发中发现的两次失败：新增身份使用带连字符 UUID，违反现有 32 位十六进制合同；句柄绑定误比较带/不带 doctype 的内容。均修复后重新执行原断言与全量测试，没有削弱断言。
