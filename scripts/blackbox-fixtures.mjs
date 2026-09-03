/**
 * Independent black-box fixtures.
 *
 * These fixtures intentionally do not import the Contract Deck. The audit
 * gate must exercise the public package boundaries with data that is owned by
 * the gate itself.
 */

import { createHash } from 'node:crypto'

export const IDS = Object.freeze({
  slide: 'bb_slide_main',
  title: 'bb_text_title',
  body: 'bb_text_body',
  image: 'bb_image_hero',
  surface: 'bb_shape_surface',
  asset: 'bb_asset_pixel',
  assetNew: 'bb_asset_new',
  chart: 'bb_chart_revenue',
  chartLine: 'bb_chart_line',
  chartPie: 'bb_chart_pie',
  metric: 'bb_metric_revenue',
  widget: 'bb_widget_code',
  videoWidget: 'bb_widget_video',
})

export function clone(value) {
  return structuredClone(value)
}

export function richText(value, prefix = 'bb-paragraph') {
  return {
    paragraphs: value.split('\n').map((line, index) => ({
      id: `${prefix}-${index + 1}`,
      runs: [{ id: `${prefix}-${index + 1}-run`, text: line }],
    })),
  }
}

export function textContent(element) {
  return element.content.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n')
}

export function pixelPng() {
  return Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10,
    0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
    0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1, 255, 137, 153, 61, 29,
    0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
  ])
}

export function alternatePng() {
  return Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2, 1])
}

function baseDocument() {
  const imageBytes = pixelPng()
  return {
    schemaVersion: '2.0.0',
    documentId: 'bb_doc_reference_core',
    locale: 'zh-CN',
    metadata: { title: 'Black-box reference fixture', source: 'generated', createdAt: '2026-09-03T00:00:00.000Z' },
    canvas: {
      width: 1920,
      height: 1080,
      unit: 'du',
      aspectRatio: '16:9',
      defaultBackground: { kind: 'solid', color: { kind: 'value', value: '#F8FAFC' } },
    },
    theme: {
      id: 'bb_theme',
      name: 'Black-box Theme',
      tokens: {
        colors: {
          'color.background': '#F8FAFC',
          'color.text.primary': '#172033',
          'color.text.muted': '#475569',
          'color.surface': '#FFFFFF',
          'color.accent': '#2563EB',
        },
        fontFamilies: { 'font.heading': 'Inter', 'font.body': 'Inter' },
        fontSizes: { 'fontSize.title': 64, 'fontSize.body': 28 },
        spacing: {},
        radii: {},
        shadows: {},
      },
      presets: {
        text: {
          'text.title': {
            fontFamily: { kind: 'token', token: 'font.heading' },
            fontSize: 64,
            fontWeight: 700,
            color: { kind: 'token', token: 'color.text.primary' },
            lineHeight: 1.15,
          },
          'text.body': {
            fontFamily: { kind: 'token', token: 'font.body' },
            fontSize: 28,
            fontWeight: 400,
            color: { kind: 'token', token: 'color.text.muted' },
            lineHeight: 1.35,
          },
        },
        shape: {
          'shape.surface': {
            fill: { kind: 'solid', color: { kind: 'token', token: 'color.surface' } },
            stroke: { color: { kind: 'token', token: 'color.accent' }, width: 2, opacity: 0.4 },
            radius: 24,
          },
        },
        image: {
          'image.hero': {
            border: { color: { kind: 'token', token: 'color.accent' }, width: 2, opacity: 0.6 },
            radius: 16,
          },
        },
        chart: {
          'chart.default': {
            palette: [{ kind: 'value', value: '#2563EB' }, { kind: 'value', value: '#14B8A6' }],
            axisColor: { kind: 'value', value: '#64748B' },
            labelColor: { kind: 'value', value: '#334155' },
            gridColor: { kind: 'value', value: '#CBD5E1' },
            lineWidth: 2,
            cornerRadius: 3,
          },
        },
      },
    },
    slideOrder: [IDS.slide],
    slides: {
      [IDS.slide]: {
        id: IDS.slide,
        name: 'Black-box acceptance slide',
        rootOrder: [IDS.surface, IDS.title, IDS.body, IDS.image],
        readingOrder: [IDS.title, IDS.body, IDS.image],
        elements: {
          [IDS.surface]: {
            id: IDS.surface,
            type: 'shape',
            semanticKey: 'surface.main',
            role: 'background',
            frame: { x: 80, y: 70, width: 1760, height: 940 },
            shape: 'rounded-rectangle',
            style: { styleRef: 'shape.surface' },
          },
          [IDS.title]: {
            id: IDS.title,
            type: 'text',
            semanticKey: 'title.main',
            role: 'title',
            frame: { x: 160, y: 120, width: 820, height: 130 },
            content: richText('年度经营回顾', 'bb-title'),
            style: { styleRef: 'text.title' },
            overflowPolicy: 'warn',
            editPolicy: { mode: 'full', agentEditable: true, preserveOnRegenerate: true },
          },
          [IDS.body]: {
            id: IDS.body,
            type: 'text',
            semanticKey: 'body.summary',
            role: 'body',
            frame: { x: 160, y: 330, width: 780, height: 260 },
            content: richText('Product education module', 'bb-body'),
            style: { styleRef: 'text.body' },
            overflowPolicy: 'warn',
            semanticRefs: { factIds: ['revenue'], sourceIds: ['source.report'] },
          },
          [IDS.image]: {
            id: IDS.image,
            type: 'image',
            semanticKey: 'image.hero',
            role: 'image',
            frame: { x: 1120, y: 250, width: 560, height: 430 },
            assetId: IDS.asset,
            fit: 'fill',
            style: { styleRef: 'image.hero' },
            altText: 'Black-box pixel image',
          },
        },
        groups: {},
        visualStrategy: 'structured',
      },
    },
    assets: {
      [IDS.asset]: {
        id: IDS.asset,
        hash: `sha256-${digest(imageBytes)}`,
        mimeType: 'image/png',
        byteLength: imageBytes.length,
        path: 'assets/pixel.png',
        width: 1,
        height: 1,
        source: { kind: 'generated', importedAt: '2026-09-03T00:00:00.000Z' },
        altText: 'Black-box pixel image',
      },
    },
    facts: { revenue: { id: 'revenue', key: 'revenue', value: 42, unit: '%' } },
    sources: { 'source.report': { id: 'source.report', title: 'Black-box source', citation: 'Fixture source, 2026' } },
    fonts: {
      bb_font_inter: { id: 'bb_font_inter', family: 'Inter', style: 'normal', weight: 400, source: 'system', editableSafe: true },
    },
    __blackboxAssetBytes: imageBytes,
  }
}

