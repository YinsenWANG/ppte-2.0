import type { AssetId, DocumentId, FontId, JsonValue, PpteDocument, Revision, RuntimeProfile, TransactionId } from './document.js'
import type { Actor, Operation, Transaction } from './operations.js'

export type PortableProfile = 'viewer' | 'quick-fix' | 'light-edit'
export interface FileEntry {
  path: string
  mediaType: string
  byteLength: number
  sha256: string
  required: boolean
}
export interface PpteManifest {
  format: 'ppte'
  formatVersion: '2'
  schemaVersion: '2.0.0'
  operationProtocolVersion: string
  compatibilityProfile: string
  documentId: DocumentId
  contentRevision: Revision
  title: string
  createdAt: string
  updatedAt: string
  requiredWidgets: Array<{ type: string; versionRange: string; fallbackRequired: true }>
  clean: boolean
  files: FileEntry[]
  history?: HistoryDescriptor
}
export interface HistoryDescriptor {
  mode: 'standard' | 'audit' | 'clean'
  snapshotRevision?: Revision
  recentTransactionCount?: number
  deepHistoryExternal?: boolean
}

/**
 * Host-owned restore metadata. It is intentionally not part of PpteDocument,
 * so document.json remains the only persisted content source. The symbol is
 * only a same-process transport from a validated open boundary to Session.
 */
export const PPTE_SESSION_RESTORE_CONTEXT = Symbol.for('ppte.session.restore-context')
export const PPTE_HISTORY_METADATA_KEY = '__ppteHistory'

export interface SessionHistoryEntrySnapshot {
  transaction: Transaction
  inverse: Transaction
  beforeRevision: Revision
  afterRevision: Revision
}

export interface SessionRestoreContext {
  historyEntries: SessionHistoryEntrySnapshot[]
  runtimeProfile?: RuntimeProfile
  compatibilityProfile?: string
  source: 'checkpoint' | 'journal' | 'recovery'
  /** Host-only cleanup invoked after the recovered snapshot is checkpointed. */
  clearRecovery?: () => void
}

export interface PersistedHistoryMetadata {
  version: 1
  beforeRevision: Revision
  afterRevision: Revision
  inverse: Transaction
  runtimeProfile?: RuntimeProfile
}

/** Attach Host-only metadata without changing canonical document bytes. */
export function attachSessionRestoreContext(document: PpteDocument, context: SessionRestoreContext): PpteDocument {
  Object.defineProperty(document, PPTE_SESSION_RESTORE_CONTEXT, {
    configurable: true,
    enumerable: false,
    writable: true,
    value: context,
  })
  return document
}

export function getSessionRestoreContext(document: PpteDocument): SessionRestoreContext | undefined {
  return (document as PpteDocument & { [PPTE_SESSION_RESTORE_CONTEXT]?: SessionRestoreContext })[PPTE_SESSION_RESTORE_CONTEXT]
}

/**
 * Recent forward transactions carry their generated inverse in history
 * metadata. This makes checkpoint Undo exact without guessing a prior
 * snapshot, while keeping that metadata outside document.json.
 */
export function withPersistedHistoryMetadata(
  transaction: Transaction,
  metadata: Omit<PersistedHistoryMetadata, 'version'> & { version?: 1 },
): Transaction {
  const history: PersistedHistoryMetadata = {
    version: 1,
    beforeRevision: metadata.beforeRevision,
    afterRevision: metadata.afterRevision,
    inverse: metadata.inverse,
    ...(metadata.runtimeProfile === undefined ? {} : { runtimeProfile: metadata.runtimeProfile }),
  }
  return {
    ...transaction,
    metadata: {
      ...(transaction.metadata ?? {}),
      [PPTE_HISTORY_METADATA_KEY]: history as unknown as JsonValue,
    },
  }
}

export function readPersistedHistoryMetadata(transaction: Transaction): PersistedHistoryMetadata | undefined {
  const value = transaction?.metadata?.[PPTE_HISTORY_METADATA_KEY]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  if (candidate.version !== 1 || typeof candidate.beforeRevision !== 'string' || typeof candidate.afterRevision !== 'string' || !candidate.inverse || typeof candidate.inverse !== 'object' || Array.isArray(candidate.inverse)) return undefined
  return candidate as unknown as PersistedHistoryMetadata
}

export interface RecoveryJournalHeader {
  journalVersion: '1'
  documentId: DocumentId
  baseCheckpointRevision: Revision
  sessionId: string
  createdAt: string
  lastTransactionId?: TransactionId
  /** The persisted runtime contract used to interpret journal operations. */
  compatibilityProfile?: string
}
export interface RecoveryJournalRecord {
  sequence: number
  transaction: Transaction
  requiredAssetHashes?: string[]
  /** The result is optional for v1 readers; when present it makes the tail auditable without replay. */
  resultRevision?: Revision
  checksum: string
}
export interface PortableOrigin {
  sourceDocumentId: DocumentId
  sourceRevision: Revision
  derivedAt: string
  profile: PortableProfile
  runtimeVersion: string
  branchId?: string
}
export interface PatchManifest {
  patchVersion: '1'
  patchId?: string
  documentId: DocumentId
  baseRevision: Revision
  headRevision?: Revision
  /** Digest over the guarded operation list and both revisions. */
  headRevisionProof?: string
  createdAt: string
  actor?: Actor
  operationProtocolVersion: string
  compatibilityProfile: string
  files: FileEntry[]
  assetFiles?: Record<AssetId, string>
  fontFiles?: Record<FontId, string>
}
export interface PptePatch {
  manifest: PatchManifest
  operations: Operation[]
  assets?: Record<AssetId, Uint8Array>
  fonts?: Record<FontId, Uint8Array>
  /** Metadata travels with new binary payloads so a patch can be applied atomically. */
  assetMetadata?: Record<AssetId, import('./document.js').Asset>
  fontMetadata?: Record<FontId, import('./document.js').FontAsset>
  metadata?: Record<string, JsonValue>
}
