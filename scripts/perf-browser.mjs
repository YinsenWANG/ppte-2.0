#!/usr/bin/env node
// P01: real file:// Portable entry. Run after pnpm build. Never overwrites frozen evidence.
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir, cpus, platform, release, arch, totalmem } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { makeGAAStandardDocument, makeContractDocument, makeGABContractDocument } from '../dist/apps/contract-deck/index.js'
import { buildPortable } from '../dist/packages/portable-runtime/src/index.js'
import { PpteSession } from '../dist/packages/core/src/index.js'
import { prepareVideo, planVideo } from '../dist/packages/editor-controller/src/video-resource.js'
import { canonicalRevision } from '../dist/packages/canonical-json/src/index.js'
import { openCheckpointBytes } from '../dist/packages/file-format/src/index.js'
import { summarizeBrowserSamples, P01_CANDIDATE_BUDGET } from '../dist/packages/performance-budget/src/index.js'

export const manifestPath = 'tests/fixtures/evolution/performance-manifest.json'
export const sha = bytes => createHash('sha256').update(bytes).digest('hex')
export const readManifest = () => JSON.parse(readFileSync(manifestPath, 'utf8'))
export function verifyManifest(manifest) {
  if (JSON.stringify(manifest.candidateBudget) !== JSON.stringify(P01_CANDIDATE_BUDGET)) throw Error('CANDIDATE_BUDGET_CHANGED')
  if (manifest.protocol.startupSamples < 20 || manifest.protocol.interactionSamples < 30) throw Error('INSUFFICIENT_PROTOCOL_SAMPLES')
  for (const resource of manifest.resources) if (sha(readFileSync(resource.path)) !== resource.sha256) throw Error(`RESOURCE_DIGEST_MISMATCH: ${resource.path}`)
}

export function validateReport(manifest, report) {
  verifyManifest(manifest)
  if (report.protocolVersion !== manifest.version || report.manifestSha256 !== sha(readFileSync(manifestPath))) throw Error('PROTOCOL_MISMATCH')
  if (report.acceptance !== 'unverified' || JSON.stringify(report.unverified) !== JSON.stringify(manifest.unverified)) throw Error('UNMEASURED_SCOPE_CANNOT_PASS')
  for (const key of ['browser', 'executableSha256', 'cpu', 'logicalCpus', 'memoryBytes', 'os', 'release', 'arch', 'viewport', 'entry', 'network']) if (!report.environment[key]) throw Error(`MISSING_ENVIRONMENT: ${key}`)
  if (JSON.stringify(report.cases.map(c => c.pageCount)) !== JSON.stringify(manifest.corpora.map(c => c.pageCount))) throw Error('MISSING_CORPUS')
  for (const [index, c] of report.cases.entries()) {
    if (c.fixtureRevision !== manifest.corpora[index].fixtureRevision || !/^[a-f0-9]{64}$/.test(c.htmlSha256)) throw Error('CORPUS_MISMATCH')
    if (!c.fonts.some(f => f.family === 'Noto Sans SC' && f.status === 'loaded')) throw Error('FONT_NOT_LOADED')
    if (!c.correctness.undoExact || !c.correctness.saveExact || !c.correctness.dragCommitted) throw Error('DOCUMENT_CORRECTNESS_FAILED')
    const metrics = { coldStartup: c.coldStartup, warmStartup: c.warmStartup, ...c.metrics }
    for (const kind of ['coldStartup', 'warmStartup', 'engineTextCommitAndPaint', 'pageSwitch', 'undoAndPaint', 'redoAndPaint', 'saveCheckpoint', 'pointerDragAndPaint', 'mediaRoundTrip']) {
      const measured = metrics[kind]
      const expected = summarizeBrowserSamples(measured.samplesMs, kind.endsWith('Startup') ? manifest.protocol.startupSamples : manifest.protocol.interactionSamples)
      if (JSON.stringify(measured) !== JSON.stringify(expected)) throw Error(`INVALID_SUMMARY: ${kind}`)
    }
    if (JSON.stringify(c.dragFrameIntervals) !== JSON.stringify(summarizeBrowserSamples(c.dragFrameIntervals.samplesMs, 1))) throw Error('INVALID_DRAG_FRAMES')
  }
  return { status: 'unverified', measuredCorpora: report.cases.length, reason: 'Synthetic Portable measurements do not close A20 physical-device and product-entry gaps.' }
}

