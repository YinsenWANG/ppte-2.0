import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium,type Page} from 'playwright';
import {readEnhanced} from '../packages/html-document/src/index.js';
const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const btn=(p:Page,name:string)=>p.getByRole('button',{name,exact:true});
const content=(p:Page)=>p.evaluate(()=>(window as any).PPTeHTML.content() as string);
async function drag(p:Page,r:{x:number;y:number;width:number;height:number},dx:number,dy:number){await p.mouse.move(r.x+r.width/2,r.y+r.height/2);await p.mouse.down();await p.mouse.move(r.x+r.width/2+dx,r.y+r.height/2+dy,{steps:8});await p.mouse.up();}
// Separate, bounded synchronous diagnostics: no author content, URLs or async IO.
function diagnostics(file:string,sink:(file:string,data:string)=>void=writeFileSync){
 const records:object[]=[];let dropped=0;
 const record=(event:string,subject:string,error?:unknown)=>{try{
  if(records.length>=128){dropped++;return;}
  const detail:Record<string,string>={};
  if(error!==undefined && error!==null){
   // Do not stringify arbitrary objects or invoke their toString methods.
   for(const key of ['name','message'] as const){try{const value=(error as any)[key];if(typeof value==='string')detail[key]=value.slice(0,512);}catch{}}
  }
  records.push({sequence:records.length+1,time:Date.now(),event,subject,...detail});
 }catch{}};
 const flush=()=>{try{sink(file,JSON.stringify({records,dropped},null,2));}catch{}};
 return {record,flush};
}
async function observed<T>(record:ReturnType<typeof diagnostics>['record'],kind:string,subject:string,operation:()=>Promise<T>):Promise<T>{
 record(`${kind}-start`,subject);
 try{const value=await operation();record(`${kind}-end`,subject);return value;}
 catch(error){record(`${kind}-error`,subject,error);throw error;}
}
test('U05 diagnostics preserve screenshot result, options and primary rejection despite sink failure',async()=>{
 let output='';const d=diagnostics('unused',(_file,data)=>{output=data;});
 const options={path:'02-edited.png',caret:'initial' as const},result=Buffer.from('image');
 let calls=0;assert.equal(await observed(d.record,'screenshot',options.path,async()=>{calls++;assert.equal(options.caret,'initial');return result;}),result);assert.equal(calls,1);
 const failure=Object.assign(new Error('capture failed'),{toString(){throw Error('must not stringify');}});
 await assert.rejects(observed(d.record,'screenshot','present-1.png',async()=>{throw failure;}),error=>error===failure);
 d.flush();assert.deepEqual(JSON.parse(output).records.map((r:any)=>r.event),['screenshot-start','screenshot-end','screenshot-start','screenshot-error']);
 const unwritable=diagnostics('unused',()=>{throw Error('diagnostic write failed');});
 await assert.rejects(observed(unwritable.record,'browser-close','browser-1',async()=>{throw failure;}),error=>error===failure);assert.doesNotThrow(unwritable.flush);
});
test('U05 diagnostics bound records and tolerate unsafe error properties',()=>{
 let output='';const d=diagnostics('unused',(_file,data)=>{output=data;});
 const error={get name(){throw Error('unsafe');},message:'x'.repeat(2000),toString(){throw Error('unsafe');}};
 for(let i=0;i<140;i++)assert.doesNotThrow(()=>d.record('screenshot-error','present-1.png',error));
 d.flush();const data=JSON.parse(output);assert.equal(data.records.length,128);assert.equal(data.dropped,12);assert.equal(data.records[0].message.length,512);assert.ok(output.length<100000);
});
for(const [label,sourcePath,outputPath] of [
 ['U05','docs/usability-reset/evidence/U01/Cherry-Studio-开源之路.ppte.html','artifacts/u05-delivery'],
 ['DLV','docs/audits/2026-09-08-main-52e3bf0/evidence/DLV/delivery/Cherry-Studio-开源之路.ppte.html','artifacts/audit-delivery-journey'],
]){
const source=resolve(sourcePath),out=resolve(outputPath);
test(`${label} delivery: nine-page reading, text, insert, drag/resize/crop, undo/redo, disk bridge, full process restart and presentation`,async()=>{
 await mkdir(out,{recursive:true});const original=await readFile(source);const file=join(out,'journey-original.ppte.html');await copyFile(source,file);
 const steps:object[]=[],errors:string[]=[],network:string[]=[],writes:object[]=[];
 const diagnostic=diagnostics(join(out,'journey-diagnostics.json'));
 let browserNumber=1;const watchBrowser=()=>{const subject=`browser-${browserNumber}`;browser.on('disconnected',()=>diagnostic.record('browser-disconnected',subject));};
 const closeBrowser=()=>observed(diagnostic.record,'browser-close',`browser-${browserNumber}`,()=>browser.close());
 const capture=<T>(name:string,operation:()=>Promise<T>)=>observed(diagnostic.record,'screenshot',name,operation);
 let browser=await chromium.launch({channel:'chrome',headless:true});
 watchBrowser();
 try{
  let p=await browser.newPage({offline:true,viewport:{width:1440,height:1000}});p.setDefaultTimeout(15000);
  let pageNumber=0;const monitor=(q:Page)=>{const subject=`page-${++pageNumber}`;q.on('close',()=>diagnostic.record('page-close',subject));q.on('crash',()=>diagnostic.record('page-crash',subject));q.on('pageerror',e=>errors.push(String(e)));q.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});};monitor(p);
  // This replaces only the native picker/file handle. Disk IO is real, but is explicitly AUTOMATED evidence.
  await p.exposeFunction('u05read',()=>readFile(file,'utf8'));
  await p.exposeFunction('u05write',async(s:string)=>{await writeFile(file,s);writes.push({sha256:sha(s),time:new Date().toISOString()});});
  await p.addInitScript(()=>{const w=window as any;w.showOpenFilePicker=async()=>[{name:'journey-original.ppte.html',queryPermission:async()=>'granted',requestPermission:async()=>'granted',getFile:async()=>({text:()=>w.u05read()}),createWritable:async()=>{let bytes='';return {write:async(s:string)=>{bytes=s;},close:()=>w.u05write(bytes),abort:async()=>{}};}}];});
  await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeEditor);
  assert.equal(await p.locator('#ppte-save-ui').getAttribute('data-mode'),'read');
  assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-slide]').count(),9);
  for(let i=0;i<9;i++){if(i)await btn(p,'下一页').click();assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-slide]').nth(i).isVisible(),true);}
  steps.push({step:'read',pages:9});
  for(let i=0;i<8;i++)await btn(p,'上一页').click();await capture('01-read.png',()=>p.screenshot({path:join(out,'01-read.png')}));
  await btn(p,'编辑').click();const title=p.frameLocator('#ppte-frame').locator('[data-ppte-id="u01-cover-title"]');
  await title.fill('开源之路 · 一起参与');await btn(p,'页面设置').click();assert.equal(await title.innerText(),'开源之路 · 一起参与');steps.push({step:'edit-text'});
  // Rasterize the existing concept illustration for the raster-image insertion control.
  for(let i=0;i<3;i++)await btn(p,'下一页').click();
  const illustration=await capture('insert-illustration.png',()=>p.frameLocator('#ppte-frame').locator('.diagram-image').screenshot({path:join(out,'insert-illustration.png')}));
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
  // Playwright's default caret hiding mutates inline styles while screenshotting.
  // Autosave observes those mutations: capture the actual UI without injecting them.
  const geometry=await model();assert.ok(geometry);await capture('02-edited.png',()=>p.screenshot({path:join(out,'02-edited.png'),caret:'initial'}));
  assert.equal(await content(p),cropped,'evidence capture must leave author content unchanged');
  await btn(p,'保存').click();await btn(p,'选择当前文件并保存').click();await p.waitForFunction(()=>(window as any).PPTeSave.state==='saved');
  const saved=await readFile(file,'utf8');assert.equal(readEnhanced(saved).content,await content(p));assert.ok(writes.length>=1);assert.notEqual(sha(saved),sha(original));
  assert.doesNotMatch(readEnhanced(saved).content,/data-ppte-transient|data-ppte-editor-|contenteditable/);steps.push({step:'save-original-path',nativePicker:false,diskBridge:true,sha256:sha(saved)});
  await closeBrowser();steps.push({step:'exit-browser',fullProcess:true});
  browser=await chromium.launch({channel:'chrome',headless:true});browserNumber++;watchBrowser();p=await browser.newPage({offline:true,viewport:{width:1440,height:1000}});monitor(p);
  await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeEditor);
  assert.equal(await p.locator('#ppte-save-ui').getAttribute('data-mode'),'read');assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-id="u01-cover-title"]').innerText(),'开源之路 · 一起参与');
  assert.equal(await p.frameLocator('#ppte-frame').locator(`img[data-ppte-id="${id}"]`).evaluate(n=>n.parentElement!.getAttribute('data-ppte-image-frame')),geometry);
  assert.equal(readEnhanced(await readFile(file,'utf8')).content,await content(p));steps.push({step:'reopen',textImageGeometryRetained:true});await capture('03-reopened.png',()=>p.screenshot({path:join(out,'03-reopened.png')}));
  await btn(p,'放映').click();assert.equal(await p.locator('#ppte-save-ui').isVisible(),false);
  for(let i=0;i<9;i++){if(i)await p.keyboard.press('ArrowRight');assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-slide]').nth(i).isVisible(),true);await capture(`present-${i+1}.png`,()=>p.screenshot({path:join(out,`present-${i+1}.png`)}));}
  await p.keyboard.press('Escape');steps.push({step:'present',pages:9});assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
  assert.deepEqual(await readFile(source),original,'signed-off direction clean deck stays byte-identical');
  await writeFile(join(out,'journey.json'),JSON.stringify({time:new Date().toISOString(),browser:browser.version(),headless:true,nativePicker:false,physicalDesktop:false,offline:true,sourceSha256:sha(original),savedSha256:sha(saved),steps,writes,errors,network,pdf:'excluded by U04 option 1; incomplete'},null,2));
 }finally{try{await closeBrowser();}finally{diagnostic.flush();}}
});

}
