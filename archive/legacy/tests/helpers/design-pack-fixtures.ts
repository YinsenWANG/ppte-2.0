import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'
import { makeContractDocument } from '../../apps/contract-deck/index.js'
import { canonicalHash } from '../../packages/canonical-json/src/index.js'
import { PpteSession } from '../../packages/core/src/index.js'
import { buildInitializationTransaction, compileSlide } from '../../packages/design-compiler/src/index.js'
import { createBrowserLayoutMeasurer } from '../../packages/design-compiler/src/browser-measurement.js'
import { RecipeRegistry, DESIGN_STYLES, designPackCoverage, designPackTheme, designPackRecipeSpecs } from '../../packages/layout-recipes/src/index.js'
import type { DesignStyle } from '../../packages/layout-recipes/src/index.js'
import { renderSlideHtml } from '../../packages/renderer-react/src/index.js'
import { measureRenderedLayout } from '../../packages/editor-react/src/text-measurement.js'
import type { PpteDocument, SlideIR, RecipeSpec, Slide, Transaction, Operation } from '../../packages/schema/src/index.js'

export const digestBytes = (bytes: Uint8Array) => `sha256-${createHash('sha256').update(bytes).digest('hex')}`
export const fontBytes = () => readFileSync('design-packs/assets/noto-sans-sc-sample-1.woff2')
export const visualBytes = () => readFileSync('design-packs/assets/visual-1.svg')
export const pinnedFonts = () => [{ family: 'Noto Sans SC', source: `data:font/woff2;base64,${fontBytes().toString('base64')}` }]
export const assetSources = () => ({ asset_design_visual: `data:image/svg+xml;base64,${visualBytes().toString('base64')}` })
export function template(style: DesignStyle, width = 1280, height = 720): PpteDocument {
  const { document } = makeContractDocument()
  document.slideOrder = []; document.slides = {}; document.facts = {}; document.locale = 'zh-CN'
  document.theme = designPackTheme(style, height)
  document.canvas = { ...document.canvas, width, height, defaultBackground: { kind: 'solid', color: { kind: 'value', value: document.theme.tokens.colors.background } } }
  document.assets = { asset_design_visual: { id: 'asset_design_visual', hash: digestBytes(visualBytes()), byteLength: visualBytes().length, mimeType: 'image/svg+xml', width: 640, height: 800, path: 'assets/visual-1.svg', altText: '连接发现与交付的双节点结构图' } }
  document.fonts = { font_design: { id: 'font_design', family: 'Noto Sans SC', style: 'normal', weight: 400, source: 'embedded', hash: digestBytes(fontBytes()), path: 'fonts/noto-sans-sc-sample-1.woff2', subset: true, glyphCoverage: JSON.parse(readFileSync('design-packs/assets/font-1.json', 'utf8')).glyphCoverage, editableSafe: true, license: 'OFL-1.1' } }
  return document
}
export function compileSample(style: DesignStyle, recipe: RecipeSpec, ir: SlideIR, width = 1280, height = 720) {
  return compileSlide(ir, { canvas: { width, height }, theme: designPackTheme(style, height), recipes: new RecipeRegistry([recipe]), recipeId: recipe.id, seed: 'D04-1', fontMetricsFingerprint: digestBytes(fontBytes()) })
}
export function insertSample(session: PpteSession, style: DesignStyle, recipe: RecipeSpec, ir: SlideIR) {
  const doc = session.getDocument(), draft = compileSample(style, recipe, ir, doc.canvas.width, doc.canvas.height)
  assert.deepEqual(draft.validationIssues.filter(i => i.severity === 'error'), [], ir.slideKey)
  const tx = buildInitializationTransaction(draft, ir.slideKey, doc.canvas, { transactionId: `insert.${ir.slideKey}`, baseRevision: session.getRevision(), index: doc.slideOrder.length })
  const result = session.commit(tx); assert.equal(result.ok, true, JSON.stringify(result))
  return draft
}
export function transaction(session: PpteSession, id: string, operations: Operation[]): Transaction {
  return { transactionId: id, baseRevision: session.getRevision(), actor: { type: 'human', id: 'd04' }, scope: { kind: 'document', permissions: ['structure','content','style','geometry'], allowInsert: true, allowDelete: false }, changeContract: { allowedOperationKinds: operations.map(o => o.kind), maxChangedSlides: 1, maxChangedElements: 5, maxInsertedElements: 5, maxDeletedElements: 0, maxChangedFacts: 0, maxChangedSources: 0, maxChangedThemeTokens: 0, maxChangedStylePresets: 0, requireConfirmation: false, userIntentSummary: id }, reason: id, createdAt: '2026-09-06T00:00:00.000Z', validationLevel: 'L3', operations }
}
export const stressText = '跨团队协作需要清晰的上下文：先记录目标与事实，再说明证据和限制。保留原始材料，才能让每次修改都有依据。'
export function stressSamples(style: DesignStyle) {
  const base: RecipeSpec = { id: `${style}.stress`, version: '1.0.0', supports: ['custom'], slots: [{ key: 'title', accepts: ['heading'], required: true, maxCount: 1, maxChars: 24 }, { key: 'body', accepts: ['paragraph','chart'], required: true, maxCount: 1 }], zones: [{ id: 'title', x: .08, y: .07, width: .84, height: .20 }, { id: 'body', x: .08, y: .33, width: .84, height: .57 }], constraints: [{ kind: 'safe-area', slotId: '*' }], qualityRules: [{ kind: 'max-overflow', value: 0 }] }
  const ir = (kind: string, content: SlideIR['blocks'][number]['content'], blockKind: 'paragraph' | 'chart' = 'paragraph'): SlideIR => ({ irVersion: '1.0', slideKey: `${style}.stress.${kind}`, purpose: 'custom', message: '压力验证', visualStrategy: 'structured', density: 'high', blocks: [{ key: 'title', kind: 'heading', content: { chinese: '长中文与数字', chart: '季度增长证据', table: '保留现有表格' }[kind]!, importance: 'primary' }, { key: 'body', kind: blockKind, content, importance: 'primary' }] })
  return [
    { kind: 'chinese', recipe: base, ir: ir('chinese', `${stressText}\n${stressText}\n关键数值：1234567890.125；增长 42%；样本 128。`) },
    { kind: 'chart', recipe: base, ir: ir('chart', { chartType: 'bar', data: { columns: [{ id: 'quarter', label: '季度', type: 'string' }, { id: 'value', label: '增长', type: 'number' }], rows: [{ id: 'q1', values: { quarter: 'Q1', value: 42 } }, { id: 'q2', values: { quarter: 'Q2', value: 38 } }, { id: 'q3', values: { quarter: 'Q3', value: 56 } }] }, encoding: { categoryField: 'quarter', valueFields: ['value'] }, options: { showLabels: true, showLegend: false }, altText: '季度增长 42、38、56' }, 'chart') },
    { kind: 'table', recipe: base, ir: ir('table', '现有表格呈现；数据保留，不声明 Table v2。') },
  ]
}
export function insertStress(session: PpteSession, style: DesignStyle, sample: ReturnType<typeof stressSamples>[number]) {
  const draft = insertSample(session, style, sample.recipe, sample.ir)
  if (sample.kind === 'table') {
    const id = sample.ir.slideKey, body = draft.elementDrafts[1]
    const table: Slide['elements'][string] = { id: 'retained_table', type: 'component', semanticKey: 'data.retained-table', frame: { x: 102.4, y: 320, width: 1075.2, height: 280 }, componentType: 'core/table', componentVersion: '1.0.0', props: { columns: ['阶段', '数值', '状态'], rows: [['发现', 1234567890.125, true], ['验证', 42, null], ['交付', 128, '中文换行\n保留来源']], caption: '合成数据：原始标量必须保留' }, fallback: { kind: 'placeholder', label: 'Table v1' } }
    const tx = transaction(session, `table.${style}`, [{ opId: 'move', kind: 'element.resize', slideId: id, elementId: body.draftId, frame: { ...body.frame, height: 65 } }, { opId: 'insert', kind: 'element.insert', slideId: id, element: table, index: 2 }])
    const result = session.commit(tx); assert.equal(result.ok, true, JSON.stringify(result))
  }
  return draft
}
export const buildDigest = () => canonicalHash(['layout-recipes/src/design-packs.js','design-compiler/src/index.js','design-compiler/src/browser-measurement.js','renderer-react/src/index.js','editor-react/src/text-measurement.js','charts/src/index.js','widgets/src/index.js','validation/src/index.js'].map(p => readFileSync(`dist/packages/${p}`, 'utf8')))

