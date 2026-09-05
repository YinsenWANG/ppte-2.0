import { canonicalRevision, cloneJson } from '../../canonical-json/src/index.js'
import { applyTransaction } from '../../operations/src/index.js'
import { validateRuntimeDocument, validateTransactionShape } from '../../validation/src/index.js'
import type { PpteDocument, RuntimeProfile, SessionHistoryEntrySnapshot } from '../../schema/src/index.js'
type HistoryEntry = SessionHistoryEntrySnapshot

/** Validates exact inverse and forward replay without modifying the supplied snapshot. */
export function validateHistoryChain(document: PpteDocument, entries: ReadonlyArray<HistoryEntry>, runtimeProfile: RuntimeProfile): PpteDocument {
    const candidate = entries.map((entry) => cloneJson(entry) as HistoryEntry)
    let cursor = cloneJson(document)
    let cursorRevision = canonicalRevision(document)
    for (let index = candidate.length - 1; index >= 0; index -= 1) {
      const entry = candidate[index]
      if (!entry) throw new Error('HISTORY_RESTORE_FAILED: missing history entry.')
      const transactionIssues = validateTransactionShape(entry.transaction).filter((issue) => issue.severity === 'error')
      const inverseIssues = validateTransactionShape(entry.inverse).filter((issue) => issue.severity === 'error')
      if (transactionIssues.length || inverseIssues.length) throw new Error(`HISTORY_RESTORE_FAILED: invalid history entry ${index + 1}.`)
      if (entry.transaction.baseRevision !== entry.beforeRevision) throw new Error(`HISTORY_RESTORE_FAILED: transaction ${entry.transaction.transactionId} has an invalid before revision.`)
      if (entry.afterRevision !== cursorRevision || entry.inverse.baseRevision !== entry.afterRevision) throw new Error(`HISTORY_RESTORE_FAILED: transaction ${entry.transaction.transactionId} does not terminate at the opened revision.`)
      let applied: ReturnType<typeof applyTransaction>
      try {
        applied = applyTransaction(cursor, { ...entry.inverse, baseRevision: cursorRevision }, { runtimeProfile: runtimeProfile, strictFactSync: true })
      } catch (cause) {
        throw new Error(`HISTORY_RESTORE_FAILED: inverse ${entry.transaction.transactionId} could not be applied: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
      const restoredRevision = canonicalRevision(applied.document)
      if (restoredRevision !== entry.beforeRevision) throw new Error(`HISTORY_RESTORE_FAILED: inverse ${entry.transaction.transactionId} restored ${restoredRevision}, expected ${entry.beforeRevision}.`)
      const restoredIssues = validateRuntimeDocument(applied.document, { runtimeProfile: runtimeProfile }).filter((issue) => issue.severity === 'error')
      if (restoredIssues.length) throw new Error(`HISTORY_RESTORE_FAILED: inverse ${entry.transaction.transactionId} produced an invalid snapshot.`)
      let replayed: ReturnType<typeof applyTransaction>
      try {
        replayed = applyTransaction(applied.document, { ...entry.transaction, baseRevision: restoredRevision }, { runtimeProfile: runtimeProfile, strictFactSync: true })
      } catch (cause) {
        throw new Error(`HISTORY_RESTORE_FAILED: transaction ${entry.transaction.transactionId} could not be replayed: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
      if (canonicalRevision(replayed.document) !== cursorRevision) throw new Error(`HISTORY_RESTORE_FAILED: transaction ${entry.transaction.transactionId} does not reproduce its after revision.`)
      cursor = applied.document
      cursorRevision = restoredRevision
    }
  return cursor
}

export interface HistoryAssessment {
  status: 'valid' | 'absent' | 'invalid' | 'unsupported'
  snapshotRevision: string
  retained: HistoryEntry[]
  retainedRedo: HistoryEntry[]
  discardedHistoryCount: number
  discardedRedoCount: number
  issues: string[]
}

/** Keeps only the contiguous, verified undo suffix and redo prefix. Never guesses missing values. */
export function assessHistory(document: PpteDocument, entries: ReadonlyArray<HistoryEntry>, redo: ReadonlyArray<HistoryEntry> = [], runtimeProfile: RuntimeProfile = 'ga-c', protocol = '1.1'): HistoryAssessment {
  const result: HistoryAssessment = { status: entries.length || redo.length ? 'valid' : 'absent', snapshotRevision: canonicalRevision(document), retained: [], retainedRedo: [], discardedHistoryCount: entries.length, discardedRedoCount: redo.length, issues: [] }
  if (!['1.0', '1.1'].includes(protocol)) return { ...result, status: 'unsupported', issues: [`Unsupported history operation protocol: ${protocol}`] }
  const snapshotErrors = validateRuntimeDocument(document, { runtimeProfile }).filter(issue => issue.severity === 'error')
  if (snapshotErrors.length) return { ...result, status: 'invalid', issues: snapshotErrors.map(issue => issue.message) }
  let cursor = cloneJson(document)
  for (let index = entries.length - 1; index >= 0; index--) {
    try {
      cursor = validateHistoryChain(cursor, [entries[index]!], runtimeProfile)
      result.retained.unshift(cloneJson(entries[index]!))
    } catch (cause) {
      result.status = 'invalid'
      result.issues.push(`Undo entry ${index + 1}: ${cause instanceof Error ? cause.message : String(cause)}`)
      break
    }
  }
  cursor = cloneJson(document)
  for (let index = redo.length - 1; index >= 0; index--) {
    try {
      const entry = redo[index]!
      if (canonicalRevision(cursor) !== entry.beforeRevision) throw new Error('Redo base revision mismatch')
      if (validateTransactionShape(entry.transaction).some(issue => issue.severity === 'error')) throw new Error('Malformed redo transaction')
      const next = applyTransaction(cursor, entry.transaction, { runtimeProfile, strictFactSync: true }).document
      if (canonicalRevision(next) !== entry.afterRevision) throw new Error('Redo after revision mismatch')
      validateHistoryChain(next, [entry], runtimeProfile)
      result.retainedRedo.unshift(cloneJson(entry))
      cursor = next
    } catch (cause) {
      result.status = 'invalid'
      result.issues.push(`Redo entry ${index + 1}: ${cause instanceof Error ? cause.message : String(cause)}`)
      break
    }
  }
  result.discardedHistoryCount -= result.retained.length
  result.discardedRedoCount -= result.retainedRedo.length
  return result
}
