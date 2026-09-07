import test from 'node:test';
import assert from 'node:assert/strict';
import { SaveController, type Snapshot } from '../packages/html-editor/src/save.js';
import { enhanceHTML, readEnhanced } from '../packages/html-document/src/index.js';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const base:Snapshot={content:'old',hash:'base',fileKey:'a',name:'same.html',metadata:{documentId:'doc',saveRevision:0}};
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
test('UI04 A5: 1s debounce, 10s sustained input, default autosave and manual override',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let writes:string[]=[];let value='';
 const c=new SaveController({load:async()=>base,write:async(_,content)=>{writes.push(content);return {...base,content};}},base,()=>value,()=>{});
 value='pause';c.change();t.mock.timers.tick(999);assert.equal(writes.length,0);t.mock.timers.tick(1);await settle();assert.deepEqual(writes,['pause']);
 for(let i=0;i<20;i++){value=String(i);c.change();t.mock.timers.tick(500);await settle();}
 assert.deepEqual(writes,['pause','19']);assert.equal(c.confirmedFileRevision,c.revision);
 c.setAutoSave(false);value='manual';c.change();t.mock.timers.tick(20000);await settle();assert.equal(writes.length,2);await c.flush();assert.equal(writes[2],'manual');
});
test('UI04 A6: one writer, stale acknowledgement stays dirty and manual queued revision runs with auto off',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let value='r1',release!:()=>void;const writes:string[]=[];let active=0,max=0;
 const c=new SaveController({load:async()=>base,write:async(_,content)=>{max=Math.max(max,++active);writes.push(content);if(writes.length===1)await new Promise<void>(r=>release=r);active--;return {...base,content};}},base,()=>value,()=>{});
 c.setAutoSave(false);c.change();const first=c.flush();value='r2';c.change();await c.flush();assert.equal(writes.length,1);release();await first;await settle();assert.equal(max,1);assert.deepEqual(writes,['r1','r2']);assert.equal(c.confirmedFileRevision,2);assert.equal(c.dirty,false);
});
test('UI04 A4/A7/A8: errors latch; composition never serializes partial drafts or writes; retry retains baseline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let value='complete',failure='PERMISSION_REVOKED',writes=0;const drafts:string[]=[];
 const c=new SaveController({load:async()=>base,write:async()=>{writes++;if(failure)throw Error(failure);return {...base,content:value};}},base,()=>value,()=>{},{getItem:()=>null,setItem:(_,v)=>{drafts.push(v);},removeItem:()=>{}});
 c.change();c.composition(true);value='half';t.mock.timers.tick(20000);c.draft();await c.flush();assert.equal(writes,0);assert.ok(drafts.every(d=>!d.includes('half')));
 value='complete IME';c.composition(false);c.change();await c.flush();assert.equal(c.state,'unauthorized');assert.equal(c.base.hash,'base');c.change();t.mock.timers.tick(20000);await settle();assert.equal(writes,1);assert.equal(c.state,'unauthorized');
 failure='';await c.flush();assert.equal(c.state,'saved');failure='CONFLICT';c.change();await c.flush();c.change();await c.flush();assert.equal(writes,3);assert.equal(c.state,'conflict');c.exported(c.revision);assert.equal(c.dirty,true);assert.match(c.detail,/原文件未覆盖/);
});
test('UI04 A1/A3/A7/A8: product save panel, wrong same-name document refusal, complete IME download and fresh browser process',async()=>{
 const out=resolve('artifacts/ui04');await mkdir(out,{recursive:true});const file=join(out,'same.ppte.html');
 const html=(await enhanceHTML('<title>UI04</title><section data-ppte-slide><h1>Original</h1></section>',{root:out,base:out})).html;await writeFile(file,html);
 let browser=await chromium.launch({channel:'chrome',headless:true});
 try{let page=await browser.newPage({offline:true});await page.goto(pathToFileURL(file).href);await page.waitForFunction(()=>!!(window as any).PPTeSave);
 await page.getByRole('button',{name:'编辑',exact:true}).click();const title=page.frameLocator('#ppte-frame').locator('h1');await title.fill('Changed');
 await page.locator('[role=status]').click();await page.getByLabel('自动保存',{exact:true}).uncheck();assert.equal(await page.evaluate(()=>(window as any).PPTeSave.autoSave),false);
 await page.evaluate(html=>{(window as any).showOpenFilePicker=async()=>[{name:'same.ppte.html',requestPermission:async()=> 'granted',getFile:async()=>({text:async()=>html.replace(/"documentId":"[^"]+"/,'"documentId":"different"')}),createWritable:()=>{throw Error('MUST_NOT_WRITE');}}];},html);
 await page.getByRole('button',{name:'保存',exact:true}).click();await page.waitForFunction(()=>(window as any).PPTeSave.state==='conflict');assert.equal(await readFile(file,'utf8'),html);
 await title.evaluate(e=>{e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));e.textContent='中';e.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));});
 await page.getByRole('button',{name:'下载我的修改',exact:true}).click();assert.match(await page.getByRole('status').innerText(),/完成输入法/);
 await title.evaluate(e=>{e.textContent='中文完整事务';e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));});
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'下载我的修改',exact:true}).click();const dest=join(out,'complete.ppte.html');await (await downloading).saveAs(dest);
 assert.match(readEnhanced(await readFile(dest,'utf8')).content,/中文完整事务/);assert.match(await page.getByRole('status').innerText(),/原文件未覆盖/);await page.screenshot({path:join(out,'save-panel.png')});
 await browser.close();browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({offline:true});await page.goto(pathToFileURL(dest).href);await page.waitForFunction(()=>!!(window as any).PPTeSave);
 assert.equal(await page.frameLocator('#ppte-frame').locator('h1').innerText(),'中文完整事务');assert.equal(await page.locator('#ppte-edit-toolbar').isVisible(),false);assert.equal(await page.evaluate(()=>!!(window as any).PPTeSave.adapter),false);
 await writeFile(join(out,'journey.json'),JSON.stringify({status:'passed',browser:browser.version(),nativePicker:false,systemIME:false,freshBrowserProcess:true,offline:true,time:new Date().toISOString()},null,2));
 }finally{await browser.close();}
});
