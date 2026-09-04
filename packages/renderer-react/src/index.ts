import { canonicalHash, canonicalJsonString } from '../../canonical-json/src/index.js'
import { renderChartSvg } from '../../charts/src/index.js'
import { getBuiltinWidgetRegistry, renderWidgetHtml, renderWidgetSvg, type WidgetRegistry } from '../../widgets/src/index.js'
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
  widgetRegistry?: WidgetRegistry
  /** Mount text surfaces as editable controls for the Product Host. */
  editable?: boolean
  /** Legacy wrapper-only opt-in for the derived reference Host shell. */
  includeHostControls?: boolean
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
  const transitionData = slide.transition
    ? ` data-ppte-transition="${escapeAttr(canonicalJsonString(slide.transition))}" data-ppte-transition-type="${escapeAttr(slide.transition.type)}" data-ppte-transition-duration-ms="${number(slide.transition.durationMs ?? 0)}"${slide.transition.direction ? ` data-ppte-transition-direction="${escapeAttr(slide.transition.direction)}"` : ''}`
    : ''
  return `<div class="ppte-slide" data-ppte-slide-id="${escapeAttr(slide.id)}" data-ppte-type="slide"${strategyData}${transitionData} style="position:relative;overflow:hidden;width:${cssLength(document.canvas.width)};height:${cssLength(document.canvas.height)};background:${background}">${diagnostics}${children}</div>`
}

/** Render only the semantic slide surface; no Host controls are mounted. */
export function renderDocumentSurfaceHtml(document: PpteDocument, options: RenderOptions = {}): string {
  const surfaceOptions = { ...options, editable: options.editable ?? false, includeHostControls: false }
  return document.slideOrder.map((slideId) => renderSlideHtml(document, slideId, surfaceOptions)).join('\n')
}

/** Render a presentation surface that is explicitly read-only. */
export function renderReadOnlyPresentationHtml(document: PpteDocument, options: RenderOptions = {}): string {
  return renderDocumentSurfaceHtml(document, { ...options, editable: false, includeHostControls: false })
}

/**
 * Render the small reference Host shell used by examples and tests. This is a
 * derived fixture, not a document editor or a persistence boundary.
 */
