import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { canonicalHash, cloneJson } from '../packages/canonical-json/src/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { DesignCompiler, buildRegenerateTransaction } from '../packages/design-compiler/src/index.js'
import { RecipeRegistry } from '../packages/layout-recipes/src/index.js'
import { createRecipeManifest, compileBrandTheme, designRuleLayers, packageDigest, recipeReference, regenerationProtectedIds, resolvePackage, resolveParameters, structuralFingerprint, validateRecipeManifest, validateStylePack } from '../packages/design-system/src/index.js'
import type { BrandSpec, StylePack, RecipeManifest, TrustPolicy, DesignPlan, DesignBinding } from '../packages/design-system/src/index.js'
import type { RecipeSpec } from '../packages/schema/src/index.js'
const fixture = () => JSON.parse(readFileSync('tests/fixtures/design-system/contracts.json', 'utf8')) as { brand: BrandSpec; style: StylePack; recipe: RecipeSpec; manifest: RecipeManifest }
const policy = (...values: object[]): TrustPolicy => ({ trustedDigests: values.map(packageDigest), allowedLicenses: ['Apache-2.0'] })
function reseal<T extends { digest: string }>(value: T): T { value.digest = packageDigest(value); return value }

test('D01 criterion 1 reuses PresentationIR, RecipeSpec and ThemeDefinition without a second content tree', () => {
  const { brand, style, recipe, manifest } = fixture()
  validateStylePack(style, policy(style))
  validateRecipeManifest(manifest, recipe, policy(manifest))
  const plan: DesignPlan = { contractVersion: '1', presentation: manifest.samples[0].input, styleRef: { id: style.id, version: style.version, digest: style.digest }, usage: 'read', seed: 'd01', selections: [{ slideKey: 'main', recipeRef: recipeReference(recipe), reason: '中文语句', contentBudget: 3 }] }
  const theme = compileBrandTheme(brand, style.theme, policy(brand))
  const compiler = new DesignCompiler()
  const context = { canvas: { width: 1280, height: 720 }, theme, recipes: new RecipeRegistry([recipe]), recipeId: recipe.id, recipeVersion: recipe.version, seed: plan.seed }
  const draft = compiler.compileSlide(plan.presentation.slides[0], context)
  assert.equal(draft.elementDrafts.length, 2)
  assert.deepEqual(draft, compiler.compileSlide(plan.presentation.slides[0], context))
  const binding: DesignBinding = { contractVersion: '1', recipeRef: recipeReference(recipe), sourceBlockToElement: { block0: draft.elementDrafts[0].draftId }, parameters: resolveParameters(manifest.controls), manualOverrides: {} }
  assert.equal('content' in binding, false)
  assert.equal('slots' in manifest, false)
  assert.equal(theme.tokens.colors.primary, '#123456')
  assert.notEqual(style.theme.tokens.colors.primary, '#123456')
})

test('D01 criterion 2 brand/recipe errors and aesthetic suggestions remain distinct', () => {
  const { brand, style, recipe } = fixture()
  const layers = designRuleLayers(brand, recipe, style)
  assert.equal(layers.brand.severity, 'error')
  assert.equal(layers.recipe.severity, 'error')
  assert.equal(layers.aesthetic.severity, 'suggestion')
  assert.deepEqual(layers.recipe.constraints, recipe.constraints)
  assert.deepEqual(layers.brand.forbidden, brand.forbidden)
  assert.deepEqual(layers.aesthetic.rules, style.rules)
})

