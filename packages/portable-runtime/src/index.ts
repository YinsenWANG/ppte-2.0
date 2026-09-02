import { canonicalJsonString, canonicalRevision, sha256HexBytes } from '../../canonical-json/src/index.js'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { PpteSession } from '../../core/src/index.js'
import { contentOnlyContract, replaceAssetContract } from '../../change-contract/src/index.js'
import { readStoredZip, writeStoredZip } from '../../archive/src/index.js'
import { renderDocumentHtml } from '../../renderer-react/src/index.js'
import { checkGlyphCoverage, validateRuntimeDocument, validateTransactionShape } from '../../validation/src/index.js'
import { plainTextToRichText } from '../../richtext-adapter/src/index.js'
import { buildCapabilityReport, type CapabilityReport } from '../../capability/src/index.js'
import { buildFactUpdateTransaction } from '../../facts/src/index.js'
import { PPTE_COMPATIBILITY_PROFILE, PPTE_FORMAT, PPTE_FORMAT_VERSION, PPTE_GA_B_COMPATIBILITY_PROFILE, PPTE_OPERATION_PROTOCOL_VERSION, PPTE_SCHEMA_VERSION } from '../../schema/src/index.js'
import { withErrorSemantics } from '../../schema/src/errors.js'
import type { AssetId, Element, FontId, PpteDocument, PpteManifest, PortableOrigin, PortableProfile, Revision, Transaction, ValidationIssue } from '../../schema/src/index.js'

export interface PortableBuildOptions {
  profile: Exclude<PortableProfile, 'light-edit'>
  assetBytes?: Record<AssetId, Uint8Array>
  fontBytes?: Record<FontId, Uint8Array>
  runtimeVersion?: string
  branchId?: string
  derivedAt?: string
  sourceRevision?: Revision
  timestamp?: string
}

export interface PortablePayload {
  document: PpteDocument
  origin: PortableOrigin
  assets: Record<AssetId, string>
  fonts: Record<FontId, string>
  capabilityReport: CapabilityReport
}

export interface PortableBuildResult {
  ok: boolean
  html: string
  origin?: PortableOrigin
  capabilityReport?: CapabilityReport
  issues: ValidationIssue[]
  bytes: number
}

export interface PortableAuditResult {
  ok: boolean
  issues: ValidationIssue[]
  origin?: PortableOrigin
}

export interface QuickFixResult {
  ok: boolean
  revision?: Revision
  bytes?: Uint8Array
  issues: ValidationIssue[]
}

export interface PresenterState {
  slideId: string
  slideIndex: number
  step: number
  maxStep: number
  notes?: PpteDocument['slides'][string]['notes']
}

