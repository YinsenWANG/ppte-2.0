import { canonicalHash } from '../../canonical-json/src/index.js'
import type {
  ChangeContract,
  Element,
  Operation,
  OperationKind,
  PpteDocument,
  Precondition,
  ScopePermission,
  Transaction,
  TransactionScope,
  ValidationIssue,
} from '../../schema/src/index.js'
import type { StructuralDiff } from '../../schema/src/index.js'

export interface OperationImpact {
  kind: OperationKind
  slideIds: string[]
  elementIds: string[]
  semanticKeys: string[]
  paths: string[]
  permissions: ScopePermission[]
  inserts: number
  deletes: number
  replacedAssets: number
}

export function analyzeOperation(document: PpteDocument, operation: Operation): OperationImpact {
  const slideIds = new Set<string>()
  const elementIds = new Set<string>()
  const semanticKeys = new Set<string>()
  const paths = new Set<string>()
  const permissions = new Set<ScopePermission>()
  let inserts = 0
  let deletes = 0
  let replacedAssets = 0

  const addElement = (slideId: string, elementId: string, path = `/slides/${pointer(slideId)}/elements/${pointer(elementId)}`, semanticKey?: string) => {
    slideIds.add(slideId)
    elementIds.add(elementId)
    paths.add(path)
    const element = document.slides[slideId]?.elements[elementId]
    if (element?.semanticKey ?? semanticKey) semanticKeys.add((element?.semanticKey ?? semanticKey) as string)
  }
  const addGroupMembers = (slideId: string, groupId: string) => {
    slideIds.add(slideId)
    for (const memberId of document.slides[slideId]?.groups?.[groupId]?.memberIds ?? []) addElement(slideId, memberId)
  }

  switch (operation.kind) {
    case 'document.updateMetadata':
      permissions.add('structure')
      paths.add('/metadata')
      break
    case 'theme.replace':
      permissions.add('theme')
      paths.add('/theme')
      break
    case 'theme.setToken':
      permissions.add('theme')
      paths.add(`/theme/tokens/${pointer(operation.category)}/${pointer(operation.token)}`)
      break
    case 'theme.updatePreset':
      permissions.add('theme')
      paths.add(`/theme/presets/${pointer(operation.category)}/${pointer(operation.presetId)}`)
      break
    case 'slide.insert':
      permissions.add('structure')
      slideIds.add(operation.slide.id)
      paths.add('/slideOrder')
      inserts += Object.keys(operation.slide.elements).length
      break
    case 'slide.delete':
      permissions.add('structure')
      slideIds.add(operation.slideId)
      paths.add(`/slides/${pointer(operation.slideId)}`)
      deletes += Object.keys(document.slides[operation.slideId]?.elements ?? {}).length
      break
    case 'slide.move':
      permissions.add('structure')
      slideIds.add(operation.slideId)
      paths.add('/slideOrder')
      break
    case 'slide.update':
      permissions.add('structure')
      slideIds.add(operation.slideId)
      paths.add(`/slides/${pointer(operation.slideId)}`)
      break
    case 'slide.setReadingOrder':
      permissions.add('structure')
      slideIds.add(operation.slideId)
      paths.add(`/slides/${pointer(operation.slideId)}/readingOrder`)
      break
    case 'slide.setProtectedAnchors':
      permissions.add('structure')
      slideIds.add(operation.slideId)
      paths.add(`/slides/${pointer(operation.slideId)}/protectedAnchors`)
      break
    case 'element.insert':
      permissions.add('structure')
      addElement(operation.slideId, operation.element.id, `/slides/${pointer(operation.slideId)}/elements/${pointer(operation.element.id)}`, operation.element.semanticKey)
      inserts += 1
      break
    case 'element.delete':
      permissions.add('structure')
      addElement(operation.slideId, operation.elementId)
      deletes += 1
      break
    case 'element.duplicate':
      permissions.add('structure')
      addElement(operation.slideId, operation.sourceElementId)
      addElement(operation.slideId, operation.newElementId, `/slides/${pointer(operation.slideId)}/elements/${pointer(operation.newElementId)}`)
      inserts += 1
      break
    case 'element.move':
      permissions.add('geometry')
      addElement(operation.slideId, operation.elementId, `/slides/${pointer(operation.slideId)}/elements/${pointer(operation.elementId)}/frame`)
      break
    case 'element.resize':
      permissions.add('geometry')
      addElement(operation.slideId, operation.elementId, `/slides/${pointer(operation.slideId)}/elements/${pointer(operation.elementId)}/frame`)
      break
    case 'element.rotate':
      permissions.add('geometry')
      addElement(operation.slideId, operation.elementId, `/slides/${pointer(operation.slideId)}/elements/${pointer(operation.elementId)}/rotationDeg`)
      break
    case 'element.reorder':
      permissions.add('structure')
      addElement(operation.slideId, operation.elementId, `/slides/${pointer(operation.slideId)}/rootOrder`)
      break
    case 'element.setVisibility':
      permissions.add('structure')
      addElement(operation.slideId, operation.elementId, `/slides/${pointer(operation.slideId)}/elements/${pointer(operation.elementId)}/visible`)
      break
    case 'element.setLocked':
      permissions.add('structure')
      addElement(operation.slideId, operation.elementId, `/slides/${pointer(operation.slideId)}/elements/${pointer(operation.elementId)}/locked`)
      break
    case 'element.setEditPolicy':
      permissions.add('structure')
      addElement(operation.slideId, operation.elementId, `/slides/${pointer(operation.slideId)}/elements/${pointer(operation.elementId)}/editPolicy`)
      break
    case 'element.setSemanticKey':
      permissions.add('structure')
      addElement(operation.slideId, operation.elementId, `/slides/${pointer(operation.slideId)}/elements/${pointer(operation.elementId)}/semanticKey`)
      break
    case 'element.setStyleRef':
      permissions.add('style')
      addElement(operation.slideId, operation.elementId, `/slides/${pointer(operation.slideId)}/elements/${pointer(operation.elementId)}/style/styleRef`)
      break
    case 'element.updateStyleOverrides':
      permissions.add('style')
      addElement(operation.slideId, operation.elementId, `/slides/${pointer(operation.slideId)}/elements/${pointer(operation.elementId)}/style/overrides`)
      break
    case 'element.clearStyleOverrides':
      permissions.add('style')
      addElement(operation.slideId, operation.elementId, `/slides/${pointer(operation.slideId)}/elements/${pointer(operation.elementId)}/style/overrides`)
      break
    case 'text.replaceContent':
      permissions.add('content')
      addElement(operation.slideId, operation.elementId, `/slides/${pointer(operation.slideId)}/elements/${pointer(operation.elementId)}/content`)
      break
    case 'text.setOverflowPolicy':
      permissions.add('style')
      addElement(operation.slideId, operation.elementId, `/slides/${pointer(operation.slideId)}/elements/${pointer(operation.elementId)}/overflowPolicy`)
      break
    case 'text.fitByReducingFont':
      permissions.add('style')
      addElement(operation.slideId, operation.elementId, `/slides/${pointer(operation.slideId)}/elements/${pointer(operation.elementId)}/style/overrides/fontSize`)
      break
    case 'text.resizeBox':
      permissions.add('geometry')
      addElement(operation.slideId, operation.elementId, `/slides/${pointer(operation.slideId)}/elements/${pointer(operation.elementId)}/frame`)
      break
    case 'image.replaceAsset':
      permissions.add('assets')
      addElement(operation.slideId, operation.elementId, `/slides/${pointer(operation.slideId)}/elements/${pointer(operation.elementId)}/assetId`)
      replacedAssets += 1
      break
    case 'image.setCrop':
      permissions.add('assets')
      addElement(operation.slideId, operation.elementId, `/slides/${pointer(operation.slideId)}/elements/${pointer(operation.elementId)}/crop`)
      break
    case 'image.setFocalPoint':
      permissions.add('assets')
      addElement(operation.slideId, operation.elementId, `/slides/${pointer(operation.slideId)}/elements/${pointer(operation.elementId)}/focalPoint`)
      break
    case 'shape.updateStyle':
      permissions.add('style')
      addElement(operation.slideId, operation.elementId, `/slides/${pointer(operation.slideId)}/elements/${pointer(operation.elementId)}/style`)
      break
    case 'chart.replaceData':
    case 'chart.updateEncoding':
    case 'chart.updateOptions':
    case 'chart.updateStyle':
    case 'component.updateProps':
      permissions.add(operation.kind.startsWith('chart.') ? 'content' : 'content')
      addElement(operation.slideId, operation.elementId)
      break
    case 'group.create':
      permissions.add('structure')
      slideIds.add(operation.slideId)
      paths.add(`/slides/${pointer(operation.slideId)}/groups/${pointer(operation.group.id)}`)
      for (const elementId of operation.group.memberIds) addElement(operation.slideId, elementId)
      break
    case 'group.delete':
      permissions.add('structure')
      slideIds.add(operation.slideId)
      paths.add(`/slides/${pointer(operation.slideId)}/groups/${pointer(operation.groupId)}`)
      addGroupMembers(operation.slideId, operation.groupId)
      break
    case 'group.addMembers':
    case 'group.removeMembers':
      permissions.add('structure')
      slideIds.add(operation.slideId)
      paths.add(`/slides/${pointer(operation.slideId)}/groups/${pointer(operation.groupId)}/memberIds`)
      for (const elementId of operation.elementIds) addElement(operation.slideId, elementId)
      break
    case 'group.move':
      permissions.add('geometry')
      addGroupMembers(operation.slideId, operation.groupId)
      break
    case 'group.resize':
      permissions.add('geometry')
      addGroupMembers(operation.slideId, operation.groupId)
      if (operation.scaleTextStyle) {
        permissions.add('style')
        for (const elementId of document.slides[operation.slideId]?.groups?.[operation.groupId]?.memberIds ?? []) {
          const element = document.slides[operation.slideId]?.elements[elementId]
          if (element?.type === 'text') paths.add(`/slides/${pointer(operation.slideId)}/elements/${pointer(elementId)}/style/overrides/fontSize`)
        }
      }
      break
    case 'fact.upsert':
      permissions.add('facts')
      paths.add(`/facts/${pointer(operation.fact.id)}`)
      break
    case 'fact.delete':
      permissions.add('facts')
      paths.add(`/facts/${pointer(operation.factId)}`)
      break
    case 'fact.syncReferences':
      permissions.add('facts')
      paths.add(`/facts/${pointer(operation.factId)}`)
      for (const elementId of operation.targetElementIds) {
        for (const slideId of document.slideOrder) if (document.slides[slideId].elements[elementId]) addElement(slideId, elementId)
      }
      break
    case 'source.upsert':
      permissions.add('sources')
      paths.add(`/sources/${pointer(operation.source.id)}`)
      break
    case 'source.delete':
      permissions.add('sources')
      paths.add(`/sources/${pointer(operation.sourceId)}`)
      break
    case 'layout.align':
    case 'layout.distribute':
      permissions.add('geometry')
      slideIds.add(operation.slideId)
      for (const elementId of operation.elementIds) addElement(operation.slideId, elementId)
      break
  }
  return { kind: operation.kind, slideIds: [...slideIds], elementIds: [...elementIds], semanticKeys: [...semanticKeys], paths: [...paths], permissions: [...permissions], inserts, deletes, replacedAssets }
}

