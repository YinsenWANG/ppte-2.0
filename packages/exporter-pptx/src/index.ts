import { canonicalRevision, sha256HexBytes } from '../../canonical-json/src/index.js'
import { buildCapabilityReport, type CapabilityReport } from '../../capability/src/index.js'
import { writeStoredZip, readStoredZip, type StoredZipEntry } from '../../archive/src/index.js'
import { renderSlideHtml } from '../../renderer-react/src/index.js'
import { renderChartSvg } from '../../charts/src/index.js'
import { validateDocument, type ChartElement, type Element, type Paint, type ParagraphStyle, type PpteDocument, type RichTextDocument, type Stroke, type TextMarks, type ValidationIssue } from '../../schema/src/index.js'
import { withErrorSemantics } from '../../schema/src/errors.js'
import { referenceFontCss, renderReferencePng } from '../../exporter-pdf/src/reference-render.js'

const PPT_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const CHART_NS = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
const CHART_URI = CHART_NS
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'

export interface PptxExportOptions {
  /** Asset bytes are required for a self-contained image package. */
  assetBytes?: Record<string, Uint8Array>
  /** Embedded font payloads used by the fixed Reference Renderer. */
  fontBytes?: Record<string, Uint8Array>
  sourceRevision?: string
  createdAt?: string
  includeCapabilityReport?: boolean
}

export interface PptxExportResult {
  ok: boolean
  format: 'pptx-image'
  bytes: Uint8Array
  slideCount: number
  degraded: boolean
  capabilityReport: CapabilityReport
  issues: ValidationIssue[]
}

export interface PptxInspection {
  valid: boolean
  slideCount: number
  entries: string[]
  hasCapabilityReport: boolean
  hasSemanticText: boolean
  hasSlideImages: boolean
}

export type SemanticPptxNodeKind = 'text-box' | 'picture' | 'shape' | 'chart-svg' | 'component-fallback'

export interface SemanticPptxNode {
  id: string
  sourceElementId?: string
  kind: SemanticPptxNodeKind
  frame: { x: number; y: number; width: number; height: number }
  rotationDeg?: number
  opacity?: number
  flipX?: boolean
  flipY?: boolean
  text?: string
  fontSize?: number
  fontFamily?: string
  color?: string
  bold?: boolean
  align?: 'left' | 'center' | 'right'
  assetId?: string
  staticSvg?: string
  fallbackLabel?: string
  shape?: string
  fill?: string
  fillPaint?: Paint
  fillOpacity?: number
  stroke?: string
  strokeWidth?: number
  strokeOpacity?: number
  strokeDash?: number[]
  lineCap?: Stroke['lineCap']
  lineJoin?: Stroke['lineJoin']
  crop?: { x: number; y: number; width: number; height: number }
  posterAsArtwork?: boolean
  paragraphs?: SemanticPptxParagraph[]
  nativeChart?: boolean
  chartType?: ChartElement['chartType']
  chartData?: ChartElement['data']
  chartEncoding?: ChartElement['encoding']
  chartOptions?: ChartElement['options']
}

export interface SemanticPptxParagraph {
  runs: SemanticPptxRun[]
  align?: 'left' | 'center' | 'right'
  list?: 'bullet' | 'number'
  spaceBefore?: number
  spaceAfter?: number
  lineHeight?: number
  indent?: number
}

export interface SemanticPptxRun {
  text: string
  marks?: TextMarks
}

export interface SemanticPptxSlide {
  slideId: string
  strategy: 'structured' | 'hybrid' | 'poster'
  nodes: SemanticPptxNode[]
  posterAsArtwork: boolean
  background?: Paint
}

export interface SemanticPptxCompilation {
  ok: boolean
  sourceRevision: string
  slides: SemanticPptxSlide[]
  capabilityReport: CapabilityReport
  issues: ValidationIssue[]
  degraded: boolean
}

export interface SemanticPptxExportResult {
  ok: boolean
  format: 'pptx-semantic'
  bytes: Uint8Array
  slideCount: number
  degraded: boolean
  capabilityReport: CapabilityReport
  compilation: SemanticPptxCompilation
  issues: ValidationIssue[]
}

/**
 * Export every slide as one deterministic raster image wrapped in an SVG
 * media part in an otherwise ordinary OOXML presentation. The image boundary
 * is deliberate: the semantic PPTe snapshot and capability report remain the
 * editable source of truth.
 */
export function exportImagePptx(document: PpteDocument, options: PptxExportOptions = {}): PptxExportResult {
  const sourceRevision = options.sourceRevision ?? canonicalRevision(document)
  const report = buildCapabilityReport(document, 'pptx-image', { sourceRevision })
  const structuralIssues = validateDocument(document, { runtimeSubset: false }).filter((issue) => issue.severity === 'error')
  const issues: ValidationIssue[] = [...report.issues, ...structuralIssues]
  const assetSources = buildAssetSources(document, options.assetBytes ?? {}, issues)
  const fontCss = buildFontCss(document, options.fontBytes, issues)
  collectFontIssues(document, options.fontBytes, issues)
  addCapabilityWarnings(report, issues)
  const slideSvgs: string[] = []
  if (structuralIssues.length === 0) {
    for (const slideId of document.slideOrder) {
      try {
        const html = renderSlideHtml(document, slideId, { assetSources, editable: false, includeHostControls: false })
        const png = renderReferencePng(htmlWithCanvasSize(html, document.canvas.width, document.canvas.height, fontCss), Math.round(document.canvas.width), Math.round(document.canvas.height))
        slideSvgs.push(rasterizedSlideSvg(document.canvas.width, document.canvas.height, png))
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        issues.push(withErrorSemantics({ code: 'EXPORT_DEGRADED', severity: 'error', message: `Slide ${slideId} could not be rendered as a self-contained image: ${message}`, slideId, recovery: 'Keep the source document, resolve the reported element/resource, and export again.' }))
        slideSvgs.push(renderFailureSvg(document.canvas.width, document.canvas.height, slideId))
      }
    }
  }
  const capabilityReport = finalizeReport(report, issues)
  const packageBytes = structuralIssues.length === 0 ? buildPptx(document, slideSvgs, capabilityReport, options) : new Uint8Array()
  const finalIssues = dedupe(issues)
  const hasBlockingIssue = !capabilityReport.ok || finalIssues.some((issue) => issue.severity === 'error') || capabilityReport.items.some((item) => ['blocked', 'unsupported', 'missing-source'].includes(item.status))
  return {
    ok: !hasBlockingIssue && slideSvgs.length === document.slideOrder.length,
    format: 'pptx-image',
    bytes: packageBytes,
    slideCount: slideSvgs.length,
    degraded: true,
    capabilityReport,
    issues: finalIssues,
  }
}

export const exportPptx = exportImagePptx
export const exportPptxBytes = (document: PpteDocument, options: PptxExportOptions = {}): Uint8Array => exportImagePptx(document, options).bytes

