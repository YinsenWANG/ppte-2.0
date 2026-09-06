import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { canonicalRevision } from '../packages/canonical-json/src/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { MockAgent } from '../packages/agent-tools/src/index.js'
import { RecoveryJournal, readJournal, replayJournal } from '../packages/recovery-journal/src/index.js'
import { openCheckpoint, writeCheckpoint } from '../packages/file-format/src/index.js'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import type { CheckpointAdapter } from '../packages/core/src/index.js'
import type { CheckpointWriteOptions } from '../packages/file-format/src/index.js'
import type { TextElement } from '../packages/schema/src/index.js'

function text(value: string) { return { paragraphs: [{ id: 'p', runs: [{ id: 'r', text: value }] }] } }

test('checkpoint is a self-contained ZIP and atomic failure leaves the previous file openable', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ppte-persistence-test-'))
  const path = join(directory, 'deck.ppte')
  const { document, imageBytes } = makeContractDocument()
  const initial = writeCheckpoint(document, path, { timestamp: '2026-09-02T00:00:00Z', assetBytes: { asset_pixel: imageBytes } })
  assert.equal(canonicalRevision(openCheckpoint(path).document), initial.revision)
  assert.throws(() => writeCheckpoint(document, path, { timestamp: '2026-09-02T00:01:00Z', assetBytes: { asset_pixel: imageBytes }, fault: 'before-rename' }), /CHECKPOINT_FAULT_BEFORE_RENAME/)
  assert.equal(canonicalRevision(openCheckpoint(path).document), initial.revision)
})

test('journal replays committed transactions after an interrupted checkpoint and rejects a corrupt tail', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ppte-recovery-test-'))
  const path = join(directory, 'deck.ppte')
  const journalPath = join(directory, 'deck.journal')
  const { document, imageBytes } = makeContractDocument()
  const initialRevision = canonicalRevision(document)
  writeCheckpoint(document, path, { timestamp: '2026-09-02T00:00:00Z', assetBytes: { asset_pixel: imageBytes } })
  const journal = new RecoveryJournal(journalPath, { journalVersion: '1', documentId: document.documentId, baseCheckpointRevision: initialRevision, sessionId: 'test-session', createdAt: '2026-09-02T00:00:00Z' })
  const adapter: CheckpointAdapter<string, CheckpointWriteOptions> = { write: (snapshot, target, options) => writeCheckpoint(snapshot, target, options), clearRecovery: () => journal.clear() }
  const session = new PpteSession(document, { journal, checkpoint: adapter })
  const agent = new MockAgent()
  const tx = agent.createTextReplaceTransaction(session.getDocument(), session.getRevision(), 'slide_main', 'text_title', text('Recovered title'), 'tx-recover')
  assert.equal(session.commit(tx).ok, true)
  const failed = session.checkpoint(path, { timestamp: '2026-09-02T00:01:00Z', assetBytes: { asset_pixel: imageBytes }, fault: 'before-rename' })
  assert.equal(failed.ok, false)
  assert.equal(canonicalRevision(openCheckpoint(path).document), initialRevision)
  const validJournal = readJournal(journalPath)
  assert.equal(validJournal.complete, true)
  assert.equal(validJournal.records.length, 1)
  const recovered = replayJournal(openCheckpoint(path).document, validJournal)
  assert.equal(recovered.applied, 1)
  assert.equal(recovered.revision, session.getRevision())

  appendFileSync(journalPath, '{"sequence":2,"transaction":')
  const corrupt = readJournal(journalPath)
  assert.equal(corrupt.complete, false)
  assert.equal(corrupt.records.length, 1)
  assert.ok(corrupt.issues.some((issue) => issue.code === 'JOURNAL_CORRUPT'))
  const final = session.checkpoint(path, { timestamp: '2026-09-02T00:02:00Z', assetBytes: { asset_pixel: imageBytes } })
  assert.equal(final.ok, true)
  assert.equal(existsSync(journalPath), false)
  const reopened = openCheckpoint(path)
  assert.equal(canonicalRevision(reopened.document), session.getRevision())
  assert.equal((reopened.document.slides.slide_main.elements.text_title as TextElement).content.paragraphs[0].runs[0].text, 'Recovered title')
  assert.ok(readFileSync(path).subarray(0, 4).length === 4)
})

test('SIGKILL during the temp-file window leaves the prior checkpoint readable', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ppte-kill-test-'))
  const path = join(directory, 'deck.ppte')
  const ready = join(directory, 'ready')
  const { document, imageBytes } = makeContractDocument()
  const expected = writeCheckpoint(document, path, { timestamp: '2026-09-02T00:00:00Z', assetBytes: { asset_pixel: imageBytes } })
  const child = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'checkpoint-kill-child.js'), path, ready], { stdio: 'ignore' })
  for (let attempt = 0; attempt < 100 && !existsSync(ready); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(existsSync(ready), true)
  child.kill('SIGKILL')
  const result = await new Promise<{ signal: NodeJS.Signals | null }>((resolve) => child.once('close', (_code, signal) => resolve({ signal })))
  assert.equal(result.signal, 'SIGKILL')
  assert.equal(canonicalRevision(openCheckpoint(path).document), expected.revision)
})
