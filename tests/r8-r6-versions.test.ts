import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium,type Page,type Locator} from 'playwright';
import {enhanceHTML,readEnhanced} from '../packages/html-document/src/index.js';
import {readHistory} from '../packages/html-document/src/history-wire.js';
import {Versions} from '../packages/html-editor/src/versions.js';
import {resizeViewport} from './helpers/browser-viewport.js';
const out=resolve('artifacts/r8-R6');
const click=(p:Page|Locator,name:string)=>p.getByRole('button',{name,exact:true}).click();
const state=(p:Page)=>p.evaluate(()=>JSON.stringify({wire:(window as any).PPTeHTML.versions.wire(),revision:(window as any).PPTeSave.revision,content:(window as any).PPTeHTML.content()}));
async function history(p:Page){await p.getByText('更多',{exact:true}).click();await p.getByRole('menuitem',{name:'版本历史',exact:true}).click();}
async function closed(p:Page){await p.locator('#ppte-version-form').waitFor({state:'detached'});}
async function focused(n:Locator){assert.equal(await n.evaluate(e=>e===e.ownerDocument.activeElement),true);}
async function manage(row:Locator){if(!await row.locator('details').evaluate(n=>(n as HTMLDetailsElement).open))await row.getByText('管理版本',{exact:true}).click();}
async function name(p:Page,value:string){await click(p,'保存命名版本');await p.getByLabel('版本名称',{exact:true}).fill(value);await click(p,'保存名称');await closed(p);}

