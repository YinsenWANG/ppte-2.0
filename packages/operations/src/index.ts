import { cloneJson } from '../../canonical-json/src/index.js'
import { syncChartFact, validateChartContract } from '../../charts/src/index.js'
import { formatFactValue } from '../../facts/src/index.js'
import { validateTextOverflow } from '../../validation/src/index.js'
import type {
  ChartElement,
  Element,
  Frame,
  ImageElement,
  PpteDocument,
  ShapeElement,
  Slide,
  TextElement,
} from '../../schema/src/index.js'

type StableStyleElement = TextElement | ShapeElement | ChartElement | (ImageElement & { style: NonNullable<ImageElement['style']> })

/** Operations implemented by the synchronous Stable Core runtime. */
export const STABLE_CORE_OPERATION_KINDS = [
  'document.updateMetadata', 'theme.replace', 'theme.setToken', 'theme.updatePreset',
  'slide.insert', 'slide.delete', 'slide.move', 'slide.update', 'slide.setReadingOrder', 'slide.setProtectedAnchors',
  'element.insert', 'element.delete', 'element.duplicate', 'element.move', 'element.resize', 'element.rotate', 'element.reorder', 'element.setVisibility', 'element.setLocked', 'element.setEditPolicy', 'element.setSemanticKey', 'element.setStyleRef', 'element.updateStyleOverrides', 'element.clearStyleOverrides',
  'text.replaceContent', 'text.setOverflowPolicy', 'text.fitByReducingFont', 'text.resizeBox',
  'image.replaceAsset', 'image.setCrop', 'image.setFocalPoint', 'shape.updateStyle',
  'group.create', 'group.delete', 'group.addMembers', 'group.removeMembers', 'group.move', 'group.resize',
  'fact.upsert', 'fact.delete', 'fact.syncReferences', 'source.upsert', 'source.delete', 'layout.align', 'layout.distribute',
] as const

/** GA-B adds deterministic Bar/Line/Pie mutations without changing the historical Week 1–2 matrix. */
export const GA_B_OPERATION_KINDS = [
  ...STABLE_CORE_OPERATION_KINDS,
  'slide.duplicate', 'slide.setNotes', 'slide.setTransition',
  'element.setAppearStep', 'element.setAnimation',
  'element.setSemanticRefs',
  'text.updateStyle',
  'chart.replaceData', 'chart.updateEncoding', 'chart.updateOptions', 'chart.updateStyle',
] as const

/** GA-C adds Area/Donut chart data paths and the controlled Widget props path. */
export const GA_C_OPERATION_KINDS = [
  ...GA_B_OPERATION_KINDS,
  'component.updateProps',
] as const

/** Backward-compatible name retained for the Week 1–2 operation matrix. */
export const WEEK1_2_OPERATION_KINDS = STABLE_CORE_OPERATION_KINDS

/** R2 operations are kept separate so the historical Week 1–2 matrix remains stable. */
export const R2_OPERATION_KINDS = [
  ...STABLE_CORE_OPERATION_KINDS,
  'slide.duplicate', 'slide.setNotes', 'slide.setTransition',
  'element.setAppearStep', 'element.setAnimation',
] as const

export interface DuplicateSlideOperationOptions {
  opId?: string
  index?: number
  offset?: { x: number; y: number }
  reason?: string
}

/** Build the one canonical operation used by Hosts when duplicating a slide. */
export function buildDuplicateSlideOperation(document: PpteDocument, sourceSlideId: string, newSlideId: string, options: DuplicateSlideOperationOptions = {}): Extract<Operation, { kind: 'slide.duplicate' }> {
  if (!document.slides[sourceSlideId]) throw new Error(`SLIDE_MISSING: ${sourceSlideId}`)
  if (!newSlideId) throw new Error('SLIDE_ID_INVALID: newSlideId is required.')
  if (document.slides[newSlideId]) throw new Error(`ID_CONFLICT: Slide already exists: ${newSlideId}.`)
  return {
    opId: options.opId ?? `slide.duplicate:${sourceSlideId}:${newSlideId}`,
    kind: 'slide.duplicate',
    sourceSlideId,
    newSlideId,
    ...(options.index === undefined ? {} : { index: options.index }),
    ...(options.offset === undefined ? {} : { offset: { ...options.offset } }),
    ...(options.reason === undefined ? {} : { reason: options.reason }),
  }
}

export const createDuplicateSlideOperation = buildDuplicateSlideOperation
export const duplicateSlideOperation = buildDuplicateSlideOperation
export const duplicateSlide = buildDuplicateSlideOperation

