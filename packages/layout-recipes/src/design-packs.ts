import type { BlockIR, RecipeSpec, SlideIR, SlidePurpose, ThemeDefinition, TextStyle } from '../../schema/src/index.js'
import { createRecipeManifest, packageDigest, recipeReference } from '../../design-system/src/index.js'
import type { LicenseEntry, StylePack } from '../../design-system/src/index.js'

export const DESIGN_PACK_VERSION = '1.0.0'
export const DESIGN_STYLES = ['business', 'swiss', 'editorial', 'launch'] as const
export const DESIGN_ROLES = ['cover', 'section', 'statement', 'metrics', 'explanation', 'comparison', 'process', 'closing'] as const
export type DesignStyle = typeof DESIGN_STYLES[number]
export type DesignRole = typeof DESIGN_ROLES[number]
export type SampleKind = 'normal' | 'boundary' | 'overload'
type Box = [number, number, number, number]
// Each row is title / narrative / evidence. Coordinates are normalized, never nested.
// Role-specific compositions intentionally alternate dense and quiet pages.
const layouts: Record<DesignStyle, [Box, Box, Box][]> = {
  business: [
    [[.07,.12,.49,.24],[.07,.45,.45,.38],[.61,.12,.32,.72]],
    [[.08,.25,.69,.22],[.08,.53,.64,.28],[.79,.26,.14,.46]],
    [[.08,.08,.84,.20],[.08,.36,.57,.48],[.71,.38,.21,.40]],
    [[.08,.08,.84,.19],[.08,.35,.55,.48],[.70,.35,.22,.48]],
    [[.07,.08,.86,.20],[.07,.37,.43,.49],[.56,.34,.37,.52]],
    [[.07,.08,.86,.20],[.07,.36,.86,.37],[.07,.79,.86,.13]],
    [[.07,.08,.86,.20],[.07,.35,.86,.38],[.07,.79,.86,.13]],
    [[.10,.14,.80,.20],[.10,.44,.52,.42],[.69,.47,.23,.32]],
  ],
  swiss: [
    [[.06,.09,.88,.23],[.06,.42,.41,.48],[.54,.42,.40,.48]],
    [[.06,.08,.55,.34],[.36,.52,.58,.37],[.68,.08,.26,.29]],
    [[.06,.10,.53,.36],[.34,.55,.60,.35],[.68,.11,.26,.32]],
    [[.06,.08,.40,.30],[.06,.47,.88,.43],[.55,.09,.39,.27]],
    [[.06,.08,.42,.29],[.06,.47,.42,.43],[.55,.08,.39,.82]],
    [[.06,.08,.32,.52],[.43,.08,.51,.65],[.06,.80,.88,.12]],
    [[.06,.08,.33,.29],[.46,.08,.48,.65],[.06,.80,.88,.12]],
    [[.06,.08,.88,.24],[.06,.45,.88,.28],[.06,.81,.88,.13]],
  ],
  editorial: [
    [[.08,.10,.42,.27],[.08,.46,.40,.43],[.56,.06,.38,.88]],
    [[.30,.13,.62,.28],[.30,.50,.62,.36],[.08,.16,.15,.66]],
    [[.12,.09,.76,.23],[.20,.42,.68,.46],[.05,.44,.12,.36]],
    [[.07,.10,.32,.31],[.46,.10,.47,.58],[.07,.53,.32,.35]],
    [[.50,.09,.43,.27],[.50,.46,.43,.44],[.06,.06,.37,.88]],
    [[.11,.09,.78,.22],[.11,.37,.78,.50],[.26,.91,.48,.07]],
    [[.08,.10,.41,.24],[.55,.10,.38,.72],[.08,.48,.41,.34]],
    [[.16,.12,.68,.26],[.16,.48,.68,.28],[.28,.82,.44,.12]],
  ],
  launch: [
    [[.14,.07,.72,.23],[.08,.44,.33,.44],[.48,.37,.44,.56]],
    [[.16,.10,.68,.27],[.08,.52,.84,.30],[.16,.86,.68,.09]],
    [[.12,.07,.76,.24],[.10,.45,.51,.46],[.70,.45,.20,.40]],
    [[.18,.08,.64,.22],[.08,.43,.53,.48],[.70,.42,.22,.49]],
    [[.10,.08,.80,.23],[.62,.41,.30,.50],[.08,.40,.47,.51]],
    [[.18,.08,.64,.23],[.08,.44,.84,.33],[.28,.85,.44,.10]],
    [[.17,.08,.66,.23],[.08,.44,.84,.31],[.17,.83,.66,.12]],
    [[.17,.09,.66,.25],[.22,.48,.56,.28],[.30,.83,.40,.12]],
  ],
}
const languages = {
  business: { description: '商务信息：左对齐结论、证据侧栏、并列比较与紧凑图像。', title: 48, body: 26, weight: 600, accent: '#175C83', background: '#F5F8FC', ink: '#122B40', radius: 4 },
  swiss: { description: '瑞士分析：不对称网格、强字级、独立数字、硬边图像与纵向流程。', title: 62, body: 27, weight: 800, accent: '#B72219', background: '#FFFFFF', ink: '#171717', radius: 0 },
  editorial: { description: '杂志叙事：窄栏与跨栏交替、通高图像、缩进引语和安静章节。', title: 50, body: 28, weight: 400, accent: '#8B422E', background: '#FAF4E9', ink: '#302820', radius: 0 },
  launch: { description: '产品发布：宽幅主张、大幅主视觉、圆角特性卡、横向使用流程。', title: 56, body: 27, weight: 700, accent: '#5836B5', background: '#F4F0FF', ink: '#23153E', radius: 28 },
} as const
const bodyKind: Record<DesignRole, BlockIR['kind']> = { cover: 'paragraph', section: 'paragraph', statement: 'quote', metrics: 'metric', explanation: 'paragraph', comparison: 'comparison', process: 'process', closing: 'paragraph' }
const supportKind: Record<DesignRole, BlockIR['kind']> = { cover: 'image', section: 'source', statement: 'metric', metrics: 'metric', explanation: 'image', comparison: 'source', process: 'source', closing: 'cta' }

