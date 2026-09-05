import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { canonicalHash } from '../packages/canonical-json/src/index.js'
import { planDeckLayout, compileSlide } from '../packages/design-compiler/src/index.js'
import { createBrowserLayoutMeasurer } from '../packages/design-compiler/src/browser-measurement.js'
import { RecipeRegistry } from '../packages/layout-recipes/src/index.js'
import { isDeckLayoutReportCurrent } from '../packages/reviewer/src/index.js'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import type { PresentationIR, RecipeSpec } from '../packages/schema/src/index.js'
const canvas = { width: 1280, height: 720 }
const recipe = (id = 'a'): RecipeSpec => ({ id, version: '1.0.0', supports: ['custom'], slots: [{ key: 'body', accepts: ['paragraph'], required: true, maxCount: 3 }], zones: [{ id: 'body', x: .1, y: .1, width: .8, height: .8 }], constraints: [] })
const input = (count = 1, content = 'Real font measurement'): PresentationIR => ({ irVersion: '1.0', title: 'D03', narrative: [], slides: Array.from({ length: count }, (_, i) => ({ irVersion: '1.0', slideKey: `s${i}`, purpose: 'custom', message: 'D03', density: 'low', visualStrategy: 'structured', blocks: [{ key: 'body', kind: 'paragraph', importance: 'primary', content }] })) })
const context = (specs = [recipe()]) => ({ canvas, recipes: new RecipeRegistry(specs), seed: 'd03' })

test('D03 A14 hard constraints beat preference; deterministic seed, variants and bounded deck rhythm', async () => {
  const bad = recipe('preferred'); bad.slots[0].maxChars = 1
  const a = recipe('a'); a.variants = [{ id: 'narrow', when: { density: 'low' }, zoneOverrides: { body: { width: .7 } } }, { id: 'wide', when: { density: 'low' }, zoneOverrides: { body: { width: .8 } } }]
  const ir = input(4); ir.slides.forEach(s => { s.layoutIntent = { balance: 'balanced', preferredRecipeIds: ['preferred'] } })
  const original = canonicalHash(ir)
  const one = await planDeckLayout(ir, context([bad, a, recipe('b')]))
  const two = await planDeckLayout(ir, context([recipe('b'), a, bad]))
  assert.deepEqual(one, two); assert.equal(canonicalHash(ir), original)
  assert.equal(one.report.status, 'complete'); assert.equal(one.slideDrafts.length, 4)
  assert.ok(one.report.pages.every(p => p.candidates.find(c => c.key.startsWith('preferred'))?.status === 'rejected'))
  assert.ok(one.report.pages.every(p => p.candidates.filter(c => c.key.startsWith('a@')).length === 2))
  assert.ok(one.report.transitions <= 4 * 8 * 6)
  assert.ok(new Set(one.report.pages.map(p => p.selected)).size > 1)
  assert.ok(one.slideDrafts.every(d => d.elementDrafts.length === 1 && d.readingOrder.length === 1))
  assert.equal(one.report.visualStatus, 'unverified')
})

test('D03 A17 required output contracts reject unsupported, absent and unverified mappings before scoring', async () => {
  for (const mapping of [undefined, 'unsupported', 'unverified', 'rasterized'] as const) {
    const result = await planDeckLayout(input(), { ...context([recipe('a'), recipe('b')]), requiredTargets: [{ target: 'pptx-semantic', allowed: ['native'] }], recipeCapabilities: { 'a@1.0.0': { 'pptx-semantic': mapping }, 'b@1.0.0': { 'pptx-semantic': 'native' } } })
    assert.equal(result.report.status, 'complete')
    assert.equal(result.report.pages[0].selected, 'b@1.0.0:base')
    assert.deepEqual(result.report.pages[0].candidates[0].reasons, ['required-target-contract-unsatisfied'])
    assert.equal(result.report.pages[0].candidates[0].score, undefined)
  }
})