test('D01 criterion 3 canonical digest, trust and exact old-version resolution fail closed', () => {
  const { style, manifest, recipe } = fixture()
  assert.equal(packageDigest({ b: 2, a: 1 }), packageDigest({ a: 1, b: 2 }))
  assert.throws(() => validateStylePack(style, { ...policy(style), trustedDigests: [] }), /UNTRUSTED/)
  const tampered = cloneJson(style); tampered.description += '!'
  assert.throws(() => validateStylePack(tampered, policy(tampered)), /DIGEST_MISMATCH/)
  const old = reseal({ ...cloneJson(style), version: '0.9.0' })
  const pin = { id: old.id, version: old.version, digest: old.digest }
  assert.deepEqual(resolvePackage(pin, [style, old]), old)
  assert.throws(() => resolvePackage(pin, [style]), /VERSION_UNAVAILABLE/)
  assert.throws(() => resolvePackage(pin, [old, old]), /AMBIGUOUS/)
  assert.throws(() => resolvePackage({ ...pin, version: '^1.0.0' }, [style]), /VERSION_INVALID/)
  assert.throws(() => resolvePackage(pin, [{ ...old, description: 'tamper' }]), /DIGEST_MISMATCH/)
  const unsupported = reseal({ ...cloneJson(manifest), contractVersion: '0' as '1' })
  assert.throws(() => validateRecipeManifest(unsupported, recipe, policy(unsupported)), /CONTRACT_UNSUPPORTED/)
  const newer = { ...recipe, version: '1.0.1' }
  assert.throws(() => validateRecipeManifest(manifest, newer, policy(manifest)), /REFERENCE_MISMATCH/)
})

test('D01 criterion 3 parameter whitelist rejects scripts, CSS, paths, unknown and invalid values', () => {
  const { manifest } = fixture()
  assert.deepEqual(resolveParameters(manifest.controls), { columns: 2, captionDensity: 'medium', imageSide: 'right' })
  for (const columns of [1, 2, 3]) assert.equal(resolveParameters(manifest.controls, { columns }).columns, columns)
  for (const columns of [0, 4, 1.5, '2', NaN, { script: 'run()' }]) assert.throws(() => resolveParameters(manifest.controls, { columns }), /PARAMETER_INVALID/)
  for (const key of ['script', 'css', '/theme/tokens', '__proto__']) assert.throws(() => resolveParameters(manifest.controls, JSON.parse(`{"${key}":"run()"}`)), /PARAMETER_NOT_ALLOWED/)
  for (const patch of [{ name: 'script' }, { options: [1, 4] }, { default: 4 }, { min: 3 }, { type: 'enum' }, { path: '/theme' }]) {
    const controls = cloneJson(manifest.controls); Object.assign(controls[0], patch)
    assert.throws(() => resolveParameters(controls))
  }
  assert.throws(() => resolveParameters([...manifest.controls, manifest.controls[0]]), /CONTROL_NOT_ALLOWED/)
})

test('D01 criterion 3 licenses are per resource and unknown/AGPL licenses need explicit policy', () => {
  const { style, brand, recipe, manifest } = fixture()
  for (const license of ['AGPL-3.0-only', 'unknown']) {
    const altered = cloneJson(style); altered.licenses[0].license = license; reseal(altered)
    assert.throws(() => validateStylePack(altered, policy(altered)), /LICENSE_DENIED/)
  }
  const altered = cloneJson(style); altered.theme.tokens.fontFamilies.extra = 'Unlicensed'; reseal(altered)
  assert.throws(() => validateStylePack(altered, policy(altered)), /FONT_LICENSE_MISSING/)
  const preview = cloneJson(style); preview.previews = ['unlicensed.png']; reseal(preview)
  assert.throws(() => validateStylePack(preview, policy(preview)), /PREVIEW_LICENSE_MISSING/)
  brand.logoAssetRefs.push('unlicensed-logo')
  assert.throws(() => compileBrandTheme(brand, style.theme, policy(brand)), /RESOURCE_LICENSE_MISSING/)
  manifest.licenses = []; reseal(manifest)
  assert.throws(() => validateRecipeManifest(manifest, recipe, policy(manifest)), /LICENSE_MISSING/)
})

