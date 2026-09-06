import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalRevision, cloneJson, sha256HexBytes } from '../packages/canonical-json/src/index.js'
import { checkFactSourceConsistency, buildFactUpdateTransaction } from '../packages/facts/src/index.js'
import { buildCapabilityReport } from '../packages/capability/src/index.js'
import { applyOperation } from '../packages/operations/src/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { AgentToolServer } from '../packages/agent-tools/src/index.js'
import { PortableRuntime } from '../packages/portable-runtime/src/index.js'
import { compareDocuments, compareTwoWayDocuments, PpteReviewer, buildAcceptTransaction } from '../packages/reviewer/src/index.js'
import { exportImagePptx, inspectPptx } from '../packages/exporter-pptx/src/index.js'
import { readStoredZip } from '../packages/archive/src/index.js'
import { buildCheckpointBytes, openCheckpointBytes } from '../packages/file-format/src/index.js'
import { migrateLegacyDocument } from '../packages/importer-legacy/src/index.js'
import { renderChartSvg, validateChartContract } from '../packages/charts/src/index.js'
import { validateRuntimeDocument } from '../packages/validation/src/index.js'
import type { ChartElement, PpteDocument, TextElement } from '../packages/schema/src/index.js'
import { makeContractDocument } from '../apps/contract-deck/index.js'

function chartDocument(): { document: PpteDocument; imageBytes: Uint8Array } {
  const { document, imageBytes } = makeContractDocument()
  document.theme.presets.chart['chart.default'] = {
    palette: [
      { kind: 'value', value: '#2563EB' },
      { kind: 'value', value: '#14B8A6' },
    ],
    axisColor: { kind: 'value', value: '#64748B' },
    labelColor: { kind: 'value', value: '#334155' },
    gridColor: { kind: 'value', value: '#CBD5E1' },
    lineWidth: 2,
    cornerRadius: 3,
  }
  document.sources = { source_report: { id: 'source_report', title: 'Public report', citation: 'Public report, 2026' } }
  const chart: ChartElement = {
    id: 'chart_revenue',
    type: 'chart',
    semanticKey: 'chart.revenue',
    role: 'chart',
    frame: { x: 1040, y: 160, width: 760, height: 560 },
    chartType: 'bar',
    data: {
      columns: [
        { id: 'period', label: 'Period', type: 'string' },
        { id: 'revenue', label: 'Revenue', type: 'number', format: '0' },
      ],
      rows: [
        { id: 'revenue', values: { period: 'Q1', revenue: 42 } },
        { id: 'other', values: { period: 'Q2', revenue: 38 } },
      ],
    },
    encoding: { categoryField: 'period', valueFields: ['revenue'] },
    options: { showLegend: false, showLabels: true },
    style: { styleRef: 'chart.default' },
    semanticRefs: { factIds: ['revenue'], sourceIds: ['source_report'] },
    altText: 'Revenue by period',
  }
  document.slides.slide_main.elements.chart_revenue = chart
  document.slides.slide_main.rootOrder.push(chart.id)
  const metric = cloneJson(document.slides.slide_main.elements.text_body) as TextElement
  metric.id = 'metric_page_one'
  metric.semanticKey = 'metric.revenue.page-one'
  metric.frame = { x: 160, y: 650, width: 700, height: 100 }
  metric.content = { paragraphs: [{ id: 'metric-p1', runs: [{ id: 'metric-r1', text: 'Revenue 42%' }] }] }
  metric.semanticRefs = { factIds: ['revenue'], sourceIds: ['source_report'] }
  document.slides.slide_main.elements[metric.id] = metric
  document.slides.slide_main.rootOrder.push(metric.id)
  document.slides.slide_main.readingOrder?.push(metric.id)
  const metricTwo = cloneJson(metric)
  metricTwo.id = 'metric_page_two'
  metricTwo.semanticKey = 'metric.revenue.page-two'
  metricTwo.content = { paragraphs: [{ id: 'metric-p2', runs: [{ id: 'metric-r2', text: 'Revenue 42%' }] }] }
  document.slides.slide_metrics = { id: 'slide_metrics', name: 'Metrics', rootOrder: [metricTwo.id], readingOrder: [metricTwo.id], elements: { [metricTwo.id]: metricTwo }, groups: {}, visualStrategy: 'structured' }
  document.slideOrder.push('slide_metrics')
  return { document, imageBytes }
}

