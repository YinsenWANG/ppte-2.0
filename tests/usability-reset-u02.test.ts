import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { chromium, type Page } from 'playwright';
import { enhanceHTML, readEnhanced } from '../packages/html-document/src/index.js';
import { downloadUpdated } from './helpers/focused-product.js';
const out=resolve('artifacts/usability-reset-u02');
const button=(p:Page,name:string)=>p.getByRole('button',{name,exact:true});
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

const src='data:image/png;base64,'+png(300,600).toString('base64');
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const content=(p:Page)=>p.evaluate(()=>(window as any).PPTeHTML.content() as string);
const depth=(p:Page)=>p.evaluate(()=>(window as any).PPTeEditor.commands.undoStack.length as number);
const model=(p:Page)=>p.frameLocator('#ppte-frame').locator('[data-ppte-image-frame]').evaluate(n=>JSON.parse((n as HTMLElement).dataset.ppteImageFrame!) as {x:number;y:number;w:number;h:number;iw:number;ih:number;ox:number;oy:number});
async function drag(p:Page,x:number,y:number,dx:number,dy:number){await p.mouse.move(x,y);await p.mouse.down();await p.mouse.move(x+dx,y+dy,{steps:8});await p.mouse.up();}
for(const layout of ['absolute','block','grid','flex'])test(`U02 ${layout}: real pointers, all corners, crop/cancel, transaction undo, siblings and saved restart`,async()=>{
 await mkdir(out,{recursive:true});const file=join(out,layout+'.ppte.html');
 const source=`<title>U02 ${layout}</title><style>body{margin:0}section{position:relative;width:960px;height:700px;padding:40px;border:3px solid #e7e9ee;box-sizing:border-box;background:#f8f7f2}.content{display:${layout==='absolute'?'block':layout};${layout==='grid'?'grid-template-columns:300px 1fr;':layout==='flex'?'align-items:start;gap:40px;':''}}img{width:300px;height:160px;object-fit:cover;${layout==='absolute'?'position:absolute;left:40px;top:120px;':''}}p{font:24px system-ui;${layout==='absolute'?'position:absolute;left:400px;top:100px;':''}}</style><section data-ppte-slide><h1>图片直接操作</h1><div class="content"><img id="subject" src="${src}"><p id="sibling">作者正文保持原位</p></div></section>`;
 await writeFile(file,(await enhanceHTML(source,{root:out,base:out,mediaTable:true})).html);
 let browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  let p=await browser.newPage({offline:true,acceptDownloads:true,viewport:{width:1440,height:1000}});const errors:string[]=[];p.on('pageerror',e=>errors.push(String(e)));
  await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeEditor);
  assert.equal(await button(p,'图片右下角').isVisible(),false);await button(p,'编辑').click();
  const image=p.frameLocator('#ppte-frame').locator('img[data-ppte-id]').first();await image.click();
  const id=await image.getAttribute('data-ppte-id');const original=await content(p);
  assert.equal(await p.getByLabel('宽度',{exact:true}).count(),0);assert.equal(await p.getByLabel('水平焦点（0–100%）',{exact:true}).count(),0);
  const sibling=()=>p.frameLocator('#ppte-frame').locator('#sibling').evaluate(n=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height];});const beforeSibling=await sibling();
  let r=(await image.boundingBox())!,d=await depth(p);
  await p.mouse.move(r.x+r.width/2,r.y+r.height/2);await p.mouse.down();await p.mouse.move(r.x+r.width/2+40,r.y+r.height/2+30,{steps:8});
  assert.equal(await image.evaluate(n=>n.hasPointerCapture(1)),true,'real mouse pointer is captured by the active image gesture');assert.equal(await content(p),original,'unfinished preview never enters save content');assert.equal(await depth(p),d);
  await p.screenshot({path:join(out,layout+'-preview.png')});await p.mouse.up();
  assert.equal(await depth(p),d+1);assert.equal(await image.evaluate(n=>getComputedStyle(n).opacity),'1');assert.deepEqual(await sibling(),beforeSibling);let b=await model(p);assert.ok(b.x>60);assert.ok(b.y>80);
  const moved=await content(p);await button(p,'撤销').click();assert.equal(await content(p),original);await button(p,'重做').click();assert.equal(await content(p),moved);
  for(const corner of ['左上','右上','左下','右下']){
   const handle=button(p,`图片${corner}角`),h=(await handle.boundingBox())!;assert.ok(h.width>=44&&h.height>=44);
   const before=await model(p),html=await content(p);d=await depth(p);
   await drag(p,h.x+22,h.y+22,corner.includes('左')?-12:12,corner.includes('上')?-8:8);
   b=await model(p);assert.ok(b.w>before.w);assert.ok(Math.abs(b.w/b.h-before.w/before.h)<.001);assert.equal(await depth(p),d+1);assert.deepEqual(await sibling(),beforeSibling);
   await button(p,'撤销').click();assert.equal(await content(p),html);await button(p,'重做').click();
  }
  const beforeCrop=await content(p);d=await depth(p);await button(p,'裁切').click();
  const crop=p.getByLabel('拖动原图调整主体',{exact:true});r=(await crop.boundingBox())!;
  await drag(p,r.x+r.width/2,r.y+r.height/2,0,35);assert.equal(await content(p),beforeCrop);
  await p.screenshot({path:join(out,layout+'-crop.png')});await p.keyboard.press('Escape');assert.equal(await content(p),beforeCrop);assert.equal(await depth(p),d);
  // Double-click enters the same crop session; range + subject is one transaction.
  await image.dblclick();await button(p,'完成').waitFor();r=(await crop.boundingBox())!;await drag(p,r.x+r.width/2,r.y+r.height/2,0,-25);
  const h=(await button(p,'图片右下角').boundingBox())!;await drag(p,h.x+22,h.y+22,25,12);await p.keyboard.press('Enter');
  assert.equal(await depth(p),d+1);const cropped=await content(p);assert.notEqual(cropped,beforeCrop);assert.deepEqual(await sibling(),beforeSibling);
  await button(p,'撤销').click();assert.equal(await content(p),beforeCrop);await button(p,'重做').click();assert.equal(await content(p),cropped);
  b=await model(p);await image.focus();await p.keyboard.press('ArrowRight');assert.equal((await model(p)).x,b.x+1);await button(p,'撤销').click();assert.equal(await content(p),cropped);
  await button(p,'删除对象').click();assert.equal(await p.frameLocator('#ppte-frame').locator('img[data-ppte-id]').count(),0);await button(p,'撤销').click();assert.equal(await content(p),cropped);
  const event=p.waitForEvent('download');await downloadUpdated(p);const saved=join(out,layout+'-saved.ppte.html');await(await event).saveAs(saved);
  const savedContent=readEnhanced(await readFile(saved,'utf8')).content;assert.doesNotMatch(savedContent,/data-ppte-transient|data-ppte-editor-|contenteditable/);assert.equal((await readFile(saved,'utf8')).split(src.split(',')[1]).length-1,1);
  const final=await model(p);await browser.close();browser=await chromium.launch({channel:'chrome',headless:true});p=await browser.newPage({offline:true,viewport:{width:1440,height:1000}});
  await p.goto(pathToFileURL(saved).href);await p.waitForFunction(()=>!!(window as any).PPTeEditor);assert.equal(await p.locator('#ppte-save-ui').getAttribute('data-mode'),'read');assert.deepEqual(await model(p),final);
  await button(p,'编辑').click();await p.frameLocator('#ppte-frame').locator(`[data-ppte-id="${id}"]`).click();await button(p,'裁切').click();await button(p,'取消').click();assert.deepEqual(await model(p),final);
  await p.screenshot({path:join(out,layout+'-reopened.png')});assert.deepEqual(errors,[]);
  await writeFile(join(out,layout+'-journey.json'),JSON.stringify({layout,headless:true,nativePicker:false,fullBrowserRestart:true,version:browser.version(),time:new Date().toISOString(),originalSha256:sha(original),movedSha256:sha(moved),croppedSha256:sha(cropped),final,beforeSibling,errors},null,2));
 }finally{await browser.close();}
});
async function simple(name:string,extra=''){
 await mkdir(out,{recursive:true});const file=join(out,name+'.ppte.html');
 await writeFile(file,(await enhanceHTML(`<style>body{margin:0}section{position:relative;width:960px;height:700px;background:#f8f7f2;padding:40px;box-sizing:border-box}h1{font:32px system-ui}</style><section data-ppte-slide><h1>插入与调整</h1>${extra}</section>`,{root:out,base:out,mediaTable:true})).html);
 const browser=await chromium.launch({channel:'chrome',headless:true}),p=await browser.newPage({offline:true,acceptDownloads:true,viewport:{width:1440,height:1000}});
 p.on('filechooser',()=>{});p.setDefaultTimeout(12000);await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeEditor);await button(p,'编辑').click();return {p,browser};
}
test('U02 insert/replace: portrait, landscape, transparent, tiny and large; frame retention, decoding cancel/error and history',async()=>{
 const {p,browser}=await simple('insert');try{
  for(const [w,h,alpha] of [[600,1200,false],[1200,600,false],[400,400,true],[8,8,true],[3200,2400,false]] as const){
   const before=await content(p),d=await depth(p),buffer=png(w,h,alpha);const event=p.waitForEvent('filechooser');await button(p,'插入图片').click();await(await event).setFiles({name:'sample.png',mimeType:'image/png',buffer});
   await p.frameLocator('#ppte-frame').locator('img[data-ppte-editor-selected]').waitFor();
   let b=await model(p);assert.ok(Math.abs(b.w/b.h-w/h)<.001);assert.ok(b.x>=0&&b.x+b.w<=960&&b.y>=0&&b.y+b.h<=700);assert.equal(await depth(p),d+1);
   const inserted=await content(p),image=p.frameLocator('#ppte-frame').locator('img[data-ppte-id]');assert.equal(await image.getAttribute('src'),'data:image/png;base64,'+buffer.toString('base64'));
   await button(p,'撤销').click();assert.equal(await content(p),before);await button(p,'重做').click();assert.equal(await content(p),inserted);await image.click();
   const replace=p.waitForEvent('filechooser');await button(p,'替换图片').click();await(await replace).setFiles({name:'replacement.png',mimeType:'image/png',buffer:png(900,400)});
   await p.waitForFunction(()=>{const c=(window as any).PPTeEditor.commands,n=c.doc.querySelector('[data-ppte-image-frame]');return JSON.parse(n.dataset.ppteImageFrame).iw/JSON.parse(n.dataset.ppteImageFrame).ih===2.25;});
   const replaced=await model(p);assert.deepEqual([replaced.x,replaced.y,replaced.w,replaced.h],[b.x,b.y,b.w,b.h]);assert.equal(replaced.ox,(b.w-replaced.iw)/2);assert.equal(replaced.oy,(b.h-replaced.ih)/2);
   await button(p,'撤销').click();assert.equal(await content(p),inserted);await button(p,'重做').click();await button(p,'删除对象').click();assert.equal(await content(p),before);
  }
  const before=await content(p),d=await depth(p),event=p.waitForEvent('filechooser');await button(p,'插入图片').click();await(await event).setFiles([]);assert.equal(await content(p),before);assert.equal(await depth(p),d);
  const broken=p.waitForEvent('filechooser');await button(p,'插入图片').click();await(await broken).setFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('broken')});await p.locator('#ppte-feedback').filter({hasText:'无法读取这张图片'}).waitFor();assert.equal(await content(p),before);assert.equal(await depth(p),d);
  // Delay decode only to make the cancellation event deterministic; pointer and
  // chooser operations remain real, this is not native OS picker evidence.
  await p.evaluate(()=>{const w=(window as any).PPTeEditor.commands.doc.defaultView;w.HTMLImageElement.prototype.decode=()=>new Promise(resolve=>setTimeout(resolve,1000));});
  const delayed=p.waitForEvent('filechooser');await button(p,'插入图片').click();await(await delayed).setFiles({name:'cancel.png',mimeType:'image/png',buffer:png(40,40)});await button(p,'取消读取图片').click();await button(p,'取消读取图片').waitFor({state:'hidden'});assert.equal(await content(p),before);assert.equal(await depth(p),d);
  await p.screenshot({path:join(out,'insert-errors-retained.png')});
 }finally{await browser.close();}
});
test('U02 zoom/scroll/resize, bounded drag, pointer cancellation, text/IME and read/present guards',async()=>{
 const {p,browser}=await simple('coordinates',`<img src="${src}" style="position:absolute;left:180px;top:200px;width:240px;height:160px;object-fit:cover"><input aria-label="作者输入" style="position:absolute;left:600px;top:220px">`);try{
  console.info('U02 coordinates: zoom');const image=p.frameLocator('#ppte-frame').locator('img[data-ppte-id]');await image.click();await button(p,'放大画布').click();await button(p,'放大画布').click();
  await p.locator('#ppte-edit-canvas').evaluate(n=>{n.scrollLeft=90;n.scrollTop=60;});await p.setViewportSize({width:1280,height:850});await p.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const before=await content(p),r=(await image.boundingBox())!,scale=await p.locator('#ppte-frame').evaluate(n=>n.getBoundingClientRect().width/n.clientWidth);
  const old=await image.evaluate(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y};});
  await drag(p,r.x+r.width/2,r.y+r.height/2,20*scale,15*scale);let b=await model(p);assert.ok(Math.abs(b.x-old.x-20)<1);assert.ok(Math.abs(b.y-old.y-15)<1);
  await button(p,'撤销').click();assert.equal(await content(p),before);await button(p,'重做').click();
  console.info('U02 coordinates: cancel drag');const moved=await content(p),d=await depth(p),h=(await button(p,'图片右下角').boundingBox())!;
  await p.mouse.move(h.x+22,h.y+22);await p.mouse.down();await p.mouse.move(h.x+60,h.y+45,{steps:4});await p.keyboard.press('Escape');await p.mouse.up();assert.equal(await content(p),moved);assert.equal(await depth(p),d);
  console.info('U02 coordinates: text');const input=p.frameLocator('#ppte-frame').locator('h1');await input.click();await input.fill('abc');await p.keyboard.press('ArrowLeft');await p.keyboard.press('Delete');assert.equal(await input.innerText(),'ab');await button(p,'撤销').click();await button(p,'撤销').click();assert.equal(await p.frameLocator('#ppte-frame').locator('img[data-ppte-id]').count(),1);
  console.info('U02 coordinates: IME');await image.click();await image.evaluate(n=>{n.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));n.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true,isComposing:true}));n.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,isComposing:true}));n.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));});assert.equal(await content(p),moved);
  // A captured pointer can leave the work area; at least 24 author pixels remain.
  console.info('U02 coordinates: bounded drag');const v=(await image.boundingBox())!;await drag(p,v.x+v.width/2,v.y+v.height/2,-1800,-1400);b=await model(p);assert.ok(b.x+b.w>=24&&b.y+b.h>=24);
  console.info('U02 coordinates: modes');await button(p,'撤销').click();await button(p,'阅读').click();assert.equal(await button(p,'图片右下角').isVisible(),false);assert.equal(await content(p),moved);
  await button(p,'放映').click();assert.equal(await button(p,'图片右下角').isVisible(),false);await p.keyboard.press('Escape');assert.equal(await content(p),moved);
  await p.screenshot({path:join(out,'mode-guards.png')});
 }finally{await browser.close();}
});
test('U02 unsupported transformed author image reports boundary before handles; no accidental multi-image selection',async()=>{
 const {p,browser}=await simple('boundaries',`<img src="${src}" style="width:240px;height:160px;transform:rotate(5deg)"><img src="${src}" style="width:120px;height:100px">`);try{
  const images=p.frameLocator('#ppte-frame').locator('img[data-ppte-id]');await images.first().click();assert.equal(await button(p,'图片右下角').isVisible(),false);assert.match(await p.locator('#ppte-feedback').innerText(),/变换.*尚未适配/);
  await images.nth(1).click({modifiers:['Shift']});assert.equal(await p.frameLocator('#ppte-frame').locator('img[data-ppte-editor-selected]').count(),1);
 }finally{await browser.close();}
});
test('U02 static multi-page author coordinates survive save and preserve prior image insertion undo chain',async()=>{
 await mkdir(out,{recursive:true});const file=join(out,'static.ppte.html');
 await writeFile(file,(await enhanceHTML(`<style>body{margin:0}section{width:960px;height:700px;padding:40px;box-sizing:border-box}</style><section data-ppte-slide><h1>第一页</h1></section><section data-ppte-slide><h1>第二页</h1></section>`,{root:out,base:out,mediaTable:true})).html);
 const browser=await chromium.launch({channel:'chrome',headless:true});try{
  const p=await browser.newPage({offline:true,acceptDownloads:true,viewport:{width:1440,height:1000}});p.on('filechooser',()=>{});await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeEditor);await button(p,'编辑').click();await button(p,'下一页').click();
  const original=await content(p),chooser=p.waitForEvent('filechooser');await button(p,'插入图片').click();await(await chooser).setFiles({name:'tiny.png',mimeType:'image/png',buffer:png(8,8,true)});const image=p.frameLocator('#ppte-frame').locator('img[data-ppte-id]');await image.waitFor();
  const inserted=await content(p),h=(await button(p,'图片左上角').boundingBox())!;await drag(p,h.x+22,h.y+22,-12,-12);const resized=await content(p);assert.notEqual(resized,inserted);
  await button(p,'撤销').click();assert.equal(await content(p),inserted);await button(p,'撤销').click();assert.equal(await content(p),original);await button(p,'重做').click();await button(p,'重做').click();assert.equal(await content(p),resized);
  assert.equal(await image.evaluate(n=>(n.closest('[data-ppte-slide]') as HTMLElement).style.position),'relative');const before=await model(p);
  const event=p.waitForEvent('download');await downloadUpdated(p);const saved=join(out,'static-saved.ppte.html');await(await event).saveAs(saved);await p.goto(pathToFileURL(saved).href);await p.waitForFunction(()=>!!(window as any).PPTeEditor);await button(p,'下一页').click();assert.deepEqual(await model(p),before);
  const visual=await image.evaluate(n=>{const r=n.parentElement!.getBoundingClientRect(),s=n.closest('[data-ppte-slide]')!.getBoundingClientRect();return {x:r.x-s.x,y:r.y-s.y};});assert.ok(Math.abs(visual.x-before.x)<1&&Math.abs(visual.y-before.y)<1);
 }finally{await browser.close();}
});
