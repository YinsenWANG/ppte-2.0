import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium,type Page} from 'playwright';
import {enhanceHTML,readEnhanced} from '../packages/html-document/src/index.js';
const out=resolve('artifacts/audit-followup-r02');
const b=(p:Page,name:string)=>p.getByRole('button',{name,exact:true});
const content=(p:Page)=>p.evaluate(()=>(window as any).PPTeHTML.content() as string);
const state=(p:Page)=>p.evaluate(()=>{const w=window as any;return {pending:w.PPTeEditor.pendingInteraction,cropping:w.PPTeEditor.cropping,revision:w.PPTeSave.revision,dirty:w.PPTeSave.dirty,depth:w.PPTeEditor.commands.undoStack.length};});
const image=(p:Page)=>p.frameLocator('#ppte-frame').locator('#subject');
async function setup(name:string,write=false){
 await mkdir(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true});const p=await browser.newPage({offline:true,viewport:{width:1440,height:1000}});p.setDefaultTimeout(10000);
 const src=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=300;c.height=600;const x=c.getContext('2d')!;x.fillStyle='#bb482d';x.fillRect(0,0,300,300);x.fillStyle='#192f46';x.fillRect(0,300,300,300);return c.toDataURL();});
 const file=join(out,name+'.html');await writeFile(file,(await enhanceHTML(`<title>R02 transactions</title><style>section{position:relative;width:960px;height:700px}img{position:absolute;left:100px;top:170px;width:300px;height:200px;object-fit:cover}h1{font:36px system-ui}</style><section data-ppte-slide><h1>第一页</h1><img id="subject" src="${src}"><img id="other" style="left:500px" src="${src}"><p>另一个对象</p></section><section data-ppte-slide><h1>第二页</h1></section>`,{root:out,base:out})).html);
 const writes:string[]=[];await p.exposeFunction('r02read',()=>readFile(file,'utf8'));await p.exposeFunction('r02write',async(s:string)=>{writes.push(s);await writeFile(file,s);});
 await p.addInitScript(({write})=>{const w=window as any;w.showOpenFilePicker=write?async()=>[{name:'current.html',requestPermission:async()=>'granted',queryPermission:async()=>'granted',getFile:async()=>({text:()=>w.r02read()}),createWritable:async()=>{if(w.r02fail)throw Error('DISK_FAILURE');let bytes='';return {write:async(s:string)=>{bytes=s;},close:()=>w.r02write(bytes),abort:async()=>{}};}}]:undefined;},{write});
 await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeSave);await b(p,'编辑').click();return {p,browser,file,writes,src};
}
async function crop(p:Page,adjust=true){await image(p).click();await b(p,'裁切').click();if(adjust){const r=(await p.getByLabel('拖动原图调整主体',{exact:true}).boundingBox())!;await p.mouse.move(r.x+r.width/2,r.y+r.height/2);await p.mouse.down();await p.mouse.move(r.x+r.width/2,r.y+r.height/2+35,{steps:8});await p.mouse.up();} }
async function box(p:Page){return image(p).evaluate(n=>{const r=n.getBoundingClientRect();const f=n.parentElement!.getBoundingClientRect();return [r.x,r.y,r.width,r.height,f.x,f.y,f.width,f.height];});}

