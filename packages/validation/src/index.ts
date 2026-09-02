import { canonicalHash } from '../../canonical-json/src/index.js'
import { validateDocument } from '../../schema/src/index.js'
import { validateSemanticIdentity } from '../../semantic-identity/src/index.js'
import { checkFactSourceConsistency } from '../../facts/src/index.js'
import { withErrorSemantics } from '../../schema/src/errors.js'
import type {
  Element,
  FontAsset,
  OperationKind,
  PpteDocument,
  RuntimeProfile,
  TextElement,
  TextStyle,
  Transaction,
  ValidationIssue,
  ValueOrToken,
} from '../../schema/src/index.js'

const TEXT_STYLE_FIELDS = ['fontFamily', 'fontSize', 'fontWeight', 'color', 'lineHeight', 'letterSpacing', 'verticalAlign', 'direction'] as const
const SHAPE_STYLE_FIELDS = ['fill', 'stroke', 'radius', 'shadow'] as const
const IMAGE_STYLE_FIELDS = ['border', 'radius', 'shadow'] as const
const CHART_STYLE_FIELDS = ['palette', 'axisColor', 'labelColor', 'gridColor', 'lineWidth', 'cornerRadius'] as const
const KEY_ROLES = new Set(['title', 'subtitle', 'body', 'caption', 'metric', 'source', 'logo', 'image', 'chart', 'cta'])
const ACTOR_TYPES = new Set(['human', 'agent', 'system', 'importer', 'reviewer'])
const SCOPE_KINDS = new Set(['selection', 'slide', 'document', 'custom'])
const SCOPE_PERMISSIONS = new Set(['content', 'geometry', 'style', 'structure', 'theme', 'assets', 'facts', 'sources', 'notes', 'animation', 'review'])
const OPERATION_KINDS = new Set<OperationKind>([
  'document.updateMetadata', 'theme.replace', 'theme.setToken', 'theme.updatePreset',
  'slide.insert', 'slide.delete', 'slide.move', 'slide.update', 'slide.setReadingOrder', 'slide.setProtectedAnchors',
  'element.insert', 'element.delete', 'element.duplicate', 'element.move', 'element.resize', 'element.rotate', 'element.reorder', 'element.setVisibility', 'element.setLocked', 'element.setEditPolicy', 'element.setSemanticKey', 'element.setSemanticRefs', 'element.setStyleRef', 'element.updateStyleOverrides', 'element.clearStyleOverrides',
  'text.replaceContent', 'text.setOverflowPolicy', 'text.fitByReducingFont', 'text.resizeBox',
  'image.replaceAsset', 'image.setCrop', 'image.setFocalPoint', 'asset.upsert', 'font.upsert', 'shape.updateStyle',
  'chart.replaceData', 'chart.updateEncoding', 'chart.updateOptions', 'chart.updateStyle', 'component.updateProps',
  'group.create', 'group.delete', 'group.addMembers', 'group.removeMembers', 'group.move', 'group.resize',
  'fact.upsert', 'fact.delete', 'fact.syncReferences', 'source.upsert', 'source.delete', 'layout.align', 'layout.distribute',
])

export interface ResolvedTextStyle extends Omit<TextStyle, 'fontFamily' | 'color'> {
  fontFamily: string
  color: string
}

export interface OverrideDebtEntry {
  slideId: string
  elementId: string
  semanticKey?: string
  fields: string[]
}

export interface OverrideDebtReport {
  /** Ratio in the range 0..1. */
  overrideDebt: number
  overriddenFields: number
  controllableFields: number
  keyElementCount: number
  entries: OverrideDebtEntry[]
}

export interface GlyphCoverageReport {
  elementId: string
  fontFamily: string
  fontId?: string
  covered: boolean
  missingCodePoints: number[]
  source: 'declared' | 'system-safe' | 'unresolved' | 'unsafe'
}

export function validateRuntimeDocument(document: PpteDocument, options: { runtimeProfile?: RuntimeProfile } = {}): ValidationIssue[] {
  const runtimeProfile = options.runtimeProfile ?? 'ga-b'
  const issues = validateDocument(document, { runtimeSubset: true, runtimeProfile })
  if (!document || typeof document !== 'object') return normalizeIssues(issues)
  if (!document.slides || typeof document.slides !== 'object') return normalizeIssues(issues)
  issues.push(...validateSemanticIdentity(document))
  issues.push(...validateStyleBindings(document))
  for (const slide of Object.values(document.slides ?? {})) {
    if (!slide || typeof slide !== 'object') continue
    for (const element of Object.values(slide.elements ?? {})) {
      if (!element || typeof element !== 'object') continue
      if (element.type === 'text') {
        issues.push(...validateTextOverflow(document, slide.id, element))
        issues.push(...checkGlyphCoverage(document, element))
      }
    }
  }
  issues.push(...diagnoseOverrideDebt(document))
  issues.push(...checkFactSourceConsistency(document).issues)
  return normalizeIssues(issues)
}

