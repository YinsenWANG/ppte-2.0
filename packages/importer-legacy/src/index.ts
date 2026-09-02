import { canonicalJsonString, sha256HexBytes } from '../../canonical-json/src/index.js'
import { getCompatibilityProfile, type CompatibilityProfile, type CompatibilityDisposition } from '../../compatibility/src/index.js'
import { withErrorSemantics } from '../../schema/src/errors.js'
import { validateRuntimeDocument } from '../../validation/src/index.js'
import type {
  Asset,
  ContentSafety,
  Element,
  ErrorImpact,
  Fact,
  FontAsset,
  Frame,
  ImageElement,
  LogicalGroup,
  PpteDocument,
  Point,
  Recoverability,
  RichTextDocument,
  ShapeElement,
  TextElement,
  TextMarks,
  TextStyle,
  ThemeDefinition,
  ValueOrToken,
  VisualStrategy,
} from '../../schema/src/index.js'

type RecordLike = Record<string, unknown>

export interface LegacyMigrationOptions {
  targetDocumentId?: string
  defaultLocale?: string
  sourceFormat?: string
  targetProfile?: string
  assetBytes?: Record<string, Uint8Array>
  fontBytes?: Record<string, Uint8Array>
}

export interface MigrationIssue {
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
  path?: string
  slideId?: string
  elementId?: string
  semanticKey?: string
  recovery?: string
  impact?: ErrorImpact
  contentSafety?: ContentSafety
  canSave?: boolean
  recoverability?: Recoverability
  retryable?: boolean
}

export interface MigrationReport {
  reportVersion: '1'
  sourceFormat: string
  sourceSchemaVersion?: string
  sourceDocumentId?: string
  targetDocumentId: string
  targetProfile: string
  sourceDigest?: string
  disposition: CompatibilityDisposition
  migrated: boolean
  convertedSlides: number
  convertedElements: number
  flattenedGroups: number
  degradedElements: number
  issues: MigrationIssue[]
}

export interface MigrationResult {
  ok: boolean
  document: PpteDocument
  profile: CompatibilityProfile
  report: MigrationReport
}

interface MigrationContext {
  options: LegacyMigrationOptions
  source: RecordLike
  profile: CompatibilityProfile
  report: MigrationReport
  usedElementIds: Set<string>
  usedSlideIds: Set<string>
  usedGroupIds: Set<string>
  assetIds: Set<string>
  fontIds: Set<string>
  semanticKeysBySlide: Map<string, Set<string>>
  theme: ThemeDefinition
}

interface Transform {
  x: number
  y: number
  scaleX: number
  scaleY: number
}

interface MappedElement {
  element: Element
  elements: Element[]
  leafIds: string[]
  nestedGroup: boolean
}

/**
 * Convert a JSON-compatible older semantic snapshot into a new GA-A
 * snapshot. The input is never mutated and no source markup or executable
 * payload is interpreted.
 */
export function migrateLegacyDocument(input: unknown, options: LegacyMigrationOptions = {}): MigrationResult {
  const requestedProfile = options.targetProfile ?? 'ppte-2.0-ga-a.1'
  const profile = getCompatibilityProfile(requestedProfile) ?? getCompatibilityProfile('ppte-2.0-ga-a.1')!
  let source: RecordLike
  try {
    source = unwrapSource(input)
  } catch (cause) {
    return failedMigration(profile, requestedProfile, options.targetDocumentId ?? 'doc_migration_failed', options.sourceFormat ?? 'unknown', cause instanceof Error ? cause.message : String(cause))
  }
  if (!getCompatibilityProfile(requestedProfile)) return failedMigration(profile, requestedProfile, options.targetDocumentId ?? stringValue(source.documentId) ?? 'doc_migration_failed', options.sourceFormat ?? stringValue(source.format) ?? 'unknown', `Target Compatibility Profile ${requestedProfile} is not supported.`, source)
  const sourceFormat = options.sourceFormat ?? stringValue(source.format) ?? stringValue(source.sourceFormat) ?? 'legacy-semantic-document'
  const sourceDocumentId = stringValue(source.documentId)
  const targetDocumentId = options.targetDocumentId ?? sourceDocumentId ?? `doc_migrated_${stableDigest(source).slice(0, 24)}`
  const report: MigrationReport = {
    reportVersion: '1',
    sourceFormat,
    sourceSchemaVersion: stringValue(source.schemaVersion),
    sourceDocumentId,
    targetDocumentId,
    targetProfile: profile.id,
    sourceDigest: stableDigest(source),
    disposition: 'migrate',
    migrated: true,
    convertedSlides: 0,
    convertedElements: 0,
    flattenedGroups: 0,
    degradedElements: 0,
    issues: [],
  }
  const theme = normalizeTheme(source.theme, report)
  const context: MigrationContext = { options, source, profile, report, usedElementIds: new Set(), usedSlideIds: new Set(), usedGroupIds: new Set(), assetIds: new Set(), fontIds: new Set(), semanticKeysBySlide: new Map(), theme }
  const assets = normalizeAssets(source.assets, context)
  const fonts = normalizeFonts(source.fonts, context)
  const rawSlides = collectionValues(source.slides ?? source.pages ?? source.slideList)
  const slides = rawSlides.map((rawSlide, index) => migrateSlide(rawSlide, index, context, assets)).filter((slide): slide is NonNullable<typeof slide> => Boolean(slide))
  const document: PpteDocument = {
    schemaVersion: '2.0.0',
    documentId: targetDocumentId,
    locale: stringValue(source.locale) ?? options.defaultLocale ?? 'en-US',
    metadata: {
      title: stringValue(asRecord(source.metadata)?.title) ?? stringValue(source.title) ?? 'Migrated presentation',
      subject: stringValue(asRecord(source.metadata)?.subject),
      description: stringValue(asRecord(source.metadata)?.description),
      author: stringValue(asRecord(source.metadata)?.author),
      createdAt: stringValue(asRecord(source.metadata)?.createdAt),
      updatedAt: stringValue(asRecord(source.metadata)?.updatedAt),
      source: 'migrated',
      sourceFormat,
    },
    canvas: normalizeCanvas(source.canvas),
    theme,
    slideOrder: slides.map((slide) => slide.id),
    slides: Object.fromEntries(slides.map((slide) => [slide.id, slide])),
    facts: normalizeFacts(source.facts),
    sources: normalizeSources(source.sources),
    assets,
    fonts,
    policies: { allowNetworkAssets: false },
  }
  const runtimeIssues = validateRuntimeDocument(document)
  for (const issue of runtimeIssues) if (issue.severity === 'error') addIssue(report, { code: `MIGRATION_${issue.code}`, severity: 'error', message: issue.message, path: issue.path, slideId: issue.slideId, elementId: issue.elementId, recovery: 'Review the migration report and fix the source before creating a new checkpoint.' })
  report.convertedSlides = slides.length
  report.disposition = report.issues.some((issue) => issue.severity === 'error') ? 'reject' : 'migrate'
  return { ok: report.issues.every((issue) => issue.severity !== 'error'), document, profile, report }
}

