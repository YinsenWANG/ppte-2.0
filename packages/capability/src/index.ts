import { canonicalRevision } from '../../canonical-json/src/index.js'
import { GA_C_CHART_TYPES, validateChartContract } from '../../charts/src/index.js'
import { checkFactSourceConsistency } from '../../facts/src/index.js'
import { validateDocument } from '../../schema/src/index.js'
import { checkGlyphCoverage, inspectGlyphCoverage, textContent, validateTextOverflow } from '../../validation/src/index.js'
import type { Element, PpteDocument, ValidationIssue } from '../../schema/src/index.js'

export type CapabilityTarget = 'portable-viewer' | 'portable-quick-fix' | 'portable-light-edit' | 'presenter' | 'pdf' | 'png' | 'pptx-image' | 'pptx-semantic'
export type CapabilityStatus = 'native' | 'property' | 'rasterized' | 'static' | 'font-replacement' | 'layout-risk' | 'missing-source' | 'unsupported' | 'blocked'

export interface CapabilityItem {
  id: string
  slideId: string
  elementId?: string
  type?: Element['type']
  status: CapabilityStatus
  reason?: string
  recovery?: string
  sourcePath?: string
}

export interface CapabilityReport {
  reportVersion: '1'
  target: CapabilityTarget
  sourceDocumentId: string
  sourceRevision: string
  ok: boolean
  degraded: boolean
  items: CapabilityItem[]
  issues: ValidationIssue[]
  summary: Record<CapabilityStatus, number>
}

const STATUS_ORDER: CapabilityStatus[] = ['blocked', 'unsupported', 'font-replacement', 'missing-source', 'layout-risk', 'rasterized', 'property', 'static', 'native']

export function buildCapabilityReport(document: PpteDocument, target: CapabilityTarget, options: { sourceRevision?: string } = {}): CapabilityReport {
  const issues = [
    ...validateDocument(document, { runtimeSubset: false }).filter((issue) => issue.severity === 'error'),
    ...checkFactSourceConsistency(document).issues,
  ]
  const items: CapabilityItem[] = []
  for (const slideId of document.slideOrder ?? []) {
    const slide = document.slides?.[slideId]
    if (!slide) continue
    for (const element of Object.values(slide.elements ?? {})) {
      items.push(capabilityForElement(document, slideId, element, target))
    }
  }
  const summary = Object.fromEntries(STATUS_ORDER.map((status) => [status, items.filter((item) => item.status === status).length])) as Record<CapabilityStatus, number>
  const degraded = items.some((item) => ['blocked', 'unsupported', 'font-replacement', 'missing-source', 'layout-risk', 'rasterized'].includes(item.status))
  return {
    reportVersion: '1',
    target,
    sourceDocumentId: document.documentId,
    sourceRevision: options.sourceRevision ?? canonicalRevision(document),
    ok: !issues.some((issue) => issue.severity === 'error' || ['FACT_DISPLAY_INCONSISTENT', 'CHART_FACT_INCONSISTENT', 'SOURCE_CITATION_MISSING'].includes(issue.code)) && !items.some((item) => ['blocked', 'unsupported', 'missing-source'].includes(item.status)),
    degraded,
    items,
    issues,
    summary,
  }
}

export const createCapabilityReport = buildCapabilityReport
export const getCapabilityReport = buildCapabilityReport

