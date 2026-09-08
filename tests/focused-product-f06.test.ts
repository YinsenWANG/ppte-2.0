import { legacyImageInsertion } from './helpers/legacy-image.js';
import { legacyImageCrop, legacyImageProperty } from './helpers/legacy-image.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium, type Page} from 'playwright';
import {enhanceHTML, readEnhanced} from '../packages/html-document/src/index.js';
import {downloadUpdated} from './helpers/focused-product.js';
const out=resolve('artifacts/focused-product/F06');
const evidence='docs/focused-product/evidence/F06';
const button=(p:Page,name:string)=>p.getByRole('button',{name,exact:true});
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');

test('F06 A1/A4: same offline Cherry draft edits text and image, downloads once, reopens in fresh process and presents all pages; PDF stays unqualified',async()=>{
 await mkdir(out,{recursive:true});
 const source=await readFile('docs/audits/2026-09-07-main-d1db13d/sample/source.html','utf8');
 const input=(await enhanceHTML(source,{root:out,base:out,mediaTable:true})).html;
 const file=join(out,'input.ppte.html'),saved=join(out,'Cherry-F06.ppte.html');await writeFile(file,input);
 const errors:string[]=[],network:string[]=[],downloads:string[]=[];
 let browser=await chromium.launch({channel:'chrome',headless:true});
 async function open(file:string){
  const p=await browser.newPage({offline:true,acceptDownloads:true,viewport:{width:1440,height:1000}});
  p.setDefaultTimeout(15000);p.on('filechooser',()=>{});
  p.on('pageerror',e=>errors.push(String(e)));p.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});p.on('download',d=>downloads.push(d.suggestedFilename()));
  await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeSave);return p;
 }
 try{
  let p=await open(file);assert.equal(await p.locator('#ppte-save-ui').getAttribute('data-mode'),'read');
  await button(p,'编辑').click();const h=p.frameLocator('#ppte-frame').locator('h1').first();
  await h.dblclick();await p.keyboard.press('End');await p.keyboard.press('Enter');await p.keyboard.insertText('离线验收');
  await button(p,'页面设置').click();await h.click();assert.equal(await h.getAttribute('contenteditable'),'true');
  await p.getByLabel('字号',{exact:true}).fill('40px');await p.getByLabel('字号',{exact:true}).press('Tab');
  assert.match(await h.innerText(),/离线验收/);assert.equal(await h.locator('div').count(),0);
  // Generate a local PNG test input; this is an engineering image, not AI image understanding evidence.
  const bytes=Buffer.from(await p.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=300;const x=c.getContext('2d')!;x.fillStyle='#176b48';x.fillRect(0,0,600,300);x.fillStyle='#faf9f4';x.font='40px sans-serif';x.fillText('F06 offline image',40,150);return c.toDataURL('image/png').split(',')[1];}),'base64');
  const chooser=p.waitForEvent('filechooser');await legacyImageInsertion(p);await button(p,'插入图片').click();await(await chooser).setFiles({name:'f06.png',mimeType:'image/png',buffer:bytes});
  const img=p.frameLocator('#ppte-frame').locator('img[data-ppte-editor-selected]');await img.waitFor();await img.evaluate(async n=>{await(n as HTMLImageElement).decode();});
  const id=await img.getAttribute('data-ppte-id');assert.ok(id);await img.click();
  const before=await img.getAttribute('style');await legacyImageCrop(p,'填充裁切');
  await legacyImageProperty(p,'水平焦点（0–100%）','80');
  const cropped=await img.getAttribute('style');assert.notEqual(cropped,before);
  await button(p,'撤销').click();assert.notEqual(await img.getAttribute('style'),cropped);await button(p,'重做').click();assert.equal(await img.getAttribute('style'),cropped);
  const expected=await p.evaluate(()=>(window as any).PPTeHTML.content());
  // Compare author markup; runtime assigns identities/focus markers to new BR nodes on reopen.
  const title=await h.evaluate(n=>{const c=n.cloneNode(true) as HTMLElement;c.querySelectorAll('br').forEach(b=>{b.removeAttribute('data-ppte-id');b.removeAttribute('data-ppte-editor-focus');});return c.innerHTML;});
  await p.screenshot({caret:'initial',path:join(out,'edited.png')});assert.equal(await p.evaluate(()=>(window as any).PPTeHTML.content()),expected);
  assert.deepEqual(downloads,[]);const event=p.waitForEvent('download');await downloadUpdated(p);const download=await event;await download.saveAs(saved);assert.equal(await download.failure(),null);assert.equal(downloads.length,1);
  const html=await readFile(saved,'utf8');assert.equal(readEnhanced(html).content,expected);assert.equal(await readFile(file,'utf8'),input,'explicit download must leave original untouched');
  assert.equal(html.split(bytes.toString('base64')).length-1,1);assert.doesNotMatch(expected,/contenteditable|data-ppte-editor-/);
  await browser.close();browser=await chromium.launch({channel:'chrome',headless:true});p=await open(saved);
  assert.equal(await p.locator('#ppte-save-ui').getAttribute('data-mode'),'read');assert.equal(await p.evaluate(()=>(window as any).PPTeHTML.content()),expected);
  assert.equal(await p.evaluate(()=>!!(window as any).PPTeSave.adapter),false);
  const reopened=p.frameLocator('#ppte-frame').locator(`[data-ppte-id="${id}"]`);await reopened.evaluate(async n=>{await(n as HTMLImageElement).decode();});
  assert.equal(await reopened.getAttribute('style'),cropped);assert.equal(await reopened.evaluate(n=>(n as HTMLImageElement).naturalWidth),600);
  await button(p,'编辑').click();await p.frameLocator('#ppte-frame').locator('h1').first().click();assert.equal(await p.frameLocator('#ppte-frame').locator('h1').first().evaluate(n=>{const c=n.cloneNode(true) as HTMLElement;c.querySelectorAll('br').forEach(b=>{b.removeAttribute('data-ppte-id');b.removeAttribute('data-ppte-editor-focus');});return c.innerHTML;}),title);
  assert.equal(await p.getByLabel('字号',{exact:true}).count(),1);await reopened.click();await legacyImageCrop(p,'重置裁切');await button(p,'撤销').click();assert.equal(await reopened.getAttribute('style'),cropped);
  await button(p,'阅读').click();const pdf=button(p,'导出为 PDF');assert.equal(await pdf.isDisabled(),true);assert.match(await pdf.getAttribute('title')??'',/未通过/);
  await button(p,'放映').click();const visited:string[]=[];
  for(let i=0;i<10;i++){
   assert.equal(await p.locator('#ppte-save-ui').isVisible(),false);assert.equal(await p.locator('#ppte-canvas-controls').isVisible(),false);
   const slides=p.frameLocator('#ppte-frame').locator('[data-ppte-slide]:visible');assert.equal(await slides.count(),1);
   const slideId=await slides.first().getAttribute('data-ppte-id');assert.ok(slideId);visited.push(slideId);
   if(i===0)await p.screenshot({caret:'initial',path:join(out,'presentation.png')});
   if(i<9)await p.keyboard.press('ArrowRight');
  }
  assert.equal(new Set(visited).size,10);await p.keyboard.press('Escape');assert.equal(await p.locator('#ppte-save-ui').getAttribute('data-mode'),'read');
  assert.equal(await p.evaluate(()=>(window as any).PPTeHTML.content()),expected);assert.deepEqual(errors,[]);assert.deepEqual(network,[]);assert.equal(downloads.length,1);
  await writeFile(join(out,'journey.json'),JSON.stringify({time:new Date().toISOString(),browser:browser.version(),headless:true,offline:true,protocol:'file:',inputSHA256:hash(input),deliverySHA256:hash(html),deliveryBytes:Buffer.byteLength(html),textEnter:true,imageCropUndoRedo:true,downloadCount:downloads.length,freshProcess:true,pagesPresented:visited,network,errors,nativePicker:false,nativeOriginalSave:false,pdf:'pending: F04A conclusion 3, disabled product entry',human:'pending'},null,2));
 }finally{await browser.close();}
});