export function enforceChangeContract(
  before: PpteDocument,
  after: PpteDocument,
  transaction: Transaction,
  diff: StructuralDiff,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const contract = transaction.changeContract
  const scope = transaction.scope
  const impacts = transaction.operations.map((operation) => analyzeOperation(before, operation))
  const allElements = new Set(impacts.flatMap((impact) => impact.elementIds))
  const allSlides = new Set(impacts.flatMap((impact) => impact.slideIds))
  const paths = new Set(impacts.flatMap((impact) => impact.paths))
  const permissions = new Set(impacts.flatMap((impact) => impact.permissions))

  for (const impact of impacts) {
    if (contract.allowedOperationKinds && !contract.allowedOperationKinds.includes(impact.kind)) {
      issues.push(issue('CHANGE_KIND_NOT_ALLOWED', `Operation ${impact.kind} is outside the Change Contract.`))
    }
    for (const permission of impact.permissions) {
      if (!scope.permissions.includes(permission)) issues.push(issue('SCOPE_VIOLATION', `Operation ${impact.kind} requires permission ${permission}.`))
    }
    if (impact.inserts > 0 && scope.allowInsert !== true) issues.push(issue('SCOPE_VIOLATION', 'The transaction attempts to insert an element but insertion is not granted.'))
    if (impact.deletes > 0 && scope.allowDelete !== true) issues.push(issue('SCOPE_VIOLATION', 'The transaction attempts to delete an element but deletion is not granted.'))
    for (const slideId of impact.slideIds) {
      if (scope.slideIds && !scope.slideIds.includes(slideId)) issues.push(issue('SCOPE_VIOLATION', `Slide ${slideId} is outside the transaction scope.`, { slideId }))
    }
    for (const elementId of impact.elementIds) {
      const slideId = findElementSlide(before, elementId)
      if (scope.elementIds && !scope.elementIds.includes(elementId)) issues.push(issue('SCOPE_VIOLATION', `Element ${elementId} is outside the transaction scope.`, { elementId, slideId }))
      if (contract.allowedElementIds && !contract.allowedElementIds.includes(elementId)) issues.push(issue('SCOPE_VIOLATION', `Element ${elementId} is outside the Change Contract.`, { elementId, slideId }))
    }
    for (const semanticKey of impact.semanticKeys) {
      if (scope.semanticKeys && !scope.semanticKeys.includes(semanticKey)) issues.push(issue('SCOPE_VIOLATION', `semanticKey ${semanticKey} is outside the transaction scope.`, { semanticKey }))
      if (contract.allowedSemanticKeys && !contract.allowedSemanticKeys.includes(semanticKey)) issues.push(issue('SCOPE_VIOLATION', `semanticKey ${semanticKey} is outside the Change Contract.`, { semanticKey }))
    }
  }
  if (contract.allowedPaths) {
    for (const path of paths) if (!contract.allowedPaths.some((allowed) => pathMatches(path, allowed))) issues.push(issue('CHANGE_PATH_NOT_ALLOWED', `Path ${path} is outside the Change Contract.`))
  }
  if (contract.maxChangedSlides !== undefined && diff.mutationSummary.changedSlides > contract.maxChangedSlides) issues.push(issue('MUTATION_BUDGET_EXCEEDED', `Changed ${diff.mutationSummary.changedSlides} slides; budget is ${contract.maxChangedSlides}.`))
  if (contract.maxChangedElements !== undefined && diff.mutationSummary.changedElements > contract.maxChangedElements) issues.push(issue('MUTATION_BUDGET_EXCEEDED', `Changed ${diff.mutationSummary.changedElements} elements; budget is ${contract.maxChangedElements}.`))
  if (contract.maxInsertedElements !== undefined && diff.mutationSummary.insertedElements > contract.maxInsertedElements) issues.push(issue('MUTATION_BUDGET_EXCEEDED', `Inserted ${diff.mutationSummary.insertedElements} elements; budget is ${contract.maxInsertedElements}.`))
  if (contract.maxDeletedElements !== undefined && diff.mutationSummary.deletedElements > contract.maxDeletedElements) issues.push(issue('MUTATION_BUDGET_EXCEEDED', `Deleted ${diff.mutationSummary.deletedElements} elements; budget is ${contract.maxDeletedElements}.`))
  if (contract.maxReplacedAssets !== undefined && diff.mutationSummary.replacedAssets > contract.maxReplacedAssets) issues.push(issue('MUTATION_BUDGET_EXCEEDED', `Replaced ${diff.mutationSummary.replacedAssets} assets; budget is ${contract.maxReplacedAssets}.`))

  for (const operation of transaction.operations) {
    const policyIssues = checkEditPolicy(before, operation, transaction.actor.type)
    issues.push(...policyIssues)
  }
  issues.push(...checkInvariants(before, after, contract))
  issues.push(...checkProtectedAnchors(before, after, contract))
  return dedupeIssues(issues)
}