/** Opt-in catalogue: existing default recipe selection and persisted decks stay stable. */
export function designPackRecipeSpecs(style?: DesignStyle): RecipeSpec[] {
  return (style ? [style] : DESIGN_STYLES).flatMap(s => DESIGN_ROLES.map((role, i): RecipeSpec => {
    const columns = ['metrics', 'comparison', 'process'].includes(role) && s !== 'editorial' && !(s === 'swiss' && ['comparison', 'process'].includes(role)) ? 2 : 1
    return {
      id: `${s}.${role}`, version: DESIGN_PACK_VERSION, supports: [role as SlidePurpose],
      slots: [
        { key: 'title', accepts: ['heading'], required: true, maxCount: 1, maxChars: 24, styleRef: 'text.title.primary' },
        { key: 'body', accepts: [bodyKind[role]], required: true, maxCount: 2, maxChars: role === 'metrics' ? 20 : 90, styleRef: role === 'metrics' ? 'text.metric.value' : 'text.body', repeat: { version: '1.0', maxCount: 2, columns, gapX: .035, gapY: .04 } },
        { key: 'support', accepts: [supportKind[role]], required: true, maxCount: 1, maxChars: 48, styleRef: ['cover', 'explanation'].includes(role) ? 'image.hero' : ['metrics','statement'].includes(role) ? 'text.metric.value' : 'text.source' },
      ],
      zones: layouts[s][i].map((box, n) => ({ id: ['title','body','support'][n], x: box[0], y: box[1], width: box[2], height: box[3] })),
      constraints: [{ kind: 'safe-area', slotId: '*' }],
      qualityRules: [{ kind: 'max-elements', value: 4 }, { kind: 'min-font-size', value: 16 }, { kind: 'max-overflow', value: 0 }, { kind: 'required-reading-order', value: true }],
    }
  }))
}

