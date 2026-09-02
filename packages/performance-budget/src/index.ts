import type { PpteDocument } from '../../schema/src/index.js'

export const GA_A_CAPACITY_BUDGET = Object.freeze({
  maxSlides: 30,
  maxElements: 900,
  maxGroups: 120,
  maxAssetBytes: 50 * 1024 * 1024,
  maxFonts: 20,
})

export const GA_A_PERFORMANCE_BUDGET = Object.freeze({
  openToInteractiveMs: 2_000,
  pageSwitchMs: 100,
  selectionMs: 50,
  humanCommitMs: 100,
  textCommitMs: 150,
  journalAppendMs: 100,
  undoRedoMs: 100,
  checkpoint50MbMs: 3_000,
  portableViewerFirstScreenMs: 2_000,
  portableQuickFixFirstScreenMs: 2_500,
  viewerBundleGzipBytes: 1_200_000,
  quickFixBundleGzipBytes: 2_000_000,
})

export interface CapacityUsage {
  slides: number
  elements: number
  groups: number
  assetBytes: number
  fonts: number
}

export interface CapacityViolation {
  code: 'CAPACITY_BUDGET_EXCEEDED'
  metric: keyof CapacityUsage
  actual: number
  budget: number
  message: string
}

export interface PerformanceMetric {
  name: string
  samplesMs: number[]
  p95Ms: number
  budgetMs: number
  passed: boolean
}

export interface BundleMetric {
  name: string
  bytes: number
  budgetBytes: number
  passed: boolean
}

export function measureCapacity(document: PpteDocument): CapacityUsage {
  let elements = 0
  let groups = 0
  for (const slide of Object.values(document.slides)) {
    elements += Object.keys(slide.elements).length
    groups += Object.keys(slide.groups ?? {}).length
  }
  return {
    slides: document.slideOrder.length,
    elements,
    groups,
    assetBytes: Object.values(document.assets).reduce((sum, asset) => sum + asset.byteLength, 0),
    fonts: Object.keys(document.fonts).length,
  }
}

export function validateCapacityBudget(document: PpteDocument, budget = GA_A_CAPACITY_BUDGET): CapacityViolation[] {
  const usage = measureCapacity(document)
  const limits: Array<[keyof CapacityUsage, number]> = [
    ['slides', budget.maxSlides],
    ['elements', budget.maxElements],
    ['groups', budget.maxGroups],
    ['assetBytes', budget.maxAssetBytes],
    ['fonts', budget.maxFonts],
  ]
  return limits.filter(([metric, limit]) => usage[metric] > limit).map(([metric, limit]) => ({
    code: 'CAPACITY_BUDGET_EXCEEDED',
    metric,
    actual: usage[metric],
    budget: limit,
    message: `${metric} usage ${usage[metric]} exceeds GA-A budget ${limit}.`,
  }))
}

export function percentile(samples: readonly number[], percentileValue = 0.95): number {
  if (samples.length === 0) return Number.NaN
  const bounded = Math.min(1, Math.max(0, percentileValue))
  const sorted = [...samples].sort((left, right) => left - right)
  const rank = (sorted.length - 1) * bounded
  const lower = Math.floor(rank)
  const upper = Math.ceil(rank)
  if (lower === upper) return sorted[lower]!
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (rank - lower)
}

export function evaluatePerformanceBudget(name: string, samplesMs: readonly number[], budgetMs: number): PerformanceMetric {
  const values = [...samplesMs]
  const p95Ms = percentile(values)
  return { name, samplesMs: values, p95Ms, budgetMs, passed: Number.isFinite(p95Ms) && p95Ms <= budgetMs }
}

export function evaluateBundleBudget(name: string, bytes: number, budgetBytes: number): BundleMetric {
  return { name, bytes, budgetBytes, passed: Number.isFinite(bytes) && bytes <= budgetBytes }
}

export function benchmark(name: string, operation: () => void, budgetMs: number, samples = 5): PerformanceMetric {
  const results: number[] = []
  for (let index = 0; index < Math.max(1, samples); index += 1) {
    const start = performance.now()
    operation()
    results.push(performance.now() - start)
  }
  return evaluatePerformanceBudget(name, results, budgetMs)
}

export function assertPerformanceBudget(metrics: readonly PerformanceMetric[], bundles: readonly BundleMetric[] = []): void {
  const failed = [...metrics.filter((metric) => !metric.passed), ...bundles.filter((metric) => !metric.passed)]
  if (failed.length) throw new Error(`PERFORMANCE_BUDGET_FAILED: ${failed.map((metric) => 'p95Ms' in metric ? `${metric.name}=${metric.p95Ms.toFixed(1)}/${metric.budgetMs}ms` : `${metric.name}=${metric.bytes}/${metric.budgetBytes}bytes`).join(', ')}`)
}
