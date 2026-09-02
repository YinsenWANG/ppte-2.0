# PPTe 2.0 完整研发方案（v2.3 稳定内核与文件协作版）

> 方案版本：2.3-RD  
> 日期：2026-09-02  
> 状态：研发基线候选，可用于架构评审、产品评审、建仓、拆 Epic、排期与分阶段 GA 验收  
> 替代：PPTe 2.0 v2.2 产品收敛实施版  
> 目标文件规范：`formatVersion=2`、`schemaVersion=2.0.0`  
> 核心变化：在稳定语义对象、确定性 Renderer、React 后编辑器与统一 Operation Engine 基础上，新增语义身份、Change Contract、Slide IR、扁平 Group、Checkpoint/Journal、Portable Quick Fix、Style Preset、Fact/Source、修订副本比较与兼容性 Profile。

---

## 0. 立项结论

PPTe 的产品方向继续成立，技术路线不再调整：

```text
标准 Web Runtime
+ 稳定语义文档
+ 确定性 Renderer
+ 人与 Agent 共用的 Operation Engine
+ React AI 后编辑器
+ 编译期 Design Compiler
+ 开放文件格式
```

v2.3 不再解决“要不要采用 Slidev、要不要允许任意 HTML、要不要做完整 PowerPoint”这些方向性问题。它解决的是 v2.2 之后暴露出的二阶风险：

```text
语义对象能稳定保存，但再生成后身份是否连续？
Agent 有 Scope，但一次允许改多少？
模型是否需要直接输出几十个底层对象？
Group 是否值得引入完整 Scene Graph？
ZIP 工作文件是否适合每几秒高频重写？
Portable 能改文字时，字体子集是否仍可靠？
主题 Token 存在后，局部 Override 是否会逐渐失控？
同一个数字出现在多页时，如何发现不一致？
接收者修改发送副本后，如何把修订带回原项目？
```

### 0.1 最终产品定义

> **PPTe 是一种由 AI 完成主要创作、由人和 Agent 进行精确调整、可以直接演示、保存、修订和流通的语义化演示文档。**

PPTe 不是空白画布上的全功能手工创作软件。它的默认工作分配是：

```text
AI 创建、重排与重设计      70%～90%
Agent 局部语义修改          10%～25%
用户直接微调                 5%～15%
```

这不是统计承诺，而是功能准入原则。主要服务复杂手工创作、且可以通过 Agent 或再生成替代的能力，默认不进入 Core。

### 0.2 最终数据链路

整页创建与再设计：

```text
用户资料 / 意图
→ Narrative Outline
→ Slide IR
→ Design Compiler
→ Stable Semantic Objects
→ Typed Transaction
→ Validation
→ Commit
→ Reference Renderer
```

局部修改：

```text
用户选择 / 意图
→ Scope
→ Change Contract
→ Typed Operations
→ Preview
→ Validation / Diff
→ Commit
→ Reference Renderer
```

文件与恢复：

```text
内存 Committed Snapshot
→ Recovery Journal（高频、追加）
→ .ppte Checkpoint（低频、原子替换）
→ Portable / PDF / PNG / PPTX（派生发布物）
```

### 0.3 v2.3 的十二项冻结优化

1. `elementId` 之外增加 `semanticKey` 与 Replacement Lineage；
2. Transaction 在 Scope 之外增加 `ChangeContract` 与 Mutation Budget；
3. 整页生成优先输出 `SlideIR`，模型不直接承担低层 Scene Graph；
4. Text v1 继续减法：Run 只保留少量强调 Mark，不允许 Run 级字体和字号；
5. Group v1 改为扁平逻辑组，不创建新的持久化坐标系；
6. `.ppte` 改为 Checkpoint，Recovery Journal 负责高频崩溃保护；
7. Portable 分为 Viewer、Quick Fix、Light Edit，首个 GA 只承诺前两档；
8. Theme 增加 `StylePreset`，对象使用 `styleRef + typed overrides`；
9. 文档增加轻量 Fact、Source 与独立 Reading Order；
10. 增加修订副本比较与 `.ppte.patch`，但不引入 CRDT；
11. 80% Layout Recipe 改为声明式资产，代码 Recipe 仅用于少数特殊页面；
12. 独立版本之上增加 `compatibilityProfile`，控制组合测试矩阵。

### 0.4 最终核心边界

PPTe Core 永久理解：

```text
Document / Slide
Text / Image / Shape / Chart / Component
Flat Group
Theme / Style Preset
Fact / Source
Operation / Transaction / Change Contract
Asset / Font
```

PPTe Core 永远不保存：

```text
DOM
React State
任意 HTML / CSS / JavaScript / JSX
第三方富文本私有 State
第三方图表私有配置
活动 Grid / Flex
嵌套 Scene Graph
模型私有推理过程
文件中的可执行插件代码
```

---

## 1. 背景与重构依据

### 1.1 第一版已经验证的事实

第一版采用 Slidev 作为内容源和运行时，实际开发暴露出多套状态与复杂映射：

```text
Markdown / Frontmatter
Vue 组件
Slidev Runtime
预构建结果
PPTe 编辑索引
运行时 Patch
Agent 修改记录
```

用户只修改两个字，系统却需要在 DOM、源码、运行时与预构建结果之间同步。可用性差并不是某几个 Bug，而是底层抽象与目标不一致。

因此 v2.0 已经冻结：

- 不采用 Slidev；
- 不以 Markdown、Vue、Theme、Addon 为内容真源；
- 不让 AI 生成任意 HTML/CSS 后再反向识别对象；
- 不从 DOM 反向覆盖语义文档；
- 不引入第二套持久化 Document Store。

### 1.2 v2.2 已经解决的问题

v2.2 已经建立：

- `document.json` 唯一内容真源；
- 固定画布与稳定 Frame；
- Text、Image、Shape、Chart、Group、Component 六类语义对象；
- React 只属于 Editor/Renderer 实现层；
- Typed Operation、Transaction、Revision、Undo、Diff；
- Structured、Hybrid、Poster 三种视觉策略；
- `.ppte` 工作文件与 `.ppte.html` 发布副本；
- Macro、Layout Recipe、Controlled Widget；
- 分级 Validation 与 Reference Renderer。

这些基础全部保留。

### 1.3 v2.3 继续优化的原因

v2.2 的方向正确，但部分细节仍可能重新长成“小型 Figma、小型 Word、低效 ZIP 数据库和模型直控 Scene Graph”：

- 嵌套 Group 会引入完整坐标树；
- Run 级字体/字号会扩大文本排版与导出差异；
- 模型直接输出 Element Draft 会与底层 Schema 高耦合；
- Scope 只能限制范围，不能限制变化规模；
- 每次自动保存重写 ZIP 会拖慢大文件；
- 字体子集与 Portable 新增字符之间存在冲突；
- Token + 任意 Override 会产生样式债务；
- `elementId` 无法稳定表达再生成前后的业务身份；
- 发送副本修改后缺少回流机制。

v2.3 的目标不是增加更多功能，而是降低这些复杂度进入 Core 的概率。

### 1.4 必要复杂度与偶然复杂度

必须承担：

```text
文本输入与排版
选择、移动和缩放
语义文档与保存
AI 生成与 Agent 修改
资源、字体、演示与导出
版本兼容和修订审阅
```

明确拒绝：

```text
任意网页编辑
完整 Scene Graph
无限 Rich Text
文件内插件执行
实时多人协作
无损双向 PPTX
每几秒重打整个 ZIP
```

---

## 2. 产品定义与用户流程

### 2.1 目标用户

- 使用 AI 创建汇报、方案、总结、培训和发布材料的办公用户；
- 收到演示后只需要改少量文字、图片和数字的接收者；
- 需要让 Agent 局部修改、批量统一和重排页面的专业用户；
- 需要品牌约束、来源追踪、修订审阅和正式交付的团队；
- 希望保留开放文件、离线演示和多种导出的用户。

### 2.2 四种核心动作

#### Direct Edit

用于确定性小改：

```text
改文字
换图片
改一个数字
移动和缩放
对齐和分布
页面排序
```

#### Agent Edit

用于语义与批量修改：

```text
“标题改得更谨慎”
“所有金额改成万元”
“统一术语”
“把这三张卡片排松一点”
“检查来源和数字是否一致”
```

#### Regenerate

用于结构和视觉大改：

```text
重排当前页
重新设计当前页
保留标题和数字重新生成
将 Structured 改为 Hybrid
替换 Artwork
```

#### Review / Merge

用于文件流通后的修订：

```text
比较修订副本
查看对方改了什么
接受部分修改
解决字段冲突
导入 .ppte.patch
```

### 2.3 北极星场景

```text
用户收到一份 PPTe
→ 双击或在 Host 中打开
→ 立即看到完整演示
→ 修改标题两个字
→ 替换一张图片
→ 让 Agent 把结论改得更谨慎
→ 保存或发送副本
→ 对方修改后发回
→ 原作者比较并接受修订
→ 继续演示或导出
```

### 2.4 产品不是什么

PPTe 不是：

- PowerPoint 的完整 Web 复刻；
- Figma 式通用矢量编辑器；
- Word 级富文本排版器；
- 任意 HTML/React 文件容器；
- 依赖云端账号才能打开的 SaaS 文档；
- 实时多人协作系统；
- 无损双向 PPTX 转换器；
- 允许文档携带执行代码的插件平台。

---

## 3. 分阶段发布策略

v2.3 不再把全部能力绑定成一次 GA。采用三个发布列车，每个列车均可形成完整用户价值。

### 3.1 GA-A：核心产品成立

目标：证明“AI 创建 + 人工小改 + Agent 局部修改 + 稳定保存”成立。

必须完成：

- Text、Image、Shape；
- Flat Group；
- Structured 与 Hybrid；
- Slide IR 与 8～12 个核心 Layout Recipe；
- AI 创建完整演示；
- Agent Selection/Slide Scope 修改；
- Change Contract；
- `.ppte` Checkpoint + Recovery Journal；
- PDF、PNG；
- Portable Viewer；
- Portable Quick Fix：改文字、换图片、撤销、保存新项目；
- Reference Renderer、Undo、Diff、Atomic Save；
- Style Preset、semanticKey、Reading Order。

明确不阻塞 GA-A：

- Chart 完整数据编辑；
- Poster；
- Persistent Widget；
- 修订副本合并；
- PPTX；
- Portable 几何编辑。

### 3.2 GA-B：文件协作闭环

目标：证明 PPTe 不只是编辑器，而是一种可以反复发送、修改和审阅的文件。

新增：

- Bar、Line、Pie 三类 Chart；
- Fact / Source；
- 修订副本比较；
- `.ppte.patch`；
- Portable Quick Fix 的数字/Fact 修改；
- Working / Clean；
- 旧 PPTe 迁移；
- 图片型 PPTX；
- Capability Report；
- 12～16 个 Layout Recipe、首批 Macro。

### 3.3 GA-C：表达力扩张

新增但不反向污染 Core：

- Area、Donut Chart；
- Poster Strategy；
- Table、Code、Equation Widget；
- Portable Light Edit：裁切、Chart Data、简单几何；
- 基础语义 PPTX；
- 更多 Recipe、Macro 和 Theme；
- Video Widget；
- 企业私有、仍受控的 Widget Registry。

### 3.4 Roadmap 优先级

```text
Text / Image / Shape / Flat Group
→ Save / Recovery / Undo
→ semanticKey / Change Contract
→ Slide IR / Design Compiler
→ Agent 局部修改
→ Portable Viewer / Quick Fix
→ 修订副本比较
→ Chart / Fact / Source
→ PPTX / Widget / Poster
```

---

## 4. 架构决策冻结（ADR）

### ADR-001：不再采用 Slidev

Slidev 只可作为旧文件导入来源，不进入 PPTe Runtime、文件格式和编辑主链路。

### ADR-002：语义文档是唯一内容真源

DOM、React Tree、缩略图、测量缓存、Slide IR、布局候选和导出结果均为派生数据。

### ADR-003：固定画布优先

默认 1920×1080 `du`。运行时不维护响应式 Flow Layout；生成阶段可以使用 Grid/Flex，提交前必须物化 Frame。

### ADR-004：React 只属于实现层

文件不保存 JSX、React State 或 React 源码。

### ADR-005：所有持久化修改经过 Operation Engine

人工、Agent、Importer、Compiler、Merge 均不得绕过 Transaction Commit。

### ADR-006：不允许任意文档代码

`.ppte` 为纯数据；`.ppte.html` 只包含固定官方 Runtime 和经过校验的 Payload。

### ADR-007：`.ppte` 是唯一工作真源

`.ppte.html`、PDF、PNG、PPTX 和 `.ppte.patch` 均为派生物或交换物。

### ADR-008：AI 后编辑器，不做完整空白画布创作

复杂大改优先 Agent 或 Regenerate。

### ADR-009：Hybrid Visual 是正式能力

关键文字、数字、Logo、来源和可编辑图表必须语义化；复杂装饰允许作为 Artwork Image。

### ADR-010：Component 是 Controlled Widget

GA-A 不持久化 Widget；GA-C 只允许可信 Host Registry、声明式 Props、静态 Fallback、默认无网络。

### ADR-011：Slide IR 只属于编译层

Slide IR 不作为显示真源。可持久化摘要与 Digest，但 Renderer 永远读取 Semantic Document。

### ADR-012：语义身份与实例身份分离

`elementId` 表示当前实例；`semanticKey` 表示业务身份；Replacement Lineage 记录再生成关系。

### ADR-013：Scope 与 Change Contract 分离

Scope 决定“在哪里改”；Change Contract 决定“可以怎样改、最多改多少”。

### ADR-014：Group v1 是扁平逻辑组

Group 不创建坐标系、不参与渲染、不嵌套。Group 操作在同一 Transaction 内物化为子元素操作。

### ADR-015：Text v1 禁止 Run 级字体和字号

Run 只允许粗体、斜体、下划线、删除线和强调色；字体、字号、字重在 Text Element 级定义。

### ADR-016：`.ppte` 是 Checkpoint，不是事务数据库

高频崩溃保护使用 Recovery Journal；显式保存、关闭与较长空闲时生成原子 Checkpoint。

### ADR-017：Portable 采用能力 Profile

GA-A 只承诺 Viewer 与 Quick Fix；Light Edit 后置。字体必须声明 Glyph Coverage 和 Edit Safety。

### ADR-018：样式使用 Preset + Override

Theme Token 提供原子值，Style Preset 提供对象级组合，Element 只保存少量 Typed Override。

### ADR-019：Fact/Source 只做显式引用，不做隐藏实时绑定

同步事实必须产生可审阅 Operations。

### ADR-020：Reading Order 与视觉层级分离

`rootOrder` 只负责前后层级；`readingOrder` 负责人、Agent 和无障碍理解顺序。

### ADR-021：修订副本比较优先于 CRDT

2.0 不做实时协作。共同 Base Revision 下进行三方语义 Diff 与显式合入。

### ADR-022：Layout Recipe 默认声明式

大多数 Recipe 为可测试的 Slot/Constraint/Variant 资产；特殊布局才允许受控代码 Compiler。

### ADR-023：版本独立但通过 Compatibility Profile 发布

Format、Schema、Operation、Widget、Portable、Recipe 独立版本；用户与发布门禁按已验证 Profile 承诺。

### ADR-024：成熟库必须通过 Adapter

借用 IME、Rich Text、图表、ZIP、Schema、截图等能力，但第三方私有模型不得进入文件格式。

### ADR-025：发布优先保证可靠闭环

Text、Undo、Save、Recovery、Agent 越界保护未达标，不允许用 Chart、Widget、PPTX 或动画掩盖核心问题。

---

## 5. 总体架构

```text
┌────────────────────────────────────────────────────────────┐
│                        PPTe Host                           │
│  File UI / Post Editor / Agent UI / Review / Export       │
└───────────────┬──────────────────────┬─────────────────────┘
                │                      │
                ▼                      ▼
┌─────────────────────────┐  ┌──────────────────────────────┐
│      Authoring Plane    │  │        Review Plane          │
│ Narrative / Slide IR    │  │ Revised Copy / Patch / Diff  │
│ Recipe / Macro / Artwork│  │ Conflict / Accept / Reject   │
└───────────────┬─────────┘  └──────────────┬───────────────┘
                │ Draft / Ops               │ Ops
                └──────────────┬─────────────┘
                               ▼
┌────────────────────────────────────────────────────────────┐
│                    Operation Plane                         │
│ Scope / Change Contract / Preview / Validation / Commit   │
│ Revision / Inverse / History / Structural & Semantic Diff │
└──────────────────────────┬─────────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────────┐
│                   Semantic Document                       │
│ Slide / Element / Flat Group / Theme / Fact / Source      │
│ Asset / Font / Reading Order / Semantic Identity          │
└───────────────┬─────────────────────────┬──────────────────┘
                │                         │
                ▼                         ▼
┌─────────────────────────┐  ┌──────────────────────────────┐
│ Reference Renderer      │  │ Persistence Plane            │
│ DOM / SVG / Chart       │  │ Journal / Checkpoint / CAS   │
│ Ready Gate / Thumbnail  │  │ Migration / Package / Patch  │
└───────────────┬─────────┘  └──────────────────────────────┘
                ▼
         Presentation / Export / Portable
```

