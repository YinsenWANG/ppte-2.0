import type { AssetId, DocumentId, FontId, JsonValue, Revision, TransactionId } from './document.js'
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
export interface RecoveryJournalHeader {
  journalVersion: '1'
  documentId: DocumentId
  baseCheckpointRevision: Revision
  sessionId: string
  createdAt: string
  lastTransactionId?: TransactionId
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
