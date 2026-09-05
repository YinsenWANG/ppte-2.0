# PPTe 下一阶段完整实施方案

方案版本 1.0 · 2026-09-05 · 状态：设计交付，任务尚未实施

**目标：把现有 PPTe 做成“Agent 能稳定生成、用户能顺手精修、文件能可靠保存、现场能放心放映”的本地演示工具。** 实施顺序是可靠性 → 统一编辑 → 设计质量 → 表格与媒体 → 规模优化。保留 npm CLI + 原生 Skill，沿用语义内核；QuickJS 不进入本轮默认依赖。

本方案基于代码提交 `2005166d3c481b43c559e851b4ad90a53ecfac43`、原 v2.3 方案及本轮深度研究。接口、任务、数值门槛和版本名均为设计，不表示已经实现或测试通过。代码工作区在方案编写前干净。原冻结决策文档保留；下文明确列出的增量决策在相应实现任务中落地。

配套文件：[任务清单](./TASKS.json)、[验收矩阵](./ACCEPTANCE.md)、[阅读入口](./README.md)。任务 ID 用于 PR、测试报告和后续进度追踪；初始状态均为 planned，条件探索为 deferred。

## 01 产品边界与最终交付

优先用户是使用现有 Agent 制作产品介绍、业务汇报、技术讲解和培训材料的人。优先完成两种用途：**现场演讲**和**阅读型汇报**。两者共用内容语义，但在密度、字级、备注、来源标注与页面节奏上分别编排。

完整交付包括：可恢复的 `.ppte` 源项目、可离线使用的浏览器可编辑副本、干净的观众放映、能力明确的 PDF/PPTX，以及从资料到成稿的原生 Skill 流程。用户手动改过的内容和锁定对象，必须在 Agent 局部修改与重新排版后继续保留。

| 用户要完成的事 | 本轮目标 | 明确的范围边界 |
|---|---|---|
| 改文字 | 整框字体字号与段落；选区粗斜体、颜色等；随后扩展选区字体字号 | 不做任意 HTML 富文本和完整 Word 排版 |
| 改形状和图片 | 插入、填充、边框、透明度、缩放、裁剪、替换、吸附、对齐、图层与锁定 | 不做自由钢笔路径和嵌套组坐标体系 |
| 改背景和版式 | 纯色/渐变/图片背景；安全换版式和密度；主题应用范围明确 | 不因换版式删除事实，不隐式缩小字号掩盖溢出 |
| 用表格 | 改值、行列增删、粘贴、尺寸、基础合并、样式与原生 PPTX 表格 | 不做公式计算引擎、筛选分析或电子表格替代品 |
| 用视频 | 本地导入、封面、手动播放、离页暂停、离线资源交付 | 不做视频剪辑；流媒体平台嵌入后置 |
| 做动画和演讲 | 分步揭示、有限入场与翻页效果、黑屏/计时/激光笔/下一页预览 | 不做复杂时间线和任意动作脚本 |
| 让作品好看 | 四套具有不同构图语言的风格，配方参数可执行，整套叙事与视觉检查 | 不以模板数量或模型自评分代替质量 |
| 稳定处理较大文稿 | 实测后增量渲染、缓存、可取消后台任务 | 不预先以更换 JS 引擎作为性能方案 |

复杂表格结构和视频资源管理优先在 Host 完成；浏览器副本覆盖日常文字、形状、图片、背景和表格改值。不同 profile 可以裁剪入口，同一命令必须保持同一含义。旧 `quick-fix`、`light-edit`、`full-portable` 名称继续识别，不默默降权。当前 full-portable 具有额外事务与组合移动能力，并非纯别名，但也不代表完整 Host 功能；界面统一称“浏览器可编辑副本”，详情列出真实支持项。

## 02 分期、发布与执行顺序

采用五个阶段，每阶段有独立可体验成果和发布门禁，不等待全部功能完成后才交付。

| 阶段 | 对用户的实际变化 | 必须交付的任务 | 发布门禁 |
|---|---|---|---|
| M0 可靠基线 | 保存重开可靠；升级副本有效；两个入口放映都干净 | C01–C06 | G0：历史、恢复、交付身份、放映与无 MCP 安装闭环全部通过 |
| M1 日常编辑 | 可以顺手改文字、形状、图片、背景和排版 | E01–E08 | G1：相同命令跨入口一致，完整编辑旅程通过；新增格式有兼容测试 |
| M2 稳定成稿 | 生成稿有清晰设计语言，换布局不丢内容 | D01–D07 | G2：配方可执行、四风格样例过关、锁定保护与人工任务验证 |
| M3 内容与演讲 | 表格真正可编辑，视频真正可播，动画与现场工具可用 | F01–F06 | G3：真实媒体测试、表格原生导出、动画边界及声明的客户端验证 |
| M4 规模与收敛 | 大文稿编辑更稳，交付与兼容证据完整 | P01–P03、Q01–Q02 | G4：固定设备预算、端到端证据和发布包复现 |

X01 QuickJS、X02 实时协作为条件探索，不是 M4 或本轮完成的必要条件。

**第一批执行顺序已经确定：** C01 留存失败样本和基线 → C02 修复可逆操作；C04 的构建身份原型与 C05 放映合同可并行，但 C04 完成须等待 C02 的兼容描述冻结；C03 在 C02 后实现旧历史恢复；C06 汇总为 M0 可安装候选包。E02 文本小实验、D01 风格与参数规格可早做原型，但不跨过 M0 发布门禁。随后 E01 共享控制层 → E03/E04/E05/E06 → E07 双端整合，E08 独立完成选区字体字号的格式扩展。设计编译工作与编辑 UI 可由不同执行者并行推进。

C01 同时前置建立浏览器测量协议和 M1 编辑依赖预算：读取现有各 profile 包体上限，固定参考设备的启动/输入基线，冻结允许的增量开销。E02 必须使用这份带版本预算做选型；M4 的 P01 扩展为大文稿和较低性能实机校准，不把基础依赖预算延后到 M4。

任务清单记录依赖、目标文件、输出、测试和工作量等级。S 为局部变更；M 为跨模块实现；L 为需要先交付小型原型的高风险工作，不把一个 L 任务压成一次不可审查的大提交。没有团队和投入量依据，因此不承诺日历工期。完成 C01、E02、D02 原型后，用实际吞吐重估后续排期；每个阶段都按验收退出，不用日期替代完成标准。

## 03 目标架构与增量决策

架构保留四个方向：输入来自 Agent 或用户；设计编译给出提案；Core 是唯一提交入口；所有渲染与导出从文档派生。

