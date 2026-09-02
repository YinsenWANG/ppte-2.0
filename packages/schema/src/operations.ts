import type {
  AssetId,
  ChartData,
  ChartEncoding,
  ChartOptions,
  ChartStyle,
  DocumentMetadata,
  EditPolicy,
  Element,
  ElementId,
  Fact,
  FactId,
  Frame,
  GroupId,
  ImageStyle,
  JsonPointer,
  JsonValue,
  LogicalGroup,
  NormalizedRect,
  Point,
  ProtectedAnchor,
  PpteDocument,
  Revision,
  RichTextDocument,
  ShapeStyle,
  Slide,
  SlideId,
  Source,
  SourceId,
  StylePresetRegistry,
  TextStyle,
  ThemeDefinition,
  TransactionId,
} from './document.js'

export type ActorType = 'human' | 'agent' | 'system' | 'importer' | 'reviewer'
export interface Actor {
  type: ActorType
  id?: string
  displayName?: string
}

export type ValidationLevel = 'L1' | 'L2' | 'L3'
export type ScopePermission =
  | 'content'
  | 'geometry'
  | 'style'
  | 'structure'
  | 'theme'
  | 'assets'
  | 'facts'
  | 'sources'
  | 'notes'
  | 'animation'
  | 'review'

export interface TransactionScope {
  kind: 'selection' | 'slide' | 'document' | 'custom'
  slideIds?: SlideId[]
  elementIds?: ElementId[]
  semanticKeys?: string[]
  permissions: ScopePermission[]
  allowInsert?: boolean
  allowDelete?: boolean
}

export interface ChangeInvariants {
  content?: 'preserve' | 'allow'
  data?: 'preserve' | 'allow'
  style?: 'preserve' | 'allow'
  geometry?: 'preserve' | 'allow'
  asset?: 'preserve' | 'allow'
  semanticIdentity?: 'preserve' | 'allow-replacement'
  readingOrder?: 'preserve' | 'allow'
  facts?: 'preserve' | 'allow-explicit-sync'
}

export interface ChangeContract {
  allowedOperationKinds?: OperationKind[]
  allowedElementIds?: ElementId[]
  allowedSemanticKeys?: string[]
  allowedPaths?: JsonPointer[]
  maxChangedSlides?: number
  maxChangedElements?: number
  maxInsertedElements?: number
  maxDeletedElements?: number
  maxReplacedAssets?: number
  maxChangedFacts?: number
  maxChangedSources?: number
  maxChangedThemeTokens?: number
  maxChangedStylePresets?: number
  preserve?: ChangeInvariants
  requireConfirmation?: boolean
  userIntentSummary?: string
}

export type Precondition =
  | { kind: 'revision-equals'; revision: Revision }
  | { kind: 'slide-exists'; slideId: SlideId }
  | { kind: 'element-exists'; slideId: SlideId; elementId: ElementId }
  | { kind: 'semantic-key-resolves'; slideId: SlideId; semanticKey: string; elementId?: ElementId }
  | { kind: 'fact-exists'; factId: FactId }
  | { kind: 'path-hash-equals'; path: JsonPointer; hash: string }
  | { kind: 'path-value-equals'; path: JsonPointer; value: JsonValue }

export interface OperationBase<K extends string> {
  opId: string
  kind: K
  preconditions?: Precondition[]
  reason?: string
}

