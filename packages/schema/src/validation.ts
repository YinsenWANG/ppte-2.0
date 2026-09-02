import type {
  Element,
  ImageElement,
  PpteDocument,
  ShapeElement,
  TextElement,
  ValidationIssue,
} from './index.js'

const ELEMENT_TYPES = new Set(['text', 'image', 'shape', 'chart', 'component'])
const SHAPE_KINDS = new Set(['rectangle', 'rounded-rectangle', 'ellipse', 'line', 'arrow', 'triangle', 'diamond', 'chevron', 'polygon'])

/** Structural/runtime validation kept dependency-free for open and commit gates. */
export function validateDocument(document: PpteDocument, options: { runtimeSubset?: boolean } = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const add = (code: string, message: string, extra: Partial<ValidationIssue> = {}) => issues.push({ code, severity: 'error', message, ...extra })
  const root = document as unknown as Record<string, unknown> | undefined
  if (!root || typeof root !== 'object') return [{ code: 'SCHEMA_INVALID', severity: 'error', message: 'Document must be an object.', path: '/' }]

  if (document.schemaVersion !== '2.0.0') add('SCHEMA_VERSION_UNSUPPORTED', 'Only document schema 2.0.0 is supported.')
  if (!document.documentId || typeof document.documentId !== 'string') add('SCHEMA_INVALID', 'documentId is required.', { path: '/documentId' })
  if (!document.locale || typeof document.locale !== 'string') add('SCHEMA_INVALID', 'locale is required.', { path: '/locale' })
  if (!document.metadata || typeof document.metadata !== 'object' || typeof document.metadata.title !== 'string' || !document.metadata.title) add('SCHEMA_INVALID', 'metadata.title is required.', { path: '/metadata/title' })
  if (!document.canvas || document.canvas.unit !== 'du') add('SCHEMA_INVALID', 'Canvas unit must be du.', { path: '/canvas/unit' })
  if (!finitePositive(document.canvas?.width) || !finitePositive(document.canvas?.height)) add('GEOMETRY_INVALID', 'Canvas width and height must be finite and positive.', { path: '/canvas' })
  if (document.canvas?.safeArea && !validInsets(document.canvas.safeArea)) add('GEOMETRY_INVALID', 'Canvas safeArea must contain finite non-negative insets.', { path: '/canvas/safeArea' })

  if (!Array.isArray(document.slideOrder)) add('SCHEMA_INVALID', 'slideOrder must be an array.', { path: '/slideOrder' })
  const slides = document.slides && typeof document.slides === 'object' ? document.slides : {}
  const seenSlides = new Set<string>()
  for (const slideId of document.slideOrder ?? []) {
    if (typeof slideId !== 'string' || !slideId) add('SCHEMA_INVALID', 'slideOrder ids must be non-empty strings.', { path: '/slideOrder' })
    if (seenSlides.has(slideId)) add('SCHEMA_INVALID', `Duplicate slideOrder id: ${slideId}`, { path: '/slideOrder' })
    seenSlides.add(slideId)
    if (!slides[slideId]) add('SCHEMA_INVALID', `slideOrder references missing slide: ${slideId}`, { path: '/slideOrder' })
  }
  for (const slideId of Object.keys(slides)) {
    if (!seenSlides.has(slideId)) add('SCHEMA_INVALID', `Slide ${slideId} is not present in slideOrder.`, { path: `/slides/${escapePointer(slideId)}` })
  }

  for (const [slideId, slide] of Object.entries(slides)) {
    if (!slide || typeof slide !== 'object') {
      add('SCHEMA_INVALID', 'Slide must be an object.', { path: `/slides/${escapePointer(slideId)}` })
      continue
    }
    if (slide.id !== slideId) add('SCHEMA_INVALID', 'Slide map key must equal slide.id.', { path: `/slides/${escapePointer(slideId)}/id` })
    if (!Array.isArray(slide.rootOrder)) add('SCHEMA_INVALID', 'rootOrder must be an array.', { slideId })
    const elements = slide.elements && typeof slide.elements === 'object' ? slide.elements : {}
    const elementIds = Object.keys(elements)
    const rootCounts = count(slide.rootOrder ?? [])
    for (const elementId of elementIds) {
      if (rootCounts.get(elementId) !== 1) add('SCHEMA_INVALID', `rootOrder must contain ${elementId} exactly once.`, { slideId, elementId })
      const element = elements[elementId]
      if (!element || typeof element !== 'object') {
        add('SCHEMA_INVALID', 'Element must be an object.', { slideId, elementId })
        continue
      }
      if (element.id !== elementId) add('SCHEMA_INVALID', 'Element map key must equal element.id.', { slideId, elementId })
      validateElement(element, add, slideId, elementId, options.runtimeSubset === true)
      validateRefs(document, element, add, slideId)
    }
    for (const elementId of slide.rootOrder ?? []) if (!elements[elementId]) add('SCHEMA_INVALID', `rootOrder references missing element: ${elementId}`, { slideId, elementId })
    if (new Set(slide.rootOrder ?? []).size !== (slide.rootOrder ?? []).length) add('SCHEMA_INVALID', 'rootOrder contains duplicate elements.', { slideId })

    const semanticKeys = new Set<string>()
    for (const element of Object.values(elements)) {
      if (!element || typeof element !== 'object') continue
      if (element.semanticKey) {
        if (semanticKeys.has(element.semanticKey)) add('SEMANTIC_KEY_DUPLICATE', `Duplicate semanticKey: ${element.semanticKey}`, { slideId, semanticKey: element.semanticKey })
        semanticKeys.add(element.semanticKey)
      }
    }
    const readingOrder = slide.readingOrder ?? []
    if (!Array.isArray(readingOrder)) add('READING_ORDER_INVALID', 'readingOrder must be an array.', { slideId })
    if (new Set(readingOrder).size !== readingOrder.length) add('READING_ORDER_INVALID', 'readingOrder contains duplicates.', { slideId })
    for (const elementId of readingOrder) if (!elements[elementId]) add('READING_ORDER_INVALID', `readingOrder references missing element ${elementId}.`, { slideId, elementId })
    validateGroups(slide, elements, add, slideId)
    for (const anchor of slide.protectedAnchors ?? []) {
      if (!anchor || !Array.isArray(anchor.preserve) || anchor.preserve.length === 0) add('SCHEMA_INVALID', 'Protected anchor must preserve at least one field.', { slideId })
      if (anchor.target?.kind === 'element' && !elements[anchor.target.elementId]) add('PROTECTED_ANCHOR_VIOLATION', 'Protected element anchor cannot be resolved.', { slideId, elementId: anchor.target.elementId })
      if (anchor.target?.kind === 'semantic' && !semanticKeys.has(anchor.target.semanticKey)) add('PROTECTED_ANCHOR_VIOLATION', 'Protected semantic anchor cannot be resolved.', { slideId, semanticKey: anchor.target.semanticKey })
      if (anchor.target?.kind === 'fact' && !document.facts?.[anchor.target.factId]) add('PROTECTED_ANCHOR_VIOLATION', 'Protected fact anchor cannot be resolved.', { slideId, factId: anchor.target.factId })
    }
  }

  validateFactsAndSources(document, add)
  for (const [assetId, asset] of Object.entries(document.assets ?? {})) {
    if (!asset || typeof asset !== 'object') { add('SCHEMA_INVALID', 'Asset must be an object.', { path: `/assets/${escapePointer(assetId)}` }); continue }
    if (asset.id !== assetId) add('SCHEMA_INVALID', 'Asset map key must equal asset.id.', { path: `/assets/${escapePointer(assetId)}/id` })
    if (typeof asset.hash !== 'string' || !asset.hash) add('SCHEMA_INVALID', `Asset hash is required: ${assetId}.`, { path: `/assets/${escapePointer(assetId)}/hash` })
    if (!safeRelativeAssetPath(asset.path)) add('ASSET_PATH_INVALID', `Asset path is not a safe package path: ${asset.path}.`, { path: `/assets/${escapePointer(assetId)}/path` })
    if (!Number.isInteger(asset.byteLength) || asset.byteLength < 0) add('SCHEMA_INVALID', `Asset byteLength is invalid: ${assetId}.`, { path: `/assets/${escapePointer(assetId)}/byteLength` })
  }
  for (const [fontId, font] of Object.entries(document.fonts ?? {})) {
    if (!font || typeof font !== 'object') { add('SCHEMA_INVALID', 'Font must be an object.', { path: `/fonts/${escapePointer(fontId)}` }); continue }
    if (font.id !== fontId) add('SCHEMA_INVALID', 'Font map key must equal font.id.', { path: `/fonts/${escapePointer(fontId)}/id` })
    if (!font.family || !['normal', 'italic'].includes(font.style) || !finitePositive(font.weight)) add('SCHEMA_INVALID', `Font metadata is invalid: ${fontId}.`, { path: `/fonts/${escapePointer(fontId)}` })
    if (font.glyphCoverage?.some((range) => !Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end < range.start)) add('SCHEMA_INVALID', `Font glyph coverage is invalid: ${fontId}.`, { path: `/fonts/${escapePointer(fontId)}/glyphCoverage` })
  }
  return issues
}

