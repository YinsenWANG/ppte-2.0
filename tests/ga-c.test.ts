import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalRevision, cloneJson, sha256HexBytes } from '../packages/canonical-json/src/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { applyOperation } from '../packages/operations/src/index.js'
import { componentPropsContract } from '../packages/change-contract/src/index.js'
import { validateRuntimeDocument } from '../packages/validation/src/index.js'
import { renderChartSvg } from '../packages/charts/src/index.js'
import { getBuiltinWidgetRegistry, validateWidgetElement } from '../packages/widgets/src/index.js'
import { renderSlideHtml, renderSlideSvg } from '../packages/renderer-react/src/index.js'
import { buildPosterTransaction, validatePosterSlide } from '../packages/design-compiler/src/index.js'
import { PortableRuntime, auditPortableBundle, createPortableLightEdit, decodePortable } from '../packages/portable-runtime/src/index.js'
import { buildCheckpointBytes, openCheckpointBytes } from '../packages/file-format/src/index.js'
import { compileSemanticPptx, exportSemanticPptx, inspectPptx } from '../packages/exporter-pptx/src/index.js'
import { readStoredZip } from '../packages/archive/src/index.js'
import { migrateLegacyDocument } from '../packages/importer-legacy/src/index.js'
import type { ChartData, ChartElement, ComponentElement, PpteDocument, TextElement, Transaction } from '../packages/schema/src/index.js'
import { makeContractDocument, makeGABContractDocument } from '../apps/contract-deck/index.js'

const IMAGE_ID = 'image_hero'
const ASSET_ID = 'asset_pixel'

function makeGaCDocument(): { document: PpteDocument; imageBytes: Uint8Array } {
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
    {
      id: 'widget_unknown', type: 'component', semanticKey: 'widget.unknown', role: 'body',
      frame: { x: 40, y: 680, width: 100, height: 90 }, componentType: 'custom/unknown', componentVersion: '1.0.0',
      props: { label: 'Safe fallback' }, fallback: { kind: 'placeholder', label: 'Custom widget unavailable' },
    },
  ]
  for (const widget of widgets) {
    document.slides.slide_main.elements[widget.id] = widget
    document.slides.slide_main.rootOrder.push(widget.id)
    document.slides.slide_main.readingOrder?.push(widget.id)
  }
  document.widgetRequirements = [
    { type: 'core/code', versionRange: '^1.0.0', fallbackRequired: true },
    { type: 'core/equation', versionRange: '^1.0.0', fallbackRequired: true },
    { type: 'core/table', versionRange: '^1.0.0', fallbackRequired: true },
    { type: 'custom/unknown', versionRange: '^1.0.0', fallbackRequired: true },
  ]
  return { document, imageBytes }
}

function transactionFor(operation: Transaction['operations'][number], contract: Transaction['changeContract'], baseRevision: string, transactionId: string): Transaction {
  const elementIds = 'elementId' in operation ? [operation.elementId] : []
  return {
    transactionId,
    baseRevision,
    actor: { type: 'human', id: 'ga-c-test' },
    scope: { kind: 'selection', slideIds: ['slide_main'], elementIds, permissions: ['content'], allowInsert: false, allowDelete: false },
    changeContract: contract,
    createdAt: '2026-09-03T00:00:00.000Z',
    operations: [operation],
  }
}

function chartDataWithValue(chart: ChartElement, value: number): ChartData {
  const data = cloneJson(chart.data)
  data.rows[0]!.values.revenue = value
  return data
}

