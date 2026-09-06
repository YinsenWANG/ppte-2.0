import { resolveRunFont, runFontFamilyCss } from '../../validation/src/index.js'
import type { RichTextDocument, TextElement, Transaction } from '../../schema/src/index.js'
import { canonicalHash } from '../../canonical-json/src/index.js'
import { editRichText } from '../../richtext-adapter/src/index.js'
import { TextEditBuffer, type FlushResult } from '../../richtext-adapter/src/edit-buffer.js'
import { offsetOf, positionAt, textOf, type TextRange } from '../../richtext-adapter/src/ranges.js'
import { setMarks, mixedMarks, type MarkPatch } from '../../richtext-adapter/src/transforms.js'

/** DOM text and offsets share one traversal; paragraph separators count once. */
function domText(root: HTMLElement) {
  let text=''
  const points=new Map<Node,number[]>()
  const block=(n:Node)=>n instanceof HTMLElement && ['P','DIV','LI','UL','OL'].includes(n.tagName)
  function visit(node:Node) {
    if(node.nodeType===3) { const start=text.length; text+=node.textContent??''; points.set(node,Array.from({length:(node.textContent?.length??0)+1},(_,i)=>start+i)); return }
    if(node instanceof HTMLElement&&node.tagName==='BR') {const at=text.length;if(node.nextSibling)text+='\n';points.set(node,[at]);return}
    const offsets=[text.length]
    Array.from(node.childNodes).forEach((child,i)=>{
      if(i && (block(child)||block(node.childNodes[i-1])))text+='\n'
      offsets[i]=text.length
      visit(child); offsets.push(text.length)
    })
    points.set(node,offsets)
  }
  visit(root)
  return {text:text.replaceAll('\u00a0',' '),points}
}
export function readText(root: HTMLElement): string { return domText(root).text }
export interface SavedTextSelection { root: HTMLElement; revision: string; contentHash: string; range: TextRange }
export function captureTextSelection(root:HTMLElement, content:RichTextDocument, revision:string): SavedTextSelection | undefined {
  const s=root.ownerDocument.getSelection()
  if(!s?.anchorNode||!s.focusNode||!root.contains(s.anchorNode)||!root.contains(s.focusNode))return
  const dom=domText(root)
  if(dom.text!==textOf(content))return
  const a=dom.points.get(s.anchorNode)?.[s.anchorOffset], h=dom.points.get(s.focusNode)?.[s.focusOffset]
  if(a===undefined||h===undefined)return
  return {root,revision,contentHash:canonicalHash(content),range:{anchor:positionAt(content,a,a===h?'forward':a<h?'backward':'forward'),head:positionAt(content,h,a<=h?'forward':'backward')}}
}
export function restoreTextSelection(saved:SavedTextSelection, root:HTMLElement, content:RichTextDocument, revision:string): boolean {
  if(saved.root!==root||!root.isConnected||saved.revision!==revision||saved.contentHash!==canonicalHash(content))return false
  const dom=domText(root)
  if(dom.text!==textOf(content))return false
  const point=(offset:number)=>{
    for(const [node,values] of dom.points) if(node.nodeType===3) {const index=values.indexOf(offset);if(index>=0)return {node,index}}
    for(const [node,values] of dom.points) {const index=values.indexOf(offset);if(index>=0)return {node,index}}
    return undefined
  }
  const a=point(offsetOf(content,saved.range.anchor)),h=point(offsetOf(content,saved.range.head))
  if(!a||!h)return false
  root.focus();root.ownerDocument.getSelection()?.setBaseAndExtent(a.node,a.index,h.node,h.index)
  return true
}
export function writeText(root:HTMLElement, content:RichTextDocument, colors:Record<string,string>={}, fonts:Record<string,string>={}) {
  const doc=root.ownerDocument
  root.replaceChildren(...content.paragraphs.map(p=>{
    const node=doc.createElement(p.list?.type==='bullet'?'ul':p.list?.type==='number'?'ol':'p');node.dataset.ppteParagraphId=p.id
    if(p.align)node.style.textAlign=p.align
    node.style.marginTop=`${p.spaceBefore??0}px`;node.style.marginBottom=`${p.spaceAfter??0}px`
    const runParent=p.list?doc.createElement('li'):node;if(runParent!==node)node.append(runParent)
    for(const r of p.runs) {
      const span=doc.createElement('span');span.dataset.ppteRunId=r.id;span.textContent=r.text
      if(r.marks?.bold)span.style.fontWeight='bold'
      if(r.marks?.fontFamily!==undefined||r.marks?.fontSize!==undefined){
        const base=root.ownerDocument.defaultView!.getComputedStyle(root)
        const font=resolveRunFont(fonts,{fontFamily:base.fontFamily,fontSize:parseFloat(base.fontSize)||28},r.marks)
        if(r.marks.fontFamily!==undefined)span.style.fontFamily=runFontFamilyCss(font.fontFamily)
        if(r.marks.fontSize!==undefined)span.style.fontSize=`${font.fontSize}px`
      }
      if(r.marks?.italic)span.style.fontStyle='italic'
      span.style.textDecoration=[r.marks?.underline?'underline':'',r.marks?.strike?'line-through':''].join(' ')
      if(r.marks?.color)span.style.color=r.marks.color.kind==='value'?r.marks.color.value:colors[r.marks.color.token]??''
      runParent.append(span)
    }
    return node
  }))
}
const reconciledMarkup = new WeakMap<Node,string>()
/** Keyed, in-place reconciliation never detaches the active editor or its ancestors. */
export function reconcileTextSurface(root:HTMLElement, html:string, protect:(node:HTMLElement)=>boolean=()=>false, force=false) {
  if(force)root.querySelectorAll('*').forEach(node=>reconciledMarkup.delete(node))
  const template=root.ownerDocument.createElement('template');template.innerHTML=html
  const key=(n:Node)=>n instanceof HTMLElement?n.dataset.ppteElementId??n.dataset.ppteSlideId:undefined
  function sync(parent:Node, source:Node) {
    let cursor:Node|null=parent.firstChild
    for(const next of Array.from(source.childNodes)) {
      const k=key(next)
      let old:Node|undefined|null=k?Array.from(parent.childNodes).find(n=>key(n)===k):cursor
      if(!old||old.nodeType!==next.nodeType||(old instanceof Element&&next instanceof Element&&old.tagName!==next.tagName)) {old=next.cloneNode(true);parent.insertBefore(old,cursor)}
      else if(old!==cursor)parent.insertBefore(old,cursor)
      if(old instanceof Element&&next instanceof Element) {
        const markup=next.outerHTML
        if(key(next)&&reconciledMarkup.get(old)===markup&&!(old instanceof HTMLElement&&protect(old))){cursor=old.nextSibling;continue}
        reconciledMarkup.set(old,markup)
        {
          for(const attr of Array.from(old.attributes))if(!next.hasAttribute(attr.name))old.removeAttribute(attr.name)
          for(const attr of Array.from(next.attributes))if(old.getAttribute(attr.name)!==attr.value)old.setAttribute(attr.name,attr.value)
          if(!(old instanceof HTMLElement&&protect(old)))sync(old,next)
        }
      } else if(old.nodeValue!==next.nodeValue)old.nodeValue=next.nodeValue
      cursor=old.nextSibling
    }
    while(cursor) {const next=cursor.nextSibling; if(!(cursor instanceof HTMLElement&&protect(cursor)))parent.removeChild(cursor);cursor=next}
  }
  sync(root,template.content)
}

