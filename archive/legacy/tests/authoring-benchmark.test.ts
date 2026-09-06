import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { canonicalHash } from '../packages/canonical-json/src/index.js'
import { evaluateAuthoringBenchmark, isBenchmarkOverlapAllowed, selectBenchmarkScripts,
  type BenchmarkManifest, type BenchmarkSubmission, type BenchmarkRun } from '../packages/reviewer/src/index.js'

const manifest: BenchmarkManifest = JSON.parse(readFileSync('tests/fixtures/evolution/authoring-benchmark.json', 'utf8'))
const digest = canonicalHash(manifest)
const retained = { path: 'synthetic-test.png', sha256: 'a'.repeat(64) }
// Contract-only synthetic data. Never persisted as human or release evidence.
function syntheticSubmission(): BenchmarkSubmission {
  const submission: BenchmarkSubmission = { version: 'd07-evidence-v1', fixtureDigest: digest,
    reviewers: [{ id: 'test-owner', role: 'owner', kind: 'human' }, { id: 'test-user-1', role: 'target-user', kind: 'human' }, { id: 'test-user-2', role: 'target-user', kind: 'human' }], runs: [], humanReviews: [] }
  for (const task of manifest.tasks) for (const side of ['baseline', 'candidate'] as const) for (let repetition = 0; repetition < 2; repetition++) {
    const identity = { source: 'source', history: 'history', resources: 'resources', fonts: 'fonts', runtime: side, renderer: side, exporter: side, config: 'config' }
    const run: BenchmarkRun = { id: `${task.id}:${side}:${repetition}`, taskId: task.id, side, repetition,
      commit: (side === 'baseline' ? 'b' : 'c').repeat(40), buildId: side, agent: 'synthetic-agent-v1', seed: manifest.protocol.seeds[repetition], fixtureDigest: digest,
      budget: { ...manifest.protocol.budget }, environment: { browser: 'synthetic', device: 'synthetic' }, identity,
      original: { path: 'original.ppte', sha256: 'b'.repeat(64) }, repaired: { path: 'repaired.ppte', sha256: 'c'.repeat(64) }, lines: { content: [], editing: [], rendering: [], visual: [] }, failures: [] }
    for (const line of ['content', 'editing', 'rendering', 'visual'] as const) run.lines[line] = manifest.qualityLines[line].map(check => ({ check, status: 'pass', identityDigest: canonicalHash(identity), pageId: 'page1', objectIds: ['object1'], note: 'Synthetic unit-test observation', evidence: [{ ...retained }] }))
    submission.runs.push(run)
    if (repetition === 0) for (const reviewer of submission.reviewers) for (const script of manifest.scripts) submission.humanReviews.push({ runId: run.id, reviewerId: reviewer.id, scriptId: script.id, scriptVersion: script.version,
      status: 'pass', elapsedMs: 100, repairMs: side === 'baseline' ? 20 : 10, helpCount: 0, repairOperations: ['Synthetic test repair'], failures: [], evidence: [{ ...retained }] })
  }
  return submission
}
const evaluate = (submission: BenchmarkSubmission) => evaluateAuthoringBenchmark(manifest, submission, 'M2', () => true)

test('D07 criterion 1: ten fixed briefs cover five categories and two uses with sourced answers, licensed bytes and versioned journeys', () => {
  const raw = JSON.parse(readFileSync('tests/fixtures/evolution/authoring-benchmark.json', 'utf8'))
  assert.equal(manifest.tasks.length, 10)
  for (const category of new Set(manifest.tasks.map(t => t.category))) assert.deepEqual(manifest.tasks.filter(t => t.category === category).map(t => t.usage).sort(), ['present', 'read'])
  for (const task of raw.tasks) {
    assert.ok(task.audience && task.prompt && task.source.provenance && task.requiredClaims.length)
    for (const answer of task.answers) {
      assert.equal(answer.sourceId, task.source.id)
      assert.ok(task.material.includes(String(answer.value)))
      assert.ok(answer.unit)
    }
    assert.deepEqual(task.scriptIds, manifest.scripts.map(s => s.id))
  }
  for (const asset of raw.assets) {
    assert.equal(asset.license, 'Apache-2.0')
    assert.equal(createHash('sha256').update(readFileSync(asset.path)).digest('hex'), asset.sha256)
  }
  assert.equal(manifest.scripts.length, 10)
  for (const script of raw.scripts) {
    assert.equal(script.version, 1)
    assert.deepEqual(script.journey, ['generate','edit','undo','redo','save','reopen','present','export','inspect'])
    assert.ok(script.record.includes('repairMs') && script.record.includes('failures'))
  }
  assert.equal(evaluate(syntheticSubmission()).status, 'pass')
})