test('F06 A2/A3: native acceptance and audit gaps cannot be closed by automated evidence',async()=>{
 const report=JSON.parse(await readFile(`${evidence}/acceptance.json`,'utf8'));
 assert.equal(report.acceptance.length,4);
 for(const row of report.acceptance){assert.ok(row.tests.length>0);for(const layer of ['code','automated','real-browser','human']){assert.ok(row.layers[layer]);if(row.layers[layer].status==='pending')assert.ok(row.layers[layer].reason.length>20);}}
 assert.equal(report.acceptance[1].layers['real-browser'].status,'pending');
 for(const id of ['PDF','B1','B2','NATIVE-SAVE','PERFORMANCE','MEDIA','HUMAN-UI','GENERATION','COMPATIBILITY','RECOVERY'])assert.ok(report.openItems.some((x:any)=>x.id===id&&x.reason&&x.evidence.length));
 const assessment=JSON.parse(await readFile('docs/focused-product/evidence/F04A/assessment.json','utf8'));assert.equal(assessment.canStartF04,false);
 const tasks=JSON.parse(await readFile('docs/focused-product/TASKS.json','utf8')).tasks;assert.equal(tasks.find((x:any)=>x.id==='F04').status,'pending');assert.notEqual(tasks.find((x:any)=>x.id==='F06').status,'completed');
 // Reproduce, rather than silently retire, the unresolved navigation contract gap.
 const source=await readFile('docs/audits/2026-09-07-main-d1db13d/sample/source-with-links.html','utf8');
 const result=await enhanceHTML(source,{root:out,base:out});assert.ok(result.issues.some(x=>x.code==='CONTENT_URL_REMOVED'));
});

test('F06 A4: frozen delivered HTML matches recorded download hash and carries ten editable pages without external runtime dependencies',async()=>{
 const html=await readFile(`${evidence}/Cherry-F06.ppte.html`,'utf8');
 const journey=JSON.parse(await readFile(`${evidence}/journey.json`,'utf8'));
 assert.equal(hash(html),journey.deliverySHA256);assert.equal(Buffer.byteLength(html),journey.deliveryBytes);
 const content=readEnhanced(html).content;
 assert.equal((content.match(/data-ppte-slide=/g)??[]).length,10);assert.match(content,/离线验收/);
 assert.doesNotMatch(content,/contenteditable|data-ppte-editor-/);assert.ok(html.includes('id="ppte-runtime"'));
 assert.doesNotMatch(html,/<script[^>]+src\s*=|<link[^>]+href\s*=/i);
 assert.equal(journey.downloadCount,1);assert.equal(journey.freshProcess,true);assert.equal(new Set(journey.pagesPresented).size,10);
 assert.deepEqual(journey.errors,[]);assert.deepEqual(journey.network,[]);
});
