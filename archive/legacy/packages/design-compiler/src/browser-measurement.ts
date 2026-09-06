import type { Page } from 'playwright'
import { canonicalHash, cloneJson } from '../../canonical-json/src/index.js'
import { renderSlideHtml } from '../../renderer-react/src/index.js'
import { measureRenderedLayout } from '../../editor-react/src/text-measurement.js'
import { materializeSlideDraft } from './index.js'
import type { CompiledSlideDraft, PpteDocument } from '../../schema/src/index.js'
import type { LayoutMeasurement } from './deck-planning.js'

/** Uses a caller-owned optional browser page and pinned font/resource bytes.
 * The supplied document is only a rendering template, never a persistence target.
 * A fresh document is mounted on each call; callers must serialize use of the page. */
export function createBrowserLayoutMeasurer(page: Page, template: PpteDocument, options: {
  fonts: Array<{ family: string; source: string }>
  assetSources?: Record<string, string>
  rendererDigest: string
  timeoutMs?: number
  onScreenshot?: (bytes: Uint8Array, draft: CompiledSlideDraft) => Promise<void>
}) {
  const source = cloneJson(template)
  const config = { ...options, fonts: cloneJson(options.fonts), assetSources: cloneJson(options.assetSources ?? {}) }
  return async (draft: CompiledSlideDraft): Promise<LayoutMeasurement> => {
    const base = { draftDigest: canonicalHash(draft), fontDigest: canonicalHash(config.fonts), resourceDigest: canonicalHash(config.assetSources), rendererDigest: config.rendererDigest }
    try {
      if (!config.fonts.length || config.fonts.some(f => !f.source.startsWith('data:')) || Object.values(config.assetSources).some(s => !s.startsWith('data:'))) throw new Error('PINNED_RESOURCE_BYTES_REQUIRED')
      const slide = materializeSlideDraft(draft, 'layout-measurement', source.canvas)
      const document = { ...source, slides: { [slide.id]: slide }, slideOrder: [slide.id] }
      await page.setViewportSize({ width: Math.ceil(source.canvas.width), height: Math.ceil(source.canvas.height) })
      await page.setContent(`<style>html,body{margin:0}</style>${renderSlideHtml(document, slide.id, { assetSources: config.assetSources })}`, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs ?? 10000 })
      const elements = await page.evaluate(measureRenderedLayout, { timeoutMs: config.timeoutMs ?? 10000, fonts: config.fonts })
      // Chromium's actual glyph-source inspection catches missing-glyph fallback;
      // FontFaceSet.check alone only proves that a declared face finished loading.
      const session = await page.context().newCDPSession(page)
      try {
        await session.send('DOM.enable')
        await session.send('CSS.enable')
        const root = await session.send('DOM.getDocument')
        const nodes = await session.send('DOM.querySelectorAll', { nodeId: root.root.nodeId, selector: '[data-ppte-type="text"]' })
        for (const nodeId of nodes.nodeIds) {
          const used = await session.send('CSS.getPlatformFontsForNode', { nodeId })
          if (used.fonts.some(font => font.glyphCount > 0 && !font.isCustomFont)) throw new Error('FONT_GLYPH_FALLBACK')
        }
      } finally { await session.detach() }
      const screenshot = await page.locator('.ppte-slide').screenshot({ animations: 'disabled', timeout: config.timeoutMs ?? 10000 })
      await config.onScreenshot?.(screenshot, draft)
      return { ...base, status: elements.some(e => e.overflow) ? 'fail' : 'pass', elements, environment: await page.evaluate(() => navigator.userAgent), screenshotDigest: canonicalHash([...screenshot]) }
    } catch (e) { return { ...base, status: 'fail', reason: String(e) } }
  }
}
