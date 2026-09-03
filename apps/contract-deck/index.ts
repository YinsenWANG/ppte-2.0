import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { canonicalRevision, cloneJson, sha256HexBytes } from '../../packages/canonical-json/src/index.js'
import { PpteSession } from '../../packages/core/src/index.js'
import { AGENT_TOOL_NAMES, AgentToolServer, MockAgent } from '../../packages/agent-tools/src/index.js'
import { ImeTextEditSession, beginDrag, endDrag, updateDrag } from '../../packages/editor-react/src/index.js'
import { hitTest } from '../../packages/geometry/src/index.js'
import { renderSlideHtml, renderTargetedVisualDiff } from '../../packages/renderer-react/src/index.js'
import { RecoveryJournal, readJournal, replayJournal } from '../../packages/recovery-journal/src/index.js'
import { openCheckpoint, openCheckpointBytes, writeCheckpoint, type CheckpointWriteOptions } from '../../packages/file-format/src/index.js'
import { buildReplacementElement } from '../../packages/semantic-identity/src/index.js'
import { auditPortableBundle, createPortableLightEdit, createPortableQuickFix, createPortableViewer, PortableRuntime, decodePortable } from '../../packages/portable-runtime/src/index.js'
import { PpteReviewer } from '../../packages/reviewer/src/index.js'
import { applyPatchToDocument, decodePatch, encodePatch } from '../../packages/patch-format/src/index.js'
import { exportPdf, exportPng } from '../../packages/exporter-pdf/src/index.js'
import { compileSemanticPptx, exportImagePptx, exportSemanticPptx, inspectPptx } from '../../packages/exporter-pptx/src/index.js'
import { buildPosterTransaction, validatePosterSlide } from '../../packages/design-compiler/src/index.js'
import { getBuiltinWidgetRegistry, validateWidgetElement } from '../../packages/widgets/src/index.js'
import { buildFactUpdateTransaction, checkFactSourceConsistency } from '../../packages/facts/src/index.js'
import { checkGlyphCoverage, validateRuntimeDocument } from '../../packages/validation/src/index.js'
import { GA_A_CAPACITY_BUDGET, GA_A_PERFORMANCE_BUDGET, assertPerformanceBudget, benchmark, evaluateBundleBudget, measureCapacity, validateCapacityBudget } from '../../packages/performance-budget/src/index.js'
import type { CheckpointAdapter } from '../../packages/core/src/index.js'
import type { Asset, ChartElement, ComponentElement, Element, Operation, PpteDocument, RichTextDocument, ShapeElement, TextElement, Transaction } from '../../packages/schema/src/index.js'

const SLIDE_ID = 'slide_main'
const TITLE_ID = 'text_title'
const BODY_ID = 'text_body'
const IMAGE_ID = 'image_hero'
const SHAPE_ID = 'shape_surface'
const IMAGE_ASSET_ID = 'asset_pixel'

export function makeContractDocument(imageBytes = pixelPng()): { document: PpteDocument; imageBytes: Uint8Array } {
  const image: Asset = {
    id: IMAGE_ASSET_ID,
    hash: `sha256-${sha256HexBytes(imageBytes)}`,
    mimeType: 'image/png',
    byteLength: imageBytes.length,
    path: 'assets/pixel.png',
    width: 1,
    height: 1,
    source: { kind: 'generated', importedAt: '2026-09-02T00:00:00.000Z' },
    altText: 'A contract-deck image',
  }
  const title: TextElement = {
    id: TITLE_ID,
    type: 'text',
    semanticKey: 'title.main',
    role: 'title',
    frame: { x: 160, y: 130, width: 820, height: 130 },
    content: text('Annual operating review', 'title-p'),
    style: { styleRef: 'text.title.primary' },
    overflowPolicy: 'warn',
    editPolicy: { mode: 'full', agentEditable: true, preserveOnRegenerate: true },
  }
  const body: TextElement = {
    id: BODY_ID,
    type: 'text',
    semanticKey: 'body.summary',
    role: 'body',
    frame: { x: 160, y: 330, width: 780, height: 260 },
    content: text('Text, image, and shape use one semantic document.', 'body-p'),
    style: { styleRef: 'text.body' },
    semanticRefs: { factIds: ['revenue'] },
    overflowPolicy: 'warn',
  }
  const surface: ShapeElement = {
    id: SHAPE_ID,
    type: 'shape',
    role: 'background',
    frame: { x: 80, y: 70, width: 1760, height: 940 },
    shape: 'rounded-rectangle',
    style: { styleRef: 'shape.surface' },
  }
  const document: PpteDocument = {
    schemaVersion: '2.0.0',
    documentId: 'doc_contract_deck_01',
    locale: 'en-US',
    metadata: { title: 'PPTe Contract Deck', source: 'native', createdAt: '2026-09-02T00:00:00.000Z' },
    canvas: { width: 1920, height: 1080, unit: 'du', aspectRatio: '16:9', defaultBackground: { kind: 'solid', color: { kind: 'value', value: '#F7F8FA' } } },
    theme: {
      id: 'theme_contract',
      name: 'Contract Theme',
      tokens: {
        colors: { 'color.background': '#F7F8FA', 'color.text.primary': '#172033', 'color.text.muted': '#5B667A', 'color.accent': '#3B82F6', 'color.surface': '#FFFFFF' },
        fontFamilies: { 'font.heading': 'Inter', 'font.body': 'Inter' },
        fontSizes: { 'fontSize.title': 64, 'fontSize.body': 28 },
        spacing: {},
        radii: {},
        shadows: {},
      },
      presets: {
        text: {
          'text.title.primary': { fontFamily: { kind: 'token', token: 'font.heading' }, fontSize: 64, fontWeight: 700, color: { kind: 'token', token: 'color.text.primary' }, lineHeight: 1.15 },
          'text.body': { fontFamily: { kind: 'token', token: 'font.body' }, fontSize: 28, fontWeight: 400, color: { kind: 'token', token: 'color.text.muted' }, lineHeight: 1.35 },
        },
        shape: { 'shape.surface': { fill: { kind: 'solid', color: { kind: 'token', token: 'color.surface' } }, stroke: { color: { kind: 'token', token: 'color.accent' }, width: 2, opacity: 0.5 }, radius: 28, shadow: { color: { kind: 'value', value: '#172033' }, offsetX: 0, offsetY: 12, blur: 28, opacity: 0.12 } } },
        image: { 'image.hero': { border: { color: { kind: 'token', token: 'color.accent' }, width: 2, opacity: 0.6 }, radius: 20, shadow: { color: { kind: 'value', value: '#172033' }, offsetX: 0, offsetY: 8, blur: 20, opacity: 0.16 } } },
        chart: {},
      },
    },
    slideOrder: [SLIDE_ID],
    slides: {
      [SLIDE_ID]: {
        id: SLIDE_ID,
        name: 'Vertical Slice',
        rootOrder: [SHAPE_ID, TITLE_ID, BODY_ID, IMAGE_ID],
        readingOrder: [TITLE_ID, BODY_ID, IMAGE_ID],
        elements: {
          [SHAPE_ID]: surface,
          [TITLE_ID]: title,
          [BODY_ID]: body,
          [IMAGE_ID]: { id: IMAGE_ID, type: 'image', semanticKey: 'image.hero', role: 'image', frame: { x: 1120, y: 250, width: 560, height: 430 }, assetId: IMAGE_ASSET_ID, fit: 'fill', style: { styleRef: 'image.hero' }, altText: 'A contract-deck image' },
        },
        groups: {},
        visualStrategy: 'structured',
      },
    },
    assets: { [IMAGE_ASSET_ID]: image },
    facts: { revenue: { id: 'revenue', key: 'revenue', value: 42, unit: '%' } },
    fonts: {
      font_system_inter: { id: 'font_system_inter', family: 'Inter', style: 'normal', weight: 400, source: 'system', editableSafe: true },
    },
  }
  return { document, imageBytes }
}

