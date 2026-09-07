import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium,type Page} from 'playwright';
import {enhanceHTML} from '../packages/html-document/src/index.js';
import {resizeViewport} from './helpers/browser-viewport.js';
const out=resolve('artifacts/r8-R5');
async function geometry(p:Page){return p.evaluate(()=>{
 const rect=(s:string)=>document.querySelector(s)!.getBoundingClientRect().toJSON();
 const f=document.querySelector<HTMLIFrameElement>('#ppte-frame')!,r=f.getBoundingClientRect(),s=f.contentDocument!.querySelector('[data-ppte-slide]')!.getBoundingClientRect(),scale=r.width/f.offsetWidth;
 return {width:innerWidth,height:innerHeight,area:rect('#ppte-edit-canvas'),panel:rect('#ppte-properties'),page:{left:r.left+s.left*scale,top:r.top+s.top*scale,right:r.left+s.right*scale,bottom:r.top+s.bottom*scale,width:s.width*scale,height:s.height*scale},inert:f.inert};
});}
test('R5: mobile inspector reserves visible current page, closes by mouse/Escape, navigation is exclusive, primary controls remain reachable',async()=>{
 await mkdir(out,{recursive:true});const source=await readFile('docs/audits/2026-09-07-ui-d96f211/sample/source.html','utf8');const file=join(out,'sample.ppte.html');await writeFile(file,(await enhanceHTML(source,{root:out,base:out})).html);
 const b=await chromium.launch({channel:'chrome',headless:true}),p=await b.newPage({offline:true,viewport:{width:1440,height:960}});const errors:string[]=[],network:string[]=[];p.on('pageerror',e=>errors.push(String(e)));p.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
 try{await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeEditor);await p.getByRole('button',{name:'编辑',exact:true}).click();const title=p.frameLocator('#ppte-frame').locator('[data-id=title1]');await title.click();
 await resizeViewport(p,{width:390,height:844});const initial=await geometry(p);await writeFile(join(out,'geometry.json'),JSON.stringify(initial,null,2));await p.screenshot({path:join(out,'selected-390.png')});
 for(const height of [844,600]){await resizeViewport(p,{width:390,height});const g=await geometry(p);assert.ok(g.panel.height<=310,JSON.stringify(g));assert.ok(g.area.bottom<=g.panel.top+1,JSON.stringify(g));assert.ok(g.page.top>=g.area.top&&g.page.bottom<=g.area.bottom+1);assert.ok(g.page.left>=0&&g.page.right<=390);assert.ok(g.page.height>=90&&g.page.width>=160,'actual page has useful visible area');assert.equal(g.inert,false);
 // Hit-test the visible page, then apply a style through a real inspector click.
 await title.click();const fontBefore=parseFloat(await title.evaluate(n=>getComputedStyle(n).fontSize));await p.getByRole('button',{name:'字号 ＋',exact:true}).click();assert.equal(parseFloat(await title.evaluate(n=>getComputedStyle(n).fontSize)),fontBefore+2);
 await p.getByRole('button',{name:'关闭属性',exact:true}).click();assert.equal(await p.locator('#ppte-properties').isVisible(),false);assert.equal(await p.getByRole('button',{name:'页面设置',exact:true}).evaluate(n=>n===document.activeElement),true);
 await p.getByRole('button',{name:'页面设置',exact:true}).click();await p.getByRole('button',{name:'关闭属性',exact:true}).press('Escape');assert.equal(await p.locator('#ppte-properties').isVisible(),false);
 await p.getByRole('button',{name:'页面导航',exact:true}).click();assert.equal(await p.locator('#ppte-pages').isVisible(),true);assert.equal(await p.locator('#ppte-properties').isVisible(),false);
 await p.getByRole('button',{name:'第 2 页',exact:true}).click();assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-slide]').nth(1).isVisible(),true);
 await p.getByRole('button',{name:'页面设置',exact:true}).click();assert.equal(await p.locator('#ppte-pages').isVisible(),false);assert.equal(await p.locator('#ppte-properties').isVisible(),true);
 await p.getByRole('button',{name:'关闭属性',exact:true}).click();await p.getByRole('button',{name:'上一页',exact:true}).click();await title.click();
 }
 await resizeViewport(p,{width:390,height:844});await p.getByLabel('画布缩放选项',{exact:true}).click();await p.getByRole('button',{name:'放大画布',exact:true}).click();await p.getByRole('button',{name:'重置缩放',exact:true}).click();await p.keyboard.press('Escape');
 for(const n of await p.locator('#ppte-save-ui button:visible,#ppte-edit-toolbar button:visible,#ppte-canvas-controls button:visible').all()){const r=(await n.boundingBox())!;assert.ok(r.x>=0&&r.x+r.width<=391&&r.y>=0&&r.y+r.height<=845,await n.getAttribute('aria-label') ?? 'button');assert.ok(r.width>=44&&r.height>=44);}
 assert.deepEqual(errors,[]);assert.deepEqual(network,[]);await writeFile(join(out,'journey.json'),JSON.stringify({browser:b.version(),errors,network,status:'pass'},null,2));
 }finally{await b.close();}
});
