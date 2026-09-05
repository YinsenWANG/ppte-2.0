import { canonicalJsonString, canonicalRevision, sha256HexBytes } from '../../canonical-json/src/index.js'
import { gzipSync as portableGzip } from 'fflate'
let gzipSync: (data: Uint8Array) => Uint8Array = portableGzip
let binaryHash: (data: Uint8Array) => string = sha256HexBytes
let encodeBase64: ((data: Uint8Array) => string) | undefined
/** Host adapters accelerate bytes without changing semantic behavior. */
export function configurePortablePlatform(adapter: { gzip: typeof gzipSync; hash: typeof binaryHash; base64: (data: Uint8Array) => string }): void { gzipSync = adapter.gzip; binaryHash = adapter.hash; encodeBase64 = adapter.base64 }

import { PpteSession, type HistoryEntry } from '../../core/src/index.js'
import { contentOnlyContract, cropOnlyContract, chartDataOnlyContract, geometryOnlyContract, replaceAssetContract, rotationOnlyContract } from '../../change-contract/src/index.js'
import { readStoredZip, writeStoredZip } from '../../archive/src/index.js'
import { renderDocumentSurfaceHtml } from '../../renderer-react/src/index.js'
import { checkGlyphCoverage, validateRuntimeDocument, validateTransactionShape } from '../../validation/src/index.js'
import { plainTextToRichText, editRichText } from '../../richtext-adapter/src/index.js'
import { buildCapabilityReport, type CapabilityReport } from '../../capability/src/index.js'
import { buildFactUpdateTransaction } from '../../facts/src/index.js'
import { assertDocumentCompatibility, inferCompatibilityProfile, runtimeProfileForCompatibility } from '../../compatibility/src/index.js'
import { PPTE_FORMAT, PPTE_FORMAT_VERSION, PPTE_OPERATION_PROTOCOL_VERSION, PPTE_SCHEMA_VERSION } from '../../schema/src/index.js'
import { withErrorSemantics } from '../../schema/src/errors.js'
import type { Asset, AssetId, ChartData, Element, FontId, Frame, NormalizedRect, PpteDocument, PpteManifest, PortableOrigin, PortableProfile, Revision, RuntimeProfile, Transaction, ValidationIssue } from '../../schema/src/index.js'
import { advancePresenterState, animationSteps, normalizePresenterState, retreatPresenterState, type PresenterAnimationState } from './presenter-state.js'
import { runtimeBudgetFor, STANDARD_EDITABLE_SUFFIX } from './delivery-policy.js'

export { advancePresenterState, animationSteps, normalizePresenterState, retreatPresenterState } from './presenter-state.js'
export type { PresenterAnimationState } from './presenter-state.js'
export {
  assessDeliveryArtifact,
  deliveryRoleLabel,
  EDITABLE_DELIVERY_PROFILES,
  isEditableDeliveryProfile,
  resolveDeliveryPolicy,
  runtimeBudgetFor,
  STANDARD_ARTIFACT_TARGET_BYTES,
  STANDARD_DELIVERY_PROFILE,
  STANDARD_EDITABLE_SUFFIX,
} from './delivery-policy.js'
export type { DeliveryArtifactAssessment, DeliveryArtifactRole, DeliveryMetrics, DeliveryPolicy, EditableDeliveryProfile } from './delivery-policy.js'