/** Generic slide.update is intentionally limited to these persisted metadata fields. */
export const SLIDE_UPDATE_METADATA_KEYS = [
  'name', 'hidden', 'background', 'notes', 'transition', 'semantic', 'visualStrategy', 'provenance', 'extensions',
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

export interface OperationApplyOptions {
  runtimeProfile?: 'ga-a' | 'ga-b' | 'ga-c'
  /** Core sessions enable this to reject unsafe Fact display fallbacks. */
  strictFactSync?: boolean
}

/** Apply one typed operation to a cloned snapshot. The input is never mutated. */
export function applyOperation(document: PpteDocument, operation: Operation, options: OperationApplyOptions = {}): AppliedOperation {
  const next = cloneJson(document)
  const runtimeProfile = options.runtimeProfile ?? 'ga-b'
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
      assertThemeToken(operation.category, operation.value)
      const bucket = next.theme.tokens[operation.category] as Record<string, unknown>
      const beforeTheme = cloneJson(next.theme)
      bucket[operation.token] = cloneJson(operation.value)
      return { document: next, inverse: [op(operation, 'theme.replace', { theme: beforeTheme })] }
    }
    case 'theme.updatePreset': {
      if (!operation.remove) assertThemePreset(operation.category, operation.value)
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
    case 'slide.duplicate': {
      const source = requireSlide(next, operation.sourceSlideId)
      if (next.slides[operation.newSlideId]) throw error('ID_CONFLICT', `Slide already exists: ${operation.newSlideId}.`)
      const offset = operation.offset ?? { x: 0, y: 0 }
      assertFinite(offset.x, offset.y)
      const duplicate = rekeySlide(source, operation.newSlideId, offset)
      next.slides[duplicate.id] = duplicate
      const index = clampIndex(operation.index ?? next.slideOrder.length, next.slideOrder.length)
      next.slideOrder.splice(index, 0, duplicate.id)
      return { document: next, inverse: [op(operation, 'slide.delete', { slideId: duplicate.id })] }
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
        if (!(SLIDE_UPDATE_METADATA_KEYS as readonly string[]).includes(key)) throw error('SLIDE_UPDATE_FIELD_NOT_ALLOWED', `slide.update may only change slide metadata; field ${key} has a dedicated operation or is not mutable.`)
        before[key] = cloneJson((slide as unknown as Record<string, unknown>)[key])
        ;(slide as unknown as Record<string, unknown>)[key] = cloneJson(value)
      }
      return { document: next, inverse: [op(operation, 'slide.update', { slideId: operation.slideId, patch: before as never })] }
    }
    case 'slide.setNotes': {
      const slide = requireSlide(next, operation.slideId)
      const before = cloneJson(slide.notes)
      if (operation.unset) delete slide.notes
      else if (operation.notes !== undefined) slide.notes = cloneJson(operation.notes)
      else throw error('SCHEMA_INVALID', 'slide.setNotes requires notes unless unset is true.')
      return { document: next, inverse: [before === undefined ? op(operation, 'slide.setNotes', { slideId: operation.slideId, unset: true }) : op(operation, 'slide.setNotes', { slideId: operation.slideId, notes: before })] }
    }
    case 'slide.setTransition': {
      const slide = requireSlide(next, operation.slideId)
      const before = cloneJson(slide.transition)
      if (operation.unset) delete slide.transition
      else if (operation.transition !== undefined) {
        assertTransition(operation.transition)
        slide.transition = cloneJson(operation.transition)
      } else throw error('SCHEMA_INVALID', 'slide.setTransition requires transition unless unset is true.')
      return { document: next, inverse: [before === undefined ? op(operation, 'slide.setTransition', { slideId: operation.slideId, unset: true }) : op(operation, 'slide.setTransition', { slideId: operation.slideId, transition: before })] }
    }
    case 'slide.setReadingOrder': {
      const slide = requireSlide(next, operation.slideId)
      const hadReadingOrder = slide.readingOrder !== undefined
      const before = cloneJson(slide.readingOrder ?? [])
      if (operation.unset) delete slide.readingOrder
      else if (operation.readingOrder) slide.readingOrder = cloneJson(operation.readingOrder)
      else throw error('SCHEMA_INVALID', 'slide.setReadingOrder requires readingOrder unless unset is true.')
      return { document: next, inverse: [hadReadingOrder ? op(operation, 'slide.setReadingOrder', { slideId: operation.slideId, readingOrder: before }) : op(operation, 'slide.setReadingOrder', { slideId: operation.slideId, unset: true })] }
    }
    case 'slide.setProtectedAnchors': {
      const slide = requireSlide(next, operation.slideId)
      const hadProtectedAnchors = slide.protectedAnchors !== undefined
      const before = cloneJson(slide.protectedAnchors ?? [])
      if (operation.unset) delete slide.protectedAnchors
      else if (operation.protectedAnchors) slide.protectedAnchors = cloneJson(operation.protectedAnchors)
      else throw error('SCHEMA_INVALID', 'slide.setProtectedAnchors requires protectedAnchors unless unset is true.')
      return { document: next, inverse: [hadProtectedAnchors ? op(operation, 'slide.setProtectedAnchors', { slideId: operation.slideId, protectedAnchors: before }) : op(operation, 'slide.setProtectedAnchors', { slideId: operation.slideId, unset: true })] }
    }
    case 'element.insert': {
      const slide = requireSlide(next, operation.slideId)
      if (slide.elements[operation.element.id]) throw error('ID_CONFLICT', `Element already exists: ${operation.element.id}.`)
      assertRuntimeElement(operation.element, runtimeProfile)
      if (operation.element.semanticKey && Object.values(slide.elements).some((candidate) => candidate.semanticKey === operation.element.semanticKey)) {
        throw error('SEMANTIC_KEY_DUPLICATE', `Duplicate semanticKey: ${operation.element.semanticKey}.`)
      }
      if (operation.element.provenance?.replacesElementId && slide.elements[operation.element.provenance.replacesElementId]) {
        throw error('SEMANTIC_LINEAGE_AMBIGUOUS', `Replacement target remains active: ${operation.element.provenance.replacesElementId}.`)
      }
      slide.elements[operation.element.id] = cloneJson(operation.element)
      slide.rootOrder.splice(clampIndex(operation.index, slide.rootOrder.length), 0, operation.element.id)
      if (operation.readingOrderIndex !== undefined && slide.readingOrder) slide.readingOrder.splice(clampIndex(operation.readingOrderIndex, slide.readingOrder.length), 0, operation.element.id)
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
      assertRuntimeElement(source, runtimeProfile)
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
      element.frame = operation.preserveAspectRatio ? preserveAspectRatioFrame(before, operation.frame) : cloneJson(operation.frame)
      return { document: next, inverse: [op(operation, 'element.resize', { slideId: operation.slideId, elementId: operation.elementId, frame: before })] }
    }
    case 'element.rotate': {
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      const before = element.rotationDeg ?? 0
      const hadRotation = element.rotationDeg !== undefined
      if (operation.unset) delete element.rotationDeg
      else if (operation.rotationDeg !== undefined) {
        assertFinite(operation.rotationDeg)
        element.rotationDeg = operation.rotationDeg
      } else throw error('SCHEMA_INVALID', 'element.rotate requires rotationDeg unless unset is true.')
      return { document: next, inverse: [hadRotation ? op(operation, 'element.rotate', { slideId: operation.slideId, elementId: operation.elementId, rotationDeg: before }) : op(operation, 'element.rotate', { slideId: operation.slideId, elementId: operation.elementId, unset: true })] }
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
      if (operation.unset) delete element.visible
      else if (operation.visible !== undefined) element.visible = operation.visible
      else throw error('SCHEMA_INVALID', 'element.setVisibility requires visible unless unset is true.')
      return { document: next, inverse: [before === undefined ? op(operation, 'element.setVisibility', { slideId: operation.slideId, elementId: operation.elementId, unset: true }) : op(operation, 'element.setVisibility', { slideId: operation.slideId, elementId: operation.elementId, visible: before })] }
    }
    case 'element.setLocked': {
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      const before = element.locked
      if (operation.unset) delete element.locked
      else if (operation.locked !== undefined) element.locked = operation.locked
      else throw error('SCHEMA_INVALID', 'element.setLocked requires locked unless unset is true.')
      return { document: next, inverse: [before === undefined ? op(operation, 'element.setLocked', { slideId: operation.slideId, elementId: operation.elementId, unset: true }) : op(operation, 'element.setLocked', { slideId: operation.slideId, elementId: operation.elementId, locked: before })] }
    }
    case 'element.setAppearStep': {
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      const before = element.appearStep
      if (operation.unset) delete element.appearStep
      else if (operation.appearStep !== undefined && Number.isInteger(operation.appearStep) && operation.appearStep >= 0) element.appearStep = operation.appearStep
      else throw error('SCHEMA_INVALID', 'element.setAppearStep requires a non-negative integer unless unset is true.')
      return { document: next, inverse: [before === undefined ? op(operation, 'element.setAppearStep', { slideId: operation.slideId, elementId: operation.elementId, unset: true }) : op(operation, 'element.setAppearStep', { slideId: operation.slideId, elementId: operation.elementId, appearStep: before })] }
    }
    case 'element.setAnimation': {
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      const before = cloneJson(element.animation)
      if (operation.unset) delete element.animation
      else if (operation.animation !== undefined) {
        assertAnimation(operation.animation)
        element.animation = cloneJson(operation.animation)
      } else throw error('SCHEMA_INVALID', 'element.setAnimation requires animation unless unset is true.')
      return { document: next, inverse: [before === undefined ? op(operation, 'element.setAnimation', { slideId: operation.slideId, elementId: operation.elementId, unset: true }) : op(operation, 'element.setAnimation', { slideId: operation.slideId, elementId: operation.elementId, animation: before })] }
    }
    case 'element.setEditPolicy': {
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      const before = cloneJson(element.editPolicy)
      if (operation.unset) delete element.editPolicy
      else if (operation.editPolicy) element.editPolicy = cloneJson(operation.editPolicy)
      else throw error('SCHEMA_INVALID', 'element.setEditPolicy requires editPolicy unless unset is true.')
      return { document: next, inverse: [before === undefined ? op(operation, 'element.setEditPolicy', { slideId: operation.slideId, elementId: operation.elementId, unset: true }) : op(operation, 'element.setEditPolicy', { slideId: operation.slideId, elementId: element.id, editPolicy: before })] }
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
    case 'element.setSemanticRefs': {
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      const before = cloneJson(element.semanticRefs)
      if (operation.unset) delete element.semanticRefs
      else if (operation.semanticRefs) element.semanticRefs = cloneJson(operation.semanticRefs)
      else throw error('SCHEMA_INVALID', 'element.setSemanticRefs requires semanticRefs unless unset is true.')
      return { document: next, inverse: [before === undefined ? op(operation, 'element.setSemanticRefs', { slideId: operation.slideId, elementId: operation.elementId, unset: true }) : op(operation, 'element.setSemanticRefs', { slideId: operation.slideId, elementId: operation.elementId, semanticRefs: before })] }
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
      assertTypedStyleOverrides(element.type, operation.patch)
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
      assertRichText(operation.content)
      element.content = cloneJson(operation.content)
      return { document: next, inverse: [op(operation, 'text.replaceContent', { slideId: operation.slideId, elementId: operation.elementId, content: before })] }
    }
    case 'text.updateStyle': {
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      if (element.type !== 'text') throw error('OPERATION_TYPE_MISMATCH', 'text.updateStyle requires a Text element.')
      const hasParagraphChange = operation.paragraphStyle !== undefined || operation.unsetParagraphStyle === true
      const hasBoxChange = operation.boxStyle !== undefined || operation.unsetBoxStyle === true
      if (!hasParagraphChange && !hasBoxChange) throw error('SCHEMA_INVALID', 'text.updateStyle requires paragraphStyle or boxStyle.')
      const beforeParagraphStyle = cloneJson(element.paragraphStyle)
      const beforeBoxStyle = cloneJson(element.boxStyle)
      if (operation.unsetParagraphStyle) delete element.paragraphStyle
      else if (operation.paragraphStyle !== undefined) {
        assertParagraphStyle(operation.paragraphStyle)
        element.paragraphStyle = cloneJson(operation.paragraphStyle)
      }
      if (operation.unsetBoxStyle) delete element.boxStyle
      else if (operation.boxStyle !== undefined) {
        assertBoxStyle(operation.boxStyle)
        element.boxStyle = cloneJson(operation.boxStyle)
      }
      return {
        document: next,
        inverse: [op(operation, 'text.updateStyle', {
          slideId: operation.slideId,
          elementId: operation.elementId,
          ...(hasParagraphChange ? (beforeParagraphStyle === undefined ? { unsetParagraphStyle: true } : { paragraphStyle: beforeParagraphStyle }) : {}),
          ...(hasBoxChange ? (beforeBoxStyle === undefined ? { unsetBoxStyle: true } : { boxStyle: beforeBoxStyle }) : {}),
        })],
      }
    }
    case 'text.setOverflowPolicy': {
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      if (element.type !== 'text') throw error('OPERATION_TYPE_MISMATCH', 'text.setOverflowPolicy requires a Text element.')
      const before = element.overflowPolicy
      if (operation.unset) delete element.overflowPolicy
      else if (operation.overflowPolicy) element.overflowPolicy = operation.overflowPolicy
      else throw error('SCHEMA_INVALID', 'text.setOverflowPolicy requires overflowPolicy unless unset is true.')
      return { document: next, inverse: [before === undefined ? op(operation, 'text.setOverflowPolicy', { slideId: operation.slideId, elementId: operation.elementId, unset: true }) : op(operation, 'text.setOverflowPolicy', { slideId: operation.slideId, elementId: operation.elementId, overflowPolicy: before })] }
    }
    case 'text.fitByReducingFont': {
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      if (element.type !== 'text') throw error('OPERATION_TYPE_MISMATCH', 'text.fitByReducingFont requires a Text element.')
      assertFinite(operation.minFontSize, operation.resolvedFontSize)
      if (operation.resolvedFontSize < operation.minFontSize || operation.minFontSize <= 0) throw error('SCHEMA_INVALID', 'Resolved font size is below minFontSize.')
      const currentFontSize = effectiveFontSize(next, element)
      if (currentFontSize !== undefined && operation.resolvedFontSize > currentFontSize + 0.001) throw error('STYLE_OVERRIDE_INVALID', 'text.fitByReducingFont may not increase the effective font size.')
      const before = cloneJson(element.style.overrides ?? {})
      const upperBound = Math.min(currentFontSize ?? operation.resolvedFontSize, operation.resolvedFontSize)
      const resolvedFontSize = solveFittingFontSize(next, operation.slideId, element, before, operation.minFontSize, upperBound)
      element.style.overrides = { ...(element.style.overrides ?? {}), fontSize: resolvedFontSize }
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
        if (operation.focalPoint.x < 0 || operation.focalPoint.x > 1 || operation.focalPoint.y < 0 || operation.focalPoint.y > 1) throw error('GEOMETRY_INVALID', 'Focal point must be inside 0–1.')
        element.focalPoint = cloneJson(operation.focalPoint)
      } else delete element.focalPoint
      return { document: next, inverse: [op(operation, 'image.setFocalPoint', { slideId: operation.slideId, elementId: operation.elementId, focalPoint: before })] }
    }
    case 'asset.upsert': {
      const before = cloneJson(next.assets[operation.asset.id])
      if (operation.remove) {
        if (!before) throw error('ASSET_MISSING', `Asset does not exist: ${operation.asset.id}.`)
        delete next.assets[operation.asset.id]
        return { document: next, inverse: [op(operation, 'asset.upsert', { asset: before })] }
      }
      next.assets[operation.asset.id] = cloneJson(operation.asset)
      return {
        document: next,
        inverse: before
          ? [op(operation, 'asset.upsert', { asset: before })]
          : [op(operation, 'asset.upsert', { asset: cloneJson(operation.asset), remove: true })],
      }
    }
    case 'font.upsert': {
      const before = cloneJson(next.fonts[operation.font.id])
      if (operation.remove) {
        if (!before) throw error('FONT_MISSING', `Font does not exist: ${operation.font.id}.`)
        delete next.fonts[operation.font.id]
        return { document: next, inverse: [op(operation, 'font.upsert', { font: before })] }
      }
      next.fonts[operation.font.id] = cloneJson(operation.font)
      return {
        document: next,
        inverse: before
          ? [op(operation, 'font.upsert', { font: before })]
          : [op(operation, 'font.upsert', { font: cloneJson(operation.font), remove: true })],
      }
    }
    case 'shape.updateStyle': {
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      if (element.type !== 'shape') throw error('OPERATION_TYPE_MISMATCH', 'shape.updateStyle requires a Shape element.')
      assertTypedStyleOverrides('shape', operation.patch)
      const before = cloneJson(element.style.overrides ?? {})
      if (operation.replace) {
        if (Object.keys(operation.patch).length === 0) delete element.style.overrides
        else element.style.overrides = cloneJson(operation.patch)
      } else {
        assertTypedStyleOverrides('shape', operation.patch)
        element.style.overrides = { ...(element.style.overrides ?? {}), ...cloneJson(operation.patch) }
      }
      return { document: next, inverse: [op(operation, 'shape.updateStyle', { slideId: operation.slideId, elementId: operation.elementId, patch: before, replace: true })] }
    }
    case 'chart.replaceData': {
      const element = requireChart(next, operation.slideId, operation.elementId, runtimeProfile)
      const before = cloneJson(element.data)
      const candidate = { ...element, data: cloneJson(operation.data) }
      assertValidChart(candidate, runtimeProfile)
      element.data = cloneJson(operation.data)
      return { document: next, inverse: [op(operation, 'chart.replaceData', { slideId: operation.slideId, elementId: operation.elementId, data: before })] }
    }
    case 'chart.updateEncoding': {
      const element = requireChart(next, operation.slideId, operation.elementId, runtimeProfile)
      const before = cloneJson(element.encoding)
      const candidate = { ...element, encoding: cloneJson(operation.encoding) }
      assertValidChart(candidate, runtimeProfile)
      element.encoding = cloneJson(operation.encoding)
      return { document: next, inverse: [op(operation, 'chart.updateEncoding', { slideId: operation.slideId, elementId: operation.elementId, encoding: before })] }
    }
    case 'chart.updateOptions': {
      const element = requireChart(next, operation.slideId, operation.elementId, runtimeProfile)
      const before = cloneJson(element.options)
      if (operation.unset) delete element.options
      else if (operation.replace) element.options = cloneJson(operation.patch)
      else element.options = { ...(element.options ?? {}), ...cloneJson(operation.patch) }
      assertValidChart(element, runtimeProfile)
      return { document: next, inverse: [before === undefined ? op(operation, 'chart.updateOptions', { slideId: operation.slideId, elementId: operation.elementId, patch: {}, unset: true }) : op(operation, 'chart.updateOptions', { slideId: operation.slideId, elementId: operation.elementId, patch: before, replace: true })] }
    }
    case 'chart.updateStyle': {
      const element = requireChart(next, operation.slideId, operation.elementId, runtimeProfile)
      const before = cloneJson(element.style.overrides ?? {})
      if (operation.unset || (operation.replace && Object.keys(operation.patch).length === 0)) delete element.style.overrides
      else if (operation.replace) element.style.overrides = cloneJson(operation.patch)
      else element.style.overrides = { ...(element.style.overrides ?? {}), ...cloneJson(operation.patch) }
      assertTypedStyleOverrides('chart', operation.patch)
      return { document: next, inverse: [op(operation, 'chart.updateStyle', { slideId: operation.slideId, elementId: operation.elementId, patch: before, replace: true })] }
    }
    case 'group.create': {
      const slide = requireSlide(next, operation.slideId)
      if (slide.groups?.[operation.group.id]) throw error('ID_CONFLICT', `Group already exists: ${operation.group.id}.`)
      assertUniqueElementIds(operation.group.memberIds)
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
      assertUniqueElementIds(operation.elementIds)
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
      const beforeStyles = members
        .filter((element): element is TextElement => element.type === 'text' && operation.scaleTextStyle === true)
        .map((element) => ({ elementId: element.id, overrides: cloneJson(element.style.overrides ?? {}) }))
      for (const element of members) {
        element.frame = {
          x: operation.targetFrame.x + (element.frame.x - bounds.x) * scaleX,
          y: operation.targetFrame.y + (element.frame.y - bounds.y) * scaleY,
          width: element.frame.width * scaleX,
          height: element.frame.height * scaleY,
        }
      }
      if (operation.scaleTextStyle === true) {
        // Non-uniform group scaling has no single axis. The geometric mean is
        // deterministic and keeps typography proportional to the area change.
        const textScale = Math.sqrt(Math.abs(scaleX * scaleY))
        for (const element of members) {
          if (element.type !== 'text') continue
          const fontSize = effectiveFontSize(next, element)
          if (fontSize === undefined) throw error('STYLE_OVERRIDE_INVALID', `Text preset has no numeric fontSize: ${element.id}.`)
          element.style.overrides = { ...(element.style.overrides ?? {}), fontSize: fontSize * textScale }
        }
      }
      const inverse: Operation[] = before.map((item) => op(operation, 'element.resize', { slideId: operation.slideId, elementId: item.elementId, frame: item.frame }))
      for (const item of beforeStyles) inverse.push(...restoreOverrides({ ...operation, elementId: item.elementId } as Operation, item.overrides))
      return { document: next, inverse }
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
      return applyFactSyncReferences(next, operation, runtimeProfile, options.strictFactSync === true)
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
    case 'component.updateProps': {
      if (runtimeProfile !== 'ga-c') throw error('UNSUPPORTED_OPERATION', `${operation.kind} is outside the ${runtimeProfile.toUpperCase()} runtime.`)
      const element = requireElement(requireSlide(next, operation.slideId), operation.elementId)
      if (element.type !== 'component') throw error('OPERATION_TYPE_MISMATCH', 'component.updateProps requires a Component element.')
      assertComponentProps(operation.patch)
      const before = cloneJson(element.props)
      element.props = operation.replace ? cloneJson(operation.patch) : { ...element.props, ...cloneJson(operation.patch) }
      return { document: next, inverse: [op(operation, 'component.updateProps', { slideId: operation.slideId, elementId: operation.elementId, patch: before, replace: true })] }
    }
  }
}

