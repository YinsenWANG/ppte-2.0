import { deflateSync } from 'node:zlib'
import { canonicalRevision, sha256HexBytes } from '../../canonical-json/src/index.js'
import { buildCapabilityReport, type CapabilityReport } from '../../capability/src/index.js'
import { renderSlideHtml } from '../../renderer-react/src/index.js'
import { validateDocument, type Element, type PpteDocument, type ValidationIssue } from '../../schema/src/index.js'
import { withErrorSemantics } from '../../schema/src/errors.js'
import { referenceFontCss, referencePdfPages, referencePngPage, renderReferencePdf, renderReferencePng } from './reference-render.js'

export interface PdfExportOptions {
  pageWidth?: number
  pageHeight?: number
  includeNotes?: boolean
  /** Required when the document references local image payloads. */
  assetBytes?: Record<string, Uint8Array>
  /** Optional embedded font payloads keyed by FontAsset id. */
  fontBytes?: Record<string, Uint8Array>
}

export interface PdfExportResult {
  ok: boolean
  format: 'pdf'
  bytes: Uint8Array
  pageCount: number
  degraded: boolean
  capabilityReport: CapabilityReport
  issues: ValidationIssue[]
}

export interface PngExportOptions {
  slideId?: string
  width?: number
  height?: number
  transparent?: boolean
  assetBytes?: Record<string, Uint8Array>
  fontBytes?: Record<string, Uint8Array>
}

export interface PngExportResult {
  ok: boolean
  format: 'png'
  bytes: Uint8Array
  pageCount: 1
  degraded: boolean
  capabilityReport: CapabilityReport
  issues: ValidationIssue[]
}

/**
 * Print the same Reference HTML that the Host displays. Chromium owns text
 * shaping, image decoding, opacity, transforms, charts, and widget fallbacks;
 * this package only supplies a deterministic page shell and reports limits.
 */
export function exportPdf(document: PpteDocument, options: PdfExportOptions = {}): PdfExportResult {
  const sourceRevision = canonicalRevision(document)
  const report = buildCapabilityReport(document, 'pdf', { sourceRevision })
  const structuralIssues = validateDocument(document, { runtimeSubset: false }).filter((issue) => issue.severity === 'error')
  const issues: ValidationIssue[] = [...report.issues, ...structuralIssues]
  const assetSources = buildAssetSources(document, options.assetBytes, issues)
  const fontCss = buildFontCss(document, options.fontBytes, issues)
  const pageWidth = positive(options.pageWidth ?? document.canvas.width, 960)
  const pageHeight = positive(options.pageHeight ?? pageWidth * document.canvas.height / Math.max(document.canvas.width, 1), 540)
  const pages = document.slideOrder.map((slideId) => {
    try {
      const slide = document.slides[slideId]
      const slideHtml = renderSlideHtml(document, slideId, { assetSources, editable: false, includeHostControls: false })
      const notes = options.includeNotes === true && slide?.notes
        ? `<aside data-ppte-export-notes style="position:absolute;left:0;right:0;bottom:0;box-sizing:border-box;padding:12px 20px;background:#ffffffee;color:#334155;font:14px/1.35 sans-serif;white-space:pre-wrap">${escapeHtml([slide.notes.speaker, slide.notes.handout].filter(Boolean).join(' — '))}</aside>`
        : ''
      return `${slideHtml}${notes}`
    } catch (cause) {
      issues.push(exportIssue('EXPORT_SLIDE_FAILED', `Slide ${slideId} could not be materialized for PDF: ${cause instanceof Error ? cause.message : String(cause)}`, slideId))
      return failedSlideHtml(slideId)
    }
  })
  let bytes: Uint8Array
  let browserSucceeded = true
  try {
    const html = referencePdfPages(pages, document.canvas.width, document.canvas.height, pageWidth, pageHeight, fontCss)
    bytes = renderReferencePdf(html, pageWidth, pageHeight)
  } catch (cause) {
    browserSucceeded = false
    issues.push(exportIssue('EXPORT_RENDERER_FAILED', `Reference PDF rendering failed: ${cause instanceof Error ? cause.message : String(cause)}`))
    bytes = blankPdf(pageWidth, pageHeight, Math.max(1, pages.length))
  }
  addCapabilityWarnings(report, issues)
  const capabilityReport = finalizeReport(report, issues)
  const finalIssues = dedupe(issues)
  const hasBlockingCapability = report.items.some((item) => item.status === 'blocked' || item.status === 'unsupported')
  const hasExportError = finalIssues.some((issue) => issue.severity === 'error')
  const hasStructuralError = structuralIssues.length > 0 || report.issues.some((issue) => issue.severity === 'error')
  return {
    ok: browserSucceeded && document.slideOrder.length > 0 && !hasStructuralError && !hasBlockingCapability && !hasExportError,
    format: 'pdf',
    bytes,
    pageCount: document.slideOrder.length,
    degraded: capabilityReport.degraded || finalIssues.length > 0 || !browserSucceeded,
    capabilityReport,
    issues: finalIssues,
  }
}

