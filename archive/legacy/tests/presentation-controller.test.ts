import test from 'node:test'
import assert from 'node:assert/strict'
import { PresentationController } from '../packages/editor-controller/src/presentation.js'
import { retreatPresenterState } from '../packages/portable-runtime/src/presenter-state.js'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { ImeTextEditSession, editRichText } from '../packages/richtext-adapter/src/index.js'

test('a failed draft flush never enters presentation and rejected drafts can be retried', () => {
  const controller = new PresentationController()
  assert.equal(controller.enter(() => ({ ok: false })), false)
  assert.equal(controller.canMutate, true)
  assert.throws(() => controller.enter(() => { throw new Error('composition pending') }))
  assert.equal(controller.canMutate, true)
  assert.equal(controller.enter(() => ({ ok: true })), true)
  assert.equal(controller.canMutate, false)
  controller.leave()
  assert.equal(controller.canMutate, true)
  const { document } = makeContractDocument()
  const text = document.slides.slide_main.elements.text_body
  assert.equal(text.type, 'text')
  if (text.type !== 'text') return
  const editor = new ImeTextEditSession(text, 'slide_main')
  editor.input(editRichText(text.content, 'Retained draft'))
  const first = editor.finish('first', 'r1')!
  editor.retryAfterRejectedCommit()
  const retry = editor.finish('retry', 'r2')!
  assert.deepEqual(retry.operations[0].kind, first.operations[0].kind)
  assert.equal(retry.baseRevision, 'r2')
  assert.deepEqual(editor.getLocalContent(), editRichText(text.content, 'Retained draft'))
})

test('previous from the first positive animation step returns to step zero on the same page', () => {
  const { document } = makeContractDocument()
  document.slides.slide_main.elements.text_body.appearStep = 3
  assert.deepEqual(retreatPresenterState(document, { slideIndex: 0, step: 3 }), { slideIndex: 0, step: 0 })
})
