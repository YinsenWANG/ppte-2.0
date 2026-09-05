import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { canonicalRevision } from '../packages/canonical-json/src/index.js'
import { applyOperation } from '../packages/operations/src/index.js'
import { buildCheckpointBytes, openCheckpointBytes } from '../packages/file-format/src/index.js'
import { buildPortableCheckpointBytes } from '../packages/portable-runtime/src/shared.js'
import { inferCompatibilityProfile, requiresEditProtocol } from '../packages/compatibility/src/index.js'
import { PPTE_EDIT_COMPATIBILITY_PROFILE, type Operation, type Transaction } from '../packages/schema/src/index.js'
import { readJournal, replayJournal } from '../packages/recovery-journal/src/index.js'
import { createPatch } from '../packages/reviewer/src/index.js'
import { applyPatchToDocument, encodePatch, decodePatch, validatePatch } from '../packages/patch-format/src/codec.js'
import { openFileSession } from '../packages/node-runtime/src/index.js'
import { writeCheckpoint, openCheckpoint } from '../packages/file-format/src/index.js'

function transaction(session: PpteSession, operation: Operation): Transaction {
  return { transactionId: `tx-${operation.opId}`, baseRevision: session.getRevision(), actor: { type: 'human', id: 'test' }, scope: { kind: 'document', permissions: ['structure', 'style', 'content', 'geometry'], allowInsert: false, allowDelete: false }, changeContract: { allowedOperationKinds: [operation.kind], maxChangedSlides: 1 }, createdAt: '2026-09-05T00:00:00Z', operations: [operation] }
}

test('absent background survives serialized inverse, both checkpoint writers and redo-only history', () => {
  const { document, imageBytes } = makeContractDocument()
  delete document.slides.slide_main.background
  const before = canonicalRevision(document)
  const session = new PpteSession(document)
  const result = session.commit(transaction(session, { opId: 'background', kind: 'slide.update', slideId: 'slide_main', patch: { background: { kind: 'solid', color: { kind: 'value', value: '#112233' } } } }))
  assert.equal(result.ok, true, JSON.stringify(result.issues))
  assert.deepEqual(result.inverseTransaction?.operations[0], { opId: result.inverseTransaction?.operations[0]?.opId, kind: 'slide.update', slideId: 'slide_main', patch: {}, unset: ['background'] })
  const options = { recentTransactions: session.getHistory().map(entry => entry.transaction), assetBytes: { asset_pixel: imageBytes } }
  for (const write of [buildCheckpointBytes, buildPortableCheckpointBytes]) {
    const opened = openCheckpointBytes(write(session.getDocument(), options))
    assert.equal(opened.manifest.operationProtocolVersion, '1.1')
    assert.equal(opened.manifest.compatibilityProfile, PPTE_EDIT_COMPATIBILITY_PROFILE)
    const restored = new PpteSession(opened.document)
    assert.equal(restored.undo().ok, true)
    assert.equal(restored.getRevision(), before)
    const redo = [...restored.getRedoHistory()]
    const redoOpened = openCheckpointBytes(write(restored.getDocument(), { ...options, recentTransactions: [], redoHistory: redo }))
    assert.equal(redoOpened.manifest.operationProtocolVersion, '1.1')
    const redoSession = new PpteSession(redoOpened.document)
    assert.equal(redoSession.redo().ok, true)
    assert.equal(redoSession.getRevision(), session.getRevision())
    assert.throws(() => write(session.getDocument(), { ...options, compatibilityProfile: inferCompatibilityProfile(document) }), /requires compatibility profile/)
  }
})

test('metadata presence is preserved through fixed-seed set/unset sequences', () => {
  const { document } = makeContractDocument()
  let current = document
  const inverse: Operation[][] = []
  let seed = 729
  for (let i = 0; i < 100; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const key = seed % 2 ? 'name' : 'hidden'
    const operation: Operation = { opId: String(i), kind: 'slide.update', slideId: 'slide_main', patch: seed % 3 ? { [key]: key === 'name' ? `Slide ${i}` : i % 2 === 0 } : {}, ...(seed % 3 ? {} : { unset: [key] }) }
    const result = applyOperation(current, operation)
    current = result.document
    inverse.push(JSON.parse(JSON.stringify(result.inverse)))
  }
  for (const operations of inverse.reverse()) for (const operation of operations) current = applyOperation(current, operation).document
  assert.equal(canonicalRevision(current), canonicalRevision(document))
})

