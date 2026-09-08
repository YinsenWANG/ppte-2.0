import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium,type Page} from 'playwright';
import {imageRaster} from './helpers/stable-raster.js';
import {enhanceHTML,readEnhanced} from '../packages/html-document/src/index.js';
const out=resolve('artifacts/audit-followup-r03');
const b=(p:Page,name:string)=>p.getByRole('button',{name,exact:true});
const content=(p:Page)=>p.evaluate(()=>(window as any).PPTeHTML.content() as string);
const image=(p:Page)=>p.frameLocator('#ppte-frame').locator('#subject');
const cw=300,ch=260,nw=640,nh=440;
// Use software compositing for deterministic cross-mode raster comparisons.
// No author CSS or pixels are changed; imageRaster also waits for stable paints.
// Keep the original DPR 3 matrix and cover DPR 1 explicitly below.
const cases=[
 {name:'negative-px',position:'-20px 0px',offset:()=>[-20,0]},
 {name:'positive-px',position:'20px 12px',offset:()=>[20,12]},
 {name:'percentage',position:'25% 75%',offset:(x:number,y:number)=>[x*.25,y*.75]},
 {name:'left-top',position:'left top',offset:()=>[0,0]},
 {name:'right-bottom',position:'right bottom',offset:(x:number,y:number)=>[x,y]},
 {name:'edge-lengths',position:'right 20px bottom 10px',offset:(x:number,y:number)=>[x-20,y-10]},
 {name:'calc',position:'calc(25% - 20px) calc(75% + 8px)',offset:(x:number,y:number)=>[x*.25-20,y*.75+8]},
 {name:'math',position:'min(25%, -10px) clamp(-30px, 75%, 40px)',offset:(x:number,y:number)=>[Math.min(x*.25,-10),Math.max(-30,Math.min(y*.75,40))]},
];
async function setup(name:string,fit:string,position:string,deviceScaleFactor=3){
 await mkdir(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});const p=await browser.newPage({offline:true,deviceScaleFactor,viewport:{width:1440,height:1000}});p.setDefaultTimeout(10000);
 const src=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=640;c.height=440;const x=c.getContext('2d')!;for(let i=0;i<8;i++){x.fillStyle=['#c43','#235','#ebc','#396'][i%4];x.fillRect(i*80,0,80,440);}x.fillStyle='#fff';x.fillRect(30,100,500,35);return c.toDataURL();});
 const file=join(out,name+'.html');await writeFile(file,(await enhanceHTML(`<title>R03 fixture</title><style>section{position:relative;width:960px;height:700px}img{position:absolute;left:100px;top:160px;width:300px;height:260px;object-fit:${fit};object-position:${position}}</style><section data-ppte-slide><h1>定位夹具</h1><img id="subject" src="${src}"></section>`,{root:out,base:out})).html);
 await p.addInitScript(()=>{(window as any).showOpenFilePicker=undefined;});await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeSave);await b(p,'编辑').click();await image(p).click();return {browser,p,src};
}
function near(a:number,b:number,label:string){assert.ok(Math.abs(a-b)<.05,`${label}: ${a} vs ${b}`);}
for(const fit of ['cover','contain'])for(const c of cases)test(`R03 ${fit} ${c.name}: browser preview, no-op bytes/history, actual move/download/fresh reopen`,async()=>{
 const name=fit+'-'+c.name,{browser,p,src}=await setup(name,fit,c.position);let fresh;
 try{
  const original=await content(p);await b(p,'阅读').click();const before=await imageRaster(image(p));await b(p,'编辑').click();await image(p).click();await writeFile(join(out,name+'-before.png'),before);
  const r=(await image(p).boundingBox())!,k=r.width/cw,scale=fit==='cover'?Math.max(cw/nw,ch/nh):Math.min(cw/nw,ch/nh),iw=nw*scale,ih=nh*scale,[ox,oy]=c.offset(cw-iw,ch-ih);
  await b(p,'裁切').click();const preview=(await p.getByLabel('拖动原图调整主体',{exact:true}).locator('img').boundingBox())!;
  near(preview.x,r.x+ox*k,'bitmap x');near(preview.y,r.y+oy*k,'bitmap y');near(preview.width,iw*k,'bitmap width');near(preview.height,ih*k,'bitmap height');
  assert.equal(await content(p),original);assert.equal(await p.evaluate(()=>(window as any).PPTeEditor.pendingInteraction),false);
  await p.screenshot({path:join(out,name+'-preview.png'),caret:'initial'});await b(p,'完成').click();assert.equal(await content(p),original);
  assert.equal(await p.evaluate(()=>(window as any).PPTeEditor.commands.undoStack.length),0);
  await b(p,'阅读').click();const after=await imageRaster(image(p));await writeFile(join(out,name+'-after.png'),after);assert.deepEqual(after,before,'no-op rendered image pixels unchanged');await b(p,'编辑').click();await image(p).click();
  const download=async(suffix:string)=>{const event=p.waitForEvent('download');await b(p,'下载更新后的文件').click();const file=join(out,name+suffix+'.html');await(await event).saveAs(file);return file;};
  const unchanged=await download('-unchanged');assert.equal(readEnhanced(await readFile(unchanged,'utf8')).content,original);
  // A real ordinary move commits the measured object-position without crop clamping.
  await image(p).click();await p.keyboard.press('ArrowRight');const moved=await content(p);assert.notEqual(moved,original);
  const model=await image(p).evaluate(n=>JSON.parse(n.parentElement!.dataset.ppteImageFrame!));
  near(model.ox,ox,'stored ox');near(model.oy,oy,'stored oy');near(model.iw,iw,'stored iw');near(model.ih,ih,'stored ih');near(model.x,101,'moved x');assert.equal(await image(p).getAttribute('src'),src);
  const saved=await download('-moved');assert.equal(readEnhanced(await readFile(saved,'utf8')).content,moved);
  await b(p,'撤销').click();assert.equal(await content(p),original);await b(p,'重做').click();assert.equal(await content(p),moved);
  await browser.close();fresh=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});const q=await fresh.newPage({offline:true,deviceScaleFactor:3,viewport:{width:1440,height:1000}});
  for(const [file,expected] of [[unchanged,original],[saved,moved]]){
   await q.goto(pathToFileURL(file).href);await q.waitForFunction(()=>!!(window as any).PPTeSave);assert.equal(await content(q),expected);if(file===unchanged)assert.deepEqual(await imageRaster(image(q)),before,'fresh process no-op pixel equality');await b(q,'编辑').click();await image(q).click();
   if(file===saved) {const actual=(await image(q).boundingBox())!;near(actual.width,iw*k,'reopened bitmap width');near(actual.height,ih*k,'reopened bitmap height');const f=(await q.frameLocator('#ppte-frame').locator('[data-ppte-image-frame]').boundingBox())!;near(actual.x-f.x,ox*k,'reopened ox');near(actual.y-f.y,oy*k,'reopened oy');}
   assert.equal(await image(q).getAttribute('src'),src);
  }
  await q.screenshot({path:join(out,name+'-reopened.png')});await writeFile(join(out,name+'.json'),JSON.stringify({fit,position:c.position,expected:{iw,ih,ox,oy},preview,model,browser:fresh.version(),headless:true,freshProcess:true},null,2));
 }finally{await browser.close();await fresh?.close();}
});
test('R03 unsupported contextual math reports before interaction and preserves content/history',async()=>{
 const {browser,p}=await setup('unsupported','cover','round(nearest, 25%, 10px) 0px');try{
  assert.match(await image(p).evaluate(n=>getComputedStyle(n).objectPosition),/round/);
  const original=await content(p);await b(p,'裁切').click();assert.equal(await p.getByRole('button',{name:'完成',exact:true}).isVisible(),false);
  assert.match(await p.locator('#ppte-feedback').innerText(),/object-position.*暂无法解析/);assert.equal(await content(p),original);assert.equal(await p.evaluate(()=>(window as any).PPTeEditor.commands.undoStack.length),0);
 }finally{await browser.close();}
});
test('R03 clean nine-page delivery: latest runtime, unchanged source, offline reading/edit/no-op/download/reopen',async()=>{
 await mkdir(out,{recursive:true});const source=resolve('docs/usability-reset/evidence/U01/source/full-deck.html');const enhanced=await enhanceHTML(await readFile(source,'utf8'),{root:resolve('docs/usability-reset/evidence/U01/source'),base:resolve('docs/usability-reset/evidence/U01/source')});
 const file=join(out,'Cherry-Studio-开源之路.ppte.html');await writeFile(file,enhanced.html);const expected=readEnhanced(enhanced.html).content;
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});try{
  const p=await browser.newPage({offline:true,deviceScaleFactor:3,viewport:{width:1440,height:1000}});await p.addInitScript(()=>{(window as any).showOpenFilePicker=undefined;});await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeSave);
  assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-slide]').count(),9);assert.equal(await content(p),expected);assert.doesNotMatch(expected,/R03 fixture|定位夹具|交互诊断/);
  for(let i=0;i<9;i++){if(i)await b(p,'下一页').click();assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-slide]').nth(i).isVisible(),true);}
  for(let i=0;i<5;i++)await b(p,'上一页').click();await b(p,'编辑').click();const img=p.frameLocator('#ppte-frame').locator('img').filter({visible:true}).first();await img.click();await b(p,'裁切').click();await b(p,'完成').click();assert.equal(await content(p),expected);assert.equal(await p.evaluate(()=>(window as any).PPTeEditor.commands.undoStack.length),0);
  const event=p.waitForEvent('download');await b(p,'下载更新后的文件').click();const saved=join(out,'clean-reopened.html');await(await event).saveAs(saved);assert.equal(readEnhanced(await readFile(saved,'utf8')).content,expected);
  await p.goto(pathToFileURL(saved).href);await p.waitForFunction(()=>!!(window as any).PPTeSave);assert.equal(await content(p),expected);await p.screenshot({path:join(out,'clean-delivery.png'),caret:'initial'});
 }finally{await browser.close();}
});

