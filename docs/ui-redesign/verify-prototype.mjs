import {chromium} from 'playwright';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const out=resolve('artifacts/ui-redesign'),url=pathToFileURL(resolve('docs/ui-redesign/UI_PROTOTYPE.html')).href;
const b=await chromium.launch({channel:'chrome',headless:true});
const ctx=await b.newContext({viewport:{width:1440,height:960},offline:true,acceptDownloads:true});const p=await ctx.newPage();p.setDefaultTimeout(6000);let passed=false;const errors=[],requests=[];p.on('pageerror',e=>errors.push(String(e)));p.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url())});
try{
await p.goto(url);await p.waitForTimeout(180);await p.screenshot({animations:'disabled',path:out+'/01-reading.png'});assert.equal(await p.locator('#app').getAttribute('data-mode'),'read');
await p.getByRole('button',{name:'编辑',exact:true}).click();await p.waitForTimeout(180);await p.screenshot({animations:'disabled',path:out+'/02-editor.png'});
await p.locator('#slide [data-id="title1"]').click();await p.waitForTimeout(180);await p.screenshot({animations:'disabled',path:out+'/03-text.png'});
await p.getByRole('button',{name:'插入',exact:true}).click();await p.waitForTimeout(180);await p.screenshot({animations:'disabled',path:out+'/04-insert.png'});
await p.getByRole('button',{name:'文本框'}).click();assert.ok((await p.locator('#slide').innerText()).includes('输入文字'));
await p.getByRole('button',{name:'撤销',exact:true}).click();assert.ok(!(await p.locator('#slide').innerText()).includes('输入文字'));
await p.getByRole('button',{name:'重做',exact:true}).click();
await p.locator('#slide .text').filter({hasText:'输入文字'}).dblclick();await p.locator('[contenteditable=true]').fill('原型交互验证');await p.keyboard.press('Escape');
await p.getByRole('button',{name:'插入',exact:true}).click();await p.getByRole('button',{name:'形状'}).click();await p.getByRole('button',{name:'椭圆',exact:true}).click();await p.getByLabel('填充',{exact:true}).fill('#b4c8a0');
await p.getByRole('button',{name:'插入',exact:true}).click();await p.getByRole('button',{name:'表格',exact:true}).click();await p.waitForTimeout(180);await p.screenshot({animations:'disabled',path:out+'/05-table-menu.png'});await p.getByRole('button',{name:'3 行 3 列'}).click();assert.equal(await p.locator('#slide table tr').count(),3);
await p.locator('#image-file').setInputFiles(out+'/01-reading.png');await p.waitForSelector('#slide img');await p.waitForTimeout(180);await p.screenshot({animations:'disabled',path:out+'/06-image.png'});
const downloadEvent=p.waitForEvent('download');await p.getByRole('button',{name:'下载副本',exact:true}).click();const dl=await downloadEvent;await dl.saveAs(out+'/downloaded.html');
const q=await ctx.newPage();await q.goto(pathToFileURL(out+'/downloaded.html').href);assert.equal(await q.locator('#app').getAttribute('data-mode'),'read');assert.ok((await q.locator('#slide').innerText()).includes('原型交互验证'));await q.close();
await p.getByRole('button',{name:'阅读',exact:true}).click();await p.getByRole('button',{name:'放映',exact:true}).click();await p.mouse.move(400,300);assert.equal(await p.locator('#app header').isVisible(),false);await p.waitForTimeout(180);await p.screenshot({animations:'disabled',path:out+'/07-present.png'});await p.keyboard.press('ArrowRight');assert.equal(await p.locator('#page-count').innerText(),'2 / 3');await p.keyboard.press('Escape');assert.equal(await p.locator('#app').getAttribute('data-mode'),'read');
await p.goto(url);await p.setViewportSize({width:1024,height:768});await p.getByRole('button',{name:'编辑',exact:true}).click();await p.locator('#slide [data-id="title1"]').click();await p.waitForTimeout(180);await p.screenshot({animations:'disabled',path:out+'/08-1024.png'});
await p.setViewportSize({width:390,height:844});await p.waitForTimeout(180);await p.screenshot({animations:'disabled',path:out+'/09-mobile.png'});
assert.equal(errors.length,0);assert.equal(requests.length,0);passed=true;console.log(JSON.stringify({pass:true,errors,requests,tests:['reading default','context inspector','insert text/shape/table/image','undo redo','text edit','download reopen','pure presentation and return','1024 and390 screenshots']},null,2));
}catch(e){await p.screenshot({path:out+'/failure.png'});console.log(await p.locator('#menu').evaluate(n=>({html:n.outerHTML})));throw e;}finally{await writeFile(out+'/result.json',JSON.stringify({passed,errors,requests,browser:b.version(),scope:"Offline prototype interactions only, not production acceptance"},null,2));await b.close()}
