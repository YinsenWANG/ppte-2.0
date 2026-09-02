import type {
  Element,
  ImageElement,
  PpteDocument,
  ShapeElement,
  TextElement,
  ValidationIssue,
} from './index.js'

export function validateDocument(document: PpteDocument, options: { runtimeSubset?: boolean } = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const add = (code: string, message: string, extra: Partial<ValidationIssue> = {}) =>
    issues.push({ code, severity: 'error', message, ...extra })

  if (document?.schemaVersion !== '2.0.0') add('SCHEMA_VERSION_UNSUPPORTED', 'Only document schema 2.0.0 is supported.')
  if (!document?.documentId) add('SCHEMA_INVALID', 'documentId is required.', { path: '/documentId' })
  if (!document?.metadata?.title) add('SCHEMA_INVALID', 'metadata.title is required.', { path: '/metadata/title' })
  if (!document?.canvas || document.canvas.unit !== 'du') add('SCHEMA_INVALID', 'Canvas unit must be du.', { path: '/canvas/unit' })
  if (!finitePositive(document?.canvas?.width) || !finitePositive(document?.canvas?.height)) {
    add('GEOMETRY_INVALID', 'Canvas width and height must be finite and positive.', { path: '/canvas' })
  }
  if (!Array.isArray(document?.slideOrder)) add('SCHEMA_INVALID', 'slideOrder must be an array.', { path: '/slideOrder' })
  const seenSlides = new Set<string>()
  for (const slideId of document?.slideOrder ?? []) {
    if (seenSlides.has(slideId)) add('SCHEMA_INVALID', `Duplicate slideOrder id: ${slideId}`, { path: '/slideOrder' })
    seenSlides.add(slideId)
    if (!document.slides?.[slideId]) add('SCHEMA_INVALID', `slideOrder references missing slide: ${slideId}`, { path: '/slideOrder' })
  }
  for (const [slideId, slide] of Object.entries(document?.slides ?? {})) {
    if (slide.id !== slideId) add('SCHEMA_INVALID', 'Slide map key must equal slide.id.', { path: `/slides/${escapePointer(slideId)}/id` })
    const elementIds = Object.keys(slide.elements ?? {})
    const rootCounts = count(slide.rootOrder ?? [])
    for (const elementId of elementIds) {
      if (rootCounts.get(elementId) !== 1) add('SCHEMA_INVALID', `rootOrder must contain ${elementId} exactly once.`, { slideId, elementId })
      const element = slide.elements[elementId]
      if (element.id !== elementId) add('SCHEMA_INVALID', 'Element map key must equal element.id.', { slideId, elementId })
      if (!validFrame(element.frame)) add('GEOMETRY_INVALID', 'Element frame must contain finite x/y and positive width/height.', { slideId, elementId })
      if (options.runtimeSubset && element.type !== 'text' && element.type !== 'image' && element.type !== 'shape') {
        add('UNSUPPORTED_ELEMENT_TYPE', `Week 1–2 runtime does not implement ${element.type}.`, { slideId, elementId })
      }
    }
    for (const elementId of slide.rootOrder ?? []) {
      if (!slide.elements?.[elementId]) add('SCHEMA_INVALID', `rootOrder references missing element: ${elementId}`, { slideId, elementId })
    }
    if (new Set(slide.rootOrder ?? []).size !== (slide.rootOrder ?? []).length) add('SCHEMA_INVALID', 'rootOrder contains duplicate elements.', { slideId })
    const semanticKeys = new Set<string>()
    for (const element of Object.values(slide.elements ?? {})) {
      if (element.semanticKey) {
        if (semanticKeys.has(element.semanticKey)) add('SEMANTIC_KEY_DUPLICATE', `Duplicate semanticKey: ${element.semanticKey}`, { slideId, semanticKey: element.semanticKey })
        semanticKeys.add(element.semanticKey)
      }
      if (element.type === 'image' && !document.assets?.[element.assetId]) add('ASSET_MISSING', `Image references missing asset ${element.assetId}.`, { slideId, elementId: element.id })
      validateRefs(document, element, add, slideId)
      if (element.type === 'text') validateText(element, add, slideId)
    }
    const readingOrder = slide.readingOrder ?? []
    if (new Set(readingOrder).size !== readingOrder.length) add('READING_ORDER_INVALID', 'readingOrder contains duplicates.', { slideId })
    for (const elementId of readingOrder) if (!slide.elements?.[elementId]) add('READING_ORDER_INVALID', `readingOrder references missing element ${elementId}.`, { slideId, elementId })
    const membership = new Map<string, string>()
    for (const [groupId, group] of Object.entries(slide.groups ?? {})) {
      if (group.id !== groupId) add('SCHEMA_INVALID', 'Group map key must equal group.id.', { slideId })
      const members = new Set<string>()
      for (const elementId of group.memberIds) {
        if (!slide.elements?.[elementId]) add('FLAT_GROUP_MISSING_MEMBER', `Group references missing element ${elementId}.`, { slideId, elementId })
        if (members.has(elementId)) add('FLAT_GROUP_DUPLICATE_MEMBER', `Group repeats member ${elementId}.`, { slideId, elementId })
        members.add(elementId)
        if (membership.has(elementId)) add('FLAT_GROUP_DUPLICATE_MEMBER', `Element belongs to multiple groups: ${elementId}.`, { slideId, elementId })
        membership.set(elementId, groupId)
      }
    }
    for (const anchor of slide.protectedAnchors ?? []) {
      if (anchor.target.kind === 'element' && !slide.elements?.[anchor.target.elementId]) add('PROTECTED_ANCHOR_VIOLATION', 'Protected element anchor cannot be resolved.', { slideId, elementId: anchor.target.elementId })
      if (anchor.target.kind === 'semantic' && !semanticKeys.has(anchor.target.semanticKey)) add('PROTECTED_ANCHOR_VIOLATION', 'Protected semantic anchor cannot be resolved.', { slideId, semanticKey: anchor.target.semanticKey })
      if (anchor.target.kind === 'fact' && !document.facts?.[anchor.target.factId]) add('PROTECTED_ANCHOR_VIOLATION', 'Protected fact anchor cannot be resolved.', { slideId, factId: anchor.target.factId })
    }
  }
  for (const [assetId, asset] of Object.entries(document?.assets ?? {})) {
    if (asset.id !== assetId) add('SCHEMA_INVALID', 'Asset map key must equal asset.id.', { path: `/assets/${escapePointer(assetId)}/id` })
    if (!safeRelativeAssetPath(asset.path)) add('ASSET_PATH_INVALID', `Asset path is not a safe package path: ${asset.path}.`, { path: `/assets/${escapePointer(assetId)}/path` })
    if (!Number.isInteger(asset.byteLength) || asset.byteLength < 0) add('SCHEMA_INVALID', `Asset byteLength is invalid: ${assetId}.`, { path: `/assets/${escapePointer(assetId)}/byteLength` })
  }
  for (const [fontId, font] of Object.entries(document?.fonts ?? {})) {
    if (font.id !== fontId) add('SCHEMA_INVALID', 'Font map key must equal font.id.', { path: `/fonts/${escapePointer(fontId)}/id` })
  }
  return issues
}

