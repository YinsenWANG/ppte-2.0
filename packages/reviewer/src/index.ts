import { canonicalHash, canonicalRevision, cloneJson } from '../../canonical-json/src/index.js'
import { validateDocument } from '../../schema/src/index.js'
import type { Asset, CompareResult, Element, Fact, FontAsset, Operation, PpteDocument, PptePatch, ReviewField, ReviewSelection, SemanticMatchMethod, SemanticReviewUnit, Source, Transaction, ValidationIssue } from '../../schema/src/index.js'
import { encodePatch } from '../../patch-format/src/index.js'

export interface PatchBuildOptions {
  assetBytes?: Record<string, Uint8Array>
  fontBytes?: Record<string, Uint8Array>
  actor?: Transaction['actor']
  createdAt?: string
  patchId?: string
  compatibilityProfile?: string
}

export class PpteReviewer {
  compare(base: PpteDocument, local: PpteDocument, revised: PpteDocument): CompareResult {
    return compareDocuments(base, local, revised)
  }

  buildAcceptTransaction(result: CompareResult, selection: ReviewSelection = {}, actor: Transaction['actor'] = { type: 'reviewer', id: 'three-way-review' }): Transaction {
    return buildAcceptTransaction(result, selection, actor)
  }

  createPatch(base: PpteDocument, revised: PpteDocument, options: PatchBuildOptions = {}): PptePatch {
    return createPatch(base, revised, options)
  }

  exportPatch(base: PpteDocument, revised: PpteDocument, options: PatchBuildOptions = {}): PptePatch {
    return createPatch(base, revised, options)
  }

  encodePatch(patch: PptePatch): Uint8Array {
    return encodePatch(patch)
  }
}

export function compareDocuments(base: PpteDocument, local: PpteDocument, revised: PpteDocument): CompareResult {
  const issues: ValidationIssue[] = [
    ...documentIssues(base, 'base'),
    ...documentIssues(local, 'local'),
    ...documentIssues(revised, 'revised'),
  ]
  const units: SemanticReviewUnit[] = []
  for (const slideId of union(base.slideOrder, local.slideOrder, revised.slideOrder)) {
    const baseSlide = base.slides[slideId]
    const localSlide = local.slides[slideId]
    const revisedSlide = revised.slides[slideId]
    compareSlideFields(slideId, baseSlide, localSlide, revisedSlide, units)
    const baseElements = Object.values(baseSlide?.elements ?? {})
    const localElements = Object.values(localSlide?.elements ?? {})
    const revisedElements = Object.values(revisedSlide?.elements ?? {})
    const localMatches = matchElements(baseElements, localElements)
    const revisedMatches = matchElements(baseElements, revisedElements)
    const usedLocal = new Set<string>()
    const usedRevised = new Set<string>()
    for (const baseElement of baseElements) {
      const localMatch = localMatches.get(baseElement.id)
      const revisedMatch = revisedMatches.get(baseElement.id)
      if (localMatch?.element) usedLocal.add(localMatch.element.id)
      if (revisedMatch?.element) usedRevised.add(revisedMatch.element.id)
      const matchInfo = localMatch ?? revisedMatch
      compareElementFields(slideId, baseElement, localMatch?.element, revisedMatch?.element, matchInfo?.method ?? 'none', units, matchInfo?.ambiguous, matchInfo?.candidates)
    }
    const unmatchedLocal = localElements.filter((element) => !usedLocal.has(element.id) && !baseElements.some((candidate) => candidate.id === element.id))
    const unmatchedRevised = revisedElements.filter((element) => !usedRevised.has(element.id) && !baseElements.some((candidate) => candidate.id === element.id))
    for (const localElement of unmatchedLocal) {
      const candidates = unmatchedRevised.filter((candidate) => candidate.id === localElement.id || (localElement.semanticKey !== undefined && candidate.semanticKey === localElement.semanticKey))
      if (candidates.length === 1) {
        const revisedElement = candidates[0]
        usedRevised.add(revisedElement.id)
        compareAddedElements(slideId, localElement, revisedElement, units)
      } else addExistenceUnit('local-only', slideId, localElement, units)
    }
    for (const element of unmatchedRevised) if (!usedRevised.has(element.id)) addExistenceUnit('added', slideId, element, units, 'revised')
  }
  compareRecords('fact', base.facts ?? {}, local.facts ?? {}, revised.facts ?? {}, units)
  compareRecords('source', base.sources ?? {}, local.sources ?? {}, revised.sources ?? {}, units)
  compareResourceRecords('asset', base.assets, local.assets, revised.assets, units)
  compareResourceRecords('font', base.fonts, local.fonts, revised.fonts, units)
  const conflicts = units.filter((unit) => unit.status === 'conflict' || unit.status === 'ambiguous')
  const result: CompareResult = {
    documentId: base.documentId,
    baseRevision: canonicalRevision(base),
    localRevision: canonicalRevision(local),
    revisedRevision: canonicalRevision(revised),
    baseAvailable: true,
    twoWay: false,
    units,
    conflicts,
    issues,
    autoAcceptable: issues.length === 0 && conflicts.length === 0 && !units.some((unit) => unit.match === 'heuristic'),
  }
  return result
}

