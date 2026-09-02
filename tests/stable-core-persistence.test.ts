import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { canonicalRevision, sha256HexBytes } from '../packages/canonical-json/src/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { ContentAddressedStore, checkpointAdapter, openCheckpoint, writeCheckpoint } from '../packages/file-format/src/index.js'
import { RecoveryJournal, readJournal, replayJournal } from '../packages/recovery-journal/src/index.js'
import { MockAgent } from '../packages/agent-tools/src/index.js'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import type { Transaction } from '../packages/schema/src/index.js'

function text(value: string) {
  return { paragraphs: [{ id: 'history-p', runs: [{ id: 'history-r', text: value }] }] }
}

test('Session exposes bounded revision history and redo replays a rebased transaction', () => {
  const { document } = makeContractDocument()
  const session = new PpteSession(document, { historyLimit: 1 })
  const agent = new MockAgent()
  const first = agent.createTextReplaceTransaction(session.getDocument(), session.getRevision(), 'slide_main', 'text_title', text('First'), 'history-first')
  assert.equal(session.commit(first).ok, true)
  const second = agent.createTextReplaceTransaction(session.getDocument(), session.getRevision(), 'slide_main', 'text_title', text('Second'), 'history-second')
  assert.equal(session.commit(second).ok, true)
  assert.equal(session.getHistory().length, 1)
  assert.equal(session.getHistory()[0]?.transaction.transactionId, 'history-second')
  assert.equal(session.undo().ok, true)
  assert.equal(session.getRedoHistory().length, 1)
  assert.equal(session.redo().ok, true)
  assert.equal(session.getHistory().length, 1)
  assert.equal(session.getHistory()[0]?.transaction.transactionId, 'history-second:redo:1')
})

test('history byte policy bounds the same undo surface as the count policy', () => {
  const { document } = makeContractDocument()
  const session = new PpteSession(document, { historyBytesLimit: 1 })
  const agent = new MockAgent()
  const transaction = agent.createTextReplaceTransaction(session.getDocument(), session.getRevision(), 'slide_main', 'text_title', text('Byte bounded'), 'history-byte-bound')
  assert.equal(session.commit(transaction).ok, true)
  assert.equal(session.getHistory().length, 0)
})

test('a failed journal append does not advance the committed revision', () => {
  const { document } = makeContractDocument()
  const initialRevision = canonicalRevision(document)
  const session = new PpteSession(document, { journal: { append: () => { throw new Error('disk unavailable') } } })
  const agent = new MockAgent()
  const transaction = agent.createTextReplaceTransaction(session.getDocument(), initialRevision, 'slide_main', 'text_title', text('Not committed'), 'journal-failure')
  const result = session.commit(transaction)
  assert.equal(result.ok, false)
  assert.equal(session.getRevision(), initialRevision)
  assert.equal(session.getSaveState(), 'readonly-recovery')
  assert.equal(session.getHistory().length, 0)
})

test('journal records result revisions and refuses a mismatched tail', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ppte-journal-contract-'))
  const path = join(directory, 'recovery.journal')
  const { document } = makeContractDocument()
  const baseRevision = canonicalRevision(document)
  const journal = new RecoveryJournal(path, { journalVersion: '1', documentId: document.documentId, baseCheckpointRevision: baseRevision, sessionId: 'journal-test', createdAt: '2026-09-02T00:00:00Z' })
  const session = new PpteSession(document, { journal })
  const agent = new MockAgent()
  const transaction = agent.createTextReplaceTransaction(session.getDocument(), baseRevision, 'slide_main', 'text_title', text('Journaled'), 'journaled')
  assert.equal(session.commit(transaction).ok, true)
  const state = readJournal(path)
  assert.equal(state.complete, true)
  assert.equal(state.records[0]?.resultRevision, session.getRevision())
  assert.throws(() => journal.append({ ...transaction, transactionId: 'wrong-base', baseRevision }), /JOURNAL_BASE_MISMATCH/)
  const mismatched = replayJournal(document, { ...state, records: [{ ...state.records[0]!, resultRevision: `sha256-${'0'.repeat(64)}` }] })
  assert.ok(mismatched.issues.some((issue) => issue.code === 'JOURNAL_CORRUPT'))
})

