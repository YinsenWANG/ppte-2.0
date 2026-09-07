# GAPS · 媒体生命周期、性能及 PDF 验证

实现提交：`86c8ce3669047e5de14575f0d515f04cc387e285`（GPG 签名 + Signed-off-by/DCO，无 push）。基于 R6 `00dd9d9`，原始 main 为 `f5ba190`。本轮不重做 R1–R6，也不代替 CLOSING。完整记录：[verification/result.json](verification/result.json)。

## 结果与边界

| 项目 | 代码 / 自动化结果 | 浏览器 / 人工边界 |
|---|---|---|
| UI07 A4 / S06 | 当前页媒体按需挂载，离页移除活动 URL；可见缩略图才加载图片，视频缩略图只使用封面；历史/保存保真 | Chrome 离线新进程旅程通过；不宣称浏览器已释放 GPU 缓存 |
| N04 / S07 PDF | 固定 sRGB RGBA8 栅格化；保留红蓝 `>4000`；历史失败 PDF 与三个缺失负样本通过 | 原生打印、Safari pending |
| S04 | 前台输入/翻页 p95 **15.3/29.1ms**；无头 **143.9/52.3ms** | 无头输入仍未达 50ms；不能以前台结果替换它。调查完成，性能总体 partial |

`pnpm typecheck && pnpm build && pnpm test` 通过，**126/126**。原始 probe 和 followup 完成；结果见 before/after JSON。R6 原始 followup 仅会应答旧 prompt，打开新产品表单并不等于完成命名；完整 R6 命名与持久数据测试仍通过。

## 媒体实现与用户路径

运行时在浏览器解析前将非当前页 img/video/audio/source 的 src/poster 改为瞬态惰性属性。阅读、编辑、放映切页恢复当前页；离页暂停并重置媒体选择，图片活动 URL 消失且 naturalWidth 回到 0。encoded 字节仍可供完整保存，不把字符串去重冒充解码内存回收。

可见缩略图通过 IntersectionObserver 加载，离开可见区释放；视频只显示封面。图片加载后重新适应原生尺寸，只响应 IMG load，避免 stylesheet load 引发重复布局。快照/序列化在脱离文档的副本恢复完整 URL，并保持原始属性顺序，因此撤销、历史和内容一致性不受临时状态影响。整稿打印显式请求所有媒体，等待解码后测量；afterprint 清理副本并恢复当前页需求。历史预览沿用按请求创建、关闭销毁路径。

`tests/r8-gaps.test.ts` 的真实用户旅程：下一页 → 可见图片鼠标选择 → 裁切 → 撤销/重做 → 更多/版本历史 → 输入命名 → 预览/关闭 → 下载 → 关闭整个 Chrome → 新进程离线重开 → 放映/键盘翻页 → PDF 菜单。验证 12 张图片中仅当前页 1 张有活动 URL、离页视频/source 暂停释放、12 张保存内容完整、打印 13 张含封面、预览及打印副本销毁。未用 force click、内部 Commands 变更或样稿专属标签。

旧 S06 的全部 12/13 张图片 decode 断言保留，改为真实翻到所属页逐页验证；整稿打印 14 张、演讲者预览 6 张及历史资源验证继续通过。[媒体记录](verification/media-lifecycle.json)、[S06](verification/s06-journey.json)、[UI06](verification/ui06-journey.json)、[UI07](verification/ui07-journey.json)。

## S04 133ms 调查

[无头最终数据](verification/performance.json) / [前台最终数据](verification/headed/performance.json) 使用同一 12 页源稿、1440×1000、安装版 Chrome、无自定义性能启动参数。真实鼠标选中文字并键盘输入 30 次，实际点击上一页/下一页各采样，共 30 次；从事件捕获到下一顶层 rAF，另记录最后冒泡监听器耗时及空白页/编辑器静置对照。采样完整性测试通过并不宣称延迟过线。

最终无头空白页 rAF p95 **143.1ms**，编辑器静置 **143.3ms**；输入处理 **0.5ms**，翻页处理 **11.0ms**。空白对照与前台对照表明历史约 133ms 主要落在本机无头帧调度等待，不能归为文字命令运行 133ms。未记录的历史 compositor/电源状态不可补造。无头输入门槛明确保留失败，不通过更换环境宣称修复性能。before.json 保留最初合成路径观测，与真实事件数据不能直接宣称优化百分比。

## PDF N04 根因边界

[源流诊断](verification/pdf-source-diagnosis.json) 显示保留的失败 PDF 内实际存在 DeviceRGB 红/蓝矢量绘制；不是丢图。旧 NSImage thumbnail → Generic RGB 采样在历史环境把红色读为约 (0.918,0.200,0.137)，当前对同一 PDF 又读为 (1,0,0)，没有固定颜色空间/栅格化合同。事后仅转换 thumbnail 的颜色空间不能纠正最初的栅格化差异。

新的 Swift 检测直接将 PDF 页绘到显式 sRGB、8 位 RGBA、白底、960 像素宽的 CGContext，保持原 `>0.9 / <0.1` 通道阈值及红蓝 `>4000` 门禁。历史失败原件只复制，不改写；固定检测红蓝各 6320。缺红、缺蓝、全缺图均被原阈值拒绝。历史具体显示配置没有记录，不能声称已还原其 ColorSync 设置。[正负样本](verification/pdf-controls.json)、[S07 检测](verification/s07-pdf-inspection.json)。

## 回归记录与离线样稿

首轮中间实现的通用 load 监听器误收 style load，已收窄到图片；随后两个严格内容一致性失败定位为属性顺序，已原序恢复。H01 精确像素、H04/UI06 内容断言均未削弱；保留中间日志，最终 test.log 为 126/126。

[生产 CLI 样稿](sample.ppte.html) 来自独立验收相同源稿，file:// 离线打开、选择标题、文字控件、放映/翻页/Esc 实测通过。SHA-256：`d19eebce892e7fa199a179a819e1271129bef96f78c53c7bd68022f1002e6379`。本轮附探针截图用于回归记录，R4/R5 同内容三尺寸原型对照仍见既有证据，最终完整回交由 CLOSING 汇总。

原生授权、Safari、系统 IME、原生打印、物理触控、屏幕阅读器、独立低性能/无 Node 设备、真人及同模型遥测都保持 null + pending + 原因，详见 result.json。不将 code/automated 状态提升为四层验收通过。
