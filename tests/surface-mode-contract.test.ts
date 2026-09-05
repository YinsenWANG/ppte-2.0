import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { createPortableFullPortable } from '../packages/portable-runtime/src/index.js'
import { buildCheckpointBytes } from '../packages/file-format/src/index.js'
import { advancePresenterState, retreatPresenterState } from '../packages/portable-runtime/src/presenter-state.js'
import { PresentationController } from '../packages/editor-controller/src/presentation.js'

test('C05 shared steps include same-page zero and previous-page final step', () => {
  const { document } = makeContractDocument()
  document.slides.slide_main.elements.text_body.appearStep = 3
  const next = structuredClone(document.slides.slide_main); next.id = 'second'
  document.slides.second = next; document.slideOrder = ['slide_main', 'second']
  assert.deepEqual(retreatPresenterState(document, { slideIndex: 0, step: 3 }), { slideIndex: 0, step: 0 })
  assert.deepEqual(retreatPresenterState(document, { slideIndex: 1, step: 0 }), { slideIndex: 0, step: 3 })
  assert.deepEqual(advancePresenterState(document, { slideIndex: 0, step: 3 }), { slideIndex: 1, step: 0 })
  assert.deepEqual(retreatPresenterState(document, { slideIndex: 0, step: 0 }), { slideIndex: 0, step: 0 })
})

test('C05 rejected flush and stale fullscreen completion cannot change a newer mode', async () => {
  const controller = new PresentationController()
  const draft = { text: 'retain me' }
  assert.equal(controller.enter(() => ({ ok: false })), false)
  assert.equal(draft.text, 'retain me')
  assert.equal(controller.canMutate, true)
  let finish!: () => void
  const doc = { fullscreenElement: null as unknown, exitFullscreen: async () => { doc.fullscreenElement = null } }
  const surface = { ownerDocument: doc, requestFullscreen: () => new Promise<void>(resolve => { finish = () => { doc.fullscreenElement = surface; resolve() } }) } as unknown as HTMLElement
  controller.enter(() => ({ ok: true }))
  const request = controller.requestFullscreen(surface)
  controller.leave(); finish(); await request
  assert.equal(controller.canMutate, true)
  assert.equal(doc.fullscreenElement, null)
  controller.enter(() => ({ ok: true }))
  assert.equal(controller.fullscreenChanged(surface), false)
  assert.equal(controller.isPresenting, true)
})