### 5.1 五个平面

#### Authoring Plane

负责从意图和资料生成 Slide IR、选择 Recipe、构建语义对象和 Artwork。只输出 Draft 或 Transaction，不直接写 Document。

#### Operation Plane

系统唯一写入口。负责 Scope、Change Contract、Precondition、Validation、Diff、Commit、Undo 和 Revision。

#### Semantic Document

稳定、开放、框架无关的内容真源。

#### Render Plane

将语义对象确定性地渲染为 DOM/SVG/受控 Canvas。不能反向覆盖 Document。

#### Persistence / Review Plane

负责 Journal、Checkpoint、修订副本比较、Patch、Migration、Portable 和导出。

### 5.2 信任边界

```text
高信任：PPTe Host / Core / Official Renderer / Built-in Adapters
中信任：官方 Recipe / Macro / Theme / Exporter
低信任：文档内容、Notes、Agent Rules、导入资料、远程 Asset
不信任：文件内脚本、未知 Widget 代码、未清洗 SVG、Prompt Injection
```

### 5.3 依赖方向

```text
schema
  ↑
core ← operations ← validation ← diff
  ↑          ↑
renderer     agent-tools
  ↑          ↑
editor       design-compiler
  ↑
host / portable / exporter / reviewer
```

上层可以依赖下层；Core 不依赖 React、DOM、具体模型、编辑器、Portable 或 PPTX 库。

---
## 6. 工程模块与 Monorepo

### 6.1 推荐目录

```text
/apps
├── desktop-host
├── web-host
├── portable-playground
├── recipe-studio
├── compatibility-lab
└── contract-deck

/packages
├── schema
├── canonical-json
├── core
├── operations
├── change-contract
├── geometry
├── validation
├── diff
├── semantic-identity
├── facts
├── file-format
├── recovery-journal
├── patch-format
├── assets
├── fonts
├── renderer-react
├── editor-react
├── richtext-adapter
├── charts
├── design-ir
├── design-compiler
├── layout-recipes
├── macros
├── agent-tools
├── reviewer
├── portable-runtime
├── exporter-pdf
├── exporter-pptx
├── importer-legacy
├── sdk
└── cli
```

### 6.2 包职责

| 包 | 责任 | 明确不负责 |
|---|---|---|
| `schema` | 文档、Manifest、Transaction、Slide IR、Patch 类型与 JSON Schema | UI、磁盘、网络 |
| `core` | Session、Commit、Revision、History、派生索引 | DOM、React、模型调用 |
| `operations` | Typed Operation 与逆操作 | 视觉布局判断 |
| `change-contract` | Scope、Mutation Budget、Invariant | 生成内容 |
| `geometry` | Frame、变换、命中、对齐、Flat Group 批量变换 | Canvas UI |
| `renderer-react` | 语义对象到 DOM/SVG | 内容写入 |
| `design-compiler` | Slide IR 到 Element Draft | 直接 Commit |
| `recovery-journal` | 追加恢复日志、重放和清理 | 正式工作文件格式 |
| `reviewer` | 三方语义 Diff、冲突、Patch 导入 | 实时协作 |
| `portable-runtime` | Viewer/Quick Fix | 完整 Host 与生成引擎 |

### 6.3 第三方依赖原则

允许使用成熟库处理：

- 富文本输入与 IME；
- ZIP；
- JSON Schema；
- Chart 绘制；
- PDF/PNG/PPTX 导出；
- 图像处理；
- Playwright 类浏览器测试；
- 像素和感知 Diff。

必须满足：

```text
PPTe Schema
→ Adapter
→ Third-party Library
```

禁止：

```text
Third-party Private State
→ document.json
```

### 6.4 Core 可运行环境

Core、Schema、Operations、Change Contract 与 Canonicalization 必须同时运行于：

- Browser Main Thread；
- Web Worker；
- Node；
- Desktop Host Background Process。

Renderer/Editor 可以依赖浏览器；文件校验和事务处理不能依赖 DOM。

---

## 7. 最终语义文档模型

### 7.1 根文档

```ts
interface PpteDocument {
  schemaVersion: '2.0.0'
  documentId: DocumentId
  locale: string

  metadata: DocumentMetadata
  canvas: CanvasSpec
  theme: ThemeDefinition

  slideOrder: SlideId[]
  slides: Record<SlideId, Slide>

  facts?: Record<FactId, Fact>
  sources?: Record<SourceId, Source>
  assets: Record<AssetId, Asset>
  fonts: Record<FontId, FontAsset>

  widgetRequirements?: WidgetRequirement[]
  policies?: DocumentPolicies
  generation?: GenerationMetadata
  extensions?: ExtensionEnvelope[]
}
```

### 7.2 根模型规则

- `slideOrder` 是页面顺序唯一真源；
- `slides` 是页面实体唯一真源；
- `document.json` 不保存当前 Revision；
- Revision 位于 Manifest 与 Session；
- Facts、Sources 是可选语义资料，不参与隐藏式自动布局；
- Asset 和 Font 使用 ID/Hash，不在 Element 中保存 Base64；
- DOM、React、缩略图、缓存、Journal 与 Slide IR 不进入 Document；
- 未识别、非必需 Extension 必须保留；
- 文件中的任何字段都不能提升权限或执行代码。

### 7.3 画布

```ts
interface CanvasSpec {
  width: number        // 默认 1920
  height: number       // 默认 1080
  unit: 'du'
  aspectRatio: '16:9' | '4:3' | 'custom'
  safeArea?: Insets
  defaultBackground: Paint
}
```

- 页面显示只做等比缩放；
- 不隐式响应式重排；
- 不保存 `px/vw/vh/%/calc()`；
- 持久化精度统一为 `0.001 du`；
- 不保存 Skew、3D Matrix 和任意 CSS Transform。

### 7.4 Slide

```ts
interface Slide {
  id: SlideId
  name?: string
  hidden?: boolean
  background?: Paint

  rootOrder: ElementId[]
  elements: Record<ElementId, Element>

  groups?: Record<GroupId, LogicalGroup>
  readingOrder?: ElementId[]

  notes?: SlideNotes
  transition?: SlideTransition
  semantic?: SlideSemanticSummary
  visualStrategy?: 'structured' | 'hybrid' | 'poster'
  protectedAnchors?: ProtectedAnchor[]
  provenance?: Provenance
  extensions?: ExtensionEnvelope[]
}
```

`rootOrder` 只承担视觉层级：数组前面为后层，后面为前层。`readingOrder` 只承担理解和无障碍顺序，二者不得复用。

### 7.5 Element Union

```ts
type Element =
  | TextElement
  | ImageElement
  | ShapeElement
  | ChartElement
  | ComponentElement
```

Group 仍然是 PPTe 的稳定语义对象，但 v1 不是渲染 Element。它是 Slide 上的扁平编辑关系。

### 7.6 Base Element

```ts
interface BaseElement {
  id: ElementId
  type: Element['type']

  semanticKey?: string
  role?: SemanticRole
  name?: string
  tags?: string[]
  description?: string

  frame: Frame
  rotationDeg?: number
  flipX?: boolean
  flipY?: boolean
  opacity?: number
  visible?: boolean
  locked?: boolean

  appearStep?: number
  animation?: ElementAnimation
  editPolicy?: EditPolicy
  semanticRefs?: SemanticRefs
  provenance?: Provenance
  extensions?: ExtensionEnvelope[]
}
```

### 7.7 Frame

```ts
interface Frame {
  x: number
  y: number
  width: number
  height: number
}
```

规则：

- Frame 永远相对 Slide；
- Flat Group 不改变 Frame 坐标空间；
- 所有数值有限且通过最小尺寸校验；
- Rotation 默认围绕元素中心；
- Matrix 只作为计算中间态，不持久化。

### 7.8 语义角色

建议内置：

```text
title
subtitle
body
caption
metric
source
logo
image
chart
artwork
background
decorative
navigation
cta
custom
```

Role 用于查询、生成、Reading Order、导出和默认编辑策略，但不直接决定视觉样式。

### 7.9 Edit Policy

```ts
interface EditPolicy {
  mode?: 'full' | 'property' | 'replace' | 'locked'
  protected?: boolean
  lockedFields?: JsonPointer[]
  agentEditable?: boolean
  preserveOnRegenerate?: boolean
}
```

默认值：

| 对象 | 默认模式 |
|---|---|
| Text | `full` |
| 普通 Image | `full` |
| Artwork Image | `replace` |
| Shape | `full` |
| Chart | `property` |
| Component | `property` |
| Logo、法律声明 | `locked` 或 `protected` |

文档可以收紧权限；不能自行放宽宿主策略。

### 7.10 派生数据

运行时可建立：

```ts
interface DerivedIndexes {
  slideByElement: Map<ElementId, SlideId>
  groupByElement: Map<ElementId, GroupId>
  assetRefCount: Map<AssetId, number>
  semanticKeyIndex: Map<string, ElementLocator>
  factRefIndex: Map<FactId, Set<ElementLocator>>
  sourceRefIndex: Map<SourceId, Set<ElementLocator>>
  roleIndex: Map<SemanticRole, Set<ElementLocator>>
  textSearchIndex?: TextSearchIndex
}
```

这些索引随时可以从 Document 重建，不参与 Revision。

---

## 8. 语义身份、替换谱系与保护锚点

### 8.1 三类身份

```text
elementId
→ 当前文档中的对象实例

semanticKey
→ 当前 Slide 中跨再生成稳定的业务身份

Fact / Source ID
→ 跨页面共享的数据或来源身份
```

例如：

```text
elementId    = el_01K...
semanticKey  = metric.annual-revenue
role         = metric
factRef      = fact_arr_2026
```

### 8.2 semanticKey 规则

- 在单个 Slide 内唯一；
- 创建后，直接编辑不改变；
- 页面再生成时，同一业务对象应尽量复用；
- 复制页面时生成新 Slide，但可保留相同局部语义名；
- 跨文档复制时可以保留语义含义，但不得造成当前 Slide 冲突；
- 装饰 Shape 默认不需要；
- Title、Metric、Logo、Chart、Source、CTA 等关键对象应优先生成；
- Agent 可以按 `semanticKey` 查询，但最终操作仍解析为当前 `elementId`。

### 8.3 Replacement Lineage

```ts
interface Provenance {
  kind?: 'human' | 'agent' | 'imported' | 'generated' | 'generated-artwork'
  actorId?: string
  sourceId?: string
  recipeId?: string
  recipeVersion?: string
  generatorId?: string
  generatorVersion?: string
  replacesElementId?: ElementId
  sourceSemanticKey?: string
  generationId?: string
  promptSummary?: string
  confidence?: number
}
```

再生成删除旧对象并创建新对象时：

- 新对象尽量继承 `semanticKey`；
- `replacesElementId` 指向旧实例；
- Diff 显示为“替换/重新设计”，而不是简单删除+新增；
- 旧对象 ID 不得在当前文档中复用；
- 评论、Fact/Source 引用和 Protected Anchor 可以基于 `semanticKey` 重新绑定；
- 无法可靠判断继承关系时，不自动绑定，进入 Review。

### 8.4 Protected Anchor

```ts
interface ProtectedAnchor {
  target:
    | { kind: 'element'; elementId: ElementId }
    | { kind: 'semantic'; semanticKey: string }
    | { kind: 'fact'; factId: FactId }
  preserve: Array<'content' | 'data' | 'style' | 'geometry' | 'asset'>
  reason?: string
}
```

推荐：

- 短时、当前事务保护用 `elementId`；
- 页面再生成和文件修订用 `semanticKey`；
- 跨页面数字一致性用 `factId`。

### 8.5 Identity Validation

必须检查：

- 同一 Slide 无重复 `semanticKey`；
- `replacesElementId` 不指向当前活对象自身；
- Lineage 不形成环；
- Protected Anchor 可解析；
- 关键语义对象再生成后未无故失去身份；
- Copy/Paste 的 ID 与 semanticKey 重映射合法。

---

## 9. Reading Order、Fact 与 Source

### 9.1 Reading Order

```ts
readingOrder?: ElementId[]
```

规则：

- 只包含当前 Slide 的非装饰内容对象；
- 同一元素最多出现一次；
- 装饰、背景和纯 Artwork 默认不进入；
- Group 不进入，因为 Group 不是阅读节点；
- 未设置时，Compiler 根据语义和空间位置生成；
- 人工可在“阅读顺序”面板调整；
- Presenter Notes、Agent Summary、无障碍和导出使用该顺序；
- 视觉层级变化不能隐式改变 Reading Order。

### 9.2 Fact

```ts
interface Fact {
  id: FactId
  key: string
  label?: string
  value: string | number | boolean | null
  unit?: string
  format?: string
  sourceIds?: SourceId[]
  verified?: boolean
  verifiedAt?: string
  provenance?: Provenance
}
```

### 9.3 Source

```ts
interface Source {
  id: SourceId
  title?: string
  author?: string
  publisher?: string
  url?: string
  citation?: string
  accessedAt?: string
  license?: string
  note?: string
}
```

### 9.4 Element 引用

```ts
interface SemanticRefs {
  factIds?: FactId[]
  sourceIds?: SourceId[]
}
```

引用只表达“这个对象使用了哪些事实或来源”，不代表隐藏实时绑定。

### 9.5 显式同步

```text
修改 Fact
→ 发现引用位置
→ 生成候选 Operations
→ 显示哪些页面和文字会变化
→ 用户确认
→ Commit
```

禁止：

```text
修改 Fact
→ 背后无提示自动改完整演示
```

### 9.6 一致性检查

L2/L3 可以检查：

- 同一 Fact 在多个文本中的值是否不一致；
- Chart Data 与 Metric Text 是否冲突；
- Source 对象是否缺少可显示 Citation；
- 已验证 Fact 是否被 Agent 无权限改动；
- 导出是否遗漏来源。

---

## 10. Theme、Style Preset 与 Override

### 10.1 Theme

```ts
interface ThemeDefinition {
  id: string
  name: string
  tokens: ThemeTokens
  presets: StylePresetRegistry
  extensions?: ExtensionEnvelope[]
}
```

### 10.2 Token

Token 保存原子值：

```text
color.text.primary
color.accent
font.heading
font.body
fontSize.title
spacing.page
radius.card
shadow.soft
```

对象属性可以引用 Token 或使用字面值，但字面值应被视为 Override。

### 10.3 Style Preset

```ts
interface StylePresetRegistry {
  text: Record<string, TextStylePreset>
  shape: Record<string, ShapeStylePreset>
  image: Record<string, ImageStylePreset>
  chart: Record<string, ChartStylePreset>
}
```

建议内置命名：

```text
text.title.primary
text.subtitle
text.body.normal
text.caption
text.metric.value
text.metric.label
text.source
shape.card
shape.emphasis
shape.divider
chart.default
chart.emphasis
```

### 10.4 元素绑定

```ts
interface StyleBinding<TOverrides> {
  styleRef: string
  overrides?: TOverrides
}
```

例如：

```ts
interface TextElement extends BaseElement {
  type: 'text'
  content: RichTextDocument
  style: StyleBinding<Partial<TextStyle>>
  paragraphStyle?: ParagraphStyle
  boxStyle?: BoxStyle
  overflowPolicy?: 'warn' | 'clip' | 'ellipsis'
}
```

Renderer 顺序：

```text
Theme Tokens
→ Style Preset
→ Typed Element Override
→ Effective Style
```

### 10.5 语义与样式分离

- `role=title` 不自动等于 `styleRef=text.title.primary`；
- Compiler 可以根据 Role 推荐 Preset；
- 用户可以把 Title 改为其他 Preset；
- Agent “换主题”优先更新 Theme/Presets；
- Agent “只改这个对象颜色”创建局部 Override；
- 重置样式时删除 Override，不硬写当前解析值。

### 10.6 Override Debt

派生指标：

```text
overrideDebt
= 关键元素中存在字面样式 Override 的字段数
  / 关键元素可由 Preset 控制的字段总数
```

编辑器提供：

- 查看局部覆盖；
- 重置为 Preset；
- 将当前样式保存为新 Preset；
- 将多个相似 Override 合并回 Preset；
- 主题切换前预览受 Override 影响的对象。

### 10.7 样式变更操作

```text
theme.setToken
theme.updatePreset
element.setStyleRef
element.updateStyleOverrides
element.clearStyleOverrides
```

所有操作可 Diff、可 Undo、可由 Change Contract 限制。

---

## 11. 对象模型

### 11.1 Text

