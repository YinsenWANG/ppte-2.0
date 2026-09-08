import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium,type Page} from 'playwright';
import {readEnhanced} from '../packages/html-document/src/index.js';
import {downloadUpdated} from './helpers/focused-product.js';
import {enhanceHTML} from '../packages/html-document/src/index.js';
const evidence=resolve('docs/audits/2026-09-08-main-52e3bf0/evidence/DLV');
const out=resolve('artifacts/audit-delivery');
const btn=(p:Page,name:string)=>p.getByRole('button',{name,exact:true});
const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
async function open(document:string){
 await mkdir(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true});
 const p=await browser.newPage({offline:true,acceptDownloads:true,viewport:{width:1440,height:960}});p.setDefaultTimeout(10000);
 const errors:string[]=[],network:string[]=[];p.on('pageerror',e=>errors.push(String(e)));p.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
 await p.goto(pathToFileURL(document).href);await p.waitForFunction(()=>!!(window as any).PPTeEditor);
 return {browser,p,errors,network};
}
test('DLV nine-page layout: nine native pages in one offline runtime, text/image bounds and clean presentation',async()=>{
 const file=join(evidence,'delivery/Cherry-Studio-开源之路.ppte.html');
 const bytes=await readFile(file,'utf8'),source=readEnhanced(bytes).content;
 assert.equal((source.match(/data-ppte-slide=/g)??[]).length,9);
 assert.match(source,/class="cover-body"/);assert.match(source,/class="split-body"/);assert.match(source,/class="dense-body"/);
 assert.doesNotMatch(source,/生长的叶片|今天，从一个问题开始|新版体验稿|制作与实机验收|TEST|占位图/);
 assert.notEqual(sha(source),sha(await readFile('docs/audits/2026-09-07-main-d1db13d/sample/source.html')));
 const f=await open(file),p=f.p,rows:unknown[]=[];
 try{
 assert.equal(await p.locator('#ppte-save-ui').getAttribute('data-mode'),'read');
 assert.equal(await btn(p,'导出为 PDF').isDisabled(),true);
 assert.equal(await p.locator('template#ppte-content').count(),1);
 for(let i=0;i<9;i++){
  if(i)await btn(p,'下一页').click();
  const slide=p.frameLocator('#ppte-frame').locator('[data-ppte-slide]').nth(i);assert.equal(await slide.isVisible(),true);
  const geometry=await slide.evaluate(el=>{
   const r=el.getBoundingClientRect();const textBounds:unknown[]=[];const overflow:string[]=[];
   for(const n of Array.from(el.querySelectorAll('h1,h2,h3,p,td,th,dt,dd,li,span,a,figcaption,header,footer'))){
    const b=n.getBoundingClientRect(),style=getComputedStyle(n);if(b.left<r.left-1||b.right>r.right+1||b.top<r.top-1||b.bottom>r.bottom+1||(style.overflowX!=='visible'&&n.scrollWidth>n.clientWidth+1)||(style.overflowY!=='visible'&&n.scrollHeight>n.clientHeight+1))overflow.push(n.textContent??'');
    // Range bounds catch wrapped glyphs clipped inside an otherwise fitting box.
    const walker=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);let t:Node|null;
    while((t=walker.nextNode())){if(!t.textContent?.trim())continue;const range=document.createRange();range.selectNodeContents(t);for(const q of Array.from(range.getClientRects()))if(q.left<r.left-1||q.right>r.right+1||q.top<r.top-1||q.bottom>r.bottom+1)overflow.push(t.textContent);}
    textBounds.push({text:n.textContent,rect:b.toJSON(),client:[n.clientWidth,n.clientHeight],scroll:[n.scrollWidth,n.scrollHeight],overflow:style.overflow});
   }
   return {page:r.toJSON(),overflow,textBounds,background:getComputedStyle(el).backgroundColor};
  });
  assert.deepEqual(geometry.overflow,[]);assert.equal(geometry.page.width,1280);assert.equal(geometry.page.height,720);
  const beforeScreenshot=await p.evaluate(()=>(window as any).PPTeHTML.content());
  await p.screenshot({caret:'initial',path:join(out,`full-read-${i+1}.png`)});
  assert.equal(await p.evaluate(()=>(window as any).PPTeHTML.content()),beforeScreenshot);
  await btn(p,'放映').click();assert.equal(await p.locator('#ppte-save-ui').isVisible(),false);assert.equal(await p.locator('#ppte-canvas-controls').isVisible(),false);
  await p.screenshot({caret:'initial',path:join(out,`full-present-${i+1}.png`)});await p.keyboard.press('Escape');rows.push(geometry);
 }
 assert.equal(new Set(rows.map((r:any)=>r.background)).size,1);
 for(let step=0;step<5;step++)await btn(p,'上一页').click();const img=p.frameLocator('#ppte-frame').locator('.diagram-image');
 assert.equal(await img.evaluate((n:HTMLImageElement)=>n.complete&&n.naturalWidth===640&&n.naturalHeight===440),true);
 assert.equal(await img.evaluate(n=>getComputedStyle(n).objectFit),'contain');
 assert.match(await p.frameLocator('#ppte-frame').locator('figcaption').innerText(),/概念图.*非产品截图/);
 assert.deepEqual(f.errors,[]);assert.deepEqual(f.network,[]);
 await writeFile(join(out,'full-layout.json'),JSON.stringify({browser:f.browser.version(),headless:true,offline:true,fileSha256:sha(bytes),rows,errors:f.errors,network:f.network},null,2));
 }finally{await f.browser.close();}
});
test('DLV download roundtrip: actual text editing, undo/redo, explicit download and new browser process retain the full source',async()=>{
 const file=join(evidence,'delivery/Cherry-Studio-开源之路.ppte.html');
 const original=await readFile(file);const f=await open(file),p=f.p;let saved='';
 try{
 await btn(p,'编辑').click();const title=p.frameLocator('#ppte-frame').locator('[data-ppte-id="u01-cover-title"]');
 await title.click();await title.dblclick();await p.keyboard.press('Meta+A');await p.keyboard.insertText('U01 editable roundtrip');await btn(p,'关闭属性').click();
 assert.match(await title.innerText(),/U01 editable roundtrip/);
 await btn(p,'撤销').click();assert.match(await title.innerText(),/开源之路/);
 await btn(p,'重做').click();assert.match(await title.innerText(),/U01 editable roundtrip/);
 const event=p.waitForEvent('download');await downloadUpdated(p);const d=await event;saved=join(out,'full-edited-download.ppte.html');await d.saveAs(saved);
 assert.equal(readEnhanced(await readFile(saved,'utf8')).content,await p.evaluate(()=>(window as any).PPTeHTML.content()));
 assert.equal((readEnhanced(await readFile(saved,'utf8')).content.match(/data-ppte-slide=/g)??[]).length,9);
 await p.screenshot({caret:'initial',path:join(out,'full-edit.png')});assert.deepEqual(f.errors,[]);assert.deepEqual(f.network,[]);
 }finally{await f.browser.close();}
 const b=await chromium.launch({channel:'chrome',headless:true});try{const q=await b.newPage({offline:true});await q.goto(pathToFileURL(saved).href);await q.waitForFunction(()=>!!(window as any).PPTeEditor);assert.equal(await q.locator('#ppte-save-ui').getAttribute('data-mode'),'read');assert.match(await q.frameLocator('#ppte-frame').locator('h1').innerText(),/U01 editable roundtrip/);for(let step=0;step<3;step++)await btn(q,'下一页').click();assert.equal(await q.frameLocator('#ppte-frame').locator('img').evaluate((n:HTMLImageElement)=>n.complete&&n.naturalWidth===640),true);}finally{await b.close();}
 assert.deepEqual(await readFile(file),original,'review delivery must stay clean');
 await writeFile(join(out,'full-roundtrip.json'),JSON.stringify({headless:true,downloadFallback:'capability override; not native save evidence',newBrowserProcess:true,originalSha256:sha(original),downloadSha256:sha(await readFile(saved))},null,2));
});