export function validateTransactionShape(transaction: Transaction): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) return normalizeIssues([error('SCHEMA_INVALID', 'Transaction must be an object.', '/')])
  const value = transaction as unknown as Record<string, unknown>
  if (!nonEmptyString(value.transactionId)) issues.push(error('SCHEMA_INVALID', 'transactionId is required.', '/transactionId'))
  if (!nonEmptyString(value.baseRevision)) issues.push(error('SCHEMA_INVALID', 'baseRevision is required.', '/baseRevision'))
  const actor = asRecord(value.actor)
  if (!actor || !ACTOR_TYPES.has(String(actor.type))) issues.push(error('SCHEMA_INVALID', 'actor.type is invalid.', '/actor/type'))
  else if (actor.id !== undefined && !nonEmptyString(actor.id)) issues.push(error('SCHEMA_INVALID', 'actor.id must be a non-empty string when present.', '/actor/id'))
  const scope = asRecord(value.scope)
  if (!scope || !SCOPE_KINDS.has(String(scope.kind))) issues.push(error('SCHEMA_INVALID', 'scope.kind is invalid.', '/scope/kind'))
  if (!scope || !Array.isArray(scope.permissions) || scope.permissions.length === 0) issues.push(error('SCHEMA_INVALID', 'scope.permissions must be a non-empty array.', '/scope/permissions'))
  else {
    checkUniqueStrings(scope.permissions, '/scope/permissions', issues)
    for (const permission of scope.permissions) if (!SCOPE_PERMISSIONS.has(permission)) issues.push(error('SCHEMA_INVALID', `Unknown scope permission ${permission}.`, '/scope/permissions'))
  }
  if (scope) {
    for (const field of ['slideIds', 'elementIds', 'semanticKeys'] as const) if (scope[field] !== undefined && !Array.isArray(scope[field])) issues.push(error('SCHEMA_INVALID', `scope.${field} must be an array when present.`, `/scope/${field}`))
    for (const field of ['slideIds', 'elementIds', 'semanticKeys'] as const) if (Array.isArray(scope[field])) checkUniqueStrings(scope[field], `/scope/${field}`, issues)
    if (scope.allowInsert !== undefined && typeof scope.allowInsert !== 'boolean') issues.push(error('SCHEMA_INVALID', 'scope.allowInsert must be boolean.', '/scope/allowInsert'))
    if (scope.allowDelete !== undefined && typeof scope.allowDelete !== 'boolean') issues.push(error('SCHEMA_INVALID', 'scope.allowDelete must be boolean.', '/scope/allowDelete'))
  }
  const contract = asRecord(value.changeContract)
  if (!contract) issues.push(error('SCHEMA_INVALID', 'changeContract is required.', '/changeContract'))
  else validateChangeContractShape(contract, issues)
  if (!nonEmptyString(value.createdAt)) issues.push(error('SCHEMA_INVALID', 'createdAt is required.', '/createdAt'))
  if (value.validationLevel !== undefined && !['L1', 'L2', 'L3'].includes(String(value.validationLevel))) issues.push(error('SCHEMA_INVALID', 'validationLevel is invalid.', '/validationLevel'))
  if (value.metadata !== undefined && !isRecord(value.metadata)) issues.push(error('SCHEMA_INVALID', 'metadata must be an object when present.', '/metadata'))
  if (!Array.isArray(value.operations) || value.operations.length === 0) issues.push(error('SCHEMA_INVALID', 'A transaction must contain at least one operation.', '/operations'))
  const ids = new Set<string>()
  for (const [index, rawOperation] of (Array.isArray(value.operations) ? value.operations : []).entries()) {
    const operation = asRecord(rawOperation)
    if (!operation) {
      issues.push(error('SCHEMA_INVALID', 'Operation must be an object.', `/operations/${index}`))
      continue
    }
    if (!nonEmptyString(operation.opId)) issues.push(error('SCHEMA_INVALID', 'Operation opId is required.', `/operations/${index}/opId`))
    else if (ids.has(operation.opId)) issues.push(error('SCHEMA_INVALID', `Duplicate operation id ${operation.opId}.`, `/operations/${index}/opId`))
    else ids.add(operation.opId)
    if (!OPERATION_KINDS.has(operation.kind as OperationKind)) issues.push(error('SCHEMA_INVALID', `Unknown operation kind ${String(operation.kind)}.`, `/operations/${index}/kind`))
    else validateOperationShape(operation, index, issues)
  }
  return normalizeIssues(issues)
}

function validateChangeContractShape(contract: Record<string, unknown>, issues: ValidationIssue[]) {
  for (const field of ['allowedOperationKinds', 'allowedElementIds', 'allowedSemanticKeys', 'allowedPaths'] as const) {
    if (contract[field] === undefined) continue
    if (!Array.isArray(contract[field])) {
      issues.push(error('SCHEMA_INVALID', `changeContract.${field} must be an array when present.`, `/changeContract/${field}`))
      continue
    }
    checkUniqueStrings(contract[field], `/changeContract/${field}`, issues)
    if (field === 'allowedOperationKinds') for (const kind of contract[field]) if (OPERATION_KINDS.has(kind as OperationKind) === false) issues.push(error('SCHEMA_INVALID', `Unknown allowed operation kind ${String(kind)}.`, `/changeContract/${field}`))
    if (field === 'allowedPaths') for (const path of contract[field]) if (typeof path === 'string' && !path.startsWith('/')) issues.push(error('SCHEMA_INVALID', 'Allowed paths must be JSON pointers.', `/changeContract/${field}`))
  }
  for (const field of ['maxChangedSlides', 'maxChangedElements', 'maxInsertedElements', 'maxDeletedElements', 'maxReplacedAssets', 'maxChangedFacts', 'maxChangedSources', 'maxChangedThemeTokens', 'maxChangedStylePresets'] as const) {
    if (contract[field] !== undefined && (!Number.isInteger(contract[field]) || (contract[field] as number) < 0)) issues.push(error('SCHEMA_INVALID', `changeContract.${field} must be a non-negative integer.`, `/changeContract/${field}`))
  }
  const preserve = contract.preserve
  if (preserve !== undefined) {
    if (!isRecord(preserve)) issues.push(error('SCHEMA_INVALID', 'changeContract.preserve must be an object.', '/changeContract/preserve'))
    else {
      const fields = new Set(['content', 'data', 'style', 'geometry', 'asset', 'semanticIdentity', 'readingOrder', 'facts'])
      for (const [field, value] of Object.entries(preserve)) {
        if (!fields.has(field)) issues.push(error('SCHEMA_INVALID', `Unknown change invariant ${field}.`, `/changeContract/preserve/${escapePointer(field)}`))
        else if (field === 'semanticIdentity' ? !['preserve', 'allow-replacement'].includes(String(value)) : field === 'facts' ? !['preserve', 'allow', 'allow-explicit-sync'].includes(String(value)) : !['preserve', 'allow'].includes(String(value))) issues.push(error('SCHEMA_INVALID', `Invalid change invariant ${field}.`, `/changeContract/preserve/${escapePointer(field)}`))
      }
    }
  }
  if (contract.requireConfirmation !== undefined && typeof contract.requireConfirmation !== 'boolean') issues.push(error('SCHEMA_INVALID', 'changeContract.requireConfirmation must be boolean.', '/changeContract/requireConfirmation'))
}