test('D07 criterion 2 A14 A17: each quality line independently blocks candidate failure despite other passes', () => {
  for (const line of ['content', 'editing', 'rendering', 'visual'] as const) for (const check of manifest.qualityLines[line]) {
    const submission = syntheticSubmission()
    submission.runs.find(r => r.side === 'candidate')!.lines[line].find(o => o.check === check)!.status = 'fail'
    const result = evaluate(submission)
    assert.equal(result.status, 'blocked')
    assert.equal(result.lines[line].failed, 1)
    assert.ok(result.blockers.some(b => b.includes(`${line}:${check}:failed`)))
  }
})

test('D07 criterion 2 A14: overlap allowances are directional and recipe/page scoped; screenshots remain required', () => {
  const overlap = manifest.allowedOverlaps[0]
  assert.equal(isBenchmarkOverlapAllowed(manifest, overlap), true)
  for (const patch of [{ recipeId: 'other' }, { pageRole: 'body' }, { front: overlap.back, back: overlap.front }]) assert.equal(isBenchmarkOverlapAllowed(manifest, { ...overlap, ...patch }), false)
  const submission = syntheticSubmission()
  submission.runs[0].lines.visual[0].evidence = [{ ...retained, path: 'score.json' }]
  assert.equal(evaluate(submission).status, 'blocked')
  submission.runs[0].lines.visual[0].evidence = [{ ...retained }]
  submission.runs[0].lines.visual[0].objectIds = []
  assert.equal(evaluate(submission).status, 'blocked')
})

test('D07 criterion 2 A17: every identity domain and missing/tampered retained artifacts invalidate evidence', () => {
  for (const key of ['source', 'history', 'resources', 'fonts', 'runtime', 'renderer', 'exporter', 'config'] as const) {
    const submission = syntheticSubmission()
    submission.runs[0].identity[key] += '-changed'
    assert.equal(evaluate(submission).status, 'blocked', key)
  }
  assert.equal(evaluateAuthoringBenchmark(manifest, syntheticSubmission(), 'M2').status, 'blocked')
  assert.equal(evaluateAuthoringBenchmark(manifest, syntheticSubmission(), 'M2', () => { throw new Error('Missing file') }).status, 'blocked')
  const submission = syntheticSubmission()
  submission.runs[0].original.sha256 = 'not-a-hash'
  assert.equal(evaluate(submission).status, 'blocked')
})

test('D07 criterion 3 A21: forty runs require the same agent/material/seed/budget/environment and two repetitions', () => {
  for (const change of [
    (s: BenchmarkSubmission) => { s.runs.pop() },
    (s: BenchmarkSubmission) => { s.runs[0].agent = 'different-agent' },
    (s: BenchmarkSubmission) => { s.runs[0].fixtureDigest = 'changed' },
    (s: BenchmarkSubmission) => { s.runs[0].seed++ },
    (s: BenchmarkSubmission) => { s.runs[0].budget.maxToolCalls++ },
    (s: BenchmarkSubmission) => { s.runs[0].environment.browser = 'other' },
    (s: BenchmarkSubmission) => { s.runs.push(structuredClone(s.runs[0])) },
    (s: BenchmarkSubmission) => { s.runs[0].buildId = 'mixed-build' },
  ]) {
    const submission = syntheticSubmission(); change(submission)
    assert.equal(evaluate(submission).status, 'blocked')
  }
  assert.equal(evaluate(syntheticSubmission()).expectedRuns, 40)
})

