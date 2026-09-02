/** The framework-neutral semantic document contract. */

export type DocumentId = string
export type SlideId = string
export type ElementId = string
export type GroupId = string
export type AssetId = string
export type FontId = string
export type FactId = string
export type SourceId = string
export type OperationId = string
export type TransactionId = string
export type Revision = string
export type JsonPointer = string

/** Independent format and protocol versions used at persistence boundaries. */
export const PPTE_FORMAT = 'ppte' as const
export const PPTE_FORMAT_VERSION = '2' as const
export const PPTE_SCHEMA_VERSION = '2.0.0' as const
export const PPTE_OPERATION_PROTOCOL_VERSION = '1.0' as const
export const PPTE_COMPATIBILITY_PROFILE = 'ppte-2.0-ga-a.1' as const

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type HexColor = `#${string}`

export interface ExtensionEnvelope {
  namespace: string
  version: string
  required: boolean
  byteLength: number
  payload: JsonValue
}

export type ValueOrToken<T> =
  | { kind: 'value'; value: T }
  | { kind: 'token'; token: string }

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

export interface DocumentMetadata {
  title: string
  subject?: string
  description?: string
  author?: string
  company?: string
  language?: string
  keywords?: string[]
  createdAt?: string
  updatedAt?: string
  source?: 'native' | 'imported' | 'generated' | 'migrated'
  sourceFormat?: string
}

export interface CanvasSpec {
  width: number
  height: number
  unit: 'du'
  aspectRatio: '16:9' | '4:3' | 'custom'
  safeArea?: Insets
  defaultBackground: Paint
}

export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
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
  visualStrategy?: VisualStrategy
  protectedAnchors?: ProtectedAnchor[]
  provenance?: Provenance
  extensions?: ExtensionEnvelope[]
}

export interface SlideNotes {
  speaker?: string
  private?: string
  handout?: string
}

export type VisualStrategy = 'structured' | 'hybrid' | 'poster'
export type SlidePurpose =
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
  | 'custom'

export interface SlideSemanticSummary {
  purpose?: SlidePurpose
  headline?: string
  keyMessage?: string
  slideIrDigest?: string
  sourceIds?: SourceId[]
}

export interface SlideTransition {
  type: 'none' | 'fade' | 'slide' | 'push'
  durationMs?: number
  direction?: 'left' | 'right' | 'up' | 'down'
}

export type ElementType = 'text' | 'image' | 'shape' | 'chart' | 'component'
export type Element = TextElement | ImageElement | ShapeElement | ChartElement | ComponentElement

