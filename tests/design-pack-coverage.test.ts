import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { canonicalHash } from '../packages/canonical-json/src/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { buildCheckpointBytes, openCheckpointBytes } from '../packages/file-format/src/index.js'
import { materializeSlideDraft } from '../packages/design-compiler/src/index.js'
import { DESIGN_STYLES, DESIGN_ROLES, designPackCoverage, designPackRecipeSpecs, designPackManifest, designPackSample, designPackTheme, matchBlocksToSlots, resolveRecipeZones } from '../packages/layout-recipes/src/index.js'
import { packageDigest, structuralFingerprint, validateStylePack, validateRecipeManifest } from '../packages/design-system/src/index.js'
import { validateRecipeSpec } from '../packages/schema/src/index.js'
import { inspectGlyphCoverage } from '../packages/validation/src/index.js'
import { renderTextPlain } from '../packages/renderer-react/src/index.js'
import type { TextElement } from '../packages/schema/src/index.js'
import { template, compileSample, insertSample, transaction, stressSamples, insertStress, fontBytes, visualBytes, digestBytes, captureDesignPacks, buildDigest } from './helpers/design-pack-fixtures.js'
const fixture = () => JSON.parse(readFileSync('tests/fixtures/evolution/design-pack-manifest.json', 'utf8'))
const policy = (value: object) => ({ trustedDigests: [packageDigest(value)], allowedLicenses: ['Apache-2.0','OFL-1.1'] })

for (const cell of designPackCoverage()) test(`D04 A14 criteria 1/2/3 ${cell.style} × ${cell.role}: real geometry, capacity, semantic content and deterministic sizes`, () => {
  const recipe = designPackRecipeSpecs(cell.style).find(r => r.id === cell.manifest.recipeRef.id)!
  assert.deepEqual(validateRecipeSpec(recipe), [])
  validateRecipeManifest(cell.manifest, recipe, policy(cell.manifest))
  const peerRecipes = DESIGN_STYLES.map(s => designPackRecipeSpecs(s).find(r => r.supports[0] === cell.role)!)
  assert.equal(new Set(peerRecipes.map(r => canonicalHash(r.zones))).size, 4, 'color-only variants do not count')
  assert.equal(new Set(peerRecipes.map(structuralFingerprint)).size, 4)
  for (const sample of cell.manifest.samples) {
    const ir = sample.input.slides[0], draft = compileSample(cell.style, recipe, ir)
    assert.deepEqual(draft, compileSample(cell.style, structuredClone(recipe), structuredClone(ir)))
    if (sample.kind === 'overload') {
      assert.ok(matchBlocksToSlots(ir.blocks, recipe).unmatched > 0)
      assert.ok(draft.validationIssues.some(i => i.severity === 'error' && /CAPACITY/.test(i.message)))
      assert.equal(draft.elementDrafts.length, 0)
      assert.throws(() => materializeSlideDraft(draft, 'rejected', { width: 1280, height: 720 }), /RECIPE_DRAFT_REJECTED/)
      assert.equal(ir.blocks.length, 5)
      continue
    }
    assert.deepEqual(draft.validationIssues.filter(i => i.severity === 'error'), [])
    assert.equal(draft.elementDrafts.length, ir.blocks.length)
    assert.deepEqual(draft.elementDrafts.map(e => e.sourceBlockKey).sort(), ir.blocks.map(b => b.key).sort())
    const slide = materializeSlideDraft(draft, ir.slideKey, { width: 1280, height: 720 })
    assert.equal(slide.readingOrder?.length, ir.blocks.length)
    for (const element of Object.values(slide.elements)) {
      const block = ir.blocks.find(b => b.semanticKey === element.semanticKey)!
      assert.ok(block)
      if (element.type === 'text') {
        assert.equal(renderTextPlain(element), String(block.content))
        assert.equal(element.overflowPolicy, 'warn')
        const style = designPackTheme(cell.style).presets.text[element.style.styleRef!]
        assert.ok(style.fontSize! / 720 >= (element.role === 'source' ? .016 : .022))
        assert.ok(element.content.paragraphs.every(p => p.runs.every(r => !r.marks?.fontSize)))
      } else { assert.equal(element.type, 'image'); assert.equal(element.assetId, 'asset_design_visual') }
    }
    // Canvas-independent du geometry and typography; no fixed product canvas assumption.
    for (const [width,height] of [[1920,1080],[1600,1200]]) {
      const large = compileSample(cell.style, recipe, ir, width, height)
      assert.deepEqual(large.validationIssues.filter(i => i.severity === 'error'), [])
      for (let i = 0; i < draft.elementDrafts.length; i++) {
        assert.ok(Math.abs(large.elementDrafts[i].frame.x / width - draft.elementDrafts[i].frame.x / 1280) < 1e-8)
        assert.ok(Math.abs(large.elementDrafts[i].frame.y / height - draft.elementDrafts[i].frame.y / 720) < 1e-8)
      }
    }
  }
  const tooLong = designPackSample(cell.style, cell.role, 'normal'); tooLong.blocks[0].content = '长'.repeat(25)
  assert.ok(matchBlocksToSlots(tooLong.blocks, recipe).unmatched > 0, 'text capacity is also a hard bound')
  assert.equal(resolveRecipeZones(recipe).length, 3)
})