export function applyTransaction(document: PpteDocument, transaction: Transaction, options: OperationApplyOptions = {}): AppliedTransaction {
  let current = cloneJson(document)
  const inverseOperations: Operation[] = []
  for (const operation of transaction.operations) {
    const result = applyOperation(current, operation, options)
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

function assertRuntimeElement(element: Element, runtimeProfile: 'ga-a' | 'ga-b' | 'ga-c'): void {
  if (element.type === 'component') {
    if (runtimeProfile !== 'ga-c') throw error('UNSUPPORTED_ELEMENT_TYPE', `${runtimeProfile.toUpperCase()} runtime does not implement component elements.`)
    assertComponentProps(element.props)
  }
  if (element.type === 'chart') assertValidChart(element, runtimeProfile)
}

function assertStyleElement(element: Element): asserts element is StableStyleElement {
  if (element.type !== 'text' && element.type !== 'image' && element.type !== 'shape' && element.type !== 'chart') throw error('OPERATION_TYPE_MISMATCH', 'Element has no GA-B style binding.')
  if (!element.style) throw error('STYLE_BINDING_MISSING', `Element has no style binding: ${element.id}.`)
}

function assertGroupMembersAvailable(slide: Slide, memberIds: string[], ownGroupId?: string) {
  assertUniqueElementIds(memberIds)
  for (const elementId of memberIds) requireElement(slide, elementId)
  for (const [groupId, group] of Object.entries(slide.groups ?? {})) {
    if (groupId === ownGroupId) continue
    for (const elementId of memberIds) if (group.memberIds.includes(elementId)) throw error('FLAT_GROUP_DUPLICATE_MEMBER', `Element belongs to another group: ${elementId}.`)
  }
}

function assertUniqueElementIds(elementIds: string[]) {
  if (new Set(elementIds).size !== elementIds.length) throw error('FLAT_GROUP_DUPLICATE_MEMBER', 'A flat group may not repeat an element.')
}

function boundingFrame(frames: Frame[]): Frame {
  const x = Math.min(...frames.map((frame) => frame.x))
  const y = Math.min(...frames.map((frame) => frame.y))
  const right = Math.max(...frames.map((frame) => frame.x + frame.width))
  const bottom = Math.max(...frames.map((frame) => frame.y + frame.height))
  return { x, y, width: right - x, height: bottom - y }
}

function preserveAspectRatioFrame(before: Frame, requested: Frame): Frame {
  const ratio = before.width / before.height
  let width = requested.width
  let height = width / ratio
  if (height > requested.height) {
    height = requested.height
    width = height * ratio
  }
  return { x: requested.x, y: requested.y, width, height }
}

function effectiveFontSize(document: PpteDocument, element: TextElement): number | undefined {
  const override = element.style.overrides?.fontSize
  if (typeof override === 'number' && Number.isFinite(override)) return override
  const preset = document.theme.presets?.text?.[element.style.styleRef]
  if (typeof preset?.fontSize === 'number' && Number.isFinite(preset.fontSize)) return preset.fontSize
  return undefined
}

function solveFittingFontSize(document: PpteDocument, slideId: string, element: TextElement, beforeOverrides: Record<string, unknown>, minFontSize: number, upperBound: number): number {
  if (!Number.isFinite(minFontSize) || minFontSize <= 0 || !Number.isFinite(upperBound) || upperBound < minFontSize) throw error('TEXT_FIT_UNRESOLVED', `No valid font-size interval exists for ${element.id}.`)
  const candidateFits = (fontSize: number): boolean => {
    element.style.overrides = { ...beforeOverrides, fontSize }
    return validateTextOverflow(document, slideId, element).length === 0
  }
  if (candidateFits(upperBound)) return upperBound
  if (!candidateFits(minFontSize)) throw error('TEXT_FIT_UNRESOLVED', `Text ${element.id} still overflows at the minimum font size ${minFontSize}.`)

  let low = minFontSize
  let high = upperBound
  for (let index = 0; index < 32; index += 1) {
    const middle = (low + high) / 2
    if (candidateFits(middle)) low = middle
    else high = middle
  }
  // Round down so serialization never turns a fitting value into a slightly
  // overflowing one at a measurement boundary.
  return Math.max(minFontSize, Math.floor(low * 1000) / 1000)
}

function assertTypedStyleOverrides(type: 'text' | 'image' | 'shape' | 'chart', patch: Record<string, unknown>) {
  const fields = type === 'text'
    ? new Set(['fontFamily', 'fontSize', 'fontWeight', 'color', 'lineHeight', 'letterSpacing', 'verticalAlign', 'direction'])
    : type === 'shape'
      ? new Set(['fill', 'stroke', 'radius', 'shadow'])
      : type === 'image'
        ? new Set(['border', 'radius', 'shadow'])
        : new Set(['palette', 'axisColor', 'labelColor', 'gridColor', 'lineWidth', 'cornerRadius'])
  for (const [field, value] of Object.entries(patch)) {
    if (!fields.has(field)) throw error('STYLE_OVERRIDE_INVALID', `Style override ${field} is not allowed for ${type}.`)
    if (type === 'text' && !validTextStyleField(field, value)) throw error('STYLE_OVERRIDE_INVALID', `Style override ${field} has an invalid typed value.`)
    if (type === 'shape' && !validShapeStyleField(field, value)) throw error('STYLE_OVERRIDE_INVALID', `Style override ${field} has an invalid typed value.`)
    if (type === 'image' && !validImageStyleField(field, value)) throw error('STYLE_OVERRIDE_INVALID', `Style override ${field} has an invalid typed value.`)
    if (type === 'chart' && !validChartStyleField(field, value)) throw error('STYLE_OVERRIDE_INVALID', `Style override ${field} has an invalid typed value.`)
  }
}

function validTextStyleField(field: string, value: unknown): boolean {
  if (field === 'fontFamily') return validValueOrToken(value, 'string')
  if (field === 'color') return validValueOrToken(value, 'color')
  if (field === 'fontSize' || field === 'lineHeight') return finitePositiveValue(value)
  if (field === 'fontWeight') return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 1000
  if (field === 'letterSpacing') return typeof value === 'number' && Number.isFinite(value)
  if (field === 'verticalAlign') return value === 'top' || value === 'middle' || value === 'bottom'
  if (field === 'direction') return value === 'ltr' || value === 'rtl' || value === 'auto'
  return false
}

function validShapeStyleField(field: string, value: unknown): boolean {
  if (field === 'fill') return validPaint(value)
  if (field === 'stroke') return validStroke(value)
  if (field === 'radius') return finiteNonNegativeValue(value)
  if (field === 'shadow') return validShadow(value)
  return false
}

function validImageStyleField(field: string, value: unknown): boolean {
  if (field === 'border') return validStroke(value)
  if (field === 'radius') return finiteNonNegativeValue(value)
  if (field === 'shadow') return validShadow(value)
  return false
}

function validChartStyleField(field: string, value: unknown): boolean {
  if (field === 'palette') return Array.isArray(value) && value.every((item) => validValueOrToken(item, 'color'))
  if (field === 'axisColor' || field === 'labelColor' || field === 'gridColor') return validValueOrToken(value, 'color')
  if (field === 'lineWidth') return finitePositiveValue(value)
  if (field === 'cornerRadius') return finiteNonNegativeValue(value)
  return false
}

function assertThemeToken(category: 'colors' | 'fontFamilies' | 'fontSizes' | 'spacing' | 'radii' | 'shadows', value: unknown) {
  const valid = category === 'colors' ? typeof value === 'string' && /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(value)
    : category === 'fontFamilies' ? typeof value === 'string' && value.length > 0
      : category === 'shadows' ? validShadow(value)
        : finiteNonNegativeValue(value) && (category !== 'fontSizes' || finitePositiveValue(value))
  if (!valid) throw error('STYLE_TOKEN_INVALID', `Theme token in ${category} has an invalid typed value.`)
}

function assertThemePreset(category: 'text' | 'shape' | 'image' | 'chart', value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw error('STYLE_PRESET_INVALID', `Theme ${category} preset must be an object.`)
  const record = value as Record<string, unknown>
  if (category === 'text') {
    const fields = new Set(['fontFamily', 'fontSize', 'fontWeight', 'color', 'lineHeight', 'letterSpacing', 'verticalAlign', 'direction'])
    if (!validValueOrToken(record.fontFamily, 'string') || !finitePositiveValue(record.fontSize) || !validValueOrToken(record.color, 'color')) throw error('STYLE_PRESET_INVALID', 'Text preset requires typed fontFamily, positive fontSize, and color.')
    for (const [field, fieldValue] of Object.entries(record)) if (!fields.has(field) || !validTextStyleField(field, fieldValue)) throw error('STYLE_PRESET_INVALID', `Invalid text preset field ${field}.`)
    return
  }
  const fields = category === 'shape' ? new Set(['fill', 'stroke', 'radius', 'shadow']) : category === 'image' ? new Set(['border', 'radius', 'shadow']) : new Set(['palette', 'axisColor', 'labelColor', 'gridColor', 'lineWidth', 'cornerRadius'])
  for (const [field, fieldValue] of Object.entries(record)) {
    const valid = category === 'shape' ? validShapeStyleField(field, fieldValue) : category === 'image' ? validImageStyleField(field, fieldValue) : validChartStyleField(field, fieldValue)
    if (!fields.has(field) || !valid) throw error('STYLE_PRESET_INVALID', `Invalid ${category} preset field ${field}.`)
  }
}

function validValueOrToken(value: unknown, valueType: 'string' | 'color' = 'color'): boolean {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (candidate.kind === 'token') return hasOnlyKeys(candidate, ['kind', 'token']) && typeof candidate.token === 'string' && candidate.token.length > 0
  return candidate.kind === 'value' && hasOnlyKeys(candidate, ['kind', 'value']) && typeof candidate.value === 'string' && candidate.value.length > 0 && (valueType === 'string' || /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(candidate.value))
}

function validPaint(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (candidate.kind === 'none') return hasOnlyKeys(candidate, ['kind'])
  if (candidate.kind === 'solid') return hasOnlyKeys(candidate, ['kind', 'color', 'opacity']) && validValueOrToken(candidate.color, 'color') && validOpacity(candidate.opacity)
  if (candidate.kind === 'linear-gradient') return Array.isArray(candidate.stops) && candidate.stops.length >= 2 && candidate.stops.every((stop) => {
    if (!stop || typeof stop !== 'object') return false
    const item = stop as Record<string, unknown>
    return hasOnlyKeys(item, ['offset', 'color']) && typeof item.offset === 'number' && Number.isFinite(item.offset) && item.offset >= 0 && item.offset <= 1 && validValueOrToken(item.color, 'color')
  }) && hasOnlyKeys(candidate, ['kind', 'angleDeg', 'stops', 'opacity']) && typeof candidate.angleDeg === 'number' && Number.isFinite(candidate.angleDeg) && validOpacity(candidate.opacity)
  return false
}

function validStroke(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return hasOnlyKeys(candidate, ['color', 'width', 'opacity', 'dash', 'lineCap', 'lineJoin']) && validValueOrToken(candidate.color, 'color') && finiteNonNegativeValue(candidate.width) && validOpacity(candidate.opacity)
    && (candidate.dash === undefined || Array.isArray(candidate.dash) && candidate.dash.every((segment) => finiteNonNegativeValue(segment)))
    && (candidate.lineCap === undefined || ['butt', 'round', 'square'].includes(String(candidate.lineCap)))
    && (candidate.lineJoin === undefined || ['miter', 'round', 'bevel'].includes(String(candidate.lineJoin)))
}

function validShadow(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return hasOnlyKeys(candidate, ['color', 'offsetX', 'offsetY', 'blur', 'spread', 'opacity']) && validValueOrToken(candidate.color, 'color') && typeof candidate.offsetX === 'number' && Number.isFinite(candidate.offsetX) && typeof candidate.offsetY === 'number' && Number.isFinite(candidate.offsetY) && finiteNonNegativeValue(candidate.blur) && (candidate.spread === undefined || typeof candidate.spread === 'number' && Number.isFinite(candidate.spread)) && validOpacity(candidate.opacity)
}

function validOpacity(value: unknown): boolean { return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) }

function finitePositiveValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function finiteNonNegativeValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean { return Object.keys(value).every((key) => allowed.includes(key)) }

function assertRichText(content: unknown): asserts content is TextElement['content'] {
  if (!content || typeof content !== 'object' || !Array.isArray((content as { paragraphs?: unknown }).paragraphs)) throw error('SCHEMA_INVALID', 'Rich text content must contain paragraphs.')
  const paragraphIds = new Set<string>()
  for (const paragraph of (content as TextElement['content']).paragraphs) {
    if (!paragraph || typeof paragraph !== 'object' || !paragraph.id || paragraphIds.has(paragraph.id) || !Array.isArray(paragraph.runs)) throw error('SCHEMA_INVALID', 'Rich text paragraphs require unique ids and runs.')
    paragraphIds.add(paragraph.id)
    const runIds = new Set<string>()
    for (const run of paragraph.runs) {
      if (!run || typeof run !== 'object' || !run.id || runIds.has(run.id) || typeof run.text !== 'string' || run.text.includes('\u0000')) throw error('SCHEMA_INVALID', 'Rich text runs require unique ids and NUL-free text.')
      runIds.add(run.id)
      if (Object.keys(run as unknown as Record<string, unknown>).some((key) => !['id', 'text', 'marks'].includes(key))) throw error('SCHEMA_INVALID', 'Run-level font and font-size fields are not supported.')
      if (run.marks && Object.keys(run.marks).some((key) => !['bold', 'italic', 'underline', 'strike', 'color'].includes(key))) throw error('SCHEMA_INVALID', 'Unsupported run mark.')
    }
  }
}

function assertParagraphStyle(value: unknown): asserts value is NonNullable<TextElement['paragraphStyle']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw error('SCHEMA_INVALID', 'Paragraph style must be an object.')
  const record = value as Record<string, unknown>
  const allowed = new Set(['align', 'lineHeight', 'paragraphSpacing', 'listIndent'])
  for (const [field, fieldValue] of Object.entries(record)) {
    if (!allowed.has(field)) throw error('SCHEMA_INVALID', `Unsupported paragraph style field ${field}.`)
    if (field === 'align' && !['left', 'center', 'right'].includes(String(fieldValue))) throw error('SCHEMA_INVALID', 'Paragraph style align is invalid.')
    if (field !== 'align' && (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue) || fieldValue < 0)) throw error('SCHEMA_INVALID', `Paragraph style ${field} must be a non-negative finite number.`)
  }
}

