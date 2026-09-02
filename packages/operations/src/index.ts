import { cloneJson } from '../../canonical-json/src/index.js'
import type {
  Element,
  Frame,
  PpteDocument,
  Slide,
} from '../../schema/src/index.js'

export const WEEK1_2_OPERATION_KINDS = [
  'document.updateMetadata', 'theme.replace', 'theme.setToken', 'theme.updatePreset',
  'slide.insert', 'slide.delete', 'slide.move', 'slide.update', 'slide.setReadingOrder', 'slide.setProtectedAnchors',
  'element.insert', 'element.delete', 'element.duplicate', 'element.move', 'element.resize', 'element.rotate', 'element.reorder', 'element.setVisibility', 'element.setLocked', 'element.setEditPolicy', 'element.setSemanticKey', 'element.setStyleRef', 'element.updateStyleOverrides', 'element.clearStyleOverrides',
  'text.replaceContent', 'text.setOverflowPolicy', 'text.fitByReducingFont', 'text.resizeBox',
  'image.replaceAsset', 'image.setCrop', 'image.setFocalPoint', 'shape.updateStyle',
  'group.create', 'group.delete', 'group.addMembers', 'group.removeMembers', 'group.move', 'group.resize',
  'fact.upsert', 'fact.delete', 'source.upsert', 'source.delete', 'layout.align', 'layout.distribute',
] as const
import type {
  Operation,
  Transaction,
} from '../../schema/src/index.js'

export class OperationApplyError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'OperationApplyError'
    this.code = code
  }
}

export interface AppliedOperation {
  document: PpteDocument
  inverse: Operation[]
}

export interface AppliedTransaction {
  document: PpteDocument
  inverseOperations: Operation[]
}

