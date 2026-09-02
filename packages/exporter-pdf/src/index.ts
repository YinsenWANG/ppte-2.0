import { deflateSync } from 'node:zlib'
import { canonicalRevision } from '../../canonical-json/src/index.js'
import { buildCapabilityReport } from '../../capability/src/index.js'
import { validateDocument, type Element, type Paint, type PpteDocument, type ValidationIssue } from '../../schema/src/index.js'
import { withErrorSemantics } from '../../schema/src/errors.js'
import { textContent } from '../../validation/src/index.js'

export interface PdfExportOptions {
  pageWidth?: number
  pageHeight?: number
  includeNotes?: boolean
}

export interface PdfExportResult {
  ok: boolean
  format: 'pdf'
  bytes: Uint8Array
  pageCount: number
  degraded: boolean
  capabilityReport: ReturnType<typeof buildCapabilityReport>
  issues: ValidationIssue[]
}

export interface PngExportOptions {
  slideId?: string
  width?: number
  height?: number
  transparent?: boolean
}

export interface PngExportResult {
  ok: boolean
  format: 'png'
  bytes: Uint8Array
  pageCount: 1
  degraded: boolean
  capabilityReport: ReturnType<typeof buildCapabilityReport>
  issues: ValidationIssue[]
}

export function exportPdf(document: PpteDocument, options: PdfExportOptions = {}): PdfExportResult {
  const report = buildCapabilityReport(document, 'pdf', { sourceRevision: canonicalRevision(document) })
  const issues = [...report.issues]
  const structuralIssues = validateDocument(document, { runtimeSubset: false }).filter((issue) => issue.severity === 'error')
  issues.push(...structuralIssues)
  for (const item of report.items.filter((entry) => ['unsupported', 'font-replacement', 'missing-source', 'layout-risk'].includes(entry.status))) issues.push({ code: 'EXPORT_DEGRADED', severity: 'warning', message: `${item.id} exported with capability status ${item.status}.`, slideId: item.slideId, elementId: item.elementId, recovery: item.recovery ?? 'Inspect the capability report before publishing.' })
  const pageWidth = positive(options.pageWidth ?? document.canvas.width, 960)
  const pageHeight = positive(options.pageHeight ?? pageWidth * document.canvas.height / Math.max(document.canvas.width, 1), 540)
  const pdf = buildPdf(document, pageWidth, pageHeight, issues, options.includeNotes === true)
  return { ok: structuralIssues.length === 0, format: 'pdf', bytes: pdf, pageCount: document.slideOrder.length, degraded: report.degraded || issues.some((issue) => issue.code === 'EXPORT_DEGRADED'), capabilityReport: report, issues: dedupe(issues) }
}

export function exportPdfBytes(document: PpteDocument, options: PdfExportOptions = {}): Uint8Array { return exportPdf(document, options).bytes }
export const exportPdfDocument = exportPdf

export function exportPng(document: PpteDocument, options: PngExportOptions = {}): PngExportResult {
  const report = buildCapabilityReport(document, 'png', { sourceRevision: canonicalRevision(document) })
  const structuralIssues = validateDocument(document, { runtimeSubset: false }).filter((issue) => issue.severity === 'error')
  const slideId = options.slideId ?? document.slideOrder[0]
  const slide = slideId ? document.slides[slideId] : undefined
  const width = Math.max(1, Math.min(4096, Math.round(options.width ?? document.canvas.width)))
  const height = Math.max(1, Math.min(4096, Math.round(options.height ?? document.canvas.height)))
  const issues: ValidationIssue[] = [...report.issues, ...structuralIssues]
  for (const element of Object.values(slide?.elements ?? {})) if (element.type === 'text' || element.type === 'image') issues.push({ code: 'EXPORT_DEGRADED', severity: 'warning', message: `${element.id} is represented by the deterministic PNG baseline renderer.`, slideId, elementId: element.id, recovery: 'Use the PDF/reference renderer for full semantic text and image fidelity.' })
  const bytes = encodePng(width, height, rasterBaseline(document, slide, width, height, options.transparent === true))
  return { ok: structuralIssues.length === 0 && Boolean(slide), format: 'png', bytes, pageCount: 1, degraded: true, capabilityReport: report, issues: dedupe(issues) }
}

export function exportPngBytes(document: PpteDocument, options: PngExportOptions = {}): Uint8Array { return exportPng(document, options).bytes }