```ts
interface TextElement extends BaseElement {
  type: 'text'
  content: RichTextDocument
  style: StyleBinding<Partial<TextStyle>>
  paragraphStyle?: ParagraphStyle
  boxStyle?: BoxStyle
  overflowPolicy?: 'warn' | 'clip' | 'ellipsis'
}
```

### 11.2 Image

```ts
interface ImageElement extends BaseElement {
  type: 'image'
  assetId: AssetId
  fit: 'contain' | 'cover' | 'fill'
  crop?: NormalizedRect
  focalPoint?: Point
  style?: StyleBinding<Partial<ImageStyle>>
  altText?: string
}
```

规则：

- Asset 由 Hash 去重；
- Crop 使用 0～1 归一化坐标；
- 替换图片默认保留 Frame/Fit；
- 是否保留 Crop 由用户明确选择；
- 远程图片导入后本地化；
- 低清、比例不匹配、版权信息缺失给出 Warning。

Artwork 仍然是 Image：

```ts
{
  type: 'image',
  role: 'artwork',
  editPolicy: { mode: 'replace' }
}
```

### 11.3 Shape

```ts
interface ShapeElement extends BaseElement {
  type: 'shape'
  shape:
    | 'rectangle'
    | 'rounded-rectangle'
    | 'ellipse'
    | 'line'
    | 'arrow'
    | 'triangle'
    | 'diamond'
    | 'chevron'
    | 'polygon'
  style: StyleBinding<Partial<ShapeStyle>>
  points?: Point[]
}
```

限制：

- SVG 确定性渲染；
- 不支持自由钢笔；
- 不支持自动连接线寻路；
- 不支持任意 SVG Filter；
- Icon 优先为安全 SVG Asset，不无限扩张 ShapeKind。

### 11.4 Chart

```ts
interface ChartElement extends BaseElement {
  type: 'chart'
  chartType: 'bar' | 'line' | 'area' | 'pie' | 'donut'
  data: ChartData
  encoding: ChartEncoding
  options?: ChartOptions
  style: StyleBinding<Partial<ChartStyle>>
  altText?: string
}
```

- 文件只保存 PPTe 自有 Chart Schema；
- 不保存 ECharts/Vega/D3 私有配置；
- 用户编辑 Data/Encoding/基础样式；
- Agent 不修改生成 SVG Path；
- 复杂图表可降级为 Artwork 或未来 Widget；
- GA-A 不阻塞 Chart，GA-B 先 Bar/Line/Pie。

### 11.5 Controlled Component

```ts
interface ComponentElement extends BaseElement {
  type: 'component'
  componentType: string
  componentVersion: string
  props: Record<string, JsonValue>
  fallback: ComponentFallback
}
```

GA-C 首批：

```text
core/table
core/code
core/equation
core/video（可后置）
```

必须：

- Host Registry 内置；
- Props Schema；
- 确定性 Renderer；
- 默认无网络；
- 不能写 Document；
- Static Fallback；
- 明确迁移和导出策略；
- 文件不携带 Component 代码。

### 11.6 Authoring Macro

Macro 只存在于编译与插入阶段：

```text
metric-card
quote
comparison
feature-grid
kpi-row
timeline
process
```

运行后展开成 Text/Image/Shape/Chart，提交后文档不依赖 Macro Runtime。

---

## 12. Text Engine v1

### 12.1 目标

Text Engine 只解决演示文稿中的稳定文本输入、显示、溢出、Diff 和导出，不复刻 Word。

### 12.2 文件结构

```ts
interface RichTextDocument {
  paragraphs: TextParagraph[]
}

interface TextParagraph {
  id: string
  runs: TextRun[]
  align?: 'left' | 'center' | 'right'
  list?: { type: 'bullet' | 'number' }
  spaceBefore?: number
  spaceAfter?: number
}

interface TextRun {
  id: string
  text: string
  marks?: {
    bold?: boolean
    italic?: boolean
    underline?: boolean
    strike?: boolean
    color?: ValueOrToken<HexColor>
  }
}
```

### 12.3 元素级样式

```ts
interface TextStyle {
  fontFamily: ValueOrToken<string>
  fontSize: number
  fontWeight?: number
  color: ValueOrToken<HexColor>
  lineHeight?: number
  letterSpacing?: number
  verticalAlign?: 'top' | 'middle' | 'bottom'
  direction?: 'ltr' | 'rtl' | 'auto'
}
```

字体、字号、字重不允许在 Run 级覆盖。

### 12.4 GA-A 支持范围

- 多段落；
- 单级项目符号或编号；
- Run 级粗体、斜体、下划线、删除线和强调色；
- 元素级字体、字号、字重、颜色；
- 水平/垂直对齐；
- 行高、字间距、段间距和 Padding；
- 中文、英文、中英混排、Emoji；
- 纯文本粘贴和有限白名单格式粘贴；
- Overflow 检测；
- 显式 Fit。

### 12.5 明确不做

- Run 级字体、字号、复杂字重；
- 两级以上列表；
- 任意 HTML；
- 表格嵌套；
- 文本绕排；
- 跨文本框续排；
- 竖排、路径文字；
- Word 级样式继承；
- 任意 OpenType Feature；
- 网页或 Office 像素级粘贴保真。

复杂字号组合优先拆成多个 Text：

```text
metric.value = “42%”
metric.label = “同比增长”
```

### 12.6 编辑状态机

```text
Idle
→ Double Click
→ Mount RichText Adapter
→ IME Composition / Local State
→ Blur / Explicit Done / Idle Batch
→ Serialize PPTe RichText
→ text.replaceContent Preview
→ Overflow Check
→ Commit
```

规则：

- IME Composition 期间不 Commit；
- 输入中不计算内容 Revision；
- 连续输入合并为一个编辑会话；
- Escape 恢复进入编辑前内容；
- 崩溃恢复可记录受控草稿，但不进入主 History；
- 第三方编辑内核 State 不进入文件。

### 12.7 默认不自动 Fit

文本变更后：

```text
Frame 不变
Style 不变
字号不变
行高不变
Overflow Policy 生效
```

如果溢出，明确提供：

```text
缩短文字
扩大文本框
减小字号
截断显示
撤销
```

对应操作：

```text
text.replaceContent
text.resizeBox
text.fitByReducingFont
text.setOverflowPolicy
```

`shorten-with-agent` 最终仍然提交 `text.replaceContent`。

### 12.8 文本测量

测量 Cache Key 至少包含：

```text
contentHash
fontFingerprint
effectiveStyleHash
frameHash
runtimeFingerprint
```

Cache 不进入 Document。Font 未 Ready 时不得把临时测量结果当作最终结果。

### 12.9 Text 验收

- macOS/Windows 主流中文输入法无丢字、重字；
- 修改两个字不暗中变字号；
- 10 分钟输入不产生 History 爆炸；
- Overflow 提示可理解；
- 显式 Fit 可撤销；
- 保存重开一致；
- Portable 新字符执行 Glyph Coverage 检查；
- Agent “只改文字”不改变 Frame、StyleRef 和 Override。

---
## 13. Slide IR 与 Design Compiler

### 13.1 为什么需要 Slide IR

整页生成不应该让模型直接承担：

```text
几十个 Element ID
精确 Frame
层级顺序
Style Token
Group
Asset
Operation
```

这会增加 Token、Schema 错误和模型耦合。Slide IR 用于表达“页面要讲什么、有哪些语义块、视觉关系是什么”，Compiler 再确定性地生成对象。

### 13.2 Slide IR 定位

```text
Narrative
→ Slide IR
→ Layout Recipe / Freeform Semantic Compiler
→ Element Draft
→ Typed Operations
```

Slide IR：

- 是编译输入，不是 Renderer 真源；
- 默认不写入 `document.json`；
- 可以在 Provenance 中保存 Digest、版本和摘要；
- 重新生成时从当前 Document 语义、Facts、Sources、用户意图重新构建；
- 如果保存完整 IR，只能进入 Host 私有生成缓存，不影响文件显示。

### 13.3 Presentation IR

```ts
interface PresentationIR {
  title: string
  audience?: string
  objective?: string
  narrative: NarrativeSection[]
  slides: SlideIR[]
  themeIntent?: ThemeIntent
  sourceIds?: SourceId[]
}
```

### 13.4 Slide IR

```ts
interface SlideIR {
  irVersion: '1.0'
  slideKey: string
  purpose:
    | 'cover'
    | 'section'
    | 'statement'
    | 'explanation'
    | 'comparison'
    | 'metrics'
    | 'chart'
    | 'timeline'
    | 'process'
    | 'quote'
    | 'summary'
    | 'closing'
  message: string
  visualStrategy: 'structured' | 'hybrid' | 'poster'
  density: 'low' | 'medium' | 'high'
  blocks: BlockIR[]
  layoutIntent?: LayoutIntent
  artworkIntent?: ArtworkIntent
  protectedContent?: ProtectedContentIR[]
  sourceIds?: SourceId[]
}
```

### 13.5 Block IR

```ts
interface BlockIR {
  key: string
  kind:
    | 'heading'
    | 'paragraph'
    | 'metric'
    | 'image'
    | 'chart'
    | 'comparison'
    | 'quote'
    | 'process'
    | 'timeline'
    | 'source'
    | 'cta'
  content?: JsonValue
  semanticKey?: string
  factIds?: FactId[]
  sourceIds?: SourceId[]
  importance: 'primary' | 'secondary' | 'supporting'
  emphasis?: 'normal' | 'strong'
  keepTogetherWith?: string[]
  preferredAspectRatio?: number
  editabilityTarget?: 'full' | 'property' | 'replace'
}
```

### 13.6 Layout Intent

```ts
interface LayoutIntent {
  balance: 'text-led' | 'visual-led' | 'balanced'
  direction?: 'horizontal' | 'vertical'
  hierarchy?: 'single-focus' | 'dual-focus' | 'grid'
  rhythm?: 'calm' | 'dynamic'
  whitespace?: 'compact' | 'normal' | 'generous'
  preferredRecipeIds?: string[]
  avoidRecipeIds?: string[]
}
```

### 13.7 Artwork Intent

```ts
interface ArtworkIntent {
  subject: string
  function: 'evidence' | 'illustration' | 'background' | 'atmosphere'
  placement: 'full-bleed' | 'side' | 'center' | 'background'
  safeTextRegions?: Rect[]
  avoidTextRegions?: Rect[]
  styleKeywords?: string[]
}
```

### 13.8 Compiler 输出

Compiler 只输出：

```ts
interface CompiledSlideDraft {
  slide: SlideDraft
  elementDrafts: ElementDraft[]
  groups: LogicalGroupDraft[]
  readingOrder: string[]
  semanticKeyMap: Record<string, string>
  validationIssues: ValidationIssue[]
  provenance: CompileProvenance
}
```

它不直接 Commit。

### 13.9 两条 AI 输出路径

#### 整页创建/再设计

模型主要输出 `SlideIR`。只有特殊修复阶段才输出受限 Operations。

#### 局部修改

模型直接输出 Change Contract 内允许的 Typed Operations。

### 13.10 Compiler 确定性

相同：

```text
Slide IR
Theme
Recipe Version
Font Metrics Fingerprint
Asset Metadata
Compiler Version
```

应得到语义等价的 Element Draft。随机探索必须显式携带 Seed，并在 Preview 中显示为候选版本。

---

## 14. 声明式 Layout Recipe 与 Macro

### 14.1 Recipe 资产化

80% Recipe 使用声明式 Spec：

```ts
interface RecipeSpec {
  id: string
  version: string
  supports: SlidePurpose[]
  slots: RecipeSlot[]
  zones: LayoutZone[]
  constraints: LayoutConstraint[]
  variants?: RecipeVariant[]
  artworkSafeRegions?: Rect[]
  qualityRules?: QualityRule[]
}
```

只有无法声明表达的少数页面使用受控代码 Compiler。

### 14.2 Slot

```ts
interface RecipeSlot {
  key: string
  accepts: BlockIR['kind'][]
  required?: boolean
  minCount?: number
  maxCount?: number
  maxChars?: number
  preferredAspectRatio?: number
  styleRef?: string
  semanticRole?: SemanticRole
}
```

### 14.3 Constraint

首版约束：

```text
align
stack
grid
gap
padding
min-size
max-size
aspect-ratio
keep-together
avoid-region
safe-area
baseline
```

保存到 Document 的只有最终 Frame；Recipe Spec 不进入工作文件。

### 14.4 Recipe Score

候选评分考虑：

```text
Purpose 匹配
Block 数量
文本长度
图片比例
Chart 类型
Visual Strategy
Density
Editability Target
Artwork Safe Region
历史接受率
```

### 14.5 Recipe Studio

内部工具必须支持：

- 拖动 Slot/Zone；
- 测试不同文本长度；
- 测试中英混排；
- 测试 1～6 个 Metric；
- 测试不同图片比例；
- 查看 Overflow、对象数量、编辑率、Reading Order；
- 批量生成 Golden Deck；
- 发布带版本的 Recipe；
- 回滚 Recipe；
- 查看真实页面接受率。

设计师可以迭代声明式 Recipe，不依赖工程师为每个布局写 React 组件。

### 14.6 Macro

```ts
interface AuthoringMacro<Input> {
  id: string
  version: string
  inputSchema: JsonSchema
  expand(input: Input, context: MacroContext): ElementDraft[]
}
```

Macro 提交后展开成普通对象。Metric Card、Timeline、Process、Quote、Comparison 默认不得升级成持久 Widget。

### 14.7 生成后不隐式重排

Document 可以记录：

```text
provenance.recipeId
provenance.recipeVersion
provenance.slideIrDigest
```

但内容变化后不会自动重新运行 Recipe。用户必须显式执行“重新适配布局”并预览 Diff。

---

## 15. AI 生成与 Hybrid Visual

### 15.1 模型输出边界

模型允许输出：

- Narrative Outline；
- Presentation IR / Slide IR；
- Theme Intent；
- Artwork Brief；
- Layout Candidate 选择；
- 局部 Typed Operations；
- 修复建议。

模型不得直接执行：

- 任意 HTML/CSS；
- JSX/React Component；
- 页面脚本；
- 第三方 Chart 私有配置；
- 未经 Schema 的自由 JSON；
- 直接 DOM Mutation；
- 绕过 Change Contract 的批量写入。

### 15.2 完整生成流水线

```text
用户资料 / 意图
→ 内容提取与事实结构
→ Narrative Outline
→ Presentation IR
→ Slide IR
→ Theme / Style Preset
→ Recipe Candidate
→ Semantic Skeleton
→ Asset / Artwork Resolve
→ Materialize Fixed Frames
→ Reading Order / semanticKey
→ Schema + Geometry Validation
→ Reference Render
→ Visual Review
→ Repair Operations
→ Editability / Exportability Check
→ 用户预览
→ system.document.initialize
```

中间的多轮修复不进入用户默认 Undo；用户接受后形成 Baseline。

### 15.3 Structured

- 主要由 Text、Image、Shape、Chart 构成；
- 适合经营汇报、培训、数据报告；
- 关键对象完整可编辑；
- 便于 PPTX 基础语义映射。

### 15.4 Hybrid

- 标题、数字、正文、Logo、来源保持语义化；
- 复杂氛围、插画、纹理、光影作为 Artwork；
- 默认 AI 视觉策略；
- Artwork 需声明 Safe Text Region、Focal Point 和 Dominant Palette；
- 不允许 Artwork 遮挡或重复关键文字。

### 15.5 Poster

- 视觉优先；
- 允许更高 Artwork 占比；
- 标题、关键数字、CTA、Logo 和来源仍尽量独立；
- GA-C；
- 大改优先整页再设计，不要求手工拆解 Artwork。

### 15.6 Artwork Metadata

```ts
interface ArtworkMetadata {
  subjectBounds?: Rect[]
  safeTextRegions?: Rect[]
  avoidTextRegions?: Rect[]
  dominantPalette?: string[]
  contrastMapAssetId?: AssetId
  focalPoint?: Point
  generationPromptSummary?: string
  generatorId?: string
  generatorVersion?: string
}
```

### 15.7 质量预算

每页同时优化：

```text
内容准确性
叙事清晰度
视觉质量
阅读顺序
关键语义可编辑率
导出兼容性
对象数量
文件体积
Override Debt
```

建议默认预算：

```text
Visual Elements       5～35
Flat Groups           0～8
Artwork Images        0～3
Persistent Widgets    0～1（GA-C）
Key semanticKey       1～12
```

### 15.8 质量评分

```text
readabilityScore
hierarchyScore
spacingScore
contrastScore
assetQualityScore
editabilityScore
exportabilityScore
sourceCompletenessScore
styleConsistencyScore
```

这些分数用于筛选、诊断和实验，不直接替代用户接受率。

---

## 16. Agent 编辑模型

### 16.1 默认 Scope

```text
当前选中对象
→ 当前页
→ 用户明确选择的多页
→ 整份文档
```

“改一下”不得默认重写整份演示。

### 16.2 查询工具

