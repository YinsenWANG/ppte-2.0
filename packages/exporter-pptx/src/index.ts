import { canonicalRevision, sha256HexBytes } from '../../canonical-json/src/index.js'
import { buildCapabilityReport, type CapabilityReport } from '../../capability/src/index.js'
import { writeStoredZip, readStoredZip, type StoredZipEntry } from '../../archive/src/index.js'
import { renderSlideSvg } from '../../renderer-react/src/index.js'
import { renderChartSvg } from '../../charts/src/index.js'
import { validateDocument, type ChartElement, type Element, type PpteDocument, type ValidationIssue } from '../../schema/src/index.js'
import { withErrorSemantics } from '../../schema/src/errors.js'

const PPT_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'

export interface PptxExportOptions {
  /** Asset bytes are required for a self-contained image package. */
  assetBytes?: Record<string, Uint8Array>
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
  stroke?: string
  crop?: { x: number; y: number; width: number; height: number }
  posterAsArtwork?: boolean
}

export interface SemanticPptxSlide {
  slideId: string
  strategy: 'structured' | 'hybrid' | 'poster'
  nodes: SemanticPptxNode[]
  posterAsArtwork: boolean
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
 * Export every slide as one deterministic SVG image in an otherwise ordinary
 * OOXML presentation. The image boundary is deliberate: the semantic PPTe
 * snapshot and capability report remain the editable source of truth.
 */
export function exportImagePptx(document: PpteDocument, options: PptxExportOptions = {}): PptxExportResult {
  const sourceRevision = options.sourceRevision ?? canonicalRevision(document)
  const report = buildCapabilityReport(document, 'pptx-image', { sourceRevision })
  const structuralIssues = validateDocument(document, { runtimeSubset: false }).filter((issue) => issue.severity === 'error')
  const issues: ValidationIssue[] = [...report.issues, ...structuralIssues]
  const assetSources = buildAssetSources(document, options.assetBytes ?? {}, issues)
  const slideSvgs: string[] = []
  if (structuralIssues.length === 0) {
    for (const slideId of document.slideOrder) {
      try {
        slideSvgs.push(renderSlideSvg(document, slideId, { assetSources }))
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
          nodes: [artworkNode, ...semanticNodes(document, slideId, semanticElements, issues)],
        })
        if (!artwork) issues.push(exportIssue('POSTER_ARTWORK_MISSING', `Poster slide ${slideId} has no artwork Image element.`, slideId))
        continue
      }
      const nodes = semanticNodes(document, slideId, slide.rootOrder.map((elementId) => slide.elements[elementId]).filter((element): element is Element => Boolean(element) && element.visible !== false), issues)
      slides.push({ slideId, strategy, nodes, posterAsArtwork: false })
    }
  }
  const degraded = slides.some((slide) => slide.posterAsArtwork || slide.nodes.some((node) => node.kind === 'chart-svg' || node.kind === 'component-fallback' || node.fallbackLabel !== undefined))
  return { ok: !issues.some((issue) => issue.severity === 'error'), sourceRevision, slides, capabilityReport, issues, degraded }
}

export function exportSemanticPptx(document: PpteDocument, options: PptxExportOptions = {}): SemanticPptxExportResult {
  const compilation = compileSemanticPptx(document, options)
  const issues = [...compilation.issues]
  let bytes: Uint8Array<ArrayBufferLike> = new Uint8Array()
  if (compilation.slides.length === document.slideOrder.length && !issues.some((issue) => issue.severity === 'error')) {
    try {
      bytes = buildSemanticPptx(document, compilation, options, issues)
    } catch (cause) {
      issues.push(exportIssue('EXPORT_FAILED', cause instanceof Error ? cause.message : String(cause)))
    }
  }
  const capabilityReport = finalizeReport(compilation.capabilityReport, issues)
  const finalIssues = dedupe(issues)
  return { ok: bytes.length > 0 && !finalIssues.some((issue) => issue.severity === 'error') && capabilityReport.ok, format: 'pptx-semantic', bytes, slideCount: compilation.slides.length, degraded: compilation.degraded || finalIssues.length > 0, capabilityReport, compilation: { ...compilation, capabilityReport, issues: finalIssues, ok: !finalIssues.some((issue) => issue.severity === 'error'), degraded: compilation.degraded || finalIssues.length > 0 }, issues: finalIssues }
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
    return { id: `${slideId}:${element.id}`, sourceElementId: element.id, kind: 'text-box', frame: element.frame, text: element.content.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n'), fontSize: typeof style.fontSize === 'number' ? style.fontSize : undefined, fontFamily: resolveTextFamily(style.fontFamily, document), color: resolveTextColor(style.color, document), bold: typeof style.fontWeight === 'number' && style.fontWeight >= 600, align: element.paragraphStyle?.align }
  }
  if (element.type === 'image') return { id: `${slideId}:${element.id}`, sourceElementId: element.id, kind: 'picture', frame: element.frame, assetId: element.assetId, crop: element.crop }
  if (element.type === 'shape') {
    const preset = document.theme.presets.shape[element.style.styleRef] ?? {}
    const style = { ...preset, ...(element.style.overrides ?? {}) }
    return { id: `${slideId}:${element.id}`, sourceElementId: element.id, kind: 'shape', frame: element.frame, shape: element.shape, fill: paintColor(style.fill, document), stroke: strokeColor(style.stroke, document) }
  }
  if (element.type === 'chart') return { id: `${slideId}:${element.id}`, sourceElementId: element.id, kind: 'chart-svg', frame: element.frame, staticSvg: renderChartSvg(element, { width: element.frame.width, height: element.frame.height, runtimeProfile: 'ga-c' }) }
  if (element.type === 'component' && element.fallback.kind === 'asset' && element.fallback.assetId) return { id: `${slideId}:${element.id}`, sourceElementId: element.id, kind: 'picture', frame: element.frame, assetId: element.fallback.assetId, fallbackLabel: element.fallback.label ?? `${element.componentType} static fallback` }
  if (element.type === 'component') return { id: `${slideId}:${element.id}`, sourceElementId: element.id, kind: 'component-fallback', frame: element.frame, fallbackLabel: element.fallback.label ?? `${element.componentType} fallback` }
  return undefined
}