function validateElement(element: Element, add: (code: string, message: string, extra?: Partial<ValidationIssue>) => void, slideId: string, elementId: string, runtimeSubset: boolean) {
  if (!ELEMENT_TYPES.has(element.type)) { add('SCHEMA_INVALID', `Unknown element type: ${element.type}.`, { slideId, elementId }); return }
  if (!validFrame(element.frame)) add('GEOMETRY_INVALID', 'Element frame must contain finite x/y and positive width/height.', { slideId, elementId })
  if (element.rotationDeg !== undefined && !finite(element.rotationDeg)) add('GEOMETRY_INVALID', 'rotationDeg must be finite.', { slideId, elementId })
  if (element.opacity !== undefined && (!finite(element.opacity) || element.opacity < 0 || element.opacity > 1)) add('SCHEMA_INVALID', 'opacity must be between 0 and 1.', { slideId, elementId })
  if (element.appearStep !== undefined && (!Number.isInteger(element.appearStep) || element.appearStep < 0)) add('SCHEMA_INVALID', 'appearStep must be a non-negative integer.', { slideId, elementId })
  if (runtimeSubset && element.type !== 'text' && element.type !== 'image' && element.type !== 'shape') add('UNSUPPORTED_ELEMENT_TYPE', `Stable Core runtime does not implement ${element.type}.`, { slideId, elementId })
  if (element.type === 'text') validateText(element, add, slideId)
  if (element.type === 'image') validateImage(element, add, slideId)
  if (element.type === 'shape') validateShape(element, add, slideId)
  if (element.type === 'chart') validateChart(element, add, slideId)
  if (element.type === 'component' && (!element.componentType || !element.componentVersion || !element.fallback)) add('SCHEMA_INVALID', 'Component requires type, version, and fallback.', { slideId, elementId })
}

