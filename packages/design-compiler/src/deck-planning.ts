import { canonicalHash, cloneJson } from '../../canonical-json/src/index.js'
import { validatePresentationIR } from '../../schema/src/index.js'
import type { CompiledSlideDraft, PresentationIR } from '../../schema/src/index.js'
import { RecipeRegistry, applyRecipeVariant, scoreRecipe, recipeKey } from '../../layout-recipes/src/index.js'
import { compileSlide, type CompilePresentationContext } from './index.js'

export interface LayoutMeasurement {
  status: 'pass' | 'fail' | 'unverified'
  draftDigest: string
  environment?: string
  fontDigest?: string
  rendererDigest?: string
  resourceDigest?: string
  screenshotDigest?: string
  elements?: Array<{ id: string; overflow: boolean; font: string; width: number; height: number }>
  reason?: string
}
export type LayoutTarget = 'html-edit' | 'html-present' | 'pdf' | 'pptx-image' | 'pptx-semantic'
export type LayoutMapping = 'native' | 'static' | 'rasterized' | 'fallback' | 'unsupported' | 'unverified'
export interface DeckPlanningOptions extends CompilePresentationContext {
  requiredTargets?: Array<{ target: LayoutTarget; allowed: Array<Exclude<LayoutMapping, 'unsupported' | 'unverified'>> }>
  /** Explicit target contracts keyed by recipe id@version; absence never implies support. */
  recipeCapabilities?: Record<string, Partial<Record<LayoutTarget, LayoutMapping>>>

  budget?: { candidatesPerSlide?: number; beamWidth?: number; maxEvaluations?: number; maxTransitions?: number; measurementTimeoutMs?: number }
  measure?: (draft: CompiledSlideDraft) => Promise<LayoutMeasurement>
  /** Caller-owned delivery identity (history, runtime and export configuration). */
  deliveryIdentity?: Record<string, string>
}
export interface DeckCandidateReport {
  key: string
  status: 'rejected' | 'eligible'
  reasons: string[]
  score?: number
  measurement?: LayoutMeasurement
}
export interface DeckLayoutReport {
  version: '1'
  identity: string
  seed: string
  status: 'complete' | 'infeasible' | 'budget-exceeded' | 'invalid'
  visualStatus: 'pass' | 'fail' | 'unverified'
  budget: Required<NonNullable<DeckPlanningOptions['budget']>>
  evaluations: number
  transitions: number
  stop?: { code: string; slideKey?: string }
  pages: Array<{ slideKey: string; candidates: DeckCandidateReport[]; selected?: string; reasons?: string[] }>
  splitProposals: Array<{ slideKey: string; reason: string; blockGroups: string[][]; requiresApproval: true }>
}
const bounded = (value: number | undefined, fallback: number, max: number) => {
  const n = value ?? fallback
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`PLANNING_BUDGET_INVALID: expected integer 1..${max}`)
  return n
}

