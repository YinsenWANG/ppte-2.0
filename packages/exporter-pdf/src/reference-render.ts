import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { deflateSync, inflateSync } from 'node:zlib'
import type { FontAsset } from '../../schema/src/index.js'

/**
 * The public exporters are synchronous because the semantic/runtime APIs are
 * synchronous.  Browser rendering is therefore isolated in a short-lived
 * child process.  The child owns Playwright and returns only the finished
 * artifact; no browser object or DOM leaks into the semantic packages.
 */
export function renderReferencePng(html: string, width: number, height: number, options: { fontCss?: string; transparent?: boolean } = {}): Uint8Array {
  const transparent = options.transparent === true
  const rendered = runBrowser({ mode: 'png', html: withReferenceCss(html, width, height, false, 1, 1, options.fontCss, transparent), width, height, transparent })
  return normalizeRgbaPng(rendered)
}

export function renderReferencePdf(html: string, width: number, height: number, options: { fontCss?: string } = {}): Uint8Array {
  return runBrowser({ mode: 'pdf', html: withReferenceCss(html, width, height, true, 1, 1, options.fontCss), width, height })
}

/** Convert a reference slide into a fixed-size page for a PNG capture. */
export function referencePngPage(html: string, sourceWidth: number, sourceHeight: number, width: number, height: number, fontCss = '', transparent = false): string {
  const sx = width / Math.max(1, sourceWidth)
  const sy = height / Math.max(1, sourceHeight)
  return withReferenceCss(`<div data-ppte-reference-page>${html}</div>`, width, height, false, sx, sy, fontCss, transparent)
}

/** Compose multiple already-derived reference slides into print pages. */
export function referencePdfPages(pages: string[], sourceWidth: number, sourceHeight: number, width: number, height: number, fontCss = ''): string {
  const sx = width / Math.max(1, sourceWidth)
  const sy = height / Math.max(1, sourceHeight)
  const body = pages.map((page) => `<section class="ppte-print-page"><div data-ppte-reference-page>${page}</div></section>`).join('')
  return withReferenceCss(body, width, height, true, sx, sy, fontCss)
}

/** Build deterministic @font-face declarations for fonts supplied by a host. */
export function referenceFontCss(fonts: Record<string, FontAsset> | undefined, fontBytes: Record<string, Uint8Array> | undefined): string {
  const declarations: string[] = []
  for (const font of Object.values(fonts ?? {}).sort((left, right) => left.id.localeCompare(right.id))) {
    const bytes = fontBytes?.[font.id]
    if (!bytes?.length) continue
    const format = fontFormat(font.path)
    const mime = fontMime(font.path)
    declarations.push(`@font-face{font-family:${cssString(font.family)};font-style:${font.style};font-weight:${font.weight};font-display:block;src:url(data:${mime};base64,${toBase64(bytes)}) format(${cssString(format)});}`)
  }
  return declarations.length ? `<style data-ppte-export-fonts>${declarations.join('')}</style>` : ''
}

