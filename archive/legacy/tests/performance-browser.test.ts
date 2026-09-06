import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { summarizeBrowserSamples, P01_CANDIDATE_BUDGET, percentile } from '../packages/performance-budget/src/index.js'
import { canonicalRevision } from '../packages/canonical-json/src/index.js'
import { buildPortable } from '../packages/portable-runtime/src/index.js'
import { validateDocument } from '../packages/schema/src/index.js'
const script = await import(pathToFileURL(resolve('scripts/perf-browser.mjs')).href)
const manifest = script.readManifest()
const evidencePath = 'docs/evolution/quality/p01-browser-reference.json'

test('P01 criterion 1: Node microbenchmarks name the computation, never a browser interaction', () => {
  const source = readFileSync('apps/contract-deck/index.ts', 'utf8')
  const names = [...source.matchAll(/benchmark\('([^']+)'/g)].map(match => match[1])
  assert.deepEqual(names, ['node-session-construction', 'node-slide-html-generation', 'node-hit-test', 'node-geometry-transaction-commit', 'node-text-transaction-commit', 'node-journal-create-and-append', 'node-history-undo', 'node-history-redo', 'node-checkpoint-50mib-write', 'node-portable-viewer-build', 'node-portable-quick-fix-build'])
})

test('P01 criterion 1: reproducible 12/30/100-page fixtures validate and build the actual Portable entry', async () => {
  assert.deepEqual(manifest.corpora.map((c: any) => c.pageCount), [12, 30, 100])
  for (const corpus of manifest.corpora) {
    const fixture = await script.makeFixture(corpus.pageCount)
    assert.equal(fixture.document.slideOrder.length, corpus.pageCount)
    assert.equal(canonicalRevision(fixture.document), corpus.fixtureRevision)
    assert.deepEqual(validateDocument(fixture.document).filter(issue => issue.severity === 'error'), [])
    const built = buildPortable(fixture.document, { ...fixture, profile: 'full-portable', derivedAt: '2026-09-06T00:00:00.000Z' })
    assert.equal(built.ok, true, JSON.stringify(built.issues))
    assert.ok(built.html.includes('data-ppte-stage'))
    assert.ok((built.runtimeBytes ?? 0) > 0)
  }
})

test('P01 criterion 2: frozen resources and statistically complete separated browser evidence', () => {
  script.verifyManifest(manifest)
  const report = JSON.parse(readFileSync(evidencePath, 'utf8'))
  assert.equal(script.validateReport(manifest, report).measuredCorpora, 3)
  assert.equal(report.environment.entry, 'full-portable file://')
  assert.equal(report.environment.cpuThrottling, 1)
  assert.equal(report.environment.network, 'offline')
})

test('P01 criterion 2: changed resources and missing browser/corpus evidence are rejected', () => {
  const changed = structuredClone(manifest); changed.resources[0].sha256 = '0'.repeat(64)
  assert.throws(() => script.verifyManifest(changed), /RESOURCE_DIGEST_MISMATCH/)
  const report = JSON.parse(readFileSync(evidencePath, 'utf8'))
  delete report.environment.browser
  assert.throws(() => script.validateReport(manifest, report), /MISSING_ENVIRONMENT/)
  const missing = JSON.parse(readFileSync(evidencePath, 'utf8')); missing.cases.pop()
  assert.throws(() => script.validateReport(manifest, missing), /MISSING_CORPUS/)
})

test('P01 criterion 3: p95 retains the tail, raw samples and count; invalid and small samples fail', () => {
  const samples = [...Array(27).fill(1), 100, 200, 300]
  const result = summarizeBrowserSamples(samples, 30)
  assert.equal(result.p95Ms, percentile(samples, .95))
  assert.ok(result.p95Ms > samples.reduce((a, b) => a + b, 0) / samples.length)
  assert.deepEqual(result.samplesMs, samples); assert.equal(result.sampleCount, 30)
  result.samplesMs[0] = 999; assert.equal(samples[0], 1)
  assert.throws(() => summarizeBrowserSamples([], 20), /INSUFFICIENT/)
  for (const invalid of [NaN, Infinity, -1]) assert.throws(() => summarizeBrowserSamples([invalid], 1), /INVALID_BROWSER_SAMPLE/)
  assert.throws(() => summarizeBrowserSamples([1], 0), /INVALID_SAMPLE_MINIMUM/)
})

test('P01 criterion 3: budgets cannot inflate and averages cannot replace measured p95', () => {
  assert.deepEqual(manifest.candidateBudget, P01_CANDIDATE_BUDGET)
  assert.equal(P01_CANDIDATE_BUDGET.coldStartupMs, 2000)
  assert.equal(P01_CANDIDATE_BUDGET.inputFeedbackMs, 50)
  const changed = structuredClone(manifest); changed.candidateBudget.coldStartupMs *= 2
  assert.throws(() => script.verifyManifest(changed), /CANDIDATE_BUDGET_CHANGED/)
  const report = JSON.parse(readFileSync(evidencePath, 'utf8'))
  report.cases[0].coldStartup.p95Ms = 0
  assert.throws(() => script.validateReport(manifest, report), /INVALID_SUMMARY/)
})

test('P01 criterion 3: unmeasured physical devices, IME, Host and real-resource capacity cannot close A20', () => {
  const report = JSON.parse(readFileSync(evidencePath, 'utf8'))
  assert.equal(script.validateReport(manifest, report).status, 'unverified')
  for (const scope of ['Safari', 'physical device', 'IME', 'Host', '50 MiB', 'Cherry', 'Memory']) assert.ok(manifest.unverified.some((item: string) => item.includes(scope)), scope)
  report.acceptance = 'passed'
  assert.throws(() => script.validateReport(manifest, report), /UNMEASURED_SCOPE_CANNOT_PASS/)
})

test('P01 criterion 1: live offline file entry paints an Engine edit, navigates and undoes exactly', async () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'p01-live-test-'))
  const browser = await chromium.launch({ headless: true })
  try {
    const fixture = await script.makeFixture(12)
    const built = buildPortable(fixture.document, { ...fixture, profile: 'full-portable' })
    assert.equal(built.ok, true)
    const file = resolve(directory, 'deck.html'); writeFileSync(file, built.html!)
    const context = await browser.newContext({ offline: true, viewport: manifest.protocol.viewport })
    const page = await context.newPage(); await page.goto(pathToFileURL(file).href)
    assert.ok(await script.ready(page) > 0)
    const observed = await page.evaluate(async () => {
      const api = (globalThis as any).PPTEPortable
      const before = api.getRevision()
      const result = api.editText({ slideId: 'perf_0', elementId: 'perf_0_text_01' }, 'P01 live input')
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const painted = Array.from(document.querySelectorAll('[data-ppte-stage] [data-ppte-element-id="perf_0_text_01"]')).some(n => n.textContent?.includes('P01 live input'))
      api.setSlide(1)
      const pageOneVisible = Array.from(document.querySelectorAll('[data-ppte-stage] [data-ppte-slide-id="perf_1"]')).some(n => n.getBoundingClientRect().width > 0)
      const undo = api.undo()
      return { ok: result.ok, painted, pageOneVisible, exact: undo.ok && api.getRevision() === before }
    })
    assert.deepEqual(observed, { ok: true, painted: true, pageOneVisible: true, exact: true })
  } finally { await browser.close(); rmSync(directory, { recursive: true, force: true }) }
})