```text
原生 Skill / CLI                Host / Portable 界面
      │                             │
      │                     EditorController（临时状态）
      └────────── Command Planners ──┘
                │  Transaction / PreviewReceipt
                ▼
         Core：Scope、Change Contract、Revision、History
                │  document.json + validated events
        ┌───────┼───────────┬───────────┐
        ▼       ▼           ▼           ▼
      渲染器  资源管理    保存与恢复    HTML / PDF / PPTX

PresentationIR + Brand/Style/Recipe → DesignCompiler → Draft/Transaction
```

CLI 复用纯命令规划函数，不依赖浏览器 Controller 或 React。Controller 复用 Core 的 subscribe、preview、commit、undo、redo；不另造历史栈或持久文档。设计包无需存在于接收者机器上，成稿必须物化为普通语义对象。

| 增量决策 | 本轮确定的做法 | 对原 v2.3 的影响 |
|---|---|---|
| A01 交互统一 | 新建无 React 依赖的 editor-controller；DOM 输入适配单列 | 补交互层，不改 document 唯一真源 |
| A02 可选字段可逆 | JSON 可表达的 unset，与操作协议/profile 一并升级 | 扩操作协议，不改变旧协议解释 |
| A03 细粒度文字 | 先完成现有 marks；Run 字体字号以显式新能力加入 | 有意扩展 Text v1 排除项，不能作为旧 profile 偷渡字段 |
| A04 设计包 | 包装并扩展现有 RecipeSpec、ThemeDefinition、PresentationIR | 不建第二套 DeckPlan 或任意 HTML 源文件 |
| A05 表格 | core/table v2，稳定行列单元格 ID 和 typed 操作 | 保留顶层 component，不先扩大 Element 联合类型 |
| A06 媒体 | CAS 资源引用 + 可控播放器生命周期 | 禁止文档自带可执行脚本；媒体与静态回退分别声明 |
| A07 运行时 | 原生 JS；增量更新优先；可信重计算再考虑 Worker | QuickJS、守护进程、MCP stdio 均非默认前提 |

新增包控制为三个：`packages/editor-controller`、`packages/editor-dom`、`packages/design-system`。其中 design-system 首期只负责资源包格式与校验，可先以 design-compiler 子目录原型验证再拆包。命令、布局、媒体工具优先扩展现有包。不得复制 Core、导出器或整套 Host 到另一目录形成第二实现。

## 04 M0：保存、历史、恢复与交付身份

### 4.1 可逆操作协议

复现缺陷：原本无背景的 slide 通过 slide.update 设置背景，逆 patch 中 undefined 经 JSON 丢失，保存重开后 HISTORY_RESTORE_FAILED。修复必须覆盖所有可选字段和所有持久化边界，不只背景按钮。

`slide.update` 新协议支持受白名单约束的 `patch` 和 `unset`。示意结构如下，正式 TypeScript 联合类型与 JSON 校验必须同步生成或测试一致：

```ts
type SlideOptionalKey = /* 明确可修改的可选 slide 字段白名单 */ string;
type SlideUpdateV11 = {
  kind: 'slide.update'; slideId: string; opId: string;
  patch: Partial<AllowedSlidePatch>;
  unset?: SlideOptionalKey[];
};
```

规则：patch 代表设置完整字段值，unset 代表删除字段；同一字段不能同时出现。不能 unset 必填字段、id、elements、rootOrder，不能借任意路径修改对象结构。null 仍是值，不充当删除标记。对每个旧字段用 hasOwnProperty 区分“缺失”和“有值”；生成的 inverse 也使用 patch/unset。nested style 的缺失恢复、空集合与字段缺失分别审计，已有专用 unset 操作继续复用。

必须验证 `D → T → JSON 序列化 → inverse(T) → D` 的 canonical 内容相等，并验证保存前后 undo/redo 行为相同。新增提交前的 inverse proof：preview 对序列化后的 inverse 验证能恢复 beforeRevision；proof 绑定事务摘要、beforeRevision、afterRevision、serialized inverse 摘要及兼容解释器版本，由 Core 内部保存，不仅信任调用方 receipt。commit 仅消费匹配证明；没有有效证明就重新验证。失败返回 `INVERSE_ROUNDTRIP_FAILED`，不写 journal、不更新文档或历史。证明成本进入性能测量，不能只在开发模式断言。允许只读 preview 事件和临时 proof cache；持久状态、history、journal 和 committed 事件仅在成功提交后变化。

### 4.2 协议与格式兼容

旧 profile 与旧 1.0 操作解释冻结。提出新的操作协议 `1.1` 和兼容 profile `ppte-2.0-edit.1`，首期文档 schema 仍为 2.0.0、容器仍为 2。带新操作的 history 或 patch 也要求新 profile，即使当前文档内容本身只用了旧字段。兼容推断输入必须扩为 document + undo 及其 inverse + redo + patch，而不是仅看当前页面对象。

新 profile 的完整设计 descriptor：formatVersion=2、schemaVersion=2.0.0、operationProtocolVersion=1.1、slideIrVersion=1.0、portableRuntimeVersion=2.1.0（协议描述版本，非 npm 应用版本）、layoutRecipeVersion=1.0、widgetAbiVersion=1.0、patchVersion=1、runtimeSubset=ga-c。patch 容器结构不变，但 manifest 明确所需操作协议/profile。新 reader 支持已登记 GA-A/B/C 的旧能力集合；迁移映射逐项登记并保留原件。最低 profile 通过能力集合包含关系选择，不按字符串、命名或简单数字大小排序。C02 同步修改 validation 的操作 kind/字段校验。E08/F01 使用新格式时，必须先追加完整 descriptor 与对应测试，不能只添加一个名字。

Run 字体字号和表格 typed 操作分别在 E08/F01 中登记新 capability 及所需协议/profile；Run 新字段拟进入 schema 2.1.0，历史格式是否变化由实际 envelope 改动决定，不无理由抬高所有版本。所有字面量类型、file-format 校验、compatibility 映射、patch codec、CLI schema、Portable 开启和保存入口必须一起更新。未知 profile 不自动迁移为已知版本；新读者仅对已登记的来源执行明确迁移。旧读取器无法识别新能力时拒绝编辑，保留文件和可用的只读预览；不能承诺任意旧读取器都能渲染新文件。

迁移生成新文件及 MigrationReport，至少包含原文件摘要、输入/输出 profile、迁移步骤、保留的内容与身份、历史状态和降级项。新旧文件都保留。不允许为了让旧程序打开，把新历史或格式字段静默剥掉；有损兼容输出必须显式选择并附报告。

### 4.3 损坏历史的保守恢复

将“文档快照是否有效”和“历史是否可恢复”分开检测。常规打开仍严格校验；新增恢复入口返回结构化诊断，不直接把异常转为空 history。

