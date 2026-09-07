import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { enhanceHTML } from '../packages/html-document/src/index.js';
const out=resolve('artifacts/ui01');
const source='<title>UI01 · 作者布局</title><style>body{margin:0}section{width:960px;height:540px;box-sizing:border-box;padding:48px;background:white;display:grid;grid-template-columns:1fr 1fr}h1{font:48px system-ui}.copy{display:flex;flex-direction:column}button{color:red}</style><section data-ppte-slide data-ppte-id="s1"><h1 data-ppte-id="t1">第一张</h1><div class="copy"><p>可复制的作者文字</p><a href="#anchor">链接</a></div></section><section data-ppte-slide data-ppte-id="s2"><h1 data-ppte-id="t2">第二张</h1><p>下一页</p></section>';
async function setup(name:string) {
 await mkdir(out,{recursive:true});const file=join(out,name+'.ppte.html');
 await writeFile(file,(await enhanceHTML(source,{root:out,base:out})).html);
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({offline:true,hasTouch:true,viewport:{width:1440,height:900},acceptDownloads:true});
 const page=await context.newPage();const errors:string[]=[],network:string[]=[];
 page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
 await page.goto(pathToFileURL(file).href);await page.waitForFunction(()=>!!(window as any).PPTeSave);
 return {browser,page,file,async close(){assert.deepEqual(errors,[]);assert.deepEqual(network,[]);await writeFile(join(out,name+'.json'),JSON.stringify({status:'captured',verdictSource:'node --test TAP assertions; capture alone is not a pass',browser:browser.version(),headless:true,offline:true,errors,network,time:new Date().toISOString()},null,2));await browser.close();}};
}
test('UI01 acceptance 1: offline initial, copied and downloaded files reopen in reading in a fresh process',async()=>{
 const f=await setup('reading');try{const p=f.page;
 assert.equal(await p.locator('#ppte-edit-toolbar').isVisible(),false);
 assert.equal(await p.locator('#ppte-properties').isVisible(),false);
 assert.equal(await p.locator('#ppte-pages').isVisible(),false);
 assert.equal(await p.getByRole('status').isVisible(),false);
 assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-slide]').nth(1).isVisible(),false);
 assert.equal(await p.frameLocator('#ppte-frame').locator('section').first().evaluate(n=>getComputedStyle(n).display),'grid');
 assert.equal(await p.frameLocator('#ppte-frame').locator('.copy').evaluate(n=>getComputedStyle(n).display),'flex');
 await p.screenshot({path:join(out,'reading.png')});
 await p.getByRole('button',{name:'下一页',exact:true}).click();
 assert.match(await p.locator('#ppte-canvas-controls').textContent()??'',/2 \/ 2/);
 assert.equal(await p.frameLocator('#ppte-frame').locator('section').first().isVisible(),false);
 await p.getByRole('button',{name:'编辑',exact:true}).click();
 await p.frameLocator('#ppte-frame').locator('[data-ppte-id=t2]').fill('已编辑第二张');
 const download=p.waitForEvent('download');await p.getByRole('button',{name:'下载更新后的文件',exact:true}).click();
 const saved=join(out,'reopened.ppte.html');await (await download).saveAs(saved);
 const copy=join(out,'copied.ppte.html');await writeFile(copy,await readFile(saved));
 // A separate browser process and storage context, not reload or the original cache.
 const fresh=await chromium.launch({channel:'chrome',headless:true});try{const q=await fresh.newPage();
 for(const file of [saved,copy]){await q.goto(pathToFileURL(file).href);await q.waitForFunction(()=>!!(window as any).PPTeSave);
 assert.equal(await q.locator('#ppte-save-ui').getAttribute('data-mode'),'read');
 assert.equal(await q.locator('#ppte-properties').isVisible(),false);
 assert.equal(await q.frameLocator('#ppte-frame').locator('[data-ppte-id=t2]').textContent(),'已编辑第二张');
 assert.equal(await q.frameLocator('#ppte-frame').locator('[data-ppte-id=t2]').getAttribute('contenteditable'),'false');}
 }finally{await fresh.close();}
 }finally{await f.close();}
});
test('UI01 acceptance 2: editor expands context on real selection, closes properties, keeps author DOM and input through mode switches',async()=>{
 const f=await setup('context');try{const p=f.page;
 const before=await p.evaluate(()=>(window as any).PPTeHTML.content());
 await p.getByRole('button',{name:'编辑',exact:true}).click();
 assert.equal(await p.locator('#ppte-edit-toolbar').isVisible(),true);
 assert.equal(await p.locator('#ppte-pages').isVisible(),true);
 assert.equal(await p.locator('#ppte-properties').isVisible(),false);
 const wide=await p.locator('#ppte-frame').boundingBox();
 await p.frameLocator('#ppte-frame').locator('[data-ppte-id=t1]').click();
 assert.equal(await p.locator('#ppte-properties').isVisible(),true);
 assert.equal(await p.locator('#ppte-properties h3').textContent(),'文字');
 assert.ok((await p.locator('#ppte-frame').boundingBox())!.width<wide!.width);
 assert.equal(await p.evaluate(()=>(window as any).PPTeHTML.content()),before);
 await p.screenshot({path:join(out,'editing-context.png')});
 await p.getByRole('button',{name:'关闭属性',exact:true}).click();
 assert.equal(await p.locator('#ppte-properties').isVisible(),false);
 await p.getByRole('button',{name:'页面设置',exact:true}).click();
 assert.equal(await p.getByLabel('背景',{exact:true}).isVisible(),true);
 await p.frameLocator('#ppte-frame').locator('[data-ppte-id=t1]').fill('输入已提交');
 await p.getByRole('button',{name:'阅读',exact:true}).click();
 assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-id=t1]').textContent(),'输入已提交');
 assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-id=t1]').getAttribute('contenteditable'),'false');
 await p.getByRole('button',{name:'编辑',exact:true}).click();await p.getByRole('button',{name:'撤销',exact:true}).click();
 assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-id=t1]').textContent(),'第一张');
 }finally{await f.close();}
});
test('UI01 acceptance 3: audience contains no menu or HUD before/after pointer, Tab, idle and black screen',async()=>{
 const f=await setup('audience');try{const p=f.page;
 await p.evaluate(()=>{document.documentElement.requestFullscreen=()=>Promise.reject(Error('test denial'));});
 await p.getByRole('button',{name:'放映',exact:true}).click();
 for(const selector of ['#ppte-save-ui','#ppte-edit-toolbar','#ppte-workspace','#ppte-canvas-controls']) assert.equal(await p.locator(selector).isVisible(),false);
 assert.equal(await p.locator('#ppte-player button,#ppte-player [role=toolbar],#ppte-player-controls').count(),0);
 await p.mouse.move(400,250);await p.keyboard.press('Tab');await p.waitForTimeout(1900);
 assert.equal(await p.frameLocator('#ppte-frame').locator('h1').first().evaluate(n=>getComputedStyle(n).cursor),'none');
 await p.mouse.move(420,260);
 assert.equal(await p.locator('#ppte-player button,#ppte-player-controls').count(),0);
 await p.keyboard.press('b');assert.equal(await p.locator('#ppte-black').isVisible(),true);
 await p.keyboard.press('b');
 const cdp=await p.context().newCDPSession(p);
 const swipe=async(x:number,y:number,to:number)=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:to,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
 const link=await p.frameLocator('#ppte-frame').locator('a').boundingBox();
 await swipe(link!.x+5,link!.y+5,link!.x-100);
 assert.equal(await p.evaluate(()=>(window as any).PPTePlayer.index),0,'link gestures must not advance');
 await swipe(600,600,300);
 assert.equal(await p.evaluate(()=>(window as any).PPTePlayer.index),1,'horizontal content swipe advances');
 await swipe(300,600,600);
 assert.equal(await p.evaluate(()=>(window as any).PPTePlayer.index),0);
 await p.screenshot({path:join(out,'audience.png')});
 await p.keyboard.press('Escape');assert.equal(await p.locator('#ppte-save-ui').getAttribute('data-mode'),'read');
 }finally{await f.close();}
});
test('UI01 acceptance 4: fullscreen reject/throw and native exit restore prior mode and current page; delayed grant cannot strand fullscreen',async()=>{
 const f=await setup('transitions');try{const p=f.page;
 for(const mode of ['read','edit']) for(const failure of ['reject','throw']){
 await p.getByRole('button',{name:mode==='read'?'阅读':'编辑',exact:true}).click();
 await p.evaluate(failure=>{document.documentElement.requestFullscreen=()=>{if(failure==='throw')throw Error('unavailable');return Promise.reject(Error('denied'));};},failure);
 await p.getByRole('button',{name:'放映',exact:true}).click();
 assert.equal(await p.evaluate(()=>(window as any).PPTePlayer.running),true);
 await p.keyboard.press('ArrowRight');await p.keyboard.press('Escape');
 assert.equal(await p.locator('#ppte-save-ui').getAttribute('data-mode'),mode);
 assert.match(await p.locator('#ppte-canvas-controls').textContent()??'',/2 \/ 2/);
 }
 await p.evaluate(()=>{delete (document.documentElement as any).requestFullscreen;});
 await p.getByRole('button',{name:'放映',exact:true}).click();await p.waitForFunction(()=>!!document.fullscreenElement);
 await p.evaluate(()=>document.exitFullscreen());await p.waitForFunction(()=>!(window as any).PPTePlayer.running);
 assert.equal(await p.locator('#ppte-save-ui').getAttribute('data-mode'),'edit');
 // Hold an actual fullscreen request's completion to reproduce Escape while permission is pending.
 await p.evaluate(()=>{const native=document.documentElement.requestFullscreen.bind(document.documentElement);document.documentElement.requestFullscreen=()=>new Promise<void>(resolve=>{(window as any).grant=()=>native().then(resolve);});});
 await p.getByRole('button',{name:'放映',exact:true}).click();await p.keyboard.press('Escape');
 await p.evaluate(()=>(window as any).grant());await p.waitForFunction(()=>!document.fullscreenElement);
 assert.equal(await p.locator('#ppte-save-ui').getAttribute('data-mode'),'edit');
 }finally{await f.close();}
});
