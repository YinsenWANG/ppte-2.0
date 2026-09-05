import { boundaries } from './ranges.js'
export * from './ranges.js'
export * from './transforms.js'
export * from './edit-buffer.js'
import { planTextReplacement } from '../../editor-controller/src/commands.js'
import { canonicalHash } from '../../canonical-json/src/index.js'
import type { RichTextDocument, TextElement, Transaction } from '../../schema/src/index.js'

/** Small adapter boundary for a rich-text/IME implementation. Private editor
 * state never becomes part of the semantic document until finish(). */
export class ImeTextEditSession {
  private readonly initial: RichTextDocument
  private current: RichTextDocument
  private composing = false
  private finished = false

  constructor(private readonly element: TextElement, private readonly slideId = 'current-slide', private readonly draftRevision?: string) {
    this.initial = cloneRichText(element.content)
    this.current = cloneRichText(element.content)
  }

  beginComposition() { this.composing = true }
  updateComposition(content: RichTextDocument) { this.current = cloneRichText(content); assertSafeRichText(this.current) }
  endComposition(content?: RichTextDocument) {
    if (content) this.updateComposition(content)
    this.composing = false
  }
  input(content: RichTextDocument) { this.current = cloneRichText(content); assertSafeRichText(this.current) }
  isComposing() { return this.composing }
  getLocalContent(): RichTextDocument { return cloneRichText(this.current) }
  retryAfterRejectedCommit(): void { this.finished = false }
  hasChanges(): boolean { return canonicalHash(this.initial) !== canonicalHash(this.current) }

  finish(transactionId: string, baseRevision: string, createdAt = new Date().toISOString()): Transaction | undefined {
    if (this.finished || this.composing || !this.hasChanges()) return undefined
    assertSafeRichText(this.current)
    this.finished = true
    return planTextReplacement({transactionId, baseRevision:this.draftRevision ?? baseRevision, createdAt, slideId:this.slideId, elementId:this.element.id, content:this.current})
  }

  cancel(): RichTextDocument {
    this.current = cloneRichText(this.initial)
    this.composing = false
    this.finished = true
    return this.getLocalContent()
  }
}

export function plainTextToRichText(value: string, paragraphPrefix = 'p'): RichTextDocument {
  if (value.includes('\u0000')) throw new Error('Text input may not contain NUL characters.')
  return { paragraphs: value.split('\n').map((line, index) => ({ id: `${paragraphPrefix}-${index + 1}`, runs: [{ id: `${paragraphPrefix}-${index + 1}-run`, text: line }] })) }
}

/** Apply a plain-text edit while retaining the semantic runs outside the
 * changed range. Newly typed characters inherit the adjacent run's marks. */
