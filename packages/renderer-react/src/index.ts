import { canonicalHash, canonicalJsonString } from '../../canonical-json/src/index.js'
import type {
  Element,
  ImageElement,
  Paint,
  PpteDocument,
  Shadow,
  ShapeElement,
  Stroke,
  TextElement,
  TextStyle,
  ValueOrToken,
} from '../../schema/src/index.js'

export interface RenderOptions {
  assetSources?: Record<string, string>
  includeDiagnostics?: boolean
}

export interface VisualDiffScope {
  elementIds?: string[]
  semanticKeys?: string[]
}

export interface TargetedVisualDiff {
  slideId: string
  beforeHtmlHash: string
  afterHtmlHash: string
  changed: boolean
  changedElementIds: string[]
  targetChangedElementIds: string[]
  nonTargetChangedElementIds: string[]
}

/**
 * Reference renderer output is derived from the semantic snapshot. It is a
 * string adapter for the contract deck; an editor may mount the same
 * primitives into React/DOM without making that tree a document source.
 */
export function renderSlideHtml(document: PpteDocument, slideId: string, options: RenderOptions = {}): string {
  const slide = document.slides[slideId]
  if (!slide) throw new Error(`SLIDE_MISSING: ${slideId}`)
  const background = paintCss(slide.background ?? document.canvas.defaultBackground, document)
  const children = slide.rootOrder
    .map((elementId) => slide.elements[elementId])
    .filter((element): element is Element => Boolean(element) && element.visible !== false)
    .map((element) => renderElement(document, element, options))
    .join('')
  const diagnostics = options.includeDiagnostics ? `<meta data-ppte-revision="${escapeAttr(JSON.stringify(document.schemaVersion))}">` : ''
  const strategy = slide.visualStrategy ?? 'structured'
  const strategyData = strategy === 'structured' ? '' : ` data-ppte-visual-strategy="${escapeAttr(strategy)}"`
  return `<div class="ppte-slide" data-ppte-slide-id="${escapeAttr(slide.id)}" data-ppte-type="slide"${strategyData} style="position:relative;overflow:hidden;width:${number(document.canvas.width)}du;height:${number(document.canvas.height)}du;background:${background}">${diagnostics}${children}</div>`
}

export function renderDocumentHtml(document: PpteDocument, options: RenderOptions = {}): string {
  return document.slideOrder.map((slideId) => renderSlideHtml(document, slideId, options)).join('\n')
}

/** Compare the deterministic reference-render surface while reporting target leakage by semantic object. */
export function renderTargetedVisualDiff(before: PpteDocument, after: PpteDocument, slideId: string, scope: VisualDiffScope = {}): TargetedVisualDiff {
  const beforeHtml = renderSlideHtml(before, slideId)
  const afterHtml = renderSlideHtml(after, slideId)
  const beforeUnits = visualUnits(before, slideId)
  const afterUnits = visualUnits(after, slideId)
  const keys = [...new Set([...beforeUnits.keys(), ...afterUnits.keys()])].sort()
  const changedElementIds: string[] = []
  const targetChangedElementIds: string[] = []
  const nonTargetChangedElementIds: string[] = []
  for (const key of keys) {
    const left = beforeUnits.get(key)
    const right = afterUnits.get(key)
    if (canonicalHash(left?.html ?? null) === canonicalHash(right?.html ?? null)) continue
    const elementId = right?.elementId ?? left?.elementId
    if (!elementId) continue
    changedElementIds.push(elementId)
    const isTarget = (!scope.elementIds?.length && !scope.semanticKeys?.length) || Boolean(scope.elementIds?.includes(elementId) || right?.semanticKey && scope.semanticKeys?.includes(right.semanticKey) || left?.semanticKey && scope.semanticKeys?.includes(left.semanticKey))
    ;(isTarget ? targetChangedElementIds : nonTargetChangedElementIds).push(elementId)
  }
  return {
    slideId,
    beforeHtmlHash: `sha256-${canonicalHash(beforeHtml)}`,
    afterHtmlHash: `sha256-${canonicalHash(afterHtml)}`,
    changed: beforeHtml !== afterHtml,
    changedElementIds: [...new Set(changedElementIds)],
    targetChangedElementIds: [...new Set(targetChangedElementIds)],
    nonTargetChangedElementIds: [...new Set(nonTargetChangedElementIds)],
  }
}