export function exportPdfBytes(document: PpteDocument, options: PdfExportOptions = {}): Uint8Array { return exportPdf(document, options).bytes }
export const exportPdfDocument = exportPdf

/** Rasterize the Reference HTML to a deterministic 8-bit RGBA PNG. */
export function exportPng(document: PpteDocument, options: PngExportOptions = {}): PngExportResult {
  const sourceRevision = canonicalRevision(document)
  const report = buildCapabilityReport(document, 'png', { sourceRevision })
  const structuralIssues = validateDocument(document, { runtimeSubset: false }).filter((issue) => issue.severity === 'error')
  const slideId = options.slideId ?? document.slideOrder[0]
  const slide = slideId ? document.slides[slideId] : undefined
  const width = Math.max(1, Math.min(4096, Math.round(options.width ?? document.canvas.width)))
  const height = Math.max(1, Math.min(4096, Math.round(options.height ?? document.canvas.height)))
  const issues: ValidationIssue[] = [...report.issues, ...structuralIssues]
  const assetSources = buildAssetSources(document, options.assetBytes, issues)
  const fontCss = buildFontCss(document, options.fontBytes, issues)
  for (const element of Object.values(slide?.elements ?? {})) {
    if (element.type === 'text' || element.type === 'image' || element.type === 'chart' || element.type === 'component') issues.push(withErrorSemantics({ code: 'EXPORT_DEGRADED', severity: 'warning', message: `${element.id} is rasterized by the Reference Renderer into PNG.`, slideId, elementId: element.id, recovery: 'Use the semantic Document as the editable source of truth.' }))
  }
  let bytes: Uint8Array
  let browserSucceeded = true
  try {
    const slideHtml = renderSlideHtml(document, slideId ?? '', { assetSources, editable: false, includeHostControls: false })
    const html = `${slideHtml}${lowResolutionTextInk(document, slide, width, height)}`
    bytes = renderReferencePng(referencePngPage(html, document.canvas.width, document.canvas.height, width, height, fontCss, options.transparent === true), width, height, { transparent: options.transparent === true })
  } catch (cause) {
    browserSucceeded = false
    issues.push(exportIssue('EXPORT_RENDERER_FAILED', `Reference PNG rendering failed: ${cause instanceof Error ? cause.message : String(cause)}`, slideId))
    bytes = blankPng(width, height, options.transparent === true)
  }
  addCapabilityWarnings(report, issues)
  const capabilityReport = finalizeReport(report, issues)
  const finalIssues = dedupe(issues)
  const hasBlockingCapability = report.items.some((item) => item.status === 'blocked' || item.status === 'unsupported')
  const hasStructuralError = structuralIssues.length > 0 || report.issues.some((issue) => issue.severity === 'error')
  return {
    ok: browserSucceeded && Boolean(slide) && !hasStructuralError && !hasBlockingCapability,
    format: 'png',
    bytes,
    pageCount: 1,
    degraded: true,
    capabilityReport,
    issues: finalIssues,
  }
}

export function exportPngBytes(document: PpteDocument, options: PngExportOptions = {}): Uint8Array { return exportPng(document, options).bytes }