test('unset rejects structure, duplicates, overlapping fields and out-of-scope changes without writes', () => {
  const { document } = makeContractDocument()
  let writes = 0
  const session = new PpteSession(document, { journal: { append() { writes++ } } })
  const before = session.getRevision()
  for (const unset of [['id'], ['elements'], ['background', 'background'], ['background']]) {
    const op: Operation = { opId: 'invalid', kind: 'slide.update', slideId: 'slide_main', patch: { background: { kind: 'none' } }, unset }
    assert.equal(session.commit(transaction(session, op)).ok, false)
  }
  const tx = transaction(session, { opId: 'scope', kind: 'slide.update', slideId: 'slide_main', patch: {}, unset: ['background'] })
  tx.scope = { kind: 'selection', slideIds: ['another-slide'], permissions: ['style'], allowInsert: false, allowDelete: false }
  assert.equal(session.commit(tx).ok, false)
  assert.equal(session.getRevision(), before)
  assert.equal(session.getHistory().length, 0)
  assert.equal(writes, 0)
  assert.equal(requiresEditProtocol({ operations: tx.operations }), true)
})

test('background removal survives review patch serialization and rejects a downgraded protocol', () => {
  const { document } = makeContractDocument()
  document.slides.slide_main.background = { kind: 'solid', color: { kind: 'value', value: '#112233' } }
  const revised = structuredClone(document)
  delete revised.slides.slide_main.background
  const patch = createPatch(document, revised)
  assert.equal(patch.manifest.operationProtocolVersion, '1.1')
  const decoded = decodePatch(encodePatch(patch))
  const applied = applyPatchToDocument(document, decoded)
  assert.equal(applied.ok, true, JSON.stringify(applied.issues))
  assert.equal(canonicalRevision(applied.document!), canonicalRevision(revised))
  const old = structuredClone(patch)
  old.manifest.operationProtocolVersion = '1.0'
  old.manifest.compatibilityProfile = inferCompatibilityProfile(document)
  assert.equal(validatePatch(old).ok, false)
})

test('new protocol journal upgrades atomically and node session checkpoints infer persisted history', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ppte-unset-'))
  try {
    const { document, imageBytes } = makeContractDocument()
    delete document.slides.slide_main.background
    const path = join(directory, 'deck.ppte')
    writeCheckpoint(document, path, { assetBytes: { asset_pixel: imageBytes } })
    const opened = openFileSession(path)
    const result = opened.session.commit(transaction(opened.session, { opId: 'node-bg', kind: 'slide.update', slideId: 'slide_main', patch: { background: { kind: 'none' } } }))
    assert.equal(result.ok, true, JSON.stringify(result.issues))
    const journal = readJournal(`${path}.journal`)
    assert.equal(journal.complete, true)
    assert.equal(journal.header?.journalVersion, '2')
    assert.equal(replayJournal(document, journal).revision, opened.session.getRevision())
    const saved = opened.session.checkpoint(path)
    assert.equal(saved.ok, true, JSON.stringify(saved.issues))
    const restored = new PpteSession(openCheckpoint(path).document)
    assert.equal(restored.undo().ok, true)
    assert.equal(restored.getRevision(), canonicalRevision(document))
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('lossy floating-point inverse is rejected before the recovery journal or document changes', () => {
  const { document } = makeContractDocument()
  document.slides.slide_main.groups = { stress: { id: 'stress', memberIds: ['text_title', 'image_hero'] } }
  let writes = 0
  const session = new PpteSession(document, { journal: { append() { writes++ } } })
  const before = session.getRevision()
  const result = session.commit(transaction(session, { opId: 'lossy', kind: 'group.move', slideId: 'slide_main', groupId: 'stress', dx: 1e20, dy: 0 }))
  assert.equal(result.ok, false)
  assert.ok(result.issues.some(issue => issue.code === 'INVERSE_ROUNDTRIP_FAILED'), JSON.stringify(result.issues))
  assert.equal(session.getRevision(), before)
  assert.equal(writes, 0)
})
