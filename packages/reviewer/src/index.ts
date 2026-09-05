import { canonicalHash, canonicalRevision, cloneJson } from '../../canonical-json/src/index.js'
import { assertDocumentCompatibility, inferCompatibilityProfile } from '../../compatibility/src/index.js'
import { validateDocument } from '../../schema/src/index.js'
import type { Asset, CompareResult, Element, Fact, FontAsset, Operation, PpteDocument, PptePatch, ReviewCapabilityGap, ReviewField, ReviewSelection, SemanticMatchMethod, SemanticReviewUnit, Source, Transaction, ValidationIssue } from '../../schema/src/index.js'
import { computePatchHeadRevisionProof, encodePatch } from '../../patch-format/src/codec.js'

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

  compareTwoWay(local: PpteDocument, revised: PpteDocument): CompareResult {
    return compareTwoWayDocuments(local, revised)
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
  compareDocumentFields(base, local, revised, units)
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
    for (const element of unmatchedRevised) if (!usedRevised.has(element.id)) addExistenceUnit('added', slideId, element, units, 'revised', revisedSlide?.rootOrder.indexOf(element.id))
  }
  compareRecords('fact', base.facts ?? {}, local.facts ?? {}, revised.facts ?? {}, units)
  compareRecords('source', base.sources ?? {}, local.sources ?? {}, revised.sources ?? {}, units)
  compareResourceRecords('asset', base.assets, local.assets, revised.assets, units)
  compareResourceRecords('font', base.fonts, local.fonts, revised.fonts, units)
  const conflicts = units.filter((unit) => unit.status === 'conflict' || unit.status === 'ambiguous')
  const capabilityGaps = uniqueCapabilityGaps(units)
  const result: CompareResult = {
    documentId: base.documentId,
    baseRevision: canonicalRevision(base),
    localRevision: canonicalRevision(local),
    revisedRevision: canonicalRevision(revised),
    baseAvailable: true,
    twoWay: false,
    units,
    conflicts,
    capabilityGaps,
    issues,
    autoAcceptable: issues.length === 0 && conflicts.length === 0 && capabilityGaps.length === 0 && !units.some((unit) => unit.match === 'heuristic'),
  }
  return result
}

export const compareRevisedCopy = compareDocuments

/** Two-way fallback used when the original base snapshot is unavailable. */
export function compareTwoWayDocuments(local: PpteDocument, revised: PpteDocument): CompareResult {
  const result = compareDocuments(local, local, revised)
  return { ...result, baseAvailable: false, twoWay: true, autoAcceptable: false }
}

export const exportPatch = createPatch
export const buildPatch = createPatch