export function designPackTheme(style: DesignStyle, canvasHeight = 720): ThemeDefinition {
  const d = languages[style], scale = canvasHeight / 720
  const colorValue = (value: `#${string}`) => ({ kind: 'value' as const, value })
  const text = (size: number, weight: number, color: `#${string}` = d.ink): TextStyle => ({ fontFamily: { kind: 'value', value: 'Noto Sans SC' }, fontSize: size * scale, fontWeight: weight, lineHeight: 1.6, color: colorValue(color) })
  return {
    id: `theme.${style}`, name: style,
    tokens: { colors: { background: d.background, ink: d.ink, accent: d.accent }, fontFamilies: { heading: 'Noto Sans SC', body: 'Noto Sans SC' }, fontSizes: { title: d.title * scale, body: d.body * scale }, spacing: {}, radii: {}, shadows: {} },
    presets: { text: { 'text.title.primary': text(d.title, d.weight), 'text.body': text(d.body, 400), 'text.metric.value': text(38, 700, d.accent), 'text.source': text(18, 400) }, shape: {}, image: { 'image.hero': { radius: d.radius, border: { color: colorValue(d.accent), width: style === 'business' ? 2 : 0 } } }, chart: { 'chart.default': { palette: [colorValue(d.accent), colorValue('#758398')], axisColor: colorValue(d.ink), labelColor: colorValue(d.ink), gridColor: colorValue('#CDD1D7'), lineWidth: 2, cornerRadius: d.radius } } },
  }
}
const titles: Record<DesignRole, string> = { cover: '让信息成为行动', section: '01 从证据出发', statement: '先看证据，再做决策', metrics: '增长来自持续改进', explanation: '把复杂过程讲清楚', comparison: '两种路径，同一目标', process: '从发现到交付', closing: '把下一步变成现实' }
const narratives: Record<DesignRole, [string, string]> = {
  cover: ['产品与团队的年度故事', '用清晰表达连接每一次协作'], section: ['看清现状，定义问题', '建立共同语言，保留事实来源'], statement: ['清晰不是减少事实，而是让事实更容易理解。', '每一个结论，都应有可以追溯的证据。'],
  metrics: ['42% 增长', '128 个团队'], explanation: ['先呈现关键关系，再解释细节。图像展示结构，文字保留判断依据。', '保留来源与关键数字；人工修改后仍能继续编辑。'], comparison: ['方案 A\n统一流程\n适合稳定交付', '方案 B\n小步探索\n适合快速验证'], process: ['01 发现\n整理材料，确认问题', '02 交付\n验证证据，保留反馈'], closing: ['选择一个真实问题，开始下一轮验证。', '让每次反馈都有记录，每次行动都有负责人。'],
}
export function designPackSample(style: DesignStyle, role: DesignRole, kind: SampleKind): SlideIR {
  const block = (key: string, k: BlockIR['kind'], content: BlockIR['content']): BlockIR => ({ key, kind: k, content, importance: 'primary', semanticKey: `${role}.${key}` })
  const support = supportKind[role] === 'image' ? { assetId: 'asset_design_visual' } : supportKind[role] === 'metric' ? '42%' : role === 'closing' ? '开始验证' : '来源：合成演示数据'
  const blocks = [block('title', 'heading', titles[role]), block('body1', bodyKind[role], narratives[role][0])]
  if (kind !== 'normal') blocks.push(block('body2', bodyKind[role], narratives[role][1]))
  blocks.push(block('support', supportKind[role], support))
  if (kind === 'overload') blocks.push(block('extra', bodyKind[role], '超出容量的内容必须保留并拒绝成稿'))
  return { irVersion: '1.0', slideKey: `${style}.${role}.${kind}`, purpose: role, message: titles[role], visualStrategy: 'structured', density: 'medium', blocks }
}
const license = (resource: string, kind: LicenseEntry['kind']): LicenseEntry => ({ resource, kind, license: 'Apache-2.0', source: 'PPTe repository authored', notice: 'Copyright PPTe contributors. Synthetic illustration and fictional data; no third-party brand or photography.' })
export function designPackManifest(style: DesignStyle): StylePack {
  const previews = DESIGN_ROLES.flatMap(r => ['normal','boundary','overload'].map(k => `design-packs/${style}/previews/${r}-${k}.png`))
  const pack: StylePack = { contractVersion: '1', id: style, version: DESIGN_PACK_VERSION, description: languages[style].description, suitableFor: ['中文演讲', '信息叙事'], unsuitableFor: ['超载内容自动压缩', '未校验字体替换'], density: 'medium', theme: designPackTheme(style), rules: { image: [languages[style].description, '图像为独立可替换对象；不把文字烘焙进图片'], line: ['按角色切换构图；正文不自动缩字'], chart: ['关键数值与分类保留为原生图表数据'] }, recipeRefs: designPackRecipeSpecs(style).map(recipeReference), previews, licenses: [license(style, 'recipe'), license('asset_design_visual', 'photo'), { resource: 'Noto Sans SC', kind: 'font', license: 'OFL-1.1', source: 'design-packs/assets/OFL.txt', notice: 'Noto Sans SC, Google and Adobe; SIL Open Font License 1.1. Pinned sample subset; see assets/README.md.' }, ...previews.map(p => license(p, 'preview'))], digest: '' }
  pack.digest = packageDigest(pack)
  return pack
}
export function designPackCoverage() {
  return DESIGN_STYLES.flatMap(style => designPackRecipeSpecs(style).map((recipe, i) => {
    const role = DESIGN_ROLES[i]
    const manifest = createRecipeManifest(recipe, { controls: [], capacity: { maxBlocks: 4, overflow: 'reject-or-propose', textUnit: 'unicode-code-point' }, capabilities: { 'html-edit': 'unverified', 'html-present': 'unverified', pdf: 'unverified', 'pptx-image': 'unverified', 'pptx-semantic': 'unverified' }, samples: (['normal','boundary','overload'] as const).map(kind => ({ kind, locale: 'zh-CN', input: { irVersion: '1.0', title: titles[role], narrative: [], slides: [designPackSample(style, role, kind)] } })), licenses: [license(recipe.id, 'recipe')] })
    return { style, role, manifest, previews: Object.fromEntries(['normal','boundary','overload'].map(k => [k, `design-packs/${style}/previews/${role}-${k}.png`])) }
  }))
}