export const migrateLegacy = migrateLegacyDocument

export function migrateLegacyJson(bytes: Uint8Array, options: LegacyMigrationOptions = {}): MigrationResult {
  try {
    return migrateLegacyDocument(JSON.parse(new TextDecoder().decode(bytes)), options)
  } catch (cause) {
    const requestedProfile = options.targetProfile ?? 'ppte-2.0-ga-a.1'
    const profile = getCompatibilityProfile(requestedProfile) ?? getCompatibilityProfile('ppte-2.0-ga-a.1')!
    const targetDocumentId = options.targetDocumentId ?? 'doc_migration_failed'
    return failedMigration(profile, requestedProfile, targetDocumentId, options.sourceFormat ?? 'unknown', cause instanceof Error ? cause.message : String(cause))
  }
}

function migrateSlide(raw: RecordLike, index: number, context: MigrationContext, assets: Record<string, Asset>): PpteDocument['slides'][string] | undefined {
  const sourceId = stringValue(raw.id) ?? `slide_${index + 1}`
  const id = uniqueId(sourceId, 'slide', context.usedSlideIds, context.report, `/slides/${index}/id`)
  const elements: Record<string, Element> = {}
  const rootOrder: string[] = []
  const groups: Record<string, LogicalGroup> = {}
  const elementSourceIds = new Map<string, string>()
  const rawElements = collectionValues(raw.elements ?? raw.items)
  const outerTransform = identityTransform()
  for (const [elementIndex, rawElement] of rawElements.entries()) {
    const mapped = mapElement(rawElement, `el_${index + 1}_${elementIndex + 1}`, outerTransform, context, assets, id)
    if (!mapped) continue
    for (const element of mapped.elements) elements[element.id] = element
    for (const leaf of mapped.leafIds) {
      const element = elements[leaf]
      if (!element) continue
      rootOrder.push(leaf)
      elementSourceIds.set(stringValue(rawElement.id) ?? leaf, leaf)
      context.report.convertedElements += 1
    }
    if (mapped.nestedGroup) {
      const groupSourceId = stringValue(rawElement.id) ?? `group_${index + 1}_${elementIndex + 1}`
      const groupId = uniqueId(groupSourceId, 'group', context.usedGroupIds, context.report, `/slides/${index}/elements/${elementIndex}/id`)
      groups[groupId] = { id: groupId, name: stringValue(rawElement.name), semanticKey: stringValue(rawElement.semanticKey), memberIds: [...mapped.leafIds] }
      context.report.flattenedGroups += 1
    }
  }
  const rawReadingOrder = Array.isArray(raw.readingOrder) ? raw.readingOrder.map((value) => elementSourceIds.get(String(value)) ?? String(value)).filter((value) => Boolean(elements[value])) : undefined
  const readingOrder = rawReadingOrder?.length ? [...new Set(rawReadingOrder)] : rootOrder.filter((elementId) => !['background', 'decorative', 'artwork'].includes(elements[elementId]?.role ?? ''))
  const visualStrategy = stringValue(raw.visualStrategy)
  return {
    id,
    name: stringValue(raw.name),
    hidden: raw.hidden === true,
    rootOrder,
    elements,
    groups,
    readingOrder,
    notes: normalizeNotes(raw.notes),
    visualStrategy: visualStrategy === 'structured' || visualStrategy === 'hybrid' || visualStrategy === 'poster' ? visualStrategy : 'structured',
  }
}