/** Validate the package boundary without interpreting slide semantics. */
export function inspectPptx(data: Uint8Array): PptxInspection {
  const archive = readStoredZip(data)
  const entries = [...archive.keys()].sort()
  const slideCount = entries.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry)).length
  const slideXml = entries.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry)).map((entry) => new TextDecoder().decode(archive.get(entry) ?? new Uint8Array())).join('')
  return { valid: entries.includes('[Content_Types].xml') && entries.includes('ppt/presentation.xml') && slideCount > 0, slideCount, entries, hasCapabilityReport: entries.includes('ppt/ppte/capability-report.json'), hasSemanticText: /<a:t>[^<]+<\/a:t>/.test(slideXml), hasSlideImages: entries.some((entry) => /^ppt\/media\/slide\d+\.svg$/.test(entry)) }
}

/** Compile the semantic snapshot into explicit PPTX mapping nodes. No slide is first rendered to an image. */
export function compileSemanticPptx(document: PpteDocument, options: PptxExportOptions = {}): SemanticPptxCompilation {
  const documentRevision = canonicalRevision(document)
  const sourceRevision = options.sourceRevision ?? documentRevision
  const revisionIssues = options.sourceRevision !== undefined && options.sourceRevision !== documentRevision
    ? [exportIssue('EXPORT_SOURCE_REVISION_MISMATCH', 'Semantic PPTX sourceRevision does not match the exported document snapshot.')]
    : []
  const capabilityReport = buildCapabilityReport(document, 'pptx-semantic', { sourceRevision })
  const issues = dedupe([...revisionIssues, ...capabilityReport.issues, ...validateDocument(document, { runtimeSubset: false }).filter((issue) => issue.severity === 'error')])
  const slides: SemanticPptxSlide[] = []
  if (!issues.some((issue) => issue.severity === 'error')) {
    for (const slideId of document.slideOrder) {
      const slide = document.slides[slideId]
      if (!slide) continue
      const strategy = slide.visualStrategy ?? 'structured'
      if (strategy === 'poster') {
        const artwork = Object.values(slide.elements).find((element): element is Extract<Element, { type: 'image' }> => element.type === 'image' && element.role === 'artwork')
        const artworkNode: SemanticPptxNode = artwork
          ? { id: `${slideId}:poster-artwork`, sourceElementId: artwork.id, kind: 'picture', frame: artwork.frame, assetId: artwork.assetId, crop: artwork.crop, posterAsArtwork: true }
          : { id: `${slideId}:poster-missing`, kind: 'component-fallback', frame: { x: 0, y: 0, width: document.canvas.width, height: document.canvas.height }, fallbackLabel: 'Poster artwork unavailable', posterAsArtwork: true }
        const semanticElements = slide.rootOrder.map((elementId) => slide.elements[elementId]).filter((element): element is Element => Boolean(element) && element.visible !== false && element.id !== artwork?.id)
        slides.push({
          slideId,
          strategy,
          posterAsArtwork: true,
          background: slide.background ?? document.canvas.defaultBackground,
          nodes: [artworkNode, ...semanticNodes(document, slideId, semanticElements, issues)],
        })
        if (!artwork) issues.push(exportIssue('POSTER_ARTWORK_MISSING', `Poster slide ${slideId} has no artwork Image element.`, slideId))
        continue
      }
      const nodes = semanticNodes(document, slideId, slide.rootOrder.map((elementId) => slide.elements[elementId]).filter((element): element is Element => Boolean(element) && element.visible !== false), issues)
      slides.push({ slideId, strategy, nodes, posterAsArtwork: false, background: slide.background ?? document.canvas.defaultBackground })
    }
  }
  const degraded = capabilityReport.degraded || slides.some((slide) => slide.posterAsArtwork || slide.nodes.some((node) => (node.kind === 'chart-svg' && node.nativeChart !== true) || node.kind === 'component-fallback' || node.fallbackLabel !== undefined))
  return { ok: !issues.some((issue) => issue.severity === 'error'), sourceRevision, slides, capabilityReport, issues, degraded }
}

export function exportSemanticPptx(document: PpteDocument, options: PptxExportOptions = {}): SemanticPptxExportResult {
  const compilation = compileSemanticPptx(document, options)
  const issues = [...compilation.issues]
  collectFontIssues(document, options.fontBytes, issues)
  addCapabilityWarnings(compilation.capabilityReport, issues)
  const media = prepareSemanticMedia(document, compilation, options, issues)
  let capabilityReport = finalizeReport(compilation.capabilityReport, issues)
  let bytes: Uint8Array = new Uint8Array()
  if (compilation.slides.length === document.slideOrder.length && !compilation.issues.some((issue) => issue.severity === 'error')) {
    try {
      bytes = buildSemanticPptx(document, compilation, options, capabilityReport, media)
    } catch (cause) {
      issues.push(exportIssue('EXPORT_FAILED', cause instanceof Error ? cause.message : String(cause)))
    }
  }
  capabilityReport = finalizeReport(compilation.capabilityReport, issues)
  const finalIssues = dedupe(issues)
  const degraded = compilation.degraded || capabilityReport.degraded || finalIssues.length > 0
  return { ok: bytes.length > 0 && !finalIssues.some((issue) => issue.severity === 'error') && capabilityReport.ok, format: 'pptx-semantic', bytes, slideCount: compilation.slides.length, degraded, capabilityReport, compilation: { ...compilation, capabilityReport, issues: finalIssues, ok: !finalIssues.some((issue) => issue.severity === 'error'), degraded }, issues: finalIssues }
}

export const exportPptxSemantic = exportSemanticPptx

function semanticNodes(document: PpteDocument, slideId: string, elements: Element[], issues: ValidationIssue[]): SemanticPptxNode[] {
  const nodes: SemanticPptxNode[] = []
  for (const element of elements) {
    const node = semanticNode(document, slideId, element)
    if (node) nodes.push(node)
    else issues.push(exportIssue('ELEMENT_UNSUPPORTED', `Semantic PPTX has no mapping for element ${element.id}.`, slideId, element.id))
  }
  return nodes
}

