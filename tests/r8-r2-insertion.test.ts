import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Page } from 'playwright';
import { enhanceHTML, readEnhanced } from '../packages/html-document/src/index.js';
const out = resolve('artifacts/r8-R2');
const frame = (p: Page) => p.frameLocator('#ppte-frame');
const selected = (p: Page) => frame(p).locator('[data-ppte-editor-selected]');
const kinds = ['text', 'image', 'shape', 'table'] as const;
type Kind = typeof kinds[number];
async function setup(name: string, source: string) {
 await mkdir(out, {recursive:true}); const file = join(out, name+'.ppte.html');
 await writeFile(file, (await enhanceHTML(source, {root:out,base:out})).html);
 const browser = await chromium.launch({channel:'chrome',headless:true});
 const p = await browser.newPage({offline:true,acceptDownloads:true,viewport:{width:1440,height:960}});
 const errors: string[] = [], network: string[] = [];
 p.on('pageerror', e => errors.push(String(e))); p.on('request', r => {if (/^https?:/.test(r.url())) network.push(r.url());});
 await p.goto(pathToFileURL(file).href); await p.waitForFunction(() => !!(window as any).PPTeEditor);
 await p.getByRole('button',{name:'编辑',exact:true}).click();
 return {p,browser,async close(){await browser.close();assert.deepEqual(errors,[]);assert.deepEqual(network,[]);}};
}
async function insert(p: Page, kind: Kind, succeeds = true) {
 const png = kind === 'image' ? await readFile('docs/audits/2026-09-07-ui-d96f211/evidence/product-read.png') : null;
 await p.getByRole('button',{name:'插入',exact:true}).click();
 if (kind === 'image') {
  const chooser = p.waitForEvent('filechooser'); await p.getByRole('menuitem',{name:'图片',exact:true}).click();
  await (await chooser).setFiles({name:'local.png',mimeType:'image/png',buffer:png!});
  if (succeeds) await frame(p).locator('img[data-ppte-editor-selected]').waitFor();
 } else {
  await p.getByRole('menuitem',{name:{text:'文本框',shape:'形状',table:'表格'}[kind],exact:true}).click();
  if (kind !== 'text') await p.getByRole('menuitem',{name:kind==='table'?'2 行 2 列':'矩形',exact:true}).click();
 }
}
async function property(p:Page,label:string,value:string){const input=p.getByLabel(label,{exact:true});if(!await input.isVisible())await p.locator('#ppte-properties summary').filter({hasText:'位置与布局'}).click();if(await input.evaluate(n=>n.tagName)==='SELECT')await input.selectOption(value);else{await input.fill(value);await input.press('Tab');}}
async function clickObject(p: Page, object: ReturnType<ReturnType<typeof frame>['locator']>, kind: Kind) {
 await object.click();
 if (kind === 'table') await p.getByRole('button',{name:'选择整个表格',exact:true}).click();
}
async function authors(p: Page) {return frame(p).locator('[data-id]').evaluateAll(ns=>ns.map(n=>{const c=n.cloneNode(true) as Element;for(const e of [c,...Array.from(c.querySelectorAll('*'))])for(const a of Array.from(e.attributes))if(a.name==='contenteditable'||a.name==='tabindex'||a.name.startsWith('data-ppte-editor-'))e.removeAttribute(a.name);return c.outerHTML;}));}
async function geometry(p: Page) {return selected(p).evaluate(n => {
 const r=n.getBoundingClientRect(), slide=n.closest('[data-ppte-slide]')!.getBoundingClientRect();
 const text=Array.from(n.ownerDocument.querySelectorAll('[data-id]')).filter(e=>e.textContent?.trim()&&!e.querySelector('svg'));
 return {rect:r.toJSON(),inside:r.left>=slide.left&&r.top>=slide.top&&r.right<=slide.right&&r.bottom<=slide.bottom,
 overlaps:text.filter(e=>{const b=e.getBoundingClientRect();return r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top;}).map(e=>e.getAttribute('data-id'))};
 });}
