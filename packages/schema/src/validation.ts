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
  if (!document.locale || typeof document.locale !== 'string' || document.locale.length < 2) add('SCHEMA_INVALID', 'locale is required.', { path: '/locale' })
  if (!document.metadata || typeof document.metadata !== 'object' || typeof document.metadata.title !== 'string' || !document.metadata.title) add('SCHEMA_INVALID', 'metadata.title is required.', { path: '/metadata/title' })
  if (!document.canvas || typeof document.canvas !== 'object' || document.canvas.unit !== 'du') add('SCHEMA_INVALID', 'Canvas unit must be du.', { path: '/canvas/unit' })
  if (!finitePositive(document.canvas?.width) || !finitePositive(document.canvas?.height)) add('GEOMETRY_INVALID', 'Canvas width and height must be finite and positive.', { path: '/canvas' })
  if (!document.canvas?.aspectRatio || !['16:9', '4:3', 'custom'].includes(document.canvas.aspectRatio)) add('SCHEMA_INVALID', 'Canvas aspectRatio is invalid.', { path: '/canvas/aspectRatio' })
  if (!document.canvas?.defaultBackground || !validPaint(document.canvas.defaultBackground)) add('SCHEMA_INVALID', 'Canvas defaultBackground is invalid.', { path: '/canvas/defaultBackground' })
  if (document.canvas?.safeArea && !validInsets(document.canvas.safeArea)) add('GEOMETRY_INVALID', 'Canvas safeArea must contain finite non-negative insets.', { path: '/canvas/safeArea' })
  if (document.policies !== undefined) validatePolicies(document.policies, add)
  if (document.widgetRequirements !== undefined) validateWidgetRequirements(document.widgetRequirements, add)

  if (!document.theme || typeof document.theme !== 'object') add('SCHEMA_INVALID', 'theme is required.', { path: '/theme' })
  else validateTheme(document.theme, add)

  if (!Array.isArray(document.slideOrder)) add('SCHEMA_INVALID', 'slideOrder must be an array.', { path: '/slideOrder' })
  if (!document.slides || typeof document.slides !== 'object' || Array.isArray(document.slides)) add('SCHEMA_INVALID', 'slides must be an object map.', { path: '/slides' })
  const slides = document.slides && typeof document.slides === 'object' && !Array.isArray(document.slides) ? document.slides : {}
  const seenSlides = new Set<string>()
  const slideOrder = Array.isArray(document.slideOrder) ? document.slideOrder : []
  for (const slideId of slideOrder) {
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
    if (!slide.elements || typeof slide.elements !== 'object' || Array.isArray(slide.elements)) add('SCHEMA_INVALID', 'elements must be an object map.', { slideId })
    if (slide.groups !== undefined && (!slide.groups || typeof slide.groups !== 'object' || Array.isArray(slide.groups))) add('SCHEMA_INVALID', 'groups must be an object map.', { slideId })
    if (slide.protectedAnchors !== undefined && !Array.isArray(slide.protectedAnchors)) add('SCHEMA_INVALID', 'protectedAnchors must be an array.', { slideId })
    const elements = slide.elements && typeof slide.elements === 'object' && !Array.isArray(slide.elements) ? slide.elements : {}
    const elementIds = Object.keys(elements)
    const rootOrder = Array.isArray(slide.rootOrder) ? slide.rootOrder : []
    const rootCounts = count(rootOrder)
    for (const elementId of elementIds) {
      if (rootCounts.get(elementId) !== 1) add('SCHEMA_INVALID', `rootOrder must contain ${elementId} exactly once.`, { slideId, elementId })
      const element = elements[elementId]
      if (!element || typeof element !== 'object') {
        add('SCHEMA_INVALID', 'Element must be an object.', { slideId, elementId })
        continue
      }
      if (element.id !== elementId) add('SCHEMA_INVALID', 'Element map key must equal element.id.', { slideId, elementId })
      if (!element.id || typeof element.id !== 'string' || !element.type) add('SCHEMA_INVALID', 'Element id and type are required.', { slideId, elementId })
      validateElement(element, add, slideId, elementId, options.runtimeSubset === true)
      if (element.type === 'image' && !document.assets?.[element.assetId]) add('ASSET_MISSING', `Image references missing asset ${element.assetId}.`, { slideId, elementId })
      validateRefs(document, element, add, slideId)
    }
    for (const elementId of rootOrder) if (!elements[elementId]) add('SCHEMA_INVALID', `rootOrder references missing element: ${elementId}`, { slideId, elementId })
    if (new Set(rootOrder).size !== rootOrder.length) add('SCHEMA_INVALID', 'rootOrder contains duplicate elements.', { slideId })

    const semanticKeys = new Set<string>()
    for (const element of Object.values(elements)) {
      if (!element || typeof element !== 'object') continue
      if (element.semanticKey) {
        if (semanticKeys.has(element.semanticKey)) add('SEMANTIC_KEY_DUPLICATE', `Duplicate semanticKey: ${element.semanticKey}`, { slideId, semanticKey: element.semanticKey })
        semanticKeys.add(element.semanticKey)
      }
    }
    const readingOrder = Array.isArray(slide.readingOrder) ? slide.readingOrder : []
    if (!Array.isArray(slide.readingOrder) && slide.readingOrder !== undefined) add('READING_ORDER_INVALID', 'readingOrder must be an array.', { slideId })
    if (new Set(readingOrder).size !== readingOrder.length) add('READING_ORDER_INVALID', 'readingOrder contains duplicates.', { slideId })
    for (const elementId of readingOrder) if (!elements[elementId]) add('READING_ORDER_INVALID', `readingOrder references missing element ${elementId}.`, { slideId, elementId })
    validateGroups(slide, elements, add, slideId)
    for (const anchor of Array.isArray(slide.protectedAnchors) ? slide.protectedAnchors : []) {
      if (!anchor || typeof anchor !== 'object' || !Array.isArray(anchor.preserve) || anchor.preserve.length === 0) {
        add('SCHEMA_INVALID', 'Protected anchor must preserve at least one field.', { slideId })
        continue
      }
      if (anchor.target?.kind === 'element' && !elements[anchor.target.elementId]) add('PROTECTED_ANCHOR_VIOLATION', 'Protected element anchor cannot be resolved.', { slideId, elementId: anchor.target.elementId })
      if (anchor.target?.kind === 'semantic' && !semanticKeys.has(anchor.target.semanticKey)) add('PROTECTED_ANCHOR_VIOLATION', 'Protected semantic anchor cannot be resolved.', { slideId, semanticKey: anchor.target.semanticKey })
      if (anchor.target?.kind === 'fact' && !document.facts?.[anchor.target.factId]) add('PROTECTED_ANCHOR_VIOLATION', 'Protected fact anchor cannot be resolved.', { slideId, factId: anchor.target.factId })
    }
  }

  if (!document.assets || typeof document.assets !== 'object' || Array.isArray(document.assets)) add('SCHEMA_INVALID', 'assets must be an object map.', { path: '/assets' })
  if (!document.fonts || typeof document.fonts !== 'object' || Array.isArray(document.fonts)) add('SCHEMA_INVALID', 'fonts must be an object map.', { path: '/fonts' })
  validateFactsAndSources(document, add)
  for (const [assetId, asset] of Object.entries(document.assets ?? {})) {
    if (!asset || typeof asset !== 'object') { add('SCHEMA_INVALID', 'Asset must be an object.', { path: `/assets/${escapePointer(assetId)}` }); continue }
    if (asset.id !== assetId) add('SCHEMA_INVALID', 'Asset map key must equal asset.id.', { path: `/assets/${escapePointer(assetId)}/id` })
    if (typeof asset.hash !== 'string' || !/^sha256-[0-9a-fA-F]{64}$/.test(asset.hash)) add('SCHEMA_INVALID', `Asset hash must be a SHA-256 digest: ${assetId}.`, { path: `/assets/${escapePointer(assetId)}/hash` })
    if (!safeRelativeAssetPath(asset.path)) add('ASSET_PATH_INVALID', `Asset path is not a safe package path: ${asset.path}.`, { path: `/assets/${escapePointer(assetId)}/path` })
    if (!Number.isInteger(asset.byteLength) || asset.byteLength < 0) add('SCHEMA_INVALID', `Asset byteLength is invalid: ${assetId}.`, { path: `/assets/${escapePointer(assetId)}/byteLength` })
    if (asset.width !== undefined && (!Number.isInteger(asset.width) || asset.width <= 0)) add('SCHEMA_INVALID', `Asset width is invalid: ${assetId}.`, { path: `/assets/${escapePointer(assetId)}/width` })
    if (asset.height !== undefined && (!Number.isInteger(asset.height) || asset.height <= 0)) add('SCHEMA_INVALID', `Asset height is invalid: ${assetId}.`, { path: `/assets/${escapePointer(assetId)}/height` })
    if (asset.durationMs !== undefined && (!Number.isInteger(asset.durationMs) || asset.durationMs < 0)) add('SCHEMA_INVALID', `Asset durationMs is invalid: ${assetId}.`, { path: `/assets/${escapePointer(assetId)}/durationMs` })
  }
  for (const [fontId, font] of Object.entries(document.fonts ?? {})) {
    if (!font || typeof font !== 'object') { add('SCHEMA_INVALID', 'Font must be an object.', { path: `/fonts/${escapePointer(fontId)}` }); continue }
    if (font.id !== fontId) add('SCHEMA_INVALID', 'Font map key must equal font.id.', { path: `/fonts/${escapePointer(fontId)}/id` })
    if (!font.family || !['normal', 'italic'].includes(font.style) || !Number.isInteger(font.weight) || font.weight < 100 || font.weight > 1000) add('SCHEMA_INVALID', `Font metadata is invalid: ${fontId}.`, { path: `/fonts/${escapePointer(fontId)}` })
    if (font.hash !== undefined && (typeof font.hash !== 'string' || !/^sha256-[0-9a-fA-F]{64}$/.test(font.hash))) add('SCHEMA_INVALID', `Font hash must be a SHA-256 digest: ${fontId}.`, { path: `/fonts/${escapePointer(fontId)}/hash` })
    if (font.path !== undefined && !safeRelativeFontPath(font.path)) add('ASSET_PATH_INVALID', `Font path is not a safe package path: ${font.path}.`, { path: `/fonts/${escapePointer(fontId)}/path` })
    if (font.glyphCoverage !== undefined && (!Array.isArray(font.glyphCoverage) || font.glyphCoverage.some((range) => !range || !Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end < range.start))) add('SCHEMA_INVALID', `Font glyph coverage is invalid: ${fontId}.`, { path: `/fonts/${escapePointer(fontId)}/glyphCoverage` })
  }
  return issues
}

