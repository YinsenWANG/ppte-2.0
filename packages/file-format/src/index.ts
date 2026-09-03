import { existsSync, fsyncSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, basename, join } from 'node:path'
import { canonicalHash, canonicalJsonString, canonicalRevision } from '../../canonical-json/src/index.js'
import { assertDocumentCompatibility, checkCompatibility, inferCompatibilityProfile, runtimeProfileForCompatibility } from '../../compatibility/src/index.js'
import { validateRuntimeDocument, validateTransactionShape } from '../../validation/src/index.js'
import { PPTE_FORMAT, PPTE_FORMAT_VERSION, PPTE_OPERATION_PROTOCOL_VERSION, PPTE_SCHEMA_VERSION } from '../../schema/src/index.js'
import type { PpteDocument, PpteManifest, PortableProfile, Revision, Transaction, ValidationIssue } from '../../schema/src/index.js'
import { ContentAddressedStore } from './cas.js'
import { buildPortable as buildPortableRuntime } from '../../portable-runtime/src/index.js'
import type { PortableBuildOptions, PortableBuildResult } from '../../portable-runtime/src/index.js'
import type { FaultInjector, FaultPoint } from '../../fault-injection/src/index.js'

export { ContentAddressedStore } from './cas.js'

export interface CheckpointWriteOptions {
  timestamp?: string
  clean?: boolean
  recentTransactions?: Transaction[]
  assetBytes?: Record<string, Uint8Array>
  fontBytes?: Record<string, Uint8Array>
  cas?: ContentAddressedStore
  fault?: FaultPoint | 'before-rename' | 'after-rename'
  faultInjector?: FaultInjector
  readyFile?: string
  pauseBeforeRenameMs?: number
  /** Defaults to the lowest profile inferred from the persisted document. */
  compatibilityProfile?: string
}

export interface CheckpointResult {
  revision: Revision
  path: string
  bytes: number
}

export interface OpenCheckpointResult {
  document: PpteDocument
  manifest: PpteManifest
  recentTransactions: Transaction[]
}

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
const MAX_ENTRY_BYTES = 256 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 10_000
const CRC_TABLE = buildCrcTable()

export class PpteFileService {
  write(document: PpteDocument, target: string, options: CheckpointWriteOptions = {}, recentTransactions?: ReadonlyArray<Transaction>): CheckpointResult {
    return writeCheckpoint(document, target, { ...options, recentTransactions: recentTransactions?.length ? [...recentTransactions] : options.recentTransactions })
  }

  checkpoint(document: PpteDocument, target: string, options: CheckpointWriteOptions = {}, recentTransactions?: ReadonlyArray<Transaction>): CheckpointResult {
    return this.write(document, target, options, recentTransactions)
  }

  open(target: string | Uint8Array): OpenCheckpointResult {
    return typeof target === 'string' ? openCheckpoint(target) : openCheckpointBytes(target)
  }

  /** Build a history-free checkpoint for sharing without mutating the source document. */
  exportClean(document: PpteDocument, options: Omit<CheckpointWriteOptions, 'clean' | 'recentTransactions'> = {}): Uint8Array {
    return buildCheckpointBytes(cleanDocumentSnapshot(document), { ...options, clean: true, recentTransactions: [] })
  }

  buildPortable(document: PpteDocument, options: PortableBuildOptions | PortableProfile): PortableBuildResult {
    if (typeof options === 'string') return buildPortableRuntime(document, { profile: options })
    return buildPortableRuntime(document, options)
  }

  clearRecovery(): void {
    // Recovery is owned by RecoveryJournal. This no-op makes the service fit
    // the Core checkpoint adapter without coupling the packages.
  }
}