for (const host of [false, true]) test(`C05 ${host ? 'Host' : 'generated file Portable'} clean mode, IME flush, API guards and late fullscreen`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'c05-surface-'))
  const { document: doc, imageBytes } = makeContractDocument()
  doc.slides.slide_main.elements.text_body.appearStep = 3
  const assetBytes = { asset_pixel: imageBytes }
  let file: string
  if (host) {
    const build = spawnSync('pnpm', ['host:build', '--outDir', join(dir, 'host')], { encoding: 'utf8' })
    assert.equal(build.status, 0, build.stdout + build.stderr)
    file = join(dir, 'host/index.html')
    writeFileSync(join(dir, 'deck.ppte'), buildCheckpointBytes(doc, { assetBytes }))
  } else {
    const built = createPortableFullPortable(doc, { assetBytes }); assert.equal(built.ok, true)
    file = join(dir, 'deck.html'); writeFileSync(file, built.html)
  }
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
    await page.goto(pathToFileURL(file).href)
    if (host) {
      await page.waitForFunction(() => document.querySelector('[data-ppte-ready]')?.getAttribute('data-ppte-ready') === 'true')
      await page.locator('[data-ppte-action="open"]').setInputFiles(join(dir, 'deck.ppte'))
    }
    const apiName = host ? 'PPTEHost' : 'PPTEPortable'
    await page.waitForFunction(name => Boolean((globalThis as any)[name]), apiName)
    const text = page.locator('[data-ppte-stage] [data-ppte-element-id="text_body"]').first()
    await text.waitFor()
    assert.equal(await text.evaluate(n => getComputedStyle(n).visibility), 'visible')
    await page.evaluate(() => { (globalThis as any).realFullscreen = HTMLElement.prototype.requestFullscreen; HTMLElement.prototype.requestFullscreen = async () => { throw Error('denied') } })
    const initialDepth = await page.evaluate(name => (globalThis as any)[name].getHistory().length, apiName)
    await text.dispatchEvent('compositionstart')
    await text.evaluate(n => { (n as HTMLElement).innerText = '待提交草稿'; n.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true })) })
    await page.evaluate(name => { void (globalThis as any)[name].enterPresentation() }, apiName)
    assert.equal(await page.evaluate(name => (globalThis as any)[name].getMode(), apiName), 'edit')
    assert.equal(await text.innerText(), '待提交草稿')
    await text.dispatchEvent('compositionend')
    await page.waitForFunction(name => (globalThis as any)[name].getMode() === 'present', apiName)
    assert.equal(await page.locator('[contenteditable="true"]').count(), 0)
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.isContentEditable), false)
    for (const selector of ['.ppte-host-toolbar', '.ppte-host-sidebar', '.ppte-host-inspector', '.ppte-toolbar', '.ppte-notes', '[data-ppte-notes-panel]', '[data-ppte-selection-id]']) {
      for (const node of await page.locator(selector).all()) assert.equal(await node.isVisible(), false, selector)
    }
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-ppte-stage] [data-ppte-element-id="text_body"]')!).visibility === 'hidden')
    for (const viewport of [{ width: 1500, height: 500 }, { width: 700, height: 1100 }]) {
      await page.setViewportSize(viewport)
      await page.waitForFunction(() => {
        const slides = Array.from(document.querySelectorAll('[data-ppte-stage] .ppte-slide'))
        const slide = slides.find(n => getComputedStyle(n).display !== 'none')!
        const r = slide.getBoundingClientRect()
        return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1
      })
    }
    const before = await page.evaluate(name => { const api = (globalThis as any)[name]; return [api.getRevision(), api.getHistory().length] }, apiName)
    assert.equal(before[1], initialDepth + 1, "composition commits exactly once")
    const blocked = await page.evaluate(name => { const api = (globalThis as any)[name]; return [api.commit({}), api.undo(), api.redo()] }, apiName)
    assert.ok(blocked.every(r => r.ok === false))
    for (const type of ['paste', 'beforeinput', 'drop']) assert.equal(await page.locator('[data-ppte-stage]').evaluate((n, type) => n.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })), type), false)
    await page.keyboard.press('ControlOrMeta+z')
    await page.keyboard.type('forbidden')
    assert.deepEqual(await page.evaluate(name => { const api = (globalThis as any)[name]; return [api.getRevision(), api.getHistory().length] }, apiName), before)
    await page.keyboard.press('ArrowRight'); assert.equal(await text.evaluate(n => getComputedStyle(n).visibility), 'visible')
    await page.keyboard.press('ArrowLeft'); assert.equal(await text.evaluate(n => getComputedStyle(n).visibility), 'hidden')
    await page.keyboard.press('Escape')
    await page.waitForFunction(name => (globalThis as any)[name].getMode() === 'edit', apiName)
    assert.equal(await text.innerText(), '待提交草稿')
    assert.equal(await text.evaluate(n => getComputedStyle(n).visibility), 'visible')
    // A cancelled IME transition cannot be revived by compositionend.
    await text.dispatchEvent('compositionstart')
    await page.evaluate(name => { void (globalThis as any)[name].enterPresentation() }, apiName)
    await page.keyboard.press('Escape')
    await text.dispatchEvent('compositionend')
    assert.equal(await page.evaluate(name => (globalThis as any)[name].getMode(), apiName), 'edit')
    // Real commit failures preserve the DOM draft and semantic revision.
    const failedRevision = await page.evaluate(name => (globalThis as any)[name].getRevision(), apiName)
    if (host) await page.evaluate(() => {
      const original = Storage.prototype.setItem
      ;(globalThis as any).restoreStorage = () => { Storage.prototype.setItem = original }
      Storage.prototype.setItem = () => { throw Error('C05 storage failure') }
    })
    const rejectedDraft = host ? 'Retained after storage failure' : 'invalid\u0000draft'
    await text.evaluate((n, value) => { (n as HTMLElement).innerText = value; n.dispatchEvent(new InputEvent('input', { bubbles: true })) }, rejectedDraft)
    await page.evaluate(name => { void (globalThis as any)[name].enterPresentation() }, apiName)
    assert.equal(await page.evaluate(name => (globalThis as any)[name].getMode(), apiName), 'edit')
    assert.equal(await text.innerText(), rejectedDraft)
    assert.equal(await page.evaluate(name => (globalThis as any)[name].getRevision(), apiName), failedRevision)
    if (host) await page.evaluate(() => (globalThis as any).restoreStorage())
    await text.evaluate(n => { (n as HTMLElement).innerText = 'Corrected draft'; n.dispatchEvent(new InputEvent('input', { bubbles: true })) })
    await page.evaluate(() => { HTMLElement.prototype.requestFullscreen = () => new Promise(resolve => { (globalThis as any).finishFullscreen = resolve }) })
    await page.evaluate(name => { void (globalThis as any)[name].enterPresentation() }, apiName)
    await page.waitForFunction(() => Boolean((globalThis as any).finishFullscreen))
    await page.evaluate(name => (globalThis as any)[name].leavePresentation(), apiName)
    await page.evaluate(() => { (globalThis as any).finishFullscreen(); document.dispatchEvent(new Event('fullscreenchange')) })
    assert.equal(await page.evaluate(name => (globalThis as any)[name].getMode(), apiName), 'edit')
    await page.evaluate(() => { HTMLElement.prototype.requestFullscreen = (globalThis as any).realFullscreen })
    await page.locator(host ? '[data-ppte-action="present"]' : '[data-ppte-action="fullscreen"]').click()
    await page.waitForFunction(() => document.fullscreenElement !== null)
    await page.evaluate(() => document.exitFullscreen())
    await page.waitForFunction(name => (globalThis as any)[name].getMode() === 'edit', apiName)
    if (host) await page.evaluate(() => {
      const original = window.requestAnimationFrame
      window.requestAnimationFrame = callback => {
        window.requestAnimationFrame = original
        ;(globalThis as any).finishPresentationFrame = () => callback(performance.now())
        return 0
      }
    })
    await page.locator(host ? '[data-ppte-action="present"]' : '[data-ppte-action="fullscreen"]').click()
    await page.locator('[data-ppte-action="exit-present"]').focus()
    if (host) {
      await page.evaluate(() => (globalThis as any).finishPresentationFrame())
      assert.equal(await page.locator('[data-ppte-action="exit-present"]').evaluate(n => n === document.activeElement), true, 'deferred presentation entry preserves control focus')
    }
    await page.keyboard.press('Space')
    await page.waitForFunction(name => (globalThis as any)[name].getMode() === 'edit', apiName)
  } finally { await browser.close(); rmSync(dir, { recursive: true, force: true }) }
})
