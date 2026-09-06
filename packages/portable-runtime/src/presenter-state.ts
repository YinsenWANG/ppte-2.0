import type { PpteDocument } from '../../schema/src/index.js'

export interface PresenterAnimationState {
  slideId?: string
  slideIndex: number
  step: number
}

/** Declared appear steps are the only clickable animation steps. */
export function animationSteps(document: PpteDocument, slideId: string): number[] {
  const slide = document.slides[slideId]
  if (!slide) return []
  return [...new Set(Object.values(slide.elements).map((element) => element.appearStep).filter((step): step is number => typeof step === 'number' && Number.isInteger(step) && step > 0))].sort((left, right) => left - right)
}

export function normalizePresenterState(document: PpteDocument, state: PresenterAnimationState): PresenterAnimationState {
  const slideIndex = document.slideOrder.length === 0 ? 0 : Math.max(0, Math.min((state.slideId && document.slideOrder.includes(state.slideId) ? document.slideOrder.indexOf(state.slideId) : Number.isFinite(state.slideIndex) ? Math.floor(state.slideIndex) : 0), document.slideOrder.length - 1))
  const steps = animationSteps(document, document.slideOrder[slideIndex] ?? '')
  const step = steps.includes(state.step) ? state.step : state.step > 0 ? (steps.filter((candidate) => candidate <= state.step).at(-1) ?? 0) : 0
  return { ...(state.slideId !== undefined ? {slideId: document.slideOrder[slideIndex] ?? ''} : {}), slideIndex, step }
}

export function advancePresenterState(document: PpteDocument, state: PresenterAnimationState): PresenterAnimationState {
  const current = normalizePresenterState(document, state)
  const steps = animationSteps(document, document.slideOrder[current.slideIndex] ?? '')
  const nextStep = steps.find((candidate) => candidate > current.step)
  if (nextStep !== undefined) return { ...current, step: nextStep }
  return current.slideIndex < document.slideOrder.length - 1 ? normalizePresenterState(document, { ...(state.slideId !== undefined ? {slideId: document.slideOrder[current.slideIndex + 1]} : {}), slideIndex: current.slideIndex + 1, step: 0 }) : current
}

export function retreatPresenterState(document: PpteDocument, state: PresenterAnimationState): PresenterAnimationState {
  const current = normalizePresenterState(document, state)
  const steps = animationSteps(document, document.slideOrder[current.slideIndex] ?? '')
  const previousStep = steps.filter((candidate) => candidate < current.step).at(-1)
  if (previousStep !== undefined) return { ...current, step: previousStep }
  if (current.step > 0) return { ...current, step: 0 }
  return current.slideIndex > 0 ? normalizePresenterState(document, { ...(state.slideId !== undefined ? {slideId: document.slideOrder[current.slideIndex - 1]} : {}), slideIndex: current.slideIndex - 1, step: animationSteps(document, document.slideOrder[current.slideIndex - 1] ?? '').at(-1) ?? 0 }) : current
}

/** Stable identity is authoritative; the index is a compatibility/viewport projection. */
export function gotoSlide(document: PpteDocument, state: PresenterAnimationState, slideId: string, step = 0): PresenterAnimationState {
  if (!document.slideOrder.includes(slideId)) return normalizePresenterState(document, state)
  return normalizePresenterState(document, {slideId, slideIndex: document.slideOrder.indexOf(slideId), step})
}
export function nextSlide(document: PpteDocument, state: PresenterAnimationState): PresenterAnimationState {
  const current = normalizePresenterState(document, state)
  const id = document.slideOrder[current.slideIndex + 1]
  return id ? gotoSlide(document, current, id) : current
}
export function previousSlide(document: PpteDocument, state: PresenterAnimationState): PresenterAnimationState {
  const current = normalizePresenterState(document, state)
  const id = document.slideOrder[current.slideIndex - 1]
  return id ? gotoSlide(document, current, id) : current
}
export const nextStep = advancePresenterState
export const previousStep = retreatPresenterState