```text
inspect_document
list_slides
get_slide_summary
get_slide
query_elements
get_element
get_selection
get_theme
get_facts
get_sources
get_validation_issues
get_editability_report
render_slide
```

Agent 默认只接收当前 Scope 的语义数据、必要 Facts/Sources 和必要截图。

### 16.3 修改工具

```text
preview_transaction
commit_transaction
undo_transaction
```

生成与重排工具：

```text
regenerate_selection
regenerate_slide
apply_layout_recipe
expand_macro
replace_artwork
sync_fact_references
compare_revised_copy
```

除 `commit_transaction` 外，工具只返回 Draft、Diff 和 Issues。

### 16.4 局部改写示例

用户：

> 第六页标题改得更谨慎，不要改变排版。

系统建立：

```text
Scope = element(el_title)
Allowed Ops = text.replaceContent
Max Changed Elements = 1
Preserve = geometry/style/asset
```

流程：

```text
query_elements(role=title)
→ generate text.replaceContent
→ preview
→ overflow + glyph check
→ structural/semantic diff
→ commit
```

### 16.5 Layout-only 示例

用户：

> 保留全部内容，把这一页排松一点。

系统建立：

```text
Scope = current slide
Allowed Ops = move/resize/align/distribute
Preserve = content/data/asset/style
Max Inserted = 0
Max Deleted = 0
```

Compiler 输出几何 Operations，Preview 后提交。

### 16.6 Visual Redesign 示例

用户：

> 保留标题、三个数字、Logo 和来源，重新做得更现代。

流程：

- 将指定对象转为 Semantic/Fact Anchors；
- 重建 Slide IR；
- 只替换未保护对象；
- 保留或继承 semanticKey；
- 新对象记录 Replacement Lineage；
- 生成 Hybrid 候选；
- 展示内容、身份、样式和视觉 Diff；
- 用户确认后 Commit。

### 16.7 自动提交

只允许：

- 单对象；
- 无删除；
- 不改变 Theme；
- 不替换 Artwork；
- Change Contract 全部通过；
- 无 Warning；
- 用户已为该类低风险操作开启自动提交。

删除、批量修改、Fact 同步、Theme、重排、再设计、Artwork、Patch 合并必须确认。

### 16.8 Prompt Injection

文档、Notes、Sources、Agent Rules、导入资料均为低信任内容：

- 不能覆盖系统或用户规则；
- 不能增加 Scope；
- 不能修改 Change Contract 后在同一事务中使用；
- 不能访问 API Key、任意本地文件、Runtime 源码或未授权附件；
- 搜图、下载、联网单独授权；
- 工具参数再次执行 Schema 和 Policy 校验。

---

## 17. Scope、Change Contract 与 Mutation Budget

### 17.1 Scope

```ts
interface TransactionScope {
  kind: 'selection' | 'slide' | 'document' | 'custom'
  slideIds?: SlideId[]
  elementIds?: ElementId[]
  semanticKeys?: string[]
  permissions: ScopePermission[]
  allowInsert?: boolean
  allowDelete?: boolean
}
```

Scope 只回答“哪些实体和领域允许变化”。

### 17.2 Change Contract

```ts
interface ChangeContract {
  allowedOperationKinds?: OperationKind[]
  allowedElementIds?: ElementId[]
  allowedSemanticKeys?: string[]
  allowedPaths?: JsonPointer[]

  maxChangedSlides?: number
  maxChangedElements?: number
  maxInsertedElements?: number
  maxDeletedElements?: number
  maxReplacedAssets?: number

  preserve?: ChangeInvariants
  requireConfirmation?: boolean
  userIntentSummary?: string
}
```

### 17.3 Invariants

```ts
interface ChangeInvariants {
  content?: 'preserve' | 'allow'
  data?: 'preserve' | 'allow'
  style?: 'preserve' | 'allow'
  geometry?: 'preserve' | 'allow'
  asset?: 'preserve' | 'allow'
  semanticIdentity?: 'preserve' | 'allow-replacement'
  readingOrder?: 'preserve' | 'allow'
  facts?: 'preserve' | 'allow-explicit-sync'
}
```

### 17.4 Mutation Budget

Budget 以实际 Draft Diff 计算，而不是相信 Agent 声明：

```text
changedSlides
changedElements
insertedElements
deletedElements
replacedAssets
changedFacts
changedSources
changedThemeTokens
changedStylePresets
```

超过预算，Preview 失败并返回实际变化摘要。

### 17.5 常用 Contract 模板

#### Content-only

```text
允许 Text/Chart Data 内容变化
禁止 Frame、Style、Asset、Reading Order 变化
```

#### Geometry-only

```text
允许 Move/Resize/Align/Distribute
禁止 Content、Data、Asset、Style 变化
```

#### Style-only

```text
允许 StyleRef、Override、Theme Preset
禁止 Content、Data、Geometry、Asset 变化
```

#### Replace-asset

```text
只允许目标 Image 的 Asset/Crop/FocalPoint
```

#### Full within scope

```text
允许指定 Scope 内结构变化
Protected Anchor、Fact 和用户指定 Invariant 仍强制保留
```

### 17.6 验证顺序

```text
Scope
→ Allowed Operation Kinds
→ Allowed Paths
→ Apply Draft
→ Compute Actual Diff
→ Mutation Budget
→ Invariant Hashes
→ EditPolicy / Anchors
→ Validation
```

Change Contract 是强约束，不是 UI 提示。

---

## 18. Operation Engine

### 18.1 唯一写入口

任何持久化修改必须进入：

```ts
session.preview(transaction)
session.commit(transaction)
```

禁止直接修改 Document 对象。

### 18.2 Transaction

```ts
interface Transaction {
  transactionId: TransactionId
  baseRevision: Revision
  actor: Actor
  scope: TransactionScope
  changeContract: ChangeContract
  reason?: string
  createdAt: string
  validationLevel?: 'L1' | 'L2' | 'L3'
  operations: Operation[]
  metadata?: Record<string, JsonValue>
}
```

### 18.3 Operation 领域

```text
Document / Metadata
Theme / Preset
Slide
Element
Text
Image / Asset
Shape
Chart
Component
Flat Group
Fact / Source
Reading Order
Layout
```

### 18.4 关键操作

```text
document.updateMetadata

theme.setToken
theme.updatePreset

element.insert
element.delete
element.move
element.resize
element.rotate
element.reorder
element.setStyleRef
element.updateStyleOverrides
element.clearStyleOverrides
element.setSemanticKey
element.setEditPolicy

text.replaceContent
text.setOverflowPolicy
text.fitByReducingFont
text.resizeBox

image.replaceAsset
image.setCrop
image.setFocalPoint

chart.replaceData
chart.updateEncoding
chart.updateOptions

group.create
group.delete
group.addMembers
group.removeMembers
group.move
group.resize

slide.setReadingOrder
slide.setProtectedAnchors

fact.upsert
fact.delete
fact.syncReferences
source.upsert
source.delete

layout.align
layout.distribute
```

### 18.5 Flat Group 操作展开

`group.move` 和 `group.resize` 可以作为公开领域 Operation，但 Commit 时展开为同一原子事务中的成员 Element 变化；History 同时保存用户命令摘要和可逆的具体结果。

### 18.6 Commit 流程

```text
Transaction Schema
→ Base Revision
→ Scope
→ Change Contract
→ EditPolicy / Anchors
→ Preconditions
→ Apply to Immutable Draft
→ Actual Diff / Budget / Invariants
→ L1 Fast Validation
→ Optional L2/L3
→ Generate Inverse
→ Atomic Memory Commit
→ New Revision
→ Append History
→ Append Recovery Journal
→ Notify Subscribers
```

任一步失败，Committed Document、Revision 和主 History 均不变化。

### 18.7 Revision

- 来自 Canonical `document.json` 的 SHA-256；
- `document.json` 不保存 Revision；
- Manifest、Session、Patch 保存 `contentRevision`；
- Agent、Patch 与 Merge 必须携带 Base Revision；
- 冲突默认拒绝，不自动覆盖；
- Session 内可以用增量脏标记降低重复计算，但 Checkpoint 必须全量复核 Canonical Hash。

### 18.8 Undo / Redo

- 每个成功事务生成逆事务；
- Undo/Redo 也是新事务；
- 连续文字输入合并；
- 拖动只提交最终结果；
- 删除保存完整逆向对象与 Asset 引用；
- Group 命令保存成员原始 Frame；
- Fact Sync 保存所有受影响位置；
- Patch 合入可以整体 Undo，也可以按接受单元拆分。

### 18.9 Transient State

```text
拖动 / 缩放 / 裁切 / 输入
→ Transient Preview
→ 不改 Revision，不进 History，不写正式文件
→ 交互结束生成一个 Transaction
```

崩溃保护可记录受控编辑草稿，但不得被当作正式 Commit。

---

## 19. Validation、Diff 与错误模型

### 19.1 L0：Transient

执行：

- 有限数值；
- 最小尺寸；
- 基础边界；
- 交互吸附；
- 局部渲染。

不执行全量 Hash、截图和模型评估。

### 19.2 L1：人工事务

执行：

- Operation Schema；
- Revision；
- Scope；
- Change Contract；
- 引用完整性；
- Flat Group Membership；
- Geometry；
- Asset 存在；
- Text Overflow 快速检查；
- EditPolicy。

目标 P95：普通 Commit ≤100ms，Text Commit ≤150ms。

### 19.3 L2：Open / Save / Export

执行：

- 完整 Document Schema；
- Element/SemanticKey/Group 唯一性；
- Asset/Font Hash；
- Fact/Source 引用；
- Reading Order；
- Glyph Coverage；
- 全页边界和 Overflow；
- Widget Requirements；
- Package/Profile/Export Capability。

### 19.4 L3：Agent / Regenerate / Merge

在 L1/L2 基础上增加：

- Actual Mutation Budget；
- Invariant Hash；
- Protected Anchor；
- semanticKey/Lineage；
- 非目标对象变化；
- Fact/Source 一致性；
- Targeted Visual Diff；
- Brand/Style Preset；
- Reading Order；
- Editability/Exportability；
- Conflict Detection。

### 19.5 L4：CI / Release

- Contract Deck；
- Golden Screenshot；
- 多浏览器；
- Property/Fuzz；
- Migration Corpus；
- Journal/Checkpoint Fault Injection；
- Patch/Three-way Merge；
- Portable Security；
- Export E2E；
- Agent/Change Contract；
- Recipe Determinism；
- Font/Glyph Matrix；
- User Task Smoke。

### 19.6 Structural Diff

显示：

- 页面新增、删除、移动；
- Element 新增、删除、修改；
- Group 关系变化；
- StyleRef/Override；
- Theme/Preset；
- Fact/Source；
- Reading Order；
- Asset；
- Protected Anchor；
- Visual Strategy。

### 19.7 Semantic Diff

显示：

- `semanticKey` 对象内容变化；
- 对象替换谱系；
- Fact 值变化；
- Source 变化；
- 关键数字和单位；
- Content-only/Layout-only Invariant；
- 同一业务对象从旧实例到新实例的迁移。

### 19.8 Visual Diff

仅 Agent、再生成、Theme、Merge 和导出验证运行：

- 修改前后截图；
- 目标 Scope；
- 非目标像素变化；
- Overflow；
- 遮挡和越界；
- Artwork 替换区域；
- Anchor 边界；
- 字体 fallback 风险。

### 19.9 错误级别

```text
Error   → 阻止 Commit/Save/Export
Warning → 明确显示后可继续
Info    → 建议，不阻断
```

错误必须说明：发生了什么、影响哪里、内容是否安全、能否保存、如何恢复。

---

## 20. Geometry 与 Flat Group

### 20.1 坐标空间

```text
Screen Space
Viewport Space
Slide Canvas Space
Element Local Space
```

v2.3 不存在持久化 Group Local Space。

### 20.2 Flat Group

```ts
interface LogicalGroup {
  id: GroupId
  name?: string
  semanticKey?: string
  memberIds: ElementId[]
  locked?: boolean
  editPolicy?: EditPolicy
}
```

规则：

- Group 不在 `Element` Union；
- Group 不渲染；
- Group 无 Frame、Rotation、Flip；
- Element Frame 永远相对 Slide；
- 同一 Element 最多属于一个 Group；
- Group 不允许包含 Group；
- `rootOrder` 仍列出所有可视 Element；
- Group 删除默认只删除关系，不删除成员；
- Group 作为 Agent Scope 时解析为成员集合。

### 20.3 Group Move

```text
计算成员当前 Frame
→ 对每个成员应用 dx/dy
→ 一个 Transaction Commit
```

### 20.4 Group Resize

```text
计算成员总包围盒
→ 将目标包围盒与原包围盒建立比例
→ 对每个成员 Frame 进行仿射缩放
→ Text 只缩放 Frame，不自动缩放字号
→ Preview Overflow
→ 一个 Transaction Commit
```

需要同时缩放文字字号时，必须由显式 Change Contract 允许 Style 变化。

### 20.5 Group Rotate

GA-A 不提供 Group Rotate。用户可以：

- 旋转单个元素；
- 解组后逐个旋转；
- 使用 Regenerate 重新布局。

Group Rotate 可在后续版本以显式成员变换实现，不引入 Group 坐标系。

### 20.6 导入嵌套 Group

- 能无损物化到 Slide Frame 时 Flatten；
- 无法稳定 Flatten 时，保留为受控只读对象或 Artwork；
- 生成迁移报告；
- 不静默丢失；
- 不因此把嵌套 Scene Graph 引入 Core。

### 20.7 命中和选择

- Hit Test 只针对可视 Element；
- 点击组内成员后，第一次可以选中 Group Selection；
- 双击或 Enter 进入成员选择；
- Alt/Option 穿透选择；
- Group Selection 是 UI 派生状态，不写入 Document。

### 20.8 对齐和分布

使用成员/选择对象的 Slide Frame：

```text
left / center-x / right
top / center-y / bottom
equal-gaps / equal-centers
```

Snapping 阈值以屏幕像素定义，再换算为 `du`。

---
## 21. Renderer Contract

### 21.1 定位

Renderer 是 Semantic Document 的确定性只读视图：

```text
Document Snapshot
→ Theme/Style Resolve
→ Element Renderer
→ DOM / SVG /受控 Canvas
```

Renderer 不能修改 Document，也不能把 DOM 状态回写成内容。

### 21.2 渲染分配

```text
Text       → HTML DOM
Image      → img + clip container
Shape      → SVG
Chart      → SVG 优先，必要时受控 Canvas
Component  → Trusted Registry
Selection  → 独立 Editor Overlay
```

Group 不渲染。

### 21.3 Slide Root

- 固定 `width/height` 逻辑画布；
- Host 根据可用空间计算统一 Scale；
- 元素使用绝对 Frame；
- 不使用响应式重排；
- 浏览器窗口变化不改变 Document；
- Editor Overlay 与内容树分离。

### 21.4 确定性要求

禁止以下因素无声明影响结果：

- 当前时间；
- `Math.random()`；
- 未固定字体；
- 未声明网络请求；
- DOM 顺序依赖的隐式布局；
- 第三方库随机颜色；
- 异步 Asset 未 Ready 即截图；
- 运行时临时 CSS Patch。

### 21.5 Renderer Ready Gate

```text
Document Valid
+ Theme Resolved
+ Required Fonts Ready/Fallback Resolved
+ Images Decoded
+ Charts Ready
+ Components Ready/Fallback Ready
→ rendererReady
```

导出、Golden Screenshot 和 Visual Diff 必须等待 Ready Gate。

### 21.6 Reference Runtime

Host 固定参考 Chromium/浏览器版本、字体配置和渲染参数。Portable 支持多浏览器，但像素级基准以 Reference Runtime 为准。

### 21.7 缓存

可缓存：

- Slide Thumbnail；
- Text Measurement；
- Chart Layout；
- Sanitized SVG；
- Artwork Contrast Map。

Cache Key 必须包含对应内容 Hash、Theme/Style、Font/Runtime Fingerprint。Cache 永远可删除重建。

### 21.8 错误隔离

- 每个 Chart/Component 有 Error Boundary；
- 单个对象失败显示可诊断 Placeholder；
- 不允许单对象导致整份文档白屏；
- 导出失败不得静默跳过页面；
- Viewer 可只读打开可恢复内容。

---

## 22. AI 后编辑器

### 22.1 产品形态

```text
┌─────────────────────────────────────────────────────────────┐
│ 文件  编辑  插入  设计  演示  AI       保存  撤销  导出    │
├────────────┬───────────────────────────┬────────────────────┤
│ 页面缩略图 │        当前页面画布       │ 属性 / AI / 问题    │
│            │                           │                    │
│ 排序       │  选择、改字、换图、微调   │ Preset / Override  │
│ 复制       │                           │ Fact / Source      │
├────────────┴───────────────────────────┴────────────────────┤
│ 备注       保存状态      验证问题       缩放       放映      │
└─────────────────────────────────────────────────────────────┘
```

### 22.2 一级操作

