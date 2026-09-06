import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { createPortableFullPortable } from '../packages/portable-runtime/src/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { EditorController, planTextReplacement, beginDrag, updateDrag, endDrag } from '../packages/editor-controller/src/index.js'
import { buildCheckpointBytes, openCheckpointBytes } from '../packages/file-format/src/index.js'
import { withPersistedHistoryMetadata } from '../packages/schema/src/file-format.js'
import { TextEditBuffer, setMarks, clearMarks, mixedMarks, positionAt, offsetOf, textOf, editRichText } from '../packages/richtext-adapter/src/index.js'
import type { RichTextDocument, TextElement } from '../packages/schema/src/index.js'
const content:RichTextDocument={paragraphs:[{id:'p',runs:[{id:'r',text:'Cherry Studio'},{id:'keep',text:' unchanged',marks:{italic:true}}]},{id:'p2',runs:[{id:'r2',text:'中文 👩‍👩‍👦 e\u0301'}]}]}
const range=(doc:RichTextDocument,a:number,h:number)=>({anchor:positionAt(doc,a,'backward'),head:positionAt(doc,h,'forward')})

test('E03 exact marks, reverse/cross-paragraph/mixed/collapsed ranges, split IDs and UTF-16 position map',()=>{
  const result=setMarks(content,range(content,7,13),{bold:true,color:{kind:'value',value:'#cc0033'}})
  assert.deepEqual(result.content.paragraphs[0].runs.map(r=>[r.id,r.text,r.marks]),[['r','Cherry ',undefined],['r:split:1','Studio',{bold:true,color:{kind:'value',value:'#cc0033'}}],['keep',' unchanged',{italic:true}]])
  assert.deepEqual(result.content.paragraphs[1],content.paragraphs[1])
  assert.equal(offsetOf(result.content,result.map(positionAt(content,10))),10)
  assert.deepEqual(setMarks(content,range(content,13,7),{bold:true}).content,setMarks(content,range(content,7,13),{bold:true}).content)
  assert.equal(mixedMarks(result.content,range(result.content,0,13)).bold,'mixed')
  const whole=setMarks(content,range(content,0,textOf(content).length),{underline:true})
  assert.ok(whole.content.paragraphs.every(p=>p.runs.every(r=>r.marks?.underline)))
  assert.deepEqual(clearMarks(whole.content,range(whole.content,0,textOf(content).length)).content.paragraphs[1].runs[0].marks,undefined)
  const collapsed=setMarks(content,range(content,7,7),{italic:true});assert.deepEqual(collapsed.content,content);assert.deepEqual(collapsed.pendingMarks,{italic:true})
  const text=textOf(content),emoji=text.indexOf('👩'),accent=text.indexOf('e\u0301')
  assert.equal(offsetOf(content,positionAt(content,emoji+2,'backward')),emoji)
  assert.equal(offsetOf(content,positionAt(content,emoji+2,'forward')),emoji+'👩‍👩‍👦'.length)
  assert.equal(offsetOf(content,positionAt(content,accent+1,'forward')),accent+2)
  assert.throws(()=>offsetOf(content,{paragraphId:'p2',runId:'r2',offset:5,affinity:'forward'}),/grapheme/)
  assert.equal(textOf(editRichText(content,text.replace('e\u0301','e\u0300'))),text.replace('e\u0301','e\u0300'))
  const collision=structuredClone(content);collision.paragraphs[0].runs.push({id:'r:split:1',text:' reserved'})
  assert.equal(setMarks(collision,range(collision,7,13),{bold:true}).content.paragraphs[0].runs[1].id,'r:split:2')
})