test('R03 DPR 1 raster regression: repeated no-op crops and fresh download reopen remain byte-identical',async()=>{
 const {browser,p}=await setup('dpr1-regression','contain','25% 75%',1);let fresh;
 try{
  const original=await content(p);await b(p,'阅读').click();const before=await imageRaster(image(p)),bounds=await image(p).boundingBox();
  await writeFile(join(out,'dpr1-before.png'),before);
  for(let i=0;i<3;i++){
   await b(p,'编辑').click();await image(p).click();await b(p,'裁切').click();await p.screenshot({caret:'initial'});await b(p,'完成').click();await b(p,'阅读').click();
   const after=await imageRaster(image(p));await writeFile(join(out,'dpr1-after.png'),after);
   assert.deepEqual(await image(p).boundingBox(),bounds);assert.deepEqual(after,before);assert.equal(await content(p),original);
   assert.equal(await p.evaluate(()=>(window as any).PPTeEditor.commands.undoStack.length),0);
  }
  await b(p,'编辑').click();const event=p.waitForEvent('download');await b(p,'下载更新后的文件').click();const file=join(out,'dpr1-downloaded.html');await(await event).saveAs(file);
  assert.equal(readEnhanced(await readFile(file,'utf8')).content,original);await browser.close();
  fresh=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});const q=await fresh.newPage({offline:true,deviceScaleFactor:1,viewport:{width:1440,height:1000}});
  await q.goto(pathToFileURL(file).href);await q.waitForFunction(()=>!!(window as any).PPTeSave);assert.equal(await content(q),original);assert.deepEqual(await image(q).boundingBox(),bounds);assert.deepEqual(await imageRaster(image(q)),before);
 }finally{await browser.close();await fresh?.close();}
});