function buildPdf(document: PpteDocument, width: number, height: number, issues: ValidationIssue[], includeNotes: boolean): Uint8Array {
  const objects: string[] = []
  const pageRefs = document.slideOrder.map((_, index) => 3 + index * 2)
  const contentRefs = document.slideOrder.map((_, index) => 4 + index * 2)
  const fontRef = 3 + document.slideOrder.length * 2
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`
  document.slideOrder.forEach((slideId, index) => {
    objects[pageRefs[index]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNumber(width)} ${pdfNumber(height)}] /Resources << /Font << /F1 ${fontRef} 0 R >> >> /Contents ${contentRefs[index]} 0 R >>`
    const content = pdfContent(document, document.slides[slideId], width, height, issues, includeNotes)
    objects[contentRefs[index]] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  })
  objects[fontRef] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  const chunks: Uint8Array[] = [new TextEncoder().encode('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n')]
  const offsets = new Array(objects.length).fill(0) as number[]
  let offset = chunks[0].length
  for (let index = 1; index < objects.length; index += 1) {
    const bytes = new TextEncoder().encode(`${index} 0 obj\n${objects[index]}\nendobj\n`)
    offsets[index] = offset
    chunks.push(bytes)
    offset += bytes.length
  }
  const xrefOffset = offset
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let index = 1; index < objects.length; index += 1) xref += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  xref += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  chunks.push(new TextEncoder().encode(xref))
  return concat(chunks)
}

function pdfContent(document: PpteDocument, slide: PpteDocument['slides'][string], width: number, height: number, issues: ValidationIssue[], includeNotes: boolean): string {
  const sx = width / document.canvas.width
  const sy = height / document.canvas.height
  const commands = [`q ${pdfNumber(sx)} 0 0 ${pdfNumber(-sy)} 0 ${pdfNumber(height)} cm`, `${pdfColor(paintColor(slide?.background ?? document.canvas.defaultBackground, document), issues)} rg 0 0 ${pdfNumber(document.canvas.width)} ${pdfNumber(document.canvas.height)} re f`]
  for (const elementId of slide?.rootOrder ?? []) {
    const element = slide.elements[elementId]
    if (!element || element.visible === false) continue
    const { x, y, width: elementWidth, height: elementHeight } = element.frame
    if (element.type === 'shape') {
      const shapePaint: Paint = element.style.overrides?.fill ?? { kind: 'solid', color: { kind: 'value', value: '#64748b' as `#${string}` } }
      const color = paintColor(shapePaint, document)
      commands.push(`${pdfColor(color, issues)} rg ${pdfNumber(x)} ${pdfNumber(y)} ${pdfNumber(elementWidth)} ${pdfNumber(elementHeight)} re f`)
    } else if (element.type === 'image') {
      commands.push('0.82 0.85 0.89 rg', `${pdfNumber(x)} ${pdfNumber(y)} ${pdfNumber(elementWidth)} ${pdfNumber(elementHeight)} re f`, `BT /F1 10 Tf 1 0 0 -1 ${pdfNumber(x + 4)} ${pdfNumber(y + 16)} Tm (${escapePdf('[image]')}) Tj ET`)
    } else if (element.type === 'text') {
      const fontSize = typeof element.style.overrides?.fontSize === 'number' ? element.style.overrides.fontSize : 18
      const value = toPdfText(textContent(element), issues, element.id)
      const color = element.style.overrides?.color ? colorValue(element.style.overrides.color, document) : '#111827'
      commands.push(`${pdfColor(color, issues)} rg`, `BT /F1 ${pdfNumber(fontSize)} Tf 1 0 0 -1 ${pdfNumber(x)} ${pdfNumber(y + fontSize)} Tm (${escapePdf(value)}) Tj ET`)
    } else {
      commands.push('0.75 0.75 0.75 rg', `${pdfNumber(x)} ${pdfNumber(y)} ${pdfNumber(elementWidth)} ${pdfNumber(elementHeight)} re f`, `BT /F1 10 Tf 1 0 0 -1 ${pdfNumber(x + 4)} ${pdfNumber(y + 16)} Tm (${escapePdf('[unsupported element]')}) Tj ET`)
    }
  }
  if (includeNotes && slide?.notes) {
    const notes = toPdfText([slide.notes.speaker, slide.notes.handout].filter(Boolean).join(' — '), issues, `${slide.id}:notes`)
    if (notes) commands.push('0.25 0.28 0.34 rg', `BT /F1 8 Tf 1 0 0 -1 8 ${pdfNumber(document.canvas.height - 8)} Tm (${escapePdf(notes)}) Tj ET`)
  }
  commands.push('Q')
  return commands.join('\n')
}

function toPdfText(value: string, issues: ValidationIssue[], elementId: string): string {
  let replaced = false
  const result = [...value].map((character) => { const code = character.codePointAt(0) ?? 0; if (code < 32 || code > 126) { replaced = true; return '?' } return character }).join('')
  if (replaced) issues.push({ code: 'EXPORT_DEGRADED', severity: 'warning', message: `Text ${elementId} contains glyphs outside the baseline PDF font encoding.`, elementId, recovery: 'Embed a PDF-capable font in a later export profile.' })
  return result
}