export type Operation =
  | DocumentUpdateMetadataOperation
  | ThemeReplaceOperation
  | ThemeSetTokenOperation
  | ThemeUpdatePresetOperation
  | SlideInsertOperation
  | SlideDeleteOperation
  | SlideMoveOperation
  | SlideUpdateOperation
  | SlideSetReadingOrderOperation
  | SlideSetProtectedAnchorsOperation
  | ElementInsertOperation
  | ElementDeleteOperation
  | ElementDuplicateOperation
  | ElementMoveOperation
  | ElementResizeOperation
  | ElementRotateOperation
  | ElementReorderOperation
  | ElementSetVisibilityOperation
  | ElementSetLockedOperation
  | ElementSetEditPolicyOperation
  | ElementSetSemanticKeyOperation
  | ElementSetStyleRefOperation
  | ElementUpdateStyleOverridesOperation
  | ElementClearStyleOverridesOperation
  | TextReplaceContentOperation
  | TextSetOverflowPolicyOperation
  | TextFitByReducingFontOperation
  | TextResizeBoxOperation
  | ImageReplaceAssetOperation
  | ImageSetCropOperation
  | ImageSetFocalPointOperation
  | ShapeUpdateStyleOperation
  | ChartReplaceDataOperation
  | ChartUpdateEncodingOperation
  | ChartUpdateOptionsOperation
  | ChartUpdateStyleOperation
  | ComponentUpdatePropsOperation
  | GroupCreateOperation
  | GroupDeleteOperation
  | GroupAddMembersOperation
  | GroupRemoveMembersOperation
  | GroupMoveOperation
  | GroupResizeOperation
  | FactUpsertOperation
  | FactDeleteOperation
  | FactSyncReferencesOperation
  | SourceUpsertOperation
  | SourceDeleteOperation
  | LayoutAlignOperation
  | LayoutDistributeOperation

export type OperationKind = Operation['kind']