/** Apply one typed operation to a cloned snapshot. The input is never mutated. */
export function applyOperation(document: PpteDocument, operation: Operation): AppliedOperation {
  const next = cloneJson(document)
  switch (operation.kind) {
    case 'document.updateMetadata': {
      const before = cloneJson(next.metadata)
      next.metadata = operation.replace ? cloneJson(operation.patch) as typeof next.metadata : { ...next.metadata, ...cloneJson(operation.patch) }
      return { document: next, inverse: [op(operation, 'document.updateMetadata', { patch: before, replace: true })] }
    }
    case 'theme.replace': {
      const before = cloneJson(next.theme)
      next.theme = cloneJson(operation.theme)
      return { document: next, inverse: [op(operation, 'theme.replace', { theme: before })] }
    }
    case 'theme.setToken': {
      const bucket = next.theme.tokens[operation.category] as Record<string, unknown>
      const beforeTheme = cloneJson(next.theme)
      bucket[operation.token] = cloneJson(operation.value)
      return { document: next, inverse: [op(operation, 'theme.replace', { theme: beforeTheme })] }
    }
    case 'theme.updatePreset': {
      const bucket = next.theme.presets[operation.category] as Record<string, unknown>
      const had = Object.prototype.hasOwnProperty.call(bucket, operation.presetId)
      const before = bucket[operation.presetId]
      if (operation.remove) delete bucket[operation.presetId]
      else bucket[operation.presetId] = cloneJson(operation.value)
      return {
        document: next,
        inverse: had
          ? [op(operation, 'theme.updatePreset', { category: operation.category, presetId: operation.presetId, value: cloneJson(before) as never })]
          : [op(operation, 'theme.updatePreset', { category: operation.category, presetId: operation.presetId, value: null, remove: true })],
      }
    }
    case 'slide.insert': {
      if (next.slides[operation.slide.id]) throw error('ID_CONFLICT', `Slide already exists: ${operation.slide.id}.`)
      next.slides[operation.slide.id] = cloneJson(operation.slide)
      next.slideOrder.splice(clampIndex(operation.index, next.slideOrder.length), 0, operation.slide.id)
      return { document: next, inverse: [op(operation, 'slide.delete', { slideId: operation.slide.id })] }
    }
    case 'slide.delete': {
      const slide = requireSlide(next, operation.slideId)
      const index = next.slideOrder.indexOf(operation.slideId)
      delete next.slides[operation.slideId]
      if (index >= 0) next.slideOrder.splice(index, 1)
      return { document: next, inverse: [op(operation, 'slide.insert', { slide: slide, index })] }
    }
    case 'slide.move': {
      requireSlide(next, operation.slideId)
      const from = next.slideOrder.indexOf(operation.slideId)
      if (from < 0) throw error('SCHEMA_INVALID', `Slide is not in slideOrder: ${operation.slideId}.`)
      next.slideOrder.splice(from, 1)
      next.slideOrder.splice(clampIndex(operation.index, next.slideOrder.length), 0, operation.slideId)
      return { document: next, inverse: [op(operation, 'slide.move', { slideId: operation.slideId, index: from })] }
    }
    case 'slide.update': {
      const slide = requireSlide(next, operation.slideId)
      const before: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(operation.patch)) {
        before[key] = cloneJson((slide as unknown as Record<string, unknown>)[key])
        ;(slide as unknown as Record<string, unknown>)[key] = cloneJson(value)
      }
      return { document: next, inverse: [op(operation, 'slide.update', { slideId: operation.slideId, patch: before as never })] }
    }
    case 'slide.setReadingOrder': {
      const slide = requireSlide(next, operation.slideId)
      const before = cloneJson(slide.readingOrder ?? [])
      slide.readingOrder = cloneJson(operation.readingOrder)
      return { document: next, inverse: [op(operation, 'slide.setReadingOrder', { slideId: operation.slideId, readingOrder: before })] }
    }
    case 'slide.setProtectedAnchors': {
      const slide = requireSlide(next, operation.slideId)
      const before = cloneJson(slide.protectedAnchors ?? [])
      slide.protectedAnchors = cloneJson(operation.protectedAnchors)
      return { document: next, inverse: [op(operation, 'slide.setProtectedAnchors', { slideId: operation.slideId, protectedAnchors: before })] }
    }
    case 'element.insert': {
      const slide = requireSlide(next, operation.slideId)
      if (slide.elements[operation.element.id]) throw error('ID_CONFLICT', `Element already exists: ${operation.element.id}.`)
      assertRuntimeElement(operation.element)
      slide.elements[operation.element.id] = cloneJson(operation.element)
      slide.rootOrder.splice(clampIndex(operation.index, slide.rootOrder.length), 0, operation.element.id)
      return { document: next, inverse: [op(operation, 'element.delete', { slideId: operation.slideId, elementId: operation.element.id })] }
    }
    case 'element.delete': {
      const slide = requireSlide(next, operation.slideId)
      const element = requireElement(slide, operation.elementId)
      const index = slide.rootOrder.indexOf(operation.elementId)
      const groupMembership = Object.values(slide.groups ?? {}).find((group) => group.memberIds.includes(operation.elementId))
      const groupBefore = groupMembership ? cloneJson(groupMembership) : undefined
      const readingOrderBefore = slide.readingOrder ? cloneJson(slide.readingOrder) : undefined
      delete slide.elements[operation.elementId]
      removeAll(slide.rootOrder, operation.elementId)
      removeAll(slide.readingOrder ?? [], operation.elementId)
      for (const group of Object.values(slide.groups ?? {})) removeAll(group.memberIds, operation.elementId)
      const inverse: Operation[] = [op(operation, 'element.insert', { slideId: operation.slideId, element: element, index })]
      if (groupMembership) {
        // Recreate the relationship to preserve member ordering exactly; an
        // append-only add would turn [body, image] into [image, body].
        inverse.push(op(operation, 'group.delete', { slideId: operation.slideId, groupId: groupMembership.id }))
        inverse.push(op(operation, 'group.create', { slideId: operation.slideId, group: groupBefore! }))
      }
      if (readingOrderBefore) inverse.push(op(operation, 'slide.setReadingOrder', { slideId: operation.slideId, readingOrder: readingOrderBefore }))
      return { document: next, inverse }
    }
    case 'element.duplicate': {
      const slide = requireSlide(next, operation.slideId)
      const source = requireElement(slide, operation.sourceElementId)
      if (slide.elements[operation.newElementId]) throw error('ID_CONFLICT', `Element already exists: ${operation.newElementId}.`)
      assertRuntimeElement(source)
      const duplicate = cloneJson(source)
      duplicate.id = operation.newElementId
      duplicate.frame.x += operation.offset?.x ?? 24
      duplicate.frame.y += operation.offset?.y ?? 24
      if (duplicate.semanticKey) duplicate.semanticKey = uniqueSemanticKey(slide, `${duplicate.semanticKey}.copy`)
      if (duplicate.type === 'text') {
        duplicate.content.paragraphs = duplicate.content.paragraphs.map((paragraph) => ({
          ...paragraph,
          id: `${paragraph.id}.${operation.newElementId}`,
          runs: paragraph.runs.map((run) => ({ ...run, id: `${run.id}.${operation.newElementId}` })),
        }))
      }
      slide.elements[duplicate.id] = duplicate
      const index = clampIndex(operation.index ?? slide.rootOrder.length, slide.rootOrder.length)
      slide.rootOrder.splice(index, 0, duplicate.id)
      return { document: next, inverse: [op(operation, 'element.delete', { slideId: operation.slideId, elementId: duplicate.id })] }
    }
    case 'element.move': {
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      const before = { x: element.frame.x, y: element.frame.y }
      assertFinite(operation.x, operation.y)
      element.frame.x = operation.x
      element.frame.y = operation.y
      return { document: next, inverse: [op(operation, 'element.move', { slideId: operation.slideId, elementId: operation.elementId, ...before })] }
    }
    case 'element.resize': {
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      assertFrame(operation.frame)
      const before = cloneJson(element.frame)
      element.frame = cloneJson(operation.frame)
      return { document: next, inverse: [op(operation, 'element.resize', { slideId: operation.slideId, elementId: operation.elementId, frame: before })] }
    }
    case 'element.rotate': {
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      const before = element.rotationDeg ?? 0
      assertFinite(operation.rotationDeg)
      element.rotationDeg = operation.rotationDeg
      return { document: next, inverse: [op(operation, 'element.rotate', { slideId: operation.slideId, elementId: operation.elementId, rotationDeg: before })] }
    }
    case 'element.reorder': {
      const slide = requireSlide(next, operation.slideId)
      requireElement(slide, operation.elementId)
      const from = slide.rootOrder.indexOf(operation.elementId)
      if (from < 0) throw error('SCHEMA_INVALID', `Element is not in rootOrder: ${operation.elementId}.`)
      slide.rootOrder.splice(from, 1)
      slide.rootOrder.splice(clampIndex(operation.index, slide.rootOrder.length), 0, operation.elementId)
      return { document: next, inverse: [op(operation, 'element.reorder', { slideId: operation.slideId, elementId: operation.elementId, index: from })] }
    }
    case 'element.setVisibility': {
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      const before = element.visible
      element.visible = operation.visible
      return { document: next, inverse: [op(operation, 'element.setVisibility', { slideId: operation.slideId, elementId: operation.elementId, visible: before ?? true })] }
    }
    case 'element.setLocked': {
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      const before = element.locked
      element.locked = operation.locked
      return { document: next, inverse: [op(operation, 'element.setLocked', { slideId: operation.slideId, elementId: operation.elementId, locked: before ?? false })] }
    }
    case 'element.setEditPolicy': {
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      const before = cloneJson(element.editPolicy)
      element.editPolicy = cloneJson(operation.editPolicy)
      return { document: next, inverse: [op(operation, 'element.setEditPolicy', { slideId: operation.slideId, elementId: operation.elementId, editPolicy: before ?? {} })] }
    }
    case 'element.setSemanticKey': {
      const slide = requireSlide(next, operation.slideId)
      const element = requireElement(slide, operation.elementId)
      if (operation.semanticKey && Object.values(slide.elements).some((candidate) => candidate.id !== element.id && candidate.semanticKey === operation.semanticKey)) throw error('SEMANTIC_KEY_DUPLICATE', `Duplicate semanticKey: ${operation.semanticKey}.`)
      const before = element.semanticKey
      if (operation.semanticKey === undefined) delete element.semanticKey
      else element.semanticKey = operation.semanticKey
      return { document: next, inverse: [op(operation, 'element.setSemanticKey', { slideId: operation.slideId, elementId: operation.elementId, semanticKey: before })] }
    }
    case 'element.setStyleRef': {
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      assertStyleElement(element)
      const before = element.style.styleRef
      element.style.styleRef = operation.styleRef
      return { document: next, inverse: [op(operation, 'element.setStyleRef', { slideId: operation.slideId, elementId: operation.elementId, styleRef: before })] }
    }
    case 'element.updateStyleOverrides': {
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      assertStyleElement(element)
      const before = cloneJson(element.style.overrides ?? {})
      element.style.overrides = { ...(element.style.overrides ?? {}), ...cloneJson(operation.patch) }
      return { document: next, inverse: restoreOverrides(operation, before) }
    }
    case 'element.clearStyleOverrides': {
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      assertStyleElement(element)
      const before = cloneJson(element.style.overrides ?? {})
      if (!operation.paths?.length) delete element.style.overrides
      else for (const path of operation.paths) deleteNested(element.style.overrides ?? {}, path)
      return { document: next, inverse: restoreOverrides(operation, before) }
    }
    case 'text.replaceContent': {
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      if (element.type !== 'text') throw error('OPERATION_TYPE_MISMATCH', 'text.replaceContent requires a Text element.')
      const before = cloneJson(element.content)
      element.content = cloneJson(operation.content)
      return { document: next, inverse: [op(operation, 'text.replaceContent', { slideId: operation.slideId, elementId: operation.elementId, content: before })] }
    }
    case 'text.setOverflowPolicy': {
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      if (element.type !== 'text') throw error('OPERATION_TYPE_MISMATCH', 'text.setOverflowPolicy requires a Text element.')
      const before = element.overflowPolicy
      element.overflowPolicy = operation.overflowPolicy
      return { document: next, inverse: [op(operation, 'text.setOverflowPolicy', { slideId: operation.slideId, elementId: operation.elementId, overflowPolicy: before ?? 'warn' })] }
    }
    case 'text.fitByReducingFont': {
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      if (element.type !== 'text') throw error('OPERATION_TYPE_MISMATCH', 'text.fitByReducingFont requires a Text element.')
      if (operation.resolvedFontSize < operation.minFontSize || operation.minFontSize <= 0) throw error('SCHEMA_INVALID', 'Resolved font size is below minFontSize.')
      const before = cloneJson(element.style.overrides ?? {})
      element.style.overrides = { ...(element.style.overrides ?? {}), fontSize: operation.resolvedFontSize }
      return { document: next, inverse: restoreOverrides(operation, before) }
    }
    case 'text.resizeBox': {
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      if (element.type !== 'text') throw error('OPERATION_TYPE_MISMATCH', 'text.resizeBox requires a Text element.')
      assertFrame(operation.frame)
      const before = cloneJson(element.frame)
      element.frame = cloneJson(operation.frame)
      return { document: next, inverse: [op(operation, 'text.resizeBox', { slideId: operation.slideId, elementId: operation.elementId, frame: before })] }
    }
    case 'image.replaceAsset': {
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      if (element.type !== 'image') throw error('OPERATION_TYPE_MISMATCH', 'image.replaceAsset requires an Image element.')
      if (!next.assets[operation.assetId]) throw error('ASSET_MISSING', `Asset does not exist: ${operation.assetId}.`)
      const beforeAsset = element.assetId
      const beforeCrop = cloneJson(element.crop)
      const beforeFocal = cloneJson(element.focalPoint)
      element.assetId = operation.assetId
      if (!operation.preserveCrop) delete element.crop
      const inverse: Operation[] = [op(operation, 'image.replaceAsset', { slideId: operation.slideId, elementId: operation.elementId, assetId: beforeAsset, preserveCrop: false })]
      if (beforeCrop) inverse.push(op(operation, 'image.setCrop', { slideId: operation.slideId, elementId: operation.elementId, crop: beforeCrop }))
      if (beforeFocal) inverse.push(op(operation, 'image.setFocalPoint', { slideId: operation.slideId, elementId: operation.elementId, focalPoint: beforeFocal }))
      return { document: next, inverse }
    }
    case 'image.setCrop': {
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      if (element.type !== 'image') throw error('OPERATION_TYPE_MISMATCH', 'image.setCrop requires an Image element.')
      assertNormalizedRect(operation.crop)
      const before = cloneJson(element.crop)
      element.crop = cloneJson(operation.crop)
      return { document: next, inverse: before ? [op(operation, 'image.setCrop', { slideId: operation.slideId, elementId: operation.elementId, crop: before })] : [op(operation, 'image.replaceAsset', { slideId: operation.slideId, elementId: operation.elementId, assetId: element.assetId, preserveCrop: false })] }
    }
    case 'image.setFocalPoint': {
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      if (element.type !== 'image') throw error('OPERATION_TYPE_MISMATCH', 'image.setFocalPoint requires an Image element.')
      const before = cloneJson(element.focalPoint)
      if (operation.focalPoint) {
        assertFinite(operation.focalPoint.x, operation.focalPoint.y)
        element.focalPoint = cloneJson(operation.focalPoint)
      } else delete element.focalPoint
      return { document: next, inverse: [op(operation, 'image.setFocalPoint', { slideId: operation.slideId, elementId: operation.elementId, focalPoint: before })] }
    }
    case 'shape.updateStyle': {
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      if (element.type !== 'shape') throw error('OPERATION_TYPE_MISMATCH', 'shape.updateStyle requires a Shape element.')
      const before = cloneJson(element.style.overrides ?? {})
      if (operation.replace) {
        if (Object.keys(operation.patch).length === 0) delete element.style.overrides
        else element.style.overrides = cloneJson(operation.patch)
      } else element.style.overrides = { ...(element.style.overrides ?? {}), ...cloneJson(operation.patch) }
      return { document: next, inverse: [op(operation, 'shape.updateStyle', { slideId: operation.slideId, elementId: operation.elementId, patch: before, replace: true })] }
    }
    case 'group.create': {
      const slide = requireSlide(next, operation.slideId)
      if (slide.groups?.[operation.group.id]) throw error('ID_CONFLICT', `Group already exists: ${operation.group.id}.`)
      assertGroupMembersAvailable(slide, operation.group.memberIds)
      slide.groups ??= {}
      slide.groups[operation.group.id] = cloneJson(operation.group)
      return { document: next, inverse: [op(operation, 'group.delete', { slideId: operation.slideId, groupId: operation.group.id })] }
    }
    case 'group.delete': {
      const slide = requireSlide(next, operation.slideId)
      const group = slide.groups?.[operation.groupId]
      if (!group) throw error('GROUP_MISSING', `Group does not exist: ${operation.groupId}.`)
      delete slide.groups?.[operation.groupId]
      return { document: next, inverse: [op(operation, 'group.create', { slideId: operation.slideId, group: cloneJson(group) })] }
    }
    case 'group.addMembers': {
      const slide = requireSlide(next, operation.slideId)
      const group = requireGroup(slide, operation.groupId)
      assertGroupMembersAvailable(slide, operation.elementIds, group.id)
      const added = operation.elementIds.filter((elementId) => !group.memberIds.includes(elementId))
      for (const elementId of added) group.memberIds.push(elementId)
      return { document: next, inverse: added.length ? [op(operation, 'group.removeMembers', { slideId: operation.slideId, groupId: operation.groupId, elementIds: cloneJson(added) })] : [] }
    }
    case 'group.removeMembers': {
      const slide = requireSlide(next, operation.slideId)
      const group = requireGroup(slide, operation.groupId)
      const groupBefore = cloneJson(group)
      const before = operation.elementIds.filter((elementId) => group.memberIds.includes(elementId))
      group.memberIds = group.memberIds.filter((elementId) => !operation.elementIds.includes(elementId))
      return { document: next, inverse: before.length ? [op(operation, 'group.delete', { slideId: operation.slideId, groupId: operation.groupId }), op(operation, 'group.create', { slideId: operation.slideId, group: groupBefore })] : [] }
    }
    case 'group.move': {
      const slide = requireSlide(next, operation.slideId)
      const group = requireGroup(slide, operation.groupId)
      assertFinite(operation.dx, operation.dy)
      for (const elementId of group.memberIds) {
        const element = requireElement(slide, elementId)
        element.frame.x += operation.dx
        element.frame.y += operation.dy
      }
      return { document: next, inverse: [op(operation, 'group.move', { slideId: operation.slideId, groupId: operation.groupId, dx: -operation.dx, dy: -operation.dy })] }
    }
    case 'group.resize': {
      const slide = requireSlide(next, operation.slideId)
      const group = requireGroup(slide, operation.groupId)
      assertFrame(operation.targetFrame)
      if (group.memberIds.length === 0) return { document: next, inverse: [] }
      const members = group.memberIds.map((elementId) => requireElement(slide, elementId))
      const bounds = boundingFrame(members.map((element) => element.frame))
      const scaleX = operation.targetFrame.width / bounds.width
      const scaleY = operation.targetFrame.height / bounds.height
      const before = members.map((element) => ({ elementId: element.id, frame: cloneJson(element.frame) }))
      for (const element of members) {
        element.frame = {
          x: operation.targetFrame.x + (element.frame.x - bounds.x) * scaleX,
          y: operation.targetFrame.y + (element.frame.y - bounds.y) * scaleY,
          width: element.frame.width * scaleX,
          height: element.frame.height * scaleY,
        }
      }
      // The v1 contract never changes Text style as a side effect of a group resize.
      return { document: next, inverse: before.map((item) => op(operation, 'element.resize', { slideId: operation.slideId, elementId: item.elementId, frame: item.frame })) }
    }
    case 'fact.upsert': {
      const before = cloneJson(next.facts?.[operation.fact.id])
      next.facts ??= {}
      next.facts[operation.fact.id] = cloneJson(operation.fact)
      return { document: next, inverse: before ? [op(operation, 'fact.upsert', { fact: before })] : [op(operation, 'fact.delete', { factId: operation.fact.id })] }
    }
    case 'fact.delete': {
      const before = next.facts?.[operation.factId]
      if (!before) throw error('FACT_REFERENCE_MISSING', `Fact does not exist: ${operation.factId}.`)
      delete next.facts?.[operation.factId]
      return { document: next, inverse: [op(operation, 'fact.upsert', { fact: cloneJson(before) })] }
    }
    case 'fact.syncReferences':
      throw error('UNSUPPORTED_OPERATION', 'fact.syncReferences is reserved for the later explicit-sync slice.')
    case 'source.upsert': {
      const before = cloneJson(next.sources?.[operation.source.id])
      next.sources ??= {}
      next.sources[operation.source.id] = cloneJson(operation.source)
      return { document: next, inverse: before ? [op(operation, 'source.upsert', { source: before })] : [op(operation, 'source.delete', { sourceId: operation.source.id })] }
    }
    case 'source.delete': {
      const before = next.sources?.[operation.sourceId]
      if (!before) throw error('SOURCE_REFERENCE_MISSING', `Source does not exist: ${operation.sourceId}.`)
      delete next.sources?.[operation.sourceId]
      return { document: next, inverse: [op(operation, 'source.upsert', { source: cloneJson(before) })] }
    }
    case 'layout.align':
      return applyLayoutAlign(next, operation)
    case 'layout.distribute':
      return applyLayoutDistribute(next, operation)
    case 'chart.replaceData':
    case 'chart.updateEncoding':
    case 'chart.updateOptions':
    case 'chart.updateStyle':
    case 'component.updateProps':
      throw error('UNSUPPORTED_OPERATION', `${operation.kind} is outside the Week 1–2 runtime.`)
  }
}