test('GA-C Area and Donut charts render, reverse, and keep the GA-B boundary explicit', () => {
  const { document } = makeGaCDocument()
  const area = document.slides.slide_main.elements.chart_revenue as ChartElement
  const donut = document.slides.slide_main.elements.chart_mix as ChartElement
  assert.deepEqual(validateRuntimeDocument(document, { runtimeProfile: 'ga-c' }).filter((issue) => issue.severity === 'error'), [])
  const oldRuntimeIssues = validateRuntimeDocument(document, { runtimeProfile: 'ga-b' })
  assert.ok(oldRuntimeIssues.some((issue) => issue.code === 'CHART_TYPE_UNSUPPORTED' && issue.message.includes('area')))
  assert.ok(oldRuntimeIssues.some((issue) => issue.code === 'CHART_TYPE_UNSUPPORTED' && issue.message.includes('donut')))
  assert.match(renderChartSvg(area, { runtimeProfile: 'ga-c' }), /<path/)
  assert.match(renderChartSvg(donut, { runtimeProfile: 'ga-c' }), /<path/)
  assert.throws(() => renderChartSvg(area, { runtimeProfile: 'ga-b' }), /CHART_TYPE_UNSUPPORTED/)
  assert.throws(() => applyOperation(document, { opId: 'old-area', kind: 'chart.updateOptions', slideId: 'slide_main', elementId: area.id, patch: { showGrid: false } }), /received area/)

  const initialRevision = canonicalRevision(document)
  const nextData = chartDataWithValue(area, 55)
  const transaction = transactionFor({ opId: 'area-data', kind: 'chart.replaceData', slideId: 'slide_main', elementId: area.id, data: nextData }, { allowedOperationKinds: ['chart.replaceData'], allowedElementIds: [area.id], maxChangedSlides: 1, maxChangedElements: 1, maxInsertedElements: 0, maxDeletedElements: 0, maxReplacedAssets: 0, maxChangedFacts: 0, maxChangedSources: 0, maxChangedThemeTokens: 0, maxChangedStylePresets: 0, preserve: { style: 'preserve', geometry: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' }, requireConfirmation: false }, initialRevision, 'area-data-tx')
  const session = new PpteSession(document)
  assert.equal(session.commit(transaction).ok, true)
  assert.equal((session.getDocument().slides.slide_main.elements[area.id] as ChartElement).data.rows[0]!.values.revenue, 55)
  assert.equal(session.undo().ok, true)
  assert.equal(session.getRevision(), initialRevision)

  const stale = transactionFor({ opId: 'stale-area', kind: 'chart.replaceData', slideId: 'slide_main', elementId: area.id, data: chartDataWithValue(area, 60) }, transaction.changeContract, initialRevision, 'stale-area-tx')
  assert.equal(session.commit(transaction).ok, true)
  const conflict = session.commit(stale)
  assert.equal(conflict.ok, false)
  assert.ok(conflict.issues.some((issue) => issue.code === 'REVISION_CONFLICT'))
})

test('Controlled Table, Code, and Equation Widgets use host registry rendering and reversible props', () => {
  const { document } = makeGaCDocument()
  const table = document.slides.slide_main.elements.widget_table as ComponentElement
  const code = document.slides.slide_main.elements.widget_code as ComponentElement
  const equation = document.slides.slide_main.elements.widget_equation as ComponentElement
  const registry = getBuiltinWidgetRegistry()
  assert.equal(validateWidgetElement(table, registry).ok, true)
  assert.equal(validateWidgetElement(code, registry).ok, true)
  assert.equal(validateWidgetElement(equation, registry).ok, true)
  const invalidCode = cloneJson(code)
  invalidCode.props = { code: 42 }
  assert.equal(validateWidgetElement(invalidCode, registry).ok, false)
  assert.match(renderSlideHtml(document, 'slide_main'), /data-ppte-widget="table"/)
  assert.match(renderSlideHtml(document, 'slide_main'), /data-ppte-widget="code"/)
  assert.match(renderSlideHtml(document, 'slide_main'), /data-ppte-widget="equation"/)
  assert.match(renderSlideHtml(document, 'slide_main'), /&lt;x&gt;|Revenue/)
  assert.match(renderSlideSvg(document, 'slide_main'), /data-ppte-widget-type="core\/table"/)
  assert.match(renderSlideHtml(document, 'slide_main'), /data-ppte-widget-fallback="true"/)

  const initialRevision = canonicalRevision(document)
  const operation = { opId: 'widget-props', kind: 'component.updateProps' as const, slideId: 'slide_main', elementId: table.id, patch: { caption: 'Updated table' } }
  const transaction = transactionFor(operation, componentPropsContract(table.id), initialRevision, 'widget-props-tx')
  const session = new PpteSession(document)
  assert.equal(session.commit(transaction).ok, true)
  assert.equal((session.getDocument().slides.slide_main.elements[table.id] as ComponentElement).props.caption, 'Updated table')
  assert.equal(session.undo().ok, true)
  assert.equal(session.getRevision(), initialRevision)
  assert.throws(() => applyOperation(document, operation), /outside the GA-B runtime/)

  const stale = transactionFor({ ...operation, opId: 'widget-stale', patch: { caption: 'Stale' } }, transaction.changeContract, initialRevision, 'widget-stale-tx')
  assert.equal(session.commit(transaction).ok, true)
  const conflict = session.commit(stale)
  assert.equal(conflict.ok, false)
  assert.ok(conflict.issues.some((issue) => issue.code === 'REVISION_CONFLICT'))
})

test('Poster artwork uses safe metadata, one reversible transaction, and explicit Profile boundaries', () => {
  const { document } = makeContractDocument()
  document.assets[ASSET_ID]!.artwork = {
    safeTextRegions: [{ x: 0, y: 0, width: 1, height: 1 }],
    avoidTextRegions: [],
    dominantPalette: ['#112233'],
    focalPoint: { x: 0.5, y: 0.5 },
  }
  assert.equal(validatePosterSlide(document, 'slide_main').ok, true)
  const initialRevision = canonicalRevision(document)
  const transaction = buildPosterTransaction(document, { transactionId: 'poster-create', baseRevision: initialRevision, slideId: 'slide_main', artworkAssetId: ASSET_ID })
  assert.equal(transaction.changeContract.requireConfirmation, true)
  const session = new PpteSession(document)
  const preview = session.preview(transaction)
  assert.equal(preview.ok, true)
  assert.equal(preview.requiresConfirmation, true)
  assert.equal(session.commit(transaction).ok, true)
  const poster = session.getDocument().slides.slide_main
  assert.equal(poster.visualStrategy, 'poster')
  assert.equal(poster.rootOrder[0], 'slide_main:poster-artwork')
  assert.equal((poster.elements['slide_main:poster-artwork'] as Extract<import('../packages/schema/src/index.js').Element, { type: 'image' }>).role, 'artwork')
  assert.equal(session.undo().ok, true)
  assert.equal(session.getRevision(), initialRevision)

  const conflictSession = new PpteSession(document)
  assert.equal(conflictSession.commit(transaction).ok, true)
  const posterConflict = conflictSession.commit({ ...transaction, transactionId: 'poster-stale' })
  assert.equal(posterConflict.ok, false)
  assert.ok(posterConflict.issues.some((issue) => issue.code === 'REVISION_CONFLICT'))

  const strictOldSession = new PpteSession(document, { runtimeProfile: 'ga-b' })
  const blocked = strictOldSession.commit({ ...transaction, transactionId: 'poster-old-runtime' })
  assert.equal(blocked.ok, false)
  assert.ok(blocked.issues.some((issue) => issue.code === 'UNSUPPORTED_VISUAL_STRATEGY'))

  const incomplete = cloneJson(document)
  incomplete.assets[ASSET_ID]!.artwork = { safeTextRegions: [{ x: 0.9, y: 0.9, width: 0.1, height: 0.1 }], dominantPalette: ['#112233'], focalPoint: { x: 0.5, y: 0.5 } }
  assert.throws(() => buildPosterTransaction(incomplete, { transactionId: 'poster-unsafe', baseRevision: canonicalRevision(incomplete), slideId: 'slide_main', artworkAssetId: ASSET_ID }), /ARTWORK_SAFE_REGION_MISSING/)
  const missingMetadata = cloneJson(document)
  delete missingMetadata.assets[ASSET_ID]!.artwork
  assert.throws(() => buildPosterTransaction(missingMetadata, { transactionId: 'poster-no-metadata', baseRevision: canonicalRevision(missingMetadata), slideId: 'slide_main', artworkAssetId: ASSET_ID }), /ARTWORK_METADATA_MISSING/)
})

test('Portable Light Edit covers crop, Chart Data, Move, Resize, undo, save, and offline bundle audit', () => {
  const { document, imageBytes } = makeGaCDocument()
  const initialRevision = canonicalRevision(document)
  const light = new PortableRuntime(document, { profile: 'light-edit', assetBytes: { [ASSET_ID]: imageBytes } })
  assert.equal(light.cropImage({ elementId: IMAGE_ID }, { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }).ok, true)
  assert.deepEqual((light.getDocument().slides.slide_main.elements[IMAGE_ID] as Extract<import('../packages/schema/src/index.js').Element, { type: 'image' }>).crop, { x: 0.1, y: 0.1, width: 0.8, height: 0.8 })
  assert.equal(light.undo().ok, true)
  assert.equal(light.getRevision(), initialRevision)

  const area = light.getDocument().slides.slide_main.elements.chart_revenue as ChartElement
  assert.equal(light.updateChartData({ elementId: area.id }, chartDataWithValue(area, 66)).ok, true)
  assert.equal((light.getDocument().slides.slide_main.elements[area.id] as ChartElement).data.rows[0]!.values.revenue, 66)
  assert.equal(light.undo().ok, true)
  assert.equal(light.moveElement({ elementId: IMAGE_ID }, { x: 300, y: 200 }).ok, true)
  assert.equal((light.getDocument().slides.slide_main.elements[IMAGE_ID] as Extract<import('../packages/schema/src/index.js').Element, { type: 'image' }>).frame.x, 300)
  assert.equal(light.undo().ok, true)
  assert.equal(light.resizeElement({ elementId: IMAGE_ID }, { x: 100, y: 100, width: 400, height: 300 }).ok, true)
  assert.equal((light.getDocument().slides.slide_main.elements[IMAGE_ID] as Extract<import('../packages/schema/src/index.js').Element, { type: 'image' }>).frame.width, 400)
  assert.equal(light.undo().ok, true)
  assert.equal(light.getRevision(), initialRevision)
  const badCrop = light.cropImage({ elementId: IMAGE_ID }, { x: 0.8, y: 0.8, width: 0.5, height: 0.5 })
  assert.equal(badCrop.ok, false)
  assert.ok(badCrop.issues.some((issue) => issue.code === 'GEOMETRY_INVALID'))
  assert.equal(light.getRevision(), initialRevision)

  const viewerDocument = makeContractDocument(imageBytes).document
  const viewer = new PortableRuntime(viewerDocument, { profile: 'viewer', assetBytes: { [ASSET_ID]: imageBytes } })
  assert.equal(viewer.cropImage({ elementId: IMAGE_ID }, { x: 0, y: 0, width: 1, height: 1 }).ok, false)
  assert.equal(viewer.updateChartData({ elementId: area.id }, area.data).ok, false)
  assert.equal(viewer.moveElement({ elementId: IMAGE_ID }, { x: 1, y: 1 }).ok, false)
  const portable = createPortableLightEdit(document, { assetBytes: { [ASSET_ID]: imageBytes }, derivedAt: '2026-09-03T00:00:00.000Z' })
  assert.equal(portable.ok, true)
  assert.equal(decodePortable(portable.html).origin.profile, 'light-edit')
  assert.equal(auditPortableBundle(portable.html).ok, true)

  const project = light.saveAsProject()
  assert.equal(project.ok, true)
  assert.equal(openCheckpointBytes(project.bytes!).manifest.compatibilityProfile, 'ppte-2.0-ga-c.1')
  const checkpoint = buildCheckpointBytes(document, { assetBytes: { [ASSET_ID]: imageBytes }, compatibilityProfile: 'ppte-2.0-ga-c.1' })
  assert.equal(openCheckpointBytes(checkpoint).document.documentId, document.documentId)
})

test('Semantic PPTX compiles mappings, keeps text editable, exposes degradation, and never silently drops assets', () => {
  const { document, imageBytes } = makeGaCDocument()
  const compilation = compileSemanticPptx(document)
  assert.equal(compilation.ok, true)
  assert.ok(compilation.slides[0]!.nodes.some((node) => node.kind === 'text-box'))
  assert.ok(compilation.slides[0]!.nodes.some((node) => node.kind === 'shape'))
  assert.ok(compilation.slides[0]!.nodes.some((node) => node.kind === 'picture'))
  assert.ok(compilation.slides[0]!.nodes.some((node) => node.kind === 'chart-svg'))
  assert.ok(compilation.slides[0]!.nodes.some((node) => node.kind === 'component-fallback'))
  const exported = exportSemanticPptx(document, { assetBytes: { [ASSET_ID]: imageBytes } })
  assert.equal(exported.ok, true)
  assert.equal(exported.capabilityReport.target, 'pptx-semantic')
  assert.equal(exported.degraded, true)
  const inspection = inspectPptx(exported.bytes)
  assert.equal(inspection.valid, true)
  assert.equal(inspection.slideCount, 2)
  assert.equal(inspection.hasSemanticText, true)
  assert.equal(inspection.hasSlideImages, false)
  const archive = readStoredZip(exported.bytes)
  assert.equal([...archive.keys()].some((entry) => entry === 'ppt/media/slide1.svg'), false)
  assert.ok([...archive.keys()].some((entry) => entry.includes('chart-slide_main_chart_revenue.svg')))
  const slideXml = new TextDecoder().decode(archive.get('ppt/slides/slide1.xml'))
  assert.match(slideXml, /<p:sp>/)
  assert.match(slideXml, /<p:pic>/)
  assert.match(slideXml, /<a:t>Annual operating review<\/a:t>/)
  assert.match(slideXml, /typeface="Inter"/)
  const exportedAgain = exportSemanticPptx(document, { assetBytes: { [ASSET_ID]: imageBytes } })
  assert.equal(sha256HexBytes(exportedAgain.bytes), sha256HexBytes(exported.bytes))

  const stale = compileSemanticPptx(document, { sourceRevision: `sha256-${'0'.repeat(64)}` })
  assert.equal(stale.ok, false)
  assert.ok(stale.issues.some((issue) => issue.code === 'EXPORT_SOURCE_REVISION_MISMATCH'))

  const missingPayload = exportSemanticPptx(document)
  assert.equal(missingPayload.ok, false)
  assert.ok(missingPayload.issues.some((issue) => issue.code === 'ASSET_PAYLOAD_MISSING'))
  assert.ok(missingPayload.bytes.length > 0)
  assert.ok([...readStoredZip(missingPayload.bytes).keys()].some((entry) => entry.endsWith('.svg') && entry.includes('asset-asset_pixel')))

  const poster = makeContractDocument().document
  poster.assets[ASSET_ID]!.artwork = { safeTextRegions: [{ x: 0, y: 0, width: 1, height: 1 }], dominantPalette: ['#112233'], focalPoint: { x: 0.5, y: 0.5 } }
  poster.slides.slide_main.visualStrategy = 'poster'
  poster.slides.slide_main.elements[IMAGE_ID]!.role = 'artwork'
  const posterCompilation = compileSemanticPptx(poster)
  assert.equal(posterCompilation.slides[0]!.posterAsArtwork, true)
  assert.equal(posterCompilation.slides[0]!.nodes[0]!.posterAsArtwork, true)
  assert.ok(posterCompilation.slides[0]!.nodes.some((node) => node.kind === 'text-box' && node.sourceElementId === 'text_title'))
})

test('Legacy migration admits GA-C Area/Donut and controlled Widgets only under the GA-C target', () => {
  const source = {
    format: 'legacy-json', documentId: 'legacy-ga-c', title: 'GA-C migration',
    slides: [{ id: 'slide_1', elements: [
      { id: 'chart_1', type: 'chart', chartType: 'area', frame: { x: 0, y: 0, width: 640, height: 360 }, data: { columns: [{ id: 'period', label: 'Period', type: 'string' }, { id: 'value', label: 'Value', type: 'number' }], rows: [{ id: 'row_1', values: { period: 'Q1', value: 10 } }] }, encoding: { categoryField: 'period', valueFields: ['value'] } },
      { id: 'widget_1', type: 'component', componentType: 'core/table', componentVersion: '1.0.0', frame: { x: 0, y: 400, width: 640, height: 240 }, props: { columns: ['A'], rows: [['B']] }, fallback: { kind: 'placeholder', label: 'Table' } },
    ] }],
  }
  const migrated = migrateLegacyDocument(source, { targetProfile: 'ppte-2.0-ga-c.1' })
  assert.equal(migrated.ok, true)
  assert.equal(migrated.document.slides.slide_1.elements.chart_1.type, 'chart')
  assert.equal((migrated.document.slides.slide_1.elements.chart_1 as ChartElement).chartType, 'area')
  assert.equal(migrated.document.slides.slide_1.elements.widget_1.type, 'component')
  assert.deepEqual(migrated.document.widgetRequirements, [{ type: 'core/table', versionRange: '^1.0.0', fallbackRequired: true }])
  assert.deepEqual(validateRuntimeDocument(migrated.document, { runtimeProfile: 'ga-c' }).filter((issue) => issue.severity === 'error'), [])

  const oldTarget = migrateLegacyDocument(source, { targetProfile: 'ppte-2.0-ga-b.1' })
  assert.equal(oldTarget.document.slides.slide_1.rootOrder.length, 0)
  assert.ok(oldTarget.report.issues.some((issue) => issue.code === 'MIGRATION_UNSUPPORTED_ELEMENT'))

  const bytes = Uint8Array.from([1, 2, 3])
  const posterSource = {
    format: 'legacy-json', documentId: 'legacy-poster', title: 'Poster migration',
    assets: { artwork: { hash: `sha256-${sha256HexBytes(bytes)}`, mimeType: 'image/png', byteLength: bytes.length, path: 'assets/artwork.png', artwork: { safeTextRegions: [{ x: 0, y: 0, width: 1, height: 1 }], dominantPalette: ['#112233'], focalPoint: { x: 0.5, y: 0.5 } } } },
    slides: [{ id: 'slide_poster', visualStrategy: 'poster', elements: [{ id: 'poster_art', type: 'image', role: 'artwork', assetId: 'artwork', frame: { x: 0, y: 0, width: 1920, height: 1080 } }] }],
  }
  const migratedPoster = migrateLegacyDocument(posterSource, { targetProfile: 'ppte-2.0-ga-c.1', assetBytes: { artwork: bytes } })
  assert.equal(migratedPoster.ok, true)
  assert.deepEqual(migratedPoster.document.assets.artwork.artwork?.focalPoint, { x: 0.5, y: 0.5 })
  assert.equal(migratedPoster.document.slides.slide_poster.visualStrategy, 'poster')

  const downgradedPoster = migrateLegacyDocument(posterSource, { targetProfile: 'ppte-2.0-ga-b.1', assetBytes: { artwork: bytes } })
  assert.equal(downgradedPoster.ok, true)
  assert.equal(downgradedPoster.document.slides.slide_poster.visualStrategy, 'structured')
  assert.ok(downgradedPoster.report.issues.some((issue) => issue.code === 'MIGRATION_UNSUPPORTED_VISUAL_STRATEGY'))
})
