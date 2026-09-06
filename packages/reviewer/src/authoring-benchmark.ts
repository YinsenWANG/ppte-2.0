import { canonicalHash } from '../../canonical-json/src/index.js'

export type BenchmarkStage = 'M1' | 'M2' | 'M3'
export type BenchmarkStatus = 'pass' | 'fail' | 'unverified'
export interface BenchmarkManifest {
  version: string
  protocol: { repetitions: number; seeds: number[]; budget: Record<string, number> }
  tasks: { id: string; category: string; usage: string; material: string; answers: { id: string; value: number; unit: string; sourceId: string }[]; scriptIds: string[] }[]
  scripts: { id: string; version: number; minStage: BenchmarkStage; instruction: string }[]
  qualityLines: Record<'content' | 'editing' | 'rendering' | 'visual', string[]>
  allowedOverlaps: { recipeId: string; pageRole: string; back: string; front: string; reason: string }[]
}
export interface BenchmarkArtifact { path: string; sha256: string }
export interface BenchmarkIdentity {
  source: string; history: string; resources: string; fonts: string
  runtime: string; renderer: string; exporter: string; config: string
}
export interface BenchmarkObservation {
  check: string; status: BenchmarkStatus; identityDigest: string
  pageId: string; objectIds: string[]; note: string; evidence: BenchmarkArtifact[]
}
export interface BenchmarkRun {
  id: string; taskId: string; side: 'baseline' | 'candidate'; repetition: number
  commit: string; buildId: string; agent: string; seed: number; fixtureDigest: string
  budget: Record<string, number>; environment: Record<string, string>
  identity: BenchmarkIdentity; original: BenchmarkArtifact; repaired: BenchmarkArtifact
  lines: Record<keyof BenchmarkManifest['qualityLines'], BenchmarkObservation[]>
  failures: string[]
}
export interface BenchmarkHumanReview {
  runId: string; reviewerId: string; scriptId: string; scriptVersion: number
  status: BenchmarkStatus; elapsedMs: number | null; repairMs: number | null
  helpCount: number | null; repairOperations: string[]; failures: string[]
  evidence: BenchmarkArtifact[]
}
export interface BenchmarkSubmission {
  version: 'd07-evidence-v1'; fixtureDigest: string
  reviewers: { id: string; role: 'owner' | 'target-user'; kind: 'human' }[]
  runs: BenchmarkRun[]; humanReviews: BenchmarkHumanReview[]
}

const stages = { M1: 1, M2: 2, M3: 3 }
const lines = ['content', 'editing', 'rendering', 'visual'] as const
const requiredChecks = { content: ['facts', 'deletion'], editing: ['locks', 'undo-reopen'], rendering: ['presentation-leak', 'media', 'degradation'], visual: ['hierarchy', 'density', 'composition', 'asset-purpose', 'rhythm'] }
const scriptStages: Record<string, BenchmarkStage> = { text: 'M1', bold: 'M1', 'font-size': 'M1', 'replace-image': 'M1', crop: 'M1', align: 'M1', table: 'M3', 'protected-layout': 'M2', 'reopen-undo': 'M1', presentation: 'M1' }
const identityKeys = ['source', 'history', 'resources', 'fonts', 'runtime', 'renderer', 'exporter', 'config'] as const
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const duration = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

export function selectBenchmarkScripts(manifest: BenchmarkManifest, stage: BenchmarkStage) {
  if (!(stage in stages)) throw new Error('Invalid benchmark stage')
  return manifest.scripts.map(script => ({ ...script, status: stages[script.minStage] <= stages[stage] ? 'required' as const : 'deferred' as const }))
}