| 情况 | 处理方式 | 可对用户声称的结果 |
|---|---|---|
| 文档和历史都有效 | 原样打开，正常继续编辑 | 项目和历史已恢复 |
| 快照有效，历史失败 | 保留原始 bytes 和错误；可只读查看；用户选择后另存新恢复项目 | 当前内容已保留，历史未恢复 |
| 当前 head 向前存在连续可验证的历史后缀 | 逐条 inverse 后再 forward 验证，首个失败处停止；另存时显式选择保留有限历史 | 仅所列最早 revision 之后的历史可用 |
| 有经过 hash/revision 验证的前置 checkpoint 和完整 forward 链 | 在隔离会话重放，逐步检查 revision，再写新文件 | 只报告实际验证通过的历史范围 |
| 无前置基准，inverse 已丢失信息 | 不猜测旧值，不把现在的快照当历史起点 | 无法可靠恢复该历史段 |
| 快照/资源本身不完整 | M0 仅输出只读诊断与可验证资源，不自动删对象拼成可编辑项目 | 内容不完整，不能报告完整恢复 |

只要快照完整，恢复副本保留 documentId、对象身份和当前 canonical 内容；另存的外部 RecoveryReport 记录 sourceRevision、sourceFileDigest、恢复范围及未恢复诊断。选择重新开始历史时以当前快照为起点，不伪造更早的共同基线；sidecar 使用新文件命名空间。浏览器恢复存储也必须从单一 KEY 改为 recoverySessionId 命名空间：先保全原 tail/base/资源引用，再切换新恢复会话，失败不能覆盖旧入口；只改文件名不够。原文件、诊断和恢复副本分开保存。恢复操作是可审阅的另存，不修改原件。容器/资源完整性失败的数据不作为可信自动重建输入。历史 validator 放在 Core 侧供上层编排复用，避免 file-format 反向依赖整个 Core；CLI 与 Host 共享诊断逻辑。浏览器无法写原路径时提供下载诊断与副本。

保存状态固定为：内存有改动、本机恢复记录已更新、文件已写出/副本已下载、保存失败。写盘成功才显示“已保存”；下载触发只显示“已下载副本”，不能声称已覆盖原文件。保存前 flush 输入，保存失败保留草稿和未写出的 revision。

### 4.4 衍生文件身份

新增 ArtifactIdentity v1，由以下字段 canonical hash 得到 identityDigest：documentId、sourceRevision、documentDigest、historyPayloadDigest、runtimeBuildId、rendererBuildId、shellDigest、fontManifestDigest、fontPolicyVersion、assetManifestDigest、portableProfile、compatibilityDescriptorDigest、capabilityManifestVersion、capabilitiesDigest、exportOptionsDigest。相同 head 可能拥有不同 undo/redo，因此 history 摘要不可省略。runtimeBuildId 由实际打包内容产生，不能只写应用 semver；shellDigest 包含受控 HTML/CSS/CSP，规范化时排除 identity 字段自身和生成时间以避免循环。资源 manifest 包含每份实际 bytes 的摘要；字体摘要记录声明及嵌入字节，不假定另一台机器的系统字体相同；不把时间戳放进可复用身份。

交付复用条件：身份全部相同、现有文件可解析、文件内部语义内容和交付记录匹配、没有未合并的接收者修改。实际脚本、外壳、资源与 history 均要重新算摘要，不能只信任内嵌 metadata；这是缓存与完整性验证，不是发行者数字签名。旧 HTML 没有新身份视为 unknown，不直接认定可复用。

新增 `collisionPolicy: error | versioned-copy | replace`：旧 API 省略参数继续保持 error；新 CLI/产品流程显式传 versioned-copy。旧 replaceExisting=true 映射 replace 并继续要求 confirmed；新旧参数冲突直接报错，不以隐含优先级覆盖。versioned-copy 在同目录使用短 identityDigest，命名规则经过路径白名单校验；目标已存在且不同则延长摘要或加唯一后缀，原子创建，绝不覆盖。replace 明确授权后原子替换，并保留可恢复的旧版本。检测不到的浏览器内存或本机草稿不可能由磁盘判断，因此新产品流程优先新副本；对旧 no-clobber 调用返回 stale/target-exists，不能返回旧 HTML 成功。

应用版本改为单一配置来源，staging 从根 package.json 读取；当前根 0.6.0 和暂存 npm 0.8.0 的不一致必须消除。先盘点实际已发布/已安装版本再确定下一 release semver，不把文档版本、私有子包版本或 profile 当应用版本。CLI `--version`、HTML 关于信息、构建 manifest、Skill 要求和验收报告可追溯到同一构建。

## 05 M0–M1：共享模式与编辑控制层

### 5.1 模式合同

临时模式为 browse、edit、present、presenter、print。模式、当前页、放映步骤、选择、焦点、缩放、媒体播放位置都不写入文档 revision。Host 打开可编辑项目默认 edit；新交付副本默认 browse，提供醒目的“编辑”和“放映”；viewer profile 没有编辑入口。开始放映不依赖成功全屏。Portable API 新增 enterEdit()/queryCapabilities() 并声明 API 版本；旧 editText/commit 方法签名保留，但在新副本中调用方必须先进入 edit。旧已生成 HTML 行为不被远程改变，新版示例、Skill 和自动化一并迁移，不能同时承诺旧的加载即编辑默认行为。

| 模式 | 文本/对象修改 | 编辑装饰与菜单 | 步骤与媒体 | 退出行为 |
|---|---|---|---|---|
| browse | 禁止；显式进入 edit 后启用 | 无文本框边线；有简洁导航 | 显示全部对象；视频用户点击播放 | 进入编辑保留页码 |
| edit | 受 capability/锁定/范围控制 | 仅选中或悬停显示必要反馈 | 默认显示所有对象；动画预览是临时状态 | 未提交输入先收口 |
| present | 禁止，包括快捷键与程序化编辑入口 | 隐藏编辑 UI；退出控件悬停/聚焦出现 | 按步骤显示；媒体点击不翻页 | Esc 恢复原模式、页码及可用焦点 |
| presenter | 禁止编辑当前成稿 | 演讲者专用控件 | 备注、计时、下一页预览 | 关闭观众窗不丢主会话 |
| print | 禁止 | 不生成编辑装饰 | 全内容静态、视频封面 | 渲染作业完成后释放资源 |

进入放映顺序：请求收口输入 → 校验/提交成功 → 取消其余暂态交互 → 保存恢复焦点 → 进入 present → 尝试全屏。提交失败保留输入，不切换模式；中文 composition 期间延后到 compositionend，不强行截断输入法。Fullscreen 拒绝只改变全屏标记，不退回可编辑模式；只退出本控制器拥有的全屏对象。请求带 modeEpoch，迟到的全屏事件不得覆盖较新的退出请求。