- 改文字；
- 换图片；
- 移动、缩放、基础旋转；
- Flat Group；
- 对齐、分布；
- 页面复制、删除、排序；
- Style Preset 与少量 Override；
- “重排当前页”；
- “重新设计当前页”；
- “保留内容重新生成”；
- “比较修订副本”。

### 22.3 模式状态机

```ts
type EditorMode =
  | 'select'
  | 'text-edit'
  | 'image-crop'
  | 'pan'
  | 'present'
  | 'review'
  | 'readonly'
```

GA-A 不提供自由路径绘制、复杂动画时间线、母版、嵌套 Group 和通用组件插入器。

### 22.4 Selection

```ts
interface SelectionState {
  slideId: SlideId
  elementIds: ElementId[]
  groupId?: GroupId
  primaryElementId?: ElementId
}
```

Selection 为会话状态，不进入 Document。

### 22.5 Transient Interaction

拖动、缩放、裁切和文字输入过程中只更新 Transient Layer。结束时产生一个 Transaction。

### 22.6 Inspector

根据对象显示：

- Content；
- Frame；
- StyleRef；
- Typed Overrides；
- EditPolicy；
- semanticKey；
- Fact/Source Ref；
- Asset；
- Overflow；
- Provenance；
- Change History。

普通用户默认只看到高频项；技术字段放入高级/诊断面板。

### 22.7 Style UX

对象样式面板优先显示：

```text
样式预设
当前局部覆盖
重置为预设
保存为新预设
```

不要只展示几十个独立 CSS 属性。

### 22.8 Overflow UX

文本溢出时就地显示：

```text
缩短文字
扩大文本框
减小字号
截断
撤销
```

任何选项都形成显式 Operation 和 Diff。

### 22.9 Clipboard

- 同文档复制保留 semanticKey 时需要避免当前 Slide 冲突；
- 默认为副本生成新的 Element ID；
- 跨文档复制重映射 Asset/Fact/Source ID；
- 复制受保护对象时保留内容但不自动继承宿主权限；
- 粘贴外部 HTML 只提取白名单文本/图片；
- 不导入脚本和任意 Style。

### 22.10 保存状态

用户可见状态：

```text
已修改
正在保存
已保存
可恢复但尚未写入文件
保存失败
只读恢复
```

普通情况下 Journal 与 Checkpoint 很快完成，只显示“正在保存/已保存”；只有 Checkpoint 长时间失败时才显示“可恢复但尚未写入文件”。

### 22.11 Review 模式

用于比较修订副本：

- 左右或叠加查看；
- 按 Slide、semanticKey、Fact、字段分组；
- 接受/拒绝单项；
- 冲突手工选择；
- 预览合入后的页面；
- 所有接受项形成普通 Transaction。

---

## 23. `.ppte` 工作文件、Checkpoint 与 Recovery Journal

### 23.1 `.ppte` 定位

`.ppte` 是唯一标准工作文件和正式交换源，采用 ZIP 容器：

```text
/mimetype
/manifest.json
/document.json
/assets/index.json
/assets/<sha256>.<ext>
/fonts/index.json
/fonts/<sha256>.woff2
/history/descriptor.json
/history/recent.jsonl
/previews/<slideId>.webp
/diagnostics/...
```

Runtime、React Bundle、Recipe/Macro 代码、模型凭据、Recovery Journal 不进入 `.ppte`。

### 23.2 Manifest

```json
{
  "format": "ppte",
  "formatVersion": "2",
  "schemaVersion": "2.0.0",
  "operationProtocolVersion": "1.0",
  "compatibilityProfile": "ppte-2.0-ga-a.1",
  "documentId": "doc_...",
  "contentRevision": "sha256-...",
  "title": "客户方案",
  "createdAt": "RFC3339",
  "updatedAt": "RFC3339",
  "requiredWidgets": [],
  "clean": false,
  "files": []
}
```

### 23.3 `.ppte` 是 Checkpoint

正式保存流程：

```text
Committed Snapshot
→ Canonical Serialize
→ Calculate Full Revision
→ Build New Package .tmp
→ Include required Assets/Fonts
→ Reopen and Validate
→ fsync
→ Atomic Rename
→ fsync Directory where supported
→ Clear Recovery Marker
```

不在原 ZIP 中随机修改条目。

### 23.4 Recovery Journal

Journal 存放于 Host 私有恢复目录，而不是工作文件内部：

```ts
interface RecoveryJournalHeader {
  documentId: DocumentId
  baseCheckpointRevision: Revision
  sessionId: string
  createdAt: string
  lastTransactionId?: TransactionId
}
```

Journal 追加：

- 已成功 Commit 的 Transaction；
- 必要的新 Asset CAS 引用；
- 可选、受控的 Text 草稿；
- Checksum 与序列号。

Journal 不保存：

- 未经 Commit 的普通 Transient；
- API Key；
- 完整模型会话；
- 无限历史；
- 无 Base Revision 的孤立 Operation。

### 23.5 自动保护与 Checkpoint 频率

建议：

```text
Commit 成功
→ 100～300 ms 内 Append Journal

显式 Ctrl/Cmd+S
→ 立即 Checkpoint

空闲 20～30 秒
→ Checkpoint

窗口失焦 / 应用进入后台 / 正常关闭
→ 尝试 Checkpoint
```

大文档可以延长空闲 Checkpoint，但 Journal 必须保持及时。

### 23.6 恢复

打开文件时：

1. 读取 `.ppte` Checkpoint；
2. 查找相同 `documentId + baseCheckpointRevision` 的 Journal；
3. 校验 Journal 顺序和 Checksum；
4. 在隔离 Draft 上重放；
5. 执行 L2 Validation；
6. 提示恢复、另存或放弃；
7. 成功 Checkpoint 后清理 Journal。

Base Revision 不匹配时不自动重放。

### 23.7 Asset CAS

Host 内部可使用 Content Addressed Store：

```text
导入/生成 Asset
→ 写 CAS by SHA-256
→ Document 引用 Asset Metadata
→ Journal 引用 CAS Blob
→ Checkpoint 时复制必需 Blob 到 .ppte
```

`.ppte` 最终仍然自包含。CAS 是 Host 优化，不是文件真源。

### 23.8 History Profile

#### Standard Working

- 当前 Snapshot；
- 最近 200 个可逐步 Undo Transaction；
- 历史 Descriptor；
- 深层历史可在 Host 私有存储保留。

#### Audit Working

- 按企业策略携带更完整 History；
- 有容量上限；
- 敏感内容和 Agent 会话仍需策略控制。

#### Clean

- 移除 History、私密 Notes、会话、未使用 Asset、本机路径和非交付 Extension。

History 使用 Snapshot + Tail，不要求新 Runtime 永久理解全部旧 Operation。

### 23.9 安全限制

- Zip Slip；
- Zip Bomb；
- 条目数量；
- 单 Asset/总解压大小；
- MIME/Magic Bytes；
- SVG 清洗；
- Hash；
- RichText 大小；
- Slide/Element 数量；
- Extension Payload 大小。

超限文件只读或拒绝，不能无提示耗尽内存。

---

## 24. Portable Runtime：Viewer、Quick Fix 与 Light Edit

### 24.1 定位

`.ppte.html` 是从 `.ppte` 生成的派生发布物，不是平行工作真源。

### 24.2 三种 Profile

#### Viewer（GA-A）

- 离线播放；
- 全屏、翻页、Click Steps、备注；
- 不含编辑器；
- 可以按当前字符激进子集化字体；
- 体积最小。

#### Quick Fix（GA-A）

- 修改 Text 内容；
- 替换 Image；
- 修改 Fact-backed 简单数字（GA-B）；
- Undo；
- 保存为新 `.ppte` 或新 Portable；
- 不提供裁切、Group、Chart 表格、自由几何；
- 不包含完整 Agent/Generation Engine。

#### Light Edit（GA-C）

- Image Crop；
- Chart Data；
- 简单 Move/Resize；
- 更完整 Inspector；
- 仍不复制 Host 全部功能。

### 24.3 Origin Metadata

```ts
interface PortableOrigin {
  sourceDocumentId: DocumentId
  sourceRevision: Revision
  derivedAt: string
  profile: 'viewer' | 'quick-fix' | 'light-edit'
  runtimeVersion: string
  branchId?: string
}
```

### 24.4 保存行为

允许：

```text
保存为新的 .ppte 项目
保存为新的 .ppte.html 发送副本
导出 PDF/PNG（能力允许时）
```

禁止声称：

- 已同步回发送者；
- 已覆盖原工作文件；
- 无冲突合并历史；
- 当前副本就是源项目最新版。

### 24.5 Quick Fix 字体规则

Viewer 可只包含原字符子集；Quick Fix 中可编辑 Text 必须满足至少一种：

1. 嵌入字体覆盖允许输入的字符；
2. 使用明确的系统安全字体栈；
3. Commit 时检测缺字并让用户显式切换兼容字体；
4. 标记为 Viewer-only，不允许当前文本直接编辑。

禁止缺字后静默 fallback。

### 24.6 Glyph Coverage

```ts
interface FontAsset {
  id: FontId
  family: string
  weight: number
  style: 'normal' | 'italic'
  source: 'embedded' | 'system' | 'fallback'
  subset?: boolean
  glyphCoverage?: UnicodeRange[]
  editableSafe?: boolean
  fallbackFamilies?: string[]
  license?: string
}
```

Text Commit 前检查新增 Grapheme 是否可覆盖。问题提示：

```text
改用兼容字体
在 Host 中补充字体
继续并接受布局风险
取消
```

### 24.7 Bundle 预算

不含 Asset/Font：

```text
Viewer gzip       ≤ 1.2 MB 目标
Quick Fix gzip    ≤ 2.0 MB 目标
Light Edit gzip   ≤ 3.0 MB 目标
```

### 24.8 安全

- 固定官方 Runtime；
- CSP；
- 默认不联网；
- 不保存 API Key；
- Payload 编码并 Schema Validation；
- Host 导入时只提取 Payload，不执行 HTML Script；
- 只打开可信来源 HTML；
- 企业环境可优先发送 `.ppte`、PDF 或链接。

---

## 25. 修订副本比较与 `.ppte.patch`

### 25.1 目标

解决真实文件工作流：

```text
原作者发送副本
→ 接收者修改
→ 返回修订文件
→ 原作者查看并接受修改
```

不引入实时多人协作和 CRDT。

### 25.2 前提

最佳情况：

```text
共同 documentId
+ 共同 baseRevision
+ Origin Metadata
```

若缺少共同 Base，只能做两方启发式比较，不能自动合并。

### 25.3 三方语义 Diff

```text
Base Checkpoint
+ Local Head
+ Revised Head
→ Three-way Semantic Diff
```

匹配优先级：

1. 相同 `elementId`；
2. 相同 `semanticKey`；
3. Replacement Lineage；
4. Fact/Source ID；
5. 内容与空间启发式，仅作为人工建议。

### 25.4 自动可接受修改

满足以下条件可生成无冲突候选：

- 不同 Element；
- 或同一 Element 的不同字段；
- 本地未改、修订方已改；
- 不违反 EditPolicy/Anchor；
- Asset 可用；
- Change Contract/Validation 通过。

同一字段双方都改，标记冲突。

### 25.5 Review Unit

接受单位可以是：

```text
单字段
单 Element
单 semanticKey
单 Fact
单 Slide
完整 Patch
```

每次接受形成正常 Transaction，可 Undo。

### 25.6 Patch 格式

```text
/mimetype                       application/vnd.ppte.patch+zip
/patch-manifest.json
/operations.jsonl
/assets/<sha256>.<ext>
/fonts/<sha256>.woff2（必要时）
/previews/...
```

```ts
interface PatchManifest {
  patchVersion: '1'
  documentId: DocumentId
  baseRevision: Revision
  headRevision?: Revision
  createdAt: string
  actor?: Actor
  operationProtocolVersion: string
  compatibilityProfile: string
  files: FileEntry[]
}
```

### 25.7 Patch 规则

- Operation 必须带 Base Revision/Precondition；
- 仅包含实际需要的新 Asset/Font；
- 应用前完整校验；
- 不执行代码；
- 不能自动提升权限；
- Base 不匹配时进入 Compare，不直接 Commit；
- Patch 可以被拒绝、部分接受和整体 Undo。

### 25.8 UI

```text
比较修订副本
导入修改包
查看 12 项修改 / 2 项冲突
接受所选
拒绝所选
预览合入结果
```

“版本合并”不应该伪装成实时协作。

---

## 26. Asset 与 Font 系统

### 26.1 Asset

```ts
interface Asset {
  id: AssetId
  hash: string
  mimeType: string
  byteLength: number
  path: string
  width?: number
  height?: number
  durationMs?: number
  source?: AssetSource
  license?: string
  altText?: string
  artwork?: ArtworkMetadata
}
```

### 26.2 Asset 规则

- SHA-256 内容去重；
- 校验 MIME 与 Magic Bytes；
- 远程资源导入后本地化；
- 禁止路径逃逸；
- SVG 清洗或栅格化；
- 删除元素后 Asset 进入延迟 GC；
- Undo 所需 Asset 不提前删除；
- Clean/Portable 清理未使用 Asset；
- 大视频可使用目录型发布物而不是单 HTML；
- 记录来源和许可证；
- 不使用远程 URL 作为关键内容唯一来源。

### 26.3 Font 规则

- 记录 Family/Weight/Style/Source/License；
- Host Reference Runtime 为排版基准；
- 可嵌入字体使用 WOFF2；
- CJK 可以使用系统安全字体栈；
- Viewer 可子集化；
- Quick Fix 必须检查 Glyph Coverage；
- 字体变化触发相关 Text 重测和缩略图失效；
- 导出前 Font Preflight；
- PPTX 报告字体替换；
- 不允许因字体未加载而提交错误测量。

### 26.4 字体指纹

```text
family
weight
style
source hash / system fingerprint
coverage digest
fallback chain
runtime fingerprint
```

用于 Text Measurement Cache 和渲染诊断。

---

## 27. 演示与动画

### 27.1 定位

演示必须可靠，但不建设复杂动画创作工具。

### 27.2 Click Steps

Element 只保存：

```ts
appearStep?: number
```

- 非负整数；
- 同一步可出现多个对象；
- 播放状态不进入 Document Revision；
- Agent 默认保留；
- PDF 默认导出最终状态，可显式按步骤展开。

### 27.3 入场动画

首版只允许预设：

```text
none
fade
slide-up
slide-left
scale
```

保存 Preset/Duration/Delay，不保存任意 Keyframes 或脚本。

### 27.4 页面转场

```text
none
fade
slide
push
```

无路径动画、时间线和自定义 CSS Transition Editor。

### 27.5 Presenter

- 当前页；
- 下一页；
- Notes；
- 页码；
- 计时；
- 键盘控制；
- 可选激光点。

录制、摄像头、直播和远程遥控后置。

---

## 28. 导出与导入

### 28.1 原则

所有导出读取 Semantic Document，不从 Editor DOM 反向猜内容。Reference Renderer 是 PDF/PNG 与视觉降级的统一基础。

### 28.2 PDF / PNG

- 固定 Reference Runtime；
- 等待 Ready Gate；
- L2 Validation；
- 每页失败不静默跳过；
- 支持单页/整份；
- PNG 透明背景为显式选项；
- Structured/Hybrid/Poster 共用 Renderer。

### 28.3 Static Web / Portable

- Viewer `.ppte.html`；
- Quick Fix `.ppte.html`；
- 目录型站点用于大视频；
- 只读发布可以移除所有编辑代码。

### 28.4 PPTX

#### GA-B 图片型

每页作为高质量图片，保证视觉交付。

#### GA-C 基础语义

尽量映射：

```text
Text → Text Box
Image/Artwork → Picture
Shape → Native Shape
Flat Group → 坐标物化或 Group
简单 Chart → Native Chart 或 SVG
```

降级：

```text
复杂 Chart → SVG/PNG
Component → Fallback
Poster → Artwork Image
动画 → 最终静态状态
字体 → 嵌入/替换/提示
```

### 28.5 Capability Report

```text
原生可编辑
属性可编辑
已栅格化
已静态化
字体替换
布局风险
缺少来源
不支持
```

不支持内容不得静默消失。

### 28.6 导入

2.0 保证：

- PPTe 2.x；
- 旧 PPTe/Slidev-era 迁移；
- Safe Image/SVG；
- CSV/JSON Chart Data；
- WOFF2；
- Plain/Limited Rich Text；
- `.ppte.patch`。

PPTX 语义导入单独立项，不阻塞核心 GA。

---

## 29. 安全模型

### 29.1 `.ppte`

- 纯数据，不执行代码；
- 全部字段 Schema Validation；
- RichText 不接受 HTML；
- Component 只引用 Host Registry；
- Asset/Font/Extension 限额；
- URL/SVG/ZIP 清洗；
- 文档不能提升权限；
- Recipe/Macro/Slide IR Compiler 代码不进入文件。

