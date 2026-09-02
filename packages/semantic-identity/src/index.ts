import { cloneJson } from '../../canonical-json/src/index.js'
import type { Element, PpteDocument, ValidationIssue } from '../../schema/src/index.js'

export function resolveSemanticKey(document: PpteDocument, slideId: string, semanticKey: string): Element | undefined {
  return Object.values(document.slides[slideId]?.elements ?? {}).find((element) => element.semanticKey === semanticKey)
}

/** Carry a business identity across an explicit replacement, never across a direct edit. */
export function inheritSemanticIdentity(replacement: Element, previous: Element): Element {
  const next = cloneJson(replacement)
  if (!next.semanticKey && previous.semanticKey) next.semanticKey = previous.semanticKey
  next.provenance = { ...next.provenance, replacesElementId: previous.id, sourceSemanticKey: previous.semanticKey }
  return next
}

export function validateSemanticIdentity(document: PpteDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const replacementGraph = new Map<string, string>()
  for (const slide of Object.values(document.slides)) {
    const keys = new Set<string>()
    for (const element of Object.values(slide.elements)) {
      if (element.semanticKey && keys.has(element.semanticKey)) issues.push({ code: 'SEMANTIC_KEY_DUPLICATE', severity: 'error', message: `Duplicate semanticKey ${element.semanticKey}.`, slideId: slide.id, semanticKey: element.semanticKey })
      if (element.semanticKey) keys.add(element.semanticKey)
      const replaces = element.provenance?.replacesElementId
      if (replaces) {
        if (replaces === element.id) issues.push({ code: 'SEMANTIC_LINEAGE_CYCLE', severity: 'error', message: `Element ${element.id} replaces itself.`, slideId: slide.id, elementId: element.id })
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
  return issues
}
