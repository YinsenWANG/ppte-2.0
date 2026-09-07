import { downloadUpdated } from './helpers/focused-product.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { enhanceHTML, readEnhanced, envelope } from '../packages/html-document/src/index.js';
import { mediaDigest, packMedia, unpackMedia } from '../packages/html-document/src/media-table.js';
import { cleanContent, CONTENT_CSP } from '../packages/html-document/src/content.js';

const evidence=resolve('artifacts/s06');
test('S06 table: SHA-256 vectors, legacy identity, dedup, stable references, missing/corrupt resources, no CSP expansion',()=>{
 for (const value of ['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(10000), '图片']) assert.equal(mediaDigest(value),createHash('sha256').update(value).digest('hex'));
 const src='data:image/png;base64,'+Buffer.alloc(8192,17).toString('base64');
 const content=cleanContent(`<section data-ppte-slide><img src="${src}"><img src="${src}"><video poster="${src}"></video></section>`).html;
 const packed=packMedia(content);assert.equal(Object.keys(packed.table.resources).length,1);assert.equal(unpackMedia(packed.content,packed.table),content);assert.equal(unpackMedia(content),content);
 assert.deepEqual(packMedia(unpackMedia(packed.content,packed.table)),packed);
 assert.equal(Object.keys(packMedia('<section><p>deleted all media</p></section>').table.resources).length,0);
 assert.throws(()=>unpackMedia(packed.content),/MISSING/);
 assert.throws(()=>unpackMedia(packed.content,{version:1,resources:{...packed.table.resources,[Object.keys(packed.table.resources)[0]]:src+'A'}}),/CORRUPT/);
 assert.throws(()=>packMedia('<img src="blob:dead">'),/UNRESOLVED/);
 assert.ok(cleanContent('<img src="blob:dead">').issues.length);
 assert.ok(cleanContent('<img src="ppte-resource:missing">').issues.length);
 assert.match(CONTENT_CSP,/script-src 'none'/);assert.match(CONTENT_CSP,/connect-src 'none'/);assert.doesNotMatch(CONTENT_CSP,/blob:|https?:/);
 const metadata={documentId:'a'.repeat(32),formatVersion:1 as const,saveRevision:0,mediaTable:1 as const};
 assert.equal(readEnhanced(envelope(content,metadata)).content,content);
 assert.equal(readEnhanced(envelope(content,{...metadata,mediaTable:undefined})).content,content);
});

test('S06 file journey: mixed ratios, insert/replace/focus/reset, guarded history, download/reopen, print and speaker',async t=>{
 await mkdir(evidence,{recursive:true});
 const root=await mkdtemp(join(tmpdir(),'s06-media-'));const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});const page=await context.newPage();
  const fixtures=await page.evaluate(()=>Array.from({length:12},(_,i)=>{
   const canvas=document.createElement('canvas');canvas.width=i%2?240:640;canvas.height=i%2?640:240;
   const x=canvas.getContext('2d')!;x.fillStyle=['#e7ddd0','#d0ded4','#d8e2f5'][i%3];x.fillRect(0,0,canvas.width,canvas.height);x.fillStyle='#20252c';x.font='24px sans-serif';x.fillText(`Fixture ${i+1}`,12,40);x.fillText(`Data: ${i*17}`,12,75);x.strokeRect(4,4,canvas.width-8,canvas.height-8);
   const mime=['image/png','image/jpeg','image/webp'][i%3];return {width:canvas.width,height:canvas.height,src:canvas.toDataURL(mime),mime};
  }));
  const inputs=join(root,'inputs');await mkdir(inputs);
  for(let i=0;i<fixtures.length;i++)await writeFile(join(inputs,`${i}.${['png','jpg','webp'][i%3]}`),Buffer.from(fixtures[i].src.split(',')[1],'base64'));
  const source=`<style>section{width:960px;height:640px;background:#fff;display:grid;grid-template-columns:repeat(3,1fr)}img{width:260px;height:220px;object-fit:contain}h1{grid-column:1/-1}</style>`+Array.from({length:2},(_,page)=>`<section data-ppte-slide data-ppte-id="s${page}"><h1 data-ppte-id="t${page}">工程图片样本 ${page+1}</h1>`+fixtures.slice(page*6,page*6+6).map((_,j)=>`<img data-ppte-id="i${page*6+j}" src="inputs/${page*6+j}.${['png','jpg','webp'][(page*6+j)%3]}">`).join('')+'</section>').join('');
  const video=await readFile('tests/fixtures/media/blue-vp9.webm');
  const withVideo=source.replace('</section>', `<video data-ppte-id="film" muted loop controls style="width:80px;height:50px" src="data:video/webm;base64,${video.toString('base64')}" poster="${fixtures[0].src}"></video></section>`);
  const result=await enhanceHTML(withVideo,{root,base:root,mediaTable:true});const file=join(root,'review.ppte.html');await writeFile(file,result.html);
  await rm(inputs,{recursive:true});await context.setOffline(true);
  const network:string[]=[];page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  await page.goto(pathToFileURL(file).href);await page.waitForFunction(()=>!!(window as any).PPTeEditor);
  let pageDecoded = 0;
  for (let slide = 0; slide < 2; slide++) {
   if (slide) await page.getByRole('button',{name:'下一页',exact:true}).click();
   pageDecoded += await page.frameLocator('#ppte-frame').locator('[data-ppte-slide]').nth(slide).locator('img').evaluateAll(async ns=>{await Promise.all(ns.map(n=>(n as HTMLImageElement).decode()));return ns.length;});
  }
  assert.equal(pageDecoded,12);
  await page.getByRole('button',{name:'上一页',exact:true}).click();
  await page.getByRole('button',{name:'编辑',exact:true}).click();
  await page.evaluate(()=>{const e=(window as any).PPTeEditor;e.select(['i0']);e.commands.crop(['i0'],'cover',100,0);});
  await page.screenshot({path:join(evidence,'crop-before.png')});
  await page.getByLabel('替换本地资源').setInputFiles({name:'portrait.jpg',mimeType:fixtures[1].mime,buffer:Buffer.from(fixtures[1].src.split(',')[1],'base64')});
  await page.waitForFunction(src=>(window as any).PPTeEditor.commands.node('i0').getAttribute('src')===src,fixtures[1].src);
  const replacement=await page.evaluate(()=>{const c=(window as any).PPTeEditor.commands,n=c.node('i0');return {fit:n.style.objectFit,position:n.style.objectPosition,alt:n.getAttribute('alt')};});
  assert.deepEqual(replacement,{fit:'contain',position:'50% 50%',alt:''});
  assert.equal(await page.getByLabel('水平焦点（0–100%）').inputValue(),'50');
  await page.screenshot({path:join(evidence,'crop-after.png')});
  await page.evaluate(()=>{const c=(window as any).PPTeEditor.commands;c.history();});
  assert.equal(await page.frameLocator('#ppte-frame').locator('[data-ppte-id=i0]').getAttribute('src'),fixtures[0].src);
  await page.evaluate(()=>{const c=(window as any).PPTeEditor.commands;c.history(true);});
  await page.getByRole('button',{name:'填充裁切',exact:true}).click();
  await page.getByLabel('水平焦点（0–100%）').fill('25');await page.getByLabel('水平焦点（0–100%）').press('Tab');
  await page.getByLabel('垂直焦点（0–100%）').fill('75');await page.getByLabel('垂直焦点（0–100%）').press('Tab');
  assert.equal(await page.frameLocator('#ppte-frame').locator('[data-ppte-id=i0]').evaluate(n=>(n as HTMLElement).style.objectPosition),'25% 75%');
  await page.getByRole('button',{name:'重置裁切',exact:true}).click();
  await page.evaluate(()=>{const e=(window as any).PPTeEditor;e.select(['film']);});
  await page.getByLabel('替换视频封面').setInputFiles({name:'poster.webp',mimeType:fixtures[2].mime,buffer:Buffer.from(fixtures[2].src.split(',')[1],'base64')});
  await page.waitForFunction(src=>(window as any).PPTeEditor.commands.node('film').getAttribute('poster')===src,fixtures[2].src);
  await page.evaluate(()=>{const c=(window as any).PPTeEditor.commands;c.history();c.history(true);c.lock(['t0'],true);});

  const imageChooser=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'插入图片',exact:true}).click();
  await (await imageChooser).setFiles({name:'new.png',mimeType:'image/png',buffer:Buffer.from(fixtures[0].src.split(',')[1],'base64')});
  await page.waitForFunction(()=>(window as any).PPTeEditor.commands.doc.querySelectorAll('img').length===13);
  const history=await page.evaluate(async()=>{
   const c=(window as any).PPTeEditor.commands, n=c.doc.querySelector('img[data-ppte-id^="image-"]'),id=n.dataset.ppteId;
   c.history();const undo=!c.doc.contains(n);c.history(true);const redo=c.node(id)===n;
   let invalid=false,broken=false;const before=c.node('i0').outerHTML;
   try{c.crop(['i0'],'cover',101,0);}catch{invalid=true;}
   try{await c.media('i0',new File(['broken'],'bad.png',{type:'image/png'}));}catch{broken=true;}
   let oversized=false;try{await c.media('i0',new File([new Uint8Array(16*1024*1024+1)],'large.png',{type:'image/png'}));}catch(error){oversized=String(error).includes('MEDIA_LIMIT');}if(!oversized)throw Error('SIZE_LIMIT_NOT_ENFORCED');
   const atomic=before===c.node('i0').outerHTML;
   for(let i=0;i<105;i++)c.crop(['i0'],i%2?'contain':'cover',i%100,50);
   const count=c.undoStack.length,trimmed=c.historyTrimmed,stats=c.mediaHistory.stats;
   c.crop(['i0'],'contain');
   return {id,undo,redo,invalid,broken,atomic,count,trimmed,stats};
  });assert.ok(history.undo&&history.redo&&history.invalid&&history.broken&&history.atomic&&history.trimmed);assert.equal(history.count,100);
  const downloadEvent=page.waitForEvent('download'); await downloadUpdated(page);
  const download=await downloadEvent; const downloaded=join(root,'download.ppte.html'); await download.saveAs(downloaded);
  const serialized=await readFile(downloaded,'utf8');assert.doesNotMatch(readEnhanced(serialized).content,/blob:|ppte-history/);
  await writeFile(join(evidence,'review.ppte.html'),serialized);
  const reopening=join(root,'reopened.ppte.html');await writeFile(reopening,serialized);await page.close();const reopened=await context.newPage();await reopened.goto(pathToFileURL(reopening).href);await reopened.waitForFunction(()=>!!(window as any).PPTeEditor);
  let reopenedDecoded = 0;
  for (let slide = 0; slide < 2; slide++) {
   if (slide) await reopened.getByRole('button',{name:'下一页',exact:true}).click();
   reopenedDecoded += await reopened.frameLocator('#ppte-frame').locator('[data-ppte-slide]').nth(slide).locator('img').evaluateAll(async ns=>{await Promise.all(ns.map(n=>(n as HTMLImageElement).decode()));return ns.length;});
  }
  assert.equal(reopenedDecoded,13);
  await reopened.getByRole('button',{name:'上一页',exact:true}).click();
  assert.equal(await reopened.frameLocator('#ppte-frame').locator('[data-ppte-id=i0]').evaluate(n=>(n as HTMLElement).style.objectFit),'contain');
  assert.equal(await reopened.frameLocator('#ppte-frame').locator('video').getAttribute('poster'),fixtures[2].src);
  const repeat=await reopened.evaluate(()=>(window as any).PPTeHTML.serialize());assert.equal(Buffer.byteLength(repeat),Buffer.byteLength(serialized));
 await t.test('Retired system-print product path — F04A/F04 pending', {skip:'F01: user forbids system printing; original assertions preserved'}, async()=>{
  const print=await reopened.evaluate(async()=>{const e=(window as any).PPTeEditor;(window as any).PPTePrint.prepare();const imgs=Array.from(document.querySelectorAll('#ppte-print>div')).flatMap(n=>Array.from(n.shadowRoot!.querySelectorAll('img')));await Promise.all(imgs.map(n=>n.decode()));return imgs.length;});assert.equal(print,14);
  await reopened.pdf({path:join(evidence,'media.pdf'),preferCSSPageSize:true});await reopened.evaluate(()=>(window as any).PPTePrint.restore());

 });
  await reopened.getByRole('button',{name:'放映',exact:true}).click();
  const popupPromise=context.waitForEvent('page');await reopened.evaluate(()=>(window as any).PPTePlayer.presenter());const popup=await popupPromise;
  await popup.waitForFunction(()=>!!document.querySelector('iframe')?.contentDocument?.querySelector('img'));
  assert.equal(await popup.locator('iframe').evaluate(async n=>{const imgs=Array.from((n as HTMLIFrameElement).contentDocument!.querySelectorAll('img'));await Promise.all(imgs.map(n=>n.decode()));return imgs.length;}),6);
  const film=reopened.frameLocator('#ppte-frame').locator('video');await film.evaluate(n=>(n as HTMLVideoElement).play());assert.equal(await film.evaluate(n=>(n as HTMLVideoElement).paused),false);
  await reopened.evaluate(()=>(window as any).PPTePlayer.next());assert.equal(await film.evaluate(n=>(n as HTMLVideoElement).paused),true);
  await reopened.evaluate(()=>(window as any).PPTePlayer.exit());
  const cleared=await reopened.evaluate(()=>{const c=(window as any).PPTeEditor.commands;c.crop(['i0'],'cover');c.clearHistory();return c.mediaHistory.stats;});assert.equal(cleared.resources,0);
  assert.deepEqual(network,[]);
  const corrupt=join(root,'corrupt.ppte.html');await writeFile(corrupt,serialized.replace(/ppte-resource:[a-f0-9]{64}/,'ppte-resource:missing'));const failed=await context.newPage();await failed.goto(pathToFileURL(corrupt).href);await failed.getByRole('alert').waitFor();assert.match(await failed.getByRole('alert').textContent() ?? '',/MEDIA_RESOURCE_MISSING/);
  await writeFile(join(evidence,'journey.json'),JSON.stringify({fixtureKind:'12 synthetic raster fixtures, not real photo or human acceptance',browser:browser.version(),offline:true,sourceDirectoryRemoved:true,decoded:13,printImages:null,PDF:"pending F04A/F04; old print subtest retired",speakerImages:6,video:{sha256:createHash('sha256').update(video).digest('hex'),offlinePlay:true,leaveSlidePaused:true},corruptFile:'visible MEDIA_RESOURCE_MISSING alert',history,repeatFileBytes:Buffer.byteLength(repeat),network,fixtures:fixtures.map((f,i)=>({index:i,width:f.width,height:f.height,mime:f.mime,bytes:Buffer.from(f.src.split(',')[1],'base64').length,sha256:createHash('sha256').update(Buffer.from(f.src.split(',')[1],'base64')).digest('hex')}))},null,2));
 }finally{await browser.close();await rm(root,{recursive:true,force:true});}
});