function validateText(element: TextElement, add: (code: string, message: string, extra?: Partial<ValidationIssue>) => void, slideId: string) {
  if (!element.style || !element.style.styleRef) add('SCHEMA_INVALID', 'Text requires a style binding.', { slideId, elementId: element.id })
  const paragraphIds = new Set<string>()
  for (const paragraph of element.content?.paragraphs ?? []) {
    if (!paragraph || !paragraph.id || paragraphIds.has(paragraph.id)) add('SCHEMA_INVALID', `Duplicate or missing paragraph id ${paragraph?.id ?? ''}.`, { slideId, elementId: element.id })
    paragraphIds.add(paragraph.id)
    if (paragraph.list && !['bullet', 'number'].includes(paragraph.list.type)) add('SCHEMA_INVALID', 'Text supports only single-level bullet or number lists.', { slideId, elementId: element.id })
    const runIds = new Set<string>()
    for (const run of paragraph.runs ?? []) {
      if (!run || !run.id || runIds.has(run.id)) add('SCHEMA_INVALID', `Duplicate or missing run id ${run?.id ?? ''}.`, { slideId, elementId: element.id })
      runIds.add(run.id)
      if (typeof run.text !== 'string' || run.text.includes('\u0000')) add('SCHEMA_INVALID', 'Text must be a NUL-free string.', { slideId, elementId: element.id })
      if (run && Object.keys(run as unknown as Record<string, unknown>).some((key) => !['id', 'text', 'marks'].includes(key))) add('SCHEMA_INVALID', 'Text Run may not contain font or font-size fields.', { slideId, elementId: element.id })
      const marks = run.marks as Record<string, unknown> | undefined
      if (marks && Object.keys(marks).some((key) => !['bold', 'italic', 'underline', 'strike', 'color'].includes(key))) add('SCHEMA_INVALID', 'Run marks may not contain font or font-size fields.', { slideId, elementId: element.id })
    }
  }
}

function validateImage(element: ImageElement, add: (code: string, message: string, extra?: Partial<ValidationIssue>) => void, slideId: string) {
  if (!element.assetId || !['contain', 'cover', 'fill'].includes(element.fit)) add('SCHEMA_INVALID', 'Image requires assetId and a valid fit.', { slideId, elementId: element.id })
  if (element.crop && (!validNormalizedRect(element.crop))) add('GEOMETRY_INVALID', 'Image crop must be a positive rectangle inside 0–1.', { slideId, elementId: element.id })
  if (element.focalPoint && (!finite(element.focalPoint.x) || !finite(element.focalPoint.y) || element.focalPoint.x < 0 || element.focalPoint.x > 1 || element.focalPoint.y < 0 || element.focalPoint.y > 1)) add('GEOMETRY_INVALID', 'Image focalPoint must be inside 0–1.', { slideId, elementId: element.id })
}