function buildSemanticPptx(document: PpteDocument, compilation: SemanticPptxCompilation, options: PptxExportOptions, issues: ValidationIssue[]): Uint8Array {
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
  const width = emu(document.canvas.width)
  const height = emu(document.canvas.height)
  const entries: StoredZipEntry[] = [
    { name: '[Content_Types].xml', data: text(contentTypes(compilation.slides.length, options.includeCapabilityReport !== false)) },
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
      const key = node.kind === 'chart-svg' ? `chart:${node.id}` : node.assetId ? `asset:${node.assetId}` : undefined
      if (key && media.has(key) && !relationIds.has(key)) relationIds.set(key, `rId${relationIndex++}`)
    }
    entries.push({ name: `ppt/slides/slide${number}.xml`, data: text(semanticSlide(width, height, slide, relationIds)) })
    entries.push({ name: `ppt/slides/_rels/slide${number}.xml.rels`, data: text(semanticSlideRelationships(slide, relationIds, media)) })
  }
  for (const item of [...media.values()].sort((left, right) => left.filename.localeCompare(right.filename))) entries.push({ name: `ppt/media/${item.filename}`, data: item.data })
  if (options.includeCapabilityReport !== false) entries.push({ name: 'ppt/ppte/capability-report.json', data: text(JSON.stringify(compilation.capabilityReport, null, 2)) })
  return writeStoredZip(entries)
}

