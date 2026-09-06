# S06 — 图片编辑与媒体资源管理

状态：**partial**。主验收入口为同目录 `review.ppte.html`（直接打开文件）。这是工程样本，不是已有人审的真实图片作品。

本轮遵循提交 `9856db3cef4da0d6ea6aca5a46b7039a166b995c` 的 HANDOFF、完整 PLAN 和 ea260ce 历史审查；基线代码为 `5e5759162aece9089100656e4977c4ad722ef207`。实现提交见 TASKS.json 的 implementationCommit。没有修改历史审查或将旧 pending 改成通过。

## 四层状态

|层|结果|
|---|---|
|代码|图片插入/替换、完整显示/填充、双轴焦点、重置、图片说明、视频封面编辑、资源历史去重和有界清理已实现。文件内资源表显式 opt-in；按需 blob 和解码内存优化未实现。|
|自动化|typecheck、build、71 项测试全部通过。新增 2 项 S06 测试，未删除、弱化任何既有测试或断言。|
|真实浏览器|实际安装的 Chrome headless，file://、断网、删除素材目录、下载后重开、媒体播放/离页暂停、打印图片解码、PDF 和演讲者 popup 已测。不是原生系统选择器、人工 GUI 或 Safari 验收。|
|人工|pending：没有用户提供的真实混合图片批次，没有人工主体/关键文字/数据/选图核对。Agent 查看测试截图不算人工签字。|

## 实现与边界

- 新插入图片按 contain / 居中显示，原始文件不重编码。替换后重置旧焦点/裁切，清空不适用的旧图片说明或旧视频封面，提示重新核对。可编辑图片说明和视频封面。异步读取会复查身份/内容/保护状态，错误不改原对象。
- 图片支持 PNG/JPEG/WebP/GIF/AVIF 的浏览器解码；本轮实际图片旅程覆盖 PNG/JPEG/WebP，未将未测格式宣称为浏览器全兼容。HEIC/损坏图片明确拒绝。单次插入/替换上限 16 MiB，有提示且不自动有损压缩。
- 历史将媒体字符串驻留一份，历史条目存会话引用；还原时展开为原 data URL，不将会话引用写入作品。最多保留 100 步，驻留媒体字符串估算超过 64 MiB 时删除最老记录并显示通知；始终保留最新一步。`clearHistory` 释放驻留表。上限不是总浏览器内存保证：DOM、插入记录持有的节点、解析临时字符串、原稿及解码缓存另计，单个大型事务也可能超过该阈值。
- `enhanceHTML(source, {...options, mediaTable: true})` 可显式试用资源表；默认生成和旧 data URL 文件不切换。大于等于 4096 字符的栅格 img/video/audio `src` 与 `poster` 按完整 data URL 的 SHA-256 保存一份，稳定身份包含 MIME；不建立版式 IR，不改原始像素。CSS/SVG 中资源仍采用既有内嵌路径，未做文件级去重。
- 文件读取校验摘要与引用，资源缺失/损坏抛出错误；直开引用缺失文件显示可见错误。保存只打包当前 DOM 引用的媒体，删除项不留在新文件的资源表中；会话撤销所需原资源仍由历史持有。下载、普通保存和重新增强均有资源表读写路径，原生授权保存未实测。
- **没有创建媒体 blob URL，也没有扩大 CSP。** 可选表打开后展开为 data URL，所以打印/演讲者仍复用既有数据路径，无媒体 blob 吊销问题；按需 blob、打印窗口引用计数、原生解码内存生命周期仍是未实现项，不能宣称已交付 PLAN 6.4 的完整内存方案。资源表保持非默认。
- 打印不再吞掉带 src 图片的解码错误，失败会恢复编辑界面并报错。没有封面的视频不伪造图像。视频本轮为仓库 CC0 常色测试素材，不能代表真实视频内容评审。

## 逐项验收与证据

