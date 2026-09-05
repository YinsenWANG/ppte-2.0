import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileSlide, materializeSlideDraft } from '../packages/design-compiler/src/index.js'
import { RecipeRegistry, matchBlocksToSlots, resolveRecipeZones, RECIPE_EXECUTION } from '../packages/layout-recipes/src/index.js'
import { validateRecipeSpec } from '../packages/schema/src/index.js'
import type { SlideIR, RecipeSpec, LayoutConstraint, JsonValue } from '../packages/schema/src/index.js'
const canvas = { width: 1280, height: 720 }
const block = (key: string, kind: SlideIR['blocks'][number]['kind'] = 'paragraph') => ({ key, kind, content: key, importance: 'primary' as const })
const ir = (blocks: SlideIR['blocks'] = [block('a')]): SlideIR => ({ irVersion: '1.0', slideKey: 'contract', purpose: 'custom', message: 'D02', visualStrategy: 'structured', density: 'low', blocks })
const spec = (): RecipeSpec => ({ id: 'contract', version: '1.0.0', supports: ['custom'], slots: [{ key: 'a', accepts: ['paragraph', 'heading'], required: true }], zones: [{ id: 'a', x: .1, y: .1, width: .8, height: .8 }], constraints: [] })
const compile = (s: RecipeSpec, input = ir(), variantId?: string) => compileSlide(input, { canvas, recipes: new RecipeRegistry([s]), recipeId: s.id, variantId, seed: 'fixed', fontMetricsFingerprint: 'reference-font-metrics-1' })
const errors = (draft: ReturnType<typeof compile>) => draft.validationIssues.filter(i => i.severity === 'error')

test('D02 A14 legacy cover golden remains identical apart from compiler version', () => {
  const old = JSON.parse(readFileSync('tests/fixtures/evolution/d02-legacy-compile.json', 'utf8'))
  const result = compileSlide({ ...ir([block('title', 'heading')]), slideKey: 'legacy', purpose: 'cover', message: 'Legacy', blocks: [{ ...block('title', 'heading'), content: 'Legacy' }] }, { canvas, recipeId: 'cover.split' })
  assert.equal(old.provenance.compilerVersion, 'design-compiler-1.0.0')
  assert.deepEqual(result, { ...old, provenance: { ...old.provenance, compilerVersion: 'design-compiler-1.1.0' } })
})

test('D02 A14 matching reserves restricted slots, honors required/min/max and maxChars at boundaries', () => {
  const s = spec(); s.slots = [{ key: 'a', accepts: ['heading', 'paragraph'], maxCount: 1 }, { key: 'b', accepts: ['heading'], required: true, minCount: 1, maxCount: 1 }]
  s.zones.push({ id: 'b', x: .1, y: .1, width: .3, height: .2 })
  assert.deepEqual(matchBlocksToSlots([block('heading', 'heading'), block('body')], s).assignments.map(a => a.slotKey), ['b', 'a'])
  assert.ok(matchBlocksToSlots([block('body')], s).unmatched)
  assert.ok(matchBlocksToSlots([block('h', 'heading'), block('p'), block('q')], s).unmatched)
  s.slots[0].maxChars = 1
  assert.equal(matchBlocksToSlots([block('h', 'heading'), block('p')], s).unmatched, 0)
  const failed = compile(s, ir([block('h', 'heading'), block('long')]))
  assert.equal(failed.elementDrafts.length, 0)
  assert.match(errors(failed)[0].message, /CAPACITY_EXCEEDED/)
  assert.throws(() => materializeSlideDraft(failed, 's', canvas), /RECIPE_DRAFT_REJECTED/)
  s.slots[1].minCount = 0 // required still wins
  assert.ok(matchBlocksToSlots([block('p')], s).unmatched)
})

test('D02 A14 variants apply equality predicates, reject conflicts, unknown conditions and invalid overrides', () => {
  const s = spec(); s.variants = [{ id: 'low', when: { density: 'low', purpose: 'custom', visualStrategy: 'structured' }, zoneOverrides: { a: { width: .4 } } }]
  assert.equal(compile(s).elementDrafts[0].frame.width, 512)
  assert.equal(compile(s, { ...ir(), density: 'high' }).elementDrafts[0].frame.width, 1024)
  assert.ok(errors(compile(s, { ...ir(), density: 'high' }, 'low')).length)
  s.variants.push({ id: 'other', when: { density: 'low' } })
  assert.ok(errors(compile(s)).length)
  assert.equal(errors(compile(s, ir(), 'low')).length, 0)
  for (const condition of [{ script: 'execute' }, { density: ['low'] }, { toString: 'low' }] as Array<Record<string, JsonValue>>) {
    s.variants[0].when = condition
    assert.ok(validateRecipeSpec(s).length)
  }
  s.variants = [{ id: 'edge', zoneOverrides: { a: { x: .2, width: .8 } } }]
  assert.equal(errors(compile(s)).length, 0)
  s.variants[0].zoneOverrides!.a!.width = .81
  assert.ok(errors(compile(s)).length)
  s.variants[0].zoneOverrides!.a!.id = 'renamed'
  assert.ok(validateRecipeSpec(s).length)
})