function paintColor(paint: Paint, document: PpteDocument): string {
  if (paint.kind === 'solid') {
    if (typeof paint.color === 'string') return paint.color
    if (paint.color.kind === 'value') return paint.color.value
    return document.theme.tokens.colors[paint.color.token] ?? '#ffffff'
  }
  return '#ffffff'
}
function colorValue(value: string | { kind: 'value'; value: string } | { kind: 'token'; token: string }, document: PpteDocument): string {
  if (typeof value === 'string') return value
  return value.kind === 'value' ? value.value : document.theme.tokens.colors[value.token] ?? '#111827'
}
function pdfColor(value: string, issues: ValidationIssue[]): string {
  const match = /^#([0-9a-f]{6})$/i.exec(value)
  if (!match) { issues.push({ code: 'EXPORT_DEGRADED', severity: 'warning', message: `Color ${value} was replaced by a baseline PDF color.` }); return '0.5 0.5 0.5' }
  return [0, 2, 4].map((index) => pdfNumber(parseInt(match[1].slice(index, index + 2), 16) / 255)).join(' ')
}
function escapePdf(value: string): string { return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)') }
function pdfNumber(value: number): string { return String(Math.round(value * 1000) / 1000) }
function positive(value: number, fallback: number): number { return Number.isFinite(value) && value > 0 ? value : fallback }

function rasterBaseline(document: PpteDocument, slide: PpteDocument['slides'][string] | undefined, width: number, height: number, transparent: boolean): Uint8Array {
  const pixels = new Uint8Array(width * height * 4)
  const background = hexRgb(paintColor(slide?.background ?? document.canvas.defaultBackground, document))
  for (let index = 0; index < pixels.length; index += 4) { pixels[index] = background[0]; pixels[index + 1] = background[1]; pixels[index + 2] = background[2]; pixels[index + 3] = transparent ? 0 : 255 }
  for (const elementId of slide?.rootOrder ?? []) {
    const element = slide?.elements[elementId]
    if (!element || element.visible === false || element.type !== 'shape') continue
    const shapePaint: Paint = element.style.overrides?.fill ?? { kind: 'solid', color: { kind: 'value', value: '#64748b' as `#${string}` } }
    const color = hexRgb(paintColor(shapePaint, document))
    fillRect(pixels, width, height, Math.round(element.frame.x / document.canvas.width * width), Math.round(element.frame.y / document.canvas.height * height), Math.round(element.frame.width / document.canvas.width * width), Math.round(element.frame.height / document.canvas.height * height), color)
  }
  return pixels
}
function hexRgb(value: string): [number, number, number] { const match = /^#([0-9a-f]{6})$/i.exec(value); return match ? [parseInt(match[1].slice(0, 2), 16), parseInt(match[1].slice(2, 4), 16), parseInt(match[1].slice(4, 6), 16)] : [128, 128, 128] }
function fillRect(pixels: Uint8Array, width: number, height: number, x: number, y: number, rectWidth: number, rectHeight: number, color: [number, number, number]) { for (let row = Math.max(0, y); row < Math.min(height, y + rectHeight); row += 1) for (let column = Math.max(0, x); column < Math.min(width, x + rectWidth); column += 1) { const index = (row * width + column) * 4; pixels[index] = color[0]; pixels[index + 1] = color[1]; pixels[index + 2] = color[2]; pixels[index + 3] = 255 } }
function encodePng(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const scanlines = new Uint8Array(height * (width * 4 + 1))
  for (let row = 0; row < height; row += 1) { scanlines[row * (width * 4 + 1)] = 0; scanlines.set(pixels.slice(row * width * 4, (row + 1) * width * 4), row * (width * 4 + 1) + 1) }
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const header = new Uint8Array(13); view(header).setUint32(0, width); view(header).setUint32(4, height); header[8] = 8; header[9] = 6
  return concat([signature, pngChunk('IHDR', header), pngChunk('IDAT', new Uint8Array(deflateSync(scanlines))), pngChunk('IEND', new Uint8Array())])
}
function pngChunk(type: string, data: Uint8Array): Uint8Array { const typeBytes = new TextEncoder().encode(type); const output = new Uint8Array(12 + data.length); view(output).setUint32(0, data.length); output.set(typeBytes, 4); output.set(data, 8); view(output).setUint32(8 + data.length, crc32(concat([typeBytes, data]))); return output }
function view(data: Uint8Array): DataView { return new DataView(data.buffer, data.byteOffset, data.byteLength) }
function crc32(data: Uint8Array): number { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) } return (crc ^ 0xffffffff) >>> 0 }
function concat(parts: Uint8Array[]): Uint8Array { const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length } return result }
function dedupe(issues: ValidationIssue[]): ValidationIssue[] { const seen = new Set<string>(); return issues.filter((issue) => { const key = `${issue.code}|${issue.message}|${issue.elementId ?? ''}`; if (seen.has(key)) return false; seen.add(key); return true }).map(withErrorSemantics) }
