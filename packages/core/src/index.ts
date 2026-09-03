import { canonicalJsonString, canonicalRevision, cloneJson, deepFreeze } from '../../canonical-json/src/index.js'
import { computeStructuralDiff } from '../../diff/src/index.js'
import { applyTransaction, OperationApplyError } from '../../operations/src/index.js'
import { checkPreconditions, checkTransactionScope, enforceChangeContract } from '../../change-contract/src/index.js'
import { validateRuntimeDocument, validateTransactionShape } from '../../validation/src/index.js'
import { compareDocuments } from '../../reviewer/src/index.js'
import { buildPatchTransaction, validatePatch } from '../../patch-format/src/index.js'
import { withErrorSemantics } from '../../schema/src/errors.js'
import type {
  Element,
  FactId,
  PpteDocument,
  Revision,
  SourceId,
  Transaction,
  ValidationIssue,
  CommitResult,
  CompareResult,
  PptePatch,
  PreviewResult,
  StructuralDiff,
  ScopePermission,
  RuntimeProfile,
} from '../../schema/src/index.js'

export type SaveState = 'modified' | 'saving' | 'saved' | 'recoverable' | 'save-failed' | 'readonly-recovery'

export interface JournalSink {
  append(transaction: Transaction, resultRevision?: Revision, requiredAssetHashes?: string[]): void
}

export interface CheckpointAdapter<TTarget = unknown, TOptions = unknown> {
  write(document: PpteDocument, target: TTarget, options?: TOptions, recentTransactions?: ReadonlyArray<Transaction>): { revision: Revision }
  clearRecovery?(): void
}

export interface SessionOptions {
  journal?: JournalSink
  checkpoint?: CheckpointAdapter
  initialSaveState?: SaveState
  historyLimit?: number
  historyBytesLimit?: number
  runtimeProfile?: RuntimeProfile
}

export interface DerivedIndexes {
  slideByElement: Map<string, string>
  groupByElement: Map<string, string>
  assetRefCount: Map<string, number>
  semanticKeyIndex: Map<string, { slideId: string; elementId: string }>
  factRefIndex: Map<FactId, Set<{ slideId: string; elementId: string }>>
  sourceRefIndex: Map<SourceId, Set<{ slideId: string; elementId: string }>>
  roleIndex: Map<string, Set<{ slideId: string; elementId: string }>>
}

export interface HistoryEntry {
  transaction: Transaction
  inverse: Transaction
  beforeRevision: Revision
  afterRevision: Revision
}

export interface PreviewOptions {
  /** Internal-only policy bypass for the inverse produced by this Session. */
  allowSystemInversePolicy?: boolean
}

export interface SessionEvent {
  type: 'previewed' | 'committed' | 'undone' | 'redone' | 'checkpointed'
  revision: Revision
  diff?: StructuralDiff
}

export class PpteSession {
  private document: PpteDocument
  private revision: Revision
  private readonly journal?: JournalSink
  private readonly checkpointAdapter?: CheckpointAdapter
  private readonly listeners = new Set<(event: SessionEvent) => void>()
  private readonly history: HistoryEntry[] = []
  private readonly redoStack: HistoryEntry[] = []
  private readonly indexes: DerivedIndexes
  private saveState: SaveState
  private readonly historyLimit: number
  private readonly historyBytesLimit: number
  private readonly runtimeProfile: RuntimeProfile
  private readonly runtimeProfileExplicit: boolean
  private systemInversePreview = false

  constructor(document: PpteDocument, options: SessionOptions = {}) {
    this.runtimeProfile = options.runtimeProfile ?? inferRuntimeProfile(document)
    this.runtimeProfileExplicit = options.runtimeProfile !== undefined
    const initialIssues = validateRuntimeDocument(document, { runtimeProfile: this.runtimeProfile })
    if (initialIssues.some((issue) => issue.severity === 'error')) throw new Error(initialIssues.map((issue) => `${issue.code}: ${issue.message}`).join('\n'))
    this.document = cloneJson(document)
    this.revision = canonicalRevision(this.document)
    this.journal = options.journal
    this.checkpointAdapter = options.checkpoint
    this.saveState = options.initialSaveState ?? 'saved'
    this.historyLimit = validHistoryLimit(options.historyLimit ?? document.policies?.maxHistoryEntries ?? 200, 'historyLimit')
    this.historyBytesLimit = validHistoryLimit(options.historyBytesLimit ?? document.policies?.maxHistoryBytes ?? Number.MAX_SAFE_INTEGER, 'historyBytesLimit')
    this.indexes = buildDerivedIndexes(this.document)
  }