export function renderReferenceHostHtml(document: PpteDocument, options: RenderOptions = {}): string {
  const surfaceOptions = { ...options, editable: options.editable ?? true, includeHostControls: false }
  const slides = document.slideOrder.map((slideId) => renderSlideHtml(document, slideId, surfaceOptions)).join('\n')
  const thumbnails = document.slideOrder.map((slideId, index) => `<button type="button" class="ppte-thumbnail" data-ppte-slide-index="${index}" aria-label="Slide ${index + 1}"><span>${index + 1}</span></button>`).join('')
  const documentJson = canonicalJsonString(document).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026')
  return `<style data-ppte-host-style>.ppte-host{min-height:100vh;display:grid;grid-template-columns:9rem 1fr;grid-template-rows:auto 1fr auto;background:#111827;color:#f8fafc;font-family:system-ui,sans-serif}.ppte-host *{box-sizing:border-box}@keyframes ppte-enter-fade{from{opacity:0}to{opacity:1}}@keyframes ppte-enter-slide-up{from{opacity:0;transform:translateY(1rem)}to{opacity:1;transform:translateY(0)}}@keyframes ppte-enter-slide-left{from{opacity:0;transform:translateX(1rem)}to{opacity:1;transform:translateX(0)}}@keyframes ppte-enter-scale{from{opacity:0;scale:.96}to{opacity:1;scale:1}}@keyframes ppte-transition-fade{from{opacity:0}to{opacity:1}}@keyframes ppte-transition-slide{from{opacity:0;transform:translateX(2rem)}to{opacity:1;transform:translateX(0)}}@keyframes ppte-transition-push{from{opacity:0;transform:translateX(2rem)}to{opacity:1;transform:translateX(0)}}.ppte-host-toolbar{grid-column:1/-1;display:flex;gap:.5rem;align-items:center;padding:.65rem .8rem;background:#0f172a;position:sticky;top:0;z-index:4}.ppte-host-toolbar button,.ppte-host-toolbar label{border:1px solid #475569;border-radius:.35rem;background:#1e293b;color:#f8fafc;padding:.4rem .65rem;cursor:pointer;font-size:.85rem}.ppte-host-toolbar input[type=file]{display:none}.ppte-host-toolbar [data-ppte-status]{margin-left:auto;color:#cbd5e1;font-size:.8rem}.ppte-host-thumbnails{padding:.75rem;background:#0b1220;overflow:auto}.ppte-thumbnail{display:block;width:100%;min-height:4rem;margin:0 0 .55rem;border:1px solid #334155;border-radius:.35rem;background:#1e293b;color:#cbd5e1;cursor:pointer}.ppte-thumbnail[data-active=true]{border-color:#60a5fa;box-shadow:0 0 0 2px #2563eb66}.ppte-thumbnail span{display:block;padding:.25rem}.ppte-host-stage{display:grid;place-items:center;overflow:auto;padding:1rem}.ppte-host-stage .ppte-slide{display:none;box-shadow:0 1rem 3rem #0008;max-width:calc(100vw - 12rem);max-height:calc(100vh - 9rem)}.ppte-host-stage .ppte-slide[data-active=true]{display:block}.ppte-host-stage [data-ppte-animation-enter]{--ppte-animation-duration:0ms}.ppte-host-stage [contenteditable=true]{outline:1px dashed transparent}.ppte-host-stage [contenteditable=true]:hover,.ppte-host-stage [contenteditable=true]:focus{outline-color:#60a5fa;cursor:text}.ppte-host-notes{grid-column:1/-1;min-height:3rem;padding:.55rem .8rem;background:#0f172a}.ppte-host-notes textarea{width:100%;min-height:2.2rem;resize:vertical;background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:.25rem;padding:.35rem}.ppte-host[data-ppte-presenting=true]{grid-template-columns:1fr}.ppte-host[data-ppte-presenting=true] .ppte-host-thumbnails,.ppte-host[data-ppte-presenting=true] .ppte-host-toolbar label,.ppte-host[data-ppte-presenting=true] .ppte-host-notes{display:none}.ppte-host[data-ppte-presenting=true] .ppte-host-stage .ppte-slide{max-width:calc(100vw - 2rem);max-height:calc(100vh - 5rem)}</style><div class="ppte-host" data-ppte-host data-ppte-canvas-unit="du"><header class="ppte-host-toolbar"><button type="button" data-ppte-action="new">New</button><label>Open<input type="file" accept=".ppte,.json,application/json" data-ppte-action="open"></label><button type="button" data-ppte-action="save">Save copy</button><button type="button" data-ppte-action="present">Present</button><span data-ppte-status>PPTe Host · local document</span></header><aside class="ppte-host-thumbnails" data-ppte-thumbnails>${thumbnails}</aside><main class="ppte-host-stage" data-ppte-stage>${slides}</main><section class="ppte-host-notes" data-ppte-notes-panel><label for="ppte-speaker-notes">Speaker notes</label><textarea id="ppte-speaker-notes" data-ppte-notes-input></textarea></section></div><script type="application/json" data-ppte-document>${documentJson}</script><script>${hostScript()}</script>`
}

/**
 * @deprecated Use renderDocumentSurfaceHtml, renderReadOnlyPresentationHtml,
 * or renderReferenceHostHtml so the output role is explicit. The legacy
 * wrapper is read-only by default and is never a delivery API.
 */
export function renderDocumentHtml(document: PpteDocument, options: RenderOptions = {}): string {
  if (options.includeHostControls === true) return renderReferenceHostHtml(document, options)
  return renderDocumentSurfaceHtml(document, options)
}