test('D03 A14/A17 no browser stays unverified; structured reasons and identity reject stale reports', async () => {
  const ir = input(); const opts = context()
  const result = await planDeckLayout(ir, { ...opts, deliveryIdentity: { history: 'h1', runtime: 'r1' } })
  assert.equal(result.report.visualStatus, 'unverified')
  assert.match(result.report.pages[0].candidates[0].measurement!.reason!, /Browser not provided/)
  assert.ok(result.report.pages[0].reasons!.includes('hard-constraints-pass'))
  assert.ok(isDeckLayoutReportCurrent(result.report, result.report.identity))
  for (const change of [{ seed: 'new' }, { fontMetricsFingerprint: 'font2' }, { deliveryIdentity: { history: 'h2', runtime: 'r1' } }, { deliveryIdentity: { history: 'h1', runtime: 'r2' } }, { canvas: { ...canvas, width: 1000 } }]) {
    const updated = await planDeckLayout(ir, { ...opts, ...change })
    assert.equal(isDeckLayoutReportCurrent(result.report, updated.report.identity), false)
  }
})

test('D03 A14 split proposals preserve linked blocks; evaluation and beam budgets stop without partial drafts', async () => {
  const ir = input(); ir.slides[0].blocks.push({ ...ir.slides[0].blocks[0], key: 'linked' }); ir.slides[0].blocks[0].keepTogetherWith = ['linked']
  const small = recipe(); small.slots[0].maxCount = 1
  const failed = await planDeckLayout(ir, context([small]))
  assert.equal(failed.report.status, 'infeasible'); assert.deepEqual(failed.slideDrafts, [])
  assert.deepEqual(failed.report.splitProposals[0].blockGroups, [['body', 'linked']]); assert.equal(failed.report.splitProposals[0].requiresApproval, true)
  for (const budget of [{ maxEvaluations: 1 }, { maxTransitions: 1 }]) {
    const stopped = await planDeckLayout(input(3), { ...context([recipe(), recipe('b')]), budget })
    assert.equal(stopped.report.status, 'budget-exceeded'); assert.deepEqual(stopped.slideDrafts, []); assert.ok(stopped.report.stop?.code.endsWith('BUDGET'))
  }
  await assert.rejects(planDeckLayout(input(), { ...context(), budget: { beamWidth: Infinity } }), /BUDGET_INVALID/)
  const invalid = input(); invalid.slides[0].blocks[0].key = ''
  assert.equal((await planDeckLayout(invalid, context())).report.status, 'invalid')
})

test('D03 A17 measurement failure, stale evidence and timeout never count as visual success', async () => {
  for (const measure of [async () => ({ status: 'pass' as const, draftDigest: 'stale' }), async () => { throw new Error('FONT_FAILED') }, () => new Promise<never>(() => {})]) {
    const result = await planDeckLayout(input(), { ...context(), measure, budget: { measurementTimeoutMs: 10 } })
    assert.equal(result.report.status, 'infeasible'); assert.equal(result.report.visualStatus, 'fail'); assert.deepEqual(result.slideDrafts, [])
  }
})