  getDocument(): Readonly<PpteDocument> {
    return deepFreeze(cloneJson(this.document))
  }

  getRevision(): Revision {
    return this.revision
  }

  getSaveState(): SaveState {
    return this.saveState
  }

  getDerivedIndexes(): DerivedIndexes {
    return this.indexes
  }

  getHistory(): ReadonlyArray<HistoryEntry> {
    return deepFreeze(cloneJson(this.history))
  }

  getRedoHistory(): ReadonlyArray<HistoryEntry> {
    return deepFreeze(cloneJson(this.redoStack))
  }

  preview(transaction: Transaction, options: PreviewOptions = {}): PreviewResult {
    const shapeIssues = validateTransactionShape(transaction)
    const issues: ValidationIssue[] = [...shapeIssues]
    if (shapeIssues.some((issue) => issue.severity === 'error')) return { ok: false, baseRevision: this.revision, issues: dedupe(issues) }
    if (transaction.baseRevision !== this.revision) issues.push(error('REVISION_CONFLICT', `Transaction base ${transaction.baseRevision} does not match current revision ${this.revision}.`))
    issues.push(...checkTransactionScope(transaction.scope))
    issues.push(...checkPreconditions(this.document, this.revision, transaction.operations))
    if (issues.some((issue) => issue.severity === 'error')) return { ok: false, baseRevision: this.revision, issues: dedupe(issues) }

    const runtimeProfile = this.runtimeProfileForTransaction(transaction)
    let applied: ReturnType<typeof applyTransaction>
    try {
      applied = applyTransaction(this.document, transaction, { runtimeProfile, strictFactSync: true })
    } catch (cause) {
      const operationError = cause instanceof OperationApplyError ? cause : undefined
      issues.push(error(operationError?.code ?? 'OPERATION_APPLY_FAILED', operationError?.message ?? String(cause)))
      return { ok: false, baseRevision: this.revision, issues: dedupe(issues) }
    }
    const diff = computeStructuralDiff(this.document, applied.document)
    issues.push(...enforceChangeContract(this.document, applied.document, transaction, diff, { allowSystemInversePolicy: options.allowSystemInversePolicy === true && this.systemInversePreview }))
    issues.push(...validateRuntimeDocument(applied.document, { runtimeProfile }))
    const ok = !issues.some((issue) => issue.severity === 'error')
    const proposedRevision = ok ? canonicalRevision(applied.document) : undefined
    const result: PreviewResult = {
      ok,
      baseRevision: this.revision,
      proposedRevision,
      document: ok ? deepFreeze(cloneJson(applied.document)) : undefined,
      diff,
      issues: dedupe(issues),
      requiresConfirmation: transaction.changeContract.requireConfirmation === true,
    }
    this.notify({ type: 'previewed', revision: this.revision, diff })
    return result
  }

  commit(transaction: Transaction): CommitResult {
    return this.performCommit(transaction, true, true, 'committed')
  }

  undo(): CommitResult {
    const entry = this.history[this.history.length - 1]
    if (!entry) return failure('UNDO_EMPTY', 'There is no committed transaction to undo.', this.revision, 'undo')
    const result = this.performCommit({ ...cloneJson(entry.inverse), baseRevision: this.revision, transactionId: `${entry.transaction.transactionId}:undo:${this.history.length}` }, false, false, 'undone', true)
    if (result.ok) {
      this.history.pop()
      this.redoStack.push(entry)
    }
    return result
  }

  redo(): CommitResult {
    const entry = this.redoStack[this.redoStack.length - 1]
    if (!entry) return failure('REDO_EMPTY', 'There is no transaction to redo.', this.revision, 'redo')
    const result = this.performCommit(rebaseForRedo(entry.transaction, this.revision, `${entry.transaction.transactionId}:redo:${this.redoStack.length}`), true, false, 'redone')
    if (result.ok) this.redoStack.pop()
    return result
  }

