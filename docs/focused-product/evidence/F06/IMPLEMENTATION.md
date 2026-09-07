# F06 收敛范围总验收

状态：`verified-with-open-items`，**未达到完整验收或发布门槛**。F06 完成可执行的总验收与交接；PDF 未实现，F05 依赖中的原生/人工层未通过。逐项四层状态见 `acceptance.json`，门禁、时间、平台和提交见 `verification/result.json`。

## 本轮工作

- 新增仓库测试 `tests/focused-product-f06.test.ts`，构建后由 `node --test dist/tests/*.test.js` 执行；不修改运行时代码，不增加依赖。
- 使用审查 `b93ffed` 留存的同一份 10 页 Cherry `sample/source.html`，通过当前运行时增强。编辑首屏真实 Enter 换行与字号，插入本地 PNG、裁切焦点、撤销重做，明确下载一次，关闭整个 Chrome，再用全新进程离线重开同一个下载稿。检查正文严格相等、原始图像只嵌入一份、原文件字节不变、重开可继续操作图片与文本，以及 10 个不同页面逐页纯净放映/Esc。
- 检查全部旅程无 HTTP 请求和页面脚本错误。截图使用 `caret:'initial'` 且检查捕获不改变正文。
- PDF 只验证一级入口禁用及原因准确；没有生成或交付所谓合格 PDF。可打开的失败候选及逐页对照仍见 [F04A 对照](../F04A/COMPARE.html)。受控 Chromium 仍使用浏览器打印管线。
- 原始 `source-with-links.html` 再次增强仍产生 `CONTENT_URL_REMOVED`，B2 保持 open。未修改原审查输入，也未以删入口关闭 B2。

## 逐项交接

|验收项|本轮可验证结果|未完成部分|
|---|---|---|
|离线直开编辑图片保存重开放映PDF|A1：同稿真实浏览器自动化 UI、明确下载/新进程重开、10 页放映；正文、图像、网络与错误断言|整项 code/automated pending：PDF 不合格；下载不等于原文件写回；real-browser/human pending|
|目标浏览器原生保存证据|A2：检查原生 pending 记录，保留 F02 原生操作标准；全仓回归含保存队列/错误/冲突|automated/real-browser/human pending：没有原生选择器授权、手动/自动写回与原文件重开回执|
|未闭环项准确记录|A3：机器可读台账与依赖状态检查，B2 原输入复现|报告 code/automated passed 仅表示记录正确；缺口本身仍未关闭|
|回交一个HTML与实现提交/证据|A4：交付实际下载的 `Cherry-F06.ppte.html`，校验和、旅程、截图和提交|自动化交付可核验；目标设备与用户签收仍 pending|

`Cherry-F06.ppte.html` 是本轮唯一产品交付 HTML，默认阅读、离线可编辑；首屏“离线验收”和工程测试图片是旅程中产生的改动，不是用户认可的美学定稿。`artifacts/` 中的测试中间输入不作为额外成品交付。

## 未闭环项与范围

完整台账见 [acceptance.json](acceptance.json)：PDF、B1 系统输入层、B2 安全导航合同、原生保存、低性能参考机、实际 GPU/解码释放、UI/成稿人工确认、生成/token 遥测和图片语义、其他浏览器/触控/系统缩放/无障碍、大图草稿存储。旧 S07 打印绿色不代表最新 PDF 合同合格；旧 R1–R6 与历史数据测试不会因为功能收敛被伪称原先已通过全部体验。

额外产品能力移除：**无**。F01 已确认的菜单收敛继续有效；建议删除的演讲者/属性/恢复等能力不被当作用户新授权。已有页面管理继续沿用 F05 的自动化覆盖，不扩展布局编辑器。不删除正文、形状、表格、SVG、媒体或历史数据，不添加必需服务，不上传，不安装新的重环境。

## 复验与证据诚实性

运行 `pnpm typecheck && pnpm build && pnpm test`。单项为 `node --test dist/tests/focused-product-f06.test.js`（先 build）。门禁原始日志与初次失败均保留。

前两次聚焦测试失败原因：比较了不同会话中的编辑器运行时 DOM，重开时新增 BR 会分配 identity/focus 属性。第二次移动快照时点仍失败，日志保留。最终仅在标题的 BR 比较副本上去掉这两类运行时标记，严格比较其余作者 innerHTML；实际下载正文与现场、重开正文与下载的整份序列化内容仍严格相等（不做规范化）。没有修改产品或既有测试断言。

原生与人工步骤见 [NATIVE-VALIDATION.md](NATIVE-VALIDATION.md)。没有桌面操作通道/目标机回执即 pending；代理查看截图不记为用户确认。原有 `brief9-F06.md`、`out9-F05.txt` 管道文件原样保留，按既有 `.git/info/exclude` 惯例仅本地排除，不纳入产品提交。不 push。

## 提交与依赖追溯

- F06 测试与台账：`6535b85`；冻结 HTML：`cd13f1d`。最终门禁在 `cd13f1d` 的代码上运行，后续证据提交仅更新日志、状态及校验和。
- 运行时沿用 F01 `2853126`、F02 `272f31c`/测试修复 `342d439`、F03 `63a5565`、F05 `8bb0234`/`46e102d`；各层状态以 TASKS.json 为准。
- PDF 验证 F04A `fca916e`，F04 未实现的记录 `903dcd1`/`494dae0`。
- 所有 F06 提交使用要求的作者、GPG 签名及 signoff；未 push。仓库全局 `*.ppte.html` 忽略规则要求显式强制纳入冻结成品，已在独立 F06 提交中追踪。

最终三项门禁均 exit 0：149 passed、0 failed、16 既有 skipped，新增 F06 三项通过且无新增 skip。`verification/commands.json` 记录每条命令的起止时间与代码提交。最终证据元数据更新后另行检查 JSON、引用路径与全部 SHA256。
