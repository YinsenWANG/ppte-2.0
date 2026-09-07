# F02 门禁修复轮

基线 `279cff3`，修复提交 `342d43927434a7c75109631b8e54b9f92e2171f7`。本轮没有改动产品运行时、扩大功能或移除额外能力。

## 复现与原因

用户附带的尾段没有失败堆栈。第一次完整门禁通过，第二次按管道的 `/bin/bash -lc` 路径执行时复现 **134 passed / 1 failed / 16 skipped**：`F01 A1/A2` 在键盘 Enter 后等待 `filechooser` 超过原有 10 秒超时。完整失败日志保存在 [before-failure.log](verification/fix-round/before-failure.log)。这次 F02 的四个测试均通过；不能由此断言截断的原始管道日志一定是同一故障。

单独运行及添加 DOM 事件诊断后的完整运行均通过，说明失败具有间歇性。本地 Playwright 1.62.1 源码中，首次添加监听器会异步 `updateSubscription`，服务端等待选择器拦截开启后才登记事件订阅。原测试首次注册一次性等待后立即发送键盘 Enter，存在订阅建立竞争；一次等待结束后又会拆除拦截。

修复把持续监听提前到导航之前，后续的两个一次性等待继续保留。新增触发计数断言：操作前 0 次、Enter 取消后 1 次、鼠标插入后 2 次。原有真实键盘、真实鼠标、取消后全文不变、撤销禁用、图片选中、撤销重做、响应式和内容保真断言全部保留。没有提高超时、重试动作、force click、跳过或替换成内部产品命令。该修复针对观察到的自动化时序风险，不宣称原生系统选择器已经验收通过。

## 验证与边界

本轮完整命令、退出码、日志摘要与哈希见 [verification/result.json](verification/result.json) 的 `gateFix`。原实现的验收记录及样稿保持不变；本轮日志单独存放，避免覆盖历史证据。

- 修复提交上 `pnpm typecheck && pnpm build && pnpm test` 全部 exit 0：135 passed、0 failed、16 既有 skip。
- 随后独立启动 12 次 `node --test --test-name-pattern="F01 A1/A2" dist/tests/focused-product-f01.test.js`，12/12 通过，无单次测试内重试，详见 [repeats.json](verification/fix-round/repeats.json)。有限次复验不能证明所有环境下绝无间歇性问题。

F02 四条 acceptance 的代码与自动化证据仍见 [IMPLEMENTATION.md](IMPLEMENTATION.md)。原生原文件手动/自动保存、授权失效、系统 IME/剪贴板、Safari 及人工确认继续 **pending**，原因仍是没有物理桌面对话框操作通道和目标机回执，详见 [NATIVE-VALIDATION.md](NATIVE-VALIDATION.md)。TASKS 状态保持 `implemented-pending-validation`。

本轮 `sw_vers` 实测为 macOS 26.6.2（25G83）arm64，与先前 result.json 一致；NATIVE-VALIDATION.md 首段旧的 25.6.0 描述未作为本轮机器信息沿用。

工作树原有管道文件 `brief9-F02.fix.md`、`out9-F02.txt` 及当前执行器输出 `out9-F02-fix1.txt` 保留在本地，按现有惯例加入 `.git/info/exclude`，不收入产品提交。
