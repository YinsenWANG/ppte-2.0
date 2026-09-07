import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium,type Page} from 'playwright';
import {enhanceHTML,readEnhanced} from '../packages/html-document/src/index.js';
import {resizeViewport} from './helpers/browser-viewport.js';
const out=resolve('artifacts/r8-R3');
const frame=(p:Page)=>p.frameLocator('#ppte-frame');
async function setup(name:string,source:string){
 await mkdir(out,{recursive:true});const file=join(out,name+'.ppte.html');await writeFile(file,(await enhanceHTML(source,{root:out,base:out})).html);
 const browser=await chromium.launch({channel:'chrome',headless:true});const p=await browser.newPage({offline:true,acceptDownloads:true,viewport:{width:1440,height:960}});
 const errors:string[]=[],network:string[]=[];p.on('pageerror',e=>errors.push(String(e)));p.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
 await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeEditor);
 return {p,browser,async close(){await browser.close();assert.deepEqual(errors,[]);assert.deepEqual(network,[]);}};
}
async function geometry(p:Page){return p.evaluate(()=>{
 const f=document.querySelector<HTMLIFrameElement>('#ppte-frame')!,a=document.querySelector<HTMLElement>('#ppte-edit-canvas')!,r=a.getBoundingClientRect(),b=f.getBoundingClientRect(),scale=b.width/f.clientWidth;
 const slides=Array.from(f.contentDocument!.querySelectorAll<HTMLElement>('[data-ppte-slide]')).map(n=>{const q=n.getBoundingClientRect();return {visible:getComputedStyle(n).display!=='none',native:q.toJSON(),screen:{x:b.x+q.x*scale,y:b.y+q.y*scale,width:q.width*scale,height:q.height*scale}};});
 return {area:r.toJSON(),slides,scale,scroll:{x:a.scrollLeft,y:a.scrollTop,width:a.scrollWidth,height:a.scrollHeight},documentScroll:{x:scrollX,y:scrollY}};
 });}