test('D02 A14 all quality rules execute with pass, boundary and failure cases', () => {
  for (const [kind, pass, fail] of [['max-elements', 1, 0], ['min-font-size', 28, 29], ['max-overflow', 1, 0]] as const) {
    const s = spec(); s.qualityRules = [{ kind, value: pass }]
    const input = kind === 'max-overflow' ? ir([{ ...block('a'), content: 'long '.repeat(700) }]) : ir()
    assert.equal(errors(compile(s, input)).length, 0, kind)
    s.qualityRules[0].value = fail
    assert.ok(errors(compile(s, input)).length, kind)
    s.qualityRules[0].value = true
    assert.ok(validateRecipeSpec(s).length, kind)
  }
  const s = spec(); s.qualityRules = [{ kind: 'required-reading-order', value: true }]
  const d = compile(s, ir([block('a'), block('b')]))
  assert.deepEqual(d.readingOrder, d.elementDrafts.map(e => e.draftId))
  d.readingOrder = []
  assert.throws(() => materializeSlideDraft(d, 's', canvas), /RECIPE_DRAFT_REJECTED/)
  s.qualityRules[0].value = false; assert.equal(errors(compile(s)).length, 0)
  s.qualityRules[0].value = 1; assert.ok(validateRecipeSpec(s).length)
})

test('D02 A14 keepTogetherWith is a capacity relation and flat groups survive materialization', () => {
  const s = spec(); s.slots[0].maxCount = 2
  const input = ir([{ ...block('a'), keepTogetherWith: ['b'] }, block('b')])
  const d = compile(s, input)
  assert.equal(errors(d).length, 0)
  assert.equal(d.groups[0].memberDraftIds.length, 2)
  assert.equal(Object.values(materializeSlideDraft(d, 's', canvas).groups!)[0].memberIds.length, 2)
  s.slots[0].maxCount = 1; assert.ok(errors(compile(s, input)).length)
  input.blocks[0].keepTogetherWith = ['missing']; assert.ok(errors(compile(s, input)).length)
  const together = spec(); together.constraints = [{ kind: 'keep-together', slotIds: ['a'] }]
  assert.equal(compile(together, ir([block('a'), block('b')])).groups.length, 1)
})

test('D02 A14 versioned repeat uses declared columns, preserves array content and stable content-key IDs', () => {
  const s = spec(); s.slots[0].repeat = { version: '1.0', maxCount: 4, columns: 4, gapX: 0, gapY: 0 }
  const input = ir(['a!', 'a_', 'c', 'd'].map(k => block(k)))
  input.blocks[2].content = ['first', 'second']
  const first = compile(s, input)
  assert.equal(errors(first).length, 0)
  assert.equal(first.elementDrafts.length, 4)
  assert.ok(first.elementDrafts.every(e => e.frame.width === 256))
  assert.equal(new Set(first.elementDrafts.map(e => e.draftId)).size, 4)
  assert.match(JSON.stringify(first.elementDrafts[2].data), /first.*second/)
  assert.deepEqual(first, compile(structuredClone(s), structuredClone(input)))
  assert.deepEqual(first.elementDrafts.map(e => e.draftId).sort(), compile(s, ir([...input.blocks].reverse())).elementDrafts.map(e => e.draftId).sort())
  assert.ok(errors(compile(s, ir([...input.blocks, block('extra')]))).length)
  s.slots[0].repeat.gapX = .5; assert.ok(errors(compile(s, input)).length)
  s.slots[0].repeat.version = '2.0' as '1.0'; assert.ok(validateRecipeSpec(s).length)
  assert.equal(RECIPE_EXECUTION.maxSearchStates, 100000)
})