export const compareRevisedCopy = compareDocuments
export const exportPatch = createPatch
export const buildPatch = createPatch

export function buildAcceptTransaction(result: CompareResult, selection: ReviewSelection = {}, actor: Transaction['actor'] = { type: 'reviewer', id: 'three-way-review' }): Transaction {
  const selectedIds = selection.unitIds ? new Set(selection.unitIds) : undefined
  const include = (unit: SemanticReviewUnit) => {
    if (unit.status === 'conflict' || unit.status === 'ambiguous' || !unit.operations?.length) return false
    if (unit.match === 'heuristic' && !selectedIds) return false
    if (selectedIds) return selectedIds.has(unit.unitId)
    if (unit.status === 'revised-only' || unit.status === 'same-change') return true
    if (unit.status === 'added') return selection.includeAdded !== false
    if (unit.status === 'deleted') return selection.includeDeleted === true
    return false
  }
  const operations: Operation[] = []
  const seen = new Set<string>()
  for (const unit of result.units) if (include(unit)) for (const operation of unit.operations ?? []) {
    if (seen.has(operation.opId)) continue
    seen.add(operation.opId)
    operations.push(cloneJson(operation))
  }
  if (!operations.length) throw new Error('REVIEW_EMPTY: no non-conflicting revised changes were selected.')
  const permissions = new Set<Transaction['scope']['permissions'][number]>()
  for (const operation of operations) for (const permission of permissionsFor(operation)) permissions.add(permission)
  return {
    transactionId: `review:${canonicalHash({ localRevision: result.localRevision, operations }).slice(0, 20)}`,
    baseRevision: result.localRevision,
    actor,
    scope: { kind: 'document', permissions: [...permissions], allowInsert: operations.some(isInsert), allowDelete: operations.some(isDelete) },
    changeContract: {
      allowedOperationKinds: [...new Set(operations.map((operation) => operation.kind))],
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
      userIntentSummary: 'Accept explicitly selected non-conflicting changes from the revised copy.',
    },
    reason: 'Three-way semantic review acceptance',
    createdAt: '1970-01-01T00:00:00.000Z',
    validationLevel: 'L2',
    operations,
  }
}