test('D04 criteria 1/2 versioned manifests, all 96 samples/previews, 12 pressure pages, asset digests and licenses are real', () => {
  const data = fixture()
  assert.deepEqual(data.cells, designPackCoverage())
  assert.equal(data.cells.length, 32); assert.equal(data.stress.length, 12); assert.equal(data.previews.length, 108)
  for (const style of DESIGN_STYLES) {
    const pack = JSON.parse(readFileSync(`design-packs/${style}/manifest.json`, 'utf8'))
    assert.deepEqual(pack, designPackManifest(style)); validateStylePack(pack, policy(pack))
    const recipes = JSON.parse(readFileSync(`design-packs/${style}/recipes.json`, 'utf8'))
    assert.deepEqual(recipes, designPackRecipeSpecs(style))
    assert.deepEqual(recipes.map((r: { supports: string[] }) => r.supports[0]), [...DESIGN_ROLES])
    assert.equal(new Set(recipes.map(structuralFingerprint)).size, 8)
    assert.deepEqual(data.stress.filter((s: { style: string }) => s.style === style).map(({ style: _style, preview: _preview, ...s }: Record<string, unknown>) => s), stressSamples(style))
  }
  for (const resource of [...data.resources, ...data.previews]) {
    const bytes = readFileSync(resource.path); assert.equal(digestBytes(bytes), resource.digest)
    if (resource.path.endsWith('.png')) { assert.equal(bytes.subarray(1,4).toString(), 'PNG'); assert.equal(bytes.readUInt32BE(16), 1280); assert.ok(bytes.readUInt32BE(20) >= 720) }
  }
  assert.match(readFileSync('design-packs/assets/OFL.txt','utf8'), /SIL OPEN FONT LICENSE/)
  const report = JSON.parse(readFileSync('design-packs/render-evidence.json', 'utf8'))
  assert.equal(report.fontDigest, digestBytes(fontBytes()))
  assert.equal(report.resourceDigest, digestBytes(visualBytes()))
  assert.equal(report.fixtureDigest, canonicalHash({ cells: designPackCoverage(), stress: DESIGN_STYLES.map(stressSamples) }))
  assert.equal(report.measurements.filter((m: { status: string }) => m.status === 'pass').length, 76)
  assert.equal(report.measurements.filter((m: { status: string }) => m.status === 'rejected').length, 32)
  for (const measurement of report.measurements) {
    const bytes = readFileSync(measurement.preview)
    assert.equal(measurement.screenshotDigest, measurement.rendererDigest ? canonicalHash([...bytes]) : digestBytes(bytes))
  }

})

