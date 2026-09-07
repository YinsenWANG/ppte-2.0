import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Page } from 'playwright';
import { enhanceHTML, readEnhanced } from '../packages/html-document/src/index.js';
const out=resolve('artifacts/r8-R1');
const frame=(p:Page)=>p.frameLocator('#ppte-frame');
async function setup(name:string, source:string){
 await mkdir(out,{recursive:true});const file=join(out,name+'.ppte.html');
 await writeFile(file,(await enhanceHTML(source,{root:out,base:out})).html);
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const p=await browser.newPage({offline:true,acceptDownloads:true,viewport:{width:1440,height:960}});
 const errors:string[]=[],network:string[]=[];p.on('pageerror',e=>errors.push(String(e)));p.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
 await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeEditor);
 await p.getByRole('button',{name:'编辑',exact:true}).click();
 return {p,browser,async close(){await browser.close();assert.deepEqual(errors,[]);assert.deepEqual(network,[]);}};
}
async function property(p:Page,label:string,value:string){await p.getByLabel(label,{exact:true}).fill(value);await p.getByLabel(label,{exact:true}).press('Tab');}
async function download(p:Page,name:string){const event=p.waitForEvent('download');await p.getByRole('button',{name:'下载更新后的文件',exact:true}).click();const file=join(out,name+'.ppte.html');await(await event).saveAs(file);return file;}
test('R1 audit native div: actual click, keyboard input, styles, undo/redo and offline download/new-process reopen',async()=>{
 const source=await readFile('docs/audits/2026-09-07-ui-d96f211/sample/source.html','utf8');
 const f=await setup('audit-source',source),p=f.p;
 try {
  const title=frame(p).locator('[data-id=title1]');const original=await title.textContent();
  await title.click();assert.equal(await title.getAttribute('contenteditable'),'true');assert.equal(await p.getByLabel('字号',{exact:true}).count(),1);
  await title.dblclick();await p.keyboard.press('End');await p.keyboard.insertText(' R1');
  assert.match(await title.textContent()??'',/ R1/);
  await p.getByRole('button',{name:'撤销',exact:true}).click();assert.equal(await title.textContent(),original);
  await p.getByRole('button',{name:'重做',exact:true}).click();const changed=await title.textContent();assert.match(changed??'',/ R1/);
  await title.click();await property(p,'字号','48px');assert.equal(await title.evaluate(n=>getComputedStyle(n).fontSize),'48px');
  await property(p,'文字颜色','#123456');assert.equal(await title.evaluate(n=>getComputedStyle(n).color),'rgb(18, 52, 86)');
  await p.getByRole('button',{name:'粗体',exact:true}).click();const weight=await title.evaluate(n=>getComputedStyle(n).fontWeight);
  await p.getByRole('button',{name:'撤销',exact:true}).click();assert.notEqual(await title.evaluate(n=>getComputedStyle(n).fontWeight),weight);
  await p.getByRole('button',{name:'重做',exact:true}).click();assert.equal(await title.evaluate(n=>getComputedStyle(n).fontWeight),weight);
  await p.screenshot({path:join(out,'native-text.png')});const saved=await download(p,'audit-edited');
  assert.doesNotMatch(readEnhanced(await readFile(saved,'utf8')).content,/contenteditable|data-ppte-editor-/);
  const fresh=await chromium.launch({channel:'chrome',headless:true});try{
   const q=await fresh.newPage({offline:true});await q.goto(pathToFileURL(saved).href);await q.waitForFunction(()=>!!(window as any).PPTeEditor);
   const t=frame(q).locator('[data-id=title1]');assert.equal(await t.textContent(),changed);assert.equal(await t.evaluate(n=>getComputedStyle(n).fontSize),'48px');assert.equal(await t.evaluate(n=>getComputedStyle(n).color),'rgb(18, 52, 86)');assert.equal(await t.evaluate(n=>getComputedStyle(n).fontWeight),weight);
   assert.equal(await q.locator('#ppte-save-ui').getAttribute('data-mode'),'read');await q.getByRole('button',{name:'编辑',exact:true}).click();await t.click();await q.keyboard.press('End');await q.keyboard.insertText(' reopened');assert.match(await t.textContent()??'',/reopened/);
  }finally{await fresh.close();}
 }finally{await f.close();}
});
const nested=`<style>body{margin:0}section{min-height:700px;padding:40px}.box{margin:20px;padding:20px;border:1px solid #ccc}.separate{position:absolute;left:280px;top:450px}</style><section data-ppte-slide>
<div id="rich" class="box">Native <span style="color:rgb(180,0,0)">red <strong>bold</strong></span> tail</div>
<span id="standalone">Standalone span</span>
<div id="mixed" class="box">Mixed container <span id="child">independent text</span><svg width="20" height="20"><circle cx="10" cy="10" r="8"/></svg></div>
<div id="blocks" class="box"><div id="block-text">Block text</div><div>Another object</div></div>
<div id="positioned" class="box">Layout <span class="separate">Positioned object</span></div>
<div id="declared" data-ppte-kind="text" class="box">Declaration with <span>inline text</span></div>
<div id="unsafe" data-ppte-kind="text" class="box">Unsafe declaration <svg width="20" height="20"><rect width="20" height="20"/></svg></div>
</section>`;
test('R1 native span and nested inline runs use one safe host; range style, input, undo and saved markup survive',async()=>{
 const f=await setup('nested',nested),p=f.p;
 try{
  const rich=frame(p).locator('#rich');await rich.locator('strong').click();assert.equal(await rich.getAttribute('data-ppte-editor-selected'),'');assert.equal(await rich.getAttribute('contenteditable'),'true');assert.equal(await rich.locator('span').getAttribute('contenteditable'),null);
  await p.keyboard.press('Tab');assert.equal(await frame(p).locator('#standalone').getAttribute('data-ppte-editor-selected'),'');await rich.locator('strong').click();
  const markup=await rich.innerHTML();await property(p,'字号','26px');assert.equal(await rich.innerHTML(),markup);assert.equal(await rich.locator('span').evaluate(n=>getComputedStyle(n).color),'rgb(180, 0, 0)');
  await rich.locator('strong').dblclick();await p.getByRole('button',{name:'蓝色',exact:true}).click();assert.equal(await rich.locator('strong').textContent(),'bold');assert.ok(await rich.evaluate(n=>Array.from(n.querySelectorAll('span')).some(s=>getComputedStyle(s).color==='rgb(51, 92, 255)')));
  await p.getByRole('button',{name:'撤销',exact:true}).click();assert.equal(await rich.innerHTML(),markup);
  await rich.locator('strong').click();await p.keyboard.press('End');await p.keyboard.insertText('!');assert.match(await rich.textContent()??'',/!/);await p.getByRole('button',{name:'撤销',exact:true}).click();assert.equal(await rich.innerHTML(),markup);
  const span=frame(p).locator('#standalone');await span.click();await p.keyboard.press('ControlOrMeta+a');await p.keyboard.insertText('Standalone span!');assert.equal(await span.textContent(),'Standalone span!');
  await frame(p).locator('#declared span').click();assert.equal(await frame(p).locator('#declared').getAttribute('data-ppte-editor-selected'),'');
  const saved=await download(p,'nested-saved');await p.goto(pathToFileURL(saved).href);await p.waitForFunction(()=>!!(window as any).PPTeEditor);await p.getByRole('button',{name:'编辑',exact:true}).click();assert.equal(await frame(p).locator('#rich').innerHTML(),markup);assert.equal(await frame(p).locator('#standalone').textContent(),'Standalone span!');
 }finally{await f.close();}
});
test('R1 mixed media/block/positioned/declared containers stay noneditable and explain unsupported text structure',async()=>{
 const f=await setup('boundaries',nested),p=f.p;try{
  for(const id of ['mixed','blocks','positioned','unsafe']){
   const n=frame(p).locator('#'+id);await n.click({position:{x:5,y:5}});
   assert.notEqual(await n.getAttribute('contenteditable'),'true');assert.equal(await p.getByLabel('字号',{exact:true}).count(),0);assert.match(await p.locator('#ppte-properties').innerText(),/此结构不支持整体文字编辑/);
  }
  await frame(p).locator('#child').click();assert.equal(await frame(p).locator('#child').getAttribute('data-ppte-editor-selected'),'');assert.equal(await p.getByLabel('字号',{exact:true}).count(),1);
  await frame(p).locator('#block-text').click();await p.keyboard.press('ControlOrMeta+a');await p.keyboard.insertText('Block text!');assert.equal(await frame(p).locator('#block-text').textContent(),'Block text!');assert.notEqual(await frame(p).locator('#blocks').getAttribute('contenteditable'),'true');
 }finally{await f.close();}
});