### 29.2 `.ppte.html`

- 本质是 HTML，只打开可信来源；
- 官方 CSP；
- 默认无网络；
- 无 API Key；
- 不暴露任意文件系统；
- Host 导入只提取 Payload；
- Viewer/Quick Fix 不含完整 Agent 和生成引擎。

### 29.3 Journal/CAS

- Journal 与 CAS 位于 Host 私有目录；
- 文件名和路径不进入遥测；
- Journal 绑定 Base Revision；
- Asset Blob 校验 Hash；
- 成功 Checkpoint 后按策略清理；
- 多用户系统隔离工作区；
- 不允许 Journal 成为绕过文档权限的旁路。

### 29.4 Agent

- 最小 Scope；
- Change Contract；
- 白名单工具；
- Revision/Precondition；
- Prompt Injection 防护；
- 在线发送范围确认；
- API Key 永不入文档；
- 文档不能在同一事务中放宽权限并立即使用。

### 29.5 Patch/Merge

- Patch 为数据包；
- 校验 Base Revision；
- 不执行脚本；
- Asset 清洗；
- 冲突不自动覆盖；
- 合入仍经过 Change Contract 和 Validation。

### 29.6 Threat Model

至少覆盖：

```text
Zip Slip / Zip Bomb
MIME Spoofing
Malicious SVG
RichText Injection
Portable Payload Injection
Prompt Injection
Path Traversal
Oversized Extension
Corrupt Journal
Patch Replay
Revision Confusion
Font Bomb
Asset License Leakage
```

---

## 30. 性能、缓存与可观测性

### 30.1 Typical Deck

```text
30 页
600～900 个可视 Element
0～120 个 Flat Group
50 MB Asset
5～20 个字体文件/系统字体引用
```

### 30.2 性能预算

```text
Host Open to Interactive        P95 ≤ 2.0 s
Page Switch                     P95 ≤ 100 ms
Selection                       P95 ≤ 50 ms
Human L1 Commit                 P95 ≤ 100 ms
Text Commit                     P95 ≤ 150 ms
Journal Append                  P95 ≤ 100 ms
Undo / Redo                     P95 ≤ 100 ms
Portable Viewer First Screen    P95 ≤ 2.0 s
Portable Quick Fix First Screen P95 ≤ 2.5 s
Checkpoint 50 MB                P95 ≤ 3.0 s 目标设备
PDF Export Success              ≥ 99%
```

### 30.3 增量工作

Session 内使用：

- Slide 级 Dirty 标记；
- Element/Fact/Source 级 Hash 缓存；
- Incremental Derived Index；
- Text Measurement Cache；
- Thumbnail Cache；
- Asset CAS；
- Worker 执行 L2/L3、Hash、Diff 和 Package。

Checkpoint 时必须全量 Canonical Serialize 与 Hash 复核。

### 30.4 异步 Job

Agent、Regenerate、Artwork、Export、Checkpoint、Merge 可以作为异步 Job，但：

- 不阻塞基础编辑；
- 有进度和取消；
- Draft 与 Commit 分离；
- 失败可恢复；
- 不承诺后台异步交付；
- UI 明确当前 Revision 是否变化。

### 30.5 诊断事件

```text
document_open_started/completed/failed
journal_append_completed/failed
checkpoint_started/completed/failed
recovery_detected/applied/rejected
transaction_previewed/committed/rejected
change_contract_violation
semantic_identity_rebound
text_overflow_detected
font_glyph_missing
regenerate_started/accepted/rejected
patch_compared/applied/conflicted
portable_exported/saved_as_project
export_completed/degraded/failed
runtime_error
```

### 30.6 隐私

默认不上传：

- 文档正文；
- Notes；
- 图片内容；
- 完整 Prompt；
- 文件路径；
- 用户身份；
- Agent 对话；
- Source 全文。

匿名指标只记录能力、规模区间、时延、错误码和任务是否成功。内容级诊断必须显式同意。

---
## 31. 规范、版本与 Compatibility Profile

### 31.1 独立版本

```text
formatVersion
→ .ppte 容器与 Manifest

schemaVersion
→ document.json

operationProtocolVersion
→ Transaction / Operations / Agent / Patch

slideIrVersion
→ Design Compiler 输入

widgetAbiVersion
→ Controlled Component

portableRuntimeVersion
→ Viewer / Quick Fix / Light Edit

layoutRecipeVersion
→ Recipe Spec

patchVersion
→ .ppte.patch
```

### 31.2 Compatibility Profile

独立版本之上发布经过验证的组合：

```json
{
  "compatibilityProfile": "ppte-2.0-ga-a.1",
  "formatVersion": "2",
  "schemaVersion": "2.0.0",
  "operationProtocolVersion": "1.0",
  "slideIrVersion": "1.0",
  "portableRuntimeVersion": "2.0.0",
  "layoutRecipeVersion": "1.0",
  "widgetAbiVersion": null,
  "patchVersion": null
}
```

GA-B、GA-C 发布新的 Profile，不要求所有版本任意组合都被支持。

### 31.3 Schema 兼容

- 同一主版本只允许向后兼容新增；
- 未知非关键字段必须保留；
- 未知 Core Element Type 不允许静默跳过；
- 未知 Component 优先使用 Fallback；
- 更高不兼容主版本只读打开；
- Migration 只向前执行；
- 原文件不原地覆盖；
- Group 从嵌套模型迁移到 Flat Group 必须显式物化坐标。

### 31.4 Extension Envelope

```ts
interface ExtensionEnvelope {
  namespace: string
  version: string
  required: boolean
  byteLength: number
  payload: JsonValue
}
```

规则：

- Namespace 必须带组织/产品前缀；
- 单项和总大小有限制；
- `required=false` 未识别时保留并继续；
- `required=true` 未识别时只读或拒绝；
- 不得改变 Core 渲染、权限、Group、Operation、Revision 和保存语义；
- 不得执行代码；
- 不得把关键内容藏在伪装为非必需的 Extension 中。

### 31.5 History 兼容

```text
Snapshot@schemaVersion
+ Tail Operations@operationProtocolVersion
```

迁移优先迁移 Snapshot。旧 Operation 可以保留审计，但超出支持窗口后不作为重建当前内容的唯一来源。

### 31.6 RFC 门槛

必须 RFC：

- 新增 Core Element；
- 将 Group 重新变成坐标容器；
- 引入响应式布局真源；
- 修改 Text Content Model；
- 允许文件代码或第三方联网 Component；
- `.ppte.html` 成为工作真源；
- 修改 Canonical Hash；
- 引入第二套 Document Store；
- 绕过 Change Contract/Operation Engine；
- PPTX 成为内容源；
- 引入 Slidev；
- Fact 变成隐藏实时绑定；
- Recovery Journal 成为长期唯一真源。

### 31.7 规范优先级

发生歧义时：

1. Runtime JSON Schema；
2. TypeScript Contract；
3. ADR；
4. Contract Test；
5. 本文；
6. UI 稿和产品文案。

实现不能以“代码已经这样写了”为理由反向改变格式。

---

## 32. Core API、SDK 与 CLI

### 32.1 Session API

```ts
interface PpteSession {
  getDocument(): Readonly<PpteDocument>
  getRevision(): Revision
  getSaveState(): SaveState

  preview(transaction: Transaction): Promise<PreviewResult>
  commit(transaction: Transaction): Promise<CommitResult>
  undo(): Promise<CommitResult>
  redo(): Promise<CommitResult>

  compare(revised: PpteDocument, base?: PpteDocument): Promise<CompareResult>
  applyPatch(patch: PptePatch, options: PatchApplyOptions): Promise<PreviewResult>

  checkpoint(target: SaveTarget): Promise<CheckpointResult>
  subscribe(listener: SessionListener): () => void
}
```

React 使用 `useSyncExternalStore` 或等价订阅，不持有可变 Document。

### 32.2 Design Compiler API

```ts
interface DesignCompiler {
  compilePresentation(ir: PresentationIR, context: CompileContext): Promise<PresentationDraft>
  compileSlide(ir: SlideIR, context: CompileContext): Promise<CompiledSlideDraft>
  reflowSlide(slideId: SlideId, request: ReflowRequest): Promise<PreviewResult>
  redesignSlide(slideId: SlideId, request: RedesignRequest): Promise<PreviewResult>
}
```

### 32.3 Reviewer API

```ts
interface PpteReviewer {
  compare(base: PpteDocument, local: PpteDocument, revised: PpteDocument): CompareResult
  buildAcceptTransaction(selection: ReviewSelection): Transaction
  exportPatch(selection: ReviewSelection): PptePatch
}
```

### 32.4 File API

```ts
interface PpteFileService {
  open(pathOrBytes: FileInput): Promise<OpenResult>
  checkpoint(document: PpteDocument, target: SaveTarget): Promise<CheckpointResult>
  exportClean(document: PpteDocument): Promise<Uint8Array>
  buildPortable(document: PpteDocument, profile: PortableProfile): Promise<Uint8Array>
}
```

### 32.5 CLI

```text
ppte validate deck.ppte
ppte inspect deck.ppte
ppte render deck.ppte --out previews/
ppte export deck.ppte --format pdf
ppte portable deck.ppte --profile viewer
ppte portable deck.ppte --profile quick-fix
ppte diff base.ppte revised.ppte
ppte patch create base.ppte revised.ppte --out changes.ppte.patch
ppte patch apply deck.ppte changes.ppte.patch --preview
ppte migrate legacy.ppte.html --out migrated.ppte
ppte recipe test recipes/ --corpus corpus/
```

CLI 默认不执行文档代码，不隐式联网。

### 32.6 Error Contract

```ts
interface PpteError {
  code: string
  message: string
  severity: 'error' | 'warning' | 'info'
  slideId?: SlideId
  elementId?: ElementId
  semanticKey?: string
  factId?: FactId
  path?: JsonPointer
  recovery?: string
  causeId?: string
}
```

禁止只返回 “Something went wrong”。

---

## 33. 测试、CI 与发布门禁

### 33.1 测试金字塔

```text
Schema / Canonicalization / Pure Functions
→ Operations / Change Contract / Geometry / Migration
→ Slide IR / Recipe / Macro Compiler
→ Renderer / Text / Font Contract
→ Editor Interaction
→ Agent / Regenerate / Review Contract
→ Journal / File / Portable / Export E2E
→ User Task Test
```

### 33.2 Schema 测试

- 每类合法文档；
- 重复 semanticKey；
- Reading Order 重复/缺失；
- Flat Group 重复成员；
- Fact/Source 缺失；
- 未知 Element；
- 未知 Extension；
- 超大字符串/数组；
- NaN/Infinity/-0；
- 恶意路径；
- 更高 Schema 只读；
- 旧 Group 迁移。

### 33.3 Operation / Change Contract 测试

- 每个 Operation 正向和逆向；
- Transaction 原子性；
- Base Revision 冲突；
- Scope 越界；
- Allowed Operation Kind；
- Allowed Path；
- Max Changed/Insert/Delete；
- Preserve Content/Geometry/Style/Asset；
- Protected Anchor；
- Fact Sync；
- Patch Apply；
- Undo/Redo；
- 随机 Operation Sequence。

### 33.4 Identity 测试

- 直接编辑保持 ID/semanticKey；
- 再生成正确继承 semanticKey；
- Replacement Lineage 无环；
- Copy/Paste 重映射；
- Review 可把替换识别为同一业务对象；
- Anchor 通过 semanticKey 重新绑定；
- 歧义时不自动绑定。

### 33.5 Flat Group 测试

- Create/Delete/Add/Remove；
- 同一元素不能属于多个 Group；
- 不允许嵌套；
- Move/Resize 物化正确；
- Text Frame 缩放不暗中改字号；
- Undo 恢复所有成员；
- 导入嵌套 Group 可 Flatten 或明确降级；
- 10,000 次随机组操作不破坏 Schema。

### 33.6 Text / Font 测试

- 中文输入法；
- 英文、中英混排、Emoji；
- 单级列表；
- Run Mark；
- Paste 清洗；
- Overflow；
- 显式 Fit；
- Font Ready；
- Glyph Coverage；
- Quick Fix 新字符；
- 保存重开；
- PDF/PNG 一致；
- PPTX 字体替换报告。

### 33.7 Slide IR / Recipe 测试

- IR Schema；
- 同输入确定性；
- Seed 可复现；
- 长短文本；
- 图片比例；
- Metric 数量；
- Structured/Hybrid；
- Reading Order；
- semanticKey；
- StyleRef；
- Artwork Safe Region；
- Recipe 版本回归；
- Macro 展开后不依赖 Runtime。

### 33.8 Journal / Checkpoint 故障注入

- Journal 写一半退出；
- Transaction Checksum 错；
- Base Revision 不匹配；
- CAS Blob 丢失；
- Checkpoint 构建中退出；
- fsync/rename 失败；
- Recovery 成功后清理；
- 原文件始终可打开；
- Journal 不能覆盖更新后的其他文件版本。

### 33.9 Revised Copy / Patch

- 共同 Base 三方 Diff；
- 不同字段自动候选；
- 同字段冲突；
- semanticKey Replacement；
- 新 Asset；
- Fact 冲突；
- Patch Replay；
- 不匹配 Base；
- 部分接受；
- 整体 Undo；
- 无代码执行。

### 33.10 Contract Deck

至少包含：

- Text/Image/Shape；
- Flat Group；
- Style Preset/Override；
- CJK/Glyph Coverage；
- Structured/Hybrid；
- Artwork；
- Fact/Source；
- Reading Order；
- semanticKey/Lineage；
- Change Contract；
- Chart；
- Component Fallback；
- Journal Recovery；
- Portable Viewer/Quick Fix；
- Patch Review；
- PPTX Degradation。

### 33.11 CI Pipeline

```text
Lint / Typecheck
→ Schema Compile
→ Canonical Hash
→ Unit / Property
→ Operation / Change Contract
→ Identity / Flat Group
→ Slide IR / Recipe
→ Renderer / Text / Font
→ Golden Visual
→ Agent / Review Contract
→ Journal / File / Portable Security
→ Export E2E
→ Migration Corpus
→ Bundle / Performance Budget
→ User Task Smoke
```

### 33.12 禁止 GA 的失败项

- Save 损坏原文件；
- Journal 无法恢复已确认 Commit；
- Undo 无法恢复；
- Agent 越过 Change Contract；
- Protected Anchor 误改；
- semanticKey 无故丢失；
- Text 隐式变字号；
- Group Resize 隐式改 Text Style；
- Quick Fix 缺字静默 fallback；
- Portable 误报同步；
- Patch 同字段冲突被静默覆盖；
- 不支持内容静默导出丢失；
- 文件执行任意代码；
- 新 Runtime 重新引入 Slidev。

---

## 34. 从 v1 与 v2.2 迁移

### 34.1 代码迁移原则

不在旧 Slidev 主链路上逐层剥离。新建 v2.3 Core、Schema、Renderer、Journal 与 Compiler，再迁移可复用 UI。

### 34.2 可以复用

- 编辑器 Shell；
- 页面缩略图；
- Toolbar/Inspector；
- Agent 对话 UI；
- Diff UI；
- 文件选择和导出任务 UI；
- 通用 Asset 管理；
- 诊断系统；
- 部分 Text/Image/Shape 样式；
- 旧 v2.2 JSON Schema 测试素材。

### 34.3 必须删除或重写

- Slidev Runtime；
- Markdown/Frontmatter 真源；
- Vue/Theme/Addon Bridge；
- DOM 到源码映射；
- sourceRevision/renderedRevision 双状态；
- 运行时 Patch 与源码物化；
- Group Local Coordinate Scene Graph；
- Run 级字体和字号；
- 每数秒全量 ZIP 自动保存；
- `.ppte.html` 与工作文件平行真源；
- 模型直接生成任意 Element Scene Graph 的默认路径。

### 34.4 v2.2 语义文件迁移

#### GroupElement

```text
读取 Group Local Transform
→ 将子元素物化到 Slide Frame
→ 创建 LogicalGroup
→ 删除 Group Render Element
→ 验证前后视觉差
```

不能稳定物化时：

- Rasterize 为 Artwork；
- 或以只读恢复模式打开；
- 生成迁移报告；
- 原文件不覆盖。

#### RichText Run Style

- Run 级字体/字号如果全段一致，提升到 Text Element Style；
- 局部差异优先拆分为多个 Text Element；
- 无法合理拆分时保留为 Migration Extension 或栅格化该文本对象；
- 不静默丢样式。

#### Style

- 从 Token/Literal 推断 Style Preset；
- 无法匹配的样式保存为 Typed Override；
- 计算 Override Debt；
- 不强制视觉变化。

#### semanticKey

- 根据 Role、文本、Fact、位置与旧 Provenance 提议；
- 只对高置信关键对象自动生成；
- 歧义对象留空；
- 用户可在迁移报告中确认。

### 34.5 Slidev-era 文件

