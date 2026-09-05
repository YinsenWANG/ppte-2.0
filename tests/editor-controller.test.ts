import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { EditorController, planTransaction, beginDrag, updateDrag, endDrag } from '../packages/editor-controller/src/index.js'
import { endDrag as legacyEndDrag } from '../packages/editor-react/src/interaction.js'
import { PortableRuntime } from '../packages/portable-runtime/src/shared.js'
import type { Transaction } from '../packages/schema/src/index.js'

function setup(locked = false) {
  const { document } = makeContractDocument()
  if (locked) document.slides.slide_main.elements.image_hero.locked = true
  const session = new PpteSession(document, {runtimeProfile:"ga-c"})
  const controller = new EditorController(session)
  return { document, session, controller }
}
function move(session: Pick<PpteSession, 'getDocument' | 'getRevision'>, id = 'move'): Transaction {
  return endDrag(updateDrag(beginDrag(session.getDocument(), session.getRevision(), 'slide_main', 'image_hero', {x:0,y:0}), {x:10,y:0}), id, '2026-09-06T00:00:00.000Z')!
}

test('E01 pure planners bundle for a platform without DOM, React or filesystem and preserve the interaction facade', async () => {
  const result = await build({ entryPoints: ['packages/editor-controller/src/index.ts'], bundle: true, platform: 'neutral', write: false, metafile: true })
  for (const file of Object.keys(result.metafile!.inputs)) {
    const source = readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /from\s+['"](?:react|node:fs|node:path)|\b(?:HTMLElement|window|document\.querySelector)\b/)
  }
  assert.equal(legacyEndDrag, endDrag)
  const { session } = setup()
  const tx = move(session)
  const planned = planTransaction({document:session.getDocument(),revision:session.getRevision()},tx)!
  assert.deepEqual(planned, tx)
  assert.notEqual(planned, tx)
  assert.equal(session.getHistory().length, 0)
  assert.equal(session.commit(planned).ok, true)
})

test('E01 Host/Portable/CLI planners share Core revision, scope, lock guards and history', (t) => {
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-06T00:00:00Z')})
  for (const locked of [false, true]) {
    const { document, session, controller } = setup(locked)
    const portable = new PortableRuntime(document, {profile:'full-portable'})
    const tx = move(session)
    const expected = session.preview(tx)
    const hostResult = controller.commit(tx)
    const portableResult = portable.commit(tx)
    assert.equal(hostResult.ok, !locked)
    assert.equal(hostResult.ok, expected.ok)
    assert.equal(portableResult.ok, hostResult.ok)
    assert.deepEqual(portable.getDocument(), session.getDocument())
    if (!locked) {
      assert.equal(controller.commit(tx).status, 'conflict')
      assert.equal(portable.commit(tx).ok, false)
      assert.equal(controller.undo().ok, true)
      assert.equal(portable.undo().ok, true)
      assert.deepEqual(portable.getDocument(), document)
      assert.equal(controller.redo().ok, true)
      assert.equal(portable.redo().ok, true)
      assert.deepEqual(portable.getHistory(), session.getHistory().map(e=>e.transaction))
      const narrowed = move(session, 'outside-scope')
      narrowed.scope.elementIds = ['text_body']
      assert.equal(controller.commit(narrowed).ok, false)
      assert.equal(portable.commit(narrowed).ok, false)
    }
    controller.dispose(); portable.dispose()
  }
})

test('E01 policy applies to preview, registered commands, facades and history in readonly modes', async () => {
  const { document, session } = setup()
  const tx = move(session)
  for (const profile of ['viewer','quick-fix'] as const) {
    const c = new EditorController(new PpteSession(document), profile)
    assert.equal(c.preview(tx).ok, false)
    assert.equal(c.commit(tx).ok, false)
    c.registry.register('move', planTransaction)
    assert.equal((await c.execute({kind:'registered',name:'move',input:tx})).ok, false)
    c.dispose()
  }
  const c = new EditorController(session)
  c.presentation.enter(() => ({ok:true}))
  assert.equal(c.preview(tx).ok, false)
  assert.equal(c.commit(tx).ok, false)
  assert.equal(c.undo().ok, false)
  assert.equal(c.redo().ok, false)
  assert.equal(session.getHistory().length, 0)
})

test('E01 a mixed locked selection is rejected atomically including unlocked members', () => {
  const { document } = setup()
  document.slides.slide_main.elements.text_body.locked = true
  const session = new PpteSession(document, {runtimeProfile:"ga-c"})
  const c = new EditorController(session)
  const tx = move(session)
  tx.scope.elementIds!.push('text_body')
  tx.changeContract.allowedElementIds = ['image_hero', 'text_body']
  tx.changeContract.maxChangedElements = 2
  tx.operations.push({opId:'locked',kind:'element.move',slideId:'slide_main',elementId:'text_body',x:100,y:100})
  assert.equal(c.commit(tx).ok, false)
  assert.deepEqual(session.getDocument(), document)
  assert.equal(session.getHistory().length, 0)
})

test('E01 one command queue deduplicates in-flight draft epochs and blocks reentrant facade writes', async () => {
  const { session, controller } = setup()
  controller.setDraft(move(session))
  const first = controller.flush('blur')
  assert.equal(first, controller.flush('save'))
  assert.equal(controller.commit(move(session,'racing')).issues[0].code, 'COMMAND_BUSY')
  let reentrant = ''
  controller.subscribe(e => { if (e.type === 'committed') reentrant = controller.commit(move(session,'nested')).issues[0].code })
  assert.equal((await first).ok, true)
  assert.equal(reentrant, 'COMMAND_BUSY')
  assert.equal(session.getHistory().length, 1)
  assert.equal(controller.getState().draft, undefined)
  assert.equal((await controller.flush()).status, 'no-op')
  assert.equal((await controller.execute({kind:'undo'})).ok, true)
  assert.equal(session.getHistory().length, 0)
})

test('E01 failed/composing/stale drafts retain input and prevent dependent undo, save, page and mode effects', async () => {
  for (const failure of ['composition','stale','lock'] as const) {
    const { session, controller } = setup(failure === 'lock')
    const tx = move(session)
    if (failure === 'stale') tx.baseRevision = 'stale'
    const epoch = controller.setDraft(tx, failure === 'composition')
    let effects = 0
    assert.equal((await controller.flush()).ok, false)
    assert.equal((await controller.execute({kind:'undo'})).ok, false)
    for (let i=0;i<3;i++) assert.equal((await controller.boundary(() => {effects++;controller.presentation.enter(()=>({ok:true}))})).ok, false)
    assert.equal(effects, 0)
    assert.equal(controller.presentation.canMutate, true)
    assert.equal(controller.getState().draft?.epoch, epoch)
    assert.deepEqual(controller.getState().draft?.transaction, tx)
    assert.equal(session.getHistory().length, 0)
  }
})

test('E01 replacing or cancelling an epoch cannot commit an obsolete flush', async () => {
  const { session, controller } = setup()
  controller.setDraft(move(session, 'old'))
  const old = controller.flush()
  controller.setDraft(move(session, 'new'))
  assert.equal((await old).status, 'cancelled')
  assert.equal(session.getHistory().length, 0)
  assert.equal((await controller.flush()).ok, true)
  assert.equal(session.getHistory()[0].transaction.transactionId, 'new')
  controller.setDraft(move(session,'cancelled'))
  const pending = controller.flush()
  controller.cancelTransient()
  assert.equal((await pending).ok, false)
  assert.equal(session.getHistory().length, 1)
})

test('E01 disposal releases subscriptions/resources/transients and cancels queued work', async () => {
  const { session, controller } = setup()
  let events = 0, released = 0
  controller.subscribe(()=>events++)
  controller.own(()=>released++)
  controller.own(()=>{ throw Error('cleanup failed') })
  controller.own(()=>released++)
  controller.setSelection({slideId:'slide_main',elementIds:['image_hero']})
  controller.setDraft(move(session))
  const pending = controller.flush()
  controller.dispose(); controller.dispose()
  assert.equal((await pending).ok, false)
  assert.equal(released, 2)
  assert.equal(controller.getState().selection, undefined)
  assert.equal(controller.getState().draft, undefined)
  assert.equal(controller.commit(move(session)).ok, false)
  assert.equal(session.commit(move(session)).ok, true)
  assert.equal(events, 0)
})

test('E01 legacy synchronous draft boundary blocks undo and retains drafts on failures', () => {
  const { session, controller } = setup()
  let attempts = 0
  controller.setFlushHandler(()=>{attempts++;return {ok:false}})
  assert.equal(controller.undo().ok, false)
  assert.equal(attempts,1)
  let pending = true
  controller.setFlushHandler(()=>{
    if (!pending) return {ok:true}
    const result = controller.commit(move(session))
    if (result.ok) pending = false
    return result
  })
  assert.equal(controller.undo().ok,true)
  assert.equal(pending,false)
  assert.equal(session.getHistory().length,0)
  assert.equal(session.getRedoHistory().length,1)
})

test('E01 shared text planner preserves semantic runs and rejects stale input from either facade', async () => {
  const { ImeTextEditSession, editRichText } = await import('../packages/richtext-adapter/src/index.js')
  const { document, session, controller } = setup()
  const element = document.slides.slide_main.elements.text_body
  assert.equal(element.type, 'text')
  if (element.type !== 'text') throw Error('fixture')
  const editor = new ImeTextEditSession(element, 'slide_main', session.getRevision())
  const content = editRichText(element.content, 'Updated')
  editor.input(content)
  const tx = editor.finish('text',session.getRevision())!
  const portable = new PortableRuntime(document,{profile:'full-portable'})
  assert.equal(controller.commit(tx).ok,true)
  assert.equal(portable.editText({elementId:'text_body'},'Updated').ok,true)
  assert.deepEqual(portable.getDocument(),session.getDocument())
  assert.equal(portable.undo().ok,true)
  assert.equal(controller.undo().ok,true)
  assert.deepEqual(portable.getDocument(),document)
  const draftRevision = session.getRevision()
  const stale = new ImeTextEditSession(element,'slide_main',draftRevision)
  stale.input(content)
  assert.equal(controller.commit(move(session)).ok,true)
  const staleTx = stale.finish('stale',session.getRevision())!
  assert.equal(staleTx.baseRevision,draftRevision)
  assert.equal(controller.commit(staleTx).status,'conflict')
  assert.equal(portable.editText({elementId:'text_body'},'Changed').ok,true)
  assert.equal(portable.editText({elementId:'text_body'},'Updated',draftRevision).ok,false)
  assert.deepEqual(stale.getLocalContent(),content)
})

test('E01 DOM resources release listeners and handles once, including registration after disposal', async () => {
  const { DomResources } = await import('../packages/editor-dom/src/index.js')
  const resources = new DomResources()
  const target = new EventTarget()
  let events = 0, released = 0
  resources.listen(target,'click',()=>events++)
  resources.own(()=>released++)
  target.dispatchEvent(new Event('click'))
  resources.dispose(); resources.dispose()
  target.dispatchEvent(new Event('click'))
  resources.own(()=>released++)
  assert.equal(events,1)
  assert.equal(released,2)
})

test('E01 flush then undo annotates the journal at each actual Core write', () => {
  const { document } = setup()
  let action = ''
  const writes: string[] = []
  const session = new PpteSession(document,{journal:{append:()=>{writes.push(action)}}})
  const c = new EditorController(session,'host',undefined,value=>{action=value})
  c.setDraft(move(session))
  assert.equal(c.undo().ok,true)
  assert.deepEqual(writes,['commit','undo'])
  assert.equal(c.redo().ok,true)
  assert.deepEqual(writes,['commit','undo','redo'])
})

test('E01 asynchronous save boundaries hold the queue and report failures without running dependent effects', async () => {
  const { session, controller } = setup()
  let release!: () => void
  const gate = new Promise<void>(resolve => {release=resolve})
  const order: string[] = []
  const save = controller.boundary(async()=>{order.push('saving');await gate;order.push('saved')})
  const edit = controller.execute({kind:'commit',transaction:move(session)})
  await Promise.resolve()
  assert.deepEqual(order,['saving'])
  assert.equal(session.getHistory().length,0)
  assert.equal(controller.commit(move(session,'race')).issues[0].code,'COMMAND_BUSY')
  release()
  assert.equal((await save).ok,true)
  assert.equal((await edit).ok,true)
  assert.deepEqual(order,['saving','saved'])
  assert.equal((await controller.boundary(async()=>{throw Error('disk failed')})).issues[0].code,'BOUNDARY_FAILED')
})