test('GA-B chart contract renders and chart data operations reverse exactly', () => {
  const { document } = chartDocument()
  const chart = document.slides.slide_main.elements.chart_revenue
  assert.equal(chart.type, 'chart')
  if (chart.type !== 'chart') return
  assert.deepEqual(validateChartContract(chart, { runtimeSubset: true }), [])
  assert.match(renderChartSvg(chart), /<rect/)
  const operation = { opId: 'chart-options', kind: 'chart.updateOptions' as const, slideId: 'slide_main', elementId: chart.id, patch: { showGrid: false } }
  const applied = applyOperation(document, operation)
  assert.equal((applied.document.slides.slide_main.elements.chart_revenue as ChartElement).options?.showGrid, false)
  const restored = applyOperation(applied.document, applied.inverse[0]!).document
  assert.equal(canonicalRevision(restored), canonicalRevision(document))
  const invalid = cloneJson(chart)
  invalid.chartType = 'area'
  const invalidDocument = cloneJson(document)
  invalidDocument.slides.slide_main.elements.chart_revenue = invalid
  assert.throws(() => applyOperation(invalidDocument, { opId: 'chart-invalid', kind: 'chart.updateOptions', slideId: 'slide_main', elementId: chart.id, patch: { showGrid: false } }), /received area/)
})

test('Fact consistency spans pages and updates text plus chart through one reversible Transaction', () => {
  const { document } = chartDocument()
  assert.equal(checkFactSourceConsistency(document).ok, true)
  const transaction = buildFactUpdateTransaction(document, 'revenue', 55, { requireConfirmation: false })
  assert.deepEqual(transaction.operations.map((operation) => operation.kind), ['fact.upsert', 'fact.syncReferences', 'fact.syncReferences'])
  const session = new PpteSession(document)
  const committed = session.commit(transaction)
  assert.equal(committed.ok, true)
  assert.equal(session.getDocument().facts?.revenue.value, 55)
  assert.equal((session.getDocument().slides.slide_main.elements.metric_page_one as TextElement).content.paragraphs[0]?.runs[0]?.text, 'Revenue 55%')
  assert.equal((session.getDocument().slides.slide_metrics.elements.metric_page_two as TextElement).content.paragraphs[0]?.runs[0]?.text, 'Revenue 55%')
  assert.equal((session.getDocument().slides.slide_main.elements.chart_revenue as ChartElement).data.rows[0]?.values.revenue, 55)
  assert.equal(checkFactSourceConsistency(session.getDocument()).ok, true)
  assert.equal(session.undo().ok, true)
  assert.equal(session.getRevision(), canonicalRevision(document))

  const stale = buildFactUpdateTransaction(document, 'revenue', 60, { requireConfirmation: false })
  const changed = new PpteSession(document)
  assert.equal(changed.commit(buildFactUpdateTransaction(document, 'revenue', 50, { requireConfirmation: false })).ok, true)
  const conflict = changed.commit(stale)
  assert.equal(conflict.ok, false)
  assert.ok(conflict.issues.some((issue) => issue.code === 'REVISION_CONFLICT'))
})

test('Portable numeric Fact Quick Fix and Agent sync remain explicit, scoped, and reversible', () => {
  const { document, imageBytes } = chartDocument()
  const portable = new PortableRuntime(document, { profile: 'quick-fix', assetBytes: { asset_pixel: imageBytes } })
  const initialRevision = portable.getRevision()
  const quickFix = portable.editFact('revenue', 55)
  assert.equal(quickFix.ok, true)
  const transaction = portable.getLastTransaction()
  assert.deepEqual(transaction?.operations.map((operation) => operation.kind), ['fact.upsert', 'fact.syncReferences', 'fact.syncReferences'])
  assert.equal((portable.getDocument().slides.slide_metrics.elements.metric_page_two as TextElement).content.paragraphs[0]?.runs[0]?.text, 'Revenue 55%')
  assert.equal((portable.getDocument().slides.slide_main.elements.chart_revenue as ChartElement).data.rows[0]?.values.revenue, 55)
  assert.equal(portable.undo().ok, true)
  assert.equal(portable.getRevision(), initialRevision)

  const defaultCheckpoint = portable.saveAsProject()
  assert.equal(defaultCheckpoint.ok, true)
  assert.equal(openCheckpointBytes(defaultCheckpoint.bytes!).manifest.compatibilityProfile, 'ppte-2.0-ga-b.1')
  const portableCheckpoint = portable.saveAsNewProject({ compatibilityProfile: 'ppte-2.0-ga-b.1' })
  assert.equal(portableCheckpoint.ok, true)
  assert.equal(openCheckpointBytes(portableCheckpoint.bytes!).manifest.compatibilityProfile, 'ppte-2.0-ga-b.1')

  const agentDocument = cloneJson(document)
  ;(agentDocument.slides.slide_main.elements.chart_revenue as ChartElement).data.rows[0]!.values.revenue = 40
  const agentSession = new PpteSession(agentDocument)
  const agent = new AgentToolServer(agentSession)
  const draft = agent.execute('sync_fact_references', { factId: 'revenue', targetElementIds: ['chart_revenue'], strategy: 'update-chart-values' })
  assert.equal(draft.ok, true)
  assert.deepEqual(draft.transaction?.scope.permissions, ['facts', 'content'])
  assert.equal(draft.requiresConfirmation, true)
  const blocked = agent.execute('commit_transaction', { transaction: draft.transaction })
  assert.equal(blocked.ok, false)
  assert.ok(blocked.issues.some((issue) => issue.code === 'CONFIRMATION_REQUIRED'))
  const committed = agent.execute('commit_transaction', { transaction: draft.transaction, confirmed: true })
  assert.equal(committed.ok, true)
  assert.equal((agentSession.getDocument().slides.slide_main.elements.chart_revenue as ChartElement).data.rows[0]?.values.revenue, 42)
  assert.equal(agent.execute('undo_transaction', { confirmed: true }).ok, true)
  assert.equal((agentSession.getDocument().slides.slide_main.elements.chart_revenue as ChartElement).data.rows[0]?.values.revenue, 40)
})