事件守卫覆盖 pointer、paste、beforeinput、composition、快捷键、拖入、API commit/undo/redo。UI 隐藏并不等于禁止修改。播放视频、点击链接、使用退出控件应消费对应事件；空白画布单击是否翻步由放映设置控制，默认键盘与明确导航优先。

### 5.2 Controller 设计

下面是目标接口草案，实装沿用现有 Core 类型，不要求名称逐字固定：

```ts
interface EditorController {
  getState(): EditorState;
  subscribe(listener: (event: EditorEvent) => void): () => void;
  can(command: EditorCommand): CapabilityDecision;
  preview(command: EditorCommand): Promise<CommandPreview>;
  execute(command: EditorCommand): Promise<CommandResult>;
  flush(reason: 'blur'|'save'|'present'|'switch-slide'|'undo'): Promise<FlushResult>;
  cancelTransient(reason: string): void;
  dispose(): void;
}
```

`EditorState` 包含 mode、activeSlideId、selection、focusTarget、textDraft、pointerDraft、saveState；不包含第二份持久文档。`CommandResult` 区分 committed / no-op / blocked / conflict / cancelled，附 revision、transactionId、issues。preview receipt 绑定 baseRevision、目标、规范化命令及事务摘要；execute 重新验证，不接受过期 receipt。

命令分两类：UI 命令只改变临时状态；内容命令经纯 planner 生成 Transaction。所有改变内容/模式/保存边界的命令进入单一队列；同一 draft epoch 的 in-flight flush 复用 Promise，成功只提交并清理一次。耗时资源准备可在队列外执行，返回后带 revision/hash 重新规划。composition 期间不执行文档撤销；flush blocked/conflict/failed 时不继续 undo、换页、保存或切模式。所有内容命令复用 scope/contract、锁定及事实保护；混合多选有不允许的对象时默认整组拒绝并列出对象，不静默只改其中一部分。只有用户显式选择“仅修改可编辑对象”才形成新的目标范围。

Core 提交事件的 diff 用来计算 dirtySlides、dirtyElements、changedResources 和 selectionInvalidation；这是派生索引，可重建，不能写回成为第二真源。无法精确归类时保守失效，不漏更新。Controller 释放订阅、对象 URL、观察器和未完成任务。

### 5.3 渐进迁移

C05 先抽出最小共享模式/步骤逻辑并修两端行为；E01 扩成 Controller。按放映 → 文本 → 指针交互 → 属性 → 保存的顺序逐项迁移，每迁移一个命令就删除旧实现入口或转为薄适配，禁止长期双写。Host 的 React state 订阅 Controller；Portable 的 DOM shell 订阅同一事件。现有 interaction.ts 和 richtext-adapter 可迁移复用，不先重写。

## 06 M1：文字、对象与编辑界面

### 6.1 文字选择和输入

选择模型使用 paragraphId、runId、offset 和 affinity。offset 明确使用 JavaScript UTF-16 编码单元，落点必须在完整 grapheme 边界，不能切断代理对、组合字符或 emoji；DOM Selection 与语义选区双向映射，拒绝旧 DOM/revision 的位置。模型已有 paragraph/run ID，沿用并规范拆分、合并规则：未变 run 保留 ID，拆分新 run 分配新 ID；引用主目标仍是 element/semanticKey，不能把临时选区 ID 误用作跨版本事实身份。

文本命令首先覆盖 selectRange、setMarks、clearMarks、setParagraphStyle、setBoxTextStyle。选区格式通过纯 RichText 变换生成 `text.replaceContent`，不直接把 DOM innerHTML 写回文档。混合样式显示 mixed；折叠选区仅设置后续输入 marks，整框字号与选区字号在 UI 明确显示作用范围。输入先进入 draft，校验提交失败保留 draft、选区和错误；不得先删 draft 再尝试 commit。

撤销只有 Core 持久历史。连续输入按同一文本框、相同格式和短输入间隔聚合为可配置 burst；默认原型从 750ms 空闲边界开始校准。composition 不在中途提交；compositionend 后的重复 input 通过 epoch/hash 去重；IME 候选阶段不截获其确认、Esc 和方向键。选区格式、粘贴、跨框、保存和开始放映切断 burst。按撤销时先收口 pending draft，再调用 Core.undo；不同时启用浏览器、富文本库和 Core 三套撤销。库内 history 插件关闭。未确认的 pointer/crop preview 按 Esc 直接取消，不增加历史。

编辑草稿记录 baseRevision 和目标 contentHash。期间仅无关对象变化时，可确认目标 hash 未变后重新规划并预览；目标文字改变则保留草稿进入冲突状态，不无条件覆盖。活动输入 DOM 不得因其他对象重渲染被替换；这一正确性要求在 E03 实现，不能等 M4 的性能优化才补。

E02 用原生适配与 ProseMirror 适配各做同样的小型用例。若现有适配在中文输入、跨段选区、格式粘贴及撤销上可以满足验收，继续使用；若成熟内核明显减少正确性缺口且通过包体/启动预算，则仅激活文本框使用 ProseMirror，Tiptap 仅在其封装减少维护成本且无强制云功能时采用。输出 ADR 包括包体、集成成本与所有失败用例，不用生态流行度决定依赖。

E08 单独增加 Run 字体字号：缺省继承 TextStyle，Run override 优先；清除格式删除 override 恢复继承。使用同一 font resolver、coverage 检查和测量路径；更新 HTML/SVG/PPTX 映射、布局、能力报告与新 profile。旧文件打开不改版式，只有首次使用新字段才升级所需能力。以显式有损输出兼容旧格式时报告被统一的 Run 属性；禁止悄悄丢失。

### 6.2 对象操作与 UI

编辑器使用统一的界面语言：顶部是文件状态、插入、撤销/重做、放映和导出；左侧是页面缩略图；中间是固定比例画布；右侧是当前目标属性。Portable 按空间把右侧改为可折叠面板。常用命令同时有图标、可访问名称和快捷键提示；不以密集图标墙承载全部功能。

| 选择目标 | 第一层属性 | 次级属性 |
|---|---|---|
| 文本 | 字体、字号、粗斜体、颜色、对齐 | 行距、段距、内边距、框背景与边框 |
| 形状 | 类型、填充、描边、透明度 | 圆角、阴影、尺寸位置、旋转 |
| 图片 | 替换、适应/填充、裁剪 | 比例、焦点、alt、来源/许可 |
| 页面 | 背景、版式、备注、过渡 | 主题应用范围、阅读顺序 |
| 多选 | 对齐、分布、组合、图层、锁定 | 共同属性与 mixed 状态 |

明确交互规则：单击选对象，双击文字进入输入；拖框多选，Shift 增减；缩放默认保持图片比例，显式解锁比例后允许变形；对齐分布基于选择包围盒或画布，两种范围可见。现有 group 仍扁平，组内锁定成员不能被整体变换绕过。

