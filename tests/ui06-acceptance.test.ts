import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chromium, type Page } from 'playwright';
import { enhanceHTML, readEnhanced } from '../packages/html-document/src/index.js';
import { readHistory } from '../packages/html-document/src/history-wire.js';
import { packMedia } from '../packages/html-document/src/media-table.js';
import { Versions } from '../packages/html-editor/src/versions.js';
const out=resolve('artifacts/ui06'), evidence=resolve('docs/ui-redesign/evidence/UI06');
const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const frame=(p:Page)=>p.frameLocator('#ppte-frame');
async function insert(p:Page,name:string,child?:string){await p.getByRole('button',{name:'插入',exact:true}).click();await p.getByRole('menuitem',{name,exact:true}).click();if(child)await p.getByRole('menuitem',{name:child,exact:true}).click();}
async function property(p:Page,name:string,value:string){await p.getByLabel(name,{exact:true}).fill(value);await p.getByLabel(name,{exact:true}).press('Tab');}
async function history(p:Page){await p.getByText('更多',{exact:true}).click();await p.getByRole('menuitem',{name:'版本历史',exact:true}).click();}
async function checkpoint(p:Page,name:string){await history(p);p.once('dialog',d=>d.accept(name));await p.getByRole('button',{name:'保存命名版本',exact:true}).click();await p.locator('#ppte-versions section').filter({hasText:name}).waitFor();await p.getByRole('button',{name:'关闭版本历史',exact:true}).click();}
async function download(p:Page,path:string){const event=p.waitForEvent('download');await p.getByRole('button',{name:'下载更新后的文件',exact:true}).click();const d=await event;assert.match(d.suggestedFilename(),/\.ppte\.html$/);await d.saveAs(path);assert.equal(await d.failure(),null);assert.match(await p.getByRole('status').innerText(),/原文件未覆盖/);assert.equal(await p.evaluate(()=>(window as any).PPTeSave.dirty),true);}