function capabilityForElement(document: PpteDocument, slideId: string, element: Element, target: CapabilityTarget): CapabilityItem {
  let status = baseStatus(element, target)
  let reason: string | undefined
  let recovery: string | undefined
  const item: CapabilityItem = { id: `${slideId}:${element.id}`, slideId, elementId: element.id, type: element.type, status }
  if (element.type === 'text') {
    const glyph = inspectGlyphCoverage(document, element, undefined, { strict: target === 'portable-quick-fix' || target === 'portable-light-edit' })
    const glyphIssues = checkGlyphCoverage(document, element, undefined, { strict: target === 'portable-quick-fix' || target === 'portable-light-edit' })
    if (glyphIssues.length) {
      status = target === 'portable-viewer' || target === 'pptx-semantic' ? 'font-replacement' : 'blocked'
      reason = glyph.source === 'unresolved' ? 'The font has no explicit portable coverage declaration.' : 'The selected font does not cover all text code points.'
      recovery = 'Choose a declared system-safe font or embed a font with coverage before editing.'
    }
    if (validateTextOverflow(document, slideId, element).length && status === 'native') {
      status = 'layout-risk'
      reason = 'Text exceeds its fixed frame; no implicit reflow is applied.'
      recovery = 'Shorten text or resize the text box explicitly.'
    }
    if (!textContent(element) && status === 'blocked') recovery = 'Add editable text content or choose Viewer-only output.'
  }
  if (element.type === 'image' && !document.assets[element.assetId]) {
    status = 'missing-source'
    reason = `Asset ${element.assetId} is not present in the document asset table.`
    recovery = 'Embed the asset or remove the image before export.'
  }
  const chartRuntimeProfile = target === 'portable-viewer' || target === 'portable-quick-fix' ? 'ga-b' : 'ga-c'
  if (element.type === 'chart' && !GA_C_CHART_TYPES.includes(element.chartType as typeof GA_C_CHART_TYPES[number])) {
    status = 'unsupported'
    reason = `Chart type ${element.chartType} is outside the GA-C chart runtime.`
    recovery = 'Use a supported chart type or preserve the source document for a newer host.'
  }
  if (element.type === 'chart' && validateChartContract(element, { runtimeSubset: true, runtimeProfile: chartRuntimeProfile }).some((issue) => issue.code === 'CHART_TYPE_UNSUPPORTED')) {
    status = 'unsupported'
    reason = `Chart type ${element.chartType} is not supported by ${chartRuntimeProfile.toUpperCase()} runtime.`
    recovery = 'Edit the chart in a GA-C host or export the source document.'
  }
  if (element.type === 'chart' && !validateChartContract(element, { runtimeSubset: true, runtimeProfile: 'ga-c' }).length && target === 'pptx-image') {
    status = 'rasterized'
    reason = 'The chart is included in the single-page image surface; chart data is not editable in PPTX.'
    recovery = 'Edit the Fact or Chart in PPTe and export again.'
  }
  if (element.type === 'component' && element.fallback.kind === 'asset' && element.fallback.assetId && !document.assets[element.fallback.assetId]) {
    status = 'missing-source'
    reason = `Widget fallback asset ${element.fallback.assetId} is not present in the document asset table.`
    recovery = 'Embed the fallback asset or use a host with the Widget implementation.'
  }
  if (element.semanticRefs?.sourceIds?.some((sourceId) => !document.sources?.[sourceId])) {
    status = 'missing-source'
    reason = 'A referenced source is not present in the document.'
    recovery = 'Restore the source record or mark the reference as unavailable.'
  }
  if (status !== baseStatus(element, target) || reason || recovery) return { ...item, status, reason, recovery }
  return item
}

function baseStatus(element: Element, target: CapabilityTarget): CapabilityStatus {
  if (element.type === 'component') return target === 'pptx-semantic' || target === 'portable-light-edit' ? 'static' : 'unsupported'
  if (target === 'pptx-image') return element.type === 'chart' || element.type === 'text' || element.type === 'shape' || element.type === 'image' ? 'rasterized' : 'unsupported'
  if (target === 'pptx-semantic' && element.type === 'chart') return 'static'
  if (element.type === 'chart') return target === 'portable-quick-fix' ? 'static' : target === 'portable-light-edit' ? 'property' : target === 'png' || target === 'pdf' ? 'rasterized' : 'native'
  if (target === 'portable-viewer' || target === 'presenter') return 'native'
  if (target === 'portable-quick-fix' || target === 'portable-light-edit') return element.type === 'text' || element.type === 'image' ? 'property' : 'static'
  if (target === 'png') return 'rasterized'
  return 'native'
}