function validatePolicies(policies: NonNullable<PpteDocument['policies']>, add: (code: string, message: string, extra?: Partial<ValidationIssue>) => void) {
  if (!policies || typeof policies !== 'object' || Array.isArray(policies)) {
    add('SCHEMA_INVALID', 'policies must be an object.', { path: '/policies' })
    return
  }
  for (const field of ['allowExternalLinks', 'allowNetworkAssets', 'allowPortableEditing'] as const) if (policies[field] !== undefined && typeof policies[field] !== 'boolean') add('SCHEMA_INVALID', `${field} must be boolean.`, { path: `/policies/${field}` })
  for (const field of ['maxHistoryEntries', 'maxHistoryBytes'] as const) if (policies[field] !== undefined && (!Number.isInteger(policies[field]) || policies[field] <= 0)) add('SCHEMA_INVALID', `${field} must be a positive integer.`, { path: `/policies/${field}` })
  if (policies.defaultAgentScope !== undefined && !['selection', 'slide', 'document'].includes(policies.defaultAgentScope)) add('SCHEMA_INVALID', 'defaultAgentScope is invalid.', { path: '/policies/defaultAgentScope' })
}

function validateWidgetRequirements(requirements: NonNullable<PpteDocument['widgetRequirements']>, add: (code: string, message: string, extra?: Partial<ValidationIssue>) => void) {
  if (!Array.isArray(requirements)) {
    add('SCHEMA_INVALID', 'widgetRequirements must be an array.', { path: '/widgetRequirements' })
    return
  }
  for (const [index, requirement] of requirements.entries()) if (!requirement || typeof requirement !== 'object' || !requirement.type || !requirement.versionRange || requirement.fallbackRequired !== true) add('SCHEMA_INVALID', 'Widget requirement must contain type, versionRange, and fallbackRequired=true.', { path: `/widgetRequirements/${index}` })
}