转换顺序：

1. 读取已有 PPTe Edit Index；
2. 可识别 Text/Image/Shape 转新对象；
3. 可识别 Chart Data 转 Chart；
4. 生成 Reading Order 和 semanticKey；
5. 复杂页面渲染为 Artwork；
6. 保留来源文件和迁移报告；
7. 原文件不原地覆盖。

---

## 35. 团队与 Workstream

### 35.1 推荐团队

- 1 Tech Lead / Core Architecture；
- 1 Core / Schema / Operation / Change Contract；
- 2 Editor / Interaction；
- 1 Renderer / Text / Font / Geometry；
- 1 Agent / Slide IR / Design Compiler；
- 1 File / Journal / Portable / Review / Export；
- 1 QA Automation；
- 1 Product/Visual Designer；
- 1 Product Manager。

其中 6～7 名工程师组成核心研发队伍，设计与 QA 持续参与。

### 35.2 Workstream

```text
WS-A  Core Contract / Schema / Ops / Identity
WS-B  Renderer / Text / Font / Flat Group
WS-C  AI Post Editor / Review UX
WS-D  Slide IR / Recipe / Agent / Artwork
WS-E  File / Journal / Portable / Patch / Export
WS-F  QA / Security / Compatibility / User Research
```

### 35.3 责任边界

- Core 对 Schema、Operation、Change Contract、Revision 负责；
- Editor 不得绕过 Core；
- Renderer 不得写 Document；
- Design Compiler 只输出 Draft/Operations；
- Agent 只走 Tool Contract；
- Journal 不得成为第二套内容真源；
- Reviewer 只生成候选 Transaction；
- Exporter 读取 Semantic Document，不依赖 Editor 私有 DOM；
- QA 对发布门禁有否决权；
- Tech Lead 对新增 Core 类型、Group/Text 复杂化和版本破坏拥有否决权。

### 35.4 设计资源

Product/Visual Designer 不是发布前补图角色，而是 Design Compiler 的核心建设者，负责：

- Theme 与 Style Preset；
- Recipe/Slot/Constraint；
- Macro；
- Structured/Hybrid；
- Artwork Safe Region；
- 长短文本测试；
- 用户编辑与 Review 流程；
- 生成接受率分析。

---

## 36. 研发里程碑与发布时间

### 36.1 总体节奏

推荐 6～7 名工程师：

```text
Week 1～2    Contract + Vertical Slice
Week 3～6    Core / Text / Flat Group / Journal
Week 5～10   Post Editor / Save / Recovery
Week 7～13   Slide IR / Recipe / Agent / Change Contract
Week 11～16  Portable Viewer / Quick Fix / Hybrid / Beta
Week 17～18  GA-A Stabilization
Week 19～24  GA-B：Chart / Fact / Review / Patch / Image PPTX
Week 25～30  GA-C：Poster / Widget / Light Edit / Semantic PPTX
```

### 36.2 Week 1～2：垂直切片

只实现：

```text
Open minimal semantic document
→ render Text/Image/Shape
→ select and drag Image via transient state
→ edit Text with IME-safe local state
→ Agent text.replaceContent
→ Scope + Change Contract
→ structural diff
→ commit
→ undo
→ append journal
→ checkpoint .ppte
→ reopen identically
```

不做 Chart、Component、Poster、PPTX、Patch、完整 Portable。

退出条件：

- 无 Slidev；
- 无 DOM 反向解析；
- 一个内容真源；
- Text 不隐式变字号；
- Change Contract 能阻止第二个对象变化；
- Journal/Checkpoint 故障后原文件可开。

### 36.3 Week 3～6：稳定 Core

交付：

- Document/Manifest/Transaction Schema；
- semanticKey/Lineage；
- Style Preset；
- Operation/Change Contract；
- Revision/History；
- Text v1；
- Image/Shape；
- Flat Group；
- Journal/CAS/Checkpoint；
- L0/L1/L2；
- Property/Fuzz/Golden。

Gate：Text、Undo、Group、Journal、Save/Open 未稳定，不进入完整 AI、Portable 和 Chart。

### 36.4 Week 5～10：AI 后编辑器

交付：

- Page List；
- Selection/Multi-select；
- Move/Resize/Rotate；
- RichText Adapter；
- Image Replace/Crop（Host）；
- Inspector；
- StyleRef/Override；
- Overflow UX；
- Reading Order Panel；
- Save State/Recovery；
- User Task Test。

Gate：首次用户 1 分钟改字并保存 <85% 时，不增加高级编辑功能。

### 36.5 Week 7～13：Slide IR、Design Compiler、Agent

交付：

- Presentation/Slide IR；
- 8～12 个声明式 Recipe；
- Theme/Style Preset Compiler；
- Structured/Hybrid；
- semanticKey 生成；
- Artwork Pipeline；
- Agent Tool Protocol；
- Change Contract Templates；
- Protected Anchor；
- Selection/Slide Regenerate；
- L3/Targeted Visual Diff。

Gate：Agent 越界、身份继承和 Anchor 不可靠时，不开放整页再设计和自动提交。

### 36.6 Week 11～16：Portable 与 Beta

交付：

- Portable Viewer；
- Portable Quick Fix；
- Glyph Coverage；
- Save as New Project；
- PDF/PNG；
- Clean Package；
- Presenter；
- Security Audit；
- Beta Diagnostics。

Gate：Portable 不达标时，GA-A 先发布 Host + `.ppte` + PDF/PNG，不让 HTML 阻塞 Core。

### 36.7 Week 17～18：GA-A

- Bug Burn Down；
- Schema/Profile Freeze；
- Recovery Drill；
- User Task Validation；
- 8～12 个 Recipe；
- 首批 Theme；
- Public File Spec；
- SDK/CLI 基础；
- GA-A Readiness。

### 36.8 Week 19～24：GA-B

- Bar/Line/Pie；
- Fact/Source；
- Compare Revised Copy；
- `.ppte.patch`；
- Portable Fact Quick Fix；
- Working/Audit/Clean；
- Legacy Migration；
- Image PPTX；
- Capability Report；
- 更多 Recipe/Macro。

### 36.9 Week 25～30：GA-C

- Area/Donut；
- Poster；
- Table/Code/Equation；
- Video 可后置；
- Portable Light Edit；
- Basic Semantic PPTX；
- 企业私有 Controlled Widget；
- 更多视觉资产。

### 36.10 最低团队方案

5 名工程师：

- GA-A 22～24 周；
- GA-B 30～34 周；
- GA-C 单独立项；
- Image Crop、Poster、Video、Semantic PPTX 后置；
- Quick Fix 先仅 Text；
- Chart 先 Bar/Line/Pie。

---

## 37. Epic 拆分

### Epic 1：Schema & Semantic Core

- Document/Slide/Element；
- Flat Group；
- semanticKey/Lineage；
- Fact/Source；
- Reading Order；
- Extension Envelope；
- Compatibility Profile。

### Epic 2：Operation & Change Contract

- Typed Operations；
- Scope；
- Mutation Budget；
- Invariants；
- Preview/Commit；
- Revision；
- Undo/Redo；
- History。

### Epic 3：Text / Font

- RichText v1；
- IME Adapter；
- Overflow；
- Explicit Fit；
- Font Ready；
- Glyph Coverage；
- Portable Text。

### Epic 4：Geometry / Flat Group

- Frame；
- Hit Test；
- Move/Resize/Rotate；
- Snap/Align/Distribute；
- Flat Group；
- Copy/Paste；
- Import Flatten。

### Epic 5：Renderer / Style

- Theme Tokens；
- Style Preset；
- Overrides；
- Text/Image/Shape；
- Ready Gate；
- Thumbnail；
- Visual Golden。

### Epic 6：AI Post Editor

- Shell；
- Page List；
- Canvas Overlay；
- Inspector；
- Overflow UX；
- Save State；
- Reading Order；
- Review Entry。

### Epic 7：Slide IR / Recipe / Artwork

- IR Schema；
- Compiler；
- Recipe Spec；
- Recipe Studio；
- Macro；
- Structured/Hybrid；
- Artwork Metadata；
- Quality Scoring。

### Epic 8：Agent / Regenerate

- Query Tools；
- Preview/Commit；
- Change Contract Templates；
- Anchor；
- Reflow/Redesign；
- Semantic/Visual Diff；
- Prompt Injection Tests。

### Epic 9：Persistence

- `.ppte` Package；
- Manifest；
- Canonical Hash；
- Journal；
- CAS；
- Checkpoint；
- Recovery；
- Working/Clean/Audit。

### Epic 10：Portable

- Viewer；
- Quick Fix；
- Glyph Safety；
- Origin；
- Save New Project；
- Bundle Budget；
- Security。

### Epic 11：Review & Patch

- Three-way Diff；
- semanticKey Matching；
- Conflict；
- Accept/Reject；
- `.ppte.patch`；
- Patch Assets；
- Undo。

### Epic 12：Chart / Component / Export

- Chart Adapter；
- Fact Sync；
- Component Fallback；
- PDF/PNG；
- Image PPTX；
- Semantic PPTX；
- Capability Report；
- Legacy Importer。

---
## 38. 产品与技术指标

### 38.1 产品价值指标

核心指标不只看 Schema 合法率，还要看用户到可用结果的距离：

```text
从输入资料到“可直接演示”的中位时间
首轮生成后无需整页重做的页面比例
每页达到可接受状态所需 Regenerate 次数
每页人工 Direct Edit 次数
Agent 局部修改一次通过率
最终进入放映、导出或发送的文档比例
发送副本后接收者 Quick Fix 成功率
修订副本返回后成功合入率
```

### 38.2 用户任务

- 首次用户 1 分钟内改字并保存 ≥85%；
- 1 分钟内替换图片并继续演示 ≥80%；
- 用户正确理解保存状态 ≥95%；
- Quick Fix 新字符无静默缺字 ≥100%；
- 修订副本比较中用户能正确判断修改范围 ≥90%；
- 页面重排首次接受率按场景建立基准并持续提升；
- Visual Redesign 平均候选次数持续下降。

### 38.3 可靠性

- Save/Open 内容一致率 100%；
- 原文件损坏率 0；
- 已 Commit 但 Journal 无法恢复率 0；
- Transaction 半提交率 0；
- Undo 无法恢复率 0；
- Unknown Field 静默丢失率 0；
- Text 隐式字号变化率 0；
- Group Resize 隐式 Text Style 变化率 0；
- Patch 同字段冲突静默覆盖率 0。

### 38.4 AI / Agent

- Slide IR Schema 合法率 100%；
- Compiler 输出 Document Schema 合法率 100%；
- Agent 写操作具备 Scope/Change Contract/Revision/Diff/Undo 100%；
- Selection Scope 非目标结构变化率 0；
- Mutation Budget 越界成功提交率 0；
- Protected Anchor 误改率 0；
- Layout-only Content/Asset 变化率 0；
- 关键 semanticKey 无故丢失率 0；
- Fact Sync 未经确认修改率 0；
- 视觉修复通过任意 CSS/Script 的比例 0。

### 38.5 生成质量

- 关键语义可编辑率：Structured/Hybrid 100%；
- Reading Order 完整率 ≥内部基准；
- Source 完整性持续提升；
- Style Override Debt 受控；
- 每页超复杂度预算比例低于阈值；
- 首轮无 Overflow 页面比例持续提升；
- Artwork 遮挡关键语义率 0。

### 38.6 Portable / Review

- Viewer 离线打开 ≥99%；
- Quick Fix 保存新项目 ≥95%；
- Portable 同步误导率 0；
- API Key 泄漏率 0；
- Glyph Coverage 漏检率 0；
- 共同 Base 修订比较成功率 ≥99%；
- Patch 应用后 Revision 可验证率 100%。

### 38.7 性能

沿用第 30 节预算。任何 P95 超标必须有规模分布和根因，而不能只给平均值。

### 38.8 范围控制指标

持续监控：

- Direct/Agent/Regenerate/Review 使用占比；
- 高级手工工具使用率；
- Flat Group 数量；
- Run Mark 使用情况；
- 每页 Element/Artwork/Override 数量；
- Component 和 Macro 增长；
- PPTX 降级比例；
- 主要服务手工创作的开发投入占比。

连续两个里程碑中，超过 25% 新研发投入主要服务复杂手工创作时，必须重新评审范围。

---

## 39. 主要风险与控制

### 风险 1：再次变成 Web PowerPoint

控制：

- Direct/Agent/Regenerate/Review 四分流；
- GA-A 功能冻结；
- 不以竞品功能数量排 Roadmap；
- 新功能必须提高真实任务成功率；
- 复杂手工能力优先由 Recipe、Agent 或再生成替代。

### 风险 2：Slide IR 变成第二套内容真源

控制：

- IR 默认不进入 Document；
- Renderer 永远读取 Semantic Document；
- 只保存 Digest/摘要；
- Regenerate 从当前 Document 重建 IR；
- IR 与 Element 变化同一 Commit 时只更新非渲染语义摘要。

### 风险 3：semanticKey 被滥用

控制：

- 只要求关键业务对象；
- Slide 内唯一；
- 装饰对象不强制；
- 继承必须有置信度和 Lineage；
- 歧义时不自动绑定；
- Fact ID 负责跨页数据身份，不让 semanticKey 承担所有关系。

### 风险 4：Change Contract 过于复杂

控制：

- 产品提供少量模板；
- 普通用户不编辑 JSON；
- Agent Tool 自动生成；
- Preview 显示自然语言摘要；
- 实际 Diff 验证，而非只信声明；
- Core 只实现稳定 Invariant，不引入任意表达式语言。

### 风险 5：Text 仍是最大 Bug 来源

控制：

- Run Style 再收缩；
- 单级列表；
- 复用成熟 IME/RichText 内核；
- 文件只存 PPTe 模型；
- 禁止隐藏 Auto Fit；
- Glyph Coverage；
- CJK/IME/Paste/Font 专项测试。

### 风险 6：Flat Group 不够强

控制：

- 产品定位为后编辑器；
- GA-A 优先满足批量移动/缩放/复制；
- Group Rotate/嵌套通过 Regenerate 或未来显式功能；
- 导入复杂 Group 可 Flatten/Artwork；
- 不为少数场景提前引入 Scene Graph。

### 风险 7：Checkpoint 间隔造成“以为已保存”

控制：

- Journal 及时追加；
- UI 区分已保护与已写入文件；
- Ctrl/Cmd+S、关闭、后台立即 Checkpoint；
- 长时间失败必须显著提示；
- 不把 Journal 当作永久保存；
- 崩溃恢复专项演练。

### 风险 8：Portable 字体编辑不可靠

控制：

- Viewer/Quick Fix Profile 分离；
- 可编辑 Text 声明 `editableSafe`；
- Commit 前 Glyph Check；
- 缺字必须显式选择 fallback；
- Quick Fix 不保证所有嵌入字体可任意新增 CJK 字符。

### 风险 9：Style Override 债务

控制：

- Style Preset；
- Override Debt；
- Reset/Reattach；
- Agent 主题修改优先 Preset；
- 批量字面样式进入 Warning；
- Recipe 默认输出 StyleRef。

### 风险 10：Fact 变成隐藏数据绑定系统

控制：

- 引用不自动更新；
- 同步必须 Preview/Operations；
- 不引入公式和实时数据源；
- GA-B 只做轻量 Fact/Source；
- 数据连接另立产品与安全方案。

### 风险 11：修订比较被误解为协作

控制：

- 明确是文件级 Compare/Apply；
- 共同 Base 才做三方 Diff；
- 冲突不自动覆盖；
- 不承诺实时同步；
- Patch 只承载 Operations/Assets。

### 风险 12：声明式 Recipe 表达力不足

控制：

- 80% 声明式、20% 受控代码；
- Recipe Studio；
- Freeform Semantic Candidate 仍输出固定对象；
- Hybrid Artwork 补足复杂视觉；
- 不退回任意 HTML/CSS。

### 风险 13：版本矩阵膨胀

控制：

- Compatibility Profile；
- 独立版本但只承诺验证组合；
- Profile Contract Deck；
- 更高版本只读；
- Portable Runtime 不修改源文件。

### 风险 14：GA-A 仍然过大

控制：

- 18 周核心 GA；
- Chart、Patch、PPTX、Widget 分列后置；
- Portable 不达标不阻塞 Host；
- 每个 Gate 可进一步删减，不追加承诺。

---

## 40. Definition of Done

任何能力只有同时满足以下条件才算完成：