export function checkPreconditions(document: PpteDocument, revision: string, operations: Operation[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const operation of operations) {
    for (const precondition of operation.preconditions ?? []) {
      const failure = checkPrecondition(document, revision, precondition)
      if (failure) issues.push(failure)
    }
  }
  return issues
}

export function checkTransactionScope(scope: TransactionScope): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!scope || typeof scope !== 'object') return [issue('SCOPE_VIOLATION', 'Transaction scope must be an object.')]
  if (!Array.isArray(scope.permissions) || scope.permissions.length === 0) issues.push(issue('SCOPE_VIOLATION', 'A transaction must grant at least one permission.'))
  if (Array.isArray(scope.permissions) && new Set(scope.permissions).size !== scope.permissions.length) issues.push(issue('SCOPE_VIOLATION', 'Transaction permissions must be unique.'))
  if (scope.kind === 'selection' && !scope.elementIds?.length && !scope.semanticKeys?.length) issues.push(issue('SCOPE_VIOLATION', 'Selection scope must name elementIds or semanticKeys.'))
  if (scope.kind === 'slide' && !scope.slideIds?.length) issues.push(issue('SCOPE_VIOLATION', 'Slide scope must name at least one slideId.'))
  if (scope.elementIds && new Set(scope.elementIds).size !== scope.elementIds.length) issues.push(issue('SCOPE_VIOLATION', 'Scope elementIds must be unique.'))
  if (scope.semanticKeys && new Set(scope.semanticKeys).size !== scope.semanticKeys.length) issues.push(issue('SCOPE_VIOLATION', 'Scope semanticKeys must be unique.'))
  if (scope.slideIds && new Set(scope.slideIds).size !== scope.slideIds.length) issues.push(issue('SCOPE_VIOLATION', 'Scope slideIds must be unique.'))
  return issues
}