function semanticNode(document: PpteDocument, slideId: string, element: Element): SemanticPptxNode | undefined {
  if (element.type === 'text') {
    const preset = document.theme.presets.text[element.style.styleRef]
    const style = { ...preset, ...(element.style.overrides ?? {}) }
    return { id: `${slideId}:${element.id}`, sourceElementId: element.id, kind: 'text-box', frame: element.frame, ...elementFields(element), text: element.content.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n'), fontSize: typeof style.fontSize === 'number' ? style.fontSize : undefined, fontFamily: resolveTextFamily(style.fontFamily, document), color: resolveTextColor(style.color, document), bold: typeof style.fontWeight === 'number' && style.fontWeight >= 600, align: element.paragraphStyle?.align, paragraphs: semanticParagraphs(element.content, element.paragraphStyle, typeof style.lineHeight === 'number' ? style.lineHeight : undefined) }
  }
  if (element.type === 'image') return { id: `${slideId}:${element.id}`, sourceElementId: element.id, kind: 'picture', frame: element.frame, ...elementFields(element), assetId: element.assetId, crop: element.crop }
  if (element.type === 'shape') {
    const preset = document.theme.presets.shape[element.style.styleRef] ?? {}
    const style = { ...preset, ...(element.style.overrides ?? {}) }
    const fillPaint = style.fill as Paint | undefined
    const stroke = style.stroke as Stroke | undefined
    return { id: `${slideId}:${element.id}`, sourceElementId: element.id, kind: 'shape', frame: element.frame, ...elementFields(element), shape: element.shape, fill: paintColor(fillPaint, document), fillPaint, fillOpacity: fillPaint?.kind === 'solid' || fillPaint?.kind === 'linear-gradient' ? fillPaint.opacity : undefined, stroke: strokeColor(stroke, document), strokeWidth: stroke?.width, strokeOpacity: stroke?.opacity, strokeDash: stroke?.dash, lineCap: stroke?.lineCap, lineJoin: stroke?.lineJoin }
  }
  if (element.type === 'chart') return { id: `${slideId}:${element.id}`, sourceElementId: element.id, kind: 'chart-svg', frame: element.frame, ...elementFields(element), staticSvg: renderChartSvg(element, { width: element.frame.width, height: element.frame.height, runtimeProfile: 'ga-c' }), nativeChart: ['bar', 'line', 'pie'].includes(element.chartType), chartType: element.chartType, chartData: element.data, chartEncoding: element.encoding, chartOptions: element.options }
  if (element.type === 'component' && element.fallback.kind === 'asset' && element.fallback.assetId) return { id: `${slideId}:${element.id}`, sourceElementId: element.id, kind: 'picture', frame: element.frame, ...elementFields(element), assetId: element.fallback.assetId, fallbackLabel: element.fallback.label ?? `${element.componentType} static fallback` }
  if (element.type === 'component') return { id: `${slideId}:${element.id}`, sourceElementId: element.id, kind: 'component-fallback', frame: element.frame, ...elementFields(element), fallbackLabel: element.fallback.label ?? `${element.componentType} fallback` }
  return undefined
}

function prepareSemanticMedia(document: PpteDocument, compilation: SemanticPptxCompilation, options: PptxExportOptions, issues: ValidationIssue[]): Map<string, { filename: string; data: Uint8Array }> {
  const media = new Map<string, { filename: string; data: Uint8Array }>()
  const addMedia = (key: string, filename: string, data: Uint8Array) => { if (!media.has(key)) media.set(key, { filename, data }) }
  for (const slide of compilation.slides) for (const node of slide.nodes) {
    if (node.kind === 'chart-svg' && node.staticSvg) addMedia(`chart:${node.id}`, `chart-${safeId(node.id)}.svg`, text(node.staticSvg))
    if (node.kind === 'picture' && node.assetId) {
      const asset = document.assets[node.assetId]
      const data = asset ? options.assetBytes?.[asset.id] : undefined
      if (!asset) {
        issues.push(exportIssue('ASSET_MISSING', `Semantic PPTX mapping could not resolve asset ${node.assetId}.`, slide.slideId, node.sourceElementId))
        addMedia(`asset:${node.assetId}`, `asset-${safeId(node.assetId)}.svg`, text(placeholderSvg(node.assetId)))
      } else if (!data) {
        issues.push(exportIssue('ASSET_PAYLOAD_MISSING', `Semantic PPTX export requires bytes for asset ${asset.id}.`, slide.slideId, node.sourceElementId))
        addMedia(`asset:${asset.id}`, `asset-${safeId(asset.id)}.svg`, text(placeholderSvg(asset.id)))
      } else if (sha256HexBytes(data) !== normalizeHash(asset.hash) || (asset.byteLength > 0 && data.length !== asset.byteLength)) {
        issues.push(exportIssue('ASSET_HASH_MISMATCH', `Asset ${asset.id} bytes do not match the declared payload.`, slide.slideId, node.sourceElementId))
        addMedia(`asset:${asset.id}`, `asset-${safeId(asset.id)}.svg`, text(placeholderSvg(asset.id)))
      } else addMedia(`asset:${asset.id}`, `asset-${safeId(asset.id)}.${extensionForMime(asset.mimeType)}`, new Uint8Array(data))
    }
  }
  return media
}

function buildSemanticPptx(document: PpteDocument, compilation: SemanticPptxCompilation, options: PptxExportOptions, capabilityReport: CapabilityReport, media: Map<string, { filename: string; data: Uint8Array }>): Uint8Array {
  const width = emu(document.canvas.width)
  const height = emu(document.canvas.height)
  const chartParts = new Map<string, { filename: string; data: Uint8Array }>()
  for (const slide of compilation.slides) for (const node of slide.nodes) {
    if (node.nativeChart !== true || !node.chartType || !node.chartData || !node.chartEncoding) continue
    const filename = `chart${chartParts.size + 1}.xml`
    chartParts.set(`chartpart:${node.id}`, { filename, data: text(nativeChartPart(node)) })
  }
  const entries: StoredZipEntry[] = [
    { name: '[Content_Types].xml', data: text(contentTypes(compilation.slides.length, options.includeCapabilityReport !== false, chartParts.size)) },
    { name: '_rels/.rels', data: text(rootRelationships()) },
    { name: 'docProps/core.xml', data: text(coreProperties(document, options.createdAt)) },
    { name: 'docProps/app.xml', data: text(appProperties(compilation.slides.length)) },
    { name: 'ppt/presentation.xml', data: text(presentation(document, compilation.slides.length, width, height)) },
    { name: 'ppt/_rels/presentation.xml.rels', data: text(presentationRelationships(compilation.slides.length)) },
    { name: 'ppt/presProps.xml', data: text('<p:presentationPr xmlns:p="' + PPT_NS + '"/>') },
    { name: 'ppt/viewProps.xml', data: text('<p:viewPr xmlns:p="' + PPT_NS + '" lastView="sldView"><p:normalViewPr/></p:viewPr>') },
    { name: 'ppt/theme/theme1.xml', data: text(theme()) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: text(slideMaster(width, height)) },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: text(slideMasterRelationships()) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: text(slideLayout()) },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: text(slideLayoutRelationships()) },
  ]
  for (const [index, slide] of compilation.slides.entries()) {
    const number = index + 1
    const relationIds = new Map<string, string>()
    let relationIndex = 2
    for (const node of slide.nodes) {
      const key = relationKey(node)
      if (key && (media.has(key) || chartParts.has(key)) && !relationIds.has(key)) relationIds.set(key, `rId${relationIndex++}`)
    }
    entries.push({ name: `ppt/slides/slide${number}.xml`, data: text(semanticSlide(width, height, slide, relationIds, document)) })
    entries.push({ name: `ppt/slides/_rels/slide${number}.xml.rels`, data: text(semanticSlideRelationships(slide, relationIds, media, chartParts)) })
  }
  for (const item of [...chartParts.values()].sort((left, right) => left.filename.localeCompare(right.filename))) entries.push({ name: `ppt/charts/${item.filename}`, data: item.data })
  for (const item of [...media.values()].sort((left, right) => left.filename.localeCompare(right.filename))) entries.push({ name: `ppt/media/${item.filename}`, data: item.data })
  if (options.includeCapabilityReport !== false) entries.push({ name: 'ppt/ppte/capability-report.json', data: text(JSON.stringify(capabilityReport, null, 2)) })
  return writeStoredZip(entries)
}