function buildAssetSources(document: PpteDocument, bytesById: Record<string, Uint8Array> | undefined, issues: ValidationIssue[]): Record<string, string> {
  const sources: Record<string, string> = {}
  const referencedAssetIds = new Set<string>()
  for (const slideId of document.slideOrder) for (const element of Object.values(document.slides[slideId]?.elements ?? {})) {
    if (element.type === 'image') referencedAssetIds.add(element.assetId)
    if (element.type === 'component' && element.fallback.kind === 'asset' && element.fallback.assetId) referencedAssetIds.add(element.fallback.assetId)
  }
  for (const assetId of referencedAssetIds) {
    const asset = document.assets[assetId]
    if (!asset) continue
    const bytes = bytesById?.[assetId]
    if (!bytes) {
      addAssetIssue(document, asset.id, 'ASSET_PAYLOAD_MISSING', `Reference export did not receive bytes for asset ${asset.id}; a neutral white fallback surface is used.`, issues, 'Pass assetBytes for a faithful self-contained export.')
      sources[asset.id] = missingAssetDataUri()
      continue
    }
    const digest = sha256HexBytes(bytes)
    if (normalizeHash(asset.hash) !== digest || (asset.byteLength > 0 && bytes.length !== asset.byteLength)) {
      addAssetIssue(document, asset.id, 'ASSET_HASH_MISMATCH', `Reference export rejected bytes for asset ${asset.id}; a neutral white fallback surface is used.`, issues, 'Pass the exact bytes matching the document asset hash.')
      sources[asset.id] = missingAssetDataUri()
      continue
    }
    sources[asset.id] = `data:${asset.mimeType};base64,${toBase64(bytes)}`
  }
  return sources
}

function addAssetIssue(document: PpteDocument, assetId: string, code: 'ASSET_PAYLOAD_MISSING' | 'ASSET_HASH_MISMATCH', message: string, issues: ValidationIssue[], recovery: string): void {
  const references = document.slideOrder.flatMap((slideId) => Object.values(document.slides[slideId]?.elements ?? {}).filter((element) => (element.type === 'image' && element.assetId === assetId) || (element.type === 'component' && element.fallback.kind === 'asset' && element.fallback.assetId === assetId)).map((element) => ({ slideId, elementId: element.id })))
  if (!references.length) {
    issues.push(withErrorSemantics({ code, severity: 'warning', message, elementId: assetId, path: `/assets/${assetId}`, recovery }))
    return
  }
  for (const reference of references) issues.push(withErrorSemantics({ code, severity: 'warning', message, slideId: reference.slideId, elementId: reference.elementId, path: `/assets/${assetId}`, recovery }))
}

/**
 * At thumbnail sizes a browser can anti-alias every glyph away. Keep one
 * source-colour ink pixel per text box only for genuinely tiny previews;
 * normal-size output remains a direct Reference Renderer capture.
 */
function lowResolutionTextInk(document: PpteDocument, slide: PpteDocument['slides'][string] | undefined, width: number, height: number): string {
  if (!slide || width >= document.canvas.width / 8 || height >= document.canvas.height / 8) return ''
  const markers: string[] = []
  for (const elementId of slide.rootOrder) {
    const element = slide.elements[elementId]
    if (!element) continue
    if (element.type !== 'text' || element.visible === false || !element.content.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text))) continue
    const x = Math.max(0, Math.min(width - 1, Math.floor(element.frame.x / document.canvas.width * width) + 2))
    const y = Math.max(0, Math.min(height - 1, Math.floor(element.frame.y / document.canvas.height * height) + 1))
    const color = textInkColor(document, element)
    if (!color) continue
    markers.push(`<i data-ppte-lowres-ink="${escapeHtml(element.id)}" style="position:absolute;z-index:3;left:${x}px;top:${y}px;width:1px;height:1px;background:${color}"></i>`)
  }
  return markers.join('')
}

function textInkColor(document: PpteDocument, element: Extract<Element, { type: 'text' }>): string | undefined {
  const preset = document.theme.presets.text[element.style.styleRef] ?? {}
  const style = { ...preset, ...(element.style.overrides ?? {}) } as { color?: unknown }
  const firstRun = element.content.paragraphs.flatMap((paragraph) => paragraph.runs).find((run) => run.text)
  return resolveColor(firstRun?.marks?.color ?? style.color, document)
}

function resolveColor(value: unknown, document: PpteDocument): string | undefined {
  const candidate = value && typeof value === 'object' ? value as { kind?: string; value?: unknown; token?: string } : undefined
  const resolved = candidate?.kind === 'value'
    ? candidate.value
    : candidate?.kind === 'token' && typeof candidate.token === 'string'
      ? document.theme.tokens.colors[candidate.token] ?? candidate.token
      : typeof value === 'string' ? value : undefined
  return typeof resolved === 'string' && /^#[0-9A-Fa-f]{6}$/.test(resolved) ? resolved : undefined
}