export interface PortableBuildOptions {
  profile: PortableProfile
  recentTransactions?: Transaction[]
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
  /** The persisted minimum profile is shared by Portable and file-format saves. */
  recentTransactions?: Transaction[]
  minimumCompatibilityProfile?: string
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
  /** Raw generated HTML size, kept separate from the runtime budget. */
  runtimeBytes?: number
  /** Gzip size of the executable/runtime portion (payload resources omitted). */
  runtimeGzipBytes?: number
  /** Unique binary Asset/Font bytes embedded in the payload. */
  resourceBytes?: number
  /** Gzip size of the complete artifact, useful for telemetry only. */
  gzipBytes?: number
  budgetBytes?: number
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

export interface PortableSelectionResult extends QuickFixResult {
  selection?: Array<{ slideId: string; elementId: string }>
}

export type PortableElementTarget = { slideId?: string; elementId?: string; semanticKey?: string }

export interface PortableImageImportOptions {
  assetId?: AssetId
  fileName?: string
  mimeType?: string
  width?: number
  height?: number
  altText?: string
  importedAt?: string
}

export interface PresenterState {
  slideId: string
  slideIndex: number
  step: number
  maxStep: number
  notes?: PpteDocument['slides'][string]['notes']
}

export function buildPortable(document: PpteDocument, options: PortableBuildOptions): PortableBuildResult {
  const runtimeProfile: RuntimeProfile = options.profile === 'light-edit' || options.profile === 'full-portable'
    ? 'ga-c'
    : runtimeProfileForCompatibility(inferCompatibilityProfile(document))
  const issues = validateRuntimeDocument(document, { runtimeProfile }).filter((issue) => issue.severity === 'error' && !(options.profile === 'viewer' && issue.code === 'FONT_GLYPH_MISSING'))
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
  const capabilityTarget = options.profile === 'quick-fix' ? 'portable-quick-fix' : options.profile === 'light-edit' || options.profile === 'full-portable' ? 'portable-light-edit' : 'portable-viewer'
  const capabilityReport = buildCapabilityReport(document, capabilityTarget, { sourceRevision })
  const assets: Record<string, string> = {}
  // Binary resources live in the payload exactly once.  The browser runtime
  // hydrates image src values from that payload after the semantic markup is
  // mounted, so the generated HTML does not duplicate base64 data in both DOM
  // attributes and JSON.
  const assetSources: Record<string, string> = {}
  for (const asset of Object.values(document.assets)) {
    const data = options.assetBytes?.[asset.id]
    if (!data) issues.push(issue('ASSET_MISSING', `Portable package requires embedded bytes for asset ${asset.id}.`, asset.id, 'Embed the asset before creating an offline package.'))
    else if (data.length !== asset.byteLength || normalizeHash(asset.hash) !== sha256Binary(data)) issues.push(issue('ASSET_HASH_MISMATCH', `Portable asset ${asset.id} failed hash verification.`, asset.id, 'Use the bytes that belong to the declared asset hash.'))
    else {
      assets[asset.id] = base64(data)
    }
  }
  const fonts: Record<string, string> = {}
  for (const font of Object.values(document.fonts)) if (font.source === 'embedded') {
    const data = options.fontBytes?.[font.id]
    if (!data) issues.push(issue('FONT_MISSING', `Portable package requires embedded bytes for font ${font.id}.`, font.id, 'Embed the font or switch to an explicitly declared system-safe font.'))
    else if (font.hash && normalizeHash(font.hash) !== sha256Binary(data)) issues.push(issue('FONT_HASH_MISMATCH', `Portable font ${font.id} failed hash verification.`, font.id, 'Use the bytes that belong to the declared font hash.'))
    else fonts[font.id] = base64(data)
  }
  if (options.profile === 'quick-fix' || options.profile === 'light-edit' || options.profile === 'full-portable') for (const slide of Object.values(document.slides)) for (const element of Object.values(slide.elements)) if (element.type === 'text') issues.push(...checkGlyphCoverage(document, element, undefined, { strict: true }))
  if (issues.some((item) => item.severity === 'error')) return { ok: false, html: '', origin, capabilityReport, issues: dedupe(issues), bytes: 0 }
  const payload: PortablePayload = { document, origin, recentTransactions: options.recentTransactions ?? [], minimumCompatibilityProfile: inferCompatibilityProfile(document), assets, fonts, capabilityReport }
  const html = assembleHtml(document, payload, assetSources)
  const runtimePayload: PortablePayload = { ...payload, assets: {}, fonts: {} }
  const runtimeHtml = assembleHtml(document, runtimePayload, {})
  const encoder = new TextEncoder()
  const htmlBytes = encoder.encode(html)
  const runtimeBytes = encoder.encode(runtimeHtml).length
  const runtimeGzipBytes = gzipSync(encoder.encode(runtimeHtml)).length
  const gzipBytes = gzipSync(htmlBytes).length
  const resourceBytes = Object.values(document.assets).reduce((sum, asset) => sum + (options.assetBytes?.[asset.id]?.length ?? 0), 0) + Object.values(document.fonts).filter((font) => font.source === 'embedded').reduce((sum, font) => sum + (options.fontBytes?.[font.id]?.length ?? 0), 0)
  const budgetBytes = runtimeBudgetFor(options.profile)
  const metrics = { runtimeBytes, runtimeGzipBytes, resourceBytes, gzipBytes, budgetBytes }
  if (runtimeGzipBytes > budgetBytes) return { ok: false, html: '', origin, capabilityReport, issues: [...dedupe(issues), issue('PORTABLE_BUDGET_EXCEEDED', `Portable ${options.profile} runtime is ${runtimeGzipBytes} bytes gzip; budget is ${budgetBytes} bytes.`)], bytes: 0, ...metrics }
  return { ok: true, html, origin, capabilityReport, issues: dedupe([...issues, ...capabilityReport.issues]), bytes: htmlBytes.length, ...metrics }
}

export function createPortableViewer(document: PpteDocument, options: Omit<PortableBuildOptions, 'profile'> = {}): PortableBuildResult {
  return buildPortable(document, { ...options, profile: 'viewer' })
}

export function createPortableQuickFix(document: PpteDocument, options: Omit<PortableBuildOptions, 'profile'> = {}): PortableBuildResult {
  return buildPortable(document, { ...options, profile: 'quick-fix' })
}

export function createPortableLightEdit(document: PpteDocument, options: Omit<PortableBuildOptions, 'profile'> = {}): PortableBuildResult {
  return buildPortable(document, { ...options, profile: 'light-edit' })
}

export function createPortableFullPortable(document: PpteDocument, options: Omit<PortableBuildOptions, 'profile'> = {}): PortableBuildResult {
  return buildPortable(document, { ...options, profile: 'full-portable' })
}

export const createFullPortable = createPortableFullPortable

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
  const markup = html.replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, '$1</script>')
  const executable = html.replace(/<script[^>]+type="application\/json"[^>]*>[\s\S]*?<\/script>/gi, '')
  const origin = payload.origin
  if (!origin?.sourceDocumentId || !origin.sourceRevision || !origin.profile || !origin.runtimeVersion) issues.push(issue('PORTABLE_ORIGIN_MISSING', 'Portable output must carry source origin metadata.'))
  if (origin?.sourceDocumentId !== payload.document.documentId) issues.push(issue('PORTABLE_ORIGIN_MISMATCH', 'Portable origin does not identify the embedded document.'))
  if (origin?.sourceRevision && canonicalRevision(payload.document) !== origin.sourceRevision) issues.push(issue('PORTABLE_ORIGIN_MISMATCH', 'Portable origin revision does not match the embedded document.'))
  if (payload.capabilityReport?.sourceDocumentId !== payload.document.documentId || payload.capabilityReport?.sourceRevision !== origin?.sourceRevision) issues.push(issue('PORTABLE_CAPABILITY_MISMATCH', 'Capability report does not describe the embedded source revision.'))
  if (payload.minimumCompatibilityProfile && payload.minimumCompatibilityProfile !== inferCompatibilityProfile(payload.document)) issues.push(issue('PORTABLE_CAPABILITY_MISMATCH', 'Portable minimum Compatibility Profile does not describe the embedded document.'))
  if (origin?.profile !== 'viewer' && origin?.profile !== 'quick-fix' && origin?.profile !== 'light-edit' && origin?.profile !== 'full-portable') issues.push(issue('PORTABLE_PROFILE_UNSUPPORTED', 'Portable profile is not recognized by this runtime.'))
  if (/<(?:script|link)[^>]+(?:src|href)\s*=\s*["'](?:https?:|\/\/|data:)/i.test(markup) || /<img[^>]+src\s*=\s*["'](?!data:|blob:|["'])/i.test(markup)) issues.push(issue('PORTABLE_NETWORK_DISABLED', 'Portable output may not load external runtime or asset resources.'))
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(executable)) issues.push(issue('PORTABLE_NETWORK_DISABLED', 'Portable runtime contains a network-capable API call.'))
  if (/\beval\s*\(|new\s+Function\s*\(/.test(markup)) issues.push(issue('PORTABLE_PAYLOAD_UNSAFE', 'Portable runtime may not evaluate generated code.'))
  if (/<script[^>]+src\s*=/i.test(markup) || /<link[^>]+href\s*=/i.test(markup)) issues.push(issue('PORTABLE_EXTERNAL_RUNTIME', 'Portable runtime must be self-contained.'))
  return { ok: !issues.some((item) => item.severity === 'error'), issues, origin }
}

export class PortableRuntime {
  private readonly session: PpteSession
  private readonly assetBytes: Record<string, Uint8Array>
  private readonly fontBytes: Record<string, Uint8Array>
  private slideIndex = 0
  private step = 0
  private lastTransaction?: Transaction
  private selection: Array<{ slideId: string; elementId: string }> = []

  constructor(document: PpteDocument, options: { profile?: PortableProfile; assetBytes?: Record<AssetId, Uint8Array>; fontBytes?: Record<FontId, Uint8Array>; recentTransactions?: Transaction[] } = {}) {
    this.profile = options.profile ?? 'viewer'
    const runtimeProfile = this.profile === 'light-edit' || this.profile === 'full-portable' ? 'ga-c' : runtimeProfileForCompatibility(inferCompatibilityProfile(document))
    this.session = new PpteSession(document, { runtimeProfile, recentTransactions: options.recentTransactions })
    this.assetBytes = cloneBytes(options.assetBytes)
    this.fontBytes = cloneBytes(options.fontBytes)
  }

  readonly profile: PortableProfile

  getDocument(): Readonly<PpteDocument> { return this.session.getDocument() }
  getRevision(): Revision { return this.session.getRevision() }
  getCapabilityReport(): CapabilityReport { return buildCapabilityReport(this.session.getDocument(), this.profile === 'quick-fix' ? 'portable-quick-fix' : this.profile === 'light-edit' || this.profile === 'full-portable' ? 'portable-light-edit' : 'portable-viewer', { sourceRevision: this.session.getRevision() }) }
  getAssetBytes(): Record<string, Uint8Array> { return cloneBytes(this.assetBytes) }
  getFontBytes(): Record<string, Uint8Array> { return cloneBytes(this.fontBytes) }
  getHistory(): Transaction[] { return this.session.getHistory().map(entry => entry.transaction) }
  preview(transaction: Transaction) { return this.session.preview(transaction) }
  commit(transaction: Transaction): QuickFixResult {
    if (this.profile !== "full-portable") return { ok: false, issues: [issue("PORTABLE_EDIT_UNSUPPORTED", "Arbitrary transactions require Full Portable.")] }
    return this.commitPortableTransaction(transaction)
  }
  getLastTransaction(): Readonly<Transaction> | undefined { return this.lastTransaction ? structuredClone(this.lastTransaction) : undefined }

  select(target: PortableElementTarget | string): PortableSelectionResult {
    const found = findElement(this.session.getDocument(), typeof target === 'string' ? { elementId: target } : target)
    if (!found) return { ok: false, issues: [issue('PORTABLE_SELECTION_INVALID', 'Selection target cannot be resolved.')] }
    this.selection = [{ slideId: found.slideId, elementId: found.element.id }]
    return { ok: true, revision: this.session.getRevision(), selection: structuredClone(this.selection), issues: [] }
  }

  selectMany(targets: Array<PortableElementTarget | string>): PortableSelectionResult {
    const selection: Array<{ slideId: string; elementId: string }> = []
    for (const target of targets) {
      const found = findElement(this.session.getDocument(), typeof target === 'string' ? { elementId: target } : target)
      if (!found) return { ok: false, issues: [issue('PORTABLE_SELECTION_INVALID', 'One or more selection targets cannot be resolved.')] }
      if (!selection.some((item) => item.slideId === found.slideId && item.elementId === found.element.id)) selection.push({ slideId: found.slideId, elementId: found.element.id })
    }
    this.selection = selection
    return { ok: true, revision: this.session.getRevision(), selection: structuredClone(this.selection), issues: [] }
  }

  getSelection(): Array<{ slideId: string; elementId: string }> { return structuredClone(this.selection) }

  editText(target: { slideId?: string; elementId?: string; semanticKey?: string }, value: string): QuickFixResult {
    if (!quickFixEditingEnabled(this.profile)) return { ok: false, issues: [issue('PORTABLE_EDIT_UNSUPPORTED', 'Viewer profile does not allow edits.')] }
    const found = findElement(this.session.getDocument(), target)
    if (!found || found.element.type !== 'text') return { ok: false, issues: [issue('PORTABLE_EDIT_UNSUPPORTED', 'Quick Fix text editing requires a resolvable Text element.')] }
    const glyphIssues = checkGlyphCoverage(this.session.getDocument(), found.element, value, { strict: true })
    if (glyphIssues.some((item) => item.severity === 'error')) return { ok: false, issues: glyphIssues }
    let content
    try { content = editRichText(found.element.content, value) } catch (cause) { return { ok: false, issues: [issue('TEXT_INVALID', cause instanceof Error ? cause.message : String(cause))] } }
    const transaction = textTransaction(this.session.getRevision(), found.slideId, found.element.id, content)
    const result = this.session.commit(transaction)
    if (result.ok) this.lastTransaction = transaction
    return { ok: result.ok, revision: result.afterRevision, issues: result.issues }
  }

  replaceImage(target: { slideId?: string; elementId?: string; semanticKey?: string }, assetId: AssetId, metadata: PortableImageImportOptions = {}): QuickFixResult {
    if (!quickFixEditingEnabled(this.profile)) return { ok: false, issues: [issue('PORTABLE_EDIT_UNSUPPORTED', 'Viewer profile does not allow edits.')] }
    const found = findElement(this.session.getDocument(), target)
    if (!found || found.element.type !== 'image') return { ok: false, issues: [issue('PORTABLE_EDIT_UNSUPPORTED', 'Quick Fix image replacement requires a resolvable Image element.')] }
    const document = this.session.getDocument()
    const data = this.assetBytes[assetId]
    if (!data) return { ok: false, issues: [issue('ASSET_MISSING', `Quick Fix asset ${assetId} is not embedded.`, assetId, 'Add the asset bytes to the portable bundle.')] }
    let asset = document.assets[assetId]
    const imported = !asset
    if (!asset) asset = createImportedAsset(assetId, data, metadata)
    try { verifyPortableBytes(asset.byteLength, asset.hash, data, `ASSET_HASH_MISMATCH: ${assetId}`) } catch (cause) { return { ok: false, issues: [issue('ASSET_HASH_MISMATCH', cause instanceof Error ? cause.message : String(cause), assetId)] } }
    const operations: Transaction['operations'] = []
    if (imported) operations.push({ opId: `portable:asset-upsert:${assetId}`, kind: 'asset.upsert', asset })
    operations.push({ opId: `portable:image:${found.element.id}`, kind: 'image.replaceAsset', slideId: found.slideId, elementId: found.element.id, assetId, preserveCrop: true })
    const transaction: Transaction = {
      transactionId: `portable:image:${found.element.id}:${this.session.getRevision().slice(-12)}`,
      baseRevision: this.session.getRevision(),
      actor: { type: 'human', id: 'portable-quick-fix' },
      scope: { kind: 'selection', slideIds: [found.slideId], elementIds: [found.element.id], permissions: ['assets'], allowInsert: false, allowDelete: false },
      changeContract: imported ? importedAssetContract(found.element.id) : replaceAssetContract(found.element.id, false),
      reason: 'Portable Quick Fix image replacement',
      createdAt: '1970-01-01T00:00:00.000Z',
      validationLevel: 'L2',
      operations,
    }
    const result = this.session.commit(transaction)
    if (result.ok) this.lastTransaction = transaction
    return { ok: result.ok, revision: result.afterRevision, issues: result.issues }
  }

  /** Validate bytes and atomically add the Asset plus replace the selected Image. */
  importImage(target: { slideId?: string; elementId?: string; semanticKey?: string }, data: Uint8Array | ArrayBuffer, options: PortableImageImportOptions = {}): QuickFixResult {
    if (!quickFixEditingEnabled(this.profile)) return { ok: false, issues: [issue('PORTABLE_EDIT_UNSUPPORTED', 'Viewer profile does not allow image imports.')] }
    const bytes = data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data)
    if (bytes.length === 0) return { ok: false, issues: [issue('ASSET_METADATA_MISSING', 'Imported image bytes must not be empty.')] }
    const assetId = options.assetId ?? `portable_asset_${sha256Binary(bytes).slice(0, 16)}`
    const previous = this.assetBytes[assetId]
    this.assetBytes[assetId] = bytes
    const result = this.replaceImage(target, assetId, options)
    if (!result.ok) {
      if (previous) this.assetBytes[assetId] = previous
      else delete this.assetBytes[assetId]
    }
    return result
  }

  /** Numeric Fact Quick Fix. The generated update and every display sync are one reviewable Transaction. */
  editFact(factId: string, value: number): QuickFixResult {
    if (!quickFixEditingEnabled(this.profile)) return { ok: false, issues: [issue('PORTABLE_EDIT_UNSUPPORTED', 'Viewer profile does not allow Fact edits.')] }
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

  cropImage(target: { slideId?: string; elementId?: string; semanticKey?: string }, crop: NormalizedRect): QuickFixResult {
    if (!advancedEditingEnabled(this.profile)) return { ok: false, issues: [issue('PORTABLE_EDIT_UNSUPPORTED', 'Image crop is available in Light Edit and Full Portable profiles only.')] }
    const found = findElement(this.session.getDocument(), target)
    if (!found || found.element.type !== 'image') return { ok: false, issues: [issue('PORTABLE_EDIT_UNSUPPORTED', 'Light Edit crop requires a resolvable Image element.')] }
    const transaction: Transaction = {
      transactionId: `portable:crop:${found.element.id}:${this.session.getRevision().slice(-12)}`,
      baseRevision: this.session.getRevision(),
      actor: { type: 'human', id: 'portable-light-edit' },
      scope: { kind: 'selection', slideIds: [found.slideId], elementIds: [found.element.id], permissions: ['assets'], allowInsert: false, allowDelete: false },
      changeContract: cropOnlyContract(found.element.id),
      reason: 'Portable Light Edit image crop',
      createdAt: '1970-01-01T00:00:00.000Z',
      validationLevel: 'L2',
      operations: [{ opId: `portable:crop:${found.element.id}`, kind: 'image.setCrop', slideId: found.slideId, elementId: found.element.id, crop }],
    }
    return this.commitPortableTransaction(transaction)
  }

  setImageCrop(target: { slideId?: string; elementId?: string; semanticKey?: string }, crop: NormalizedRect): QuickFixResult { return this.cropImage(target, crop) }
  editImageCrop(target: { slideId?: string; elementId?: string; semanticKey?: string }, crop: NormalizedRect): QuickFixResult { return this.cropImage(target, crop) }

  updateChartData(target: { slideId?: string; elementId?: string; semanticKey?: string }, data: ChartData): QuickFixResult {
    if (!advancedEditingEnabled(this.profile)) return { ok: false, issues: [issue('PORTABLE_EDIT_UNSUPPORTED', 'Chart data editing is available in Light Edit and Full Portable profiles only.')] }
    const found = findElement(this.session.getDocument(), target)
    if (!found || found.element.type !== 'chart') return { ok: false, issues: [issue('PORTABLE_EDIT_UNSUPPORTED', 'Light Edit chart editing requires a resolvable Chart element.')] }
    const transaction: Transaction = {
      transactionId: `portable:chart-data:${found.element.id}:${this.session.getRevision().slice(-12)}`,
      baseRevision: this.session.getRevision(),
      actor: { type: 'human', id: 'portable-light-edit' },
      scope: { kind: 'selection', slideIds: [found.slideId], elementIds: [found.element.id], permissions: ['content'], allowInsert: false, allowDelete: false },
      changeContract: chartDataOnlyContract(found.element.id),
      reason: 'Portable Light Edit chart data',
      createdAt: '1970-01-01T00:00:00.000Z',
      validationLevel: 'L2',
      operations: [{ opId: `portable:chart-data:${found.element.id}`, kind: 'chart.replaceData', slideId: found.slideId, elementId: found.element.id, data }],
    }
    return this.commitPortableTransaction(transaction)
  }

  editChartData(target: { slideId?: string; elementId?: string; semanticKey?: string }, data: ChartData): QuickFixResult { return this.updateChartData(target, data) }
  replaceChartData(target: { slideId?: string; elementId?: string; semanticKey?: string }, data: ChartData): QuickFixResult { return this.updateChartData(target, data) }

  moveElement(target: { slideId?: string; elementId?: string; semanticKey?: string }, point: { x: number; y: number }): QuickFixResult {
    return this.geometryEdit(target, { kind: 'element.move', point })
  }

  resizeElement(target: { slideId?: string; elementId?: string; semanticKey?: string }, frame: Frame): QuickFixResult {
    return this.geometryEdit(target, { kind: 'element.resize', frame })
  }

  scaleElement(target: PortableElementTarget, factor: number): QuickFixResult {
    if (!Number.isFinite(factor) || factor <= 0) return { ok: false, issues: [issue('GEOMETRY_INVALID', 'Scale factor must be finite and positive.')] }
    const found = findElement(this.session.getDocument(), target)
    if (!found) return { ok: false, issues: [issue('PORTABLE_EDIT_UNSUPPORTED', 'Scale requires a resolvable element.')] }
    return this.geometryEdit(target, { kind: 'element.resize', frame: { ...found.element.frame, width: found.element.frame.width * factor, height: found.element.frame.height * factor } })
  }

  rotateElement(target: PortableElementTarget, rotationDeg: number): QuickFixResult {
    if (!advancedEditingEnabled(this.profile)) return { ok: false, issues: [issue('PORTABLE_EDIT_UNSUPPORTED', 'Rotation is available in Light Edit and Full Portable profiles only.')] }
    if (!Number.isFinite(rotationDeg)) return { ok: false, issues: [issue('GEOMETRY_INVALID', 'Rotation must be finite.')] }
    const found = findElement(this.session.getDocument(), target)
    if (!found) return { ok: false, issues: [issue('PORTABLE_EDIT_UNSUPPORTED', 'Rotation requires a resolvable element.')] }
    const transaction: Transaction = {
      transactionId: `portable:rotate:${found.element.id}:${this.session.getRevision().slice(-12)}`,
      baseRevision: this.session.getRevision(),
      actor: { type: 'human', id: 'portable-full' },
      scope: { kind: 'selection', slideIds: [found.slideId], elementIds: [found.element.id], permissions: ['geometry'], allowInsert: false, allowDelete: false },
      changeContract: rotationOnlyContract(found.element.id, false),
      reason: 'Portable element rotation',
      createdAt: '1970-01-01T00:00:00.000Z',
      validationLevel: 'L2',
      operations: [{ opId: `portable:rotate:${found.element.id}`, kind: 'element.rotate', slideId: found.slideId, elementId: found.element.id, rotationDeg }],
    }
    return this.commitPortableTransaction(transaction)
  }

  undo(): QuickFixResult {
    if (!quickFixEditingEnabled(this.profile)) return { ok: false, issues: [issue('PORTABLE_EDIT_UNSUPPORTED', 'Viewer profile does not allow undo.')] }
    const result = this.session.undo()
    return { ok: result.ok, revision: result.afterRevision, issues: result.issues }
  }

  redo(): QuickFixResult {
    if (!quickFixEditingEnabled(this.profile)) return { ok: false, issues: [issue('PORTABLE_EDIT_UNSUPPORTED', 'Viewer profile does not allow redo.')] }
    const result = this.session.redo()
    return { ok: result.ok, revision: result.afterRevision, issues: result.issues }
  }

  saveAsProject(options: { timestamp?: string; clean?: boolean; compatibilityProfile?: string } = {}): QuickFixResult {
    try {
      const bytes = buildPortableCheckpointBytes(this.session.getDocument(), { timestamp: options.timestamp ?? '1970-01-01T00:00:00.000Z', clean: options.clean, compatibilityProfile: options.compatibilityProfile ?? inferCompatibilityProfile(this.session.getDocument()), runtimeProfile: this.profile === 'light-edit' || this.profile === 'full-portable' ? 'ga-c' : runtimeProfileForCompatibility(inferCompatibilityProfile(this.session.getDocument())), recentTransactions: options.clean ? [] : this.session.getHistory().map((entry) => entry.transaction), assetBytes: this.assetBytes, fontBytes: this.fontBytes })
      return { ok: true, revision: this.session.getRevision(), bytes, issues: [] }
    } catch (cause) { return { ok: false, issues: [issue('CHECKPOINT_FAILED', cause instanceof Error ? cause.message : String(cause))] } }
  }

  saveAsNewProject(options: { timestamp?: string; compatibilityProfile?: string } = {}): QuickFixResult { return this.saveAsProject(options) }

  saveAsPortable(options: Omit<PortableBuildOptions, 'profile'> = {}): PortableBuildResult {
    return buildPortable(this.session.getDocument(), { ...options, profile: this.profile, recentTransactions: this.getHistory(), sourceRevision: this.session.getRevision(), assetBytes: this.assetBytes, fontBytes: this.fontBytes })
  }

  /** Semantic alias for callers that want to make the browser-copy role explicit. */
  saveAsEditableCopy(options: Omit<PortableBuildOptions, 'profile'> = {}): PortableBuildResult {
    return this.saveAsPortable(options)
  }

  presenterState(): PresenterState {
    const document = this.session.getDocument()
    const normalized = normalizePresenterState(document, { slideIndex: this.slideIndex, step: this.step })
    this.slideIndex = normalized.slideIndex
    this.step = normalized.step
    const slideId = document.slideOrder[this.slideIndex] ?? document.slideOrder[0] ?? ''
    const slide = document.slides[slideId]
    const maxStep = animationSteps(document, slideId).at(-1) ?? 0
    return { slideId, slideIndex: this.slideIndex, step: Math.min(this.step, maxStep), maxStep, notes: slide?.notes }
  }

  next(): PresenterState {
    const next = advancePresenterState(this.session.getDocument(), { slideIndex: this.slideIndex, step: this.step })
    this.slideIndex = next.slideIndex
    this.step = next.step
    return this.presenterState()
  }

  previous(): PresenterState {
    const previous = retreatPresenterState(this.session.getDocument(), { slideIndex: this.slideIndex, step: this.step })
    this.slideIndex = previous.slideIndex
    this.step = previous.step
    return this.presenterState()
  }

  setSlide(index: number): PresenterState {
    this.slideIndex = Math.max(0, Math.min(Math.floor(index), this.session.getDocument().slideOrder.length - 1))
    this.step = 0
    return this.presenterState()
  }

  clickStep(): PresenterState { return this.next() }

  private commitPortableTransaction(transaction: Transaction): QuickFixResult {
    const result = this.session.commit(transaction)
    if (result.ok) this.lastTransaction = transaction
    return { ok: result.ok, revision: result.afterRevision, issues: result.issues }
  }

  private geometryEdit(target: { slideId?: string; elementId?: string; semanticKey?: string }, change: { kind: 'element.move'; point: { x: number; y: number } } | { kind: 'element.resize'; frame: Frame }): QuickFixResult {
    if (!advancedEditingEnabled(this.profile)) return { ok: false, issues: [issue('PORTABLE_EDIT_UNSUPPORTED', 'Move and resize are available in Light Edit and Full Portable profiles only.')] }
    const found = findElement(this.session.getDocument(), target)
    if (!found) return { ok: false, issues: [issue('PORTABLE_EDIT_UNSUPPORTED', 'Light Edit geometry requires a resolvable element.')] }
    const operation = change.kind === 'element.move'
      ? { opId: `portable:move:${found.element.id}`, kind: 'element.move' as const, slideId: found.slideId, elementId: found.element.id, x: change.point.x, y: change.point.y }
      : { opId: `portable:resize:${found.element.id}`, kind: 'element.resize' as const, slideId: found.slideId, elementId: found.element.id, frame: change.frame }
    const transaction: Transaction = {
      transactionId: `portable:${change.kind.slice('element.'.length)}:${found.element.id}:${this.session.getRevision().slice(-12)}`,
      baseRevision: this.session.getRevision(),
      actor: { type: 'human', id: 'portable-light-edit' },
      scope: { kind: 'selection', slideIds: [found.slideId], elementIds: [found.element.id], permissions: ['geometry'], allowInsert: false, allowDelete: false },
      changeContract: geometryOnlyContract([found.element.id], false),
      reason: `Portable Light Edit ${change.kind}`,
      createdAt: '1970-01-01T00:00:00.000Z',
      validationLevel: 'L2',
      operations: [operation],
    }
    return this.commitPortableTransaction(transaction)
  }
}

/** Presenter and Portable Runtime intentionally share the same state machine. */
export class Presenter extends PortableRuntime {
  constructor(document: PpteDocument) { super(document, { profile: 'viewer' }) }
}

/** Build the self-contained file:// surface. Resources are hydrated from the
 * JSON payload by portableScript so each Asset/Font is embedded only once. */
function assembleHtml(document: PpteDocument, payload: PortablePayload, assetSources: Record<string, string>): string {
  const editable = payload.origin.profile !== 'viewer'
  const offlineAssetSources = Object.fromEntries(Object.keys(document.assets).map((assetId) => [assetId, assetSources[assetId] ?? '']))
  const rendered = renderDocumentSurfaceHtml(document, { assetSources: offlineAssetSources, editable })
  const payloadJson = JSON.stringify(payload).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026')
  const editingControls = editable
    ? `<button type="button" data-ppte-action="undo">Undo</button><button type="button" data-ppte-action="redo">Redo</button><label class="ppte-file-label">Replace image<input type="file" accept="image/*" data-ppte-action="import-image"></label><button type="button" data-ppte-action="save-portable">保存可编辑副本 (.ppte.html)</button><button type="button" data-ppte-action="save">导出源项目 (.ppte，需 PPTe Host)</button>${payload.origin.profile === 'light-edit' || payload.origin.profile === 'full-portable' ? '<button type="button" data-ppte-action="crop">Crop</button><button type="button" data-ppte-action="chart-data">Chart data</button><button type="button" data-ppte-action="move-left">Move left</button><button type="button" data-ppte-action="move-right">Move right</button><button type="button" data-ppte-action="scale-up">Scale up</button><button type="button" data-ppte-action="scale-down">Scale down</button><button type="button" data-ppte-action="rotate">Rotate</button>' : ''}`
    : ''
  return `<!doctype html><html lang="${css(document.locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="ppte-runtime-version" content="${css(payload.origin.runtimeVersion)}"><meta name="ppte-source-revision" content="${css(payload.origin.sourceRevision)}"><meta name="ppte-deliverable" content="${editable ? 'editable-browser-copy' : 'read-only-preview'}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; script-src 'unsafe-inline';"><style>html,body{margin:0;min-height:100%;background:#111827;color:#f9fafb;font-family:system-ui,sans-serif}#ppte-shell{min-height:100vh;display:grid;grid-template-rows:auto 1fr auto}.ppte-toolbar{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;padding:.5rem;background:#0f172a;position:sticky;top:0;z-index:2}.ppte-toolbar button,.ppte-file-label{padding:.35rem .6rem;color:#f9fafb;background:#1e293b;border:1px solid #475569;border-radius:.25rem;cursor:pointer;font-size:.82rem}.ppte-file-label input{display:none}.ppte-status{margin-left:auto;font-size:.8rem;color:#cbd5e1}.ppte-stage{display:flex;align-items:center;justify-content:center;overflow:auto;padding:1rem;min-width:0;min-height:0}.ppte-canvas{position:relative;flex:none}.ppte-canvas>.ppte-slide{position:absolute;left:0;top:0;display:none;box-shadow:0 1rem 3rem #0008;transform-origin:top left;max-width:none;max-height:none}.ppte-${payload.origin.profile} [data-ppte-type="text"]{outline:1px dashed #60a5fa;cursor:text}.ppte-${payload.origin.profile} [data-ppte-selected="true"]{outline:2px solid #38bdf8!important;outline-offset:2px}.ppte-notes{min-height:1.5rem;padding:.5rem 1rem;background:#0f172a;color:#cbd5e1;font-size:.85rem;white-space:pre-wrap}@keyframes ppte-enter-fade{from{opacity:0}to{opacity:1}}@keyframes ppte-enter-slide-up{from{opacity:0;transform:translateY(1rem)}to{opacity:1;transform:translateY(0)}}@keyframes ppte-enter-slide-left{from{opacity:0;transform:translateX(1rem)}to{opacity:1;transform:translateX(0)}}@keyframes ppte-enter-scale{from{opacity:0;scale:.96}to{opacity:1;scale:1}}@keyframes ppte-transition-fade{from{opacity:0}to{opacity:1}}@keyframes ppte-transition-slide{from{opacity:0;transform:translateX(2rem)}to{opacity:1;transform:translateX(0)}}@keyframes ppte-transition-push{from{opacity:0}to{opacity:1}}</style></head><body><div id="ppte-shell" class="ppte-${payload.origin.profile}" data-ppte-profile="${payload.origin.profile}" data-ppte-deliverable="${editable ? 'true' : 'false'}" data-ppte-deliverable-role="${editable ? 'editable-browser-copy' : 'read-only-preview'}"><div class="ppte-toolbar"><button type="button" data-ppte-action="previous">Previous</button><button type="button" data-ppte-action="next">Next</button><button type="button" data-ppte-action="fullscreen">开始演示（全屏）</button>${editingControls}<span class="ppte-status" data-ppte-status>Offline ${payload.origin.profile} · no sync</span></div><main class="ppte-stage" data-ppte-stage><div class="ppte-canvas" data-ppte-canvas style="width:${document.canvas.width}px;height:${document.canvas.height}px">${rendered}</div></main><div class="ppte-notes" data-ppte-notes aria-live="polite"></div></div><script id="ppte-portable-payload" type="application/json">${payloadJson}</script><script id="ppte-runtime">${portableScript()}</script></body></html>`
}


/**
 * Save-as-project is deliberately implemented against the lower archive
 * adapter. Portable Runtime may depend on Core, but Core/File Format must not
 * become a dependency cycle through the Portable package.
 */
export function buildPortableCheckpointBytes(document: PpteDocument, options: { timestamp?: string; clean?: boolean; compatibilityProfile?: string; runtimeProfile?: RuntimeProfile; redoHistory?: HistoryEntry[]; recentTransactions?: Transaction[]; assetBytes?: Record<string, Uint8Array>; fontBytes?: Record<string, Uint8Array> }): Uint8Array {
  const issues = validateRuntimeDocument(document, { runtimeProfile: options.runtimeProfile ?? 'ga-b' }).filter((item) => item.severity === 'error')
  if (issues.length) throw new Error(issues.map((item) => `${item.code}: ${item.message}`).join('\n'))
  const snapshot = options.clean ? cleanPortableSnapshot(document) : document
  const compatibilityProfile = options.compatibilityProfile ?? inferCompatibilityProfile(snapshot)
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

  if(!options.clean&&options.redoHistory?.length)addPortableEntry(entries,'history/redo.json',bytes(canonicalJsonString(options.redoHistory)))
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
  assertDocumentCompatibility(document, compatibilityProfile)
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

// Set by the Node packaging adapter or the running self-contained HTML.
let executableScript = ''
export function configurePortableScript(script: string): void { executableScript = script }
function portableScript(): string {
  if (!executableScript) throw new Error('PORTABLE_RUNTIME_MISSING: build the browser runtime before packaging.')
  return executableScript.replace(/<\/script/gi, '<\\/script')
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
function quickFixEditingEnabled(profile: PortableProfile): boolean { return profile === 'quick-fix' || profile === 'light-edit' || profile === 'full-portable' }
function advancedEditingEnabled(profile: PortableProfile): boolean { return profile === 'light-edit' || profile === 'full-portable' }
function importedAssetContract(elementId: string): Transaction['changeContract'] {
  return {
    allowedOperationKinds: ['asset.upsert', 'image.replaceAsset'],
    allowedElementIds: [elementId],
    maxChangedSlides: 1,
    maxChangedElements: 1,
    maxInsertedElements: 0,
    maxDeletedElements: 0,
    maxReplacedAssets: 1,
    maxChangedFacts: 0,
    maxChangedSources: 0,
    maxChangedThemeTokens: 0,
    maxChangedStylePresets: 0,
    preserve: { content: 'preserve', data: 'preserve', style: 'preserve', geometry: 'preserve', asset: 'allow', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' },
    requireConfirmation: false,
    userIntentSummary: 'Import one verified local image and replace the selected Image atomically.',
  }
}
function createImportedAsset(assetId: AssetId, data: Uint8Array, options: PortableImageImportOptions): Asset {
  const mimeType = options.mimeType ?? 'image/png'
  const fileName = (options.fileName ?? `${assetId}.png`).replace(/[^A-Za-z0-9._-]+/g, '_')
  const extension = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase() : mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png'
  const safeId = assetId.replace(/[^A-Za-z0-9._-]+/g, '_')
  return {
    id: assetId,
    hash: `sha256-${sha256Binary(data)}`,
    mimeType,
    byteLength: data.length,
    path: `assets/${safeId}.${extension}`,
    ...(options.width === undefined ? {} : { width: options.width }),
    ...(options.height === undefined ? {} : { height: options.height }),
    altText: options.altText ?? fileName,
    source: { kind: 'upload', importedAt: options.importedAt ?? '1970-01-01T00:00:00.000Z' },
  }
}
function cloneBytes(value: Record<string, Uint8Array> | undefined): Record<string, Uint8Array> { return Object.fromEntries(Object.entries(value ?? {}).map(([key, data]) => [key, new Uint8Array(data)])) }
export function base64(data: Uint8Array): string { if (encodeBase64) return encodeBase64(data); let s = ''; for (let i = 0; i < data.length; i += 8192) s += String.fromCharCode(...data.subarray(i, i + 8192)); return btoa(s) }
function css(value: string): string { return value.replace(/[^A-Za-z0-9 ,._:-]/g, '') }
function normalizeHash(hash: string): string { return (hash.startsWith('sha256-') ? hash.slice(7) : hash).toLowerCase() }
function sha256Binary(data: Uint8Array): string { return binaryHash(data) }
function issue(code: string, message: string, elementId?: string, recovery?: string): ValidationIssue { return withErrorSemantics({ code, severity: 'error', message, elementId, recovery }) }
function dedupe(issues: ValidationIssue[]): ValidationIssue[] { const seen = new Set<string>(); return issues.filter((item) => { const key = `${item.code}|${item.message}|${item.elementId ?? ''}`; if (seen.has(key)) return false; seen.add(key); return true }) }