function mapElement(raw: RecordLike, hint: string, parent: Transform, context: MigrationContext, assets: Record<string, Asset>, slideId: string): MappedElement | undefined {
  const rawType = (stringValue(raw.type) ?? '').toLowerCase()
  const frame = transformFrame(normalizeFrame(raw.frame ?? raw, context.report, `/slides/${slideId}/elements/${hint}/frame`), parent)
  if (rawType === 'group' || rawType === 'group-element' || Array.isArray(raw.children)) {
    const groupTransform = composeTransform(parent, raw)
    const leafIds: string[] = []
    const elements: Element[] = []
    const children = collectionValues(raw.children ?? raw.elements)
    for (const [index, child] of children.entries()) {
      const mapped = mapElement(child, `${hint}_${index + 1}`, groupTransform, context, assets, slideId)
      if (mapped) { leafIds.push(...mapped.leafIds); elements.push(...mapped.elements) }
    }
    if (leafIds.length === 0) {
      addIssue(context.report, { code: 'MIGRATION_EMPTY_GROUP', severity: 'warning', message: `Group ${hint} had no supported leaf elements and was dropped.`, path: hint, slideId, recovery: 'Inspect the source group and export it as a safe image if its visual content is required.' })
      return undefined
    }
    const first = elements[0]!
    return { element: first, elements, leafIds, nestedGroup: true }
  }
  if (rawType === 'text' || rawType === 'richtext' || rawType === 'text-box') {
    return mapText(raw, hint, frame, context, slideId)
  }
  if (rawType === 'image' || rawType === 'picture') {
    const sourceAssetId = stringValue(raw.assetId) ?? stringValue(raw.asset) ?? stringValue(raw.id)
    const assetId = sourceAssetId ? findAssetId(sourceAssetId, assets) : undefined
    if (!assetId) {
      context.report.degradedElements += 1
      addIssue(context.report, { code: 'MIGRATION_ASSET_MISSING', severity: 'error', message: `Image ${hint} has no resolvable local asset.`, path: `${hint}/assetId`, slideId, recovery: 'Provide the asset bytes/metadata and run migration again; the source is not overwritten.' })
      return undefined
    }
    const element: ImageElement = {
      id: uniqueId(stringValue(raw.id) ?? hint, 'el', context.usedElementIds, context.report, `${hint}/id`),
      type: 'image',
      semanticKey: safeSemanticKey(raw.semanticKey ?? raw.key, context, slideId),
      role: validRole(raw.role) ?? 'image',
      name: stringValue(raw.name),
      frame,
      assetId,
      fit: raw.fit === 'contain' || raw.fit === 'cover' || raw.fit === 'fill' ? raw.fit : 'contain',
      crop: validNormalizedRect(raw.crop),
      focalPoint: validPoint(raw.focalPoint),
      style: normalizeStyleBinding(raw.style, 'image', context.theme, context.report),
      altText: stringValue(raw.altText) ?? stringValue(raw.description),
    }
    return { element, elements: [element], leafIds: [element.id], nestedGroup: false }
  }
  if (rawType === 'shape' || rawType === 'rectangle' || rawType === 'rounded-rectangle' || rawType === 'ellipse' || rawType === 'line' || rawType === 'arrow') {
    const shape = validShape(raw.shape) ?? (rawType === 'shape' ? 'rectangle' : rawType as ShapeElement['shape'])
    const element: ShapeElement = {
      id: uniqueId(stringValue(raw.id) ?? hint, 'el', context.usedElementIds, context.report, `${hint}/id`),
      type: 'shape',
      semanticKey: safeSemanticKey(raw.semanticKey ?? raw.key, context, slideId),
      role: validRole(raw.role) ?? 'decorative',
      name: stringValue(raw.name),
      frame,
      shape,
      style: normalizeStyleBinding(raw.style, 'shape', context.theme, context.report),
      points: Array.isArray(raw.points) ? raw.points.map(validPoint).filter((point): point is Point => Boolean(point)) : undefined,
    }
    return { element, elements: [element], leafIds: [element.id], nestedGroup: false }
  }
  if (rawType) {
    context.report.degradedElements += 1
    addIssue(context.report, { code: 'MIGRATION_UNSUPPORTED_ELEMENT', severity: 'warning', message: `Element type ${rawType} was not imported into the GA-A runtime.`, path: hint, slideId, recovery: 'Export the unsupported object as a safe image or retain the source for a later profile.' })
  }
  return undefined
}

