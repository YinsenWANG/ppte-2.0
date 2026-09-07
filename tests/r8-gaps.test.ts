import { downloadUpdated } from './helpers/focused-product.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { enhanceHTML, readEnhanced } from '../packages/html-document/src/index.js';
const out=resolve('artifacts/r8-gaps');

test('GAPS N04: fixed sRGB rasterization preserves original >4000 gates and rejects missing red, blue, and image',async()=>{
 await mkdir(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true});
 const records:Record<string,unknown>={};
 const inspect=(file:string)=>{const r=spawnSync('swift',['scripts/verify-journey-pdf.swift',file],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout)[0];};
 try {
  // Same historical failing bytes; copy before rasterizer writes sidecar PNGs.
  const historical=join(out,'historical-failed.pdf');await copyFile('docs/audits/2026-09-07-main-61310c7/evidence/initial-s07.pdf',historical);
  const old=inspect(historical);assert.ok(old.redPixels>4000);assert.ok(old.bluePixels>4000);records.historical=old;
  const page=await browser.newPage();
  for(const [name,red,blue] of [['both',true,true],['no-red',false,true],['no-blue',true,false],['no-image',false,false]] as const){
   await page.setContent(`<style>@page{size:960px 540px;margin:0}body{margin:0}svg{margin:40px}</style><svg width="160" height="80"><rect width="80" height="80" fill="${red?'#ff0000':'white'}"/><rect x="80" width="80" height="80" fill="${blue?'#0000ff':'white'}"/></svg>`);
   const path=join(out,`${name}.pdf`);await page.pdf({path,preferCSSPageSize:true,printBackground:true});const p=inspect(path);
   assert.equal(p.redPixels>4000,red);assert.equal(p.bluePixels>4000,blue);assert.equal(p.colorSpace,'sRGB');records[name]=p;
  }
  await writeFile(join(out,'pdf-controls.json'),JSON.stringify({time:new Date().toISOString(),browser:browser.version(),records},null,2));
 }finally{await browser.close();}
});