function checkPrecondition(document: PpteDocument, revision: string, precondition: Precondition): ValidationIssue | undefined {
  switch (precondition.kind) {
    case 'revision-equals':
      return revision !== precondition.revision ? issue('REVISION_CONFLICT', `Precondition expected ${precondition.revision}, current revision is ${revision}.`) : undefined
    case 'slide-exists':
      return document.slides[precondition.slideId] ? undefined : issue('SCHEMA_INVALID', `Precondition slide does not exist: ${precondition.slideId}.`, { slideId: precondition.slideId })
    case 'element-exists':
      return document.slides[precondition.slideId]?.elements[precondition.elementId] ? undefined : issue('SCHEMA_INVALID', `Precondition element does not exist: ${precondition.elementId}.`, { slideId: precondition.slideId, elementId: precondition.elementId })
    case 'semantic-key-resolves': {
      const matches = Object.values(document.slides[precondition.slideId]?.elements ?? {}).filter((element) => element.semanticKey === precondition.semanticKey)
      const found = matches.length === 1 ? matches[0] : undefined
      if (!found || (precondition.elementId && found.id !== precondition.elementId)) return issue('SEMANTIC_LINEAGE_AMBIGUOUS', `Precondition semanticKey does not resolve uniquely: ${precondition.semanticKey}.`, { slideId: precondition.slideId, semanticKey: precondition.semanticKey })
      return undefined
    }
    case 'fact-exists':
      return document.facts?.[precondition.factId] ? undefined : issue('FACT_REFERENCE_MISSING', `Precondition fact does not exist: ${precondition.factId}.`, { factId: precondition.factId })
    case 'path-value-equals': {
      const actual = readPointer(document, precondition.path)
      return canonicalHash(actual) === canonicalHash(precondition.value) ? undefined : issue('REVISION_CONFLICT', `Precondition value does not match at ${precondition.path}.`, { path: precondition.path })
    }
    case 'path-hash-equals': {
      const actual = readPointer(document, precondition.path)
      return canonicalHash(actual) === precondition.hash ? undefined : issue('REVISION_CONFLICT', `Precondition hash does not match at ${precondition.path}.`, { path: precondition.path })
    }
  }
}

