import type { ElementId, JsonPointer, Revision, SlideId } from './document.js'
import type { Operation, ValidationIssue } from './operations.js'

/** The semantic granularity at which a revised copy can be reviewed. */
export type ReviewUnitKind = 'slide' | 'element' | 'fact' | 'source' | 'document'
export type ReviewField =
  | 'schemaVersion'
  | 'documentId'
  | 'locale'
  | 'metadata'
  | 'canvas'
  | 'theme'
  | 'slideOrder'
  | 'widgetRequirements'
  | 'policies'
  | 'generation'
  | 'extensions'
  | 'name'
  | 'hidden'
  | 'background'
  | 'rootOrder'
  | 'groups'
  | 'notes'
  | 'transition'
  | 'semantic'
  | 'visualStrategy'
  | 'protectedAnchors'
  | 'provenance'
  | 'type'
  | 'semanticKey'
  | 'role'
  | 'tags'
  | 'description'
  | 'frame'
  | 'rotationDeg'
  | 'flipX'
  | 'flipY'
  | 'opacity'
  | 'visible'
  | 'locked'
  | 'appearStep'
  | 'animation'
  | 'editPolicy'
  | 'semanticRefs'
  | 'paragraphStyle'
  | 'boxStyle'
  | 'overflowPolicy'
  | 'assetId'
  | 'fit'
  | 'crop'
  | 'focalPoint'
  | 'altText'
  | 'shape'
  | 'points'
  | 'chartType'
  | 'componentType'
  | 'componentVersion'
  | 'props'
  | 'fallback'
  | 'content'
  | 'data'
  | 'encoding'
  | 'options'
  | 'style'
  | 'geometry'
  | 'asset'
  | 'identity'
  | 'visibility'
  | 'structure'
  | 'readingOrder'
  | 'fact'
  | 'source'
  | 'font'
  | 'slide'

export type ReviewUnitStatus =
  | 'unchanged'
  | 'local-only'
  | 'revised-only'
  | 'same-change'
  | 'conflict'
  | 'added'
  | 'deleted'
  | 'ambiguous'

export type SemanticMatchMethod = 'elementId' | 'semanticKey' | 'lineage' | 'factId' | 'sourceId' | 'heuristic' | 'none'

export interface ReviewCapabilityGap {
  code: 'REVIEW_CAPABILITY_GAP'
  field: ReviewField
  path: JsonPointer
  message: string
  supported: false
}

export interface SemanticReviewUnit {
  unitId: string
  kind: ReviewUnitKind
  field: ReviewField
  path: JsonPointer
  slideId?: SlideId
  elementId?: ElementId
  semanticKey?: string
  status: ReviewUnitStatus
  match: SemanticMatchMethod
  baseValue?: unknown
  localValue?: unknown
  revisedValue?: unknown
  /** Operations are generated against the local copy and remain reviewable before commit. */
  operations?: Operation[]
  candidates?: string[]
  reason?: string
  /** A changed field with no typed operation is visible to the reviewer and cannot be silently dropped. */
  capabilityGap?: ReviewCapabilityGap
}

export interface CompareResult {
  documentId: string
  baseRevision: Revision
  localRevision: Revision
  revisedRevision: Revision
  baseAvailable: boolean
  twoWay: boolean
  units: SemanticReviewUnit[]
  conflicts: SemanticReviewUnit[]
  capabilityGaps: ReviewCapabilityGap[]
  issues: ValidationIssue[]
  autoAcceptable: boolean
}

export interface ReviewSelection {
  unitIds?: string[]
  includeRevisedOnly?: boolean
  includeSameChange?: boolean
  includeAdded?: boolean
  includeDeleted?: boolean
  /** Explicit human resolution for a conflicted or ambiguous unit. */
  resolutions?: Record<string, 'local' | 'revised'>
}
