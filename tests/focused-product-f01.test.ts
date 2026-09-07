import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Page } from 'playwright';
import { enhanceHTML, readEnhanced } from '../packages/html-document/src/index.js';
import { historyHTML, readHistory } from '../packages/html-document/src/history-wire.js';
import { Versions, type HistoryWire } from '../packages/html-editor/src/versions.js';
import { packMedia } from '../packages/html-document/src/media-table.js';
import { downloadUpdated } from './helpers/focused-product.js';
import { resizeViewport } from './helpers/browser-viewport.js';
const out=resolve('artifacts/focused-product/F01');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const image='data:image/png;base64,'+png.toString('base64');
async function source() {
 const video=(await readFile('tests/fixtures/media/blue-vp9.webm')).toString('base64');
 return `<title>F01 兼容性</title><style>body{margin:0}section{width:960px;min-height:640px;box-sizing:border-box;padding:30px;background:#f8f7f2}h1{font:32px system-ui}.content{display:flex;flex-direction:column;gap:12px}img{width:64px;height:48px}video{width:80px;height:50px}</style><section data-ppte-slide data-ppte-id="s1"><h1 data-ppte-id="title">作者原文</h1><div class="content" data-ppte-content><p>中文正文 English</p><div data-ppte-kind="shape" style="width:40px;height:20px;background:#268454"></div><table><tbody><tr><td>原有单元格</td></tr></tbody></table><svg width="40" height="20"><circle cx="10" cy="10" r="8" fill="green"/></svg><img src="${image}"><video controls muted src="data:video/webm;base64,${video}" poster="${image}"></video></div></section><section data-ppte-slide data-ppte-id="s2"><h1>第二页完整内容</h1></section>`;
}
async function open(name:string, history?:'valid'|'broken'|'unknown') {
 await mkdir(out,{recursive:true});const initial=await enhanceHTML(await source(),{root:out,base:out,mediaTable:true});
 let wire:HistoryWire|undefined;
 if(history==='valid'){const v=new Versions(initial.metadata.documentId);v.add(readEnhanced(initial.html).content.replace('作者原文','旧版本原文'),'manual','保留旧历史',1);wire=v.wire(packMedia(readEnhanced(initial.html).content).table.resources);}
 else if(history)wire={index:history==='broken'?'{':'{"schemaVersion":99,"future":"保留未知数据"}',blocks:{opaque:'原样保留的块'},resources:{}};
 const html=initial.html.replace('<script id="ppte-runtime"',historyHTML(wire)+'<script id="ppte-runtime"');const file=join(out,name+'.ppte.html');await writeFile(file,html);
 const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({offline:true,acceptDownloads:true,viewport:{width:1440,height:1000}});
 const errors:string[]=[],network:string[]=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
 await page.goto(pathToFileURL(file).href);await page.waitForFunction(()=>!!(window as any).PPTeSave);
 return {page,browser,file,html,wire,async close(){await browser.close();assert.deepEqual(errors,[]);assert.deepEqual(network,[]);}};
}
async function content(p:Page){return p.evaluate(()=>(window as any).PPTeHTML.content());}
async function noRetiredControls(p:Page){
 const labels=await p.locator('#ppte-save-ui,#ppte-edit-toolbar,#ppte-workspace').evaluateAll(ns=>ns.flatMap(n=>Array.from(n.querySelectorAll('button,summary,[role=menuitem]')).map(e=>[e.textContent,e.getAttribute('aria-label'),e.getAttribute('title')].join(' '))));
 assert.doesNotMatch(labels.join('\n'),/文本框|插入对象|插入指定表格|版本历史|保存命名版本|下载不含历史|另存为新文件/);
 assert.equal(await p.locator('#ppte-insert-menu,#ppte-versions').count(),0);
 assert.equal(await p.getByText('更多',{exact:true}).count(),0);
 assert.equal(await p.locator('#ppte-save-ui > button[aria-label="下载更新后的文件"]').count(),0);
}
test('F01 A1/A2: one direct image chooser, no retired shortcuts/menus, disabled truthful top-level PDF and responsive shell',async()=>{
 const f=await open('controls');const p=f.page;try{
  await noRetiredControls(p);const original=await content(p);
  await p.evaluate(()=>{(window as any).printCalls=0;window.print=()=>{(window as any).printCalls++;};});
  for(const mode of ['read','edit']){
   if(mode==='edit')await p.getByRole('button',{name:'编辑',exact:true}).click();
   const pdf=p.getByRole('button',{name:'导出为 PDF',exact:true});assert.equal(await pdf.count(),1);assert.equal(await pdf.isVisible(),true);assert.equal(await pdf.isDisabled(),true);assert.match(await pdf.getAttribute('title')??'',/尚未可用/);
   assert.equal(await pdf.evaluate(n=>n.parentElement?.id),'ppte-save-ui');
   await pdf.evaluate(n=>(n as HTMLButtonElement).click());
   await p.getByRole('button',{name:mode==='read'?'编辑':'插入图片',exact:true}).focus();await p.keyboard.press('t');await p.keyboard.press('T');
   assert.equal(await content(p),original);
  }
  assert.equal(await p.evaluate(()=>typeof (window as any).PPTePrint),'undefined');await p.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));assert.equal(await p.locator('#ppte-print').count(),0);assert.equal(await p.evaluate(()=>(window as any).printCalls),0);
  await p.frameLocator('#ppte-frame').locator('svg').click();await p.keyboard.press('t');await p.keyboard.press('T');assert.equal(await content(p),original);assert.equal(await p.evaluate(()=>(window as any).PPTeSave.dirty),false);
  const insert=p.getByRole('button',{name:'插入图片',exact:true});assert.equal(await insert.getAttribute('aria-haspopup'),null);
  await insert.focus();const cancelled=p.waitForEvent('filechooser');await p.keyboard.press('Enter');await(await cancelled).setFiles([]);assert.equal(await content(p),original);assert.equal(await p.getByRole('button',{name:'撤销',exact:true}).isDisabled(),true);
  const chooser=p.waitForEvent('filechooser');await insert.click();await(await chooser).setFiles({name:'local.png',mimeType:'image/png',buffer:png});await p.frameLocator('#ppte-frame').locator('img[data-ppte-editor-selected]').waitFor();
  assert.equal(await p.frameLocator('#ppte-frame').locator('img').count(),2);await p.getByRole('button',{name:'撤销',exact:true}).click();assert.equal(await content(p),original);await p.getByRole('button',{name:'重做',exact:true}).click();assert.equal(await p.frameLocator('#ppte-frame').locator('img').count(),2);
  await noRetiredControls(p);
  for(const width of [1440,1024,390]){await resizeViewport(p,{width,height:1000});for(const mode of ['阅读','编辑']){await p.getByRole('button',{name:mode,exact:true}).click();for(const selector of ['#ppte-save-ui','#ppte-edit-toolbar']){if(!await p.locator(selector).isVisible())continue;const r=(await p.locator(selector).boundingBox())!;assert.ok(r.x>=0&&r.x+r.width<=width+1,JSON.stringify({selector,width,r}));}const r=(await p.getByRole('button',{name:'导出为 PDF',exact:true}).boundingBox())!;assert.ok(r.x>=0&&r.x+r.width<=width+1);await p.screenshot({path:join(out,`${mode}-${width}.png`)});}}
  await writeFile(join(out,'browser.json'),JSON.stringify({time:new Date().toISOString(),browser:f.browser.version(),platform:process.platform,headless:true,offline:true,nativePicker:false,chooser:'Playwright filechooser capture/setFiles',screenshots:[1440,1024,390],human:'pending: user has not reviewed UI'},null,2));
 }finally{await f.close();}
});
for(const history of [undefined,'valid','broken','unknown'] as const)test(`F01 A3: ${history??'no'} history and all author content survive edit/download/full browser restart`,async()=>{
 const f=await open('history-'+(history??'none'),history);const p=f.page;try{
  const before=await content(p);const wireBefore=await p.evaluate(()=>(window as any).PPTeHTML.versions.wire());
  await p.evaluate(()=>{(window as any).PPTeHTML.versions.automatic=()=>{throw Error('F01: automatic history creation must not run');};});
  if(history==='broken'||history==='unknown'){assert.match(await p.getByRole('alert').innerText(),/原始历史保留/);assert.doesNotMatch(await p.getByRole('alert').innerText(),/下载不含历史/);}
  await p.getByRole('button',{name:'编辑',exact:true}).click();await p.frameLocator('#ppte-frame').locator('[data-ppte-id=title]').fill('修改后的原文');
  await p.getByRole('button',{name:'页面设置',exact:true}).click();
  const updated=await content(p);assert.equal(updated,before.replace('作者原文','修改后的原文'));
  const event=p.waitForEvent('download');await downloadUpdated(p);const saved=join(out,`saved-${history??'none'}.ppte.html`);await(await event).saveAs(saved);
  const downloaded=await readFile(saved,'utf8');assert.equal(readEnhanced(downloaded).content,updated);assert.deepEqual(readHistory(downloaded),f.wire);assert.deepEqual(await p.evaluate(()=>(window as any).PPTeHTML.versions.wire()),wireBefore);assert.equal(await readFile(f.file,'utf8'),f.html);
  assert.match(await p.getByRole('status').innerText(),/原文件未覆盖/);
  await f.browser.close();const fresh=await chromium.launch({channel:'chrome',headless:true});try{
   const q=await fresh.newPage({offline:true});await q.goto(pathToFileURL(saved).href);await q.waitForFunction(()=>!!(window as any).PPTeSave);assert.equal(await content(q),updated);assert.equal(await q.locator('#ppte-save-ui').getAttribute('data-mode'),'read');await noRetiredControls(q);
   if(history==='valid'){const v=new Versions(readEnhanced(downloaded).metadata.documentId,readHistory(downloaded),()=>packMedia(updated).table.resources);assert.match(v.preview(v.index.versions[0].id),/旧版本原文/);assert.equal(v.index.versions.length,1);}
   await q.getByRole('button',{name:'放映',exact:true}).click();assert.equal(await q.locator('#ppte-save-ui').isVisible(),false);await q.keyboard.press('ArrowRight');await q.keyboard.press('Escape');assert.equal(await content(q),updated);
  }finally{await fresh.close();}
 }finally{await f.close();}
});
test('F01 A3: simulated native adapter writes real disk and preserves old media history without new snapshots',async()=>{
 const f=await open('bridge','valid');const p=f.page;try{
  await p.exposeFunction('f01Read',()=>readFile(f.file,'utf8'));await p.exposeFunction('f01Write',(s:string)=>writeFile(f.file,s));
  await p.evaluate(()=>{const w=window as any;w.PPTeHTML.versions.automatic=()=>{throw Error('automatic history called');};w.showOpenFilePicker=async()=>[{name:'bridge.ppte.html',requestPermission:async()=>'granted',queryPermission:async()=>'granted',getFile:async()=>({text:()=>w.f01Read()}),createWritable:async()=>{let data='';return {write:async(s:string)=>{data=s;},close:()=>w.f01Write(data),abort:async()=>{}};}}];});
  await p.getByRole('button',{name:'编辑',exact:true}).click();await p.frameLocator('#ppte-frame').locator('[data-ppte-id=title]').fill('磁盘修改');await p.getByRole('button',{name:'保存',exact:true}).click();await p.waitForFunction(()=>(window as any).PPTeSave.state==='saved');
  // Remove the current shared image through UI; old checkpoint must retain its media.
  await p.getByRole('button',{name:'页面设置',exact:true}).click();await p.frameLocator('#ppte-frame').locator('img').click();await p.getByRole('button',{name:'删除对象',exact:true}).click();await p.waitForFunction(()=>(window as any).PPTeSave.state==='saved'&&!(window as any).PPTeSave.dirty);
  const disk=await readFile(f.file,'utf8'),parsed=readEnhanced(disk);assert.match(parsed.content,/磁盘修改/);assert.deepEqual(readHistory(disk),f.wire);
  const v=new Versions(parsed.metadata.documentId,readHistory(disk),()=>packMedia(parsed.content).table.resources);assert.equal(v.index.versions.length,1);assert.match(v.preview(v.index.versions[0].id),/旧版本原文/);assert.ok(v.preview(v.index.versions[0].id).includes(image));
 }finally{await f.close();}
});
test('F01 A1–A3: audited Cherry ten-page document upgrades without content loss and keeps focused controls',async()=>{
 await mkdir(out,{recursive:true});const original=await readFile('docs/audits/2026-09-07-main-d1db13d/sample/Cherry-Studio-开源之路.ppte.html','utf8');
 const upgraded=await enhanceHTML(original,{root:out,base:out});assert.equal(readEnhanced(upgraded.html).content,readEnhanced(original).content);assert.deepEqual(readHistory(upgraded.html),readHistory(original));
 const file=join(out,'Cherry-F01.ppte.html');await writeFile(file,upgraded.html);const browser=await chromium.launch({channel:'chrome',headless:true});try{
  const p=await browser.newPage({offline:true,viewport:{width:1440,height:1000}});const errors:string[]=[];p.on('pageerror',e=>errors.push(String(e)));await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeSave);
  assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-slide]').count(),10);const initial=await content(p);
  for(let i=1;i<10;i++)await p.getByRole('button',{name:'下一页',exact:true}).click();for(let i=1;i<10;i++)await p.getByRole('button',{name:'上一页',exact:true}).click();assert.equal(await content(p),initial);
  for(const width of [1440,1024,390]){await resizeViewport(p,{width,height:1000});for(const mode of ['阅读','编辑']){await p.getByRole('button',{name:mode,exact:true}).click();await noRetiredControls(p);await p.screenshot({path:join(out,`Cherry-${mode}-${width}.png`)});}}
  // CSSOM reads during editing may normalize inline declaration whitespace.
  // Compare the entire author DOM after canonicalizing every style declaration,
  // retaining all properties/values/priorities and all non-style bytes.
  const canonical=await p.evaluate(values=>values.map(value=>{const doc=new DOMParser().parseFromString(value,'text/html');for(const n of Array.from(doc.querySelectorAll<HTMLElement>('[style]')))n.setAttribute('style',n.style.cssText);return doc.documentElement.outerHTML;}),[initial,await content(p)]);
  assert.equal(canonical[1],canonical[0]);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
