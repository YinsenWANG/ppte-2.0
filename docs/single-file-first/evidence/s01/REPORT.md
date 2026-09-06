# S01 — 单文件入口实施与证据

状态：**partial**。实现提交 `ec215cd`（完整 ID 见 TASKS.json）。代码与自动化通过；实际 Chrome headless 文件旅程通过，独立无 Node 目标、Safari 和人工确认仍待验收。

主验收入口：[作品.ppte.html](作品.ppte.html)。直接下载/复制这一个文件后在浏览器打开。它是仓库原生 Grid/Flex/SVG/内嵌媒体回归样稿，不是 S08 的新版 Skill 人工审美验收稿；样稿的测试字体并不覆盖完整文字字形，不据此声称成稿审美或字体可读性已获人工认可。

## 实现范围

- 默认显示作品名称、状态、编辑、保存/授权、完整下载与放映。移除透明启动按钮和隐藏入口；Esc/阅读保留可见操作。阅读与编辑的画布边距统一由 workspace 管理，放映退出恢复先前模式。
- 编辑器仍由文件内可信运行时安装，不要求 token、adapter 或 localhost。作者 DOM/CSS 不改写为其他表示。
- `ppte edit FILE [--no-open]` 返回 `file://` 并退出，不创建监听器；正常模式调用系统打开命令。`--port` 在 edit 中明确拒绝。`ppte serve` 显式保留开发服务及原有服务回归测试，不是默认入口或缺权限降级。
- 增加完整 HTML 下载，默认 `.ppte.html`，复用清理/序列化入口。状态明确“原文件未覆盖”，原字节不变。原生授权及更完整保存状态机仍属 S02；本轮不关闭其验收。
- Skill、README、CLI 帮助、活动合同同步实际迁移行为；不修改历史审查。

## 验收与 requiredEvidence

|条目|实际证据|结论|
|---|---|---|
|无 PPTe/Node 目标断网，文字/格式/撤销/放映/Esc|[journey.json](journey.json)、[无 Node 目标记录](no-node-target-environment.json)|Chrome 实际文件旅程通过；独立无 Node 目标不可用，整项 partial|
|网络无 localhost/CDN/外部编辑器|[network-log.json](network-log.json)|通过：offline context，仅三个 file 请求，无 HTTP/WS 请求、无 pageerror|
|复制另一目录且原生 CSS 保真|journey.json；[布局测量](canvas-layout.json)、[原画布](canvas-before.png)、[增强画布](canvas-after.png)|通过：原文件及目录副本分别完成旅程，原生 Grid/Flex、媒体解码通过；同尺寸画布布局及 PNG 字节完全相同|
|阅读操作可见，放映无编辑器/常驻工具条|[阅读](read.png)、[编辑](edit.png)、[放映](present.png)、journey.json|通过：实际 UI 点击，放映工具条空闲 opacity=0，Esc 恢复编辑，阅读关闭 contenteditable|
|real-file-url-journey|journey.json；tests/single-file-entry.test.ts|Chrome 152.0.7977.76，headless 实际 file://，非 page.setContent 模拟文件|
|network-log|network-log.json|保留实际请求列表与错误列表|
|read-edit-present-screenshots|read.png / edit.png / present.png|真实浏览器截图，未修图|
|no-node-target-environment|no-node-target-environment.json|pending：测试宿主装有 Node/PPTe，没有另一个未安装目标；离线自动化不能替代这一证明|

另有实际浏览器下载落盘后重开：[download.ppte.html](download.ppte.html)；原文件未覆盖断言、下载文件内容与可编辑性断言见新增测试。应用自身只声明下载发起；测试驱动确认的下载落盘不被偷换为产品可确认落盘。

## 测试变化与结果

新增 `tests/single-file-entry.test.ts` 两项测试，测试总数 58 → 60，没有删除测试或放宽正确性断言。

- 新文件旅程经实际按钮和内容输入完成：文字、斜体、撤销格式、放映、Esc、阅读、下载、重开；另一目录副本重复旅程。网络从 context 创建时记录。
- 新 CLI 子进程测试使用 `net.Server.listen` 拒绝守卫，验证 edit 返回正确编码的 file URL、及时退出、拒绝服务参数且原字节不变。`--no-open` 是自动化支路；尚无人工默认浏览器打开命令的端到端确认。
- 既有服务安装/保存/重启/令牌/多文件映射测试改用显式 serve，保留所有服务断言；播放器和保存测试从可见“编辑”按钮进入。
- 保真测试保留完整布局相等和 PNG 字节完全相等。新增顶栏使截图改为内容 iframe；两个画布统一视口、物理位置与合成层（测试中对两个外层 iframe 使用 translateZ(0)，不修改作者 DOM）。对原作者 file 还额外比较一次布局。开发阶段不同合成层导致渐变抖动色值差异，未使用容差消掉差异。Buffer 相等断言改用 equals，避免失败打印巨量字节造成测试进程 SIGKILL。
- 首轮全量 59/60：CLI 返回 HTML_FILE_REQUIRED 与既有 HTML_REQUIRED 断言不符。修复实现保留原错误码，未修改该断言。失败日志保留 [first-test.log](verification/first-test.log)，开发诊断日志另存，不回写为通过。
- 最终 `pnpm typecheck && pnpm build && pnpm test` 均退出 0，60/60。见 [result.json](verification/result.json)、[类型检查](verification/typecheck.log)、[构建](verification/build.log)、[全量测试](verification/test.log)。60 包括“记录 Safari 受阻”的测试，不是 Safari 通过率。

## 状态分层及待验收

|层|状态|边界|
|---|---|---|
|代码实现|passed|S01 文件入口与 CLI；S02 保存权限生命周期不在此关闭|
|自动化|passed|60/60；真实 Chrome headless 文件旅程、精确画布对比、服务回归|
|真实浏览器|partial|Chrome 152 headless 已执行；[Safari 本轮返回](safari.json)要求启用远程自动化，未执行成功旅程；独立无 Node 目标缺失|
|人工确认|pending|无用户手动复核、无原生选择器/真实 IME/打印交互确认|

F01 对应本轮可见入口修复及截图；F02/F03/F04/F05 保留 S03 的 `F02-F05-regressions` 映射，未修改其计划状态。性能、低性能设备、模型遥测、图片选择审美均未在此冒充完成。历史审查证据保持原样。

本轮新增文件：入口测试、此报告、逐项 JSON、三张 UI 截图、两张原生画布截图、两份自包含 HTML、Safari 受阻记录、验证日志。可重跑 `pnpm test`，新原始输出在 `artifacts/s01`，不会覆盖此提交冻结的证据。任务开始前已存在的 brief6/out6 管线文件保留原位，仅加入本地 `.git/info/exclude`，未纳入产品提交。