function semanticSlide(width: number, height: number, slide: SemanticPptxSlide, relationIds: Map<string, string>): string {
  const nodes = slide.nodes.map((node, index) => semanticNodeXml(node, 2 + index, relationIds.get(node.kind === 'chart-svg' ? `chart:${node.id}` : node.assetId ? `asset:${node.assetId}` : ''))).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="${DRAWING_NS}" xmlns:r="${REL_NS}" xmlns:p="${PPT_NS}"><p:cSld name="${escapeXml(slide.slideId)}"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${nodes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
}

function semanticNodeXml(node: SemanticPptxNode, numericId: number, relationId?: string): string {
  const xfrm = `<a:xfrm><a:off x="${emu(node.frame.x)}" y="${emu(node.frame.y)}"/><a:ext cx="${emu(node.frame.width)}" cy="${emu(node.frame.height)}"/></a:xfrm>`
  if (node.kind === 'picture' && relationId) return `<p:pic><p:nvPicPr><p:cNvPr id="${numericId}" name="${escapeXml(node.sourceElementId ?? node.id)}"/><p:cNvPicPr preferRelativeResize="0"/><p:nvPr/></p:nvPicPr><p:blipFill>${node.crop ? `<a:srcRect l="${Math.round(node.crop.x * 100000)}" t="${Math.round(node.crop.y * 100000)}" r="${Math.round((1 - node.crop.x - node.crop.width) * 100000)}" b="${Math.round((1 - node.crop.y - node.crop.height) * 100000)}"/>` : ''}<a:blip r:embed="${relationId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
  if (node.kind === 'text-box') return semanticTextShape(node, numericId, xfrm, false)
  if (node.kind === 'component-fallback') return semanticTextShape(node, numericId, xfrm, true)
  if (node.kind === 'shape') return `<p:sp><p:nvSpPr><p:cNvPr id="${numericId}" name="${escapeXml(node.sourceElementId ?? node.id)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm}<a:prstGeom prst="${shapePreset(node.shape)}"><a:avLst/></a:prstGeom>${shapeFillXml(node.fill, node.stroke)}</p:spPr></p:sp>`
  if (node.kind === 'chart-svg' && relationId) return `<p:pic><p:nvPicPr><p:cNvPr id="${numericId}" name="${escapeXml(node.sourceElementId ?? node.id)}"/><p:cNvPicPr preferRelativeResize="0"/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relationId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
  return ''
}

function semanticTextShape(node: SemanticPptxNode, numericId: number, xfrm: string, fallback: boolean): string {
  const textValue = node.text ?? node.fallbackLabel ?? ''
  const fill = fallback ? '<a:solidFill><a:srgbClr val="F1F5F9"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="94A3B8"/></a:solidFill></a:ln>' : ''
  const fontSize = Math.max(100, Math.round((node.fontSize ?? 18) * 100))
  const color = colorValue(node.color ?? (fallback ? '#334155' : '#1F2937'))
  const align = node.align ? ` algn="${node.align === 'center' ? 'ctr' : node.align === 'right' ? 'r' : 'l'}"` : ''
  return `<p:sp><p:nvSpPr><p:cNvPr id="${numericId}" name="${escapeXml(node.sourceElementId ?? node.id)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p${align}><a:r><a:rPr lang="en-US" sz="${fontSize}"${node.bold ? ' b="1"' : ''}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${node.fontFamily ? `<a:latin typeface="${escapeXml(node.fontFamily)}"/>` : ''}</a:rPr><a:t>${escapeXml(textValue)}</a:t></a:r><a:endParaRPr lang="en-US" sz="${fontSize}"/></a:p></p:txBody></p:sp>`
}

function semanticSlideRelationships(slide: SemanticPptxSlide, relationIds: Map<string, string>, media: Map<string, { filename: string; data: Uint8Array }>): string {
  const relationships = [...relationIds.entries()].sort((left, right) => left[1].localeCompare(right[1])).map(([key, id]) => {
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
    document.slideOrder.flatMap((slideId) => Object.values(document.slides[slideId]?.elements ?? []).filter((element) => element.type === 'image').map((element) => element.assetId)),
  )
  for (const asset of Object.values(document.assets)) {
    if (!referencedAssetIds.has(asset.id)) continue
    const bytes = bytesById[asset.id]
    if (!bytes) {
      issues.push(withErrorSemantics({ code: 'ASSET_PAYLOAD_MISSING', severity: 'error', message: `Image PPTX export requires bytes for asset ${asset.id}.`, elementId: asset.id, path: `/assets/${asset.id}`, recovery: 'Provide assetBytes for every referenced asset, then export again.' }))
      sources[asset.id] = placeholderDataUri(asset.id)
      continue
    }
    const digest = `sha256-${sha256HexBytes(bytes)}`
    const expected = normalizeHash(asset.hash)
    if (expected && digest.slice('sha256-'.length) !== expected) {
      issues.push(withErrorSemantics({ code: 'ASSET_HASH_MISMATCH', severity: 'error', message: `Asset ${asset.id} bytes do not match the declared hash.`, elementId: asset.id, path: `/assets/${asset.id}/hash`, recovery: 'Use the bytes matching the document asset hash; the source document remains unchanged.' }))
      sources[asset.id] = placeholderDataUri(asset.id)
      continue
    }
    if (asset.byteLength > 0 && asset.byteLength !== bytes.length) {
      issues.push(withErrorSemantics({ code: 'ASSET_PAYLOAD_MISSING', severity: 'error', message: `Asset ${asset.id} byteLength does not match the supplied bytes.`, elementId: asset.id, path: `/assets/${asset.id}/byteLength`, recovery: 'Use the complete asset payload declared by the document.' }))
      sources[asset.id] = placeholderDataUri(asset.id)
      continue
    }
    sources[asset.id] = `data:${asset.mimeType};base64,${toBase64(bytes)}`
  }
  return sources
}

function finalizeReport(report: CapabilityReport, issues: ValidationIssue[], forceDegraded = false): CapabilityReport {
  const merged = dedupe([...report.issues, ...issues])
  return { ...report, ok: report.ok && !merged.some((issue) => issue.severity === 'error'), degraded: report.degraded || forceDegraded || merged.length > 0, issues: merged }
}

function contentTypes(slideCount: number, includeReport: boolean): string {
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
  return typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : undefined
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

function shapeFillXml(fill: string | undefined, stroke: string | undefined): string {
  const fillXml = fill ? `<a:solidFill><a:srgbClr val="${colorValue(fill)}"/></a:solidFill>` : '<a:noFill/>'
  const strokeXml = stroke ? `<a:ln><a:solidFill><a:srgbClr val="${colorValue(stroke)}"/></a:solidFill></a:ln>` : '<a:ln><a:noFill/></a:ln>'
  return `${fillXml}${strokeXml}`
}

function colorValue(value: string): string {
  const normalized = value.replace('#', '').toUpperCase()
  return /^[0-9A-F]{6}$/.test(normalized) ? normalized : '1F2937'
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
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${number(width)}" height="${number(height)}" viewBox="0 0 ${number(width)} ${number(height)}"><rect width="100%" height="100%" fill="#F8FAFC"/><rect x="32" y="32" width="${number(Math.max(0, width - 64))}" height="${number(Math.max(0, height - 64))}" fill="none" stroke="#CBD5E1" stroke-width="4"/><text x="64" y="96" fill="#475569" font-family="Arial, sans-serif" font-size="28">Slide image unavailable</text><text x="64" y="140" fill="#64748B" font-family="Arial, sans-serif" font-size="18">Source slide: ${escapeXml(slideId)}</text></svg>`
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