export function renderTextPlain(element: TextElement): string {
  return element.content.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n')
}

function renderElement(document: PpteDocument, element: Element, options: RenderOptions): string {
  const frame = `left:${number(element.frame.x)}du;top:${number(element.frame.y)}du;width:${number(element.frame.width)}du;height:${number(element.frame.height)}du;opacity:${number(element.opacity ?? 1)};transform:rotate(${number(element.rotationDeg ?? 0)}deg);transform-origin:center center;`
  let rendered: string
  if (element.type === 'text') rendered = renderText(document, element, frame)
  else if (element.type === 'image') rendered = renderImage(document, element, frame, options)
  else if (element.type === 'shape') rendered = renderShape(document, element, frame)
  else throw new Error(`UNSUPPORTED_ELEMENT_TYPE: ${element.type}`)
  return element.appearStep === undefined ? rendered : rendered.replace(/^<(\w+)/, `<$1 data-ppte-appear-step="${number(element.appearStep)}"`)
}

function visualUnits(document: PpteDocument, slideId: string): Map<string, { elementId: string; semanticKey?: string; html: string }> {
  const slide = document.slides[slideId]
  if (!slide) throw new Error(`SLIDE_MISSING: ${slideId}`)
  return new Map(slide.rootOrder.map((elementId) => slide.elements[elementId]).filter((element): element is Element => Boolean(element) && element.visible !== false).map((element) => {
    const key = element.semanticKey ? `semantic:${element.semanticKey}` : `element:${element.id}`
    let html: string
    try { html = renderElement(document, element, {}) } catch { html = `<unsupported data-ppte-element-id="${escapeAttr(element.id)}" data-ppte-type="${escapeAttr(element.type)}">` }
    return [key, { elementId: element.id, ...(element.semanticKey ? { semanticKey: element.semanticKey } : {}), html }] as const
  }))
}