export function applyTransaction(document: PpteDocument, transaction: Transaction): AppliedTransaction {
  let current = cloneJson(document)
  const inverseOperations: Operation[] = []
  for (const operation of transaction.operations) {
    const result = applyOperation(current, operation)
    current = result.document
    inverseOperations.unshift(...result.inverse)
  }
  return { document: current, inverseOperations }
}

function applyLayoutAlign(document: PpteDocument, operation: Extract<Operation, { kind: 'layout.align' }>): AppliedOperation {
  const slide = requireSlide(document, operation.slideId)
  const elements = operation.elementIds.map((elementId) => requireElement(slide, elementId))
  const before = elements.map((element) => ({ elementId: element.id, frame: cloneJson(element.frame) }))
  const reference = operation.reference === 'slide' ? { x: 0, y: 0, width: document.canvas.width, height: document.canvas.height } : operation.reference === 'selection' ? boundingFrame(elements.map((element) => element.frame)) : requireElement(slide, operation.reference).frame
  for (const element of elements) {
    if (operation.alignment === 'left') element.frame.x = reference.x
    if (operation.alignment === 'center-x') element.frame.x = reference.x + (reference.width - element.frame.width) / 2
    if (operation.alignment === 'right') element.frame.x = reference.x + reference.width - element.frame.width
    if (operation.alignment === 'top') element.frame.y = reference.y
    if (operation.alignment === 'center-y') element.frame.y = reference.y + (reference.height - element.frame.height) / 2
    if (operation.alignment === 'bottom') element.frame.y = reference.y + reference.height - element.frame.height
  }
  return { document, inverse: before.map((item) => op(operation, 'element.resize', { slideId: operation.slideId, elementId: item.elementId, frame: item.frame })) }
}

