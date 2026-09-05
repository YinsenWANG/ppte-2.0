import { cloneJson } from '../../canonical-json/src/index.js'
import { renderTextPlain } from '../../renderer-react/src/index.js'
import type { PpteDocument, SlideIR, Element, BlockIR, JsonValue } from '../../schema/src/index.js'

export function inferSlideIR(document: PpteDocument, slideId: string): SlideIR {
  const slide = document.slides[slideId]
  if (!slide) throw new Error(`SLIDE_MISSING: ${slideId}`)
  const blocks = slide.rootOrder.map((elementId) => slide.elements[elementId]).filter((element): element is Element => Boolean(element)).filter((element) => element.role !== 'decorative' && element.role !== 'background').map(elementToBlock)
  const purpose = slide.semantic?.purpose ?? 'custom'
  return { irVersion: '1.0' as const, slideKey: slideId, purpose, message: slide.semantic?.keyMessage || slide.name || slideId, visualStrategy: slide.visualStrategy ?? 'structured', density: 'medium' as const, blocks, ...(slide.visualStrategy === 'hybrid' ? { artworkIntent: { subject: 'existing artwork', function: 'illustration' as const, placement: 'side' as const } } : {}) }
}

function elementToBlock(element: Element): BlockIR {
  if (element.type === 'text') {
    const kind: BlockIR['kind'] = element.role === 'title' ? 'heading' : element.role === 'source' ? 'source' : element.role === 'metric' ? 'metric' : element.role === 'cta' ? 'cta' : 'paragraph'
    return { key: element.id, kind, content: renderTextPlain(element), semanticKey: element.semanticKey, ...(element.semanticRefs?.factIds ? { factIds: cloneJson(element.semanticRefs.factIds) } : {}), ...(element.semanticRefs?.sourceIds ? { sourceIds: cloneJson(element.semanticRefs.sourceIds) } : {}), importance: element.role === 'title' ? 'primary' as const : 'supporting' as const, editabilityTarget: 'full' as const }
  }
  if (element.type === 'image') return { key: element.id, kind: 'image' as const, content: { assetId: element.assetId }, semanticKey: element.semanticKey, ...(element.semanticRefs?.factIds ? { factIds: cloneJson(element.semanticRefs.factIds) } : {}), ...(element.semanticRefs?.sourceIds ? { sourceIds: cloneJson(element.semanticRefs.sourceIds) } : {}), importance: element.role === 'artwork' ? 'supporting' as const : 'secondary' as const, editabilityTarget: 'replace' as const }
  if (element.type === 'chart') return { key: element.id, kind: 'chart' as const, content: { chartType: element.chartType, data: element.data } as unknown as JsonValue, semanticKey: element.semanticKey, ...(element.semanticRefs?.factIds ? { factIds: cloneJson(element.semanticRefs.factIds) } : {}), ...(element.semanticRefs?.sourceIds ? { sourceIds: cloneJson(element.semanticRefs.sourceIds) } : {}), importance: 'secondary' as const, editabilityTarget: 'property' as const }
  return { key: element.id, kind: 'paragraph' as const, content: element.description ?? '', semanticKey: element.semanticKey, ...(element.semanticRefs?.factIds ? { factIds: cloneJson(element.semanticRefs.factIds) } : {}), ...(element.semanticRefs?.sourceIds ? { sourceIds: cloneJson(element.semanticRefs.sourceIds) } : {}), importance: 'supporting' as const, editabilityTarget: 'property' as const }
}
