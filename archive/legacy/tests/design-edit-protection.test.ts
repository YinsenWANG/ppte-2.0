import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { EditorController } from '../packages/editor-controller/src/index.js'
import { PortableRuntime } from '../packages/portable-runtime/src/shared.js'
import { AgentToolServer, AGENT_TOOL_DEFINITIONS } from '../packages/agent-tools/src/index.js'
import { MCP_TOOL_INPUT_SCHEMAS } from '../packages/agent-tools/src/tool-schemas.js'
import { RecipeRegistry } from '../packages/layout-recipes/src/index.js'
import { resolveParameters } from '../packages/design-system/src/index.js'
import { planDesignEdit, planDesignTheme, recipeControls, parameterizeRecipe, readDesignBinding, bindingExtension } from '../packages/design-compiler/src/design-edits.js'
import { buildCheckpointBytes, openCheckpointBytes } from '../packages/file-format/src/index.js'
import { renderSlideHtml } from '../packages/renderer-react/src/index.js'
import type { RecipeSpec, TextElement, Transaction } from '../packages/schema/src/index.js'

const recipe: RecipeSpec = { id: 'd05.grid', version: '1.0.0', supports: ['custom'], slots: [{ key: 'items', accepts: ['paragraph'], required: true, maxCount: 4, repeat: { version: '1.0', maxCount: 4, columns: 4, gapX: .03, gapY: .03 } }], zones: [{ id: 'items', x: .1, y: .1, width: .8, height: .8 }], constraints: [] }
function fixture() {
  const { document } = makeContractDocument()
  const template = structuredClone(document.slides.slide_main.elements.text_body) as TextElement
  document.slides = { s: { id: 's', rootOrder: [], elements: {}, readingOrder: [] } }; document.slideOrder = ['s']
  for (let i = 0; i < 4; i++) {
    const id = `item${i}`
    const element: TextElement = { ...structuredClone(template), id, semanticKey: `d05.${id}`, frame: { x: 100 + i * 220, y: 100, width: 180, height: 300 }, content: { paragraphs: [{ id: `p${i}`, runs: [{ id: `r${i}`, text: `人工内容 ${i}` }] }] } }
    document.slides.s.elements[id] = element; document.slides.s.rootOrder.push(id); document.slides.s.readingOrder!.push(id)
  }
  // Keep the actual fact/source and asset registries from the contract fixture.
  return document
}
const options = (s: PpteSession, id = 'layout') => ({ recipe, slideId: 's', transactionId: id, baseRevision: s.getRevision(), parameters: { columns: 3 } })
function commit(s: PpteSession, tx: Transaction) { const p = s.preview(tx); assert.equal(p.ok, true, JSON.stringify(p.issues)); const r = s.commit(tx); assert.equal(r.ok, true, JSON.stringify(r.issues)) }

test('D05 criterion 1: Host, Portable and Skill share finite recipe controls; CSS, code and unknown paths rejected', () => {
  const s = new PpteSession(fixture(), { runtimeProfile: 'ga-c' })
  const server = new AgentToolServer(s, { recipes: new RecipeRegistry([recipe]) })
  assert.deepEqual(server.execute('get_recipe_controls', { recipeId: recipe.id }).data, recipeControls(recipe))
  assert.deepEqual(resolveParameters(recipeControls(recipe), { columns: 3 }), { columns: 3 })
  for (const parameters of [{ css: 'position:fixed' }, { code: 'alert(1)' }, { 'style.fontSize': 1 }, { columns: '3' }, { columns: 0 }, { columns: 4 }, { columns: NaN }, []]) {
    assert.throws(() => parameterizeRecipe(recipe, parameters as Record<string, unknown>))
    assert.equal(server.execute('apply_layout_recipe', { slideId: 's', recipeId: recipe.id, parameters }).ok, false)
  }
  assert.ok(MCP_TOOL_INPUT_SCHEMAS.apply_layout_recipe)
  assert.equal(AGENT_TOOL_DEFINITIONS.find(t => t.name === 'apply_design_theme')!.mutates, false)
  for (const path of ['packages/editor-react/src/RecipeStudio.tsx', 'packages/portable-runtime/src/browser.ts']) assert.match(readFileSync(path, 'utf8'), /recipeControls/)
  assert.equal(s.getHistory().length, 0)
})