function checkEditPolicy(document: PpteDocument, operation: Operation, actorType: Transaction['actor']['type']): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const elementId of analyzeOperation(document, operation).elementIds) {
    const slideId = findElementSlide(document, elementId)
    const element = slideId ? document.slides[slideId].elements[elementId] : undefined
    if (!slideId || !element) continue
    if (element.locked || element.editPolicy?.mode === 'locked') issues.push(issue('EDIT_POLICY_VIOLATION', `Element ${elementId} is locked.`, { slideId, elementId }))
    if (actorType === 'agent' && element.editPolicy?.agentEditable === false) issues.push(issue('EDIT_POLICY_VIOLATION', `Agent editing is disabled for ${elementId}.`, { slideId, elementId }))
    if (element.editPolicy?.mode === 'replace' && operation.kind !== 'image.replaceAsset') issues.push(issue('EDIT_POLICY_VIOLATION', `Only explicit asset replacement is allowed for replace-only element ${elementId}.`, { slideId, elementId }))
    if (element.editPolicy?.lockedFields?.some((lockedPath) => analyzeOperation(document, operation).paths.some((path) => path === `/slides/${pointer(slideId)}/elements/${pointer(elementId)}${lockedPath}` || path.startsWith(`/slides/${pointer(slideId)}/elements/${pointer(elementId)}${lockedPath}/`)))) issues.push(issue('EDIT_POLICY_VIOLATION', `Operation ${operation.kind} touches a locked field on ${elementId}.`, { slideId, elementId }))
  }
  return issues
}