test('E03 marks survive Operation Engine undo/redo and archive reopen with exact IDs',()=>{
  const {document,imageBytes}=makeContractDocument();const element=document.slides.slide_main.elements.text_body as TextElement;element.content=structuredClone(content)
  const session=new PpteSession(document)
  for(const patch of [{bold:true},{italic:true},{underline:true},{strike:true},{color:{kind:'value' as const,value:'#aa0033' as const}},{bold:null,italic:null,underline:null,strike:null,color:null}]) {
    const before=structuredClone(session.getDocument()),current=(before.slides.slide_main.elements.text_body as TextElement).content
    const changed=setMarks(current,range(current,7,13),patch).content
    const tx=planTextReplacement({transactionId:`format-${session.getHistory().length}`,baseRevision:session.getRevision(),createdAt:new Date().toISOString(),slideId:'slide_main',elementId:element.id,content:changed})!
    assert.equal(session.commit(tx).ok,true)
    const bytes=buildCheckpointBytes(session.getDocument(),{assetBytes:{asset_pixel:imageBytes},recentTransactions:session.getHistory().map(e=>withPersistedHistoryMetadata(e.transaction,e))})
    const reopened=new PpteSession(openCheckpointBytes(bytes).document)
    assert.equal(reopened.undo().ok,true);assert.deepEqual(reopened.getDocument(),before)
    assert.equal(reopened.redo().ok,true);assert.deepEqual(reopened.getDocument(),session.getDocument())
  }
})

test('E03 composition, burst boundary, rejected flush, conflict and overlapping saves retain draft with only Core history',async(t)=>{
  t.mock.timers.enable({apis:['setTimeout']})
  const {document}=makeContractDocument(),session=new PpteSession(document),controller=new EditorController(session)
  const target=()=>session.getDocument().slides.slide_main.elements.text_body as TextElement
  const buffer=new TextEditBuffer('text_body','slide_main',target().content,session.getRevision())
  let sequence=0,reject=false
  controller.setFlushHandler(()=>buffer.flush(target(),session.getRevision(),tx=>reject?{ok:false}:controller.commit(tx),`input-${++sequence}`))
  buffer.beginComposition();buffer.input(editRichText(buffer.content(),'中文 👩‍👩‍👦 e\u0301'))
  assert.equal(controller.undo().ok,false);assert.equal(session.getHistory().length,0)
  buffer.endComposition(buffer.content());buffer.input(buffer.content())
  const results=await Promise.all([controller.flush('compositionend'),controller.flush('save'),controller.flush('save'),controller.flush('blur')])
  assert.ok(results.every(r=>r.ok));assert.equal(session.getHistory().length,1)
  buffer.input(editRichText(buffer.content(),'next draft'));buffer.schedule(()=>controller.flushSync());t.mock.timers.tick(749);assert.equal(session.getHistory().length,1)
  buffer.schedule(()=>controller.flushSync());t.mock.timers.tick(750);assert.equal(session.getHistory().length,2)
  buffer.input(editRichText(buffer.content(),'retained'));buffer.selection=range(buffer.content(),1,4);const retainedSelection=structuredClone(buffer.selection);reject=true
  assert.equal(controller.undo().ok,false);assert.equal(session.getHistory().length,2);assert.equal(textOf(buffer.content()),'retained');assert.deepEqual(buffer.selection,retainedSelection)
  reject=false
  const move=endDrag(updateDrag(beginDrag(session.getDocument(),session.getRevision(),'slide_main','image_hero',{x:0,y:0}),{x:10,y:0}),'unrelated',new Date().toISOString())!
  assert.equal(controller.commit(move).ok,true)
  assert.equal(controller.flushSync().ok,true,'unchanged target hash permits replan on unrelated revision')
  buffer.input(editRichText(buffer.content(),'local conflict'))
  const tx=planTextReplacement({transactionId:'external',baseRevision:session.getRevision(),createdAt:new Date().toISOString(),slideId:'slide_main',elementId:'text_body',content:editRichText(target().content,'external text')})!
  assert.equal(controller.commit(tx).ok,true)
  const depth=session.getHistory().length
  assert.equal(controller.undo().ok,false);assert.equal(buffer.error,'TEXT_DRAFT_CONFLICT');assert.equal(textOf(buffer.content()),'local conflict');assert.equal(textOf(target().content),'external text');assert.equal(session.getHistory().length,depth)
  buffer.cancel();assert.equal(controller.undo().ok,true)
  controller.dispose()
})