export function editRichText(original: RichTextDocument, value: string): RichTextDocument {
  if (value.includes('\u0000')) throw new Error('Text input may not contain NUL characters.')
  const tokens = original.paragraphs.flatMap((p, index) => [
    ...(index ? [{char:'\n',p,r:p.runs[0]}] : []),
    ...p.runs.flatMap(r => Array.from(r.text).map(char=>({char,p,r}))),
  ])
  const chars=Array.from(value)
  let left=0,right=0
  while(left<tokens.length&&left<chars.length&&tokens[left].char===chars[left])left++
  if(left===tokens.length&&left===chars.length)return cloneRichText(original)
  while(right<tokens.length-left&&right<chars.length-left&&tokens[tokens.length-1-right].char===chars[chars.length-1-right])right++
  // Expand the diff to complete graphemes on both sides of the edit.
  const oldText=tokens.map(t=>t.char).join(''), oldBoundaries=boundaries(oldText), newBoundaries=boundaries(value)
  while(left>0&&(!oldBoundaries.includes(tokens.slice(0,left).map(t=>t.char).join('').length)||!newBoundaries.includes(chars.slice(0,left).join('').length)))left--
  while(right>0&&(!oldBoundaries.includes(oldText.length-tokens.slice(tokens.length-right).map(t=>t.char).join('').length)||!newBoundaries.includes(value.length-chars.slice(chars.length-right).join('').length)))right--
  const p=original.paragraphs[0]??{id:'p',runs:[{id:'r',text:''}]}
  const anchor=tokens[Math.max(0,left-1)]??{p,r:p.runs[0],char:''}
  const next=[...tokens.slice(0,left),...chars.slice(left,chars.length-right).map(char=>({...anchor,char})),...tokens.slice(tokens.length-right)]
  const lines: typeof next[]=[[]]
  for(const token of next) {if(token.char==='\n')lines.push([]);else lines.at(-1)!.push(token)}
  const used=new Set<string>()
  const reserved=new Set(original.paragraphs.map(p=>p.id))
  const result:RichTextDocument={paragraphs:lines.map((line,i)=>{
    const source=line[0]?.p??original.paragraphs[i]??anchor.p
    let id=source.id
    if(used.has(id)){let suffix=i;while(reserved.has(`${id}:edit:${suffix}`)||used.has(`${id}:edit:${suffix}`))suffix++;id=`${id}:edit:${suffix}`}
    used.add(id)
    const runs:RichTextDocument['paragraphs'][number]['runs']=[]
    const runIds=new Set<string>()
    let previousSource:typeof line[number]['r']|undefined=undefined
    for(const token of line){
      const previous=runs.at(-1)
      if(previous&&previousSource===token.r)previous.text+=token.char
      else {
        let rid=token.r?.id??`${id}:run`
        if(runIds.has(rid)){let suffix=runs.length;while(runIds.has(`${rid}:edit:${suffix}`)||source.runs.some(r=>r.id===`${rid}:edit:${suffix}`))suffix++;rid=`${rid}:edit:${suffix}`}
        runIds.add(rid)
        runs.push({id:rid,text:token.char,...(token.r?.marks?{marks:{...token.r.marks}}:{})})
        previousSource=token.r
      }
    }
    if(!runs.length)runs.push({id:`${id}:empty`,text:'',...(anchor.r?.marks?{marks:{...anchor.r.marks}}:{})})
    return {...source,id,runs}
  })}
  assertSafeRichText(result)
  return result
}

export function cloneRichText(value: RichTextDocument): RichTextDocument {
  return {
    paragraphs: value.paragraphs.map((paragraph) => ({
      ...paragraph,
      runs: paragraph.runs.map((run) => run.marks ? { ...run, marks: { ...run.marks } } : { id: run.id, text: run.text }),
    })),
  }
}

/** The adapter boundary rejects private-editor fields before they reach a transaction. */
export function assertSafeRichText(value: RichTextDocument): void {
  if (!value || !Array.isArray(value.paragraphs)) throw new Error('Rich text must contain paragraphs.')
  const paragraphIds = new Set<string>()
  for (const paragraph of value.paragraphs) {
    if (!paragraph || !paragraph.id || paragraphIds.has(paragraph.id) || !Array.isArray(paragraph.runs)) throw new Error('Rich text paragraphs require unique ids and runs.')
    paragraphIds.add(paragraph.id)
    const runIds = new Set<string>()
    for (const run of paragraph.runs) {
      if (!run || !run.id || runIds.has(run.id) || typeof run.text !== 'string' || run.text.includes('\u0000')) throw new Error('Rich text runs require unique ids and NUL-free text.')
      runIds.add(run.id)
      if (Object.keys(run as unknown as Record<string, unknown>).some((key) => !['id', 'text', 'marks'].includes(key))) throw new Error('Run-level font and font-size fields are not supported.')
      if(run.marks){
        for(const key of ['bold','italic','underline','strike'] as const)if(run.marks[key]!==undefined&&typeof run.marks[key]!=='boolean')throw new Error('Boolean mark required')
        const color=run.marks.color
        if(color&&!(color.kind==='value'&&/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color.value))&&!(color.kind==='token'&&typeof color.token==='string'))throw new Error('Invalid color mark')
      }
      if (run.marks && Object.keys(run.marks).some((key) => !['bold', 'italic', 'underline', 'strike', 'color'].includes(key))) throw new Error('Unsupported run mark.')
    }
  }
}