function applyLayoutDistribute(document: PpteDocument, operation: Extract<Operation, { kind: 'layout.distribute' }>): AppliedOperation {
  const slide = requireSlide(document, operation.slideId)
  const elements = operation.elementIds.map((elementId) => requireElement(slide, elementId)).sort((a, b) => operation.axis === 'horizontal' ? a.frame.x - b.frame.x : a.frame.y - b.frame.y)
  const before = elements.map((element) => ({ elementId: element.id, frame: cloneJson(element.frame) }))
  if (elements.length >= 3) {
    const first = elements[0].frame
    const last = elements[elements.length - 1].frame
    if (operation.mode === 'centers') {
      const start = operation.axis === 'horizontal' ? first.x + first.width / 2 : first.y + first.height / 2
      const end = operation.axis === 'horizontal' ? last.x + last.width / 2 : last.y + last.height / 2
      const step = (end - start) / (elements.length - 1)
      elements.slice(1, -1).forEach((element, index) => {
        const center = start + step * (index + 1)
        if (operation.axis === 'horizontal') element.frame.x = center - element.frame.width / 2
        else element.frame.y = center - element.frame.height / 2
      })
    } else {
      const start = operation.axis === 'horizontal' ? first.x : first.y
      const end = operation.axis === 'horizontal' ? last.x + last.width : last.y + last.height
      const total = elements.reduce((sum, element) => sum + (operation.axis === 'horizontal' ? element.frame.width : element.frame.height), 0)
      const gap = (end - start - total) / (elements.length - 1)
      let cursor = start
      elements.forEach((element) => {
        if (operation.axis === 'horizontal') element.frame.x = cursor
        else element.frame.y = cursor
        cursor += (operation.axis === 'horizontal' ? element.frame.width : element.frame.height) + gap
      })
    }
  }
  return { document, inverse: before.map((item) => op(operation, 'element.resize', { slideId: operation.slideId, elementId: item.elementId, frame: item.frame })) }
}