/** Pure proposals only. All durable changes still require Operation Engine transactions. */
export async function planDeckLayout(ir: PresentationIR, options: DeckPlanningOptions) {
  const registry = options.recipes ?? new RecipeRegistry()
  const recipes = registry.listDeclarative().sort((a, b) => recipeKey(a).localeCompare(recipeKey(b)))
  const budget = { candidatesPerSlide: bounded(options.budget?.candidatesPerSlide, 6, 32), beamWidth: bounded(options.budget?.beamWidth, 8, 64), maxEvaluations: bounded(options.budget?.maxEvaluations, 4096, 16384), maxTransitions: bounded(options.budget?.maxTransitions, 10000, 100000), measurementTimeoutMs: bounded(options.budget?.measurementTimeoutMs, 10000, 60000) }
  const seed = options.seed ?? 'deck-layout-1'
  const identity = canonicalHash({ ir, recipes, canvas: options.canvas, theme: options.theme ?? null, document: options.document ?? null, seed, budget, compiler: options.compilerVersion ?? 'design-compiler-1.1.0', fonts: options.fontMetricsFingerprint ?? null, history: options.historyAcceptance ?? {}, delivery: options.deliveryIdentity ?? {}, recipeId: options.recipeId ?? null, recipeVersion: options.recipeVersion ?? null, variantId: options.variantId ?? null, measurement: Boolean(options.measure), requiredTargets: options.requiredTargets ?? [], capabilities: options.recipeCapabilities ?? {} })
  const report: DeckLayoutReport = { version: '1', identity, seed, status: 'complete', visualStatus: 'unverified', budget, evaluations: 0, transitions: 0, pages: [], splitProposals: [] }
  const bindMeasurements = () => { report.identity = canonicalHash({ input: identity, measurements: report.pages.map(p => p.candidates.map(c => c.measurement ?? null)) }) }
  const stop = (status: DeckLayoutReport['status'], code: string, slideKey?: string) => { report.status = status; bindMeasurements(); report.stop = { code, ...(slideKey ? { slideKey } : {}) }; return { slideDrafts: [] as CompiledSlideDraft[], report } }
  if (validatePresentationIR(ir).some(i => i.severity === 'error')) return stop('invalid', 'IR_INVALID')
  type Choice = { draft: CompiledSlideDraft; entry: DeckCandidateReport }
  let beam: Array<{ choices: Choice[]; score: number; tie: string }> = [{ choices: [], score: 0, tie: '' }]
  for (const slide of ir.slides) {
    const page: DeckLayoutReport['pages'][number] = { slideKey: slide.slideKey, candidates: [] }
    report.pages.push(page)
    const choices: Choice[] = []
    for (const recipe of recipes) {
      if (options.recipeId && recipe.id !== options.recipeId || options.recipeVersion && recipe.version !== options.recipeVersion) continue
      const eligibleVariants = (recipe.variants ?? []).filter(v => Object.entries(v.when ?? {}).every(([key, value]) => slide[key as 'density'] === value))
      const variants = options.variantId ? [options.variantId] : eligibleVariants.length ? eligibleVariants.map(v => v.id).sort() : [undefined]
      for (const variantId of variants) {
        if (report.evaluations >= budget.maxEvaluations) return stop('budget-exceeded', 'CANDIDATE_BUDGET', slide.slideKey)
        report.evaluations++
        const entry: DeckCandidateReport = { key: `${recipeKey(recipe)}:${variantId ?? 'base'}`, status: 'rejected', reasons: [] }
        page.candidates.push(entry)
        if ((options.requiredTargets ?? []).some(required => {
          const mapping = options.recipeCapabilities?.[recipeKey(recipe)]?.[required.target]
          return !mapping || mapping === 'unsupported' || mapping === 'unverified' || !required.allowed.includes(mapping)
        })) { entry.reasons.push('required-target-contract-unsatisfied'); continue }
        let resolved
        try { resolved = applyRecipeVariant(recipe, slide, variantId) } catch (e) { entry.reasons.push(String(e)); continue }
        // Hard purpose/capacity checks and compilation precede any aesthetic ranking.
        const draft = compileSlide(slide, { ...options, recipes: registry, recipeId: recipe.id, recipeVersion: recipe.version, variantId, seed })
        const referenceOverflow = draft.validationIssues.filter(i => i.code === 'QUALITY_OVERFLOW')
        // Reference advances are only a conservative preflight. A successful
        // actual-font measurement is authoritative; unavailable verification
        // must retain the reference rejection instead of silently bypassing it.
        if (options.measure) draft.validationIssues = draft.validationIssues.filter(i => i.code !== 'QUALITY_OVERFLOW')
        const errors = draft.validationIssues.filter(i => i.severity === 'error')
        if (errors.length) { entry.reasons = errors.map(i => i.code); continue }
        if (slide.purpose !== 'custom' && !resolved.supports.includes(slide.purpose) && !resolved.supports.includes('custom')) { entry.reasons.push('purpose-mismatch'); continue }
        if (options.measure) {
          let timer: ReturnType<typeof setTimeout> | undefined
          try {
            entry.measurement = await Promise.race([options.measure(cloneJson(draft)), new Promise<LayoutMeasurement>((_, reject) => { timer = setTimeout(() => reject(new Error('MEASUREMENT_TIMEOUT')), budget.measurementTimeoutMs) })])
            const m = entry.measurement
            if (m.draftDigest !== canonicalHash(draft) || m.status === 'pass' && (!m.fontDigest || !m.rendererDigest || !m.resourceDigest || !m.environment || !m.screenshotDigest || !m.elements || draft.elementDrafts.filter(d => d.kind === 'text').some(d => !m.elements!.some(e => e.id === d.draftId)) || m.elements.some(e => e.overflow || !Number.isFinite(e.width) || !Number.isFinite(e.height)))) throw new Error('MEASUREMENT_EVIDENCE_INVALID')
          } catch (e) { entry.measurement = { status: 'fail', draftDigest: canonicalHash(draft), reason: String(e) } } finally { clearTimeout(timer) }
          if (entry.measurement.status === 'unverified' && referenceOverflow.length) { entry.reasons.push('REFERENCE_OVERFLOW_UNVERIFIED'); continue }
          if (entry.measurement.status === 'fail') { entry.reasons.push(entry.measurement.reason ?? 'BROWSER_OVERFLOW'); continue }
        } else entry.measurement = { status: 'unverified', draftDigest: canonicalHash(draft), reason: 'Browser not provided; reference metrics only.' }
        const score = scoreRecipe(slide, resolved, options.historyAcceptance?.[recipeKey(recipe)])
        if (!Number.isFinite(score.score)) { entry.reasons = score.reasons; continue }
        entry.status = 'eligible'; entry.score = score.score; entry.reasons = ['hard-constraints-pass', ...score.reasons]
        choices.push({ draft, entry })
      }
    }
    if (!choices.length) {
      report.visualStatus = page.candidates.some(c => c.measurement?.status === 'fail') ? 'fail' : 'unverified'
      // Connected keepTogether components remain indivisible; proposals never rewrite content.
      const groups = slide.blocks.map(b => [b.key])
      for (const b of slide.blocks) for (const key of b.keepTogetherWith ?? []) {
        const a = groups.find(g => g.includes(b.key)); const z = groups.find(g => g.includes(key))
        if (a && z && a !== z) { a.push(...z); groups.splice(groups.indexOf(z), 1) }
      }
      report.splitProposals.push({ slideKey: slide.slideKey, reason: 'No feasible candidate; review these indivisible groups for a new page or recipe. Capacity of proposed pages is not yet verified.', blockGroups: groups, requiresApproval: true })
      return stop('infeasible', 'NO_FEASIBLE_CANDIDATE', slide.slideKey)
    }
    choices.sort((a, b) => b.entry.score! - a.entry.score! || canonicalHash({ seed, key: a.entry.key }).localeCompare(canonicalHash({ seed, key: b.entry.key })))
    const next: typeof beam = []
    for (const state of beam) for (const choice of choices.slice(0, budget.candidatesPerSlide)) {
      if (report.transitions >= budget.maxTransitions) return stop('budget-exceeded', 'SEARCH_BUDGET', slide.slideKey)
      report.transitions++
      const previous = state.choices.at(-1)
      // A small rhythm penalty cannot outweigh semantic fit. Consecutive data pages are exempt.
      const repeat = previous?.entry.key === choice.entry.key && !['metrics', 'chart', 'comparison'].includes(slide.purpose) ? 3 : 0
      const selected = [...state.choices, choice]
      next.push({ choices: selected, score: state.score + choice.entry.score! - repeat, tie: canonicalHash({ seed, keys: selected.map(c => c.entry.key) }) })
    }
    beam = next.sort((a, b) => b.score - a.score || a.tie.localeCompare(b.tie)).slice(0, budget.beamWidth)
  }
  const selected = beam[0].choices
  selected.forEach((c, i) => { report.pages[i].selected = c.entry.key; report.pages[i].reasons = [...c.entry.reasons, 'bounded-deck-semantic-and-adjacency-score'] })
  report.visualStatus = selected.length && selected.every(c => c.entry.measurement?.status === 'pass') ? 'pass' : 'unverified'
  bindMeasurements()
  return { slideDrafts: selected.map(c => c.draft), report }
}