function validateTheme(theme: PpteDocument['theme'], add: (code: string, message: string, extra?: Partial<ValidationIssue>) => void) {
  if (!theme.id || typeof theme.id !== 'string' || typeof theme.name !== 'string' || !theme.name || !theme.tokens || typeof theme.tokens !== 'object' || !theme.presets || typeof theme.presets !== 'object') {
    add('SCHEMA_INVALID', 'Theme requires id, name, tokens, and presets.', { path: '/theme' })
    return
  }
  for (const category of ['colors', 'fontFamilies', 'fontSizes', 'spacing', 'radii', 'shadows'] as const) {
    const bucket = theme.tokens[category]
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) add('SCHEMA_INVALID', `Theme token bucket ${category} must be an object map.`, { path: `/theme/tokens/${category}` })
    else for (const [token, value] of Object.entries(bucket)) {
      const valid = category === 'colors' ? typeof value === 'string' && /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(value)
        : category === 'fontFamilies' ? typeof value === 'string' && value.length > 0
          : category === 'shadows' ? validShadow(value)
            : finiteNonNegative(value)
      if (!valid || (category === 'fontSizes' && !finitePositive(value))) add('SCHEMA_INVALID', `Theme token ${token} is invalid in ${category}.`, { path: `/theme/tokens/${category}/${escapePointer(token)}` })
    }
  }
  const textPresets = theme.presets.text
  if (!textPresets || typeof textPresets !== 'object' || Array.isArray(textPresets)) add('SCHEMA_INVALID', 'Theme text presets must be an object map.', { path: '/theme/presets/text' })
  else for (const [presetId, preset] of Object.entries(textPresets)) {
    if (!validTextStyle(preset)) add('SCHEMA_INVALID', `Text preset is invalid: ${presetId}.`, { path: `/theme/presets/text/${escapePointer(presetId)}` })
  }
  for (const category of ['shape', 'image', 'chart'] as const) {
    const bucket = theme.presets[category]
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) add('SCHEMA_INVALID', `Theme ${category} presets must be an object map.`, { path: `/theme/presets/${category}` })
    else if (category === 'shape') {
      for (const [presetId, preset] of Object.entries(bucket)) if (!validShapeStyle(preset)) add('SCHEMA_INVALID', `Shape preset is invalid: ${presetId}.`, { path: `/theme/presets/shape/${escapePointer(presetId)}` })
    } else if (category === 'image') {
      for (const [presetId, preset] of Object.entries(bucket)) if (!validImageStyle(preset)) add('SCHEMA_INVALID', `Image preset is invalid: ${presetId}.`, { path: `/theme/presets/image/${escapePointer(presetId)}` })
    }
  }
}