export function buildPortable(document: PpteDocument, options: PortableBuildOptions): PortableBuildResult {
  if (options.profile !== 'viewer' && options.profile !== 'quick-fix') return { ok: false, html: '', issues: [issue('PORTABLE_PROFILE_UNSUPPORTED', 'Only Viewer and Quick Fix are included in the first GA portable profile.')], bytes: 0 }
  const issues = validateRuntimeDocument(document).filter((issue) => issue.severity === 'error' && !(options.profile === 'viewer' && issue.code === 'FONT_GLYPH_MISSING'))
  if (issues.length) return { ok: false, html: '', issues, bytes: 0 }
  const sourceRevision = options.sourceRevision ?? canonicalRevision(document)
  if (sourceRevision !== canonicalRevision(document)) issues.push(issue('PORTABLE_ORIGIN_MISMATCH', 'sourceRevision must match the embedded document revision.', undefined, 'Rebuild from the exact source snapshot.'))
  const origin: PortableOrigin = {
    sourceDocumentId: document.documentId,
    sourceRevision,
    derivedAt: options.derivedAt ?? '1970-01-01T00:00:00.000Z',
    profile: options.profile,
    runtimeVersion: options.runtimeVersion ?? 'portable-runtime-1',
    ...(options.branchId ? { branchId: options.branchId } : {}),
  }
  const capabilityReport = buildCapabilityReport(document, options.profile === 'quick-fix' ? 'portable-quick-fix' : 'portable-viewer', { sourceRevision })
  const assets: Record<string, string> = {}
  const assetSources: Record<string, string> = {}
  for (const asset of Object.values(document.assets)) {
    const data = options.assetBytes?.[asset.id]
    if (!data) issues.push(issue('ASSET_MISSING', `Portable package requires embedded bytes for asset ${asset.id}.`, asset.id, 'Embed the asset before creating an offline package.'))
    else if (data.length !== asset.byteLength || normalizeHash(asset.hash) !== sha256Binary(data)) issues.push(issue('ASSET_HASH_MISMATCH', `Portable asset ${asset.id} failed hash verification.`, asset.id, 'Use the bytes that belong to the declared asset hash.'))
    else {
      assets[asset.id] = base64(data)
      assetSources[asset.id] = `data:${asset.mimeType};base64,${assets[asset.id]}`
    }
  }
  const fonts: Record<string, string> = {}
  for (const font of Object.values(document.fonts)) if (font.source === 'embedded') {
    const data = options.fontBytes?.[font.id]
    if (!data) issues.push(issue('FONT_MISSING', `Portable package requires embedded bytes for font ${font.id}.`, font.id, 'Embed the font or switch to an explicitly declared system-safe font.'))
    else if (font.hash && normalizeHash(font.hash) !== sha256Binary(data)) issues.push(issue('FONT_HASH_MISMATCH', `Portable font ${font.id} failed hash verification.`, font.id, 'Use the bytes that belong to the declared font hash.'))
    else fonts[font.id] = base64(data)
  }
  if (options.profile === 'quick-fix') for (const slide of Object.values(document.slides)) for (const element of Object.values(slide.elements)) if (element.type === 'text') issues.push(...checkGlyphCoverage(document, element, undefined, { strict: true }))
  if (issues.some((item) => item.severity === 'error')) return { ok: false, html: '', origin, capabilityReport, issues: dedupe(issues), bytes: 0 }
  const payload: PortablePayload = { document, origin, assets, fonts, capabilityReport }
  const html = assembleHtml(document, payload, assetSources)
  const gzipLimit = options.profile === 'viewer' ? 1_200_000 : 2_000_000
  const gzipBytes = gzipSync(new TextEncoder().encode(html)).length
  if (gzipBytes > gzipLimit) return { ok: false, html: '', origin, capabilityReport, issues: [...dedupe(issues), issue('PORTABLE_BUDGET_EXCEEDED', `Portable ${options.profile} output is ${gzipBytes} bytes gzip; budget is ${gzipLimit} bytes.`)], bytes: 0 }
  return { ok: true, html, origin, capabilityReport, issues: dedupe([...issues, ...capabilityReport.issues]), bytes: new TextEncoder().encode(html).length }
}

export function createPortableViewer(document: PpteDocument, options: Omit<PortableBuildOptions, 'profile'> = {}): PortableBuildResult {
  return buildPortable(document, { ...options, profile: 'viewer' })
}

export function createPortableQuickFix(document: PpteDocument, options: Omit<PortableBuildOptions, 'profile'> = {}): PortableBuildResult {
  return buildPortable(document, { ...options, profile: 'quick-fix' })
}

export function decodePortable(html: string): PortablePayload {
  const match = /<script id="ppte-portable-payload" type="application\/json">([\s\S]*?)<\/script>/.exec(html)
  if (!match) throw new Error('PORTABLE_INVALID: missing embedded payload')
  try {
    const payload = JSON.parse(match[1]) as PortablePayload
    if (!payload || typeof payload !== 'object' || !payload.document || !payload.origin || !payload.capabilityReport) throw new Error('payload is incomplete')
    return payload
  } catch (cause) { throw new Error(`PORTABLE_INVALID: invalid payload: ${cause instanceof Error ? cause.message : String(cause)}`) }
}