export function makeCoreDocument() {
  const document = baseDocument()
  delete document.__blackboxAssetBytes
  return document
}

export function makeCoreFixture() {
  const document = baseDocument()
  const imageBytes = document.__blackboxAssetBytes
  delete document.__blackboxAssetBytes
  return { document, imageBytes }
}

export function makeChartFixture() {
  const { document, imageBytes } = makeCoreFixture()
  document.metadata.title = 'Black-box Chart and Fact fixture'
  document.slides[IDS.slide].name = 'Chart and Fact acceptance slide'
  document.slides[IDS.slide].visualStrategy = 'structured'
  document.slides[IDS.slide].elements[IDS.body].content = richText('Revenue was 41% last year; target is 50%.', 'bb-fact-body')
  document.slides[IDS.slide].elements[IDS.body].role = 'body'
  const chart = {
    id: IDS.chart,
    type: 'chart',
    semanticKey: 'chart.revenue',
    role: 'chart',
    frame: { x: 1040, y: 160, width: 760, height: 560 },
    chartType: 'bar',
    data: {
      columns: [{ id: 'period', label: 'Period', type: 'string' }, { id: 'revenue', label: 'Revenue', type: 'number' }],
      rows: [{ id: 'q1', values: { period: 'Q1', revenue: 42 } }, { id: 'q2', values: { period: 'Q2', revenue: 38 } }],
    },
    encoding: { categoryField: 'period', valueFields: ['revenue'] },
    options: { showLegend: false, showLabels: true },
    style: { styleRef: 'chart.default' },
    semanticRefs: { factIds: ['revenue'], sourceIds: ['source.report'] },
    altText: 'Revenue by period',
  }
  const metric = {
    id: IDS.metric,
    type: 'text',
    semanticKey: 'metric.revenue',
    role: 'metric',
    frame: { x: 160, y: 650, width: 700, height: 100 },
    content: richText('Revenue 42%', 'bb-metric'),
    style: { styleRef: 'text.body' },
    semanticRefs: { factIds: ['revenue'], sourceIds: ['source.report'] },
    overflowPolicy: 'warn',
  }
  const slide = document.slides[IDS.slide]
  slide.elements[IDS.chart] = chart
  slide.elements[IDS.metric] = metric
  slide.rootOrder.push(IDS.chart, IDS.metric)
  slide.readingOrder.push(IDS.metric)
  return { document, imageBytes }
}