test('E03 DOM selection roundtrip rejects stale revision/root, grapheme snaps and retains active node during unrelated reconcile',async()=>{
  const bundle=await build({stdin:{contents:`import * as dom from './packages/editor-dom/src/text-selection.ts';globalThis.DOM=dom;`,resolveDir:process.cwd()},bundle:true,write:false,platform:'browser'})
  const browser=await chromium.launch({headless:true})
  try{const page=await browser.newPage();await page.setContent('<div id="surface"><section data-ppte-slide-id="s"><div contenteditable="true" data-ppte-type="text" data-ppte-element-id="t"></div><div data-ppte-element-id="other">before</div></section></div>');await page.addScriptTag({content:bundle.outputFiles[0].text})
    const result=await page.evaluate(content=>{
      const api=(globalThis as any).DOM,root=document.querySelector<HTMLElement>('[data-ppte-element-id="t"]')!,surface=document.getElementById('surface')!;api.writeText(root,content);root.focus()
      const nodes=root.querySelectorAll('span');document.getSelection()!.setBaseAndExtent(nodes[2].firstChild!,3,nodes[0].firstChild!,7)
      const saved=api.captureTextSelection(root,content,'rev');document.getSelection()!.removeAllRanges()
      const restored=api.restoreTextSelection(saved,root,content,'rev'),selected=document.getSelection()!.toString()
      const invalid=api.restoreTextSelection(saved,root,content,'stale'),wrongRoot=api.restoreTextSelection(saved,root.cloneNode(true),content,'rev')
      api.reconcileTextSurface(surface,surface.innerHTML.replace('>before<','>after<'),(n:HTMLElement)=>n===root)
      return {restored,selected,invalid,wrongRoot,same:root===surface.querySelector('[data-ppte-element-id="t"]'),focused:document.activeElement===root,other:surface.querySelector('[data-ppte-element-id="other"]')!.textContent,stillSelected:document.getSelection()!.toString()}
    },content)
    assert.equal(result.restored,true);assert.equal(result.invalid,false);assert.equal(result.wrongRoot,false);assert.equal(result.same,true);assert.equal(result.focused,true);assert.equal(result.other,'after');assert.equal(result.stillSelected,result.selected);assert.ok(result.selected.includes('Studio'))
  }finally{await browser.close()}
})

