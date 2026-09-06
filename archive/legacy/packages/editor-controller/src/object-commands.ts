import { planTransform, type TransformCommand } from './transform-session.js'
import { cloneJson, equalJson } from '../../canonical-json/src/index.js'
import { resolveEffectiveStyle } from '../../validation/src/index.js'
import type { Element, Operation, Paint, ParagraphStyle, PpteDocument, ShapeKind, ShapeStyle, Stroke, TextStyle, Transaction } from '../../schema/src/index.js'

/** Object formatting is always whole-box; no Run font fields are introduced. */
export type ObjectPropertyCommand =
  | { kind: 'transform'; command: TransformCommand }
  | { kind: 'shape-stroke'; patch: Partial<Stroke> }
  | { kind: 'shape-kind'; shape: ShapeKind }
  | { kind: 'shape-style'; patch: Partial<ShapeStyle> }
  | { kind: 'text-style'; patch: Partial<TextStyle> }
  | { kind: 'paragraph'; patch: ParagraphStyle }
  | { kind: 'background'; paint: Paint | 'inherit' }
  | { kind: 'insert'; element: Element }

export type MixedValue<T> = { state: 'empty' } | { state: 'mixed' } | { state: 'value'; value: T }
export function mixedValue<T>(values: readonly T[]): MixedValue<T> {
  if (!values.length) return {state:'empty'}
  return values.every(value => equalJson(value, values[0])) ? {state:'value',value:cloneJson(values[0])} : {state:'mixed'}
}
export function objectPropertyValues(document: PpteDocument, slideId: string, ids: string[], key: string): MixedValue<unknown> {
  return mixedValue(ids.map(id => {
    const element = document.slides[slideId]?.elements[id]
    if (!element) throw new Error(`ELEMENT_MISSING: ${id}`)
    if (key === 'stroke.width') return (resolveEffectiveStyle(document,element).stroke as Stroke | undefined)?.width ?? 0
    if (key === 'shape') return element.type === 'shape' ? element.shape : undefined
    if (key === 'align' || key === 'lineHeight' || key === 'paragraphSpacing') {
      if (element.type !== 'text') return undefined
      return element.paragraphStyle?.[key] ?? (key === 'align' ? 'left' : resolveEffectiveStyle(document,element)[key])
    }
    return resolveEffectiveStyle(document,element)[key]
  }))
}

/** Plan the complete selection before emitting anything. Unsupported members are never skipped. */
export function objectPropertyOperations(document: PpteDocument, slideId: string, ids: string[], command: ObjectPropertyCommand, opId: string): Operation[] {
  if(command.kind === 'transform') throw Error('USE_TRANSFORM_PLANNER')
  const slide = document.slides[slideId]
  if (!slide) throw new Error(`SLIDE_MISSING: ${slideId}`)
  if (command.kind === 'background') return [{opId,kind:'slide.update',slideId,patch:command.paint === 'inherit' ? {} : {background:cloneJson(command.paint)},...(command.paint === 'inherit' ? {unset:['background'] as ['background']} : {})}]
  if (command.kind === 'insert') return [{opId,kind:'element.insert',slideId,element:cloneJson(command.element),index:slide.rootOrder.length,...(slide.readingOrder ? {readingOrderIndex:slide.readingOrder.length} : {})}]
  if (!ids.length) throw new Error('SELECTION_EMPTY')
  return [...new Set(ids)].map((elementId,index): Operation => {
    const element = slide.elements[elementId]
    if (!element) throw new Error(`ELEMENT_MISSING: ${elementId}`)
    const base = {opId:`${opId}:${index}`,slideId,elementId}
    if (command.kind === 'shape-stroke') {
      if (element.type !== 'shape') throw new Error('OPERATION_TYPE_MISMATCH: select shapes only')
      const stroke = element.style.overrides?.stroke ?? document.theme.presets.shape[element.style.styleRef]?.stroke ?? {width:0,color:{kind:'value' as const,value:'#000000' as const}}
      return {...base,kind:'shape.updateStyle',patch:{stroke:{...cloneJson(stroke),...cloneJson(command.patch)}}}
    }
    if (command.kind === 'shape-kind') {
      if (element.type !== 'shape') throw new Error('OPERATION_TYPE_MISMATCH: select shapes only')
      return {...base,kind:'shape.setKind',shape:command.shape}
    }
    if (command.kind === 'shape-style') {
      if (element.type !== 'shape') throw new Error('OPERATION_TYPE_MISMATCH: select shapes only')
      return {...base,kind:'shape.updateStyle',patch:cloneJson(command.patch)}
    }
    if (element.type !== 'text') throw new Error('OPERATION_TYPE_MISMATCH: select text boxes only')
    if (command.kind === 'paragraph') return {...base,kind:'text.updateStyle',paragraphStyle:{...element.paragraphStyle,...cloneJson(command.patch)}}
    return {...base,kind:'element.updateStyleOverrides',patch:cloneJson(command.patch) as Extract<Operation,{kind:'element.updateStyleOverrides'}>['patch']}
  })
}

export function planObjectProperty(document: PpteDocument, input: {revision:string; slideId:string; ids:string[]; command:ObjectPropertyCommand; transactionId:string; createdAt:string}): Transaction {
  if(input.command.kind === 'transform') { const tx=planTransform(document,{...input,command:input.command.command}); if(!tx)throw Error('TRANSFORM_NO_CHANGE'); return tx }
  const operations = objectPropertyOperations(document,input.slideId,input.ids,input.command,input.transactionId)
  const page = input.command.kind === 'background', insert = input.command.kind === 'insert'
  return {
    transactionId:input.transactionId,baseRevision:input.revision,createdAt:input.createdAt,actor:{type:'human',id:'object-properties'},
    scope:{kind:page||insert?'slide':'selection',slideIds:[input.slideId],...(!page&&!insert?{elementIds:[...new Set(input.ids)]}:{}),permissions:[insert||page?'structure':'style'],allowInsert:insert,allowDelete:false},
    changeContract:{allowedOperationKinds:[...new Set(operations.map(op=>op.kind))],maxChangedSlides:1,maxInsertedElements:insert?1:0,maxDeletedElements:0,maxChangedThemeTokens:0,maxChangedStylePresets:0,requireConfirmation:false},operations,
  }
}

export function createBasicObject(document: PpteDocument, id: string, kind: 'text' | ShapeKind): Element {
  const frame = {x:40,y:40,width:240,height:120}
  if (kind === 'text') {
    const styleRef = Object.keys(document.theme.presets.text)[0]
    if (!styleRef) throw new Error('STYLE_PRESET_MISSING: text')
    return {id,type:'text',frame,style:{styleRef},content:{paragraphs:[{id:`${id}:p`,runs:[{id:`${id}:r`,text:'文字'}]}]}}
  }
  if (kind === 'polygon') throw new Error('POLYGON_REQUIRES_POINTS')
  const styleRef = Object.keys(document.theme.presets.shape)[0]
  if (!styleRef) throw new Error('STYLE_PRESET_MISSING: shape')
  return {id,type:'shape',frame,shape:kind,style:{styleRef}}
}