  checkpoint<TTarget, TOptions>(target: TTarget, options?: TOptions): { ok: boolean; revision?: Revision; issues: ValidationIssue[] } {
    if (!this.checkpointAdapter) return { ok: false, issues: [error('CHECKPOINT_FAILED', 'No checkpoint adapter is attached to this session.')] }
    this.saveState = 'saving'
    try {
      const result = this.checkpointAdapter.write(this.document, target, options, this.history.map((entry) => cloneJson(entry.transaction)))
      if (result.revision !== this.revision) throw new Error('Checkpoint adapter returned a revision different from the committed snapshot.')
      this.checkpointAdapter.clearRecovery?.()
      this.saveState = 'saved'
      this.notify({ type: 'checkpointed', revision: this.revision })
      return { ok: true, revision: this.revision, issues: [] }
    } catch (cause) {
      this.saveState = this.journal ? 'recoverable' : 'save-failed'
      return { ok: false, issues: [error('CHECKPOINT_FAILED', cause instanceof Error ? cause.message : String(cause), undefined, 'Retry checkpoint; committed changes remain in memory and the recovery journal.')] }
    }
  }

  compare(revised: PpteDocument, base: PpteDocument = this.document): CompareResult {
    return compareDocuments(base, this.document, revised)
  }

  previewPatch(patch: PptePatch): PreviewResult {
    const patchValidation = validatePatch(patch)
    if (!patchValidation.ok) return { ok: false, baseRevision: this.revision, issues: patchValidation.issues }
    if (patch.manifest.documentId !== this.document.documentId) return { ok: false, baseRevision: this.revision, issues: [error('PATCH_BASE_MISMATCH', 'Patch documentId does not match the session document.')] }
    if (patch.manifest.baseRevision !== this.revision) return { ok: false, baseRevision: this.revision, issues: [error('PATCH_BASE_MISMATCH', `Patch base ${patch.manifest.baseRevision} does not match current revision ${this.revision}.`)] }
    return this.preview(buildPatchTransaction(patch))
  }

  applyPatch(patch: PptePatch): CommitResult {
    const patchValidation = validatePatch(patch)
    if (!patchValidation.ok) return { ok: false, beforeRevision: this.revision, transactionId: `patch:${patch.manifest.patchId ?? 'unknown'}`, issues: patchValidation.issues }
    if (patch.manifest.documentId !== this.document.documentId) return failure('PATCH_BASE_MISMATCH', 'Patch documentId does not match the session document.', this.revision, `patch:${patch.manifest.patchId ?? 'unknown'}`)
    if (patch.manifest.baseRevision !== this.revision) return failure('PATCH_BASE_MISMATCH', `Patch base ${patch.manifest.baseRevision} does not match current revision ${this.revision}.`, this.revision, `patch:${patch.manifest.patchId ?? 'unknown'}`)
    return this.commit(buildPatchTransaction(patch))
  }

