import { canonicalRevision } from '../../canonical-json/src/index.js'
import type { Element, Fact, FactId, Operation, PpteDocument, Source, SourceId, Transaction, ValidationIssue } from '../../schema/src/index.js'

export interface FactReference {
  slideId: string
  elementId: string
  elementType: Element['type']
  factId: FactId
}

export interface SourceReference {
  slideId: string
  elementId: string
  sourceId: SourceId
}

export interface FactConsistencyReport {
  ok: boolean
  facts: Record<FactId, { references: FactReference[]; displayValues: string[]; consistent: boolean }>
  sources: Record<SourceId, { references: SourceReference[]; displayable: boolean }>
  issues: ValidationIssue[]
}

export function formatFactValue(fact: Fact): string {
  const value = fact.value === null ? '' : typeof fact.value === 'number' ? formatNumber(fact.value, fact.format) : String(fact.value)
  return fact.unit ? `${value}${fact.unit}` : value
}

export function findFactReferences(document: PpteDocument, factId: FactId): FactReference[] {
  const references: FactReference[] = []
  for (const slideId of document.slideOrder ?? []) for (const element of Object.values(document.slides?.[slideId]?.elements ?? {})) if (element.semanticRefs?.factIds?.includes(factId)) references.push({ slideId, elementId: element.id, elementType: element.type, factId })
  return references
}

export function findSourceReferences(document: PpteDocument, sourceId: SourceId): SourceReference[] {
  const references: SourceReference[] = []
  for (const slideId of document.slideOrder ?? []) for (const element of Object.values(document.slides?.[slideId]?.elements ?? {})) if (element.semanticRefs?.sourceIds?.includes(sourceId)) references.push({ slideId, elementId: element.id, sourceId })
  return references
}

/** L2 check: every referenced Fact has one display value across pages and every Source can render a citation. */
export function checkFactSourceConsistency(document: PpteDocument): FactConsistencyReport {
  const issues: ValidationIssue[] = []
  const facts: FactConsistencyReport['facts'] = {}
  for (const [factId, fact] of Object.entries(document.facts ?? {})) {
    const references = findFactReferences(document, factId)
    const display = formatFactValue(fact)
    const displayValues: string[] = []
    for (const reference of references) {
      const element = document.slides[reference.slideId]?.elements[reference.elementId]
      if (!element) continue
      if (element.type === 'text') {
        const text = plainText(element)
        const values = extractFactCandidates(text, fact)
        displayValues.push(...values)
        if (values.length > 0 && !values.includes(display)) issues.push(consistencyIssue('FACT_DISPLAY_INCONSISTENT', `Fact ${factId} is displayed inconsistently on ${reference.slideId}/${reference.elementId}.`, reference, factId))
      } else if (element.type === 'chart') {
        const values = chartFactValues(element, fact)
        displayValues.push(...values.map(String))
        const numberFact = typeof fact.value === 'number' ? fact.value : undefined
        if (values.length > 0 && numberFact !== undefined && values.some((value) => Math.abs(value - numberFact) > 0.000001)) issues.push(consistencyIssue('CHART_FACT_INCONSISTENT', `Chart ${reference.elementId} does not match Fact ${factId}.`, reference, factId))
      }
    }
    facts[factId] = { references, displayValues, consistent: !issues.some((issue) => issue.factId === factId && (issue.code === 'FACT_DISPLAY_INCONSISTENT' || issue.code === 'CHART_FACT_INCONSISTENT')) }
  }
  const sources: FactConsistencyReport['sources'] = {}
  for (const [sourceId, source] of Object.entries(document.sources ?? {})) {
    const references = findSourceReferences(document, sourceId)
    const displayable = isDisplayableSource(source)
    sources[sourceId] = { references, displayable }
    if (references.length > 0 && !displayable) for (const reference of references) issues.push(consistencyIssue('SOURCE_CITATION_MISSING', `Source ${sourceId} has no displayable citation.`, reference, undefined, sourceId))
  }
  return { ok: issues.length === 0, facts, sources, issues }
}

export interface FactUpdateTransactionOptions {
  transactionId?: string
  actor?: Transaction['actor']
  createdAt?: string
  targetElementIds?: string[]
  strategy?: 'replace-display-value' | 'update-chart-values'
  requireConfirmation?: boolean
}