function validTextStyle(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const style = value as Record<string, unknown>
  if (!hasOnlyKeys(style, ['fontFamily', 'fontSize', 'fontWeight', 'color', 'lineHeight', 'letterSpacing', 'verticalAlign', 'direction'])) return false
  return validValueOrToken(style.fontFamily, 'string') && finitePositive(style.fontSize) && validValueOrToken(style.color, 'color')
    && (style.fontWeight === undefined || (Number.isInteger(style.fontWeight) && Number(style.fontWeight) >= 100 && Number(style.fontWeight) <= 1000))
    && (style.lineHeight === undefined || finitePositive(style.lineHeight))
    && (style.letterSpacing === undefined || finite(style.letterSpacing))
    && (style.verticalAlign === undefined || ['top', 'middle', 'bottom'].includes(String(style.verticalAlign)))
    && (style.direction === undefined || ['ltr', 'rtl', 'auto'].includes(String(style.direction)))
}

function validShapeStyle(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const style = value as Record<string, unknown>
  if (!hasOnlyKeys(style, ['fill', 'stroke', 'radius', 'shadow'])) return false
  return (style.fill === undefined || validPaint(style.fill)) && (style.stroke === undefined || validStroke(style.stroke)) && (style.radius === undefined || finiteNonNegative(style.radius)) && (style.shadow === undefined || validShadow(style.shadow))
}

