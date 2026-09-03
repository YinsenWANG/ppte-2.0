import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { makeContractDocument, makeGABContractDocument } from '../apps/contract-deck/index.js'
import { buildCheckpointBytes, openCheckpointBytes } from '../packages/file-format/src/index.js'
import { auditPortableBundle, createPortableLightEdit, createPortableQuickFix, decodePortable, PortableRuntime } from '../packages/portable-runtime/src/index.js'
import type { ImageElement, TextElement } from '../packages/schema/src/index.js'

test('R3 infers one minimum profile for file-format and Portable checkpoints', () => {
  const { document, imageBytes } = makeGABContractDocument()
  const checkpoint = buildCheckpointBytes(document, { assetBytes: { asset_pixel: imageBytes } })
  assert.equal(openCheckpointBytes(checkpoint).manifest.compatibilityProfile, 'ppte-2.0-ga-b.1')

  const portable = createPortableQuickFix(document, { assetBytes: { asset_pixel: imageBytes } })
  assert.equal(portable.ok, true)
  assert.equal(decodePortable(portable.html).minimumCompatibilityProfile, 'ppte-2.0-ga-b.1')
  assert.equal(portable.runtimeGzipBytes! <= portable.budgetBytes!, true)
  assert.equal(portable.resourceBytes, imageBytes.length)
  assert.equal(portable.html.includes('data:image/png;base64,'), false)

  const runtime = new PortableRuntime(document, { profile: 'quick-fix', assetBytes: { asset_pixel: imageBytes } })
  const saved = runtime.saveAsNewProject()
  assert.equal(saved.ok, true)
  assert.equal(openCheckpointBytes(saved.bytes!).manifest.compatibilityProfile, 'ppte-2.0-ga-b.1')
  assert.throws(() => buildCheckpointBytes(document, { assetBytes: { asset_pixel: imageBytes }, compatibilityProfile: 'ppte-2.0-ga-a.1' }), /requires compatibility profile ppte-2\.0-ga-b\.1/)
})

