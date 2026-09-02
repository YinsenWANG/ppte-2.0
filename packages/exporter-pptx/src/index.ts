import { canonicalRevision, sha256HexBytes } from '../../canonical-json/src/index.js'
import { buildCapabilityReport, type CapabilityReport } from '../../capability/src/index.js'
import { writeStoredZip, readStoredZip, type StoredZipEntry } from '../../archive/src/index.js'
import { renderSlideSvg } from '../../renderer-react/src/index.js'
import { validateDocument, type PpteDocument, type ValidationIssue } from '../../schema/src/index.js'
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
  const entries = [...readStoredZip(data).keys()].sort()
  const slideCount = entries.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry)).length
  return { valid: entries.includes('[Content_Types].xml') && entries.includes('ppt/presentation.xml') && slideCount > 0, slideCount, entries, hasCapabilityReport: entries.includes('ppt/ppte/capability-report.json') }
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

function finalizeReport(report: CapabilityReport, issues: ValidationIssue[]): CapabilityReport {
  const merged = dedupe([...report.issues, ...issues])
  return { ...report, ok: report.ok && !merged.some((issue) => issue.severity === 'error'), degraded: true, issues: merged }
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
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="svg" ContentType="image/svg+xml"/><Default Extension="json" ContentType="application/json"/>${overrides.join('')}</Types>`
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