export async function makeFixture(pageCount) {
  if (![12, 30, 100].includes(pageCount)) throw Error('UNSUPPORTED_CORPUS')
  const { imageBytes } = makeContractDocument()
  const document = makeGAAStandardDocument(imageBytes).document
  const originals = structuredClone(document.slides)
  document.slides = {}; document.slideOrder = []
  for (let i = 0; i < pageCount; i++) {
    const sourceId = Object.keys(originals)[i % 30], id = `perf_${i}`
    // All local identifiers, including group membership, must remain consistent.
    const slide = JSON.parse(JSON.stringify(originals[sourceId]).replaceAll(sourceId, id))
    document.slides[id] = slide; document.slideOrder.push(id)
  }
  document.documentId = `p01-synthetic-${pageCount}`
  document.metadata.title = `P01 synthetic ${pageCount} pages`
  const font = readFileSync('design-packs/assets/noto-sans-sc-sample-1.woff2')
  document.fonts = { font_perf: { id: 'font_perf', family: 'Noto Sans SC', style: 'normal', weight: 400, source: 'embedded', hash: `sha256-${sha(font)}`, path: 'fonts/perf.woff2', subset: true, glyphCoverage: JSON.parse(readFileSync('design-packs/assets/font-1.json', 'utf8')).glyphCoverage, editableSafe: true, license: 'OFL-1.1' } }
  document.theme.tokens.fontFamilies = { 'font.heading': 'Noto Sans SC', 'font.body': 'Noto Sans SC' }
  for (const preset of Object.values(document.theme.presets.text)) preset.fontWeight = 400
  const chartSource = makeGABContractDocument().document
  document.theme.presets.chart = chartSource.theme.presets.chart
  if (pageCount === 100) {
    for (let i = 2; i < pageCount; i += 3) {
      const chart = structuredClone(chartSource.slides.slide_main.elements.chart_revenue)
      chart.id = `perf_${i}_chart`; delete chart.semanticRefs
      document.slides[`perf_${i}`].elements[chart.id] = chart
      document.slides[`perf_${i}`].rootOrder.push(chart.id)
    }
  }
  const videoBytes = readFileSync('tests/fixtures/media/blue-vp9.webm')
  const prepared = await prepareVideo(videoBytes, { mimeType: 'video/webm', decode: async () => ({ width: 160, height: 90, durationMs: 1000 }), posterAssetId: 'asset_pixel' })
  const session = new PpteSession(document, { runtimeProfile: 'ga-c' })
  const tx = planVideo(document, { revision: session.getRevision(), slideId: 'perf_0', elementId: 'perf_video', prepared, transactionId: 'p01-video-fixture' })
  const result = session.commit(tx)
  if (!result.ok) throw Error(JSON.stringify(result.issues))
  return { document: session.getDocument(), assetBytes: { asset_pixel: imageBytes, [prepared.asset.id]: prepared.bytes }, fontBytes: { font_perf: font } }
}

export async function ready(page) {
  await page.waitForFunction(() => Boolean(globalThis.PPTEPortable))
  return page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all([...document.images].map(image => image.decode()))
    await Promise.all([...document.querySelectorAll('video')].map(video => video.readyState >= 1 ? undefined : new Promise((resolve, reject) => { video.addEventListener('loadedmetadata', resolve, { once: true }); video.addEventListener('error', () => reject(Error('MEDIA_DECODE_FAILED')), { once: true }) })))
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const api = globalThis.PPTEPortable
    api.select({ slideId: 'perf_0', elementId: 'perf_0_text_01' })
    return performance.now()
  })
}