export function auditPortableBundle(html: string): PortableAuditResult {
  const issues: ValidationIssue[] = []
  let payload: PortablePayload
  try { payload = decodePortable(html) } catch (cause) { return { ok: false, issues: [issue('PORTABLE_INVALID', cause instanceof Error ? cause.message : String(cause))] } }
  const origin = payload.origin
  if (!origin?.sourceDocumentId || !origin.sourceRevision || !origin.profile || !origin.runtimeVersion) issues.push(issue('PORTABLE_ORIGIN_MISSING', 'Portable output must carry source origin metadata.'))
  if (origin?.sourceDocumentId !== payload.document.documentId) issues.push(issue('PORTABLE_ORIGIN_MISMATCH', 'Portable origin does not identify the embedded document.'))
  if (origin?.sourceRevision && canonicalRevision(payload.document) !== origin.sourceRevision) issues.push(issue('PORTABLE_ORIGIN_MISMATCH', 'Portable origin revision does not match the embedded document.'))
  if (payload.capabilityReport?.sourceDocumentId !== payload.document.documentId || payload.capabilityReport?.sourceRevision !== origin?.sourceRevision) issues.push(issue('PORTABLE_CAPABILITY_MISMATCH', 'Capability report does not describe the embedded source revision.'))
  if (origin?.profile !== 'viewer' && origin?.profile !== 'quick-fix') issues.push(issue('PORTABLE_PROFILE_UNSUPPORTED', 'Only Viewer and Quick Fix are included in the first GA portable profile.'))
  if (/<(?:script|link)[^>]+(?:src|href)\s*=\s*["'](?:https?:|\/\/|data:)/i.test(html) || /<img[^>]+src\s*=\s*["'](?!data:|blob:)/i.test(html)) issues.push(issue('PORTABLE_NETWORK_DISABLED', 'Portable output may not load external runtime or asset resources.'))
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(html)) issues.push(issue('PORTABLE_NETWORK_DISABLED', 'Portable runtime contains a network-capable API call.'))
  if (/\beval\s*\(|new\s+Function\s*\(/.test(html)) issues.push(issue('PORTABLE_PAYLOAD_UNSAFE', 'Portable runtime may not evaluate generated code.'))
  if (/<script[^>]+src\s*=/i.test(html) || /<link[^>]+href\s*=/i.test(html)) issues.push(issue('PORTABLE_EXTERNAL_RUNTIME', 'Portable runtime must be self-contained.'))
  if (origin.profile === 'light-edit') issues.push(issue('PORTABLE_PROFILE_UNSUPPORTED', 'Light Edit is outside the first GA portable profile.'))
  return { ok: !issues.some((item) => item.severity === 'error'), issues, origin }
}

export class PortableRuntime {
  private readonly session: PpteSession
  private readonly assetBytes: Record<string, Uint8Array>
  private readonly fontBytes: Record<string, Uint8Array>
  private slideIndex = 0
  private step = 0
  private lastTransaction?: Transaction

  constructor(document: PpteDocument, options: { profile?: Exclude<PortableProfile, 'light-edit'>; assetBytes?: Record<AssetId, Uint8Array>; fontBytes?: Record<FontId, Uint8Array> } = {}) {
    if ((options.profile as string | undefined) === 'light-edit') throw new Error('PORTABLE_PROFILE_UNSUPPORTED: Light Edit is outside the first GA portable profile.')
    this.session = new PpteSession(document)
    this.assetBytes = cloneBytes(options.assetBytes)
    this.fontBytes = cloneBytes(options.fontBytes)
    this.profile = options.profile ?? 'viewer'
  }

  readonly profile: Exclude<PortableProfile, 'light-edit'>

  getDocument(): Readonly<PpteDocument> { return this.session.getDocument() }
  getRevision(): Revision { return this.session.getRevision() }
  getCapabilityReport(): CapabilityReport { return buildCapabilityReport(this.session.getDocument(), this.profile === 'quick-fix' ? 'portable-quick-fix' : 'portable-viewer', { sourceRevision: this.session.getRevision() }) }
  getAssetBytes(): Record<string, Uint8Array> { return cloneBytes(this.assetBytes) }
  getFontBytes(): Record<string, Uint8Array> { return cloneBytes(this.fontBytes) }
  getLastTransaction(): Readonly<Transaction> | undefined { return this.lastTransaction ? structuredClone(this.lastTransaction) : undefined }

  editText(target: { slideId?: string; elementId?: string; semanticKey?: string }, value: string): QuickFixResult {
    if (this.profile !== 'quick-fix') return { ok: false, issues: [issue('PORTABLE_EDIT_UNSUPPORTED', 'Viewer profile does not allow edits.')] }
    const found = findElement(this.session.getDocument(), target)
    if (!found || found.element.type !== 'text') return { ok: false, issues: [issue('PORTABLE_EDIT_UNSUPPORTED', 'Quick Fix text editing requires a resolvable Text element.')] }
    const glyphIssues = checkGlyphCoverage(this.session.getDocument(), found.element, value, { strict: true })
    if (glyphIssues.some((item) => item.severity === 'error')) return { ok: false, issues: glyphIssues }
    let content
    try { content = plainTextToRichText(value, `${found.element.id}-p`) } catch (cause) { return { ok: false, issues: [issue('TEXT_INVALID', cause instanceof Error ? cause.message : String(cause))] } }
    const transaction = textTransaction(this.session.getRevision(), found.slideId, found.element.id, content)
    const result = this.session.commit(transaction)
    if (result.ok) this.lastTransaction = transaction
    return { ok: result.ok, revision: result.afterRevision, issues: result.issues }
  }

  replaceImage(target: { slideId?: string; elementId?: string; semanticKey?: string }, assetId: AssetId): QuickFixResult {
    if (this.profile !== 'quick-fix') return { ok: false, issues: [issue('PORTABLE_EDIT_UNSUPPORTED', 'Viewer profile does not allow edits.')] }
    const found = findElement(this.session.getDocument(), target)
    if (!found || found.element.type !== 'image') return { ok: false, issues: [issue('PORTABLE_EDIT_UNSUPPORTED', 'Quick Fix image replacement requires a resolvable Image element.')] }
    if (!this.session.getDocument().assets[assetId] || !this.assetBytes[assetId]) return { ok: false, issues: [issue('ASSET_MISSING', `Quick Fix asset ${assetId} is not embedded.`, assetId, 'Add the asset bytes to the portable bundle.')] }
    const transaction: Transaction = {
      transactionId: `portable:image:${found.element.id}:${this.session.getRevision().slice(-12)}`,
      baseRevision: this.session.getRevision(),
      actor: { type: 'human', id: 'portable-quick-fix' },
      scope: { kind: 'selection', slideIds: [found.slideId], elementIds: [found.element.id], permissions: ['assets'], allowInsert: false, allowDelete: false },
      changeContract: replaceAssetContract(found.element.id, false),
      reason: 'Portable Quick Fix image replacement',
      createdAt: '1970-01-01T00:00:00.000Z',
      validationLevel: 'L2',
      operations: [{ opId: `portable:image:${found.element.id}`, kind: 'image.replaceAsset', slideId: found.slideId, elementId: found.element.id, assetId, preserveCrop: true }],
    }
    const result = this.session.commit(transaction)
    if (result.ok) this.lastTransaction = transaction
    return { ok: result.ok, revision: result.afterRevision, issues: result.issues }
  }

  /** Numeric Fact Quick Fix. The generated update and every display sync are one reviewable Transaction. */
  editFact(factId: string, value: number): QuickFixResult {
    if (this.profile !== 'quick-fix') return { ok: false, issues: [issue('PORTABLE_EDIT_UNSUPPORTED', 'Viewer profile does not allow Fact edits.')] }
    if (!Number.isFinite(value)) return { ok: false, issues: [issue('SCHEMA_INVALID', 'Fact Quick Fix accepts a finite numeric value.')] }
    let transaction: Transaction
    try {
      transaction = buildFactUpdateTransaction(this.session.getDocument(), factId, value, { actor: { type: 'human', id: 'portable-quick-fix' }, requireConfirmation: false })
    } catch (cause) { return { ok: false, issues: [issue('PORTABLE_EDIT_UNSUPPORTED', cause instanceof Error ? cause.message : String(cause))] } }
    const result = this.session.commit(transaction)
    if (result.ok) this.lastTransaction = transaction
    return { ok: result.ok, revision: result.afterRevision, issues: result.issues }
  }

  updateFact(factId: string, value: number): QuickFixResult { return this.editFact(factId, value) }
  editFactValue(factId: string, value: number): QuickFixResult { return this.editFact(factId, value) }

  undo(): QuickFixResult {
    if (this.profile !== 'quick-fix') return { ok: false, issues: [issue('PORTABLE_EDIT_UNSUPPORTED', 'Viewer profile does not allow undo.')] }
    const result = this.session.undo()
    return { ok: result.ok, revision: result.afterRevision, issues: result.issues }
  }

  saveAsProject(options: { timestamp?: string; clean?: boolean; compatibilityProfile?: string } = {}): QuickFixResult {
    try {
      const bytes = buildPortableCheckpointBytes(this.session.getDocument(), { timestamp: options.timestamp ?? '1970-01-01T00:00:00.000Z', clean: options.clean, compatibilityProfile: options.compatibilityProfile, recentTransactions: options.clean ? [] : this.session.getHistory().map((entry) => entry.transaction), assetBytes: this.assetBytes, fontBytes: this.fontBytes })
      return { ok: true, revision: this.session.getRevision(), bytes, issues: [] }
    } catch (cause) { return { ok: false, issues: [issue('CHECKPOINT_FAILED', cause instanceof Error ? cause.message : String(cause))] } }
  }

  saveAsNewProject(options: { timestamp?: string; compatibilityProfile?: string } = {}): QuickFixResult { return this.saveAsProject(options) }

  saveAsPortable(options: Omit<PortableBuildOptions, 'profile'> = {}): PortableBuildResult {
    return buildPortable(this.session.getDocument(), { ...options, profile: this.profile, sourceRevision: this.session.getRevision(), assetBytes: this.assetBytes, fontBytes: this.fontBytes })
  }

  presenterState(): PresenterState {
    const document = this.session.getDocument()
    const slideId = document.slideOrder[this.slideIndex] ?? document.slideOrder[0]
    const slide = document.slides[slideId]
    const maxStep = Math.max(0, ...Object.values(slide?.elements ?? {}).map((element) => element.appearStep ?? 0))
    return { slideId, slideIndex: this.slideIndex, step: Math.min(this.step, maxStep), maxStep, notes: slide?.notes }
  }

  next(): PresenterState {
    const state = this.presenterState()
    if (state.step < state.maxStep) this.step += 1
    else if (this.slideIndex < this.session.getDocument().slideOrder.length - 1) { this.slideIndex += 1; this.step = 0 }
    return this.presenterState()
  }

  previous(): PresenterState {
    if (this.step > 0) this.step -= 1
    else if (this.slideIndex > 0) { this.slideIndex -= 1; this.step = 0 }
    return this.presenterState()
  }

  setSlide(index: number): PresenterState {
    this.slideIndex = Math.max(0, Math.min(Math.floor(index), this.session.getDocument().slideOrder.length - 1))
    this.step = 0
    return this.presenterState()
  }

  clickStep(): PresenterState { return this.next() }
}

function assembleHtml(document: PpteDocument, payload: PortablePayload, assetSources: Record<string, string>): string {
  const rendered = renderDocumentHtml(document, { assetSources }).replaceAll('du', 'px')
  const fontCss = Object.values(document.fonts).filter((font) => font.source === 'embedded' && payload.fonts[font.id]).map((font) => `@font-face{font-family:'${css(font.family)}';font-style:${font.style};font-weight:${font.weight};src:url(data:font/woff2;base64,${payload.fonts[font.id]}) format('woff2');font-display:block;}`).join('')
  const payloadJson = JSON.stringify(payload).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026')
  return `<!doctype html><html lang="${css(document.locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="ppte-runtime-version" content="${css(payload.origin.runtimeVersion)}"><meta name="ppte-source-revision" content="${css(payload.origin.sourceRevision)}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; script-src 'unsafe-inline';"><style>${fontCss}html,body{margin:0;background:#111827;color:#f9fafb;font-family:system-ui,sans-serif}#ppte-shell{min-height:100vh;display:grid;grid-template-rows:auto 1fr auto}.ppte-toolbar{display:flex;gap:.5rem;align-items:center;padding:.5rem;background:#0f172a;position:sticky;top:0;z-index:2}.ppte-toolbar button{padding:.35rem .65rem;color:#f9fafb;background:#1e293b;border:1px solid #475569;border-radius:.25rem}.ppte-status{margin-left:auto;font-size:.8rem;color:#cbd5e1}.ppte-stage{display:grid;place-items:center;overflow:auto;padding:1rem}.ppte-stage .ppte-slide{display:none;box-shadow:0 1rem 3rem #0008;transform-origin:center center;max-width:calc(100vw - 2rem);max-height:calc(100vh - 8rem)}.ppte-stage .ppte-slide:first-child{display:block}.ppte-notes{min-height:1.5rem;padding:.5rem 1rem;background:#0f172a;color:#cbd5e1;font-size:.85rem} .ppte-quick-fix [data-ppte-type="text"]{outline:1px dashed #60a5fa;cursor:text}</style></head><body><div id="ppte-shell" class="ppte-${payload.origin.profile}"><div class="ppte-toolbar"><button type="button" data-ppte-action="previous">Previous</button><button type="button" data-ppte-action="next">Next</button><button type="button" data-ppte-action="fullscreen">Fullscreen</button><span class="ppte-status" data-ppte-status>Offline ${payload.origin.profile} · no sync</span></div><main class="ppte-stage" data-ppte-stage>${rendered}</main><div class="ppte-notes" data-ppte-notes aria-live="polite"></div></div><script id="ppte-portable-payload" type="application/json">${payloadJson}</script><script>${portableScript()}</script></body></html>`
}

/**
 * Save-as-project is deliberately implemented against the lower archive
 * adapter. Portable Runtime may depend on Core, but Core/File Format must not
 * become a dependency cycle through the Portable package.
 */
function buildPortableCheckpointBytes(document: PpteDocument, options: { timestamp?: string; clean?: boolean; compatibilityProfile?: string; recentTransactions?: Transaction[]; assetBytes?: Record<string, Uint8Array>; fontBytes?: Record<string, Uint8Array> }): Uint8Array {
  const issues = validateRuntimeDocument(document).filter((item) => item.severity === 'error')
  if (issues.length) throw new Error(issues.map((item) => `${item.code}: ${item.message}`).join('\n'))
  const snapshot = options.clean ? cleanPortableSnapshot(document) : document
  const compatibilityProfile = options.compatibilityProfile ?? PPTE_COMPATIBILITY_PROFILE
  assertPortableDocumentCompatibility(snapshot, compatibilityProfile)
  const revision = canonicalRevision(snapshot)
  const recent = options.recentTransactions ?? []
  if (options.clean && recent.length) throw new Error('CHECKPOINT_FAILED: clean checkpoint cannot contain recent history')
  for (const [index, transaction] of recent.entries()) {
    const transactionIssues = validateTransactionShape(transaction).filter((item) => item.severity === 'error')
    if (transactionIssues.length) throw new Error(`CHECKPOINT_FAILED: invalid recent transaction ${index + 1}: ${transactionIssues.map((item) => item.message).join('; ')}`)
  }
  const entries: Array<{ name: string; data: Uint8Array }> = []
  addPortableEntry(entries, 'mimetype', bytes('application/vnd.ppte+zip'))
  addPortableEntry(entries, 'document.json', bytes(canonicalJsonString(snapshot)))
  addPortableEntry(entries, 'assets/index.json', bytes(canonicalJsonString(snapshot.assets)))
  addPortableEntry(entries, 'fonts/index.json', bytes(canonicalJsonString(snapshot.fonts)))
  addPortableEntry(entries, 'history/descriptor.json', bytes(canonicalJsonString({ mode: options.clean ? 'clean' : 'standard', snapshotRevision: revision, recentTransactionCount: options.clean ? 0 : recent.length, deepHistoryExternal: !options.clean })))
  if (!options.clean && recent.length) addPortableEntry(entries, 'history/recent.jsonl', bytes(recent.map((transaction) => canonicalJsonString(transaction)).join('\n') + '\n'))

  for (const [assetId, data] of Object.entries(options.assetBytes ?? {})) {
    const asset = snapshot.assets[assetId]
    if (!asset) throw new Error(`ASSET_MISSING: ${assetId}`)
    verifyPortableBytes(asset.byteLength, asset.hash, data, `ASSET_HASH_MISMATCH: ${assetId}`)
    addPortableEntry(entries, safePortablePath(asset.path, `assets/${assetId}`, 'assets/'), data)
  }
  for (const asset of Object.values(snapshot.assets)) {
    const data = options.assetBytes?.[asset.id]
    if (!data) throw new Error(`ASSET_MISSING: checkpoint requires bytes for ${asset.id}`)
    if (!entries.some((entry) => entry.name === safePortablePath(asset.path, `assets/${asset.id}`, 'assets/'))) addPortableEntry(entries, safePortablePath(asset.path, `assets/${asset.id}`, 'assets/'), data)
  }
  for (const [fontId, data] of Object.entries(options.fontBytes ?? {})) {
    const font = snapshot.fonts[fontId]
    if (!font) throw new Error(`FONT_MISSING: ${fontId}`)
    if (font.hash) verifyPortableBytes(undefined, font.hash, data, `FONT_HASH_MISMATCH: ${fontId}`)
    addPortableEntry(entries, safePortablePath(font.path ?? `fonts/${fontId}.woff2`, `fonts/${fontId}.woff2`, 'fonts/'), data)
  }
  for (const font of Object.values(snapshot.fonts)) if (font.source === 'embedded') {
    const data = options.fontBytes?.[font.id]
    if (!data) throw new Error(`FONT_MISSING: checkpoint requires bytes for ${font.id}`)
    if (font.hash) verifyPortableBytes(undefined, font.hash, data, `FONT_HASH_MISMATCH: ${font.id}`)
    const path = safePortablePath(font.path ?? `fonts/${font.id}.woff2`, `fonts/${font.id}.woff2`, 'fonts/')
    if (!entries.some((entry) => entry.name === path)) addPortableEntry(entries, path, data)
  }
  const files = entries.filter((entry) => entry.name !== 'mimetype').map((entry) => ({ path: entry.name, mediaType: portableMediaType(entry.name), byteLength: entry.data.length, sha256: sha256HexBytes(entry.data), required: entry.name === 'document.json' }))
  const manifest: PpteManifest = {
    format: PPTE_FORMAT,
    formatVersion: PPTE_FORMAT_VERSION,
    schemaVersion: PPTE_SCHEMA_VERSION,
    operationProtocolVersion: PPTE_OPERATION_PROTOCOL_VERSION,
    compatibilityProfile,
    documentId: snapshot.documentId,
    contentRevision: revision,
    title: snapshot.metadata.title,
    createdAt: snapshot.metadata.createdAt ?? options.timestamp ?? '1970-01-01T00:00:00.000Z',
    updatedAt: options.timestamp ?? '1970-01-01T00:00:00.000Z',
    requiredWidgets: snapshot.widgetRequirements ?? [],
    clean: options.clean ?? false,
    files,
    history: { mode: options.clean ? 'clean' : 'standard', snapshotRevision: revision, recentTransactionCount: options.clean ? 0 : recent.length, deepHistoryExternal: !options.clean },
  }
  addPortableEntry(entries, 'manifest.json', bytes(canonicalJsonString(manifest)))
  const archive = writeStoredZip(entries)
  readStoredZip(archive)
  return archive
}

function assertPortableDocumentCompatibility(document: PpteDocument, compatibilityProfile: string): void {
  const hasChart = Object.values(document.slides).some((slide) => Object.values(slide.elements).some((element) => element.type === 'chart'))
  if (hasChart && compatibilityProfile !== PPTE_GA_B_COMPATIBILITY_PROFILE) throw new Error(`CHECKPOINT_FAILED: Chart documents require compatibility profile ${PPTE_GA_B_COMPATIBILITY_PROFILE}.`)
}

function cleanPortableSnapshot(document: PpteDocument): PpteDocument {
  const cleaned = JSON.parse(canonicalJsonString(document)) as PpteDocument
  for (const slide of Object.values(cleaned.slides)) if (slide.notes?.private !== undefined) {
    const notes = { ...slide.notes }
    delete notes.private
    slide.notes = Object.keys(notes).length ? notes : undefined
  }
  return cleaned
}

function addPortableEntry(entries: Array<{ name: string; data: Uint8Array }>, name: string, data: Uint8Array) {
  if (entries.some((entry) => entry.name === name)) throw new Error(`CHECKPOINT_FAILED: duplicate package entry ${name}`)
  entries.push({ name, data: new Uint8Array(data) })
}
function safePortablePath(path: string, fallback: string, prefix: string): string {
  if (!path || path.startsWith('/') || path.includes('..') || path.includes('\\') || path.includes('\u0000') || !path.startsWith(prefix)) throw new Error(`CHECKPOINT_FAILED: unsafe package path ${path || fallback}`)
  return path || fallback
}
function verifyPortableBytes(byteLength: number | undefined, hash: string, data: Uint8Array, message: string) {
  if (byteLength !== undefined && data.length !== byteLength) throw new Error(message)
  if (normalizeHash(hash) !== sha256Binary(data)) throw new Error(message)
}
function portableMediaType(path: string): string {
  if (path.endsWith('.json')) return 'application/json'
  if (path.endsWith('.jsonl')) return 'application/x-ndjson'
  if (path.endsWith('.woff2')) return 'font/woff2'
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
  if (path.endsWith('.webp')) return 'image/webp'
  return 'application/octet-stream'
}
function bytes(value: string): Uint8Array { return new TextEncoder().encode(value) }

function portableScript(): string {
  return `(()=>{const p=JSON.parse(document.getElementById('ppte-portable-payload').textContent||'{}');const slides=[...document.querySelectorAll('[data-ppte-slide-id]')];let i=0;let step=0;const status=document.querySelector('[data-ppte-status]');const notes=document.querySelector('[data-ppte-notes]');const show=()=>{slides.forEach((s,n)=>{s.style.display=n===i?'block':'none';if(n===i)s.querySelectorAll('[data-ppte-appear-step]').forEach(e=>e.style.visibility=Number(e.getAttribute('data-ppte-appear-step'))<=step?'visible':'hidden')});const s=p.document.slides[p.document.slideOrder[i]];if(notes)notes.textContent=s&&s.notes?(s.notes.speaker||s.notes.handout||''):'';if(status)status.textContent='Offline '+p.origin.profile+(p.capabilityReport.degraded?' · degraded':'')+' · slide '+(i+1)+'/'+slides.length+' · no sync';document.documentElement.dataset.ppteStep=String(step)};const advance=()=>{const active=slides[i];const pending=[...(active?active.querySelectorAll('[data-ppte-appear-step]'):[])].filter(e=>Number(e.getAttribute('data-ppte-appear-step'))>step).map(e=>Number(e.getAttribute('data-ppte-appear-step')));if(pending.length)step=Math.min(...pending);else if(i<slides.length-1){i++;step=0}show()};document.querySelectorAll('[data-ppte-action="next"]').forEach(b=>b.addEventListener('click',advance));document.querySelectorAll('[data-ppte-action="previous"]').forEach(b=>b.addEventListener('click',()=>{if(step>0)step=Math.max(0,step-1);else if(i>0){i--;step=0}show()}));document.querySelectorAll('[data-ppte-action="fullscreen"]').forEach(b=>b.addEventListener('click',()=>{const shell=document.getElementById('ppte-shell');if(shell&&shell.requestFullscreen)shell.requestFullscreen()}));globalThis.PPTEPortable={origin:p.origin,capabilityReport:p.capabilityReport,getPayload:()=>p,next:advance,previous:()=>{if(i>0)i--;step=0;show()},setSlide:n=>{i=Math.max(0,Math.min(slides.length-1,Number(n)||0));step=0;show()}};show()})()`
}

function textTransaction(baseRevision: string, slideId: string, elementId: string, content: ReturnType<typeof plainTextToRichText>): Transaction {
  return { transactionId: `portable:text:${elementId}:${baseRevision.slice(-12)}`, baseRevision, actor: { type: 'human', id: 'portable-quick-fix' }, scope: { kind: 'selection', slideIds: [slideId], elementIds: [elementId], permissions: ['content'], allowInsert: false, allowDelete: false }, changeContract: contentOnlyContract(elementId), reason: 'Portable Quick Fix text edit', createdAt: '1970-01-01T00:00:00.000Z', validationLevel: 'L2', operations: [{ opId: `portable:text:${elementId}`, kind: 'text.replaceContent', slideId, elementId, content }] }
}

function findElement(document: PpteDocument, target: { slideId?: string; elementId?: string; semanticKey?: string }): { slideId: string; element: Element } | undefined {
  const slideIds = target.slideId ? [target.slideId] : document.slideOrder
  for (const slideId of slideIds) {
    const slide = document.slides[slideId]
    if (!slide) continue
    const element = target.elementId ? slide.elements[target.elementId] : Object.values(slide.elements).find((candidate) => candidate.semanticKey === target.semanticKey)
    if (element) return { slideId, element }
  }
  return undefined
}
function cloneBytes(value: Record<string, Uint8Array> | undefined): Record<string, Uint8Array> { return Object.fromEntries(Object.entries(value ?? {}).map(([key, data]) => [key, new Uint8Array(data)])) }
function base64(data: Uint8Array): string { return Buffer.from(data).toString('base64') }
function css(value: string): string { return value.replace(/[^A-Za-z0-9 ,._:-]/g, '') }
function normalizeHash(hash: string): string { return (hash.startsWith('sha256-') ? hash.slice(7) : hash).toLowerCase() }
function sha256Binary(data: Uint8Array): string { return createHash('sha256').update(data).digest('hex') }
function issue(code: string, message: string, elementId?: string, recovery?: string): ValidationIssue { return withErrorSemantics({ code, severity: 'error', message, elementId, recovery }) }
function dedupe(issues: ValidationIssue[]): ValidationIssue[] { const seen = new Set<string>(); return issues.filter((item) => { const key = `${item.code}|${item.message}|${item.elementId ?? ''}`; if (seen.has(key)) return false; seen.add(key); return true }) }