function validateOperationShape(operation: Record<string, unknown>, index: number, issues: ValidationIssue[]) {
  const path = `/operations/${index}`
  const kind = String(operation.kind)
  const requireString = (field: string) => { if (!nonEmptyString(operation[field])) issues.push(error('SCHEMA_INVALID', `${kind}.${field} must be a non-empty string.`, `${path}/${field}`)) }
  const requireFiniteNumber = (field: string) => { if (!finite(operation[field])) issues.push(error('SCHEMA_INVALID', `${kind}.${field} must be finite.`, `${path}/${field}`)) }
  const requireInteger = (field: string) => { if (!Number.isInteger(operation[field])) issues.push(error('SCHEMA_INVALID', `${kind}.${field} must be an integer.`, `${path}/${field}`)) }
  const requireRecord = (field: string) => { if (!isRecord(operation[field])) issues.push(error('SCHEMA_INVALID', `${kind}.${field} must be an object.`, `${path}/${field}`)); return asRecord(operation[field]) }
  const requireStringArray = (field: string, minimum = 0) => {
    if (!Array.isArray(operation[field]) || operation[field].length < minimum) issues.push(error('SCHEMA_INVALID', `${kind}.${field} must be an array.`, `${path}/${field}`))
    else checkUniqueStrings(operation[field], `${path}/${field}`, issues)
  }
  const requireFrame = (field: string) => {
    const frame = requireRecord(field)
    if (frame) for (const coordinate of ['x', 'y', 'width', 'height']) requireFiniteNumberAt(frame, coordinate, `${path}/${field}`, issues)
    if (frame && (typeof frame.width !== 'number' || frame.width <= 0 || typeof frame.height !== 'number' || frame.height <= 0)) issues.push(error('SCHEMA_INVALID', `${kind}.${field} dimensions must be positive.`, `${path}/${field}`))
  }
  const requirePoint = (field: string) => {
    const point = requireRecord(field)
    if (point) { requireFiniteNumberAt(point, 'x', `${path}/${field}`, issues); requireFiniteNumberAt(point, 'y', `${path}/${field}`, issues) }
  }
  if (operation.preconditions !== undefined) validatePreconditions(operation.preconditions, path, issues)

  const slideKinds = new Set(['slide.delete', 'slide.move', 'slide.update', 'slide.setReadingOrder', 'slide.setProtectedAnchors', 'element.insert', 'element.delete', 'element.duplicate', 'element.move', 'element.resize', 'element.rotate', 'element.reorder', 'element.setVisibility', 'element.setLocked', 'element.setEditPolicy', 'element.setSemanticKey', 'element.setSemanticRefs', 'element.setStyleRef', 'element.updateStyleOverrides', 'element.clearStyleOverrides', 'text.replaceContent', 'text.setOverflowPolicy', 'text.fitByReducingFont', 'text.resizeBox', 'image.replaceAsset', 'image.setCrop', 'image.setFocalPoint', 'shape.updateStyle', 'chart.replaceData', 'chart.updateEncoding', 'chart.updateOptions', 'chart.updateStyle', 'component.updateProps', 'group.create', 'group.delete', 'group.addMembers', 'group.removeMembers', 'group.move', 'group.resize', 'layout.align', 'layout.distribute'])
  if (slideKinds.has(kind)) requireString('slideId')
  const elementKinds = new Set(['element.delete', 'element.move', 'element.resize', 'element.rotate', 'element.reorder', 'element.setVisibility', 'element.setLocked', 'element.setEditPolicy', 'element.setSemanticKey', 'element.setSemanticRefs', 'element.setStyleRef', 'element.updateStyleOverrides', 'element.clearStyleOverrides', 'text.replaceContent', 'text.setOverflowPolicy', 'text.fitByReducingFont', 'text.resizeBox', 'image.replaceAsset', 'image.setCrop', 'image.setFocalPoint', 'shape.updateStyle', 'chart.replaceData', 'chart.updateEncoding', 'chart.updateOptions', 'chart.updateStyle', 'component.updateProps'])
  if (elementKinds.has(kind)) requireString('elementId')

  switch (kind) {
    case 'document.updateMetadata': {
      requireRecord('patch')
      if (operation.replace !== undefined && typeof operation.replace !== 'boolean') issues.push(error('SCHEMA_INVALID', 'document.updateMetadata.replace must be boolean.', `${path}/replace`))
      break
    }
    case 'theme.replace': requireRecord('theme'); break
    case 'theme.setToken':
      if (!['colors', 'fontFamilies', 'fontSizes', 'spacing', 'radii', 'shadows'].includes(String(operation.category))) issues.push(error('SCHEMA_INVALID', 'theme.setToken.category is invalid.', `${path}/category`))
      requireString('token')
      if (!Object.prototype.hasOwnProperty.call(operation, 'value')) issues.push(error('SCHEMA_INVALID', 'theme.setToken.value is required.', `${path}/value`))
      break
    case 'theme.updatePreset':
      if (!['text', 'shape', 'image', 'chart'].includes(String(operation.category))) issues.push(error('SCHEMA_INVALID', 'theme.updatePreset.category is invalid.', `${path}/category`))
      requireString('presetId')
      if (!operation.remove && !Object.prototype.hasOwnProperty.call(operation, 'value')) issues.push(error('SCHEMA_INVALID', 'theme.updatePreset.value is required unless remove is true.', `${path}/value`))
      if (operation.remove !== undefined && typeof operation.remove !== 'boolean') issues.push(error('SCHEMA_INVALID', 'theme.updatePreset.remove must be boolean.', `${path}/remove`))
      break
    case 'slide.insert': {
      const slide = requireRecord('slide')
      if (slide) { requireStringAt(slide, 'id', `${path}/slide`, issues); if (!Array.isArray(slide.rootOrder)) issues.push(error('SCHEMA_INVALID', 'slide.insert.slide.rootOrder must be an array.', `${path}/slide/rootOrder`)); if (!isRecord(slide.elements)) issues.push(error('SCHEMA_INVALID', 'slide.insert.slide.elements must be an object.', `${path}/slide/elements`)) }
      requireInteger('index')
      break
    }
    case 'slide.delete': case 'slide.move': requireString('slideId'); if (kind === 'slide.move') requireInteger('index'); break
    case 'slide.update': requireRecord('patch'); break
    case 'slide.setReadingOrder':
      validateUnsetPair(operation, 'readingOrder', (value) => Array.isArray(value), path, issues)
      if (operation.unset !== true && Array.isArray(operation.readingOrder)) checkUniqueStrings(operation.readingOrder, `${path}/readingOrder`, issues)
      break
    case 'slide.setProtectedAnchors': validateUnsetPair(operation, 'protectedAnchors', Array.isArray, path, issues); break
    case 'element.insert': {
      const element = requireRecord('element')
      if (element) { requireStringAt(element, 'id', `${path}/element`, issues); requireStringAt(element, 'type', `${path}/element`, issues) }
      requireInteger('index')
      break
    }
    case 'element.duplicate': requireString('sourceElementId'); requireString('newElementId'); if (operation.offset !== undefined) requirePoint('offset'); if (operation.index !== undefined) requireInteger('index'); break
    case 'element.move': requireFiniteNumber('x'); requireFiniteNumber('y'); break
    case 'element.resize': requireFrame('frame'); if (operation.preserveAspectRatio !== undefined && typeof operation.preserveAspectRatio !== 'boolean') issues.push(error('SCHEMA_INVALID', 'element.resize.preserveAspectRatio must be boolean.', `${path}/preserveAspectRatio`)); break
    case 'element.rotate': validateUnsetPair(operation, 'rotationDeg', finite, path, issues); break
    case 'element.reorder': requireInteger('index'); break
    case 'element.setVisibility': validateUnsetPair(operation, 'visible', (value) => typeof value === 'boolean', path, issues); break
    case 'element.setLocked': validateUnsetPair(operation, 'locked', (value) => typeof value === 'boolean', path, issues); break
    case 'element.setEditPolicy': validateUnsetPair(operation, 'editPolicy', isRecord, path, issues); break
    case 'element.setSemanticKey': if (operation.semanticKey !== undefined && !nonEmptyString(operation.semanticKey)) issues.push(error('SCHEMA_INVALID', 'element.setSemanticKey.semanticKey must be a string when present.', `${path}/semanticKey`)); break
    case 'element.setSemanticRefs': validateUnsetPair(operation, 'semanticRefs', isRecord, path, issues); break
    case 'element.setStyleRef': requireString('styleRef'); break
    case 'element.updateStyleOverrides': requireRecord('patch'); break
    case 'element.clearStyleOverrides': if (operation.paths !== undefined) { if (!Array.isArray(operation.paths)) issues.push(error('SCHEMA_INVALID', 'element.clearStyleOverrides.paths must be an array.', `${path}/paths`)); else checkUniqueStrings(operation.paths, `${path}/paths`, issues) } break
    case 'text.replaceContent': requireRecord('content'); break
    case 'text.setOverflowPolicy': validateUnsetPair(operation, 'overflowPolicy', (value) => ['warn', 'clip', 'ellipsis'].includes(String(value)), path, issues); break
    case 'text.fitByReducingFont': requireFiniteNumber('minFontSize'); requireFiniteNumber('resolvedFontSize'); break
    case 'text.resizeBox': requireFrame('frame'); break
    case 'image.replaceAsset': requireString('assetId'); if (operation.preserveCrop !== undefined && typeof operation.preserveCrop !== 'boolean') issues.push(error('SCHEMA_INVALID', 'image.replaceAsset.preserveCrop must be boolean.', `${path}/preserveCrop`)); break
    case 'image.setCrop': { const crop = requireRecord('crop'); if (crop) for (const coordinate of ['x', 'y', 'width', 'height']) requireFiniteNumberAt(crop, coordinate, `${path}/crop`, issues); break }
    case 'image.setFocalPoint': if (operation.focalPoint !== undefined) requirePoint('focalPoint'); break
    case 'asset.upsert': {
      const asset = requireRecord('asset')
      if (asset) {
        requireStringAt(asset, 'id', `${path}/asset`, issues)
        requireStringAt(asset, 'hash', `${path}/asset`, issues)
        requireStringAt(asset, 'mimeType', `${path}/asset`, issues)
        requireStringAt(asset, 'path', `${path}/asset`, issues)
        if (!Number.isInteger(asset.byteLength) || Number(asset.byteLength) < 0) issues.push(error('SCHEMA_INVALID', 'asset.upsert.asset.byteLength must be a non-negative integer.', `${path}/asset/byteLength`))
      }
      if (operation.remove !== undefined && typeof operation.remove !== 'boolean') issues.push(error('SCHEMA_INVALID', 'asset.upsert.remove must be boolean.', `${path}/remove`))
      break
    }
    case 'font.upsert': {
      const font = requireRecord('font')
      if (font) {
        requireStringAt(font, 'id', `${path}/font`, issues)
        requireStringAt(font, 'family', `${path}/font`, issues)
        requireStringAt(font, 'source', `${path}/font`, issues)
        if (!Number.isFinite(font.weight)) issues.push(error('SCHEMA_INVALID', 'font.upsert.font.weight must be finite.', `${path}/font/weight`))
      }
      if (operation.remove !== undefined && typeof operation.remove !== 'boolean') issues.push(error('SCHEMA_INVALID', 'font.upsert.remove must be boolean.', `${path}/remove`))
      break
    }
    case 'shape.updateStyle': requireRecord('patch'); if (operation.replace !== undefined && typeof operation.replace !== 'boolean') issues.push(error('SCHEMA_INVALID', 'shape.updateStyle.replace must be boolean.', `${path}/replace`)); break
    case 'chart.replaceData': requireRecord('data'); break
    case 'chart.updateEncoding': requireRecord('encoding'); break
    case 'chart.updateOptions': case 'chart.updateStyle':
      requireRecord('patch')
      if (operation.replace !== undefined && typeof operation.replace !== 'boolean') issues.push(error('SCHEMA_INVALID', `${kind}.replace must be boolean.`, `${path}/replace`))
      if (operation.unset !== undefined && typeof operation.unset !== 'boolean') issues.push(error('SCHEMA_INVALID', `${kind}.unset must be boolean.`, `${path}/unset`))
      if (operation.unset === true && isRecord(operation.patch) && Object.keys(operation.patch).length > 0) issues.push(error('SCHEMA_INVALID', `${kind}.patch must be empty when unset is true.`, `${path}/patch`))
      if (operation.unset === true && operation.replace === true) issues.push(error('SCHEMA_INVALID', `${kind} cannot set both replace and unset.`, path))
      break
    case 'component.updateProps': requireRecord('patch'); if (operation.replace !== undefined && typeof operation.replace !== 'boolean') issues.push(error('SCHEMA_INVALID', 'component.updateProps.replace must be boolean.', `${path}/replace`)); break
    case 'group.create': { const group = requireRecord('group'); if (group) { requireStringAt(group, 'id', `${path}/group`, issues); if (!Array.isArray(group.memberIds)) issues.push(error('SCHEMA_INVALID', 'group.create.group.memberIds must be an array.', `${path}/group/memberIds`)); else checkUniqueStrings(group.memberIds, `${path}/group/memberIds`, issues) } break }
    case 'group.delete': requireString('groupId'); break
    case 'group.addMembers': case 'group.removeMembers': requireString('groupId'); requireStringArray('elementIds'); break
    case 'group.move': requireString('groupId'); requireFiniteNumber('dx'); requireFiniteNumber('dy'); break
    case 'group.resize': requireString('groupId'); requireFrame('targetFrame'); if (operation.scaleTextStyle !== undefined && typeof operation.scaleTextStyle !== 'boolean') issues.push(error('SCHEMA_INVALID', 'group.resize.scaleTextStyle must be boolean.', `${path}/scaleTextStyle`)); break
    case 'fact.upsert': { const fact = requireRecord('fact'); if (fact) { requireStringAt(fact, 'id', `${path}/fact`, issues); requireStringAt(fact, 'key', `${path}/fact`, issues); if (!Object.prototype.hasOwnProperty.call(fact, 'value')) issues.push(error('SCHEMA_INVALID', 'fact.upsert.fact.value is required.', `${path}/fact/value`)) } break }
    case 'fact.delete': requireString('factId'); break
    case 'fact.syncReferences': requireString('factId'); requireStringArray('targetElementIds', 1); if (!['replace-display-value', 'update-chart-values'].includes(String(operation.strategy))) issues.push(error('SCHEMA_INVALID', 'fact.syncReferences.strategy is invalid.', `${path}/strategy`)); break
    case 'source.upsert': { const source = requireRecord('source'); if (source) requireStringAt(source, 'id', `${path}/source`, issues); break }
    case 'source.delete': requireString('sourceId'); break
    case 'layout.align': requireStringArray('elementIds', 1); if (!['left', 'center-x', 'right', 'top', 'center-y', 'bottom'].includes(String(operation.alignment))) issues.push(error('SCHEMA_INVALID', 'layout.align.alignment is invalid.', `${path}/alignment`)); if (!['selection', 'slide'].includes(String(operation.reference)) && !nonEmptyString(operation.reference)) issues.push(error('SCHEMA_INVALID', 'layout.align.reference is invalid.', `${path}/reference`)); break
    case 'layout.distribute': requireStringArray('elementIds', 3); if (!['horizontal', 'vertical'].includes(String(operation.axis))) issues.push(error('SCHEMA_INVALID', 'layout.distribute.axis is invalid.', `${path}/axis`)); if (!['centers', 'gaps'].includes(String(operation.mode))) issues.push(error('SCHEMA_INVALID', 'layout.distribute.mode is invalid.', `${path}/mode`)); break
  }
}