async function measureAction(page, kind, index) {
  return page.evaluate(async ({ kind, index }) => {
    const api = globalThis.PPTEPortable
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const start = performance.now()
    let result
    if (kind === 'engineTextCommitAndPaint') result = api.editText({ slideId: 'perf_0', elementId: 'perf_0_text_01' }, `P01 sample ${index}`)
    // Every trial starts on page 0. Alternating targets would time a no-op in half the trials.
    if (kind === 'pageSwitch') result = api.setSlide(1)
    if (kind === 'undoAndPaint') result = api.undo()
    if (kind === 'redoAndPaint') result = api.redo()
    if (kind === 'saveCheckpoint') result = api.saveAsNewProject()
    if (result?.ok === false) throw Error(JSON.stringify(result))
    await frame()
    const elapsed = performance.now() - start
    if (kind === 'saveCheckpoint' && !result?.bytes?.length) throw Error('EMPTY_CHECKPOINT')
    return elapsed
  }, { kind, index })
}

async function interactions(page, count) {
  const samples = Object.fromEntries(['engineTextCommitAndPaint', 'pageSwitch', 'undoAndPaint', 'redoAndPaint', 'saveCheckpoint', 'pointerDragAndPaint', 'mediaRoundTrip'].map(key => [key, []]))
  const correctness = { undoExact: true, saveExact: false, dragCommitted: true }
  const dragFramesMs = []
  for (let i = 0; i < count; i++) {
    await page.evaluate(() => globalThis.PPTEPortable.setSlide(0)); await ready(page)
    const before = await page.evaluate(() => globalThis.PPTEPortable.getRevision())
    samples.engineTextCommitAndPaint.push(await measureAction(page, 'engineTextCommitAndPaint', i))
    samples.undoAndPaint.push(await measureAction(page, 'undoAndPaint', i))
    correctness.undoExact &&= before === await page.evaluate(() => globalThis.PPTEPortable.getRevision())
    samples.redoAndPaint.push(await measureAction(page, 'redoAndPaint', i))
    samples.pageSwitch.push(await measureAction(page, 'pageSwitch', i))
    await page.evaluate(() => globalThis.PPTEPortable.setSlide(0)); await ready(page)
    samples.saveCheckpoint.push(await measureAction(page, 'saveCheckpoint', i))
    const target = page.locator('[data-ppte-stage] [data-ppte-element-id="perf_0_shape_14"]')
    const node = await target.count() ? target : page.locator('[data-ppte-element-id="perf_0_shape_14"]').last()
    const box = await node.boundingBox()
    if (!box) throw Error('DRAG_TARGET_MISSING')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    const revision = await page.evaluate(() => globalThis.PPTEPortable.getRevision())
    await page.evaluate(() => {
      globalThis.__p01Drag = { start: 0, end: 0, frames: [], active: true }
      document.addEventListener('pointerdown', () => { globalThis.__p01Drag.start = performance.now() }, { once: true, capture: true })
      const tick = time => { const state = globalThis.__p01Drag; if (!state.active) return; state.frames.push(time); requestAnimationFrame(tick) }; requestAnimationFrame(tick)
    })
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + (i % 2 ? -12 : 12), box.y + box.height / 2 + 8, { steps: 10 })
    await page.mouse.up()
    const drag = await page.evaluate(async () => { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); const state = globalThis.__p01Drag; state.active = false; return { ms: performance.now() - state.start, frames: state.frames.slice(1).map((t, i) => t - state.frames[i]) } })
    samples.pointerDragAndPaint.push(drag.ms); dragFramesMs.push(...drag.frames)
    correctness.dragCommitted &&= revision !== await page.evaluate(() => globalThis.PPTEPortable.getRevision())
    samples.mediaRoundTrip.push(await page.evaluate(async () => {
      const start = performance.now(), api = globalThis.PPTEPortable
      let video = [...document.querySelectorAll('video')].find(v => v.getBoundingClientRect().width > 0)
      if (!video) throw Error('MEDIA_MISSING')
      video.muted = true; await video.play(); video.pause()
      api.setSlide(1); api.setSlide(0)
      video = [...document.querySelectorAll('video')].find(v => v.getBoundingClientRect().width > 0)
      if (!video) throw Error('MEDIA_RETURN_MISSING')
      if (video.readyState < 1) await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = reject })
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return performance.now() - start
    }))
  }
  const saved = await page.evaluate(() => { const api = globalThis.PPTEPortable; const result = api.saveAsNewProject(); return { bytes: Array.from(result.bytes), revision: api.getRevision() } })
  correctness.saveExact = canonicalRevision(openCheckpointBytes(Uint8Array.from(saved.bytes)).document) === saved.revision
  if (!correctness.undoExact || !correctness.saveExact) throw Error('DOCUMENT_CORRECTNESS_FAILED')
  return { metrics: Object.fromEntries(Object.entries(samples).map(([kind, values]) => [kind, summarizeBrowserSamples(values, count)])), dragFrameIntervals: summarizeBrowserSamples(dragFramesMs, 1), correctness }
}