test('D01 criterion 3 Chinese pressure fixtures and capability claims cannot masquerade as measured exports', () => {
  const { manifest, recipe } = fixture()
  assert.deepEqual(manifest.samples.map(s => s.input.slides[0].blocks.length), [2, 3, 4])
  assert.ok(manifest.samples[2].input.slides[0].blocks.some(b => String(b.content).includes('12345678901234567890')))
  const before = canonicalHash(manifest.samples)
  validateRecipeManifest(manifest, recipe, policy(manifest))
  assert.equal(canonicalHash(manifest.samples), before)
  const noChinese = cloneJson(manifest); noChinese.samples[0].input.slides[0].blocks.forEach(b => { b.content = 'English' }); reseal(noChinese)
  assert.throws(() => validateRecipeManifest(noChinese, recipe, policy(noChinese)), /CJK_SAMPLE/)
  const fake = cloneJson(manifest); (fake.capabilities as Record<string, string>).pdf = 'verified'; reseal(fake)
  assert.throws(() => validateRecipeManifest(fake, recipe, policy(fake)), /EVIDENCE_REQUIRED/)
  const wrong = cloneJson(manifest); wrong.samples[2].input = wrong.samples[0].input; reseal(wrong)
  assert.throws(() => validateRecipeManifest(wrong, recipe, policy(wrong)), /CAPACITY_MISMATCH/)
})

test('D01 criterion 4 slotRefs and fingerprints detect duplicated or stale recipe structure', () => {
  const { manifest, recipe } = fixture()
  const { controls, capacity, capabilities, samples, licenses } = manifest
  assert.deepEqual(createRecipeManifest(recipe, { controls, capacity, capabilities, samples, licenses }), manifest)
  for (const patch of [{ slots: recipe.slots }, { slotRefs: ['missing'] }, { slotRefs: ['title', 'title'] }, { structuralFingerprint: packageDigest({}) }, { purpose: ['closing'] }]) {
    const altered = reseal(Object.assign(cloneJson(manifest), patch))
    assert.throws(() => validateRecipeManifest(altered, recipe, policy(altered)))
  }
  const changed = cloneJson(recipe); changed.slots[1].maxCount = 1
  assert.notEqual(structuralFingerprint(changed), manifest.structuralFingerprint)
  assert.throws(() => validateRecipeManifest(manifest, changed, policy(manifest)), /REFERENCE_MISMATCH/)
})

test('D01 criterion 4 current object policies and page anchors are authoritative; IR only adds', () => {
  const { document } = makeContractDocument()
  const slide = document.slides.slide_main
  const template = cloneJson(slide.elements.text_title)
  delete template.editPolicy
  delete template.locked
  slide.elements = {}; slide.rootOrder = []; slide.readingOrder = []
  const policies = [{ locked: true }, { editPolicy: { mode: 'locked' as const } }, { editPolicy: { protected: true } }, { editPolicy: { lockedFields: ['/frame'] } }, { editPolicy: { preserveOnRegenerate: true } }, { editPolicy: { agentEditable: false } }, {}, {}, {}, {}, {}]
  policies.forEach((patch, i) => { const id = `e${i}`; slide.elements[id] = { ...cloneJson(template), id, semanticKey: id, semanticRefs: { factIds: [`f${i}`] }, ...patch }; slide.rootOrder.push(id); slide.readingOrder!.push(id) })
  slide.protectedAnchors = [{ target: { kind: 'element', elementId: 'e6' }, preserve: ['geometry'] }, { target: { kind: 'semantic', semanticKey: 'e7' }, preserve: ['content'] }, { target: { kind: 'fact', factId: 'f8' }, preserve: ['data'] }]
  const additions = [{ semanticKey: 'e9', preserve: ['content' as const] }]
  assert.deepEqual([...regenerationProtectedIds(slide)], policies.slice(0, 9).map((_, i) => `e${i}`))
  assert.equal(regenerationProtectedIds(slide, additions).size, 10)
  assert.equal(regenerationProtectedIds(slide, [{ semanticKey: 'e0', preserve: [] }]).has('e0'), true)
  const before = canonicalHash(document)
  const { manifest, recipe } = fixture()
  const draft = new DesignCompiler().compileSlide(manifest.samples[0].input.slides[0], { canvas: document.canvas, recipes: new RecipeRegistry([recipe]), recipeId: recipe.id })
  const options = { transactionId: 'd01', baseRevision: 'test', protectedContent: additions }
  const tx = buildRegenerateTransaction(document, draft, slide.id, options)
  assert.deepEqual(tx.operations.filter(op => op.kind === 'element.delete').map(op => op.elementId), ['e10'])
  assert.throws(() => buildRegenerateTransaction(document, draft, slide.id, { ...options, targetElementIds: ['e6'] }), /TARGET_PROTECTED/)
  assert.equal(canonicalHash(document), before)
})