function checkInvariants(before: PpteDocument, after: PpteDocument, contract: ChangeContract): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const preserve = contract.preserve ?? {}
  const beforeElements = allElements(before)
  const afterElements = allElements(after)
  for (const [key, beforeElement] of beforeElements) {
    const afterElement = afterElements.get(key) ?? findReplacement(afterElements, beforeElement)
    if (!afterElement) {
      if (preserve.content === 'preserve' || preserve.data === 'preserve' || preserve.geometry === 'preserve' || preserve.style === 'preserve' || preserve.asset === 'preserve' || preserve.semanticIdentity === 'preserve' || preserve.semanticIdentity === 'allow-replacement') issues.push(issue('CHANGE_INVARIANT_VIOLATION', `Element ${key} was removed while an invariant is preserved.`, { elementId: key }))
      continue
    }
    if (preserve.content === 'preserve' && canonicalHash(contentProjection(beforeElement)) !== canonicalHash(contentProjection(afterElement))) issues.push(issue('CHANGE_INVARIANT_VIOLATION', `Content changed for ${key}.`, { elementId: key }))
    if (preserve.data === 'preserve' && canonicalHash(dataProjection(beforeElement)) !== canonicalHash(dataProjection(afterElement))) issues.push(issue('CHANGE_INVARIANT_VIOLATION', `Data changed for ${key}.`, { elementId: key }))
    if (preserve.style === 'preserve' && canonicalHash(styleProjection(beforeElement)) !== canonicalHash(styleProjection(afterElement))) issues.push(issue('CHANGE_INVARIANT_VIOLATION', `Style changed for ${key}.`, { elementId: key }))
    if (preserve.geometry === 'preserve' && canonicalHash(geometryProjection(beforeElement)) !== canonicalHash(geometryProjection(afterElement))) issues.push(issue('CHANGE_INVARIANT_VIOLATION', `Geometry changed for ${key}.`, { elementId: key }))
    if (preserve.asset === 'preserve' && canonicalHash(assetProjection(beforeElement)) !== canonicalHash(assetProjection(afterElement))) issues.push(issue('CHANGE_INVARIANT_VIOLATION', `Asset changed for ${key}.`, { elementId: key }))
    if (preserve.semanticIdentity === 'preserve' && (beforeElement.id !== afterElement.id || beforeElement.semanticKey !== afterElement.semanticKey)) issues.push(issue('CHANGE_INVARIANT_VIOLATION', `Semantic identity changed for ${key}.`, { elementId: key }))
    if (preserve.semanticIdentity === 'allow-replacement' && afterElement.id !== beforeElement.id && !isLineageReplacement(beforeElement, afterElement)) issues.push(issue('CHANGE_INVARIANT_VIOLATION', `Replacement for ${key} does not carry explicit lineage.`, { elementId: key }))
  }
  if (preserve.readingOrder === 'preserve' && canonicalHash(readingOrderProjection(before)) !== canonicalHash(readingOrderProjection(after))) issues.push(issue('CHANGE_INVARIANT_VIOLATION', 'Reading order changed while it is preserved.', { path: '/slides' }))
  if (preserve.facts === 'preserve' && canonicalHash(before.facts ?? {}) !== canonicalHash(after.facts ?? {})) issues.push(issue('CHANGE_INVARIANT_VIOLATION', 'Facts changed while they are preserved.', { path: '/facts' }))
  return issues
}

function checkProtectedAnchors(before: PpteDocument, after: PpteDocument, contract: ChangeContract): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const [slideId, slide] of Object.entries(before.slides)) {
    for (const anchor of slide.protectedAnchors ?? []) {
      const beforeElement = resolveAnchorElement(before, slideId, anchor)
      const afterElement = resolveAnchorElement(after, slideId, anchor)
      if (!afterElement && anchor.preserve.length > 0) {
        issues.push(issue('PROTECTED_ANCHOR_VIOLATION', 'Protected anchor no longer resolves.', { slideId }))
        continue
      }
      if (!beforeElement || !afterElement) continue
      for (const field of anchor.preserve) {
        const beforeValue = fieldProjection(beforeElement, field)
        const afterValue = fieldProjection(afterElement, field)
        if (canonicalHash(beforeValue) !== canonicalHash(afterValue)) issues.push(issue('PROTECTED_ANCHOR_VIOLATION', `Protected anchor field ${field} changed.`, { slideId, elementId: afterElement.id, semanticKey: afterElement.semanticKey }))
      }
    }
  }
  return issues
}

