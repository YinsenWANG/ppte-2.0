import type {
  AssetId,
  FactId,
  JsonValue,
  Rect,
  SemanticRole,
  SlidePurpose,
  SourceId,
  VisualStrategy,
} from './document.js'

export interface PresentationIR {
  irVersion: '1.0'
  title: string
  audience?: string
  objective?: string
  narrative: NarrativeSection[]
  slides: SlideIR[]
  themeIntent?: ThemeIntent
  sourceIds?: SourceId[]
}
export interface NarrativeSection {
  key: string
  title: string
  message?: string
  slideKeys: string[]
}
export interface ThemeIntent {
  tone?: 'formal' | 'modern' | 'editorial' | 'technical' | 'playful'
  density?: 'low' | 'medium' | 'high'
  brandKeywords?: string[]
  preferredColors?: string[]
  avoidColors?: string[]
}
export interface SlideIR {
  irVersion: '1.0'
  slideKey: string
  purpose: SlidePurpose
  message: string
  visualStrategy: VisualStrategy
  density: 'low' | 'medium' | 'high'
  blocks: BlockIR[]
  layoutIntent?: LayoutIntent
  artworkIntent?: ArtworkIntent
  protectedContent?: ProtectedContentIR[]
  sourceIds?: SourceId[]
}
export type BlockKind =
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
export interface BlockIR {
  key: string
  kind: BlockKind
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
export interface LayoutIntent {
  balance: 'text-led' | 'visual-led' | 'balanced'
  direction?: 'horizontal' | 'vertical'
  hierarchy?: 'single-focus' | 'dual-focus' | 'grid'
  rhythm?: 'calm' | 'dynamic'
  whitespace?: 'compact' | 'normal' | 'generous'
  preferredRecipeIds?: string[]
  avoidRecipeIds?: string[]
}
export interface ArtworkIntent {
  subject: string
  function: 'evidence' | 'illustration' | 'background' | 'atmosphere'
  placement: 'full-bleed' | 'side' | 'center' | 'background'
  safeTextRegions?: Rect[]
  avoidTextRegions?: Rect[]
  styleKeywords?: string[]
}
export interface ProtectedContentIR {
  semanticKey?: string
  factId?: FactId
  preserve: Array<'content' | 'data' | 'style' | 'geometry' | 'asset'>
}
export interface RecipeSlot {
  key: string
  accepts: BlockKind[]
  required?: boolean
  minCount?: number
  maxCount?: number
  maxChars?: number
  preferredAspectRatio?: number
  styleRef?: string
  semanticRole?: SemanticRole
}
export interface LayoutZone {
  id: string
  x: number
  y: number
  width: number
  height: number
}
export type LayoutConstraint =
  | { kind: 'align'; slotIds: string[]; axis: 'x' | 'y'; mode: 'start' | 'center' | 'end' }
  | { kind: 'stack'; slotIds: string[]; axis: 'horizontal' | 'vertical'; gap: number }
  | { kind: 'grid'; slotIds: string[]; columns: number; gapX: number; gapY: number }
  | { kind: 'min-size'; slotId: string; width?: number; height?: number }
  | { kind: 'max-size'; slotId: string; width?: number; height?: number }
  | { kind: 'aspect-ratio'; slotId: string; ratio: number }
  | { kind: 'avoid-region'; slotId: string; region: Rect }
  | { kind: 'safe-area'; slotId: string }
export interface RecipeVariant {
  id: string
  when?: Record<string, JsonValue>
  zoneOverrides?: Partial<Record<string, Partial<LayoutZone>>>
}
export interface QualityRule {
  kind: 'max-elements' | 'min-font-size' | 'max-overflow' | 'required-reading-order'
  value: number | boolean
}
export interface RecipeSpec {
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
export interface CompileProvenance {
  compilerVersion: string
  recipeId?: string
  recipeVersion?: string
  slideIrDigest: string
  seed?: string
  fontMetricsFingerprint: string
}
export interface ElementDraft {
  draftId: string
  kind: 'text' | 'image' | 'shape' | 'chart' | 'component'
  semanticKey?: string
  role?: SemanticRole
  frame: Rect
  data: JsonValue
}
export interface LogicalGroupDraft {
  draftId: string
  memberDraftIds: string[]
}
export interface CompiledSlideDraft {
  slideKey: string
  elementDrafts: ElementDraft[]
  groups: LogicalGroupDraft[]
  readingOrder: string[]
  semanticKeyMap: Record<string, string>
  assetIds?: AssetId[]
  provenance: CompileProvenance
}
