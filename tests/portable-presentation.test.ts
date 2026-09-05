import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { createPortableFullPortable } from '../packages/portable-runtime/src/index.js'

test('portable slideshow separates editing, supports fullscreen refusal and exit, and survives save', async () => {
  const { document: doc, imageBytes } = makeContractDocument()
  const built = createPortableFullPortable(doc, { assetBytes: { asset_pixel: imageBytes } })
  assert.equal(built.ok, true)
  const dir = mkdtempSync(join(tmpdir(), 'ppte-presentation-'))
  const file = join(dir, 'deck.html')
  writeFileSync(file, built.html)
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
    await page.goto(pathToFileURL(file).href)
    await page.waitForFunction(() => Boolean((globalThis as any).PPTEPortable))
    const text = page.locator('[data-ppte-element-id="text_body"]')
    await text.fill('Draft before slideshow')
    // Refusal must still enter a clean slideshow, committing the focused draft.
    await page.evaluate(() => { document.getElementById('ppte-shell')!.requestFullscreen = async () => { throw new Error('denied') } })
    await page.locator('[data-ppte-action="fullscreen"]').click()
    assert.equal(await page.locator('.ppte-toolbar').isVisible(), false)
    assert.equal(await page.locator('.ppte-notes').isVisible(), false)
    assert.equal(await page.locator('[contenteditable=true]').count(), 0)
    assert.equal(await text.evaluate(n => getComputedStyle(n).outlineStyle), 'none')
    const before = await page.evaluate(() => (globalThis as any).PPTEPortable.getRevision())
    await page.keyboard.press('ControlOrMeta+z')
    await page.keyboard.type('accidental typing')
    assert.equal(await page.evaluate(() => (globalThis as any).PPTEPortable.getRevision()), before)
    await page.setViewportSize({ width: 800, height: 1100 })
    await page.waitForFunction(() => { const r=document.querySelector('[data-ppte-canvas]')!.getBoundingClientRect();return r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1 })
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.ppte-toolbar').isVisible(), true)
    assert.equal(await text.getAttribute('contenteditable'), 'true')
    await text.fill('Editable after exit')
    await text.blur()
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-ppte-action="save-portable"]').click()])
    const saved = join(dir, 'saved.html'); await download.saveAs(saved)
    await page.goto(pathToFileURL(saved).href)
    await page.waitForFunction(() => Boolean((globalThis as any).PPTEPortable))
    assert.equal(await text.innerText(), 'Editable after exit')
    await page.locator('[data-ppte-action="fullscreen"]').click()
    await page.waitForFunction(() => document.fullscreenElement !== null)
    await page.evaluate(() => document.exitFullscreen())
    await page.waitForFunction(() => (globalThis as any).PPTEPortable.getMode() === 'edit')
    assert.equal(await text.getAttribute('contenteditable'), 'true')
  } finally { await browser.close(); rmSync(dir, {recursive:true,force:true}) }
})