  subscribe(listener: (event: SessionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private performCommit(transaction: Transaction, recordHistory: boolean, clearRedo: boolean, eventType: SessionEvent['type'], allowSystemInversePolicy = false): CommitResult {
    const beforeRevision = this.revision
    const priorInverseState = this.systemInversePreview
    this.systemInversePreview = allowSystemInversePolicy
    let preview: PreviewResult
    try {
      preview = this.preview(transaction, { allowSystemInversePolicy: allowSystemInversePolicy && transaction.actor.type === 'system' })
    } finally {
      this.systemInversePreview = priorInverseState
    }
    if (!preview.ok || !preview.document || !preview.diff) return { ok: false, beforeRevision, transactionId: transaction.transactionId, diff: preview.diff, issues: preview.issues }
    let applied: ReturnType<typeof applyTransaction>
    try {
      applied = applyTransaction(this.document, transaction, { runtimeProfile: this.runtimeProfileForTransaction(transaction), strictFactSync: true })
    } catch (cause) {
      return { ok: false, beforeRevision, transactionId: transaction.transactionId, issues: [error('OPERATION_APPLY_FAILED', cause instanceof Error ? cause.message : String(cause))] }
    }
    const afterRevision = canonicalRevision(applied.document)
    const inverse: Transaction = {
      transactionId: `${transaction.transactionId}:inverse`,
      baseRevision: afterRevision,
      actor: { type: 'system', id: 'undo' },
      scope: { kind: 'document', permissions: allPermissions(), allowInsert: true, allowDelete: true },
      changeContract: { allowedOperationKinds: [...new Set(applied.inverseOperations.map((operation) => operation.kind))], maxChangedSlides: Number.MAX_SAFE_INTEGER, maxChangedElements: Number.MAX_SAFE_INTEGER, maxInsertedElements: Number.MAX_SAFE_INTEGER, maxDeletedElements: Number.MAX_SAFE_INTEGER, maxReplacedAssets: Number.MAX_SAFE_INTEGER, maxChangedFacts: Number.MAX_SAFE_INTEGER, maxChangedSources: Number.MAX_SAFE_INTEGER, maxChangedThemeTokens: Number.MAX_SAFE_INTEGER, maxChangedStylePresets: Number.MAX_SAFE_INTEGER },
      reason: `Inverse of ${transaction.transactionId}`,
      createdAt: new Date().toISOString(),
      operations: applied.inverseOperations,
    }
    if (this.journal) {
      try {
        // A transaction is not confirmed until its recovery record is durable.
        // This keeps the in-memory committed snapshot and recovery tail atomic
        // from the caller's point of view.
        this.journal.append(transaction, afterRevision, requiredAssetHashes(this.document, transaction))
      } catch (cause) {
        this.saveState = 'readonly-recovery'
        return {
          ok: false,
          beforeRevision,
          transactionId: transaction.transactionId,
          diff: preview.diff,
          issues: [error('JOURNAL_APPEND_FAILED', cause instanceof Error ? cause.message : String(cause), undefined, 'The transaction was not applied in memory; inspect the recovery journal before retrying.')],
        }
      }
    }
    this.document = applied.document
    this.revision = afterRevision
    this.indexes.slideByElement.clear()
    this.indexes.groupByElement.clear()
    this.indexes.assetRefCount.clear()
    this.indexes.semanticKeyIndex.clear()
    this.indexes.factRefIndex.clear()
    this.indexes.sourceRefIndex.clear()
    this.indexes.roleIndex.clear()
    rebuildIndexes(this.document, this.indexes)
    if (recordHistory) {
      this.history.push({ transaction: cloneJson(transaction), inverse, beforeRevision, afterRevision })
      while (this.history.length > this.historyLimit || (this.history.length > 0 && historyBytes(this.history) > this.historyBytesLimit)) this.history.shift()
    }
    if (clearRedo) this.redoStack.length = 0
    const issues: ValidationIssue[] = preview.issues.filter((issue) => issue.severity !== 'error')
    this.saveState = this.journal ? 'recoverable' : 'modified'
    this.notify({ type: eventType, revision: afterRevision, diff: preview.diff })
    return { ok: true, beforeRevision, afterRevision, transactionId: transaction.transactionId, inverseTransaction: inverse, diff: preview.diff, issues }
  }

  private notify(event: SessionEvent) {
    for (const listener of this.listeners) listener(event)
  }

  private runtimeProfileForTransaction(transaction: Transaction): RuntimeProfile {
    if (this.runtimeProfileExplicit) return this.runtimeProfile
    if (this.runtimeProfile === 'ga-c' || inferRuntimeProfile(this.document) === 'ga-c' || transactionIntroducesGaC(transaction)) return 'ga-c'
    return this.runtimeProfile
  }
}

export function buildDerivedIndexes(document: PpteDocument): DerivedIndexes {
  const indexes: DerivedIndexes = {
    slideByElement: new Map(),
    groupByElement: new Map(),
    assetRefCount: new Map(),
    semanticKeyIndex: new Map(),
    factRefIndex: new Map(),
    sourceRefIndex: new Map(),
    roleIndex: new Map(),
  }
  rebuildIndexes(document, indexes)
  return indexes
}

function rebuildIndexes(document: PpteDocument, indexes: DerivedIndexes) {
  for (const [slideId, slide] of Object.entries(document.slides)) {
    for (const [elementId, element] of Object.entries(slide.elements)) {
      indexes.slideByElement.set(elementId, slideId)
      if (element.semanticKey) indexes.semanticKeyIndex.set(`${slideId}:${element.semanticKey}`, { slideId, elementId })
      if (element.role) addSet(indexes.roleIndex, element.role, { slideId, elementId })
      for (const factId of element.semanticRefs?.factIds ?? []) addSet(indexes.factRefIndex, factId, { slideId, elementId })
      for (const sourceId of element.semanticRefs?.sourceIds ?? []) addSet(indexes.sourceRefIndex, sourceId, { slideId, elementId })
      if (element.type === 'image') indexes.assetRefCount.set(element.assetId, (indexes.assetRefCount.get(element.assetId) ?? 0) + 1)
    }
    for (const [groupId, group] of Object.entries(slide.groups ?? {})) for (const elementId of group.memberIds) indexes.groupByElement.set(elementId, groupId)
  }
}

function addSet<T>(map: Map<string, Set<T>>, key: string, value: T) {
  const set = map.get(key) ?? new Set<T>()
  set.add(value)
  map.set(key, set)
}
function allPermissions(): ScopePermission[] {
  return ['content', 'geometry', 'style', 'structure', 'theme', 'assets', 'facts', 'sources', 'notes', 'animation', 'review']
}
function rebaseForRedo(transaction: Transaction, revision: Revision, transactionId: string): Transaction {
  const rebased = cloneJson(transaction)
  rebased.baseRevision = revision
  rebased.transactionId = transactionId
  rebased.operations = rebased.operations.map((operation) => ({
    ...operation,
    preconditions: operation.preconditions?.map((precondition) => precondition.kind === 'revision-equals' ? { ...precondition, revision } : precondition),
  })) as Transaction['operations']
  return rebased
}
function validHistoryLimit(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`SCHEMA_INVALID: ${name} must be a positive integer.`)
  return value
}

function historyBytes(history: ReadonlyArray<HistoryEntry>): number {
  return new TextEncoder().encode(canonicalJsonString(history)).length
}

function requiredAssetHashes(document: PpteDocument, transaction: Transaction): string[] {
  const hashes = new Set<string>()
  const addAsset = (assetId: string) => {
    const hash = document.assets?.[assetId]?.hash
    if (hash) hashes.add(hash.toLowerCase())
  }
  for (const operation of transaction.operations) {
    if (operation.kind === 'image.replaceAsset') addAsset(operation.assetId)
    if (operation.kind === 'asset.upsert' && !operation.remove) {
      const hash = operation.asset.hash
      if (hash) hashes.add(hash.toLowerCase())
    }
    if (operation.kind === 'font.upsert' && !operation.remove) {
      const hash = operation.font.hash
      if (hash) hashes.add(hash.toLowerCase())
    }
    if (operation.kind === 'element.insert' && operation.element.type === 'image') addAsset(operation.element.assetId)
    if (operation.kind === 'slide.insert') {
      for (const element of Object.values(operation.slide.elements)) if (element.type === 'image') addAsset(element.assetId)
    }
  }
  return [...hashes].sort()
}

function inferRuntimeProfile(document: PpteDocument): RuntimeProfile {
  for (const slide of Object.values(document.slides ?? {})) {
    if (slide.visualStrategy === 'poster') return 'ga-c'
    for (const element of Object.values(slide.elements ?? {})) {
      if (element.type === 'component' || element.type === 'chart' && (element.chartType === 'area' || element.chartType === 'donut')) return 'ga-c'
    }
  }
  return 'ga-b'
}

function transactionIntroducesGaC(transaction: Transaction): boolean {
  return transaction.operations.some((operation) => {
    if (operation.kind === 'slide.update') return operation.patch.visualStrategy === 'poster'
    if (operation.kind === 'slide.insert') return operation.slide.visualStrategy === 'poster' || Object.values(operation.slide.elements).some((element) => element.type === 'component' || element.type === 'chart' && (element.chartType === 'area' || element.chartType === 'donut'))
    if (operation.kind === 'element.insert') return operation.element.type === 'component' || operation.element.type === 'chart' && (operation.element.chartType === 'area' || operation.element.chartType === 'donut')
    return false
  })
}
function error(code: string, message: string, path?: string, recovery?: string): ValidationIssue {
  return withErrorSemantics({ code, severity: 'error', message, path, recovery })
}
function failure(code: string, message: string, revision: Revision, transactionId: string): CommitResult {
  return { ok: false, beforeRevision: revision, transactionId, issues: [error(code, message)] }
}
function dedupe(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = `${issue.code}|${issue.message}|${issue.path ?? ''}|${issue.elementId ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