function validatePreconditions(value: unknown, basePath: string, issues: ValidationIssue[]) {
  if (!Array.isArray(value)) { issues.push(error('SCHEMA_INVALID', 'Operation preconditions must be an array.', `${basePath}/preconditions`)); return }
  const kinds = new Set(['revision-equals', 'slide-exists', 'element-exists', 'semantic-key-resolves', 'fact-exists', 'path-hash-equals', 'path-value-equals'])
  for (const [index, raw] of value.entries()) {
    const precondition = asRecord(raw)
    if (!precondition || !kinds.has(String(precondition.kind))) { issues.push(error('SCHEMA_INVALID', 'Precondition kind is invalid.', `${basePath}/preconditions/${index}`)); continue }
    const path = `${basePath}/preconditions/${index}`
    if (['revision-equals', 'fact-exists'].includes(String(precondition.kind))) requireStringAt(precondition, String(precondition.kind) === 'revision-equals' ? 'revision' : 'factId', path, issues)
    if (precondition.kind === 'slide-exists') requireStringAt(precondition, 'slideId', path, issues)
    if (precondition.kind === 'element-exists') { requireStringAt(precondition, 'slideId', path, issues); requireStringAt(precondition, 'elementId', path, issues) }
    if (precondition.kind === 'semantic-key-resolves') { requireStringAt(precondition, 'slideId', path, issues); requireStringAt(precondition, 'semanticKey', path, issues); if (precondition.elementId !== undefined) requireStringAt(precondition, 'elementId', path, issues) }
    if (precondition.kind === 'path-hash-equals') { requireStringAt(precondition, 'path', path, issues); requireStringAt(precondition, 'hash', path, issues) }
    if (precondition.kind === 'path-value-equals') requireStringAt(precondition, 'path', path, issues)
  }
}