test('D07 criterion 3 A21: real timing fields, owner plus two users, failures and repair trends are mandatory', () => {
  for (const change of [
    (s: BenchmarkSubmission) => { s.reviewers.pop() },
    (s: BenchmarkSubmission) => { s.humanReviews.shift() },
    (s: BenchmarkSubmission) => { s.humanReviews[0].repairMs = null },
    (s: BenchmarkSubmission) => { s.humanReviews[0].elapsedMs = -1 },
    (s: BenchmarkSubmission) => { s.humanReviews[0].helpCount = null },
    (s: BenchmarkSubmission) => { s.humanReviews[0].repairOperations = [] },
    (s: BenchmarkSubmission) => { s.humanReviews[0].scriptVersion = 0 },
    (s: BenchmarkSubmission) => { s.humanReviews.forEach(r => { r.repairMs = 20 }) },
    (s: BenchmarkSubmission) => { s.humanReviews.find(r => r.runId.includes('candidate') && r.scriptId === 'text')!.failures = ['lost text'] },
  ]) {
    const submission = syntheticSubmission(); change(submission)
    assert.equal(evaluate(submission).status, 'blocked')
  }
  const submission = syntheticSubmission()
  submission.runs[0].lines.content[0].status = 'fail'
  submission.runs[0].failures = ['Observed baseline factual error']
  submission.humanReviews[0].status = 'fail'
  submission.humanReviews[0].failures = ['Baseline task failed']
  assert.equal(evaluate(submission).status, 'pass', 'observed baseline failures must remain available for comparison')
})

test('D07 criterion 4 A21: stage selection defers M3 table without counting or blocking G2, and requires it at M3', () => {
  assert.deepEqual(selectBenchmarkScripts(manifest, 'M1').filter(s => s.status === 'deferred').map(s => s.id), ['table', 'protected-layout'])
  const submission = syntheticSubmission()
  for (const review of submission.humanReviews.filter(r => r.scriptId === 'table')) { review.status = 'unverified'; review.repairMs = null; review.evidence = [] }
  const result = evaluate(submission)
  assert.equal(result.status, 'pass')
  assert.deepEqual(result.deferredScriptIds, ['table'])
  assert.equal(result.humanPassed, 540)
  assert.equal(evaluateAuthoringBenchmark(manifest, submission, 'M3', () => true).status, 'blocked')
  submission.humanReviews = submission.humanReviews.filter(r => r.scriptId !== 'table')
  assert.equal(evaluate(submission).status, 'pass')
  submission.humanReviews[0].status = 'unverified'
  assert.equal(evaluate(submission).status, 'blocked')
})

test('D07 criterion 4 A17 A21: checked report recomputes honestly; empty submissions cannot close G2', () => {
  const report = JSON.parse(readFileSync('docs/evolution/quality/benchmark-report.json', 'utf8'))
  const process = spawnSync('node', ['scripts/authoring-benchmark.mjs'], { encoding: 'utf8' })
  const actual = JSON.parse(process.stdout)
  assert.deepEqual(report.gate, actual)
  const empty: BenchmarkSubmission = { version: 'd07-evidence-v1', fixtureDigest: digest, reviewers: [], runs: [], humanReviews: [] }
  const missing = evaluateAuthoringBenchmark(manifest, empty, 'M2')
  assert.equal(missing.status, 'blocked')
  assert.ok(missing.blockers.includes('missing-human-panel'))
  assert.equal(missing.humanPassed, 0)
  assert.equal(process.status, actual.status === 'pass' ? 0 : 1, process.stderr)
  assert.deepEqual(JSON.parse(process.stdout), actual)
})


test('D07 gate rejects weakened quality/stage manifests and overwritten originals', () => {
  for (const mutate of [
    (m: BenchmarkManifest) => { m.qualityLines.content = [] },
    (m: BenchmarkManifest) => { m.protocol.repetitions = 1000000000 },
    (m: BenchmarkManifest) => { m.scripts.find(s => s.id === 'text')!.minStage = 'M3' },
  ]) {
    const changed = structuredClone(manifest); mutate(changed)
    const submission = syntheticSubmission(); submission.fixtureDigest = canonicalHash(changed)
    assert.equal(evaluateAuthoringBenchmark(changed, submission, 'M2', () => true).status, 'blocked')
  }
  const submission = syntheticSubmission()
  submission.runs[0].repaired = { ...submission.runs[0].original }
  assert.ok(evaluate(submission).blockers.some(b => b.endsWith('repair-overwrote-original')))
})