拖动、缩放、旋转和裁剪全过程为 transient preview；pointerup 产生一笔事务；pointercancel、lostcapture、Esc 回到起点。零位移不提交。吸附在画布逻辑坐标计算，阈值按屏幕像素换算，缩放后手感一致。首版只吸附安全区、画布中心、其他可见对象边线/中心；禁止因吸附改写非目标对象。键盘方向键细移与 Shift 大步移使用相同 planner，可按连续按键聚合。

图片导入共用资源管线：文件/拖入/粘贴 → 类型与尺寸校验 → CAS hash 去重 → 预览 → 资源与对象原子提交。撤销可从当前文档移除资源引用，但物理 bytes 的保留集合必须包含当前文档、undo/redo、恢复日志、未决草稿与作业；仅全部无引用才物理回收。checkpoint 保存也要包含重做需要的资源，验证“插图→撤销→保存重开→重做”仍完整。读取、解码或配额失败均不产生半个对象。替换保留 elementId、semanticKey、指定 frame 和裁剪策略，明确重新裁剪的选择。

背景支持设置和恢复主题背景，后者用可靠 unset；图片背景的资源引用参与 CAS 和导出；应用到全部页由明确 document scope 事务完成。边框和渐变只支持 schema/renderer/exporter 共同声明的子集，未支持的参数不出现可点击入口。

## 07 M2：品牌、风格与配方的数据设计

复用现有 PresentationIR/SlideIR/RecipeSpec/ThemeDefinition。以下是设计资产层的包装和版本化扩展，不是另一份成稿数据库。

| 对象 | 必需字段 | 持久位置与作用 |
|---|---|---|
| BrandSpec v1 | id/version、品牌色映射、font roles、logo asset refs、品牌安全区、授权/来源、禁用规则 | 本地设计资产；编译为 ThemeDefinition 和普通资源；成稿不依赖外部品牌包 |
| StylePack v1 | id/version、设计说明、适用/不适用、密度、type scale、spacing、图像/线条/图表规则、recipe refs、预览、许可 | 可检索资源包；主题值与配方版本固定，包有 digest |
| RecipeManifest v1 | recipe ref、purpose、slotRefs、controls、capacity、capabilities、structuralFingerprint、sample refs | 包装 RecipeSpec；槽位定义只在 RecipeSpec，检索摘要由工具生成并校验 digest |
| DesignPlan v1 | PresentationIR、brand/style refs、用途、seed、每页 recipe selection 与理由、内容预算、保护规则 | 编译输入/审阅记录；成稿仍是 document.json |
| DesignBinding v1 | recipeId/version/digest、sourceBlock→element 映射、已应用参数、手动覆盖字段、锁定信息摘要 | 成稿的版本化生成元数据/扩展；不能存第二份正文；缺失不影响打开编辑 |

DesignBinding 中保护摘要仅供重排解释；权威状态来自对象 locked/editPolicy 及页面 protectedAnchors，执行重新查 Core。SlideIR.protectedContent 是本次请求的附加保护，不能替代既有规则。内容发生手动修改后，重新设计从当前文档提取语义值，不拿旧 IR 覆盖当前文稿。绑定失效的对象退出自动重排或要求重新建立绑定，不猜测身份。

参数例：columns 是整数枚举 1/2/3，captionDensity 是枚举，imageSide 为 left/right。控件描述含 label、type、default、min/max/options、applicability 和影响范围。禁止任意脚本、CSS 字符串或任意 JSON path。改变 columns 只改变已存在内容的安置；容量不足返回 `RECIPE_CAPACITY_EXCEEDED` 并附换配方/拆页提案，不能截断数组。拆页需要允许 insert-slide 的 scope，不自行扩大权限。

建议资源结构：

```text
design-packs/<style-id>/
  manifest.json       品牌兼容、风格规则、许可、版本
  theme.json          对接现有 ThemeDefinition
  recipes/*.json      RecipeSpec + manifest 扩展
  previews/*         使用固定真实材料的代表页
  fixtures/*.json     正常、边界、超容量输入
  design.md          Agent 所需设计理由与禁用场景
```

### 7.1 先让参数真正执行

现有 variants 有声明，编译执行未完整接入；baseline/keep-together 等约束也需逐项核对实现，qualityRules 的不同类型必须全部兑现。D02 建立“声明 → 校验 → 执行 → 测试”登记表，未实现约束明确拒绝，不可静默忽略。槽位分配必须满足 required/min/max 和配对关系，不能以 first-fit 或统一最多三列规则冒充所有构图。需要新的 repeat/装饰/布局组合时，只允许有界声明式语法并显式升级 RecipeSpec 版本；按内容 block key 生成身份，不按数组位置。配方以编译器和主呈现能力为基础，对每个交付目标分别声明 native/static/rasterized/fallback/unsupported；用户指定必需目标时筛除不能满足该目标合同的候选，不用所有出口的最小交集限制所有设计。

编译过程固定为：校验 IR → 解析品牌/主题 → 过滤能力与容量 → 应用已选 variant → 槽位分配 → 约束求解 → 文本实际测量 → 安全/阅读顺序检查 → 生成 draft → diff 与 contract 校验。maxChars 只作预筛，最终容量依据字体就绪后的排版框测量；keep-together 可能令候选不可行，不能强行塞入。求解限制配方数量、递归深度、迭代次数和总元素数，避免声明式输入造成无限计算。

CLI 基础 compile 仍可在没有浏览器的环境运行确定性语义校验和保守度量，报告 `visualStatus: unverified`。正式视觉校验另用按需浏览器或 Agent 已有浏览器，等待指定字体及资源就绪。D03 工具可以诚实返回 unverified，但 D04 成熟覆盖格和 D07/G2 不能以 unverified 通过：正常/边界样例必须有本构建、fixture、字体摘要与真实截图；超载样例证明拒绝或提案。字体/资源超时使该次验证失败，允许的 fallback 需以另一份明确配置重新验证。浏览器可选不等于视觉门禁可以伪造。

### 7.2 整套编排与风格首批覆盖

整套选择先满足硬约束，再按语义适配、密度、素材、相邻结构和章节节奏排序。首版每页保留有限候选，采用有界 beam search 或等价确定性选择；初始上限每页 6 个候选、beam 8，作为可配置预算经 D03 性能测试校准。相同 seed、字体指纹、材料及包 digest 应得到相同选择。不要为了避免重复把合适的连续数据页强行改成海报。

| 风格 | 设计语言 | 首批必须覆盖的八类角色 |
|---|---|---|
| 商务信息 | 克制色彩、清晰表格与关系、结论优先 | 封面、章节、观点、指标、图文、对比、流程、结尾 |
| 瑞士分析 | 网格、强字级、数字与留白、有限强调色 | 同上，指标/对比以分析阅读为中心 |
| 杂志叙事 | 图文张力、章节节奏、摄影与引语 | 同上，图文/观点强调故事推进 |
| 产品发布 | 主视觉、特性层级、场景与证据 | 同上，流程/对比体现使用价值 |