function checkUniqueStrings(values: unknown[], path: string, issues: ValidationIssue[]) {
  const seen = new Set<string>()
  for (const [index, value] of values.entries()) {
    if (!nonEmptyString(value)) issues.push(error('SCHEMA_INVALID', 'Array entries must be non-empty strings.', `${path}/${index}`))
    else if (seen.has(value)) issues.push(error('SCHEMA_INVALID', `Duplicate array entry ${value}.`, `${path}/${index}`))
    else seen.add(value)
  }
}

function requireStringAt(record: Record<string, unknown>, field: string, path: string, issues: ValidationIssue[]) {
  if (!nonEmptyString(record[field])) issues.push(error('SCHEMA_INVALID', `${field} must be a non-empty string.`, `${path}/${field}`))
}

function validateUnsetPair(record: Record<string, unknown>, field: string, valid: (value: unknown) => boolean, path: string, issues: ValidationIssue[]) {
  if (record.unset !== undefined && typeof record.unset !== 'boolean') issues.push(error('SCHEMA_INVALID', 'unset must be boolean when present.', `${path}/unset`))
  if (record.unset === true) {
    if (Object.prototype.hasOwnProperty.call(record, field)) issues.push(error('SCHEMA_INVALID', `${field} must be omitted when unset is true.`, `${path}/${field}`))
  } else if (!valid(record[field])) issues.push(error('SCHEMA_INVALID', `${field} is required unless unset is true.`, `${path}/${field}`))
}

function requireFiniteNumberAt(record: Record<string, unknown>, field: string, path: string, issues: ValidationIssue[]) {
  if (!finite(record[field])) issues.push(error('SCHEMA_INVALID', `${field} must be finite.`, `${path}/${field}`))
}

function asRecord(value: unknown): Record<string, unknown> | undefined { return isRecord(value) ? value : undefined }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function nonEmptyString(value: unknown): value is string { return typeof value === 'string' && value.length > 0 }

