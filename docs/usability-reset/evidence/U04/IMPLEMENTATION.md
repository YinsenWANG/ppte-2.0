# U04 — 诊断完成，PDF 仍不合格，等待架构决策

只修改独立诊断脚本与证据，未改 PDF 产品实现、未增加依赖、未启动服务或上传。历史 F04A 两候选及失败 PDF 均保留；本轮只重验其受控 Chromium 路线。执行 `node scripts/u04/diagnose.mjs`，现有 macOS PDFKit、Chrome 和 Python PyMuPDF 均来自本机已安装环境。

## 结果与可复现操作

- 同一原 fixtures-01 / fixtures-04 / cherry-10 以及各原视口变体，复制原字节并用 PDFKit 与 MuPDF 重读。`historical.json` 记录 SHA、全文、搜索结果；每 PDF 的 `.json` 包含 PDFKit 字符选区边界、字体资源和 MuPDF 单词框。English 2026：PDFKit 0 命中、MuPDF 1 命中。PDFKit 的 `En\nlish 2026\ng` 与 MuPDF 完整文本支持阅读器排序差异，不能归因成 PDF 没写入 g，也不能声明通用合格。
- 旧 transforms 两变体 MuPDF 差异仅在 (214,437)–(409,528)，通道差 >32 的像素数 0。查看 `transform-comparison.png` 未见可见位移；这是栅格细节差异证据，非降低门槛后的质量通过。原 PDFKit 失败记录不改写。
- 原适配先测量后切视口，并在变体导出时留下调用方视口/缩放。本轮在选择页和布局前固定冻结的作者宽高，复位 visual scale=1，不修改作者 ID，不替换字体，不搬动内容到另一套模型。20 页全部重跑（原型 3、Cherry 10、夹具 7），每页有固定和变体 PDF、屏幕截图及 PDFKit 栅格。20/20 DOM 几何与两个解析器栅格严格相同。
- 仍有全文问题：PDFKit 9/20 页与 DOM 去空白全文不等（包含页脚顺序等，非一律字丢失）；MuPDF 1/20 不等（prototype-01 中“一”未提取）。保留全部全文，既不靠关键词验收，也不把空白归一当搜索成功。fixture 缺失字体仍是显式原始测试条件；未静默添加字体来掩盖。
- PDFKit 字体嵌入与字符框、MuPDF 单词框是自动解析证据；不等于人工拖选、复制顺序合理或选区贴合字形。屏幕与 PDF 的通道差保留，`automaticPassThreshold:null`。原色彩正负控制继续 >4000 且缺色为 0。
- 全部 20 页以原单页夹具方式输出对照，**不是合格整稿 PDF**。没有执行会破坏字体映射的 PDFKit 拼接，也没有引入新拼接库。整稿/混合尺寸交付仍属未完成路线的后续验收，旧 whole PDF 失败证据不变。

## 验收覆盖与边界

`tests/u04-diagnosis.test.ts` 由仓库 build 到 dist 后使用 node --test：A1 对历史 6 PDF 重新运行两解析器；A2/A3 对全部 20 页重新运行 MuPDF、校验尺寸/哈希/严格栅格/色彩；另用当前 Chrome 真实重复导出变换页；A4 约束待决策门及四层状态。测试接受“诊断观测成立”，不接受“PDF 产品质量通过”。

真实桌面/人工 pending：当前工具没有可操作的目标桌面 PDF 阅读器通道。需在 Preview 和独立桌面阅读器打开原 fixtures-01、fixtures-04、cherry-10 与对应 fixed.pdf，搜索上述字符串，拖选中英混排和旋转文字，复制到纯文本并拍摄选区与粘贴结果；逐页看屏幕/PDF 对照。用户已拒收状态 human=reopened，重验尚 pending。不能以无头操作冲销。

脚本首次失败原因仅为本轮 Python 文件名 inspect.py 遮蔽标准库 inspect，已改 mupdf_probe.py；原日志保留。此诊断脚本故障与用户 PDF 体验原因无关。

## 决策

见 ../../DECISIONS.md U04。建议保持未完成并先补目标阅读器操作证据；如果接受独立可选工具方向，也需解决质量问题后再集成。无自动安装、无 window.print 产品动作、无整页图片 PDF 或透明文字层。code=诊断实现通过；automated=见最终门禁；real-browser=pending；human=reopened。

共享工作区门禁同步：本轮执行期间编排器提交 e82116f，记录 U01 三代表页用户签收并把状态改为 signed-off-awaiting-full-deck，原 U01 测试仍硬编码 awaiting-user-decision。保留所有旧断言，改为针对签收前 d51c729 的冻结状态执行；当前状态额外严格验证签收状态、DECISIONS 原话与证据链接。这只同步已记录的裁决，不由 U04 授权全稿或改变 U01 实现。

最终严格尺寸测试另外发现：19/20 PDF MediaBox 与作者 CSS px × 0.75 不精确相等（例如 540px 应为 405pt，实际 404.8800048828125pt）。记录 actualSizePt/pageSizeExact，不以取整或容差把该项变绿。测试保留严格等式并断言这些已观测反例会拒绝质量验收。20 页“栅格一致”仅指固定/变体相互一致，不能理解为与作者页面尺寸严格相等。路线继续不合格。

变换差异进一步量化：旧两变体 MuPDF 栅格最大通道差为 1/255，单词框最大坐标差为 0.000030517578125pt（非严格 0）。因此本轮仅报告未发现可见位移/主要是数值和栅格差异，不宣称原输出字节或几何完全相等。`scripts/u04/compare.py` 可重现对照图与数值。

本轮保留编排器 brief/status/log 脚本原文件，沿用仓库已有做法在本地 .git/info/exclude 按精确文件名排除；未删除、移动或提交调度文件。提交只包含产品修复、测试和本轮证据；不 push。
