import type { PpteDocument } from '../../schema/src/index.js'

export interface PresenterAnimationState {
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
  const slideIndex = document.slideOrder.length === 0 ? 0 : Math.max(0, Math.min(Math.floor(state.slideIndex), document.slideOrder.length - 1))
  const steps = animationSteps(document, document.slideOrder[slideIndex] ?? '')
  const step = steps.includes(state.step) ? state.step : state.step > 0 ? (steps.filter((candidate) => candidate <= state.step).at(-1) ?? 0) : 0
  return { slideIndex, step }
}

export function advancePresenterState(document: PpteDocument, state: PresenterAnimationState): PresenterAnimationState {
  const current = normalizePresenterState(document, state)
  const steps = animationSteps(document, document.slideOrder[current.slideIndex] ?? '')
  const nextStep = steps.find((candidate) => candidate > current.step)
  if (nextStep !== undefined) return { slideIndex: current.slideIndex, step: nextStep }
  return current.slideIndex < document.slideOrder.length - 1 ? { slideIndex: current.slideIndex + 1, step: 0 } : current
}

export function retreatPresenterState(document: PpteDocument, state: PresenterAnimationState): PresenterAnimationState {
  const current = normalizePresenterState(document, state)
  const steps = animationSteps(document, document.slideOrder[current.slideIndex] ?? '')
  const previousStep = steps.filter((candidate) => candidate < current.step).at(-1)
  if (previousStep !== undefined) return { slideIndex: current.slideIndex, step: previousStep }
  return current.slideIndex > 0 ? { slideIndex: current.slideIndex - 1, step: 0 } : current
}
