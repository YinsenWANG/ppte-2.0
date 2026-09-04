import { canonicalJsonString, canonicalRevision, sha256HexBytes } from '../../canonical-json/src/index.js'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { PpteSession } from '../../core/src/index.js'
import { contentOnlyContract, cropOnlyContract, chartDataOnlyContract, geometryOnlyContract, replaceAssetContract, rotationOnlyContract } from '../../change-contract/src/index.js'
import { readStoredZip, writeStoredZip } from '../../archive/src/index.js'
import { renderDocumentSurfaceHtml } from '../../renderer-react/src/index.js'
import { checkGlyphCoverage, validateRuntimeDocument, validateTransactionShape } from '../../validation/src/index.js'
import { plainTextToRichText } from '../../richtext-adapter/src/index.js'
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
  const payload: PortablePayload = { document, origin, minimumCompatibilityProfile: inferCompatibilityProfile(document), assets, fonts, capabilityReport }
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
  const origin = payload.origin
  if (!origin?.sourceDocumentId || !origin.sourceRevision || !origin.profile || !origin.runtimeVersion) issues.push(issue('PORTABLE_ORIGIN_MISSING', 'Portable output must carry source origin metadata.'))
  if (origin?.sourceDocumentId !== payload.document.documentId) issues.push(issue('PORTABLE_ORIGIN_MISMATCH', 'Portable origin does not identify the embedded document.'))
  if (origin?.sourceRevision && canonicalRevision(payload.document) !== origin.sourceRevision) issues.push(issue('PORTABLE_ORIGIN_MISMATCH', 'Portable origin revision does not match the embedded document.'))
  if (payload.capabilityReport?.sourceDocumentId !== payload.document.documentId || payload.capabilityReport?.sourceRevision !== origin?.sourceRevision) issues.push(issue('PORTABLE_CAPABILITY_MISMATCH', 'Capability report does not describe the embedded source revision.'))
  if (payload.minimumCompatibilityProfile && payload.minimumCompatibilityProfile !== inferCompatibilityProfile(payload.document)) issues.push(issue('PORTABLE_CAPABILITY_MISMATCH', 'Portable minimum Compatibility Profile does not describe the embedded document.'))
  if (origin?.profile !== 'viewer' && origin?.profile !== 'quick-fix' && origin?.profile !== 'light-edit' && origin?.profile !== 'full-portable') issues.push(issue('PORTABLE_PROFILE_UNSUPPORTED', 'Portable profile is not recognized by this runtime.'))
  if (/<(?:script|link)[^>]+(?:src|href)\s*=\s*["'](?:https?:|\/\/|data:)/i.test(html) || /<img[^>]+src\s*=\s*["'](?!data:|blob:|["'])/i.test(html)) issues.push(issue('PORTABLE_NETWORK_DISABLED', 'Portable output may not load external runtime or asset resources.'))
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(html)) issues.push(issue('PORTABLE_NETWORK_DISABLED', 'Portable runtime contains a network-capable API call.'))
  if (/\beval\s*\(|new\s+Function\s*\(/.test(html)) issues.push(issue('PORTABLE_PAYLOAD_UNSAFE', 'Portable runtime may not evaluate generated code.'))
  if (/<script[^>]+src\s*=/i.test(html) || /<link[^>]+href\s*=/i.test(html)) issues.push(issue('PORTABLE_EXTERNAL_RUNTIME', 'Portable runtime must be self-contained.'))
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

  constructor(document: PpteDocument, options: { profile?: PortableProfile; assetBytes?: Record<AssetId, Uint8Array>; fontBytes?: Record<FontId, Uint8Array> } = {}) {
    this.profile = options.profile ?? 'viewer'
    const runtimeProfile = this.profile === 'light-edit' || this.profile === 'full-portable' ? 'ga-c' : runtimeProfileForCompatibility(inferCompatibilityProfile(document))
    this.session = new PpteSession(document, { runtimeProfile })
    this.assetBytes = cloneBytes(options.assetBytes)
    this.fontBytes = cloneBytes(options.fontBytes)
  }

  readonly profile: PortableProfile

  getDocument(): Readonly<PpteDocument> { return this.session.getDocument() }
  getRevision(): Revision { return this.session.getRevision() }
  getCapabilityReport(): CapabilityReport { return buildCapabilityReport(this.session.getDocument(), this.profile === 'quick-fix' ? 'portable-quick-fix' : this.profile === 'light-edit' || this.profile === 'full-portable' ? 'portable-light-edit' : 'portable-viewer', { sourceRevision: this.session.getRevision() }) }
  getAssetBytes(): Record<string, Uint8Array> { return cloneBytes(this.assetBytes) }
  getFontBytes(): Record<string, Uint8Array> { return cloneBytes(this.fontBytes) }
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
    try { content = plainTextToRichText(value, `${found.element.id}-p`) } catch (cause) { return { ok: false, issues: [issue('TEXT_INVALID', cause instanceof Error ? cause.message : String(cause))] } }
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
    return buildPortable(this.session.getDocument(), { ...options, profile: this.profile, sourceRevision: this.session.getRevision(), assetBytes: this.assetBytes, fontBytes: this.fontBytes })
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
  return `<!doctype html><html lang="${css(document.locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="ppte-runtime-version" content="${css(payload.origin.runtimeVersion)}"><meta name="ppte-source-revision" content="${css(payload.origin.sourceRevision)}"><meta name="ppte-deliverable" content="${editable ? 'editable-browser-copy' : 'read-only-preview'}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; script-src 'unsafe-inline';"><style>html,body{margin:0;min-height:100%;background:#111827;color:#f9fafb;font-family:system-ui,sans-serif}#ppte-shell{min-height:100vh;display:grid;grid-template-rows:auto 1fr auto}.ppte-toolbar{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;padding:.5rem;background:#0f172a;position:sticky;top:0;z-index:2}.ppte-toolbar button,.ppte-file-label{padding:.35rem .6rem;color:#f9fafb;background:#1e293b;border:1px solid #475569;border-radius:.25rem;cursor:pointer;font-size:.82rem}.ppte-file-label input{display:none}.ppte-status{margin-left:auto;font-size:.8rem;color:#cbd5e1}.ppte-stage{display:flex;align-items:center;justify-content:center;overflow:auto;padding:1rem;min-width:0;min-height:0}.ppte-canvas{position:relative;flex:none}.ppte-canvas>.ppte-slide{position:absolute;left:0;top:0;display:none;box-shadow:0 1rem 3rem #0008;transform-origin:top left;max-width:none;max-height:none}.ppte-${payload.origin.profile} [data-ppte-type="text"]{outline:1px dashed #60a5fa;cursor:text}.ppte-${payload.origin.profile} [data-ppte-selected="true"]{outline:2px solid #38bdf8!important;outline-offset:2px}.ppte-notes{min-height:1.5rem;padding:.5rem 1rem;background:#0f172a;color:#cbd5e1;font-size:.85rem;white-space:pre-wrap}@keyframes ppte-enter-fade{from{opacity:0}to{opacity:1}}@keyframes ppte-enter-slide-up{from{opacity:0;transform:translateY(1rem)}to{opacity:1;transform:translateY(0)}}@keyframes ppte-enter-slide-left{from{opacity:0;transform:translateX(1rem)}to{opacity:1;transform:translateX(0)}}@keyframes ppte-enter-scale{from{opacity:0;scale:.96}to{opacity:1;scale:1}}@keyframes ppte-transition-fade{from{opacity:0}to{opacity:1}}@keyframes ppte-transition-slide{from{opacity:0;transform:translateX(2rem)}to{opacity:1;transform:translateX(0)}}@keyframes ppte-transition-push{from{opacity:0}to{opacity:1}}</style></head><body><div id="ppte-shell" class="ppte-${payload.origin.profile}" data-ppte-profile="${payload.origin.profile}" data-ppte-deliverable="${editable ? 'true' : 'false'}" data-ppte-deliverable-role="${editable ? 'editable-browser-copy' : 'read-only-preview'}"><div class="ppte-toolbar"><button type="button" data-ppte-action="previous">Previous</button><button type="button" data-ppte-action="next">Next</button><button type="button" data-ppte-action="fullscreen">开始演示（全屏）</button>${editingControls}<span class="ppte-status" data-ppte-status>Offline ${payload.origin.profile} · no sync</span></div><main class="ppte-stage" data-ppte-stage><div class="ppte-canvas" data-ppte-canvas style="width:${document.canvas.width}px;height:${document.canvas.height}px">${rendered}</div></main><div class="ppte-notes" data-ppte-notes aria-live="polite"></div></div><script id="ppte-portable-payload" type="application/json">${payloadJson}</script><script>${portableScript(STANDARD_EDITABLE_SUFFIX)}</script></body></html>`
}


/**
 * Save-as-project is deliberately implemented against the lower archive
 * adapter. Portable Runtime may depend on Core, but Core/File Format must not
 * become a dependency cycle through the Portable package.
 */
function buildPortableCheckpointBytes(document: PpteDocument, options: { timestamp?: string; clean?: boolean; compatibilityProfile?: string; runtimeProfile?: RuntimeProfile; recentTransactions?: Transaction[]; assetBytes?: Record<string, Uint8Array>; fontBytes?: Record<string, Uint8Array> }): Uint8Array {
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

/**
 * The browser side is intentionally a small compiled boundary rather than a
 * second document model: it carries the same operation names and checkpoint
 * shape, while all durable content remains p.document.
 */
function portableScript(editableSuffix = STANDARD_EDITABLE_SUFFIX): string {
  return String.raw`(()=>{
  'use strict';
  const payloadNode=document.getElementById('ppte-portable-payload');
  if(!payloadNode) return;
  const payload=JSON.parse(payloadNode.textContent||'{}');
  let documentNode=payload.document;
  const profile=payload.origin.profile;
  const editableSuffix=__PPTE_EDITABLE_SUFFIX__;
  const editable=profile==='quick-fix'||profile==='light-edit'||profile==='full-portable';
  const lightEdit=profile==='light-edit'||profile==='full-portable';
  const root=document.getElementById('ppte-shell');
  const stage=document.querySelector('[data-ppte-stage]');
  const canvas=document.querySelector('[data-ppte-canvas]');
  const status=document.querySelector('[data-ppte-status]');
  const notes=document.querySelector('[data-ppte-notes]');
  const slides=()=>Array.from(document.querySelectorAll('[data-ppte-slide-id]'));
  let slideIndex=0;
  let step=0;
  let scale=1;
  let selectedElementId='';
  let modified=false;
  let operationNumber=0;
  let history=[];
  let redoHistory=[];
  const drafts=new Map();
  const composing=new Set();
  const dragState={value:null};

  const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  const canonical=value=>{
    if(value===null)return 'null';
    if(typeof value==='string')return JSON.stringify(value);
    if(typeof value==='boolean')return value?'true':'false';
    if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('CANONICAL_NON_FINITE_NUMBER');return Object.is(value,-0)?'0':JSON.stringify(value)}
    if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
    if(value&&typeof value==='object')return '{'+Object.entries(value).filter(([,child])=>child!==undefined).sort((a,b)=>a[0].localeCompare(b[0])).map(([key,child])=>JSON.stringify(key)+':'+canonical(child)).join(',')+'}';
    throw new Error('CANONICAL_UNSUPPORTED_TYPE');
  };
  const rotr=(value,bits)=>(value>>>bits)|(value<<(32-bits));
  const sha256=input=>{
    const hashConstants=[
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
    ];
    const bitLength=input.length*8;
    const paddedLength=Math.ceil((input.length+9)/64)*64;
    const padded=new Uint8Array(paddedLength);
    padded.set(input);padded[input.length]=0x80;
    const low=bitLength>>>0;const high=Math.floor(bitLength/0x100000000)>>>0;
    padded[padded.length-8]=high>>>24;padded[padded.length-7]=high>>>16;padded[padded.length-6]=high>>>8;padded[padded.length-5]=high;
    padded[padded.length-4]=low>>>24;padded[padded.length-3]=low>>>16;padded[padded.length-2]=low>>>8;padded[padded.length-1]=low;
    let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
    const w=new Uint32Array(64);
    for(let offset=0;offset<padded.length;offset+=64){
      for(let index=0;index<16;index+=1){const p=offset+index*4;w[index]=((padded[p]<<24)|(padded[p+1]<<16)|(padded[p+2]<<8)|padded[p+3])>>>0}
      for(let index=16;index<64;index+=1){const s0=rotr(w[index-15],7)^rotr(w[index-15],18)^(w[index-15]>>>3);const s1=rotr(w[index-2],17)^rotr(w[index-2],19)^(w[index-2]>>>10);w[index]=(w[index-16]+s0+w[index-7]+s1)>>>0}
      let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
      for(let index=0;index<64;index+=1){const s1=rotr(e,6)^rotr(e,11)^rotr(e,25);const ch=(e&f)^(~e&g);const temp1=(h+s1+ch+hashConstants[index]+w[index])>>>0;const s0=rotr(a,2)^rotr(a,13)^rotr(a,22);const maj=(a&b)^(a&c)^(b&c);const temp2=(s0+maj)>>>0;h=g;g=f;f=e;e=(d+temp1)>>>0;d=c;c=b;b=a;a=(temp1+temp2)>>>0}
      h0=(h0+a)>>>0;h1=(h1+b)>>>0;h2=(h2+c)>>>0;h3=(h3+d)>>>0;h4=(h4+e)>>>0;h5=(h5+f)>>>0;h6=(h6+g)>>>0;h7=(h7+h)>>>0;
    }
    const output=new Uint8Array(32);[h0,h1,h2,h3,h4,h5,h6,h7].forEach((word,index)=>{output[index*4]=word>>>24;output[index*4+1]=word>>>16;output[index*4+2]=word>>>8;output[index*4+3]=word});return output;
  };
  const sha256HexBytes=data=>Array.from(sha256(data),byte=>byte.toString(16).padStart(2,'0')).join('');
  const revision=()=>'sha256-'+sha256HexBytes(new TextEncoder().encode(canonical(documentNode)));
  const utf8=value=>new TextEncoder().encode(value);
  const base64Bytes=value=>{const raw=atob(value||'');const output=new Uint8Array(raw.length);for(let index=0;index<raw.length;index+=1)output[index]=raw.charCodeAt(index);return output};
  const bytesBase64=value=>{let raw='';for(let index=0;index<value.length;index+=0x8000)raw+=String.fromCharCode(...value.subarray(index,index+0x8000));return btoa(raw)};
  const escapeHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  const safeFilename=value=>{const normalized=String(value||'presentation').normalize('NFC');const cleaned=normalized.replace(/[\u0000-\u001f\u007f-\u009f]/gu,'').replace(/[\\/:*?"<>|]/gu,'_').replace(/[^\p{L}\p{N}\p{M}\p{Zs}._-]/gu,'_').replace(/^[.]+|[.]+$/gu,'').replace(/[ .]+$/gu,'');return cleaned||'presentation'};
  const assetUri=assetId=>{const asset=documentNode.assets&&documentNode.assets[assetId];const encoded=payload.assets&&payload.assets[assetId];return asset&&encoded?'data:'+asset.mimeType+';base64,'+encoded:''};
  const currentSlide=()=>documentNode.slides&&documentNode.slides[documentNode.slideOrder[slideIndex]];
  const elementNode=elementId=>Array.from(document.querySelectorAll('[data-ppte-element-id]')).find(node=>node.getAttribute('data-ppte-element-id')===elementId);
  const findElement=target=>{
    const wanted=typeof target==='string'?{elementId:target}:target||{};
    const ids=wanted.slideId?[wanted.slideId]:documentNode.slideOrder||[];
    for(const slideId of ids){const slide=documentNode.slides&&documentNode.slides[slideId];if(!slide)continue;const element=wanted.elementId?slide.elements[wanted.elementId]:Object.values(slide.elements||{}).find(candidate=>candidate.semanticKey===wanted.semanticKey);if(element)return {slideId,element}}
    return undefined;
  };
  const textValue=element=>element&&element.type==='text'?(element.content.paragraphs||[]).map(paragraph=>(paragraph.runs||[]).map(run=>run.text||'').join('')).join(String.fromCharCode(10)):'';
  const richText=value=>({paragraphs:String(value).split(String.fromCharCode(10)).map((line,index)=>({id:'portable-paragraph-'+(++operationNumber)+'-'+index,runs:[{id:'portable-run-'+operationNumber+'-'+index,text:line}]}))});
  const updateOrigin=()=>{const current=revision();payload.origin.sourceRevision=current;if(payload.capabilityReport)payload.capabilityReport.sourceRevision=current;modified=true;root.dataset.ppteRevision=current;return current};
  const issue=(code,message)=>({ok:false,issues:[{code,severity:'error',message}]});
  const operationId=kind=>'portable:'+kind+':'+(++operationNumber);
  const transactionFor=(operations,slideId,elementIds,permissions)=>({transactionId:operationId('transaction'),baseRevision:revision(),actor:{type:'human',id:'portable-'+profile},scope:{kind:'selection',slideIds:slideId?[slideId]:undefined,elementIds,permissions,allowInsert:operations.some(operation=>operation.kind==='asset.upsert'),allowDelete:false},changeContract:{allowedOperationKinds:operations.map(operation=>operation.kind),allowedElementIds:elementIds,maxChangedSlides:1,maxChangedElements:Math.max(1,elementIds.length),maxInsertedElements:0,maxDeletedElements:0,maxReplacedAssets:operations.some(operation=>operation.kind==='image.replaceAsset')?1:0,preserve:{content:'preserve',data:'preserve',style:'preserve',geometry:'preserve',semanticIdentity:'preserve',readingOrder:'preserve',facts:'preserve'}},createdAt:'1970-01-01T00:00:00.000Z',validationLevel:'L2',operations:clone(operations)});
  const requireElement=(slideId,elementId)=>{const element=documentNode.slides[slideId]&&documentNode.slides[slideId].elements[elementId];if(!element)throw new Error('ELEMENT_MISSING: '+elementId);return element};
  const applyOperation=(operation)=>{
    const slide=operation.slideId?documentNode.slides[operation.slideId]:undefined;
    if(operation.kind==='asset.upsert'){if(operation.remove)delete documentNode.assets[operation.asset.id];else documentNode.assets[operation.asset.id]=clone(operation.asset);return}
    if(!slide)throw new Error('SLIDE_MISSING: '+operation.slideId);
    const element=operation.elementId?requireElement(operation.slideId,operation.elementId):undefined;
    if(operation.kind==='text.replaceContent'){if(!element||element.type!=='text')throw new Error('OPERATION_TYPE_MISMATCH: text.replaceContent');element.content=clone(operation.content);return}
    if(operation.kind==='image.replaceAsset'){if(!element||element.type!=='image')throw new Error('OPERATION_TYPE_MISMATCH: image.replaceAsset');if(!documentNode.assets[operation.assetId])throw new Error('ASSET_MISSING: '+operation.assetId);element.assetId=operation.assetId;if(!operation.preserveCrop)delete element.crop;return}
    if(operation.kind==='image.setCrop'){if(!element||element.type!=='image')throw new Error('OPERATION_TYPE_MISMATCH: image.setCrop');const crop=operation.crop;if(!crop||crop.x<0||crop.y<0||crop.width<=0||crop.height<=0||crop.x+crop.width>1||crop.y+crop.height>1)throw new Error('GEOMETRY_INVALID: image crop must be inside 0..1');element.crop=clone(crop);return}
    if(operation.kind==='chart.replaceData'){if(!element||element.type!=='chart')throw new Error('OPERATION_TYPE_MISMATCH: chart.replaceData');element.data=clone(operation.data);return}
    if(operation.kind==='element.move'){if(!element)throw new Error('ELEMENT_MISSING: '+operation.elementId);element.frame.x=Number(operation.x);element.frame.y=Number(operation.y);return}
    if(operation.kind==='element.resize'){if(!element)throw new Error('ELEMENT_MISSING: '+operation.elementId);const frame=operation.frame;if(!frame||frame.width<=0||frame.height<=0)throw new Error('GEOMETRY_INVALID: resize frame');element.frame=clone(frame);return}
    if(operation.kind==='element.rotate'){if(!element||!Number.isFinite(Number(operation.rotationDeg)))throw new Error('GEOMETRY_INVALID: rotation');element.rotationDeg=Number(operation.rotationDeg);return}
    throw new Error('UNSUPPORTED_OPERATION: '+operation.kind);
  };
  const syncTextNode=(node,element)=>{if(!node||!element||element.type!=='text')return;node.innerHTML=(element.content.paragraphs||[]).map(paragraph=>{const content=(paragraph.runs||[]).map(run=>{let value=escapeHtml(run.text||'');const marks=run.marks||{};if(marks.bold)value='<strong>'+value+'</strong>';if(marks.italic)value='<em>'+value+'</em>';if(marks.underline)value='<u>'+value+'</u>';if(marks.strike)value='<s>'+value+'</s>';return value}).join('');return '<p data-ppte-paragraph-id="'+escapeHtml(paragraph.id)+'">'+content+'</p>'}).join('')};
  const syncElement=(slideId,element)=>{const node=elementNode(element.id);if(!node)return;node.setAttribute('data-ppte-selected',selectedElementId===element.id?'true':'false');node.style.left=Number(element.frame.x)+'px';node.style.top=Number(element.frame.y)+'px';node.style.width=Number(element.frame.width)+'px';node.style.height=Number(element.frame.height)+'px';node.style.opacity=String(element.opacity===undefined?1:element.opacity);node.style.transform='rotate('+Number(element.rotationDeg||0)+'deg)';if(element.type==='text'&&!drafts.has(element.id))syncTextNode(node,element);if(element.type==='image'){node.setAttribute('data-ppte-asset-id',element.assetId);const image=node.querySelector('img');if(image){image.src=assetUri(element.assetId);image.style.transform=element.crop?'scale('+Number(1/element.crop.width)+','+Number(1/element.crop.height)+')':'';image.style.transformOrigin=element.crop?Number((element.crop.x+element.crop.width/2)*100)+'% '+Number((element.crop.y+element.crop.height/2)*100)+'%':'50% 50%'}if(element.crop)node.setAttribute('data-ppte-crop',[element.crop.x,element.crop.y,element.crop.width,element.crop.height].join(','));else node.removeAttribute('data-ppte-crop')}if(element.type==='chart')node.setAttribute('data-ppte-chart-data',JSON.stringify(element.data))};
  const hydrateFonts=()=>{let style=document.getElementById('ppte-portable-fonts');if(style)style.remove();const rules=[];for(const font of Object.values(documentNode.fonts||{})){const encoded=payload.fonts&&payload.fonts[font.id];if(encoded)rules.push('@font-face{font-family:"'+String(font.family).replace(/[^\p{L}\p{N}\p{M}\p{Zs}._-]/gu,'')+'";font-style:'+font.style+';font-weight:'+font.weight+';src:url(data:font/woff2;base64,'+encoded+') format("woff2");font-display:block}')};if(rules.length){style=document.createElement('style');style.id='ppte-portable-fonts';style.textContent=rules.join('');document.head.appendChild(style)}};
  const fitViewport=()=>{if(!stage||!canvas)return;const availableWidth=Math.max(1,stage.clientWidth-32);const availableHeight=Math.max(1,stage.clientHeight-32);scale=Math.min(1,availableWidth/Number(documentNode.canvas.width),availableHeight/Number(documentNode.canvas.height));if(!Number.isFinite(scale)||scale<=0)scale=1;canvas.style.width=Number(documentNode.canvas.width)*scale+'px';canvas.style.height=Number(documentNode.canvas.height)*scale+'px';for(const slide of slides())slide.style.transform='scale('+scale+')'};
  const slideSteps=()=>Array.from(new Set(Array.from(slides()[slideIndex]?.querySelectorAll('[data-ppte-appear-step]')||[]).map(node=>Number(node.getAttribute('data-ppte-appear-step'))).filter(value=>Number.isInteger(value)&&value>0))).sort((a,b)=>a-b);
  const show=()=>{const all=slides();all.forEach((slide,index)=>{const active=index===slideIndex;slide.style.display=active?'block':'none';slide.style.transform='scale('+scale+')';slide.querySelectorAll('[data-ppte-appear-step]').forEach(node=>{const visible=active&&Number(node.getAttribute('data-ppte-appear-step'))<=step;node.style.visibility=visible?'visible':'hidden';const type=node.getAttribute('data-ppte-animation-enter');if(type){node.style.animationName=visible?'ppte-enter-'+type:'none';node.style.animationDuration=(node.getAttribute('data-ppte-animation-duration-ms')||'0')+'ms';node.style.animationDelay=(node.getAttribute('data-ppte-animation-delay-ms')||'0')+'ms';node.style.animationTimingFunction=node.getAttribute('data-ppte-animation-easing')||'ease';node.style.animationFillMode='both'}});const transition=slide.getAttribute('data-ppte-transition-type');slide.style.animationName=active&&transition&&transition!=='none'?'ppte-transition-'+transition:'none';slide.style.animationDuration=(slide.getAttribute('data-ppte-transition-duration-ms')||'0')+'ms';slide.style.animationFillMode='both'});const slide=currentSlide();if(notes)notes.textContent=slide&&slide.notes?(slide.notes.speaker||slide.notes.handout||''):'';if(status)status.textContent='Offline '+profile+(modified?' · modified':'')+' · slide '+(slideIndex+1)+'/'+all.length+(selectedElementId?' · selected':'');if(root)root.dataset.ppteStep=String(step);document.documentElement.dataset.ppteRevision=revision()};
  const refresh=()=>{for(const slide of Object.values(documentNode.slides||{}))for(const element of Object.values(slide.elements||{}))syncElement(slide.id,element);hydrateFonts();fitViewport();show()};
  const commitTransaction=(operations,label)=>{const before=clone(documentNode);const beforeRevision=revision();const transaction=transactionFor(operations,operations.find(operation=>operation.slideId)?.slideId,operations.filter(operation=>operation.elementId).map(operation=>operation.elementId),operations.some(operation=>operation.kind==='asset.upsert'||operation.kind.startsWith('image.'))?['assets']:['content']);try{for(const operation of operations)applyOperation(operation);const afterRevision=revision();if(afterRevision===beforeRevision)return {ok:true,revision:afterRevision,issues:[],transaction};history.push({before,after:clone(documentNode),transaction});redoHistory=[];updateOrigin();payload.lastTransaction=transaction;refresh();if(status)status.textContent='Offline '+profile+' · '+label+' · committed';return {ok:true,revision:afterRevision,issues:[],transaction}}catch(error){documentNode=before;payload.document=documentNode;return issue('OPERATION_APPLY_FAILED',error instanceof Error?error.message:String(error))}};
  const commitText=(elementId,value)=>{const found=findElement({elementId});if(!found||found.element.type!=='text')return issue('PORTABLE_EDIT_UNSUPPORTED','Text target cannot be resolved.');const next=String(value);if(textValue(found.element)===next){drafts.delete(elementId);return {ok:true,revision:revision(),issues:[]}};drafts.delete(elementId);return commitTransaction([{opId:operationId('text.replaceContent'),kind:'text.replaceContent',slideId:found.slideId,elementId,content:richText(next)}],'text edit')};
  const editText=(target,value)=>editable?commitText((findElement(target)||{}).element?.id,value):issue('PORTABLE_EDIT_UNSUPPORTED','Viewer profile does not allow text edits.');
  const replaceImage=(target,assetId)=>{if(!editable)return issue('PORTABLE_EDIT_UNSUPPORTED','Viewer profile does not allow image edits.');const found=findElement(target);if(!found||found.element.type!=='image')return issue('PORTABLE_EDIT_UNSUPPORTED','Image target cannot be resolved.');if(!documentNode.assets[assetId]||!payload.assets[assetId])return issue('ASSET_MISSING','Image asset is not available in this offline package.');return commitTransaction([{opId:operationId('image.replaceAsset'),kind:'image.replaceAsset',slideId:found.slideId,elementId:found.element.id,assetId,preserveCrop:true}],'image replacement')};
  const createImportedAsset=(assetId,data,options)=>{const mimeType=options.mimeType||'image/png';const filename=String(options.fileName||assetId+'.png').replace(/[^A-Za-z0-9._-]+/g,'_');const extension=filename.includes('.')?filename.slice(filename.lastIndexOf('.')+1).toLowerCase():(mimeType==='image/jpeg'?'jpg':mimeType==='image/webp'?'webp':'png');return {id:assetId,hash:'sha256-'+sha256HexBytes(data),mimeType,byteLength:data.length,path:'assets/'+assetId.replace(/[^A-Za-z0-9._-]+/g,'_')+'.'+extension,width:options.width,height:options.height,altText:options.altText||filename,source:{kind:'upload',importedAt:options.importedAt||new Date().toISOString()}}};
  const importImage=async(target,data,options={})=>{if(!editable)return issue('PORTABLE_EDIT_UNSUPPORTED','Viewer profile does not allow image imports.');const bytes=data instanceof Uint8Array?new Uint8Array(data):new Uint8Array(await data.arrayBuffer());if(!bytes.length)return issue('ASSET_METADATA_MISSING','Imported image is empty.');const assetId=options.assetId||'portable_asset_'+sha256HexBytes(bytes).slice(0,16);const requested=target||(selectedElementId?{elementId:selectedElementId}:undefined);const found=requested?findElement(requested):Object.values(documentNode.slides||{}).flatMap(slide=>Object.values(slide.elements||{})).map(element=>({element,slideId:documentNode.slideOrder.find(slideId=>documentNode.slides[slideId].elements[element.id])})).find(item=>item.element.type==='image');const previous=payload.assets[assetId];payload.assets[assetId]=bytesBase64(bytes);const asset=createImportedAsset(assetId,bytes,options);const result=commitTransaction([{opId:operationId('asset.upsert'),kind:'asset.upsert',asset},{opId:operationId('image.replaceAsset'),kind:'image.replaceAsset',slideId:found.slideId,elementId:found.element.id,assetId,preserveCrop:true}],'image import');if(!result.ok){if(previous===undefined)delete payload.assets[assetId];else payload.assets[assetId]=previous}return result};
  const cropImage=(target,crop)=>{if(!lightEdit)return issue('PORTABLE_EDIT_UNSUPPORTED','Image crop is available in Light Edit only.');const found=findElement(target);if(!found||found.element.type!=='image')return issue('PORTABLE_EDIT_UNSUPPORTED','Image target cannot be resolved.');return commitTransaction([{opId:operationId('image.setCrop'),kind:'image.setCrop',slideId:found.slideId,elementId:found.element.id,crop:clone(crop)}],'image crop')};
  const updateChartData=(target,data)=>{if(!lightEdit)return issue('PORTABLE_EDIT_UNSUPPORTED','Chart editing is available in Light Edit only.');const found=findElement(target);if(!found||found.element.type!=='chart')return issue('PORTABLE_EDIT_UNSUPPORTED','Chart target cannot be resolved.');return commitTransaction([{opId:operationId('chart.replaceData'),kind:'chart.replaceData',slideId:found.slideId,elementId:found.element.id,data:clone(data)}],'chart data')};
  const moveElement=(target,point)=>{if(!lightEdit)return issue('PORTABLE_EDIT_UNSUPPORTED','Geometry editing is available in Light Edit only.');const found=findElement(target);if(!found)return issue('PORTABLE_EDIT_UNSUPPORTED','Element target cannot be resolved.');return commitTransaction([{opId:operationId('element.move'),kind:'element.move',slideId:found.slideId,elementId:found.element.id,x:Number(point.x),y:Number(point.y)}],'move')};
  const resizeElement=(target,frame)=>{if(!lightEdit)return issue('PORTABLE_EDIT_UNSUPPORTED','Geometry editing is available in Light Edit only.');const found=findElement(target);if(!found)return issue('PORTABLE_EDIT_UNSUPPORTED','Element target cannot be resolved.');return commitTransaction([{opId:operationId('element.resize'),kind:'element.resize',slideId:found.slideId,elementId:found.element.id,frame:clone(frame)}],'resize')};
  const scaleElement=(target,factor)=>{const found=findElement(target);if(!found)return issue('PORTABLE_EDIT_UNSUPPORTED','Element target cannot be resolved.');return resizeElement(target,{...found.element.frame,width:found.element.frame.width*Number(factor),height:found.element.frame.height*Number(factor)})};
  const rotateElement=(target,rotationDeg)=>{if(!lightEdit)return issue('PORTABLE_EDIT_UNSUPPORTED','Rotation is available in Light Edit and Full Portable profiles only.');const found=findElement(target);if(!found||!Number.isFinite(Number(rotationDeg)))return issue('GEOMETRY_INVALID','Rotation target or value is invalid.');return commitTransaction([{opId:operationId('element.rotate'),kind:'element.rotate',slideId:found.slideId,elementId:found.element.id,rotationDeg:Number(rotationDeg)}],'rotate')};
  const undo=()=>{if(!editable)return issue('PORTABLE_EDIT_UNSUPPORTED','Viewer profile does not allow undo.');flushTextDrafts();const entry=history.pop();if(!entry)return issue('UNDO_EMPTY','There is no committed transaction to undo.');redoHistory.push({before:clone(documentNode),after:entry.after,transaction:entry.transaction});documentNode=entry.before;payload.document=documentNode;updateOrigin();refresh();return {ok:true,revision:revision(),issues:[]}};
  const redo=()=>{if(!editable)return issue('PORTABLE_EDIT_UNSUPPORTED','Viewer profile does not allow redo.');const entry=redoHistory.pop();if(!entry)return issue('REDO_EMPTY','There is no transaction to redo.');const before=clone(documentNode);documentNode=entry.after;payload.document=documentNode;history.push({before,after:clone(documentNode),transaction:entry.transaction});updateOrigin();refresh();return {ok:true,revision:revision(),issues:[]}};
  const flushTextDrafts=()=>{for(const [elementId,value] of Array.from(drafts.entries()))if(!composing.has(elementId))commitText(elementId,value)};
  const download=(data,filename,mime)=>{const objectUrl=URL.createObjectURL(new Blob([data],{type:mime}));const link=document.createElement('a');link.href=objectUrl;link.download=filename;link.click();window.setTimeout(()=>URL.revokeObjectURL(objectUrl),1000)};
  const writeU16=(buffer,offset,value)=>{buffer[offset]=value&255;buffer[offset+1]=(value>>>8)&255};
  const writeU32=(buffer,offset,value)=>{buffer[offset]=value&255;buffer[offset+1]=(value>>>8)&255;buffer[offset+2]=(value>>>16)&255;buffer[offset+3]=(value>>>24)&255};
  const crc32=data=>{let crc=0xffffffff;for(const byte of data){let value=(crc^byte)&255;for(let bit=0;bit<8;bit+=1)value=(value>>>1)^(value&1?0xedb88320:0);crc=(crc>>>8)^value}return (crc^0xffffffff)>>>0};
  const writeZip=entries=>{const local=[];const central=[];let offset=0;for(const entry of entries){const name=utf8(entry.name);const data=new Uint8Array(entry.data);const crc=crc32(data);const localPart=new Uint8Array(30+name.length+data.length);writeU32(localPart,0,0x04034b50);writeU16(localPart,4,20);writeU32(localPart,14,crc);writeU32(localPart,18,data.length);writeU32(localPart,22,data.length);writeU16(localPart,26,name.length);localPart.set(name,30);localPart.set(data,30+name.length);local.push(localPart);const centralPart=new Uint8Array(46+name.length);writeU32(centralPart,0,0x02014b50);writeU16(centralPart,4,20);writeU16(centralPart,6,20);writeU32(centralPart,16,crc);writeU32(centralPart,20,data.length);writeU32(centralPart,24,data.length);writeU16(centralPart,28,name.length);writeU32(centralPart,42,offset);centralPart.set(name,46);central.push(centralPart);offset+=localPart.length}const centralOffset=offset;const centralSize=central.reduce((sum,part)=>sum+part.length,0);const end=new Uint8Array(22);writeU32(end,0,0x06054b50);writeU16(end,8,entries.length);writeU16(end,10,entries.length);writeU32(end,12,centralSize);writeU32(end,16,centralOffset);const result=new Uint8Array(offset+centralSize+22);let cursor=0;for(const part of local){result.set(part,cursor);cursor+=part.length}for(const part of central){result.set(part,cursor);cursor+=part.length}result.set(end,cursor);return result};
  const inferredProfile=()=>{let gaB=false;for(const slide of Object.values(documentNode.slides||{})){if(slide.visualStrategy==='poster')return 'ppte-2.0-ga-c.1';if(slide.transition!==undefined)gaB=true;for(const element of Object.values(slide.elements||{})){if(element.type==='component'||element.type==='chart'&&(element.chartType==='area'||element.chartType==='donut'))return 'ppte-2.0-ga-c.1';if(element.type==='chart'||element.appearStep!==undefined||element.animation!==undefined)gaB=true}}return gaB?'ppte-2.0-ga-b.1':'ppte-2.0-ga-a.1'};
  const checkpoint=()=>{flushTextDrafts();const entries=[{name:'mimetype',data:utf8('application/vnd.ppte+zip')},{name:'document.json',data:utf8(canonical(documentNode))},{name:'assets/index.json',data:utf8(canonical(documentNode.assets||{}))},{name:'fonts/index.json',data:utf8(canonical(documentNode.fonts||{}))},{name:'history/descriptor.json',data:utf8(canonical({mode:'standard',snapshotRevision:revision(),recentTransactionCount:history.length,deepHistoryExternal:true}))}];if(history.length)entries.push({name:'history/recent.jsonl',data:utf8(history.map(entry=>canonical(entry.transaction)).join(String.fromCharCode(10))+String.fromCharCode(10))});for(const asset of Object.values(documentNode.assets||{})){const encoded=payload.assets&&payload.assets[asset.id];if(!encoded)throw new Error('ASSET_MISSING: '+asset.id);const data=base64Bytes(encoded);if(data.length!==asset.byteLength||'sha256-'+sha256HexBytes(data)!==asset.hash)throw new Error('ASSET_HASH_MISMATCH: '+asset.id);entries.push({name:asset.path,data})}for(const font of Object.values(documentNode.fonts||{}))if(font.source==='embedded'){const encoded=payload.fonts&&payload.fonts[font.id];if(!encoded)throw new Error('FONT_MISSING: '+font.id);entries.push({name:font.path||'fonts/'+font.id+'.woff2',data:base64Bytes(encoded)})}const files=entries.filter(entry=>entry.name!=='mimetype').map(entry=>({path:entry.name,mediaType:entry.name.endsWith('.json')?'application/json':entry.name.endsWith('.jsonl')?'application/x-ndjson':entry.name.endsWith('.woff2')?'font/woff2':entry.name.endsWith('.png')?'image/png':entry.name.endsWith('.jpg')||entry.name.endsWith('.jpeg')?'image/jpeg':'application/octet-stream',byteLength:entry.data.length,sha256:sha256HexBytes(entry.data),required:entry.name==='document.json'}));const manifest={format:'ppte',formatVersion:'2',schemaVersion:'2.0.0',operationProtocolVersion:'1.0',compatibilityProfile:payload.minimumCompatibilityProfile||inferredProfile(),documentId:documentNode.documentId,contentRevision:revision(),title:documentNode.metadata.title,createdAt:documentNode.metadata.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),requiredWidgets:documentNode.widgetRequirements||[],clean:false,files,history:{mode:'standard',snapshotRevision:revision(),recentTransactionCount:history.length,deepHistoryExternal:true}};entries.push({name:'manifest.json',data:utf8(canonical(manifest))});return writeZip(entries)};
  const compositionGuard=()=>composing.size?issue('PORTABLE_COMPOSITION_ACTIVE','Finish the active IME composition before saving; the draft is still present.'):undefined;
  const saveAsProject=()=>{const blocked=compositionGuard();if(blocked){if(status)status.textContent='无法保存 · 请先结束输入法组合';return blocked}try{const data=checkpoint();download(data,safeFilename(documentNode.metadata&&documentNode.metadata.title)+'.ppte','application/vnd.ppte+zip');if(status)status.textContent='已导出 .ppte 源项目 · 请用 PPTe Host 打开';return {ok:true,revision:revision(),bytes:data,issues:[]}}catch(error){return issue('CHECKPOINT_FAILED',error instanceof Error?error.message:String(error))}};
  const saveAsPortable=()=>{if(!editable)return issue('PORTABLE_EDIT_UNSUPPORTED','Viewer profile does not allow editable copies.');const blocked=compositionGuard();if(blocked){if(status)status.textContent='无法保存 · 请先结束输入法组合';return blocked}try{flushTextDrafts();updateOrigin();const copy=document.documentElement.cloneNode(true);const hydratedFonts=copy.querySelector('#ppte-portable-fonts');if(hydratedFonts)hydratedFonts.remove();const embedded=copy.querySelector('#ppte-portable-payload');if(embedded)embedded.textContent=JSON.stringify(payload).replaceAll('<','\\u003c').replaceAll('>','\\u003e').replaceAll('&','\\u0026');copy.querySelectorAll('img').forEach(image=>image.setAttribute('src',''));const html='<!doctype html>'+copy.outerHTML;download(html,safeFilename(documentNode.metadata&&documentNode.metadata.title)+editableSuffix,'text/html');if(status)status.textContent='已下载新的可编辑副本 · 当前文件未被原地覆盖';return {ok:true,revision:revision(),html,issues:[]}}catch(error){return issue('CHECKPOINT_FAILED',error instanceof Error?error.message:String(error))}};
  const select=id=>{const target=typeof id==='string'?{elementId:id}:id||{};const found=findElement(target);if(!found)return issue('PORTABLE_SELECTION_INVALID','Selection target cannot be resolved.');selectedElementId=found.element.id;for(const node of document.querySelectorAll('[data-ppte-element-id]'))node.setAttribute('data-ppte-selected',node.getAttribute('data-ppte-element-id')===selectedElementId?'true':'false');show();return {ok:true,revision:revision(),selection:[{slideId:found.slideId,elementId:found.element.id}],issues:[]}};
  const selectMany=targets=>{const resolved=[];for(const target of Array.isArray(targets)?targets:[]){const found=findElement(target);if(!found)return issue('PORTABLE_SELECTION_INVALID','One or more selection targets cannot be resolved.');if(!resolved.some(item=>item.slideId===found.slideId&&item.elementId===found.element.id))resolved.push({slideId:found.slideId,elementId:found.element.id})}selectedElementId=resolved[0]?resolved[0].elementId:'';for(const node of document.querySelectorAll('[data-ppte-element-id]'))node.setAttribute('data-ppte-selected',resolved.some(item=>item.elementId===node.getAttribute('data-ppte-element-id'))?'true':'false');show();return {ok:true,revision:revision(),selection:resolved,issues:[]}};
  const next=()=>{const pending=slideSteps().filter(value=>value>step);if(pending.length)step=pending[0];else if(slideIndex<slides().length-1){slideIndex+=1;step=0}show()};
  const previous=()=>{const pending=slideSteps().filter(value=>value<step);if(pending.length)step=pending[pending.length-1];else if(slideIndex>0){slideIndex-=1;step=0}show()};
  const setSlide=index=>{slideIndex=Math.max(0,Math.min(slides().length-1,Number(index)||0));step=0;selectedElementId='';show()};
  const selectedTarget=()=>selectedElementId?{elementId:selectedElementId}:undefined;
  const buttonAction=action=>{if(action==='next')next();else if(action==='previous')previous();else if(action==='undo')undo();else if(action==='redo')redo();else if(action==='save')saveAsProject();else if(action==='save-portable')saveAsPortable();else if(action==='fullscreen'){if(root&&root.requestFullscreen)root.requestFullscreen()}else if(action==='crop'){const found=findElement(selectedTarget());if(found&&found.element.type==='image')cropImage({elementId:found.element.id},{x:.05,y:.05,width:.9,height:.9})}else if(action==='chart-data'){const found=findElement(selectedTarget());if(found&&found.element.type==='chart'){const data=clone(found.element.data);const column=(data.columns||[]).find(item=>item.type==='number');if(column&&data.rows[0])data.rows[0].values[column.id]=Number(data.rows[0].values[column.id]||0)+1;updateChartData({elementId:found.element.id},data)}}else if(action==='move-left'||action==='move-right'){const found=findElement(selectedTarget());if(found)moveElement({elementId:found.element.id},{x:found.element.frame.x+(action==='move-left'?-20:20),y:found.element.frame.y})}else if(action==='scale-up'||action==='scale-down'){const found=findElement(selectedTarget());if(found)scaleElement({elementId:found.element.id},action==='scale-up'?1.1:.9)}else if(action==='rotate'){const found=findElement(selectedTarget());if(found)rotateElement({elementId:found.element.id},Number(found.element.rotationDeg||0)+90)}};
  document.querySelectorAll('[data-ppte-action]').forEach(button=>{if(button.tagName==='BUTTON')button.addEventListener('click',()=>buttonAction(button.getAttribute('data-ppte-action')||''))});
  document.querySelectorAll('[data-ppte-slide-index]').forEach(button=>button.addEventListener('click',()=>setSlide(button.getAttribute('data-ppte-slide-index'))));
  if(stage){stage.addEventListener('click',event=>{const target=event.target instanceof Element?event.target.closest('[data-ppte-element-id]'):null;if(target&&editable)select(target.getAttribute('data-ppte-element-id')||'')});stage.addEventListener('pointerdown',event=>{if(!lightEdit)return;const target=event.target instanceof Element?event.target.closest('[data-ppte-element-id]'):null;const id=target&&target.getAttribute('data-ppte-element-id');const found=id?findElement({elementId:id}):undefined;if(!found||found.element.locked===true)return;select(id);const rect=slides()[slideIndex].getBoundingClientRect();dragState.value={id,startX:event.clientX,startY:event.clientY,frame:clone(found.element.frame),rect};if(target&&target.setPointerCapture)target.setPointerCapture(event.pointerId)});stage.addEventListener('pointermove',event=>{const drag=dragState.value;if(!drag)return;const dx=(event.clientX-drag.startX)/scale;const dy=(event.clientY-drag.startY)/scale;const node=elementNode(drag.id);if(node){node.style.left=drag.frame.x+dx+'px';node.style.top=drag.frame.y+dy+'px'}});stage.addEventListener('pointerup',event=>{const drag=dragState.value;dragState.value=null;if(!drag)return;const dx=(event.clientX-drag.startX)/scale;const dy=(event.clientY-drag.startY)/scale;if(Math.abs(dx)+Math.abs(dy)>0.5)moveElement({elementId:drag.id},{x:drag.frame.x+dx,y:drag.frame.y+dy})})}
  if(editable){document.querySelectorAll('[contenteditable="true"]').forEach(node=>{const id=node.getAttribute('data-ppte-element-id');if(!id)return;const plainText=()=>node.innerText.replaceAll(String.fromCharCode(160),' ');node.addEventListener('compositionstart',()=>composing.add(id));node.addEventListener('compositionend',()=>{composing.delete(id);drafts.set(id,plainText());commitText(id,drafts.get(id))});node.addEventListener('input',()=>drafts.set(id,plainText()));node.addEventListener('blur',()=>{if(!composing.has(id))commitText(id,plainText())})});const input=document.querySelector('[data-ppte-action="import-image"]');if(input)input.addEventListener('change',()=>{const file=input.files&&input.files[0];if(file)void importImage(selectedTarget(),file,{fileName:file.name,mimeType:file.type,altText:file.name});input.value=''})}
  window.addEventListener('resize',fitViewport);
  const api={origin:payload.origin,capabilityReport:payload.capabilityReport,getPayload:()=>payload,getDocument:()=>clone(documentNode),getRevision:()=>revision(),getHistory:()=>clone(history.map(entry=>entry.transaction)),select,selectMany,editText,replaceImage,importImage,cropImage,updateChartData,moveElement,resizeElement,scaleElement,rotateElement,undo,redo,saveAsProject,saveAsNewProject:saveAsProject,saveAsPortable,saveAsEditableCopy:saveAsPortable,next,previous,setSlide};
  globalThis.PPTEPortable=api;
  for(const slide of Object.values(documentNode.slides||{}))for(const element of Object.values(slide.elements||{}))syncElement(slide.id,element);
  hydrateFonts();fitViewport();show();
})()`.replace('__PPTE_EDITABLE_SUFFIX__', JSON.stringify(editableSuffix))
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
function base64(data: Uint8Array): string { return Buffer.from(data).toString('base64') }
function css(value: string): string { return value.replace(/[^A-Za-z0-9 ,._:-]/g, '') }
function normalizeHash(hash: string): string { return (hash.startsWith('sha256-') ? hash.slice(7) : hash).toLowerCase() }
function sha256Binary(data: Uint8Array): string { return createHash('sha256').update(data).digest('hex') }
function issue(code: string, message: string, elementId?: string, recovery?: string): ValidationIssue { return withErrorSemantics({ code, severity: 'error', message, elementId, recovery }) }
function dedupe(issues: ValidationIssue[]): ValidationIssue[] { const seen = new Set<string>(); return issues.filter((item) => { const key = `${item.code}|${item.message}|${item.elementId ?? ''}`; if (seen.has(key)) return false; seen.add(key); return true }) }