test('R02 download: preview, explicit completion, single real download bytes, fresh browser geometry and undo',async()=>{
 const {p,browser,src}=await setup('download');let fresh;try{
  const original=await content(p);await crop(p);await p.getByLabel('拖动原图调整主体',{exact:true}).dblclick();assert.equal(await content(p),original);assert.equal((await state(p)).dirty,false);assert.equal((await state(p)).pending,true);assert.match(await p.getByRole('status').innerText(),/裁切中/);
  const preview=await p.getByLabel('拖动原图调整主体',{exact:true}).boundingBox();assert.ok(preview&&preview.width>100&&preview.height>100);const bitmapPreview=(await p.getByLabel('拖动原图调整主体',{exact:true}).locator('img').boundingBox())!;await p.screenshot({path:join(out,'preview.png')});
  assert.equal(await p.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;}),true);
  let downloads=0;p.on('download',()=>downloads++);await b(p,'下载更新后的文件').click();await b(p,'继续调整').click();assert.equal(downloads,0);assert.equal(await content(p),original);assert.equal((await state(p)).pending,true);
  await b(p,'下载更新后的文件').click();await p.screenshot({path:join(out,'save-decision.png')});const event=p.waitForEvent('download');await b(p,'完成裁切并继续').click();const saved=join(out,'download-result.html');await(await event).saveAs(saved);assert.equal(downloads,1);
  const committed=await content(p),bytes=await readFile(saved,'utf8');assert.notEqual(committed,original);assert.equal(readEnhanced(bytes).content,committed);assert.ok(bytes.includes(src));assert.equal((await state(p)).depth,1);assert.equal((await state(p)).pending,false);const geometry=await box(p);const actual=(await image(p).boundingBox())!;for(const key of ['x','y','width','height'] as const)assert.ok(Math.abs(actual[key]-bitmapPreview[key])<=1,`preview ${key} matches committed bitmap`);
  await b(p,'撤销').click();assert.equal(await content(p),original);await b(p,'重做').click();assert.equal(await content(p),committed);
  await browser.close();fresh=await chromium.launch({channel:'chrome',headless:true});const reopened=await fresh.newPage({offline:true,viewport:{width:1440,height:1000}});await reopened.goto(pathToFileURL(saved).href);await reopened.waitForFunction(()=>!!(window as any).PPTeSave);assert.equal(await content(reopened),committed);await b(reopened,'编辑').click();await image(reopened).click();assert.deepEqual(await box(reopened),geometry);assert.equal(await image(reopened).getAttribute('src'),src);await reopened.screenshot({path:join(out,'reopened.png')});
  await writeFile(join(out,'download-result.json'),JSON.stringify({preview,geometry,downloads,browser:fresh.version(),headless:true,nativePicker:false,freshBrowser:true},null,2));
 }finally{await browser.close();await fresh?.close();}
});

for(const action of ['阅读','放映','下一页','缩略图','另一对象','另一图片','删除对象','键盘删除','替换图片'])test(`R02 leave ${action}: stay / discard / apply through one exit`,async()=>{
 const {p,browser}=await setup('leave-'+action);try{
  const original=await content(p);const act=async()=>{if(action==='另一对象')await p.frameLocator('#ppte-frame').locator('p').click();else if(action==='缩略图')await b(p,'第 2 页').click();else if(action==='键盘删除')await p.keyboard.press('Delete');else if(action==='另一图片')await p.frameLocator('#ppte-frame').locator('#other').click();else await b(p,action).click();};
  await crop(p);await act();await b(p,'留在当前').click();assert.equal((await state(p)).pending,true);assert.equal(await content(p),original);assert.equal(await p.locator('#ppte-save-ui').getAttribute('data-mode'),'edit');
  await act();const chooser=action==='替换图片'?p.waitForEvent('filechooser'):undefined;await b(p,'放弃并继续').click();if(chooser)await(await chooser).setFiles([]);assert.equal((await state(p)).pending,false);
  if((action==='删除对象'||action==='键盘删除')){assert.equal(await image(p).count(),0);await b(p,'撤销').click();}else assert.equal(await content(p),original);
  if(action==='放映')await p.keyboard.press('Escape');if((action==='下一页'||action==='缩略图'))await b(p,'上一页').click();await b(p,'编辑').click();
  await crop(p);await act();const chooser2=action==='替换图片'?p.waitForEvent('filechooser'):undefined;await b(p,'应用并继续').click();if(chooser2){const replacement=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=300;return c.toDataURL();});await(await chooser2).setFiles({name:'replacement.png',mimeType:'image/png',buffer:Buffer.from(replacement.split(',')[1],'base64')});await p.waitForFunction(src=>(window as any).PPTeEditor.commands.doc.querySelector('#subject').getAttribute('src')===src,replacement);await b(p,'撤销').click();} assert.equal((await state(p)).pending,false);assert.notEqual(await content(p),original);
  if(action==='阅读')assert.equal(await p.locator('#ppte-save-ui').getAttribute('data-mode'),'read');
  if(action==='放映'){assert.equal(await p.locator('#ppte-save-ui').isVisible(),false);await p.keyboard.press('Escape');}
  if((action==='下一页'||action==='缩略图')){assert.equal(await p.frameLocator('#ppte-frame').locator('h1').nth(1).isVisible(),true);await b(p,'上一页').click();}
  await b(p,'编辑').click();if((action==='删除对象'||action==='键盘删除'))await b(p,'撤销').click();assert.ok((await content(p)).includes('data-ppte-image-frame'));
  const applied=await content(p),event=p.waitForEvent('download');await b(p,'下载更新后的文件').click();const saved=join(out,'leave-'+action+'-saved.html');await(await event).saveAs(saved);assert.equal(readEnhanced(await readFile(saved,'utf8')).content,applied);const reopened=await browser.newPage({offline:true});await reopened.goto(pathToFileURL(saved).href);await reopened.waitForFunction(()=>!!(window as any).PPTeSave);assert.equal(await content(reopened),applied);await reopened.close();
  await b(p,'撤销').click();assert.equal(await content(p),original);
 }finally{await browser.close();}
});