function mapText(raw: RecordLike, hint: string, frame: Frame, context: MigrationContext, slideId: string): MappedElement {
  const contentResult = normalizeRichText(raw.content ?? raw.text ?? '', hint, context.report, slideId)
  const role = validRole(raw.role) ?? 'body'
  const style = normalizeTextStyle(raw.style, role, context.theme, context.report)
  const element: TextElement = {
    id: uniqueId(stringValue(raw.id) ?? hint, 'el', context.usedElementIds, context.report, `${hint}/id`),
    type: 'text',
    semanticKey: safeSemanticKey(raw.semanticKey ?? raw.key, context, slideId),
    role,
    name: stringValue(raw.name),
    frame,
    content: contentResult.content,
    style: { styleRef: style.styleRef, ...(Object.keys(style.overrides).length ? { overrides: style.overrides } : {}) },
    paragraphStyle: isRecord(raw.paragraphStyle) ? raw.paragraphStyle as TextElement['paragraphStyle'] : undefined,
    overflowPolicy: raw.overflowPolicy === 'clip' || raw.overflowPolicy === 'ellipsis' || raw.overflowPolicy === 'warn' ? raw.overflowPolicy : 'warn',
    extensions: contentResult.runStyleExtension ? [contentResult.runStyleExtension] : undefined,
  }
  return { element, elements: [element], leafIds: [element.id], nestedGroup: false }
}

function normalizeRichText(raw: unknown, hint: string, report: MigrationReport, slideId: string): { content: RichTextDocument; runStyleExtension?: NonNullable<TextElement['extensions']>[number] } {
  const paragraphsRaw = isRecord(raw) && Array.isArray(raw.paragraphs) ? raw.paragraphs : [{ text: typeof raw === 'string' ? raw : String(raw ?? '') }]
  const runStyles: Array<{ fontFamily?: string; fontSize?: number }> = []
  const paragraphs = paragraphsRaw.map((paragraph, paragraphIndex) => {
    const paragraphRecord = asRecord(paragraph)
    const runsRaw = paragraphRecord && Array.isArray(paragraphRecord.runs) ? paragraphRecord.runs : [{ text: stringValue(paragraphRecord?.text) ?? '' }]
    const align: 'left' | 'center' | 'right' | undefined = paragraphRecord?.align === 'left' || paragraphRecord?.align === 'center' || paragraphRecord?.align === 'right' ? paragraphRecord.align : undefined
    return {
      id: stringValue(paragraphRecord?.id) ?? `${hint}-p-${paragraphIndex + 1}`,
      runs: runsRaw.map((run, runIndex) => {
        const runRecord = asRecord(run)
        const fontFamily = stringValue(runRecord?.fontFamily)
        const fontSize = finiteNumber(runRecord?.fontSize) ? Number(runRecord?.fontSize) : undefined
        if (fontFamily || fontSize !== undefined) runStyles.push({ fontFamily, fontSize })
        const marks = normalizeMarks(runRecord?.marks)
        return { id: stringValue(runRecord?.id) ?? `${hint}-p-${paragraphIndex + 1}-r-${runIndex + 1}`, text: stringValue(runRecord?.text) ?? '', ...(marks ? { marks } : {}) }
      }),
      ...(align ? { align } : {}),
    }
  })
  const distinctStyles = new Set(runStyles.map((style) => `${style.fontFamily ?? ''}|${style.fontSize ?? ''}`))
  if (distinctStyles.size > 1) {
    addIssue(report, { code: 'MIGRATION_RUN_STYLE_DEGRADED', severity: 'warning', message: `Text ${hint} used multiple Run-level font styles; content was preserved and the styles were retained as a non-rendering migration note.`, path: `${hint}/content`, slideId, recovery: 'Split the text into separate Text elements or choose one element-level font style.' })
  }
  if (runStyles.length > 0) {
    const payload = { kind: 'run-style', styles: runStyles }
    return { content: { paragraphs }, runStyleExtension: { namespace: 'org.ppte.migration', version: '1', required: false, byteLength: new TextEncoder().encode(canonicalJsonString(payload)).length, payload } }
  }
  return { content: { paragraphs } }
}

function normalizeTextStyle(raw: unknown, role: string, theme: ThemeDefinition, report: MigrationReport): { styleRef: string; overrides: Partial<TextStyle> } {
  const record = asRecord(raw)
  const nestedOverrides = asRecord(record?.overrides)
  const requestedStyleRef = stringValue(record?.styleRef)
  const fallbackStyleRef = role === 'title' ? 'text.title.primary' : 'text.body'
  const styleRef = requestedStyleRef && theme.presets.text[requestedStyleRef] ? requestedStyleRef : fallbackStyleRef
  if (requestedStyleRef && !theme.presets.text[requestedStyleRef]) addIssue(report, { code: 'MIGRATION_STYLE_REATTACHED', severity: 'warning', message: `Text style ${requestedStyleRef} was not available in the target theme and was reattached to ${fallbackStyleRef}.`, path: '/style/styleRef', recovery: 'Create a matching preset or select another Style Preset.' })
  const overrides: Partial<TextStyle> = {}
  const fontFamily = stringValue(record?.fontFamily ?? nestedOverrides?.fontFamily)
  const fontSizeValue = record?.fontSize ?? nestedOverrides?.fontSize
  const fontSize = finiteNumber(fontSizeValue) ? Number(fontSizeValue) : undefined
  const color = stringValue(record?.color ?? nestedOverrides?.color)
  if (fontFamily) overrides.fontFamily = { kind: 'value', value: fontFamily }
  if (fontSize !== undefined && fontSize > 0) overrides.fontSize = fontSize
  if (color && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color)) overrides.color = { kind: 'value', value: color } as ValueOrToken<`#${string}`>
  if (record && (record.fontFamily !== undefined || record.fontSize !== undefined || nestedOverrides?.fontFamily !== undefined || nestedOverrides?.fontSize !== undefined)) addIssue(report, { code: 'MIGRATION_STYLE_PROMOTED', severity: 'info', message: `Text style values were promoted to element-level typed overrides.`, path: '/style', recovery: 'Use the Style Preset inspector to reattach the element if desired.' })
  return { styleRef, overrides }
}