export function createPatch(base: PpteDocument, revised: PpteDocument, options: PatchBuildOptions = {}): PptePatch {
  const comparison = compareDocuments(base, base, revised)
  if (comparison.issues.some((issue) => issue.severity === 'error')) throw new Error(comparison.issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n'))
  const transaction = buildAcceptTransaction(comparison, { includeAdded: true, includeDeleted: true }, options.actor ?? { type: 'reviewer', id: 'three-way-review' })
  const operations = transaction.operations.map((operation) => operation.preconditions?.some((precondition) => precondition.kind === 'revision-equals') ? operation : { ...operation, preconditions: [...(operation.preconditions ?? []), { kind: 'revision-equals', revision: comparison.baseRevision }] }) as Operation[]
  const assetMetadata: PptePatch['assetMetadata'] = {}
  const assets: PptePatch['assets'] = {}
  for (const [assetId, asset] of Object.entries(revised.assets)) {
    if (canonicalHash(base.assets[assetId]) === canonicalHash(asset)) continue
    assetMetadata[assetId] = cloneJson(asset)
    const data = options.assetBytes?.[assetId]
    if (!data) throw new Error(`ASSET_MISSING: patch requires bytes for ${assetId}`)
    assets[assetId] = new Uint8Array(data)
  }
  const fontMetadata: PptePatch['fontMetadata'] = {}
  const fonts: PptePatch['fonts'] = {}
  for (const [fontId, font] of Object.entries(revised.fonts)) {
    if (canonicalHash(base.fonts[fontId]) === canonicalHash(font)) continue
    fontMetadata[fontId] = cloneJson(font)
    const data = options.fontBytes?.[fontId]
    if (font.source === 'embedded' && !data) throw new Error(`FONT_MISSING: patch requires bytes for ${fontId}`)
    if (data) fonts[fontId] = new Uint8Array(data)
  }
  const patch: PptePatch = {
    manifest: {
      patchVersion: '1',
      patchId: options.patchId ?? canonicalHash({ documentId: base.documentId, baseRevision: comparison.baseRevision, revisedRevision: comparison.revisedRevision, operations }).slice(0, 32),
      documentId: base.documentId,
      baseRevision: comparison.baseRevision,
      headRevision: comparison.revisedRevision,
      createdAt: options.createdAt ?? '1970-01-01T00:00:00.000Z',
      actor: options.actor ?? { type: 'reviewer', id: 'three-way-review' },
      operationProtocolVersion: '1.0',
      compatibilityProfile: options.compatibilityProfile ?? 'ppte-2.0-ga-b.1',
      files: [],
    },
    operations,
    assets: Object.keys(assets).length ? assets : undefined,
    fonts: Object.keys(fonts).length ? fonts : undefined,
    assetMetadata: Object.keys(assetMetadata).length ? assetMetadata : undefined,
    fontMetadata: Object.keys(fontMetadata).length ? fontMetadata : undefined,
  }
  return patch
}

function compareElementFields(slideId: string, base: Element, local: Element | undefined, revised: Element | undefined, match: SemanticMatchMethod, units: SemanticReviewUnit[], ambiguous = false, candidates?: string[]) {
  if (!local && !revised) return
  if (!local || !revised) {
    const side = local ? 'local' : 'revised'
    const status = local && revised ? (sameValue(elementIdentity(base), elementIdentity(local)) ? 'revised-only' : 'conflict') : local ? (sameValue(elementIdentity(base), elementIdentity(local)) ? 'deleted' : 'conflict') : revised ? (sameValue(elementIdentity(base), elementIdentity(revised)) ? 'local-only' : 'conflict') : 'conflict'
    const value = local ?? revised
    if (!value) return
    units.push({ unitId: unitId('element', slideId, value.id, 'identity'), kind: 'element', field: 'identity', path: `/slides/${pointer(slideId)}/elements/${pointer(base.id)}`, slideId, elementId: value.id, semanticKey: value.semanticKey, status: ambiguous ? 'ambiguous' : status, match, candidates, baseValue: cloneJson(base), localValue: local ? cloneJson(local) : undefined, revisedValue: revised ? cloneJson(revised) : undefined, operations: operationsForExistence(slideId, local, revised), reason: `${side} copy removed or added the matched element.` })
    return
  }
  const baseFields = elementFields(base)
  const localFields = elementFields(local)
  const revisedFields = elementFields(revised)
  for (const field of Object.keys(baseFields) as ReviewField[]) {
    const baseValue = baseFields[field]
    const localValue = localFields[field]
    const revisedValue = revisedFields[field]
    const localChanged = !sameValue(baseValue, localValue)
    const revisedChanged = !sameValue(baseValue, revisedValue)
    if (!localChanged && !revisedChanged) continue
    const status = !localChanged ? (revisedValue === undefined ? 'deleted' : baseValue === undefined ? 'added' : 'revised-only') : !revisedChanged ? 'local-only' : sameValue(localValue, revisedValue) ? 'same-change' : 'conflict'
    units.push({ unitId: unitId('element', slideId, local.id, field), kind: 'element', field, path: elementPath(slideId, local.id, field), slideId, elementId: local.id, semanticKey: local.semanticKey ?? revised.semanticKey, status: ambiguous ? 'ambiguous' : status, match, candidates, baseValue: cloneJson(baseValue), localValue: cloneJson(localValue), revisedValue: cloneJson(revisedValue), operations: operationsForField(slideId, local, revised, field) })
  }
}

function compareResourceRecords(kind: 'asset' | 'font', base: Record<string, Asset> | Record<string, FontAsset>, local: Record<string, Asset> | Record<string, FontAsset>, revised: Record<string, Asset> | Record<string, FontAsset>, units: SemanticReviewUnit[]) {
  for (const id of union(Object.keys(base), Object.keys(local), Object.keys(revised))) {
    const baseValue = base[id]
    const localValue = local[id]
    const revisedValue = revised[id]
    const localChanged = !sameValue(baseValue, localValue)
    const revisedChanged = !sameValue(baseValue, revisedValue)
    if (!localChanged && !revisedChanged) continue
    const status = !localChanged ? (revisedValue === undefined ? 'deleted' : baseValue === undefined ? 'added' : 'revised-only') : !revisedChanged ? 'local-only' : sameValue(localValue, revisedValue) ? 'same-change' : 'conflict'
    const operation = resourceOperation(kind, id, localValue, revisedValue, baseValue)
    units.push({ unitId: `document:${kind}:${id}`, kind: 'document', field: kind === 'asset' ? 'asset' : 'structure', path: `/${kind === 'asset' ? 'assets' : 'fonts'}/${pointer(id)}`, status, match: 'none', baseValue, localValue, revisedValue, operations: operation ? [operation] : undefined, reason: `${kind} metadata changed.` })
  }
}

function resourceOperation(kind: 'asset' | 'font', id: string, local: Asset | FontAsset | undefined, revised: Asset | FontAsset | undefined, base: Asset | FontAsset | undefined): Operation | undefined {
  if (kind === 'asset') {
    if (revised) return { opId: `review:asset:${id}:upsert`, kind: 'asset.upsert', asset: cloneJson(revised as Asset) }
    if (local && base) return { opId: `review:asset:${id}:delete`, kind: 'asset.upsert', asset: cloneJson(base as Asset), remove: true }
  } else {
    if (revised) return { opId: `review:font:${id}:upsert`, kind: 'font.upsert', font: cloneJson(revised as FontAsset) }
    if (local && base) return { opId: `review:font:${id}:delete`, kind: 'font.upsert', font: cloneJson(base as FontAsset), remove: true }
  }
  return undefined
}

function compareAddedElements(slideId: string, local: Element, revised: Element, units: SemanticReviewUnit[]) {
  if (sameValue(local, revised)) {
    units.push({ unitId: unitId('element', slideId, local.id, 'identity'), kind: 'element', field: 'identity', path: `/slides/${pointer(slideId)}/elements/${pointer(local.id)}`, slideId, elementId: local.id, semanticKey: local.semanticKey, status: 'same-change', match: local.id === revised.id ? 'elementId' : 'semanticKey', localValue: cloneJson(local), revisedValue: cloneJson(revised), reason: 'Both copies added the same element.' })
    return
  }
  units.push({ unitId: unitId('element', slideId, local.id, 'identity'), kind: 'element', field: 'identity', path: `/slides/${pointer(slideId)}/elements/${pointer(local.id)}`, slideId, elementId: local.id, semanticKey: local.semanticKey ?? revised.semanticKey, status: 'conflict', match: local.id === revised.id ? 'elementId' : 'semanticKey', localValue: cloneJson(local), revisedValue: cloneJson(revised), reason: 'Both copies added a matching element with different content.' })
}

function compareSlideFields(slideId: string, base: PpteDocument['slides'][string] | undefined, local: PpteDocument['slides'][string] | undefined, revised: PpteDocument['slides'][string] | undefined, units: SemanticReviewUnit[]) {
  const baseValue = base ? { name: base.name, hidden: base.hidden, background: base.background, readingOrder: base.readingOrder } : undefined
  const localValue = local ? { name: local.name, hidden: local.hidden, background: local.background, readingOrder: local.readingOrder } : undefined
  const revisedValue = revised ? { name: revised.name, hidden: revised.hidden, background: revised.background, readingOrder: revised.readingOrder } : undefined
  if (sameValue(baseValue, localValue) && sameValue(baseValue, revisedValue)) return
  const status = !sameValue(baseValue, localValue) && !sameValue(baseValue, revisedValue) && !sameValue(localValue, revisedValue) ? 'conflict' : sameValue(baseValue, localValue) ? (revised ? 'revised-only' : 'deleted') : sameValue(baseValue, revisedValue) ? 'local-only' : 'same-change'
  units.push({ unitId: unitId('slide', slideId, slideId, 'slide'), kind: 'slide', field: 'slide', path: `/slides/${pointer(slideId)}`, slideId, status, match: 'elementId', baseValue, localValue, revisedValue, operations: local && revised ? operationsForSlide(slideId, local, revised) : operationsForSlideExistence(slideId, local, revised), reason: 'Slide-level properties changed.' })
}

function compareRecords(kind: 'fact' | 'source', base: Record<string, Fact | Source>, local: Record<string, Fact | Source>, revised: Record<string, Fact | Source>, units: SemanticReviewUnit[]) {
  for (const id of union(Object.keys(base), Object.keys(local), Object.keys(revised))) {
    const baseValue = base[id]
    const localValue = local[id]
    const revisedValue = revised[id]
    const localChanged = !sameValue(baseValue, localValue)
    const revisedChanged = !sameValue(baseValue, revisedValue)
    if (!localChanged && !revisedChanged) continue
    const status = !localChanged ? (revisedValue === undefined ? 'deleted' : baseValue === undefined ? 'added' : 'revised-only') : !revisedChanged ? 'local-only' : sameValue(localValue, revisedValue) ? 'same-change' : 'conflict'
    const field = kind === 'fact' ? 'fact' : 'source'
    units.push({ unitId: `${kind}:${id}`, kind, field, path: `/${kind === 'fact' ? 'facts' : 'sources'}/${pointer(id)}`, status, match: kind === 'fact' ? 'factId' : 'sourceId', baseValue, localValue, revisedValue, operations: operationsForRecord(kind, id, localValue, revisedValue) })
  }
}

function addExistenceUnit(status: 'local-only' | 'added', slideId: string, element: Element, units: SemanticReviewUnit[], side = 'local') {
  units.push({ unitId: unitId('element', slideId, element.id, 'identity'), kind: 'element', field: 'identity', path: `/slides/${pointer(slideId)}/elements/${pointer(element.id)}`, slideId, elementId: element.id, semanticKey: element.semanticKey, status, match: 'none', localValue: side === 'local' ? cloneJson(element) : undefined, revisedValue: side === 'revised' ? cloneJson(element) : undefined, operations: side === 'revised' ? [{ opId: `review:${slideId}:${element.id}:insert`, kind: 'element.insert', slideId, element: cloneJson(element), index: 999 }] : undefined })
}

function matchElements(base: Element[], candidates: Element[]): Map<string, { element: Element; method: SemanticMatchMethod; ambiguous?: boolean; candidates?: string[] } | undefined> {
  const used = new Set<string>()
  const result = new Map<string, { element: Element; method: SemanticMatchMethod; ambiguous?: boolean; candidates?: string[] } | undefined>()
  for (const source of base) {
    const choices: Array<{ method: SemanticMatchMethod; values: Element[] }> = [
      { method: 'elementId', values: candidates.filter((candidate) => candidate.id === source.id) },
      { method: 'semanticKey', values: source.semanticKey ? candidates.filter((candidate) => candidate.semanticKey === source.semanticKey) : [] },
      { method: 'lineage', values: candidates.filter((candidate) => candidate.provenance?.replacesElementId === source.id || (source.semanticKey !== undefined && candidate.provenance?.sourceSemanticKey === source.semanticKey)) },
      { method: 'factId', values: candidates.filter((candidate) => intersection(candidate.semanticRefs?.factIds, source.semanticRefs?.factIds).length > 0) },
      { method: 'sourceId', values: candidates.filter((candidate) => intersection(candidate.semanticRefs?.sourceIds, source.semanticRefs?.sourceIds).length > 0) },
      { method: 'heuristic', values: candidates.filter((candidate) => candidate.type === source.type && candidate.role === source.role && normalizeLabel(candidate) === normalizeLabel(source)) },
    ]
    let selected: { method: SemanticMatchMethod; available: Element[] } | undefined
    for (const entry of choices) {
      const available = entry.values.filter((candidate) => !used.has(candidate.id))
      if (available.length) { selected = { method: entry.method, available }; break }
    }
    if (!selected) { result.set(source.id, undefined); continue }
    const element = selected.available[0]
    used.add(element.id)
    result.set(source.id, { element, method: selected.method, ambiguous: selected.available.length > 1, candidates: selected.available.length > 1 ? selected.available.map((candidate) => candidate.id) : undefined })
  }
  return result
}

function elementFields(element: Element): Partial<Record<ReviewField, unknown>> {
  return {
    content: element.type === 'text' ? element.content : undefined,
    data: element.type === 'chart' ? element.data : undefined,
    style: 'style' in element ? { style: element.style, paragraphStyle: element.type === 'text' ? element.paragraphStyle : undefined, boxStyle: element.type === 'text' ? element.boxStyle : undefined } : undefined,
    geometry: { frame: element.frame, rotationDeg: element.rotationDeg, flipX: element.flipX, flipY: element.flipY },
    asset: element.type === 'image' ? { assetId: element.assetId, crop: element.crop, focalPoint: element.focalPoint } : undefined,
    identity: elementIdentity(element),
    visibility: { visible: element.visible, locked: element.locked, editPolicy: element.editPolicy },
  }
}

function elementIdentity(element: Element): unknown {
  return { type: element.type, semanticKey: element.semanticKey, role: element.role, name: element.name, semanticRefs: element.semanticRefs }
}

function operationsForField(slideId: string, local: Element, revised: Element, field: ReviewField): Operation[] {
  const prefix = `review:${slideId}:${local.id}:${field}`
  if (field === 'content' && local.type === 'text' && revised.type === 'text') return [{ opId: prefix, kind: 'text.replaceContent', slideId, elementId: local.id, content: cloneJson(revised.content) }]
  if (field === 'data' && local.type === 'chart' && revised.type === 'chart') return [{ opId: prefix, kind: 'chart.replaceData', slideId, elementId: local.id, data: cloneJson(revised.data) }]
  if (field === 'geometry') {
    const operations: Operation[] = []
    if (!sameValue(local.frame, revised.frame)) operations.push({ opId: `${prefix}:frame`, kind: 'element.resize', slideId, elementId: local.id, frame: cloneJson(revised.frame) })
    if (local.rotationDeg !== revised.rotationDeg) operations.push({ opId: `${prefix}:rotation`, kind: 'element.rotate', slideId, elementId: local.id, rotationDeg: revised.rotationDeg, unset: revised.rotationDeg === undefined })
    return operations
  }
  if (field === 'asset' && local.type === 'image' && revised.type === 'image') return [
    ...imageAssetOperations(slideId, local, revised, prefix),
  ]
  if (field === 'identity' && local.semanticKey !== revised.semanticKey && local.type === revised.type && local.role === revised.role && local.name === revised.name && sameValue(local.semanticRefs, revised.semanticRefs)) return [{ opId: prefix, kind: 'element.setSemanticKey', slideId, elementId: local.id, semanticKey: revised.semanticKey }]
  if (field === 'visibility') {
    const operations: Operation[] = []
    if (local.visible !== revised.visible) operations.push({ opId: `${prefix}:visible`, kind: 'element.setVisibility', slideId, elementId: local.id, visible: revised.visible, unset: revised.visible === undefined })
    if (local.locked !== revised.locked) operations.push({ opId: `${prefix}:locked`, kind: 'element.setLocked', slideId, elementId: local.id, locked: revised.locked, unset: revised.locked === undefined })
    if (!sameValue(local.editPolicy, revised.editPolicy)) operations.push({ opId: `${prefix}:policy`, kind: 'element.setEditPolicy', slideId, elementId: local.id, editPolicy: cloneJson(revised.editPolicy), unset: revised.editPolicy === undefined })
    return operations
  }
  if (field === 'style' && 'style' in local && 'style' in revised && local.style && revised.style) {
    if (local.type === 'text' && revised.type === 'text' && (!sameValue(local.paragraphStyle, revised.paragraphStyle) || !sameValue(local.boxStyle, revised.boxStyle))) return []
    const operations: Operation[] = []
    if (local.style.styleRef !== revised.style.styleRef) operations.push({ opId: `${prefix}:ref`, kind: 'element.setStyleRef', slideId, elementId: local.id, styleRef: revised.style.styleRef })
    if (revised.style.overrides) {
      operations.push({ opId: `${prefix}:clear`, kind: 'element.clearStyleOverrides', slideId, elementId: local.id })
      operations.push({ opId: `${prefix}:overrides`, kind: 'element.updateStyleOverrides', slideId, elementId: local.id, patch: cloneJson(revised.style.overrides) as Record<string, never> })
    } else operations.push({ opId: `${prefix}:clear`, kind: 'element.clearStyleOverrides', slideId, elementId: local.id })
    return operations
  }
  return []
}

function imageAssetOperations(slideId: string, local: Extract<Element, { type: 'image' }>, revised: Extract<Element, { type: 'image' }>, prefix: string): Operation[] {
  const operations: Operation[] = []
  if (local.assetId !== revised.assetId) operations.push({ opId: `${prefix}:asset`, kind: 'image.replaceAsset', slideId, elementId: local.id, assetId: revised.assetId, preserveCrop: revised.crop !== undefined && sameValue(local.crop, revised.crop) })
  if (!sameValue(local.crop, revised.crop)) {
    // v1 has no standalone crop-unset operation. Replacing the current asset
    // with preserveCrop=false is the explicit, reversible clear primitive.
    if (revised.crop) operations.push({ opId: `${prefix}:crop`, kind: 'image.setCrop', slideId, elementId: local.id, crop: cloneJson(revised.crop) })
    else if (local.crop) operations.push({ opId: `${prefix}:clear-crop`, kind: 'image.replaceAsset', slideId, elementId: local.id, assetId: revised.assetId, preserveCrop: false })
  }
  if (!sameValue(local.focalPoint, revised.focalPoint)) operations.push({ opId: `${prefix}:focal`, kind: 'image.setFocalPoint', slideId, elementId: local.id, focalPoint: revised.focalPoint })
  return operations
}

function operationsForExistence(slideId: string, local: Element | undefined, revised: Element | undefined): Operation[] | undefined {
  if (!local && revised) return [{ opId: `review:${slideId}:${revised.id}:insert`, kind: 'element.insert', slideId, element: cloneJson(revised), index: 999 }]
  if (local && !revised) return [{ opId: `review:${slideId}:${local.id}:delete`, kind: 'element.delete', slideId, elementId: local.id }]
  return undefined
}

function operationsForSlide(slideId: string, local: PpteDocument['slides'][string], revised: PpteDocument['slides'][string]): Operation[] {
  const operations: Operation[] = []
  const patch: Record<string, never> = {}
  if (local.name !== revised.name && revised.name !== undefined) patch.name = revised.name as never
  if (local.hidden !== revised.hidden && revised.hidden !== undefined) patch.hidden = revised.hidden as never
  if (canonicalHash(local.background) !== canonicalHash(revised.background) && revised.background !== undefined) patch.background = cloneJson(revised.background) as never
  if (Object.keys(patch).length) operations.push({ opId: `review:${slideId}:slide:update`, kind: 'slide.update', slideId, patch })
  if (canonicalHash(local.readingOrder) !== canonicalHash(revised.readingOrder) && revised.readingOrder !== undefined) operations.push({ opId: `review:${slideId}:reading-order`, kind: 'slide.setReadingOrder', slideId, readingOrder: cloneJson(revised.readingOrder) })
  return operations
}

function operationsForSlideExistence(slideId: string, local: PpteDocument['slides'][string] | undefined, revised: PpteDocument['slides'][string] | undefined): Operation[] | undefined {
  if (!local && revised) return [{ opId: `review:${slideId}:slide:insert`, kind: 'slide.insert', slide: cloneJson(revised), index: 999 }]
  if (local && !revised) return [{ opId: `review:${slideId}:slide:delete`, kind: 'slide.delete', slideId }]
  return undefined
}

function operationsForRecord(kind: 'fact' | 'source', id: string, local: Fact | Source | undefined, revised: Fact | Source | undefined): Operation[] | undefined {
  if (kind === 'fact') {
    if (revised) return [{ opId: `review:fact:${id}:upsert`, kind: 'fact.upsert', fact: cloneJson(revised) as Fact }]
    if (local) return [{ opId: `review:fact:${id}:delete`, kind: 'fact.delete', factId: id }]
  } else {
    if (revised) return [{ opId: `review:source:${id}:upsert`, kind: 'source.upsert', source: cloneJson(revised) as Source }]
    if (local) return [{ opId: `review:source:${id}:delete`, kind: 'source.delete', sourceId: id }]
  }
  return undefined
}

function documentIssues(document: PpteDocument, side: string): ValidationIssue[] {
  return validateDocument(document, { runtimeSubset: false }).filter((issue) => issue.severity === 'error').map((issue) => ({ ...issue, message: `${side}: ${issue.message}` }))
}
function permissionsFor(operation: Operation): Transaction['scope']['permissions'] {
  if (operation.kind.startsWith('text.') || operation.kind === 'document.updateMetadata') return ['content']
  if (operation.kind.startsWith('image.') || operation.kind === 'asset.upsert' || operation.kind === 'font.upsert') return ['assets']
  if (operation.kind.startsWith('element.') || operation.kind.startsWith('group.') || operation.kind.startsWith('slide.') || operation.kind.startsWith('layout.')) return ['structure', 'geometry']
  if (operation.kind.startsWith('fact.')) return ['facts']
  if (operation.kind.startsWith('source.')) return ['sources']
  if (operation.kind.startsWith('chart.') || operation.kind.startsWith('component.')) return ['content']
  return ['content']
}
function isInsert(operation: Operation): boolean { return operation.kind === 'element.insert' || operation.kind === 'slide.insert' }
function isDelete(operation: Operation): boolean { return operation.kind === 'element.delete' || operation.kind === 'slide.delete' }
function sameValue(left: unknown, right: unknown): boolean { return canonicalHash(left) === canonicalHash(right) }
function union(...values: Array<ReadonlyArray<string>>): string[] { return [...new Set(values.flat())] }
function intersection(left: string[] | undefined, right: string[] | undefined): string[] { return (left ?? []).filter((value) => (right ?? []).includes(value)) }
function normalizeLabel(element: Element): string { return element.type === 'text' ? element.content.paragraphs.flatMap((paragraph) => paragraph.runs).map((run) => run.text).join('').trim().toLocaleLowerCase() : `${element.type}:${element.role ?? ''}:${Math.round(element.frame.x)}:${Math.round(element.frame.y)}` }
function unitId(kind: string, slideId: string, elementId: string, field: string): string { return `${kind}:${slideId}:${elementId}:${field}` }
function elementPath(slideId: string, elementId: string, field: string): string { return `/slides/${pointer(slideId)}/elements/${pointer(elementId)}/${field}` }
function pointer(value: string): string { return value.replaceAll('~', '~0').replaceAll('/', '~1') }
