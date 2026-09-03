import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { renderSlideHtml } from '../packages/renderer-react/src/index.js'

interface BrowserGolden {
  computed: {
    slideWidth: string
    slideHeight: string
    slideBackground: string
    titleLeft: string
    titleTop: string
    titleFontSize: string
    titleWidth: number
    titleHeight: number
    allElementPosition: string
  }
  screenshot: { width: number; height: number; pngSignature: string }
}

const golden = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'goldens', 'renderer-browser-golden.json'), 'utf8')) as BrowserGolden

test('renderer browser computed-style and screenshot golden preserve slide-space geometry', async () => {
  const { document: documentNode, imageBytes } = makeContractDocument()
  documentNode.theme.tokens.fontFamilies['font.heading'] = '思源黑体 SC'
  const html = renderSlideHtml(documentNode, 'slide_main', { assetSources: { asset_pixel: `data:image/png;base64,${Buffer.from(imageBytes).toString('base64')}` } })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
    await page.setContent(`<style>html,body{margin:0}</style>${html}`)
    await page.waitForFunction(() => Array.from(globalThis.document.images).every((image) => image.complete))
    const observed = await page.evaluate(() => {
      const slide = globalThis.document.querySelector<HTMLElement>('.ppte-slide')
      const title = globalThis.document.querySelector<HTMLElement>('[data-ppte-element-id="text_title"]')
      if (!slide || !title) throw new Error('renderer golden fixture is missing slide or title')
      const slideStyle = getComputedStyle(slide)
      const titleStyle = getComputedStyle(title)
      const titleRect = title.getBoundingClientRect()
      const positions = Array.from(globalThis.document.querySelectorAll<HTMLElement>('[data-ppte-element-id]')).map((element) => getComputedStyle(element).position)
      return {
        slideWidth: slideStyle.width,
        slideHeight: slideStyle.height,
        slideBackground: slideStyle.backgroundColor,
        titleLeft: titleStyle.left,
        titleTop: titleStyle.top,
        titleFontSize: titleStyle.fontSize,
        titleFontFamily: titleStyle.fontFamily,
        titleWidth: titleRect.width,
        titleHeight: titleRect.height,
        allElementPosition: positions.every((position) => position === 'absolute') ? 'absolute' : positions.join(','),
      }
    })
    assert.deepEqual({ ...observed, titleFontFamily: undefined }, { ...golden.computed, titleFontFamily: undefined })
    assert.match(observed.titleFontFamily, /思源黑体 SC/)
    const screenshot = await page.locator('.ppte-slide').screenshot({ animations: 'disabled' })
    assert.equal(screenshot.subarray(0, 8).toString('hex'), golden.screenshot.pngSignature)
    assert.equal(screenshot.readUInt32BE(16), golden.screenshot.width)
    assert.equal(screenshot.readUInt32BE(20), golden.screenshot.height)
    assert.ok(screenshot.length > 1000, 'renderer screenshot golden must contain visible pixels')
  } finally {
    await browser.close()
  }
})
