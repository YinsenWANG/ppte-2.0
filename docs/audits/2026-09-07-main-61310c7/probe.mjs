import {chromium} from 'playwright';
import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const audit=dirname(fileURLToPath(import.meta.url)),out=resolve('artifacts/independent-613-review'),src=resolve(audit,'sample/source.html'),original=resolve(audit,'sample/Cherry-Studio-开源之路.ppte.html');
await mkdir(out,{recursive:true});const copy=out+'/review-copy.ppte.html';await copyFile(original,copy);
const hash=b=>createHash('sha256').update(b).digest('hex');
const result={requests:[],errors:[],pages:[]};
let browser=await chromium.launch({channel:'chrome',headless:true});result.browser=browser.version();
try{
 const context=await browser.newContext({offline:true,acceptDownloads:true,viewport:{width:1280,height:900}});
 context.on('request',r=>{if(/^https?:/.test(r.url()))result.requests.push(r.url())});
 const page=await context.newPage(),raw=await context.newPage();page.setDefaultTimeout(10000);raw.setDefaultTimeout(10000);
 page.on('pageerror',e=>result.errors.push(String(e)));
 await page.goto(pathToFileURL(copy).href);await raw.goto(pathToFileURL(src).href);await page.waitForFunction(()=>window.PPTeSave&&window.PPTeEditor);
 result.entry={edit:await page.getByRole('button',{name:'编辑',exact:true}).isVisible(),present:await page.getByRole('button',{name:'放映',exact:true}).isVisible()};
 await page.screenshot({path:out+'/direct-read.png'});
 for(let i=0;i<12;i++){
   const a=await raw.locator('[data-ppte-slide]').nth(i).screenshot();
   const b=await page.frameLocator('#ppte-frame').locator('[data-ppte-slide]').nth(i).screenshot({path:out+`/slide-${i+1}.png`});
   result.pages.push({page:i+1,pixelIdentical:hash(a)===hash(b)});
 }
 result.overflow=await page.evaluate(()=>[...window.PPTeHTML.contentDocument.querySelectorAll('[data-ppte-slide]')].flatMap((s,i)=>{const b=s.getBoundingClientRect();return [...s.querySelectorAll('h1,h2,h3,p,td,th')].filter(n=>{const r=n.getBoundingClientRect();return r.width&&r.height&&(r.right>b.right+1||r.left<b.left-1||r.bottom>b.bottom+1||r.top<b.top-1)}).map(n=>({page:i+1,text:n.textContent}))}));
 await page.getByRole('button',{name:'编辑',exact:true}).click();
 await page.getByRole('button',{name:'第 2 页',exact:true}).click();
 const text=page.frameLocator('#ppte-frame').locator('[data-ppte-slide]').nth(1).locator('p').nth(1);
 await text.fill('独立验收：一个文件，保留每一次修改。');
 const event=page.waitForEvent('download');await page.getByRole('button',{name:'下载更新后的文件',exact:true}).click();const download=await event;await download.saveAs(out+'/downloaded.ppte.html');
 result.download={failure:await download.failure(),status:await page.getByRole('status').innerText(),originalUnchanged:hash(await readFile(original))===hash(await readFile(copy))};
 await browser.close();browser=await chromium.launch({channel:'chrome',headless:true});
 const fresh=await browser.newContext({offline:true,viewport:{width:1440,height:1000}});const p=await fresh.newPage();p.setDefaultTimeout(10000);
 await p.goto(pathToFileURL(out+'/downloaded.ppte.html').href);await p.waitForFunction(()=>window.PPTeSave&&window.PPTeEditor);
 assert.match(await p.frameLocator('#ppte-frame').locator('[data-ppte-slide]').nth(1).innerText(),/独立验收/);result.download.freshProcessReopen=true;
 await p.getByRole('button',{name:'编辑',exact:true}).click();await p.getByRole('button',{name:'第 1 页',exact:true}).click();
 await p.screenshot({path:out+'/editor.png'});
 result.background=await p.getByLabel('背景',{exact:true}).inputValue();
 await p.getByRole('button',{name:'放映',exact:true}).click();await p.waitForTimeout(2100);await p.screenshot({path:out+'/present.png'});
 result.presentation=await p.evaluate(()=>({editable:window.PPTeHTML.contentDocument.querySelectorAll('[contenteditable=true]').length,visiblePages:[...window.PPTeHTML.contentDocument.querySelectorAll('[data-ppte-slide]')].filter(n=>getComputedStyle(n).display!=='none').length}));
 await p.keyboard.press('b');await p.screenshot({path:out+'/black.png'});await p.keyboard.press('b');await p.keyboard.press('Escape');
 await p.frameLocator('#ppte-frame').locator('h1').first().click();await p.getByRole('button',{name:'保护对象',exact:true}).click();
 const add=async()=>{const b=p.getByRole('button',{name:'添加页',exact:true});try{await b.click({timeout:1500});}catch(e){result.addMouseBlocked=String(e);await p.screenshot({path:out+'/add-blocked.png'});await b.focus();await b.press('Enter');result.addUsedKeyboardWorkaround=true;}};await add();
 result.addProtected=await p.evaluate(()=>({pages:window.PPTeHTML.contentDocument.querySelectorAll('[data-ppte-slide]').length,feedback:document.querySelector('#ppte-feedback').textContent}));
 await add();await p.getByRole('button',{name:'放映',exact:true}).click();
 result.newPagesVisible=await p.evaluate(()=>[...window.PPTeHTML.contentDocument.querySelectorAll('[data-ppte-slide]')].filter(n=>n.ownerDocument.defaultView.getComputedStyle(n).display!=='none').map(n=>n.dataset.ppteSlide));
 await p.keyboard.press('Escape');await p.getByRole('button',{name:'阅读',exact:true}).click();
 result.newPageResponsive=await p.evaluate(()=>[...window.PPTeHTML.contentDocument.querySelectorAll('[data-ppte-slide]')].slice(0,4).map(n=>({id:n.dataset.ppteSlide,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));await p.screenshot({path:out+'/added-read.png'});
 await p.getByRole('button',{name:'编辑',exact:true}).click();await p.getByRole('button',{name:'第 1 页',exact:true}).click();
 // A generated screenshot is only a deterministic insertion fixture, not a user-image semantic evaluation.
 await p.getByLabel('插入本地图片',{exact:true}).setInputFiles(out+'/slide-3.png');
 await p.waitForFunction(()=>window.PPTeHTML.contentDocument.querySelector('img'));
 result.insertImage=await p.evaluate(()=>{const d=window.PPTeHTML.contentDocument,n=d.querySelector('img'),r=n.getBoundingClientRect();return {rect:{x:r.x,y:r.y,width:r.width,height:r.height},hitTag:d.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.tagName,hitIsImage:d.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===n,style:n.getAttribute('style')}});
 await p.screenshot({path:out+'/insert-image.png'});
 const gallery=await fresh.newPage();await gallery.setViewportSize({width:1320,height:800});await writeFile(out+'/contact.html','<style>body{margin:12px;background:#d8d9d5;display:grid;grid-template-columns:repeat(4,1fr);gap:12px;align-content:start}img{width:100%}</style>'+Array.from({length:12},(_,i)=>`<img src="slide-${i+1}.png">`).join(''));await gallery.goto(pathToFileURL(out+'/contact.html').href);await gallery.screenshot({path:out+'/contact.png'});
}catch(e){result.failure=String(e.stack);process.exitCode=1;}finally{await writeFile(out+'/result.json',JSON.stringify(result,null,2));await browser.close();}
console.log(JSON.stringify(result,null,2));