export function writeCheckpoint(document: PpteDocument, target: string, options: CheckpointWriteOptions = {}): CheckpointResult {
  const compatibilityProfile = options.compatibilityProfile ?? inferCompatibilityProfile(document)
  const issues = validateRuntimeDocument(document, { runtimeProfile: runtimeProfileForCompatibility(compatibilityProfile) }).filter((issue) => issue.severity === 'error')
  if (issues.length) throw new Error(issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n'))
  const revision = canonicalRevision(document)
  const timestamp = options.timestamp ?? new Date().toISOString()
  assertDocumentCompatibility(document, compatibilityProfile)
  const entries: ZipEntry[] = []
  addEntry(entries, 'mimetype', bytes('application/vnd.ppte+zip'))
  addEntry(entries, 'document.json', bytes(canonicalJsonString(document)))
  addEntry(entries, 'assets/index.json', bytes(canonicalJsonString(document.assets)))
  addEntry(entries, 'fonts/index.json', bytes(canonicalJsonString(document.fonts)))
  const recent = options.recentTransactions ?? []
  if (options.clean && recent.length) throw new Error('CHECKPOINT_FAILED: clean checkpoint cannot contain recent history')
  for (const [index, transaction] of recent.entries()) {
    const transactionIssues = validateTransactionShape(transaction).filter((issue) => issue.severity === 'error')
    if (transactionIssues.length) throw new Error(`CHECKPOINT_FAILED: invalid recent transaction ${index + 1}: ${transactionIssues.map((issue) => issue.message).join('; ')}`)
  }
  addEntry(entries, 'history/descriptor.json', bytes(canonicalJsonString({ mode: options.clean ? 'clean' : 'standard', snapshotRevision: revision, recentTransactionCount: options.clean ? 0 : recent.length, deepHistoryExternal: !options.clean })))
  if (!options.clean && recent.length) addEntry(entries, 'history/recent.jsonl', bytes(recent.map((transaction) => canonicalJsonString(transaction)).join('\n') + '\n'))
  for (const [assetId, data] of Object.entries(options.assetBytes ?? {})) {
    const asset = document.assets[assetId]
    if (!asset) throw new Error(`ASSET_MISSING: ${assetId}`)
    if (data.length !== asset.byteLength || normalizeHash(asset.hash) !== sha256Binary(data)) throw new Error(`ASSET_HASH_MISMATCH: ${assetId}`)
    addEntry(entries, safePackagePath(asset.path, `assets/${assetId}`, 'assets/'), data)
  }
  for (const asset of Object.values(document.assets)) {
    const data = options.assetBytes?.[asset.id] ?? options.cas?.get(asset.hash)
    if (!data) throw new Error(`ASSET_MISSING: checkpoint requires bytes for ${asset.id}`)
    if (!options.assetBytes?.[asset.id]) {
      if (data.length !== asset.byteLength || normalizeHash(asset.hash) !== sha256Binary(data)) throw new Error(`ASSET_HASH_MISMATCH: ${asset.id}`)
      addEntry(entries, safePackagePath(asset.path, `assets/${asset.id}`, 'assets/'), data)
    }
  }
  for (const [fontId, data] of Object.entries(options.fontBytes ?? {})) {
    const font = document.fonts[fontId]
    if (!font) throw new Error(`FONT_MISSING: ${fontId}`)
    if (font.hash && normalizeHash(font.hash) !== sha256Binary(data)) throw new Error(`ASSET_HASH_MISMATCH: ${fontId}`)
    addEntry(entries, safePackagePath(font.path ?? `fonts/${fontId}.woff2`, `fonts/${fontId}.woff2`, 'fonts/'), data)
  }
  for (const font of Object.values(document.fonts)) {
    if (font.source !== 'embedded') continue
    const data = options.fontBytes?.[font.id] ?? (font.hash ? options.cas?.get(font.hash) : undefined)
    if (!data) throw new Error(`FONT_MISSING: checkpoint requires bytes for ${font.id}`)
    if (font.hash && normalizeHash(font.hash) !== sha256Binary(data)) throw new Error(`FONT_HASH_MISMATCH: ${font.id}`)
    if (!options.fontBytes?.[font.id]) addEntry(entries, safePackagePath(font.path ?? `fonts/${font.id}.woff2`, `fonts/${font.id}.woff2`, 'fonts/'), data)
  }
  const files = entries.filter((entry) => entry.name !== 'mimetype').map((entry) => ({ path: entry.name, mediaType: mediaTypeFor(entry.name), byteLength: entry.data.length, sha256: sha256Binary(entry.data), required: entry.name === 'document.json' }))
  const manifest: PpteManifest = {
    format: 'ppte',
    formatVersion: '2',
    schemaVersion: '2.0.0',
    operationProtocolVersion: '1.0',
    compatibilityProfile,
    documentId: document.documentId,
    contentRevision: revision,
    title: document.metadata.title,
    createdAt: document.metadata.createdAt ?? timestamp,
    updatedAt: timestamp,
    requiredWidgets: document.widgetRequirements ?? [],
    clean: options.clean ?? false,
    files,
    history: { mode: options.clean ? 'clean' : 'standard', snapshotRevision: revision, recentTransactionCount: options.clean ? 0 : recent.length, deepHistoryExternal: !options.clean },
  }
  validateManifest(manifest)
  addEntry(entries, 'manifest.json', bytes(canonicalJsonString(manifest)))
  const archive = writeZip(entries)
  hitFault(options, 'checkpoint.build')
  // Validate the exact bytes that are about to become the checkpoint before
  // any rename can make them visible to a reader.
  readZip(archive)
  mkdirSync(dirname(target), { recursive: true })
  const temporary = join(dirname(target), `.${basename(target)}.${process.pid}.${Date.now()}.tmp`)
  let descriptor: number | undefined
  try {
    descriptor = openSync(temporary, 'w', 0o600)
    writeFileSync(descriptor, archive)
    hitFault(options, 'checkpoint.fsync')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    if (options.readyFile) writeFileSync(options.readyFile, 'checkpoint-ready\n', { mode: 0o600 })
    if (options.pauseBeforeRenameMs) pause(options.pauseBeforeRenameMs)
    hitFault(options, 'checkpoint.before-rename')
    hitFault(options, 'checkpoint.rename')
    renameSync(temporary, target)
    fsyncDirectory(dirname(target))
    hitFault(options, 'checkpoint.after-rename')
    return { revision, path: target, bytes: archive.length }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

export function openCheckpoint(target: string): OpenCheckpointResult {
  const bytesOnDisk = new Uint8Array(readFileSync(target))
  return openCheckpointBytes(bytesOnDisk)
}

export function openCheckpointBytes(bytesOnDisk: Uint8Array): OpenCheckpointResult {
  const archive = readZip(bytesOnDisk)
  if (new TextDecoder().decode(archive.get('mimetype') ?? new Uint8Array()) !== 'application/vnd.ppte+zip') throw new Error('CHECKPOINT_FAILED: invalid mimetype')
  const manifest = parseJson<PpteManifest>(archive, 'manifest.json')
  validateManifest(manifest)
  const expectedEntries = new Set(['mimetype', 'manifest.json', ...manifest.files.map((entry) => entry.path)])
  for (const entry of archive.keys()) if (!expectedEntries.has(entry)) throw new Error(`CHECKPOINT_FAILED: archive contains an unlisted entry: ${entry}`)
  for (const required of ['document.json', 'assets/index.json', 'fonts/index.json', 'history/descriptor.json']) {
    if (!manifest.files.some((entry) => entry.path === required)) throw new Error(`CHECKPOINT_FAILED: manifest omits required package entry: ${required}`)
  }
  const document = parseJson<PpteDocument>(archive, 'document.json')
  const issues = validateRuntimeDocument(document, { runtimeProfile: runtimeProfileForCompatibility(manifest.compatibilityProfile) }).filter((issue) => issue.severity === 'error')
  if (issues.length) throw new Error(issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n'))
  assertDocumentCompatibility(document, manifest.compatibilityProfile)
  if (manifest.documentId !== document.documentId) throw new Error('CHECKPOINT_FAILED: manifest/document documentId mismatch')
  const revision = canonicalRevision(document)
  if (manifest.contentRevision !== revision) throw new Error(`CHECKPOINT_FAILED: manifest revision ${manifest.contentRevision} does not match document ${revision}`)
  const archivedAssets = parseJson<unknown>(archive, 'assets/index.json')
  const archivedFonts = parseJson<unknown>(archive, 'fonts/index.json')
  if (canonicalHash(archivedAssets) !== canonicalHash(document.assets)) throw new Error('CHECKPOINT_FAILED: assets index does not match document')
  if (canonicalHash(archivedFonts) !== canonicalHash(document.fonts)) throw new Error('CHECKPOINT_FAILED: fonts index does not match document')
  for (const entry of manifest.files ?? []) {
    const data = archive.get(entry.path)
    if (!data) throw new Error(`CHECKPOINT_FAILED: manifest file is missing: ${entry.path}`)
    if (data.length !== entry.byteLength || sha256Binary(data) !== entry.sha256) throw new Error(`CHECKPOINT_FAILED: manifest hash mismatch: ${entry.path}`)
  }
  for (const asset of Object.values(document.assets)) {
    const data = archive.get(safePackagePath(asset.path, `assets/${asset.id}`, 'assets/'))
    if (!data || data.length !== asset.byteLength || normalizeHash(asset.hash) !== sha256Binary(data)) throw new Error(`ASSET_HASH_MISMATCH: ${asset.id}`)
  }
  for (const font of Object.values(document.fonts)) {
    if (font.source !== 'embedded') continue
    const fontPath = safePackagePath(font.path ?? `fonts/${font.id}.woff2`, `fonts/${font.id}.woff2`, 'fonts/')
    const data = archive.get(fontPath)
    if (!data) throw new Error(`FONT_MISSING: ${font.id}`)
    if (font.hash && normalizeHash(font.hash) !== sha256Binary(data)) throw new Error(`FONT_HASH_MISMATCH: ${font.id}`)
  }
  const descriptor = parseJson<Record<string, unknown>>(archive, 'history/descriptor.json')
  const history = manifest.history
  if (!history || descriptor.mode !== history.mode || descriptor.snapshotRevision !== history.snapshotRevision || descriptor.recentTransactionCount !== history.recentTransactionCount || descriptor.deepHistoryExternal !== history.deepHistoryExternal) throw new Error('CHECKPOINT_FAILED: history descriptor does not match manifest')
  const recentTransactions = readRecentTransactions(archive, manifest)
  return { document, manifest, recentTransactions }
}

/** Serialize the exact stored ZIP used by writeCheckpoint without touching disk. */
export function buildCheckpointBytes(document: PpteDocument, options: CheckpointWriteOptions = {}): Uint8Array {
  const compatibilityProfile = options.compatibilityProfile ?? inferCompatibilityProfile(document)
  const issues = validateRuntimeDocument(document, { runtimeProfile: runtimeProfileForCompatibility(compatibilityProfile) }).filter((issue) => issue.severity === 'error')
  if (issues.length) throw new Error(issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n'))
  const revision = canonicalRevision(document)
  const timestamp = options.timestamp ?? '1970-01-01T00:00:00.000Z'
  assertDocumentCompatibility(document, compatibilityProfile)
  const entries: ZipEntry[] = []
  addEntry(entries, 'mimetype', bytes('application/vnd.ppte+zip'))
  addEntry(entries, 'document.json', bytes(canonicalJsonString(document)))
  addEntry(entries, 'assets/index.json', bytes(canonicalJsonString(document.assets)))
  addEntry(entries, 'fonts/index.json', bytes(canonicalJsonString(document.fonts)))
  const recent = options.recentTransactions ?? []
  if (options.clean && recent.length) throw new Error('CHECKPOINT_FAILED: clean checkpoint cannot contain recent history')
  for (const [index, transaction] of recent.entries()) {
    const transactionIssues = validateTransactionShape(transaction).filter((issue) => issue.severity === 'error')
    if (transactionIssues.length) throw new Error(`CHECKPOINT_FAILED: invalid recent transaction ${index + 1}: ${transactionIssues.map((issue) => issue.message).join('; ')}`)
  }
  addEntry(entries, 'history/descriptor.json', bytes(canonicalJsonString({ mode: options.clean ? 'clean' : 'standard', snapshotRevision: revision, recentTransactionCount: options.clean ? 0 : recent.length, deepHistoryExternal: !options.clean })))
  if (!options.clean && recent.length) addEntry(entries, 'history/recent.jsonl', bytes(recent.map((transaction) => canonicalJsonString(transaction)).join('\n') + '\n'))
  for (const [assetId, data] of Object.entries(options.assetBytes ?? {})) {
    const asset = document.assets[assetId]
    if (!asset) throw new Error(`ASSET_MISSING: ${assetId}`)
    if (data.length !== asset.byteLength || normalizeHash(asset.hash) !== sha256Binary(data)) throw new Error(`ASSET_HASH_MISMATCH: ${assetId}`)
    addEntry(entries, safePackagePath(asset.path, `assets/${assetId}`, 'assets/'), data)
  }
  for (const asset of Object.values(document.assets)) {
    const data = options.assetBytes?.[asset.id] ?? options.cas?.get(asset.hash)
    if (!data) throw new Error(`ASSET_MISSING: checkpoint requires bytes for ${asset.id}`)
    if (!options.assetBytes?.[asset.id]) {
      if (data.length !== asset.byteLength || normalizeHash(asset.hash) !== sha256Binary(data)) throw new Error(`ASSET_HASH_MISMATCH: ${asset.id}`)
      addEntry(entries, safePackagePath(asset.path, `assets/${asset.id}`, 'assets/'), data)
    }
  }
  for (const [fontId, data] of Object.entries(options.fontBytes ?? {})) {
    const font = document.fonts[fontId]
    if (!font) throw new Error(`FONT_MISSING: ${fontId}`)
    if (font.hash && normalizeHash(font.hash) !== sha256Binary(data)) throw new Error(`FONT_HASH_MISMATCH: ${fontId}`)
    addEntry(entries, safePackagePath(font.path ?? `fonts/${fontId}.woff2`, `fonts/${fontId}.woff2`, 'fonts/'), data)
  }
  for (const font of Object.values(document.fonts)) {
    if (font.source !== 'embedded') continue
    const data = options.fontBytes?.[font.id] ?? (font.hash ? options.cas?.get(font.hash) : undefined)
    if (!data) throw new Error(`FONT_MISSING: checkpoint requires bytes for ${font.id}`)
    if (font.hash && normalizeHash(font.hash) !== sha256Binary(data)) throw new Error(`FONT_HASH_MISMATCH: ${font.id}`)
    if (!options.fontBytes?.[font.id]) addEntry(entries, safePackagePath(font.path ?? `fonts/${font.id}.woff2`, `fonts/${font.id}.woff2`, 'fonts/'), data)
  }
  const files = entries.filter((entry) => entry.name !== 'mimetype').map((entry) => ({ path: entry.name, mediaType: mediaTypeFor(entry.name), byteLength: entry.data.length, sha256: sha256Binary(entry.data), required: entry.name === 'document.json' }))
  const manifest: PpteManifest = {
    format: 'ppte',
    formatVersion: '2',
    schemaVersion: '2.0.0',
    operationProtocolVersion: '1.0',
    compatibilityProfile,
    documentId: document.documentId,
    contentRevision: revision,
    title: document.metadata.title,
    createdAt: document.metadata.createdAt ?? timestamp,
    updatedAt: timestamp,
    requiredWidgets: document.widgetRequirements ?? [],
    clean: options.clean ?? false,
    files,
    history: { mode: options.clean ? 'clean' : 'standard', snapshotRevision: revision, recentTransactionCount: options.clean ? 0 : recent.length, deepHistoryExternal: !options.clean },
  }
  validateManifest(manifest)
  addEntry(entries, 'manifest.json', bytes(canonicalJsonString(manifest)))
  const archive = writeZip(entries)
  hitFault(options, 'checkpoint.build')
  readZip(archive)
  return archive
}

export function cleanDocumentSnapshot(document: PpteDocument): PpteDocument {
  const cleaned = JSON.parse(canonicalJsonString(document)) as PpteDocument
  for (const slide of Object.values(cleaned.slides)) if (slide.notes?.private !== undefined) {
    const notes = { ...slide.notes }
    delete notes.private
    slide.notes = Object.keys(notes).length ? notes : undefined
  }
  return cleaned
}

export function validateManifest(manifest: PpteManifest): void {
  if (!manifest || typeof manifest !== 'object') throw new Error('CHECKPOINT_FAILED: manifest must be an object')
  if (manifest.format !== PPTE_FORMAT || manifest.formatVersion !== PPTE_FORMAT_VERSION || manifest.schemaVersion !== PPTE_SCHEMA_VERSION) throw new Error('CHECKPOINT_FAILED: unsupported manifest format or schema version')
  const compatibility = checkCompatibility(manifest)
  if (!compatibility.ok || compatibility.disposition !== 'native') throw new Error(`CHECKPOINT_FAILED: ${compatibility.issues[0]?.code ?? 'COMPATIBILITY_PROFILE_UNSUPPORTED'}`)
  if (typeof manifest.documentId !== 'string' || !manifest.documentId || typeof manifest.contentRevision !== 'string' || !/^sha256-[0-9a-fA-F]{64}$/.test(manifest.contentRevision)) throw new Error('CHECKPOINT_FAILED: invalid manifest identity or revision')
  if (typeof manifest.title !== 'string' || typeof manifest.createdAt !== 'string' || typeof manifest.updatedAt !== 'string' || typeof manifest.clean !== 'boolean' || !Array.isArray(manifest.requiredWidgets) || !Array.isArray(manifest.files)) throw new Error('CHECKPOINT_FAILED: invalid manifest metadata')
  for (const requirement of manifest.requiredWidgets) if (!requirement || typeof requirement !== 'object' || typeof requirement.type !== 'string' || !requirement.type || typeof requirement.versionRange !== 'string' || !requirement.versionRange || requirement.fallbackRequired !== true) throw new Error('CHECKPOINT_FAILED: invalid required widget declaration')
  const paths = new Set<string>()
  for (const entry of manifest.files) {
    if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string' || !entry.path || paths.has(entry.path) || typeof entry.mediaType !== 'string' || !entry.mediaType || !Number.isInteger(entry.byteLength) || entry.byteLength < 0 || entry.byteLength > MAX_ENTRY_BYTES || typeof entry.sha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(entry.sha256) || typeof entry.required !== 'boolean') throw new Error('CHECKPOINT_FAILED: invalid manifest file entry')
    validatePackagePath(entry.path)
    if (entry.path === 'mimetype' || entry.path === 'manifest.json') throw new Error('CHECKPOINT_FAILED: manifest cannot list reserved package entries')
    if (entry.path !== 'document.json' && !/^(assets|fonts|history)\//.test(entry.path)) throw new Error(`CHECKPOINT_FAILED: unsupported manifest file path ${entry.path}`)
    paths.add(entry.path)
  }
  if (manifest.history) {
    if (!['standard', 'audit', 'clean'].includes(manifest.history.mode) || (manifest.history.snapshotRevision !== undefined && manifest.history.snapshotRevision !== manifest.contentRevision) || (manifest.history.recentTransactionCount !== undefined && (!Number.isInteger(manifest.history.recentTransactionCount) || manifest.history.recentTransactionCount < 0))) throw new Error('CHECKPOINT_FAILED: invalid manifest history descriptor')
    if (manifest.clean && manifest.history.mode !== 'clean') throw new Error('CHECKPOINT_FAILED: clean checkpoint has a non-clean history descriptor')
  }
}

function readRecentTransactions(archive: Map<string, Uint8Array>, manifest: PpteManifest): Transaction[] {
  const expected = manifest.history?.recentTransactionCount ?? 0
  const data = archive.get('history/recent.jsonl')
  if (!data) {
    if (expected !== 0) throw new Error('CHECKPOINT_FAILED: history descriptor requires recent.jsonl')
    return []
  }
  if (manifest.clean) throw new Error('CHECKPOINT_FAILED: clean checkpoint contains recent history')
  const transactions: Transaction[] = []
  for (const [index, line] of new TextDecoder().decode(data).split('\n').filter(Boolean).entries()) {
    let transaction: Transaction
    try { transaction = JSON.parse(line) as Transaction } catch (cause) { throw new Error(`CHECKPOINT_FAILED: invalid history transaction ${index + 1}: ${cause instanceof Error ? cause.message : String(cause)}`) }
    const issues = validateTransactionShape(transaction).filter((issue) => issue.severity === 'error')
    if (issues.length) throw new Error(`CHECKPOINT_FAILED: invalid history transaction ${index + 1}: ${issues.map((issue) => issue.message).join('; ')}`)
    transactions.push(transaction)
  }
  if (transactions.length !== expected) throw new Error(`CHECKPOINT_FAILED: history count ${transactions.length} does not match descriptor ${expected}`)
  return transactions
}

export function checkpointAdapter(): { write(document: PpteDocument, target: string, options?: CheckpointWriteOptions, recentTransactions?: ReadonlyArray<Transaction>): CheckpointResult } {
  return {
    write: (document, target, options = {}, recentTransactions) => writeCheckpoint(document, target, {
      ...options,
      recentTransactions: recentTransactions?.length ? [...recentTransactions] : options.recentTransactions,
    }),
  }
}

interface ZipEntry {
  name: string
  data: Uint8Array
}

export interface StoredZipEntry {
  name: string
  data: Uint8Array
}

function addEntry(entries: ZipEntry[], name: string, data: Uint8Array) {
  if (entries.some((entry) => entry.name === name)) throw new Error(`CHECKPOINT_FAILED: duplicate package entry ${name}`)
  entries.push({ name, data: new Uint8Array(data) })
}

function writeZip(entries: ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = bytes(entry.name)
    const crc = crc32(entry.data)
    const local = new Uint8Array(30 + name.length + entry.data.length)
    writeU32(local, 0, 0x04034b50)
    writeU16(local, 4, 20)
    writeU16(local, 6, 0)
    writeU16(local, 8, 0)
    writeU16(local, 10, 0)
    writeU16(local, 12, 0)
    writeU32(local, 14, crc)
    writeU32(local, 18, entry.data.length)
    writeU32(local, 22, entry.data.length)
    writeU16(local, 26, name.length)
    writeU16(local, 28, 0)
    local.set(name, 30)
    local.set(entry.data, 30 + name.length)
    localParts.push(local)

    const central = new Uint8Array(46 + name.length)
    writeU32(central, 0, 0x02014b50)
    writeU16(central, 4, 20)
    writeU16(central, 6, 20)
    writeU16(central, 8, 0)
    writeU16(central, 10, 0)
    writeU16(central, 12, 0)
    writeU16(central, 14, 0)
    writeU32(central, 16, crc)
    writeU32(central, 20, entry.data.length)
    writeU32(central, 24, entry.data.length)
    writeU16(central, 28, name.length)
    writeU16(central, 30, 0)
    writeU16(central, 32, 0)
    writeU16(central, 34, 0)
    writeU16(central, 36, 0)
    writeU32(central, 38, 0)
    writeU32(central, 42, offset)
    central.set(name, 46)
    centralParts.push(central)
    offset += local.length
  }
  const centralOffset = offset
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  writeU32(end, 0, 0x06054b50)
  writeU16(end, 4, 0)
  writeU16(end, 6, 0)
  writeU16(end, 8, entries.length)
  writeU16(end, 10, entries.length)
  writeU32(end, 12, centralSize)
  writeU32(end, 16, centralOffset)
  writeU16(end, 20, 0)
  return concat([...localParts, ...centralParts, end])
}

export function writeStoredZip(entries: StoredZipEntry[]): Uint8Array {
  return writeZip(entries)
}

function readZip(data: Uint8Array): Map<string, Uint8Array> {
  if (data.length > MAX_ARCHIVE_BYTES) throw new Error('CHECKPOINT_FAILED: ZIP archive exceeds size limit')
  const result = new Map<string, Uint8Array>()
  const end = findEndOfCentralDirectory(data)
  const commentLength = readU16(data, end + 20)
  if (end + 22 + commentLength !== data.length) throw new Error('CHECKPOINT_FAILED: ZIP has trailing data or an invalid comment length')
  if (readU16(data, end + 4) !== 0 || readU16(data, end + 6) !== 0) throw new Error('CHECKPOINT_FAILED: multi-disk ZIP is not supported')
  const count = readU16(data, end + 10)
  if (readU16(data, end + 8) !== count) throw new Error('CHECKPOINT_FAILED: ZIP entry counts do not match')
  const centralSize = readU32(data, end + 12)
  const centralOffset = readU32(data, end + 16)
  if (count > MAX_ARCHIVE_ENTRIES || centralOffset > data.length || centralSize > data.length - centralOffset) throw new Error('CHECKPOINT_FAILED: unsafe ZIP directory')
  const centralEnd = centralOffset + centralSize
  if (centralEnd !== end) throw new Error('CHECKPOINT_FAILED: ZIP central directory is not adjacent to the end record')
  let cursor = centralOffset
  let totalUncompressed = 0
  const localRanges: Array<{ start: number; end: number }> = []
  for (let index = 0; index < count; index += 1) {
    if (cursor > centralEnd || centralEnd - cursor < 46) throw new Error('CHECKPOINT_FAILED: truncated ZIP central directory')
    if (readU32(data, cursor) !== 0x02014b50) throw new Error('CHECKPOINT_FAILED: invalid ZIP central directory')
    const method = readU16(data, cursor + 10)
    const flags = readU16(data, cursor + 8)
    const compressedSize = readU32(data, cursor + 20)
    const uncompressedSize = readU32(data, cursor + 24)
    const nameLength = readU16(data, cursor + 28)
    const extraLength = readU16(data, cursor + 30)
    const commentLength = readU16(data, cursor + 32)
    const localOffset = readU32(data, cursor + 42)
    const centralNameStart = cursor + 46
    const centralEntryLength = 46 + nameLength + extraLength + commentLength
    if (centralEntryLength > centralEnd - cursor || centralNameStart + nameLength > centralEnd) throw new Error('CHECKPOINT_FAILED: truncated ZIP central entry')
    const name = new TextDecoder().decode(data.slice(cursor + 46, cursor + 46 + nameLength))
    validatePackagePath(name)
    if (result.has(name)) throw new Error(`CHECKPOINT_FAILED: duplicate ZIP entry ${name}`)
    if (flags !== 0 || method !== 0 || compressedSize !== uncompressedSize || compressedSize > MAX_ENTRY_BYTES) throw new Error('CHECKPOINT_FAILED: only bounded stored ZIP entries are supported')
    totalUncompressed += uncompressedSize
    if (totalUncompressed > MAX_ARCHIVE_BYTES) throw new Error('CHECKPOINT_FAILED: ZIP uncompressed size exceeds limit')
    if (localOffset > data.length || data.length - localOffset < 30) throw new Error('CHECKPOINT_FAILED: truncated ZIP local header')
    if (readU32(data, localOffset) !== 0x04034b50) throw new Error('CHECKPOINT_FAILED: invalid ZIP local header')
    if (readU16(data, localOffset + 6) !== 0 || readU16(data, localOffset + 8) !== 0) throw new Error('CHECKPOINT_FAILED: unsupported ZIP local flags or method')
    const localNameLength = readU16(data, localOffset + 26)
    const localExtraLength = readU16(data, localOffset + 28)
    const localNameStart = localOffset + 30
    const start = localNameStart + localNameLength + localExtraLength
    if (localNameStart + localNameLength > data.length || start < localNameStart || start > data.length) throw new Error('CHECKPOINT_FAILED: truncated ZIP local entry')
    const localName = new TextDecoder().decode(data.slice(localNameStart, localNameStart + localNameLength))
    if (localName !== name) throw new Error('CHECKPOINT_FAILED: ZIP central/local name mismatch')
    if (readU32(data, localOffset + 18) !== compressedSize || readU32(data, localOffset + 22) !== uncompressedSize) throw new Error('CHECKPOINT_FAILED: ZIP size mismatch')
    const endOffset = start + compressedSize
    if (endOffset < start || endOffset > centralOffset) throw new Error('CHECKPOINT_FAILED: ZIP entry overlaps the central directory')
    if (localRanges.some((range) => start < range.end && endOffset > range.start)) throw new Error('CHECKPOINT_FAILED: ZIP local entries overlap')
    localRanges.push({ start: localOffset, end: endOffset })
    const content = data.slice(start, endOffset)
    const crc = readU32(data, cursor + 16)
    if (crc32(content) !== crc) throw new Error(`CHECKPOINT_FAILED: ZIP CRC mismatch: ${name}`)
    result.set(name, new Uint8Array(content))
    cursor += centralEntryLength
  }
  if (cursor !== centralEnd) throw new Error('CHECKPOINT_FAILED: ZIP central directory size mismatch')
  return result
}

export function readStoredZip(data: Uint8Array): Map<string, Uint8Array> {
  return readZip(data)
}

function parseJson<T>(archive: Map<string, Uint8Array>, name: string): T {
  const data = archive.get(name)
  if (!data) throw new Error(`CHECKPOINT_FAILED: missing ${name}`)
  try {
    return JSON.parse(new TextDecoder().decode(data)) as T
  } catch (cause) {
    throw new Error(`CHECKPOINT_FAILED: invalid ${name}: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}
function safePackagePath(path: string, fallback: string, requiredPrefix: string): string {
  validatePackagePath(path)
  if (!path.startsWith(requiredPrefix)) throw new Error(`CHECKPOINT_FAILED: package path must start with ${requiredPrefix}: ${path}`)
  return path || fallback
}
function validatePackagePath(path: string) {
  if (!path || path.startsWith('/') || path.includes('..') || path.includes('\\') || path.includes('\u0000')) throw new Error(`CHECKPOINT_FAILED: unsafe package path ${path}`)
}
function mediaTypeFor(path: string): string {
  if (path.endsWith('.json')) return 'application/json'
  if (path.endsWith('.jsonl')) return 'application/x-ndjson'
  if (path.endsWith('.woff2')) return 'font/woff2'
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
  if (path.endsWith('.webp')) return 'image/webp'
  return 'application/octet-stream'
}
function normalizeHash(hash: string): string {
  return (hash.startsWith('sha256-') ? hash.slice('sha256-'.length) : hash).toLowerCase()
}
function sha256Binary(data: Uint8Array): string { return createHash('sha256').update(data).digest('hex') }
function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}
function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.length }
  return result
}
function writeU16(buffer: Uint8Array, offset: number, value: number) { buffer[offset] = value & 0xff; buffer[offset + 1] = (value >>> 8) & 0xff }
function writeU32(buffer: Uint8Array, offset: number, value: number) { buffer[offset] = value & 0xff; buffer[offset + 1] = (value >>> 8) & 0xff; buffer[offset + 2] = (value >>> 16) & 0xff; buffer[offset + 3] = (value >>> 24) & 0xff }
function readU16(buffer: Uint8Array, offset: number): number { return buffer[offset] | (buffer[offset + 1] << 8) }
function readU32(buffer: Uint8Array, offset: number): number { return (buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16) | (buffer[offset + 3] << 24)) >>> 0 }
function findEndOfCentralDirectory(data: Uint8Array): number {
  for (let index = data.length - 22; index >= Math.max(0, data.length - 65557); index -= 1) if (readU32(data, index) === 0x06054b50) return index
  throw new Error('CHECKPOINT_FAILED: ZIP end record not found')
}
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]!
  return (crc ^ 0xffffffff) >>> 0
}
function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
    table[index] = value >>> 0
  }
  return table
}
function fsyncDirectory(path: string) {
  try { const descriptor = openSync(path, 'r'); fsyncSync(descriptor); closeSync(descriptor) } catch { /* unsupported on some platforms */ }
}
function pause(milliseconds: number) {
  const shared = new SharedArrayBuffer(4)
  Atomics.wait(new Int32Array(shared), 0, 0, milliseconds)
}

function hitFault(options: CheckpointWriteOptions, point: FaultPoint): void {
  if (point === 'checkpoint.before-rename' && options.fault === 'before-rename') throw new Error('CHECKPOINT_FAULT_BEFORE_RENAME')
  if (point === 'checkpoint.after-rename' && options.fault === 'after-rename') throw new Error('CHECKPOINT_FAULT_AFTER_RENAME')
  if (options.fault === point) throw new Error(`CHECKPOINT_FAULT_INJECTED: ${point}`)
  options.faultInjector?.hit(point)
}

export type { ValidationIssue }