test('DLV installed delivery equals current runtime and original nine-page content; package receipts match source',async()=>{
 const delivery=await readFile(join(evidence,'delivery/Cherry-Studio-开源之路.ppte.html'),'utf8');
 const base=resolve('docs/usability-reset/evidence/U01/source');
 const source=await readFile(join(base,'full-deck.html'),'utf8');
 const current=(await enhanceHTML(source,{root:base,base})).html;
 assert.equal(readEnhanced(delivery).content,readEnhanced(current).content,'entire author content including images must match');
 const runtime=(s:string)=>s.match(/<script id="ppte-runtime">([\s\S]*?)<\/script>/)![1];
 assert.equal(runtime(delivery),runtime(current),'installed CLI must embed the current compiled runtime');
 const {readdir}=await import('node:fs/promises');
 assert.deepEqual(await readdir(join(evidence,'delivery')),['Cherry-Studio-开源之路.ppte.html']);
 const receipt=JSON.parse(await readFile(join(evidence,'verification/installation.json'),'utf8'));
 for(const [key,path] of Object.entries({source:join(base,'full-deck.html'),skill:'skills/ppte/SKILL.md',readme:'README-AGENT.md'}))assert.equal(receipt.sha256[key],sha(await readFile(path)));
 assert.equal(receipt.sha256.delivery,sha(delivery));assert.equal(receipt.enhancement.calls,1);
 assert.ok(receipt.commands.length>=5);for(const command of receipt.commands)assert.equal(command.status,0);
});