function validImageStyle(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const style = value as Record<string, unknown>
  if (!hasOnlyKeys(style, ['border', 'radius', 'shadow'])) return false
  return (style.border === undefined || validStroke(style.border)) && (style.radius === undefined || finiteNonNegative(style.radius)) && (style.shadow === undefined || validShadow(style.shadow))
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
  if (!element.style || !element.style.styleRef || !isPlainObject(element.style) || (element.style.overrides !== undefined && !isPlainObject(element.style.overrides))) add('SCHEMA_INVALID', 'Text requires a valid style binding.', { slideId, elementId: element.id })
  if (element.paragraphStyle !== undefined && (!element.paragraphStyle || typeof element.paragraphStyle !== 'object' || (element.paragraphStyle.align !== undefined && !['left', 'center', 'right'].includes(element.paragraphStyle.align)) || (element.paragraphStyle.lineHeight !== undefined && !finitePositive(element.paragraphStyle.lineHeight)) || (element.paragraphStyle.paragraphSpacing !== undefined && !finiteNonNegative(element.paragraphStyle.paragraphSpacing)) || (element.paragraphStyle.listIndent !== undefined && !finiteNonNegative(element.paragraphStyle.listIndent)))) add('SCHEMA_INVALID', 'Text paragraphStyle is invalid.', { slideId, elementId: element.id })
  if (element.boxStyle !== undefined && (!element.boxStyle || typeof element.boxStyle !== 'object' || (element.boxStyle.padding !== undefined && !validInsets(element.boxStyle.padding)) || (element.boxStyle.fill !== undefined && !validPaint(element.boxStyle.fill)) || (element.boxStyle.stroke !== undefined && !validStroke(element.boxStyle.stroke)) || (element.boxStyle.radius !== undefined && !finiteNonNegative(element.boxStyle.radius)) || (element.boxStyle.shadow !== undefined && !validShadow(element.boxStyle.shadow)))) add('SCHEMA_INVALID', 'Text boxStyle is invalid.', { slideId, elementId: element.id })
  const paragraphs = Array.isArray(element.content?.paragraphs) ? element.content.paragraphs : []
  if (!element.content || typeof element.content !== 'object' || !Array.isArray(element.content.paragraphs)) add('SCHEMA_INVALID', 'Text content must contain a paragraphs array.', { slideId, elementId: element.id })
  const paragraphIds = new Set<string>()
  for (const paragraph of paragraphs) {
    if (!paragraph || typeof paragraph !== 'object' || !paragraph.id || paragraphIds.has(paragraph.id) || !Array.isArray(paragraph.runs)) {
      add('SCHEMA_INVALID', `Duplicate or missing paragraph id ${paragraph?.id ?? ''}.`, { slideId, elementId: element.id })
      continue
    }
    paragraphIds.add(paragraph.id)
    if (paragraph.align !== undefined && !['left', 'center', 'right'].includes(paragraph.align)) add('SCHEMA_INVALID', 'Text paragraph alignment is invalid.', { slideId, elementId: element.id })
    if (paragraph.spaceBefore !== undefined && !finiteNonNegative(paragraph.spaceBefore)) add('SCHEMA_INVALID', 'Text paragraph spaceBefore is invalid.', { slideId, elementId: element.id })
    if (paragraph.spaceAfter !== undefined && !finiteNonNegative(paragraph.spaceAfter)) add('SCHEMA_INVALID', 'Text paragraph spaceAfter is invalid.', { slideId, elementId: element.id })
    if (paragraph.list && !['bullet', 'number'].includes(paragraph.list.type)) add('SCHEMA_INVALID', 'Text supports only single-level bullet or number lists.', { slideId, elementId: element.id })
    const runIds = new Set<string>()
    for (const run of paragraph.runs ?? []) {
      if (!run || typeof run !== 'object' || !run.id || runIds.has(run.id)) {
        add('SCHEMA_INVALID', `Duplicate or missing run id ${run?.id ?? ''}.`, { slideId, elementId: element.id })
        continue
      }
      runIds.add(run.id)
      if (typeof run.text !== 'string' || run.text.includes('\u0000')) add('SCHEMA_INVALID', 'Text must be a NUL-free string.', { slideId, elementId: element.id })
      if (run && Object.keys(run as unknown as Record<string, unknown>).some((key) => !['id', 'text', 'marks'].includes(key))) add('SCHEMA_INVALID', 'Text Run may not contain font or font-size fields.', { slideId, elementId: element.id })
      const marks = run.marks as Record<string, unknown> | undefined
      if (marks && (!isPlainObject(marks) || Object.keys(marks).some((key) => !['bold', 'italic', 'underline', 'strike', 'color'].includes(key)) || ['bold', 'italic', 'underline', 'strike'].some((key) => marks[key] !== undefined && typeof marks[key] !== 'boolean') || (marks.color !== undefined && !validValueOrToken(marks.color, 'color')))) add('SCHEMA_INVALID', 'Run marks are invalid or contain unsupported font fields.', { slideId, elementId: element.id })
    }
  }
}