test('D01 criterion 4 stale IR cannot overwrite anchored content during an Operation Engine replacement', () => {
  const { document } = makeContractDocument()
  const slide = document.slides.slide_main
  const original = cloneJson(slide.elements.text_title)
  slide.protectedAnchors = [{ target: { kind: 'element', elementId: original.id }, preserve: ['content'] }]
  const { manifest, recipe } = fixture()
  const ir = manifest.samples[0].input.slides[0]
  ir.blocks[0].semanticKey = original.semanticKey
  ir.blocks[0].content = '过期 IR 企图覆盖当前内容'
  const draft = new DesignCompiler().compileSlide(ir, { canvas: document.canvas, recipes: new RecipeRegistry([recipe]), recipeId: recipe.id })
  const session = new PpteSession(document)
  const tx = buildRegenerateTransaction(document, draft, slide.id, { transactionId: 'd01-stale', baseRevision: session.getRevision(), requireConfirmation: false, targetElementIds: [original.id], protectedContent: [] })
  const inserted = tx.operations.find(op => op.kind === 'element.insert')
  assert.ok(inserted?.kind === 'element.insert')
  assert.deepEqual({ ...inserted.element, id: original.id, provenance: original.provenance }, { ...original, provenance: original.provenance })
  const committed = session.commit(tx)
  assert.equal(committed.ok, true, JSON.stringify(committed.issues))
  const current = session.getDocument().slides.slide_main.elements[inserted.element.id]
  assert.equal(current.type, 'text')
  if (current.type === 'text' && original.type === 'text') assert.deepEqual(current.content, original.content)
  assert.equal(session.undo().ok, true)
  assert.deepEqual(session.getDocument(), document)
})

test('D01 schemas validate examples with the real JSON Schema validator and reject executable/double content fields', () => {
  const result = spawnSync('python', ['-c', `
import json, pathlib
from jsonschema import Draft202012Validator, RefResolver
root=pathlib.Path('schemas').resolve()
def validator(name):
 s=json.load(open(root/name)); Draft202012Validator.check_schema(s)
 store={}
 for path in root.glob('*.schema.json'):
  item=json.load(open(path)); store[item.get('$id',path.as_uri())]=item
  store['https://ppte.dev/schemas/1.0/'+path.name]=item
 return Draft202012Validator(s, resolver=RefResolver(root.as_uri()+'/',s,store=store))
v=json.load(open('tests/fixtures/design-system/contracts.json'))
for name,key in [('style-pack.schema.json','style'),('recipe-manifest.schema.json','manifest')]:
 check=validator(name); check.validate(v[key])
 for bad in ['script','css','slots','content']:
  assert not check.is_valid(dict(v[key],**{bad:[]}))
 assert not check.is_valid(dict(v[key],contractVersion='0'))
b=validator('style-pack.schema.json')
s=b.schema['$defs']['brandSpec']
Draft202012Validator(s,resolver=b.resolver).validate(v['brand'])
check=validator('recipe-manifest.schema.json')
params=Draft202012Validator(check.schema['$defs']['parameters'])
params.validate({'columns':3,'imageSide':'left'})
for bad in [{'columns':4},{'columns':'2'},{'css':'display:none'},{'/content':[]}]:
 assert not params.is_valid(bad)
v['manifest']['controls'][0]['default']=4
assert not check.is_valid(v['manifest'])
`], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})
