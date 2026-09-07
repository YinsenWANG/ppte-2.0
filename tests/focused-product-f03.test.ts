import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { chromium, type Page, type Locator } from 'playwright';
import { enhanceHTML, readEnhanced } from '../packages/html-document/src/index.js';
import { downloadUpdated } from './helpers/focused-product.js';
const out = resolve('artifacts/focused-product/F03');
const frame = (p: Page) => p.frameLocator('#ppte-frame');
const button = (p: Page, name: string) => p.getByRole('button', {name, exact:true});
// Deterministic actual PNG inputs, including alpha and 7.68 million pixels.
function png(width: number, height: number, alpha = false) {
 const chunk = (name: string, bytes: Buffer) => {
  const data = Buffer.concat([Buffer.from(name),bytes]); let crc = 0xffffffff;
  for (const v of data) { crc ^= v; for (let i=0;i<8;i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
  const n=Buffer.alloc(4),c=Buffer.alloc(4);n.writeUInt32BE(bytes.length);c.writeUInt32BE((crc ^ 0xffffffff) >>> 0);return Buffer.concat([n,data,c]);
 };
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 const raw=Buffer.alloc((width*4+1)*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*(width*4+1)+1+x*4;raw[i]=Math.floor(x/width*255);raw[i+1]=Math.floor(y/height*255);raw[i+2]=96;raw[i+3]=alpha?(x<width/4?0:128):255;}
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const samples = [
 {name:'landscape',width:1200,height:600,alpha:false},
 {name:'portrait',width:600,height:1200,alpha:false},
 {name:'transparent-large',width:3200,height:2400,alpha:true}
].map(s=>({...s,buffer:png(s.width,s.height,s.alpha),mimeType:'image/png'}));
async function open(name:string,source:string){
 await mkdir(out,{recursive:true});const file=join(out,name+'.ppte.html');await writeFile(file,(await enhanceHTML(source,{root:out,base:out,mediaTable:true})).html);
 const browser=await chromium.launch({channel:'chrome',headless:true});const p=await browser.newPage({offline:true,acceptDownloads:true,viewport:{width:1440,height:1000}});
 p.setDefaultTimeout(15000);p.on('filechooser',()=>{});
 const errors:string[]=[],network:string[]=[];p.on('pageerror',e=>errors.push(String(e)));p.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
 await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeSave);await button(p,'编辑').click();
 return {p,browser,file,errors,network};
}
async function insert(p:Page,s:typeof samples[number]){
 const selected=frame(p).locator('img[data-ppte-editor-selected]'), old=await selected.count()?await selected.getAttribute('data-ppte-id'):null;
 const chooser=p.waitForEvent('filechooser');await button(p,'插入图片').click();await(await chooser).setFiles({name:s.name+'.png',mimeType:s.mimeType,buffer:s.buffer});
 try { await p.waitForFunction(old=>{const n=document.querySelector<HTMLIFrameElement>('#ppte-frame')!.contentDocument!.querySelector('img[data-ppte-editor-selected]');return n && n.getAttribute('data-ppte-id')!==old;},old); } catch(e) { await writeFile(join(out,'insertion-failure.json'),JSON.stringify(await p.evaluate(()=>({feedback:document.querySelector('#ppte-feedback')?.textContent,toolbar:document.querySelector('#ppte-edit-toolbar')?.outerHTML,content:(window as any).PPTeHTML.content()})),null,2));throw e; }
 const n=frame(p).locator('img[data-ppte-editor-selected]');await n.waitFor();await n.evaluate(async n=>{await (n as HTMLImageElement).decode();});return n;
}
async function property(p:Page,label:string,value:string){
 const input=p.getByLabel(label,{exact:true});if(!await input.isVisible())await p.locator('#ppte-properties summary').filter({hasText:'位置与布局'}).click();await input.fill(value);await input.press('Tab');
}
async function geometry(n:Locator){return n.evaluate(n=>{const r=n.getBoundingClientRect(),s=n.closest('[data-ppte-slide]')!.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,inside:r.left>=s.left-.5&&r.top>=s.top-.5&&r.right<=s.right+.5&&r.bottom<=s.bottom+.5};});}
async function state(n:Locator){return n.evaluate(n=>({src:n.getAttribute('src'),style:n.getAttribute('style'),alt:n.getAttribute('alt')}));}
async function undoRedo(p:Page,n:Locator,before:Awaited<ReturnType<typeof state>>,after:Awaited<ReturnType<typeof state>>){
 await button(p,'撤销').click();assert.deepEqual(await state(n),before);await button(p,'重做').click();assert.deepEqual(await state(n),after);
}
const source=(layout:string)=>`<title>F03 ${layout}</title><style>body{margin:0}section{position:relative;width:960px;min-height:720px;box-sizing:border-box;padding:36px;background:#f8f7f2}.content{width:880px;${layout==='absolute'?'position:relative;height:640px':`display:${layout};${layout==='flex'?'flex-direction:column;':layout==='grid'?'grid-template-columns:1fr;':''}gap:16px`}}p{font:24px system-ui;margin:8px 0;${layout==='absolute'?'position:absolute;left:0;top:0;width:800px;height:50px':''}}</style><section data-ppte-slide><div class="content" data-ppte-content><p id="first">作者正文 · 图片不能遮挡文字</p>${layout==='absolute'?'':'<p id="last">保留原有内容顺序与容器</p>'}</div></section>`;
for(const layout of ['absolute','block','flex','grid'])test(`F03 A1/A2/A3 ${layout}: image UI placement, pointer/order, resize/crop/replace, undo/redo and fresh-process saved reopen`,async()=>{
 const f=await open(layout,source(layout)),p=f.p;const rows:unknown[]=[];
 try{
  for(const sample of samples){
   await frame(p).locator('#first').click();const inserted=await insert(p,sample),id=await inserted.getAttribute('data-ppte-id');assert.ok(id);
   const n=frame(p).locator(`[data-ppte-id="${id}"]`);await n.click();assert.equal(await n.getAttribute('data-ppte-editor-selected')!==null,true);
   const initial=await geometry(n);assert.equal(initial.inside,true);assert.ok(Math.abs(initial.width/initial.height-sample.width/sample.height)<.01,'initial frame preserves intrinsic ratio');
   assert.equal(await n.evaluate(n=>{const r=n.getBoundingClientRect();return Array.from(n.ownerDocument.querySelectorAll('p')).every(e=>{const b=e.getBoundingClientRect();return r.left>=b.right||r.right<=b.left||r.top>=b.bottom||r.bottom<=b.top;});}),true);
   const original='data:image/png;base64,'+sample.buffer.toString('base64');assert.equal((await state(n)).src,original);
   const before=await state(n);
   if(layout==='absolute'){
    const b=(await n.boundingBox())!;await p.mouse.move(b.x+b.width/2,b.y+b.height/2);await p.mouse.down();await p.mouse.move(b.x+b.width/2+20,b.y+b.height/2+12,{steps:5});await p.mouse.up();
    assert.ok((await geometry(n)).x>initial.x+10,'actual pointer drag moves image');
   }else{
    await p.keyboard.press('Alt+ArrowDown');assert.ok((await geometry(n)).y>initial.y,'actual key changes rendered order');
   }
   const moved=await state(n);if(layout!=='block')await undoRedo(p,n,before,moved);else{
    // Block order is a DOM relocation, not a style mutation.
    assert.equal(await n.evaluate(n=>n.previousElementSibling?.id),'last');await button(p,'撤销').click();assert.equal(await n.evaluate(n=>n.previousElementSibling?.id),'first');await button(p,'重做').click();assert.equal(await n.evaluate(n=>n.previousElementSibling?.id),'last');
   }
   await property(p,'宽度','220px');await property(p,'高度','140px');const uncropped=await state(n);
   await button(p,'填充裁切').click();await property(p,'水平焦点（0–100%）','25');await property(p,'垂直焦点（0–100%）','75');
   const cropped=await state(n);assert.equal(cropped.src,original);assert.equal(await n.evaluate(n=>getComputedStyle(n).objectFit),'cover');assert.equal(await n.evaluate(n=>getComputedStyle(n).objectPosition),'25% 75%');
   await button(p,'重置裁切').click();const reset=await state(n);assert.deepEqual(reset,uncropped);await undoRedo(p,n,cropped,reset);await button(p,'撤销').click();
   const replacement=samples[(samples.indexOf(sample)+1)%samples.length];const input=p.getByLabel('替换本地资源',{exact:true});assert.match(await input.getAttribute('accept')??'',/image\/avif/);assert.doesNotMatch(await input.getAttribute('accept')??'',/video/);
   const chooser=p.waitForEvent('filechooser');await input.click();await(await chooser).setFiles({name:replacement.name+'.png',mimeType:'image/png',buffer:replacement.buffer});
   await p.waitForFunction(({id,src})=>(document.querySelector<HTMLIFrameElement>('#ppte-frame')!.contentDocument!.querySelector(`[data-ppte-id="${id}"]`) as HTMLImageElement).src===src,{id,src:'data:image/png;base64,'+replacement.buffer.toString('base64')});
   await n.evaluate(async n=>{await (n as HTMLImageElement).decode();});
   const replaced=await state(n);assert.equal(await n.evaluate(n=>getComputedStyle(n).objectFit),'contain');assert.equal(await n.evaluate(n=>getComputedStyle(n).objectPosition),'50% 50%');await undoRedo(p,n,cropped,replaced);
   await button(p,'撤销').click(); // deliver the original pixels with custom non-destructive crop
   rows.push({sample:sample.name,pixels:[sample.width,sample.height],bytes:sample.buffer.length,initial,moved:await geometry(n),id,state:await state(n)});
   await p.screenshot({caret:'initial',path:join(out,`${layout}-${sample.name}.png`)});
   // Remove via product UI to give the next fixture the same author space.
   if(sample!==samples.at(-1))await button(p,'删除对象').click();
  }
  const last=rows.at(-1) as {id:string;state:Awaited<ReturnType<typeof state>>};const event=p.waitForEvent('download');await downloadUpdated(p);const saved=join(out,layout+'-saved.ppte.html');await(await event).saveAs(saved);
  const html=await readFile(saved,'utf8'),content=readEnhanced(html).content;assert.doesNotMatch(content,/contenteditable|data-ppte-editor-|ppte-history-/);assert.match(content,/作者正文 · 图片不能遮挡文字/);
  assert.equal(html.split(samples[2].buffer.toString('base64')).length-1,1,'saved original bytes occur once');
  await f.browser.close();const fresh=await chromium.launch({channel:'chrome',headless:true});try{
   const q=await fresh.newPage({offline:true,viewport:{width:1440,height:1000}});await q.goto(pathToFileURL(saved).href);await q.waitForFunction(()=>!!(window as any).PPTeSave);assert.equal(await q.locator('#ppte-save-ui').getAttribute('data-mode'),'read');
   const n=frame(q).locator(`[data-ppte-id="${last.id}"]`);await n.evaluate(async n=>{await(n as HTMLImageElement).decode();});assert.deepEqual(await state(n),last.state);
   assert.equal(await n.evaluate(n=>(n as HTMLImageElement).naturalWidth),3200);await button(q,'编辑').click();await n.click();assert.equal(await n.getAttribute('data-ppte-editor-selected')!==null,true);assert.equal(await n.evaluate(n=>getComputedStyle(n.parentElement!).display),layout==='absolute'?'block':layout);
   await button(q,'重置裁切').click();assert.equal(await n.evaluate(n=>getComputedStyle(n).objectFit),'contain');await button(q,'撤销').click();assert.deepEqual(await state(n),last.state);await q.screenshot({caret:'initial',path:join(out,layout+'-reopened.png')});
  }finally{await fresh.close();}
  assert.deepEqual(f.errors,[]);assert.deepEqual(f.network,[]);await writeFile(join(out,layout+'.json'),JSON.stringify({browser:f.browser.version(),rows,savedBytes:(await stat(saved)).size,download:true,freshProcess:true,errors:f.errors,network:f.network},null,2));
 }finally{await f.browser.close();}
});
test('F03 failures/cancel: cancelled chooser, invalid bytes/type/oversize preserve original and undo stack; same replacement can be retried',async()=>{
 const f=await open('errors',source('absolute')),p=f.p;try{
  const chooser=p.waitForEvent('filechooser');await button(p,'插入图片').click();await(await chooser).setFiles([]);assert.equal(await frame(p).locator('img').count(),0);assert.equal(await button(p,'撤销').isDisabled(),true);
  const n=await insert(p,samples[0]);await n.click();const original=await state(n);
  for(const file of [{name:'broken.png',mimeType:'image/png',buffer:Buffer.from('broken')},{name:'bad.txt',mimeType:'text/plain',buffer:Buffer.from('bad')},{name:'large.png',mimeType:'image/png',buffer:Buffer.alloc(16*1024*1024+1)}]){
   await p.getByLabel('替换本地资源',{exact:true}).setInputFiles(file);await p.locator('#ppte-feedback').filter({hasText:file.name==='broken.png'?'无法读取这张图片':file.name==='bad.txt'?'MEDIA_KIND_MISMATCH':'MEDIA_LIMIT'}).waitFor();assert.equal(await button(p,'插入图片').isDisabled(),false);assert.deepEqual(await state(n),original);assert.equal(await p.getByLabel('替换本地资源',{exact:true}).inputValue(),'');
  }
  // Failed operations create no undo entry: the next undo removes the insertion.
  await button(p,'撤销').click();assert.equal(await frame(p).locator('img').count(),0);await button(p,'重做').click();assert.deepEqual(await state(frame(p).locator('img')),original);
  await writeFile(join(out,'errors.json'),JSON.stringify({cancel:'chooser empty files (automation, not native OS Cancel)',invalidDecode:true,invalidType:true,over16MiB:true,unchanged:true,noUndoPollution:true},null,2));
 }finally{await f.browser.close();assert.deepEqual(f.errors,[]);assert.deepEqual(f.network,[]);}
});
test('F03 bounded async image import: progress, cancel and leaving edit discard delayed decode without dirty/history changes',async()=>{
 const f=await open('cancel-decode',source('absolute')),p=f.p;try{
  // Explicit timing injection uses the outer timer: author frames disallow scripts,
  // including timer callbacks. The user path below still uses chooser + buttons.
  await p.evaluate(()=>{const win=document.querySelector<HTMLIFrameElement>('#ppte-frame')!.contentDocument!.defaultView!;const decode=win.HTMLImageElement.prototype.decode;win.HTMLImageElement.prototype.decode=async function(){await new Promise(r=>setTimeout(r,2000));return decode.call(this);};});
  for(const action of ['取消读取图片','阅读']){
   const chooser=p.waitForEvent('filechooser');await button(p,'插入图片').click();await(await chooser).setFiles({name:'delayed.png',mimeType:'image/png',buffer:samples[0].buffer});
   await button(p,'取消读取图片').waitFor();assert.equal(await button(p,'插入图片').isDisabled(),true);await button(p,action).click();await button(p,'取消读取图片').waitFor({state:'hidden'});
   if(action==='阅读')await button(p,'编辑').click();assert.equal(await frame(p).locator('img').count(),0);assert.equal(await button(p,'撤销').isDisabled(),true);assert.equal(await p.evaluate(()=>(window as any).PPTeSave.dirty),false);
  }
  const n=await insert(p,samples[0]);await n.click();const before=await state(n);
  const chooser=p.waitForEvent('filechooser');await p.getByLabel('替换本地资源',{exact:true}).click();await(await chooser).setFiles({name:'replacement.png',mimeType:'image/png',buffer:samples[1].buffer});await button(p,'取消读取图片').waitFor();await button(p,'取消读取图片').click();await button(p,'取消读取图片').waitFor({state:'hidden'});assert.deepEqual(await state(n),before);
  await button(p,'撤销').click();assert.equal(await frame(p).locator('img').count(),0);
  await writeFile(join(out,'cancel-decode.json'),JSON.stringify({injection:'2s delayed native image.decode',cancelButton:true,leaveEdit:true,replacementCancel:true,noMutation:true,notNativeChooserEvidence:true},null,2));
 }finally{await f.browser.close();assert.deepEqual(f.errors,[]);assert.deepEqual(f.network,[]);}
});
for(const name of ['prototype','cherry'])test(`F03 A1/A2 ${name}: actual author draft, consecutive images, pointer resize, resource reuse and author content preserved`,async()=>{
 const input=await readFile(name==='prototype'?'docs/audits/2026-09-07-ui-d96f211/sample/source.html':'docs/audits/2026-09-07-main-d1db13d/sample/source.html','utf8');const f=await open(name,input),p=f.p;try{
  const authorBefore=await p.evaluate(()=>(window as any).PPTeHTML.content());
  await frame(p).locator(name==='prototype'?'[data-id=title1]':'h1').first().click();const first=await insert(p,samples[0]),firstId=await first.getAttribute('data-ppte-id');assert.ok(firstId);await first.click();
  const second=await insert(p,samples[0]),secondId=await second.getAttribute('data-ppte-id');assert.notEqual(firstId,secondId);assert.equal((await geometry(second)).inside,true);await second.click();
  const old=await geometry(second),oldState=await state(second),handle=button(p,'调整对象大小'),b=(await handle.boundingBox())!;
  await p.mouse.move(b.x+b.width/2,b.y+b.height/2);await p.mouse.down();await p.mouse.move(b.x+b.width/2-12,b.y+b.height/2-8,{steps:4});await p.mouse.up();assert.ok((await geometry(second)).width<old.width);const resized=await state(second);await undoRedo(p,second,oldState,resized);
  await button(p,'填充裁切').click();await property(p,'水平焦点（0–100%）','80');await p.screenshot({caret:'initial',path:join(out,name+'-images.png')});
  const event=p.waitForEvent('download');await downloadUpdated(p);const saved=join(out,name==='cherry'?'Cherry-F03.ppte.html':'prototype-images.ppte.html');await(await event).saveAs(saved);
  const html=await readFile(saved,'utf8');assert.equal(html.split(samples[0].buffer.toString('base64')).length-1,1,'two images share one saved original');
  const canonical=await p.evaluate(({before,after,ids})=>[before,after].map(value=>{const d=new DOMParser().parseFromString(value,'text/html');for(const id of ids)d.querySelector(`[data-ppte-id="${id}"]`)?.remove();for(const n of Array.from(d.querySelectorAll<HTMLElement>('[style]')))n.setAttribute('style',n.style.cssText);return d.documentElement.outerHTML;}),{before:authorBefore,after:readEnhanced(html).content,ids:[firstId,secondId]});assert.equal(canonical[1],canonical[0],'entire original author content and layout retained');
  const savedCount=await frame(p).locator('[data-ppte-slide]').count();await writeFile(join(out,name+'-images.json'),JSON.stringify({browser:f.browser.version(),savedCount,continuousInsertion:true,actualPointerResize:true,authorPreserved:true,embeddedCopies:1,originalBytes:samples[0].buffer.length},null,2));
 }finally{await f.browser.close();assert.deepEqual(f.errors,[]);assert.deepEqual(f.network,[]);}
});
