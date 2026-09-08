# R03 — 保留作者图片定位

承接 FOLLOWUP.md 的 R03，基线为已完成 R01/R02 实现与证据的 1b4f7c2。本轮不改变 PDF 裁决或用户九页设计方向。

## 实现与验收映射

- `image-direct.ts` 读取浏览器 computed object-position。浏览器先规范化左右上下/单轴关键字、四值边缘偏移、相对长度；仅按括号层级拆分两个轴，不用空格直接拆分计算式。
- 以真实图片内容框尺寸（当前支持无边框、无内边距的图片）和 object-fit 缩放后的固有尺寸之差作为百分比基准，保留 cover 的负差值。px 作为绝对偏移，不再除以 100。
- 将百分比代入有符号剩余空间后，用隔离 Shadow DOM 中的 CSS left 求值，支持 calc/min/max/clamp 的组合。探针在编辑器外层，finally 删除，不写正文、不进入撤销。没有新增通用布局引擎或依赖。
- 不支持的数学/上下文表达式（测试 round）在产生操作预览前显示 object-position 说明；不显示可用手柄、不改变正文和撤销栈。非法作者 CSS 本身的浏览器回退不冒充编辑器解析结果。
- 进入裁切不再调用 cover() 铺满/钳制。未调整时，contain 留白、正偏移、负偏移均原样预览；完成直接退出，正文与撤销记录不变。实际拖动/缩放的原有铺满规则保留。
- 实际移动后保留模型中的原偏移和原图资源。新图片框使用 overflow:clip，防止 overflow:hidden 容器被浏览器滚动定位后改变取景。保存的 JSON、CSS 和重开后的实际几何共同验证。
- 顺带按 CSS object-fit 定义保持 none/scale-down 尺寸计算；本轮核心矩阵覆盖 contain/cover。

## 仓库内断言与证据

`tests/audit-followup-r03.test.ts` 构建到 dist，随 node --test 执行：

- 640×440 源图、300×260 框，contain/cover × 负 px、正 px、百分比、left top、right bottom、right/bottom 边距、calc、min/clamp 共 16 组。
- 每组按独立预期值断言预览 bitmap 的真实 x/y/width/height（误差 <0.05 CSS px）；审计的 -20px 0px 必须为 ox=-20。
- 无操作完成后正文严格相等、撤销深度为 0，阅读态截图字节相等；实际下载 HTML 用 readEnhanced 提取正文严格相等；关闭 headless 浏览器进程后重开再次核对正文与图片像素。
- 真实方向键移动一像素，断言模型偏移与尺寸、原图 src 不变、单次撤销和重做正文严格相等；真实下载与新进程重开后实际 bitmap/框坐标对应。
- 不支持表达式的说明、进入前拒绝、正文/撤销不变均有断言。
- 干净九页稿由未改动 full-deck.html 重新增强；断言离线九页可阅读、图文页仅打开裁切再完成不改正文、下载重开一致，无诊断标题或测试图片。

`verification/` 存命令、返回码、日志、平台、时间及提交；`matrix/` 存实际测量与前/预览/重开截图；必要下载文件及干净交付文件列入 SHA256SUMS。原有 additional-results.json 和 crop-pending.png 作为旧复现对照保留。

## 失败轮次

`verification/first-run/targeted.log`：初版测试误读不存在的 history.undoDepth；改为现有 undoStack.length，不降低预期 0。
`selection-pixels.log`：像素对比受选中态覆盖层/焦点影响，改到真实阅读态比较，保留严格字节等值。
`first-run/full-gate/`：首轮全仓 214 pass / 2 fail / 16 skipped；两项严格截图差异来自 Chromium 缩放重采样，真实边界框相等，对照图 resample-before/after.png 差异 440 像素、最大色阶差 4。尝试 image-rendering:pixelated 后仍失败（pixelated-gate，210 pass / 6 fail / 16 skipped）。最终保留默认图片渲染，测试 DPR=3 保证阅读与编辑态均使用完整源图解码，避免解码降采样缓存变化。保留截图字节完全等值，不加容差，不修改产品渲染规则。
`scroll-frame.log`：实际检测到正偏移框 scrollLeft/scrollTop 导致重开点击后的偏移消失，产品改用 overflow:clip；保留失败记录，重跑全部门禁。

## 四层状态及本地交接

code / automated 以 verification/result.json 的最终回执为准。
real-browser：pending；当前仅有 Chrome headless 自动化，没有目标物理桌面输入和原生文件选择器通道，未执行原生授权、手动/自动原文件写回、退出整个桌面浏览器重开。
human：pending；未收到用户目标设备手感或九页完整稿最终签收，旧拒收不关闭。

本地用干净 HTML 副本完成 FOLLOWUP 第 4 项的原生保存验收；用 matrix 中的定位夹具复查裁切预览、完成、实际调整和重开。保留原图、录屏/截图、写回前后摘要及重开正文。PDF 按 U04 选项 1 保持未完成，不新增服务，不宣称整体通过。