这是 32 个“风格 × 角色”可验收覆盖格，允许复用底层配方，不要求维护 32 份重复模板。图表、表格、长内容作为每套压力页补测；M2 表格只验现有支持能力的显示、语义保留和既有出口，不提前要求 M3 Table v2 编辑或原生导出。首版风格不全是换颜色：至少在字级、空间结构、图像处理和页间节奏上存在可解释差异。

度量以画布 du 和比例为主。采用一套标准画布样例，并测试既有不同画布尺寸；不要把示例像素值写成全产品固定规则。初始现场演讲正文字级建议不低于画布高度的 2.2%，阅读型不低于 1.6%，来源等次级信息独立规则；这些是质量预警起点，由代表页评审校准，不是自动判定内容应该删减的依据。

### 7.3 Skill 的可执行流程

新增 CLI 命令族的目标形态为 `ppte design list/inspect/plan/preview/apply/validate`，由 E/D 任务登记到 CLI help/schema；这些命令当前尚不存在。保留已有 compile、preview、commit、deliver 流程兼容。Skill 的输入输出顺序固定为：

1. 从用户材料提取受众、用途、事实/来源、内容目标和可用素材；没有材料依据的数字不可补写成事实。
2. 读取轻量 style index，检索少量候选，再读取选中的 design.md 和配方；不一次载入全库。
3. 形成 DesignPlan，用真实封面、正文、复杂数据三类代表页验证；用户已要求直接做时自动选择继续，不新增强制风格确认。
4. 批量编译，校验全部内容已安置；生成 proposed transactions，由相同 preview/commit 机制写入。
5. 渲染检查后最多两轮自动局部修复，每轮记录修改对象、原因和硬约束结果；仍不通过时明确列出未完成项，保存可审查产物，不无限重写。
6. 人工修订后再设计只取请求范围，保留锁定、事实、语义 ID 和显式覆盖；重新绑定或扩大范围必须有依据。
7. 输出 `.ppte`、可编辑副本和与构建身份绑定的报告；未实际执行视觉或 Office 检查的项目写 unverified。

许可策略延续研究结论：独立实现参数化、布局选择、渐进检索与评审机制；不复制 Dashi 专有导出子包。采用可复用 MIT 代码或素材时固定版本并保留 notices；AGPL 代码不混入默认 Apache-2.0 产品实现。品牌、字体、照片分别记录许可，不能只依赖仓库根许可。

## 08 M3：表格、视频、动画与演讲工具

### 8.1 core/table v2

保持 ComponentElement，props 内使用 versioned TableModel：rowOrder、columnOrder、rows、columns、cells、merges、tableStyle。每个 row/column/cell 都有稳定 ID；cell 含 typed value（string/number/boolean/null）、displayFormat、richText 可选、style、fact/source refs。typed value 是数据真值，richText 仅适用于文本单元格，不同时存储相互冲突的数字真值和正文副本。合并记录锚 cellId 与矩形 row/column ID 范围；被覆盖格的数据仍保留，拆分可恢复。

typed 命令为 setCellValue、insert/delete/moveRows、insert/delete/moveColumns、resizeRows/Columns、mergeCells、splitCell、setCellStyle。UI/Agent 共享 planner，Core 增加经过校验的 `table.*` 操作及 inverse，仍落在组件 props。禁止通过泛化 component.updateProps 绕过行列一致性、合并与引用不变量；同样的 validator 应用于所有组件更新入口。

v1 二维数组显式迁移：补齐矩形行列，生成确定性 ID，保留表头、caption、原 scalar 类型与元素 ID，产生迁移报告。空表、非矩形数据、长数字、TSV 粘贴、中文换行、合并边界都要覆盖。结构删除若会删掉被引用的事实单元格，拒绝或要求审阅影响；事实同步不能把位置变化误当新事实。

首版合并只允许完整矩形、不跨已有合并、不丢被覆盖数据；包含不同非空值时显示合并后的展示规则，值保留可撤销。超过容量建议分页或缩减展示范围，但由用户/Agent 显式确认内容处理。语义 PPTX 使用原生 table 结构；只有通过实际导出对象验证才标 nativeTable。特殊样式可降级但必须列明。

### 8.2 媒体与离线交付

core/video v2 使用 assetId，资源 metadata 包含 MIME、byteLength、digest、width/height、durationMs、posterAssetId 与可选的 codec 检测信息。现有 source 字符串在本地导入时解析为资源，未知路径或缺文件维持封面并报告 missing-source，不进行任意网络抓取。

Renderer 生成受控容器，MediaController 从已验证 CAS bytes 建立 Blob URL 并绑定 src；组件 renderHtml 不读取磁盘或执行任意脚本。CSP 仅按交付模式允许必要的 blob/data 媒体和受控同源资源，不扩大脚本权限。loadedmetadata 后校验实际尺寸与时长；play 的 Promise 失败可见；离页暂停，返回默认从原位置继续；结束/关闭释放 URL 与缓冲引用。导出采用指定 poster frame，测试音频/视频是否停止占用资源。

交付采用两级：预算内使用单 HTML；超过当前标准目标时提供显式允许的大 HTML，或经过验证的离线目录包。目录包至少包含可打开的 index.html、manifest.json、media/ 文件及可选 `.ppte` 源包，manifest 将 assetId 映射到受控相对路径与 byte digest；打包时验证所有字节。单 HTML 打开时可校验内嵌 CAS 再建立 Blob URL；file:// 目录无法读取字节时仅声明“打包时完整性已校验、打开时未复验”，不得伪称打开时 CAS 校验。不能在该路径启动未验证的计算/脚本资源。

先保留已有 20 MiB 标准目标，F04 根据样例决定新阈值，不默默放大默认体积。离线目录相对媒体播放必须实测；需要 fetch/CORS 的实现不得伪称双击可用。若目录无法满足目标合同，就不作为支持交付路径，保留经验证的大 HTML 或 Host 打开方式。

默认用户手动播放，不自动播放有声视频。PDF、PNG、图片 PPTX 使用封面；首版语义 PPTX 同样允许有报告的封面降级，PPTX 媒体嵌入作为 F04 的后续子项，只在目标客户端实测通过后开启。不能为了完成“视频支持”隐藏导出边界。

### 8.3 动画语义与现场工具

放映状态使用 slideId + step，索引只作派生，避免页面重排使演讲者同步错页。step=0 是页面的基础状态；正 appearStep 升序揭示。定义四个独立命令：