test('GAPS A4: real navigation, image edit undo, versions, download/reopen, presentation and PDF demand/release', async t=>{
 await mkdir(out,{recursive:true});let browser=await chromium.launch({channel:'chrome',headless:true});
 const network:string[]=[],errors:string[]=[];
 let original:string,downloaded=join(out,'media-downloaded.ppte.html');
 try {
  const context=await browser.newContext({offline:true,viewport:{width:1440,height:960}});const page=await context.newPage();page.setDefaultTimeout(10000);
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=512;c.height=512;const x=c.getContext('2d')!;x.fillStyle='red';x.fillRect(0,0,512,512);return c.toDataURL();});
  const video=(await readFile('tests/fixtures/media/blue-vp9.webm')).toString('base64');
  const source='<title>Media demand</title><style>body{margin:0}section{width:960px;height:540px;background:white}img{width:240px;height:240px}video{width:120px;height:80px}</style>'+Array.from({length:12},(_,i)=>`<section data-ppte-slide><h1>Page ${i+1}</h1><img src="${png}" alt="Image ${i+1}">${i===0?`<video controls muted poster="${png}"><source src="data:video/webm;base64,${video}" type="video/webm"></video>`:''}</section>`).join('');
  original=(await enhanceHTML(source,{root:out,base:out,mediaTable:true})).html;const file=join(out,'media.ppte.html');await writeFile(file,original);
  context.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(pathToFileURL(file).href);await page.getByRole('button',{name:'编辑',exact:true}).waitFor();
  const frame=page.frameLocator('#ppte-frame');
  const beforeNavigation=await page.evaluate(()=>(window as any).PPTeHTML.content());
  assert.equal(await frame.locator('img[src]').count(),1);assert.equal(await frame.locator('img:not([src])').count(),11);
  await frame.getByAltText('Image 1',{exact:true}).evaluate(n=>(n as HTMLImageElement).decode());
  await page.getByRole('button',{name:'下一页',exact:true}).click();await frame.getByAltText('Image 2',{exact:true}).evaluate(n=>(n as HTMLImageElement).decode());
  assert.equal(await frame.getByAltText('Image 1',{exact:true}).getAttribute('src'),null);
  await page.waitForFunction(()=>document.querySelector<HTMLIFrameElement>('#ppte-frame')!.contentDocument!.querySelector('img')!.naturalWidth===0);
  assert.equal(await frame.locator('video source').getAttribute('src'),null);assert.equal(await frame.locator('video').evaluate(n=>(n as HTMLVideoElement).paused),true);
  assert.equal(await page.evaluate(()=>(window as any).PPTeHTML.content()),beforeNavigation);
  await page.getByRole('button',{name:'编辑',exact:true}).click();
  // Only intersecting rail thumbnails receive URLs, and closing the rail releases them.
  await page.waitForFunction(()=>{const roots=Array.from(document.querySelectorAll('.preview')).map(n=>n.shadowRoot!);const loaded=roots.reduce((sum,r)=>sum+r.querySelectorAll('img[src]').length,0);return loaded>0&&loaded<12;});
  const imageBox=await frame.getByAltText('Image 2',{exact:true}).boundingBox();assert.ok(imageBox && imageBox.y>0 && imageBox.y+imageBox.height<960);
  await page.mouse.click(imageBox.x+imageBox.width/2,imageBox.y+imageBox.height/2);await page.getByRole('button',{name:'填充裁切',exact:true}).click();
  assert.equal(await frame.getByAltText('Image 2',{exact:true}).evaluate(n=>(n as HTMLElement).style.objectFit),'cover');
  await page.getByRole('button',{name:'撤销',exact:true}).click();assert.equal(await frame.getByAltText('Image 2',{exact:true}).evaluate(n=>(n as HTMLElement).style.objectFit),'');
  await page.getByRole('button',{name:'重做',exact:true}).click();
  await t.test('Retired history preview UI', {skip:'F01 confirmed history UI removal'},async()=>{
  await page.getByText('更多',{exact:true}).click();await page.getByRole('menuitem',{name:'版本历史',exact:true}).click();
  await page.getByRole('button',{name:'保存命名版本',exact:true}).click();await page.getByLabel('版本名称',{exact:true}).fill('Media checkpoint');await page.getByRole('button',{name:'保存名称',exact:true}).click();
  await page.locator('#ppte-versions section').filter({hasText:'Media checkpoint'}).getByRole('button',{name:'预览',exact:true}).click();await page.getByTitle('版本预览（只读）').waitFor();
  await page.getByRole('button',{name:'关闭版本历史',exact:true}).click();await page.getByTitle('版本预览（只读）').waitFor({state:'detached'});assert.equal(await page.getByTitle('版本预览（只读）').count(),0);
  });
  const event=page.waitForEvent('download');await downloadUpdated(page);await(await event).saveAs(downloaded);
  const wire=readEnhanced(await readFile(downloaded,'utf8'));assert.equal((wire.content.match(/<img /g)||[]).length,12);assert.doesNotMatch(wire.content,/data-ppte-editor-media-/);assert.equal((wire.content.match(/src="data:image/g)||[]).length,12);
 }finally{await browser.close();}
 browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const context=await browser.newContext({offline:true});context.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});const p=await context.newPage();p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(String(e)));
  await p.goto(pathToFileURL(downloaded).href);await p.getByRole('button',{name:'放映',exact:true}).waitFor();const f=p.frameLocator('#ppte-frame');
  assert.equal(await f.locator('img[src]').count(),1);await p.getByRole('button',{name:'放映',exact:true}).click();
  await f.locator('video').evaluate(n=>(n as HTMLVideoElement).play());
  await p.keyboard.press('ArrowRight');assert.equal(await f.locator('video').evaluate(n=>(n as HTMLVideoElement).paused),true);assert.equal(await f.locator('video source').getAttribute('src'),null);
  await f.getByAltText('Image 2',{exact:true}).evaluate(n=>(n as HTMLImageElement).decode());assert.equal(await f.locator('img[src]').count(),1);
  await p.keyboard.press('Escape');await t.test('Retired system-print action', {skip:'F01 PDF pending F04A/F04'},async()=>{
await p.getByText('更多',{exact:true}).click();
  // Native print dialog is out of scope: keep prepared DOM for PDF API inspection.
  await p.evaluate(()=>{window.print=()=>{};});await p.getByRole('menuitem',{name:'导出 PDF',exact:true}).click();
  await p.waitForFunction(()=>Array.from(document.querySelectorAll('#ppte-print>div')).every(n=>Array.from(n.shadowRoot!.querySelectorAll('img[src]')).every(i=>(i as HTMLImageElement).complete)));
  assert.equal(await p.locator('#ppte-print img[src]').count(),13);await p.pdf({path:join(out,'media.pdf'),preferCSSPageSize:true,printBackground:true});
  await p.evaluate(()=>window.dispatchEvent(new Event('afterprint')));assert.equal(await p.locator('#ppte-print').count(),0);assert.equal(await f.locator('img[src]').count(),1);
  });
  assert.deepEqual(network,[]);assert.deepEqual(errors,[]);
  await writeFile(join(out,'media-lifecycle.json'),JSON.stringify({time:new Date().toISOString(),browser:browser.version(),offline:true,freshProcess:true,sourceImages:12,activeImages:1,inactiveURLs:0,releasedNaturalWidth:0,printImages:null,previewRemovedOnClose:null,printRemovedOnAfterprint:null,network,errors,nativePrint:null,nativePrintReason:'F01: obsolete history preview and system-print subtests retired; PDF pending F04A/F04',decodedMemoryBytes:null,decodedMemoryReason:'URL and naturalWidth release measured; browser GPU/decoder cache reclamation is not observable'},null,2));
 }finally{await browser.close();}
});

test('GAPS S04: real mouse/keyboard measurements report the unchanged 50/100ms gates, including unmet targets',async()=>{
 const {measureGapsPerformance}=await import(pathToFileURL(resolve('scripts/r8-gaps-performance.mjs')).href);
 const result=await measureGapsPerformance(join(out,'performance-suite'));
 assert.equal(result.pages,12);assert.match(result.inputText,/x{30}$/);
 for(const name of ['input','turn','inputHandler','turnHandler','blankIdle','editorIdle']) {
  const samples=result.samples[name];assert.equal(samples.length,30);assert.ok(samples.every((n:number)=>Number.isFinite(n)&&n>=0));
  const p95=[...samples].sort((a:number,b:number)=>a-b)[28];assert.equal(result.p95[name],p95);
 }
 assert.equal(result.targets.inputLimitMs,50);assert.equal(result.targets.turnLimitMs,100);
 assert.equal(result.targets.inputPassed,result.p95.input<=50);assert.equal(result.targets.turnPassed,result.p95.turn<=100);
 // Passing this measurement-integrity test is not passing the performance gates.
});