export function makeChartVariantsFixture() {
  const fixture = makeChartFixture()
  const slide = fixture.document.slides[IDS.slide]
  const baseChart = slide.elements[IDS.chart]
  for (const [id, chartType, y] of [[IDS.chartLine, 'line', 160], [IDS.chartPie, 'pie', 740]]) {
    slide.elements[id] = {
      ...clone(baseChart),
      id,
      semanticKey: `chart.${chartType}`,
      chartType,
      frame: { ...baseChart.frame, y },
    }
    slide.rootOrder.push(id)
    slide.readingOrder.push(id)
  }
  return fixture
}

export function makeWidgetFixture() {
  const { document, imageBytes } = makeCoreFixture()
  document.metadata.title = 'Black-box Widget fixture'
  const widget = {
    id: IDS.widget,
    type: 'component',
    semanticKey: 'widget.code',
    role: 'body',
    frame: { x: 160, y: 760, width: 760, height: 180 },
    componentType: 'core/code',
    componentVersion: '1.0.0',
    props: { code: 'return 42', language: 'text' },
    fallback: { kind: 'placeholder', label: 'Code unavailable' },
  }
  const slide = document.slides[IDS.slide]
  slide.elements[IDS.widget] = widget
  slide.rootOrder.push(IDS.widget)
  slide.readingOrder.push(IDS.widget)
  document.widgetRequirements = [{ type: 'core/code', versionRange: '^1.0.0', fallbackRequired: true }]
  return { document, imageBytes }
}

export function makeVideoWidgetFixture() {
  const { document, imageBytes } = makeCoreFixture()
  document.metadata.title = 'Black-box Video Widget fixture'
  const video = {
    id: IDS.videoWidget,
    type: 'component',
    semanticKey: 'widget.video',
    role: 'artwork',
    frame: { x: 1040, y: 160, width: 760, height: 560 },
    componentType: 'core/video',
    componentVersion: '1.0.0',
    props: {
      source: 'media/quarterly-review.mp4',
      posterAssetId: IDS.asset,
      controls: true,
      muted: true,
    },
    fallback: { kind: 'asset', assetId: IDS.asset, label: 'Video poster' },
  }
  const slide = document.slides[IDS.slide]
  slide.elements[IDS.videoWidget] = video
  slide.rootOrder.push(IDS.videoWidget)
  slide.readingOrder.push(IDS.videoWidget)
  document.widgetRequirements = [{ type: 'core/video', versionRange: '^1.0.0', fallbackRequired: true }]
  return { document, imageBytes }
}

