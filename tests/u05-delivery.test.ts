import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium,type Page} from 'playwright';
import {readEnhanced} from '../packages/html-document/src/index.js';
const out=resolve('artifacts/u05-delivery');
const source=resolve('docs/usability-reset/evidence/U01/Cherry-Studio-开源之路.ppte.html');
const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const btn=(p:Page,name:string)=>p.getByRole('button',{name,exact:true});
const content=(p:Page)=>p.evaluate(()=>(window as any).PPTeHTML.content() as string);
async function drag(p:Page,r:{x:number;y:number;width:number;height:number},dx:number,dy:number){await p.mouse.move(r.x+r.width/2,r.y+r.height/2);await p.mouse.down();await p.mouse.move(r.x+r.width/2+dx,r.y+r.height/2+dy,{steps:8});await p.mouse.up();}
test('U05 delivery: nine-page reading, text, insert, drag/resize/crop, undo/redo, disk bridge, full process restart and presentation',async()=>{
 await mkdir(out,{recursive:true});const original=await readFile(source);const file=join(out,'journey-original.ppte.html');await copyFile(source,file);
 const steps:object[]=[],errors:string[]=[],network:string[]=[],writes:object[]=[];
 let browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  let p=await browser.newPage({offline:true,viewport:{width:1440,height:1000}});p.setDefaultTimeout(15000);
  const monitor=(q:Page)=>{q.on('pageerror',e=>errors.push(String(e)));q.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});};monitor(p);
  // This replaces only the native picker/file handle. Disk IO is real, but is explicitly AUTOMATED evidence.
  await p.exposeFunction('u05read',()=>readFile(file,'utf8'));
  await p.exposeFunction('u05write',async(s:string)=>{await writeFile(file,s);writes.push({sha256:sha(s),time:new Date().toISOString()});});
  await p.addInitScript(()=>{const w=window as any;w.showOpenFilePicker=async()=>[{name:'journey-original.ppte.html',queryPermission:async()=>'granted',requestPermission:async()=>'granted',getFile:async()=>({text:()=>w.u05read()}),createWritable:async()=>{let bytes='';return {write:async(s:string)=>{bytes=s;},close:()=>w.u05write(bytes),abort:async()=>{}};}}];});
  await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeEditor);
  assert.equal(await p.locator('#ppte-save-ui').getAttribute('data-mode'),'read');
  assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-slide]').count(),9);
  for(let i=0;i<9;i++){if(i)await btn(p,'下一页').click();assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-slide]').nth(i).isVisible(),true);}
  steps.push({step:'read',pages:9});
  for(let i=0;i<8;i++)await btn(p,'上一页').click();await p.screenshot({path:join(out,'01-read.png')});
  await btn(p,'编辑').click();const title=p.frameLocator('#ppte-frame').locator('[data-ppte-id="u01-cover-title"]');
  await title.fill('开源之路 · 一起参与');await btn(p,'页面设置').click();assert.equal(await title.innerText(),'开源之路 · 一起参与');steps.push({step:'edit-text'});
  // Rasterize the existing concept illustration for the raster-image insertion control.
  for(let i=0;i<3;i++)await btn(p,'下一页').click();
  const illustration=await p.frameLocator('#ppte-frame').locator('.diagram-image').screenshot({path:join(out,'insert-illustration.png')});
  for(let i=0;i<3;i++)await btn(p,'上一页').click();
  const chooser=p.waitForEvent('filechooser');await btn(p,'插入图片').click();await(await chooser).setFiles({name:'concept.png',mimeType:'image/png',buffer:illustration});
  const image=p.frameLocator('#ppte-frame').locator('img[data-ppte-editor-selected]');await image.waitFor();const id=await image.getAttribute('data-ppte-id');assert.ok(id);
  const stable=p.frameLocator('#ppte-frame').locator(`img[data-ppte-id="${id}"]`);
  const model=()=>stable.evaluate(n=>n.parentElement!.getAttribute('data-ppte-image-frame'));
  const inserted=await content(p);steps.push({step:'insert',imageId:id});
  await drag(p,(await stable.boundingBox())!,30,20);const moved=await content(p);assert.notEqual(moved,inserted);steps.push({step:'drag'});
  await drag(p,(await btn(p,'图片右下角').boundingBox())!,24,16);const resized=await content(p);assert.notEqual(resized,moved);steps.push({step:'resize'});
  await btn(p,'裁切').click();await drag(p,(await btn(p,'图片右下角').boundingBox())!,-45,-25);await drag(p,(await p.getByLabel('拖动原图调整主体',{exact:true}).boundingBox())!,-12,-8);await btn(p,'完成').click();
  const cropped=await content(p);assert.notEqual(cropped,resized);steps.push({step:'crop'});
  await btn(p,'撤销').click();assert.equal(await content(p),resized);await btn(p,'重做').click();assert.equal(await content(p),cropped);steps.push({step:'undo-redo',exactContentEquality:true});
  const geometry=await model();assert.ok(geometry);await p.screenshot({path:join(out,'02-edited.png')});
  await btn(p,'保存').click();await btn(p,'选择当前文件并保存').click();await p.waitForFunction(()=>(window as any).PPTeSave.state==='saved');
  const saved=await readFile(file,'utf8');assert.equal(readEnhanced(saved).content,await content(p));assert.ok(writes.length>=1);assert.notEqual(sha(saved),sha(original));
  assert.doesNotMatch(readEnhanced(saved).content,/data-ppte-transient|data-ppte-editor-|contenteditable/);steps.push({step:'save-original-path',nativePicker:false,diskBridge:true,sha256:sha(saved)});
  await browser.close();steps.push({step:'exit-browser',fullProcess:true});
  browser=await chromium.launch({channel:'chrome',headless:true});p=await browser.newPage({offline:true,viewport:{width:1440,height:1000}});monitor(p);
  await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeEditor);
  assert.equal(await p.locator('#ppte-save-ui').getAttribute('data-mode'),'read');assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-id="u01-cover-title"]').innerText(),'开源之路 · 一起参与');
  assert.equal(await p.frameLocator('#ppte-frame').locator(`img[data-ppte-id="${id}"]`).evaluate(n=>n.parentElement!.getAttribute('data-ppte-image-frame')),geometry);
  assert.equal(readEnhanced(await readFile(file,'utf8')).content,await content(p));steps.push({step:'reopen',textImageGeometryRetained:true});await p.screenshot({path:join(out,'03-reopened.png')});
  await btn(p,'放映').click();assert.equal(await p.locator('#ppte-save-ui').isVisible(),false);
  for(let i=0;i<9;i++){if(i)await p.keyboard.press('ArrowRight');assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-slide]').nth(i).isVisible(),true);await p.screenshot({path:join(out,`present-${i+1}.png`)});}
  await p.keyboard.press('Escape');steps.push({step:'present',pages:9});assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
  assert.deepEqual(await readFile(source),original,'signed-off direction clean deck stays byte-identical');
  await writeFile(join(out,'journey.json'),JSON.stringify({time:new Date().toISOString(),browser:browser.version(),headless:true,nativePicker:false,physicalDesktop:false,offline:true,sourceSha256:sha(original),savedSha256:sha(saved),steps,writes,errors,network,pdf:'excluded by U04 option 1; incomplete'},null,2));
 }finally{await browser.close();}
});
