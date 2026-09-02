import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { canonicalHash, canonicalJsonString, canonicalRevision } from '../../canonical-json/src/index.js'
import { applyTransaction, OperationApplyError } from '../../operations/src/index.js'
import { computeStructuralDiff } from '../../diff/src/index.js'
import { enforceChangeContract } from '../../change-contract/src/index.js'
import { validateRuntimeDocument, validateTransactionShape } from '../../validation/src/index.js'
import { withErrorSemantics } from '../../schema/src/errors.js'
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
  private lastRevision?: Revision

  constructor(readonly path: string, header: RecoveryJournalHeader) {
    this.header = { ...header }
    const current = existsSync(path) ? readJournal(path) : undefined
    if (current?.header) {
      if (!current.complete) throw new Error('JOURNAL_CORRUPT: existing journal has an invalid tail')
      if (current.header.documentId !== header.documentId) throw new Error('JOURNAL_BASE_MISMATCH: documentId')
      if (current.header.baseCheckpointRevision !== header.baseCheckpointRevision) throw new Error('JOURNAL_BASE_MISMATCH: baseCheckpointRevision')
      this.header = current.header
      this.nextSequence = (current.records.at(-1)?.sequence ?? 0) + 1
      this.lastRevision = current.records.at(-1)?.resultRevision
    } else if (existsSync(path)) {
      throw new Error('JOURNAL_CORRUPT: journal has no valid header')
    } else {
      this.nextSequence = 1
      mkdirSync(dirname(path), { recursive: true })
      writeHeader(path, this.header)
    }
  }

  append(transaction: Transaction, resultRevision?: Revision, requiredAssetHashes?: string[]): void {
    this.appendDurable(transaction, resultRevision, requiredAssetHashes)
  }

  appendDurable(transaction: Transaction, resultRevision?: Revision, requiredAssetHashes?: string[]): void {
    const shapeIssues = validateTransactionShape(transaction).filter((issue) => issue.severity === 'error')
    if (shapeIssues.length) throw new Error(shapeIssues.map((issue) => `${issue.code}: ${issue.message}`).join('\n'))
    const assetHashes = normalizeAssetHashes(requiredAssetHashes)
    if (!existsSync(this.path)) {
      // A successful checkpoint clears the tail. The first later commit starts
      // a new journal rooted at that transaction's base checkpoint.
      this.header = { ...this.header, baseCheckpointRevision: transaction.baseRevision, lastTransactionId: undefined }
      this.nextSequence = 1
      this.lastRevision = transaction.baseRevision
      mkdirSync(dirname(this.path), { recursive: true })
      writeHeader(this.path, this.header)
    }
    const expectedRevision = this.nextSequence === 1 ? this.header.baseCheckpointRevision : this.lastRevision
    if (expectedRevision && transaction.baseRevision !== expectedRevision) throw new Error('JOURNAL_BASE_MISMATCH: transaction does not follow the journal tail')
    if (resultRevision !== undefined && !/^sha256-[0-9a-fA-F]{64}$/.test(resultRevision)) throw new Error('JOURNAL_CORRUPT: invalid result revision')
    const body = {
      sequence: this.nextSequence,
      transaction,
      ...(assetHashes.length ? { requiredAssetHashes: assetHashes } : {}),
      ...(resultRevision === undefined ? {} : { resultRevision }),
    }
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
    this.lastRevision = resultRevision
    this.nextSequence += 1
  }

  read(): JournalReadResult {
    return readJournal(this.path)
  }

  clear(): void {
    if (existsSync(this.path)) unlinkSync(this.path)
    this.nextSequence = 1
    this.lastRevision = undefined
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
  if (!isRecord(header) || header.journalVersion !== '1' || typeof header.documentId !== 'string' || !header.documentId || typeof header.baseCheckpointRevision !== 'string' || !isRevision(header.baseCheckpointRevision) || typeof header.sessionId !== 'string' || !header.sessionId || typeof header.createdAt !== 'string' || !header.createdAt) issues.push(error('JOURNAL_CORRUPT', 'Journal header is invalid.'))
  const records: RecoveryJournalRecord[] = []
  let complete = issues.length === 0
  const headerBaseRevision = isRecord(header) ? header.baseCheckpointRevision : undefined
  let tailRevision = isRevision(headerBaseRevision) ? headerBaseRevision : undefined
  for (let index = 1; index < meaningful.length; index += 1) {
    const line = meaningful[index]
    let parsed: RecoveryJournalRecord
    try { parsed = JSON.parse(line) as RecoveryJournalRecord } catch (cause) {
      issues.push(error('JOURNAL_CORRUPT', `Invalid record at line ${index + 1}; later records were not applied.`))
      complete = false
      break
    }
    const shapeIssues = validateTransactionShape(parsed?.transaction).filter((issue) => issue.severity === 'error')
    const hasAssetHashes = isRecord(parsed) && Object.prototype.hasOwnProperty.call(parsed, 'requiredAssetHashes')
    const hasResultRevision = isRecord(parsed) && Object.prototype.hasOwnProperty.call(parsed, 'resultRevision')
    const rawAssetHashes = hasAssetHashes && Array.isArray(parsed.requiredAssetHashes) ? parsed.requiredAssetHashes : undefined
    let assetHashes: string[] = []
    let assetHashesValid = !hasAssetHashes
    if (hasAssetHashes && rawAssetHashes) {
      try {
        assetHashes = normalizeAssetHashes(rawAssetHashes)
        assetHashesValid = true
      } catch {
        assetHashesValid = false
      }
    }
    const resultRevisionValid = !hasResultRevision || isRevision(parsed.resultRevision)
    const followsTail = !tailRevision || parsed?.transaction?.baseRevision === tailRevision
    const body = {
      sequence: parsed?.sequence,
      transaction: parsed?.transaction,
      ...(hasAssetHashes ? { requiredAssetHashes: rawAssetHashes } : {}),
      ...(hasResultRevision ? { resultRevision: parsed?.resultRevision } : {}),
    }
    if (!isRecord(parsed) || !assetHashesValid || !Number.isInteger(parsed.sequence) || typeof parsed.checksum !== 'string' || shapeIssues.length > 0 || parsed.sequence !== records.length + 1 || !resultRevisionValid || !followsTail || parsed.checksum !== canonicalHash(body)) {
      issues.push(error('JOURNAL_CORRUPT', `Checksum or sequence mismatch at line ${index + 1}; later records were not applied.`))
      complete = false
      break
    }
    records.push(parsed)
    tailRevision = isRevision(parsed.resultRevision) ? parsed.resultRevision : undefined
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
    const availableAssetHashes = new Set(Object.values(document.assets ?? {}).map((asset) => asset.hash.toLowerCase()))
    const missingAssetHash = (record.requiredAssetHashes ?? []).find((hash) => !availableAssetHashes.has(hash.toLowerCase()))
    if (missingAssetHash) {
      issues.push(error('ASSET_MISSING', `Journal transaction ${record.transaction.transactionId} requires asset hash ${missingAssetHash}.`))
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
      if (record.resultRevision !== undefined && record.resultRevision !== revision) {
        issues.push(error('JOURNAL_CORRUPT', `Transaction ${record.transaction.transactionId} result revision does not match replay.`))
        break
      }
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
  const descriptor = openSync(path, 'a', 0o600)
  try {
    appendFileSync(descriptor, `${canonicalJsonString(header)}\n`, 'utf8')
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}
function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
function isRevision(value: unknown): value is Revision { return typeof value === 'string' && /^sha256-[0-9a-fA-F]{64}$/.test(value) }
function normalizeAssetHashes(value: unknown, throwOnInvalid = true): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    if (throwOnInvalid) throw new Error('JOURNAL_CORRUPT: requiredAssetHashes must be an array')
    return []
  }
  const hashes = value.map((hash) => typeof hash === 'string' ? hash.toLowerCase() : '')
  if (hashes.some((hash) => !/^sha256-[0-9a-f]{64}$/.test(hash)) || new Set(hashes).size !== hashes.length) {
    if (throwOnInvalid) throw new Error('JOURNAL_CORRUPT: requiredAssetHashes contains an invalid or duplicate hash')
    return []
  }
  return [...hashes].sort()
}
function error(code: string, message: string): ValidationIssue {
  return withErrorSemantics({ code, severity: 'error', message, recovery: 'Keep the last valid checkpoint and inspect the journal tail before recovery.' })
}