export function makeLegacyBoundarySource() {
  const { document, imageBytes } = makeCoreFixture()
  document.schemaVersion = '1.0.0'
  document.documentId = 'legacy_slidev_reference'
  document.metadata = { ...document.metadata, title: 'Legacy Slidev boundary fixture' }
  document.format = 'slidev'
  document.sourceFormat = 'slidev'
  const slide = document.slides[IDS.slide]
  slide.name = 'Legacy Slidev semantic source'
  slide.visualStrategy = 'poster'
  slide.elements[IDS.image].role = 'artwork'
  document.assets[IDS.asset].artwork = {
    subjectBounds: [{ x: 0.12, y: 0.1, width: 0.7, height: 0.75 }],
    safeTextRegions: [{ x: 0.02, y: 0.02, width: 0.35, height: 0.22 }],
    dominantPalette: ['#2563EB', '#F8FAFC'],
    focalPoint: { x: 0.5, y: 0.45 },
    generationPromptSummary: 'Legacy poster artwork fixture',
  }
  const chartData = {
    columns: [{ id: 'period', label: 'Period', type: 'string' }, { id: 'revenue', label: 'Revenue', type: 'number' }],
    rows: [{ id: 'q1', values: { period: 'Q1', revenue: 42 } }, { id: 'q2', values: { period: 'Q2', revenue: 38 } }],
  }
  for (const [id, chartType, x] of [['legacy_area', 'area', 1040], ['legacy_donut', 'donut', 1040]]) {
    slide.elements[id] = {
      id,
      type: 'chart',
      semanticKey: `legacy.${chartType}`,
      role: 'chart',
      frame: { x, y: id === 'legacy_area' ? 160 : 740, width: 700, height: 400 },
      chartType,
      data: clone(chartData),
      encoding: { categoryField: 'period', valueFields: ['revenue'] },
      options: { showLegend: true, showLabels: true },
      style: { styleRef: 'chart.default' },
    }
    slide.rootOrder.push(id)
    slide.readingOrder.push(id)
  }
  const widgetId = 'legacy_widget_static'
  slide.elements[widgetId] = {
    id: widgetId,
    type: 'component',
    semanticKey: 'legacy.widget',
    role: 'body',
    frame: { x: 160, y: 760, width: 760, height: 160 },
    componentType: 'legacy/kpi-widget',
    componentVersion: '1.0.0',
    props: { label: 'Revenue', value: 42 },
    fallback: { kind: 'placeholder', label: 'Legacy KPI static fallback' },
  }
  slide.rootOrder.push(widgetId)
  slide.readingOrder.push(widgetId)
  return { source: document, imageBytes }
}

export function makeOverflowDocument() {
  const document = makeCoreDocument()
  const title = document.slides[IDS.slide].elements[IDS.title]
  title.frame = { x: 160, y: 120, width: 180, height: 24 }
  title.content = richText('这是一个需要真正测量并消除溢出的超长标题文本', 'bb-overflow')
  return document
}

export function makeExportFixture() {
  const { document, imageBytes } = makeCoreFixture()
  const title = document.slides[IDS.slide].elements[IDS.title]
  title.content = {
    paragraphs: [
      { id: 'bb-export-p1', runs: [{ id: 'bb-export-r1', text: '年度经营回顾', marks: { bold: true } }] },
      { id: 'bb-export-p2', runs: [{ id: 'bb-export-r2', text: '第二段：😀', marks: { italic: true, underline: true, color: { kind: 'value', value: '#2563EB' } } }] },
    ],
  }
  title.paragraphStyle = { align: 'center' }
  title.rotationDeg = 12
  title.opacity = 0.75
  document.slides[IDS.slide].notes = { speaker: '演讲者备注', handout: '讲义内容' }
  return { document, imageBytes }
}

export function makeCrashFixture() {
  return makeCoreFixture()
}

export function makeSlideIR() {
  return {
    irVersion: '1.0',
    slideKey: 'bb-generated-slide',
    purpose: 'statement',
    message: '谨慎表达的经营结论',
    visualStrategy: 'structured',
    density: 'medium',
    blocks: [
      { key: 'bb-heading', kind: 'heading', content: '谨慎表达的新标题', semanticKey: 'title.main', importance: 'primary', editabilityTarget: 'full' },
      { key: 'bb-body', kind: 'paragraph', content: '保留原始内容并清晰表达', semanticKey: 'body.summary', importance: 'supporting', editabilityTarget: 'full' },
      { key: 'bb-image', kind: 'image', content: { assetId: IDS.asset }, semanticKey: 'image.hero', importance: 'secondary', editabilityTarget: 'replace' },
    ],
  }
}

export function addAlternateAsset(document, imageBytes) {
  const hash = bytesToSha256Placeholder(imageBytes)
  document.assets[IDS.assetNew] = {
    id: IDS.assetNew,
    hash,
    mimeType: 'image/png',
    byteLength: imageBytes.length,
    path: 'assets/new.png',
    width: 1,
    height: 1,
    source: { kind: 'generated', importedAt: '2026-09-03T00:00:00.000Z' },
    altText: 'New black-box image',
  }
  return hash
}

function bytesToSha256Placeholder(bytes) {
  return `sha256-${digest(bytes)}`
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