|验收条目|实测与缺口|证据|
|---|---|---|
|至少 12 张真实授权图片制稿和人核对|**pending**。12 张不同尺寸/格式合成栅格样本 + CC0 常色视频仅用于工程验证，不冒充真实混合照片或人审。|`mixed-media-fixtures-and-hashes.json`、`human-review.md`、`review.ppte.html`、`tests/single-file-media.test.ts`|
|替换不同宽高比，撤销/重做、保存/重开保留裁切资源|Chrome 自动化通过：横图 cover(100,0) → 竖图 contain(50,50)，说明清空；双轴焦点 25/75、重置；替换/插入/封面撤销重做；下载重开。任意作者父容器遮罩、主体语义和真实原生 picker **pending**。|`crop-before.png`、`crop-after.png`、`journey.json`、`verification/test.log`|
|删除原素材目录并断网仍显示/播放|Chrome 自动化通过：删除输入目录后 file:// 打开；13 张图片（含插入项）解码，重开视频实际播放、翻页暂停；未发生 HTTP 请求。其他浏览器/机器 pending。|`journey.json`、`review.ppte.html`、`verification/test.log`|
|无临时 blob URL、失效/缺失引用明确失败|表打包拒绝临时 URL；保存清理拒绝未解析引用；表损坏/缺失测试拒绝；实际错误文件显示 MEDIA_RESOURCE_MISSING。既有 S02 成品无 blob 字符串断言继续通过。|`tests/single-file-media.test.ts`、`verification/test.log`、`journey.json`|
|新表启用前兼容、重复体积、历史清理、打印、演讲者|旧文件测试全部保留；新表往返与重复保存字节数一致；100 步历史上限/清空，14 张打印图片（含封面）解码和 PDF，6 张下一页预览解码。资源表仅 opt-in；原生打印/Safari/按需 blob 仍 pending。|`journey.json`、`media.pdf`、`resource-lifecycle-and-size-results.json`、`verification/test.log`|
|CSP 仅必要 blob 能力、不放宽脚本/网络|未引入媒体 blob，CSP 完全不变。作者 script-src none / connect-src none 原断言和沙箱攻击测试通过。|`tests/single-file-media.test.ts`、`verification/test.log`|
|压力稿体积、解码与内存成本透明|有真实文件/gzip 字节数、增强/序列化/打开时间、CDP heap 原值和剩余 decode 等待时间。原生解码内存/完整 codec CPU、低性能实机 **unavailable**，RGBA 数仅估算，不是假称实测。|`baseline.json`、`resource-lifecycle-and-size-results.json`、`stress-table.ppte.html`、`scripts/s06-media.mjs`|

requiredEvidence 映射：`mixed-media-fixtures-and-hashes` → 同名 JSON + human-review.md；`crop-before-after` → 两张截图 + journey.json；`offline-reopen-media` → journey.json + review.ppte.html；`resource-lifecycle-and-size-results` → baseline.json + 同名 JSON + verification/test.log。各项实现提交在 TASKS.json 中逐条绑定。

## 测量说明

先用未修改构建运行基线探针，保留 `baseline.json`；`baseline-probe.mjs` 是当时探针（移除固定仓库绝对路径），重放基线应在上述基线提交构建后运行。固定 1024×768 确定性噪声 PNG，原始 1,767,697 bytes，重复 12 次；无有损变换。基线文件 28,583,563 bytes；10 次 fit 切换历史字符串按 UTF-16 估算 94,282,610 bytes。这个估算不是实际 heap/RSS。

后测同一输入由 `node scripts/s06-media.mjs` 重建，默认输出到 artifacts/s06-stress。最新精确数字和全部 CDP 指标见结果 JSON；文件级去重大幅降低重复资源体积，历史元信息从大段 Base64 改为短引用。资源表打开仍展开 data URL，不能推断解码内存下降；SHA 校验/表封装会增加序列化成本。脚本既记录 legacy 也记录 opt-in，不用 gzip 或热缓存掩盖真实文件体积。

此处每模式一次工程样本，不是 S04 冻结参考机的 p95，也不是九对模型比较。decodeWaitMs 是编辑器 ready 之后等待 Image.decode 的剩余时间，非完整解码耗时。CDP JSHeapUsedSize 只测 JS heap，非 native/GPU 媒体内存。没有模型 token 遥测或真实低性能设备。

## 测试、历史问题与复现

新增文件：media-table.ts、media-history.ts、tests/single-file-media.test.ts、scripts/s06-media.mjs，以及本目录报告、工程成品、截图、PDF、哈希清单、测量和验证日志。

```
pnpm typecheck && pnpm build && pnpm test
node scripts/s06-media.mjs
```

首次全量失败原样保留为 `verification/test-initial-failed.log`（69/71）：新历史构造器在非安全上下文依赖 randomUUID 导致初始化超时；新增校验的字面量触发既有成品无 blob 断言。已修复构造器能力检测和校验表达式，没有改断言。中间定向失败日志另存 `focused-initial-failed.log`；最终通过日志为 test.log/focused.log。截图发现替换后焦点控件显示旧值，已修复并新增字段断言；两轴连续调整也从实时样式读取。

F01–F05 映射仍沿用 S01/S03 的原记录；本轮全量运行包含 tests/single-file-editing.test.ts 与 tests/single-file-entry.test.ts（F01 入口、F02 唯一页放映、F03 保护兄弟与插入、F04 页面设计上下文、F05 背景同步）。既有断言全部通过，不据此抹去 Safari、原生权限/IME/打印和人工确认的缺口。S02/S03/S05 依赖仍 partial。没有触及 Office/PPTX/旧 IR，没有推送或部署。