function assertBoxStyle(value: unknown): asserts value is NonNullable<TextElement['boxStyle']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw error('SCHEMA_INVALID', 'Box style must be an object.')
  const allowed = new Set(['padding', 'fill', 'stroke', 'radius', 'shadow'])
  for (const field of Object.keys(value as Record<string, unknown>)) if (!allowed.has(field)) throw error('SCHEMA_INVALID', `Unsupported box style field ${field}.`)
}

function applyFactSyncReferences(document: PpteDocument, operation: Extract<import('../../schema/src/index.js').Operation, { kind: 'fact.syncReferences' }>, runtimeProfile: 'ga-a' | 'ga-b' | 'ga-c', strict = false): AppliedOperation {
  const fact = document.facts?.[operation.factId]
  if (!fact) throw error('FACT_REFERENCE_MISSING', `Fact does not exist: ${operation.factId}.`)
  assertUniqueElementIds(operation.targetElementIds)
  const inverse: Operation[] = []
  for (const elementId of operation.targetElementIds) {
    const found = findElement(document, elementId)
    if (!found) throw error('ELEMENT_MISSING', `Element does not exist: ${elementId}.`)
    if (operation.strategy === 'update-chart-values') {
      if (found.element.type !== 'chart') throw error('OPERATION_TYPE_MISMATCH', 'update-chart-values requires Chart targets.')
      assertValidChart(found.element, runtimeProfile)
      const before = cloneJson(found.element.data)
      const result = syncChartFact(found.element, fact, operation.previousValue)
      if (!result.changed) throw error('CHART_FACT_INCONSISTENT', `No safe chart cell matched Fact ${operation.factId} on ${found.element.id}.`)
      found.element.data = result.data
      inverse.unshift(op(operation, 'chart.replaceData', { slideId: found.slideId, elementId: found.element.id, data: before }))
      continue
    }
    if (found.element.type !== 'text') throw error('OPERATION_TYPE_MISMATCH', 'replace-display-value requires Text targets.')
    const before = cloneJson(found.element.content)
    const display = formatFactValue(fact)
    const previousFact = operation.previousValue === undefined ? fact : { ...fact, value: operation.previousValue }
    const oldDisplay = formatFactValue(previousFact)
    const nextContent = cloneJson(found.element.content)
    const runs = nextContent.paragraphs.flatMap((paragraph) => paragraph.runs)
    const occurrences = oldDisplay ? runs.reduce((count, run) => count + countOccurrences(run.text, oldDisplay), 0) : 0
    if (strict && operation.previousValue === undefined) throw error('FACT_SYNC_CONFLICT', `Fact ${operation.factId} synchronization requires previousValue for Text ${found.element.id}.`)
    if (strict && occurrences !== 1) throw error('FACT_SYNC_CONFLICT', `Fact ${operation.factId} does not have one uniquely matching prior display in Text ${found.element.id}.`)
    if (runs.length === 0) {
      if (strict) throw error('FACT_SYNC_CONFLICT', `Text ${found.element.id} has no display range for Fact ${operation.factId}.`)
      nextContent.paragraphs = [{ id: `${found.element.id}-fact`, runs: [{ id: `${found.element.id}-fact-run`, text: display }] }]
    } else if (occurrences === 1) {
      let replaced = false
      for (const run of runs) if (!replaced && run.text.includes(oldDisplay)) { run.text = run.text.replace(oldDisplay, display); replaced = true }
    } else if (strict) {
      throw error('FACT_SYNC_CONFLICT', `Fact ${operation.factId} has no safe prior display match in Text ${found.element.id}.`)
    } else {
      // Keep the legacy low-level applyOperation behavior for callers that use
      // it as a primitive. Core Sessions always enable strict synchronization.
      runs[0]!.text = display
      for (const run of runs.slice(1)) run.text = ''
    }
    found.element.content = nextContent
    inverse.unshift(op(operation, 'text.replaceContent', { slideId: found.slideId, elementId: found.element.id, content: before }))
  }
  return { document, inverse }
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let offset = 0
  while (true) {
    const index = text.indexOf(needle, offset)
    if (index < 0) return count
    count += 1
    offset = index + needle.length
  }
}

