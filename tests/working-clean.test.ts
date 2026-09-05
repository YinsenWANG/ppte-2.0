import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { canonicalRevision } from '../packages/canonical-json/src/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { MockAgent } from '../packages/agent-tools/src/index.js'
import { RecoveryJournal, readJournal } from '../packages/recovery-journal/src/index.js'
import { openCheckpoint, writeCheckpoint } from '../packages/file-format/src/index.js'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import type { CheckpointAdapter } from '../packages/core/src/index.js'
import type { CheckpointWriteOptions, CheckpointResult } from '../packages/file-format/src/index.js'
import type { TextElement } from '../packages/schema/src/index.js'

function text(value: string) {
  return { paragraphs: [{ id: 'save-state-p', runs: [{ id: 'save-state-r', text: value }] }] }
}

function makeCase() {
  const directory = mkdtempSync(join(tmpdir(), 'ppte-save-state-'))
  const target = join(directory, 'deck.ppte')
  const journalPath = join(directory, 'deck.journal')
  const { document, imageBytes } = makeContractDocument()
  const initial = writeCheckpoint(document, target, { assetBytes: { asset_pixel: imageBytes }, timestamp: '2026-09-05T00:00:00Z' })
  const journal = new RecoveryJournal(journalPath, {
    journalVersion: '1',
    documentId: document.documentId,
    baseCheckpointRevision: initial.revision,
    sessionId: 'save-state-test',
    createdAt: '2026-09-05T00:00:00Z',
  })
  const agent = new MockAgent()
  return { directory, target, journalPath, document, imageBytes, journal, agent }
}

function fileAdapter(journal: RecoveryJournal): CheckpointAdapter<string, CheckpointWriteOptions> {
  return {
    write: (snapshot, target, options = {}, recentTransactions): CheckpointResult => writeCheckpoint(snapshot, target, {
      ...options,
      recentTransactions: recentTransactions?.length ? [...recentTransactions] : options.recentTransactions,
    }),
    clearRecovery: () => journal.clear(),
  }
}

function title(session: PpteSession): string {
  const element = session.getDocument().slides.slide_main.elements.text_title as TextElement
  return element.content.paragraphs[0]?.runs[0]?.text ?? ''
}

test('a new session is saved and an Operation Engine commit exposes a pending checkpoint', () => {
  const state = makeCase()
  const session = new PpteSession(state.document, { journal: state.journal, checkpoint: fileAdapter(state.journal) })
  const events: string[] = []
  session.subscribe((event) => events.push(event.type))

  assert.equal(session.getSaveState(), 'saved')
  const transaction = state.agent.createTextReplaceTransaction(session.getDocument(), session.getRevision(), 'slide_main', 'text_title', text('Edited title'), 'save-state-edit')
  assert.equal(session.commit(transaction).ok, true)
  assert.equal(session.getSaveState(), 'recoverable')
  assert.equal(title(session), 'Edited title')
  assert.deepEqual(events, ['previewed', 'committed'])
})

test('an injected checkpoint failure preserves the pending state and committed content', () => {
  const state = makeCase()
  const failingAdapter: CheckpointAdapter<string, CheckpointWriteOptions> = {
    write: () => { throw new Error('injected save failure') },
  }
  const session = new PpteSession(state.document, { journal: state.journal, checkpoint: failingAdapter })
  const transaction = state.agent.createTextReplaceTransaction(session.getDocument(), session.getRevision(), 'slide_main', 'text_title', text('Keep this title'), 'save-state-failed-save')
  assert.equal(session.commit(transaction).ok, true)
  const revisionAfterCommit = session.getRevision()

  const result = session.checkpoint(state.target, { assetBytes: { asset_pixel: state.imageBytes } })

  assert.equal(result.ok, false)
  assert.equal(session.getSaveState(), 'recoverable')
  assert.equal(session.getRevision(), revisionAfterCommit)
  assert.equal(title(session), 'Keep this title')
  assert.equal(readJournal(state.journalPath).records.length, 1)
  assert.equal(canonicalRevision(openCheckpoint(state.target).document), canonicalRevision(state.document))
})

test('journal autosave and explicit checkpoint converge on the same snapshot', () => {
  const state = makeCase()
  const session = new PpteSession(state.document, { journal: state.journal, checkpoint: fileAdapter(state.journal) })
  const events: string[] = []
  session.subscribe((event) => events.push(event.type))
  const transaction = state.agent.createTextReplaceTransaction(session.getDocument(), session.getRevision(), 'slide_main', 'text_title', text('Checkpointed title'), 'save-state-save')

  assert.equal(session.commit(transaction).ok, true)
  const journalState = readJournal(state.journalPath)
  assert.equal(journalState.complete, true)
  assert.equal(journalState.records.length, 1)
  assert.equal(journalState.records[0]?.resultRevision, session.getRevision())

  const result = session.checkpoint(state.target, { assetBytes: { asset_pixel: state.imageBytes }, timestamp: '2026-09-05T00:01:00Z' })
  const reopened = openCheckpoint(state.target)

  assert.equal(result.ok, true)
  assert.equal(session.getSaveState(), 'saved')
  assert.equal(existsSync(state.journalPath), false)
  assert.equal(reopened.manifest.contentRevision, session.getRevision())
  assert.equal(canonicalRevision(reopened.document), canonicalRevision(session.getDocument()))
  assert.equal((reopened.document.slides.slide_main.elements.text_title as TextElement).content.paragraphs[0]?.runs[0]?.text, 'Checkpointed title')
  assert.deepEqual(events, ['previewed', 'committed', 'checkpointed'])
})
