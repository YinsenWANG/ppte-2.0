import type { RichTextDocument } from '../../schema/src/index.js'
export interface TextPosition { paragraphId: string; runId: string; offset: number; affinity: 'forward' | 'backward' }
export interface TextRange { anchor: TextPosition; head: TextPosition }
export const textOf = (doc: RichTextDocument): string => doc.paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\n')
export function boundaries(text: string): number[] {
  return [...new Intl.Segmenter(undefined, {granularity:'grapheme'}).segment(text)].map(s => s.index).concat(text.length)
}
export function snap(text: string, offset: number, affinity: TextPosition['affinity']): number {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) throw new Error('Invalid UTF-16 offset')
  const points = boundaries(text)
  return affinity === 'forward' ? points.find(p => p >= offset)! : points.filter(p => p <= offset).at(-1)!
}
export function offsetOf(doc: RichTextDocument, position: TextPosition): number {
  let offset = 0
  for (const p of doc.paragraphs) {
    for (const r of p.runs) {
      if (p.id === position.paragraphId && r.id === position.runId) {
        if (position.offset < 0 || position.offset > r.text.length) throw new Error('Stale text position')
        const result = offset + position.offset
        if (snap(textOf(doc), result, position.affinity) !== result) throw new Error('Position splits a grapheme')
        return result
      }
      offset += r.text.length
    }
    offset++
  }
  throw new Error('Stale text position')
}
export function positionAt(doc: RichTextDocument, offset: number, affinity: TextPosition['affinity'] = 'forward'): TextPosition {
  offset = snap(textOf(doc), offset, affinity)
  let cursor = 0
  for (const p of doc.paragraphs) {
    for (let i = 0; i < p.runs.length; i++) {
      const r = p.runs[i], end = cursor + r.text.length
      if (offset < end || (offset === end && (affinity === 'backward' || i === p.runs.length - 1))) return {paragraphId:p.id, runId:r.id, offset:offset-cursor, affinity}
      cursor = end
    }
    cursor++
  }
  throw new Error('Invalid text position')
}
export function orderedRange(doc: RichTextDocument, range: TextRange): [number, number] {
  return [offsetOf(doc,range.anchor), offsetOf(doc,range.head)].sort((a,b)=>a-b) as [number,number]
}
/** A marks-only transform keeps code units fixed, while split run IDs change. */
export function positionMap(before: RichTextDocument, after: RichTextDocument) {
  return (p: TextPosition): TextPosition => positionAt(after, offsetOf(before,p), p.affinity)
}