- nextStep：揭示下一步；已到末步则进入下一页 step=0。
- previousStep：撤回当前页最近一步，包括 step=1 回到 0；在 step=0 时转上一页的最后一步。
- nextSlide：跳下一页 step=0；previousSlide：跳上一页 step=0。
- gotoSlide：显式指定页面，默认 step=0。首末边界均不越界、不循环。

首版对象动画实现 fade、slide-up、slide-left，翻页实现 none、fade、slide/push 的已声明方向；duration/delay 有上下界。未实现 scale/exit 等既有字段保留但报告 static/unsupported，不用“动画支持”概括全部枚举。减少动态效果时瞬时切换到同一终态，语义步骤仍正确；打印显示全部可见内容。

现场工具先做页索引、黑屏、激光笔、计时和下一页预览。黑屏是临时视觉状态，不改变 step；激光笔不写入文档。双屏为 F06 后段，使用版本化消息、session token、seq/ACK 和发送方窗口校验。file:// 可能为 opaque origin，必须验证 event.source 与会话随机 token，不能只校验 origin 字符串；无法可靠隔离时关闭双屏保持单屏可用。弹窗失败、断连、重连、重复/乱序消息和观众屏关闭有明确反馈；备注不发到观众 DOM。

## 09 能力矩阵与交付合同

能力报告拆为两个维度：操作是否允许（supported/read-only/blocked + 原因），呈现/导出如何实现（native/static/rasterized/fallback/unverified）。不要以“按钮存在”或 widget exportPolicy=native 推断实际支持。报告粒度为目标、对象、属性/命令，聚合结果仍保留原因。

| 内容/能力 | Host 编辑 | Portable 日常编辑 | HTML 放映 | PDF | 语义 PPTX |
|---|---|---|---|---|---|
| 文本、形状、图片、背景 | 本轮完整常用子集 | 相同基础命令，profile 可裁剪 | 正常显示 | 静态视觉 | 原生受支持对象；字体风险报告 |
| 表格 v2 | 单元格与结构 | 首批改值/基础样式 | 正常显示 | 静态视觉 | 原生表格及允许样式 |
| 视频 | 资源和封面管理 | 播放/封面；资源管理可只读 | 受支持素材真实播放 | 封面 | 首批封面降级；嵌入另验 |
| 步骤与动画 | 配置/预览 | 基础配置按 profile | 声明子集播放 | 全内容静态 | 首批静态终态，动画导出后置 |
| 自定义组件 | 受控注册实现 | 已登记安全参数 | 运行时支持或回退 | 回退 | 依 adapter；未验证不能标原生 |

Native、nativeTable、nativeChart 等标记必须以实际 exporter adapter 和验证结果产生。布局/字体替代不等于内容丢失，但必须同时报告风险。质量报告绑定 ArtifactIdentity；源内容、字体、配置、运行时或导出器任何一项变化，旧通过报告失效。

Portable 保存必须带完整资源和兼容声明；浏览器不支持原地写入时下载新副本。用户的浏览器修改与源项目关系通过 revised-copy/patch 审阅处理，不声称自动同步。升级 runtime 时新建派生副本，不自动覆盖接收者修订。

## 10 M4：真实性能预算与实施方法

先保留现有 Node 微基准，但将“打开/翻页/首屏”中只测字符串生成或构造函数的项目重命名为实际测量对象。另建真实浏览器基准，包含字体和资源就绪后的画面与输入反馈。研究已证明无关页被重建，但尚未证明小文稿普遍慢；不宣传未经测量的优化倍数。

固定三档素材：12 页 Cherry 案例；30 页、约 900 对象和 50 MiB 资源的常规压力档；100 页混合内容极限档。各档固定文件 hash、字体、浏览器和设备信息。常规档是目标校准集，100 页不自动成为公开容量承诺。

| 指标 | 首轮候选门槛 | 测量规则 |
|---|---|---|
| 打开至可交互 | 常规档 p95 ≤ 2s | 本地入口到字体/首屏资源就绪、可选中对象；冷/热分别测 |
| 翻页稳定画面 | 常规档 p95 ≤ 100ms | 输入到目标页稳定渲染，不只 HTML 字符串生成 |
| 输入/拖拽反馈 | p95 ≤ 50ms；持续拖动无 >100ms 停顿 | 合成压力 + 手工 IME/真实指针；口径单独记录 |
| 局部修改影响面 | 无关页 DOM 身份、媒体播放和文字焦点不变 | 结构性门禁，可独立于速度判断 |
| 内存与资源释放 | 反复进入/离开媒体与文件后无持续增长趋势 | 至少 20 次循环，记录峰值与稳定后残留，不假定 GC 精确时刻 |
| 默认包体 | 不超经校准的 Portable/安装包预算 | 新文本依赖、字体和媒体拆开记录，不只压缩后的源码大小 |

以上是候选目标，C01/P01 在固定主机和较低性能实机校准后冻结；不能一边调门槛一边宣称回归通过。浏览器自动化每场景至少 30 次、启动至少 20 次以观察分布，p95 同时给样本数和散点/原始值；少量数据不包装成统计结论。Chromium 自动化是主线，Playwright WebKit 不等同真实 Safari，公开浏览器支持必须另留实机证据。

优化按 P01→P02→P03 执行：diff 到脏对象/页 → 稳定节点与当前文本隔离 → 资源/字体 URL 缓存 → 缩略图失效缓存 → 当前与相邻页按需挂载 → Core 索引增量。打印/全量导出使用独立全页路径，避免窗口化遗漏页面；搜索、页码、阅读顺序来自模型，不依赖已挂载 DOM。

仅对实测占用显著的哈希、压缩、复杂测量准备等可信作业使用 Worker。任务带 jobId、baseRevision、inputDigest、AbortSignal，输出回主线程后重新校验，过期结果丢弃；Worker 不能直接提交 Core。任务池有队列上限和背压，不每次拖动新建 Worker。M4 不把 Worker 当不受信任脚本沙箱。

QuickJS 只在 X01 条件成立时做独立实验：确有声明式无法合理表达的第三方计算需求，且必须执行不受信任代码。比较 native/Worker/Worker+QuickJS 的总成本及限制；JSON draft 经 Core 校验，成品无需扩展运行时即可打开。实时协作 X02 也只有真实多人需求、文件级合并不够用时启动；不能把 Yjs 接入等同现有事务语义已解决。

## 11 质量基准、验收与完成定义

质量分为四条独立线：事实内容、语义编辑、渲染交付、视觉叙事。任一硬门禁失败都不能用其余分数抵消。每个功能必须走一遍：生成 → 人工修改 → 撤销/重做 → 保存 → 重开 → 放映 → 导出 → 检查结果。测试通过数不是产品完成度。

