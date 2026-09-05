import { canonicalHash, equalJson } from '../../canonical-json/src/index.js'
import type { Element, PpteDocument, StructuralDiff, MutationSummary } from '../../schema/src/index.js'

export function computeStructuralDiff(before: PpteDocument, after: PpteDocument): StructuralDiff {
  const addedSlides = after.slideOrder.filter((slideId) => !before.slides[slideId])
  const removedSlides = before.slideOrder.filter((slideId) => !after.slides[slideId])
  const changedSlides = after.slideOrder.filter((slideId) => before.slides[slideId] && !equalJson(before.slides[slideId], after.slides[slideId]))
  const addedElements: StructuralDiff['addedElements'] = []
  const removedElements: StructuralDiff['removedElements'] = []
  const changedElementIds = new Set<string>()
  const replacedElements: StructuralDiff['replacedElements'] = []

  for (const slideId of new Set([...before.slideOrder, ...after.slideOrder])) {
    const beforeElements = before.slides[slideId]?.elements ?? {}
    const afterElements = after.slides[slideId]?.elements ?? {}
    for (const elementId of Object.keys(afterElements)) {
      if (!beforeElements[elementId]) addedElements.push({ slideId, elementId })
      else if (!equalJson(beforeElements[elementId], afterElements[elementId])) changedElementIds.add(elementId)
    }
    for (const elementId of Object.keys(beforeElements)) if (!afterElements[elementId]) removedElements.push({ slideId, elementId })

    const beforeByKey = new Map(Object.values(beforeElements).filter((element) => element.semanticKey).map((element) => [element.semanticKey as string, element]))
    const afterByKey = new Map(Object.values(afterElements).filter((element) => element.semanticKey).map((element) => [element.semanticKey as string, element]))
    for (const [semanticKey, beforeElement] of beforeByKey) {
      const afterElement = afterByKey.get(semanticKey)
      if (afterElement && beforeElement.id !== afterElement.id && (afterElement.provenance?.replacesElementId === beforeElement.id || afterElement.provenance?.sourceSemanticKey === semanticKey)) {
        replacedElements.push({ slideId, beforeElementId: beforeElement.id, afterElementId: afterElement.id, semanticKey })
      }
    }
    for (const afterElement of Object.values(afterElements)) {
      const beforeElementId = afterElement.provenance?.replacesElementId
      const beforeElement = beforeElementId ? beforeElements[beforeElementId] : undefined
      if (!beforeElement || beforeElement.id === afterElement.id || replacedElements.some((item) => item.slideId === slideId && item.beforeElementId === beforeElement.id && item.afterElementId === afterElement.id)) continue
      replacedElements.push({ slideId, beforeElementId: beforeElement.id, afterElementId: afterElement.id, ...(afterElement.semanticKey ?? beforeElement.semanticKey ? { semanticKey: afterElement.semanticKey ?? beforeElement.semanticKey } : {}) })
    }
  }

  const replacedElementIds = new Set(replacedElements.flatMap((item) => [item.beforeElementId, item.afterElementId]))
  const changedElementCount = new Set([
    ...changedElementIds,
    ...addedElements.map((item) => item.elementId),
    ...removedElements.map((item) => item.elementId),
  ].filter((elementId) => !replacedElementIds.has(elementId))).size + replacedElements.length
  const changedPaths = deepChangedPaths(before, after)
  const mutationSummary: MutationSummary = {
    changedSlides: new Set([...changedSlides, ...addedSlides, ...removedSlides]).size,
    changedElements: changedElementCount,
    insertedElements: addedElements.length,
    deletedElements: removedElements.length,
    replacedAssets: countAssetReplacements(before, after),
    changedFacts: changedMapKeys(before.facts ?? {}, after.facts ?? {}),
    changedSources: changedMapKeys(before.sources ?? {}, after.sources ?? {}),
    changedThemeTokens: changedThemeTokens(before, after),
    changedStylePresets: changedStylePresets(before, after),
  }
  return { addedSlides, removedSlides, changedSlides, addedElements, removedElements, replacedElements, changedPaths, mutationSummary }
}