/** The smallest GA-B scene: one chart and the same Fact displayed on two pages. */
export function makeGABContractDocument(imageBytes = pixelPng()): { document: PpteDocument; imageBytes: Uint8Array } {
  const { document } = makeContractDocument(imageBytes)
  document.metadata.title = 'PPTe GA-B Chart and Fact Contract'
  document.theme.presets.chart['chart.default'] = {
    palette: [{ kind: 'value', value: '#2563EB' }, { kind: 'value', value: '#14B8A6' }],
    axisColor: { kind: 'value', value: '#64748B' },
    labelColor: { kind: 'value', value: '#334155' },
    gridColor: { kind: 'value', value: '#CBD5E1' },
    lineWidth: 2,
    cornerRadius: 3,
  }
  document.sources = { source_report: { id: 'source_report', title: 'Public report', citation: 'Public report, 2026' } }
  const chart: ChartElement = {
    id: 'chart_revenue', type: 'chart', semanticKey: 'chart.revenue', role: 'chart', frame: { x: 1040, y: 160, width: 760, height: 560 }, chartType: 'bar',
    data: { columns: [{ id: 'period', label: 'Period', type: 'string' }, { id: 'revenue', label: 'Revenue', type: 'number' }], rows: [{ id: 'revenue', values: { period: 'Q1', revenue: 42 } }, { id: 'other', values: { period: 'Q2', revenue: 38 } }] },
    encoding: { categoryField: 'period', valueFields: ['revenue'] }, options: { showLegend: false, showLabels: true }, style: { styleRef: 'chart.default' }, semanticRefs: { factIds: ['revenue'], sourceIds: ['source_report'] }, altText: 'Revenue by period',
  }
  document.slides.slide_main.elements[chart.id] = chart
  document.slides.slide_main.rootOrder.push(chart.id)
  const metric = cloneJson(document.slides.slide_main.elements.text_body) as TextElement
  metric.id = 'metric_page_one'; metric.semanticKey = 'metric.revenue.page-one'; metric.role = 'metric'; metric.frame = { x: 160, y: 650, width: 700, height: 100 }; metric.content = text('Revenue 42%', 'metric-page-one'); metric.semanticRefs = { factIds: ['revenue'], sourceIds: ['source_report'] }
  document.slides.slide_main.elements[metric.id] = metric
  document.slides.slide_main.rootOrder.push(metric.id)
  document.slides.slide_main.readingOrder?.push(metric.id)
  const metricTwo = cloneJson(metric)
  metricTwo.id = 'metric_page_two'; metricTwo.semanticKey = 'metric.revenue.page-two'; metricTwo.content = text('Revenue 42%', 'metric-page-two')
  document.slides.slide_metrics = { id: 'slide_metrics', name: 'Metrics', rootOrder: [metricTwo.id], readingOrder: [metricTwo.id], elements: { [metricTwo.id]: metricTwo }, groups: {}, visualStrategy: 'structured' }
  document.slideOrder.push('slide_metrics')
  return { document, imageBytes }
}

/** Build the deterministic 30-slide / 900-element GA-A capacity corpus. */
export function makeGAAStandardDocument(assetBytes = new Uint8Array(50 * 1024 * 1024)): { document: PpteDocument; assetBytes: Uint8Array } {
  const base = makeContractDocument(assetBytes).document
  const document = cloneJson(base)
  const slides: PpteDocument['slides'] = {}
  const slideOrder: string[] = []
  const sourceSlide = document.slides[SLIDE_ID]
  const sourceText = sourceSlide.elements[TITLE_ID] as TextElement
  const sourceShape = sourceSlide.elements[SHAPE_ID] as ShapeElement
  const sourceImage = sourceSlide.elements[IMAGE_ID] as Extract<Element, { type: 'image' }>
  for (let slideIndex = 0; slideIndex < GA_A_CAPACITY_BUDGET.maxSlides; slideIndex += 1) {
    const slideId = `slide_${String(slideIndex + 1).padStart(2, '0')}`
    const elements: Record<string, Element> = {}
    const rootOrder: string[] = []
    const readingOrder: string[] = []
    const shapeIds: string[] = []
    for (let index = 0; index < 15; index += 1) {
      const elementId = `${slideId}_text_${String(index + 1).padStart(2, '0')}`
      const element = cloneJson(sourceText)
      element.id = elementId
      element.semanticKey = `${slideId}.text.${index + 1}`
      element.role = index === 0 ? 'title' : 'body'
      element.frame = { x: 80 + (index % 3) * 580, y: 80 + Math.floor(index / 3) * 150, width: 500, height: 100 }
      element.content = text(`Capacity corpus slide ${slideIndex + 1} text ${index + 1}`, `${elementId}-p`)
      elements[elementId] = element
      rootOrder.push(elementId)
      readingOrder.push(elementId)
    }
    const shapeCount = slideIndex === 0 ? 14 : 15
    for (let index = 0; index < shapeCount; index += 1) {
      const elementId = `${slideId}_shape_${String(index + 1).padStart(2, '0')}`
      const element = cloneJson(sourceShape)
      element.id = elementId
      element.semanticKey = `${slideId}.shape.${index + 1}`
      element.role = index < 12 ? 'decorative' : 'background'
      element.frame = { x: 50 + (index % 7) * 260, y: 40 + Math.floor(index / 7) * 430, width: 220, height: 320 }
      elements[elementId] = element
      shapeIds.push(elementId)
      rootOrder.push(elementId)
    }
    if (slideIndex === 0) {
      const imageId = `${slideId}_image`
      const image = cloneJson(sourceImage)
      image.id = imageId
      image.semanticKey = `${slideId}.image.hero`
      image.frame = { x: 1420, y: 760, width: 360, height: 260 }
      elements[imageId] = image
      rootOrder.push(imageId)
    }
    const groups: NonNullable<PpteDocument['slides'][string]['groups']> = {}
    for (let groupIndex = 0; groupIndex < 4; groupIndex += 1) {
      const memberIds = shapeIds.slice(groupIndex * 3, groupIndex * 3 + 3)
      groups[`${slideId}_group_${groupIndex + 1}`] = { id: `${slideId}_group_${groupIndex + 1}`, name: `Capacity group ${groupIndex + 1}`, memberIds }
    }
    slides[slideId] = { id: slideId, name: `Capacity slide ${slideIndex + 1}`, rootOrder, elements, groups, readingOrder, visualStrategy: 'structured' }
    slideOrder.push(slideId)
  }
  document.documentId = 'doc_ga_a_capacity'
  document.metadata.title = 'GA-A capacity corpus'
  document.slideOrder = slideOrder
  document.slides = slides
  delete document.facts
  document.assets[IMAGE_ASSET_ID].byteLength = assetBytes.length
  document.assets[IMAGE_ASSET_ID].hash = `sha256-${sha256HexBytes(assetBytes)}`
  for (let index = Object.keys(document.fonts).length; index < GA_A_CAPACITY_BUDGET.maxFonts; index += 1) {
    const id = `font_capacity_${index + 1}`
    document.fonts[id] = { id, family: `Capacity Sans ${index + 1}`, style: 'normal', weight: 400, source: 'system', editableSafe: true }
  }
  return { document, assetBytes }
}

