import { boundingFrame } from '../../geometry/src/index.js'
import type { Frame, PpteDocument, Transaction } from '../../schema/src/index.js'
import type { ElementMoveOperation } from '../../schema/src/index.js'

export interface SelectionState {
  slideId: string
  elementIds: string[]
  groupId?: string
  primaryElementId?: string
}

export interface SelectionOverlayItem {
  elementId: string
  frame: Frame
  selected: boolean
}

export function buildSelectionOverlay(document: PpteDocument, selection: SelectionState): SelectionOverlayItem[] {
  const slide = document.slides[selection.slideId]
  if (!slide) return []
  return selection.elementIds.flatMap((elementId) => slide.elements[elementId] ? [{ elementId, frame: { ...slide.elements[elementId].frame }, selected: true }] : [])
}

export interface DragTransient {
  baseRevision: string
  slideId: string
  elementId: string
  groupId?: string
  memberIds?: string[]
  pointerStart: { x: number; y: number }
  originalFrame: Frame
  currentFrame: Frame
}

export function beginDrag(document: PpteDocument, baseRevision: string, slideId: string, elementId: string, pointerStart: { x: number; y: number }, groupId?:string): DragTransient {
  const element = document.slides[slideId]?.elements[elementId]
  if (!element) throw new Error(`ELEMENT_MISSING: ${elementId}`)
  const group=groupId?document.slides[slideId].groups?.[groupId]:undefined
  const frame=group?boundingFrame(group.memberIds.map(id=>document.slides[slideId].elements[id].frame)):element.frame
  return { baseRevision, slideId, elementId, groupId, memberIds:group?.memberIds, pointerStart: { ...pointerStart }, originalFrame: { ...frame }, currentFrame: { ...frame } }
}

export function updateDrag(transient: DragTransient, pointer: { x: number; y: number }): DragTransient {
  const dx = pointer.x - transient.pointerStart.x
  const dy = pointer.y - transient.pointerStart.y
  return { ...transient, currentFrame: { ...transient.originalFrame, x: transient.originalFrame.x + dx, y: transient.originalFrame.y + dy } }
}

export function endDrag(transient: DragTransient, transactionId: string, createdAt = new Date().toISOString()): Transaction | undefined {
  if (transient.currentFrame.x === transient.originalFrame.x && transient.currentFrame.y === transient.originalFrame.y) return undefined
  const operation: Transaction['operations'][number] = transient.groupId ? {opId:`${transactionId}:move`,kind:'group.move',slideId:transient.slideId,groupId:transient.groupId,dx:transient.currentFrame.x-transient.originalFrame.x,dy:transient.currentFrame.y-transient.originalFrame.y} : { opId: `${transactionId}:move`, kind: 'element.move', slideId: transient.slideId, elementId: transient.elementId, x: transient.currentFrame.x, y: transient.currentFrame.y }
  return {
    transactionId,
    baseRevision: transient.baseRevision,
    actor: { type: 'human', id: 'editor' },
    scope: { kind: 'selection', slideIds: [transient.slideId], elementIds: (transient.memberIds??[transient.elementId]), permissions: ['geometry'], allowInsert: false, allowDelete: false },
    changeContract: {
      allowedOperationKinds: [operation.kind],
      allowedElementIds: (transient.memberIds??[transient.elementId]),
      maxChangedSlides: 1,
      maxChangedElements: transient.memberIds?.length??1,
      maxInsertedElements: 0,
      maxDeletedElements: 0,
      preserve: { content: 'preserve', data: 'preserve', style: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' },
      requireConfirmation: false,
    },
    createdAt,
    operations: [operation],
  }
}
