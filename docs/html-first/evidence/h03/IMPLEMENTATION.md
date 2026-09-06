# H03 — DOM 原生编辑与统一 UI

按 bbcd46bde2c608b5a56e617f316c5dcb5534857e 的 README、PLAN、TASKS 和 REVIEW_DISPOSITION 实施。沿用 H02 SaveController、loopback/FSA 适配；未接入旧 Core、IR、Portable 或 Office。

## 实现与局部选择

- 顶栏保留保存状态与主保存；恢复动作放在“更多”，出现冲突时自动展开。左侧真实内容缩略图使用独立 Shadow DOM 隔离作品 CSS；右侧按文字、图片/视频、SVG/形状、表格切换。空选、多选、混合字号/颜色有明确表达，色板、分组、浮动格式栏共用统一样式。
- 文字原生输入及选区格式进入同一局部历史；composition 事件结束才记录一次。撤销/重做使用稳定 ID、前后局部快照，先验证整批基准再应用，不重建 iframe 或整页。单纯容器样式修改保持子节点身份。
- 命令先在离线副本验证整批操作，再修改活动节点。正文变更只替换目标对象的子树；新增页、表格结构操作在相应容器范围记录。BODY 使用文档解析恢复，避免 template 解析丢失 body 包装。
- 绝对定位对象采用 transform 移动和尺寸/旋转属性；阻止浏览器原生选区拖放接管对象拖动。Grid/Flex 使用 CSS order、gap、grid-template-columns，不把节点改为 absolute。普通文档流无法重排时明确报错。
- Agent 接口为父窗口 `PPTeEditor.hash(id)` 与 `patch(id, expectedSHA256, {text?, style?})`。摘要不含临时 UI 状态；异步摘要返回后重新比较活动快照，拒绝陈旧请求。未知 patch 字段报错。不会接受可执行 HTML。
- `data-ppte-locked="true"` 是持久人工保护约束。命令和原生 beforeinput 均校验；改动含保护节点的祖先整体被拒绝。用户可显式解锁；Agent patch 不含解锁入口。
- 本地图片解码成功才替换；SVG 整体替换经 H01 sanitizer，保留对象根 ID。单个基础 SVG 图元支持填充；复杂插画拒绝一键重涂并提示替换整体，避免静默破坏渐变和构图。
- 编辑器全部 UI、选区和预览隐藏标记均为 transient，序列化后不留痕。基础干净预览和 Escape 返回已接入；H04 的黑屏、闲置、媒体离页、全屏/演讲者/PDF 仍由 H04 验收。

## 测试范围与限制

`tests/html-editor.test.ts` 编译为 `dist/tests/html-editor.test.js`，使用已安装 Chrome channel 的真实 headless 浏览器与 H02 loopback 服务，真实写入临时原文件后关闭/重开；换图使用不同像素和字节的新图片，并核对重开后的完整 data URL。截图及对比度结果不等同于人工盲评或 Safari 复验。

新增 7 个测试，覆盖四项 acceptance，并补充原生键盘输入、拖动、单元格与添加页历史、SVG 拒绝与替换、模拟 composition 事件合并、保护输入及 hash 异步竞态。composition 测试是显式合成事件，不声称本轮做了真实中文输入法或 Safari 的 H03 人工验收。

不承诺任意外部 HTML CSS 都有通用编辑控件；复杂 SVG 可整体替换，基础表格仅单元格和末尾行列增删。Agent 局部接口首版限定文字及可验证样式；整页任意 HTML 重构不在该接口内。历史栈为本次会话内，持久文件保留内容和保护状态。

## 审查承接

- R02：本轮在新运行时核对实际上下文 UI 截图、计算对比度、键盘路径及可见焦点；下列验证记录给出结果。原型文件仍只作为设计参考，不充当运行时证据。
- R01：基础干净预览作为编辑旅程回归；完整放映问题继续留给 H04，不在此关闭。
- R03/R04：H00/H06 的同模型测量、人工盲评及设备证据不变，不用自动化测试代替。
- R05/R06：复用并回归 H01/H02 原文件保存和恢复。H03 不新增 Office、旧 .ppte/CAS/Portable 义务，也不宣称 H05 的发行包剥离已经完成。
