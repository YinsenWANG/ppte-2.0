import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium, type Page } from 'playwright';
import { enhanceHTML, readEnhanced } from '../packages/html-document/src/index.js';
import { SaveController, type Snapshot } from '../packages/html-editor/src/save.js';
const out=resolve('artifacts/s02');
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
async function ready(page:Page,file:string){await page.goto(pathToFileURL(file).href);await page.waitForFunction(()=>!!(window as any).PPTeSave);}

test('S02 file entry: no API and denied permission actually download, reopen content/style/lock/media offline',async()=>{
 await mkdir(out,{recursive:true});
 const media='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>').toString('base64');
 const file=join(out,'download-source.ppte.html');
 await writeFile(file,(await enhanceHTML(`<title>S02</title><style>h1{color:rgb(12, 34, 56)}</style><section data-ppte-slide="s"><h1>Original</h1><p data-ppte-locked="true">Protected</p><img src="${media}"></section>`,{root:out,base:out})).html);
 const before=await readFile(file,'utf8');const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({offline:true});const page=await context.newPage();await ready(page,file);
  const capabilities=await page.evaluate(()=>({userAgent:navigator.userAgent,secure:isSecureContext,picker:typeof(window as any).showOpenFilePicker,locks:!!navigator.locks,protocol:location.protocol}));
  const requests:string[]=[];page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  for(const mode of ['no-api','denied']){
   await page.evaluate(mode=>{(window as any).showOpenFilePicker=mode==='no-api'?undefined:async()=>[{requestPermission:async()=> 'denied'}];},mode);
   await page.getByText('编辑',{exact:true}).click();await page.frameLocator('#ppte-frame').locator('h1').fill(`Updated ${mode}`);
   const event=page.waitForEvent('download');await page.frameLocator('#ppte-frame').locator('h1').press('Control+s');const download=await event;
   const dest=join(out,`${mode}.ppte.html`);await download.saveAs(dest);
   const state=await page.evaluate(()=>{const c=(window as any).PPTeSave;return {state:c.state,dirty:c.dirty,confirmed:c.confirmedFileRevision,exported:c.exportedRevision,revision:c.revision};});
   assert.notEqual(state.state,'saved');assert.equal(state.dirty,true);assert.equal(state.confirmed,null);assert.equal(state.exported,state.revision);
   assert.match(await page.locator('[role=status]').innerText(),/原文件未覆盖/);
   const reopened=await context.newPage();await ready(reopened,dest);
   assert.equal(await reopened.frameLocator('#ppte-frame').locator('h1').innerText(),`Updated ${mode}`);
   assert.equal(await reopened.frameLocator('#ppte-frame').locator('h1').evaluate(e=>getComputedStyle(e).color),'rgb(12, 34, 56)');
   assert.equal(await reopened.frameLocator('#ppte-frame').locator('p').getAttribute('data-ppte-locked'),'true');
   assert.equal(await reopened.frameLocator('#ppte-frame').locator('img').evaluate((e:HTMLImageElement)=>e.complete&&e.naturalWidth===40),true);
   await reopened.getByText('编辑',{exact:true}).click();assert.equal(await reopened.frameLocator('#ppte-frame').locator('h1').getAttribute('contenteditable'),'true');
   assert.equal(await reopened.frameLocator('#ppte-frame').locator('p').getAttribute('contenteditable'),'false');
   const bytes=await readFile(dest,'utf8');assert.ok(bytes.includes(media));assert.ok(!bytes.includes('blob:'));assert.equal(readEnhanced(bytes).metadata.documentId,readEnhanced(before).metadata.documentId);
   await reopened.close();
  }
  // Cancellation keeps the document; direct-file drafts require explicit recovery.
  await page.evaluate(()=>{(window as any).showOpenFilePicker=async()=>{throw new DOMException('cancel','AbortError');};});
  await page.getByText('保存 / 授权',{exact:true}).click();await page.waitForFunction(()=>(window as any).PPTeSave.detail.includes('已取消'));
  await page.evaluate(()=>(window as any).PPTeSave.draft());await page.close();const again=await context.newPage();await ready(again,file);
  assert.equal(await again.frameLocator('#ppte-frame').locator('h1').innerText(),'Original');assert.match(await again.locator('[role=status]').innerText(),/发现匹配草稿/);
  const copy=join(out,'copy.ppte.html');await copyFile(file,copy);const copied=await context.newPage();await ready(copied,copy);assert.equal(await copied.evaluate(()=>(window as any).PPTeSave.recover()),undefined);
  const dl=copied.waitForEvent('download');await copied.getByText('更多',{exact:true}).click();await copied.getByText('另存为新文件',{exact:true}).click();await (await dl).saveAs(join(out,'new-instance.ppte.html'));
  assert.notEqual(readEnhanced(await readFile(join(out,'new-instance.ppte.html'),'utf8')).metadata.documentId,readEnhanced(before).metadata.documentId);
  await copied.getByText('编辑',{exact:true}).click();
  await copied.evaluate(()=>{Storage.prototype.setItem=()=>{throw new DOMException('quota','QuotaExceededError');};(window as any).showOpenFilePicker=undefined;});
  await copied.frameLocator('#ppte-frame').locator('h1').fill('Storage unavailable');
  assert.equal(await copied.evaluate(()=>(window as any).PPTeSave.draftAvailable),false);
  assert.match(await copied.locator('[role=status]').innerText(),/草稿恢复不可用/);
  const noStorage=copied.waitForEvent('download');await copied.frameLocator('#ppte-frame').locator('h1').press('Control+s');await (await noStorage).saveAs(join(out,'no-storage.ppte.html'));
  assert.match(readEnhanced(await readFile(join(out,'no-storage.ppte.html'),'utf8')).content,/Storage unavailable/);
  assert.equal(await readFile(file,'utf8'),before);assert.deepEqual(requests,[]);
  await writeFile(join(out,'actual-download-reopen.json'),JSON.stringify({status:'passed',browser:browser.version(),headless:true,capabilities,modes:['no-api','denied'],checks:['actual download.saveAs and file reopen','text/style/lock/media/editor','cancel retains edits','explicit draft recovery','copy isolation','new instance identity','no HTTP requests'],originalBefore:hash(before),originalAfter:hash(await readFile(file,'utf8'))},null,2));
 }finally{await browser.close();}
});

