# H00 实施与证据（partial）

已冻结 HTML 正向合同，固定三份真实来源及 SHA-256、十二页、轻资源层级、空外部资源集和系统字体栈。来源分别为 Cherry Studio 固定版本 README、PPTe 固定方案、基线源码依赖真实统计表；第三份不是虚构营收数据。来源的功能陈述不是 PPTe 格式兼容要求。

`manifest.json` 指定未来对照目标 `gpt-6-astra / medium`，与本机当前 Codex 启动参数一致。这只证明请求配置，不证明提供方实际响应身份。没有可核验的提供方配置与 usage 回执，故 verification 为 pending；首次受控运行前必须确认可用配置，变更时重算 manifest 摘要并重启整组测量，禁止混用模型结果。

[三份首稿](drafts.json) 是本轮直接编写 HTML/CSS、通过本地 Python 序列化的探索稿，各十二页，不经过旧核心。未测量独立模型调用、首稿 tokens 或冷/热生成耗时；不能塞进九对正式对照，也不是编辑保存成品。可直接阅读 [Cherry 开源之路](drafts/cherry.html)。其余首稿和三张首屏截图仅作仓库内部证据，不是用户多文件交付协议。

## 基线工具

```sh
node scripts/html-benchmark.mjs
# pending 退出 2；invalid 退出 1；recorded 退出 0。
# recorded 仅表示字段和文件证据完整，不代表 H06 性能/审美或浏览器验收通过。

node scripts/html-benchmark.mjs capture /tmp/unique-first-run -- producer arg1 arg2
# producer 的 stdout 应是原始 HTML；stderr 为日志。目录必须不存在。
# 首稿、部分输出、失败退出码、stderr、SHA-256、原始/gzip 字节与实测 wall time 都会保留。
```

正式模型生成由现有 Agent/提供方执行，不新增模型客户端或密钥依赖。捕获器不重试、不修稿、不以字符数推算 tokens；当前 null 不能改成 0。后续将提供方原始 telemetry 和日志一并放入证据根，按 baseline 的十八个固定槽位填写 success/failure；每槽记录同一 manifest 摘要、模型、提交、设备、系统、热环境，installation/research/generation/tool/correction/total 毫秒，input/output tokens、calls、retries、failures、firstDraft（失败未生成时允许 null）、bytes/gzipBytes/mediaBytes、telemetry/log 文件引用。路径相对证据根，含 SHA-256，不允许越界或 symlink 逃逸。

冷/热安装分开填 installation.cold/hot；冷安装需隔离安装目录和完整日志，当前已有 node_modules，不能倒推冷安装成本。总耗时不得小于各阶段之和。原始回执仍需人工核对字段与调用归属，JSON 校验不是反伪造认证。失败不删除、不用修正版替换首稿；修正另存并计入 correction。十八槽全部缺测时报告 pending，不给出中位数、速度比或 token 改善结论。

## 实际浏览器边界

机器安装的 Google Chrome 为 152.0.7977.76，Safari 为 26.6.2（safaridriver 21624.5.1.11.3）。[Chrome 探针](chrome-probe.json) 使用 Playwright `channel: chrome` 启动已安装品牌浏览器的 headless 实例；三稿 `file:` 打开各检测到十二页，1440×900 下未测出 section scroll 尺寸溢出，文件选择 API 暴露。这里只检查元素滚动尺寸，不覆盖所有遮挡或字体差异；首屏截图不是完整视觉验收。API 暴露不等于用户授权或写入成功。

[Safari 探针](safari-probe.json) 尝试创建真实 Safari WebDriver 会话，实际返回 `session not created`，要求开启 Safari 的 Allow remote automation。没有更改用户浏览器设置，也没有用 Playwright WebKit 替代 Safari。

| 旅程 | Chrome | Safari |
|---|---|---|
| 自动化 file URL 阅读 | 三稿已观测；不算人工验收 | pending，会话创建失败 |
| 人工 file URL 阅读与关闭重开 | pending | pending |
| 文件选择、授权写入、撤权与重授权 | pending | pending |
| 本地服务编辑→写入原路径→关闭重开 | pending，等待 H02 | pending，等待 H02 |

因此 H00 的真实浏览器 deliverable 未完成，状态必须 partial。H02/H06 必须补实际原文件旅程；当前没有借助 DOM 修改、缓存、下载副本或模拟服务宣称保存通过。

## R01–R06 承接

| 审查 | 本轮证据 | 仍未关闭 |
|---|---|---|
| R01 | 仅探索性原稿，没有产品放映 runtime | H04 观众 UI、黑屏、Esc、媒体与弹窗实测 |
| R02 | 三张原稿首屏；不属于编辑器 | H03 编辑 UI、对比度、键盘及混合状态 |
| R03 | 固定材料、全量槽位、三份探索首稿 | 受控正式首稿、三人盲评和人工编辑 |
| R04 | 捕获器测试实际进程耗时；拒绝缺失 tokens | 同模型端到端冷/热测量与真实设备性能 |
| R05 | 品牌 Chrome 自动化观察、Safari 原始失败 | 实际双浏览器授权、保存、重开、放映/PDF；Office 范围废止，不继续补验 |
| R06 | 基线原文件摘要与越界校验；依赖快照 | H02/H05 安装、保存中断、恢复与包检查；旧格式专属恢复演练废止 |

没有保留的用户体验问题被本轮关闭。旧格式义务按权威范围废止；旧代码还在调用链中，不把“计划退休”当作缺陷豁免。

## 仓库验证

[typecheck/build/全量测试与定向 TAP](verification/result.json)：全部通过，400/400 测试，H00 新增 8 项、删除 0 项（既有 392 项）。两条 acceptance 分别由定向测试第一项和第二至第六项覆盖；第七项检查三份探索稿，第八项检查真实依赖快照。合同约束通过不等于真实模型或浏览器测量完成。

没有修改 blackbox 或发布脚本，未运行旧格式专属新增验收。当前仓库全量既有测试按原样执行。工作区原有管道控制文件保留原内容，仅列入本地 `.git/info/exclude`，未纳入产品提交。