export function validateTextOverflow(document: PpteDocument, slideId: string, element: TextElement): ValidationIssue[] {
  const text = textContent(element)
  const style = effectiveTextStyle(document, element)
  const padding = element.boxStyle?.padding && typeof element.boxStyle.padding === 'object' ? element.boxStyle.padding : undefined
  const width = finitePositiveNumber(element.frame?.width) ? element.frame.width : 1
  const height = finiteNonNegativeNumber(element.frame?.height) ? element.frame.height : 0
  const availableWidth = Math.max(1, width - (padding?.left ?? 0) - (padding?.right ?? 0))
  const estimatedLineWidth = Math.max(1, availableWidth / Math.max(style.fontSize, 1))
  const estimatedLines = text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil([...line].length / estimatedLineWidth)), 0)
  const lineHeight = style.lineHeight ?? 1.2
  const availableHeight = Math.max(0, height - (padding?.top ?? 0) - (padding?.bottom ?? 0))
  const estimatedHeight = estimatedLines * style.fontSize * (finitePositiveNumber(lineHeight) ? lineHeight : 1.2)
  if (estimatedHeight <= availableHeight + 0.001) return []
  return [withErrorSemantics({
    code: 'TEXT_OVERFLOW',
    severity: 'warning',
    message: `Text ${element.id} exceeds its fixed frame; font size and frame were not changed implicitly.`,
    slideId,
    elementId: element.id,
    recovery: 'Shorten text, resize the text box, explicitly fit the font, or change overflow policy.',
  })]
}

/**
 * Inspect the complete text content, including supplementary-plane characters.
 * Portable editing passes `strict: true`: an undeclared font is an error, not a
 * reason to let the browser silently select a fallback font.
 */
export function inspectGlyphCoverage(document: PpteDocument, element: TextElement, addedText?: string, options: { strict?: boolean } = {}): GlyphCoverageReport {
  const text = addedText ?? textContent(element)
  const fonts = Object.values(document.fonts ?? {}).filter((font): font is FontAsset => Boolean(font) && typeof font === 'object')
  const style = effectiveTextStyle(document, element)
  const candidate = fonts.find((font) => font.family === style.fontFamily)
  if (!candidate) return { elementId: element.id, fontFamily: style.fontFamily, covered: !options.strict, missingCodePoints: [], source: 'unresolved' }
  const codePoints = [...new Set([...text].map((character) => character.codePointAt(0) ?? 0))]
  if (!Array.isArray(candidate.glyphCoverage) || candidate.glyphCoverage.length === 0) {
    const systemSafe = candidate.source === 'system' && candidate.editableSafe === true
    return { elementId: element.id, fontFamily: candidate.family, fontId: candidate.id, covered: systemSafe || !options.strict, missingCodePoints: systemSafe || !options.strict ? [] : codePoints, source: systemSafe ? 'system-safe' : 'unsafe' }
  }
  const missing = codePoints.filter((codePoint) => !candidate.glyphCoverage?.some((range) => codePoint >= range.start && codePoint <= range.end))
  const unsafe = options.strict && (candidate.editableSafe !== true || candidate.source === 'fallback')
  return { elementId: element.id, fontFamily: candidate.family, fontId: candidate.id, covered: missing.length === 0 && !unsafe, missingCodePoints: missing, source: unsafe ? 'unsafe' : 'declared' }
}

export function checkGlyphCoverage(document: PpteDocument, element: TextElement, addedText?: string, options: { strict?: boolean } = {}): ValidationIssue[] {
  const report = inspectGlyphCoverage(document, element, addedText, options)
  if (report.covered) return []
  if (report.source === 'unresolved') return [withErrorSemantics({ code: 'FONT_GLYPH_MISSING', severity: 'error', message: `Font ${report.fontFamily} has no explicit coverage declaration for portable editing.`, elementId: element.id, recovery: 'Choose a declared system-safe font or embed a font with glyph coverage.' })]
  if (report.source === 'unsafe') return [withErrorSemantics({ code: 'FONT_GLYPH_MISSING', severity: 'error', message: `Font ${report.fontFamily} is not marked editableSafe for portable editing.`, elementId: element.id, recovery: 'Choose a font with declared editable coverage.' })]
  return [withErrorSemantics({ code: 'FONT_GLYPH_MISSING', severity: 'error', message: `Font ${report.fontFamily} does not cover ${report.missingCodePoints.map((codePoint) => `U+${codePoint.toString(16).toUpperCase()}`).join(', ')}.`, elementId: element.id, recovery: 'Choose a compatible font, add coverage, or cancel the edit.' })]
}

export function effectiveTextStyle(document: PpteDocument, element: TextElement): ResolvedTextStyle {
  return resolveTextStyle(document, element)
}

/** Resolve preset → typed override → token values for any supported element. */
export function resolveEffectiveStyle(document: PpteDocument, element: Element): Record<string, unknown> {
  if (element.type === 'text') return resolveTextStyle(document, element) as unknown as Record<string, unknown>
  if (element.type === 'shape') return resolveStyle(presetFor(document, element), styleOverrides(element), document)
  if (element.type === 'image') return resolveStyle(presetFor(document, element), styleOverrides(element), document)
  if (element.type === 'chart') return resolveStyle(presetFor(document, element), styleOverrides(element), document)
  return {}
}

/** Compute the derived Style Preset debt metric without changing the document. */
export function computeOverrideDebt(document: PpteDocument): OverrideDebtReport {
  let overriddenFields = 0
  let controllableFields = 0
  let keyElementCount = 0
  const entries: OverrideDebtEntry[] = []
  for (const [slideId, slide] of Object.entries(document.slides ?? {})) {
    if (!slide || typeof slide !== 'object') continue
    for (const element of Object.values(slide.elements ?? {})) {
      if (!element || typeof element !== 'object') continue
      if (!KEY_ROLES.has(element.role ?? '') || !hasStyleBinding(element)) continue
      keyElementCount += 1
      const preset = presetFor(document, element)
      const presetFields = Object.keys(preset ?? {})
      controllableFields += presetFields.length
      const overrides = styleOverrides(element)
      const fields = Object.keys(overrides).filter((field) => presetFields.includes(field) || presetFields.length === 0)
      overriddenFields += fields.length
      if (fields.length) entries.push({ slideId, elementId: element.id, semanticKey: element.semanticKey, fields: fields.sort() })
    }
  }
  return {
    overrideDebt: controllableFields === 0 ? 0 : Math.min(1, overriddenFields / controllableFields),
    overriddenFields,
    controllableFields,
    keyElementCount,
    entries,
  }
}

