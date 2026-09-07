# F04A：有边界 PDF 路线验证

结论 **③：两条路线均未取得合格结论，F04 保持未完成**。这是验证任务的负向结果，不是 PDF 产品功能完成。未启用导出入口，未改变架构，未新增产品依赖、服务、上传、系统打印兜底或图片 PDF。额外产品能力移除：**无**。B1/B2 与其他历史未关闭项仍由后续任务处理。

## 固定输入和环境

依据 5987af6 的 PLAN / TASKS / PDF-AND-CORE-REVIEW、b93ffed 对应的 `docs/audits/2026-09-07-main-d1db13d/REPORT.md` 和 UI DESIGN。原型来源为 UI_PROTOTYPE.html 的实际三页文稿 DOM 与原始 CSS；没有将 UI 截图当正文，也没有重新设计或删改示例内容。Cherry 为同审查目录的 `sample/source.html` 十页原稿。原文件 SHA、环境冻结于 [freeze.json](freeze.json)，导出前的输入哈希在 [input-hashes.json](input-hashes.json)。

共 20 页：原型 3、Cherry 10、夹具 7。夹具包含中文多行/中英混排/嵌入字体/故意缺失字体、Grid/Flex/表格、SVG（含文本）/透明 PNG/object-fit 裁切/渐变/阴影、640×800 纵向页与 rotate/skew/translate/scale/perspective/rotateY，以及红蓝正样本、缺红和缺蓝负样本。其余尺寸为 960×540、Cherry 1200×675。原有 S07 色彩证据不改写，新控制仍使用红/蓝 >4000 像素门槛。

macOS 25.6.0 arm64，Chrome 152.0.7977.76，Node 22.23.2；headless，offline:true，file://，deviceScaleFactor=1。首个浏览器窗口 1440×960；每页以作者尺寸建立规范视口。所有输入在两条候选间相同。验证适配仅选出当前页、去除原型工作台缩放、设置作者尺寸/无边距/精确颜色；保留作者样式和兄弟结构。脚本不被产品导入。

## 两条候选及实测

| 项目 | 浏览器内 html-to-pdfmake 2.5.32 + pdfmake 0.2.20 | 外部 Chrome Page.pdf |
|---|---|---|
| 20 页输入的 PDF 页数 | **25，失败**；原型首页和 Cherry 1/2/4/5 溢出额外页 | 20 |
| 布局与可见文字 | **失败**；位置、背景、字体及 SVG 等明显不保真，原型首页渲染近空白但仍能提取文字，尤其说明“有关键词≠合格” | 所查看页面视觉接近；未取得人工逐页认可 |
| 完整文字与搜索 | 保留提取文件，但不能抵消视觉失败 | **未合格**：PDFKit 将 fonts 页 `English` 提取为 `En\nlish…g`，搜索 `English 2026` 为 0；Cherry 第10页“统计结论”顺序错乱。中文“甲乙丙丁”正搜索对照成功 |
| 视口/缩放 | 已淘汰，进一步变体验证 pending，未无限改库 | 20页文字一致，19页渲染字节相同；复杂变换页不同，差异分类 pending |
| 累计生成时间 | 2340.77 ms | 2857.31 ms |
| 最慢单页 | 173.54 ms | 189.37 ms |
| 未合并 PDF 总体积 | 287,928 bytes | 2,388,849 bytes |
| 主机 Chrome RSS 采样最大值 | 4,395,188,224 bytes | 4,641,816,576 bytes |

时间包含浏览器候选库/字体注入，排除 PDFKit 检查与合并；不是生产优化后的速度。内存为每100ms采样的**主机所有 Chrome 进程合计**（含其他进程），不是候选独占峰值；各页另存 CDP JSHeapUsedSize 前后值。独占峰值和瞬时原生分配未测，不能据此给产品内存预算放行。[probe.json](probe.json) 保留每页数值、字体、PDF 哈希、搜索结果和无 HTTP 请求记录。