test('Review accepts selected chart changes, requires explicit conflict resolution, and supports two-way fallback', () => {
  const { document: base } = chartDocument()
  const revised = cloneJson(base)
  const revisedChart = revised.slides.slide_main.elements.chart_revenue as ChartElement
  revisedChart.data.rows[0]!.values.revenue = 44
  const comparison = compareDocuments(base, base, revised)
  const dataUnit = comparison.units.find((unit) => unit.elementId === 'chart_revenue' && unit.field === 'data')!
  assert.equal(dataUnit.status, 'revised-only')
  const accepted = buildAcceptTransaction(comparison, { unitIds: [dataUnit.unitId] })
  const session = new PpteSession(base)
  accepted.changeContract.requireConfirmation = false
  assert.equal(session.commit(accepted).ok, true)
  assert.equal((session.getDocument().slides.slide_main.elements.chart_revenue as ChartElement).data.rows[0]?.values.revenue, 44)

  const local = cloneJson(base)
  const localChart = local.slides.slide_main.elements.chart_revenue as ChartElement
  localChart.data.rows[0]!.values.revenue = 43
  const conflictRevised = cloneJson(base)
  ;(conflictRevised.slides.slide_main.elements.chart_revenue as ChartElement).data.rows[0]!.values.revenue = 44
  const conflict = compareDocuments(base, local, conflictRevised)
  const conflictUnit = conflict.conflicts.find((unit) => unit.elementId === 'chart_revenue' && unit.field === 'data')!
  assert.throws(() => buildAcceptTransaction(conflict, { unitIds: [conflictUnit.unitId] }), /REVIEW_EMPTY/)
  const resolved = buildAcceptTransaction(conflict, { unitIds: [conflictUnit.unitId], resolutions: { [conflictUnit.unitId]: 'revised' } })
  resolved.changeContract.requireConfirmation = false
  const resolvedSession = new PpteSession(local)
  assert.equal(resolvedSession.commit(resolved).ok, true)
  assert.equal((resolvedSession.getDocument().slides.slide_main.elements.chart_revenue as ChartElement).data.rows[0]?.values.revenue, 44)

  const twoWay = compareTwoWayDocuments(local, conflictRevised)
  assert.equal(twoWay.baseAvailable, false)
  assert.equal(twoWay.twoWay, true)
})

