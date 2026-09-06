import { join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { canonicalRevision } from '../dist/packages/canonical-json/src/index.js'
import { PpteSession } from '../dist/packages/core/src/index.js'
import { MockAgent } from '../dist/packages/agent-tools/src/index.js'
import { RecoveryJournal } from '../dist/packages/recovery-journal/src/index.js'
import { writeCheckpoint } from '../dist/packages/file-format/src/index.js'
import { makeCrashFixture, richText, IDS } from './blackbox-fixtures.mjs'

const directory = process.argv[2]
if (!directory) throw new Error('BLACKBOX_CRASH_CHILD: output directory is required')
mkdirSync(directory, { recursive: true })

const { document, imageBytes } = makeCrashFixture()
const checkpointPath = join(directory, 'base.ppte')
const journalPath = join(directory, 'recovery.journal')
const initialRevision = canonicalRevision(document)
writeCheckpoint(document, checkpointPath, { clean: true, assetBytes: { [IDS.asset]: imageBytes }, timestamp: '2026-09-03T00:00:00.000Z' })
const journal = new RecoveryJournal(journalPath, {
  journalVersion: '1',
  documentId: document.documentId,
  baseCheckpointRevision: initialRevision,
  sessionId: 'blackbox-sigkill-session',
  createdAt: '2026-09-03T00:00:00.000Z',
})
const session = new PpteSession(document, { journal })
const agent = new MockAgent()
for (let index = 1; index <= 3; index += 1) {
  const transaction = agent.createTextReplaceTransaction(
    session.getDocument(),
    session.getRevision(),
    IDS.slide,
    IDS.title,
    richText(`崩溃前第 ${index} 步`, `bb-crash-${index}`),
    `bb-crash-${index}`,
  )
  const result = session.commit(transaction)
  if (!result.ok) throw new Error(`BLACKBOX_CRASH_CHILD: commit ${index} failed`)
}
writeFileSync(join(directory, 'child-state.json'), JSON.stringify({
  checkpointPath,
  journalPath,
  initialRevision,
  committedRevision: session.getRevision(),
  journalRecords: journal.read().records.length,
}, null, 2))
process.kill(process.pid, 'SIGKILL')