仅测试一个浏览器内候选；将计算样式提供给既有转换器，没有另写布局引擎。其基础 HTML 支持边界来自 [html-to-pdfmake 官方说明](https://github.com/Aymkdn/html-to-pdfmake)。[pdfmake 字体文档](https://pdfmake.github.io/docs/0.1/fonts/custom-fonts-client-side/vfs/) 描述 VFS 字体注册；本次没有假设注册成功即保真。

Chromium **仍使用浏览器 PDF/打印管线**，API 和进程位于页面外。无系统对话框不等于达成用户“不依赖系统打印”的要求。其 screen 媒体与颜色设置依据 [Playwright Page.pdf 文档](https://playwright.dev/docs/api/class-page#page-pdf)。使用现有 Chrome，未安装浏览器或重量环境；未把它接成服务或导出产品动作。

## 字体与依赖成本

- 冻结的 Noto Sans SC 子集 189,808 bytes，原文件 SHA 对应仓库既有 font-1.json 所记的 Google Fonts 源；OFL 和上游链接随输入保存。该 variable font 的内部 PostScript 名为 NotoSansSC-Thin；浏览器实际 regular/bold 与候选映射均如实记录。生成子集使用机器已有 FontTools，仅供验证。
- 原型/Cherry 屏幕实际使用的 PingFang 等系统字体见各页 screen-text.json / platformFonts，**没有替换参考稿字体**。浏览器候选显式将 HTML 字体及粗斜体映射至同一 Noto 子集，PDF 出现 Type0/CIDFontType2 + FontFile2；这已是字体保真失败，不能称自动字体支持完成。
- Chromium 多数资源为 **Type3 + CharProcs + ToUnicode**：带映射的字形程序，不是原字体 TTF/OTF 的常规嵌入。fonts 夹具中的 Times 另有 FontFile2。检查器解析 CoreGraphics 字典与 DescendantFonts，不能用搜索原始 PDF 字符串推断压缩对象里有没有字体。系统字体可访问性、再分发许可和跨设备可移植性未建立，保持未通过。
- F04AMissing 故意不存在：参考浏览器实际退回 Times/PingFang，候选使用 Noto。缺失声明、实际字体均记录；FontFaceSet.check 对不存在的系统字体仍可能返回 true，不能据此宣称字体存在。
- 浏览器候选新增验证文件：24,401 + 1,402,214 bytes（gzip 7,146 + 583,364），另加字体；隔离 npm 依赖目录 `du -sk` 为 28,400 KiB。依赖树与固定 lock 随证据保存。安装输出曾提示 crypto-js、jpeg-exif 废弃，不将这些成本带入产品。
- 外部对照复用现有 Playwright 和 Chrome；Chrome.app 实测 1,442,696 KiB，占用不是新增安装量。独立工具若未来采用，用户需承担 Node/受控浏览器版本、安装更新及安全维护；当前没有取得用户批准，也没有通过质量门。

## 回交物与逐层验收

从 [COMPARE.html](COMPARE.html) 打开逐页屏幕/浏览器候选全部分页/Chromium 渲染对照。每页目录都有两个可打开 PDF、PNG、完整文本提取、逐字符 PDF 坐标、屏幕文本节点坐标、字体资源和搜索记录。额外保留每页 1440×1000 + visual viewport scale 1.5 的 Chromium PDF/PNG。这是 CDP 视觉视口缩放，**不是物理浏览器菜单200%缩放**；后者 pending。像素差异只给原始指标，无“低于某宽松阈值即人工通过”。

整稿 PDF：[原型浏览器](prototype-browser.pdf) / [原型 Chromium](prototype-chromium.pdf)、[Cherry 浏览器](cherry-browser.pdf) / [Cherry Chromium](cherry-chromium.pdf)、[夹具浏览器](fixtures-browser.pdf) / [夹具 Chromium](fixtures-chromium.pdf)。浏览器候选由 PDFKit 拼接测试产物；Chromium 使用同一候选直接导出整稿，以命名 @page 保留不同页尺寸。首次 PDFKit 拼接 Chromium 的 Type3 字体映射丢失，被完整文字断言发现；失败 PDF 另存 `*-chromium-pdfkit-merge-failed.pdf`，不删除断言。直接整稿恢复了提取文字；严格比较仍发现夹具变换页单页 `T ex t` 与整稿 `Text` 空格不同，作为新增失败收录 whole-inspection.json，原型/Cherry 和其余夹具页文字/尺寸一致。变换页即使改变外层视口也未消除差异，因此结束验证，不继续调路线。整稿与单页对照严格核验，生成记录见 [whole-chromium.json](whole-chromium.json)，不构成第三候选。失败页完整清单见 [assessment.json](assessment.json)。

| Acceptance | 仓库 node --test on dist 的真实检查 | real-browser / human |
|---|---|---|
| 最多两候选、同稿逐页对照 | 20页来源/哈希/PDF头/大小校验；PDFKit重新打开每个候选，核对页数、尺寸及完整提取 | pending：headless 仅算 automated；桌面逐页视觉确认未取得 |
| 中文复制/搜索/选区/字体/视觉同时验证 | 逐节点全文比较、中文搜索正样本与英文搜索实际失败、字符坐标、真实 FontFile2 与 Type3资源；不会把提取成功判成路线通过 | [manual-selection.json](manual-selection.json) 40条均 pending：没有人工拖选、复制文本与选区截图；步骤/预期/失败参考齐全 |
| 依赖/file协议/性能/失败夹具 | 锁定依赖与测量记录；新启动已安装Chrome实际file://离线生成夹具PDF；独立解析红蓝正负控制不弱化阈值 | pending：其他物理设备/浏览器、独占内存峰值未测 |
| 外部通过须交回架构取舍 | `decision.mjs` 门测试覆盖①②③，②必须 awaiting-user-decision/HOLD，③禁止进入F04；核对真实报告和任务状态、产品依赖未新增 | 本次③；不存在“仅外部通过”前提，因此没有以②发起架构审批或擅自改变架构 |

代码层指验证工具/夹具已实现，不指 PDF 功能。自动层指探针/回归能正确检查并拒绝失败路线，不指导出质量通过。最终命令、提交、时间和平台见 [verification/result.json](verification/result.json)。

自动查看原型首页候选、字体夹具、Cherry末页及复杂变换参考图确认了上述可见现象；这不是用户人工验收。PDFKit 的提取异常是该独立 macOS 阅读器路径的实证，不能扩大为所有 PDF 阅读器都失败，也不能因 Chrome 视觉接近就忽略。结论③表示当前证据不足以合格，不是数学证明所有库永远不可行。按止损线结束本轮验证，不继续换库或开发 CSS→PDF 引擎。

## 复验

已经冻结的 inputs 可直接使用，不要求重新获取字体或 UI 内容。环境需现有 macOS PDFKit/Swift 和 Chrome；脚本不会自动安装这些环境。

```sh
mkdir -p artifacts/f04a-deps
cp scripts/f04a/candidate-package.json artifacts/f04a-deps/package.json
cp docs/focused-product/evidence/F04A/candidate-package-lock.json artifacts/f04a-deps/package-lock.json
npm ci --prefix artifacts/f04a-deps --ignore-scripts --no-audit --no-fund
swiftc scripts/f04a/inspect.swift -o artifacts/f04a-inspect
F04A_OUT=artifacts/f04a-recheck node scripts/f04a/run.mjs
pnpm typecheck
pnpm build
node --test dist/tests/f04a-pdf-route.test.js
pnpm test
```

run.mjs 默认写本任务证据目录，复验应按例指定新目录，避免覆盖历史产物。summarize.mjs 只在本轮生成报告时使用；freeze.mjs 是已执行的来源提取脚本，其字体缓存路径需用 F04A_FONT_SOURCE 显式提供。没有新增人工确认前，不更新 human 为 passed。

初次类型检查发现 DOM lib 未声明 FontFaceSet 迭代接口，已补明确类型；首次验证测试将浏览器候选的空白溢出页误当正样本，改为要求原有“每页有文字”断言必须抛错且报告记录该失败。产品断言未删改。随后完整文稿检查发现上述拼接问题，保持严格文字/尺寸断言并改用直接整稿产物。变换页的严格相等断言继续拒绝该路线，在验证测试中必须抛错并匹配已记录的精确差异，不用忽略空白放宽整稿合同。失败日志保留在 verification/，最终状态以 result.json 为准。