test('UI06 A1/A2: product offline four-object history → download → full shutdown → copy → preview/restore → download → fresh read/show/PDF',async()=>{
 await mkdir(join(out,'portable'),{recursive:true});
 const source=await readFile('tests/fixtures/ui06/journey.html','utf8');
 const original=join(out,'original.ppte.html');await writeFile(original,(await enhanceHTML(source,{root:out,base:out,mediaTable:true})).html);
 const originalHash=sha(await readFile(original));const errors:string[]=[],network:string[]=[];const timings:Record<string,number>={};const sessions:unknown[]=[];
 let browser=await chromium.launch({channel:'chrome',headless:true});
 async function open(path:string){const p=await browser.newPage({offline:true,acceptDownloads:true,viewport:{width:1440,height:1000}});p.on('pageerror',e=>errors.push(String(e)));p.on('request',r=>{if(/^(https?|wss?):/.test(r.url()))network.push(r.url());});const start=performance.now();await p.goto(pathToFileURL(path).href);await p.waitForFunction(()=>!!(window as any).PPTeSave);timings[`open${sessions.length+1}Ms`]=performance.now()-start;assert.equal(await p.locator('#ppte-save-ui').getAttribute('data-mode'),'read');assert.equal(await p.evaluate(()=>localStorage.length),0);sessions.push(await p.evaluate(()=>({protocol:location.protocol,userAgent:navigator.userAgent,openPicker:typeof(window as any).showOpenFilePicker,secure:isSecureContext,cacheEntries:localStorage.length})));return p;}
 try{
  let p=await open(original);await p.screenshot({path:join(out,'reading.png')});await p.getByRole('button',{name:'编辑',exact:true}).click();await p.getByRole('button',{name:'下一页',exact:true}).click();
  await insert(p,'文本框');await frame(p).locator('[data-ppte-kind=text]').fill('第一稿 · 保留想法');await property(p,'字号','28px');
  await insert(p,'形状','矩形');await property(p,'填充','#6f8c69');await property(p,'宽度','180px');await property(p,'高度','72px');await property(p,'圆角','12px');
  // Deterministic encoded PNG: two colored halves make non-destructive crop/recovery observable.
  const png=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=240;c.height=120;const x=c.getContext('2d')!;x.fillStyle='#426d58';x.fillRect(0,0,120,120);x.fillStyle='#dfbc75';x.fillRect(120,0,120,120);return c.toDataURL();});
  await p.getByRole('button',{name:'插入',exact:true}).click();const chooser=p.waitForEvent('filechooser');await p.getByRole('menuitem',{name:'图片',exact:true}).click();await(await chooser).setFiles({name:'two-tones.png',mimeType:'image/png',buffer:Buffer.from(png.split(',')[1],'base64')});await frame(p).locator('img').waitFor();await property(p,'宽度','240px');await property(p,'高度','120px');await p.getByRole('button',{name:'填充裁切',exact:true}).click();await property(p,'水平焦点（0–100%）','25');
  await insert(p,'表格','2 行 2 列');await frame(p).locator('td').first().click();await frame(p).locator('td').first().fill('初稿');await property(p,'单元格填充','#e2e9df');
  const t=performance.now();await checkpoint(p,'四类对象 · 第一稿');timings.checkpointMs=performance.now()-t;
  const first=await p.evaluate(()=>(window as any).PPTeHTML.content());
  await frame(p).locator('[data-ppte-kind=text]').fill('第二稿 · 继续表达');await frame(p).locator('[data-ppte-kind=shape]').click();await property(p,'填充','#dfbc75');await frame(p).locator('img').click();await property(p,'水平焦点（0–100%）','75');await frame(p).locator('td').first().click();await frame(p).locator('td').first().fill('定稿');await property(p,'单元格填充','#fff0cc');
  await checkpoint(p,'四类对象 · 第二稿');const second=await p.evaluate(()=>(window as any).PPTeHTML.content());assert.notEqual(first,second);await p.screenshot({path:join(out,'editing.png')});
  const saved=join(out,'saved.ppte.html');let start=performance.now();await download(p,saved);timings.downloadMs=performance.now()-start;assert.equal(sha(await readFile(original)),originalHash);
  await browser.close();const portable=join(out,'portable','唯一文件.ppte.html');await copyFile(saved,portable);assert.deepEqual(await readdir(join(out,'portable')),['唯一文件.ppte.html']);
  browser=await chromium.launch({channel:'chrome',headless:true});p=await open(portable);assert.equal(await p.evaluate(()=>(window as any).PPTeHTML.content()),second);assert.equal(await p.evaluate(()=>(window as any).PPTeHTML.versions.decoded),0);
  await history(p);assert.equal(await p.getByRole('button',{name:'恢复到此版本',exact:true}).count(),0);const target=p.locator('#ppte-versions section').filter({hasText:'四类对象 · 第一稿'});start=performance.now();await target.getByRole('button',{name:'预览',exact:true}).click();const preview=p.frameLocator('iframe[title="版本预览（只读）"]');await preview.locator('table').waitFor();timings.previewMs=performance.now()-start;
  assert.equal(await preview.locator('[data-ppte-kind=text]').innerText(),'第一稿 · 保留想法');assert.equal(await preview.locator('[data-ppte-kind=shape]').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(111, 140, 105)');assert.equal(await preview.locator('img').evaluate(n=>getComputedStyle(n).objectPosition),'25% 50%');assert.equal(await preview.locator('td').first().innerText(),'初稿');assert.equal(await p.evaluate(()=>(window as any).PPTeHTML.content()),second);assert.equal(await p.evaluate(()=>(window as any).PPTeSave.dirty),false);
  await p.getByRole('button',{name:'关闭版本历史',exact:true}).click();await p.getByRole('button',{name:'编辑',exact:true}).click();await p.getByRole('button',{name:'下一页',exact:true}).click();await frame(p).locator('[data-ppte-kind=text]').fill('恢复前 · 未保存的想法');await history(p);p.once('dialog',d=>{assert.match(d.message(),/当前内容会先保留/);return d.accept();});start=performance.now();await target.getByRole('button',{name:'恢复到此版本',exact:true}).click();await p.waitForFunction(()=>!(window as any).PPTeHTML.content().includes('恢复前 · 未保存的想法'));timings.restoreMs=performance.now()-start;assert.equal(await p.evaluate(()=>(window as any).PPTeHTML.content()),first);
  await p.locator('#ppte-versions section').filter({hasText:'恢复前'}).getByRole('button',{name:'预览',exact:true}).click();assert.equal(await preview.locator('[data-ppte-kind=text]').innerText(),'恢复前 · 未保存的想法');await p.screenshot({path:join(out,'restore-preview.png')});await p.getByRole('button',{name:'关闭版本历史',exact:true}).click();const final=join(out,'sample.ppte.html');await download(p,final);
  const bytes=await readFile(final,'utf8'), enhanced=readEnhanced(bytes),wire=readHistory(bytes)!;const versions=new Versions(enhanced.metadata.documentId,wire,()=>packMedia(enhanced.content).table.resources);assert.equal(bytes.split(png).length-1,1);assert.equal(versions.index.versions.filter(v=>v.kind==='before-restore').length,1);for(const [name,expected] of [['四类对象 · 第一稿',first],['四类对象 · 第二稿',second]])assert.equal(versions.preview(versions.index.versions.find(v=>v.name===name)!.id),expected);
  await browser.close();browser=await chromium.launch({channel:'chrome',headless:true});p=await open(final);assert.equal(await p.evaluate(()=>(window as any).PPTeHTML.content()),first);await p.getByRole('button',{name:'下一页',exact:true}).click();await frame(p).locator('img').evaluate(async n=>{await (n as HTMLImageElement).decode();});assert.equal(await frame(p).locator('img').evaluate(n=>(n as HTMLImageElement).naturalWidth),240);await p.screenshot({path:join(out,'reopened.png')});await p.getByRole('button',{name:'放映',exact:true}).click();assert.equal(await p.locator('#ppte-save-ui').isVisible(),false);await p.mouse.move(700,300);assert.equal(await p.locator('#ppte-save-ui').isVisible(),false);await p.screenshot({path:join(out,'present.png')});await p.keyboard.press('Escape');assert.equal(await p.locator('#ppte-save-ui').getAttribute('data-mode'),'read');
  // Print product API emits all slides; PDFKit independently verifies the browser's PDF bytes.
  await p.evaluate(()=>(window as any).PPTePrint.prepare());await p.emulateMedia({media:'print'});assert.equal(await p.locator('#ppte-print>div').count(),2);assert.equal(await p.locator('#ppte-save-ui').isVisible(),false);await p.pdf({path:join(out,'journey.pdf'),preferCSSPageSize:true,printBackground:true});const inspection=spawnSync('swift',['scripts/verify-journey-pdf.swift',join(out,'journey.pdf')],{encoding:'utf8'});assert.equal(inspection.status,0,inspection.stderr);const pages=JSON.parse(inspection.stdout);assert.equal(pages.length,2);assert.match(pages[0].text,/把作品带走/);assert.match(pages[1].text,/第一稿/);assert.match(pages[1].text,/初稿/);for(const page of pages){assert.ok(Math.abs(page.width-720)<1);assert.ok(Math.abs(page.height-480)<1);assert.doesNotMatch(page.text,/保存命名版本|恢复到此版本|下载更新后的文件|第二稿/);}await writeFile(join(out,'pdf-inspection.json'),JSON.stringify(pages,null,2));
  assert.deepEqual(network,[]);assert.deepEqual(errors,[]);await writeFile(join(out,'journey.json'),JSON.stringify({status:'passed',timestamp:new Date().toISOString(),browser:browser.version(),headless:true,sessions,wholeBrowserShutdowns:2,offline:true,network,errors,timings,savePath:'actual browser download; no native permission or disk-write bridge',originalHash,originalAfterHash:sha(await readFile(original)),sample:{sha256:sha(bytes),bytes:Buffer.byteLength(bytes)},historyVersions:versions.index.versions.length,resourceCopies:1,source:'tests/fixtures/ui06/journey.html',image:'Generated two-tone PNG; not real-user media or aesthetic evidence',pdf:'Chromium PDF API + independent PDFKit; native dialog pending'},null,2));
 }finally{await browser.close();}
});