test('committed asset changes carry required CAS hashes into the journal', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ppte-journal-assets-'))
  const path = join(directory, 'recovery.journal')
  const { document } = makeContractDocument()
  const originalAsset = document.assets.asset_pixel
  document.assets.asset_alt = { ...originalAsset, id: 'asset_alt', path: 'assets/alt.png' }
  const session = new PpteSession(document, { journal: new RecoveryJournal(path, { journalVersion: '1', documentId: document.documentId, baseCheckpointRevision: canonicalRevision(document), sessionId: 'journal-assets', createdAt: '2026-09-02T00:00:00Z' }) })
  const transaction: Transaction = {
    transactionId: 'replace-asset-for-journal',
    baseRevision: session.getRevision(),
    actor: { type: 'human', id: 'test' },
    scope: { kind: 'selection', slideIds: ['slide_main'], elementIds: ['image_hero'], permissions: ['assets'], allowInsert: false, allowDelete: false },
    changeContract: { allowedOperationKinds: ['image.replaceAsset'], allowedElementIds: ['image_hero'], maxChangedSlides: 1, maxChangedElements: 1, maxReplacedAssets: 1, preserve: { content: 'preserve', geometry: 'preserve', style: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' } },
    createdAt: '2026-09-02T00:00:00Z',
    operations: [{ opId: 'replace-asset-for-journal-op', kind: 'image.replaceAsset', slideId: 'slide_main', elementId: 'image_hero', assetId: 'asset_alt' }],
  }
  assert.equal(session.commit(transaction).ok, true)
  const state = readJournal(path)
  assert.deepEqual(state.records[0]?.requiredAssetHashes, [originalAsset.hash])
})

test('CAS-backed checkpoint is self-contained and carries recent history', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ppte-cas-contract-'))
  const cas = new ContentAddressedStore(join(directory, 'cas'))
  const path = join(directory, 'deck.ppte')
  const { document, imageBytes } = makeContractDocument()
  const asset = document.assets.asset_pixel
  assert.equal(cas.put(imageBytes, asset.hash), `sha256-${sha256HexBytes(imageBytes)}`)
  assert.equal(cas.has(asset.hash), true)
  assert.deepEqual(cas.get(asset.hash), imageBytes)
  const session = new PpteSession(document, { checkpoint: checkpointAdapter() })
  const agent = new MockAgent()
  const transaction = agent.createTextReplaceTransaction(session.getDocument(), session.getRevision(), 'slide_main', 'text_title', text('Saved with CAS'), 'cas-history')
  assert.equal(session.commit(transaction).ok, true)
  const checkpoint = session.checkpoint(path, { timestamp: '2026-09-02T00:00:00Z', cas })
  assert.equal(checkpoint.ok, true)
  const reopened = openCheckpoint(path)
  assert.equal(reopened.manifest.compatibilityProfile, 'ppte-2.0-ga-a.1')
  assert.equal(reopened.manifest.contentRevision, session.getRevision())
  assert.equal(reopened.recentTransactions.length, 1)
})

test('direct checkpoint rejects missing CAS or asset bytes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ppte-checkpoint-cas-missing-'))
  const { document } = makeContractDocument()
  assert.throws(() => writeCheckpoint(document, join(directory, 'deck.ppte')), /ASSET_MISSING/)
})

test('CAS detects a corrupted blob instead of returning unverified bytes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ppte-cas-corrupt-'))
  const cas = new ContentAddressedStore(join(directory, 'cas'))
  const bytes = Uint8Array.from([1, 2, 3])
  const hash = cas.put(bytes)
  writeFileSync(cas.pathFor(hash), Uint8Array.from([9, 9, 9]))
  assert.throws(() => cas.get(hash), /CAS_HASH_MISMATCH/)
})
