import type {
  Element,
  ImageElement,
  Paint,
  PpteDocument,
  ShapeElement,
  TextElement,
  TextStyle,
  ValueOrToken,
} from '../../schema/src/index.js'

export interface RenderOptions {
  assetSources?: Record<string, string>
  includeDiagnostics?: boolean
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
  return `<div class="ppte-slide" data-ppte-slide-id="${escapeAttr(slide.id)}" data-ppte-type="slide" style="position:relative;overflow:hidden;width:${number(document.canvas.width)}du;height:${number(document.canvas.height)}du;background:${background}">${diagnostics}${children}</div>`
}

export function renderDocumentHtml(document: PpteDocument, options: RenderOptions = {}): string {
  return document.slideOrder.map((slideId) => renderSlideHtml(document, slideId, options)).join('\n')
}

export function renderTextPlain(element: TextElement): string {
  return element.content.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n')
}

function renderElement(document: PpteDocument, element: Element, options: RenderOptions): string {
  const frame = `left:${number(element.frame.x)}du;top:${number(element.frame.y)}du;width:${number(element.frame.width)}du;height:${number(element.frame.height)}du;opacity:${number(element.opacity ?? 1)};transform:rotate(${number(element.rotationDeg ?? 0)}deg);transform-origin:center center;`
  if (element.type === 'text') return renderText(document, element, frame)
  if (element.type === 'image') return renderImage(document, element, frame, options)
  if (element.type === 'shape') return renderShape(document, element, frame)
  throw new Error(`UNSUPPORTED_ELEMENT_TYPE: ${element.type}`)
}