function validateImage(element: ImageElement, add: (code: string, message: string, extra?: Partial<ValidationIssue>) => void, slideId: string) {
  if (!element.assetId || !['contain', 'cover', 'fill'].includes(element.fit)) add('SCHEMA_INVALID', 'Image requires assetId and a valid fit.', { slideId, elementId: element.id })
  if (element.style !== undefined && (!isPlainObject(element.style) || typeof element.style.styleRef !== 'string' || !element.style.styleRef || (element.style.overrides !== undefined && !isPlainObject(element.style.overrides)))) add('SCHEMA_INVALID', 'Image style binding is invalid.', { slideId, elementId: element.id })
  if (element.crop && (!validNormalizedRect(element.crop))) add('GEOMETRY_INVALID', 'Image crop must be a positive rectangle inside 0–1.', { slideId, elementId: element.id })
  if (element.focalPoint && (!finite(element.focalPoint.x) || !finite(element.focalPoint.y) || element.focalPoint.x < 0 || element.focalPoint.x > 1 || element.focalPoint.y < 0 || element.focalPoint.y > 1)) add('GEOMETRY_INVALID', 'Image focalPoint must be inside 0–1.', { slideId, elementId: element.id })
}

function validateShape(element: ShapeElement, add: (code: string, message: string, extra?: Partial<ValidationIssue>) => void, slideId: string) {
  if (!SHAPE_KINDS.has(element.shape)) add('SCHEMA_INVALID', `Unknown shape kind: ${element.shape}.`, { slideId, elementId: element.id })
  if (!element.style || !element.style.styleRef || !isPlainObject(element.style) || (element.style.overrides !== undefined && !isPlainObject(element.style.overrides))) add('SCHEMA_INVALID', 'Shape requires a valid style binding.', { slideId, elementId: element.id })
  if (element.points !== undefined && (!Array.isArray(element.points) || element.points.some((point) => !point || !finite(point.x) || !finite(point.y)))) add('GEOMETRY_INVALID', 'Shape points must be finite.', { slideId, elementId: element.id })
}

function validateChart(element: Extract<Element, { type: 'chart' }>, add: (code: string, message: string, extra?: Partial<ValidationIssue>) => void, slideId: string) {
  if (!['bar', 'line', 'area', 'pie', 'donut'].includes(element.chartType) || !element.data || !element.encoding) add('SCHEMA_INVALID', 'Chart type, data, and encoding are required.', { slideId, elementId: element.id })
}

function validateGroups(slide: PpteDocument['slides'][string], elements: Record<string, Element>, add: (code: string, message: string, extra?: Partial<ValidationIssue>) => void, slideId: string) {
  const membership = new Map<string, string>()
  for (const [groupId, group] of Object.entries(slide.groups ?? {})) {
    if (!group || typeof group !== 'object') { add('SCHEMA_INVALID', 'Group must be an object.', { slideId }); continue }
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
  if (element.semanticRefs !== undefined && (!element.semanticRefs || typeof element.semanticRefs !== 'object' || Array.isArray(element.semanticRefs))) {
    add('SCHEMA_INVALID', 'semanticRefs must be an object.', { slideId, elementId: element.id })
    return
  }
  for (const field of ['factIds', 'sourceIds'] as const) {
    const values = element.semanticRefs?.[field]
    if (values !== undefined && (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || !value))) add('SCHEMA_INVALID', `semanticRefs.${field} must contain non-empty strings.`, { slideId, elementId: element.id })
    if (Array.isArray(values) && new Set(values).size !== values.length) add('SCHEMA_INVALID', `semanticRefs.${field} must not contain duplicates.`, { slideId, elementId: element.id })
  }
  for (const factId of Array.isArray(element.semanticRefs?.factIds) ? element.semanticRefs.factIds : []) if (!document.facts?.[factId]) add('FACT_REFERENCE_MISSING', `Missing fact ${factId}.`, { slideId, elementId: element.id, factId })
  for (const sourceId of Array.isArray(element.semanticRefs?.sourceIds) ? element.semanticRefs.sourceIds : []) if (!document.sources?.[sourceId]) add('SOURCE_REFERENCE_MISSING', `Missing source ${sourceId}.`, { slideId, elementId: element.id })
}