test('R6: audit source mouse/keyboard naming, validation, cancellation, scoped confirmations, quota review, offline history round trip',async()=>{
 await mkdir(out,{recursive:true});const source=await readFile('docs/audits/2026-09-07-ui-d96f211/sample/source.html','utf8');const file=join(out,'sample.ppte.html');await writeFile(file,(await enhanceHTML(source,{root:out,base:out})).html);
 let b=await chromium.launch({channel:'chrome',headless:true});const nativeDialogs:string[]=[],errors:string[]=[],network:string[]=[];
 try{
 let p=await b.newPage({offline:true,acceptDownloads:true,viewport:{width:1440,height:960}});p.on('dialog',async d=>{nativeDialogs.push(d.type());await d.dismiss();});p.on('pageerror',e=>errors.push(String(e)));p.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
 await p.goto(pathToFileURL(file).href);await click(p,'编辑');await p.frameLocator('#ppte-frame').locator('[data-id=title1]').click();await history(p);
 const initial=await state(p);const create=p.getByRole('button',{name:'保存命名版本',exact:true});await create.click();const input=p.getByLabel('版本名称',{exact:true});await focused(input);
 for(const value of ['   ','长'.repeat(201)]){await input.fill(value);await click(p,'保存名称');assert.match(await p.locator('#ppte-version-form [role=alert]').innerText(),/1–200/);assert.equal(await input.getAttribute('aria-invalid'),'true');assert.equal(await state(p),initial);await focused(input);}
 await input.fill('不会保留');await input.press('Escape');await closed(p);await focused(create);assert.equal(await state(p),initial);
 await create.click();await input.press('Shift+Tab');await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>!!document.activeElement?.closest('#ppte-version-form')),true);await click(p,'取消');await closed(p);await focused(create);assert.equal(await state(p),initial);
 await create.click();await input.fill('独立 UI 验收');await input.press('Enter');await closed(p);await focused(create);
 let row=p.locator('#ppte-versions section').filter({hasText:'独立 UI 验收'});assert.match(await row.innerText(),/尚未写入文件/);assert.equal(await row.getByRole('button',{name:'删除版本',exact:true}).isVisible(),false);
 await manage(row);await click(row,'命名');assert.equal(await input.inputValue(),'独立 UI 验收');await input.fill('');await click(p,'保存名称');assert.match(await p.locator('#ppte-version-form [role=alert]').innerText(),/1–200/);await input.fill('  独立 UI 验收 · 命名  ');await input.press('Enter');await closed(p);await focused(row.getByRole('button',{name:'命名',exact:true}));
 await p.screenshot({path:join(out,'history-named.png')});
 const unchanged=await state(p);await click(p,'调整历史上限');const count=p.getByLabel('未命名自动版本上限（0–200）',{exact:true}),size=p.getByLabel('历史容量上限（MiB，1 KiB–128 MiB）',{exact:true});
 assert.match(await p.locator('#ppte-version-form').innerText(),/历史占用.*命名版本不会自动删除/s);
 for(const [c,s] of [['',''],['201','129'],['1.5','0']]){await count.fill(c);await size.fill(s);await click(p,'确认调整上限');assert.match(await p.locator('#ppte-version-form [role=alert]').innerText(),/自动版本数.*历史容量/);assert.equal(await state(p),unchanged);}
 // A valid numeric quota that cannot retain the named snapshot must fail atomically.
 await count.fill('0');await size.fill(String(1/1024));await click(p,'确认调整上限');assert.match(await p.locator('#ppte-version-form [role=alert]').innerText(),/历史容量已满/);assert.equal(await state(p),unchanged);
 await count.fill('5');await size.fill('32');await click(p,'取消');await closed(p);assert.equal(await state(p),unchanged);await focused(p.getByRole('button',{name:'调整历史上限',exact:true}));
 await click(p,'调整历史上限');await count.fill('5');await size.fill('32');await size.press('Enter');await closed(p);assert.match(await p.locator('#ppte-versions').innerText(),/32.00 MiB.*最多 5 个/s);assert.match(await p.locator('#ppte-version-pending').innerText(),/尚未写入文件/);
 // Both fields and consequences remain reviewable at the required widths.
 for(const width of [1440,1024,390]){await resizeViewport(p,{width,height:width===390?844:960});await click(p,'调整历史上限');for(const field of [count,size]){const r=(await field.boundingBox())!;assert.ok(r.x>=0&&r.x+r.width<=width);}await p.screenshot({path:join(out,`capacity-${width}.png`)});await click(p,'取消');await closed(p);}
 await resizeViewport(p,{width:1440,height:960});await click(p,'关闭版本历史');
 const title=p.frameLocator('#ppte-frame').locator('[data-id=title1]');await title.dblclick();await title.fill('恢复前的临时内容');await click(p,'页面设置');await history(p);await name(p,'后续版本');
 row=p.locator('#ppte-versions section').filter({hasText:'独立 UI 验收 · 命名'});await click(row,'预览');assert.equal(await p.frameLocator('iframe[title="版本预览（只读）"]').locator('[data-id=title1]').innerText(),'开源，\n让选择更多。');assert.equal(await title.innerText(),'恢复前的临时内容');
 await manage(row);const beforeRestore=await state(p);await click(row,'恢复到此版本');assert.match(await p.locator('#ppte-version-form').innerText(),/独立 UI 验收 · 命名.*当前内容会先保留一个版本.*已有历史继续保留/s);await focused(p.getByRole('button',{name:'取消',exact:true}));await p.keyboard.press('t');await p.keyboard.press('Delete');await p.keyboard.press('Control+z');assert.equal(await state(p),beforeRestore);await p.keyboard.press('Escape');await closed(p);assert.equal(await state(p),beforeRestore);await focused(row.getByRole('button',{name:'恢复到此版本',exact:true}));
 await click(row,'恢复到此版本');await p.screenshot({path:join(out,'restore-confirmation.png')});await click(p,'确认恢复');await closed(p);assert.equal(await title.innerText(),'开源，\n让选择更多。');assert.match(await p.locator('#ppte-versions [role=alert]').innerText(),/恢复前内容已保留.*尚未写入文件/);
 await click(p.locator('#ppte-versions section').filter({hasText:'恢复前 ·'}),'预览');assert.equal(await p.frameLocator('iframe[title="版本预览（只读）"]').locator('[data-id=title1]').innerText(),'恢复前的临时内容');
 const later=p.locator('#ppte-versions section').filter({hasText:'后续版本'});await manage(later);const beforeDelete=await state(p);await click(later,'删除版本');assert.match(await p.locator('#ppte-version-form').innerText(),/永久删除 1 个.*后续版本.*跨会话不可恢复.*当前内容和其他历史版本保持不变/s);await click(p,'取消');await closed(p);assert.equal(await state(p),beforeDelete);await focused(later.getByRole('button',{name:'删除版本',exact:true}));
 await click(later,'删除版本');await click(p,'确认删除');await closed(p);assert.equal(await later.count(),0);await focused(p.getByRole('button',{name:'关闭版本历史',exact:true}));assert.equal(await title.innerText(),'开源，\n让选择更多。');
 await click(p,'关闭版本历史');const event=p.waitForEvent('download');await click(p,'下载更新后的文件');const saved=join(out,'downloaded.ppte.html');await(await event).saveAs(saved);const bytes=await readFile(saved,'utf8'),wire=readHistory(bytes)!;const historyIndex=JSON.parse(wire.index);assert.equal(historyIndex.maxAuto,5);assert.equal(historyIndex.maxBytes,32*1048576);assert.equal(historyIndex.versions.some((v:any)=>v.name==='后续版本'),false);const data=new Versions(readEnhanced(bytes).metadata.documentId,wire);assert.match(data.preview(data.index.versions.find(v=>v.kind==='before-restore')!.id),/恢复前的临时内容/);
 await b.close();b=await chromium.launch({channel:'chrome',headless:true});p=await b.newPage({offline:true,viewport:{width:1440,height:960}});await p.goto(pathToFileURL(saved).href);await history(p);row=p.locator('#ppte-versions section').filter({hasText:'独立 UI 验收 · 命名'});assert.match(await row.innerText(),/已随打开文件载入/);await click(row,'预览');assert.equal(await p.frameLocator('iframe[title="版本预览（只读）"]').locator('[data-id=title1]').innerText(),'开源，\n让选择更多。');assert.equal(await p.getByRole('button',{name:'恢复到此版本',exact:true}).count(),0);
 assert.deepEqual(nativeDialogs,[]);assert.deepEqual(errors,[]);assert.deepEqual(network,[]);await writeFile(join(out,'journey.json'),JSON.stringify({status:'pass',browser:b.version(),offline:true,nativeDialogs,errors,network,source:'docs/audits/2026-09-07-ui-d96f211/sample/source.html',freshBrowserProcess:true,nativeAuthorization:null,nativeAuthorizationReason:'No native picker exercised; actual download and file reopen only'},null,2));
 }finally{await b.close();}
});