export function diagnoseOverrideDebt(document: PpteDocument, warningThreshold = 0.25): ValidationIssue[] {
  const report = computeOverrideDebt(document)
  if (report.overrideDebt <= warningThreshold || report.overriddenFields === 0) return []
  return [withErrorSemantics({
    code: 'STYLE_OVERRIDE_DEBT',
    severity: 'warning',
    message: `Style override debt is ${(report.overrideDebt * 100).toFixed(1)}% across ${report.keyElementCount} key elements.`,
    recovery: 'Reset local overrides, reattach the element to a preset, or save the style as a new preset.',
  })]
}

export function validateStyleBindings(document: PpteDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const theme = document.theme && typeof document.theme === 'object' ? document.theme : undefined
  const presets = theme?.presets && typeof theme.presets === 'object' ? theme.presets : undefined
  if (!presets) issues.push({ code: 'STYLE_THEME_INVALID', severity: 'error', message: 'Theme presets are required for Stable Core style resolution.', path: '/theme/presets', recovery: 'Provide text, shape, image, and chart preset registries.' })
  for (const [slideId, slide] of Object.entries(document.slides ?? {})) {
    if (!slide || typeof slide !== 'object') continue
    for (const element of Object.values(slide.elements ?? {})) {
      if (!element || typeof element !== 'object') continue
      if (!hasStyleBinding(element)) continue
      const style = element.style
      if (!style) continue
      const category = element.type
      const bucket = presets?.[category]
      const preset = bucket && typeof bucket === 'object' ? bucket[style.styleRef] : undefined
      if (!preset) issues.push({ code: 'STYLE_PRESET_MISSING', severity: 'error', message: `Style preset ${style.styleRef} does not exist for ${category}.`, slideId, elementId: element.id, recovery: 'Choose an existing preset or create one through theme.updatePreset.' })
      issues.push(...missingStyleTokenIssues(document, preset, slideId, element.id))
      issues.push(...missingStyleTokenIssues(document, style.overrides, slideId, element.id))
      const allowed: readonly string[] = category === 'text' ? TEXT_STYLE_FIELDS : category === 'shape' ? SHAPE_STYLE_FIELDS : category === 'image' ? IMAGE_STYLE_FIELDS : CHART_STYLE_FIELDS
      for (const [field, value] of Object.entries(style.overrides ?? {})) {
        if (!allowed.includes(field as never)) {
          issues.push({ code: 'STYLE_OVERRIDE_INVALID', severity: 'error', message: `Style override ${field} is not allowed for ${category}.`, slideId, elementId: element.id, path: `/slides/${escapePointer(slideId)}/elements/${escapePointer(element.id)}/style/overrides/${escapePointer(field)}` })
          continue
        }
        if (!validStyleField(element.type, field, value)) issues.push({ code: 'STYLE_OVERRIDE_INVALID', severity: 'error', message: `Style override ${field} has an invalid typed value.`, slideId, elementId: element.id })
      }
    }
  }
  return normalizeIssues(issues)
}

function resolveTextStyle(document: PpteDocument, element: TextElement): ResolvedTextStyle {
  const theme = document.theme && typeof document.theme === 'object' ? document.theme : undefined
  const preset = theme?.presets?.text?.[element.style?.styleRef ?? '']
  const base: Partial<TextStyle> = preset ?? {
    fontFamily: { kind: 'token', token: 'font.body' },
    fontSize: 28,
    color: { kind: 'token', token: 'color.text.primary' },
  }
  const merged = { ...base, ...(element.style?.overrides ?? {}) } as TextStyle
  const tokens = theme?.tokens
  return {
    ...merged,
    fontSize: finitePositive(merged.fontSize) ? merged.fontSize : 28,
    lineHeight: finitePositive(merged.lineHeight) ? merged.lineHeight : undefined,
    fontFamily: resolveToken(merged.fontFamily, tokens?.fontFamilies, 'Inter'),
    color: resolveToken(merged.color, tokens?.colors, '#111827'),
  }
}

function resolveStyle<T extends Record<string, unknown> | undefined>(preset: T, overrides: Record<string, unknown> | undefined, document: PpteDocument): Record<string, unknown> {
  const merged = { ...(preset ?? {}), ...(overrides ?? {}) }
  return resolveNestedTokens(merged, document) as Record<string, unknown>
}

function resolveNestedTokens(value: unknown, document: PpteDocument): unknown {
  if (Array.isArray(value)) return value.map((item) => resolveNestedTokens(item, document))
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (record.kind === 'token' && typeof record.token === 'string') return resolveAnyToken(document, record.token)
  return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, resolveNestedTokens(child, document)]))
}

function resolveAnyToken(document: PpteDocument, token: string): unknown {
  const tokens = document.theme?.tokens
  return tokens?.colors?.[token]
    ?? tokens?.fontFamilies?.[token]
    ?? tokens?.fontSizes?.[token]
    ?? tokens?.spacing?.[token]
    ?? tokens?.radii?.[token]
    ?? tokens?.shadows?.[token]
    ?? token
}

function missingStyleTokenIssues(document: PpteDocument, value: unknown, slideId: string, elementId: string): ValidationIssue[] {
  const missing = new Set<string>()
  const visit = (current: unknown) => {
    if (Array.isArray(current)) { current.forEach(visit); return }
    if (!current || typeof current !== 'object') return
    const record = current as Record<string, unknown>
    if (record.kind === 'token' && typeof record.token === 'string') {
      if (!tokenExists(document, record.token)) missing.add(record.token)
      return
    }
    Object.values(record).forEach(visit)
  }
  visit(value)
  return [...missing].map((token) => withErrorSemantics({ code: 'STYLE_TOKEN_MISSING', severity: 'error' as const, message: `Style token ${token} is not defined in the active theme.`, slideId, elementId, recovery: 'Define the token or select a preset using existing theme tokens.' }))
}

function tokenExists(document: PpteDocument, token: string): boolean {
  const tokens = document.theme?.tokens
  return Boolean(tokens && [tokens.colors, tokens.fontFamilies, tokens.fontSizes, tokens.spacing, tokens.radii, tokens.shadows].some((bucket) => bucket && Object.prototype.hasOwnProperty.call(bucket, token)))
}