function normalizeStyleBinding(raw: unknown, type: 'image' | 'shape', theme: ThemeDefinition, report: MigrationReport): { styleRef: string; overrides?: Record<string, unknown> } {
  const record = asRecord(raw)
  const nestedOverrides = asRecord(record?.overrides)
  const requestedStyleRef = stringValue(record?.styleRef)
  const fallbackStyleRef = type === 'image' ? 'image.hero' : 'shape.surface'
  const styleRef = requestedStyleRef && theme.presets[type][requestedStyleRef] ? requestedStyleRef : fallbackStyleRef
  if (requestedStyleRef && !theme.presets[type][requestedStyleRef]) addIssue(report, { code: 'MIGRATION_STYLE_REATTACHED', severity: 'warning', message: `Style ${requestedStyleRef} was not available in the target theme and was reattached to ${fallbackStyleRef}.`, path: '/style/styleRef', recovery: 'Create a matching preset or select another Style Preset.' })
  const overrides: Record<string, unknown> = {}
  if (type === 'shape') {
    const fill = record?.fill ?? nestedOverrides?.fill
    const radius = record?.radius ?? nestedOverrides?.radius
    if (validPaint(fill)) overrides.fill = fill
    if (validNumber(radius)) overrides.radius = Number(radius)
  } else {
    const radius = record?.radius ?? nestedOverrides?.radius
    if (validNumber(radius)) overrides.radius = Number(radius)
  }
  return Object.keys(overrides).length ? { styleRef, overrides } : { styleRef }
}

function normalizeTheme(raw: unknown, report: MigrationReport): ThemeDefinition {
  const theme = defaultTheme()
  const source = asRecord(raw)
  const tokens = asRecord(source?.tokens)
  for (const category of ['colors', 'fontFamilies', 'fontSizes', 'spacing', 'radii', 'shadows'] as const) {
    const bucket = asRecord(tokens?.[category])
    if (bucket) Object.assign(theme.tokens[category], cloneJsonRecord(bucket))
  }
  const presets = asRecord(source?.presets)
  for (const category of ['text', 'shape', 'image', 'chart'] as const) {
    const bucket = asRecord(presets?.[category])
    if (bucket) Object.assign(theme.presets[category], cloneJsonRecord(bucket))
  }
  if (source?.id !== undefined && stringValue(source.id)) theme.id = stringValue(source.id)!
  if (source?.name !== undefined && stringValue(source.name)) theme.name = stringValue(source.name)!
  if (!source) addIssue(report, { code: 'MIGRATION_DEFAULT_THEME', severity: 'info', message: 'The source had no usable theme; the GA-A default theme was selected.', recovery: 'Review the generated Style Preset bindings.' })
  return theme
}

function defaultTheme(): ThemeDefinition {
  return {
    id: 'theme_migrated_default', name: 'Migrated Default',
    tokens: {
      colors: { 'color.background': '#FFFFFF', 'color.text.primary': '#111827', 'color.text.muted': '#4B5563', 'color.accent': '#2563EB', 'color.surface': '#FFFFFF' },
      fontFamilies: { 'font.heading': 'Inter', 'font.body': 'Inter' },
      fontSizes: { 'fontSize.title': 64, 'fontSize.body': 28 }, spacing: {}, radii: {}, shadows: {},
    },
    presets: {
      text: {
        'text.title.primary': { fontFamily: { kind: 'token', token: 'font.heading' }, fontSize: 64, fontWeight: 700, color: { kind: 'token', token: 'color.text.primary' }, lineHeight: 1.15 },
        'text.body': { fontFamily: { kind: 'token', token: 'font.body' }, fontSize: 28, fontWeight: 400, color: { kind: 'token', token: 'color.text.primary' }, lineHeight: 1.2 },
      },
      shape: { 'shape.surface': { fill: { kind: 'solid', color: { kind: 'token', token: 'color.surface' } }, stroke: { color: { kind: 'token', token: 'color.accent' }, width: 1 }, radius: 16 } },
      image: { 'image.hero': {} }, chart: {},
    },
  }
}