test('D05 criteria 2/3: four columns to three keeps the fourth item, IDs, facts, reading order and current text; stale IR cannot overwrite', () => {
  const d = fixture(); const s = new PpteSession(d, { runtimeProfile: 'ga-c' })
  const server = new AgentToolServer(s, { recipes: new RecipeRegistry([recipe]) })
  const result = server.execute('apply_layout_recipe', { slideId: 's', recipeId: recipe.id, parameters: { columns: 3 }, slideIR: { blocks: [] } })
  assert.equal(result.ok, true, JSON.stringify(result.issues)); assert.ok(result.transaction)
  commit(s, result.transaction)
  const after = s.getDocument()
  assert.equal(Object.keys(after.slides.s.elements).length, 4)
  assert.ok(after.slides.s.elements.item3.frame.y > after.slides.s.elements.item0.frame.y)
  for (const id of d.slides.s.rootOrder) { const { frame: _a, ...before } = d.slides.s.elements[id]; const { frame: _b, ...next } = after.slides.s.elements[id]; assert.deepEqual(next, before) }
  assert.deepEqual(after.facts, d.facts); assert.deepEqual(after.sources, d.sources); assert.deepEqual(after.slides.s.readingOrder, d.slides.s.readingOrder)
  assert.ok(result.transaction.operations.every(o => ['element.move', 'element.resize', 'slide.update'].includes(o.kind)))
  assert.equal(result.transaction.scope.allowDelete, false)
  assert.equal(readDesignBinding(after, 's')!.parameters.columns, 3)
})

test('D05 criterion 2: bound reflow preserves manual additions, local formatting, crop/assets and authoritative locks', () => {
  const initial = new PpteSession(fixture(), { runtimeProfile: 'ga-c' }); commit(initial, planDesignEdit(initial.getDocument(), options(initial)).transaction!)
  const d = structuredClone(initial.getDocument()), slide = d.slides.s
  const e = slide.elements.item0 as TextElement; e.content.paragraphs[0].runs[0].text = '新手工改字'; e.style.overrides = { ...e.style.overrides, color: { kind: 'value', value: '#FF0000' } }
  slide.elements.item1.locked = true; slide.elements.item2.editPolicy = { lockedFields: ['/frame'] }
  const { document: source } = makeContractDocument()
  slide.elements.manual = { ...structuredClone(source.slides.slide_main.elements.image_hero), id: 'manual', crop: { x: .1, y: .2, width: .6, height: .5 } } as typeof source.slides.slide_main.elements.image_hero
  slide.rootOrder.push('manual'); slide.readingOrder!.push('manual')
  slide.elements.manualShape = { ...structuredClone(source.slides.slide_main.elements.shape_surface), id: 'manualShape' }
  slide.rootOrder.push('manualShape')
  const s = new PpteSession(d, { runtimeProfile: 'ga-c' })
  const plan = planDesignEdit(d, { ...options(s), parameters: { columns: 2 } }); assert.ok(plan.transaction); commit(s, plan.transaction)
  for (const id of ['manual', 'manualShape', 'item1', 'item2']) assert.deepEqual(s.getDocument().slides.s.elements[id], d.slides.s.elements[id])
  const edited = s.getDocument().slides.s.elements.item0 as TextElement
  assert.deepEqual(edited.content, e.content); assert.deepEqual(edited.style, e.style)
  assert.ok(!Object.values(readDesignBinding(s.getDocument(), 's')!.sourceBlockToElement).includes('manual'))
})

test('D05 criterion 2: invalid/missing binding identities and changed recipe digest never guess; explicit rebuild repairs metadata', () => {
  const s = new PpteSession(fixture(), { runtimeProfile: 'ga-c' }); commit(s, planDesignEdit(s.getDocument(), options(s)).transaction!)
  const d = structuredClone(s.getDocument()); const b = readDesignBinding(d, 's')!; b.sourceBlockToElement.item0 = 'missing'; d.slides.s.extensions = [bindingExtension(b)]
  assert.throws(() => planDesignEdit(d, options(s)), /STALE/)
  assert.ok(planDesignEdit(d, { ...options(s), rebuildBinding: true }).transaction)
  const changed = structuredClone(recipe); changed.zones[0].x = .11
  assert.throws(() => planDesignEdit(s.getDocument(), { ...options(s), recipe: changed }), /RECIPE_CHANGED/)
  b.sourceBlockToElement.item0 = 'item1'; d.slides.s.extensions = [bindingExtension(b)]
  assert.throws(() => planDesignEdit(d, options(s)), /INVALID/)
})

test('D05 criterion 3: insufficient capacity returns a proposal and no transaction; geometry and theme never rewrite content', () => {
  const s = new PpteSession(fixture(), { runtimeProfile: 'ga-c' }); const small = structuredClone(recipe); small.slots[0].maxCount = 3; small.slots[0].repeat!.maxCount = 3
  const result = planDesignEdit(s.getDocument(), { ...options(s), recipe: small })
  assert.equal(result.transaction, undefined); assert.ok(result.issues.some(i => /CAPACITY/.test(i.code))); assert.equal(result.proposals.length, 2); assert.equal(s.getHistory().length, 0)
})