/** Produces new evidence under the caller's output root; tests never update source previews. */
export async function captureDesignPacks(root: string) {
  const browser = await chromium.launch({ headless: true })
  const measurements: Array<Record<string, unknown>> = []
  const save = (path: string, data: Uint8Array | string) => { mkdirSync(dirname(`${root}/${path}`), { recursive: true }); writeFileSync(`${root}/${path}`, data) }
  try {
    const page = await browser.newPage()
    await page.route('http://**/*', route => route.abort()); await page.route('https://**/*', route => route.abort())
    for (const cell of designPackCoverage()) {
      const recipe = designPackRecipeSpecs(cell.style).find(r => r.id === cell.manifest.recipeRef.id)!
      for (const sample of cell.manifest.samples) {
        const input = sample.input.slides[0], draft = compileSample(cell.style, recipe, input)
        const path = `design-packs/${cell.style}/previews/${cell.role}-${sample.kind}.png`
        if (sample.kind === 'overload') {
          assert.ok(draft.validationIssues.some(i => i.severity === 'error')); assert.equal(draft.elementDrafts.length, 0)
          // A rejected draft has no slide. Preview the explicit diagnostic and all retained input.
          await page.setViewportSize({ width: 1280, height: 720 })
          await page.setContent('<style>body{margin:50px;font:22px "Noto Sans SC";background:#fff6f4}h1{font-size:38px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:18px "Noto Sans SC"}</style><h1>CAPACITY_EXCEEDED</h1><p>Draft rejected. Split the page or choose a larger layout. All input is retained below.</p><pre></pre>')
          await page.locator('pre').evaluate((node, value) => { node.textContent = value }, JSON.stringify(input, null, 1))
          await page.evaluate(measureRenderedLayout, { timeoutMs: 10000, fonts: pinnedFonts() })
          const screenshot = await page.screenshot({ fullPage: true }); save(path, screenshot)
          measurements.push({ id: input.slideKey, status: 'rejected', fixtureDigest: canonicalHash(input), draftDigest: canonicalHash(draft), preview: path, screenshotDigest: digestBytes(screenshot) })
          continue
        }
        const doc = template(cell.style)
        const measure = createBrowserLayoutMeasurer(page, doc, { fonts: pinnedFonts(), assetSources: assetSources(), rendererDigest: buildDigest(), onScreenshot: async bytes => save(path, bytes) })
        const result = await measure(draft)
        assert.equal(result.status, 'pass', `${input.slideKey}: ${JSON.stringify(result)}`)
        // No recipe declares intentional overlap: every pair of element frames must be disjoint.
        for (const a of draft.elementDrafts) for (const b of draft.elementDrafts) if (a.draftId < b.draftId) assert.ok(a.frame.x + a.frame.width <= b.frame.x + .01 || b.frame.x + b.frame.width <= a.frame.x + .01 || a.frame.y + a.frame.height <= b.frame.y + .01 || b.frame.y + b.frame.height <= a.frame.y + .01, `overlap ${input.slideKey}`)
        assert.equal(await page.locator('[contenteditable=true]').count(), 0)
        measurements.push({ id: input.slideKey, fixtureDigest: canonicalHash(input), preview: path, ...result })
      }
    }
    for (const style of DESIGN_STYLES) for (const sample of stressSamples(style)) {
      const session = new PpteSession(template(style)); insertStress(session, style, sample)
      const doc = session.getDocument(), path = `design-packs/${style}/previews/stress-${sample.kind}.png`
      await page.setViewportSize({ width: 1280, height: 720 })
      await page.setContent(`<style>html,body{margin:0;font-family:"Noto Sans SC"}</style>${renderSlideHtml(doc, sample.ir.slideKey, { assetSources: assetSources() })}`)
      const elements = await page.evaluate(measureRenderedLayout, { timeoutMs: 10000, fonts: pinnedFonts() })
      assert.ok(elements.every(e => !e.overflow), `${style}.${sample.kind}: ${JSON.stringify(elements)}`)
      if (sample.kind === 'table') {
        assert.equal(await page.locator('table tbody tr').count(), 3)
        assert.match(await page.locator('table').innerText(), /1234567890.125/)
        const fits = await page.locator('table').evaluate(table => { const outer = table.parentElement!.getBoundingClientRect(), box = table.getBoundingClientRect(); return box.right <= outer.right + 1 && box.bottom <= outer.bottom + 1 })
        assert.ok(fits, `${style} table outside frame`)
      }
      if (sample.kind === 'chart') { assert.equal(await page.locator('svg').count(), 1); assert.match(await page.locator('svg').textContent() ?? '', /42/); assert.match(await page.locator('svg').textContent() ?? '', /56/) }
      const cdp = await page.context().newCDPSession(page)
      try {
        await cdp.send('DOM.enable'); await cdp.send('CSS.enable')
        const rootNode = await cdp.send('DOM.getDocument')
        const nodes = await cdp.send('DOM.querySelectorAll', { nodeId: rootNode.root.nodeId, selector: '[data-ppte-type="text"], svg text, table' })
        for (const nodeId of nodes.nodeIds) {
          const used = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
          assert.ok(used.fonts.every(font => font.glyphCount === 0 || font.isCustomFont), `${style}.${sample.kind}: unpinned glyph fallback`)
        }
      } finally { await cdp.detach() }
      const screenshot = await page.locator('.ppte-slide').screenshot(); save(path, screenshot)
      measurements.push({ id: sample.ir.slideKey, status: 'pass', documentDigest: canonicalHash(doc), fixtureDigest: canonicalHash(sample), preview: path, screenshotDigest: digestBytes(screenshot), elements })
    }
    const report = { version: '1.0.0', buildDigest: buildDigest(), harnessDigest: canonicalHash(readFileSync('dist/tests/helpers/design-pack-fixtures.js', 'utf8')), fixtureDigest: canonicalHash({ cells: designPackCoverage(), stress: DESIGN_STYLES.map(stressSamples) }), fontDigest: digestBytes(fontBytes()), resourceDigest: digestBytes(visualBytes()), browser: browser.version(), environment: { platform: process.platform, arch: process.arch, node: process.version }, measurements, unverified: ['Office client visual fidelity', 'Safari', 'Human G2 editing study', 'Glyph coverage outside the declared sample subset', 'Table v2 and native table export'] }
    save('report.json', JSON.stringify(report, null, 2) + '\n')
    return report
  } finally { await browser.close() }
}