test('S02 conflict remains latched through input; exported and confirmed revisions are independent',async()=>{
 const base:Snapshot={content:'old',hash:'old',fileKey:'a',name:'a',metadata:{documentId:'a',saveRevision:0}};
 let writes=0;const c=new SaveController({load:async()=>base,write:async()=>{writes++;throw Error('CONFLICT');}},base,()=> 'unsaved',()=>{});
 c.change();await c.flush();assert.equal(c.state,'conflict');c.change();c.exported(c.revision);await c.flush();assert.equal(writes,1);assert.equal(c.state,'conflict');assert.equal(c.dirty,true);assert.equal(c.confirmedFileRevision,null);assert.equal(c.exportedRevision,2);c.composition(true);
});

test('S02 file handle contract bridge: real file bytes, permission lifecycle, autosave, conflicts and delayed receipts',async()=>{
 await mkdir(out,{recursive:true});const file=join(out,'bound.ppte.html');
 await writeFile(file,(await enhanceHTML('<title>Bound</title><h1>Original</h1>',{root:out,base:out})).html);
 const initial=await readFile(file,'utf8');const browser=await chromium.launch({channel:'chrome',headless:true});
 let permission='granted',fail=false,delay=false,release:()=>void=()=>{};
 try{
  const context=await browser.newContext({offline:true});
  await context.exposeBinding('readDisk',()=>readFile(file,'utf8'));
  await context.exposeBinding('permission',()=>permission);
  await context.exposeBinding('writeDisk',async(_,bytes:string)=>{if(fail)throw Error('ENOSPC');if(delay)await new Promise<void>(r=>release=r);await writeFile(file,bytes);});
  await context.addInitScript(()=>{
   const w=window as any;
   w.showOpenFilePicker=async()=>[{name:'bound.ppte.html',requestPermission:()=>w.permission(),queryPermission:()=>w.permission(),getFile:async()=>({text:()=>w.readDisk()}),createWritable:async()=>{let bytes='';return {write:async(s:string)=>{bytes=s;},close:()=>w.writeDisk(bytes),abort:async()=>{}};}}];
  });
  const page=await context.newPage();await ready(page,file);await page.getByText('编辑',{exact:true}).click();
  const title=page.frameLocator('#ppte-frame').locator('h1');await title.fill('First write');await title.press('Control+s');await page.waitForFunction(()=>(window as any).PPTeSave.state==='saved');
  const first=await readFile(file,'utf8');assert.match(readEnhanced(first).content,/First write/);assert.notEqual(hash(initial),hash(first));
  delay=true;await title.fill('In flight');await page.waitForFunction(()=>(window as any).PPTeSave.state==='saving');await title.fill('Latest input');delay=false;release();
  await page.waitForFunction(()=>{const c=(window as any).PPTeSave;return c.state==='saved'&&c.confirmedFileRevision===c.revision;});assert.match(readEnhanced(await readFile(file,'utf8')).content,/Latest input/);
  permission='denied';await title.fill('Permission retained');await page.waitForFunction(()=>(window as any).PPTeSave.state==='unauthorized');assert.equal(await title.innerText(),'Permission retained');
  const downloadEvent=page.waitForEvent('download');await title.press('Control+s');await (await downloadEvent).saveAs(join(out,'revoked.ppte.html'));
  permission='granted';await title.press('Control+s');await page.waitForFunction(()=>(window as any).PPTeSave.state==='saved');assert.match(readEnhanced(await readFile(file,'utf8')).content,/Permission retained/);
  fail=true;await title.fill('Quota retry');await page.waitForFunction(()=>(window as any).PPTeSave.state==='failed');assert.match(readEnhanced(await readFile(file,'utf8')).content,/Permission retained/);fail=false;await title.press('Control+s');await page.waitForFunction(()=>(window as any).PPTeSave.state==='saved');
  const winner=await readFile(file,'utf8');const external=winner.replace(/Quota retry/g,'External winner');await writeFile(file,external);await title.fill('Conflict retained');await page.waitForFunction(()=>(window as any).PPTeSave.state==='conflict');await title.fill('Conflict still retained');await title.press('Control+s');assert.equal(await readFile(file,'utf8'),external);
  await page.close();const reopened=await context.newPage();await ready(reopened,file);assert.equal(await reopened.frameLocator('#ppte-frame').locator('h1').innerText(),'External winner');
  await reopened.evaluate(()=>{const w=window as any;const picker=w.showOpenFilePicker;w.showOpenFilePicker=async()=>{const [handle]=await picker();const get=handle.getFile;handle.getFile=async()=>({text:async()=>(await (await get()).text()).replace(/"saveRevision":(\d+)/,(_:string,n:string)=>'"saveRevision":'+(Number(n)+1))});return [handle];};});
  await reopened.getByText('保存 / 授权',{exact:true}).click();await reopened.waitForFunction(()=>(window as any).PPTeSave.detail.includes('所选文件不匹配'));
  assert.equal(await readFile(file,'utf8'),external);
  await writeFile(join(out,'original-file-hashes.json'),JSON.stringify({status:'passed-automation-only',nativePicker:false,bridge:'Playwright bindings provide mocked handle methods backed by Node file I/O; no HTTP service',path:file,initial:hash(initial),firstConfirmed:hash(first),lastConfirmed:hash(winner),externalAfterConflict:hash(await readFile(file,'utf8')),checks:['write/close/readback','edit during pending write','revocation/download/reauthorization','failed close/retry','external conflict stays latched','close/reopen same path','same-name same-content different-revision binding rejected']},null,2));
 }finally{release();await browser.close();}
});
