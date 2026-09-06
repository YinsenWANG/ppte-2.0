# S02 故障恢复证据

执行结果见 [最终全量日志](verification/test.log)。新增用例位于 `tests/single-file-save.test.ts`，既有用例位于 `tests/html-save.test.ts`。日志中 Safari 用例的测试通过仅表示受阻证据已记录。

|场景|真实执行层与断言|状态|
|---|---|---|
|无 API、权限拒绝|Chrome file://，注入无 API/拒绝；真实下载落盘重开，原件摘要不变|自动化 passed|
|取消选择|注入 AbortError，编辑保留；重开不自动恢复草稿|自动化 passed；原生 pending|
|权限撤销、再授权|文件句柄合同桥接实际磁盘；拒绝后下载，重新授权后写入读回|自动化 passed；原生 pending|
|外部修改|实际改磁盘字节；保存报冲突，继续输入及再次按键也不覆盖|自动化 passed|
|写入中继续输入/迟到回执|延迟磁盘 close，修改后最终文件为最新输入，confirmedFileRevision 等于 revision|自动化 passed|
|双窗口|原有 H02 两真实浏览器窗口经显式开发服务的冲突和共享草稿确认测试，另有控制器测试|回归 passed；原生双句柄窗口 pending|
|写入失败|注入 close ENOSPC 后原字节保留，重试成功；原有 OS 只读、终止写进程、文件系统故障测试保留|自动化 passed；非物理断电证明|
|草稿容量/存储限制|新测试注入 Storage.setItem QuotaExceededError，UI 提示不可恢复但仍真实下载；原有控制器配额测试|自动化 passed；真实私密浏览 pending|
|复制与同名|复制文件 URL 不取其他路径草稿；同名同内容不同持久化版本拒绝绑定；新实例身份与原件不同|自动化 passed；真实移动/选择器路径 pending|
|输入法|原有合成 composition 事件阻止半组合保存；新代码下载时明确等待组合完成|合同自动化覆盖；原生中文 IME pending|

所有 API 注入/故障注入均为自动化合同证据，不代表实际操作系统授予权限、真实磁盘配额耗尽或真实私密浏览完成。