test('D07 evidence CLI checks actual bytes and rejects tampering, fake PNG, missing files and escaped paths', () => {
  const directory = mkdtempSync('artifacts/d07-contract-')
  const outside = mkdtempSync(join(tmpdir(), 'd07-contract-'))
  try {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZioAAAAASUVORK5CYII=', 'base64')
    const save = (name: string, bytes: Buffer) => {
      const path = join(directory, name); writeFileSync(path, bytes)
      return { path, sha256: createHash('sha256').update(bytes).digest('hex') }
    }
    const screenshot = save('screenshot.png', png)
    const original = save('original.json', Buffer.from('synthetic original'))
    const repaired = save('repaired.json', Buffer.from('synthetic repair'))
    const submission = syntheticSubmission()
    for (const run of submission.runs) {
      run.original = original; run.repaired = repaired
      for (const observations of Object.values(run.lines)) for (const observation of observations) observation.evidence = [screenshot]
    }
    for (const review of submission.humanReviews) review.evidence = [screenshot]
    const input = join(directory, 'submission.json')
    const invoke = () => {
      writeFileSync(input, JSON.stringify({ submission, gate: { status: 'pass' } }))
      const result = spawnSync('node', ['scripts/authoring-benchmark.mjs', input], { encoding: 'utf8' })
      return { code: result.status, report: JSON.parse(result.stdout) }
    }
    assert.equal(invoke().code, 0, 'only synthetic contract evidence, removed after test')
    writeFileSync(screenshot.path, 'tampered')
    assert.equal(invoke().code, 1)
    screenshot.sha256 = createHash('sha256').update('tampered').digest('hex')
    assert.equal(invoke().code, 1, 'hash-matching non-PNG is still rejected')
    writeFileSync(screenshot.path, png)
    screenshot.sha256 = createHash('sha256').update(png).digest('hex')
    const screenshotPath = screenshot.path
    const disguised = save('not-an-image.txt', Buffer.from('not PNG bytes'))
    const disguisedLink = join(directory, 'disguised.png')
    symlinkSync('not-an-image.txt', disguisedLink)
    screenshot.path = disguisedLink; screenshot.sha256 = disguised.sha256
    assert.equal(invoke().code, 1, 'PNG claim cannot bypass signature validation through a symlink')
    screenshot.path = screenshotPath
    screenshot.sha256 = createHash('sha256').update(png).digest('hex')
    const external = join(outside, 'external.png'); writeFileSync(external, png)
    const link = join(directory, 'escape.png'); symlinkSync(external, link)
    screenshot.path = link
    assert.equal(invoke().code, 1, 'symlink escape')
    screenshot.path = relative(process.cwd(), external)
    assert.equal(invoke().code, 1, 'relative traversal')
    screenshot.path = external
    assert.equal(invoke().code, 1, 'absolute path')
    screenshot.path = join(directory, 'missing.png')
    assert.equal(invoke().code, 1)
    writeFileSync(input, '{bad JSON')
    const malformed = spawnSync('node', ['scripts/authoring-benchmark.mjs', input], { encoding: 'utf8' })
    assert.equal(malformed.status, 1)
    assert.equal(JSON.parse(malformed.stdout).status, 'blocked')
  } finally {
    rmSync(directory, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})


test('D07 criterion 3: invalid or duplicate human sessions never count as passes or repair comparisons', () => {
  for (const mutate of [
    (s: BenchmarkSubmission) => { s.humanReviews[0].evidence = [] },
    (s: BenchmarkSubmission) => { s.humanReviews[0].elapsedMs = -1 },
    (s: BenchmarkSubmission) => { s.humanReviews[0].repairOperations = ['   '] },
    (s: BenchmarkSubmission) => { s.humanReviews.push(structuredClone(s.humanReviews[0])) },
  ]) {
    const submission = syntheticSubmission(); mutate(submission)
    const result = evaluate(submission)
    assert.equal(result.status, 'blocked')
    assert.equal(result.humanPassed, 539, 'invalid sessions and all duplicate copies are excluded')
    assert.equal(result.repairComparisons.length, 29, 'incomplete timing cannot support improvement')
  }
  const submission = syntheticSubmission()
  submission.humanReviews.push({ ...submission.humanReviews[0], reviewerId: 'unknown-person' })
  const result = evaluate(submission)
  assert.equal(result.status, 'blocked')
  assert.equal(result.humanPassed, 540, 'unknown reviewer cannot inflate pass count')
})

test('D07 criterion 3: blank failure descriptions cannot stand in for actual recorded failures', () => {
  const submission = syntheticSubmission()
  submission.humanReviews[0].status = 'fail'
  submission.humanReviews[0].failures = [' ']
  assert.equal(evaluate(submission).status, 'blocked')
  submission.humanReviews[0].failures = ['Observed inability to save baseline output']
  assert.equal(evaluate(submission).status, 'pass', 'described baseline failures remain comparable')
})