/** A self-contained image surface for exporters. It remains derived from the semantic snapshot. */
export function renderSlideSvg(document: PpteDocument, slideId: string, options: RenderOptions = {}): string {
  const slide = document.slides[slideId]
  if (!slide) throw new Error(`SLIDE_MISSING: ${slideId}`)
  const width = document.canvas.width
  const height = document.canvas.height
  const defs: string[] = []
  const background = paintSvg(slide.background ?? document.canvas.defaultBackground, document, 'ppte-background', defs)
  const children = slide.rootOrder
    .map((elementId) => slide.elements[elementId])
    .filter((element): element is Element => Boolean(element) && element.visible !== false)
    .map((element) => renderElementSvg(document, element, options, defs))
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${number(width)}" height="${number(height)}" viewBox="0 0 ${number(width)} ${number(height)}"><defs>${defs.join('')}</defs><rect x="0" y="0" width="${number(width)}" height="${number(height)}" fill="${escapeAttr(background)}"/>${children}</svg>`
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
  const frame = `left:${cssLength(element.frame.x)};top:${cssLength(element.frame.y)};width:${cssLength(element.frame.width)};height:${cssLength(element.frame.height)};opacity:${number(element.opacity ?? 1)};transform:rotate(${number(element.rotationDeg ?? 0)}deg);transform-origin:center center;`
  let rendered: string
  if (element.type === 'text') rendered = renderText(document, element, frame, options)
  else if (element.type === 'image') rendered = renderImage(document, element, frame, options)
  else if (element.type === 'shape') rendered = renderShape(document, element, frame)
  else if (element.type === 'chart') rendered = renderChart(document, element, frame)
  else rendered = renderComponent(document, element, frame, options)
  const markers = [
    element.appearStep === undefined ? '' : ` data-ppte-appear-step="${number(element.appearStep)}"`,
    element.animation ? ` data-ppte-animation="${escapeAttr(canonicalJsonString(element.animation))}"` : '',
    element.animation?.enter ? ` data-ppte-animation-enter="${escapeAttr(element.animation.enter.type)}" data-ppte-animation-duration-ms="${number(element.animation.enter.durationMs ?? 0)}" data-ppte-animation-delay-ms="${number(element.animation.enter.delayMs ?? 0)}" data-ppte-animation-easing="${escapeAttr(element.animation.enter.easing ?? 'ease')}"` : '',
  ].join('')
  return markers ? rendered.replace(/^(<[A-Za-z][\w:-]*)/, `$1${markers}`) : rendered
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

function renderText(document: PpteDocument, element: TextElement, frame: string, options: RenderOptions): string {
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
    element.boxStyle?.radius !== undefined ? `border-radius:${cssLength(element.boxStyle.radius)};` : '',
    `font-family:${quoteCss(resolve(style.fontFamily, document, 'font.body'))};font-size:${cssLength(style.fontSize)};font-weight:${number(style.fontWeight ?? 400)};`,
    `color:${resolveColor(style.color, document, '#111827')};line-height:${number(style.lineHeight ?? 1.2)};letter-spacing:${cssLength(style.letterSpacing ?? 0)};`,
    `text-align:${element.paragraphStyle?.align ?? 'left'};`,
    padding ? `padding:${cssLength(padding.top)} ${cssLength(padding.right)} ${cssLength(padding.bottom)} ${cssLength(padding.left)};` : '',
    `vertical-align:${style.verticalAlign ?? 'top'};direction:${style.direction ?? 'auto'};`,
  ].join('')
  const paragraphs = element.content.paragraphs.map((paragraph) => {
    const paragraphStyle = [
      paragraph.align ? `text-align:${paragraph.align};` : '',
      paragraph.spaceBefore !== undefined ? `margin-top:${cssLength(paragraph.spaceBefore)};` : '',
      paragraph.spaceAfter !== undefined ? `margin-bottom:${cssLength(paragraph.spaceAfter)};` : '',
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
  const editable = options.editable === true ? ' contenteditable="true" spellcheck="false" tabindex="0"' : ''
  return `<div data-ppte-element-id="${escapeAttr(element.id)}" data-ppte-type="text" data-ppte-semantic-key="${escapeAttr(element.semanticKey ?? '')}"${editable} style="${box}">${paragraphs}</div>`
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
    `position:absolute;${frame}overflow:hidden;border-radius:${cssLength(asNumber(style.radius) ?? 0)};`,
    style.border ? strokeCss(style.border as Stroke, document, 'border') : '',
    style.shadow ? `box-shadow:${shadowCss(style.shadow as Shadow, document)};` : '',
  ].join('')
  const alt = element.altText ?? asset.altText ?? ''
  const cropData = crop ? ` data-ppte-crop="${escapeAttr([crop.x, crop.y, crop.width, crop.height].map(number).join(','))}"` : ''
  const artwork = element.role === 'artwork' ? asset.artwork : undefined
  const artworkData = artwork ? ` data-ppte-artwork="true" data-ppte-safe-text-regions="${escapeAttr(canonicalJsonString(artwork.safeTextRegions ?? []))}" data-ppte-avoid-text-regions="${escapeAttr(canonicalJsonString(artwork.avoidTextRegions ?? []))}" data-ppte-dominant-palette="${escapeAttr(canonicalJsonString(artwork.dominantPalette ?? []))}"${artwork.focalPoint ? ` data-ppte-focal-point="${escapeAttr(canonicalJsonString(artwork.focalPoint))}"` : ''}` : ''
  return `<div data-ppte-element-id="${escapeAttr(element.id)}" data-ppte-type="image" data-ppte-asset-id="${escapeAttr(element.assetId)}" data-ppte-semantic-key="${escapeAttr(element.semanticKey ?? '')}"${cropData}${artworkData} style="${wrapper}"><img src="${escapeAttr(source)}" alt="${escapeAttr(alt)}" draggable="false" style="${imageCss}"></div>`
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

function renderChart(document: PpteDocument, element: Extract<Element, { type: 'chart' }>, frame: string): string {
  const preset = document.theme.presets.chart[element.style.styleRef] ?? {}
  const style = resolveStyle({ ...preset, ...(element.style.overrides ?? {}) }, document) as Record<string, unknown>
  const colors = Array.isArray(style.palette) ? style.palette.filter((value): value is string => typeof value === 'string') : undefined
  const svg = renderChartSvg(element, {
    width: element.frame.width,
    height: element.frame.height,
    palette: colors,
    axisColor: typeof style.axisColor === 'string' ? style.axisColor : undefined,
    labelColor: typeof style.labelColor === 'string' ? style.labelColor : undefined,
    gridColor: typeof style.gridColor === 'string' ? style.gridColor : undefined,
    lineWidth: asNumber(style.lineWidth),
    cornerRadius: asNumber(style.cornerRadius),
    runtimeProfile: element.chartType === 'area' || element.chartType === 'donut' ? 'ga-c' : 'ga-b',
  })
  return `<div data-ppte-element-id="${escapeAttr(element.id)}" data-ppte-type="chart" data-ppte-chart-type="${escapeAttr(element.chartType)}" data-ppte-semantic-key="${escapeAttr(element.semanticKey ?? '')}" style="position:absolute;${frame};overflow:hidden;">${svg}</div>`
}

function renderComponent(document: PpteDocument, element: Extract<Element, { type: 'component' }>, frame: string, options: RenderOptions): string {
  const fallbackAsset = element.fallback.kind === 'asset' && element.fallback.assetId ? document.assets[element.fallback.assetId] : undefined
  if (fallbackAsset) {
    const source = options.assetSources?.[fallbackAsset.id] ?? fallbackAsset.path
    return `<div data-ppte-element-id="${escapeAttr(element.id)}" data-ppte-type="component" data-ppte-component-type="${escapeAttr(element.componentType)}" data-ppte-component-version="${escapeAttr(element.componentVersion)}" data-ppte-semantic-key="${escapeAttr(element.semanticKey ?? '')}" data-ppte-widget-fallback="asset" style="position:absolute;${frame}overflow:hidden;"><img src="${escapeAttr(source)}" alt="${escapeAttr(fallbackAsset.altText ?? element.fallback.label ?? element.componentType)}" style="width:100%;height:100%;object-fit:contain;"></div>`
  }
  const widget = renderWidgetHtml(element, options.widgetRegistry ?? getBuiltinWidgetRegistry())
  return `<div data-ppte-element-id="${escapeAttr(element.id)}" data-ppte-type="component" data-ppte-component-type="${escapeAttr(element.componentType)}" data-ppte-component-version="${escapeAttr(element.componentVersion)}" data-ppte-semantic-key="${escapeAttr(element.semanticKey ?? '')}" style="position:absolute;${frame}overflow:hidden;">${widget}</div>`
}

function renderElementSvg(document: PpteDocument, element: Element, options: RenderOptions, defs: string[]): string {
  const transform = `translate(${number(element.frame.x + (element.flipX ? element.frame.width : 0))} ${number(element.frame.y + (element.flipY ? element.frame.height : 0))}) scale(${element.flipX ? -1 : 1} ${element.flipY ? -1 : 1}) rotate(${number(element.rotationDeg ?? 0)} ${number(element.frame.width / 2)} ${number(element.frame.height / 2)})`
  const opacity = element.opacity === undefined ? '' : ` opacity="${number(element.opacity)}"`
  let body: string
  if (element.type === 'text') body = renderTextSvg(document, element, defs)
  else if (element.type === 'image') body = renderImageSvg(document, element, options, defs)
  else if (element.type === 'shape') body = renderShapeSvg(document, element, defs)
  else if (element.type === 'chart') body = renderChartSvgElement(document, element)
  else if (element.fallback.kind === 'asset' && element.fallback.assetId && document.assets[element.fallback.assetId]) {
    const asset = document.assets[element.fallback.assetId]
    const source = options.assetSources?.[asset.id] ?? asset.path
    body = `<image x="0" y="0" width="${number(element.frame.width)}" height="${number(element.frame.height)}" href="${escapeAttr(source)}" xlink:href="${escapeAttr(source)}" preserveAspectRatio="xMidYMid meet"/>`
  } else body = renderWidgetSvg(element, element.frame.width, element.frame.height, options.widgetRegistry ?? getBuiltinWidgetRegistry())
  return `<g data-ppte-element-id="${escapeAttr(element.id)}" data-ppte-type="${escapeAttr(element.type)}"${element.semanticKey ? ` data-ppte-semantic-key="${escapeAttr(element.semanticKey)}"` : ''} transform="${transform}"${opacity}>${body}</g>`
}

function renderTextSvg(document: PpteDocument, element: TextElement, defs: string[]): string {
  const preset = document.theme.presets.text[element.style.styleRef] ?? defaultTextStyle(document)
  const style = resolveStyle({ ...preset, ...element.style.overrides }, document) as TextStyle
  const padding = element.boxStyle?.padding ?? { top: 0, right: 0, bottom: 0, left: 0 }
  const fill = element.boxStyle?.fill ? paintSvg(element.boxStyle.fill, document, `ppte-fill-${safeId(element.id)}`, defs) : undefined
  const stroke = element.boxStyle?.stroke
  const clipId = `ppte-clip-${safeId(element.id)}`
  const overflow = element.overflowPolicy === 'clip' || element.overflowPolicy === 'ellipsis'
  if (overflow) defs.push(`<clipPath id="${escapeAttr(clipId)}"><rect x="0" y="0" width="${number(element.frame.width)}" height="${number(element.frame.height)}" rx="${number(element.boxStyle?.radius ?? 0)}"/></clipPath>`)
  const lines = element.content.paragraphs.map((paragraph, paragraphIndex) => {
    const y = padding.top + style.fontSize * (paragraphIndex + 1) * (style.lineHeight ?? 1.2)
    const x = paragraph.align === 'center' ? element.frame.width / 2 : paragraph.align === 'right' ? element.frame.width - padding.right : padding.left
    const anchor = paragraph.align === 'center' ? 'middle' : paragraph.align === 'right' ? 'end' : 'start'
    const prefix = paragraph.list?.type === 'bullet' ? '• ' : paragraph.list?.type === 'number' ? '1. ' : ''
    const runs = paragraph.runs.map((run) => {
      const marks = run.marks
      const color = marks?.color ? resolveColor(marks.color, document, resolveColor(style.color, document, '#111827')) : resolveColor(style.color, document, '#111827')
      return `<tspan fill="${escapeAttr(color)}"${marks?.bold ? ' font-weight="700"' : ''}${marks?.italic ? ' font-style="italic"' : ''}${marks?.underline ? ' text-decoration="underline"' : ''}${marks?.strike ? ' text-decoration="line-through"' : ''}>${escapeXml(run.text)}</tspan>`
    }).join('')
    return `<text x="${number(x)}" y="${number(y)}" text-anchor="${anchor}" font-family="${escapeAttr(sanitizeFontFamily(resolve(style.fontFamily, document, 'font.body')))}" font-size="${number(style.fontSize)}" font-weight="${number(style.fontWeight ?? 400)}" line-height="${number(style.lineHeight ?? 1.2)}"${style.direction && style.direction !== 'auto' ? ` direction="${style.direction}"` : ''}>${escapeXml(prefix)}${runs}</text>`
  }).join('')
  const box = fill || stroke ? `<rect x="0" y="0" width="${number(element.frame.width)}" height="${number(element.frame.height)}"${fill ? ` fill="${escapeAttr(fill)}"` : ' fill="none"'}${stroke ? ` ${svgStroke(stroke, document)}` : ''}${element.boxStyle?.radius !== undefined ? ` rx="${number(element.boxStyle.radius)}"` : ''}/>` : ''
  return `${box}${overflow ? `<g clip-path="url(#${escapeAttr(clipId)})">${lines}</g>` : lines}`
}

function renderImageSvg(document: PpteDocument, element: ImageElement, options: RenderOptions, defs: string[]): string {
  const asset = document.assets[element.assetId]
  if (!asset) throw new Error(`ASSET_MISSING: ${element.assetId}`)
  const source = options.assetSources?.[element.assetId] ?? asset.path
  const imageId = `ppte-image-${safeId(element.id)}`
  const image = `<image x="0" y="0" width="${number(element.frame.width)}" height="${number(element.frame.height)}" href="${escapeAttr(source)}" xlink:href="${escapeAttr(source)}" preserveAspectRatio="${element.fit === 'contain' ? 'xMidYMid meet' : element.fit === 'cover' ? 'xMidYMid slice' : 'none'}"/>`
  if (!element.crop) return image
  defs.push(`<clipPath id="${escapeAttr(imageId)}"><rect x="0" y="0" width="${number(element.frame.width)}" height="${number(element.frame.height)}"/></clipPath>`)
  const crop = element.crop
  const cropped = `<g clip-path="url(#${escapeAttr(imageId)})" transform="translate(${number(-crop.x * element.frame.width / crop.width)} ${number(-crop.y * element.frame.height / crop.height)}) scale(${number(1 / crop.width)} ${number(1 / crop.height)})">${image}</g>`
  return cropped
}

function renderShapeSvg(document: PpteDocument, element: ShapeElement, defs: string[]): string {
  const preset = document.theme.presets.shape[element.style.styleRef] ?? {}
  const style = resolveStyle({ ...preset, ...element.style.overrides }, document) as Record<string, unknown>
  const fill = style.fill ? paintSvg(style.fill as Paint, document, `ppte-fill-${safeId(element.id)}`, defs) : 'none'
  const stroke = style.stroke as Stroke | undefined
  const common = `fill="${escapeAttr(fill)}"${stroke ? ` ${svgStroke(stroke, document)}` : ' stroke="none"'}`
  if (element.shape === 'ellipse') return `<ellipse cx="${number(element.frame.width / 2)}" cy="${number(element.frame.height / 2)}" rx="${number(element.frame.width / 2)}" ry="${number(element.frame.height / 2)}" ${common}/>`
  if (element.shape === 'rectangle' || element.shape === 'rounded-rectangle') {
    const radius = element.shape === 'rounded-rectangle' ? Math.min(element.frame.width, element.frame.height) / 2 : 0
    return `<rect x="0" y="0" width="${number(element.frame.width)}" height="${number(element.frame.height)}" rx="${number(Math.min(asNumber(style.radius) ?? radius, Math.min(element.frame.width, element.frame.height) / 2))}" ${common}/>`
  }
  if (element.shape === 'line' || element.shape === 'arrow') return `<line x1="0" y1="0" x2="${number(element.frame.width)}" y2="${number(element.frame.height)}" ${common}/>`
  const points = element.points?.length ? element.points.map((point) => `${number(point.x)},${number(point.y)}`).join(' ') : defaultPoints(element.shape, element.frame.width, element.frame.height)
  return `<polygon points="${escapeAttr(points)}" ${common}/>`
}

function renderChartSvgElement(document: PpteDocument, element: Extract<Element, { type: 'chart' }>): string {
  const preset = document.theme.presets.chart[element.style.styleRef] ?? {}
  const style = resolveStyle({ ...preset, ...(element.style.overrides ?? {}) }, document) as Record<string, unknown>
  const palette = Array.isArray(style.palette) ? style.palette.filter((value): value is string => typeof value === 'string') : undefined
  return renderChartSvg(element, { width: element.frame.width, height: element.frame.height, palette, axisColor: typeof style.axisColor === 'string' ? style.axisColor : undefined, labelColor: typeof style.labelColor === 'string' ? style.labelColor : undefined, gridColor: typeof style.gridColor === 'string' ? style.gridColor : undefined, lineWidth: asNumber(style.lineWidth), cornerRadius: asNumber(style.cornerRadius), runtimeProfile: element.chartType === 'area' || element.chartType === 'donut' ? 'ga-c' : 'ga-b' })
}

function svgStroke(stroke: Stroke, document: PpteDocument): string {
  return `stroke="${escapeAttr(resolveColor(stroke.color, document, 'none'))}" stroke-width="${number(stroke.width)}"${stroke.opacity === undefined ? '' : ` stroke-opacity="${number(stroke.opacity)}"`}${stroke.dash?.length ? ` stroke-dasharray="${escapeAttr(stroke.dash.map(number).join(' '))}"` : ''}${stroke.lineCap ? ` stroke-linecap="${stroke.lineCap}"` : ''}${stroke.lineJoin ? ` stroke-linejoin="${stroke.lineJoin}"` : ''}`
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
  return `${property}:${cssLength(stroke.width)} ${style} ${resolveColor(stroke.color, document, 'transparent')};${stroke.opacity === undefined ? '' : `${property}-opacity:${number(stroke.opacity)};`}`
}
function shadowCss(shadow: Shadow, document: PpteDocument): string {
  return `${cssLength(shadow.offsetX)} ${cssLength(shadow.offsetY)} ${cssLength(shadow.blur)} ${cssLength(shadow.spread ?? 0)} ${resolveColor(shadow.color, document, 'transparent')}`
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
function cssLength(value: number): string { return `${number(value)}px` }
function number(value: number): string {
  if (!Number.isFinite(value)) throw new Error('RENDER_INVALID_NUMBER')
  return String(Math.round(value * 1000) / 1000)
}
function quoteCss(value: unknown): string {
  const families = sanitizeFontFamily(value).split(',').map((family) => family.trim()).filter(Boolean)
  return families.length ? families.map((family) => `'${family}'`).join(',') : 'sans-serif'
}
function sanitizeFontFamily(value: unknown): string {
  return String(value ?? '').split(',').map((family) => family.trim().replace(/[^\p{L}\p{N}\p{M}\p{Zs}._-]/gu, '')).filter(Boolean).join(',')
}
function hostScript(): string {
  return `(()=>{const host=document.querySelector('[data-ppte-host]');if(!host)return;const documentNode=JSON.parse(document.querySelector('[data-ppte-document]').textContent||'{}');let index=0;let step=0;const slides=[...host.querySelectorAll('[data-ppte-slide-id]')];const status=host.querySelector('[data-ppte-status]');const notes=host.querySelector('[data-ppte-notes-input]');const current=()=>documentNode.slides&&documentNode.slides[documentNode.slideOrder[index]];const setStatus=(value)=>{if(status)status.textContent=value};const show=()=>{slides.forEach((slide,slideIndex)=>{slide.dataset.active=String(slideIndex===index);slide.querySelectorAll('[data-ppte-appear-step]').forEach((element)=>{element.style.visibility=Number(element.getAttribute('data-ppte-appear-step'))<=step?'visible':'hidden'})});const slide=current();if(notes)notes.value=slide&&slide.notes?slide.notes.speaker||'':'';host.querySelectorAll('[data-ppte-slide-index]').forEach((button)=>{button.dataset.active=String(Number(button.dataset.ppteSlideIndex||button.getAttribute('data-ppte-slide-index'))===index)});setStatus('PPTe Host · slide '+(index+1)+'/'+slides.length+(host.dataset.pptePresenting==='true'?' · presenting':''))};const next=()=>{const active=slides[index];const pending=[...(active?active.querySelectorAll('[data-ppte-appear-step]'):[])].map((element)=>Number(element.getAttribute('data-ppte-appear-step'))).filter((value)=>value>step).sort((a,b)=>a-b);if(pending.length)step=pending[0];else if(index<slides.length-1){index+=1;step=0}show()};const previous=()=>{if(step>0)step=Math.max(0,step-1);else if(index>0){index-=1;step=0}show()};const save=()=>{const blob=new Blob([JSON.stringify(documentNode,null,2)],{type:'application/vnd.ppte+json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=((documentNode.metadata&&documentNode.metadata.title)||'presentation')+'.ppte.json';link.click();URL.revokeObjectURL(link.href);setStatus('PPTe Host · saved copy')};host.addEventListener('click',(event)=>{const target=event.target.closest('button');if(!target)return;const action=target.getAttribute('data-ppte-action');if(action==='next')next();else if(action==='previous')previous();else if(action==='save')save();else if(action==='present'){host.dataset.pptePresenting=host.dataset.pptePresenting==='true'?'false':'true';show()}else if(action==='new')setStatus('PPTe Host · new document requires a local semantic snapshot');else if(target.hasAttribute('data-ppte-slide-index')){index=Math.max(0,Math.min(slides.length-1,Number(target.getAttribute('data-ppte-slide-index'))||0));step=0;show()}});host.addEventListener('input',(event)=>{const target=event.target;if(target.matches('[contenteditable="true"]')){const element=target.closest('[data-ppte-element-id]');const slide=current();const model=slide&&element?slide.elements[element.getAttribute('data-ppte-element-id')]:null;if(model&&model.type==='text'&&model.content&&model.content.paragraphs&&model.content.paragraphs[0]&&model.content.paragraphs[0].runs&&model.content.paragraphs[0].runs[0])model.content.paragraphs[0].runs[0].text=target.innerText.replace(/\\n/g,'\\n')}});if(notes)notes.addEventListener('input',()=>{const slide=current();if(slide){slide.notes=slide.notes||{};slide.notes.speaker=notes.value}});const open=host.querySelector('input[type="file"]');if(open)open.addEventListener('change',()=>{const file=open.files&&open.files[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const parsed=JSON.parse(String(reader.result||''));if(parsed&&parsed.schemaVersion){setStatus('PPTe Host · opened '+file.name+'; reload to remount the snapshot')}else throw new Error('not a document')}catch(error){setStatus('PPTe Host · open failed: '+error.message)}};reader.readAsText(file)});show()})()`
}
function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;') }
function escapeXml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;') }
function escapeAttr(value: string): string { return escapeHtml(value) }
