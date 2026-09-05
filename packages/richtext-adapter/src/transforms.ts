import type { RichTextDocument } from '../../schema/src/index.js'
import { cloneRichText, assertSafeRichText } from './index.js'
import { orderedRange, positionMap, type TextRange } from './ranges.js'
export type Marks = NonNullable<RichTextDocument['paragraphs'][number]['runs'][number]['marks']>
export type MarkPatch = { [K in keyof Marks]?: Marks[K] | null }
export function setMarks(doc: RichTextDocument, range: TextRange, patch: MarkPatch) {
  const [start,end] = orderedRange(doc,range)
  const content = cloneRichText(doc)
  let cursor = 0
  for (const p of content.paragraphs) {
    const used = new Set(p.runs.map(r => r.id))
    p.runs = p.runs.flatMap(r => {
      const lo = Math.max(0,start-cursor), hi = Math.min(r.text.length,end-cursor)
      cursor += r.text.length
      if (lo >= hi) return [r]
      const marks = {...r.marks}
      for (const [key,value] of Object.entries(patch)) {
        if (!['bold','italic','underline','strike','color'].includes(key)) throw new Error('Unsupported mark')
        if (value === null) delete (marks as Record<string,unknown>)[key]
        else (marks as Record<string,unknown>)[key] = value
      }
      if(JSON.stringify(marks)===JSON.stringify(r.marks??{}))return [r]
      const pieces = [{text:r.text.slice(0,lo),marks:r.marks},{text:r.text.slice(lo,hi),marks},{text:r.text.slice(hi),marks:r.marks}].filter(part=>part.text)
      return pieces.map((part,i)=>{
        let id=r.id
        if(i) { let n=1; while(used.has(`${r.id}:split:${n}`)) n++; id=`${r.id}:split:${n}`; used.add(id) }
        return {id,text:part.text,...(part.marks && Object.keys(part.marks).length ? {marks:part.marks} : {})}
      })
    })
    cursor++
  }
  assertSafeRichText(content)
  const map = positionMap(doc,content)
  return {content, range:{anchor:map(range.anchor),head:map(range.head)}, map, ...(start===end?{pendingMarks:patch}:{})}
}
export const clearMarks = (doc: RichTextDocument, range: TextRange) => setMarks(doc,range,{bold:null,italic:null,underline:null,strike:null,color:null})
export function mixedMarks(doc: RichTextDocument, range: TextRange): { [K in keyof Marks]?: Marks[K] | 'mixed' } {
  const [start,end] = orderedRange(doc,range)
  const samples: Marks[]=[]
  let cursor=0
  for(const p of doc.paragraphs) { for(const r of p.runs) { if(cursor+r.text.length>start&&cursor<end)samples.push(r.marks??{}); cursor+=r.text.length } cursor++ }
  const result:Record<string,unknown>={}
  for(const key of ['bold','italic','underline','strike','color'] as const) {
    const values=samples.map(m=>m[key])
    if(values.length)result[key]=values.every(v=>JSON.stringify(v)===JSON.stringify(values[0]))?values[0]:'mixed'
  }
  return result
}