function assertRuntimeElement(element: Element): asserts element is Exclude<Element, { type: 'chart' | 'component' }> {
  if (element.type === 'chart' || element.type === 'component') throw error('UNSUPPORTED_ELEMENT_TYPE', `Week 1–2 runtime does not implement ${element.type}.`)
}

function assertStyleElement(element: Element): asserts element is Extract<Element, { style: unknown }> {
  if (element.type !== 'text' && element.type !== 'image' && element.type !== 'shape') throw error('OPERATION_TYPE_MISMATCH', 'Element has no Week 1–2 style binding.')
}

function assertGroupMembersAvailable(slide: Slide, memberIds: string[], ownGroupId?: string) {
  for (const elementId of memberIds) requireElement(slide, elementId)
  for (const [groupId, group] of Object.entries(slide.groups ?? {})) {
    if (groupId === ownGroupId) continue
    for (const elementId of memberIds) if (group.memberIds.includes(elementId)) throw error('FLAT_GROUP_DUPLICATE_MEMBER', `Element belongs to another group: ${elementId}.`)
  }
}

function boundingFrame(frames: Frame[]): Frame {
  const x = Math.min(...frames.map((frame) => frame.x))
  const y = Math.min(...frames.map((frame) => frame.y))
  const right = Math.max(...frames.map((frame) => frame.x + frame.width))
  const bottom = Math.max(...frames.map((frame) => frame.y + frame.height))
  return { x, y, width: right - x, height: bottom - y }
}