for (const kind of kinds) test(`R2 audit ${kind}: mouse insertion/selection, actual Alt+Right, resize, undo/redo and offline download/new-process reopen`, async () => {
 const f=await setup('audit-'+kind,await readFile('docs/audits/2026-09-07-ui-d96f211/sample/source.html','utf8')),p=f.p;
 try {
  const author=await authors(p);
  await frame(p).locator('[data-id=title1]').click(); await insert(p,kind);
  const selector={text:'[data-ppte-kind=text]',shape:'[data-ppte-kind=shape]',image:'img',table:'table'}[kind];
  const object=frame(p).locator(selector).first(); await object.waitFor();
  const id=await object.getAttribute('data-ppte-id'); assert.ok(id);
  // Cell click followed by the labeled table selection action is a real mouse path.
  await clickObject(p,object,kind);
  assert.equal(await selected(p).getAttribute('data-ppte-id'),id);
  const before=await geometry(p); assert.equal(before.inside,true); assert.deepEqual(before.overlaps,[]);
  assert.equal(await object.evaluate(n=>getComputedStyle(n).position),'absolute');
  await p.keyboard.press('Alt+ArrowRight'); const moved=await geometry(p);
  assert.equal(moved.rect.x,before.rect.x+8); assert.equal(moved.rect.y,before.rect.y); assert.deepEqual(moved.overlaps,[]);
  await p.getByRole('button',{name:'撤销',exact:true}).click(); assert.equal((await geometry(p)).rect.x,before.rect.x);
  await p.getByRole('button',{name:'重做',exact:true}).click(); assert.equal((await geometry(p)).rect.x,moved.rect.x);
  await property(p,'宽度',`${before.rect.width-8}px`);assert.equal((await geometry(p)).rect.width,before.rect.width-8);
  if(kind==='text'){await object.dblclick();await p.keyboard.press('ControlOrMeta+a');await p.keyboard.insertText('R2 可调整文字');await p.getByRole('button',{name:'插入',exact:true}).click();await p.keyboard.press('Escape');}
  if(kind==='table'){await object.locator('td').first().click();await p.keyboard.press('ControlOrMeta+a');await p.keyboard.insertText('R2 单元格');}
  // No author layout or text mutation is allowed as an insertion side effect.
  const cleanAuthors=await frame(p).locator('[data-id]').evaluateAll(ns=>ns.map(n=>{const c=n.cloneNode(true) as Element;for(const e of [c,...Array.from(c.querySelectorAll('*'))])for(const a of Array.from(e.attributes))if(a.name==='contenteditable'||a.name==='tabindex'||a.name.startsWith('data-ppte-editor-'))e.removeAttribute(a.name);return c.outerHTML;}));
  assert.deepEqual(cleanAuthors,author);
  await p.screenshot({path:join(out,kind+'.png'),caret:'initial'});
  const event=p.waitForEvent('download');await p.getByRole('button',{name:'下载更新后的文件',exact:true}).click();const saved=join(out,kind+'-saved.ppte.html');await(await event).saveAs(saved);
  const content=readEnhanced(await readFile(saved,'utf8')).content;assert.doesNotMatch(content,/contenteditable|data-ppte-editor-/);
  const style=await object.getAttribute('style'),text=await object.textContent(),src=await object.getAttribute('src');
  const fresh=await chromium.launch({channel:'chrome',headless:true});try{
   const q=await fresh.newPage({offline:true,viewport:{width:1440,height:960}});await q.goto(pathToFileURL(saved).href);await q.waitForFunction(()=>!!(window as any).PPTeEditor);
   const reopened=frame(q).locator(`[data-ppte-id="${id}"]`);assert.equal(await reopened.getAttribute('style'),style);assert.equal(await reopened.textContent(),text);assert.equal(await reopened.getAttribute('src'),src);
   await q.getByRole('button',{name:'编辑',exact:true}).click();await clickObject(q,reopened,kind);const x=(await geometry(q)).rect.x;await q.keyboard.press('Alt+ArrowRight');assert.equal((await geometry(q)).rect.x,x+8);
  }finally{await fresh.close();}
  await writeFile(join(out,kind+'.json'),JSON.stringify({kind,browser:f.browser.version(),before,moved,authorUnchanged:true,downloadReopen:true},null,2));
 }finally{await f.close();}
});
const flowSource=(display:string)=>`<style>body{margin:0}section{padding:40px;min-height:700px}.content{display:${display};${display==='flex'?'flex-direction:column;':display==='grid'?'grid-template-columns:1fr;':''}gap:16px;width:700px}p{margin:12px 0}</style><section data-ppte-slide><div class="content"><p id="first">First author paragraph</p><p id="last">Last author paragraph</p></div></section>`;
for(const display of ['block','flex','grid']) test(`R2 ${display}: all four types use real order, spacing/alignment and retain native layout after download`,async()=>{
 const f=await setup(display,flowSource(display)),p=f.p;try{
  for(const kind of kinds){
   await frame(p).locator('#first').click();await insert(p,kind);const obj=selected(p);await obj.waitFor();const id=await obj.getAttribute('data-ppte-id');assert.ok(id);assert.notEqual(await obj.evaluate(n=>getComputedStyle(n).position),'absolute');assert.equal(await obj.evaluate(n=>n.parentElement!.className),'content');
   await clickObject(p,frame(p).locator(`[data-ppte-id="${id}"]`),kind);const oldY=await obj.evaluate(n=>n.getBoundingClientRect().y);await p.keyboard.press('Alt+ArrowDown');
   assert.ok(await obj.evaluate(n=>n.getBoundingClientRect().y)>oldY,'real order operation changes rendered position');
   if(display==='block'){assert.equal(await obj.evaluate(n=>n.previousElementSibling?.id),'last');await p.getByRole('button',{name:'撤销',exact:true}).click();assert.equal(await obj.evaluate(n=>n.previousElementSibling?.id),'first');await p.getByRole('button',{name:'重做',exact:true}).click();await property(p,'宽度','280px');await p.getByRole('button',{name:'对象居中',exact:true}).click();assert.ok(await obj.evaluate(n=>n.getBoundingClientRect().left>n.parentElement!.getBoundingClientRect().left));}
   else {await property(p,'容器内对齐','center');assert.equal(await obj.evaluate(n=>getComputedStyle(n).alignSelf),'center');}
   await property(p,'外边距','16px');assert.equal(await obj.evaluate(n=>getComputedStyle(n).marginTop),'16px');
   const event=p.waitForEvent('download');await p.getByRole('button',{name:'下载更新后的文件',exact:true}).click();const saved=join(out,`${display}-${kind}-saved.ppte.html`);await(await event).saveAs(saved);const style=await obj.getAttribute('style');
   await p.goto(pathToFileURL(saved).href);await p.waitForFunction(()=>!!(window as any).PPTeEditor);await p.getByRole('button',{name:'编辑',exact:true}).click();const reopened=frame(p).locator(`[data-ppte-id="${id}"]`);assert.equal(await reopened.getAttribute('style'),style);assert.equal(await reopened.evaluate(n=>getComputedStyle(n.parentElement!).display),display);await clickObject(p,reopened,kind);await p.getByRole('button',{name:'删除对象',exact:true}).click();
  }
 }finally{await f.close();}
});
test('R2 no available space: each menu insertion rolls back DOM and undo history with an accurate visible error',async()=>{
 const source='<style>body{margin:0}section{position:relative;width:480px;height:360px;overflow:hidden}#full{position:absolute;inset:0;background:white;font:30px system-ui}</style><section data-ppte-slide><div id="full">All this text area is occupied</div></section>';
 const f=await setup('no-space',source),p=f.p;try{
  await frame(p).locator('#full').click();
  const before=await frame(p).locator('[data-ppte-slide]').innerHTML();
  for(const kind of kinds){await insert(p,kind,false);await p.locator('#ppte-feedback').filter({hasText:'插入已撤销'}).waitFor();assert.match(await p.locator('#ppte-feedback').innerText(),/没有足够空白/);assert.equal(await frame(p).locator('[data-ppte-slide]').innerHTML(),before);assert.equal(await p.getByRole('button',{name:'撤销',exact:true}).isDisabled(),true);}
 }finally{await f.close();}
});
test('R2 native media wrapper and mixed text: insert beside the canvas object, and protect non-heading direct text',async()=>{
 const source=await readFile('docs/audits/2026-09-07-ui-d96f211/sample/source.html','utf8');
 const f=await setup('media-wrapper',source),p=f.p;try{
  await frame(p).locator('[data-id=art1] svg').click();await insert(p,'text');
  assert.equal(await selected(p).evaluate(n=>n.parentElement!.hasAttribute('data-ppte-slide')),true);
  assert.deepEqual((await geometry(p)).overlaps,[]);
  await selected(p).click();const before=(await geometry(p)).rect.x;await p.keyboard.press('Alt+ArrowRight');assert.equal((await geometry(p)).rect.x,before+8);
 }finally{await f.close();}
 const mixed='<style>body{margin:0}section{position:relative;width:720px;height:540px;overflow:hidden}#mixed{position:absolute;left:40px;top:40px;width:640px;height:80px;font:28px system-ui}#anchor{position:absolute;left:40px;top:160px;width:300px}</style><section data-ppte-slide><div id="mixed">Direct mixed text <svg width="20" height="20"><circle cx="10" cy="10" r="8"/></svg></div><div id="anchor">Reference text</div></section>';
 const g=await setup('mixed-text',mixed);try{
  await frame(g.p).locator('#anchor').click();await insert(g.p,'image');await selected(g.p).click();
  assert.equal(await selected(g.p).evaluate(n=>{const a=n.getBoundingClientRect(),d=n.ownerDocument,r=d.createRange();r.selectNodeContents(d.querySelector('#mixed')!.firstChild!);return Array.from(r.getClientRects()).every(b=>a.left>=b.right||a.right<=b.left||a.top>=b.bottom||a.bottom<=b.top);}),true);
 }finally{await g.close();}
});