export function deepChangedPaths(before: unknown, after: unknown): string[] {
  const paths: string[] = []
  walk(before, after, '', paths)
  return paths
}

export function elementFieldHash(element: Element, field: 'content' | 'style' | 'geometry' | 'asset' | 'identity'): string {
  if (field === 'content') return hashPresent(element.type === 'text' ? element.content : element.type === 'chart' ? { data: element.data, encoding: element.encoding, options: element.options } : undefined)
  if (field === 'style') return hashPresent(element.type === 'text' || element.type === 'shape' || element.type === 'image' || element.type === 'chart' ? element.style : undefined)
  if (field === 'geometry') return hashPresent({ frame: element.frame, rotationDeg: element.rotationDeg, flipX: element.flipX, flipY: element.flipY })
  if (field === 'asset') return hashPresent(element.type === 'image' ? { assetId: element.assetId, crop: element.crop, focalPoint: element.focalPoint } : undefined)
  return hashPresent({ id: element.id, semanticKey: element.semanticKey })
}

function walk(before: unknown, after: unknown, path: string, paths: string[]) {
  if (before === after) return
  if (isRecord(before) && isRecord(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    for (const key of [...keys].sort()) walk(before[key], after[key], `${path}/${escapePointer(key)}`, paths)
    return
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length)
    for (let index = 0; index < length; index += 1) walk(before[index], after[index], `${path}/${index}`, paths)
    return
  }
  paths.push(path || '/')
}

function countAssetReplacements(before: PpteDocument, after: PpteDocument): number {
  let count = 0
  for (const slideId of before.slideOrder) {
    const beforeElements = before.slides[slideId]?.elements ?? {}
    const afterElements = after.slides[slideId]?.elements ?? {}
    for (const elementId of Object.keys(beforeElements)) {
      const oldElement = beforeElements[elementId]
      if (oldElement?.type !== 'image') continue
      const newElement = matchingImageReplacement(oldElement, afterElements)
      if (newElement?.type === 'image' && oldElement.assetId !== newElement.assetId) count += 1
    }
  }
  return count
}

function matchingImageReplacement(oldElement: Extract<Element, { type: 'image' }>, afterElements: Record<string, Element>): Extract<Element, { type: 'image' }> | undefined {
  const sameId = afterElements[oldElement.id]
  if (sameId?.type === 'image') return sameId
  return Object.values(afterElements).find((candidate): candidate is Extract<Element, { type: 'image' }> => candidate.type === 'image' && (candidate.provenance?.replacesElementId === oldElement.id || candidate.semanticKey === oldElement.semanticKey && candidate.provenance?.sourceSemanticKey === oldElement.semanticKey))
}
function changedMapKeys(before: Record<string, unknown>, after: Record<string, unknown>): number {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => !equalJson(before[key], after[key])).length
}
function changedThemeTokens(before: PpteDocument, after: PpteDocument): number {
  return changedMapKeys(before.theme.tokens.colors, after.theme.tokens.colors) + changedMapKeys(before.theme.tokens.fontFamilies, after.theme.tokens.fontFamilies) + changedMapKeys(before.theme.tokens.fontSizes, after.theme.tokens.fontSizes) + changedMapKeys(before.theme.tokens.spacing, after.theme.tokens.spacing) + changedMapKeys(before.theme.tokens.radii, after.theme.tokens.radii) + changedMapKeys(before.theme.tokens.shadows, after.theme.tokens.shadows)
}
function changedStylePresets(before: PpteDocument, after: PpteDocument): number {
  return (['text', 'shape', 'image', 'chart'] as const).reduce((sum, category) => sum + changedMapKeys(before.theme.presets[category], after.theme.presets[category]), 0)
}
function hashPresent(value: unknown): string {
  return canonicalHash({ present: value !== undefined, value: value === undefined ? null : value })
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
function escapePointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}