function validateRefs(document: PpteDocument, element: Element, add: (code: string, message: string, extra?: Partial<ValidationIssue>) => void, slideId: string) {
  for (const factId of element.semanticRefs?.factIds ?? []) if (!document.facts?.[factId]) add('FACT_REFERENCE_MISSING', `Missing fact ${factId}.`, { slideId, elementId: element.id, factId })
  for (const sourceId of element.semanticRefs?.sourceIds ?? []) if (!document.sources?.[sourceId]) add('SOURCE_REFERENCE_MISSING', `Missing source ${sourceId}.`, { slideId, elementId: element.id })
}

function validateText(element: TextElement, add: (code: string, message: string, extra?: Partial<ValidationIssue>) => void, slideId: string) {
  const paragraphIds = new Set<string>()
  for (const paragraph of element.content?.paragraphs ?? []) {
    if (paragraphIds.has(paragraph.id)) add('SCHEMA_INVALID', `Duplicate paragraph id ${paragraph.id}.`, { slideId, elementId: element.id })
    paragraphIds.add(paragraph.id)
    const runIds = new Set<string>()
    for (const run of paragraph.runs ?? []) {
      if (runIds.has(run.id)) add('SCHEMA_INVALID', `Duplicate run id ${run.id}.`, { slideId, elementId: element.id })
      runIds.add(run.id)
      if (run.text.includes('\u0000')) add('SCHEMA_INVALID', 'Text cannot contain NUL.', { slideId, elementId: element.id })
    }
  }
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}
function validFrame(frame: unknown): frame is { x: number; y: number; width: number; height: number } {
  if (!frame || typeof frame !== 'object') return false
  const candidate = frame as Record<string, unknown>
  return [candidate.x, candidate.y].every((value) => typeof value === 'number' && Number.isFinite(value)) && finitePositive(candidate.width) && finitePositive(candidate.height)
}
function count(values: string[]): Map<string, number> {
  const result = new Map<string, number>()
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1)
  return result
}
function escapePointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}
function safeRelativeAssetPath(value: string): boolean {
  return value.startsWith('assets/') && !value.startsWith('/') && !value.includes('..') && !value.includes('\\') && !value.includes('\u0000')
}

export type RuntimeElement = TextElement | ImageElement | ShapeElement
export type RuntimeShape = ShapeElement
export type RuntimeImage = ImageElement