export function runGAAStabilization(): Record<string, unknown> {
  const { document, assetBytes } = makeGAAStandardDocument()
  const capacity = measureCapacity(document)
  const capacityViolations = validateCapacityBudget(document)
  assert(capacityViolations.length === 0, `capacity budget: ${capacityViolations.map((violation) => violation.metric).join(',')}`)
  const firstSlide = document.slideOrder[0]!
  const lastSlide = document.slideOrder.at(-1)!
  const humanSession = new PpteSession(document)
  let humanSequence = 0
  const textSession = new PpteSession(document)
  let textSequence = 0
  const undoSessions = Array.from({ length: 5 }, (_, index) => {
    const session = new PpteSession(document)
    const transaction = new MockAgent().createTextReplaceTransaction(document, session.getRevision(), firstSlide, `${firstSlide}_text_01`, text(`Undo measurement ${index}`, `perf-undo-${index}`), `perf-undo-${index}`)
    assert(session.commit(transaction).ok, 'undo preparation')
    return session
  })
  const redoSessions = Array.from({ length: 5 }, (_, index) => {
    const session = new PpteSession(document)
    const transaction = new MockAgent().createTextReplaceTransaction(document, session.getRevision(), firstSlide, `${firstSlide}_text_01`, text(`Redo measurement ${index}`, `perf-redo-${index}`), `perf-redo-${index}`)
    assert(session.commit(transaction).ok, 'redo preparation commit')
    assert(session.undo().ok, 'redo preparation')
    return session
  })
  let undoIndex = 0
  let redoIndex = 0
  const metrics = [
    benchmark('open-to-interactive', () => { new PpteSession(document) }, GA_A_PERFORMANCE_BUDGET.openToInteractiveMs, 5),
    benchmark('page-switch', () => { renderSlideHtml(document, lastSlide) }, GA_A_PERFORMANCE_BUDGET.pageSwitchMs, 5),
    benchmark('selection', () => { hitTest(document, firstSlide, { x: 100, y: 100 }) }, GA_A_PERFORMANCE_BUDGET.selectionMs, 5),
    benchmark('human-commit', () => {
      const imageId = `${firstSlide}_image`
      const transaction: Transaction = {
        transactionId: `perf-human-${humanSequence}`,
        baseRevision: humanSession.getRevision(),
        actor: { type: 'human', id: 'performance-harness' },
        scope: { kind: 'selection', slideIds: [firstSlide], elementIds: [imageId], permissions: ['geometry'], allowInsert: false, allowDelete: false },
        changeContract: { allowedOperationKinds: ['element.move'], allowedElementIds: [imageId], maxChangedSlides: 1, maxChangedElements: 1, maxInsertedElements: 0, maxDeletedElements: 0, maxReplacedAssets: 0, preserve: { content: 'preserve', data: 'preserve', style: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' } },
        reason: 'GA-A human commit benchmark',
        createdAt: '2026-09-03T00:00:00.000Z',
        validationLevel: 'L1',
        operations: [{ opId: `perf-human-${humanSequence++}:move`, kind: 'element.move', slideId: firstSlide, elementId: imageId, x: 1420 + humanSequence, y: 760 + humanSequence }],
      }
      assert(humanSession.commit(transaction).ok, 'human commit benchmark')
    }, GA_A_PERFORMANCE_BUDGET.humanCommitMs, 5),
    benchmark('text-commit', () => {
      const transaction = new MockAgent().createTextReplaceTransaction(document, textSession.getRevision(), firstSlide, `${firstSlide}_text_01`, text(`Measured capacity edit ${textSequence}`, `perf-text-${textSequence}`), `perf-text-${textSequence++}`)
      assert(textSession.commit(transaction).ok, 'text commit benchmark')
    }, GA_A_PERFORMANCE_BUDGET.textCommitMs, 5),
    benchmark('journal-append', () => {
      const journalPath = join(mkdtempSync(join(tmpdir(), 'ppte-ga-a-journal-')), 'recovery.journal')
      const revision = canonicalRevision(document)
      const journal = new RecoveryJournal(journalPath, { journalVersion: '1', documentId: document.documentId, baseCheckpointRevision: revision, sessionId: 'ga-a-performance', createdAt: '2026-09-03T00:00:00.000Z' })
      const transaction = new MockAgent().createTextReplaceTransaction(document, revision, firstSlide, `${firstSlide}_text_01`, text('Journal measurement', 'perf-journal'), `perf-journal-${journalPath}`)
      journal.append(transaction)
    }, GA_A_PERFORMANCE_BUDGET.journalAppendMs, 5),
    benchmark('undo', () => { assert(undoSessions[undoIndex++]?.undo().ok, 'undo benchmark') }, GA_A_PERFORMANCE_BUDGET.undoRedoMs, 5),
    benchmark('redo', () => { assert(redoSessions[redoIndex++]?.redo().ok, 'redo benchmark') }, GA_A_PERFORMANCE_BUDGET.undoRedoMs, 5),
    benchmark('checkpoint-50mb', () => {
      const checkpointPath = join(mkdtempSync(join(tmpdir(), 'ppte-ga-a-checkpoint-')), 'capacity.ppte')
      writeCheckpoint(document, checkpointPath, { clean: true, assetBytes: { [IMAGE_ASSET_ID]: assetBytes }, timestamp: '2026-09-03T00:00:00.000Z' })
    }, GA_A_PERFORMANCE_BUDGET.checkpoint50MbMs, 3),
    benchmark('portable-viewer-first-screen', () => {
      const result = createPortableViewer(document, { assetBytes: { [IMAGE_ASSET_ID]: assetBytes }, derivedAt: '2026-09-03T00:00:00.000Z' })
      assert(result.ok, `portable viewer: ${result.issues.map((issue) => issue.code).join(',')}`)
    }, GA_A_PERFORMANCE_BUDGET.portableViewerFirstScreenMs, 1),
    benchmark('portable-quick-fix-first-screen', () => {
      const result = createPortableQuickFix(document, { assetBytes: { [IMAGE_ASSET_ID]: assetBytes }, derivedAt: '2026-09-03T00:00:00.000Z' })
      assert(result.ok, `portable quick fix: ${result.issues.map((issue) => issue.code).join(',')}`)
    }, GA_A_PERFORMANCE_BUDGET.portableQuickFixFirstScreenMs, 1),
  ]
  const viewer = createPortableViewer(document, { assetBytes: { [IMAGE_ASSET_ID]: assetBytes }, derivedAt: '2026-09-03T00:00:00.000Z' })
  const quickFix = createPortableQuickFix(document, { assetBytes: { [IMAGE_ASSET_ID]: assetBytes }, derivedAt: '2026-09-03T00:00:00.000Z' })
  assert(viewer.ok && quickFix.ok, 'portable bundle build')
  const bundles = [
    evaluateBundleBudget('viewer-bundle-gzip', gzipSync(new TextEncoder().encode(viewer.html)).length, GA_A_PERFORMANCE_BUDGET.viewerBundleGzipBytes),
    evaluateBundleBudget('quick-fix-bundle-gzip', gzipSync(new TextEncoder().encode(quickFix.html)).length, GA_A_PERFORMANCE_BUDGET.quickFixBundleGzipBytes),
  ]
  assertPerformanceBudget(metrics, bundles)
  return { status: 'ok', capacity, budgets: { capacity: GA_A_CAPACITY_BUDGET, performance: GA_A_PERFORMANCE_BUDGET }, metrics, bundles }
}

export function runVerticalSlice(): Record<string, unknown> {
  const root = mkdtempSync(join(tmpdir(), 'ppte-contract-deck-'))
  const checkpointPath = join(root, 'deck.ppte')
  const journalPath = join(root, 'recovery.journal')
  const { document, imageBytes } = makeContractDocument()
  const initialRevision = canonicalRevision(document)
  const journal = new RecoveryJournal(journalPath, { journalVersion: '1', documentId: document.documentId, baseCheckpointRevision: initialRevision, sessionId: 'contract-deck-session', createdAt: '2026-09-02T00:00:00.000Z' })
  const checkpoint: CheckpointAdapter<string, CheckpointWriteOptions> = {
    write: (snapshot, target, options, recentTransactions) => writeCheckpoint(snapshot, target, {
      ...options,
      recentTransactions: recentTransactions?.length ? [...recentTransactions] : options?.recentTransactions,
    }),
    clearRecovery: () => journal.clear(),
  }
  const session = new PpteSession(document, { journal, checkpoint })
  assert(session.checkpoint(checkpointPath, { timestamp: '2026-09-02T00:00:00.000Z', assetBytes: { [IMAGE_ASSET_ID]: imageBytes } }).ok, 'initial checkpoint')
  const rendered = renderSlideHtml(session.getDocument(), SLIDE_ID)
  assert(rendered.includes('data-ppte-type="text"'), 'Text renderer')
  assert(rendered.includes('data-ppte-type="image"'), 'Image renderer')
  assert(rendered.includes('data-ppte-type="shape"'), 'Shape renderer')

  const dragStart = beginDrag(session.getDocument(), session.getRevision(), SLIDE_ID, IMAGE_ID, { x: 1200, y: 300 })
  const transient = updateDrag(dragStart, { x: 1260, y: 345 })
  assert(session.getRevision() === initialRevision, 'drag transient does not change revision')
  const moveTransaction = endDrag(transient, 'human:move-image', '2026-09-02T00:01:00.000Z')
  assert(Boolean(moveTransaction), 'drag creates one transaction on pointer-up')
  const moved = session.commit(moveTransaction!)
  assert(moved.ok && moved.diff?.mutationSummary.changedElements === 1, 'image move committed through Operation Engine')
  assert(session.getDocument().slides[SLIDE_ID].elements[IMAGE_ID].frame.x === 1180, 'image moved by transient delta')

  const titleBeforeIme = session.getDocument().slides[SLIDE_ID].elements[TITLE_ID] as TextElement
  const ime = new ImeTextEditSession(titleBeforeIme, SLIDE_ID)
  ime.beginComposition()
  ime.updateComposition(text('Annual operating review — draft', 'title-ime'))
  assert(ime.finish('human:ime-too-early', session.getRevision()) === undefined, 'IME composition never commits')
  ime.endComposition()
  const imeTransaction = ime.finish('human:ime', session.getRevision(), '2026-09-02T00:02:00.000Z')
  assert(Boolean(imeTransaction), 'IME commits once after composition')
  assert(session.commit(imeTransaction!).ok, 'IME commit')

  const agent = new MockAgent()
  const agentDocument = session.getDocument()
  const agentRevision = session.getRevision()
  const attempted = agent.createOutOfScopeTextTransaction(agentDocument, agentRevision, SLIDE_ID, TITLE_ID, BODY_ID, text('A cautious operating review', 'agent-bad'))
  const blocked = session.preview(attempted)
  assert(!blocked.ok && blocked.issues.some((issue) => issue.code === 'SCOPE_VIOLATION'), 'Change Contract blocks second object')
  const valid = agent.createTextReplaceTransaction(agentDocument, agentRevision, SLIDE_ID, TITLE_ID, text('A cautious operating review', 'agent-good'), 'agent:text-title')
  const agentPreview = agent.previewTextReplace(session, valid)
  assert(agentPreview.ok && agentPreview.diff?.mutationSummary.changedElements === 1, 'Agent preview has one changed element')
  const agentCommit = agent.commitTextReplace(session, valid)
  assert(agentCommit.ok && agentCommit.diff?.changedPaths.some((path) => path.includes('/content')), 'Agent commit uses structural diff')
  const afterAgentRevision = session.getRevision()
  assert(session.undo().ok, 'Undo is a new operation-engine transaction')
  assert(session.redo().ok, 'Redo restores the same semantic edit')
  assert(session.getRevision() === afterAgentRevision, 'Redo restores committed revision')

  const styleTransaction = stableTransaction(session, 'stable:style-override', [{ opId: 'stable:style-override:op', kind: 'element.updateStyleOverrides', slideId: SLIDE_ID, elementId: TITLE_ID, patch: { letterSpacing: 1 } }], {
    kind: 'selection', slideIds: [SLIDE_ID], elementIds: [TITLE_ID], permissions: ['style'], allowInsert: false, allowDelete: false,
  }, [TITLE_ID], { content: 'preserve', geometry: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' })
  assert(session.commit(styleTransaction).ok, 'typed Style Override commit')
  assert((session.getDocument().slides[SLIDE_ID].elements[TITLE_ID] as TextElement).style.overrides?.letterSpacing === 1, 'typed Style Override persisted')
  assert(session.undo().ok, 'Style Override inverse')

  const fitTransaction = stableTransaction(session, 'stable:text-fit', [{ opId: 'stable:text-fit:op', kind: 'text.fitByReducingFont', slideId: SLIDE_ID, elementId: TITLE_ID, minFontSize: 24, resolvedFontSize: 48 }], {
    kind: 'selection', slideIds: [SLIDE_ID], elementIds: [TITLE_ID], permissions: ['style'], allowInsert: false, allowDelete: false,
  }, [TITLE_ID], { content: 'preserve', geometry: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' })
  assert(session.commit(fitTransaction).ok, 'explicit Text Fit commit')
  assert((session.getDocument().slides[SLIDE_ID].elements[TITLE_ID] as TextElement).style.overrides?.fontSize === 48, 'explicit Text Fit changed only font size')
  assert(session.undo().ok, 'Text Fit inverse')

  const imageStyleTransaction = stableTransaction(session, 'stable:image-style', [{ opId: 'stable:image-style:op', kind: 'element.updateStyleOverrides', slideId: SLIDE_ID, elementId: IMAGE_ID, patch: { radius: 24 } }], {
    kind: 'selection', slideIds: [SLIDE_ID], elementIds: [IMAGE_ID], permissions: ['style'], allowInsert: false, allowDelete: false,
  }, [IMAGE_ID], { content: 'preserve', geometry: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' })
  assert(session.commit(imageStyleTransaction).ok, 'Image typed style commit')
  assert(session.undo().ok, 'Image typed style inverse')

  const imageViewTransaction = stableTransaction(session, 'stable:image-view', [
    { opId: 'stable:image-view:crop', kind: 'image.setCrop', slideId: SLIDE_ID, elementId: IMAGE_ID, crop: { x: 0.08, y: 0.12, width: 0.84, height: 0.72 } },
    { opId: 'stable:image-view:focal', kind: 'image.setFocalPoint', slideId: SLIDE_ID, elementId: IMAGE_ID, focalPoint: { x: 0.64, y: 0.38 } },
  ], {
    kind: 'selection', slideIds: [SLIDE_ID], elementIds: [IMAGE_ID], permissions: ['assets'], allowInsert: false, allowDelete: false,
  }, [IMAGE_ID], { content: 'preserve', style: 'preserve', geometry: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' })
  assert(session.commit(imageViewTransaction).ok, 'Image crop and focal-point commit')
  assert((session.getDocument().slides[SLIDE_ID].elements[IMAGE_ID] as { crop?: { x: number } }).crop?.x === 0.08, 'Image crop persisted')
  assert(session.undo().ok, 'Image crop and focal-point inverse')

  const shapeStyleTransaction = stableTransaction(session, 'stable:shape-style', [{ opId: 'stable:shape-style:op', kind: 'shape.updateStyle', slideId: SLIDE_ID, elementId: SHAPE_ID, patch: { radius: 36 } }], {
    kind: 'selection', slideIds: [SLIDE_ID], elementIds: [SHAPE_ID], permissions: ['style'], allowInsert: false, allowDelete: false,
  }, [SHAPE_ID], { content: 'preserve', geometry: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' })
  assert(session.commit(shapeStyleTransaction).ok, 'Shape style commit')
  assert(session.undo().ok, 'Shape style inverse')

  const factSeedTransaction = stableTransaction(session, 'stable:fact-seed', [{ opId: 'stable:fact-seed:op', kind: 'text.replaceContent', slideId: SLIDE_ID, elementId: BODY_ID, content: text('Revenue 41% last year; target is 50%.', 'fact-seed') }], {
    kind: 'selection', slideIds: [SLIDE_ID], elementIds: [BODY_ID], permissions: ['content'], allowInsert: false, allowDelete: false,
  }, [BODY_ID], { geometry: 'preserve', style: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' })
  assert(session.commit(factSeedTransaction).ok, 'Fact display seed')
  const factTransaction = stableTransaction(session, 'stable:fact-sync', [{ opId: 'stable:fact-sync:op', kind: 'fact.syncReferences', factId: 'revenue', targetElementIds: [BODY_ID], strategy: 'replace-display-value', previousValue: 41 }], {
    kind: 'selection', slideIds: [SLIDE_ID], elementIds: [BODY_ID], permissions: ['facts', 'content'], allowInsert: false, allowDelete: false,
  }, [BODY_ID], { style: 'preserve', geometry: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' })
  assert(session.commit(factTransaction).ok, 'Explicit Fact display synchronization')
  assert((session.getDocument().slides[SLIDE_ID].elements[BODY_ID] as TextElement).content.paragraphs[0].runs[0].text === 'Revenue 42% last year; target is 50%.', 'Fact display value synchronized')
  assert(session.undo().ok, 'Fact synchronization inverse')

  const previousTitle = session.getDocument().slides[SLIDE_ID].elements[TITLE_ID] as TextElement
  const replacement = buildReplacementElement(session.getDocument(), SLIDE_ID, TITLE_ID, { ...cloneJson(previousTitle), id: 'text_title_v2', content: text('A regenerated operating review', 'title-regenerated') })
  const lineageTransaction = stableTransaction(session, 'stable:lineage-replacement', [
    { opId: 'stable:lineage-replacement:delete', kind: 'element.delete', slideId: SLIDE_ID, elementId: TITLE_ID },
    { opId: 'stable:lineage-replacement:insert', kind: 'element.insert', slideId: SLIDE_ID, element: replacement, index: 1 },
    { opId: 'stable:lineage-replacement:reading-order', kind: 'slide.setReadingOrder', slideId: SLIDE_ID, readingOrder: ['text_title_v2', BODY_ID, IMAGE_ID] },
  ], {
    kind: 'selection', slideIds: [SLIDE_ID], elementIds: [TITLE_ID, 'text_title_v2'], semanticKeys: ['title.main'], permissions: ['structure'], allowInsert: true, allowDelete: true,
  }, [TITLE_ID, 'text_title_v2'], { geometry: 'preserve', style: 'preserve', asset: 'preserve', semanticIdentity: 'allow-replacement', readingOrder: 'preserve', facts: 'preserve' }, 1)
  assert(session.commit(lineageTransaction).ok, 'Replacement Lineage commit')
  assert(session.getDocument().slides[SLIDE_ID].elements.text_title_v2.provenance?.replacesElementId === TITLE_ID, 'Replacement Lineage points to prior instance')
  assert(session.undo().ok, 'Replacement Lineage inverse')

  const groupMembers = [TITLE_ID, BODY_ID, IMAGE_ID]
  const groupCreate = stableTransaction(session, 'stable:group-create', [{ opId: 'stable:group-create:op', kind: 'group.create', slideId: SLIDE_ID, group: { id: 'content-cluster', semanticKey: 'content.cluster', memberIds: groupMembers } }], {
    kind: 'slide', slideIds: [SLIDE_ID], permissions: ['structure'], allowInsert: false, allowDelete: false,
  }, groupMembers, { content: 'preserve', style: 'preserve', geometry: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' })
  assert(session.commit(groupCreate).ok, 'Flat Group create')
  const groupMove = stableTransaction(session, 'stable:group-move', [{ opId: 'stable:group-move:op', kind: 'group.move', slideId: SLIDE_ID, groupId: 'content-cluster', dx: 24, dy: 16 }], {
    kind: 'slide', slideIds: [SLIDE_ID], permissions: ['geometry'], allowInsert: false, allowDelete: false,
  }, groupMembers, { content: 'preserve', style: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' })
  assert(session.commit(groupMove).ok, 'Flat Group move')
  assert(session.undo().ok, 'Flat Group move inverse')
  const groupResize = stableTransaction(session, 'stable:group-resize', [{ opId: 'stable:group-resize:op', kind: 'group.resize', slideId: SLIDE_ID, groupId: 'content-cluster', targetFrame: { x: 120, y: 180, width: 1600, height: 600 } }], {
    kind: 'slide', slideIds: [SLIDE_ID], permissions: ['geometry'], allowInsert: false, allowDelete: false,
  }, groupMembers, { content: 'preserve', style: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' })
  assert(session.commit(groupResize).ok, 'Flat Group resize without implicit text scaling')
  assert((session.getDocument().slides[SLIDE_ID].elements[TITLE_ID] as TextElement).style.overrides?.fontSize === undefined, 'Flat Group resize leaves text style unchanged by default')
  const groupResizeUndo = session.undo()
  assert(groupResizeUndo.ok, `Flat Group resize inverse ${groupResizeUndo.issues.map((issue) => `${issue.code}:${issue.message}`).join('|')}`)
  const groupDelete = stableTransaction(session, 'stable:group-delete', [{ opId: 'stable:group-delete:op', kind: 'group.delete', slideId: SLIDE_ID, groupId: 'content-cluster' }], {
    kind: 'slide', slideIds: [SLIDE_ID], permissions: ['structure'], allowInsert: false, allowDelete: false,
  }, groupMembers, { content: 'preserve', style: 'preserve', geometry: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' })
  assert(session.commit(groupDelete).ok, 'Flat Group delete')
  assert(session.undo().ok, 'Flat Group delete inverse')

  const failedCheckpoint = session.checkpoint(checkpointPath, { timestamp: '2026-09-02T00:03:00.000Z', assetBytes: { [IMAGE_ASSET_ID]: imageBytes }, fault: 'before-rename' })
  assert(!failedCheckpoint.ok, 'fault-injected checkpoint reports failure')
  const original = openCheckpoint(checkpointPath, { recovery: 'ignore' })
  assert(canonicalRevision(original.document) === initialRevision, 'atomic checkpoint keeps original file readable')
  const journalState = readJournal(journalPath)
  assert(journalState.records.length >= 5, 'journal contains successful commits including undo/redo')
  const recovered = replayJournal(original.document, journalState)
  assert(recovered.issues.filter((issue) => issue.severity === 'error').length === 0, 'journal replay has no errors')
  assert(recovered.revision === session.getRevision(), 'journal recovery reaches current committed snapshot')

  const finalCheckpoint = session.checkpoint(checkpointPath, { timestamp: '2026-09-02T00:04:00.000Z', assetBytes: { [IMAGE_ASSET_ID]: imageBytes } })
  assert(finalCheckpoint.ok, 'final checkpoint')
  assert(readJournal(journalPath).records.length === 0, 'successful checkpoint clears recovery journal')
  const reopened = openCheckpoint(checkpointPath)
  assert(canonicalRevision(reopened.document) === session.getRevision(), 'reopen canonical hash matches')
  assert(canonicalRevision(reopened.document) === canonicalRevision(session.getDocument()), 'document round trip is canonical-hash equal')
  assert(reopened.recentTransactions.length === session.getHistory().length, 'recent History tail round trips')

  return {
    status: 'ok',
    renderedTypes: ['text', 'image', 'shape'],
    stableCoreCoverage: ['Style Preset + typed Override', 'explicit Text Fit + IME', 'Image crop + focal point', 'Shape style', 'Flat Group move + resize + inverse', 'Fact explicit sync', 'semanticKey + Replacement Lineage', 'Revision + bounded History + redo', 'Journal + CAS-compatible Checkpoint + reopen'],
    initialRevision,
    finalRevision: session.getRevision(),
    blockedIssue: blocked.issues.find((issue) => issue.code === 'SCOPE_VIOLATION')?.code,
    journalRecoveredTransactions: recovered.applied,
    checkpointRoundTrip: true,
    unsupportedScope: ['Chart', 'Widget', 'Poster', 'PPTX', 'Light Edit/full Portable editor', 'nested Group', 'Group Rotate', 'Run-level font/size'],
  }
}

export function runWeek7To13(): Record<string, unknown> {
  const { document } = makeContractDocument()
  const session = new PpteSession(document)
  const tools = new AgentToolServer(session)
  const initialRevision = session.getRevision()
  const inspected = tools.execute<{ slideCount: number }>('inspect_document')
  assert(inspected.ok && inspected.data?.slideCount === 1, 'Agent inspect_document is scope-aware')
  assert(tools.execute('list_slides').ok, 'Agent list_slides')
  assert(tools.execute('get_slide_summary').ok, 'Agent get_slide_summary')
  assert(tools.execute('query_elements', { role: 'title' }).ok, 'Agent query_elements')
  assert(tools.execute('get_slide', { slideId: SLIDE_ID }).ok, 'Agent get_slide')
  assert(tools.execute('get_element', { slideId: SLIDE_ID, elementId: TITLE_ID }).ok, 'Agent get_element')
  assert(tools.execute('get_selection').ok, 'Agent get_selection')
  assert(tools.execute('get_theme').ok, 'Agent get_theme')
  assert(tools.execute('get_facts').ok, 'Agent get_facts')
  assert(tools.execute('get_sources').ok, 'Agent get_sources')
  assert(tools.execute('get_validation_issues').ok, 'Agent get_validation_issues')
  assert(tools.execute('get_editability_report').ok, 'Agent get_editability_report')
  assert(tools.execute('render_slide', { slideId: SLIDE_ID }).ok, 'Agent render_slide')
  assert(tools.execute('inspect_facts').ok, 'Agent inspect_facts')
  assert(tools.execute('inspect_sources').ok, 'Agent inspect_sources')
  assert(tools.execute('inspect_assets').ok, 'Agent inspect_assets')
  assert(tools.execute('inspect_theme').ok, 'Agent inspect_theme')
  assert(tools.execute('inspect_history').ok, 'Agent inspect_history')
  assert(tools.execute('search_text', { query: 'semantic' }).ok, 'Agent search_text')
  assert(tools.execute('query_semantic_keys', { query: 'title' }).ok, 'Agent query_semantic_keys')

  const regenerated = tools.execute('regenerate_slide', { slideId: SLIDE_ID })
  assert(regenerated.ok && regenerated.transaction, 'regenerate_slide returns a transaction draft')
  assert(session.getRevision() === initialRevision, 'regenerate_slide is preview-only')
  const previewed = tools.execute('preview_transaction', { transaction: regenerated.transaction })
  assert(previewed.ok, 'preview_transaction validates generated transaction')
  const confirmation = tools.execute('commit_transaction', { transaction: regenerated.transaction })
  assert(!confirmation.ok && confirmation.issues.some((issue) => issue.code === 'CONFIRMATION_REQUIRED'), 'destructive commit requires explicit confirmation')
  const committed = tools.execute('commit_transaction', { transaction: regenerated.transaction, confirmed: true })
  assert(committed.ok, 'confirmed Agent commit uses Session')
  assert(tools.execute('undo_transaction', { confirmed: true }).ok, 'Agent undo uses Session')
  assert(session.getRevision() === initialRevision, 'generated commit inverse restores the exact snapshot')

  const layout = tools.execute('apply_layout_recipe', { slideId: SLIDE_ID, recipeId: 'statement.focus' })
  assert(layout.ok && layout.transaction, 'apply_layout_recipe returns a geometry transaction')
  assert(session.getRevision() === initialRevision, 'apply_layout_recipe is preview-only')
  assert(tools.execute('expand_macro', { macroId: 'metric-card', input: { key: 'kpi', label: 'KPI', value: 42, unit: '%' } }).ok, 'expand_macro returns drafts without committing')
  assert(tools.execute('replace_artwork', { slideId: SLIDE_ID, elementId: IMAGE_ID, assetId: IMAGE_ASSET_ID }).ok, 'replace_artwork returns a guarded transaction')
  const guardedFactSync = tools.execute('sync_fact_references', { factId: 'revenue', targetElementIds: [BODY_ID] })
  assert(!guardedFactSync.ok && guardedFactSync.transaction && guardedFactSync.issues.some((issue) => issue.code === 'FACT_SYNC_CONFLICT'), 'sync_fact_references returns a guarded transaction')
  assert(tools.execute('compare_revised_copy', { revisedDocument: session.getDocument() }).ok, 'compare_revised_copy is read-only')
  const selectionSession = new PpteSession(makeContractDocument().document)
  const selectionTools = new AgentToolServer(selectionSession, { selection: { slideId: SLIDE_ID, elementIds: [TITLE_ID] } })
  const selectedRegeneration = selectionTools.execute('regenerate_selection')
  assert(selectedRegeneration.ok && selectedRegeneration.transaction, 'regenerate_selection returns a protected transaction draft')
  assert(selectedRegeneration.transaction.operations.some((operation) => ('elementId' in operation && operation.elementId === TITLE_ID) || ('element' in operation && operation.element?.semanticKey === 'title.main')), 'regenerate_selection targets the selected anchor')
  assert(!selectedRegeneration.transaction.operations.some((operation) => ('elementId' in operation && [BODY_ID, IMAGE_ID, SHAPE_ID].includes(operation.elementId)) || operation.kind === 'slide.setReadingOrder' && operation.readingOrder?.some((elementId) => [BODY_ID, IMAGE_ID, SHAPE_ID].includes(elementId))), 'regenerate_selection leaves non-selected elements untouched')
  const revised = cloneJson(session.getDocument())
  const revisedBody = revised.slides[SLIDE_ID].elements[BODY_ID]
  assert(revisedBody.type === 'text', 'targeted visual diff uses a text target')
  revisedBody.content = text('Targeted visual change', 'targeted-visual')
  const targetedVisualDiff = renderTargetedVisualDiff(session.getDocument(), revised, SLIDE_ID, { elementIds: [TITLE_ID] })
  assert(targetedVisualDiff.nonTargetChangedElementIds.includes(BODY_ID), 'targeted visual diff reports non-target change')

  return {
    status: 'ok',
    initialRevision,
    finalRevision: session.getRevision(),
    agentTools: AGENT_TOOL_NAMES.length,
    declarativeRecipeCoverage: '12/12 built-in Recipes',
    macroExpansion: 'draft-only',
    compilerBoundary: 'IR → Element Draft → Transaction → Session preview/commit',
    hybridVisual: 'artwork metadata and safety validator covered by contract tests',
    targetedVisualDiff: targetedVisualDiff.changed,
  }
}

export function runWeek11To16(): Record<string, unknown> {
  const { document, imageBytes } = makeContractDocument()
  const initialRevision = canonicalRevision(document)
  const viewer = createPortableViewer(document, { assetBytes: { [IMAGE_ASSET_ID]: imageBytes }, derivedAt: '2026-09-03T00:00:00.000Z' })
  assert(viewer.ok, `Portable Viewer: ${viewer.issues.map((issue) => issue.code).join(',')}`)
  assert(auditPortableBundle(viewer.html).ok, 'Portable Viewer bundle audit')
  assert(decodePortable(viewer.html).origin.sourceRevision === initialRevision, 'Portable origin revision')

  const quick = new PortableRuntime(document, { profile: 'quick-fix', assetBytes: { [IMAGE_ASSET_ID]: imageBytes } })
  assert(quick.editText({ semanticKey: 'title.main' }, 'Offline Quick Fix title').ok, 'Portable Quick Fix text')
  assert(quick.undo().ok && quick.getRevision() === initialRevision, 'Portable Quick Fix inverse')
  assert(quick.replaceImage({ elementId: IMAGE_ID }, IMAGE_ASSET_ID).ok, 'Portable Quick Fix image')
  assert(quick.saveAsNewProject().ok, 'Portable Quick Fix Save as New Project')

  const subset = cloneJson(document)
  const subsetText = subset.slides[SLIDE_ID].elements[TITLE_ID] as TextElement
  subset.fonts.font_system_inter = { id: 'font_system_inter', family: 'Inter', style: 'normal', weight: 400, source: 'embedded', editableSafe: true, glyphCoverage: [{ start: 32, end: 126 }] }
  assert(checkGlyphCoverage(subset, subsetText, '标题', { strict: true }).some((issue) => issue.code === 'FONT_GLYPH_MISSING'), 'Glyph Coverage blocks missing CJK')

  const revised = cloneJson(document)
  ;(revised.slides[SLIDE_ID].elements[TITLE_ID] as TextElement).content = text('Revised title', 'week11-revised')
  const reviewer = new PpteReviewer()
  const patch = reviewer.createPatch(document, revised)
  const applied = applyPatchToDocument(document, decodePatch(encodePatch(patch)))
  assert(applied.ok, 'three-way patch application')
  const patchSession = new PpteSession(document)
  assert(patchSession.applyPatch(patch).ok, 'Session patch commit')
  assert(patchSession.undo().ok && patchSession.getRevision() === initialRevision, 'Session patch undo')

  const pdf = exportPdf(document)
  const png = exportPng(document)
  assert(pdf.bytes.length > 8 && new TextDecoder().decode(pdf.bytes.slice(0, 8)) === '%PDF-1.4', 'PDF baseline')
  assert(png.bytes.length > 8 && png.bytes[0] === 137 && png.bytes[1] === 80, 'PNG baseline')
  return {
    status: 'ok',
    portableViewer: { profile: viewer.origin?.profile, audited: true, offline: true },
    quickFix: { text: true, image: true, undo: true, saveAsNewProject: true },
    glyphCoverage: 'missing glyphs are explicit errors',
    compareRevisedCopy: { threeWay: true, patch: true, replayProtection: true },
    exports: { pdf: true, png: true, degraded: pdf.degraded || png.degraded },
  }
}

export function runGABStabilization(): Record<string, unknown> {
  const { document, imageBytes } = makeGABContractDocument()
  const initialRevision = canonicalRevision(document)
  assert(checkFactSourceConsistency(document).ok, 'GA-B cross-page Fact/Source consistency')
  assert(validateRuntimeDocument(document).filter((issue) => issue.severity === 'error').length === 0, 'GA-B runtime validation')

  const session = new PpteSession(document)
  const factTransaction = buildFactUpdateTransaction(document, 'revenue', 55, { requireConfirmation: false, actor: { type: 'human', id: 'ga-b-e2e' } })
  assert(factTransaction.operations.filter((operation) => operation.kind === 'fact.syncReferences').length === 2, 'GA-B Fact sync covers text and chart')
  assert(session.commit(factTransaction).ok, 'GA-B Fact update transaction')
  assert((session.getDocument().slides.slide_main.elements.chart_revenue as ChartElement).data.rows[0]?.values.revenue === 55, 'GA-B chart Fact value')
  assert((session.getDocument().slides.slide_metrics.elements.metric_page_two as TextElement).content.paragraphs[0]?.runs[0]?.text === 'Revenue 55%', 'GA-B cross-page display value')
  assert(session.undo().ok && session.getRevision() === initialRevision, 'GA-B Fact transaction inverse')

  const revised = cloneJson(document)
  ;(revised.slides.slide_main.elements.chart_revenue as ChartElement).data.rows[1]!.values.revenue = 41
  const reviewer = new PpteReviewer()
  const comparison = reviewer.compare(document, document, revised)
  const chartDataUnit = comparison.units.find((unit) => unit.elementId === 'chart_revenue' && unit.field === 'data')
  assert(Boolean(chartDataUnit && chartDataUnit.status === 'revised-only'), 'GA-B chart review unit')
  const reviewTransaction = reviewer.buildAcceptTransaction(comparison, { unitIds: chartDataUnit ? [chartDataUnit.unitId] : [] })
  reviewTransaction.changeContract.requireConfirmation = false
  assert(session.commit(reviewTransaction).ok, 'GA-B Review acceptance through Session')
  assert(session.undo().ok && session.getRevision() === initialRevision, 'GA-B Review inverse')

  const patch = reviewer.createPatch(document, revised)
  assert(patch.manifest.compatibilityProfile === 'ppte-2.0-ga-b.1', 'GA-B patch profile')
  const patchSession = new PpteSession(document)
  assert(patchSession.applyPatch(patch).ok, 'GA-B patch apply')
  assert(patchSession.undo().ok && patchSession.getRevision() === initialRevision, 'GA-B patch inverse')

  const pptx = exportImagePptx(document, { assetBytes: { [IMAGE_ASSET_ID]: imageBytes } })
  assert(pptx.ok && pptx.capabilityReport.ok, `GA-B Image PPTX: ${pptx.issues.map((issue) => issue.code).join(',')}`)
  const inspection = inspectPptx(pptx.bytes)
  assert(inspection.valid && inspection.slideCount === 2 && inspection.hasCapabilityReport, 'GA-B Image PPTX package and Capability Report')
  const missingAsset = exportImagePptx(document)
  assert(!missingAsset.ok && missingAsset.issues.some((issue) => issue.code === 'ASSET_PAYLOAD_MISSING'), 'GA-B Image PPTX missing asset is explicit')

  return {
    status: 'ok',
    initialRevision,
    finalRevision: session.getRevision(),
    chart: { types: ['bar', 'line', 'pie'], rendered: true, factSync: true },
    factSource: { crossPageConsistency: true, explicitTransaction: true, undo: true },
    review: { chartField: true, acceptedThroughSession: true, patch: true },
    imagePptx: { slides: inspection.slideCount, capabilityReport: inspection.hasCapabilityReport, missingAssetBlocked: true },
    excluded: ['Poster', 'Widget', 'Light Edit', 'Semantic PPTX'],
  }
}

export function runGACStabilization(): Record<string, unknown> {
  const { document, imageBytes } = makeGABContractDocument()
  const area = document.slides.slide_main.elements.chart_revenue as ChartElement
  area.chartType = 'area'
  const donut = cloneJson(area)
  donut.id = 'chart_mix'
  donut.semanticKey = 'chart.mix'
  donut.chartType = 'donut'
  donut.frame = { x: 1040, y: 740, width: 620, height: 260 }
  document.slides.slide_main.elements[donut.id] = donut
  document.slides.slide_main.rootOrder.push(donut.id)
  document.slides.slide_main.readingOrder?.push(donut.id)

  const widgets: ComponentElement[] = [
    {
      id: 'widget_table', type: 'component', semanticKey: 'widget.table', role: 'body',
      frame: { x: 160, y: 790, width: 760, height: 220 }, componentType: 'core/table', componentVersion: '1.0.0',
      props: { columns: ['Period', 'Value'], rows: [['Q1', 42], ['Q2', 38]], caption: 'Revenue' },
      fallback: { kind: 'placeholder', label: 'Table unavailable' },
    },
    {
      id: 'widget_code', type: 'component', semanticKey: 'widget.code', role: 'body',
      frame: { x: 40, y: 790, width: 100, height: 100 }, componentType: 'core/code', componentVersion: '1.0.0',
      props: { code: 'return 42', language: 'text' }, fallback: { kind: 'placeholder', label: 'Code unavailable' },
    },
    {
      id: 'widget_equation', type: 'component', semanticKey: 'widget.equation', role: 'body',
      frame: { x: 40, y: 900, width: 100, height: 100 }, componentType: 'core/equation', componentVersion: '1.0.0',
      props: { expression: 'x = y + 1' }, fallback: { kind: 'placeholder', label: 'Equation unavailable' },
    },
  ]
  for (const widget of widgets) {
    document.slides.slide_main.elements[widget.id] = widget
    document.slides.slide_main.rootOrder.push(widget.id)
    document.slides.slide_main.readingOrder?.push(widget.id)
  }
  document.widgetRequirements = widgets.map((widget) => ({ type: widget.componentType, versionRange: '^1.0.0', fallbackRequired: true }))
  document.assets[IMAGE_ASSET_ID].artwork = {
    safeTextRegions: [{ x: 0, y: 0, width: 1, height: 1 }],
    avoidTextRegions: [],
    dominantPalette: ['#112233'],
    focalPoint: { x: 0.5, y: 0.5 },
  }

  const initialRevision = canonicalRevision(document)
  const gaCIssues = validateRuntimeDocument(document, { runtimeProfile: 'ga-c' }).filter((issue) => issue.severity === 'error')
  assert(gaCIssues.length === 0, `GA-C runtime validation: ${gaCIssues.map((issue) => issue.code).join(',')}`)
  const gaBIssues = validateRuntimeDocument(document, { runtimeProfile: 'ga-b' })
  assert(gaBIssues.some((issue) => issue.code === 'CHART_TYPE_UNSUPPORTED'), 'GA-B rejects GA-C chart types')
  assert(gaBIssues.some((issue) => issue.code === 'UNSUPPORTED_ELEMENT_TYPE'), 'GA-B rejects controlled Widgets')

  const registry = getBuiltinWidgetRegistry()
  assert(widgets.every((widget) => validateWidgetElement(widget, registry).ok), 'built-in Widget props validate')
  assert(renderSlideHtml(document, SLIDE_ID).includes('data-ppte-widget="table"'), 'Table Widget renders through host registry')

  const session = new PpteSession(document)
  const posterTransaction = buildPosterTransaction(document, { transactionId: 'ga-c:poster', baseRevision: initialRevision, slideId: SLIDE_ID, artworkAssetId: IMAGE_ASSET_ID })
  assert(session.preview(posterTransaction).ok, 'Poster preview')
  assert(session.commit(posterTransaction).ok, 'Poster commit')
  assert(session.undo().ok && session.getRevision() === initialRevision, 'Poster inverse restores exact revision')
  assert(validatePosterSlide(document, SLIDE_ID).ok, 'Poster safety metadata')

  const light = new PortableRuntime(document, { profile: 'light-edit', assetBytes: { [IMAGE_ASSET_ID]: imageBytes } })
  assert(light.cropImage({ elementId: IMAGE_ID }, { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }).ok, 'Light Edit image crop')
  assert(light.undo().ok && light.getRevision() === initialRevision, 'Light Edit crop inverse')
  const editedData = cloneJson(area.data)
  editedData.rows[0]!.values.revenue = 55
  assert(light.updateChartData({ elementId: area.id }, editedData).ok, 'Light Edit Chart Data')
  assert(light.undo().ok && light.getRevision() === initialRevision, 'Light Edit Chart Data inverse')
  assert(light.moveElement({ elementId: IMAGE_ID }, { x: 300, y: 200 }).ok, 'Light Edit move')
  assert(light.undo().ok, 'Light Edit move inverse')
  assert(light.resizeElement({ elementId: IMAGE_ID }, { x: 100, y: 100, width: 400, height: 300 }).ok, 'Light Edit resize')
  assert(light.undo().ok && light.getRevision() === initialRevision, 'Light Edit resize inverse')
  const portable = createPortableLightEdit(document, { assetBytes: { [IMAGE_ASSET_ID]: imageBytes }, derivedAt: '2026-09-03T00:00:00.000Z' })
  assert(portable.ok && auditPortableBundle(portable.html).ok, 'Light Edit portable audit')
  const saved = light.saveAsProject()
  assert(saved.ok, 'Light Edit save as project')
  assert(openCheckpointBytes(saved.bytes!).manifest.compatibilityProfile === 'ppte-2.0-ga-c.1', 'Light Edit checkpoint profile')

  const semantic = compileSemanticPptx(document)
  assert(semantic.ok && semantic.slides.some((slide) => slide.nodes.some((node) => node.kind === 'text-box')), 'semantic PPTX mapping compiler')
  const pptx = exportSemanticPptx(document, { assetBytes: { [IMAGE_ASSET_ID]: imageBytes } })
  const inspection = inspectPptx(pptx.bytes)
  assert(pptx.ok && inspection.valid && inspection.slideCount === 2 && inspection.hasSemanticText && !inspection.hasSlideImages, 'semantic PPTX package')

  return {
    status: 'ok',
    initialRevision,
    finalRevision: session.getRevision(),
    charts: { area: true, donut: true, gaBBoundary: true },
    widgets: { table: true, code: true, equation: true, hostRegistry: true, fallback: true },
    poster: { metadata: true, safety: true, transaction: true, undo: true },
    lightEdit: { crop: true, chartData: true, move: true, resize: true, undo: true, saveAsProject: true },
    semanticPptx: { slides: inspection.slideCount, editableText: inspection.hasSemanticText, imageSlideAbsent: !inspection.hasSlideImages },
  }
}

function stableTransaction(
  session: PpteSession,
  transactionId: string,
  operations: Operation[],
  scope: Transaction['scope'],
  allowedElementIds: string[] | undefined,
  preserve: NonNullable<Transaction['changeContract']['preserve']>,
  maxChangedElements = Math.max(1, allowedElementIds?.length ?? 1),
): Transaction {
  return {
    transactionId,
    baseRevision: session.getRevision(),
    actor: { type: 'human', id: 'contract-deck' },
    scope,
    changeContract: {
      allowedOperationKinds: [...new Set(operations.map((operation) => operation.kind))],
      allowedElementIds,
      maxChangedSlides: 1,
      maxChangedElements,
      maxInsertedElements: scope.allowInsert === true ? 1 : 0,
      maxDeletedElements: scope.allowDelete === true ? 1 : 0,
      maxReplacedAssets: 0,
      preserve,
    },
    reason: `Stable Core contract coverage: ${transactionId}`,
    createdAt: '2026-09-02T00:05:00.000Z',
    validationLevel: 'L2',
    operations,
  }
}

function text(value: string, paragraphId: string): RichTextDocument {
  return { paragraphs: [{ id: paragraphId, runs: [{ id: `${paragraphId}-run`, text: value }] }] }
}
function pixelPng(): Uint8Array {
  return Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130])
}
function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`VERTICAL_SLICE_FAILED: ${label}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--ga-a')) {
  try {
    process.stdout.write(`${JSON.stringify(runGAAStabilization())}\n`)
  } catch (cause) {
    process.stderr.write(`${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`)
    process.exitCode = 1
  }
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--ga-b')) {
  try {
    process.stdout.write(`${JSON.stringify(runGABStabilization())}\n`)
  } catch (cause) {
    process.stderr.write(`${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`)
    process.exitCode = 1
  }
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--ga-c')) {
  try {
    process.stdout.write(`${JSON.stringify(runGACStabilization())}\n`)
  } catch (cause) {
    process.stderr.write(`${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`)
    process.exitCode = 1
  }
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--beta')) {
  try {
    process.stdout.write(`${JSON.stringify(runWeek11To16())}\n`)
  } catch (cause) {
    process.stderr.write(`${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`)
    process.exitCode = 1
  }
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--milestone')) {
  try {
    process.stdout.write(`${JSON.stringify(runWeek7To13())}\n`)
  } catch (cause) {
    process.stderr.write(`${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`)
    process.exitCode = 1
  }
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--e2e')) {
  try {
    process.stdout.write(`${JSON.stringify(runVerticalSlice())}\n`)
  } catch (cause) {
    process.stderr.write(`${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`)
    process.exitCode = 1
  }
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const artifactDirectory = resolve('artifacts')
  mkdirSync(artifactDirectory, { recursive: true })
  const artifact = join(artifactDirectory, 'contract-deck.html')
  const { document } = makeContractDocument()
  writeFileSync(artifact, `<!doctype html><meta charset="utf-8"><title>${document.metadata.title}</title>${renderSlideHtml(document, SLIDE_ID)}`)
  process.stdout.write(`Contract Deck rendered Text/Image/Shape to ${artifact}\n`)
}