function validateShape(element: ShapeElement, add: (code: string, message: string, extra?: Partial<ValidationIssue>) => void, slideId: string) {
  if (!SHAPE_KINDS.has(element.shape)) add('SCHEMA_INVALID', `Unknown shape kind: ${element.shape}.`, { slideId, elementId: element.id })
  if (element.points?.some((point) => !finite(point.x) || !finite(point.y))) add('GEOMETRY_INVALID', 'Shape points must be finite.', { slideId, elementId: element.id })
}

function validateChart(element: Extract<Element, { type: 'chart' }>, add: (code: string, message: string, extra?: Partial<ValidationIssue>) => void, slideId: string) {
  if (!['bar', 'line', 'area', 'pie', 'donut'].includes(element.chartType) || !element.data || !element.encoding) add('SCHEMA_INVALID', 'Chart type, data, and encoding are required.', { slideId, elementId: element.id })
}

function validateGroups(slide: PpteDocument['slides'][string], elements: Record<string, Element>, add: (code: string, message: string, extra?: Partial<ValidationIssue>) => void, slideId: string) {
  const membership = new Map<string, string>()
  for (const [groupId, group] of Object.entries(slide.groups ?? {})) {
    if (group.id !== groupId) add('SCHEMA_INVALID', 'Group map key must equal group.id.', { slideId })
    if (!Array.isArray(group.memberIds)) { add('SCHEMA_INVALID', 'Group memberIds must be an array.', { slideId }); continue }
    const members = new Set<string>()
    for (const elementId of group.memberIds) {
      if (!elements[elementId]) add('FLAT_GROUP_MISSING_MEMBER', `Group references missing element ${elementId}.`, { slideId, elementId })
      if (members.has(elementId)) add('FLAT_GROUP_DUPLICATE_MEMBER', `Group repeats member ${elementId}.`, { slideId, elementId })
      members.add(elementId)
      if (membership.has(elementId)) add('FLAT_GROUP_DUPLICATE_MEMBER', `Element belongs to multiple groups: ${elementId}.`, { slideId, elementId })
      membership.set(elementId, groupId)
    }
  }
}

function validateRefs(document: PpteDocument, element: Element, add: (code: string, message: string, extra?: Partial<ValidationIssue>) => void, slideId: string) {
  for (const factId of element.semanticRefs?.factIds ?? []) if (!document.facts?.[factId]) add('FACT_REFERENCE_MISSING', `Missing fact ${factId}.`, { slideId, elementId: element.id, factId })
  for (const sourceId of element.semanticRefs?.sourceIds ?? []) if (!document.sources?.[sourceId]) add('SOURCE_REFERENCE_MISSING', `Missing source ${sourceId}.`, { slideId, elementId: element.id })
}

function validateFactsAndSources(document: PpteDocument, add: (code: string, message: string, extra?: Partial<ValidationIssue>) => void) {
  for (const [factId, fact] of Object.entries(document.facts ?? {})) if (fact.id !== factId || !fact.key) add('SCHEMA_INVALID', `Fact metadata is invalid: ${factId}.`, { factId })
  for (const [sourceId, source] of Object.entries(document.sources ?? {})) if (source.id !== sourceId) add('SCHEMA_INVALID', `Source metadata is invalid: ${sourceId}.`, { path: `/sources/${escapePointer(sourceId)}/id` })
}

function validInsets(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const insets = value as Record<string, unknown>
  return ['top', 'right', 'bottom', 'left'].every((key) => finiteNonNegative(insets[key]))
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function finitePositive(value: unknown): value is number { return finite(value) && value > 0 }
function finiteNonNegative(value: unknown): value is number { return finite(value) && value >= 0 }
function validFrame(frame: unknown): frame is { x: number; y: number; width: number; height: number } {
  if (!frame || typeof frame !== 'object') return false
  const candidate = frame as Record<string, unknown>
  return finite(candidate.x) && finite(candidate.y) && finitePositive(candidate.width) && finitePositive(candidate.height)
}
function validNormalizedRect(rect: { x: number; y: number; width: number; height: number }): boolean {
  return finite(rect.x) && finite(rect.y) && finitePositive(rect.width) && finitePositive(rect.height) && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 1 && rect.y + rect.height <= 1
}
function count(values: string[]): Map<string, number> {
  const result = new Map<string, number>()
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1)
  return result
}
function escapePointer(value: string): string { return value.replaceAll('~', '~0').replaceAll('/', '~1') }
function safeRelativeAssetPath(value: string): boolean { return typeof value === 'string' && value.startsWith('assets/') && !value.startsWith('/') && !value.includes('..') && !value.includes('\\') && !value.includes('\u0000') }

export type RuntimeElement = TextElement | ImageElement | ShapeElement
export type RuntimeShape = ShapeElement
export type RuntimeImage = ImageElement