function renderText(document: PpteDocument, element: TextElement, frame: string): string {
  const preset = document.theme.presets.text[element.style.styleRef] ?? defaultTextStyle(document)
  const style = resolveStyle({ ...preset, ...element.style.overrides }, document) as TextStyle
  const padding = element.boxStyle?.padding
  const boxFill = element.boxStyle?.fill ? `background:${paintCss(element.boxStyle.fill, document)};` : ''
  const boxStroke = element.boxStyle?.stroke ? strokeCss(element.boxStyle.stroke, document) : ''
  const boxShadow = element.boxStyle?.shadow ? `box-shadow:${shadowCss(element.boxStyle.shadow, document)};` : ''
  const overflow = element.overflowPolicy === 'clip' || element.overflowPolicy === 'ellipsis' ? 'hidden' : 'visible'
  const box = [
    `position:absolute;${frame}`,
    `box-sizing:border-box;overflow:${overflow};${boxFill}${boxStroke}${boxShadow}`,
    element.boxStyle?.radius !== undefined ? `border-radius:${number(element.boxStyle.radius)}du;` : '',
    `font-family:${quoteCss(resolve(style.fontFamily, document, 'font.body'))};font-size:${number(style.fontSize)}du;font-weight:${number(style.fontWeight ?? 400)};`,
    `color:${resolveColor(style.color, document, '#111827')};line-height:${number(style.lineHeight ?? 1.2)};letter-spacing:${number(style.letterSpacing ?? 0)}du;`,
    `text-align:${element.paragraphStyle?.align ?? 'left'};`,
    padding ? `padding:${number(padding.top)}du ${number(padding.right)}du ${number(padding.bottom)}du ${number(padding.left)}du;` : '',
    `vertical-align:${style.verticalAlign ?? 'top'};direction:${style.direction ?? 'auto'};`,
  ].join('')
  const paragraphs = element.content.paragraphs.map((paragraph) => {
    const paragraphStyle = [
      paragraph.align ? `text-align:${paragraph.align};` : '',
      paragraph.spaceBefore !== undefined ? `margin-top:${number(paragraph.spaceBefore)}du;` : '',
      paragraph.spaceAfter !== undefined ? `margin-bottom:${number(paragraph.spaceAfter)}du;` : '',
    ].join('')
    const align = paragraphStyle ? ` style="${escapeAttr(paragraphStyle)}"` : ''
    const listPrefix = paragraph.list?.type === 'bullet' ? '• ' : paragraph.list?.type === 'number' ? '1. ' : ''
    const content = paragraph.runs.map((run) => renderRun(document, run.text, run.marks, style.color)).join('')
    const line = `${listPrefix}${content}`
    const paragraphTag = paragraph.list?.type === 'bullet' ? 'ul' : paragraph.list?.type === 'number' ? 'ol' : 'p'
    return paragraphTag === 'p'
      ? `<p data-ppte-paragraph-id="${escapeAttr(paragraph.id)}"${align}>${line}</p>`
      : `<${paragraphTag} data-ppte-paragraph-id="${escapeAttr(paragraph.id)}"${align}><li>${content}</li></${paragraphTag}>`
  }).join('')
  return `<div data-ppte-element-id="${escapeAttr(element.id)}" data-ppte-type="text" data-ppte-semantic-key="${escapeAttr(element.semanticKey ?? '')}" style="${box}">${paragraphs}</div>`
}

function renderRun(document: PpteDocument, text: string, marks: TextElement['content']['paragraphs'][number]['runs'][number]['marks'], fallbackColor: ValueOrToken<`#${string}`>): string {
  let result = escapeHtml(text)
  if (marks?.bold) result = `<strong>${result}</strong>`
  if (marks?.italic) result = `<em>${result}</em>`
  if (marks?.underline) result = `<u>${result}</u>`
  if (marks?.strike) result = `<s>${result}</s>`
  const color = marks?.color ? resolveColor(marks.color, document, resolveColor(fallbackColor, document, '#111827')) : undefined
  return color ? `<span style="color:${color}">${result}</span>` : result
}

function renderImage(document: PpteDocument, element: ImageElement, frame: string, options: RenderOptions): string {
  const asset = document.assets[element.assetId]
  if (!asset) throw new Error(`ASSET_MISSING: ${element.assetId}`)
  const source = options.assetSources?.[element.assetId] ?? asset.path
  const crop = element.crop
  const imageStyle = document.theme.presets.image[element.style?.styleRef ?? ''] ?? {}
  const style = resolveStyle({ ...imageStyle, ...(element.style?.overrides ?? {}) }, document) as Record<string, unknown>
  const focal = element.focalPoint ?? (crop ? { x: crop.x + crop.width / 2, y: crop.y + crop.height / 2 } : undefined)
  const imageCss = [
    'position:absolute;left:0;top:0;width:100%;height:100%;',
    `object-fit:${element.fit};`,
    focal ? `object-position:${number(focal.x * 100)}% ${number(focal.y * 100)}%;` : 'object-position:50% 50%;',
    crop ? `transform:scale(${number(1 / crop.width)},${number(1 / crop.height)});transform-origin:${number((crop.x + crop.width / 2) * 100)}% ${number((crop.y + crop.height / 2) * 100)}%;` : '',
  ].join('')
  const wrapper = [
    `position:absolute;${frame}overflow:hidden;border-radius:${number(asNumber(style.radius) ?? 0)}du;`,
    style.border ? strokeCss(style.border as Stroke, document, 'border') : '',
    style.shadow ? `box-shadow:${shadowCss(style.shadow as Shadow, document)};` : '',
  ].join('')
  const alt = element.altText ?? asset.altText ?? ''
  const cropData = crop ? ` data-ppte-crop="${escapeAttr([crop.x, crop.y, crop.width, crop.height].map(number).join(','))}"` : ''
  const artwork = element.role === 'artwork' ? asset.artwork : undefined
  const artworkData = artwork ? ` data-ppte-artwork="true" data-ppte-safe-text-regions="${escapeAttr(canonicalJsonString(artwork.safeTextRegions ?? []))}" data-ppte-avoid-text-regions="${escapeAttr(canonicalJsonString(artwork.avoidTextRegions ?? []))}" data-ppte-dominant-palette="${escapeAttr(canonicalJsonString(artwork.dominantPalette ?? []))}"${artwork.focalPoint ? ` data-ppte-focal-point="${escapeAttr(canonicalJsonString(artwork.focalPoint))}"` : ''}` : ''
  return `<div data-ppte-element-id="${escapeAttr(element.id)}" data-ppte-type="image" data-ppte-semantic-key="${escapeAttr(element.semanticKey ?? '')}"${cropData}${artworkData} style="${wrapper}"><img src="${escapeAttr(source)}" alt="${escapeAttr(alt)}" draggable="false" style="${imageCss}"></div>`
}