function normalizeAssets(raw: unknown, context: MigrationContext): Record<string, Asset> {
  const result: Record<string, Asset> = {}
  for (const [index, [sourceId, value]] of collectionEntries(raw).entries()) {
    const record = asRecord(value)
    const id = uniqueId(sourceId || `asset_${index + 1}`, 'asset', context.assetIds, context.report, `/assets/${sourceId}`)
    const data = context.options.assetBytes?.[sourceId]
    const hash = normalizeHash(stringValue(record?.hash)) ?? (data ? `sha256-${sha256HexBytes(data)}` : undefined)
    if (!hash) {
      addIssue(context.report, { code: 'MIGRATION_ASSET_HASH_MISSING', severity: 'error', message: `Asset ${sourceId} has no verifiable hash or supplied bytes.`, path: `/assets/${sourceId}`, recovery: 'Supply assetBytes or a valid SHA-256 digest.' })
      continue
    }
    const path = safePackagePath(stringValue(record?.path), `assets/${id}.bin`)
    result[id] = {
      id, hash, mimeType: stringValue(record?.mimeType) ?? 'application/octet-stream', byteLength: Number.isInteger(record?.byteLength) ? Number(record?.byteLength) : data?.length ?? 0, path,
      width: integerPositive(record?.width), height: integerPositive(record?.height), durationMs: integerNonNegative(record?.durationMs), altText: stringValue(record?.altText),
    }
  }
  return result
}

function normalizeFonts(raw: unknown, context: MigrationContext): Record<string, FontAsset> {
  const result: Record<string, FontAsset> = {}
  for (const [index, [sourceId, value]] of collectionEntries(raw).entries()) {
    const record = asRecord(value)
    const id = uniqueId(sourceId || `font_${index + 1}`, 'font', context.fontIds, context.report, `/fonts/${sourceId}`)
    const data = context.options.fontBytes?.[sourceId]
    const hash = normalizeHash(stringValue(record?.hash)) ?? (data ? `sha256-${sha256HexBytes(data)}` : undefined)
    const glyphCoverage = Array.isArray(record?.glyphCoverage) ? record?.glyphCoverage.filter((range): range is RecordLike => isRecord(range) && integerNonNegative(range.start) !== undefined && integerNonNegative(range.end) !== undefined).map((range) => ({ start: Number(range.start), end: Number(range.end) })) : undefined
    result[id] = { id, family: stringValue(record?.family) ?? 'Inter', style: record?.style === 'italic' ? 'italic' : 'normal', weight: integerPositive(record?.weight) ?? 400, hash, path: stringValue(record?.path), source: record?.source === 'embedded' ? 'embedded' : 'system', subset: record?.subset === true, glyphCoverage, editableSafe: record?.editableSafe === true, fallbackFamilies: Array.isArray(record?.fallbackFamilies) ? record?.fallbackFamilies.filter((item): item is string => typeof item === 'string') : undefined, license: stringValue(record?.license) }
  }
  if (!Object.values(result).some((font) => font.family === 'Inter')) result.font_system_inter = { id: 'font_system_inter', family: 'Inter', style: 'normal', weight: 400, source: 'system', editableSafe: true }
  return result
}

function normalizeFacts(raw: unknown): PpteDocument['facts'] {
  const result: NonNullable<PpteDocument['facts']> = {}
  for (const [id, value] of collectionEntries(raw)) {
    const record = asRecord(value)
    if (!record || !stringValue(record.id ?? id) || !stringValue(record.key ?? id) || !Object.prototype.hasOwnProperty.call(record, 'value')) continue
    result[id] = { id: stringValue(record.id ?? id)!, key: stringValue(record.key ?? id)!, value: record.value as Fact['value'], label: stringValue(record.label), unit: stringValue(record.unit), format: stringValue(record.format), sourceIds: Array.isArray(record.sourceIds) ? record.sourceIds.filter((item): item is string => typeof item === 'string') : undefined, verified: record.verified === true, verifiedAt: stringValue(record.verifiedAt) }
  }
  return Object.keys(result).length ? result : undefined
}

function normalizeSources(raw: unknown): PpteDocument['sources'] {
  const result: NonNullable<PpteDocument['sources']> = {}
  for (const [id, value] of collectionEntries(raw)) {
    const record = asRecord(value)
    if (!record) continue
    result[id] = { id: stringValue(record.id ?? id) ?? id, title: stringValue(record.title), author: stringValue(record.author), publisher: stringValue(record.publisher), url: stringValue(record.url), citation: stringValue(record.citation), accessedAt: stringValue(record.accessedAt), license: stringValue(record.license), note: stringValue(record.note) }
  }
  return Object.keys(result).length ? result : undefined
}

function normalizeCanvas(raw: unknown): PpteDocument['canvas'] {
  const record = asRecord(raw)
  const width = finiteNumber(record?.width) && Number(record?.width) > 0 ? Number(record?.width) : 1920
  const height = finiteNumber(record?.height) && Number(record?.height) > 0 ? Number(record?.height) : 1080
  const aspectRatio = record?.aspectRatio === '4:3' || record?.aspectRatio === 'custom' ? record.aspectRatio : '16:9'
  return { width, height, unit: 'du', aspectRatio, defaultBackground: { kind: 'solid', color: { kind: 'value', value: '#FFFFFF' } } }
}

