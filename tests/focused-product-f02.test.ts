import { confirmFirstSave } from './helpers/focused-product.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { enhanceHTML, readEnhanced } from '../packages/html-document/src/index.js';
import { SaveController, type Snapshot } from '../packages/html-editor/src/save.js';
import { downloadUpdated } from './helpers/focused-product.js';
const out=resolve('artifacts/focused-product-f02');
const base:Snapshot={content:'old',hash:'base',fileKey:'file',name:'file.html',metadata:{documentId:'doc',saveRevision:0}};
test('F02 errors survive editing and draft quota failure; pending automatic timer cannot retry without consent',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let writes=0;
 const c=new SaveController({load:async()=>base,write:async()=>{writes++;throw new DOMException('write denied','NotAllowedError');}},base,()=> 'new',()=>{},{getItem:()=>null,setItem:()=>{throw Error('quota');},removeItem:()=>{}});
 c.change();await c.flush();assert.equal(c.state,'unauthorized');const detail=c.detail;
 c.change();c.draft();t.mock.timers.tick(20000);await c.flush(false);assert.equal(writes,1);assert.equal(c.detail,detail);assert.equal(c.base,base);assert.equal(c.dirty,true);assert.match(c.draftError,/草稿存储/);
 const unbound=new SaveController(undefined,base,()=> 'new',()=>{});unbound.set('unauthorized','已取消选择');unbound.change();assert.equal(unbound.detail,'已取消选择');assert.equal(unbound.state,'unauthorized');
});
test('F02 recovery serializes and stores once per revision/base; next acknowledged baseline checkpoints latest revision',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let serialized=0,stored=0;
 const c=new SaveController(undefined,base,()=>{serialized++;return 'new';},()=>{},{getItem:()=>null,setItem:()=>{stored++;},removeItem:()=>{}});
 c.change();c.draft();t.mock.timers.tick(200);c.draft();assert.equal(serialized,1);assert.equal(stored,1);
 c.base={...base,hash:'next'};c.draft();assert.equal(stored,2);assert.equal(serialized,1);
 c.change();c.draft();assert.equal(stored,3);assert.equal(serialized,2);
});
test('F02 cancel, denial, picker/read errors and unsupported save never download; explicit download retains content',async()=>{
 await mkdir(out,{recursive:true});const file=join(out,'failures.ppte.html');
 const html=(await enhanceHTML('<title>F02 failures</title><h1>Original</h1>',{root:out,base:out})).html;await writeFile(file,html);
 const browser=await chromium.launch({channel:'chrome',headless:true});try{
  const p=await browser.newPage({offline:true});await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeSave);
  const downloads:string[]=[];p.on('download',d=>downloads.push(d.suggestedFilename()));await p.getByRole('button',{name:'编辑',exact:true}).click();const title=p.frameLocator('#ppte-frame').locator('h1');await title.fill('Retained');
  for(const [mode,state] of [['cancel','unauthorized'],['deny','unauthorized'],['picker','failed'],['read','failed'],['unsupported','unauthorized']]){
   await p.evaluate(({mode,html})=>{const w=window as any;w.showOpenFilePicker=mode==='unsupported'?undefined:async()=>{
    if(mode==='cancel')throw new DOMException('cancel','AbortError');if(mode==='picker')throw new Error('PICKER_IO');
    return [{name:'failures.ppte.html',requestPermission:async()=>mode==='deny'?'denied':'granted',queryPermission:async()=> 'granted',getFile:async()=>{if(mode==='read')throw Error('READ_IO');return {text:async()=>html};}}];
   };w.PPTeSave.set('dirty');},{mode,html});
   if(mode==='unsupported')await p.evaluate(()=>(window as any).PPTeSave.set('unauthorized','此浏览器不能覆盖原文件'));else await p.getByRole('button',{name:'保存',exact:true}).click();if(mode==='cancel')await confirmFirstSave(p);await p.waitForFunction(state=>(window as any).PPTeSave.state===state,state);
   const detail=await p.getByRole('status').innerText();await title.fill('Retained '+mode);await p.waitForTimeout(1100);
   assert.deepEqual(downloads,[]);assert.equal(await p.evaluate(()=>(window as any).PPTeSave.dirty),true);assert.equal(await p.evaluate(()=>(window as any).PPTeSave.confirmedFileRevision),null);assert.equal(await readFile(file,'utf8'),html);assert.ok(detail.length>0);
  }
  await p.screenshot({path:join(out,'explicit-download.png')});const event=p.waitForEvent('download');await downloadUpdated(p);await(await event).saveAs(join(out,'failures-downloaded.ppte.html'));assert.equal(downloads.length,1);
 }finally{await browser.close();}
});
test('F02 B1 actual Enter/Shift+Enter, inline formatting, multiline clipboard event, undo/redo, download and fresh process editing',async()=>{
 await mkdir(out,{recursive:true});const file=join(out,'multiline.ppte.html');
 const source=await readFile('docs/audits/2026-09-07-main-d1db13d/sample/source.html','utf8');await writeFile(file,(await enhanceHTML(source,{root:out,base:out})).html);
 let browser=await chromium.launch({channel:'chrome',headless:true});try{
  let p=await browser.newPage({offline:true,viewport:{width:1440,height:960}});const errors:string[]=[];p.on('pageerror',e=>errors.push(String(e)));
  await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeSave);await p.getByRole('button',{name:'编辑',exact:true}).click();let h=p.frameLocator('#ppte-frame').locator('h1').first();
  await h.dblclick();await p.keyboard.press('End');await p.keyboard.press('Enter');await p.keyboard.insertText('新增一行');await p.keyboard.press('Shift+Enter');await p.keyboard.insertText('第三行');
  await p.getByRole('button',{name:'页面设置',exact:true}).click();await h.click();assert.equal(await h.getAttribute('contenteditable'),'true');assert.equal(await p.getByLabel('字号',{exact:true}).count(),1);assert.equal(await h.locator('div').count(),0);assert.match(await h.innerText(),/新增一行\n第三行/);
  const before=await h.innerHTML();await p.getByLabel('字号',{exact:true}).fill('40px');await p.getByLabel('字号',{exact:true}).press('Tab');assert.equal(await h.innerHTML(),before);assert.equal(await h.evaluate(n=>getComputedStyle(n).fontSize),'40px');
  await p.getByRole('button',{name:'撤销',exact:true}).click();assert.notEqual(await h.evaluate(n=>getComputedStyle(n).fontSize),'40px');await p.getByRole('button',{name:'重做',exact:true}).click();assert.equal(await h.evaluate(n=>getComputedStyle(n).fontSize),'40px');
  await h.dblclick();await p.getByRole('button',{name:'蓝色',exact:true}).click();assert.ok(await h.locator('span').count()>0);
  await h.click();await p.keyboard.press('ControlOrMeta+End');const beforePaste=await h.innerHTML();
  // Synthetic ClipboardEvent covers the browser paste handler, not the OS clipboard.
  await h.evaluate(n=>{const data=new DataTransfer();data.setData('text/plain','粘贴 A\r\n粘贴 B');data.setData('text/html','<div>unsafe layout</div>');n.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});
  assert.match(await h.innerText(),/粘贴 A\n粘贴 B/);assert.equal(await h.locator('div').count(),0);const afterPaste=await h.innerHTML();
  await p.getByRole('button',{name:'撤销',exact:true}).click();assert.equal(await h.innerHTML(),beforePaste);await p.getByRole('button',{name:'重做',exact:true}).click();assert.equal(await h.innerHTML(),afterPaste);
  await p.getByRole('button',{name:'页面设置',exact:true}).click();await h.click();assert.equal(await h.getAttribute('contenteditable'),'true');await p.screenshot({path:join(out,'multiline.png')});
  const finalText=await h.innerText();const dest=join(out,'Cherry-F02.ppte.html');const event=p.waitForEvent('download');await downloadUpdated(p);await(await event).saveAs(dest);assert.doesNotMatch(readEnhanced(await readFile(dest,'utf8')).content,/contenteditable|data-ppte-editor-/);assert.deepEqual(errors,[]);
  await browser.close();browser=await chromium.launch({channel:'chrome',headless:true});p=await browser.newPage({offline:true});await p.goto(pathToFileURL(dest).href);await p.waitForFunction(()=>!!(window as any).PPTeSave);h=p.frameLocator('#ppte-frame').locator('h1').first();assert.equal(await h.innerText(),finalText);assert.equal(await p.locator('#ppte-save-ui').getAttribute('data-mode'),'read');assert.equal(await p.evaluate(()=>!!(window as any).PPTeSave.adapter),false);
  await p.getByRole('button',{name:'编辑',exact:true}).click();await h.click();assert.equal(await h.getAttribute('contenteditable'),'true');await p.keyboard.press('End');await p.keyboard.insertText('重开继续');assert.match(await h.innerText(),/重开继续/);
  await writeFile(join(out,'journey.json'),JSON.stringify({status:'passed-automated',time:new Date().toISOString(),browser:browser.version(),headless:true,protocol:'file:',offline:true,nativePicker:false,systemIME:false,systemClipboard:false,freshBrowserProcess:true},null,2));
 }finally{await browser.close();}
});