export async function run(output) {
  const manifest = readManifest(); verifyManifest(manifest)
  const directory = mkdtempSync(join(tmpdir(), 'p01-browser-'))
  let browser
  const report = { protocolVersion: manifest.version, manifestSha256: sha(readFileSync(manifestPath)), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), measuredAt: new Date().toISOString(), environment: { node: process.version, os: platform(), release: release(), arch: arch(), cpu: cpus()[0].model, logicalCpus: cpus().length, memoryBytes: totalmem(), viewport: manifest.protocol.viewport, headless: true, cpuThrottling: 1, entry: 'full-portable file://', network: 'offline', locale: 'en-US', timezone: 'Asia/Shanghai' }, cases: [], unverified: manifest.unverified, acceptance: 'unverified' }
  report.sourceFiles = Object.fromEntries(['scripts/perf-browser.mjs', 'apps/contract-deck/index.ts', 'packages/performance-budget/src/index.ts', 'packages/portable-runtime/src/browser.ts'].map(path => [path, sha(readFileSync(path))]))
  report.buildManifest = JSON.parse(readFileSync('artifacts/build-manifest.json', 'utf8'))
  report.sourceWorktreeDirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0
  try {
    for (const corpus of manifest.corpora) {
      const fixture = await makeFixture(corpus.pageCount)
      const fixtureRevision = canonicalRevision(fixture.document)
      if (fixtureRevision !== corpus.fixtureRevision) throw Error('FIXTURE_DIGEST_MISMATCH')
      const built = buildPortable(fixture.document, { ...fixture, profile: 'full-portable', derivedAt: '2026-09-06T00:00:00.000Z' })
      if (!built.ok) throw Error(JSON.stringify(built.issues))
      const file = join(directory, `${corpus.pageCount}.html`); writeFileSync(file, built.html)
      const cold = [], warm = []; let interaction
      for (let i = 0; i < manifest.protocol.startupSamples; i++) {
        browser = await chromium.launch({ headless: true })
        if (report.environment.browser && report.environment.browser !== browser.version()) throw Error('BROWSER_CHANGED')
        report.environment.browser = browser.version()
        report.environment.executableSha256 ??= sha(readFileSync(chromium.executablePath()))
        const context = await browser.newContext({ offline: true, viewport: manifest.protocol.viewport, locale: 'en-US', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' })
        const page = await context.newPage(); page.setDefaultTimeout(60000)
        await page.goto(pathToFileURL(file).href); cold.push(await ready(page))
        await page.reload(); warm.push(await ready(page))
        if (i === manifest.protocol.startupSamples - 1) {
          interaction = await interactions(page, manifest.protocol.interactionSamples)
          interaction.fonts = await page.evaluate(() => [...document.fonts].map(f => ({ family: f.family, status: f.status, weight: f.weight })))
        }
        await browser.close(); browser = undefined
      }
      report.cases.push({ pageCount: corpus.pageCount, fixtureRevision, htmlSha256: sha(built.html), htmlBytes: built.bytes, runtimeBytes: built.runtimeBytes, runtimeGzipBytes: built.runtimeGzipBytes, coldStartup: summarizeBrowserSamples(cold, 20), warmStartup: summarizeBrowserSamples(warm, 20), ...interaction })
      process.stderr.write(`P01 sampled ${corpus.pageCount} pages\n`)
    }
    validateReport(manifest, report)
    writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
    return report
  } finally { await browser?.close(); rmSync(directory, { recursive: true, force: true }) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw Error('Usage: node scripts/perf-browser.mjs NEW_REPORT_PATH (after pnpm build)')
  await run(process.argv[2])
}