function normalizeFrame(raw: unknown, report: MigrationReport, path: string): Frame {
  const record = asRecord(raw)
  const x = finiteNumber(record?.x) ? Number(record?.x) : 0
  const y = finiteNumber(record?.y) ? Number(record?.y) : 0
  const width = finiteNumber(record?.width) && Number(record?.width) > 0 ? Number(record?.width) : 1
  const height = finiteNumber(record?.height) && Number(record?.height) > 0 ? Number(record?.height) : 1
  if (!finiteNumber(record?.width) || !finiteNumber(record?.height) || width <= 0 || height <= 0) addIssue(report, { code: 'MIGRATION_FRAME_DEFAULTED', severity: 'warning', message: 'An invalid or missing frame was replaced with a minimal positive frame.', path, recovery: 'Review the migrated slide geometry.' })
  return { x, y, width, height }
}

function composeTransform(parent: Transform, raw: RecordLike): Transform {
  const transform = asRecord(raw.transform)
  const frame = asRecord(raw.frame)
  const x = finiteNumber(transform?.x) ? Number(transform?.x) : finiteNumber(frame?.x) ? Number(frame?.x) : 0
  const y = finiteNumber(transform?.y) ? Number(transform?.y) : finiteNumber(frame?.y) ? Number(frame?.y) : 0
  const scaleX = finiteNumber(transform?.scaleX) ? Number(transform?.scaleX) : 1
  const scaleY = finiteNumber(transform?.scaleY) ? Number(transform?.scaleY) : 1
  return { x: parent.x + x * parent.scaleX, y: parent.y + y * parent.scaleY, scaleX: parent.scaleX * scaleX, scaleY: parent.scaleY * scaleY }
}

function transformFrame(frame: Frame, transform: Transform): Frame { return { x: transform.x + frame.x * transform.scaleX, y: transform.y + frame.y * transform.scaleY, width: frame.width * transform.scaleX, height: frame.height * transform.scaleY } }
function identityTransform(): Transform { return { x: 0, y: 0, scaleX: 1, scaleY: 1 } }

function safeSemanticKey(value: unknown, context: MigrationContext, slideId: string): string | undefined {
  const key = stringValue(value)
  if (!key) return undefined
  const seen = context.semanticKeysBySlide.get(slideId) ?? new Set<string>()
  if (seen.has(key)) {
    addIssue(context.report, { code: 'MIGRATION_SEMANTIC_KEY_AMBIGUOUS', severity: 'warning', message: `Duplicate semanticKey ${key} was left unset on the later element.`, slideId, semanticKey: key, recovery: 'Confirm the business identity in the migration report before using it for review matching.' })
    return undefined
  }
  seen.add(key)
  context.semanticKeysBySlide.set(slideId, seen)
  return key
}

function findAssetId(sourceId: string, assets: Record<string, Asset>): string | undefined {
  if (assets[sourceId]) return sourceId
  const normalized = sourceId.replace(/^assets\//, '')
  return Object.values(assets).find((asset) => asset.path.endsWith(normalized) || asset.id === normalized)?.id
}

function uniqueId(sourceId: string, prefix: string, used: Set<string>, report: MigrationReport, path: string): string {
  const clean = sourceId.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 180) || `${prefix}_item`
  let id = clean
  let suffix = 2
  while (used.has(id)) id = `${clean}_${suffix++}`
  if (id !== clean) addIssue(report, { code: 'MIGRATION_ID_REMAP', severity: 'warning', message: `Duplicate identifier ${clean} was remapped to ${id}.`, path, recovery: 'Use the migration report to update external references.' })
  used.add(id)
  return id
}

function failedMigration(profile: CompatibilityProfile, requestedProfile: string, targetDocumentId: string, sourceFormat: string, message: string, source?: RecordLike): MigrationResult {
  const code = requestedProfile !== profile.id ? 'COMPATIBILITY_PROFILE_UNSUPPORTED' : 'MIGRATION_INPUT_INVALID'
  const report: MigrationReport = {
    reportVersion: '1',
    sourceFormat,
    sourceSchemaVersion: stringValue(source?.schemaVersion),
    sourceDocumentId: stringValue(source?.documentId),
    targetDocumentId,
    targetProfile: requestedProfile,
    sourceDigest: source ? stableDigest(source) : undefined,
    disposition: 'reject',
    migrated: false,
    convertedSlides: 0,
    convertedElements: 0,
    flattenedGroups: 0,
    degradedElements: 0,
    issues: [],
  }
  addIssue(report, {
    code,
    severity: 'error',
    message,
    recovery: code === 'COMPATIBILITY_PROFILE_UNSUPPORTED' ? 'Select a supported target Compatibility Profile or open the source read-only.' : 'Keep the source unchanged, correct the input, and retry migration.',
  })
  return { ok: false, document: emptyDocument(targetDocumentId, 'en-US', sourceFormat), profile, report }
}