function semanticSlide(width: number, height: number, slide: SemanticPptxSlide, relationIds: Map<string, string>, document: PpteDocument): string {
  const nodes = slide.nodes.map((node, index) => semanticNodeXml(node, 2 + index, relationIds.get(relationKey(node) ?? ''), document)).join('')
  const background = slide.background ? `<p:bg><p:bgPr>${paintXml(slide.background, document)}<a:effectLst/></p:bgPr></p:bg>` : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="${DRAWING_NS}" xmlns:c="${CHART_NS}" xmlns:r="${REL_NS}" xmlns:p="${PPT_NS}"><p:cSld name="${escapeXml(slide.slideId)}">${background}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${nodes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
}

function semanticNodeXml(node: SemanticPptxNode, numericId: number, relationId: string | undefined, document: PpteDocument): string {
  const xfrm = transformXml(node)
  if (node.kind === 'picture' && relationId) return `<p:pic><p:nvPicPr><p:cNvPr id="${numericId}" name="${escapeXml(node.sourceElementId ?? node.id)}"/><p:cNvPicPr preferRelativeResize="0"/><p:nvPr/></p:nvPicPr><p:blipFill>${node.crop ? `<a:srcRect l="${Math.round(node.crop.x * 100000)}" t="${Math.round(node.crop.y * 100000)}" r="${Math.round((1 - node.crop.x - node.crop.width) * 100000)}" b="${Math.round((1 - node.crop.y - node.crop.height) * 100000)}"/>` : ''}<a:blip r:embed="${relationId}">${node.opacity === undefined ? '' : `<a:alphaModFix amt="${Math.round(clamp01(node.opacity) * 100000)}"/>`}</a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
  if (node.kind === 'text-box') return semanticTextShape(node, numericId, xfrm, false, document)
  if (node.kind === 'component-fallback') return semanticTextShape(node, numericId, xfrm, true, document)
  if (node.kind === 'shape') return `<p:sp><p:nvSpPr><p:cNvPr id="${numericId}" name="${escapeXml(node.sourceElementId ?? node.id)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm}<a:prstGeom prst="${shapePreset(node.shape)}"><a:avLst/></a:prstGeom>${shapeFillXml(node.fillPaint ?? node.fill, node.stroke, document, node.opacity, node.strokeOpacity, node.strokeWidth, node.strokeDash, node.lineCap, node.lineJoin)}</p:spPr></p:sp>`
  if (node.kind === 'chart-svg' && node.nativeChart === true && relationId) return nativeChartFrame(node, numericId, relationId)
  if (node.kind === 'chart-svg' && relationId) return `<p:pic><p:nvPicPr><p:cNvPr id="${numericId}" name="${escapeXml(node.sourceElementId ?? node.id)}"/><p:cNvPicPr preferRelativeResize="0"/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relationId}">${node.opacity === undefined ? '' : `<a:alphaModFix amt="${Math.round(clamp01(node.opacity) * 100000)}"/>`}</a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
  return ''
}

function relationKey(node: SemanticPptxNode): string | undefined {
  if (node.kind === 'chart-svg') return node.nativeChart === true ? `chartpart:${node.id}` : `chart:${node.id}`
  return node.assetId ? `asset:${node.assetId}` : undefined
}

function nativeChartFrame(node: SemanticPptxNode, numericId: number, relationId: string): string {
  const rotation = node.rotationDeg === undefined ? '' : ` rot="${Math.round(node.rotationDeg * 60000)}"`
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${numericId}" name="${escapeXml(node.sourceElementId ?? node.id)}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm${rotation}><a:off x="${emu(node.frame.x)}" y="${emu(node.frame.y)}"/><a:ext cx="${emu(node.frame.width)}" cy="${emu(node.frame.height)}"/></p:xfrm><a:graphic><a:graphicData uri="${CHART_URI}"><c:chart r:id="${relationId}"/></a:graphicData></a:graphic></p:graphicFrame>`
}

function nativeChartPart(node: SemanticPptxNode): string {
  const data = node.chartData!
  const encoding = node.chartEncoding!
  const categories = data.rows.map((row) => String(row.values[encoding.categoryField] ?? row.id))
  const valueFields = encoding.valueFields.filter((field) => data.columns.some((column) => column.id === field && column.type === 'number'))
  const series = valueFields.map((field, index) => nativeChartSeries(data, encoding, categories, field, index)).join('')
  const chartType = node.chartType!
  const axisIds = { category: 48650112, value: 48672768 }
  const plot = chartType === 'bar'
    ? `<c:barChart><c:barDir val="${node.chartOptions?.orientation === 'horizontal' ? 'bar' : 'col'}"/><c:grouping val="${node.chartOptions?.stacked ? 'stacked' : 'clustered'}"/><c:varyColors val="0"/>${series}<c:gapWidth val="150"/><c:overlap val="${node.chartOptions?.stacked ? '100' : '0'}"/><c:axId val="${axisIds.category}"/><c:axId val="${axisIds.value}"/></c:barChart>`
    : chartType === 'line'
      ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:marker val="1"/><c:smooth val="0"/><c:axId val="${axisIds.category}"/><c:axId val="${axisIds.value}"/></c:lineChart>`
      : `<c:pieChart><c:varyColors val="1"/>${series}<c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showLeaderLines val="0"/></c:dLbls></c:pieChart>`
  const axes = chartType === 'pie' ? '' : nativeChartAxes(axisIds.category, axisIds.value)
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="${CHART_NS}" xmlns:a="${DRAWING_NS}" xmlns:r="${REL_NS}"><c:date1904 val="0"/><c:lang val="en-US"/><c:roundedCorners val="0"/><c:style val="10"/><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/>${plot}${axes}</c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart><c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/></c:printSettings></c:chartSpace>`
}

function nativeChartSeries(data: ChartElement['data'], encoding: ChartElement['encoding'], categories: string[], field: string, index: number): string {
  const fieldColumn = data.columns.find((column) => column.id === field)
  const categoryColumn = data.columns.find((column) => column.id === encoding.categoryField)
  const fieldColumnIndex = Math.max(0, data.columns.findIndex((column) => column.id === field))
  const categoryColumnIndex = Math.max(0, data.columns.findIndex((column) => column.id === encoding.categoryField))
  const values = data.rows.map((row) => typeof row.values[field] === 'number' && Number.isFinite(row.values[field]) ? row.values[field] as number : 0)
  const categoryFormula = `Sheet1!$${excelColumn(categoryColumnIndex)}$2:$${excelColumn(categoryColumnIndex)}$${Math.max(2, categories.length + 1)}`
  const valueFormula = `Sheet1!$${excelColumn(fieldColumnIndex)}$2:$${excelColumn(fieldColumnIndex)}$${Math.max(2, values.length + 1)}`
  const titleFormula = `Sheet1!$${excelColumn(fieldColumnIndex)}$1`
  const title = fieldColumn?.label ?? field
  const categoryCache = categories.map((category, pointIndex) => `<c:pt idx="${pointIndex}"><c:v>${escapeXml(category)}</c:v></c:pt>`).join('')
  const valueCache = values.map((value, pointIndex) => `<c:pt idx="${pointIndex}"><c:v>${String(value)}</c:v></c:pt>`).join('')
  const marker = '<c:marker><c:symbol val="circle"/><c:size val="6"/></c:marker>'
  return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:strRef><c:f>${escapeXml(titleFormula)}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${escapeXml(title)}</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:f>${escapeXml(categoryFormula)}</c:f><c:strCache><c:ptCount val="${categories.length}"/>${categoryCache}</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>${escapeXml(valueFormula)}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${valueCache}</c:numCache></c:numRef></c:val>${nodeSeriesMarker(data, encoding, marker)}</c:ser>`
}

function nodeSeriesMarker(data: ChartElement['data'], encoding: ChartElement['encoding'], marker: string): string {
  return data && encoding ? marker : ''
}

function nativeChartAxes(categoryId: number, valueId: number): string {
  return `<c:catAx><c:axId val="${categoryId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${valueId}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="${valueId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:numFmt formatCode="General" sourceLinked="1"/><c:crossAx val="${categoryId}"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>`
}

function excelColumn(index: number): string {
  let value = index + 1
  let result = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }
  return result
}

function semanticTextShape(node: SemanticPptxNode, numericId: number, xfrm: string, fallback: boolean, document: PpteDocument): string {
  const textValue = node.text ?? node.fallbackLabel ?? ''
  const fill = fallback ? shapeFillXml('#F1F5F9', '#94A3B8', node.opacity) : ''
  const fontSize = Math.max(100, Math.round((node.fontSize ?? 18) * 75))
  const color = colorValue(node.color ?? (fallback ? '#334155' : '#1F2937'))
  const paragraphs = node.paragraphs?.length ? node.paragraphs : [{ runs: [{ text: textValue, marks: node.bold ? { bold: true } : undefined }], align: node.align }]
  const textBody = paragraphs.map((paragraph) => semanticParagraphXml(paragraph, fontSize, node.fontFamily, color, node.opacity, node.bold === true, document)).join('')
  return `<p:sp><p:nvSpPr><p:cNvPr id="${numericId}" name="${escapeXml(node.sourceElementId ?? node.id)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${textBody}</p:txBody></p:sp>`
}

function transformXml(node: SemanticPptxNode): string {
  const attributes = [
    node.rotationDeg === undefined ? '' : ` rot="${Math.round(node.rotationDeg * 60000)}"`,
    node.flipX ? ' flipH="1"' : '',
    node.flipY ? ' flipV="1"' : '',
  ].join('')
  return `<a:xfrm${attributes}><a:off x="${emu(node.frame.x)}" y="${emu(node.frame.y)}"/><a:ext cx="${emu(node.frame.width)}" cy="${emu(node.frame.height)}"/></a:xfrm>`
}

function semanticParagraphXml(paragraph: SemanticPptxParagraph, fontSize: number, fontFamily: string | undefined, defaultColor: string, opacity: number | undefined, defaultBold: boolean, document: PpteDocument): string {
  const alignment = paragraph.align ? ` algn="${paragraph.align === 'center' ? 'ctr' : paragraph.align === 'right' ? 'r' : 'l'}"` : ''
  const bullet = paragraph.list === 'bullet' ? '<a:buChar char="•"/>' : paragraph.list === 'number' ? '<a:buAutoNum type="arabicPeriod"/>' : ''
  const spacing = `${paragraph.spaceBefore === undefined ? '' : `<a:spcBef><a:spcPts val="${Math.max(0, Math.round(points100(paragraph.spaceBefore)))}"/></a:spcBef>`}${paragraph.spaceAfter === undefined ? '' : `<a:spcAft><a:spcPts val="${Math.max(0, Math.round(points100(paragraph.spaceAfter)))}"/></a:spcAft>`}`
  const lineSpacing = paragraph.lineHeight === undefined ? '' : `<a:lnSpc><a:spcPct val="${Math.round(Math.max(0, paragraph.lineHeight) * 100000)}"/></a:lnSpc>`
  const indent = paragraph.indent === undefined ? '' : ` marL="${emu(Math.max(0, paragraph.indent))}"`
  const paragraphProperties = alignment || bullet || spacing || lineSpacing || indent ? `<a:pPr${alignment}${indent}>${bullet}${spacing}${lineSpacing}</a:pPr>` : ''
  const runs = paragraph.runs.map((run) => semanticRunXml(run, fontSize, fontFamily, defaultColor, opacity, defaultBold, document)).join('')
  const endParagraph = fontFamily
    ? `<a:endParaRPr lang="en-US" sz="${fontSize}"><a:latin typeface="${escapeXml(fontFamily)}"/></a:endParaRPr>`
    : `<a:endParaRPr lang="en-US" sz="${fontSize}"/>`
  return `<a:p>${paragraphProperties}${runs}${endParagraph}</a:p>`
}

function semanticRunXml(run: SemanticPptxRun, fontSize: number, fontFamily: string | undefined, defaultColor: string, opacity: number | undefined, defaultBold: boolean, document: PpteDocument): string {
  const marks = run.marks
  const color = marks?.color ? resolveTextColor(marks.color, document) ?? defaultColor : defaultColor
  const attributes = [
    ` lang="en-US" sz="${fontSize}"`,
    marks?.bold || defaultBold ? ' b="1"' : '',
    marks?.italic ? ' i="1"' : '',
    marks?.underline ? ' u="sng"' : '',
    marks?.strike ? ' strike="sng"' : '',
  ].join('')
  const family = fontFamily ? `<a:latin typeface="${escapeXml(fontFamily)}"/>` : ''
  return `<a:r><a:rPr${attributes}><a:solidFill>${srgbColorXml(color, opacity)}</a:solidFill>${family}</a:rPr><a:t>${escapeXml(run.text)}</a:t></a:r>`
}

function semanticParagraphs(content: RichTextDocument, paragraphStyle?: ParagraphStyle, lineHeight?: number): SemanticPptxParagraph[] {
  return content.paragraphs.map((paragraph, index) => ({ runs: paragraph.runs.map((run) => ({ text: run.text, marks: run.marks })), align: paragraph.align ?? paragraphStyle?.align, list: paragraph.list?.type, spaceBefore: paragraph.spaceBefore, spaceAfter: paragraph.spaceAfter ?? (index < content.paragraphs.length - 1 ? paragraphStyle?.paragraphSpacing : undefined), lineHeight: lineHeight ?? paragraphStyle?.lineHeight, indent: paragraphStyle?.listIndent }))
}

function elementFields(element: Element): Pick<SemanticPptxNode, 'rotationDeg' | 'opacity' | 'flipX' | 'flipY'> {
  return { rotationDeg: element.rotationDeg, opacity: element.opacity, flipX: element.flipX, flipY: element.flipY }
}

function paintXml(paint: Paint, document: PpteDocument, opacityMultiplier = 1): string {
  if (paint.kind === 'none') return '<a:noFill/>'
  if (paint.kind === 'solid') return `<a:solidFill>${srgbColorXml(resolveTextColor(paint.color, document) ?? '#FFFFFF', multiplyOpacity(paint.opacity, opacityMultiplier))}</a:solidFill>`
  const stops = paint.stops.map((stop) => `<a:gs pos="${Math.round(Math.max(0, Math.min(1, stop.offset)) * 100000)}">${srgbColorXml(resolveTextColor(stop.color, document) ?? '#FFFFFF', multiplyOpacity(paint.opacity, opacityMultiplier))}</a:gs>`).join('')
  return `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst><a:lin ang="${Math.round(((paint.angleDeg % 360) + 360) % 360 * 60000)}" scaled="1"/></a:gradFill>`
}

function srgbColorXml(value: string, opacity?: number): string {
  const normalized = colorValue(value)
  const alpha = multiplyOpacity(colorAlpha(value), opacity)
  return `<a:srgbClr val="${normalized}">${alpha === undefined || alpha >= 1 ? '' : `<a:alpha val="${Math.round(clamp01(alpha) * 100000)}"/>`}</a:srgbClr>`
}

function multiplyOpacity(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined && right === undefined) return undefined
  return clamp01((left ?? 1) * (right ?? 1))
}

function colorAlpha(value: string): number | undefined {
  const normalized = value.replace('#', '')
  return /^[0-9A-Fa-f]{8}$/.test(normalized) ? parseInt(normalized.slice(6), 16) / 255 : undefined
}

function semanticSlideRelationships(slide: SemanticPptxSlide, relationIds: Map<string, string>, media: Map<string, { filename: string; data: Uint8Array }>, chartParts: Map<string, { filename: string; data: Uint8Array }>): string {
  const relationships = [...relationIds.entries()].sort((left, right) => left[1].localeCompare(right[1])).map(([key, id]) => {
    if (key.startsWith('chartpart:')) {
      const filename = chartParts.get(key)?.filename ?? `chart-${safeId(key)}.xml`
      return `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/${filename}"/>`
    }
    const filename = media.get(key)?.filename ?? `asset-${safeId(key)}.svg`
    return `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${filename}"/>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_REL_NS}">${relationships}<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`
}

function buildPptx(document: PpteDocument, slides: string[], report: CapabilityReport, options: PptxExportOptions): Uint8Array {
  const width = emu(document.canvas.width)
  const height = emu(document.canvas.height)
  const entries: StoredZipEntry[] = []
  entries.push({ name: '[Content_Types].xml', data: text(contentTypes(slides.length, options.includeCapabilityReport !== false)) })
  entries.push({ name: '_rels/.rels', data: text(rootRelationships()) })
  entries.push({ name: 'docProps/core.xml', data: text(coreProperties(document, options.createdAt)) })
  entries.push({ name: 'docProps/app.xml', data: text(appProperties(slides.length)) })
  entries.push({ name: 'ppt/presentation.xml', data: text(presentation(document, slides.length, width, height)) })
  entries.push({ name: 'ppt/_rels/presentation.xml.rels', data: text(presentationRelationships(slides.length)) })
  entries.push({ name: 'ppt/presProps.xml', data: text('<p:presentationPr xmlns:p="' + PPT_NS + '"/>') })
  entries.push({ name: 'ppt/viewProps.xml', data: text('<p:viewPr xmlns:p="' + PPT_NS + '" lastView="sldView"><p:normalViewPr/></p:viewPr>') })
  entries.push({ name: 'ppt/theme/theme1.xml', data: text(theme()) })
  entries.push({ name: 'ppt/slideMasters/slideMaster1.xml', data: text(slideMaster(width, height)) })
  entries.push({ name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: text(slideMasterRelationships()) })
  entries.push({ name: 'ppt/slideLayouts/slideLayout1.xml', data: text(slideLayout()) })
  entries.push({ name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: text(slideLayoutRelationships()) })
  for (const [index, svg] of slides.entries()) {
    const number = index + 1
    entries.push({ name: `ppt/slides/slide${number}.xml`, data: text(slide(width, height, number)) })
    entries.push({ name: `ppt/slides/_rels/slide${number}.xml.rels`, data: text(slideRelationships(number)) })
    entries.push({ name: `ppt/media/slide${number}.svg`, data: text(svg) })
  }
  if (options.includeCapabilityReport !== false) entries.push({ name: 'ppt/ppte/capability-report.json', data: text(JSON.stringify(report, null, 2)) })
  return writeStoredZip(entries)
}

function buildAssetSources(document: PpteDocument, bytesById: Record<string, Uint8Array>, issues: ValidationIssue[]): Record<string, string> {
  const sources: Record<string, string> = {}
  const referencedAssetIds = new Set(
    document.slideOrder.flatMap((slideId) => Object.values(document.slides[slideId]?.elements ?? {}).flatMap((element) => element.type === 'image' ? [element.assetId] : element.type === 'component' && element.fallback.kind === 'asset' && element.fallback.assetId ? [element.fallback.assetId] : [])),
  )
  for (const asset of Object.values(document.assets)) {
    if (!referencedAssetIds.has(asset.id)) continue
    const bytes = bytesById[asset.id]
    if (!bytes) {
      addAssetIssue(document, asset.id, 'ASSET_PAYLOAD_MISSING', `Image PPTX export requires bytes for asset ${asset.id}.`, issues, 'Provide assetBytes for every referenced asset, then export again.')
      sources[asset.id] = placeholderDataUri(asset.id)
      continue
    }
    const digest = `sha256-${sha256HexBytes(bytes)}`
    const expected = normalizeHash(asset.hash)
    if (expected && digest.slice('sha256-'.length) !== expected) {
      addAssetIssue(document, asset.id, 'ASSET_HASH_MISMATCH', `Asset ${asset.id} bytes do not match the declared hash.`, issues, 'Use the bytes matching the document asset hash; the source document remains unchanged.', `/assets/${asset.id}/hash`)
      sources[asset.id] = placeholderDataUri(asset.id)
      continue
    }
    if (asset.byteLength > 0 && asset.byteLength !== bytes.length) {
      addAssetIssue(document, asset.id, 'ASSET_PAYLOAD_MISSING', `Asset ${asset.id} byteLength does not match the supplied bytes.`, issues, 'Use the complete asset payload declared by the document.', `/assets/${asset.id}/byteLength`)
      sources[asset.id] = placeholderDataUri(asset.id)
      continue
    }
    sources[asset.id] = `data:${asset.mimeType};base64,${toBase64(bytes)}`
  }
  return sources
}

function addAssetIssue(document: PpteDocument, assetId: string, code: 'ASSET_PAYLOAD_MISSING' | 'ASSET_HASH_MISMATCH', message: string, issues: ValidationIssue[], recovery: string, path = `/assets/${assetId}`): void {
  const references = document.slideOrder.flatMap((slideId) => Object.values(document.slides[slideId]?.elements ?? {}).filter((element) => (element.type === 'image' && element.assetId === assetId) || (element.type === 'component' && element.fallback.kind === 'asset' && element.fallback.assetId === assetId)).map((element) => ({ slideId, elementId: element.id })))
  if (!references.length) {
    issues.push(withErrorSemantics({ code, severity: 'error', message, elementId: assetId, path, recovery }))
    return
  }
  for (const reference of references) issues.push(withErrorSemantics({ code, severity: 'error', message, slideId: reference.slideId, elementId: reference.elementId, path, recovery }))
}

function collectFontIssues(document: PpteDocument, fontBytes: Record<string, Uint8Array> | undefined, issues: ValidationIssue[]): void {
  for (const font of Object.values(document.fonts ?? {})) {
    if (font.source !== 'embedded') continue
    const bytes = fontBytes?.[font.id]
    if (!bytes) {
      issues.push(withErrorSemantics({ code: 'FONT_PAYLOAD_MISSING', severity: 'warning', message: `PPTX export did not receive embedded bytes for font ${font.family}; font-replacement risk is reported.`, elementId: font.id, path: `/fonts/${font.id}`, recovery: 'Provide the declared font payload or accept receiving-host substitution.' }))
      continue
    }
    if (font.hash && normalizeHash(font.hash) !== sha256HexBytes(bytes)) issues.push(withErrorSemantics({ code: 'FONT_HASH_MISMATCH', severity: 'warning', message: `PPTX export rejected bytes for font ${font.family}; font-replacement risk is reported.`, elementId: font.id, path: `/fonts/${font.id}/hash`, recovery: 'Provide bytes matching the declared font hash.' }))
  }
}

function buildFontCss(document: PpteDocument, fontBytes: Record<string, Uint8Array> | undefined, issues: ValidationIssue[]): string {
  const verifiedBytes: Record<string, Uint8Array> = {}
  for (const font of Object.values(document.fonts ?? {})) {
    const bytes = fontBytes?.[font.id]
    if (font.source !== 'embedded') {
      if (bytes?.length) verifiedBytes[font.id] = bytes
      continue
    }
    if (!bytes) continue
    if (font.hash && normalizeHash(font.hash) !== sha256HexBytes(bytes)) continue
    verifiedBytes[font.id] = bytes
  }
  return referenceFontCss(document.fonts, verifiedBytes)
}

function addCapabilityWarnings(report: CapabilityReport, issues: ValidationIssue[]): void {
  for (const item of report.items) {
    if (!['unsupported', 'blocked', 'missing-source', 'font-replacement', 'layout-risk', 'rasterized', 'static'].includes(item.status)) continue
    issues.push(withErrorSemantics({ code: 'EXPORT_DEGRADED', severity: 'warning', message: `${item.id} exported with capability status ${item.status}.`, slideId: item.slideId, elementId: item.elementId, recovery: item.recovery ?? 'Inspect the capability report before publishing.' }))
  }
}

function finalizeReport(report: CapabilityReport, issues: ValidationIssue[], forceDegraded = false): CapabilityReport {
  const merged = dedupe([...report.issues, ...issues])
  const items = report.items.map((item) => {
    const related = merged.find((issue) => {
      if (['ASSET_PAYLOAD_MISSING', 'ASSET_HASH_MISMATCH'].includes(issue.code)) return issue.slideId === item.slideId && issue.elementId === item.elementId
      if (['FONT_PAYLOAD_MISSING', 'FONT_HASH_MISMATCH'].includes(issue.code)) return item.type === 'text' && (!issue.slideId || issue.slideId === item.slideId)
      return false
    })
    if (!related) return item
    const font = related.code.startsWith('FONT_')
    return { ...item, status: (font ? 'font-replacement' : 'missing-source') as CapabilityReport['items'][number]['status'], reason: related.message, recovery: related.recovery }
  })
  const summary = Object.fromEntries(Object.keys(report.summary).map((status) => [status, items.filter((item) => item.status === status).length])) as CapabilityReport['summary']
  return { ...report, ok: report.ok && !merged.some((issue) => issue.severity === 'error') && !items.some((item) => ['blocked', 'unsupported', 'missing-source'].includes(item.status)), degraded: report.degraded || forceDegraded || merged.length > 0 || items.some((item) => ['blocked', 'unsupported', 'missing-source', 'font-replacement', 'layout-risk', 'rasterized'].includes(item.status)), items, issues: merged, summary }
}

function contentTypes(slideCount: number, includeReport: boolean, chartCount = 0): string {
  const overrides = [
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>',
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
    '<Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>',
    '<Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    ...Array.from({ length: slideCount }, (_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`),
    ...Array.from({ length: chartCount }, (_, index) => `<Override PartName="/ppt/charts/chart${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`),
  ]
  if (includeReport) overrides.push('<Override PartName="/ppt/ppte/capability-report.json" ContentType="application/json"/>')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="svg" ContentType="image/svg+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="webp" ContentType="image/webp"/><Default Extension="json" ContentType="application/json"/>${overrides.join('')}</Types>`
}

function rootRelationships(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`
}

function coreProperties(document: PpteDocument, createdAt?: string): string {
  const now = escapeXml(createdAt ?? document.metadata.updatedAt ?? document.metadata.createdAt ?? '1970-01-01T00:00:00.000Z')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(document.metadata.title)}</dc:title><dc:creator>PPTe</dc:creator><cp:lastModifiedBy>PPTe</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`
}

function appProperties(slideCount: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>PPTe</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat><Slides>${slideCount}</Slides><Words>0</Words><Paragraphs>0</Paragraphs></Properties>`
}

function presentation(document: PpteDocument, slideCount: number, width: number, height: number): string {
  const slideIds = Array.from({ length: slideCount }, (_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="${DRAWING_NS}" xmlns:r="${REL_NS}" xmlns:p="${PPT_NS}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="${width}" cy="${height}" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr/><a:lvl1pPr marL="0" algn="l"><a:defRPr lang="en-US"/></a:lvl1pPr></p:defaultTextStyle></p:presentation>`
}

function presentationRelationships(slideCount: number): string {
  const slides = Array.from({ length: slideCount }, (_, index) => `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides}</Relationships>`
}

function slideMaster(width: number, height: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="${DRAWING_NS}" xmlns:r="${REL_NS}" xmlns:p="${PPT_NS}"><p:cSld name="Master"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/><a:chOff x="0" y="0"/><a:chExt cx="${width}" cy="${height}"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/></p:sldMaster>`
}

function slideMasterRelationships(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`
}

function slideLayout(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="${DRAWING_NS}" xmlns:r="${REL_NS}" xmlns:p="${PPT_NS}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
}

function slideLayoutRelationships(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`
}

function slide(width: number, height: number, number: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="${DRAWING_NS}" xmlns:r="${REL_NS}" xmlns:p="${PPT_NS}"><p:cSld name="Slide ${number}"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:pic><p:nvPicPr><p:cNvPr id="2" name="Slide image ${number}"/><p:cNvPicPr preferRelativeResize="0"/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
}

function slideRelationships(number: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/slide${number}.svg"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`
}

function theme(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="${DRAWING_NS}" name="PPTe"><a:themeElements><a:clrScheme name="PPTe"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="FFFFFF"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="14B8A6"/></a:accent2><a:accent3><a:srgbClr val="F97316"/></a:accent3><a:accent4><a:srgbClr val="8B5CF6"/></a:accent4><a:accent5><a:srgbClr val="64748B"/></a:accent5><a:accent6><a:srgbClr val="CBD5E1"/></a:accent6><a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="8B5CF6"/></a:folHlink></a:clrScheme><a:fontScheme name="PPTe"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="PPTe"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>`
}

function resolveTextFamily(value: unknown, document: PpteDocument): string | undefined {
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value : undefined
  const candidate = value as { kind?: string; value?: unknown; token?: string }
  return candidate.kind === 'value' && typeof candidate.value === 'string' ? candidate.value : candidate.kind === 'token' && typeof candidate.token === 'string' ? document.theme.tokens.fontFamilies[candidate.token] ?? candidate.token : undefined
}

function resolveTextColor(value: unknown, document: PpteDocument): string | undefined {
  const candidate = value && typeof value === 'object' ? value as { kind?: string; value?: unknown; token?: string } : undefined
  const color = candidate?.kind === 'value' ? candidate.value : candidate?.kind === 'token' && typeof candidate.token === 'string' ? document.theme.tokens.colors[candidate.token] ?? candidate.token : typeof value === 'string' ? value : undefined
  return typeof color === 'string' && /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/.test(color) ? color : undefined
}

function paintColor(value: unknown, document: PpteDocument): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const paint = value as { kind?: string; color?: unknown }
  if (paint.kind !== 'solid') return undefined
  return resolveTextColor(paint.color, document)
}

function strokeColor(value: unknown, document: PpteDocument): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const stroke = value as { color?: unknown }
  return resolveTextColor(stroke.color, document)
}

function shapePreset(shape: string | undefined): string {
  if (shape === 'rounded-rectangle') return 'roundRect'
  if (shape === 'ellipse') return 'ellipse'
  if (shape === 'triangle') return 'triangle'
  if (shape === 'diamond') return 'diamond'
  if (shape === 'chevron') return 'chevron'
  if (shape === 'line') return 'line'
  return 'rect'
}

function shapeFillXml(fill: string | Paint | undefined, stroke: string | undefined, documentOrOpacity: PpteDocument | number | undefined, opacity?: number, strokeOpacity?: number, strokeWidth?: number, strokeDash?: number[], lineCap?: Stroke['lineCap'], lineJoin?: Stroke['lineJoin']): string {
  const document = typeof documentOrOpacity === 'object' ? documentOrOpacity : undefined
  const nodeOpacity = typeof documentOrOpacity === 'number' ? documentOrOpacity : opacity
  const fillXml = fill
    ? typeof fill === 'object' && document ? paintXml(fill, document, nodeOpacity) : `<a:solidFill>${srgbColorXml(fill as string, nodeOpacity)}</a:solidFill>`
    : '<a:noFill/>'
  const lineAttributes = [
    strokeWidth === undefined ? '' : ` w="${emu(strokeWidth)}"`,
    lineCap ? ` cap="${lineCap === 'round' ? 'rnd' : lineCap === 'square' ? 'sq' : 'flat'}"` : '',
  ].join('')
  const dash = strokeDash?.length ? '<a:prstDash val="dash"/>' : ''
  const join = lineJoin === 'round' ? '<a:round/>' : lineJoin === 'bevel' ? '<a:bevel/>' : lineJoin === 'miter' ? '<a:miter lim="800000"/>' : ''
  const strokeXml = stroke ? `<a:ln${lineAttributes}><a:solidFill>${srgbColorXml(stroke, multiplyOpacity(strokeOpacity, nodeOpacity))}</a:solidFill>${dash}${join}</a:ln>` : '<a:ln><a:noFill/></a:ln>'
  return `${fillXml}${strokeXml}`
}

function colorValue(value: string): string {
  const normalized = value.replace('#', '').toUpperCase()
  return /^[0-9A-F]{6}(?:[0-9A-F]{2})?$/.test(normalized) ? normalized.slice(0, 6) : '1F2937'
}

function points100(value: number): number { return value * 0.75 * 100 }

function clamp01(value: number): number { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1)) }

function htmlWithCanvasSize(html: string, width: number, height: number, fontCss = ''): string {
  return `${fontCss}<style data-ppte-pptx-reference-size>html,body{width:${number(width)}px;height:${number(height)}px;margin:0;padding:0;overflow:hidden}</style>${html}`
}

function rasterizedSlideSvg(width: number, height: number, png: Uint8Array): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${number(width)}" height="${number(height)}" viewBox="0 0 ${number(width)} ${number(height)}"><image x="0" y="0" width="${number(width)}" height="${number(height)}" preserveAspectRatio="none" href="data:image/png;base64,${toBase64(png)}"/></svg>`
}

function extensionForMime(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  if (mimeType === 'image/svg+xml') return 'svg'
  return 'png'
}

function safeId(value: string): string { return value.replace(/[^A-Za-z0-9_-]/g, '_') }
function placeholderSvg(assetId: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="#F1F5F9"/><rect x="12" y="12" width="296" height="156" fill="none" stroke="#94A3B8" stroke-width="3"/><text x="24" y="92" font-family="Arial, sans-serif" font-size="16" fill="#475569">Asset unavailable: ${escapeXml(assetId)}</text></svg>`
}

function exportIssue(code: string, message: string, slideId?: string, elementId?: string): ValidationIssue {
  return withErrorSemantics({ code, severity: 'error', message, slideId, elementId, recovery: 'Keep the semantic source, resolve the reported mapping or asset, and export again.' })
}

function renderFailureSvg(width: number, height: number, slideId: string): string {
  const seed = [...slideId].reduce((sum, character) => sum + character.codePointAt(0)!, 0) % 4
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${number(width)}" height="${number(height)}" viewBox="0 0 ${number(width)} ${number(height)}"><rect width="100%" height="100%" fill="#F8FAFC"/><rect x="32" y="32" width="${number(Math.max(0, width - 64))}" height="${number(Math.max(0, height - 64))}" fill="none" stroke="#CBD5E1" stroke-width="4"/><path d="M${number(width / 2 - 64)} ${number(height / 2 - 48)}h128v96H${number(width / 2 - 64)}z" fill="#E2E8F0"/><path d="m${number(width / 2 - 42 + seed * 8)} ${number(height / 2 + 24)} 24-24 20 18 22-30 34 36" fill="none" stroke="#64748B" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}

function placeholderDataUri(assetId: string): string {
  return `data:image/svg+xml;base64,${toBase64(text(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#E2E8F0"/><path d="M4 24 12 16 17 21 22 14 28 24" fill="none" stroke="#64748B" stroke-width="2"/><text x="4" y="10" font-family="Arial" font-size="5" fill="#475569">${escapeXml(assetId.slice(0, 18))}</text></svg>`))}`
}

function normalizeHash(hash: string | undefined): string | undefined {
  if (!hash) return undefined
  return (hash.startsWith('sha256-') ? hash.slice(7) : hash).toLowerCase()
}

function toBase64(data: Uint8Array): string {
  let value = ''
  const chunk = 0x8000
  for (let index = 0; index < data.length; index += chunk) value += String.fromCharCode(...data.subarray(index, Math.min(index + chunk, data.length)))
  return btoa(value)
}

function emu(value: number): number { return Math.max(1, Math.round(value * 9525)) }
function number(value: number): string { return String(Math.round(value * 1000) / 1000) }
function text(value: string): Uint8Array { return new TextEncoder().encode(value) }
function escapeXml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;') }
function dedupe(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = `${issue.code}|${issue.message}|${issue.slideId ?? ''}|${issue.elementId ?? ''}|${issue.path ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).map(withErrorSemantics)
}
