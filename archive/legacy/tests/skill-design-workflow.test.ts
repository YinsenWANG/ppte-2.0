import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { runCli } from '../apps/cli/index.js'
import { designPackSample } from '../packages/layout-recipes/src/design-packs.js'
import { template, visualBytes, fontBytes } from './helpers/design-pack-fixtures.js'
import { openCheckpoint } from '../packages/file-format/src/index.js'
import { canonicalRevision } from '../packages/canonical-json/src/index.js'

function material() {
  const doc = template('business')
  return { style: 'business', usage: 'present', stage: 'representatives', representativeKeys: { cover: 'business.cover.normal', body: 'business.explanation.normal', data: 'business.metrics.normal' }, input: {
    presentation: { irVersion: '1.0', title: 'Fixed synthetic design brief', narrative: [], slides: ['cover','explanation','metrics','closing'].map(role => designPackSample('business', role as 'cover', 'normal')) },
    assets: doc.assets, fonts: doc.fonts,
    assetBytes: { asset_design_visual: visualBytes().toString('base64') }, fontBytes: { font_design: fontBytes().toString('base64') },
  } }
}
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'ppte-d06-'))
  const file = (name: string) => join(dir, name)
  const save = (name: string, data: unknown) => { writeFileSync(file(name), JSON.stringify(data)); return file(name) }
  return { dir, file, save, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('D06 A19 help and schema register all executable design commands and retain legacy tools', async () => {
  const help = runCli(['--help']).help
  const schemas = runCli(['schema', 'design']).commands
  for (const name of ['list','inspect','plan','preview','apply','validate']) {
    assert.match(help, new RegExp(`ppte design ${name}`))
    assert.equal(schemas[name].type, 'object')
  }
  for (const name of ['compile', 'preview', 'commit', 'deliver', 'undo', 'skill-install']) assert.ok(help.includes(`ppte ${name}`))
  assert.ok(runCli(['schema']).tools.apply_layout_recipe)
  assert.deepEqual(runCli(['schema']).commands.design, schemas)
  assert.throws(() => runCli(['design', 'unknown']), /DESIGN_COMMAND_UNKNOWN/)
  assert.throws(() => runCli(['design', 'list', '--limit', '4']), /DESIGN_LIMIT_INVALID/)
  assert.throws(() => runCli(['design', 'inspect', 'unknown']), /DESIGN_STYLE_UNKNOWN/)
})

test('D06 A15 fixed material: index → bounded candidates → selected recipes → representatives → full deck via Core', async () => {
  const box = sandbox()
  try {
    const listed = runCli(['design', 'list'])
    assert.equal(listed.index.length, 4)
    assert.equal(listed.candidates.length, 3)
    assert.ok(!JSON.stringify(listed).includes('zones'))
    assert.equal(runCli(['design','list','--query','business','--limit','1']).candidates[0].id, 'business')
    const selected = runCli(['design','inspect',listed.candidates[0].id])
    assert.equal(selected.pack.id, 'business')
    assert.equal(selected.recipes.length, 8)
    assert.ok(selected.recipes.every((r: any) => r.id.startsWith('business.') && r.zones.length))
    const input = material()
    for (const stage of ['representatives', 'deck']) {
      const project = box.file(`${stage}.ppte`)
      assert.equal(runCli(['new',project]).ok, true)
      const before = readFileSync(project)
      const args = box.save(`${stage}.json`, { ...input, stage })
      const planPath = box.file(`${stage}.plan.json`)
      const plan = await runCli(['design','plan',project,'--args',args,'--out',planPath])
      assert.equal(plan.ok, true, JSON.stringify(plan.report))
      assert.equal(plan.plan.selections.length, stage === 'deck' ? 4 : 3)
      assert.equal(plan.report.visualStatus, 'unverified')
      assert.equal(plan.report.officeStatus, 'unverified')
      assert.ok(plan.report.evaluations <= plan.report.budget.maxEvaluations)
      assert.deepEqual(readFileSync(project), before)
      const receipt = box.file(`${stage}.review.json`)
      const preview = runCli(['design','preview',project,'--plan',planPath,'--out',receipt])
      assert.equal(preview.ok, true, JSON.stringify(preview))
      assert.deepEqual(readFileSync(project), before)
      assert.equal(runCli(['design','apply',project,'--preview',receipt]).ok, true)
      const doc = openCheckpoint(project, { recovery: 'ignore' }).document
      assert.equal(doc.slideOrder.length, stage === 'deck' ? 4 : 3)
      for (const source of input.input.presentation.slides.filter(s => stage === 'deck' || Object.values(input.representativeKeys).includes(s.slideKey))) {
        for (const block of source.blocks) assert.ok(JSON.stringify(doc).includes(block.semanticKey!), block.key)
      }
      assert.ok(JSON.stringify(doc).includes('42%'))
      assert.equal(doc.assets.asset_design_visual.hash, input.input.assets.asset_design_visual.hash)
      if (stage === 'representatives') {
        for (const slideId of doc.slideOrder) {
          const png = box.file(`${slideId}.png`)
          const rendered = runCli(['export',project,'--format','png','--slide',slideId,'--out',png])
          assert.equal(rendered.ok, true, JSON.stringify(rendered))
          assert.equal(readFileSync(png).subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
        }
      }
      const checked = runCli(['design','validate',project])
      assert.equal(checked.ok, true)
      assert.equal(checked.visualStatus, 'unverified')
      assert.equal(checked.officeStatus, 'unverified')
      assert.equal(checked.revision, canonicalRevision(doc))
      await assert.rejects(async () => runCli(['design','plan',project,'--args',args,'--out',box.file('bad.json')]), /DESIGN_EXISTING_CONTENT/)
      const delivered = runCli(['deliver',project])
      assert.equal(delivered.ok, true, JSON.stringify(delivered))
      const audited = runCli(['design','validate',project,'--artifact',delivered.artifacts.find((a: any) => a.primary).path])
      assert.equal(audited.ok, true, JSON.stringify(audited))
      assert.ok(audited.artifactIdentity.digest)
      assert.equal(audited.visualStatus, 'unverified')
    }
  } finally { box.cleanup() }
})

test('D06 A15 A17 two local repair rounds preserve preview semantics; third round and failed plans cannot apply', async () => {
  const box = sandbox()
  try {
    const project = box.file('deck.ppte'); runCli(['new',project])
    const planPath = box.file('plan.json')
    const plan = await runCli(['design','plan',project,'--args',box.save('input.json',material()),'--out',planPath])
    assert.equal(plan.ok, true)
    const repaired = box.file('repair.ppte'); runCli(['new',repaired])
    const repairPlanPath = box.file('repair.plan.json')
    await runCli(['design','plan',repaired,'--args',box.file('input.json'),'--out',repairPlanPath])
    const initialReview = box.file('initial.review.json')
    runCli(['design','preview',repaired,'--plan',repairPlanPath,'--out',initialReview])
    assert.equal(runCli(['design','apply',repaired,'--preview',initialReview]).ok, true)
    const delivered = runCli(['deliver',repaired])
    const artifact = delivered.artifacts.find((a: any) => a.primary).path
    for (const round of [1,2]) {
      const before = openCheckpoint(repaired, { recovery: 'ignore' }).document
      const slideId = before.slideOrder[0], elementId = before.slides[slideId].rootOrder[0]
      const element = before.slides[slideId].elements[elementId]
      const tx = { ...plan.transaction, transactionId: `repair-${round}`, baseRevision: canonicalRevision(before), reason: 'Adjust representative title alignment', operations: [{ opId: `move-${round}`, kind: 'element.move', slideId, elementId, x: element.frame.x + 1, y: element.frame.y }], changeContract: { ...plan.transaction.changeContract, allowedOperationKinds: ['element.move'] } }
      const review = box.file(`repair-${round}.json`)
      const preview = runCli(['design','preview',repaired,'--transaction',box.save(`tx-${round}.json`,tx),'--out',review,'--round',String(round)])
      assert.equal(preview.ok, true, JSON.stringify(preview))
      assert.equal(preview.designReview.round, round)
      assert.deepEqual(preview.designReview.changedObjectIds, [slideId, elementId])
      assert.equal(runCli(['design','apply',repaired,'--preview',review]).ok, true)
      assert.equal(runCli(['design','validate',repaired]).ok, true)
      const after = openCheckpoint(repaired, { recovery: 'ignore' }).document
      assert.deepEqual(after.slides[slideId].elements[elementId], { ...element, frame: { ...element.frame, x: element.frame.x + 1 } })
      const stale = runCli(['design','validate',repaired,'--artifact',artifact])
      assert.equal(stale.ok, false)
      assert.ok(stale.issues.some((i: any) => i.code === 'DESIGN_ARTIFACT_STALE'))
    }
    assert.throws(() => runCli(['design','preview',project,'--plan',planPath,'--out',box.file('third.json'),'--round','3']), /DESIGN_REPAIR_LIMIT/)
    const overloaded = material(); overloaded.input.presentation.slides[0].blocks[1].content = '超载内容'.repeat(500)
    const failedPath = box.file('failed.json')
    const failed = await runCli(['design','plan',project,'--args',box.save('overload.json',overloaded),'--out',failedPath])
    assert.equal(failed.ok, false)
    assert.equal(failed.report.status, 'infeasible')
    assert.equal(failed.transaction, undefined)
    assert.equal(failed.report.visualStatus, 'unverified')
    assert.throws(() => runCli(['design','preview',project,'--plan',failedPath,'--out',box.file('failed.review.json')]), /DESIGN_PLAN_FAILED/)
    assert.equal(openCheckpoint(project, { recovery: 'ignore' }).document.slideOrder.length, 1)
    const bad = material(); bad.representativeKeys.data = 'missing'
    await assert.rejects(async () => runCli(['design','plan',project,'--args',box.save('missing.json',bad),'--out',box.file('missing.plan.json')]), /DESIGN_REPRESENTATIVES_INVALID/)
  } finally { box.cleanup() }
})

test('D06 A19 native subprocess runs offline without model/MCP and reports errors with nonzero exit', () => {
  const box = sandbox()
  try {
    writeFileSync(box.file('offline.cjs'), "const deny=()=>{throw Error('NETWORK_FORBIDDEN')};require('net').Socket.prototype.connect=deny;globalThis.fetch=deny;")
    const invoke = (...args: string[]) => spawnSync(process.execPath, [resolve('dist/apps/cli/index.js'), ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: box.dir, NODE_OPTIONS: `--require=${box.file('offline.cjs')}` } })
    assert.equal(invoke('design','list').status, 0)
    const project = box.file('native.ppte'); assert.equal(invoke('new',project).status, 0)
    const args = box.save('workflow.json',material()), plan = box.file('plan.json'), receipt = box.file('review.json')
    for (const command of [ ['design','plan',project,'--args',args,'--out',plan], ['design','preview',project,'--plan',plan,'--out',receipt], ['design','apply',project,'--preview',receipt], ['design','validate',project], ['deliver',project] ]) {
      const result = invoke(...command)
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.equal(JSON.parse(result.stdout).ok, true)
    }
    const failed = invoke('design','inspect','missing')
    assert.equal(failed.status, 1)
    assert.equal(JSON.parse(failed.stdout).issues[0].code, 'DESIGN_STYLE_UNKNOWN')
    assert.equal(invoke('skill-install','--out',box.file('skill')).status, 0)
    const skill = readFileSync(box.file('skill/SKILL.md'),'utf8')
    const reference = readFileSync(box.file('skill/references/design-workflow.md'),'utf8')
    assert.match(skill, /Continue directly within existing user authorization/)
    assert.match(skill, /at most two automatic local repair rounds/)
    assert.match(reference, /No third automatic round/)
    assert.match(reference, /Office.*unverified/)
    assert.equal(invoke('skill-install','--out',box.file('skill')).status, 1)
  } finally { box.cleanup() }
})
