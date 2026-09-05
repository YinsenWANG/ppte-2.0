import { canonicalHash, canonicalRevision, sha256HexBytes } from '../../canonical-json/src/index.js'
import { readStoredZip } from '../../archive/src/index.js'
import { assessHistory, type HistoryAssessment } from '../../core/src/history.js'
import { readPersistedHistoryMetadata } from '../../schema/src/file-format.js'
import { checkCompatibility, assertDocumentCompatibility } from '../../compatibility/src/index.js'
import { validateRuntimeDocument } from '../../validation/src/index.js'
import type { PpteDocument, PpteManifest, SessionHistoryEntrySnapshot, Transaction } from '../../schema/src/index.js'

export interface CheckpointRecoveryAssessment {
  sourceHash: string
  snapshotStatus: 'valid' | 'invalid' | 'unsupported'
  snapshot?: unknown
  document?: PpteDocument
  manifest?: PpteManifest
  history: HistoryAssessment
  issues: string[]
  assetBytes: Record<string, Uint8Array>
  fontBytes: Record<string, Uint8Array>
  recentTransactions: Transaction[]
}

/** Read-only layered diagnosis shared by CLI and Host. Unverified content never becomes a project. */
export function assessCheckpointRecovery(bytes: Uint8Array): CheckpointRecoveryAssessment {
  const result: CheckpointRecoveryAssessment = {
    sourceHash: sha256HexBytes(bytes), snapshotStatus: 'invalid', issues: [], assetBytes: {}, fontBytes: {}, recentTransactions: [],
    history: { status: 'invalid', snapshotRevision: '', retained: [], retainedRedo: [], discardedHistoryCount: 0, discardedRedoCount: 0, issues: [] },
  }
  try {
    const archive = readStoredZip(bytes)
    const parse = <T>(path: string): T => JSON.parse(new TextDecoder().decode(archive.get(path))) as T
    const document = parse<PpteDocument>('document.json')
    result.snapshot = document
    const manifest = parse<PpteManifest>('manifest.json')
    result.manifest = manifest
    if (new TextDecoder().decode(archive.get('mimetype')) !== 'application/vnd.ppte+zip') throw new Error('Invalid mimetype')
    if (!checkCompatibility(manifest).ok || manifest.format !== 'ppte' || manifest.schemaVersion !== '2.0.0' || manifest.formatVersion !== '2') {
      result.snapshotStatus = 'unsupported'; result.history.status = 'unsupported'
      throw new Error('Unsupported checkpoint compatibility descriptor')
    }
    const errors = validateRuntimeDocument(document, { runtimeProfile: 'ga-c' }).filter(issue => issue.severity === 'error')
    if (errors.length) throw new Error(errors.map(issue => issue.message).join('; '))
    assertDocumentCompatibility(document, manifest.compatibilityProfile)
    if (manifest.documentId !== document.documentId || manifest.contentRevision !== canonicalRevision(document)) throw new Error('Snapshot identity/revision mismatch')
    if (canonicalHash(parse('assets/index.json')) !== canonicalHash(document.assets) || canonicalHash(parse('fonts/index.json')) !== canonicalHash(document.fonts)) throw new Error('Resource index mismatch')
    const historyIssues: string[] = []
    let undoIntegrityFailed = false
    let redoIntegrityFailed = false
    const paths = new Set<string>()
    for (const file of manifest.files) {
      if (paths.has(file.path) || !/^(document\.json|(?:assets|fonts|history)\/[^\\]+)$/.test(file.path) || file.path.split('/').includes('..')) throw new Error('Invalid manifest path')
      paths.add(file.path)
      const data = archive.get(file.path)
      if (!data || data.length !== file.byteLength || sha256HexBytes(data) !== file.sha256) {
        if (file.path.startsWith('history/')) {
          historyIssues.push(`History integrity failure: ${file.path}`)
          if (file.path === 'history/redo.json') redoIntegrityFailed = true
          else undoIntegrityFailed = true
        }
        else throw new Error(`Snapshot/resource integrity failure: ${file.path}`)
      }
    }
    for (const path of ['document.json', 'assets/index.json', 'fonts/index.json']) if (!paths.has(path)) throw new Error(`Missing manifest entry: ${path}`)
    for (const path of archive.keys()) if (!['mimetype', 'manifest.json'].includes(path) && !paths.has(path)) throw new Error(`Unlisted archive entry: ${path}`)
    for (const asset of Object.values(document.assets)) {
      const data = archive.get(asset.path)
      if (!data || data.length !== asset.byteLength || sha256HexBytes(data) !== asset.hash.replace(/^sha256-/, '')) throw new Error(`ASSET_HASH_MISMATCH: ${asset.id}`)
      result.assetBytes[asset.id] = data
    }
    for (const font of Object.values(document.fonts)) if (font.source === 'embedded') {
      const data = archive.get(font.path ?? `fonts/${font.id}.woff2`)
      if (!data || (font.hash && sha256HexBytes(data) !== font.hash.replace(/^sha256-/, ''))) throw new Error(`FONT_HASH_MISMATCH: ${font.id}`)
      result.fontBytes[font.id] = data
    }
    result.document = document
    result.snapshotStatus = 'valid'
    const lines = new TextDecoder().decode(archive.get('history/recent.jsonl')).split('\n').filter(Boolean)
    const entries = lines.map(line => {
      try {
        const transaction = JSON.parse(line) as Transaction
        const metadata = readPersistedHistoryMetadata(transaction)
        return { transaction, inverse: metadata?.inverse, beforeRevision: metadata?.beforeRevision, afterRevision: metadata?.afterRevision } as SessionHistoryEntrySnapshot
      } catch { return null as unknown as SessionHistoryEntrySnapshot }
    })
    let redo: SessionHistoryEntrySnapshot[] = []
    try {
      const descriptor = parse<Record<string, unknown>>('history/descriptor.json')
      if (!paths.has('history/descriptor.json') || !manifest.history || descriptor.mode !== manifest.history.mode || descriptor.snapshotRevision !== manifest.contentRevision || descriptor.recentTransactionCount !== lines.length || descriptor.recentTransactionCount !== manifest.history.recentTransactionCount || descriptor.deepHistoryExternal !== manifest.history.deepHistoryExternal || (manifest.clean && (lines.length || descriptor.mode !== 'clean'))) throw new Error('History descriptor mismatch')
    } catch (cause) { undoIntegrityFailed = true; historyIssues.push(String(cause)) }
    if (archive.has('history/redo.json')) {
      try { redo = parse('history/redo.json'); if (!Array.isArray(redo)) throw new Error('Redo is not an array') }
      catch { redo = []; redoIntegrityFailed = true; historyIssues.push('Malformed redo history') }
    }
    result.history = assessHistory(document, entries, redo, 'ga-c', manifest.operationProtocolVersion)
    result.recentTransactions = entries.map(entry => entry?.transaction)
    // Unknown history semantics are never offered as a truncated editable recovery.
    try { assertDocumentCompatibility(document, manifest.compatibilityProfile, { recentTransactions: entries.filter(Boolean).map(entry => entry.transaction), redoHistory: redo }) }
    catch (cause) { result.history.status = 'unsupported'; result.history.issues.push(String(cause)) }
    if (historyIssues.length || result.history.status === 'unsupported') {
      if (result.history.status !== 'unsupported') result.history.status = 'invalid'
      if (undoIntegrityFailed || result.history.status === 'unsupported') {
        result.history.retained = []; result.history.discardedHistoryCount = entries.length
      }
      if (redoIntegrityFailed || result.history.status === 'unsupported') {
        result.history.retainedRedo = []; result.history.discardedRedoCount = redo.length
      }
      result.history.issues.push(...historyIssues)
      // Integrity failures cannot supply a trusted forward chain either.
      if (undoIntegrityFailed) result.recentTransactions = []
    }
  } catch (cause) { result.issues.push(String(cause)) }
  return result
}