for (const style of DESIGN_STYLES) test(`D04 A15/A17 criterion 3 ${style}: Operation Engine edit/undo/redo/checkpoint and fresh process without packs opens and exports`, () => {
  const session = new PpteSession(template(style))
  for (const recipe of designPackRecipeSpecs(style)) insertSample(session, style, recipe, designPackSample(style, recipe.supports[0] as typeof DESIGN_ROLES[number], 'boundary'))
  for (const sample of stressSamples(style)) insertStress(session, style, sample)
  const original = session.getDocument(), slideId = original.slideOrder[0], title = Object.values(original.slides[slideId].elements).find(e => e.role === 'title') as TextElement
  const content = structuredClone(title.content); content.paragraphs[0].runs[0].text = '开始下一步'
  const edited = session.commit(transaction(session, `edit.${style}`, [{ opId: 'edit', kind: 'text.replaceContent', slideId, elementId: title.id, content }]))
  assert.equal(edited.ok, true, JSON.stringify(edited.issues))
  assert.equal(session.undo().ok, true); assert.deepEqual(session.getDocument(), original)
  assert.equal(session.redo().ok, true)
  const current = session.getDocument()
  const resources = { assetBytes: { asset_design_visual: visualBytes() }, fontBytes: { font_design: fontBytes() }, recentTransactions: session.getHistory().map(h => h.transaction) }
  const bytes = buildCheckpointBytes(current, resources), reopened = openCheckpointBytes(bytes)
  assert.deepEqual(reopened.document.slides, current.slides)
  assert.deepEqual(reopened.document.theme, current.theme)
  const restored = new PpteSession(reopened.document)
  assert.equal(restored.undo().ok, true); assert.deepEqual(restored.getDocument().slides, original.slides)
  assert.equal(restored.redo().ok, true); assert.deepEqual(restored.getDocument().slides, current.slides)
  const tableSlide = current.slides[`${style}.stress.table`], table = tableSlide.elements.retained_table
  assert.equal(table.type, 'component'); assert.equal(table.componentVersion, '1.0.0')
  assert.deepEqual(table.props.rows, [['发现', 1234567890.125, true], ['验证', 42, null], ['交付', 128, '中文换行\n保留来源']])
  const chart = Object.values(current.slides[`${style}.stress.chart`].elements).find(e => e.type === 'chart')!
  assert.equal(chart.type, 'chart'); assert.deepEqual(chart.data.rows.map(r => r.values.value), [42,38,56])
  const temp = mkdtempSync(join(tmpdir(), 'd04-no-pack-'))
  try {
    writeFileSync(join(temp,'deck.ppte'), bytes)
    // The only external input is the checkpoint. No manifest, recipe or source fixture is copied.
    const script = `import assert from 'node:assert/strict'; import {readFileSync,writeFileSync,existsSync} from 'node:fs';
      import {openCheckpointBytes,readStoredZip} from ${JSON.stringify(new URL('../packages/file-format/src/index.js', import.meta.url).href)};
      import {renderReadOnlyPresentationHtml} from ${JSON.stringify(new URL('../packages/renderer-react/src/index.js', import.meta.url).href)};
      import {exportSemanticPptx} from ${JSON.stringify(new URL('../packages/exporter-pptx/src/index.js', import.meta.url).href)};
      assert.equal(existsSync('design-packs'),false); const bytes=readFileSync('deck.ppte'); const {document}=openCheckpointBytes(bytes); const zip=readStoredZip(bytes);
      const visual=zip.get('assets/visual-1.svg'); const font=zip.get('fonts/noto-sans-sc-sample-1.woff2'); assert.ok(visual); assert.ok(font);
      const html=renderReadOnlyPresentationHtml(document,{assetSources:{asset_design_visual:'data:image/svg+xml;base64,'+Buffer.from(visual).toString('base64')}});
      assert.equal(document.slideOrder.length,11); assert.ok(html.includes('1234567890.125')); assert.ok(html.includes('开始下一步')); assert.ok(!html.includes('contenteditable="true"'));
      writeFileSync('deck.html',html); const pptx=exportSemanticPptx(document,{assetBytes:{asset_design_visual:visual},fontBytes:{font_design:font}}); assert.equal(pptx.ok,true,JSON.stringify(pptx.issues)); writeFileSync('deck.pptx',pptx.bytes);
      const entries=readStoredZip(pptx.bytes); assert.ok([...entries.keys()].some(k=>k.startsWith('ppt/slides/slide'))); console.log('opened 11 semantic slides and exported HTML/PPTX; Office fidelity unverified');`
    writeFileSync(join(temp,'open.mjs'), script)
    const result = spawnSync(process.execPath, ['open.mjs'], { cwd: temp, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /opened 11 semantic slides/)
  } finally { rmSync(temp, { recursive: true, force: true }) }
})

test('D04 A14/A17 criterion 4 G2 all normal/boundary and Chinese/chart/Table v1 pressure pages actually render with pinned fonts offline', async () => {
  const report = await captureDesignPacks('artifacts/d04')
  assert.equal(report.buildDigest, buildDigest())
  assert.equal(report.measurements.length, 108)
  assert.equal(report.measurements.filter(m => m.status === 'pass').length, 76)
  assert.equal(report.measurements.filter(m => m.status === 'rejected').length, 32)
  for (const m of report.measurements) { assert.ok(m.screenshotDigest); assert.ok(m.fixtureDigest); assert.ok(readFileSync(resolve('artifacts/d04', String(m.preview))).length > 1000) }
  assert.ok(report.unverified.includes('Office client visual fidelity'))
})


test('D04 criterion 3 pinned sample font accepts layout controls and rejects uncovered visible glyphs without fallback', () => {
  const document = template('business')
  const draft = compileSample('business', designPackRecipeSpecs('business')[0], designPackSample('business','cover','normal'))
  const element = Object.values(materializeSlideDraft(draft, 'sample', document.canvas).elements).find(e => e.type === 'text') as TextElement
  assert.equal(inspectGlyphCoverage(document, element, '发现\n交付\t42\r128', { strict: true }).covered, true)
  const missing = inspectGlyphCoverage(document, element, '发现\n🦄', { strict: true })
  assert.equal(missing.covered, false); assert.deepEqual(missing.missingCodePoints, [0x1f984])
  const sample = stressSamples('business').find(s => s.kind === 'chart')!
  const chart = Object.values(materializeSlideDraft(compileSample('business', sample.recipe, sample.ir), 'chart', document.canvas).elements).find(e => e.type === 'chart')!
  assert.equal(chart.type, 'chart'); assert.deepEqual(chart.options, { showLabels: true, showLegend: false }); assert.equal(chart.altText, '季度增长 42、38、56')
})
