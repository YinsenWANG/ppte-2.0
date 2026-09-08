import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium, type Page } from 'playwright';
import { enhanceHTML, readEnhanced } from '../packages/html-document/src/index.js';
import { SaveController, type Snapshot } from '../packages/html-editor/src/save.js';
const out=resolve('artifacts/usability-reset-u03');
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
async function ready(p:Page,file:string){await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeSave);await p.getByRole('button',{name:'编辑',exact:true}).click();}
async function fixture(name:string){await mkdir(out,{recursive:true});const file=join(out,name+'.ppte.html');const source=await readFile('docs/audits/2026-09-07-main-d1db13d/sample/source.html','utf8');const html=(await enhanceHTML(source,{root:out,base:out})).html;await writeFile(file,html);return {file,html};}
test('U03 A1/A2/A3: discoverable primary save, explanatory gesture, manual/automatic disk bridge then full browser restart',async()=>{
 const {file,html}=await fixture('manual-auto');let pickerCalls=0,writes=0;const records:object[]=[];
 let browser=await chromium.launch({channel:'chrome',headless:true});try{
  let p=await browser.newPage({offline:true,viewport:{width:1440,height:1000}});
  await p.exposeFunction('u03read',()=>readFile(file,'utf8'));await p.exposeFunction('u03write',async(s:string)=>{writes++;await writeFile(file,s);records.push({kind:writes===1?'manual':'automatic',sha256:sha(s),content:readEnhanced(s).content,time:new Date().toISOString()});});await p.exposeFunction('u03picker',()=>{pickerCalls++;});
  await p.addInitScript(()=>{const w=window as any;w.showOpenFilePicker=async()=>{await w.u03picker();return [{name:'manual-auto.ppte.html',queryPermission:async()=>'granted',requestPermission:async()=>'granted',getFile:async()=>({text:()=>w.u03read()}),createWritable:async()=>{let bytes='';return {write:async(s:string)=>{bytes=s;},close:()=>w.u03write(bytes),abort:async()=>{}};}}];};});
  await ready(p,file);assert.equal(pickerCalls,0);assert.equal(await p.locator('#ppte-save-ui').getAttribute('data-pristine'),'');
  await p.locator('#ppte-save-panel summary').click();assert.equal(await p.getByRole('button',{name:/复制恢复草稿|复制保留当前修改|查看磁盘版本|重新读取文件/}).count(),0);assert.equal(await p.getByRole('checkbox',{name:'自动保存'}).count(),0);await p.locator('#ppte-save-panel summary').click();
  const h=p.frameLocator('#ppte-frame').locator('h1').first();await h.fill('手动写回后的标题');await p.getByRole('button',{name:'页面设置',exact:true}).click();await p.getByRole('button',{name:'保存',exact:true}).click();assert.equal(pickerCalls,0);assert.match(await p.locator('#ppte-save-panel').innerText(),/首次保存需要选择当前文件/);await p.screenshot({path:join(out,'first-save.png')});
  await p.getByRole('button',{name:'选择当前文件并保存',exact:true}).click();await p.waitForFunction(()=>(window as any).PPTeSave.state==='saved');assert.equal(pickerCalls,1);assert.equal(writes,1);assert.match(await p.getByRole('status').innerText(),/已保存 ·/);assert.match(readEnhanced(await readFile(file,'utf8')).content,/手动写回后的标题/);
  assert.equal(await p.locator('#ppte-save-panel').getAttribute('open'),null);await h.fill('自动写回后的标题');await p.getByRole('button',{name:'页面设置',exact:true}).click();await p.waitForFunction(()=>{const c=(window as any).PPTeSave;return !c.dirty&&c.confirmedFileRevision===c.revision;});assert.equal(pickerCalls,1);assert.ok(writes>=2);const saved=await readFile(file,'utf8');assert.match(readEnhanced(saved).content,/自动写回后的标题/);await p.screenshot({path:join(out,'saved.png')});
  await browser.close();browser=await chromium.launch({channel:'chrome',headless:true});p=await browser.newPage({offline:true});await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeSave);assert.equal(await p.frameLocator('#ppte-frame').locator('h1').first().innerText(),'自动写回后的标题');assert.equal(await p.evaluate(()=>!!(window as any).PPTeSave.adapter),false);assert.equal(await p.locator('#ppte-save-ui').getAttribute('data-mode'),'read');await p.screenshot({path:join(out,'reopened.png')});
  await writeFile(join(out,'disk-bridge.json'),JSON.stringify({time:new Date().toISOString(),browser:browser.version(),platform:process.platform,nativePicker:false,headless:true,fullBrowserRestart:true,initial:sha(html),final:sha(saved),records},null,2));
 }finally{await browser.close();}
});
test('U03 A1/A3/A4: unsupported primary action downloads exactly one complete file; cache failure and beforeunload retain dirty state',async()=>{
 const {file,html}=await fixture('fallback');const browser=await chromium.launch({channel:'chrome',headless:true});try{
  const p=await browser.newPage({offline:true});await p.addInitScript(()=>{(window as any).showOpenFilePicker=undefined;Storage.prototype.setItem=()=>{throw Error('quota');};});await ready(p,file);
  assert.match(await p.getByRole('status').innerText(),/此浏览器不能覆盖原文件/);assert.equal(await p.getByRole('button',{name:'保存',exact:true}).count(),0);
  await p.frameLocator('#ppte-frame').locator('h1').first().fill('缓存不可用仍可下载');await p.getByRole('button',{name:'页面设置',exact:true}).click();assert.match(await p.getByRole('status').innerText(),/草稿恢复不可用/);
  const downloads:string[]=[];p.on('download',d=>downloads.push(d.suggestedFilename()));const event=p.waitForEvent('download');await p.getByRole('button',{name:'下载更新后的文件',exact:true}).click();const saved=join(out,'fallback-downloaded.ppte.html');await(await event).saveAs(saved);assert.equal(downloads.length,1);assert.match(readEnhanced(await readFile(saved,'utf8')).content,/缓存不可用仍可下载/);assert.equal(await readFile(file,'utf8'),html);assert.equal(await p.evaluate(()=>(window as any).PPTeSave.dirty),true);
  assert.equal(await p.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;}),true);assert.match(await p.getByRole('status').innerText(),/原文件未覆盖/);await p.screenshot({path:join(out,'fallback.png')});
 }finally{await browser.close();}
});
test('U03 A4: recovery requires preview, keeps editing and pre-recovery content, cancellation and storage errors are independent of file saves',async()=>{
 const {file}=await fixture('recovery');const browser=await chromium.launch({channel:'chrome',headless:true});try{
  const p=await browser.newPage({offline:true});await ready(p,file);const h=p.frameLocator('#ppte-frame').locator('h1').first();await h.fill('待恢复的草稿');await p.getByRole('button',{name:'页面设置',exact:true}).click();await p.evaluate(()=>(window as any).PPTeSave.draft());await p.reload();await p.waitForFunction(()=>!!(window as any).PPTeSave);await p.getByRole('button',{name:'编辑',exact:true}).click();
  await h.fill('恢复前新编辑');await p.getByRole('button',{name:'页面设置',exact:true}).click();await p.locator('#ppte-save-panel summary').click();assert.equal(await p.getByRole('button',{name:'恢复草稿',exact:true}).count(),0);await p.getByRole('button',{name:'预览恢复草稿',exact:true}).click();assert.equal(await h.innerText(),'恢复前新编辑');assert.match(await p.frameLocator('iframe[title="恢复草稿（只读）"]').locator('h1').first().innerText(),/待恢复的草稿/);
  await p.getByRole('button',{name:'恢复草稿',exact:true}).click();assert.equal(await h.innerText(),'待恢复的草稿');assert.equal(await p.evaluate(()=>(window as any).PPTeSave.dirty),true);assert.equal(await p.evaluate(()=>(window as any).PPTeSave.confirmedFileRevision),null);await p.getByRole('button',{name:'返回恢复前内容',exact:true}).click();assert.equal(await h.innerText(),'恢复前新编辑');await p.screenshot({path:join(out,'recovery.png')});
  await p.reload();await p.waitForFunction(()=>!!(window as any).PPTeSave);await p.getByRole('button',{name:'编辑',exact:true}).click();const before=await h.innerText();await p.locator('#ppte-save-panel summary').click();await p.getByRole('button',{name:'保留文件版本',exact:true}).click();assert.equal(await h.innerText(),before);assert.equal(await p.getByRole('button',{name:'恢复草稿',exact:true}).count(),0);
 }finally{await browser.close();}
});
test('U03 A4: corrupt recovery does not become a file-write failure; quota cannot block verified manual save',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const base:Snapshot={content:'old',hash:'base',fileKey:'a',name:'a',metadata:{documentId:'a',saveRevision:0}};let writes=0;
 const c=new SaveController({load:async()=>base,write:async()=>{writes++;return {...base,content:'latest'};}},base,()=> 'latest',()=>{},{getItem:()=>'{broken',setItem:()=>{throw Error('quota');},removeItem:()=>{}});
 assert.equal(c.recover(),undefined);assert.notEqual(c.state,'failed');assert.match(c.draftError,/草稿不可读取/);c.change();await c.flush();assert.equal(writes,1);assert.equal(c.state,'saved');assert.equal(c.dirty,false);assert.equal(c.confirmedFileRevision,c.revision);
});
test('U03 A2/A4 performance: large raster, real keyboard edits, natural cache quota, crop and verified manual write survive fresh browser',async()=>{
 await mkdir(out,{recursive:true});const file=join(out,'large-image.ppte.html');let browser=await chromium.launch({channel:'chrome',headless:true});try{
  let p=await browser.newPage({offline:true,viewport:{width:1440,height:1000}});
  const image=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=1600;c.height=1200;const x=c.getContext('2d')!,d=x.createImageData(c.width,c.height);let r=12345;for(let i=0;i<d.data.length;i+=4){for(let j=0;j<3;j++){r=(Math.imul(r,1664525)+1013904223)>>>0;d.data[i+j]=r>>>24;}d.data[i+3]=255;}x.putImageData(d,0,0);return c.toDataURL('image/png');});
  assert.ok(image.length>5*1024*1024);
  await writeFile(file,(await enhanceHTML(`<title>大图片保存检查</title><style>section{position:relative;width:1000px;height:700px}h1{font:40px system-ui}img{position:absolute;left:100px;top:150px;width:400px;height:240px;object-fit:cover;object-position:25% 75%}</style><section data-ppte-slide><h1>图片与文字</h1><img src="${image}" alt="测试用确定性像素图"></section>`,{root:out,base:out})).html);
  await p.exposeFunction('u03read',()=>readFile(file,'utf8'));await p.exposeFunction('u03write',(s:string)=>writeFile(file,s));
  await p.addInitScript(()=>{const w=window as any;w.showOpenFilePicker=async()=>[{name:'large-image.ppte.html',queryPermission:async()=>'granted',requestPermission:async()=>'granted',getFile:async()=>({text:()=>w.u03read()}),createWritable:async()=>{let bytes='';return {write:async(s:string)=>{bytes=s;},close:()=>w.u03write(bytes),abort:async()=>{}};}}];});await ready(p,file);
  await p.evaluate(()=>{const w=window as any;w.u03long=[];new PerformanceObserver(list=>{for(const e of list.getEntries())w.u03long.push(e.duration);}).observe({type:'longtask',buffered:true});});
  const h=p.frameLocator('#ppte-frame').locator('h1');await h.click();await h.dblclick();await p.keyboard.press('End');const latencies:number[]=[];for(const ch of '连续编辑保留完整内容'){const start=Date.now();await p.keyboard.insertText(ch);latencies.push(Date.now()-start);}
  await p.getByRole('button',{name:'页面设置',exact:true}).click();assert.match(await h.innerText(),/连续编辑保留完整内容/);await p.waitForFunction(()=>!!(window as any).PPTeSave.draftError);assert.match(await p.getByRole('status').innerText(),/草稿恢复不可用/);
  // Crop property interactions remain the pre-U02 UI; this tests persistence, not U02 usability.
  const img=p.frameLocator('#ppte-frame').locator('img');await img.click();await p.getByRole('button',{name:'填充裁切',exact:true}).click();const focus=p.getByLabel('水平焦点（0–100%）',{exact:true});await focus.fill('70');await focus.press('Tab');const crop=await img.evaluate(n=>getComputedStyle(n).objectPosition);assert.match(crop,/70%/);
  await p.getByRole('button',{name:'保存',exact:true}).click();await p.getByRole('button',{name:'选择当前文件并保存',exact:true}).click();await p.waitForFunction(()=>(window as any).PPTeSave.state==='saved');const saved=await readFile(file,'utf8');assert.match(readEnhanced(saved).content,/连续编辑保留完整内容/);const metrics=await p.evaluate(()=>(window as any).u03long);await p.screenshot({path:join(out,'large-image.png')});
  await browser.close();browser=await chromium.launch({channel:'chrome',headless:true});p=await browser.newPage({offline:true});await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeSave);const reopened=p.frameLocator('#ppte-frame').locator('img');assert.equal(await reopened.evaluate(n=>getComputedStyle(n).objectPosition),crop);assert.equal(await reopened.getAttribute('src'),image);assert.match(await p.frameLocator('#ppte-frame').locator('h1').innerText(),/连续编辑保留完整内容/);
  await writeFile(join(out,'large-image.json'),JSON.stringify({time:new Date().toISOString(),headless:true,nativePicker:false,browser:browser.version(),fileBytes:Buffer.byteLength(saved),sha256:sha(saved),imageBytes:Buffer.from(image.split(',')[1],'base64').length,keyboardRoundTripMs:latencies,longTasksMs:metrics,naturalQuotaFailure:true,manualWritePassed:true,crop,fullBrowserRestart:true,note:'Timings include automation/host contention; no human smoothness claim.'},null,2));
 }finally{await browser.close();}
});
test('U03 A4: known cache failure backs off repeated checkpoints, retains cached content and retries on manual save',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const base:Snapshot={content:'old',hash:'base',fileKey:'a',name:'a',metadata:{documentId:'a',saveRevision:0}};let attempts=0,value='one';
 const c=new SaveController(undefined,base,()=>value,()=>{},{getItem:()=>null,setItem:()=>{attempts++;throw Error('quota');},removeItem:()=>{throw Error('must not delete');}});c.change();assert.equal(attempts,1);value='latest';c.change();t.mock.timers.tick(1999);assert.equal(attempts,1);t.mock.timers.tick(1);assert.equal(attempts,2);assert.equal(c.snapshotContent(),'latest');await c.flush();assert.equal(attempts,3);assert.equal(c.dirty,true);
});
test('U03 A4: failed disk reread/mount cannot clear unsaved revision or replace the confirmed baseline',async()=>{
 const {file}=await fixture('reread-failure');const browser=await chromium.launch({channel:'chrome',headless:true});try{
  const p=await browser.newPage({offline:true});await ready(p,file);const h=p.frameLocator('#ppte-frame').locator('h1').first();await h.fill('读取失败仍保留');await p.getByRole('button',{name:'页面设置',exact:true}).click();
  const before=await p.evaluate(()=>{const c=(window as any).PPTeSave;const base=c.base;c.adapter={load:async()=>({...base,hash:'different-disk',content:'<script>alert(1)</script><h1>unsafe disk</h1>'})};c.set('conflict','外部修改');return {revision:c.revision,hash:c.base.hash};});
  p.on('dialog',d=>d.accept());await p.getByRole('button',{name:'重新读取文件',exact:true}).click();await p.waitForFunction(()=>(window as any).PPTeSave.state==='failed');assert.equal(await h.innerText(),'读取失败仍保留');assert.deepEqual(await p.evaluate(()=>{const c=(window as any).PPTeSave;return {revision:c.revision,hash:c.base.hash};}),before);assert.equal(await p.evaluate(()=>(window as any).PPTeSave.dirty),true);assert.equal(await p.getByRole('button',{name:'返回恢复前内容',exact:true}).isVisible(),true);
 }finally{await browser.close();}
});
