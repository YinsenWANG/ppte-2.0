# H02 原文件保存与恢复：partial

依据：提交 `bbcd46bde2c608b5a56e617f316c5dcb5534857e` 的 README、PLAN、TASKS 和 REVIEW_DISPOSITION。实施与最终验证提交见 `verification/result.json` 和 TASKS.json。

## 使用

在仓库执行 `pnpm html:build`，然后 `node scripts/stage-html.mjs`。候选包位于 `artifacts/html-package`；用 `npm install --global --prefix /你的独立安装目录 ./artifacts/html-package` 安装，将该目录的 `bin` 加入 PATH。此候选不替换历史安装，也未发布到 registry。

运行 `ppte edit ./作品.html`，打开增强后的原文件。命令默认调用系统浏览器，`--no-open` 只输出实际会话链接；`--port=PORT` 可指定端口。必须保持进程运行。默认端口由路径确定，多文稿映射到各自端口；冲突会明确报 EADDRINUSE，可指定空闲端口。重启同一命令仍使用同一端口，产生新令牌，打开终端的新链接重新连接。当前进程内刷新页面会保留会话授权。

文字修改停顿 800 ms 后写回；IME composition 期间不提交。Cmd/Ctrl+S 重试保存。状态区区分已落盘、修改中、等待写入确认、仅草稿、冲突、无授权和失败。冲突可复制保留当前 HTML/恢复草稿，或明确重新读取磁盘；不会自动覆盖新版本。历史恢复通过“恢复上一版本”操作。

直开 HTML 时，右下角编辑入口可由悬停或 Tab 聚焦唤出；编辑前显示原文件写入限制。支持 File System Access 的浏览器首次保存须用原生选择器选择原文件并授权，不支持时展示 `ppte edit` 启动指导。没有常驻服务或 shell 协议假链接。重开直开的文件需要重新选择并检查权限；本阶段不持久化文件 handle。

## 保存协议与局部选择

- 新的 html-save 只接入 html-document；html-editor 是同一内嵌 runtime 的保存 UI 与适配层。未接入 IR/Core/Recipe/Portable/Office。H01 图测试显式允许新增的这两个原生包，继续拒绝其余所有旧包；浏览器图还拒绝 Node 保存包。未删除任何既有测试。
- 服务仅绑定 IPv4 127.0.0.1。Host、Origin、跨站 fetch 元数据、256 bit 会话令牌、精确路由/字段和 16 MiB 请求上限共同限制入口。令牌仅在可信父页面会话中；文稿 iframe 禁止脚本，持久 HTML 不保存会话令牌。服务重新验证内容并重建可信封装，永不接受目标路径或调用方 runtime。
- 每个 canonical 文件以应用目录锁串行协调多个服务进程。死进程锁在下一次写入时回收；活进程锁不抢占。旧文件摘要匹配后先将恢复版本写入应用目录，再在同目录创建临时文件、sync、校验、再次检查磁盘摘要、rename、sync 目录，读取确认后才返回成功。实际 SIGKILL 后重启会清理临时文件并恢复写入。
- 版本缓存位于 `~/.local/share/ppte-html/<路径摘要>`，每个文件最多 10 个版本、32 MiB；用户目录仅保存作品，写入过程中短暂存在临时文件。草稿为浏览器存储，包含文件路径作用域、documentId、基准摘要、revision 与时间。仅匹配基准才自动恢复；配额、不可用存储和冲突单独提示。
- 浏览器 File System Access 使用权限检查、当前字节摘要、createWritable/write/close、写后重新读取校验；可用时通过 Web Locks 协调同源窗口。原生 picker/授权撤回尚未有真实交互验收，合成 handle 测试仅证明适配契约。

## acceptance 证据

所有测试均由 `node --test dist/tests/html-save.test.js` 运行；完整名称与结果在 `verification/h02.tap`。

| 条目 | 结论 | 实际证据 |
| --- | --- | --- |
| 原路径编辑、关闭重开、进程重启 | passed（自动化） | installed Chrome 编辑后读取同一磁盘文件；关页重开、服务重启、页面刷新；真实 npm pack/install 后执行 ppte edit 并重启进程；无下载事件 |
| 满盘、只读、撤权、中断、双窗口、Agent | partial | 16 MiB HFS+ 磁盘实际填满得到 ENOSPC，原文件不变且释放空间后重试通过；chmod 只读；SIGKILL 中断后重启；两个服务竞争只有一个成功；双窗口冲突保留修改；替换前 Agent 修改拒绝；撤权仅 API 契约测试，真实浏览器撤权仍待验证 |
| 写入确认才显示已保存、草稿单列 | passed（自动化） | 阻塞 replace 时保持“保存中”；IME 未结束和 400 ms 时未写入；新编辑不被旧响应清掉；失败重试；草稿关闭重开恢复、基准冲突、复制路径隔离、配额满；file URL 仅草稿 |
| 本地、安全边界 | passed（自动化） | socket 绑定地址、非 loopback 网卡连接拒绝、恶意 Host/Origin、无令牌、跨站、路径穿越、任意字段、脚本内容全部拒绝，磁盘摘要不变 |
| Safari 与 file 直开 | partial | 实际 installed Chrome file URL 限制与状态截图；实际 Safari 26.6.2 WebDriver 请求被拒绝：必须在 Safari 设置开启 Allow remote automation。`safari.json` 是原始阻塞证据；测试通过表示成功记录阻塞，绝不表示 Safari 编辑验收通过 |

## 剩余风险与明确未完成

1. Safari 原路径编辑/保存/重开及 file 直开尚未完成；真实 Chrome 原生文件选择授权、权限撤回和重新授权尚未完成。不得将 API mock、Chromium 或安装检测冒充这些验证。
2. 已实测 APFS 保存、HFS+ 满盘和进程中断；未做物理断电测试，未承诺硬件断电耐久性。没有声称所有操作系统或文件系统均通过。
3. 任意外部进程不遵守 PPTe 文件锁时，最后一次摘要检查与 rename 之间仍存在系统 API 不提供 CAS 的竞争窗口；浏览器原生写入也无法与任意外部进程共享原子 CAS。已覆盖常规外部修改及替换前故障注入，不宣称消除此极窄窗口。
4. 服务重启需要打开新的会话链接；端口碰撞使用明确 `--port` 解决。尚无常驻发现服务或系统文件关联。手动改变端口会改变浏览器草稿 origin。
5. 保存条是 H02 最小可用入口，统一设计、日常编辑工具、放映状态协调/PDF 属 H03/H04。收起保存条不等于完成 H04 放映验收；本任务不关闭 R01/R02。

## 审查承接

R01/R02：仍交 H04/H03，未关闭。R03/R04：仍交 H00/H06，未增加合成质量或性能结论。R05：新 Chrome 自动化与 Safari 阻塞如实记录，Office 不实施。R06：新包安装、原文件保存、满盘重试、版本恢复和 SIGKILL 重启已有证据；真实浏览器与断电范围仍待验。旧 CLI/Office/CAS/Portable 仍存在历史仓库，全局分发退休由 H05 处理，本任务未宣称已完成旧发行包退休，也未修理其专属问题。