test('D03 A14/A17/A20 actual pinned font DOM measurements, screenshots, failures and 30 capacity samples per deck size', async () => {
  const browser = await chromium.launch({ headless: true })
  const { document } = makeContractDocument()
  document.canvas = { ...document.canvas, ...canvas }
  document.theme.tokens.fontFamilies['font.body'] = 'D03 Fixture'
  document.theme.tokens.fontFamilies['font.heading'] = 'D03 Fixture'
  const font = readFileSync('tests/fixtures/design-system/d03-fixture.ttf')
  const fonts = [{ family: 'D03 Fixture', source: `data:font/ttf;base64,${font.toString('base64')}` }]
  const rendererDigest = canonicalHash(readFileSync('dist/packages/renderer-react/src/index.js', 'utf8'))
  const dir = 'artifacts/d03'; mkdirSync(dir, { recursive: true })
  try {
    const page = await browser.newPage()
    const measure = createBrowserLayoutMeasurer(page, document, { fonts, rendererDigest, onScreenshot: async (bytes, draft) => { writeFileSync(`${dir}/${canonicalHash(draft)}.png`, bytes) } })
    const opts = { ...context(), theme: document.theme, measure }
    const normal = await planDeckLayout(input(), opts)
    assert.equal(normal.report.status, 'complete'); assert.equal(normal.report.visualStatus, 'pass')
    const evidence = normal.report.pages[0].candidates[0].measurement!
    assert.equal(evidence.elements![0].width, 1024); assert.ok(evidence.screenshotDigest); assert.ok(evidence.fontDigest)
    const narrow = recipe(); narrow.zones[0].height = .0525 // 37.8du, exactly the resolved 28 * 1.35 line box
    const edge = await planDeckLayout(input(1, 'Edge'), { ...opts, recipes: new RecipeRegistry([narrow]) })
    assert.equal(edge.report.visualStatus, 'pass')
    const exact = recipe('exact'); exact.zones[0].width = 170 / canvas.width; exact.zones[0].height = .0525; exact.qualityRules = [{ kind: 'max-overflow', value: 0 }]
    const uppercase = input(1, 'WWWWWWWWWW') // reference 179.2du; pinned real font 168du
    const exactOpts = { ...opts, recipes: new RecipeRegistry([exact]) }
    assert.equal((await planDeckLayout(uppercase, { ...exactOpts, measure: undefined })).report.status, 'infeasible')
    assert.equal((await planDeckLayout(uppercase, exactOpts)).report.visualStatus, 'pass')
    assert.equal((await planDeckLayout(uppercase, { ...exactOpts, measure: async d => ({ status: 'unverified', draftDigest: canonicalHash(d) }) })).report.status, 'infeasible')
    const overflow = await planDeckLayout(input(1, 'Overflow '.repeat(100)), { ...opts, recipes: new RecipeRegistry([narrow]) })
    assert.equal(overflow.report.status, 'infeasible'); assert.equal(overflow.report.visualStatus, 'fail')
    const draft = compileSlide(input().slides[0], opts)
    const broken = createBrowserLayoutMeasurer(page, document, { fonts: [{ family: 'D03 Fixture', source: 'data:font/ttf;base64,YmFk' }], rendererDigest })
    assert.equal((await broken(draft)).status, 'fail')
    const wrong = createBrowserLayoutMeasurer(page, document, { fonts: [{ ...fonts[0], family: 'Other' }], rendererDigest })
    assert.match((await wrong(draft)).reason!, /FONT_UNPINNED/)
    const missingGlyph = await planDeckLayout(input(1, '缺字'), opts)
    assert.equal(missingGlyph.report.visualStatus, 'fail')
    assert.match(missingGlyph.report.pages[0].candidates[0].measurement!.reason!, /FONT_GLYPH_FALLBACK/)
    const imageRecipe = recipe('image'); imageRecipe.slots[0].accepts = ['image']
    const imageInput = input(); imageInput.slides[0].blocks[0].kind = 'image'
    const imageDraft = compileSlide(imageInput.slides[0], { ...context([imageRecipe]), resolveAsset: () => 'asset_pixel' })
    const brokenImage = createBrowserLayoutMeasurer(page, document, { fonts, rendererDigest, assetSources: { asset_pixel: 'data:image/png;base64,YmFk' } })
    assert.equal((await brokenImage(imageDraft)).status, 'fail')
    const tampered = await planDeckLayout(input(), { ...opts, measure: async d => { d.elementDrafts[0].frame.width = 1; return { status: 'unverified', draftDigest: canonicalHash(d) } } })
    assert.equal(tampered.report.visualStatus, 'fail')
    const samples: Array<{ pages: number; elapsedMs: number; evaluations: number; transitions: number }> = []
    for (let i = 0; i < 90; i++) {
      const pages = [12, 30, 100][i % 3]; const start = performance.now()
      const result = await planDeckLayout(input(pages), opts)
      assert.equal(result.report.visualStatus, 'pass'); assert.equal(result.slideDrafts.length, pages)
      samples.push({ pages, elapsedMs: performance.now() - start, evaluations: result.report.evaluations, transitions: result.report.transitions })
    }
    const summaries = [12, 30, 100].map(pages => { const sorted = samples.filter(s => s.pages === pages).map(s => s.elapsedMs).sort((a, b) => a - b); return { pages, count: sorted.length, p50: sorted[14], p95: sorted[28] } })
    writeFileSync(`${dir}/measurements.json`, JSON.stringify({ fixtureDigest: canonicalHash(input(100)), rendererDigest, fontDigest: canonicalHash([...font]), browser: browser.version(), environment: { platform: process.platform, arch: process.arch, node: process.version }, viewport: canvas, samples, summaries, normal: normal.report, boundary: edge.report, overflow: overflow.report, unverified: ['Physical low-performance devices', 'Safari', 'Office clients', 'General font glyph coverage outside the ASCII fixture'] }, null, 2))
  } finally { await browser.close() }
})
