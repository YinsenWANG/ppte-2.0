import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { canonicalHash, canonicalJsonString, canonicalRevision } from '../../canonical-json/src/index.js'
import { applyTransaction, OperationApplyError } from '../../operations/src/index.js'
import { computeStructuralDiff } from '../../diff/src/index.js'
import { enforceChangeContract } from '../../change-contract/src/index.js'
import { validateRuntimeDocument } from '../../validation/src/index.js'
import type { PpteDocument, RecoveryJournalHeader, RecoveryJournalRecord, Revision, Transaction, ValidationIssue } from '../../schema/src/index.js'

export interface JournalReadResult {
  header?: RecoveryJournalHeader
  records: RecoveryJournalRecord[]
  issues: ValidationIssue[]
  complete: boolean
}

export interface ReplayResult {
  document: PpteDocument
  revision: Revision
  applied: number
  issues: ValidationIssue[]
}

export class RecoveryJournal {
  private header: RecoveryJournalHeader
  private nextSequence: number

  constructor(readonly path: string, header: RecoveryJournalHeader) {
    this.header = { ...header }
    const current = existsSync(path) ? readJournal(path) : undefined
    if (current?.header) {
      if (current.header.documentId !== header.documentId) throw new Error('JOURNAL_BASE_MISMATCH: documentId')
      this.header = current.header
      this.nextSequence = (current.records.at(-1)?.sequence ?? 0) + 1
    } else if (existsSync(path)) {
      throw new Error('JOURNAL_CORRUPT: journal has no valid header')
    } else {
      this.nextSequence = 1
      mkdirSync(dirname(path), { recursive: true })
      writeHeader(path, this.header)
    }
  }

  append(transaction: Transaction): void {
    if (!existsSync(this.path)) {
      // A successful checkpoint clears the tail. The first later commit starts
      // a new journal rooted at that transaction's base checkpoint.
      this.header = { ...this.header, baseCheckpointRevision: transaction.baseRevision, lastTransactionId: undefined }
      this.nextSequence = 1
      mkdirSync(dirname(this.path), { recursive: true })
      writeHeader(this.path, this.header)
    }
    const body = { sequence: this.nextSequence, transaction }
    const record: RecoveryJournalRecord = { ...body, checksum: canonicalHash(body) }
    const line = `${canonicalJsonString(record)}\n`
    const descriptor = openSync(this.path, 'a', 0o600)
    try {
      appendFileSync(descriptor, line, 'utf8')
      fsyncSync(descriptor)
    } finally {
      closeSync(descriptor)
    }
    this.header = { ...this.header, lastTransactionId: transaction.transactionId }
    this.nextSequence += 1
  }

  read(): JournalReadResult {
    return readJournal(this.path)
  }

  clear(): void {
    if (existsSync(this.path)) unlinkSync(this.path)
  }
}

export function readJournal(path: string): JournalReadResult {
  if (!existsSync(path)) return { records: [], issues: [], complete: true }
  const issues: ValidationIssue[] = []
  let lines: string[]
  try {
    lines = readFileSync(path, 'utf8').split('\n')
  } catch (cause) {
    return { records: [], issues: [error('JOURNAL_CORRUPT', cause instanceof Error ? cause.message : String(cause))], complete: false }
  }
  const meaningful = lines.filter((line, index) => line.length > 0 || index < lines.length - 1)
  if (!meaningful[0]) return { records: [], issues: [error('JOURNAL_CORRUPT', 'Journal is empty.')], complete: false }
  let header: RecoveryJournalHeader
  try { header = JSON.parse(meaningful[0]) as RecoveryJournalHeader } catch (cause) { return { records: [], issues: [error('JOURNAL_CORRUPT', `Invalid journal header: ${cause instanceof Error ? cause.message : String(cause)}`)], complete: false } }
  if (header.journalVersion !== '1' || !header.documentId || !header.baseCheckpointRevision) issues.push(error('JOURNAL_CORRUPT', 'Journal header is invalid.'))
  const records: RecoveryJournalRecord[] = []
  let complete = issues.length === 0
  for (let index = 1; index < meaningful.length; index += 1) {
    const line = meaningful[index]
    let parsed: RecoveryJournalRecord
    try { parsed = JSON.parse(line) as RecoveryJournalRecord } catch (cause) {
      issues.push(error('JOURNAL_CORRUPT', `Invalid record at line ${index + 1}; later records were not applied.`))
      complete = false
      break
    }
    const body = { sequence: parsed.sequence, transaction: parsed.transaction }
    if (parsed.sequence !== records.length + 1 || parsed.checksum !== canonicalHash(body)) {
      issues.push(error('JOURNAL_CORRUPT', `Checksum or sequence mismatch at line ${index + 1}; later records were not applied.`))
      complete = false
      break
    }
    records.push(parsed)
  }
  return { header, records, issues, complete }
}

export function replayJournal(base: PpteDocument, journal: JournalReadResult): ReplayResult {
  const issues = [...journal.issues]
  const baseRevision = canonicalRevision(base)
  if (!journal.header || journal.header.documentId !== base.documentId || journal.header.baseCheckpointRevision !== baseRevision) {
    issues.push(error('JOURNAL_BASE_MISMATCH', 'Journal does not belong to the current checkpoint revision.'))
    return { document: base, revision: baseRevision, applied: 0, issues }
  }
  let document = base
  let revision = baseRevision
  let applied = 0
  for (const record of journal.records) {
    if (record.transaction.baseRevision !== revision) {
      issues.push(error('JOURNAL_BASE_MISMATCH', `Transaction ${record.transaction.transactionId} does not follow the journal revision.`))
      break
    }
    try {
      const result = applyTransaction(document, record.transaction)
      const diff = computeStructuralDiff(document, result.document)
      const transactionIssues = [...enforceChangeContract(document, result.document, record.transaction, diff), ...validateRuntimeDocument(result.document)]
      issues.push(...transactionIssues)
      if (transactionIssues.some((issue) => issue.severity === 'error')) break
      document = result.document
      revision = canonicalRevision(document)
      applied += 1
    } catch (cause) {
      const operationError = cause instanceof OperationApplyError ? cause : undefined
      issues.push(error(operationError?.code ?? 'JOURNAL_CORRUPT', operationError?.message ?? String(cause)))
      break
    }
  }
  return { document, revision, applied, issues }
}

function writeHeader(path: string, header: RecoveryJournalHeader) {
  appendFileSync(path, `${canonicalJsonString(header)}\n`, { encoding: 'utf8', mode: 0o600 })
}
function error(code: string, message: string): ValidationIssue {
  return { code, severity: 'error', message, recovery: 'Keep the last valid checkpoint and inspect the journal tail before recovery.' }
}