export interface TextSurfacePort {
  colors?():Record<string,string>
  fonts?():Record<string,string>
  revision():string
  target(id:string): {element:TextElement;slideId:string}|undefined
  commit(tx:Transaction):FlushResult
  history(redo:boolean):void
  changed(result:FlushResult):void
  canEdit():boolean
}
/** One production native input adapter shared by Host and Portable. */
export class TextEditingSurface {
  readonly drafts=new Map<string,TextEditBuffer>()
  private inputErrors=new Map<string,string>()
  private saved?:SavedTextSelection
  private pending:MarkPatch={}
  private sequence=0
  private cleanups:Array<()=>void>=[]
  constructor(readonly root:HTMLElement, private readonly port:TextSurfacePort) {
    const listen=(type:string,fn:(e:any)=>void)=>{root.addEventListener(type,fn);this.cleanups.push(()=>root.removeEventListener(type,fn))}
    listen('focusin',e=>{const n=this.node(e.target);if(n)this.buffer(n)})
    listen('compositionstart',e=>{const n=this.node(e.target);if(n)this.buffer(n)?.beginComposition()})
    listen('input',e=>{const n=this.node(e.target);if(n){this.capture(n);this.buffer(n)?.schedule(()=>port.changed(this.flush()))}})
    listen('compositionend',e=>{const n=this.node(e.target);if(n){this.capture(n);this.buffer(n)?.endComposition(this.buffer(n)!.content());port.changed(this.flush())}})
    listen('focusout',e=>{const n=this.node(e.target);if(n&&!this.buffer(n)?.isComposing())port.changed(this.flush())})
    listen('beforeinput',e=>{
      if(!port.canEdit()){e.preventDefault();return}
      if(['formatBold','formatItalic','formatUnderline','formatStrikeThrough'].includes(e.inputType)){e.preventDefault();this.remember();const mark=({formatBold:'bold',formatItalic:'italic',formatUnderline:'underline',formatStrikeThrough:'strike'} as const)[e.inputType as 'formatBold'];this.format({[mark]:true});return}
      if(e.inputType==='historyUndo'||e.inputType==='historyRedo'){e.preventDefault();port.history(e.inputType==='historyRedo')}
      const n=this.node(e.target)
      if(n&&!e.isComposing&&e.inputType==='insertText'&&e.data&&Object.keys(this.pending).length){e.preventDefault();this.insert(n,e.data,undefined,false)}
    })
    listen('keydown',e=>{
      const n=this.node(e.target);if(!n||e.isComposing||this.buffer(n)?.isComposing())return
      if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();e.stopPropagation();port.history(e.key.toLowerCase()==='y'||e.shiftKey)}
      if((e.ctrlKey||e.metaKey)&&['b','i','u'].includes(e.key.toLowerCase())){e.preventDefault();e.stopPropagation();this.remember();const key=({b:'bold',i:'italic',u:'underline'} as const)[e.key.toLowerCase() as 'b'|'i'|'u'];this.format({[key]:true})}
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();this.discard(n.dataset.ppteElementId!)}
    })
    listen('paste',e=>{const n=this.node(e.target);if(!n||!port.canEdit())return;e.preventDefault();if(this.buffer(n)?.isComposing())return;this.insert(n,e.clipboardData?.getData('text/plain')??'',e.clipboardData?.getData('text/html'))})
    const remember=()=>{this.remember();this.syncFontControls()};root.ownerDocument.addEventListener('selectionchange',remember);this.cleanups.push(()=>root.ownerDocument.removeEventListener('selectionchange',remember))
  }
  private node(target:EventTarget|null):HTMLElement|undefined {
    const n=target instanceof Element?target.closest<HTMLElement>('[data-ppte-type="text"][data-ppte-element-id]'):null
    return n&&this.root.contains(n)&&this.port.canEdit()?n:undefined
  }
  private buffer(n:HTMLElement) {
    const id=n.dataset.ppteElementId!,target=this.port.target(id)
    if(!target)return
    let b=this.drafts.get(id)
    if(!b){b=new TextEditBuffer(id,target.slideId,target.element.content,this.port.revision());this.drafts.set(id,b)}
    return b
  }
  private capture(n:HTMLElement) {
    const b=this.buffer(n)
    if(!b)return
    try {
      const before=b.content(),previous=textOf(before),plain=readText(n)
      let content=editRichText(before,plain)
      if(Object.keys(this.pending).length&&previous!==plain){
        let left=0,right=0
        while(left<previous.length&&left<plain.length&&previous[left]===plain[left])left++
        while(right<previous.length-left&&right<plain.length-left&&previous[previous.length-right-1]===plain[plain.length-right-1])right++
        if(left<plain.length-right)content=setMarks(content,{anchor:positionAt(content,left,'backward'),head:positionAt(content,plain.length-right,'forward')},this.pending).content
      }
      b.input(content);this.inputErrors.delete(b.elementId)
    } catch(error) {this.inputErrors.set(b.elementId,String(error))}
  }
  remember() {
    const s=this.root.ownerDocument.getSelection(),n=this.node(s?.anchorNode instanceof Element?s.anchorNode:s?.anchorNode?.parentElement??null)
    if(n){const b=this.buffer(n);if(b){const saved=captureTextSelection(n,b.content(),this.port.revision());if(saved){if(this.saved&&this.saved.root!==saved.root)this.pending={};this.saved=saved;b.selection=saved.range;const marks=this.marks();for(const button of Array.from(this.root.ownerDocument.querySelectorAll<HTMLElement>('[data-ppte-text-mark]'))){const key=button.dataset.ppteTextMark as keyof typeof marks;button.setAttribute('aria-pressed',marks[key]==='mixed'?'mixed':String(marks[key]===true));button.dataset.ppteMarkLabel??=button.textContent??key;button.textContent=button.dataset.ppteMarkLabel+(marks[key]==='mixed'?' (mixed)':'')}}}}
  }
  syncFontControls() {
    const marks=this.marks()
    for(const input of Array.from(this.root.ownerDocument.querySelectorAll<HTMLInputElement>('[data-ppte-run-font]'))) {
      if(input===input.ownerDocument.activeElement)continue
      const key=input.dataset.ppteRunFont as 'fontSize'|'fontFamily',value=marks[key]
      input.dataset.valueState=value==='mixed'?'mixed':value===undefined?'inherited':'value'
      input.placeholder=value==='mixed'?'混合值':'继承整框'
      input.value=value===undefined||value==='mixed'?'':typeof value==='number'?String(value):value.kind==='token'?`@${value.token}`:value.value
    }
  }
  marks() {const s=this.saved,b=s&&this.drafts.get(s.root.dataset.ppteElementId!);return s&&b&&s.contentHash===canonicalHash(b.content())?mixedMarks(b.content(),s.range):{}}
  format(patch:MarkPatch):FlushResult {
    const saved=this.saved
    if(!saved||!this.port.canEdit())return {ok:false}
    const b=this.buffer(saved.root)
    if(!b||b.isComposing()||!restoreTextSelection(saved,saved.root,b.content(),this.port.revision()))return {ok:false}
    const boundary=this.flush();if(!boundary.ok)return boundary
    const result=setMarks(b.content(),saved.range,patch)
    if(result.pendingMarks){this.pending={...this.pending,...patch};return {ok:true}}
    b.input(result.content);writeText(saved.root,result.content,this.port.colors?.(),this.port.fonts?.())
    this.saved={...saved,range:result.range,contentHash:canonicalHash(result.content),revision:this.port.revision()}
    restoreTextSelection(this.saved,saved.root,result.content,this.port.revision())
    const flushed=this.flush();this.saved.revision=this.port.revision();this.port.changed(flushed);return flushed
  }
  private insert(n:HTMLElement,plain:string,html?:string,boundary=true) {
    this.remember();const b=this.buffer(n),saved=this.saved
    if(!b||!saved||saved.root!==n||(boundary&&!this.flush().ok))return
    let pasted:RichTextDocument|undefined
    if(html) {
      const container=n.ownerDocument.createElement('div');const template=n.ownerDocument.createElement('template');template.innerHTML=html
      // Detached inert parse; only text and the five registered marks survive.
      template.content.querySelectorAll('script,style,iframe,object,embed,svg,math,img,audio,video,source,link,meta').forEach(node=>node.remove())
      for(const node of Array.from(template.content.querySelectorAll<HTMLElement>('*'))){
        const {fontWeight,fontStyle,textDecoration,color,fontFamily,fontSize}=node.style
        for(const attr of Array.from(node.attributes))node.removeAttribute(attr.name)
        Object.assign(node.style,{fontWeight,fontStyle,textDecoration,color,fontFamily,fontSize})
      }
      container.append(template.content);plain=readText(container)
      pasted=editRichText({paragraphs:[{id:'paste',runs:[{id:'paste-run',text:''}]}]},plain)
      const dom=domText(container)
      for(const [node,points] of dom.points)if(node.nodeType===3&&node.textContent) {
        const patch:MarkPatch={}
        for(let parent=node.parentElement;parent&&parent!==container;parent=parent.parentElement){
          if(['B','STRONG'].includes(parent.tagName)||['bold','700'].includes(parent.style.fontWeight))patch.bold=true
          if(['I','EM'].includes(parent.tagName)||parent.style.fontStyle==='italic')patch.italic=true
          if(parent.tagName==='U'||parent.style.textDecoration.includes('underline'))patch.underline=true
          if(['S','STRIKE'].includes(parent.tagName)||parent.style.textDecoration.includes('line-through'))patch.strike=true
          if(patch.fontFamily===undefined&&parent.style.fontFamily)patch.fontFamily={kind:'value',value:parent.style.fontFamily.replace(/^['"]|['"]$/g,'')}
          if(patch.fontSize===undefined&&/^\d+(\.\d+)?px$/.test(parent.style.fontSize)&&parseFloat(parent.style.fontSize)>0)patch.fontSize=parseFloat(parent.style.fontSize)
          const color=parent.style.color;const rgb=color.match(/^rgb\((\d+), (\d+), (\d+)\)$/)
          if(rgb)patch.color={kind:'value',value:('#'+rgb.slice(1).map(v=>Number(v).toString(16).padStart(2,'0')).join('')) as `#${string}`}
        }
        pasted=setMarks(pasted,{anchor:positionAt(pasted,points[0],'backward'),head:positionAt(pasted,points.at(-1)!,'forward')},patch).content
      }
    }
    const before=b.content(),a=offsetOf(before,saved.range.anchor),h=offsetOf(before,saved.range.head),start=Math.min(a,h),end=Math.max(a,h)
    let content=editRichText(before,textOf(before).slice(0,start)+plain+textOf(before).slice(end))
    if(plain.length)content=setMarks(content,{anchor:positionAt(content,start,'backward'),head:positionAt(content,start+plain.length,'forward')},this.pending).content
    if(pasted){let at=start;for(const p of pasted.paragraphs){for(const r of p.runs){if(r.text)content=setMarks(content,{anchor:positionAt(content,at,'backward'),head:positionAt(content,at+r.text.length,'forward')},{bold:null,italic:null,underline:null,strike:null,color:null,fontFamily:null,fontSize:null,...r.marks}).content;at+=r.text.length}at++}}
    b.input(content);writeText(n,content,this.port.colors?.(),this.port.fonts?.())
    const caret=positionAt(content,start+plain.length)
    this.saved={root:n,revision:this.port.revision(),contentHash:canonicalHash(content),range:{anchor:caret,head:caret}}
    restoreTextSelection(this.saved,n,content,this.port.revision());if(boundary)this.port.changed(this.flush());else b.schedule(()=>this.port.changed(this.flush()))
  }
  flush():FlushResult {
    if(this.inputErrors.size)return {ok:false,issues:[{code:"TEXT_INVALID",message:[...this.inputErrors.values()].join("; "),severity:"error"}]}
    for(const b of this.drafts.values())if(b.isComposing())return {ok:false,issues:[{code:'COMPOSITION_ACTIVE',message:'Finish input composition first.',severity:'error'}]}
    for(const [id,b] of this.drafts){const dirty=b.dirty();const r=b.flush(this.port.target(id)?.element,this.port.revision(),tx=>this.port.commit(tx),`text-${Date.now()}-${++this.sequence}`);if(!r.ok)return r;if(dirty&&this.saved?.root.dataset.ppteElementId===id&&this.saved.contentHash===canonicalHash(b.content()))this.saved.revision=this.port.revision()}
    return {ok:true}
  }
  refresh() {
    for(const [id,b] of this.drafts){const t=this.port.target(id);if(!b.dirty()&&!b.isComposing()&&(!t||canonicalHash(t.element.content)!==canonicalHash(b.content()))){b.stopTimer();this.drafts.delete(id);this.saved=undefined}}
  }
  protect=(n:HTMLElement):boolean=>{
    const b=this.drafts.get(n.dataset.ppteElementId??'')
    return this.port.canEdit()&&!!b&&(this.inputErrors.has(b.elementId)||b.dirty()||b.isComposing()||n.contains(n.ownerDocument.activeElement))
  }
  retainedDrafts() {return [...this.drafts.values()].filter(b=>b.error).map(b=>({id:b.elementId,text:textOf(b.content()),error:b.error}))}
  showCanonical(id:string) {const n=Array.from(this.root.querySelectorAll<HTMLElement>('[data-ppte-element-id]')).find(n=>n.dataset.ppteElementId===id),target=this.port.target(id);if(n&&target)writeText(n,target.element.content,this.port.colors?.(),this.port.fonts?.())}
  discardActive() {const id=this.saved?.root.dataset.ppteElementId??[...this.drafts.values()].find(b=>b.dirty()||b.error)?.elementId;if(id)this.discard(id)}
  discard(id:string) {this.inputErrors.delete(id);const b=this.drafts.get(id);b?.cancel();this.drafts.delete(id);const n=Array.from(this.root.querySelectorAll<HTMLElement>('[data-ppte-element-id]')).find(n=>n.dataset.ppteElementId===id);const t=this.port.target(id);if(n&&t)writeText(n,t.element.content,this.port.colors?.(),this.port.fonts?.());this.saved=undefined;this.pending={}}
  reset(){for(const b of this.drafts.values())b.stopTimer();this.drafts.clear();this.saved=undefined;this.pending={};this.inputErrors.clear()}
  dispose(){for(const b of this.drafts.values())b.stopTimer();for(const release of this.cleanups)release();this.drafts.clear()}
}

const fontControlOwners=new WeakMap<HTMLElement,TextEditingSurface>()

/** Shared controls route through the saved text selection and Operation Engine. */
export function renderRunFontControls(root: HTMLElement, surface: TextEditingSurface) {
  if(fontControlOwners.get(root)===surface){surface.syncFontControls();return}
  fontControlOwners.set(root,surface)
  root.style.cssText='display:flex;flex-direction:column;gap:8px;padding:8px;background:#fff;color:#292b35;border:1px solid #d9dbe3;border-radius:5px;font:13px/1.5 system-ui'
  root.replaceChildren()
  for(const [key,label,type] of [['fontFamily','选区字体','text'],['fontSize','选区字号','number']] as const) {
    const wrap=root.ownerDocument.createElement('label');wrap.textContent=label;wrap.style.cssText='display:flex;flex-direction:column;gap:3px'
    const input=root.ownerDocument.createElement('input');input.type=type;input.dataset.ppteRunFont=key;input.setAttribute('aria-label',label)
    input.style.cssText='min-width:0;max-width:100%;box-sizing:border-box;background:#fff;color:#292b35;border:1px solid #d9dbe3;border-radius:3px;padding:4px;font:inherit'
    input.placeholder='继承整框';if(key==='fontSize'){input.min='0.01';input.step='any'}
    input.onpointerdown=()=>surface.remember()
    input.onchange=()=>{
      const value=input.value.trim()
      const patch:MarkPatch=key==='fontSize'?{fontSize:value?Number(value):null}:{fontFamily:!value?null:value.startsWith('@')?{kind:'token',token:value.slice(1)}:{kind:'value',value}}
      try {const result=surface.format(patch);input.setCustomValidity(result.ok?'':'无法应用格式，请恢复文字选区或完成输入')} catch(error){input.setCustomValidity(String(error))}
      surface.syncFontControls()
    }
    wrap.append(input);root.append(wrap)
  }
  const hint=root.ownerDocument.createElement('small');hint.textContent='留空恢复继承；字体可用 @主题 token';root.append(hint)
  surface.syncFontControls()
}