async function fitted(p:Page,index:number){const g=await geometry(p);assert.deepEqual(g.slides.map(n=>n.visible),g.slides.map((_,i)=>i===index));const s=g.slides[index].screen,a=g.area;
 assert.ok(s.x>=a.x+10&&s.y>=a.y+10,JSON.stringify(g));assert.ok(s.x+s.width<=a.right-10&&s.y+s.height<=a.bottom-10,JSON.stringify(g));
 assert.ok(Math.abs(s.x+s.width/2-(a.x+a.width/2))<1);assert.ok(Math.abs(s.y+s.height/2-(a.y+a.height/2))<1);assert.deepEqual(g.documentScroll,{x:0,y:0});return g;
}
const audit=()=>readFile('docs/audits/2026-09-07-ui-d96f211/sample/source.html','utf8');
test('R3 current page fits with padding through inspector, rail, viewport changes, mouse/keyboard navigation and modes',async()=>{
 const f=await setup('audit',await audit()),p=f.p;try{
 await p.getByRole('button',{name:'编辑',exact:true}).click();await fitted(p,0);
 await frame(p).locator('[data-id=title1]').click();const wide=await fitted(p,0);
 await p.screenshot({path:join(out,'product-1440.png')});
 await p.getByRole('button',{name:'关闭属性',exact:true}).click();assert.ok((await fitted(p,0)).scale>wide.scale);
 await p.getByRole('button',{name:'第 2 页',exact:true}).click();await fitted(p,1);
 await p.getByRole('button',{name:'第 3 页',exact:true}).focus();await p.keyboard.press('Enter');await fitted(p,2);
 await p.getByRole('button',{name:'阅读',exact:true}).click();assert.equal(await frame(p).locator('[data-ppte-slide]').nth(0).isVisible(),false);
 await p.getByRole('button',{name:'编辑',exact:true}).click();await fitted(p,2);
 await p.getByRole('button',{name:'放映',exact:true}).click();await p.keyboard.press('ArrowLeft');await p.keyboard.press('Escape');await fitted(p,1);
 await p.getByRole('button',{name:'上一页',exact:true}).click();await frame(p).locator('[data-id=title1]').click();
 await resizeViewport(p,{width:1024,height:768});const medium=await fitted(p,0);await p.screenshot({path:join(out,'product-1024.png')});
 await p.getByRole('button',{name:'关闭属性',exact:true}).click();await resizeViewport(p,{width:390,height:844});const small=await fitted(p,0);await p.screenshot({path:join(out,'product-390.png')});
 // R5 owns the small-screen inspector occlusion. Capture it honestly as pending.
 await p.getByRole('button',{name:'页面设置',exact:true}).click();await p.screenshot({path:join(out,'product-390-inspector-pending-R5.png')});
 await writeFile(join(out,'geometry.json'),JSON.stringify({wide,medium,small,smallInspector:'pending R5: overlay remains',browser:f.browser.version()},null,2));
 }finally{await f.close();}
});
test('R3 manual zoom scrolls only the current work area, reset fits; real drag/resize keep author units',async()=>{
 const f=await setup('zoom',await audit()),p=f.p;try{
 await p.getByRole('button',{name:'编辑',exact:true}).click();await p.getByRole('button',{name:'页面设置',exact:true}).click();
 for(let i=0;i<5;i++)await p.getByRole('button',{name:'放大画布',exact:true}).click();
 const before=await geometry(p);assert.ok(before.scroll.width>before.area.width);
 const s=before.slides[0].screen;await p.mouse.move(Math.max(before.area.x+30,s.x+30),before.area.y+100);await p.mouse.wheel(200,120);await p.waitForFunction(()=>document.querySelector('#ppte-edit-canvas')!.scrollLeft>0);
 const after=await geometry(p);assert.ok(after.scroll.x>0);assert.deepEqual(after.slides.map(n=>n.visible),[true,false,false]);assert.deepEqual(after.documentScroll,{x:0,y:0});
 await p.getByRole('button',{name:'重置缩放',exact:true}).click();await fitted(p,0);
 await p.getByRole('button',{name:'插入',exact:true}).click();await p.getByRole('menuitem',{name:'形状',exact:true}).click();await p.getByRole('menuitem',{name:'矩形',exact:true}).click();
 const obj=frame(p).locator('[data-ppte-kind=shape]');await obj.click();const old=await obj.evaluate(n=>n.getBoundingClientRect().toJSON()),scale=(await geometry(p)).scale;
 const b=(await obj.boundingBox())!;await p.mouse.move(b.x+b.width/2,b.y+b.height/2);await p.mouse.down();await p.mouse.move(b.x+b.width/2+16*scale,b.y+b.height/2);await p.mouse.up();
 assert.ok(Math.abs(await obj.evaluate(n=>n.getBoundingClientRect().x)-old.x-16)<1);
 const handle=p.getByRole('button',{name:'调整对象大小',exact:true}),h=(await handle.boundingBox())!;
 await p.mouse.move(h.x+h.width/2,h.y+h.height/2);await p.mouse.down();await p.mouse.move(h.x+h.width/2+16*scale,h.y+h.height/2+8*scale);await p.mouse.up();
 assert.ok(Math.abs(await obj.evaluate(n=>n.getBoundingClientRect().width)-old.width-16)<1);
 await p.getByRole('button',{name:'撤销',exact:true}).click();assert.equal(await obj.evaluate(n=>n.getBoundingClientRect().width),old.width);
 }finally{await f.close();}
});
test('R3 responsive author CSS reflows on window resize; transient fits do not change saved layouts; download/new-process reopen',async()=>{
 const source='<style>body{margin:0}.slide{width:90vw;min-height:60vh;display:grid;grid-template-columns:1fr 1fr;padding:20px;box-sizing:border-box;background:white}.copy{display:flex;flex-direction:column}h1{font-size:28px}@media(max-width:800px){.slide{grid-template-columns:1fr}h1{font-size:18px}}</style><section class="slide" data-ppte-slide><h1 id="title">Responsive author</h1><div class="copy"><p>Flexible copy</p><p>Second paragraph</p></div></section><section class="slide" data-ppte-slide><h1>Second page</h1></section>';
 const f=await setup('responsive',source),p=f.p;try{
 const original=await p.evaluate(()=>(window as any).PPTeHTML.content());
 await p.getByRole('button',{name:'编辑',exact:true}).click();await fitted(p,0);
 const measure=()=>frame(p).locator('.slide').first().evaluate(n=>({width:n.getBoundingClientRect().width,columns:getComputedStyle(n).gridTemplateColumns,font:getComputedStyle(n.querySelector('h1')!).fontSize,child:getComputedStyle(n.querySelector('.copy')!).display}));
 const wide=await measure();assert.equal(wide.width,1296);assert.equal(wide.child,'flex');
 await frame(p).locator('#title').click();assert.deepEqual(await measure(),wide);
 await p.getByRole('button',{name:'关闭属性',exact:true}).click();await resizeViewport(p,{width:700,height:800});await fitted(p,0);
 const small=await measure();assert.equal(small.width,630);assert.equal(small.font,'18px');assert.equal(small.columns.split(' ').length,1);
 assert.equal(await p.evaluate(()=>(window as any).PPTeHTML.content()),original);
 await frame(p).locator('#title').click();await frame(p).locator('#title').dblclick();await p.keyboard.press('ControlOrMeta+a');await p.keyboard.insertText('Saved responsive edit');assert.equal(await frame(p).locator('#title').textContent(),'Saved responsive edit');await p.getByRole('button',{name:'阅读',exact:true}).click();
 const event=p.waitForEvent('download');await p.getByRole('button',{name:'下载更新后的文件',exact:true}).click();const saved=join(out,'responsive-saved.ppte.html');await(await event).saveAs(saved);
 const content=readEnhanced(await readFile(saved,'utf8')).content;assert.doesNotMatch(content,/data-ppte-transient|position:fixed!important|contenteditable/);assert.match(content,/90vw/);
 const fresh=await chromium.launch({channel:'chrome',headless:true});try{const q=await fresh.newPage({offline:true,viewport:{width:1440,height:960}});await q.goto(pathToFileURL(saved).href);await q.waitForFunction(()=>!!(window as any).PPTeEditor);assert.equal(await frame(q).locator('#title').textContent(),'Saved responsive edit');await q.getByRole('button',{name:'编辑',exact:true}).click();await fitted(q,0);assert.equal(await frame(q).locator('.slide').first().evaluate(n=>n.getBoundingClientRect().width),1296);}finally{await fresh.close();}
 }finally{await f.close();}
});
test('R3 twelve-page audit source: current-page navigation and added page stay isolated and fitted',async()=>{
 const f=await setup('twelve',await readFile('docs/audits/2026-09-07-main-61310c7/sample/source.html','utf8')),p=f.p;try{
 await p.getByRole('button',{name:'编辑',exact:true}).click();await fitted(p,0);await p.getByRole('button',{name:'第 12 页',exact:true}).click();await fitted(p,11);
 await p.getByRole('button',{name:'添加页',exact:true}).click();await fitted(p,12);assert.equal(await frame(p).locator('[data-ppte-slide]').count(),13);
 }finally{await f.close();}
});