test('D05 criteria 2/3: theme/font changes preserve edited text and local overrides; protected global theme is rejected', () => {
  const d = fixture(); const e = d.slides.s.elements.item0 as TextElement; e.style.overrides = { fontFamily: { kind: 'value', value: 'Arial' }, fontSize: 32 }; e.content.paragraphs[0].runs[0].text = '已精修'
  const s = new PpteSession(d, { runtimeProfile: 'ga-c' }); const theme = structuredClone(d.theme)
  for (const key of Object.keys(theme.tokens.colors)) theme.tokens.colors[key] = '#123456'
  for (const key of Object.keys(theme.tokens.fontFamilies)) theme.tokens.fontFamilies[key] = 'serif'
  commit(s, planDesignTheme(d, theme, options(s, 'theme')))
  assert.deepEqual(s.getDocument().slides, d.slides); assert.deepEqual(s.getDocument().facts, d.facts); assert.deepEqual(s.getDocument().theme, theme)
  d.slides.s.elements.item0.editPolicy = { lockedFields: ['/style'] }
  assert.throws(() => planDesignTheme(d, theme, options(s)), /PROTECTED/)
  d.slides.s.elements.item0.locked = true
  assert.throws(() => planDesignTheme(d, theme, options(s)), /PROTECTED/)
})

test('D05 dual entry protection sequence: preview is read-only, commits match, stale previews fail, undo/redo reopen without recipe pack', () => {
  const d = fixture(); const s = new PpteSession(d, { runtimeProfile: 'ga-c' }); const host = new EditorController(s); const portable = new PortableRuntime(d, { profile: 'full-portable' })
  const tx = planDesignEdit(d, options(s)).transaction!
  assert.equal(host.preview(tx).ok, true); assert.equal(portable.preview(tx).ok, true); assert.deepEqual(s.getDocument(), d); assert.deepEqual(portable.getDocument(), d)
  assert.equal(host.commit(tx).ok, true); assert.equal(portable.controller.commit(tx).ok, true); assert.deepEqual(portable.getDocument(), s.getDocument())
  assert.equal(host.commit(tx).ok, false); assert.equal(portable.controller.commit(tx).ok, false)
  assert.equal(host.undo().ok, true); assert.equal(portable.undo().ok, true); assert.deepEqual(s.getDocument(), d)
  assert.equal(host.redo().ok, true); assert.equal(portable.redo().ok, true)
  // No external assets are used by these slides. Include the original registry bytes for the container.
  const { imageBytes } = makeContractDocument(); const assetBytes = Object.fromEntries(Object.keys(d.assets).map(id => [id, imageBytes]))
  const reopened = openCheckpointBytes(buildCheckpointBytes(s.getDocument(), { assetBytes, recentTransactions: s.getHistory().map(e => e.transaction) }))
  assert.deepEqual(reopened.document, s.getDocument()); assert.match(renderSlideHtml(reopened.document, 's'), /人工内容/)
  host.dispose(); portable.dispose()
})