export interface DocumentUpdateMetadataOperation extends OperationBase<'document.updateMetadata'> {
  patch: Partial<DocumentMetadata>
  replace?: boolean
}
export interface ThemeReplaceOperation extends OperationBase<'theme.replace'> {
  theme: ThemeDefinition
}
export interface ThemeSetTokenOperation extends OperationBase<'theme.setToken'> {
  category: 'colors' | 'fontFamilies' | 'fontSizes' | 'spacing' | 'radii' | 'shadows'
  token: string
  value: JsonValue
}
export interface ThemeUpdatePresetOperation extends OperationBase<'theme.updatePreset'> {
  category: keyof StylePresetRegistry
  presetId: string
  value: JsonValue
  remove?: boolean
}
export interface SlideInsertOperation extends OperationBase<'slide.insert'> {
  slide: Slide
  index: number
}
export interface SlideDeleteOperation extends OperationBase<'slide.delete'> {
  slideId: SlideId
}
export interface SlideMoveOperation extends OperationBase<'slide.move'> {
  slideId: SlideId
  index: number
}
export interface SlideUpdateOperation extends OperationBase<'slide.update'> {
  slideId: SlideId
  patch: Record<string, JsonValue>
}
export interface SlideSetReadingOrderOperation extends OperationBase<'slide.setReadingOrder'> {
  slideId: SlideId
  readingOrder?: ElementId[]
  unset?: boolean
}
export interface SlideSetProtectedAnchorsOperation extends OperationBase<'slide.setProtectedAnchors'> {
  slideId: SlideId
  protectedAnchors?: ProtectedAnchor[]
  unset?: boolean
}
export interface ElementInsertOperation extends OperationBase<'element.insert'> {
  slideId: SlideId
  element: Element
  index: number
}
export interface ElementDeleteOperation extends OperationBase<'element.delete'> {
  slideId: SlideId
  elementId: ElementId
}
export interface ElementDuplicateOperation extends OperationBase<'element.duplicate'> {
  slideId: SlideId
  sourceElementId: ElementId
  newElementId: ElementId
  offset?: Point
  index?: number
}
export interface ElementMoveOperation extends OperationBase<'element.move'> {
  slideId: SlideId
  elementId: ElementId
  x: number
  y: number
}
export interface ElementResizeOperation extends OperationBase<'element.resize'> {
  slideId: SlideId
  elementId: ElementId
  frame: Frame
  preserveAspectRatio?: boolean
}
export interface ElementRotateOperation extends OperationBase<'element.rotate'> {
  slideId: SlideId
  elementId: ElementId
  rotationDeg?: number
  unset?: boolean
}
export interface ElementReorderOperation extends OperationBase<'element.reorder'> {
  slideId: SlideId
  elementId: ElementId
  index: number
}
export interface ElementSetVisibilityOperation extends OperationBase<'element.setVisibility'> {
  slideId: SlideId
  elementId: ElementId
  visible?: boolean
  unset?: boolean
}
export interface ElementSetLockedOperation extends OperationBase<'element.setLocked'> {
  slideId: SlideId
  elementId: ElementId
  locked?: boolean
  unset?: boolean
}
export interface ElementSetEditPolicyOperation extends OperationBase<'element.setEditPolicy'> {
  slideId: SlideId
  elementId: ElementId
  editPolicy?: EditPolicy
  unset?: boolean
}
export interface ElementSetSemanticKeyOperation extends OperationBase<'element.setSemanticKey'> {
  slideId: SlideId
  elementId: ElementId
  semanticKey?: string
}
export interface ElementSetStyleRefOperation extends OperationBase<'element.setStyleRef'> {
  slideId: SlideId
  elementId: ElementId
  styleRef: string
}
export interface ElementUpdateStyleOverridesOperation extends OperationBase<'element.updateStyleOverrides'> {
  slideId: SlideId
  elementId: ElementId
  patch: Record<string, JsonValue>
}
export interface ElementClearStyleOverridesOperation extends OperationBase<'element.clearStyleOverrides'> {
  slideId: SlideId
  elementId: ElementId
  paths?: JsonPointer[]
}
export interface TextReplaceContentOperation extends OperationBase<'text.replaceContent'> {
  slideId: SlideId
  elementId: ElementId
  content: RichTextDocument
}
export interface TextSetOverflowPolicyOperation extends OperationBase<'text.setOverflowPolicy'> {
  slideId: SlideId
  elementId: ElementId
  overflowPolicy?: 'warn' | 'clip' | 'ellipsis'
  unset?: boolean
}
export interface TextFitByReducingFontOperation extends OperationBase<'text.fitByReducingFont'> {
  slideId: SlideId
  elementId: ElementId
  minFontSize: number
  resolvedFontSize: number
}
export interface TextResizeBoxOperation extends OperationBase<'text.resizeBox'> {
  slideId: SlideId
  elementId: ElementId
  frame: Frame
}
export interface ImageReplaceAssetOperation extends OperationBase<'image.replaceAsset'> {
  slideId: SlideId
  elementId: ElementId
  assetId: AssetId
  preserveCrop?: boolean
}
export interface ImageSetCropOperation extends OperationBase<'image.setCrop'> {
  slideId: SlideId
  elementId: ElementId
  crop: NormalizedRect
}
export interface ImageSetFocalPointOperation extends OperationBase<'image.setFocalPoint'> {
  slideId: SlideId
  elementId: ElementId
  focalPoint?: Point
}
export interface ShapeUpdateStyleOperation extends OperationBase<'shape.updateStyle'> {
  slideId: SlideId
  elementId: ElementId
  patch: Partial<ShapeStyle>
  replace?: boolean
}
export interface ChartReplaceDataOperation extends OperationBase<'chart.replaceData'> {
  slideId: SlideId
  elementId: ElementId
  data: ChartData
}
export interface ChartUpdateEncodingOperation extends OperationBase<'chart.updateEncoding'> {
  slideId: SlideId
  elementId: ElementId
  encoding: ChartEncoding
}
export interface ChartUpdateOptionsOperation extends OperationBase<'chart.updateOptions'> {
  slideId: SlideId
  elementId: ElementId
  patch: Partial<ChartOptions>
}
export interface ChartUpdateStyleOperation extends OperationBase<'chart.updateStyle'> {
  slideId: SlideId
  elementId: ElementId
  patch: Partial<ChartStyle>
}
export interface ComponentUpdatePropsOperation extends OperationBase<'component.updateProps'> {
  slideId: SlideId
  elementId: ElementId
  patch: Record<string, JsonValue>
  replace?: boolean
}
export interface GroupCreateOperation extends OperationBase<'group.create'> {
  slideId: SlideId
  group: LogicalGroup
}
export interface GroupDeleteOperation extends OperationBase<'group.delete'> {
  slideId: SlideId
  groupId: GroupId
}
export interface GroupAddMembersOperation extends OperationBase<'group.addMembers'> {
  slideId: SlideId
  groupId: GroupId
  elementIds: ElementId[]
}
export interface GroupRemoveMembersOperation extends OperationBase<'group.removeMembers'> {
  slideId: SlideId
  groupId: GroupId
  elementIds: ElementId[]
}
export interface GroupMoveOperation extends OperationBase<'group.move'> {
  slideId: SlideId
  groupId: GroupId
  dx: number
  dy: number
}
export interface GroupResizeOperation extends OperationBase<'group.resize'> {
  slideId: SlideId
  groupId: GroupId
  targetFrame: Frame
  scaleTextStyle?: boolean
}
export interface FactUpsertOperation extends OperationBase<'fact.upsert'> {
  fact: Fact
}
export interface FactDeleteOperation extends OperationBase<'fact.delete'> {
  factId: FactId
}
export interface FactSyncReferencesOperation extends OperationBase<'fact.syncReferences'> {
  factId: FactId
  targetElementIds: ElementId[]
  strategy: 'replace-display-value' | 'update-chart-values'
}
export interface SourceUpsertOperation extends OperationBase<'source.upsert'> {
  source: Source
}
export interface SourceDeleteOperation extends OperationBase<'source.delete'> {
  sourceId: SourceId
}
export interface LayoutAlignOperation extends OperationBase<'layout.align'> {
  slideId: SlideId
  elementIds: ElementId[]
  alignment: 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom'
  reference: 'selection' | 'slide' | ElementId
}
export interface LayoutDistributeOperation extends OperationBase<'layout.distribute'> {
  slideId: SlideId
  elementIds: ElementId[]
  axis: 'horizontal' | 'vertical'
  mode: 'centers' | 'gaps'
}