/** Evidence validation is read-only. verifyArtifact must check retained bytes; it cannot attest human truth. */
export function evaluateAuthoringBenchmark(manifest: BenchmarkManifest, submission: BenchmarkSubmission, stage: BenchmarkStage,
  verifyArtifact: (artifact: BenchmarkArtifact) => boolean = () => false) {
  const blockers: string[] = []
  const block = (message: string) => { blockers.push(message) }
  const scripts = selectBenchmarkScripts(manifest, stage)
  const required = scripts.filter(s => s.status === 'required')
  const digest = canonicalHash(manifest)
  if (lines.some(line => canonicalHash(manifest.qualityLines[line]) !== canonicalHash(requiredChecks[line]))) block('invalid-quality-lines')
  if (manifest.scripts.some(s => scriptStages[s.id] !== s.minStage)) block('invalid-minimum-stage')
  if (manifest.tasks.length !== 10 || new Set(manifest.tasks.map(t => t.id)).size !== 10 ||
    new Set(manifest.tasks.map(t => `${t.category}:${t.usage}`)).size !== 10 ||
    new Set(manifest.tasks.map(t => t.category)).size !== 5 ||
    manifest.tasks.some(t => !['present', 'read'].includes(t.usage) || !nonempty(t.material) || !t.answers.length ||
      required.some(s => !t.scriptIds.includes(s.id)))) block('invalid-fixed-materials')
  if (manifest.scripts.length !== 10 || new Set(manifest.scripts.map(s => s.id)).size !== 10 ||
    manifest.scripts.some(s => !nonempty(s.instruction) || s.version < 1 || !(s.minStage in stages))) block('invalid-scripts')
  if (!Number.isInteger(manifest.protocol.repetitions) || manifest.protocol.repetitions < 2 || manifest.protocol.repetitions > 10 || manifest.protocol.seeds.length !== manifest.protocol.repetitions || new Set(manifest.protocol.seeds).size !== manifest.protocol.repetitions) block('invalid-repetitions')
  if (submission.version !== 'd07-evidence-v1' || submission.fixtureDigest !== digest) block('stale-fixture')
  const reviewers = submission.reviewers
  if (new Set(reviewers.map(r => r.id)).size !== reviewers.length || reviewers.some(r => !nonempty(r.id) || r.kind !== 'human') ||
    reviewers.filter(r => r.role === 'owner').length !== 1 || reviewers.filter(r => r.role === 'target-user').length < 2) block('missing-human-panel')
  const artifact = (a: BenchmarkArtifact | undefined) => {
    if (!a || !nonempty(a.path) || !/^[a-f0-9]{64}$/.test(a.sha256)) return false
    try { return verifyArtifact(a) === true } catch { return false }
  }
  const evidence = (items: BenchmarkArtifact[]) => Array.isArray(items) && items.length > 0 && items.every(artifact)
  const lineResults = Object.fromEntries(lines.map(line => [line, { passed: 0, failed: 0, unverified: 0 }])) as Record<typeof lines[number], { passed: number; failed: number; unverified: number }>
  if (new Set(submission.runs.map(r => r.id)).size !== submission.runs.length) block('duplicate-run-id')
  let agent: string | undefined
  const sideBuilds = new Map<string, string>()
  for (const run of submission.runs) {
    const prefix = `run:${run.id}`
    if (!manifest.tasks.some(t => t.id === run.taskId) || !['baseline', 'candidate'].includes(run.side) ||
      !Number.isInteger(run.repetition) || run.repetition < 0 || run.repetition >= manifest.protocol.repetitions) block(`${prefix}:unexpected-run`)
    if (!/^[a-f0-9]{40}$/.test(run.commit) || !nonempty(run.buildId) || !nonempty(run.agent) || !Object.keys(run.environment).length) block(`${prefix}:missing-provenance`)
    agent ??= run.agent
    if (agent !== run.agent || run.fixtureDigest !== digest || run.seed !== manifest.protocol.seeds[run.repetition] ||
      canonicalHash(run.budget) !== canonicalHash(manifest.protocol.budget)) block(`${prefix}:unfair-comparison`)
    const build = canonicalHash({ commit: run.commit, buildId: run.buildId })
    if (sideBuilds.has(run.side) && sideBuilds.get(run.side) !== build) block(`${prefix}:mixed-builds`)
    sideBuilds.set(run.side, build)
    if (identityKeys.some(key => !nonempty(run.identity[key]))) block(`${prefix}:incomplete-identity`)
    if (!artifact(run.original) || !artifact(run.repaired)) block(`${prefix}:missing-original-or-repair`)
    if (submission.humanReviews.some(r => required.some(s => s.id === r.scriptId) && r.runId === run.id && duration(r.repairMs) && r.repairMs > 0) &&
      (run.original.path === run.repaired.path || run.original.sha256 === run.repaired.sha256)) block(`${prefix}:repair-overwrote-original`)
    if (run.failures.length && run.side === 'candidate') block(`${prefix}:generation-failed`)
    for (const line of lines) {
      const observations = run.lines[line] ?? []
      // Each check has its own verdict: good visuals cannot compensate for a lost fact.
      for (const check of manifest.qualityLines[line]) {
        const matching = observations.filter(o => o.check === check)
        const valid = matching.length > 0 && matching.every(o => o.identityDigest === canonicalHash(run.identity) && nonempty(o.pageId) &&
          o.objectIds.length > 0 && o.objectIds.every(nonempty) && nonempty(o.note) && evidence(o.evidence) &&
          (line !== 'visual' || o.evidence.some(a => /\.png$/i.test(a.path))))
        const status = !valid || matching.some(o => !['pass', 'fail'].includes(o.status)) ? 'unverified'
          : matching.some(o => o.status === 'fail') ? 'failed' : 'passed'
        lineResults[line][status]++
        if (status === 'unverified' || (status === 'failed' && run.side === 'candidate')) block(`${prefix}:${line}:${check}:${status}`)
      }
      if (observations.some(o => !manifest.qualityLines[line].includes(o.check))) block(`${prefix}:${line}:unknown-check`)
    }
  }
  let expectedRuns = 0
  const repetitions = Number.isInteger(manifest.protocol.repetitions) && manifest.protocol.repetitions >= 2 && manifest.protocol.repetitions <= 10 ? manifest.protocol.repetitions : 0
  for (const task of manifest.tasks) for (let repetition = 0; repetition < repetitions; repetition++) {
    const pair = (['baseline', 'candidate'] as const).map(side => {
      expectedRuns++
      const found = submission.runs.filter(r => r.taskId === task.id && r.side === side && r.repetition === repetition)
      if (found.length !== 1) {
        block(`${task.id}:${side}:${repetition}:missing-or-duplicate`)
        if (!found.length) for (const line of lines) lineResults[line].unverified += manifest.qualityLines[line].length
      }
      return found[0]
    })
    if (pair[0] && pair[1] && canonicalHash(pair[0].environment) !== canonicalHash(pair[1].environment)) block(`${task.id}:${repetition}:environment-mismatch`)
  }
  const applicableReviews = submission.humanReviews.filter(r => required.some(s => s.id === r.scriptId))
  for (const review of submission.humanReviews) {
    if (!scripts.some(s => s.id === review.scriptId) || (required.some(s => s.id === review.scriptId) &&
      (!submission.runs.some(r => r.id === review.runId) || !reviewers.some(r => r.id === review.reviewerId)))) block('unknown-human-review-reference')
  }
  let humanPassed = 0
  const validReviews = new Set<BenchmarkHumanReview>()
  const sessionKey = (review: BenchmarkHumanReview) => {
    const run = submission.runs.find(r => r.id === review.runId)
    return JSON.stringify([run?.taskId, run?.side, review.reviewerId, review.scriptId])
  }
  const sessionCounts = new Map<string, number>()
  for (const review of applicableReviews) {
    const key = sessionKey(review)
    sessionCounts.set(key, (sessionCounts.get(key) ?? 0) + 1)
  }
  for (const review of applicableReviews) {
    const candidate = submission.runs.find(r => r.id === review.runId)?.side === 'candidate'
    if (!submission.runs.some(r => r.id === review.runId) || !reviewers.some(r => r.id === review.reviewerId) ||
      sessionCounts.get(sessionKey(review)) !== 1 || !review.failures.every(nonempty) || !review.repairOperations.every(nonempty) ||
      !['pass', 'fail'].includes(review.status) || (candidate && review.status !== 'pass') ||
      (review.status === 'fail' && !review.failures.length) || (review.status === 'pass' && review.failures.length) || !duration(review.elapsedMs) || !duration(review.repairMs) ||
      review.repairMs > review.elapsedMs || !Number.isInteger(review.helpCount) || review.helpCount === null || review.helpCount < 0 ||
      (review.repairMs > 0 && !review.repairOperations.length) || !evidence(review.evidence) ||
      review.scriptVersion !== required.find(s => s.id === review.scriptId)?.version) block(`human:${review.runId}:${review.reviewerId}:${review.scriptId}:incomplete-or-failed`)
    else {
      validReviews.add(review)
      if (review.status === 'pass') humanPassed++
    }
  }
  const repairComparisons: { taskId: string; reviewerId: string; baselineMs: number; candidateMs: number }[] = []
  for (const task of manifest.tasks) for (const reviewer of reviewers) {
    const totals = [0, 0]
    let complete = true
    for (const [index, side] of (['baseline', 'candidate'] as const).entries()) for (const script of required) {
      const runs = submission.runs.filter(r => r.taskId === task.id && r.side === side).map(r => r.id)
      const matches = applicableReviews.filter(r => runs.includes(r.runId) && r.reviewerId === reviewer.id && r.scriptId === script.id)
      // One timed session per person/task/script/side, attached to one of the retained repetitions.
      if (matches.length !== 1 || !validReviews.has(matches[0])) { complete = false; block(`human:${task.id}:${reviewer.id}:${side}:${script.id}:missing-or-duplicate`) }
      else totals[index] += matches[0].repairMs!
    }
    if (complete) {
      repairComparisons.push({ taskId: task.id, reviewerId: reviewer.id, baselineMs: totals[0], candidateMs: totals[1] })
      if (totals[1] > totals[0]) block(`human:${task.id}:${reviewer.id}:repair-regression`)
    }
  }
  if (stage === 'M2' && !repairComparisons.some(p => p.candidateMs < p.baselineMs)) block('repair-improvement-not-demonstrated')
  return { version: 'd07-gate-v1', stage, fixtureDigest: digest, status: blockers.length ? 'blocked' as const : 'pass' as const,
    blockers: [...new Set(blockers)], expectedRuns, receivedRuns: submission.runs.length, lines: lineResults,
    requiredScriptIds: required.map(s => s.id), deferredScriptIds: scripts.filter(s => s.status === 'deferred').map(s => s.id),
    humanPassed, repairComparisons,
    limitation: 'Checks evidence completeness and retained bytes, not reviewer honesty. Human and Office execution cannot be replaced by synthetic tests.' }
}

/** Directional, recipe-scoped allowance; it never exempts legibility or other visual checks. */
export function isBenchmarkOverlapAllowed(manifest: BenchmarkManifest, overlap: { recipeId: string; pageRole: string; back: string; front: string }) {
  return manifest.allowedOverlaps.some(rule => nonempty(rule.reason) && rule.recipeId === overlap.recipeId && rule.pageRole === overlap.pageRole && rule.back === overlap.back && rule.front === overlap.front)
}