test('D05 Portable browser: schema controls preview/cancel/accept through Core and survive undo and save/reopen', async () => {
  const { chromium } = await import('playwright')
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path'); const { pathToFileURL } = await import('node:url')
  const { createPortableFullPortable } = await import('../packages/portable-runtime/src/index.js')
  const { document, imageBytes } = makeContractDocument()
  const built = createPortableFullPortable(document, { assetBytes: { asset_pixel: imageBytes } }); assert.equal(built.ok, true)
  const dir = mkdtempSync(join(tmpdir(), 'd05-browser-')); const file = join(dir, 'deck.html'); writeFileSync(file, built.html)
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ acceptDownloads: true }); await page.goto(pathToFileURL(file).href); await page.waitForFunction(() => Boolean((globalThis as any).PPTEPortable))
    await page.locator('[data-ppte-design-panel] > summary').click()
    await page.getByLabel('配方', { exact: true }).selectOption('summary.grid'); await page.getByLabel('列数', { exact: true }).selectOption('1')
    const before = await page.evaluate(() => (globalThis as any).PPTEPortable.getDocument())
    await page.getByRole('button', { name: '预览保留内容重排', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: '接受设计修改', exact: true }).isVisible(), true)
    assert.deepEqual(await page.evaluate(() => (globalThis as any).PPTEPortable.getDocument()), before)
    await page.getByRole('button', { name: '取消设计修改', exact: true }).click(); assert.equal(await page.locator('[data-ppte-design-preview] > *').count(), 0)
    await page.getByRole('button', { name: '预览保留内容重排', exact: true }).click(); await page.getByRole('button', { name: '接受设计修改', exact: true }).click()
    const after = await page.evaluate(() => (globalThis as any).PPTEPortable.getDocument())
    assert.equal(readDesignBinding(after, 'slide_main')!.parameters.columns, 1)
    assert.deepEqual(after.facts, before.facts)
    for (const id of before.slides.slide_main.rootOrder) { const { frame: _a, ...a } = before.slides.slide_main.elements[id]; const { frame: _b, ...b } = after.slides.slide_main.elements[id]; assert.deepEqual(a, b) }
    assert.equal(await page.evaluate(() => (globalThis as any).PPTEPortable.undo().ok), true); assert.deepEqual(await page.evaluate(() => (globalThis as any).PPTEPortable.getDocument()), before)
    assert.equal(await page.evaluate(() => (globalThis as any).PPTEPortable.redo().ok), true)
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-ppte-action="save-portable"]').click()]); const saved = join(dir, 'saved.html'); await download.saveAs(saved)
    await page.goto(pathToFileURL(saved).href); await page.waitForFunction(() => Boolean((globalThis as any).PPTEPortable)); assert.deepEqual(await page.evaluate(() => (globalThis as any).PPTEPortable.getDocument()), after)
  } finally { await browser.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('D05 Host browser: RecipeStudio shares columns, stages geometry and theme separately, and accepts reviewed edits', async () => {
  const { chromium } = await import('playwright'); const { spawnSync } = await import('node:child_process')
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path'); const { pathToFileURL } = await import('node:url')
  const dir = mkdtempSync(join(tmpdir(), 'd05-host-')); const { document, imageBytes } = makeContractDocument()
  // Use an unprotected deck for successful global theme application; protection rejection is tested separately.
  delete document.slides.slide_main.elements.text_title.editPolicy
  delete document.slides.slide_main.elements.text_title.locked
  delete document.slides.slide_main.protectedAnchors
  const built = spawnSync('pnpm', ['host:build', '--outDir', join(dir, 'host')], { encoding: 'utf8' }); assert.equal(built.status, 0, built.stdout + built.stderr)
  const file = join(dir, 'deck.ppte'); writeFileSync(file, buildCheckpointBytes(document, { assetBytes: { asset_pixel: imageBytes } }))
  const theme = structuredClone(document.theme); for (const k of Object.keys(theme.tokens.colors)) theme.tokens.colors[k] = '#123456'
  const themeFile = join(dir, 'theme.json'); writeFileSync(themeFile, JSON.stringify(theme))
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }); await page.goto(pathToFileURL(join(dir, 'host/index.html')).href)
    await page.waitForFunction(() => globalThis.document.querySelector('[data-ppte-ready]')?.getAttribute('data-ppte-ready') === 'true')
    await page.locator('[data-ppte-action=open]').setInputFiles(file); await page.waitForFunction(() => Boolean((globalThis as any).PPTEHost))
    await page.getByRole('button', { name: '布局工作室', exact: true }).click(); await page.getByLabel('布局版本', { exact: true }).selectOption('summary.grid@1.1.0'); await page.getByLabel('列数', { exact: true }).selectOption('2')
    const before = await page.evaluate(() => (globalThis as any).PPTEHost.getDocument())
    await page.getByRole('button', { name: '预览应用到当前页', exact: true }).click(); assert.equal(await page.locator('[data-ppte-preview]').isVisible(), true)
    assert.deepEqual(await page.evaluate(() => (globalThis as any).PPTEHost.getDocument()), before)
    await page.getByRole('button', { name: '接受修改', exact: true }).click()
    const layout = await page.evaluate(() => (globalThis as any).PPTEHost.getDocument()); assert.equal(readDesignBinding(layout, 'slide_main')!.parameters.columns, 2)
    await page.getByLabel('全稿主题', { exact: true }).setInputFiles(themeFile); await page.locator('[data-ppte-preview]').waitFor({ state: 'visible', timeout: 5000 }).catch(async cause => { throw new Error(`${cause}: ${await page.locator('[data-ppte-status]').innerText()}`) }); assert.equal(await page.locator('[data-ppte-preview]').isVisible(), true)
    assert.deepEqual(await page.evaluate(() => (globalThis as any).PPTEHost.getDocument()), layout)
    await page.getByRole('button', { name: '接受修改', exact: true }).click()
    const after = await page.evaluate(() => (globalThis as any).PPTEHost.getDocument()); assert.deepEqual(after.theme, theme); assert.deepEqual(after.slides, layout.slides)
  } finally { await browser.close(); rmSync(dir, { recursive: true, force: true }) }
})
