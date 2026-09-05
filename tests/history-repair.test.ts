import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { PpteSession, assessHistory } from '../packages/core/src/index.js'
import { buildCheckpointBytes, openCheckpointBytes } from '../packages/file-format/src/index.js'
import { withPersistedHistoryMetadata } from '../packages/schema/src/file-format.js'
import { inspectHistoryFile, repairHistoryCopy } from '../packages/node-runtime/src/history-repair.js'

function fixture() {
  const { document, imageBytes } = makeContractDocument()
  const session = new PpteSession(document)
  for (let i = 0; i < 3; i++) {
    const result = session.commit({ transactionId: `rename-${i}`, baseRevision: session.getRevision(), actor: { type: 'human', id: 'test' }, scope: { kind: 'document', permissions: ['structure'], allowInsert: false, allowDelete: false }, changeContract: { allowedOperationKinds: ['slide.update'], maxChangedSlides: 1 }, createdAt: '2026-09-05T00:00:00Z', operations: [{ kind: 'slide.update', opId: `rename-${i}`, slideId: 'slide_main', patch: { name: `Name ${i}` } }] })
    assert.equal(result.ok, true, JSON.stringify(result.issues))
  }
  return { session, imageBytes }
}

test('assessment keeps only the verified contiguous suffix and never mutates history', () => {
  const { session } = fixture()
  const entries = structuredClone([...session.getHistory()])
  entries[1]!.inverse.operations = [{ kind: 'slide.update', opId: 'bad', slideId: 'slide_main', patch: { name: 'incorrect prior value' } }]
  const before = JSON.stringify(entries)
  const result = assessHistory(session.getDocument(), entries)
  assert.equal(result.status, 'invalid')
  assert.equal(result.retained.length, 1)
  assert.equal(result.discardedHistoryCount, 2)
  assert.equal(JSON.stringify(entries), before)
  const repaired = new PpteSession(session.getDocument(), { history: result.retained })
  assert.equal(repaired.undo().ok, true)
  assert.equal(repaired.undo().ok, false)
  assert.equal(assessHistory(session.getDocument(), [], [], 'ga-c', '9.0').status, 'unsupported')
  assert.equal(assessHistory(session.getDocument(), []).status, 'absent')
})

test('repair saves a verified new copy and report while preserving source and journal byte for byte', () => {
  const { session, imageBytes } = fixture()
  const history = structuredClone([...session.getHistory()])
  history[0]!.inverse.operations = [{ kind: 'slide.update', opId: 'bad', slideId: 'slide_main', patch: { name: 'wrong prior name' } }]
  const bytes = buildCheckpointBytes(session.getDocument(), { assetBytes: { asset_pixel: imageBytes }, recentTransactions: history.map(entry => withPersistedHistoryMetadata(entry.transaction, entry)) })
  assert.throws(() => new PpteSession(openCheckpointBytes(bytes).document), /HISTORY_RESTORE_FAILED/)
  const dir = mkdtempSync(join(tmpdir(), 'ppte-history-repair-'))
  try {
    const source = join(dir, 'source.ppte'); writeFileSync(source, bytes)
    writeFileSync(`${source}.journal`, 'preserve even a damaged journal')
    const inspected = inspectHistoryFile(source)
    assert.equal(inspected.assessment.status, 'invalid')
    assert.equal(inspected.assessment.retained.length, 2)
    const target = join(dir, 'recovery')
    const report = repairHistoryCopy(source, target)
    assert.equal(report.assessment.retained.length, 2)
    assert.deepEqual(readFileSync(source), Buffer.from(bytes))
    assert.equal(readFileSync(`${source}.journal`, 'utf8'), 'preserve even a damaged journal')
    assert.deepEqual(readFileSync(join(target, 'original.ppte')), Buffer.from(bytes))
    assert.equal(existsSync(join(target, 'INCOMPLETE')), false)
    assert.equal(JSON.parse(readFileSync(join(target, 'report.json'), 'utf8')).sourceHash, inspected.sourceHash)
    const restored = new PpteSession(openCheckpointBytes(readFileSync(report.outputPath)).document)
    assert.equal(restored.getRevision(), session.getRevision())
    assert.equal(restored.undo().ok, true)
    assert.equal(restored.undo().ok, true)
    assert.equal(restored.undo().ok, false)
    assert.throws(() => repairHistoryCopy(source, target), /EEXIST/)
    assert.deepEqual(readFileSync(source), Buffer.from(bytes))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('redo assessment preserves only the reachable prefix of the redo stack', () => {
  const { session } = fixture()
  session.undo(); session.undo(); session.undo()
  const redo = structuredClone([...session.getRedoHistory()])
  redo[1]!.afterRevision = 'sha256:' + '0'.repeat(64)
  const result = assessHistory(session.getDocument(), [], redo)
  assert.equal(result.status, 'invalid')
  assert.equal(result.retainedRedo.length, 1)
  const repaired = new PpteSession(session.getDocument(), { redoHistory: result.retainedRedo })
  assert.equal(repaired.redo().ok, true)
  assert.equal(repaired.redo().ok, false)
})

test('history rebuild requires an exact base and exact final snapshot', async () => {
  const { rebuildHistoryFromBase } = await import('../packages/core/src/index.js')
  const { session } = fixture()
  const history = session.getHistory()
  const base = makeContractDocument().document
  const rebuilt = rebuildHistoryFromBase(base, session.getDocument(), history.map(entry => entry.transaction))
  assert.equal(rebuilt.length, 3)
  assert.equal(new PpteSession(session.getDocument(), { history: rebuilt }).getHistory().length, 3)
  const wrong = structuredClone(base)
  wrong.metadata.title = 'Not the exact base'
  assert.throws(() => rebuildHistoryFromBase(wrong, session.getDocument(), history.map(entry => entry.transaction)), /BASE_MISMATCH/)
  assert.throws(() => rebuildHistoryFromBase(base, session.getDocument(), history.slice(0, 2).map(entry => entry.transaction)), /HEAD_MISMATCH/)
})
