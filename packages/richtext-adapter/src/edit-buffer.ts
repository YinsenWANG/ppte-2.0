import { canonicalHash } from '../../canonical-json/src/index.js'
import type { RichTextDocument, TextElement, Transaction, ValidationIssue } from '../../schema/src/index.js'
import { planTextReplacement } from '../../editor-controller/src/commands.js'
import { assertSafeRichText, cloneRichText } from './index.js'
import type { TextRange } from './ranges.js'
export interface FlushResult { ok: boolean; issues?: ValidationIssue[] }
export class TextEditBuffer {
  private baseline: RichTextDocument
  private draft: RichTextDocument
  private composing = false
  private flushing = false
  private timer?: ReturnType<typeof setTimeout>
  error?: string
  selection?: TextRange
  constructor(readonly elementId: string, readonly slideId: string, content: RichTextDocument, public baseRevision: string, readonly burstMs = 750) {
    this.baseline=cloneRichText(content); this.draft=cloneRichText(content)
  }
  content() { return cloneRichText(this.draft) }
  dirty() { return canonicalHash(this.baseline)!==canonicalHash(this.draft) }
  isComposing() { return this.composing }
  beginComposition() { this.stopTimer(); this.composing=true }
  endComposition(content: RichTextDocument) { this.input(content); this.composing=false }
  input(content: RichTextDocument) { assertSafeRichText(content); this.draft=cloneRichText(content) }
  schedule(flush:()=>void) { this.stopTimer(); if(!this.composing)this.timer=setTimeout(flush,this.burstMs) }
  stopTimer() { if(this.timer)clearTimeout(this.timer); this.timer=undefined }
  cancel() { this.stopTimer(); this.draft=cloneRichText(this.baseline); this.composing=false; this.error=undefined }
  flush(current: TextElement | undefined, revision: string, commit:(tx:Transaction)=>FlushResult, id: string): FlushResult {
    this.stopTimer()
    const fail=(message:string):FlushResult=>{this.error=message;return {ok:false,issues:[{code:message,message,severity:'error'}]}}
    if(this.composing)return fail('COMPOSITION_ACTIVE')
    if(this.flushing)return fail('TEXT_FLUSH_BUSY')
    if(!this.dirty())return {ok:true}
    if(!current || canonicalHash(current.content)!==canonicalHash(this.baseline))return fail('TEXT_DRAFT_CONFLICT')
    this.flushing=true
    try {
      const captured=this.content()
      const tx=planTextReplacement({transactionId:id,baseRevision:revision,createdAt:new Date().toISOString(),slideId:this.slideId,elementId:this.elementId,content:captured})!
      const result=commit(tx)
      if(result.ok) {this.baseline=captured;this.baseRevision=revision;this.error=undefined}
      else this.error=result.issues?.map(i=>i.message).join('; ')??'TEXT_FLUSH_FAILED'
      return result
    } catch(cause) {return fail(String(cause))} finally {this.flushing=false}
  }
}
