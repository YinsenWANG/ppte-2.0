import { canonicalRevision, cloneJson, deepFreeze } from '../../canonical-json/src/index.js'
import { computeStructuralDiff } from '../../diff/src/index.js'
import { applyTransaction, OperationApplyError } from '../../operations/src/index.js'
import { checkPreconditions, checkTransactionScope, enforceChangeContract } from '../../change-contract/src/index.js'
import { validateRuntimeDocument, validateTransactionShape } from '../../validation/src/index.js'
import type {
  Element,
  FactId,
  PpteDocument,
  Revision,
  SourceId,
  Transaction,
  ValidationIssue,
  CommitResult,
  PreviewResult,
  StructuralDiff,
  ScopePermission,
} from '../../schema/src/index.js'

export type SaveState = 'modified' | 'saving' | 'saved' | 'recoverable' | 'save-failed' | 'readonly-recovery'

export interface JournalSink {
  append(transaction: Transaction): void
}

export interface CheckpointAdapter<TTarget = unknown, TOptions = unknown> {
  write(document: PpteDocument, target: TTarget, options?: TOptions): { revision: Revision }
  clearRecovery?(): void
}

export interface SessionOptions {
  journal?: JournalSink
  checkpoint?: CheckpointAdapter
  initialSaveState?: SaveState
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

interface HistoryEntry {
  transaction: Transaction
  inverse: Transaction
  beforeRevision: Revision
  afterRevision: Revision
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

  constructor(document: PpteDocument, options: SessionOptions = {}) {
    const initialIssues = validateRuntimeDocument(document)
    if (initialIssues.some((issue) => issue.severity === 'error')) throw new Error(initialIssues.map((issue) => `${issue.code}: ${issue.message}`).join('\n'))
    this.document = cloneJson(document)
    this.revision = canonicalRevision(this.document)
    this.journal = options.journal
    this.checkpointAdapter = options.checkpoint
    this.saveState = options.initialSaveState ?? 'saved'
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

  preview(transaction: Transaction): PreviewResult {
    const shapeIssues = validateTransactionShape(transaction)
    const issues: ValidationIssue[] = [...shapeIssues]
    if (transaction.baseRevision !== this.revision) issues.push(error('REVISION_CONFLICT', `Transaction base ${transaction.baseRevision} does not match current revision ${this.revision}.`))
    issues.push(...checkTransactionScope(transaction.scope))
    issues.push(...checkPreconditions(this.document, this.revision, transaction.operations))
    if (issues.some((issue) => issue.severity === 'error')) return { ok: false, baseRevision: this.revision, issues: dedupe(issues) }

    let applied: ReturnType<typeof applyTransaction>
    try {
      applied = applyTransaction(this.document, transaction)
    } catch (cause) {
      const operationError = cause instanceof OperationApplyError ? cause : undefined
      issues.push(error(operationError?.code ?? 'OPERATION_APPLY_FAILED', operationError?.message ?? String(cause)))
      return { ok: false, baseRevision: this.revision, issues: dedupe(issues) }
    }
    const diff = computeStructuralDiff(this.document, applied.document)
    issues.push(...enforceChangeContract(this.document, applied.document, transaction, diff))
    issues.push(...validateRuntimeDocument(applied.document))
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
    const result = this.performCommit({ ...cloneJson(entry.inverse), baseRevision: this.revision, transactionId: `${entry.transaction.transactionId}:undo:${this.history.length}` }, false, false, 'undone')
    if (result.ok) {
      this.history.pop()
      this.redoStack.push(entry)
    }
    return result
  }

  redo(): CommitResult {
    const entry = this.redoStack[this.redoStack.length - 1]
    if (!entry) return failure('REDO_EMPTY', 'There is no transaction to redo.', this.revision, 'redo')
    const result = this.performCommit({ ...cloneJson(entry.transaction), baseRevision: this.revision, transactionId: `${entry.transaction.transactionId}:redo:${this.redoStack.length}` }, true, false, 'redone')
    if (result.ok) this.redoStack.pop()
    return result
  }

  checkpoint<TTarget, TOptions>(target: TTarget, options?: TOptions): { ok: boolean; revision?: Revision; issues: ValidationIssue[] } {
    if (!this.checkpointAdapter) return { ok: false, issues: [error('CHECKPOINT_FAILED', 'No checkpoint adapter is attached to this session.')] }
    this.saveState = 'saving'
    try {
      const result = this.checkpointAdapter.write(this.document, target, options)
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

  subscribe(listener: (event: SessionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private performCommit(transaction: Transaction, recordHistory: boolean, clearRedo: boolean, eventType: SessionEvent['type']): CommitResult {
    const beforeRevision = this.revision
    const preview = this.preview(transaction)
    if (!preview.ok || !preview.document || !preview.diff) return { ok: false, beforeRevision, transactionId: transaction.transactionId, diff: preview.diff, issues: preview.issues }
    let applied: ReturnType<typeof applyTransaction>
    try {
      applied = applyTransaction(this.document, transaction)
    } catch (cause) {
      return { ok: false, beforeRevision, transactionId: transaction.transactionId, issues: [error('OPERATION_APPLY_FAILED', cause instanceof Error ? cause.message : String(cause))] }
    }
    const afterRevision = canonicalRevision(applied.document)
    const inverse: Transaction = {
      transactionId: `${transaction.transactionId}:inverse`,
      baseRevision: afterRevision,
      actor: { type: 'system', id: 'undo' },
      scope: { kind: 'document', permissions: allPermissions(), allowInsert: true, allowDelete: true },
      changeContract: { allowedOperationKinds: applied.inverseOperations.map((operation) => operation.kind), maxChangedSlides: Number.MAX_SAFE_INTEGER, maxChangedElements: Number.MAX_SAFE_INTEGER, maxInsertedElements: Number.MAX_SAFE_INTEGER, maxDeletedElements: Number.MAX_SAFE_INTEGER, maxReplacedAssets: Number.MAX_SAFE_INTEGER },
      reason: `Inverse of ${transaction.transactionId}`,
      createdAt: new Date().toISOString(),
      operations: applied.inverseOperations,
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
    if (recordHistory) this.history.push({ transaction: cloneJson(transaction), inverse, beforeRevision, afterRevision })
    if (clearRedo) this.redoStack.length = 0
    const issues: ValidationIssue[] = []
    if (this.journal) {
      try {
        this.journal.append(transaction)
        this.saveState = 'recoverable'
      } catch (cause) {
        this.saveState = 'recoverable'
        issues.push({ code: 'JOURNAL_APPEND_FAILED', severity: 'warning', message: cause instanceof Error ? cause.message : String(cause), recovery: 'Keep the session open and checkpoint as soon as possible.' })
      }
    } else {
      this.saveState = 'modified'
    }
    this.notify({ type: eventType, revision: afterRevision, diff: preview.diff })
    return { ok: true, beforeRevision, afterRevision, transactionId: transaction.transactionId, inverseTransaction: inverse, diff: preview.diff, issues }
  }

  private notify(event: SessionEvent) {
    for (const listener of this.listeners) listener(event)
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
function error(code: string, message: string, path?: string, recovery?: string): ValidationIssue {
  return { code, severity: 'error', message, path, recovery }
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