function restoreOverrides(operation: Operation, before: Record<string, unknown>): Operation[] {
  const clear = op(operation, 'element.clearStyleOverrides', { slideId: (operation as { slideId: string }).slideId, elementId: (operation as { elementId: string }).elementId })
  if (Object.keys(before).length === 0) return [clear]
  return [clear, op(operation, 'element.updateStyleOverrides', { slideId: (operation as { slideId: string }).slideId, elementId: (operation as { elementId: string }).elementId, patch: before as never })]
}

function deleteNested(root: Record<string, unknown>, path: string) {
  const parts = path.split('/').filter(Boolean).map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
  if (parts.length === 0) return
  let current: Record<string, unknown> | undefined = root
  for (const part of parts.slice(0, -1)) {
    const child = current[part]
    if (!child || typeof child !== 'object' || Array.isArray(child)) return
    current = child as Record<string, unknown>
  }
  delete current[parts[parts.length - 1]]
}

function uniqueSemanticKey(slide: Slide, preferred: string): string {
  const keys = new Set(Object.values(slide.elements).map((element) => element.semanticKey).filter(Boolean))
  if (!keys.has(preferred)) return preferred
  let index = 2
  while (keys.has(`${preferred}.${index}`)) index += 1
  return `${preferred}.${index}`
}

