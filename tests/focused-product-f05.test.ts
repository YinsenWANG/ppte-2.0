import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium,type Page} from 'playwright';
import {enhanceHTML} from '../packages/html-document/src/index.js';
import {resizeViewport} from './helpers/browser-viewport.js';
const out=resolve('artifacts/focused-product/F05');
const btn=(p:Page,name:string)=>p.getByRole('button',{name,exact:true});
async function open(long=false){
 await mkdir(out,{recursive:true});
 const source=await readFile('docs/audits/2026-09-07-main-d1db13d/sample/source.html','utf8');
 const input=long?'<title>F05 · 40 页长稿</title><style>body{margin:0}section{width:960px;height:540px;box-sizing:border-box;padding:48px;background:#faf9f4}h1{font:40px system-ui}</style>'+Array.from({length:40},(_,i)=>`<section data-ppte-slide><h1>长稿第 ${i+1} 页</h1><p>中文与 English · 保留作者内容</p></section>`).join(''):source;
 const file=join(out,long?'long.ppte.html':'Cherry-F05.ppte.html');await writeFile(file,(await enhanceHTML(input,{root:out,base:out,mediaTable:true})).html);
 const browser=await chromium.launch({channel:'chrome',headless:true});const p=await browser.newPage({offline:true,viewport:{width:1440,height:900}});
 p.setDefaultTimeout(10000);const errors:string[]=[],network:string[]=[];p.on('pageerror',e=>errors.push(String(e)));p.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
 await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeSave);
 return {p,browser,async close(){await browser.close();assert.deepEqual(errors,[]);assert.deepEqual(network,[]);}};
}
async function fits(p:Page,selector:string){
 for(const n of await p.locator(selector).all()){
  const r=await n.boundingBox();assert.ok(r);const v=p.viewportSize()!;
  assert.ok(r.x>=-1&&r.y>=-1&&r.x+r.width<=v.width+1&&r.y+r.height<=v.height+1,`${await n.getAttribute('aria-label')} ${JSON.stringify(r)}`);
 }
}
test('F05 A1/A2: scoped controls, no retired menu/gutter, honest PDF state, navigation endpoints and keyboard focus',async()=>{
 const f=await open(),p=f.p;try{
 const before=await p.evaluate(()=>(window as any).PPTeHTML.content());
 assert.equal(await p.locator('#ppte-save-ui [role=status]:visible').count(),0);
 assert.equal(await p.getByRole('button',{name:/^(更多|插入|版本历史|插入文本框|插入表格)$/}).count(),0);
 assert.equal(await btn(p,'上一页').isDisabled(),true);assert.equal(await btn(p,'下一页').isEnabled(),true);
 await btn(p,'展开缩略图').click();assert.equal(await p.locator('#ppte-page-list .thumb-row').first().evaluate(n=>getComputedStyle(n).paddingRight),'0px');
 assert.equal(await p.locator('#ppte-page-footer').isVisible(),false);
 await btn(p,'编辑').click();const toggle=btn(p,'页面导航');assert.equal(await toggle.getAttribute('aria-expanded'),'true');
 await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');await toggle.click();
 assert.equal(await btn(p,'撤销').isDisabled(),true);assert.equal(await btn(p,'重做').isDisabled(),true);
 for(const name of ['撤销','重做','上一页','导出为 PDF']){const s=await btn(p,name).evaluate(n=>({bg:getComputedStyle(n).backgroundColor,cursor:getComputedStyle(n).cursor}));assert.deepEqual(s,{bg:'rgb(243, 244, 246)',cursor:'not-allowed'});}
 assert.match(await btn(p,'导出为 PDF').getAttribute('title')??'',/未通过/);
 for(const name of ['撤销','重做'])assert.equal(await btn(p,name).locator('svg').getAttribute('viewBox'),'0 0 18 18');
 await btn(p,'插入图片').focus();await p.keyboard.press('Tab');await btn(p,'页面设置').focus();assert.equal(await btn(p,'页面设置').evaluate(n=>getComputedStyle(n).outlineStyle),'solid');await p.keyboard.press('Enter');
 await btn(p,'关闭属性').press('Escape');assert.equal(await btn(p,'页面设置').evaluate(n=>n===document.activeElement),true);
 for(let i=1;i<10;i++)await btn(p,'下一页').click();assert.equal(await btn(p,'下一页').isDisabled(),true);assert.equal(await btn(p,'上一页').isEnabled(),true);
 assert.equal(await p.evaluate(()=>(window as any).PPTeHTML.content()),before);
 await writeFile(join(out,'controls.json'),JSON.stringify({browser:f.browser.version(),headless:true,offline:true,noContentMutation:true,endpointStates:true,focus:true,pdf:'disabled; no qualified route'},null,2));
 }finally{await f.close();}
});
test('F05 A1/A2/A3: same Cherry draft at 1440/1024/390, unclipped centered page, inspector, save status and pure presentation',async()=>{
 const f=await open(),p=f.p;const rows:unknown[]=[];try{
 for(const width of [1440,1024,390]){
  await resizeViewport(p,{width,height:900});await btn(p,'阅读').click();await p.screenshot({caret:'initial',path:join(out,`read-${width}.png`)});
  await fits(p,'#ppte-save-ui button:visible,#ppte-canvas-controls button:visible');
  await btn(p,'编辑').click();await p.frameLocator('#ppte-frame').locator('h1').first().click();
  const g=await p.evaluate(()=>{
   const a=document.querySelector('#ppte-edit-canvas')!.getBoundingClientRect(),panel=document.querySelector('#ppte-properties')!.getBoundingClientRect();
   const f=document.querySelector<HTMLIFrameElement>('#ppte-frame')!,r=f.getBoundingClientRect(),s=f.contentDocument!.querySelector('[data-ppte-slide]')!.getBoundingClientRect(),scale=r.width/f.offsetWidth;
   return {area:a.toJSON(),panel:panel.toJSON(),page:{left:r.left+s.left*scale,right:r.left+s.right*scale,top:r.top+s.top*scale,bottom:r.top+s.bottom*scale}};
  });
  assert.ok(g.page.left>=g.area.left-1&&g.page.right<=g.area.right+1&&g.page.top>=g.area.top-1&&g.page.bottom<=g.area.bottom+1,JSON.stringify(g));
  assert.ok(Math.abs((g.page.left+g.page.right)-(g.area.left+g.area.right))<=2,'page centered in usable workspace');
  if(width===390){assert.ok(g.area.bottom<=g.panel.top+1);assert.ok(g.panel.height<=310);}
  else assert.ok(g.area.right<=g.panel.left+1);
  await fits(p,'#ppte-save-ui button:visible,#ppte-edit-toolbar button:visible,#ppte-canvas-controls button:visible');
  await p.screenshot({caret:'initial',path:join(out,`edit-${width}.png`)});
  await btn(p,'字号 ＋').click();assert.equal(await p.locator('#ppte-save-ui [role=status]:visible').count(),1);
  await p.locator('#ppte-save-panel summary').click();await p.waitForFunction(()=>document.querySelector('#ppte-save-panel summary')?.getAttribute('aria-expanded')==='true');await fits(p,'#ppte-save-panel > div');assert.match(await p.locator('.save-detail').innerText(),/尚未写入/);
  await p.screenshot({caret:'initial',path:join(out,`save-${width}.png`)});await p.keyboard.press('Escape');
  await btn(p,'关闭属性').click();await btn(p,'撤销').click();
  await btn(p,'放映').click();assert.equal(await p.locator('#ppte-save-ui').isVisible(),false);assert.equal(await p.locator('#ppte-canvas-controls').isVisible(),false);await p.keyboard.press('Escape');
  rows.push({width,...g});
 }
 await writeFile(join(out,'responsive.json'),JSON.stringify({browser:f.browser.version(),headless:true,rows},null,2));
 }finally{await f.close();}
});
test('F05 A3: 40-page rail scrolls independently; last page/add footer and keyboard reorder remain reachable at desktop and narrow width',async()=>{
 const f=await open(true),p=f.p;const rows:unknown[]=[];try{
 for(const width of [1440,390]){
  await resizeViewport(p,{width,height:900});await btn(p,'阅读').click();await btn(p,'编辑').click();
  if(!await p.locator('#ppte-pages').isVisible())await btn(p,'页面导航').click();
  const count=await p.frameLocator('#ppte-frame').locator('[data-ppte-slide]').count();const last=btn(p,`第 ${count} 页`);await last.scrollIntoViewIfNeeded();await last.click();
  const geometry=await p.evaluate(()=>{const list=document.querySelector('#ppte-page-list')!,footer=document.querySelector('#ppte-page-footer')!;return {scrollTop:list.scrollTop,scrollHeight:list.scrollHeight,height:list.clientHeight,list:list.getBoundingClientRect().toJSON(),footer:footer.getBoundingClientRect().toJSON(),bodyScroll:scrollY};});
  assert.ok(geometry.scrollTop>0);assert.ok(geometry.scrollHeight>geometry.height);assert.ok(geometry.list.bottom<=geometry.footer.top+1);assert.equal(geometry.bodyScroll,0);await fits(p,'#ppte-page-footer button');
  await last.press('Alt+ArrowUp');assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-slide]').nth(count-2).isVisible(),true);
  await btn(p,'添加页').click();assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-slide]').count(),count+1);
  await p.screenshot({caret:'initial',path:join(out,`long-${width}.png`)});await btn(p,'撤销').click();await p.waitForFunction(count=>document.querySelector<HTMLIFrameElement>('#ppte-frame')!.contentDocument!.querySelectorAll('[data-ppte-slide]').length===count,count);assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-slide]').count(),count);rows.push({width,...geometry});
 }
 await writeFile(join(out,'long.json'),JSON.stringify({browser:f.browser.version(),headless:true,rows},null,2));
 }finally{await f.close();}
});