export interface BaseElement {
  id: ElementId
  type: ElementType
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

export type SemanticRole =
  | 'title'
  | 'subtitle'
  | 'body'
  | 'caption'
  | 'metric'
  | 'source'
  | 'logo'
  | 'image'
  | 'chart'
  | 'artwork'
  | 'background'
  | 'decorative'
  | 'navigation'
  | 'cta'
  | 'custom'

export interface Frame {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface Rect extends Frame {}

export interface NormalizedRect {
  x: number
  y: number
  width: number
  height: number
}

export interface EditPolicy {
  mode?: 'full' | 'property' | 'replace' | 'locked'
  protected?: boolean
  lockedFields?: JsonPointer[]
  agentEditable?: boolean
  preserveOnRegenerate?: boolean
}

export type PreservedField = 'content' | 'data' | 'style' | 'geometry' | 'asset'
export type ProtectedAnchor = {
  target:
    | { kind: 'element'; elementId: ElementId }
    | { kind: 'semantic'; semanticKey: string }
    | { kind: 'fact'; factId: FactId }
  preserve: PreservedField[]
  reason?: string
}

export interface SemanticRefs {
  factIds?: FactId[]
  sourceIds?: SourceId[]
}

export interface Provenance {
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

export interface LogicalGroup {
  id: GroupId
  name?: string
  semanticKey?: string
  memberIds: ElementId[]
  locked?: boolean
  editPolicy?: EditPolicy
}

export interface ElementAnimation {
  enter?: AnimationSpec
  exit?: AnimationSpec
}

export interface AnimationSpec {
  type: 'fade' | 'slide-up' | 'slide-left' | 'scale'
  durationMs?: number
  delayMs?: number
  easing?: 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out'
}

export interface StyleBinding<TOverrides> {
  styleRef: string
  overrides?: TOverrides
}

export interface TextElement extends BaseElement {
  type: 'text'
  content: RichTextDocument
  style: StyleBinding<Partial<TextStyle>>
  paragraphStyle?: ParagraphStyle
  boxStyle?: BoxStyle
  overflowPolicy?: 'warn' | 'clip' | 'ellipsis'
}

export interface RichTextDocument {
  paragraphs: TextParagraph[]
}

export interface TextParagraph {
  id: string
  runs: TextRun[]
  align?: 'left' | 'center' | 'right'
  list?: { type: 'bullet' | 'number' }
  spaceBefore?: number
  spaceAfter?: number
}

export interface TextRun {
  id: string
  text: string
  marks?: TextMarks
}

export interface TextMarks {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  color?: ValueOrToken<HexColor>
}

export interface TextStyle {
  fontFamily: ValueOrToken<string>
  fontSize: number
  fontWeight?: number
  color: ValueOrToken<HexColor>
  lineHeight?: number
  letterSpacing?: number
  verticalAlign?: 'top' | 'middle' | 'bottom'
  direction?: 'ltr' | 'rtl' | 'auto'
}

export interface ParagraphStyle {
  align?: 'left' | 'center' | 'right'
  lineHeight?: number
  paragraphSpacing?: number
  listIndent?: number
}

export interface BoxStyle {
  padding?: Insets
  fill?: Paint
  stroke?: Stroke
  radius?: number
  shadow?: Shadow
}

export interface ImageElement extends BaseElement {
  type: 'image'
  assetId: AssetId
  fit: 'contain' | 'cover' | 'fill'
  crop?: NormalizedRect
  focalPoint?: Point
  style?: StyleBinding<Partial<ImageStyle>>
  altText?: string
}

export interface ImageStyle {
  border?: Stroke
  radius?: number
  shadow?: Shadow
}

export type ShapeKind =
  | 'rectangle'
  | 'rounded-rectangle'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'triangle'
  | 'diamond'
  | 'chevron'
  | 'polygon'

export interface ShapeElement extends BaseElement {
  type: 'shape'
  shape: ShapeKind
  style: StyleBinding<Partial<ShapeStyle>>
  points?: Point[]
}

export interface ShapeStyle {
  fill?: Paint
  stroke?: Stroke
  radius?: number
  shadow?: Shadow
}

/** Forward-compatible contract types; Week 1–2 runtime intentionally rejects these. */
export interface ChartElement extends BaseElement {
  type: 'chart'
  chartType: 'bar' | 'line' | 'area' | 'pie' | 'donut'
  data: ChartData
  encoding: ChartEncoding
  options?: ChartOptions
  style: StyleBinding<Partial<ChartStyle>>
  altText?: string
}

export interface ChartColumn {
  id: string
  label: string
  type: 'string' | 'number' | 'date'
  format?: string
}

export interface ChartRow {
  id: string
  values: Record<string, string | number | null>
}

export interface ChartData {
  columns: ChartColumn[]
  rows: ChartRow[]
}

export interface ChartEncoding {
  categoryField: string
  valueFields: string[]
  seriesField?: string
  labelField?: string
}

export interface ChartOptions {
  orientation?: 'vertical' | 'horizontal'
  stacked?: boolean
  showLegend?: boolean
  showLabels?: boolean
  showXAxis?: boolean
  showYAxis?: boolean
  showGrid?: boolean
  sort?: 'none' | 'ascending' | 'descending'
}

export interface ChartStyle {
  palette?: ValueOrToken<HexColor>[]
  axisColor?: ValueOrToken<HexColor>
  labelColor?: ValueOrToken<HexColor>
  gridColor?: ValueOrToken<HexColor>
  lineWidth?: number
  cornerRadius?: number
}

export interface ComponentElement extends BaseElement {
  type: 'component'
  componentType: string
  componentVersion: string
  props: Record<string, JsonValue>
  fallback: ComponentFallback
}

export interface ComponentFallback {
  kind: 'asset' | 'placeholder'
  assetId?: AssetId
  label?: string
}

export type Paint =
  | { kind: 'none' }
  | { kind: 'solid'; color: ValueOrToken<HexColor>; opacity?: number }
  | { kind: 'linear-gradient'; angleDeg: number; stops: GradientStop[]; opacity?: number }

export interface GradientStop {
  offset: number
  color: ValueOrToken<HexColor>
}

export interface Stroke {
  color: ValueOrToken<HexColor>
  width: number
  opacity?: number
  dash?: number[]
  lineCap?: 'butt' | 'round' | 'square'
  lineJoin?: 'miter' | 'round' | 'bevel'
}

export interface Shadow {
  color: ValueOrToken<HexColor>
  offsetX: number
  offsetY: number
  blur: number
  spread?: number
  opacity?: number
}

export interface ThemeDefinition {
  id: string
  name: string
  tokens: ThemeTokens
  presets: StylePresetRegistry
  extensions?: ExtensionEnvelope[]
}

export interface ThemeTokens {
  colors: Record<string, HexColor>
  fontFamilies: Record<string, string>
  fontSizes: Record<string, number>
  spacing: Record<string, number>
  radii: Record<string, number>
  shadows: Record<string, Shadow>
}

export interface StylePresetRegistry {
  text: Record<string, TextStyle>
  shape: Record<string, ShapeStyle>
  image: Record<string, ImageStyle>
  chart: Record<string, ChartStyle>
}

export interface Fact {
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

export interface Source {
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

export interface Asset {
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

export interface AssetSource {
  kind: 'upload' | 'generated' | 'remote-import' | 'clipboard' | 'migration'
  uri?: string
  provider?: string
  sourceId?: string
  importedAt?: string
}

export interface ArtworkMetadata {
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

export interface UnicodeRange {
  start: number
  end: number
}

export interface FontAsset {
  id: FontId
  family: string
  style: 'normal' | 'italic'
  weight: number
  hash?: string
  path?: string
  source: 'embedded' | 'system' | 'fallback'
  subset?: boolean
  glyphCoverage?: UnicodeRange[]
  editableSafe?: boolean
  fallbackFamilies?: string[]
  license?: string
}

export interface WidgetRequirement {
  type: string
  versionRange: string
  fallbackRequired: true
}

export interface GenerationMetadata {
  generatorId?: string
  generatorVersion?: string
  createdFrom?: 'prompt' | 'outline' | 'template' | 'import'
  defaultVisualStrategy?: VisualStrategy
}

export interface DocumentPolicies {
  allowExternalLinks?: boolean
  allowNetworkAssets?: boolean
  allowPortableEditing?: boolean
  maxHistoryEntries?: number
  maxHistoryBytes?: number
  defaultAgentScope?: 'selection' | 'slide' | 'document'
}