test('GA-B revised-copy patch and Image PPTX carry deterministic capabilities and no silent asset drop', () => {
  const { document: base, imageBytes } = chartDocument()
  const revised = cloneJson(base)
  ;(revised.slides.slide_main.elements.chart_revenue as ChartElement).data.rows[1]!.values.revenue = 41
  const patch = new PpteReviewer().createPatch(base, revised)
  assert.equal(patch.manifest.compatibilityProfile, 'ppte-2.0-ga-b.1')
  const patchApplied = new PpteSession(base).previewPatch(patch)
  assert.equal(patchApplied.ok, true)

  const exported = exportImagePptx(base, { assetBytes: { asset_pixel: imageBytes } })
  assert.equal(exported.ok, true)
  assert.equal(exported.capabilityReport.target, 'pptx-image')
  const exportedAgain = exportImagePptx(base, { assetBytes: { asset_pixel: imageBytes } })
  assert.equal(sha256HexBytes(exportedAgain.bytes), sha256HexBytes(exported.bytes))
  const inspection = inspectPptx(exported.bytes)
  assert.equal(inspection.valid, true)
  assert.equal(inspection.slideCount, 2)
  assert.equal(inspection.hasCapabilityReport, true)
  const archive = readStoredZip(exported.bytes)
  assert.match(new TextDecoder().decode(archive.get('ppt/slides/slide1.xml')), /<p:pic>/)
  const slideSvg = new TextDecoder().decode(archive.get('ppt/media/slide1.svg'))
  assert.match(slideSvg, /data:image\/png;base64/)
  assert.doesNotMatch(slideSvg, /foreignObject/)
  assert.equal(JSON.parse(new TextDecoder().decode(archive.get('ppt/ppte/capability-report.json'))).target, 'pptx-image')

  const checkpoint = buildCheckpointBytes(base, { assetBytes: { asset_pixel: imageBytes }, compatibilityProfile: 'ppte-2.0-ga-b.1' })
  assert.equal(openCheckpointBytes(checkpoint).manifest.compatibilityProfile, 'ppte-2.0-ga-b.1')
  const inferredCheckpoint = buildCheckpointBytes(base, { assetBytes: { asset_pixel: imageBytes } })
  assert.equal(openCheckpointBytes(inferredCheckpoint).manifest.compatibilityProfile, 'ppte-2.0-ga-b.1')

  const missing = exportImagePptx(base)
  assert.equal(missing.ok, false)
  assert.ok(missing.issues.some((issue) => issue.code === 'ASSET_PAYLOAD_MISSING'))
  assert.ok(missing.bytes.length > 0)
  const reportWithMissingSource = buildCapabilityReport({ ...base, sources: { source_report: { id: 'source_report' } } }, 'pptx-image')
  assert.equal(reportWithMissingSource.ok, false)
  assert.ok(reportWithMissingSource.issues.some((issue) => issue.code === 'SOURCE_CITATION_MISSING'))
  const inconsistent = cloneJson(base)
  ;(inconsistent.slides.slide_metrics.elements.metric_page_two as TextElement).content.paragraphs[0]!.runs[0]!.text = 'Revenue 41%'
  const blockedConsistencyExport = exportImagePptx(inconsistent, { assetBytes: { asset_pixel: imageBytes } })
  assert.equal(blockedConsistencyExport.ok, false)
  assert.ok(blockedConsistencyExport.issues.some((issue) => issue.code === 'FACT_DISPLAY_INCONSISTENT'))
})

test('Legacy migration imports GA-B chart and semantic references only under the explicit GA-B profile', () => {
  const source = {
    format: 'legacy-json',
    documentId: 'legacy-chart',
    title: 'Legacy chart',
    slides: [{ id: 'slide_1', elements: [{ id: 'chart_1', type: 'chart', chartType: 'line', frame: { x: 0, y: 0, width: 640, height: 360 }, data: { columns: [{ id: 'period', label: 'Period', type: 'string' }, { id: 'value', label: 'Value', type: 'number' }], rows: [{ id: 'row_1', values: { period: 'Q1', value: 10 } }] }, encoding: { categoryField: 'period', valueFields: ['value'] }, semanticRefs: { factIds: ['fact_1'], sourceIds: ['source_1'] } }] }],
    facts: { fact_1: { id: 'fact_1', key: 'value', value: 10 } },
    sources: { source_1: { id: 'source_1', title: 'Public source' } },
  }
  const migrated = migrateLegacyDocument(source, { targetProfile: 'ppte-2.0-ga-b.1' })
  assert.equal(migrated.ok, true)
  assert.equal(migrated.document.slides.slide_1.elements.chart_1.type, 'chart')
  assert.deepEqual(validateRuntimeDocument(migrated.document).filter((issue) => issue.severity === 'error'), [])
  const areaSource = cloneJson(source)
  ;(areaSource.slides[0]!.elements[0] as { chartType: string }).chartType = 'area'
  const area = migrateLegacyDocument(areaSource, { targetProfile: 'ppte-2.0-ga-b.1' })
  assert.equal(area.document.slides.slide_1.rootOrder.length, 0)
  assert.ok(area.report.issues.some((issue) => issue.code === 'MIGRATION_UNSUPPORTED_ELEMENT'))
  const gaA = migrateLegacyDocument(source)
  assert.equal(gaA.document.slides.slide_1.rootOrder.length, 0)
  assert.ok(gaA.report.issues.some((issue) => issue.code === 'MIGRATION_UNSUPPORTED_ELEMENT'))
})