function renderText(document: PpteDocument, element: TextElement, frame: string): string {
  const preset = document.theme.presets.text[element.style.styleRef] ?? defaultTextStyle(document)
  const style = { ...preset, ...element.style.overrides }
  const padding = element.boxStyle?.padding
  const box = [
    `position:absolute;${frame}`,
    `box-sizing:border-box;overflow:${element.overflowPolicy === 'clip' ? 'hidden' : 'visible'};`,
    `font-family:${quoteCss(resolve(style.fontFamily, document, 'font.body'))};font-size:${number(style.fontSize)}du;font-weight:${number(style.fontWeight ?? 400)};`,
    `color:${resolveColor(style.color, document, '#111827')};line-height:${number(style.lineHeight ?? 1.2)};letter-spacing:${number(style.letterSpacing ?? 0)}du;`,
    `text-align:${element.paragraphStyle?.align ?? 'left'};`,
    padding ? `padding:${number(padding.top)}du ${number(padding.right)}du ${number(padding.bottom)}du ${number(padding.left)}du;` : '',
    `vertical-align:${style.verticalAlign ?? 'top'};direction:${style.direction ?? 'auto'};`,
  ].join('')
  const paragraphs = element.content.paragraphs.map((paragraph) => {
    const align = paragraph.align ? ` style="text-align:${paragraph.align};"` : ''
    const listPrefix = paragraph.list?.type === 'bullet' ? '• ' : paragraph.list?.type === 'number' ? '1. ' : ''
    const content = paragraph.runs.map((run) => renderRun(document, run.text, run.marks, style.color)).join('')
    return `<p data-ppte-paragraph-id="${escapeAttr(paragraph.id)}"${align}>${listPrefix}${content}</p>`
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
  const overrides = element.style?.overrides ?? {}
  const style = { ...imageStyle, ...overrides }
  const imageCss = `width:100%;height:100%;object-fit:${element.fit};${crop ? `object-position:${number((crop.x + crop.width / 2) * 100)}% ${number((crop.y + crop.height / 2) * 100)}%;` : ''}`
  const wrapper = `position:absolute;${frame}overflow:hidden;border-radius:${number(style.radius ?? 0)}du;`
  const alt = element.altText ?? asset.altText ?? ''
  return `<div data-ppte-element-id="${escapeAttr(element.id)}" data-ppte-type="image" data-ppte-semantic-key="${escapeAttr(element.semanticKey ?? '')}" style="${wrapper}"><img src="${escapeAttr(source)}" alt="${escapeAttr(alt)}" draggable="false" style="${imageCss}"></div>`
}

function renderShape(document: PpteDocument, element: ShapeElement, frame: string): string {
  const preset = document.theme.presets.shape[element.style.styleRef] ?? {}
  const style = { ...preset, ...element.style.overrides }
  const fill = style.fill ? paintSvg(style.fill, document) : 'none'
  const stroke = style.stroke ? resolveColor(style.stroke.color, document, 'none') : 'none'
  const strokeWidth = style.stroke?.width ?? 0
  const common = `fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="${number(strokeWidth)}"`
  let body: string
  if (element.shape === 'ellipse') body = `<ellipse cx="${number(element.frame.width / 2)}" cy="${number(element.frame.height / 2)}" rx="${number(element.frame.width / 2)}" ry="${number(element.frame.height / 2)}" ${common}/>`
  else if (element.shape === 'line' || element.shape === 'arrow') body = `<line x1="0" y1="0" x2="${number(element.frame.width)}" y2="${number(element.frame.height)}" ${common}/>`
  else {
    const points = element.points?.length ? element.points.map((point) => `${number(point.x)},${number(point.y)}`).join(' ') : defaultPoints(element.shape, element.frame.width, element.frame.height)
    body = `<polygon points="${escapeAttr(points)}" ${common}/>`
  }
  const svgStyle = `position:absolute;${frame};overflow:visible;`
  return `<svg data-ppte-element-id="${escapeAttr(element.id)}" data-ppte-type="shape" data-ppte-semantic-key="${escapeAttr(element.semanticKey ?? '')}" viewBox="0 0 ${number(element.frame.width)} ${number(element.frame.height)}" style="${svgStyle}" aria-hidden="${element.role === 'decorative' ? 'true' : 'false'}">${body}</svg>`
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
function resolve<T>(value: ValueOrToken<T> | undefined, document: PpteDocument, fallbackToken: string): T | string {
  if (!value) return (tokenValue(document, fallbackToken) as T | undefined) ?? ''
  return value.kind === 'value' ? value.value : (tokenValue(document, value.token) as T | undefined) ?? value.token
}
function resolveColor(value: ValueOrToken<`#${string}`> | undefined, document: PpteDocument, fallback: string): string {
  const resolved = resolve(value, document, 'color.text.primary')
  return typeof resolved === 'string' && resolved ? resolved : fallback
}
function tokenValue(document: PpteDocument, token: string): string | number | undefined {
  if (document.theme.tokens.colors[token]) return document.theme.tokens.colors[token]
  if (document.theme.tokens.fontFamilies[token]) return document.theme.tokens.fontFamilies[token]
  if (document.theme.tokens.fontSizes[token] !== undefined) return document.theme.tokens.fontSizes[token]
  return undefined
}
function paintCss(paint: Paint, document: PpteDocument): string {
  if (paint.kind === 'none') return 'transparent'
  if (paint.kind === 'solid') return `${resolveColor(paint.color, document, 'transparent')}${paint.opacity === undefined ? '' : `;opacity:${number(paint.opacity)}`}`
  return `linear-gradient(${number(paint.angleDeg)}deg,${paint.stops.map((stop) => `${resolveColor(stop.color, document, '#000000')} ${number(stop.offset * 100)}%`).join(',')})`
}
function paintSvg(paint: Paint, document: PpteDocument): string {
  if (paint.kind === 'none') return 'none'
  if (paint.kind === 'solid') return resolveColor(paint.color, document, 'none')
  return resolveColor(paint.stops[0]?.color, document, 'none')
}
function number(value: number): string {
  if (!Number.isFinite(value)) throw new Error('RENDER_INVALID_NUMBER')
  return String(Math.round(value * 1000) / 1000)
}
function quoteCss(value: string): string { return `'${value.replaceAll("'", '')}'` }
function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;') }
function escapeAttr(value: string): string { return escapeHtml(value) }