/** Build the explicit, reviewable transaction used by Quick Fix and agent flows. */
export function buildFactUpdateTransaction(document: PpteDocument, factId: FactId, value: Fact['value'], options: FactUpdateTransactionOptions = {}): Transaction {
  const before = document.facts?.[factId]
  if (!before) throw new Error(`FACT_REFERENCE_MISSING: ${factId}`)
  const next: Fact = { ...structuredClone(before), value }
  const references = findFactReferences(document, factId)
  const targetElementIds = options.targetElementIds ?? references.map((reference) => reference.elementId)
  if (!targetElementIds.length) throw new Error(`FACT_REFERENCE_MISSING: Fact ${factId} has no references.`)
  const selectedReferences = references.filter((reference) => targetElementIds.includes(reference.elementId))
  const textTargets = selectedReferences.filter((reference) => reference.elementType === 'text').map((reference) => reference.elementId)
  const chartTargets = selectedReferences.filter((reference) => reference.elementType === 'chart').map((reference) => reference.elementId)
  const operations: Operation[] = [{ opId: `fact:${factId}:upsert`, kind: 'fact.upsert', fact: next }]
  const explicitStrategy = options.strategy
  if ((explicitStrategy ?? 'replace-display-value') === 'replace-display-value' && textTargets.length) operations.push({ opId: `fact:${factId}:sync:text`, kind: 'fact.syncReferences', factId, targetElementIds: [...new Set(textTargets)], strategy: 'replace-display-value', previousValue: before.value })
  if ((explicitStrategy ?? 'update-chart-values') === 'update-chart-values' && chartTargets.length) operations.push({ opId: `fact:${factId}:sync:chart`, kind: 'fact.syncReferences', factId, targetElementIds: [...new Set(chartTargets)], strategy: 'update-chart-values', previousValue: before.value })
  if (operations.length === 1) throw new Error(`FACT_REFERENCE_MISSING: Fact ${factId} has no compatible references for synchronization.`)
  return {
    transactionId: options.transactionId ?? `fact-sync:${factId}:${canonicalRevision(document).slice(-12)}`,
    baseRevision: canonicalRevision(document),
    actor: options.actor ?? { type: 'human', id: 'fact-quick-fix' },
    scope: { kind: 'document', permissions: ['facts', 'content'], allowInsert: false, allowDelete: false },
    changeContract: {
      allowedOperationKinds: ['fact.upsert', 'fact.syncReferences'],
      maxChangedSlides: references.length ? new Set(references.map((reference) => reference.slideId)).size : 0,
      maxChangedElements: targetElementIds.length,
      maxInsertedElements: 0,
      maxDeletedElements: 0,
      maxReplacedAssets: 0,
      maxChangedFacts: 1,
      maxChangedSources: 0,
      maxChangedThemeTokens: 0,
      maxChangedStylePresets: 0,
      preserve: { geometry: 'preserve', style: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'allow-explicit-sync' },
      requireConfirmation: options.requireConfirmation ?? true,
      userIntentSummary: `Update Fact ${factId} and explicitly synchronize its declared references.`,
    },
    reason: 'Explicit Fact synchronization',
    createdAt: options.createdAt ?? '1970-01-01T00:00:00.000Z',
    validationLevel: 'L2',
    metadata: { kind: 'fact-sync', factId, targetElementIds: [...new Set(targetElementIds)] },
    operations,
  }
}

function plainText(element: Extract<Element, { type: 'text' }>): string { return element.content.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join('\n') }
function extractFactCandidates(text: string, fact: Fact): string[] {
  const display = formatFactValue(fact)
  if (display && text.includes(display)) return [display]
  if (typeof fact.value === 'number') {
    const matches = text.match(/[-+]?\d[\d,]*(?:\.\d+)?%?/g) ?? []
    return matches.filter((candidate) => candidate.replaceAll(',', '') !== String(fact.value))
  }
  return []
}
function chartFactValues(element: Extract<Element, { type: 'chart' }>, fact: Fact): number[] {
  const keys = new Set([fact.id, fact.key])
  const fields = new Set(element.encoding.valueFields)
  const values: number[] = []
  for (const row of element.data.rows) if (keys.has(row.id)) for (const field of fields) if (typeof row.values[field] === 'number') values.push(row.values[field] as number)
  for (const row of element.data.rows) for (const field of fields) if (keys.has(field) && typeof row.values[field] === 'number') values.push(row.values[field] as number)
  return values
}
function isDisplayableSource(source: Source): boolean { return Boolean(source.citation || source.title || source.author || source.publisher || source.url) }
function formatNumber(value: number, format?: string): string {
  if (!format) return String(value)
  if (format.includes('%')) return `${(value * 100).toFixed(decimalPlaces(format))}%`
  if (format.includes(',')) return new Intl.NumberFormat('en-US', { maximumFractionDigits: decimalPlaces(format) }).format(value)
  return value.toFixed(decimalPlaces(format)).replace(/\.0+$/, '')
}
function decimalPlaces(format: string): number { const match = /\.(0+)/.exec(format); return match?.[1].length ?? 0 }
function consistencyIssue(code: ValidationIssue['code'], message: string, reference: { slideId: string; elementId: string }, factId?: string, sourceId?: string): ValidationIssue {
  return { code, severity: 'warning', message, slideId: reference.slideId, elementId: reference.elementId, ...(factId ? { factId } : {}), ...(sourceId ? { path: `/sources/${escapePointer(sourceId)}` } : {}), recovery: code === 'SOURCE_CITATION_MISSING' ? 'Add a citation, URL, title, author, or publisher to the Source.' : 'Run an explicit Fact synchronization transaction or resolve the conflicting display.' }
}
function escapePointer(value: string): string { return value.replaceAll('~', '~0').replaceAll('/', '~1') }