function addIssue(report: MigrationReport, issue: MigrationIssue) { report.issues.push(withErrorSemantics(issue)) }
function unwrapSource(input: unknown): RecordLike { const record = asRecord(input); if (!record) throw new Error('MIGRATION_INPUT_INVALID: source must be a JSON object.'); const nested = asRecord(record.document); return nested ?? record }
function collectionValues(value: unknown): RecordLike[] { return Array.isArray(value) ? value.map(asRecord).filter((item): item is RecordLike => Boolean(item)) : collectionEntries(value).map(([, item]) => asRecord(item)).filter((item): item is RecordLike => Boolean(item)) }
function collectionEntries(value: unknown): Array<[string, unknown]> { if (Array.isArray(value)) return value.map((item, index) => [String(index), item]); if (isRecord(value)) return Object.entries(value); return [] }
function asRecord(value: unknown): RecordLike | undefined { return isRecord(value) ? value : undefined }
function isRecord(value: unknown): value is RecordLike { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function stringValue(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined }
function finiteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function validNumber(value: unknown): value is number { return finiteNumber(value) }
function integerPositive(value: unknown): number | undefined { return Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined }
function integerNonNegative(value: unknown): number | undefined { return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : undefined }
function normalizeHash(value: string | undefined): string | undefined { if (!value) return undefined; const hex = value.replace(/^sha256-/, ''); return /^[0-9a-f]{64}$/i.test(hex) ? `sha256-${hex.toLowerCase()}` : undefined }
function safePackagePath(value: string | undefined, fallback: string): string { return value && !value.startsWith('/') && !value.includes('..') && !value.includes('\\') && !value.includes('\u0000') ? value : fallback }
function stableDigest(value: unknown): string { try { return sha256HexBytes(new TextEncoder().encode(canonicalJsonString(value))) } catch { return sha256HexBytes(new TextEncoder().encode('migration')) } }
function cloneJsonRecord(value: RecordLike): RecordLike { return JSON.parse(canonicalJsonString(value)) as RecordLike }
function validRole(value: unknown): TextElement['role'] | undefined { const roles = new Set<TextElement['role']>(['title', 'subtitle', 'body', 'caption', 'metric', 'source', 'logo', 'image', 'chart', 'artwork', 'background', 'decorative', 'navigation', 'cta', 'custom']); return roles.has(value as TextElement['role']) ? value as TextElement['role'] : undefined }
function validShape(value: unknown): ShapeElement['shape'] | undefined { const shapes = new Set<ShapeElement['shape']>(['rectangle', 'rounded-rectangle', 'ellipse', 'line', 'arrow', 'triangle', 'diamond', 'chevron', 'polygon']); return shapes.has(value as ShapeElement['shape']) ? value as ShapeElement['shape'] : undefined }
function validPoint(value: unknown): Point | undefined { const record = asRecord(value); return finiteNumber(record?.x) && finiteNumber(record?.y) ? { x: Number(record?.x), y: Number(record?.y) } : undefined }
function validNormalizedRect(value: unknown): ImageElement['crop'] | undefined { const record = asRecord(value); return finiteNumber(record?.x) && finiteNumber(record?.y) && finiteNumber(record?.width) && finiteNumber(record?.height) && Number(record?.x) >= 0 && Number(record?.y) >= 0 && Number(record?.width) > 0 && Number(record?.height) > 0 && Number(record?.x) + Number(record?.width) <= 1 && Number(record?.y) + Number(record?.height) <= 1 ? { x: Number(record?.x), y: Number(record?.y), width: Number(record?.width), height: Number(record?.height) } : undefined }
function validPaint(value: unknown): boolean { const record = asRecord(value); return record?.kind === 'none' || (record?.kind === 'solid' && isRecord(record.color)) }
function normalizeMarks(value: unknown): TextMarks | undefined { const record = asRecord(value); if (!record) return undefined; const marks: TextMarks = {}; for (const key of ['bold', 'italic', 'underline', 'strike'] as const) if (typeof record[key] === 'boolean') marks[key] = record[key] as boolean; if (typeof record.color === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(record.color)) marks.color = { kind: 'value', value: record.color } as ValueOrToken<`#${string}`>; return Object.keys(marks).length ? marks : undefined }
function normalizeNotes(value: unknown): PpteDocument['slides'][string]['notes'] { const record = asRecord(value); if (!record) return undefined; return { speaker: stringValue(record.speaker), handout: stringValue(record.handout) } }

function emptyDocument(documentId: string, locale: string, sourceFormat = 'unknown'): PpteDocument { const theme = defaultTheme(); return { schemaVersion: '2.0.0', documentId, locale, metadata: { title: 'Migration failed', source: 'migrated', sourceFormat }, canvas: normalizeCanvas(undefined), theme, slideOrder: [], slides: {}, assets: {}, fonts: { font_system_inter: { id: 'font_system_inter', family: 'Inter', style: 'normal', weight: 400, source: 'system', editableSafe: true } } } }