function findElement(document: PpteDocument, elementId: string): { slideId: string; element: Element } | undefined {
  for (const slideId of document.slideOrder) {
    const element = document.slides[slideId]?.elements[elementId]
    if (element) return { slideId, element }
  }
  return undefined
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

/**
 * Rekey every instance-local identity in a copied slide. Semantic keys and
 * Fact/Source identities intentionally remain unchanged because they are
 * business identities scoped to a slide or document, respectively.
 */
export function rekeySlide(source: Slide, newSlideId: string, offset: { x: number; y: number } = { x: 0, y: 0 }): Slide {
  if (!newSlideId || newSlideId === source.id) throw error('ID_CONFLICT', `New slide id must differ from ${source.id}.`)
  assertFinite(offset.x, offset.y)
  const elementIds = buildRekeyMap(Object.keys(source.elements), newSlideId, 'element')
  const groupIds = buildRekeyMap(Object.keys(source.groups ?? {}), newSlideId, 'group')
  const elements = Object.fromEntries(Object.entries(source.elements).map(([oldId, value]) => {
    const element = cloneJson(value)
    const newId = elementIds.get(oldId)!
    element.id = newId
    element.frame = { ...element.frame, x: element.frame.x + offset.x, y: element.frame.y + offset.y }
    if (element.provenance?.replacesElementId) element.provenance.replacesElementId = elementIds.get(element.provenance.replacesElementId) ?? element.provenance.replacesElementId
    if (element.type === 'text') {
      const paragraphIds = buildRekeyMap(element.content.paragraphs.map((paragraph, paragraphIndex) => paragraph.id || String(paragraphIndex)), newId, 'paragraph')
      element.content.paragraphs = element.content.paragraphs.map((paragraph, paragraphIndex) => {
        const paragraphId = paragraphIds.get(paragraph.id || String(paragraphIndex))!
        const runIds = buildRekeyMap(paragraph.runs.map((run, runIndex) => run.id || String(runIndex)), paragraphId, 'run')
        const runs = paragraph.runs.map((run, runIndex) => {
          const runId = runIds.get(run.id || String(runIndex))!
          return { ...run, id: runId }
        })
        return { ...paragraph, id: paragraphId, runs }
      })
    }
    return [newId, element]
  })) as Slide['elements']
  const groups = Object.fromEntries(Object.entries(source.groups ?? {}).map(([oldId, value]) => {
    const group = cloneJson(value)
    const newId = groupIds.get(oldId)!
    group.id = newId
    group.memberIds = group.memberIds.map((elementId) => elementIds.get(elementId) ?? elementId)
    return [newId, group]
  }))
  const duplicate = cloneJson(source)
  duplicate.id = newSlideId
  duplicate.elements = elements
  duplicate.rootOrder = source.rootOrder.map((elementId) => elementIds.get(elementId) ?? elementId)
  if (source.readingOrder) duplicate.readingOrder = source.readingOrder.map((elementId) => elementIds.get(elementId) ?? elementId)
  if (source.groups) duplicate.groups = groups
  if (source.protectedAnchors) duplicate.protectedAnchors = source.protectedAnchors.map((anchor) => {
    const next = cloneJson(anchor)
    if (next.target.kind === 'element') next.target.elementId = elementIds.get(next.target.elementId) ?? next.target.elementId
    return next
  })
  return duplicate
}

function rekeyInstanceId(owner: string, kind: string, sourceId: string): string {
  const safe = sourceId.replace(/[^A-Za-z0-9_-]/g, '_')
  return `${owner}__${kind}__${safe}`
}

function buildRekeyMap(sourceIds: string[], owner: string, kind: string): Map<string, string> {
  const result = new Map<string, string>()
  const used = new Set<string>()
  for (const sourceId of sourceIds) {
    const base = rekeyInstanceId(owner, kind, sourceId)
    let candidate = base
    let suffix = 2
    while (used.has(candidate)) candidate = `${base}__${suffix++}`
    used.add(candidate)
    result.set(sourceId, candidate)
  }
  return result
}

function assertTransition(value: unknown): asserts value is NonNullable<Slide['transition']> {
  if (!value || typeof value !== 'object' || !['none', 'fade', 'slide', 'push'].includes(String((value as { type?: unknown }).type))) throw error('SCHEMA_INVALID', 'Slide transition type is invalid.')
  const transition = value as { durationMs?: unknown; direction?: unknown }
  if (transition.durationMs !== undefined && (!Number.isInteger(transition.durationMs) || Number(transition.durationMs) < 0)) throw error('SCHEMA_INVALID', 'Slide transition durationMs must be a non-negative integer.')
  if (transition.direction !== undefined && !['left', 'right', 'up', 'down'].includes(String(transition.direction))) throw error('SCHEMA_INVALID', 'Slide transition direction is invalid.')
}

function assertAnimation(value: unknown): asserts value is NonNullable<import('../../schema/src/index.js').ElementAnimation> {
  if (!value || typeof value !== 'object') throw error('SCHEMA_INVALID', 'Element animation must be an object.')
  for (const key of ['enter', 'exit'] as const) {
    const spec = (value as Record<string, unknown>)[key]
    if (spec === undefined) continue
    if (!spec || typeof spec !== 'object' || !['fade', 'slide-up', 'slide-left', 'scale'].includes(String((spec as { type?: unknown }).type))) throw error('SCHEMA_INVALID', `Element animation ${key} type is invalid.`)
    const record = spec as { durationMs?: unknown; delayMs?: unknown; easing?: unknown }
    for (const field of ['durationMs', 'delayMs'] as const) if (record[field] !== undefined && (!Number.isInteger(record[field]) || Number(record[field]) < 0)) throw error('SCHEMA_INVALID', `Element animation ${key}.${field} must be a non-negative integer.`)
    if (record.easing !== undefined && !['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'].includes(String(record.easing))) throw error('SCHEMA_INVALID', `Element animation ${key}.easing is invalid.`)
  }
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
function requireChart(document: PpteDocument, slideId: string, elementId: string, runtimeProfile: 'ga-a' | 'ga-b' | 'ga-c' = 'ga-b'): ChartElement {
  const element = requireElement(requireSlide(document, slideId), elementId)
  if (element.type !== 'chart') throw error('OPERATION_TYPE_MISMATCH', 'Chart operation requires a Chart element.')
  assertValidChart(element, runtimeProfile)
  return element
}
function assertValidChart(element: ChartElement, runtimeProfile: 'ga-a' | 'ga-b' | 'ga-c' = 'ga-b'): void {
  const issue = validateChartContract(element, { runtimeSubset: true, runtimeProfile: runtimeProfile === 'ga-c' ? 'ga-c' : 'ga-b' })[0]
  if (issue) throw error(issue.code, issue.message)
}

function assertComponentProps(value: unknown): asserts value is Record<string, import('../../schema/src/index.js').JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !isJsonValue(value)) throw error('SCHEMA_INVALID', 'Component props must be a JSON object.')
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (value && typeof value === 'object') return Object.values(value).every(isJsonValue)
  return false
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
  const record = payload as Record<string, unknown>
  const identity = ['slideId', 'elementId', 'groupId', 'factId', 'sourceId']
    .map((key) => typeof record[key] === 'string' ? `${key}=${record[key]}` : undefined)
    .filter(Boolean)
    .join('|')
  return { opId: `${source.opId}:inverse:${kind}${identity ? `:${identity}` : ''}`, kind, ...payload } as Extract<Operation, { kind: K }>
}