function renderShape(document: PpteDocument, element: ShapeElement, frame: string): string {
  const preset = document.theme.presets.shape[element.style.styleRef] ?? {}
  const style = resolveStyle({ ...preset, ...element.style.overrides }, document) as Record<string, unknown>
  const fillId = `ppte-fill-${safeId(element.id)}`
  const shadowId = `ppte-shadow-${safeId(element.id)}`
  const arrowId = `ppte-arrow-${safeId(element.id)}`
  const defs: string[] = []
  const fill = style.fill ? paintSvg(style.fill as Paint, document, fillId, defs) : 'none'
  const stroke = style.stroke as Stroke | undefined
  const strokeColor = stroke ? resolveColor(stroke.color, document, 'none') : 'none'
  const strokeWidth = stroke?.width ?? 0
  const shadow = style.shadow as Shadow | undefined
  if (shadow) defs.push(svgShadow(shadow, document, shadowId))
  if (element.shape === 'arrow') defs.push(svgArrowMarker(arrowId, strokeColor, strokeWidth))
  const common = `fill="${escapeAttr(fill)}" stroke="${escapeAttr(strokeColor)}" stroke-width="${number(strokeWidth)}"${stroke?.opacity !== undefined ? ` stroke-opacity="${number(stroke.opacity)}"` : ''}${stroke?.dash?.length ? ` stroke-dasharray="${escapeAttr(stroke.dash.map(number).join(' '))}"` : ''}${stroke?.lineCap ? ` stroke-linecap="${stroke.lineCap}"` : ''}${stroke?.lineJoin ? ` stroke-linejoin="${stroke.lineJoin}"` : ''}${shadow ? ` filter="url(#${shadowId})"` : ''}`
  let body: string
  if (element.shape === 'ellipse') body = `<ellipse cx="${number(element.frame.width / 2)}" cy="${number(element.frame.height / 2)}" rx="${number(element.frame.width / 2)}" ry="${number(element.frame.height / 2)}" ${common}/>`
  else if (element.shape === 'rectangle' || element.shape === 'rounded-rectangle') {
    const radius = element.shape === 'rounded-rectangle' ? Math.min(element.frame.width, element.frame.height) / 2 : 0
    const requestedRadius = asNumber(style.radius)
    body = `<rect x="0" y="0" width="${number(element.frame.width)}" height="${number(element.frame.height)}" rx="${number(Math.min(requestedRadius ?? radius, Math.min(element.frame.width, element.frame.height) / 2))}" ${common}/>`
  } else if (element.shape === 'line' || element.shape === 'arrow') body = `<line x1="0" y1="0" x2="${number(element.frame.width)}" y2="${number(element.frame.height)}" ${common}${element.shape === 'arrow' ? ` marker-end="url(#${arrowId})"` : ''}/>`
  else {
    const points = element.points?.length ? element.points.map((point) => `${number(point.x)},${number(point.y)}`).join(' ') : defaultPoints(element.shape, element.frame.width, element.frame.height)
    body = `<polygon points="${escapeAttr(points)}" ${common}/>`
  }
  const svgStyle = `position:absolute;${frame};overflow:visible;`
  return `<svg data-ppte-element-id="${escapeAttr(element.id)}" data-ppte-type="shape" data-ppte-semantic-key="${escapeAttr(element.semanticKey ?? '')}" viewBox="0 0 ${number(element.frame.width)} ${number(element.frame.height)}" style="${svgStyle}" aria-hidden="${element.role === 'decorative' ? 'true' : 'false'}">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${body}</svg>`
}

