import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { canonicalRevision } from '../packages/canonical-json/src/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { MockAgent } from '../packages/agent-tools/src/index.js'
import { RecoveryJournal } from '../packages/recovery-journal/src/index.js'
import { PpteFileService, checkpointAdapter, openCheckpoint, writeCheckpoint } from '../packages/file-format/src/index.js'
import { makeContractDocument } from '../apps/contract-deck/index.js'

function text(value: string) {
  return { paragraphs: [{ id: 'r5-p', runs: [{ id: 'r5-r', text: value }] }] }
}

function makeRecoverableCase(journalName: string) {
  const directory = mkdtempSync(join(tmpdir(), 'ppte-r5-test-'))
  const target = join(directory, 'deck.ppte')
  const journalPath = join(directory, journalName)
  const { document, imageBytes } = makeContractDocument()
  const baseRevision = canonicalRevision(document)
  writeCheckpoint(document, target, { assetBytes: { asset_pixel: imageBytes }, timestamp: '2026-09-03T00:00:00.000Z' })
  const journal = new RecoveryJournal(journalPath, {
    journalVersion: '1', documentId: document.documentId, baseCheckpointRevision: baseRevision,
    sessionId: 'r5-test-session', createdAt: '2026-09-03T00:00:00.000Z',
  })
  const session = new PpteSession(document, { journal })
  return { directory, target, journalPath, document, imageBytes, session, baseRevision }
}

test('Host recovery discovers a non-default Journal and restores Undo history', () => {
  const state = makeRecoverableCase('crash-tail.journal')
  const revisions = [state.baseRevision]
  const agent = new MockAgent()
  for (const value of ['Recovered 1', 'Recovered 2', 'Recovered 3']) {
    const transaction = agent.createTextReplaceTransaction(state.session.getDocument(), state.session.getRevision(), 'slide_main', 'text_title', text(value), `r5:${value}`)
    assert.equal(state.session.commit(transaction).ok, true)
    revisions.push(state.session.getRevision())
  }

  const opened = new PpteFileService().open(state.target)
  assert.equal(opened.recovery?.status, 'recovered')
  assert.equal(opened.manifest.contentRevision, revisions[3])
  assert.equal(existsSync(state.journalPath), true)

  const restored = new PpteSession(opened.document, { checkpoint: checkpointAdapter() })
  assert.equal(restored.getHistory().length, 3)
  assert.equal(restored.undo().ok, true)
  assert.equal(restored.getRevision(), revisions[2])
  assert.equal(restored.checkpoint(join(state.directory, 'recovered.ppte'), { assetBytes: { asset_pixel: state.imageBytes } }).ok, true)
  assert.equal(existsSync(state.journalPath), false)
})

test('Host recovery exposes isolated prompt, discard, and save-as outcomes', () => {
  const promptState = makeRecoverableCase('prompt.journal')
  const promptAgent = new MockAgent()
  const promptTransaction = promptAgent.createTextReplaceTransaction(promptState.session.getDocument(), promptState.session.getRevision(), 'slide_main', 'text_title', text('Prompt draft'), 'r5:prompt')
  assert.equal(promptState.session.commit(promptTransaction).ok, true)
  const prompt = new PpteFileService().openWithRecovery(promptState.target)
  assert.equal(prompt.recovery?.status, 'available')
  assert.notEqual(prompt.recovery?.draft && canonicalRevision(prompt.recovery.draft), canonicalRevision(prompt.document))
  assert.equal(existsSync(promptState.journalPath), true)

  const discardState = makeRecoverableCase('discard.journal')
  const discardAgent = new MockAgent()
  const discardTransaction = discardAgent.createTextReplaceTransaction(discardState.session.getDocument(), discardState.session.getRevision(), 'slide_main', 'text_title', text('Discard me'), 'r5:discard')
  assert.equal(discardState.session.commit(discardTransaction).ok, true)
  const discarded = new PpteFileService().recover(discardState.target, 'discard')
  assert.equal(discarded.recovery?.status, 'discarded')
  assert.equal(existsSync(discardState.journalPath), false)
  assert.equal(discarded.manifest.contentRevision, discardState.baseRevision)

  const saveState = makeRecoverableCase('save-as.journal')
  const saveAgent = new MockAgent()
  const saveTransaction = saveAgent.createTextReplaceTransaction(saveState.session.getDocument(), saveState.session.getRevision(), 'slide_main', 'text_title', text('Save me'), 'r5:save-as')
  assert.equal(saveState.session.commit(saveTransaction).ok, true)
  const saveAsTarget = join(saveState.directory, 'recovered.ppte')
  const saved = new PpteFileService().recover(saveState.target, 'save-as', { saveAsTarget, assetBytes: { asset_pixel: saveState.imageBytes } })
  assert.equal(saved.recovery?.status, 'saved-as')
  assert.equal(existsSync(saveState.journalPath), false)
  assert.equal(openCheckpoint(saveAsTarget, { recovery: 'ignore' }).manifest.contentRevision, saveState.session.getRevision())
})
