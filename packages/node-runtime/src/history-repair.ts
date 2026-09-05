import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { openCheckpointBytes, buildCheckpointBytes } from '../../file-format/src/index.js'
import { PpteSession, rebuildHistoryFromBase } from '../../core/src/index.js'
import { readCheckpointResources } from './delivery.js'

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Strict package/resource validation with an isolated, read-only history assessment. */
export function inspectHistoryFile(path: string) {
  const bytes = readFileSync(path)
  const opened = openCheckpointBytes(bytes, { history: 'inspect' })
  return { sourcePath: resolve(path), sourceHash: digest(bytes), documentId: opened.document.documentId, revision: opened.manifest.contentRevision, assessment: opened.historyAssessment! }
}

/** A new directory is the recovery boundary. The source and all adjacent sidecars remain untouched. */
export function repairHistoryCopy(source: string, outputDirectory: string, options: { baseCheckpoint?: string } = {}) {
  const original = readFileSync(source)
  const opened = openCheckpointBytes(original, { history: 'inspect' })
  const assessment = opened.historyAssessment!
  if (assessment.status === 'unsupported') throw new Error('HISTORY_REPAIR_UNSUPPORTED: use a compatible runtime to inspect this history.')
  const resources = readCheckpointResources(source, opened.document)
  if (digest(readFileSync(source)) !== digest(original)) throw new Error('REVISION_CONFLICT: source changed during history inspection.')
  const rebuilt = options.baseCheckpoint ? rebuildHistoryFromBase(openCheckpointBytes(readFileSync(options.baseCheckpoint)).document, opened.document, opened.recentTransactions) : undefined
  const session = new PpteSession(opened.document, { history: rebuilt ?? assessment.retained, redoHistory: assessment.retainedRedo })
  const repaired = buildCheckpointBytes(session.getDocument(), { ...resources, recentTransactions: session.getHistory().map(entry => entry.transaction), redoHistory: [...session.getRedoHistory()] })
  const verified = new PpteSession(openCheckpointBytes(repaired).document)
  if (verified.getRevision() !== opened.manifest.contentRevision) throw new Error('HISTORY_REPAIR_FAILED: snapshot changed.')
  const directory = resolve(outputDirectory)
  const report = { version: 1, sourcePath: resolve(source), sourceHash: digest(original), recoveredHash: digest(repaired), snapshotRevision: verified.getRevision(), strategy: rebuilt ? 'exact-base-rebuild' : 'verified-contiguous-history', retainedHistoryCount: session.getHistory().length, assessment, journalPolicy: 'original adjacent journals preserved; not replayed or merged', outputPath: join(directory, 'recovered.ppte') }
  // Exclusive directory creation prevents overwriting a previous recovery result.
  mkdirSync(directory)
  try {
    writeFileSync(join(directory, 'INCOMPLETE'), 'Recovery has not finished. Keep the original project.\n', { flag: 'wx' })
    writeFileSync(join(directory, 'original.ppte'), original, { flag: 'wx' })
    if (existsSync(`${source}.journal`)) writeFileSync(join(directory, 'original.journal'), readFileSync(`${source}.journal`), { flag: 'wx' })
    writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
    writeFileSync(join(directory, 'recovered.ppte'), repaired, { flag: 'wx' })
    rmSync(join(directory, 'INCOMPLETE'))
  } catch (cause) {
    // Only this call's exclusively created output is removed; never the source.
    rmSync(directory, { recursive: true, force: true })
    throw cause
  }
  return report
}