function requireSlide(document: PpteDocument, slideId: string): Slide {
  const slide = document.slides[slideId]
  if (!slide) throw error('SLIDE_MISSING', `Slide does not exist: ${slideId}.`)
  return slide
}
function requireElement(slide: Slide, elementId: string): Element {
  const element = slide.elements[elementId]
  if (!element) throw error('ELEMENT_MISSING', `Element does not exist: ${elementId}.`)
  return element
}
function requireGroup(slide: Slide, groupId: string) {
  const group = slide.groups?.[groupId]
  if (!group) throw error('GROUP_MISSING', `Group does not exist: ${groupId}.`)
  return group
}
function assertFinite(...values: number[]) {
  if (values.some((value) => !Number.isFinite(value))) throw error('GEOMETRY_INVALID', 'Geometry values must be finite.')
}
function assertFrame(frame: Frame) {
  assertFinite(frame.x, frame.y, frame.width, frame.height)
  if (frame.width <= 0 || frame.height <= 0) throw error('GEOMETRY_INVALID', 'Frame dimensions must be positive.')
}
function assertNormalizedRect(rect: { x: number; y: number; width: number; height: number }) {
  assertFinite(rect.x, rect.y, rect.width, rect.height)
  if (rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 || rect.x + rect.width > 1 || rect.y + rect.height > 1) throw error('GEOMETRY_INVALID', 'Crop must be a positive rectangle inside 0–1.')
}
function clampIndex(index: number, length: number): number {
  if (!Number.isInteger(index)) throw error('SCHEMA_INVALID', 'Array index must be an integer.')
  return Math.max(0, Math.min(index, length))
}
function removeAll(values: string[], value: string) {
  let index = values.indexOf(value)
  while (index >= 0) {
    values.splice(index, 1)
    index = values.indexOf(value)
  }
}
function error(code: string, message: string): OperationApplyError {
  return new OperationApplyError(code, message)
}

type OperationPayload<K extends Operation['kind']> = Omit<Extract<Operation, { kind: K }>, 'opId' | 'kind' | 'preconditions' | 'reason'>
function op<K extends Operation['kind']>(source: Operation, kind: K, payload: OperationPayload<K>): Extract<Operation, { kind: K }> {
  return { opId: `${source.opId}:inverse:${kind}`, kind, ...payload } as Extract<Operation, { kind: K }>
}
