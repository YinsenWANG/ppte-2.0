import { canonicalHash } from '../../canonical-json/src/index.js'
import type { RichTextDocument, TextElement, Transaction } from '../../schema/src/index.js'

/** Small adapter boundary for a rich-text/IME implementation. Private editor
 * state never becomes part of the semantic document until finish(). */
export class ImeTextEditSession {
  private readonly initial: RichTextDocument
  private current: RichTextDocument
  private composing = false
  private finished = false

  constructor(private readonly element: TextElement, private readonly slideId = 'current-slide') {
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
  hasChanges(): boolean { return canonicalHash(this.initial) !== canonicalHash(this.current) }

  finish(transactionId: string, baseRevision: string, createdAt = new Date().toISOString()): Transaction | undefined {
    if (this.finished || this.composing || !this.hasChanges()) return undefined
    assertSafeRichText(this.current)
    this.finished = true
    return {
      transactionId,
      baseRevision,
      actor: { type: 'human', id: 'editor' },
      scope: { kind: 'selection', slideIds: [this.slideId], elementIds: [this.element.id], permissions: ['content'], allowInsert: false, allowDelete: false },
      changeContract: {
        allowedOperationKinds: ['text.replaceContent'],
        allowedElementIds: [this.element.id],
        maxChangedSlides: 1,
        maxChangedElements: 1,
        maxInsertedElements: 0,
        maxDeletedElements: 0,
        preserve: { style: 'preserve', geometry: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' },
      },
      createdAt,
      operations: [{ opId: `${transactionId}:replace`, kind: 'text.replaceContent', slideId: this.slideId, elementId: this.element.id, content: cloneRichText(this.current) }],
    }
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
  const p=original.paragraphs[0]??{id:'p',runs:[{id:'r',text:''}]}
  const anchor=tokens[Math.max(0,left-1)]??{p,r:p.runs[0],char:''}
  const next=[...tokens.slice(0,left),...chars.slice(left,chars.length-right).map(char=>({...anchor,char})),...tokens.slice(tokens.length-right)]
  const lines: typeof next[]=[[]]
  for(const token of next) {if(token.char==='\n')lines.push([]);else lines.at(-1)!.push(token)}
  const used=new Set<string>()
  const result:RichTextDocument={paragraphs:lines.map((line,i)=>{
    const source=line[0]?.p??original.paragraphs[i]??anchor.p
    let id=source.id
    if(used.has(id))id=`${id}:edit:${i}`
    used.add(id)
    const runs:RichTextDocument['paragraphs'][number]['runs']=[]
    const runIds=new Set<string>()
    let previousSource:typeof line[number]['r']|undefined=undefined
    for(const token of line){
      const previous=runs.at(-1)
      if(previous&&previousSource===token.r)previous.text+=token.char
      else {
        let rid=token.r?.id??`${id}:run`
        if(runIds.has(rid))rid=`${rid}:edit:${runs.length}`
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
      if (run.marks && Object.keys(run.marks).some((key) => !['bold', 'italic', 'underline', 'strike', 'color'].includes(key))) throw new Error('Unsupported run mark.')
    }
  }
}
