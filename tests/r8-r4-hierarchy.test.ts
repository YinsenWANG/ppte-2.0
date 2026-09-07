import { downloadUpdated } from './helpers/focused-product.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {enhanceHTML,readEnhanced} from '../packages/html-document/src/index.js';
import {resizeViewport} from './helpers/browser-viewport.js';
const out=resolve('artifacts/r8-R4');
test('R4 hierarchy: actual text controls, stable status, contextual page ordering, offline download and prototype comparisons',async()=>{
 await mkdir(out,{recursive:true});const source=await readFile('docs/audits/2026-09-07-ui-d96f211/sample/source.html','utf8');
 const file=join(out,'sample.ppte.html');await writeFile(file,(await enhanceHTML(source,{root:out,base:out})).html);
 const b=await chromium.launch({channel:'chrome',headless:true});const p=await b.newPage({offline:true,acceptDownloads:true,viewport:{width:1440,height:960}});const errors:string[]=[];p.on('pageerror',e=>errors.push(String(e)));
 try{await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeEditor);await p.getByRole('button',{name:'编辑',exact:true}).click();
 const title=p.frameLocator('#ppte-frame').locator('[data-id=title1]');await title.click();
 const bar=p.locator('#ppte-save-ui'),panel=p.locator('#ppte-properties');const before=await bar.boundingBox();assert.equal(before!.height,56);
 assert.equal(await p.locator('#ppte-edit-toolbar').evaluate(n=>n.getBoundingClientRect().height),46);
 assert.equal(await p.locator('#ppte-canvas-controls').evaluate(n=>n.getBoundingClientRect().height),36);
 assert.equal(await p.getByRole('button',{name:'放映',exact:true}).evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(82, 97, 216)');
 assert.equal(await panel.locator('details').first().getAttribute('open'),null);
 assert.equal(await panel.getByLabel('文字颜色',{exact:true}).getAttribute('type'),'color');
 await panel.getByLabel('字体',{exact:true}).selectOption('serif');assert.equal(await title.evaluate(n=>getComputedStyle(n).fontFamily),'serif');
 await panel.getByLabel('字号',{exact:true}).fill('48');await panel.getByLabel('字号',{exact:true}).press('Tab');assert.equal(await title.evaluate(n=>getComputedStyle(n).fontSize),'48px');
 await p.getByRole('button',{name:'字号 ＋',exact:true}).click();assert.equal(await title.evaluate(n=>getComputedStyle(n).fontSize),'50px');
 await p.getByRole('button',{name:'粗体',exact:true}).click();await p.getByRole('button',{name:'斜体',exact:true}).click();assert.equal(await title.evaluate(n=>getComputedStyle(n).fontStyle),'italic');
 await p.getByRole('button',{name:'右对齐',exact:true}).click();assert.equal(await title.evaluate(n=>getComputedStyle(n).textAlign),'right');
 await p.getByRole('button',{name:'叶绿色',exact:true}).click();assert.equal(await title.evaluate(n=>getComputedStyle(n).color),'rgb(83, 99, 72)');
 assert.equal((await bar.boundingBox())!.height,before!.height);
 const rows=await panel.getByRole('group',{name:'字号与强调',exact:true}).evaluate(n=>Array.from(n.querySelectorAll('button')).map(b=>b.getBoundingClientRect().y));assert.equal(new Set(rows).size,1);
 await panel.locator('summary').filter({hasText:'位置与布局'}).click();const height=await panel.getByLabel('高度',{exact:true}).inputValue();assert.doesNotMatch(height,/\d+\.\d{2,}px/);
 // Page actions are accessible through an actual menu; equivalent keyboard action restores order.
 assert.equal(await p.getByRole('menuitem',{name:'第 1 页下移',exact:true}).isVisible(),false);
 await p.getByTitle('第 1 页操作',{exact:true}).click();await p.getByRole('menuitem',{name:'第 1 页下移',exact:true}).click();
 assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-slide]').nth(1).locator('[data-id=title1]').count(),1);
 await p.getByRole('button',{name:'第 2 页',exact:true}).press('Alt+ArrowUp');assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-slide]').first().locator('[data-id=title1]').count(),1);
 // Capture the same unmodified author content as the approved prototype at all three widths.
 await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeEditor);await p.getByRole('button',{name:'编辑',exact:true}).click();await title.click();
 const geometry=[];
 for(const width of [1440,1024,390]){await resizeViewport(p,{width,height:width===390?844:960});await p.screenshot({path:join(out,`product-${width}.png`)});geometry.push(await p.evaluate(()=>({width:innerWidth,bar:document.querySelector('#ppte-save-ui')!.getBoundingClientRect().toJSON(),panel:document.querySelector('#ppte-properties')!.getBoundingClientRect().toJSON()})));}
 await resizeViewport(p,{width:1440,height:960});await p.getByRole('button',{name:'叶绿色',exact:true}).click();const download=p.waitForEvent('download');await downloadUpdated(p);const saved=join(out,'saved.ppte.html');await(await download).saveAs(saved);assert.match(readEnhanced(await readFile(saved,'utf8')).content,/rgb\(83, 99, 72\)/);
 const fresh=await b.newContext({offline:true});const q=await fresh.newPage();await q.goto(pathToFileURL(saved).href);await q.waitForFunction(()=>!!(window as any).PPTeEditor);assert.equal(await q.frameLocator('#ppte-frame').locator('[data-id=title1]').evaluate(n=>getComputedStyle(n).color),'rgb(83, 99, 72)');await fresh.close();
 await p.goto(pathToFileURL(resolve('docs/ui-redesign/UI_PROTOTYPE.html')).href);await p.getByRole('button',{name:'编辑',exact:true}).click();await p.locator('#slide [data-id=title1]').click();
 for(const width of [1440,1024,390]){await resizeViewport(p,{width,height:width===390?844:960});await p.screenshot({path:join(out,`prototype-${width}.png`)});}
 await writeFile(join(out,'hierarchy.json'),JSON.stringify({browser:b.version(),geometry,errors,smallInspector:'R5 geometry and interaction verified by r8-r5-mobile.test.ts'},null,2));assert.deepEqual(errors,[]);
 }finally{await b.close();}
});
