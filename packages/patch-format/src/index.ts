import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { canonicalHash, canonicalJsonString, canonicalRevision, sha256HexBytes } from '../../canonical-json/src/index.js'
import { checkCompatibility } from '../../compatibility/src/index.js'
import { withErrorSemantics } from '../../schema/src/errors.js'
import { applyTransaction } from '../../operations/src/index.js'
import { computeStructuralDiff } from '../../diff/src/index.js'
import { enforceChangeContract } from '../../change-contract/src/index.js'
import { validateRuntimeDocument, validateTransactionShape } from '../../validation/src/index.js'
import { readStoredZip, writeStoredZip } from '../../archive/src/index.js'
import { PPTE_OPERATION_PROTOCOL_VERSION, type Actor, type FileEntry, type Operation, type PpteDocument, type PptePatch, type PatchManifest, type Transaction, type ValidationIssue } from '../../schema/src/index.js'

export interface PatchApplyResult {
  ok: boolean
  document?: PpteDocument
  revision?: string
  inverseOperations?: Operation[]
  issues: ValidationIssue[]
}

export interface PatchValidationResult {
  ok: boolean
  issues: ValidationIssue[]
}

const PATCH_MIMETYPE = 'application/vnd.ppte.patch+zip'

/** Encode a patch as the stored ZIP package defined by the PPTe review protocol. */
export function encodePatch(patch: PptePatch): Uint8Array {
  const inputValidation = validatePatch(patch)
  if (!inputValidation.ok) throw new Error(inputValidation.issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n'))
  assertSafePatchValue(patch.metadata, '$.metadata')
  assertSafePatchValue(patch.assetMetadata, '$.assetMetadata')
  assertSafePatchValue(patch.fontMetadata, '$.fontMetadata')
  const entries: Array<{ name: string; data: Uint8Array }> = []
  add(entries, 'mimetype', text(PATCH_MIMETYPE))
  const operations = guardPatchOperations(patch.operations, patch.manifest.baseRevision).map((operation) => {
    assertSafePatchValue(operation)
    return canonicalJsonString(operation)
  }).join('\n') + (patch.operations.length ? '\n' : '')
  add(entries, 'operations.jsonl', text(operations))
  const assetFiles: Record<string, string> = {}
  for (const [assetId, data] of Object.entries(patch.assets ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    const path = `assets/${safeDigest(patch.assetMetadata?.[assetId]?.hash ?? sha256HexBytes(data))}.${assetExtension(patch.assetMetadata?.[assetId]?.mimeType, patch.assetMetadata?.[assetId]?.path)}`
    assetFiles[assetId] = path
    if (!entries.some((entry) => entry.name === path)) add(entries, path, data)
  }
  const fontFiles: Record<string, string> = {}
  for (const [fontId, data] of Object.entries(patch.fonts ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    const path = `fonts/${safeDigest(patch.fontMetadata?.[fontId]?.hash ?? sha256HexBytes(data))}.woff2`
    fontFiles[fontId] = path
    if (!entries.some((entry) => entry.name === path)) add(entries, path, data)
  }
  if (patch.assetMetadata && Object.keys(patch.assetMetadata).length) add(entries, 'asset-metadata.json', text(canonicalJsonString(patch.assetMetadata)))
  if (patch.fontMetadata && Object.keys(patch.fontMetadata).length) add(entries, 'font-metadata.json', text(canonicalJsonString(patch.fontMetadata)))
  if (patch.metadata && Object.keys(patch.metadata).length) add(entries, 'metadata.json', text(canonicalJsonString(patch.metadata)))
  const files: FileEntry[] = entries.filter((entry) => entry.name !== 'mimetype').map((entry) => ({ path: entry.name, mediaType: mediaTypeFor(entry.name), byteLength: entry.data.length, sha256: sha256HexBytes(entry.data), required: entry.name === 'operations.jsonl' }))
  const manifest: PatchManifest = {
    ...patch.manifest,
    operationProtocolVersion: patch.manifest.operationProtocolVersion || PPTE_OPERATION_PROTOCOL_VERSION,
    files,
    assetFiles: Object.keys(assetFiles).length ? assetFiles : undefined,
    fontFiles: Object.keys(fontFiles).length ? fontFiles : undefined,
  }
  validatePatchManifest(manifest)
  add(entries, 'patch-manifest.json', text(canonicalJsonString(manifest)))
  return writeStoredZip(entries)
}

export function decodePatch(data: Uint8Array): PptePatch {
  let archive: Map<string, Uint8Array>
  try {
    archive = readStoredZip(data)
  } catch (cause) {
    throw new Error(`PATCH_INVALID: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (decodeText(archive.get('mimetype')) !== PATCH_MIMETYPE) throw new Error('PATCH_INVALID: invalid mimetype')
  const manifest = parseJson<PatchManifest>(archive, 'patch-manifest.json')
  validatePatchManifest(manifest)
  const expected = new Set(['mimetype', 'patch-manifest.json', ...manifest.files.map((file) => file.path)])
  for (const path of archive.keys()) if (!expected.has(path)) throw new Error(`PATCH_INVALID: unlisted archive entry ${path}`)
  for (const file of manifest.files) {
    const value = archive.get(file.path)
    if (!value) throw new Error(`PATCH_INVALID: missing manifest file ${file.path}`)
    if (value.length !== file.byteLength || sha256HexBytes(value) !== file.sha256) throw new Error(`PATCH_INVALID: hash mismatch ${file.path}`)
  }
  const operations = decodeText(archive.get('operations.jsonl')).split('\n').filter(Boolean).map((line) => parseJsonValue(line) as Operation)
  const patch: PptePatch = {
    manifest,
    operations,
    assets: readBinaryMap(archive, manifest.assetFiles),
    fonts: readBinaryMap(archive, manifest.fontFiles),
    assetMetadata: parseOptionalJson<Record<string, PpteDocument['assets'][string]>>(archive, 'asset-metadata.json'),
    fontMetadata: parseOptionalJson<Record<string, PpteDocument['fonts'][string]>>(archive, 'font-metadata.json'),
    metadata: parseOptionalJson<Record<string, never>>(archive, 'metadata.json'),
  }
  const validation = validatePatch(patch)
  if (!validation.ok) throw new Error(validation.issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n'))
  return patch
}

export function validatePatch(patch: PptePatch): PatchValidationResult {
  if (!patch || typeof patch !== 'object') return { ok: false, issues: [error('PATCH_INVALID', 'Patch must be an object.')] }
  const issues: ValidationIssue[] = []
  try { validatePatchManifest(patch?.manifest, Array.isArray(patch?.manifest?.files) && patch.manifest.files.length > 0) } catch (cause) { issues.push(error('PATCH_INVALID', cause instanceof Error ? cause.message : String(cause))) }
  if (!Array.isArray(patch.operations) || patch.operations.length === 0) issues.push(error('PATCH_INVALID', 'A patch must contain at least one operation.'))
  else {
    try {
      const transaction = patchTransaction(patch.manifest.documentId, patch.manifest.baseRevision, patch.operations)
      issues.push(...validateTransactionShape(transaction).filter((issue) => issue.severity === 'error'))
    } catch (cause) { issues.push(error('PATCH_INVALID', cause instanceof Error ? cause.message : String(cause))) }
    for (const operation of patch.operations) {
      try { assertSafePatchValue(operation) } catch (cause) { issues.push(error('PATCH_PAYLOAD_UNSAFE', cause instanceof Error ? cause.message : String(cause))) }
    }
  }
  try {
    assertSafePatchValue(patch.metadata, '$.metadata')
    assertSafePatchValue(patch.assetMetadata, '$.assetMetadata')
    assertSafePatchValue(patch.fontMetadata, '$.fontMetadata')
  } catch (cause) { issues.push(error('PATCH_PAYLOAD_UNSAFE', cause instanceof Error ? cause.message : String(cause))) }
  for (const [assetId, data] of Object.entries(patch.assets ?? {})) {
    const asset = patch.assetMetadata?.[assetId]
    if (!asset) issues.push(error('ASSET_METADATA_MISSING', `Patch asset ${assetId} has no metadata.`))
    else if (asset.byteLength !== data.length || normalizeHash(asset.hash) !== sha256HexBytes(data)) issues.push(error('ASSET_HASH_MISMATCH', `Patch asset ${assetId} failed hash verification.`))
  }
  for (const [assetId, asset] of Object.entries(patch.assetMetadata ?? {})) if (!patch.assets?.[assetId]) issues.push(error('ASSET_PAYLOAD_MISSING', `Patch asset metadata ${assetId} has no binary payload.`))
  for (const [fontId, data] of Object.entries(patch.fonts ?? {})) {
    const font = patch.fontMetadata?.[fontId]
    if (!font) issues.push(error('FONT_METADATA_MISSING', `Patch font ${fontId} has no metadata.`))
    else if (font.hash && normalizeHash(font.hash) !== sha256HexBytes(data)) issues.push(error('FONT_HASH_MISMATCH', `Patch font ${fontId} failed hash verification.`))
  }
  for (const [fontId, font] of Object.entries(patch.fontMetadata ?? {})) if (font.source === 'embedded' && !patch.fonts?.[fontId]) issues.push(error('FONT_PAYLOAD_MISSING', `Embedded patch font ${fontId} has no binary payload.`))
  for (const operation of patch.operations ?? []) {
    if (operation.kind === 'asset.upsert' && !operation.remove && !patch.assets?.[operation.asset.id]) issues.push(error('ASSET_PAYLOAD_MISSING', `Asset operation ${operation.asset.id} has no binary payload.`))
    if (operation.kind === 'font.upsert' && !operation.remove && operation.font.source === 'embedded' && !patch.fonts?.[operation.font.id]) issues.push(error('FONT_PAYLOAD_MISSING', `Embedded font operation ${operation.font.id} has no binary payload.`))
  }
  return { ok: !issues.some((issue) => issue.severity === 'error'), issues: dedupe(issues) }
}

/** Apply after a three-way review has selected operations. Base revision is mandatory. */
export function applyPatchToDocument(document: PpteDocument, patch: PptePatch): PatchApplyResult {
  const validation = validatePatch(patch)
  if (!validation.ok) return { ok: false, issues: validation.issues }
  if (patch.manifest.documentId !== document.documentId) return { ok: false, issues: [error('PATCH_BASE_MISMATCH', 'Patch documentId does not match the target document.')] }
  const currentRevision = canonicalRevision(document)
  if (patch.manifest.baseRevision !== currentRevision) return { ok: false, issues: [error('PATCH_BASE_MISMATCH', `Patch base ${patch.manifest.baseRevision} does not match target revision ${currentRevision}.`)] }
  const operations = patchOperations(patch)
  const transaction = patchTransaction(document.documentId, currentRevision, operations, patch.manifest.actor)
  const shapeIssues = validateTransactionShape(transaction).filter((issue) => issue.severity === 'error')
  if (shapeIssues.length) return { ok: false, issues: shapeIssues }
  try {
    const applied = applyTransaction(document, transaction)
    const diff = computeStructuralDiff(document, applied.document)
    const contractIssues = enforceChangeContract(document, applied.document, transaction, diff)
    const runtimeIssues = validateRuntimeDocument(applied.document).filter((issue) => issue.severity === 'error')
    const issues = dedupe([...contractIssues, ...runtimeIssues])
    if (issues.some((issue) => issue.severity === 'error')) return { ok: false, issues }
    return { ok: true, document: applied.document, revision: canonicalRevision(applied.document), inverseOperations: applied.inverseOperations, issues: [] }
  } catch (cause) {
    return { ok: false, issues: [error('PATCH_APPLY_FAILED', cause instanceof Error ? cause.message : String(cause))] }
  }
}

export const applyPatch = applyPatchToDocument

export function patchOperations(patch: PptePatch): Operation[] {
  const assetOperations = new Set(patch.operations.filter((operation): operation is Extract<Operation, { kind: 'asset.upsert' }> => operation.kind === 'asset.upsert').map((operation) => operation.asset.id))
  const fontOperations = new Set(patch.operations.filter((operation): operation is Extract<Operation, { kind: 'font.upsert' }> => operation.kind === 'font.upsert').map((operation) => operation.font.id))
  const importedAssets: Operation[] = Object.values(patch.assetMetadata ?? {}).filter((asset) => !assetOperations.has(asset.id)).map((asset) => ({ opId: `patch:asset:${asset.id}`, kind: 'asset.upsert', asset }))
  const importedFonts: Operation[] = Object.values(patch.fontMetadata ?? {}).filter((font) => !fontOperations.has(font.id)).map((font) => ({ opId: `patch:font:${font.id}`, kind: 'font.upsert', font }))
  const resourceOperations = patch.operations.filter((operation) => operation.kind === 'asset.upsert' || operation.kind === 'font.upsert')
  const contentOperations = patch.operations.filter((operation) => operation.kind !== 'asset.upsert' && operation.kind !== 'font.upsert')
  return [...importedAssets, ...importedFonts, ...resourceOperations, ...contentOperations]
}

export function buildPatchTransaction(patch: PptePatch, actor: Actor = patch.manifest.actor ?? { type: 'reviewer', id: 'three-way-review' }): Transaction {
  return patchTransaction(patch.manifest.documentId, patch.manifest.baseRevision, patchOperations(patch), actor)
}

export function writePatch(target: string, patch: PptePatch): { path: string; bytes: number } {
  const data = encodePatch(patch)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, data)
  return { path: target, bytes: data.length }
}

export function readPatch(target: string): PptePatch {
  return decodePatch(new Uint8Array(readFileSync(target)))
}

export function patchTransaction(documentId: string, baseRevision: string, operations: Operation[], actor: Actor = { type: 'reviewer', id: 'three-way-review' }): Transaction {
  const guardedOperations = guardPatchOperations(operations, baseRevision)
  const allowedOperationKinds = [...new Set(guardedOperations.map((operation) => operation.kind))]
  return {
    transactionId: `patch:${canonicalHash({ documentId, baseRevision, operations }).slice(0, 20)}`,
    baseRevision,
    actor,
    scope: { kind: 'document', permissions: ['content', 'geometry', 'style', 'structure', 'theme', 'assets', 'facts', 'sources', 'notes', 'animation', 'review'], allowInsert: true, allowDelete: true },
    changeContract: {
      allowedOperationKinds,
      maxChangedSlides: Number.MAX_SAFE_INTEGER,
      maxChangedElements: Number.MAX_SAFE_INTEGER,
      maxInsertedElements: Number.MAX_SAFE_INTEGER,
      maxDeletedElements: Number.MAX_SAFE_INTEGER,
      maxReplacedAssets: Number.MAX_SAFE_INTEGER,
      maxChangedFacts: Number.MAX_SAFE_INTEGER,
      maxChangedSources: Number.MAX_SAFE_INTEGER,
      maxChangedThemeTokens: Number.MAX_SAFE_INTEGER,
      maxChangedStylePresets: Number.MAX_SAFE_INTEGER,
      requireConfirmation: true,
      userIntentSummary: 'Apply the explicitly selected reviewed operations from a revised copy.',
    },
    reason: 'Three-way semantic patch application',
    createdAt: '1970-01-01T00:00:00.000Z',
    validationLevel: 'L2',
    operations: guardedOperations,
  }
}

function guardPatchOperations(operations: Operation[], baseRevision: string): Operation[] {
  return operations.map((operation) => {
    const preconditions = operation.preconditions ?? []
    return preconditions.some((precondition) => precondition.kind === 'revision-equals')
      ? operation
      : { ...operation, preconditions: [...preconditions, { kind: 'revision-equals', revision: baseRevision }] }
  }) as Operation[]
}

function validatePatchManifest(manifest: PatchManifest, requireFiles = true): void {
  if (!manifest || typeof manifest !== 'object' || manifest.patchVersion !== '1' || !manifest.documentId || !manifest.baseRevision || !manifest.createdAt || !manifest.compatibilityProfile || !Array.isArray(manifest.files)) throw new Error('PATCH_INVALID: incomplete patch manifest')
  if (manifest.operationProtocolVersion !== PPTE_OPERATION_PROTOCOL_VERSION) throw new Error(`PATCH_INVALID: unsupported operation protocol ${manifest.operationProtocolVersion}`)
  const compatibility = checkCompatibility(manifest)
  if (!compatibility.ok || compatibility.disposition !== 'native') throw new Error(`PATCH_INVALID: ${compatibility.issues[0]?.code ?? 'COMPATIBILITY_PROFILE_UNSUPPORTED'}`)
  const paths = new Set<string>()
  for (const file of manifest.files ?? []) {
    if (!file.path || file.path.startsWith('/') || file.path.includes('..') || file.path.includes('\\') || paths.has(file.path)) throw new Error(`PATCH_INVALID: unsafe or duplicate file path ${file.path}`)
    paths.add(file.path)
    if (!Number.isInteger(file.byteLength) || file.byteLength < 0 || !file.sha256) throw new Error(`PATCH_INVALID: invalid file entry ${file.path}`)
  }
  if (requireFiles && !manifest.files.some((file) => file.path === 'operations.jsonl')) throw new Error('PATCH_INVALID: operations.jsonl is required')
  validateBinaryMap(manifest.assetFiles, 'assets/', paths)
  validateBinaryMap(manifest.fontFiles, 'fonts/', paths)
}

function validateBinaryMap(mapping: Record<string, string> | undefined, prefix: string, files: Set<string>) {
  if (mapping === undefined) return
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw new Error('PATCH_INVALID: binary file map must be an object')
  const mappedPaths = new Set<string>()
  for (const [id, path] of Object.entries(mapping)) {
    if (!id || !path || path.startsWith('/') || path.includes('..') || path.includes('\\') || !path.startsWith(prefix) || files.has(path) === false || mappedPaths.has(path)) throw new Error(`PATCH_INVALID: invalid binary file map entry ${id}`)
    mappedPaths.add(path)
  }
}

function add(entries: Array<{ name: string; data: Uint8Array }>, name: string, data: Uint8Array) {
  if (entries.some((entry) => entry.name === name)) throw new Error(`PATCH_INVALID: duplicate package entry ${name}`)
  entries.push({ name, data: new Uint8Array(data) })
}
function readBinaryMap(archive: Map<string, Uint8Array>, paths: Record<string, string> | undefined): Record<string, Uint8Array> | undefined {
  if (!paths) return undefined
  const result: Record<string, Uint8Array> = {}
  for (const [id, path] of Object.entries(paths)) {
    const data = archive.get(path)
    if (!data) throw new Error(`PATCH_INVALID: missing binary payload ${path}`)
    result[id] = new Uint8Array(data)
  }
  return result
}
function parseOptionalJson<T>(archive: Map<string, Uint8Array>, path: string): T | undefined {
  const data = archive.get(path)
  return data ? parseJsonValue(decodeText(data)) as T : undefined
}
function parseJson<T>(archive: Map<string, Uint8Array>, path: string): T {
  const data = archive.get(path)
  if (!data) throw new Error(`PATCH_INVALID: missing ${path}`)
  return parseJsonValue(decodeText(data)) as T
}
function parseJsonValue(value: string): unknown {
  try { return JSON.parse(value) as unknown } catch (cause) { throw new Error(`PATCH_INVALID: invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`) }
}
function assertSafePatchValue(value: unknown, path = '$') {
  if (value === undefined) return
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Non-finite number is not allowed at ${path}.`)
    return
  }
  if (typeof value === 'string') {
    if (/^javascript:/i.test(value) || /<\s*\/??script\b/i.test(value)) throw new Error(`Executable payload is not allowed at ${path}.`)
    return
  }
  if (Array.isArray(value)) { value.forEach((item, index) => assertSafePatchValue(item, `${path}[${index}]`)); return }
  if (typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    if (['code', 'script', 'html', 'command', 'eval', '__proto__'].includes(key.toLowerCase())) throw new Error(`Executable field ${path}.${key} is not allowed.`)
    assertSafePatchValue(child, `${path}.${key}`)
  } else throw new Error(`Non-JSON value is not allowed at ${path}.`)
}
function safeDigest(value: string): string {
  const digest = normalizeHash(value)
  if (!/^[0-9a-f]{64}$/i.test(digest)) throw new Error(`PATCH_INVALID: binary payload must use a SHA-256 digest: ${value}`)
  return digest.toLowerCase()
}
function assetExtension(mimeType: string | undefined, declaredPath: string | undefined): string {
  const fromPath = declaredPath?.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (fromPath) return fromPath.slice(0, 8)
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  if (mimeType === 'image/svg+xml') return 'svg'
  return 'bin'
}
function mediaTypeFor(path: string): string {
  if (path.endsWith('.json')) return 'application/json'
  if (path.endsWith('.jsonl')) return 'application/x-ndjson'
  return 'application/octet-stream'
}
function normalizeHash(hash: string): string { return (hash.startsWith('sha256-') ? hash.slice(7) : hash).toLowerCase() }
function text(value: string): Uint8Array { return new TextEncoder().encode(value) }
function decodeText(value: Uint8Array | undefined): string { return new TextDecoder().decode(value ?? new Uint8Array()) }
function error(code: string, message: string): ValidationIssue { return withErrorSemantics({ code, severity: 'error', message }) }
function dedupe(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => { const key = `${issue.code}|${issue.message}|${issue.path ?? ''}`; if (seen.has(key)) return false; seen.add(key); return true })
}