1. 有明确产品任务；
2. 属于 Direct、Agent、Regenerate、Review 或 Export；
3. 有公开 Schema，或明确为派生状态；
4. 不引入第二套内容真源；
5. 有 Typed Operation，或只读派生；
6. 有 Scope 与 Change Contract；
7. 有正向、逆向和冲突行为；
8. 有对应 Validation Level；
9. 人工、Agent、Compiler、Merge 走同一 Commit；
10. 输入/拖动使用 Transient State；
11. Save/Open Round Trip 一致；
12. Journal/Checkpoint 故障可恢复；
13. 有语义/结构 Diff；
14. 必要时有视觉基线；
15. 有 Portable 行为或明确不进入 Portable；
16. 有导出策略或明确降级；
17. 有 Migration；
18. 不执行文档代码；
19. 不依赖 DOM 反向推断；
20. 不引入隐藏 Auto Fit/布局重排/Fact 同步；
21. 关键对象有 semanticKey/Lineage 策略；
22. 字体编辑有 Glyph Coverage 行为；
23. Override Debt 可诊断；
24. 性能和容量有预算；
25. 有用户任务测试；
26. 文档、Schema、TypeScript、示例和 Contract Test 同步。

任何“Demo 看起来能工作”，但 Undo、Save、Change Contract、Recovery、Portable、导出和迁移没有闭环的能力，均视为未完成。

---

## 41. GA 验收场景

### 场景 A：AI 新建

用户上传资料并输入目标，系统生成 10 页演示：

- 模型输出合法 Slide IR；
- Compiler 生成合法语义对象；
- Structured/Hybrid 策略合理；
- 关键标题、数字、Logo、来源可查询；
- semanticKey 唯一；
- Reading Order 完整；
- 无关键 Overflow；
- 用户无需进入代码。

### 场景 B：人工小改

用户双击标题改两个字：

- IME 稳定；
- Frame、StyleRef、字号不暗中变化；
- Overflow 明确；
- 只生成一个 Transaction；
- Journal 及时保护；
- Checkpoint 后重开一致；
- Undo 可恢复。

### 场景 C：Flat Group

用户选中三张卡片创建 Group、移动并缩放：

- Group 不创建新坐标系；
- 所有成员 Frame 正确；
- Text 不暗中缩字号；
- 一个事务提交；
- Undo 恢复；
- 解组只删除关系。

### 场景 D：Agent 局部修改

用户选中标题说“改得更谨慎，不要改变排版”：

- Scope 仅目标元素；
- Change Contract 仅允许 `text.replaceContent`；
- Max Changed Elements=1；
- 非目标变化为 0；
- Style/Geometry Hash 保持；
- Overflow/Glyph 通过；
- Diff 可见；
- 可 Undo。

### 场景 E：页面重排

用户说“保留内容和图片，排得更松”：

- 重建 Slide IR/Layout Intent；
- 只生成 Geometry Operations；
- Content/Data/Asset/Style Invariant 保持；
- Mutation Budget 通过；
- Preview 可接受/拒绝；
- semanticKey 不丢失。

### 场景 F：视觉重设计

用户保护标题、三个 Fact、Logo 和来源：

- Anchor 可解析；
- 新对象继承 semanticKey；
- Replacement Lineage 可查看；
- Artwork 不遮挡关键内容；
- Fact 值不变；
- 用户确认后提交。

### 场景 G：崩溃恢复

用户完成修改后、Checkpoint 前进程退出：

- 原 `.ppte` 仍可打开；
- Journal 被检测；
- 只重放已 Commit Transaction；
- Base Revision 校验；
- 恢复后内容正确；
- 用户可另存；
- 成功 Checkpoint 后 Journal 清理。

### 场景 H：Portable Quick Fix

接收者离线打开发送副本：

- 无需安装 Host；
- 修改标题；
- 输入新汉字时执行 Glyph Check；
- 替换图片；
- Undo；
- 保存为新 `.ppte`；
- 不显示“已同步回原项目”；
- 不包含 API Key。

### 场景 I：修订副本回流

原作者收到对方修改后的 `.ppte`：

- 根据共同 Base 做三方 Diff；
- 相同 semanticKey 正确匹配；
- 非冲突字段可选择接受；
- 同字段冲突不覆盖；
- 新 Asset 安全导入；
- 接受项形成 Transaction；
- 可整体 Undo。

### 场景 J：导出

用户导出 PDF、PNG 和 PPTX：

- PDF/PNG 与 Reference Renderer 一致；
- Image PPTX 可用；
- 基础语义 PPTX 按 Profile 提供；
- Artwork/Component 明确降级；
- 字体替换可见；
- 不支持内容不静默丢失。

---

## 42. 管理机制与 Stop/Go Gate

### 42.1 架构红线

以下变化必须 ADR + RFC + Migration + Contract Test：

- 新增 Core Element；
- Group 变成嵌套坐标树；
- Text 增加 Run 级字体/字号；
- 文件执行代码；
- 响应式布局成为真源；
- 第二套 Document Store；
- 绕过 Change Contract/Operation Engine；
- Fact 隐式实时同步；
- `.ppte.html` 成为工作真源；
- Journal 成为永久文件；
- 第三方联网 Component；
- PPTX 成为真源；
- 引入 Slidev。

### 42.2 功能准入问题

每个新功能回答：

1. 属于哪条核心通路？
2. 是否显著提高生成后可用率或修改效率？
3. 能否用现有 Primitive/Flat Group/Chart/Macro 表达？
4. 是否需要新增文件语义？
5. Scope 与 Change Contract 是什么？
6. Undo、Recovery、Patch、Migration 如何工作？
7. Portable 是否需要？
8. 字体/Asset/安全预算是什么？
9. 导出如何降级？
10. 能否由 Agent/Regenerate 替代？
11. 是否增加 Override Debt？
12. 是否把 IR/Journal/DOM 变成第二真源？

不能清楚回答，不进入 Core。

### 42.3 Stop/Go Gate

#### Week 2

若仍存在 Slidev、DOM 反向解析、多套真源、无法阻止 Agent 修改第二对象，停止扩展。

#### Week 6

若 Text、Flat Group、Undo、Journal、Checkpoint 不稳定，不进入完整 Design Compiler 和 Portable。

#### Week 10

若一分钟改字保存成功率不足，不增加高级编辑工具。

#### Week 13

若 Slide IR/Recipe 不能稳定生成语义对象，或 semanticKey/Anchor 不可靠，不开放整页再设计。

#### Week 16

若 Portable Glyph/Save 不可靠，GA-A 只发布 Viewer，Quick Fix 后置。

#### Week 18

若 Host Core 达标但 Portable 不达标，发布 Host + `.ppte` + PDF/PNG，不让 HTML 阻塞。

#### Week 24

若 Patch/Chart/PPTX 任一不达标，独立后置，不反向推迟已稳定的 GA-A。

### 42.4 每周评审

- Schema/ADR；
- Vertical Slice；
- Text/Save/Recovery Root Cause；
- Change Contract 越界；
- semanticKey/Lineage；
- Slide IR/Recipe 接受率；
- Direct/Agent/Regenerate/Review 使用；
- Override Debt；
- Portable Glyph；
- Patch Conflict；
- Performance/Bundle；
- Scope Creep。

---

## 43. 最终立项口径

PPTe v2.3 的底层不是网页、Slidev 工程或 React Tree，而是：

```text
Slide IR（编译意图）
→ Design Compiler（生成期）
→ Stable Semantic Document（唯一真源）
→ Scope + Change Contract + Typed Operations（唯一写入）
→ Reference Renderer（确定性显示）
→ Journal + Checkpoint + Patch（文件生命期）
```

v2.3 相对 v2.2 最重要的变化，不是新增更多对象，而是把五个容易失控的地方重新收紧：

```text
模型不直接控制底层 Scene Graph
Group 不演变成嵌套 Scene Graph
Text 不演变成小型 Word
ZIP 不承担高频事务数据库
Portable 不假装拥有完整 Host 能力
```

同时补齐三项真正服务文件流通的能力：

```text
semanticKey / Lineage
Fact / Source / Reading Order
Revised Copy / .ppte.patch
```

最终发布标准不是覆盖多少 PowerPoint 功能，而是：

> **AI 能否快速生成一份真正可用的演示；用户和 Agent 能否精确修改而不破坏其他内容；文件能否安全保存、发送、修订、比较、继续演示和导出。**

---

# 附录 A：核心 TypeScript 契约

```ts
export type DocumentId = string
export type SlideId = string
export type ElementId = string
export type GroupId = string
export type AssetId = string
export type FontId = string
export type FactId = string
export type SourceId = string
export type Revision = string
export type JsonPointer = string
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export interface PpteDocument {
  schemaVersion: '2.0.0'
  documentId: DocumentId
  locale: string
  metadata: DocumentMetadata
  canvas: CanvasSpec
  theme: ThemeDefinition
  slideOrder: SlideId[]
  slides: Record<SlideId, Slide>
  facts?: Record<FactId, Fact>
  sources?: Record<SourceId, Source>
  assets: Record<AssetId, Asset>
  fonts: Record<FontId, FontAsset>
  widgetRequirements?: WidgetRequirement[]
  policies?: DocumentPolicies
  generation?: GenerationMetadata
  extensions?: ExtensionEnvelope[]
}

export interface Slide {
  id: SlideId
  name?: string
  hidden?: boolean
  background?: Paint
  rootOrder: ElementId[]
  elements: Record<ElementId, Element>
  groups?: Record<GroupId, LogicalGroup>
  readingOrder?: ElementId[]
  notes?: SlideNotes
  transition?: SlideTransition
  semantic?: SlideSemanticSummary
  visualStrategy?: 'structured' | 'hybrid' | 'poster'
  protectedAnchors?: ProtectedAnchor[]
  provenance?: Provenance
  extensions?: ExtensionEnvelope[]
}

export type Element =
  | TextElement
  | ImageElement
  | ShapeElement
  | ChartElement
  | ComponentElement

export interface BaseElement {
  id: ElementId
  type: Element['type']
  semanticKey?: string
  role?: SemanticRole
  name?: string
  tags?: string[]
  description?: string
  frame: Frame
  rotationDeg?: number
  flipX?: boolean
  flipY?: boolean
  opacity?: number
  visible?: boolean
  locked?: boolean
  appearStep?: number
  editPolicy?: EditPolicy
  semanticRefs?: SemanticRefs
  provenance?: Provenance
  extensions?: ExtensionEnvelope[]
}

export interface LogicalGroup {
  id: GroupId
  name?: string
  semanticKey?: string
  memberIds: ElementId[]
  locked?: boolean
  editPolicy?: EditPolicy
}

export interface Transaction {
  transactionId: string
  baseRevision: Revision
  actor: Actor
  scope: TransactionScope
  changeContract: ChangeContract
  reason?: string
  createdAt: string
  validationLevel?: 'L1' | 'L2' | 'L3'
  operations: Operation[]
  metadata?: Record<string, JsonValue>
}
```

# 附录 B：Change Contract 示例

## B.1 只改标题文字

```json
{
  "allowedOperationKinds": ["text.replaceContent"],
  "allowedElementIds": ["el_title"],
  "maxChangedSlides": 1,
  "maxChangedElements": 1,
  "maxInsertedElements": 0,
  "maxDeletedElements": 0,
  "maxReplacedAssets": 0,
  "preserve": {
    "style": "preserve",
    "geometry": "preserve",
    "asset": "preserve",
    "semanticIdentity": "preserve",
    "readingOrder": "preserve",
    "facts": "preserve"
  }
}
```

## B.2 只重排当前页

```json
{
  "allowedOperationKinds": [
    "element.move",
    "element.resize",
    "layout.align",
    "layout.distribute"
  ],
  "maxChangedSlides": 1,
  "maxChangedElements": 30,
  "maxInsertedElements": 0,
  "maxDeletedElements": 0,
  "preserve": {
    "content": "preserve",
    "data": "preserve",
    "style": "preserve",
    "asset": "preserve",
    "semanticIdentity": "preserve",
    "facts": "preserve"
  },
  "requireConfirmation": true
}
```

# 附录 C：最小合法 Document 示例

```json
{
  "schemaVersion": "2.0.0",
  "documentId": "doc_01K00000000000000000000000",
  "locale": "zh-CN",
  "metadata": {
    "title": "年度经营回顾"
  },
  "canvas": {
    "width": 1920,
    "height": 1080,
    "unit": "du",
    "aspectRatio": "16:9",
    "defaultBackground": {
      "kind": "solid",
      "color": { "kind": "token", "token": "color.background" }
    }
  },
  "theme": {
    "id": "theme_default",
    "name": "Default",
    "tokens": {
      "colors": {
        "color.background": "#FFFFFF",
        "color.text.primary": "#111827",
        "color.accent": "#2563EB"
      },
      "fontFamilies": {
        "font.heading": "Inter",
        "font.body": "Inter"
      },
      "fontSizes": {
        "fontSize.title": 64,
        "fontSize.body": 28
      },
      "spacing": {},
      "radii": {},
      "shadows": {}
    },
    "presets": {
      "text": {
        "text.title.primary": {
          "fontFamily": { "kind": "token", "token": "font.heading" },
          "fontSize": 64,
          "fontWeight": 700,
          "color": { "kind": "token", "token": "color.text.primary" },
          "lineHeight": 1.15
        }
      },
      "shape": {},
      "image": {},
      "chart": {}
    }
  },
  "slideOrder": ["sld_01K00000000000000000000000"],
  "slides": {
    "sld_01K00000000000000000000000": {
      "id": "sld_01K00000000000000000000000",
      "rootOrder": ["el_01K000000000000000000000000"],
      "readingOrder": ["el_01K000000000000000000000000"],
      "elements": {
        "el_01K000000000000000000000000": {
          "id": "el_01K000000000000000000000000",
          "type": "text",
          "semanticKey": "title.main",
          "role": "title",
          "frame": {
            "x": 160,
            "y": 120,
            "width": 1400,
            "height": 120
          },
          "content": {
            "paragraphs": [
              {
                "id": "p_1",
                "runs": [
                  { "id": "r_1", "text": "年度经营回顾" }
                ]
              }
            ]
          },
          "style": {
            "styleRef": "text.title.primary"
          },
          "overflowPolicy": "warn"
        }
      },
      "groups": {},
      "visualStrategy": "structured"
    }
  },
  "assets": {},
  "fonts": {}
}
```

# 附录 D：建议错误码

```text
SCHEMA_INVALID
SCHEMA_VERSION_UNSUPPORTED
REVISION_CONFLICT
SCOPE_VIOLATION
CHANGE_KIND_NOT_ALLOWED
CHANGE_PATH_NOT_ALLOWED
MUTATION_BUDGET_EXCEEDED
CHANGE_INVARIANT_VIOLATION
EDIT_POLICY_VIOLATION
PROTECTED_ANCHOR_VIOLATION
SEMANTIC_KEY_DUPLICATE
SEMANTIC_LINEAGE_AMBIGUOUS
READING_ORDER_INVALID
FACT_REFERENCE_MISSING
SOURCE_REFERENCE_MISSING
FLAT_GROUP_DUPLICATE_MEMBER
FLAT_GROUP_NESTING_NOT_ALLOWED
TEXT_OVERFLOW
FONT_NOT_READY
FONT_GLYPH_MISSING
ASSET_MISSING
ASSET_HASH_MISMATCH
JOURNAL_BASE_MISMATCH
JOURNAL_CORRUPT
CHECKPOINT_FAILED
PATCH_BASE_MISMATCH
PATCH_CONFLICT
PORTABLE_PROFILE_UNSUPPORTED
EXPORT_DEGRADED
COMPONENT_FALLBACK_REQUIRED
```

# 附录 E：前两周启动清单

## E.1 Schema

- [ ] `PpteDocument`；
- [ ] Text/Image/Shape；
- [ ] Flat Group；
- [ ] semanticKey/Lineage；
- [ ] Theme/Preset；
- [ ] Transaction/Scope/Change Contract；
- [ ] Manifest/Compatibility Profile；
- [ ] JSON Schema 与最小示例。

## E.2 Core

- [ ] Canonical Hash；
- [ ] Immutable Snapshot；
- [ ] Derived Index；
- [ ] Preview/Commit；
- [ ] `text.replaceContent`；
- [ ] `element.move`；
- [ ] Inverse/Undo；
- [ ] Change Contract Enforcement；
- [ ] Journal Append；
- [ ] Checkpoint/Reopen。

## E.3 Renderer/Editor

- [ ] Fixed Slide；
- [ ] Text/Image/Shape Renderer；
- [ ] Selection Overlay；
- [ ] Drag Transient；
- [ ] IME-safe Text Local State；
- [ ] Overflow Warning；
- [ ] Save State；
- [ ] One-slide Golden。

## E.4 E2E

```text
打开
→ 改标题
→ 拖图片
→ Agent 只改标题
→ Change Contract 阻止越界
→ Diff
→ Commit
→ Undo
→ Journal
→ Checkpoint
→ 重开一致
```

## E.5 明确禁止

- [ ] 不引入 Slidev；
- [ ] 不生成任意 HTML/CSS；
- [ ] 不实现嵌套 Group；
- [ ] 不实现 Run 级字体/字号；
- [ ] 不做 Chart/Widget/PPTX；
- [ ] 不让 Portable 阻塞垂直切片；
- [ ] 不绕过 Operation Engine。