function defaultPoints(shape: ShapeElement['shape'], width: number, height: number): string {
  if (shape === 'triangle') return `${number(width / 2)},0 ${number(width)},${number(height)} 0,${number(height)}`
  if (shape === 'diamond') return `${number(width / 2)},0 ${number(width)},${number(height / 2)} ${number(width / 2)},${number(height)} 0,${number(height / 2)}`
  if (shape === 'chevron') return `0,0 ${number(width * 0.65)},0 ${number(width)},${number(height / 2)} ${number(width * 0.65)},${number(height)} 0,${number(height)} ${number(width * 0.35)},${number(height / 2)}`
  return `0,0 ${number(width)},0 ${number(width)},${number(height)} 0,${number(height)}`
}

function defaultTextStyle(document: PpteDocument): TextStyle {
  return { fontFamily: { kind: 'token', token: 'font.body' }, fontSize: 28, color: { kind: 'token', token: 'color.text.primary' }, lineHeight: 1.2 }
}
function resolve<T>(value: ValueOrToken<T> | T | undefined, document: PpteDocument, fallbackToken: string): T | string {
  if (value === undefined) return (tokenValue(document, fallbackToken) as T | undefined) ?? ''
  if (!value || typeof value !== 'object') return value as T
  const candidate = value as unknown as { kind?: string; value?: T; token?: string }
  if (candidate.kind === 'value') return candidate.value as T
  if (candidate.kind === 'token' && candidate.token) return (tokenValue(document, candidate.token) as T | undefined) ?? candidate.token
  return value as T
}
function resolveColor(value: ValueOrToken<`#${string}`> | `#${string}` | string | undefined, document: PpteDocument, fallback: string): string {
  const resolved = resolve(value, document, 'color.text.primary')
  return typeof resolved === 'string' && /^#[0-9A-Fa-f]{6,8}$/.test(resolved) ? resolved : fallback
}
function tokenValue(document: PpteDocument, token: string): string | number | Shadow | undefined {
  if (document.theme.tokens.colors[token]) return document.theme.tokens.colors[token]
  if (document.theme.tokens.fontFamilies[token]) return document.theme.tokens.fontFamilies[token]
  if (document.theme.tokens.fontSizes[token] !== undefined) return document.theme.tokens.fontSizes[token]
  if (document.theme.tokens.radii[token] !== undefined) return document.theme.tokens.radii[token]
  if (document.theme.tokens.shadows[token] !== undefined) return document.theme.tokens.shadows[token]
  return undefined
}
function resolveStyle(value: unknown, document: PpteDocument): unknown {
  if (Array.isArray(value)) return value.map((item) => resolveStyle(item, document))
  if (!value || typeof value !== 'object') return value
  const candidate = value as Record<string, unknown>
  if (candidate.kind === 'token' && typeof candidate.token === 'string') return tokenValue(document, candidate.token) ?? candidate.token
  if (candidate.kind === 'value' && Object.prototype.hasOwnProperty.call(candidate, 'value')) return resolveStyle(candidate.value, document)
  return Object.fromEntries(Object.entries(candidate).map(([key, child]) => [key, resolveStyle(child, document)]))
}
function paintCss(paint: Paint, document: PpteDocument): string {
  if (paint.kind === 'none') return 'transparent'
  if (paint.kind === 'solid') return paint.opacity === undefined ? resolveColor(paint.color, document, 'transparent') : cssColor(resolveColor(paint.color, document, 'transparent'), paint.opacity)
  return `linear-gradient(${number(paint.angleDeg)}deg,${paint.stops.map((stop) => `${resolveColor(stop.color, document, '#000000')} ${number(stop.offset * 100)}%`).join(',')})`
}
function paintSvg(paint: Paint, document: PpteDocument, id: string, defs: string[]): string {
  if (paint.kind === 'none') return 'none'
  if (paint.kind === 'solid') return paint.opacity === undefined ? resolveColor(paint.color, document, 'none') : cssColor(resolveColor(paint.color, document, 'none'), paint.opacity)
  const gradientId = `${id}-gradient`
  defs.push(`<linearGradient id="${escapeAttr(gradientId)}" gradientTransform="rotate(${number(paint.angleDeg)})">${paint.stops.map((stop) => `<stop offset="${number(stop.offset * 100)}%" stop-color="${escapeAttr(resolveColor(stop.color, document, '#000000'))}"/>`).join('')}</linearGradient>`)
  return `url(#${gradientId})`
}
function strokeCss(stroke: Stroke, document: PpteDocument, property = 'border'): string {
  const style = stroke.dash?.length ? 'dashed' : 'solid'
  return `${property}:${number(stroke.width)}du ${style} ${resolveColor(stroke.color, document, 'transparent')};${stroke.opacity === undefined ? '' : `${property}-opacity:${number(stroke.opacity)};`}`
}
function shadowCss(shadow: Shadow, document: PpteDocument): string {
  return `${number(shadow.offsetX)}du ${number(shadow.offsetY)}du ${number(shadow.blur)}du ${number(shadow.spread ?? 0)}du ${resolveColor(shadow.color, document, 'transparent')}`
}
function svgShadow(shadow: Shadow, document: PpteDocument, id: string): string {
  return `<filter id="${escapeAttr(id)}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${number(shadow.offsetX)}" dy="${number(shadow.offsetY)}" stdDeviation="${number(shadow.blur / 2)}"${shadow.spread === undefined ? '' : ` flood-opacity="${number(shadow.opacity ?? 1)}"`} flood-color="${escapeAttr(resolveColor(shadow.color, document, '#000000'))}"${shadow.opacity === undefined || shadow.spread !== undefined ? '' : ` flood-opacity="${number(shadow.opacity)}"`}/></filter>`
}
function svgArrowMarker(id: string, color: string, width: number): string {
  const size = Math.max(4, width * 3)
  return `<marker id="${escapeAttr(id)}" markerWidth="${number(size)}" markerHeight="${number(size)}" refX="${number(size - 1)}" refY="${number(size / 2)}" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L${number(size)},${number(size / 2)} L0,${number(size)} z" fill="${escapeAttr(color)}"/></marker>`
}
function cssColor(color: string, opacity: number): string {
  const match = /^#([0-9A-Fa-f]{6})$/.exec(color)
  if (!match) return color
  const hex = match[1]
  return `rgba(${parseInt(hex.slice(0, 2), 16)},${parseInt(hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)},${number(opacity)})`
}
function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
function safeId(value: string): string { return value.replace(/[^A-Za-z0-9_-]/g, '_') }
function number(value: number): string {
  if (!Number.isFinite(value)) throw new Error('RENDER_INVALID_NUMBER')
  return String(Math.round(value * 1000) / 1000)
}
function quoteCss(value: string): string { return `'${value.replace(/[^A-Za-z0-9 ,._-]/g, '')}'` }
function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;') }
function escapeAttr(value: string): string { return escapeHtml(value) }
