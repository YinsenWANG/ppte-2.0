import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalRevision, cloneJson } from '../packages/canonical-json/src/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { MockAgent } from '../packages/agent-tools/src/index.js'
import { applyOperation } from '../packages/operations/src/index.js'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import type { Operation, TextElement, Transaction } from '../packages/schema/src/index.js'

function text(value: string, id = 'p'): { paragraphs: [{ id: string; runs: [{ id: string; text: string }] }] } {
  return { paragraphs: [{ id, runs: [{ id: `${id}-r`, text: value }] }] }
}

test('human move, agent text replacement, structural diff, undo, and redo share one engine', () => {
  const { document } = makeContractDocument()
  const session = new PpteSession(document)
  const originalRevision = session.getRevision()
  const move: Transaction = {
    transactionId: 'tx-move',
    baseRevision: originalRevision,
    actor: { type: 'human', id: 'test' },
    scope: { kind: 'selection', slideIds: ['slide_main'], elementIds: ['image_hero'], permissions: ['geometry'], allowInsert: false, allowDelete: false },
    changeContract: { allowedOperationKinds: ['element.move'], allowedElementIds: ['image_hero'], maxChangedSlides: 1, maxChangedElements: 1, preserve: { content: 'preserve', style: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' } },
    createdAt: '2026-09-02T00:00:00Z',
    operations: [{ opId: 'op-move', kind: 'element.move', slideId: 'slide_main', elementId: 'image_hero', x: 1230, y: 300 }],
  }
  const moveResult = session.commit(move)
  assert.equal(moveResult.ok, true)
  assert.equal(moveResult.diff?.mutationSummary.changedElements, 1)
  const afterMove = session.getRevision()

  const agent = new MockAgent()
  const agentTx = agent.createTextReplaceTransaction(session.getDocument(), afterMove, 'slide_main', 'text_title', text('A cautious review'), 'tx-agent')
  const preview = session.preview(agentTx)
  assert.equal(preview.ok, true)
  assert.ok(preview.diff?.changedPaths.some((path) => path.includes('/content')))
  const commit = session.commit(agentTx)
  assert.equal(commit.ok, true)
  assert.equal(commit.diff?.mutationSummary.changedElements, 1)
  const agentRevision = session.getRevision()
  assert.equal(session.undo().ok, true)
  assert.equal(session.getDocument().slides.slide_main.elements.image_hero.frame.x, 1230)
  assert.equal(session.redo().ok, true)
  assert.equal(session.getRevision(), agentRevision)
  assert.notEqual(originalRevision, agentRevision)
})

test('Change Contract rejects a second object before commit and preserves the snapshot', () => {
  const { document } = makeContractDocument()
  const session = new PpteSession(document)
  const agent = new MockAgent()
  const tx = agent.createOutOfScopeTextTransaction(session.getDocument(), session.getRevision(), 'slide_main', 'text_title', 'text_body', text('same content'), 'tx-bad')
  const before = session.getRevision()
  const result = session.preview(tx)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((issue) => issue.code === 'SCOPE_VIOLATION'))
  assert.equal(session.getRevision(), before)
  assert.equal((session.getDocument().slides.slide_main.elements.text_body as TextElement).content.paragraphs[0].runs[0].text, 'Text, image, and shape use one semantic document.')
})

test('flat group move and resize materialize member frames without changing text style', () => {
  const { document } = makeContractDocument()
  const session = new PpteSession(document)
  const base = session.getRevision()
  const groupTx: Transaction = {
    transactionId: 'tx-group',
    baseRevision: base,
    actor: { type: 'human' },
    scope: { kind: 'slide', slideIds: ['slide_main'], permissions: ['structure'], allowInsert: false, allowDelete: false },
    changeContract: { allowedOperationKinds: ['group.create'], maxChangedSlides: 1, maxChangedElements: 2, preserve: { content: 'preserve', geometry: 'preserve', style: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' } },
    createdAt: '2026-09-02T00:00:00Z',
    operations: [{ opId: 'op-group', kind: 'group.create', slideId: 'slide_main', group: { id: 'group_cards', memberIds: ['text_body', 'image_hero'] } }],
  }
  assert.equal(session.commit(groupTx).ok, true)
  const beforeStyle = cloneJson((session.getDocument().slides.slide_main.elements.text_body as TextElement).style)
  const beforeMove = session.getDocument().slides.slide_main.elements.image_hero.frame
  const moveTx: Transaction = {
    transactionId: 'tx-group-move',
    baseRevision: session.getRevision(),
    actor: { type: 'human' },
    scope: { kind: 'slide', slideIds: ['slide_main'], permissions: ['geometry'], allowInsert: false, allowDelete: false },
    changeContract: { allowedOperationKinds: ['group.move'], maxChangedSlides: 1, maxChangedElements: 2, preserve: { content: 'preserve', style: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' } },
    createdAt: '2026-09-02T00:00:00Z',
    operations: [{ opId: 'op-group-move', kind: 'group.move', slideId: 'slide_main', groupId: 'group_cards', dx: 10, dy: 20 }],
  }
  assert.equal(session.commit(moveTx).ok, true)
  assert.equal(session.getDocument().slides.slide_main.elements.image_hero.frame.x, beforeMove.x + 10)
  assert.deepEqual((session.getDocument().slides.slide_main.elements.text_body as TextElement).style, beforeStyle)
  assert.equal(session.undo().ok, true)
  assert.equal(session.getDocument().slides.slide_main.elements.image_hero.frame.x, beforeMove.x)
})

test('operation inverse restores a text replacement and stale base is a conflict', () => {
  const { document } = makeContractDocument()
  const session = new PpteSession(document)
  const original = session.getDocument()
  const operation: Operation = { opId: 'op-text', kind: 'text.replaceContent', slideId: 'slide_main', elementId: 'text_title', content: text('Changed') }
  const applied = applyOperation(original, operation)
  const restored = applyOperation(applied.document, applied.inverse[0])
  assert.equal(canonicalRevision(restored.document), canonicalRevision(original))
  const agent = new MockAgent()
  const stale = agent.createTextReplaceTransaction(session.getDocument(), 'sha256-stale', 'slide_main', 'text_title', text('Nope'), 'tx-stale')
  const result = session.preview(stale)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((issue) => issue.code === 'REVISION_CONFLICT'))
})