function resolveAnchorElement(document: PpteDocument, slideId: string, anchor: { target: { kind: string; elementId?: string; semanticKey?: string; factId?: string } }): Element | undefined {
  const slide = document.slides[slideId]
  if (!slide) return undefined
  if (anchor.target.kind === 'element') return slide.elements[anchor.target.elementId ?? '']
  if (anchor.target.kind === 'semantic') return Object.values(slide.elements).find((element) => element.semanticKey === anchor.target.semanticKey)
  if (anchor.target.kind === 'fact') return Object.values(slide.elements).find((element) => element.semanticRefs?.factIds?.includes(anchor.target.factId ?? ''))
  return undefined
}

function fieldProjection(element: Element, field: string): unknown {
  switch (field) {
    case 'content': return contentProjection(element)
    case 'data': return dataProjection(element)
    case 'style': return styleProjection(element)
    case 'geometry': return geometryProjection(element)
    case 'asset': return assetProjection(element)
    default: return undefined
  }
}
function contentProjection(element: Element): unknown {
  return element.type === 'text' ? element.content : undefined
}
function dataProjection(element: Element): unknown {
  return element.type === 'chart' ? element.data : undefined
}
function styleProjection(element: Element): unknown {
  if (element.type === 'text') return { style: element.style, paragraphStyle: element.paragraphStyle, boxStyle: element.boxStyle, overflowPolicy: element.overflowPolicy, opacity: element.opacity }
  if (element.type === 'shape') return { style: element.style, opacity: element.opacity }
  if (element.type === 'image') return { style: element.style, opacity: element.opacity }
  return { opacity: element.opacity }
}
function geometryProjection(element: Element): unknown {
  return { frame: element.frame, rotationDeg: element.rotationDeg, flipX: element.flipX, flipY: element.flipY }
}
function assetProjection(element: Element): unknown {
  return element.type === 'image' ? { assetId: element.assetId, crop: element.crop, focalPoint: element.focalPoint } : undefined
}
function readingOrderProjection(document: PpteDocument): unknown {
  return document.slideOrder.map((slideId) => [slideId, (document.slides[slideId].readingOrder ?? []).map((elementId) => {
    const element = document.slides[slideId].elements[elementId]
    return element?.semanticKey ?? elementId
  })])
}
function allElements(document: PpteDocument): Map<string, Element> {
  const result = new Map<string, Element>()
  for (const slide of Object.values(document.slides)) for (const [elementId, element] of Object.entries(slide.elements)) result.set(elementId, element)
  return result
}
function findReplacement(afterElements: Map<string, Element>, beforeElement: Element): Element | undefined {
  return [...afterElements.values()].find((candidate) => isLineageReplacement(beforeElement, candidate))
}
function isLineageReplacement(beforeElement: Element, candidate: Element): boolean {
  return candidate.provenance?.replacesElementId === beforeElement.id || (Boolean(beforeElement.semanticKey) && candidate.provenance?.sourceSemanticKey === beforeElement.semanticKey)
}
function findElementSlide(document: PpteDocument, elementId: string): string | undefined {
  return document.slideOrder.find((slideId) => Boolean(document.slides[slideId]?.elements[elementId]))
}
function readPointer(root: unknown, path: string): unknown {
  if (!path || path === '/') return root
  let current: unknown = root
  for (const token of path.slice(1).split('/').map(unescapePointer)) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined
    current = Array.isArray(current) ? current[Number(token)] : (current as Record<string, unknown>)[token]
  }
  return current
}
function unescapePointer(value: string): string {
  return value.replaceAll('~1', '/').replaceAll('~0', '~')
}
function pathMatches(path: string, allowed: string): boolean {
  return allowed === path || (allowed.endsWith('/*') && path.startsWith(allowed.slice(0, -1))) || path.startsWith(`${allowed}/`)
}
function pointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}
function issue(code: string, message: string, extra: Partial<ValidationIssue> = {}): ValidationIssue {
  return { code, severity: 'error', message, ...extra }
}
function dedupeIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>()
  return issues.filter((item) => {
    const key = `${item.code}|${item.message}|${item.path ?? ''}|${item.elementId ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