test('R3 file:// Quick Fix imports, edits, saves, and reopens the semantic document', async () => {
  const { document, imageBytes } = makeContractDocument()
  const built = createPortableQuickFix(document, { assetBytes: { asset_pixel: imageBytes }, derivedAt: '2026-09-03T00:00:00.000Z' })
  assert.equal(built.ok, true)
  assert.equal(auditPortableBundle(built.html).ok, true)
  const directory = mkdtempSync(join(tmpdir(), 'ppte-r3-portable-'))
  const sourcePath = join(directory, 'quick-fix.ppte.html')
  const savedPath = join(directory, 'saved.ppte.html')
  writeFileSync(sourcePath, built.html)
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
    await page.goto(pathToFileURL(sourcePath).href)
    await page.waitForFunction(() => Boolean((globalThis as any).PPTEPortable?.getDocument))

    const input = page.locator('input[data-ppte-action="import-image"]')
    await input.setInputFiles({ name: 'new-image.png', mimeType: 'image/png', buffer: Buffer.from([1, 2, 3, 4]) })
    await page.waitForFunction(() => Object.keys((globalThis as any).PPTEPortable.getDocument().assets).some((id) => id !== 'asset_pixel'))
    const imported = await page.evaluate(() => {
      const api = (globalThis as any).PPTEPortable
      return { assetIds: Object.keys(api.getDocument().assets), imageAssetId: api.getDocument().slides.slide_main.elements.image_hero.assetId }
    })
    assert.equal(imported.assetIds.length, 2)
    assert.notEqual(imported.imageAssetId, 'asset_pixel')

    const edited = await page.evaluate(() => (globalThis as any).PPTEPortable.editText({ elementId: 'text_body' }, 'Browser saved text'))
    assert.equal(edited.ok, true)
    const undone = await page.evaluate(() => (globalThis as any).PPTEPortable.undo())
    assert.equal(undone.ok, true)
    assert.equal(await page.evaluate(() => (globalThis as any).PPTEPortable.getDocument().slides.slide_main.elements.text_body.content.paragraphs[0].runs[0].text), 'Text, image, and shape use one semantic document.')
    const redone = await page.evaluate(() => (globalThis as any).PPTEPortable.redo())
    assert.equal(redone.ok, true)
    const project = await page.evaluate(() => {
      const result = (globalThis as any).PPTEPortable.saveAsProject()
      return { ok: result.ok, issues: result.issues, bytes: Array.from(result.bytes ?? []) }
    })
    assert.equal(project.ok, true)
    const reopenedProject = openCheckpointBytes(Uint8Array.from(project.bytes))
    assert.equal((reopenedProject.document.slides.slide_main.elements.text_body as TextElement).content.paragraphs[0]!.runs[0]!.text, 'Browser saved text')
    assert.equal((reopenedProject.document.slides.slide_main.elements.image_hero as ImageElement).assetId, imported.imageAssetId)

    const savedHtml = await page.evaluate(() => {
      const result = (globalThis as any).PPTEPortable.saveAsPortable()
      return { ok: result.ok, issues: result.issues, html: result.html }
    })
    assert.equal(savedHtml.ok, true)
    writeFileSync(savedPath, savedHtml.html)
    const reopened = await browser.newPage({ viewport: { width: 900, height: 700 } })
    await reopened.goto(pathToFileURL(savedPath).href)
    await reopened.waitForFunction(() => Boolean((globalThis as any).PPTEPortable?.getDocument))
    const htmlState = await reopened.evaluate(() => {
      const api = (globalThis as any).PPTEPortable
      return { text: api.getDocument().slides.slide_main.elements.text_body.content.paragraphs[0].runs[0].text, assetId: api.getDocument().slides.slide_main.elements.image_hero.assetId }
    })
    assert.deepEqual(htmlState, { text: 'Browser saved text', assetId: imported.imageAssetId })
    await reopened.close()
  } finally {
    await browser.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('R3 file:// Light Edit commits crop, Chart Data, and geometry operations', async () => {
  const { document, imageBytes } = makeGABContractDocument()
  const built = createPortableLightEdit(document, { assetBytes: { asset_pixel: imageBytes } })
  assert.equal(built.ok, true)
  const directory = mkdtempSync(join(tmpdir(), 'ppte-r3-light-'))
  const sourcePath = join(directory, 'light-edit.ppte.html')
  writeFileSync(sourcePath, built.html)
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
    await page.goto(pathToFileURL(sourcePath).href)
    await page.waitForFunction(() => Boolean((globalThis as any).PPTEPortable?.getDocument))
    const observed = await page.evaluate(() => {
      const api = (globalThis as any).PPTEPortable
      const chart = JSON.parse(JSON.stringify(api.getDocument().slides.slide_main.elements.chart_revenue.data))
      chart.rows[0].values.revenue = 66
      const text = api.editText({ elementId: 'text_body' }, 'Light browser text')
      const crop = api.cropImage({ elementId: 'image_hero' }, { x: 0.1, y: 0.1, width: 0.8, height: 0.8 })
      const chartResult = api.updateChartData({ elementId: 'chart_revenue' }, chart)
      const move = api.moveElement({ elementId: 'image_hero' }, { x: 300, y: 200 })
      const resize = api.resizeElement({ elementId: 'image_hero' }, { x: 300, y: 200, width: 400, height: 300 })
      const state = api.getDocument()
      return { text: text.ok, crop: crop.ok, chart: chartResult.ok, move: move.ok, resize: resize.ok, cropData: state.slides.slide_main.elements.image_hero.crop, chartValue: state.slides.slide_main.elements.chart_revenue.data.rows[0].values.revenue, frame: state.slides.slide_main.elements.image_hero.frame }
    })
    assert.deepEqual(observed, { text: true, crop: true, chart: true, move: true, resize: true, cropData: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, chartValue: 66, frame: { x: 300, y: 200, width: 400, height: 300 } })
  } finally {
    await browser.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