function validateFactsAndSources(document: PpteDocument, add: (code: string, message: string, extra?: Partial<ValidationIssue>) => void) {
  if (document.facts !== undefined && (!document.facts || typeof document.facts !== 'object' || Array.isArray(document.facts))) add('SCHEMA_INVALID', 'facts must be an object map.', { path: '/facts' })
  if (document.sources !== undefined && (!document.sources || typeof document.sources !== 'object' || Array.isArray(document.sources))) add('SCHEMA_INVALID', 'sources must be an object map.', { path: '/sources' })
  for (const [factId, fact] of Object.entries(document.facts ?? {})) if (!fact || typeof fact !== 'object' || fact.id !== factId || !fact.key) add('SCHEMA_INVALID', `Fact metadata is invalid: ${factId}.`, { factId })
  for (const [sourceId, source] of Object.entries(document.sources ?? {})) if (!source || typeof source !== 'object' || source.id !== sourceId) add('SCHEMA_INVALID', `Source metadata is invalid: ${sourceId}.`, { path: `/sources/${escapePointer(sourceId)}/id` })
}

function validInsets(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const insets = value as Record<string, unknown>
  return ['top', 'right', 'bottom', 'left'].every((key) => finiteNonNegative(insets[key]))
}
function validPaint(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const paint = value as Record<string, unknown>
  if (paint.kind === 'none') return hasOnlyKeys(paint, ['kind'])
  if (paint.kind === 'solid') return hasOnlyKeys(paint, ['kind', 'color', 'opacity']) && validValueOrToken(paint.color, 'color') && validOpacity(paint.opacity)
  if (paint.kind === 'linear-gradient') return hasOnlyKeys(paint, ['kind', 'angleDeg', 'stops', 'opacity']) && finite(paint.angleDeg) && validOpacity(paint.opacity) && Array.isArray(paint.stops) && paint.stops.length >= 2 && paint.stops.every((stop) => Boolean(stop) && typeof stop === 'object' && hasOnlyKeys(stop as Record<string, unknown>, ['offset', 'color']) && finiteNonNegative((stop as Record<string, unknown>).offset) && Number((stop as Record<string, unknown>).offset) <= 1 && validValueOrToken((stop as Record<string, unknown>).color))
  return false
}
function validStroke(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const stroke = value as Record<string, unknown>
  return hasOnlyKeys(stroke, ['color', 'width', 'opacity', 'dash', 'lineCap', 'lineJoin']) && validValueOrToken(stroke.color, 'color') && finiteNonNegative(stroke.width) && validOpacity(stroke.opacity)
    && (stroke.dash === undefined || (Array.isArray(stroke.dash) && stroke.dash.every((segment) => finiteNonNegative(segment))))
    && (stroke.lineCap === undefined || ['butt', 'round', 'square'].includes(String(stroke.lineCap)))
    && (stroke.lineJoin === undefined || ['miter', 'round', 'bevel'].includes(String(stroke.lineJoin)))
}
function validShadow(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const shadow = value as Record<string, unknown>
  return hasOnlyKeys(shadow, ['color', 'offsetX', 'offsetY', 'blur', 'spread', 'opacity']) && validValueOrToken(shadow.color, 'color') && finite(shadow.offsetX) && finite(shadow.offsetY) && finiteNonNegative(shadow.blur) && (shadow.spread === undefined || finite(shadow.spread)) && validOpacity(shadow.opacity)
}
function validValueOrToken(value: unknown, valueType: 'color' | 'string' = 'color'): boolean {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (candidate.kind === 'token') return hasOnlyKeys(candidate, ['kind', 'token']) && typeof candidate.token === 'string' && candidate.token.length > 0
  return candidate.kind === 'value' && hasOnlyKeys(candidate, ['kind', 'value']) && typeof candidate.value === 'string' && (valueType === 'string' || /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(candidate.value))
}
function validOpacity(value: unknown): boolean { return value === undefined || (finite(value) && value >= 0 && value <= 1) }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function finitePositive(value: unknown): value is number { return finite(value) && value > 0 }
function finiteNonNegative(value: unknown): value is number { return finite(value) && value >= 0 }
function isPlainObject(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean { return Object.keys(value).every((key) => allowed.includes(key)) }
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
function safeRelativeFontPath(value: string): boolean { return typeof value === 'string' && value.startsWith('fonts/') && !value.startsWith('/') && !value.includes('..') && !value.includes('\\') && !value.includes('\u0000') }

export type RuntimeElement = TextElement | ImageElement | ShapeElement
export type RuntimeShape = ShapeElement
export type RuntimeImage = ImageElement