test('R02 Esc and unchanged crop: exact content and history, no reminder or leave prompt',async()=>{
 const {p,browser}=await setup('cancel');try{const original=await content(p);await crop(p);await p.keyboard.press('Escape');assert.equal(await content(p),original);assert.equal((await state(p)).depth,0);assert.equal((await state(p)).pending,false);assert.equal(await p.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;}),false);
 await crop(p,false);await b(p,'阅读').click();assert.equal(await p.getByRole('dialog').count(),0);assert.equal(await content(p),original);assert.equal((await state(p)).depth,0);
 await b(p,'编辑').click();await crop(p,false);await b(p,'完成').click();assert.equal(await content(p),original);assert.equal((await state(p)).depth,0);
 await crop(p,false);const event=p.waitForEvent('download');await b(p,'下载更新后的文件').click();const saved=join(out,'unchanged-saved.html');await(await event).saveAs(saved);assert.equal(await p.getByRole('dialog').count(),0);assert.equal(readEnhanced(await readFile(saved,'utf8')).content,original);
 }finally{await browser.close();}
});

test('R02 manual and automatic disk bridge: committed bytes only, failure preserves crop/source, one undo',async()=>{
 const {p,browser,file,writes,src}=await setup('write',true);try{
  const original=await content(p);await crop(p);await b(p,'保存').click();await b(p,'继续调整').click();assert.equal(writes.length,0);await b(p,'保存').click();await b(p,'完成裁切并继续').click();await b(p,'选择当前文件并保存').click();await p.waitForFunction(()=>(window as any).PPTeSave.state==='saved');assert.equal(writes.length,1);const first=await content(p);assert.equal(readEnhanced(await readFile(file,'utf8')).content,first);
  // Schedule a committed text edit, then start a crop before the real autosave timer fires.
  await p.frameLocator('#ppte-frame').locator('h1').first().fill('已提交的文字');await image(p).click();const committed=await content(p);await b(p,'裁切').click();const r=(await p.getByLabel('拖动原图调整主体',{exact:true}).boundingBox())!;await p.mouse.move(r.x+r.width/2,r.y+r.height/2);await p.mouse.down();await p.mouse.move(r.x+r.width/2,r.y+r.height/2-25,{steps:5});await p.mouse.up();
  await p.waitForFunction(()=>(window as any).PPTeSave.state==='saved');assert.equal(readEnhanced(await readFile(file,'utf8')).content,committed);assert.equal((await state(p)).pending,true);assert.match(await p.getByRole('status').innerText(),/已提交修改已保存/);assert.match(await p.getByRole('status').innerText(),/裁切仍在调整/);assert.equal(await content(p),committed);
  await p.evaluate(()=>{(window as any).r02fail=true;});await b(p,'保存').click();await b(p,'完成裁切并继续').click();await p.waitForFunction(()=>(window as any).PPTeSave.state==='failed');const failed=await content(p);assert.notEqual(failed,committed);assert.equal(await image(p).getAttribute('src'),src);assert.equal((await state(p)).dirty,true);assert.equal(readEnhanced(await readFile(file,'utf8')).content,committed);await b(p,'撤销').click();assert.equal(await content(p),committed);
  const fresh=await browser.newPage({offline:true});await fresh.goto(pathToFileURL(file).href);await fresh.waitForFunction(()=>!!(window as any).PPTeSave);assert.equal(await content(fresh),committed);assert.equal(await image(fresh).getAttribute('src'),src);
 }finally{await browser.close();}
});