function buildFontCss(document: PpteDocument, fontBytes: Record<string, Uint8Array> | undefined, issues: ValidationIssue[]): string {
  const verifiedBytes: Record<string, Uint8Array> = {}
  for (const font of Object.values(document.fonts ?? {})) {
    const bytes = fontBytes?.[font.id]
    if (font.source !== 'embedded') {
      if (bytes?.length) verifiedBytes[font.id] = bytes
      continue
    }
    if (!bytes) {
      issues.push(withErrorSemantics({ code: 'FONT_PAYLOAD_MISSING', severity: 'warning', message: `Reference export could not embed font ${font.family}; the browser fallback is reported.`, elementId: font.id, path: `/fonts/${font.id}`, recovery: 'Pass fontBytes for the declared embedded FontAsset.' }))
      continue
    }
    if (font.hash && normalizeHash(font.hash) !== sha256HexBytes(bytes)) {
      issues.push(withErrorSemantics({ code: 'FONT_HASH_MISMATCH', severity: 'warning', message: `Reference export rejected bytes for font ${font.family}; the browser fallback is reported.`, elementId: font.id, path: `/fonts/${font.id}/hash`, recovery: 'Pass the exact bytes matching the document font hash.' }))
      continue
    }
    verifiedBytes[font.id] = bytes
  }
  return referenceFontCss(document.fonts, verifiedBytes)
}

function addCapabilityWarnings(report: CapabilityReport, issues: ValidationIssue[]): void {
  for (const item of report.items) {
    if (['unsupported', 'blocked', 'missing-source', 'font-replacement', 'layout-risk', 'rasterized', 'static'].includes(item.status)) issues.push(withErrorSemantics({ code: 'EXPORT_DEGRADED', severity: 'warning', message: `${item.id} exported with capability status ${item.status}.`, slideId: item.slideId, elementId: item.elementId, recovery: item.recovery ?? 'Inspect the capability report before publishing.' }))
  }
}

function finalizeReport(report: CapabilityReport, issues: ValidationIssue[]): CapabilityReport {
  const merged = dedupe([...report.issues, ...issues])
  const items = report.items.map((item) => {
    const related = merged.find((issue) => {
      if (['ASSET_PAYLOAD_MISSING', 'ASSET_HASH_MISMATCH'].includes(issue.code)) return issue.elementId === item.elementId && issue.slideId === item.slideId
      if (['FONT_PAYLOAD_MISSING', 'FONT_HASH_MISMATCH'].includes(issue.code)) return item.type === 'text' && (!issue.slideId || issue.slideId === item.slideId)
      return false
    })
    if (!related) return item
    const font = related.code.startsWith('FONT_')
    return { ...item, status: (font ? 'font-replacement' : 'missing-source') as CapabilityReport['items'][number]['status'], reason: related.message, recovery: related.recovery }
  })
  const summary = Object.fromEntries(Object.keys(report.summary).map((status) => [status, items.filter((item) => item.status === status).length])) as CapabilityReport['summary']
  return { ...report, ok: report.ok && !merged.some((issue) => issue.severity === 'error') && !items.some((item) => ['blocked', 'unsupported', 'missing-source'].includes(item.status)), degraded: report.degraded || merged.length > 0 || items.some((item) => ['blocked', 'unsupported', 'missing-source', 'font-replacement', 'layout-risk', 'rasterized'].includes(item.status)), items, issues: merged, summary }
}

function failedSlideHtml(slideId: string): string {
  return `<div class="ppte-slide" data-ppte-export-failed="true" style="position:relative;box-sizing:border-box;width:100%;height:100%;padding:48px;background:#F8FAFC;color:#475569;font:28px/1.35 Arial,sans-serif"><div>Slide unavailable</div><div style="margin-top:12px;font-size:18px">${escapeHtml(slideId)}</div></div>`
}