test('D02 A14 constraints reject impossible final geometry without clamp and baseline explicitly rejects', () => {
  const cases: LayoutConstraint[] = [
    { kind: 'padding', zoneId: 'a', top: 1, right: 0, bottom: 0, left: 0 },
    { kind: 'min-size', slotId: 'a', width: 1 },
    { kind: 'max-size', slotId: 'a', height: 0 },
    { kind: 'avoid-region', slotId: 'a', region: { x: 0, y: 0, width: 1, height: 1 } },
    { kind: 'baseline', slotIds: ['a'] },
  ]
  for (const c of cases) { const s = spec(); s.constraints = [c]; assert.ok(errors(compile(s)).length, c.kind) }
  for (const c of [
    { kind: 'padding', zoneId: 'a', top: 0, right: 0, bottom: 0, left: 0 },
    { kind: 'min-size', slotId: 'a', width: .8 },
    { kind: 'max-size', slotId: 'a', height: .8 },
    { kind: 'aspect-ratio', slotId: 'a', ratio: 1 },
    { kind: 'safe-area', slotId: '*' },
    { kind: 'avoid-region', slotId: 'a', region: { x: 0, y: 0, width: .1, height: .1 } },
  ] as LayoutConstraint[]) { const s = spec(); s.constraints = [c]; assert.equal(errors(compile(s)).length, 0, c.kind) }
  const conflict = spec(); conflict.constraints = [{ kind: 'min-size', slotId: 'a', width: .7 }, { kind: 'max-size', slotId: 'a', width: .6 }]
  assert.ok(errors(compile(conflict)).length)
})

test('D02 A14 alignment, stack, gap and grid execute and detect capacity conflicts', () => {
  const s = spec(); s.slots.push({ key: 'b', accepts: ['heading'] }); s.zones = [{ id: 'a', x: .1, y: .1, width: .2, height: .2 }, { id: 'b', x: .4, y: .4, width: .2, height: .2 }]
  for (const c of [
    { kind: 'align', slotIds: ['a', 'b'], axis: 'y', mode: 'start' },
    { kind: 'stack', slotIds: ['a', 'b'], axis: 'horizontal', gap: 0 },
    { kind: 'gap', slotIds: ['a', 'b'], axis: 'horizontal', value: .3 },
    { kind: 'grid', slotIds: ['a', 'b'], columns: 2, gapX: 0, gapY: 0 },
  ] as LayoutConstraint[]) {
    s.constraints = [c]; const z = resolveRecipeZones(s, canvas)
    assert.ok(z.every(z => z.width > 0 && z.x + z.width <= 1))
    if (c.kind === 'align') assert.equal(z[0].y, z[1].y)
    if (c.kind === 'stack') assert.equal(z[1].x, z[0].x + z[0].width)
    if (c.kind === 'gap') assert.ok(z[1].x >= z[0].x + z[0].width + c.value)
    if (c.kind === 'grid') assert.equal(z[0].width, z[1].width)
  }
  for (const c of [
    { kind: 'stack', slotIds: ['a', 'b'], axis: 'horizontal', gap: 1 },
    { kind: 'gap', slotIds: ['a', 'b'], axis: 'horizontal', value: 1 },
    { kind: 'grid', slotIds: ['a', 'b'], columns: 2, gapX: 1, gapY: 0 },
  ] as LayoutConstraint[]) { s.constraints = [c]; assert.throws(() => resolveRecipeZones(s, canvas), /RECIPE_INFEASIBLE/) }
})

test('D02 A14 search and registry have deterministic hard budgets; unsupported syntax is rejected', () => {
  const s = spec()
  s.slots = [{ key: 'a', accepts: ['paragraph'] }, { key: 'b', accepts: ['paragraph'] }]
  s.zones.push({ id: 'b', x: .1, y: .1, width: .2, height: .2 })
  // Last relation cannot fit either slot; preceding unrestricted choices would be exponential.
  const blocks = Array.from({ length: 24 }, (_, i) => block(`b${i}`))
  blocks.push({ ...block('last', 'heading') })
  assert.equal(matchBlocksToSlots(blocks, s).failure, 'budget')
  assert.equal(errors(compile(s, ir(blocks)))[0].code, 'RECIPE_SEARCH_LIMIT')
  const registry = new RecipeRegistry([])
  for (let i = 0; i < 128; i++) registry.register({ ...spec(), id: `r${i}` })
  assert.throws(() => registry.register({ ...spec(), id: 'extra' }), /RECIPE_LIMIT/)
  assert.ok(validateRecipeSpec({ ...spec(), execute: 'arbitrary code' }).length)
  const invalid = spec(); invalid.slots[0].maxCount = 0
  assert.ok(validateRecipeSpec(invalid).length)
  assert.ok(errors(compileSlide(ir(Array.from({ length: 65 }, (_, i) => block(String(i)))), { canvas })).length)
})

test('D02 A14 registry snapshots cannot mutate execution and corrected built-ins have explicit versions', () => {
  const source = spec(), registry = new RecipeRegistry([source])
  source.zones[0].width = 0
  registry.get(source.id)!.zones[0].width = 0
  assert.equal(registry.get(source.id)!.zones[0].width, .8)
  const builtins = new RecipeRegistry()
  for (const id of ['timeline.horizontal', 'comparison.two-column', 'metrics.kpi-row']) {
    const recipe = builtins.get(id)!
    assert.equal(recipe.version, '1.1.0')
    assert.doesNotThrow(() => resolveRecipeZones(recipe, canvas))
  }
})