建立 10 个固定任务：产品故事、数据汇报、技术解释、业务提案、培训各两种用途（演讲/阅读）。材料、事实答案、来源、素材许可、目标受众和人工编辑脚本进入 fixtures manifest；真实 Cherry 案例经资料许可与隐私检查后作为回归资产，否则用结构等价脱敏样例。当前基线与候选版本使用同样 Agent、输入、种子/预算，每任务至少两次生成保留原产物，观察波动，不宣称显著性。

硬门禁为：零关键事实错误、零意外内容删除、零锁定误伤、保存重开/撤销一致、放映无编辑泄漏、媒体真实可用、降级声明准确。视觉检查记录页面/对象与截图证据：层级、密度、构图、素材作用、整套节奏；配方标明允许的文字/背景等覆盖关系，不把所有相交一律判错；不允许只给“8 分”而无修复项。

人工目标使用 10 项任务脚本（改字、局部加粗、字号、换图、裁剪、对齐、改表格、保留锁定换布局、重开撤销、演讲交付），由项目负责人和至少两名目标使用者执行。脚本标记最低阶段：文字/图片/对齐/重开和基础演讲在 M1，保护式换布局在 M2，表格与媒体现场工具在 M3。G2 仅执行适用子集，其余记 deferred、不计通过；G3/Q01 再执行完整十项。任何保存失败、误伤或无法退出放映均阻断。首轮形成耗时/求助基线，M2 的人工修复时间应有一致改善趋势，关键任务成功率不退步；样本不足不制定伪精确百分比。

详细正负用例与证据路径见 ACCEPTANCE.md。报告格式统一包含 commit/buildId、fixtureDigest、环境、执行人或自动工具、测量口径、结果、附件和未验证项。人工 Office/浏览器验收未完成时状态保持 unverified；不允许自动测试生成一个假的通过勾。

## 12 开发、迁移、灰度与发布方式

每个 PR 对应一项任务或 L 任务的一段可验收切片，标题含任务 ID。先提交失败 fixture/合同，再实现，再补跨边界验收；数据操作和恢复使用属性/序列化测试，UI 使用真实浏览器旅程。纯外观微调不写镜像实现的测试，依代表页视觉检查。

建议工作分工为四条责任线，人数不足时同一人依序承担：Core/持久化、编辑器/交互、设计系统/Skill、验收/交付。Schema、Operations、Compatibility、Core 和共享测试骨架指定单一整合负责人，避免并行分支分别发明不兼容字段。一个功能不能只有 UI 负责人而没有保存/导出验收责任人。

现有命令继续用于构建、类型检查、单元测试、Host 构建、validate 和 blackbox；新增精确任务命令必须由对应 PR 真正加入 package.json 后才写成可运行手册。文档中的 API 和命令草案不会被冒充为现有 CLI 功能。CI 不修改源 fixture，不自动接受新的视觉 golden。

每个阶段发布前执行：核对阶段任务及阻断项 → 全量核心/保存回归 → 相关浏览器旅程 → npm 临时目录干净安装 → 原生 Skill 创建/编辑/交付 → 断网基础流程 → 核对 capability/report/buildId → 生成迁移和发布说明。基础安装后不启动 MCP、不配置模型密钥；浏览器导出依赖按需安装，缺失时给操作提示而不是损坏项目。

先发布候选包和示例副本做验收，再发布正式 npm/Git tag；GitHub 推送、npm 发布、用户技能/runtime 安装和既有 HTML 升级是四个不同动作，发布报告逐项记录。实现本方案不预先授权发布凭据变更或覆盖他人文件。功能开关用于未完成 UI，不得让旧程序忽略新格式；已写入新文档能力后不能仅靠关开关回滚。

回滚保留旧 npm tarball、旧 runtime build、原始项目和迁移前摘要。降级运行时只打开它能识别的 profile；新格式项目继续用已验证的新读取器只读/导出。暂停 rollout 可以阻止新升级，不能伪称新项目已经自动降级。任何 save/reopen、事实保护或放映控制回归都应停止候选推广并保留失败产物。

## 13 风险、决策门与下一次执行入口

| 风险 | 最早验证任务 | 不通过时的处理 |
|---|---|---|
| 新 inverse 修好新文件却无法救旧历史 | C02/C03 | 分开报告内容恢复与历史恢复，保留原件；不阻塞可靠的新写入能力 |
| 富文本库破坏输入法或历史/包体 | E02/E03 | 使用能通过合同的适配；缩小库使用到活动文本框；不给全画布换内核 |
| 新字段被旧入口静默丢掉 | C02/E08/F01 | persistence/patch/Portable profile 统一推断并拒绝未知能力 |
| 风格好看但长中文或数字失效 | D02/D04/D07 | 调配方容量、拆页提案和字体规则，不缩字/删内容装作通过 |
| 表格/媒体在导出中能力缩水 | F03/F04/Q01 | 保留显式降级合同；只有验证的子集列原生支持 |
| 性能优化导致漏画/选区丢失/视频重启 | P02/P03 | 以语义与交互回归优先，允许安全全量回退后再定位 |
| 多任务并行导致 schema 与 UI 不一致 | E01/D01/F01 | 共享契约先合入，一处登记版本，CI 覆盖两端与导出 |

本轮已决定的方向可以直接执行；待实验决定的仅有文本内核选型、性能阈值校准、媒体体积阈值及条件扩展。它们各有具体任务、判定材料和后备方案，不留成模糊“待研究”。

**开始开发时，从 C01/C02/C04/C05 进入第一批工作，不先扩模板数量或引入 QuickJS。** 首个可体验验收成果必须能演示：无独立背景的页面修改后保存重开并撤销；旧运行时副本生成正确的新版本；Host 与 Portable 放映都无编辑菜单、虚线或可编辑焦点。随后继续 M1 的完整日常编辑闭环。

## 14 依据与适用范围

本方案是基于固定版本的工程设计，不能当作当前能力说明。主要内部依据：原始 [v2.3 研发方案](../PPTe_2.0_完整研发方案_v2.3.md)、[冻结决策](../ADR_v2.3_冻结决策.md)、schema/operations/Core/file-format/compatibility、Host/Portable、richtext-adapter、layout-recipes/design-compiler、widgets/capability/exporter 代码，以及上一轮研究的可复现实验。

外部取舍沿用已核验的第一方资料：[QuickJS 官方说明](https://bellard.org/quickjs/quickjs.html)、[ProseMirror 体系说明](https://tiptap.dev/docs/editor/core-concepts/prosemirror)、[Worker 能力](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)、[字体加载](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Font_Loading_API)、[PresentationML 结构](https://learn.microsoft.com/en-us/office/open-xml/presentation/structure-of-a-presentationml-document)。六个指定开源项目的固定提交、机制与许可比较保留在深度研究报告；本方案不重复宣称未经同素材实验的效果排名。