function blankPdf(width: number, height: number, requestedPageCount = 1): Uint8Array {
  const pageCount = Math.max(1, Math.floor(requestedPageCount))
  const objects: string[] = ['', '<< /Type /Catalog /Pages 2 0 R >>', '']
  const pageRefs: number[] = []
  for (let index = 0; index < pageCount; index += 1) {
    const pageRef = objects.length
    const contentRef = pageRef + 1
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNumber(width)} ${pdfNumber(height)}] /Contents ${contentRef} 0 R >>`)
    objects.push('<< /Length 3 >>\nstream\nq Q\nendstream')
    pageRefs.push(pageRef)
  }
  objects[2] = `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(' ')}] /Count ${pageCount} >>`
  const parts: Uint8Array[] = [new TextEncoder().encode('%PDF-1.4\n')]
  const offsets = new Array(objects.length).fill(0) as number[]
  let offset = parts[0]!.length
  for (let index = 1; index < objects.length; index += 1) {
    const bytes = new TextEncoder().encode(`${index} 0 obj\n${objects[index]}\nendobj\n`)
    offsets[index] = offset
    parts.push(bytes)
    offset += bytes.length
  }
  const xrefOffset = offset
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let index = 1; index < objects.length; index += 1) xref += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  xref += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  parts.push(new TextEncoder().encode(xref))
  return concat(parts)
}

function blankPng(width: number, height: number, transparent: boolean): Uint8Array {
  const pixels = new Uint8Array(width * height * 4)
  for (let index = 0; index < pixels.length; index += 4) { pixels[index] = 248; pixels[index + 1] = 250; pixels[index + 2] = 252; pixels[index + 3] = transparent ? 0 : 255 }
  return encodePng(width, height, pixels)
}

function encodePng(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const scanlines = new Uint8Array(height * (width * 4 + 1))
  for (let row = 0; row < height; row += 1) { scanlines[row * (width * 4 + 1)] = 0; scanlines.set(pixels.slice(row * width * 4, (row + 1) * width * 4), row * (width * 4 + 1) + 1) }
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const header = new Uint8Array(13)
  new DataView(header.buffer).setUint32(0, width)
  new DataView(header.buffer).setUint32(4, height)
  header[8] = 8
  header[9] = 6
  return concat([signature, pngChunk('IHDR', header), pngChunk('IDAT', new Uint8Array(deflateSync(scanlines))), pngChunk('IEND', new Uint8Array())])
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const output = new Uint8Array(12 + data.length)
  new DataView(output.buffer).setUint32(0, data.length)
  output.set(typeBytes, 4)
  output.set(data, 8)
  new DataView(output.buffer).setUint32(8 + data.length, crc32(concat([typeBytes, data])))
  return output
}

function crc32(data: Uint8Array): number { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) } return (crc ^ 0xffffffff) >>> 0 }
function normalizeHash(hash: string | undefined): string | undefined { return hash ? (hash.startsWith('sha256-') ? hash.slice(7) : hash).toLowerCase() : undefined }
function placeholderDataUri(assetId: string): string { return `data:image/svg+xml;base64,${toBase64(new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#E2E8F0"/><path d="M4 24 12 16 17 21 22 14 28 24" fill="none" stroke="#64748B" stroke-width="2"/><text x="4" y="10" font-family="Arial" font-size="5" fill="#475569">${escapeHtml(assetId.slice(0, 18))}</text></svg>`))}` }
function missingAssetDataUri(): string { return `data:image/svg+xml;base64,${toBase64(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="#FFFFFF"/></svg>'))}` }
function exportIssue(code: string, message: string, slideId?: string, elementId?: string): ValidationIssue { return withErrorSemantics({ code, severity: 'error', message, slideId, elementId, recovery: 'Keep the semantic source, resolve the reported export issue, and export again.' }) }
function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;') }
function toBase64(data: Uint8Array): string { let value = ''; const chunk = 0x8000; for (let offset = 0; offset < data.length; offset += chunk) value += String.fromCharCode(...data.subarray(offset, Math.min(offset + chunk, data.length))); return btoa(value) }
function positive(value: number, fallback: number): number { return Number.isFinite(value) && value > 0 ? value : fallback }
function pdfNumber(value: number): string { return String(Math.round(value * 1000) / 1000) }
function concat(parts: Uint8Array[]): Uint8Array { const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length } return result }
function dedupe(issues: ValidationIssue[]): ValidationIssue[] { const seen = new Set<string>(); return issues.filter((issue) => { const key = `${issue.code}|${issue.message}|${issue.slideId ?? ''}|${issue.elementId ?? ''}|${issue.path ?? ''}`; if (seen.has(key)) return false; seen.add(key); return true }).map(withErrorSemantics) }
