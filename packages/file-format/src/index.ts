import { existsSync, fsyncSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'
import { canonicalJsonString, canonicalRevision, sha256HexBytes } from '../../canonical-json/src/index.js'
import { validateRuntimeDocument } from '../../validation/src/index.js'
import type { PpteDocument, PpteManifest, Revision, Transaction, ValidationIssue } from '../../schema/src/index.js'

export interface CheckpointWriteOptions {
  timestamp?: string
  clean?: boolean
  recentTransactions?: Transaction[]
  assetBytes?: Record<string, Uint8Array>
  fontBytes?: Record<string, Uint8Array>
  fault?: 'before-rename' | 'after-rename'
  readyFile?: string
  pauseBeforeRenameMs?: number
}

export interface CheckpointResult {
  revision: Revision
  path: string
  bytes: number
}

export interface OpenCheckpointResult {
  document: PpteDocument
  manifest: PpteManifest
}

export class PpteFileService {
  write(document: PpteDocument, target: string, options: CheckpointWriteOptions = {}): CheckpointResult {
    return writeCheckpoint(document, target, options)
  }

  open(target: string): OpenCheckpointResult {
    return openCheckpoint(target)
  }

  clearRecovery(): void {
    // Recovery is owned by RecoveryJournal. This no-op makes the service fit
    // the Core checkpoint adapter without coupling the packages.
  }
}

export function writeCheckpoint(document: PpteDocument, target: string, options: CheckpointWriteOptions = {}): CheckpointResult {
  const issues = validateRuntimeDocument(document).filter((issue) => issue.severity === 'error')
  if (issues.length) throw new Error(issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n'))
  const revision = canonicalRevision(document)
  const timestamp = options.timestamp ?? new Date().toISOString()
  const entries: ZipEntry[] = []
  addEntry(entries, 'mimetype', bytes('application/vnd.ppte+zip'))
  addEntry(entries, 'document.json', bytes(canonicalJsonString(document)))
  addEntry(entries, 'assets/index.json', bytes(canonicalJsonString(document.assets)))
  addEntry(entries, 'fonts/index.json', bytes(canonicalJsonString(document.fonts)))
  const recent = options.recentTransactions ?? []
  addEntry(entries, 'history/descriptor.json', bytes(canonicalJsonString({ mode: options.clean ? 'clean' : 'standard', snapshotRevision: revision, recentTransactionCount: options.clean ? 0 : recent.length, deepHistoryExternal: !options.clean })))
  if (!options.clean && recent.length) addEntry(entries, 'history/recent.jsonl', bytes(recent.map((transaction) => canonicalJsonString(transaction)).join('\n') + '\n'))
  for (const [assetId, data] of Object.entries(options.assetBytes ?? {})) {
    const asset = document.assets[assetId]
    if (!asset) throw new Error(`ASSET_MISSING: ${assetId}`)
    if (data.length !== asset.byteLength || normalizeHash(asset.hash) !== sha256HexBytes(data)) throw new Error(`ASSET_HASH_MISMATCH: ${assetId}`)
    addEntry(entries, safePackagePath(asset.path, `assets/${assetId}`, 'assets/'), data)
  }
  for (const asset of Object.values(document.assets)) if (!options.assetBytes?.[asset.id]) throw new Error(`ASSET_MISSING: checkpoint requires bytes for ${asset.id}`)
  for (const [fontId, data] of Object.entries(options.fontBytes ?? {})) {
    const font = document.fonts[fontId]
    if (!font) throw new Error(`FONT_MISSING: ${fontId}`)
    if (font.hash && normalizeHash(font.hash) !== sha256HexBytes(data)) throw new Error(`ASSET_HASH_MISMATCH: ${fontId}`)
    addEntry(entries, safePackagePath(font.path ?? `fonts/${fontId}.woff2`, `fonts/${fontId}.woff2`, 'fonts/'), data)
  }
  const files = entries.filter((entry) => entry.name !== 'mimetype').map((entry) => ({ path: entry.name, mediaType: mediaTypeFor(entry.name), byteLength: entry.data.length, sha256: sha256HexBytes(entry.data), required: entry.name === 'document.json' }))
  const manifest: PpteManifest = {
    format: 'ppte',
    formatVersion: '2',
    schemaVersion: '2.0.0',
    operationProtocolVersion: '1.0',
    compatibilityProfile: 'ppte-2.0-week1-2.1',
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
  addEntry(entries, 'manifest.json', bytes(canonicalJsonString(manifest)))
  const archive = writeZip(entries)
  // Validate the exact bytes that are about to become the checkpoint before
  // any rename can make them visible to a reader.
  readZip(archive)
  mkdirSync(dirname(target), { recursive: true })
  const temporary = join(dirname(target), `.${basename(target)}.${process.pid}.${Date.now()}.tmp`)
  let descriptor: number | undefined
  try {
    descriptor = openSync(temporary, 'w', 0o600)
    writeFileSync(descriptor, archive)
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    if (options.readyFile) writeFileSync(options.readyFile, 'checkpoint-ready\n', { mode: 0o600 })
    if (options.pauseBeforeRenameMs) pause(options.pauseBeforeRenameMs)
    if (options.fault === 'before-rename') throw new Error('CHECKPOINT_FAULT_BEFORE_RENAME')
    renameSync(temporary, target)
    fsyncDirectory(dirname(target))
    if (options.fault === 'after-rename') throw new Error('CHECKPOINT_FAULT_AFTER_RENAME')
    return { revision, path: target, bytes: archive.length }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

export function openCheckpoint(target: string): OpenCheckpointResult {
  const archive = readZip(new Uint8Array(readFileSync(target)))
  if (new TextDecoder().decode(archive.get('mimetype') ?? new Uint8Array()) !== 'application/vnd.ppte+zip') throw new Error('CHECKPOINT_FAILED: invalid mimetype')
  const manifest = parseJson<PpteManifest>(archive, 'manifest.json')
  const document = parseJson<PpteDocument>(archive, 'document.json')
  const issues = validateRuntimeDocument(document).filter((issue) => issue.severity === 'error')
  if (issues.length) throw new Error(issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n'))
  if (manifest.documentId !== document.documentId) throw new Error('CHECKPOINT_FAILED: manifest/document documentId mismatch')
  const revision = canonicalRevision(document)
  if (manifest.contentRevision !== revision) throw new Error(`CHECKPOINT_FAILED: manifest revision ${manifest.contentRevision} does not match document ${revision}`)
  for (const entry of manifest.files ?? []) {
    const data = archive.get(entry.path)
    if (!data) throw new Error(`CHECKPOINT_FAILED: manifest file is missing: ${entry.path}`)
    if (data.length !== entry.byteLength || sha256HexBytes(data) !== entry.sha256) throw new Error(`CHECKPOINT_FAILED: manifest hash mismatch: ${entry.path}`)
  }
  for (const asset of Object.values(document.assets)) {
    const data = archive.get(safePackagePath(asset.path, `assets/${asset.id}`, 'assets/'))
    if (!data || data.length !== asset.byteLength || normalizeHash(asset.hash) !== sha256HexBytes(data)) throw new Error(`ASSET_HASH_MISMATCH: ${asset.id}`)
  }
  return { document, manifest }
}

export function checkpointAdapter(): { write(document: PpteDocument, target: string, options?: CheckpointWriteOptions): CheckpointResult } {
  return { write: writeCheckpoint }
}

interface ZipEntry {
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

function readZip(data: Uint8Array): Map<string, Uint8Array> {
  const result = new Map<string, Uint8Array>()
  const end = findEndOfCentralDirectory(data)
  const count = readU16(data, end + 10)
  const centralSize = readU32(data, end + 12)
  const centralOffset = readU32(data, end + 16)
  if (count > 10000 || centralOffset + centralSize > data.length) throw new Error('CHECKPOINT_FAILED: unsafe ZIP directory')
  let cursor = centralOffset
  for (let index = 0; index < count; index += 1) {
    if (readU32(data, cursor) !== 0x02014b50) throw new Error('CHECKPOINT_FAILED: invalid ZIP central directory')
    const method = readU16(data, cursor + 10)
    const compressedSize = readU32(data, cursor + 20)
    const uncompressedSize = readU32(data, cursor + 24)
    const nameLength = readU16(data, cursor + 28)
    const extraLength = readU16(data, cursor + 30)
    const commentLength = readU16(data, cursor + 32)
    const localOffset = readU32(data, cursor + 42)
    const name = new TextDecoder().decode(data.slice(cursor + 46, cursor + 46 + nameLength))
    validatePackagePath(name)
    if (result.has(name)) throw new Error(`CHECKPOINT_FAILED: duplicate ZIP entry ${name}`)
    if (method !== 0 || compressedSize !== uncompressedSize) throw new Error('CHECKPOINT_FAILED: only stored ZIP entries are supported')
    if (readU32(data, localOffset) !== 0x04034b50) throw new Error('CHECKPOINT_FAILED: invalid ZIP local header')
    const localNameLength = readU16(data, localOffset + 26)
    const localExtraLength = readU16(data, localOffset + 28)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const endOffset = start + compressedSize
    if (endOffset > data.length) throw new Error('CHECKPOINT_FAILED: ZIP entry exceeds file')
    const content = data.slice(start, endOffset)
    const crc = readU32(data, cursor + 16)
    if (crc32(content) !== crc) throw new Error(`CHECKPOINT_FAILED: ZIP CRC mismatch: ${name}`)
    result.set(name, new Uint8Array(content))
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return result
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
  try {
    validatePackagePath(path)
    if (!path.startsWith(requiredPrefix)) throw new Error('wrong package directory')
    return path
  } catch {
    return fallback
  }
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
  return hash.startsWith('sha256-') ? hash.slice('sha256-'.length) : hash
}
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
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function fsyncDirectory(path: string) {
  try { const descriptor = openSync(path, 'r'); fsyncSync(descriptor); closeSync(descriptor) } catch { /* unsupported on some platforms */ }
}
function pause(milliseconds: number) {
  const shared = new SharedArrayBuffer(4)
  Atomics.wait(new Int32Array(shared), 0, 0, milliseconds)
}

export type { ValidationIssue }