test('UI06 A3 evidence contract: native/Safari unknowns cannot inherit headless or bridge passes',async()=>{
 const matrix=JSON.parse(await readFile(join(evidence,'environment-matrix.json'),'utf8'));
 assert.equal(matrix.chromeHeadless.evidence,'docs/ui-redesign/evidence/UI06/journey.json');
 for(const key of ['safari','nativePermissions','systemIME','nativePrint','screenReader','independentDevice']){assert.equal(matrix[key].status,'pending');assert.equal(matrix[key].result,null);assert.ok(matrix[key].reason.length>15);assert.ok(matrix[key].procedure.length>20);}
 assert.equal(matrix.nativePermissions.bridgeIsNativeEvidence,false);
});

test('UI06 A4 evidence contract: UI feedback and sample aesthetics have separate unfilled human records and vetoes',async()=>{
 const ui=JSON.parse(await readFile(join(evidence,'ui-feedback.json'),'utf8')),art=JSON.parse(await readFile(join(evidence,'sample-aesthetics.json'),'utf8'));
 assert.equal(ui.category,'product-ui');assert.equal(art.category,'sample-aesthetics');
 for(const record of [ui,art]){assert.equal(record.status,'pending');assert.equal(record.result,null);assert.ok(record.reason);assert.equal(record.reviewers.length,3);for(const reviewer of record.reviewers){assert.equal(reviewer.rating,null);assert.equal(reviewer.comments,null);}assert.ok(record.criteria.length>=4);}
 assert.deepEqual(Object.keys(art.vetoes).sort(),['crop','facts','save']);assert.ok(Object.values(art.vetoes).every(v=>v===null));assert.equal(art.controlledPairs.count,0);assert.equal(art.controlledPairs.result,null);
});