export function buildAcceptTransaction(result: CompareResult, selection: ReviewSelection = {}, actor: Transaction['actor'] = { type: 'reviewer', id: 'three-way-review' }): Transaction {
  const selectedIds = selection.unitIds ? new Set(selection.unitIds) : undefined
  const include = (unit: SemanticReviewUnit) => {
    const resolution = selection.resolutions?.[unit.unitId]
    if ((unit.status === 'conflict' || unit.status === 'ambiguous') && resolution !== 'revised') return false
    if (unit.match === 'heuristic' && !selectedIds) return false
    if (selectedIds && !selectedIds.has(unit.unitId) && !resolution) return false
    if (resolution === 'local') return false
    const candidate = unit.status === 'revised-only' ? selection.includeRevisedOnly !== false
      : unit.status === 'same-change' ? selection.includeSameChange !== false
        : unit.status === 'added' ? selection.includeAdded !== false
          : unit.status === 'deleted' ? selection.includeDeleted === true
            : resolution === 'revised'
    if (!unit.operations?.length) {
      if (unit.capabilityGap && candidate) throw new Error(`${unit.capabilityGap.code}: ${unit.capabilityGap.message}`)
      return false
    }
    return candidate
  }
  const operations: Operation[] = []
  const seen = new Set<string>()
  for (const unit of result.units) if (include(unit)) {
    if (unit.capabilityGap) throw new Error(`${unit.capabilityGap.code}: ${unit.capabilityGap.message}`)
    for (const operation of unit.operations ?? []) {
      if (seen.has(operation.opId)) continue
      seen.add(operation.opId)
      operations.push(cloneJson(operation))
    }
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
  const inferredProfile = inferCompatibilityProfile(revised)
  if (options.compatibilityProfile !== undefined && options.compatibilityProfile !== inferredProfile) throw new Error(`COMPATIBILITY_PROFILE_MISMATCH: inferred ${inferredProfile}, received ${options.compatibilityProfile}.`)
  assertDocumentCompatibility(revised, inferredProfile)
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
      headRevisionProof: computePatchHeadRevisionProof(comparison.baseRevision, comparison.revisedRevision, operations),
      createdAt: options.createdAt ?? '1970-01-01T00:00:00.000Z',
      actor: options.actor ?? { type: 'reviewer', id: 'three-way-review' },
      operationProtocolVersion: '1.0',
      compatibilityProfile: inferredProfile,
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

interface ReviewUnitInput {
  unitId: string
  kind: SemanticReviewUnit['kind']
  field: ReviewField
  path: string
  status: SemanticReviewUnit['status']
  match: SemanticMatchMethod
  slideId?: string
  elementId?: string
  semanticKey?: string
  baseValue?: unknown
  localValue?: unknown
  revisedValue?: unknown
  operations?: Operation[]
  candidates?: string[]
  reason?: string
}

function addReviewUnit(units: SemanticReviewUnit[], input: ReviewUnitInput) {
  const operations = input.operations ?? []
  const capabilityGap: ReviewCapabilityGap | undefined = operations.length || sameValue(input.baseValue, input.revisedValue)
    ? undefined
    : { code: 'REVIEW_CAPABILITY_GAP', field: input.field, path: input.path, message: `No typed review operation supports ${input.field} at ${input.path}; the change must remain an explicit capability gap.`, supported: false }
  units.push({
    ...input,
    baseValue: cloneJson(input.baseValue),
    localValue: cloneJson(input.localValue),
    revisedValue: cloneJson(input.revisedValue),
    operations: operations.length ? cloneJson(operations) : undefined,
    capabilityGap,
  })
}

function fieldStatus(baseValue: unknown, localValue: unknown, revisedValue: unknown): SemanticReviewUnit['status'] {
  const localChanged = !sameValue(baseValue, localValue)
  const revisedChanged = !sameValue(baseValue, revisedValue)
  if (!localChanged && !revisedChanged) return 'unchanged'
  if (!localChanged) return revisedValue === undefined ? 'deleted' : baseValue === undefined ? 'added' : 'revised-only'
  if (!revisedChanged) return 'local-only'
  return sameValue(localValue, revisedValue) ? 'same-change' : 'conflict'
}

function fieldKeys(...maps: Array<Partial<Record<ReviewField, unknown>>>): ReviewField[] {
  return [...new Set(maps.flatMap((map) => Object.keys(map) as ReviewField[]))]
}

function uniqueCapabilityGaps(units: SemanticReviewUnit[]): ReviewCapabilityGap[] {
  const seen = new Set<string>()
  return units.flatMap((unit) => {
    const gap = unit.capabilityGap
    if (!gap) return []
    const key = `${gap.field}|${gap.path}`
    if (seen.has(key)) return []
    seen.add(key)
    return [gap]
  })
}

function documentPath(field: ReviewField): string {
  return `/${field}`
}

function operationsForDocumentField(field: ReviewField, local: PpteDocument, revised: PpteDocument): Operation[] {
  const prefix = `review:document:${field}`
  if (field === 'metadata') return [{ opId: prefix, kind: 'document.updateMetadata', patch: cloneJson(revised.metadata), replace: true }]
  if (field === 'theme') return [{ opId: prefix, kind: 'theme.replace', theme: cloneJson(revised.theme) }]
  if (field === 'slideOrder') return reconcileSlideOrderOperations(local, revised, prefix)
  return []
}

function reconcileSlideOrderOperations(local: PpteDocument, revised: PpteDocument, prefix: string): Operation[] {
  const localOrder = local.slideOrder
  const revisedOrder = revised.slideOrder
  const working = [...localOrder]
  const operations: Operation[] = []
  for (let index = working.length - 1; index >= 0; index -= 1) {
    const slideId = working[index]
    if (!revised.slides[slideId]) {
      operations.push({ opId: `review:${slideId}:slide:delete`, kind: 'slide.delete', slideId })
      working.splice(index, 1)
    } else if (!revisedOrder.includes(slideId)) return []
  }
  for (const [index, slideId] of revisedOrder.entries()) {
    if (working.includes(slideId)) continue
    if (local.slides[slideId] || !revised.slides[slideId]) return []
    operations.push({ opId: `review:${slideId}:slide:insert`, kind: 'slide.insert', slide: cloneJson(revised.slides[slideId]), index })
    working.splice(Math.min(index, working.length), 0, slideId)
  }
  revisedOrder.forEach((slideId, index) => {
    if (working[index] === slideId) return
    const from = working.indexOf(slideId)
    if (from < 0) return
    working.splice(from, 1)
    working.splice(index, 0, slideId)
    operations.push({ opId: `${prefix}:${slideId}`, kind: 'slide.move', slideId, index })
  })
  return sameValue(working, revisedOrder) ? operations : []
}

function compareDocumentFields(base: PpteDocument, local: PpteDocument, revised: PpteDocument, units: SemanticReviewUnit[]) {
  const baseFields = documentFields(base)
  const localFields = documentFields(local)
  const revisedFields = documentFields(revised)
  for (const field of fieldKeys(baseFields, localFields, revisedFields)) {
    const status = fieldStatus(baseFields[field], localFields[field], revisedFields[field])
    const operations = operationsForDocumentField(field, local, revised)
    addReviewUnit(units, {
      unitId: `document:${field}`,
      kind: 'document',
      field,
      path: documentPath(field),
      status,
      match: 'none',
      baseValue: baseFields[field],
      localValue: localFields[field],
      revisedValue: revisedFields[field],
      operations,
      reason: 'Document-level persisted field review unit.',
    })
  }
}

function compareElementFields(slideId: string, base: Element, local: Element | undefined, revised: Element | undefined, match: SemanticMatchMethod, units: SemanticReviewUnit[], ambiguous = false, candidates?: string[]) {
  if (!local && !revised) return
  if (!local || !revised) {
    const value = local ?? revised
    if (!value) return
    // A deletion is only clean when the surviving copy is byte-for-byte the
    // base element. Any local/revised mutation turns it into a decision unit.
    const status = local ? (sameValue(base, local) ? 'deleted' : 'conflict') : revised ? (sameValue(base, revised) ? 'local-only' : 'conflict') : 'conflict'
    addReviewUnit(units, {
      unitId: unitId('element', slideId, value.id, 'identity'),
      kind: 'element',
      field: 'identity',
      path: `/slides/${pointer(slideId)}/elements/${pointer(base.id)}`,
      slideId,
      elementId: value.id,
      semanticKey: value.semanticKey,
      status: ambiguous ? 'ambiguous' : status,
      match,
      candidates,
      baseValue: base,
      localValue: local,
      revisedValue: revised,
      operations: operationsForExistence(slideId, local, revised),
      reason: 'Delete-versus-any-modify is an explicit review decision.',
    })
    return
  }
  const baseFields = elementFields(base)
  const localFields = elementFields(local)
  const revisedFields = elementFields(revised)
  for (const field of fieldKeys(baseFields, localFields, revisedFields)) {
    const baseValue = baseFields[field]
    const localValue = localFields[field]
    const revisedValue = revisedFields[field]
    const status = fieldStatus(baseValue, localValue, revisedValue)
    const operations = operationsForField(slideId, local, revised, field)
    addReviewUnit(units, {
      unitId: unitId('element', slideId, local.id, field),
      kind: 'element',
      field,
      path: elementPath(slideId, local.id, field),
      slideId,
      elementId: local.id,
      semanticKey: local.semanticKey ?? revised.semanticKey,
      status: ambiguous ? 'ambiguous' : status,
      match,
      candidates,
      baseValue,
      localValue,
      revisedValue,
      operations,
    })
  }
}

function compareResourceRecords(kind: 'asset' | 'font', base: Record<string, Asset> | Record<string, FontAsset>, local: Record<string, Asset> | Record<string, FontAsset>, revised: Record<string, Asset> | Record<string, FontAsset>, units: SemanticReviewUnit[]) {
  for (const id of union(Object.keys(base), Object.keys(local), Object.keys(revised))) {
    const baseValue = base[id]
    const localValue = local[id]
    const revisedValue = revised[id]
    const status = fieldStatus(baseValue, localValue, revisedValue)
    const operation = status === 'unchanged' ? undefined : resourceOperation(kind, id, localValue, revisedValue, baseValue)
    addReviewUnit(units, {
      unitId: `document:${kind}:${id}`,
      kind: 'document',
      field: kind === 'asset' ? 'asset' : 'font',
      path: `/${kind === 'asset' ? 'assets' : 'fonts'}/${pointer(id)}`,
      status,
      match: 'none',
      baseValue,
      localValue,
      revisedValue,
      operations: operation ? [operation] : [],
      reason: `${kind} metadata review unit.`,
    })
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
    addReviewUnit(units, { unitId: unitId('element', slideId, local.id, 'identity'), kind: 'element', field: 'identity', path: `/slides/${pointer(slideId)}/elements/${pointer(local.id)}`, slideId, elementId: local.id, semanticKey: local.semanticKey, status: 'same-change', match: local.id === revised.id ? 'elementId' : 'semanticKey', localValue: local, revisedValue: revised, reason: 'Both copies added the same element.' })
    return
  }
  addReviewUnit(units, { unitId: unitId('element', slideId, local.id, 'identity'), kind: 'element', field: 'identity', path: `/slides/${pointer(slideId)}/elements/${pointer(local.id)}`, slideId, elementId: local.id, semanticKey: local.semanticKey ?? revised.semanticKey, status: 'conflict', match: local.id === revised.id ? 'elementId' : 'semanticKey', localValue: local, revisedValue: revised, reason: 'Both copies added a matching element with different content.' })
}

function compareSlideFields(slideId: string, base: PpteDocument['slides'][string] | undefined, local: PpteDocument['slides'][string] | undefined, revised: PpteDocument['slides'][string] | undefined, units: SemanticReviewUnit[]) {
  if (!base || !local || !revised) {
    const value = local ?? revised ?? base
    if (!value) return
    const status = local ? (base && sameValue(base, local) ? 'deleted' : 'conflict') : revised ? (base && sameValue(base, revised) ? 'local-only' : 'conflict') : 'conflict'
    addReviewUnit(units, { unitId: unitId('slide', slideId, slideId, 'slide'), kind: 'slide', field: 'slide', path: `/slides/${pointer(slideId)}`, slideId, status, match: 'elementId', baseValue: base, localValue: local, revisedValue: revised, operations: operationsForSlideExistence(slideId, local, revised), reason: 'Slide deletion versus any modification is an explicit review decision.' })
    return
  }
  const baseFields = slideFields(base)
  const localFields = slideFields(local)
  const revisedFields = slideFields(revised)
  for (const field of fieldKeys(baseFields, localFields, revisedFields)) {
    const status = fieldStatus(baseFields[field], localFields[field], revisedFields[field])
    addReviewUnit(units, {
      unitId: unitId('slide', slideId, slideId, field),
      kind: 'slide',
      field,
      path: `/slides/${pointer(slideId)}/${field}`,
      slideId,
      status,
      match: 'elementId',
      baseValue: baseFields[field],
      localValue: localFields[field],
      revisedValue: revisedFields[field],
      operations: operationsForSlideField(slideId, local, revised, field),
      reason: 'Slide-level persisted field review unit.',
    })
  }
}

function compareRecords(kind: 'fact' | 'source', base: Record<string, Fact | Source>, local: Record<string, Fact | Source>, revised: Record<string, Fact | Source>, units: SemanticReviewUnit[]) {
  for (const id of union(Object.keys(base), Object.keys(local), Object.keys(revised))) {
    const baseValue = base[id]
    const localValue = local[id]
    const revisedValue = revised[id]
    const status = fieldStatus(baseValue, localValue, revisedValue)
    const field = kind === 'fact' ? 'fact' : 'source'
    addReviewUnit(units, { unitId: `${kind}:${id}`, kind, field, path: `/${kind === 'fact' ? 'facts' : 'sources'}/${pointer(id)}`, status, match: kind === 'fact' ? 'factId' : 'sourceId', baseValue, localValue, revisedValue, operations: status === 'unchanged' ? [] : operationsForRecord(kind, id, localValue, revisedValue) ?? [] })
  }
}

function addExistenceUnit(status: 'local-only' | 'added', slideId: string, element: Element, units: SemanticReviewUnit[], side = 'local', index = 999) {
  addReviewUnit(units, { unitId: unitId('element', slideId, element.id, 'identity'), kind: 'element', field: 'identity', path: `/slides/${pointer(slideId)}/elements/${pointer(element.id)}`, slideId, elementId: element.id, semanticKey: element.semanticKey, status, match: 'none', localValue: side === 'local' ? element : undefined, revisedValue: side === 'revised' ? element : undefined, operations: side === 'revised' ? [{ opId: `review:${slideId}:${element.id}:insert`, kind: 'element.insert', slideId, element: cloneJson(element), index }] : [] })
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

function documentFields(document: PpteDocument): Partial<Record<ReviewField, unknown>> {
  return {
    schemaVersion: document.schemaVersion,
    documentId: document.documentId,
    locale: document.locale,
    metadata: document.metadata,
    canvas: document.canvas,
    theme: document.theme,
    slideOrder: document.slideOrder,
    widgetRequirements: document.widgetRequirements,
    policies: document.policies,
    generation: document.generation,
    extensions: document.extensions,
  }
}

function slideFields(slide: PpteDocument['slides'][string]): Partial<Record<ReviewField, unknown>> {
  return {
    name: slide.name,
    hidden: slide.hidden,
    background: slide.background,
    rootOrder: slide.rootOrder,
    groups: slide.groups,
    readingOrder: slide.readingOrder,
    notes: slide.notes,
    transition: slide.transition,
    semantic: slide.semantic,
    visualStrategy: slide.visualStrategy,
    protectedAnchors: slide.protectedAnchors,
    provenance: slide.provenance,
    extensions: slide.extensions,
  }
}

function elementFields(element: Element): Partial<Record<ReviewField, unknown>> {
  const fields: Partial<Record<ReviewField, unknown>> = {
    type: element.type,
    semanticKey: element.semanticKey,
    role: element.role,
    name: element.name,
    tags: element.tags,
    description: element.description,
    frame: element.frame,
    rotationDeg: element.rotationDeg,
    flipX: element.flipX,
    flipY: element.flipY,
    opacity: element.opacity,
    visible: element.visible,
    locked: element.locked,
    appearStep: element.appearStep,
    animation: element.animation,
    editPolicy: element.editPolicy,
    semanticRefs: element.semanticRefs,
    provenance: element.provenance,
    extensions: element.extensions,
    geometry: { frame: element.frame, rotationDeg: element.rotationDeg, flipX: element.flipX, flipY: element.flipY },
    identity: elementIdentity(element),
    visibility: { visible: element.visible, locked: element.locked, editPolicy: element.editPolicy },
  }
  if (element.type === 'text') {
    fields.content = element.content
    fields.style = { style: element.style, paragraphStyle: element.paragraphStyle, boxStyle: element.boxStyle }
    fields.paragraphStyle = element.paragraphStyle
    fields.boxStyle = element.boxStyle
    fields.overflowPolicy = element.overflowPolicy
  } else if (element.type === 'image') {
    fields.asset = { assetId: element.assetId, crop: element.crop, focalPoint: element.focalPoint }
    fields.assetId = element.assetId
    fields.fit = element.fit
    fields.crop = element.crop
    fields.focalPoint = element.focalPoint
    fields.altText = element.altText
    fields.style = element.style
  } else if (element.type === 'shape') {
    fields.shape = element.shape
    fields.points = element.points
    fields.style = element.style
  } else if (element.type === 'chart') {
    fields.chartType = element.chartType
    fields.data = element.data
    fields.encoding = element.encoding
    fields.options = element.options
    fields.altText = element.altText
    fields.style = element.style
  } else if (element.type === 'component') {
    fields.content = element.props
    fields.props = element.props
    fields.componentType = element.componentType
    fields.componentVersion = element.componentVersion
    fields.fallback = element.fallback
  }
  return fields
}

function elementIdentity(element: Element): unknown {
  return { type: element.type, semanticKey: element.semanticKey, role: element.role, name: element.name, semanticRefs: element.semanticRefs }
}

function operationsForField(slideId: string, local: Element, revised: Element, field: ReviewField): Operation[] {
  const prefix = `review:${slideId}:${local.id}:${field}`
  if (field === 'content' && local.type === 'text' && revised.type === 'text') return [{ opId: prefix, kind: 'text.replaceContent', slideId, elementId: local.id, content: cloneJson(revised.content) }]
  if (field === 'content' && local.type === 'component' && revised.type === 'component') return [{ opId: prefix, kind: 'component.updateProps', slideId, elementId: local.id, patch: cloneJson(revised.props), replace: true }]
  if (field === 'props' && local.type === 'component' && revised.type === 'component') return [{ opId: `review:${slideId}:${local.id}:content`, kind: 'component.updateProps', slideId, elementId: local.id, patch: cloneJson(revised.props), replace: true }]
  if (field === 'data' && local.type === 'chart' && revised.type === 'chart') return [{ opId: prefix, kind: 'chart.replaceData', slideId, elementId: local.id, data: cloneJson(revised.data) }]
  if (field === 'encoding' && local.type === 'chart' && revised.type === 'chart') return [{ opId: prefix, kind: 'chart.updateEncoding', slideId, elementId: local.id, encoding: cloneJson(revised.encoding) }]
  if (field === 'options' && local.type === 'chart' && revised.type === 'chart') return [{ opId: prefix, kind: 'chart.updateOptions', slideId, elementId: local.id, patch: cloneJson(revised.options ?? {}), ...(revised.options === undefined ? { unset: true } : { replace: true }) }]
  if (field === 'geometry') {
    if (local.flipX !== revised.flipX || local.flipY !== revised.flipY) return []
    const operations: Operation[] = []
    if (!sameValue(local.frame, revised.frame)) operations.push({ opId: `${prefix}:frame`, kind: 'element.resize', slideId, elementId: local.id, frame: cloneJson(revised.frame) })
    if (local.rotationDeg !== revised.rotationDeg) operations.push({ opId: `${prefix}:rotation`, kind: 'element.rotate', slideId, elementId: local.id, rotationDeg: revised.rotationDeg, unset: revised.rotationDeg === undefined })
    return operations
  }
  if (field === 'frame') return sameValue(local.frame, revised.frame) ? [] : [{ opId: prefix, kind: 'element.resize', slideId, elementId: local.id, frame: cloneJson(revised.frame) }]
  if (field === 'rotationDeg') return local.rotationDeg === revised.rotationDeg ? [] : [{ opId: prefix, kind: 'element.rotate', slideId, elementId: local.id, rotationDeg: revised.rotationDeg, unset: revised.rotationDeg === undefined }]
  if (field === 'appearStep') return local.appearStep === revised.appearStep ? [] : [{ opId: prefix, kind: 'element.setAppearStep', slideId, elementId: local.id, appearStep: revised.appearStep, unset: revised.appearStep === undefined }]
  if (field === 'animation') return sameValue(local.animation, revised.animation) ? [] : [{ opId: prefix, kind: 'element.setAnimation', slideId, elementId: local.id, animation: cloneJson(revised.animation), unset: revised.animation === undefined }]
  if (field === 'semanticKey') return local.semanticKey === revised.semanticKey ? [] : [{ opId: prefix, kind: 'element.setSemanticKey', slideId, elementId: local.id, semanticKey: revised.semanticKey }]
  if (field === 'semanticRefs') return sameValue(local.semanticRefs, revised.semanticRefs) ? [] : [{ opId: prefix, kind: 'element.setSemanticRefs', slideId, elementId: local.id, semanticRefs: cloneJson(revised.semanticRefs), unset: revised.semanticRefs === undefined }]
  if (field === 'visible') return local.visible === revised.visible ? [] : [{ opId: prefix, kind: 'element.setVisibility', slideId, elementId: local.id, visible: revised.visible, unset: revised.visible === undefined }]
  if (field === 'locked') return local.locked === revised.locked ? [] : [{ opId: prefix, kind: 'element.setLocked', slideId, elementId: local.id, locked: revised.locked, unset: revised.locked === undefined }]
  if (field === 'editPolicy') return sameValue(local.editPolicy, revised.editPolicy) ? [] : [{ opId: prefix, kind: 'element.setEditPolicy', slideId, elementId: local.id, editPolicy: cloneJson(revised.editPolicy), unset: revised.editPolicy === undefined }]
  if (field === 'overflowPolicy' && local.type === 'text' && revised.type === 'text') return local.overflowPolicy === revised.overflowPolicy ? [] : [{ opId: prefix, kind: 'text.setOverflowPolicy', slideId, elementId: local.id, overflowPolicy: revised.overflowPolicy, unset: revised.overflowPolicy === undefined }]
  if (field === 'asset' && local.type === 'image' && revised.type === 'image') return [
    ...imageAssetOperations(slideId, local, revised, prefix),
  ]
  if (field === 'assetId' && local.type === 'image' && revised.type === 'image') return local.assetId === revised.assetId ? [] : [{ opId: prefix, kind: 'image.replaceAsset', slideId, elementId: local.id, assetId: revised.assetId, preserveCrop: sameValue(local.crop, revised.crop) }]
  if (field === 'crop' && local.type === 'image' && revised.type === 'image') return sameValue(local.crop, revised.crop) ? [] : revised.crop ? [{ opId: prefix, kind: 'image.setCrop', slideId, elementId: local.id, crop: cloneJson(revised.crop) }] : [{ opId: prefix, kind: 'image.replaceAsset', slideId, elementId: local.id, assetId: revised.assetId, preserveCrop: false }]
  if (field === 'focalPoint' && local.type === 'image' && revised.type === 'image') return sameValue(local.focalPoint, revised.focalPoint) ? [] : [{ opId: prefix, kind: 'image.setFocalPoint', slideId, elementId: local.id, focalPoint: cloneJson(revised.focalPoint) }]
  if (field === 'identity' && local.type === revised.type && local.role === revised.role && local.name === revised.name) {
    const operations: Operation[] = []
    if (local.semanticKey !== revised.semanticKey) operations.push({ opId: `${prefix}:key`, kind: 'element.setSemanticKey', slideId, elementId: local.id, semanticKey: revised.semanticKey })
    if (!sameValue(local.semanticRefs, revised.semanticRefs)) operations.push({ opId: `${prefix}:refs`, kind: 'element.setSemanticRefs', slideId, elementId: local.id, semanticRefs: cloneJson(revised.semanticRefs), unset: revised.semanticRefs === undefined })
    return operations
  }
  if (field === 'visibility') {
    const operations: Operation[] = []
    if (local.visible !== revised.visible) operations.push({ opId: `${prefix}:visible`, kind: 'element.setVisibility', slideId, elementId: local.id, visible: revised.visible, unset: revised.visible === undefined })
    if (local.locked !== revised.locked) operations.push({ opId: `${prefix}:locked`, kind: 'element.setLocked', slideId, elementId: local.id, locked: revised.locked, unset: revised.locked === undefined })
    if (!sameValue(local.editPolicy, revised.editPolicy)) operations.push({ opId: `${prefix}:policy`, kind: 'element.setEditPolicy', slideId, elementId: local.id, editPolicy: cloneJson(revised.editPolicy), unset: revised.editPolicy === undefined })
    return operations
  }
  if (field === 'paragraphStyle' && local.type === 'text' && revised.type === 'text') return textStyleOperations(slideId, local, revised, 'paragraphStyle')
  if (field === 'boxStyle' && local.type === 'text' && revised.type === 'text') return textStyleOperations(slideId, local, revised, 'boxStyle')
  if (field === 'style' && 'style' in local && 'style' in revised && local.style && revised.style) {
    const operations: Operation[] = []
    if (local.style.styleRef !== revised.style.styleRef) operations.push({ opId: `${prefix}:ref`, kind: 'element.setStyleRef', slideId, elementId: local.id, styleRef: revised.style.styleRef })
    if (local.type === 'text' && revised.type === 'text') operations.push(...textStyleOperations(slideId, local, revised, 'both'))
    if (local.type === 'chart' && revised.type === 'chart') {
      if (revised.style.overrides) operations.push({ opId: `${prefix}:chart-style`, kind: 'chart.updateStyle', slideId, elementId: local.id, patch: cloneJson(revised.style.overrides), replace: true })
      else operations.push({ opId: `${prefix}:chart-style`, kind: 'chart.updateStyle', slideId, elementId: local.id, patch: {}, replace: true, unset: true })
    } else if (revised.style.overrides) {
      operations.push({ opId: `${prefix}:clear`, kind: 'element.clearStyleOverrides', slideId, elementId: local.id })
      operations.push({ opId: `${prefix}:overrides`, kind: 'element.updateStyleOverrides', slideId, elementId: local.id, patch: cloneJson(revised.style.overrides) as Record<string, never> })
    } else operations.push({ opId: `${prefix}:clear`, kind: 'element.clearStyleOverrides', slideId, elementId: local.id })
    return operations
  }
  return []
}

function textStyleOperations(slideId: string, local: Extract<Element, { type: 'text' }>, revised: Extract<Element, { type: 'text' }>, requested: 'paragraphStyle' | 'boxStyle' | 'both'): Operation[] {
  const operations: Operation[] = []
  const prefix = `review:${slideId}:${local.id}:text-style`
  const paragraphChanged = !sameValue(local.paragraphStyle, revised.paragraphStyle)
  const boxChanged = !sameValue(local.boxStyle, revised.boxStyle)
  if ((requested === 'paragraphStyle' || requested === 'both') && paragraphChanged) operations.push({ opId: `${prefix}:paragraph`, kind: 'text.updateStyle', slideId, elementId: local.id, ...(revised.paragraphStyle === undefined ? { unsetParagraphStyle: true } : { paragraphStyle: cloneJson(revised.paragraphStyle) }) })
  if ((requested === 'boxStyle' || requested === 'both') && boxChanged) operations.push({ opId: `${prefix}:box`, kind: 'text.updateStyle', slideId, elementId: local.id, ...(revised.boxStyle === undefined ? { unsetBoxStyle: true } : { boxStyle: cloneJson(revised.boxStyle) }) })
  return operations
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

function operationsForSlideField(slideId: string, local: PpteDocument['slides'][string], revised: PpteDocument['slides'][string], field: ReviewField): Operation[] {
  const prefix = `review:${slideId}:slide:${field}`
  if (['name', 'hidden', 'background', 'semantic', 'visualStrategy', 'provenance', 'extensions'].includes(field)) {
    const value = revised[field as keyof typeof revised]
    return value === undefined ? [] : [{ opId: prefix, kind: 'slide.update', slideId, patch: { [field]: cloneJson(value) } as Record<string, never> }]
  }
  if (field === 'notes') return revised.notes === undefined ? [{ opId: prefix, kind: 'slide.setNotes', slideId, unset: true }] : [{ opId: prefix, kind: 'slide.setNotes', slideId, notes: cloneJson(revised.notes) }]
  if (field === 'transition') return revised.transition === undefined ? [{ opId: prefix, kind: 'slide.setTransition', slideId, unset: true }] : [{ opId: prefix, kind: 'slide.setTransition', slideId, transition: cloneJson(revised.transition) }]
  if (field === 'readingOrder') return revised.readingOrder === undefined ? [{ opId: prefix, kind: 'slide.setReadingOrder', slideId, unset: true }] : [{ opId: prefix, kind: 'slide.setReadingOrder', slideId, readingOrder: cloneJson(revised.readingOrder) }]
  if (field === 'protectedAnchors') return revised.protectedAnchors === undefined ? [{ opId: prefix, kind: 'slide.setProtectedAnchors', slideId, unset: true }] : [{ opId: prefix, kind: 'slide.setProtectedAnchors', slideId, protectedAnchors: cloneJson(revised.protectedAnchors) }]
  if (field === 'rootOrder') return reconcileElementOrderOperations(slideId, local, revised, prefix)
  return []
}

function reconcileElementOrderOperations(slideId: string, local: PpteDocument['slides'][string], revised: PpteDocument['slides'][string], prefix: string): Operation[] {
  const localOrder = local.rootOrder
  const revisedOrder = revised.rootOrder
  const working = [...localOrder]
  const operations: Operation[] = []
  for (let index = working.length - 1; index >= 0; index -= 1) {
    const elementId = working[index]
    if (!revised.elements[elementId]) {
      operations.push({ opId: `review:${slideId}:${elementId}:delete`, kind: 'element.delete', slideId, elementId })
      working.splice(index, 1)
    } else if (!revisedOrder.includes(elementId)) return []
  }
  for (const [index, elementId] of revisedOrder.entries()) {
    if (working.includes(elementId)) continue
    if (local.elements[elementId] || !revised.elements[elementId]) return []
    operations.push({ opId: `review:${slideId}:${elementId}:insert`, kind: 'element.insert', slideId, element: cloneJson(revised.elements[elementId]), index })
    working.splice(Math.min(index, working.length), 0, elementId)
  }
  revisedOrder.forEach((elementId, index) => {
    if (working[index] === elementId) return
    const from = working.indexOf(elementId)
    if (from < 0) return
    working.splice(from, 1)
    working.splice(index, 0, elementId)
    operations.push({ opId: `${prefix}:${elementId}`, kind: 'element.reorder', slideId, elementId, index })
  })
  return sameValue(working, revisedOrder) ? operations : []
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
  if (operation.kind === 'element.setSemanticRefs') return ['content']
  if (operation.kind === 'fact.syncReferences') return ['facts', 'content']
  if (operation.kind === 'chart.updateStyle') return ['style']
  if (operation.kind === 'text.updateStyle') return ['style']
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