export interface Transaction {
  transactionId: TransactionId
  baseRevision: Revision
  actor: Actor
  scope: TransactionScope
  changeContract: ChangeContract
  reason?: string
  createdAt: string
  validationLevel?: ValidationLevel
  operations: Operation[]
  metadata?: Record<string, JsonValue>
}

export interface MutationSummary {
  changedSlides: number
  changedElements: number
  insertedElements: number
  deletedElements: number
  replacedAssets: number
  changedFacts: number
  changedSources: number
  changedThemeTokens: number
  changedStylePresets: number
}

export interface ValidationIssue {
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
  slideId?: SlideId
  elementId?: ElementId
  semanticKey?: string
  factId?: FactId
  path?: JsonPointer
  recovery?: string
  causeId?: string
}

export interface StructuralDiff {
  addedSlides: SlideId[]
  removedSlides: SlideId[]
  changedSlides: SlideId[]
  addedElements: Array<{ slideId: SlideId; elementId: ElementId }>
  removedElements: Array<{ slideId: SlideId; elementId: ElementId }>
  replacedElements: Array<{
    slideId: SlideId
    beforeElementId: ElementId
    afterElementId: ElementId
    semanticKey?: string
  }>
  changedPaths: JsonPointer[]
  mutationSummary: MutationSummary
}

export interface PreviewResult {
  ok: boolean
  baseRevision: Revision
  proposedRevision?: Revision
  document?: Readonly<PpteDocument>
  diff?: StructuralDiff
  issues: ValidationIssue[]
  requiresConfirmation?: boolean
}

export interface CommitResult {
  ok: boolean
  beforeRevision: Revision
  afterRevision?: Revision
  transactionId: TransactionId
  inverseTransaction?: Transaction
  diff?: StructuralDiff
  issues: ValidationIssue[]
}