for(const host of [false,true])test(`E03 ${host?'Host':'Portable'} real browser range-format, IME dedup, retained focus, history and rich paste journey`,async()=>{
  const dir=mkdtempSync(join(tmpdir(),'e03-journey-')),{document:doc,imageBytes}=makeContractDocument();(doc.slides.slide_main.elements.text_body as TextElement).content=structuredClone(content)
  const assets={asset_pixel:imageBytes};let file:string
  if(host){const b=spawnSync('pnpm',['host:build','--outDir',join(dir,'host')],{encoding:'utf8'});assert.equal(b.status,0,b.stdout+b.stderr);file=join(dir,'host/index.html');writeFileSync(join(dir,'deck.ppte'),buildCheckpointBytes(doc,{assetBytes:assets}))}
  else{const b=createPortableFullPortable(doc,{assetBytes:assets});assert.equal(b.ok,true);file=join(dir,'deck.html');writeFileSync(file,b.html)}
  const browser=await chromium.launch({headless:true})
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(pathToFileURL(file).href)
    if(host){await page.waitForFunction(()=>document.querySelector('[data-ppte-ready]')?.getAttribute('data-ppte-ready')==='true');await page.locator('[data-ppte-action="open"]').setInputFiles(join(dir,'deck.ppte'))}
    const apiName=host?'PPTEHost':'PPTEPortable';await page.waitForFunction(name=>Boolean((globalThis as any)[name]),apiName)
    const editor=page.locator('[data-ppte-stage] [data-ppte-element-id="text_body"]').first();await editor.waitFor()
    await editor.evaluate(n=>{n.focus();(globalThis as any).activeText=n;const t=n.querySelector('p')!.firstChild!;const walker=document.createTreeWalker(t,NodeFilter.SHOW_TEXT);const text=t.nodeType===3?t:walker.nextNode()!;document.getSelection()!.setBaseAndExtent(text,7,text,13)})
    await page.waitForTimeout(30)
    await page.getByRole('button',{name:'bold',exact:true}).click()
    await page.waitForTimeout(30)
    assert.equal(await editor.evaluate(n=>n=== (globalThis as any).activeText),true)
    assert.equal(await editor.evaluate(n=>n===document.activeElement),true)
    assert.equal(await page.evaluate(()=>document.getSelection()!.toString()),'Studio')
    const getContent=()=>page.evaluate(name=>{const api=(globalThis as any)[name];const d=api.getDocument?api.getDocument():api.getState().document;return d.slides.slide_main.elements.text_body.content},apiName)
    let actual=await getContent();assert.equal(actual.paragraphs[0].runs.filter((r:any)=>r.marks?.bold).map((r:any)=>r.text).join(''),'Studio')
    const depth=await page.evaluate(name=>(globalThis as any)[name].getHistory().length,apiName)
    await editor.dispatchEvent('compositionstart')
    await editor.evaluate(n=>{n.textContent='中文 composition';n.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}))})
    assert.equal(await page.evaluate(name=>(globalThis as any)[name].undo().ok,apiName),false)
    const saveButton=page.locator('[data-ppte-action=save]')
    await saveButton.dispatchEvent('click');await saveButton.dispatchEvent('click')
    assert.equal(await page.evaluate(name=>(globalThis as any)[name].getHistory().length,apiName),depth)
    await editor.dispatchEvent('compositionend')
    await editor.dispatchEvent('input')
    await editor.blur()
    assert.equal(await page.evaluate(name=>(globalThis as any)[name].getHistory().length,apiName),depth+1)
    await editor.focus();await page.keyboard.press('ControlOrMeta+z');await page.waitForTimeout(30)
    actual=await getContent();assert.equal(textOf(actual),textOf(content))
    await page.keyboard.press('ControlOrMeta+Shift+z');await page.waitForTimeout(30);assert.equal(textOf(await getContent()),'中文 composition')
    await editor.evaluate(n=>{n.focus();const range=document.createRange();range.selectNodeContents(n);const s=document.getSelection()!;s.removeAllRanges();s.addRange(range);const data=new DataTransfer();data.setData('text/html','<p><b>Safe</b> <i>paste</i></p><p><u>next</u><script>bad()</script></p>');data.setData('text/plain','Safe paste\nnext');n.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}))})
    actual=await getContent();assert.equal(textOf(actual),'Safe paste\nnext');assert.equal(actual.paragraphs[0].runs[0].marks.bold,true);assert.equal(actual.paragraphs[1].runs[0].marks.underline,true)
    assert.equal(await editor.locator('script').count(),0)
    // A collapsed selection sets future marks without creating a history entry.
    await editor.evaluate(n=>{const w=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);const text=w.nextNode()!;document.getSelection()!.setBaseAndExtent(text,0,text,0);n.focus()})
    await page.waitForTimeout(30)
    const beforePending=await page.evaluate(name=>(globalThis as any)[name].getHistory().length,apiName)
    assert.equal(await page.evaluate(name=>(globalThis as any)[name].setTextMarks({strike:true}).ok,apiName),true)
    assert.equal(await page.evaluate(name=>(globalThis as any)[name].getHistory().length,apiName),beforePending)
    await page.keyboard.type('X');await editor.blur()
    actual=await getContent();assert.equal(textOf(actual),'XSafe paste\nnext');assert.equal(actual.paragraphs[0].runs[0].marks.strike,true)
    const [download]=await Promise.all([page.waitForEvent('download'),saveButton.dispatchEvent('click')]);const savedFile=join(dir,'saved.ppte');await download.saveAs(savedFile)
    const reopened=new PpteSession(openCheckpointBytes(new Uint8Array(readFileSync(savedFile))).document)
    assert.deepEqual((reopened.getDocument().slides.slide_main.elements.text_body as TextElement).content,actual)
    assert.equal(reopened.undo().ok,true);assert.equal(reopened.redo().ok,true)
    await editor.click()
    const size=host?page.getByLabel('字号',{exact:true}):page.getByLabel('整框字号',{exact:true})
    const beforeSize=await page.evaluate(name=>(globalThis as any)[name].getHistory().length,apiName)
    await editor.evaluate(n=>{n.textContent='Size boundary';n.dispatchEvent(new InputEvent('input',{bubbles:true}))})
    await size.fill('34');await size.dispatchEvent('change');await size.blur()
    assert.equal(await page.evaluate(name=>(globalThis as any)[name].getDocument().slides.slide_main.elements.text_body.style.overrides.fontSize,apiName),34)
    assert.equal(await page.evaluate(name=>(globalThis as any)[name].getHistory().length,apiName),beforeSize+2)
    assert.equal(textOf(await getContent()),'Size boundary')
    // Unrelated Agent changes retain the focused DOM and caret during IME.
    await editor.focus();await editor.dispatchEvent('compositionstart')
    await editor.evaluate(n=>{n.textContent='Local draft';n.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));document.getSelection()!.setBaseAndExtent(n.firstChild!,3,n.firstChild!,3);(globalThis as any).draftNode=n})
    const current=await page.evaluate(name=>{const api=(globalThis as any)[name];return {document:api.getDocument(),revision:api.getRevision()}},apiName)
    const move=endDrag(updateDrag(beginDrag(current.document,current.revision,'slide_main','image_hero',{x:0,y:0}),{x:15,y:0}),'browser-unrelated',new Date().toISOString())!
    assert.equal(await page.evaluate<any,any>(({name,tx})=>(globalThis as any)[name].commit(tx).ok,{name:apiName,tx:move}),true)
    await page.waitForTimeout(30)
    assert.equal(await editor.evaluate(n=>n===(globalThis as any).draftNode&&document.activeElement===n&&document.getSelection()!.anchorOffset===3),true)
    await editor.dispatchEvent('compositionend');assert.equal(textOf(await getContent()),'Local draft')
    // A target change must never be overwritten by the local draft or undo.
    await editor.dispatchEvent('compositionstart');await editor.evaluate(n=>{n.textContent='Conflicting local';n.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}))})
    const revision=await page.evaluate(name=>(globalThis as any)[name].getRevision(),apiName)
    const remote=planTextReplacement({transactionId:'remote-text',baseRevision:revision,createdAt:new Date().toISOString(),slideId:'slide_main',elementId:'text_body',content:editRichText(await getContent(),'Agent text')})
    assert.equal(await page.evaluate<any,any>(({name,tx})=>(globalThis as any)[name].commit(tx).ok,{name:apiName,tx:remote}),true)
    await editor.dispatchEvent('compositionend')
    assert.equal(await editor.innerText(),'Conflicting local');assert.equal(textOf(await getContent()),'Agent text')
    assert.equal(await page.evaluate(name=>(globalThis as any)[name].undo().ok,apiName),false)
    await page.getByRole('button',{name:'放弃文字草稿',exact:true}).click()
    assert.equal(await editor.innerText(),'Agent text')

  }finally{await browser.close();rmSync(dir,{recursive:true,force:true})}
})