function resolveToken<T>(value: ValueOrToken<T> | undefined, bucket: Record<string, T> | undefined, fallback: T): T {
  if (!value) return fallback
  return value.kind === 'value' ? value.value : bucket?.[value.token] ?? fallback
}

function hasStyleBinding(element: Element): element is Extract<Element, { type: 'text' | 'shape' | 'image' | 'chart' }> {
  return element.type === 'text' || element.type === 'shape' || element.type === 'image' || element.type === 'chart'
}

function styleOverrides(element: Element): Record<string, unknown> {
  return hasStyleBinding(element) ? (element.style?.overrides as Record<string, unknown> | undefined) ?? {} : {}
}

function presetFor(document: PpteDocument, element: Element): Record<string, unknown> | undefined {
  if (!hasStyleBinding(element)) return undefined
  if (!element.style) return undefined
  const bucket = document.theme?.presets?.[element.type]
  return bucket?.[element.style.styleRef] as Record<string, unknown> | undefined
}

function validStyleField(type: Element['type'], field: string, value: unknown): boolean {
  if (type === 'text') {
    if (field === 'fontFamily') return validValueOrToken(value, 'string')
    if (field === 'color') return validValueOrToken(value, 'color')
    if (field === 'fontSize' || field === 'lineHeight') return finitePositive(value)
    if (field === 'fontWeight') return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 1000
    if (field === 'letterSpacing') return finite(value)
    if (field === 'verticalAlign') return value === 'top' || value === 'middle' || value === 'bottom'
    if (field === 'direction') return value === 'ltr' || value === 'rtl' || value === 'auto'
  }
  if ((type === 'shape' || type === 'image') && field === 'radius') return finiteNonNegative(value)
  if (type === 'shape' && field === 'fill') return validPaint(value)
  if ((type === 'shape' || type === 'image') && (field === 'stroke' || field === 'border')) return validStroke(value)
  if ((type === 'shape' || type === 'image') && field === 'shadow') return validShadow(value)
  if (type === 'chart') {
    if (field === 'palette') return Array.isArray(value) && value.every((item) => validValueOrToken(item, 'color'))
    if (field === 'axisColor' || field === 'labelColor' || field === 'gridColor') return validValueOrToken(value, 'color')
    if (field === 'lineWidth') return finitePositive(value)
    if (field === 'cornerRadius') return finiteNonNegative(value)
  }
  return false
}

function validValueOrToken(value: unknown, valueType: 'string' | 'color'): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.kind === 'token') return hasOnlyKeys(record, ['kind', 'token']) && typeof record.token === 'string' && record.token.length > 0
  if (record.kind !== 'value') return false
  return hasOnlyKeys(record, ['kind', 'value']) && (valueType === 'string' ? typeof record.value === 'string' : typeof record.value === 'string' && /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(record.value))
}

function validPaint(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.kind === 'none') return hasOnlyKeys(record, ['kind'])
  if (record.kind === 'solid') return hasOnlyKeys(record, ['kind', 'color', 'opacity']) && validValueOrToken(record.color, 'color') && validOpacity(record.opacity)
  if (record.kind === 'linear-gradient') return hasOnlyKeys(record, ['kind', 'angleDeg', 'stops', 'opacity']) && validOpacity(record.opacity) && Array.isArray(record.stops) && record.stops.length >= 2 && record.stops.every((stop) => Boolean(stop) && typeof stop === 'object' && hasOnlyKeys(stop as Record<string, unknown>, ['offset', 'color']) && finiteNonNegative((stop as Record<string, unknown>).offset) && Number((stop as Record<string, unknown>).offset) <= 1 && validValueOrToken((stop as Record<string, unknown>).color, 'color'))
  return false
}

function validStroke(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return hasOnlyKeys(record, ['color', 'width', 'opacity', 'dash', 'lineCap', 'lineJoin']) && validValueOrToken(record.color, 'color') && finiteNonNegative(record.width) && validOpacity(record.opacity)
    && (record.dash === undefined || (Array.isArray(record.dash) && record.dash.every((segment) => finiteNonNegative(segment))))
    && (record.lineCap === undefined || ['butt', 'round', 'square'].includes(String(record.lineCap)))
    && (record.lineJoin === undefined || ['miter', 'round', 'bevel'].includes(String(record.lineJoin)))
}

function validShadow(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return hasOnlyKeys(record, ['color', 'offsetX', 'offsetY', 'blur', 'spread', 'opacity']) && validValueOrToken(record.color, 'color') && finite(record.offsetX) && finite(record.offsetY) && finiteNonNegative(record.blur) && (record.spread === undefined || finite(record.spread)) && validOpacity(record.opacity)
}

function validOpacity(value: unknown): boolean { return value === undefined || (finite(value) && value >= 0 && value <= 1) }

function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function finitePositive(value: unknown): value is number { return finite(value) && value > 0 }
function finiteNonNegative(value: unknown): value is number { return finite(value) && value >= 0 }
function finitePositiveNumber(value: unknown): value is number { return finite(value) && value > 0 }
function finiteNonNegativeNumber(value: unknown): value is number { return finite(value) && value >= 0 }
function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean { return Object.keys(value).every((key) => allowed.includes(key)) }

export function textContent(element: TextElement): string {
  if (!element.content || !Array.isArray(element.content.paragraphs)) return ''
  return element.content.paragraphs.map((paragraph) => Array.isArray(paragraph?.runs) ? paragraph.runs.map((run) => typeof run?.text === 'string' ? run.text : '').join('') : '').join('\n')
}

export function invariantHash(document: PpteDocument, selector: (element: Element) => unknown): string {
  return canonicalHash(Object.values(document.slides).flatMap((slide) => Object.values(slide.elements).map(selector)))
}

function error(code: string, message: string, path: string): ValidationIssue {
  return withErrorSemantics({ code, severity: 'error', message, path })
}
function normalizeIssues(issues: ValidationIssue[]): ValidationIssue[] { return dedupeIssues(issues).map(withErrorSemantics) }
function dedupeIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>()
  return issues.filter((item) => {
    const key = `${item.code}|${item.message}|${item.path ?? ''}|${item.slideId ?? ''}|${item.elementId ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
function escapePointer(value: string): string { return value.replaceAll('~', '~0').replaceAll('/', '~1') }

export type { FontAsset }