function runBrowser(request: { mode: 'png' | 'pdf'; html: string; width: number; height: number; transparent?: boolean }): Uint8Array {
  let playwrightEntry: string
  try {
    playwrightEntry = createRequire(import.meta.url).resolve('playwright')
  } catch (cause) {
    throw new Error(`EXPORT_RENDERER_UNAVAILABLE: Playwright is required for Reference Renderer export. ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', BROWSER_WORKER], {
    cwd: process.cwd(),
    input: JSON.stringify({ ...request, playwrightEntry }),
    maxBuffer: 512 * 1024 * 1024,
  })
  const stdout = Buffer.isBuffer(child.stdout) ? child.stdout.toString('utf8') : String(child.stdout ?? '')
  const stderr = Buffer.isBuffer(child.stderr) ? child.stderr.toString('utf8') : String(child.stderr ?? '')
  if (child.error || child.status !== 0) throw new Error(`EXPORT_RENDERER_FAILED: ${stderr || child.error?.message || `child status ${child.status}`}`)
  try {
    const result = JSON.parse(stdout) as { bytes?: string; error?: string }
    if (!result.bytes) throw new Error(result.error ?? 'browser returned no artifact')
    return new Uint8Array(Buffer.from(result.bytes, 'base64'))
  } catch (cause) {
    throw new Error(`EXPORT_RENDERER_PROTOCOL: ${cause instanceof Error ? cause.message : String(cause)}${stderr ? `; ${stderr}` : ''}`)
  }
}

function withReferenceCss(html: string, width: number, height: number, print: boolean, sx: number, sy: number, fontCss = '', transparent = false): string {
  const transform = sx === 1 && sy === 1 ? '' : `[data-ppte-reference-page]>.ppte-slide{transform:scale(${number(sx)},${number(sy)});transform-origin:top left}`
  const transparentCss = transparent ? '.ppte-slide{background:transparent!important}' : ''
  const printCss = print
    ? `html,body{height:auto;overflow:visible}@page{size:${number(width)}px ${number(height)}px;margin:0}.ppte-print-page{position:relative;width:${number(width)}px;height:${number(height)}px;overflow:hidden;break-after:page;page-break-after:always}.ppte-print-page:last-child{break-after:auto;page-break-after:auto}`
    : ''
  return `${fontCss}<style data-ppte-export-style>html,body{margin:0;padding:0;width:${number(width)}px;height:${number(height)}px;overflow:hidden;background:${transparent ? 'transparent' : '#fff'};-webkit-print-color-adjust:exact;print-color-adjust:exact}body{font-synthesis:none}[data-ppte-reference-page]{position:relative;width:${number(width)}px;height:${number(height)}px;overflow:hidden}${transparentCss}${transform}${printCss}</style>${html}`
}

const BROWSER_WORKER = String.raw`
import { readFileSync } from 'node:fs'
const request = JSON.parse(readFileSync(0, 'utf8'))
try {
  const playwright = await import(request.playwrightEntry)
  const { chromium } = playwright.default ?? playwright
  const browser = await chromium.launch({ headless: true, args: ['--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text'] })
  try {
    const page = await browser.newPage({ viewport: { width: Math.max(1, Math.ceil(request.width)), height: Math.max(1, Math.ceil(request.height)) }, deviceScaleFactor: 1, locale: 'zh-CN', colorScheme: 'light', reducedMotion: 'reduce' })
    await page.setContent(request.html, { waitUntil: 'load' })
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all(Array.from(document.images).map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => { image.addEventListener('load', resolve, { once: true }); image.addEventListener('error', resolve, { once: true }) })))
    })
    const bytes = request.mode === 'pdf'
      ? await page.pdf({ width: request.width + 'px', height: request.height + 'px', printBackground: true, preferCSSPageSize: true, margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' } })
      : await page.screenshot({ type: 'png', omitBackground: request.transparent === true, clip: { x: 0, y: 0, width: Math.max(1, request.width), height: Math.max(1, request.height) }, animations: 'disabled' })
    process.stdout.write(JSON.stringify({ bytes: Buffer.from(bytes).toString('base64') }))
  } finally {
    await browser.close()
  }
} catch (error) {
  process.stderr.write(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
}
`

function normalizeRgbaPng(bytes: Uint8Array): Uint8Array {
  const decoded = decodePng(bytes)
  return encodePng(decoded.width, decoded.height, decoded.pixels)
}

function decodePng(bytes: Uint8Array): { width: number; height: number; pixels: Uint8Array } {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length < 33 || !signature.every((value, index) => bytes[index] === value)) throw new Error('EXPORT_RENDERER_FAILED: browser returned an invalid PNG.')
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat: Uint8Array[] = []
  while (offset + 12 <= bytes.length) {
    const length = readU32(bytes, offset)
    if (length > bytes.length - offset - 12) throw new Error('EXPORT_RENDERER_FAILED: PNG chunk exceeds the artifact.')
    const type = new TextDecoder().decode(bytes.slice(offset + 4, offset + 8))
    const data = bytes.slice(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = readU32(data, 0)
      height = readU32(data, 4)
      bitDepth = data[8] ?? 0
      colorType = data[9] ?? 0
      interlace = data[12] ?? 0
    }
    if (type === 'IDAT') idat.push(data)
    offset += length + 12
    if (type === 'IEND') break
  }
  if (!width || !height || bitDepth !== 8 || interlace !== 0 || ![2, 6].includes(colorType)) throw new Error(`EXPORT_RENDERER_FAILED: unsupported browser PNG (${width}x${height}, depth ${bitDepth}, type ${colorType}, interlace ${interlace}).`)
  const channels = colorType === 6 ? 4 : 3
  const rowBytes = width * channels
  const raw = inflateSync(concat(idat))
  const pixels = new Uint8Array(width * height * 4)
  let rawOffset = 0
  let previous = new Uint8Array(rowBytes)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset++]
    const row = new Uint8Array(raw.slice(rawOffset, rawOffset + rowBytes))
    rawOffset += rowBytes
    if (row.length !== rowBytes) throw new Error('EXPORT_RENDERER_FAILED: truncated browser PNG row.')
    for (let x = 0; x < row.length; x += 1) {
      const left = x >= channels ? row[x - channels] ?? 0 : 0
      const up = previous[x] ?? 0
      const upperLeft = x >= channels ? previous[x - channels] ?? 0 : 0
      if (filter === 1) row[x] = (row[x] + left) & 0xff
      else if (filter === 2) row[x] = (row[x] + up) & 0xff
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 0xff
      else if (filter === 4) row[x] = (row[x] + paeth(left, up, upperLeft)) & 0xff
      else if (filter !== 0) throw new Error(`EXPORT_RENDERER_FAILED: unsupported browser PNG filter ${filter}.`)
    }
    for (let x = 0; x < width; x += 1) {
      const source = x * channels
      const target = (y * width + x) * 4
      pixels[target] = row[source] ?? 0
      pixels[target + 1] = row[source + 1] ?? 0
      pixels[target + 2] = row[source + 2] ?? 0
      pixels[target + 3] = colorType === 6 ? row[source + 3] ?? 255 : 255
    }
    previous = row
  }
  return { width, height, pixels }
}

function encodePng(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const scanlines = new Uint8Array(height * (width * 4 + 1))
  for (let row = 0; row < height; row += 1) {
    scanlines[row * (width * 4 + 1)] = 0
    scanlines.set(pixels.slice(row * width * 4, (row + 1) * width * 4), row * (width * 4 + 1) + 1)
  }
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

function readU32(data: Uint8Array, offset: number): number { return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset) }
function paeth(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upperLeftDistance = Math.abs(estimate - upperLeft)
  return leftDistance <= upDistance && leftDistance <= upperLeftDistance ? left : upDistance <= upperLeftDistance ? up : upperLeft
}
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.length }
  return result
}
function toBase64(data: Uint8Array): string {
  let value = ''
  const chunk = 0x8000
  for (let offset = 0; offset < data.length; offset += chunk) value += String.fromCharCode(...data.subarray(offset, Math.min(offset + chunk, data.length)))
  return btoa(value)
}
function cssString(value: string): string { return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'` }
function fontFormat(path: string | undefined): string { return path?.toLowerCase().endsWith('.woff2') ? 'woff2' : path?.toLowerCase().endsWith('.woff') ? 'woff' : path?.toLowerCase().endsWith('.otf') ? 'opentype' : 'truetype' }
function fontMime(path: string | undefined): string { return path?.toLowerCase().endsWith('.woff2') ? 'font/woff2' : path?.toLowerCase().endsWith('.woff') ? 'font/woff' : path?.toLowerCase().endsWith('.otf') ? 'font/otf' : 'font/ttf' }
function number(value: number): string { return String(Math.round(value * 100000) / 100000) }
