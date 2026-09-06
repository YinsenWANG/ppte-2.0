import { cloneJson } from '../../canonical-json/src/index.js'
import { withErrorSemantics } from '../../schema/src/errors.js'
import type { Element, ElementId, PpteDocument, SlideId, ValidationIssue } from '../../schema/src/index.js'

export interface SemanticKeyMatch {
  slideId: SlideId
  elementId: ElementId
  element: Element
}

/** Return every match so callers cannot silently pick an ambiguous business identity. */
export function resolveSemanticKeyMatches(document: PpteDocument, slideId: SlideId, semanticKey: string): SemanticKeyMatch[] {
  return Object.values(document.slides?.[slideId]?.elements ?? {})
    .filter((element) => element.semanticKey === semanticKey)
    .map((element) => ({ slideId, elementId: element.id, element }))
}

/** Resolve only an unambiguous semantic key. */
export function resolveSemanticKey(document: PpteDocument, slideId: SlideId, semanticKey: string): Element | undefined {
  const matches = resolveSemanticKeyMatches(document, slideId, semanticKey)
  return matches.length === 1 ? matches[0].element : undefined
}

/** Carry a business identity across an explicit replacement, never across a direct edit. */
export function inheritSemanticIdentity(replacement: Element, previous: Element): Element {
  const next = cloneJson(replacement)
  if (next.id === previous.id) throw new Error('SEMANTIC_LINEAGE_CYCLE: replacement must have a new element id.')
  if (previous.semanticKey && next.semanticKey && next.semanticKey !== previous.semanticKey) throw new Error(`SEMANTIC_KEY_CONFLICT: replacement must inherit ${previous.semanticKey}.`)
  if (previous.semanticKey) next.semanticKey = previous.semanticKey
  next.provenance = {
    ...next.provenance,
    replacesElementId: previous.id,
    ...(previous.semanticKey ? { sourceSemanticKey: previous.semanticKey } : {}),
  }
  return next
}

/**
 * Build a replacement element from the current slide without mutating it. The
 * caller still has to submit the resulting insert/delete operations through
 * the Operation Engine.
 */
export function buildReplacementElement(document: PpteDocument, slideId: SlideId, previousElementId: ElementId, replacement: Element): Element {
  const previous = document.slides[slideId]?.elements[previousElementId]
  if (!previous) throw new Error(`ELEMENT_MISSING: ${previousElementId}`)
  return inheritSemanticIdentity(replacement, previous)
}

export function validateSemanticIdentity(document: PpteDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const replacementGraph = new Map<string, string>()
  const currentElementIds = new Set<string>()
  for (const slide of Object.values(document.slides ?? {})) {
    if (!slide || typeof slide !== 'object') continue
    const keys = new Set<string>()
    for (const element of Object.values(slide.elements ?? {})) {
      if (!element || typeof element !== 'object') continue
      if (currentElementIds.has(element.id)) issues.push({ code: 'ELEMENT_ID_DUPLICATE', severity: 'error', message: `Element id ${element.id} is used more than once.`, slideId: slide.id, elementId: element.id })
      currentElementIds.add(element.id)
      if (element.semanticKey && keys.has(element.semanticKey)) issues.push({ code: 'SEMANTIC_KEY_DUPLICATE', severity: 'error', message: `Duplicate semanticKey ${element.semanticKey}.`, slideId: slide.id, semanticKey: element.semanticKey })
      if (element.semanticKey) keys.add(element.semanticKey)
      const replaces = element.provenance?.replacesElementId
      if (replaces) {
        if (replaces === element.id) issues.push({ code: 'SEMANTIC_LINEAGE_CYCLE', severity: 'error', message: `Element ${element.id} replaces itself.`, slideId: slide.id, elementId: element.id })
        if (replaces !== element.id && document.slideOrder.some((candidateSlideId) => Boolean(document.slides[candidateSlideId]?.elements[replaces]))) {
          issues.push({ code: 'SEMANTIC_LINEAGE_AMBIGUOUS', severity: 'error', message: `Replacement target ${replaces} is still active; replace operations must remove the old instance.`, slideId: slide.id, elementId: element.id })
        }
        replacementGraph.set(element.id, replaces)
      }
    }
  }
  for (const elementId of replacementGraph.keys()) {
    const seen = new Set<string>()
    let current: string | undefined = elementId
    while (current && replacementGraph.has(current)) {
      if (seen.has(current)) {
        issues.push({ code: 'SEMANTIC_LINEAGE_CYCLE', severity: 'error', message: `Replacement lineage cycles at ${current}.`, elementId: elementId })
        break
      }
      seen.add(current)
      current = replacementGraph.get(current)
    }
  }
  return issues.map(withErrorSemantics)
}
