import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { enhanceHTML } from '../packages/html-document/src/index.js';
const evidence=resolve('artifacts/h04');
const source=`<title>H04 presentation</title><style>body{margin:0;background:#fff;color:#123;font:24px Arial}section{box-sizing:border-box;width:960px;height:540px;background:#fff;padding:40px}h1{font-size:48px}.grid{display:grid;grid-template-columns:1fr 1fr}video{width:180px;height:100px}</style><section data-ppte-slide data-ppte-id="one" data-ppte-notes="Speaker secret"><h1 data-ppte-id="title">First slide</h1><div class="grid"><p data-ppte-step>Reveal alpha</p><p data-ppte-step>Reveal beta</p></div><video controls data-ppte-id="video" poster="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" aria-label="Film"></video></section><section data-ppte-slide data-ppte-id="two" data-ppte-transition="fade"><h1>Second slide</h1><p data-ppte-step>Final reveal</p></section>`;
async function setup() {
 await mkdir(evidence,{recursive:true});const root=await mkdtemp(join(tmpdir(),'h04-'));const file=join(root,'作品.html');
 const video=await readFile('tests/fixtures/media/blue-vp9.webm');
 await writeFile(file,(await enhanceHTML(source.replace('<video controls', '<video muted loop src="data:video/webm;base64,'+video.toString('base64')+'" controls'),{root,base:root})).html);
 const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1200,height:800}});
 await page.goto('file://'+file);await page.waitForFunction(()=>!!(window as any).PPTePlayer);
 await page.getByRole('button',{name:'编辑 / 保存',exact:true}).click();
 // Explicitly inject platform failures; these are not claims of native permission interaction.
 await page.evaluate(()=>{document.documentElement.requestFullscreen=()=>Promise.reject(Error('denied'));});
 return {root,file,browser,page,async close(){await browser.close();await rm(root,{recursive:true,force:true});}};
}
test('H04 acceptance 1/2: clean audience, idle controls, black pixels, steps, media clicks, fullscreen denial and Escape restore',async()=>{
 const f=await setup();try {const p=f.page;await p.getByRole('button',{name:'编辑',exact:true}).click();
 await p.evaluate(()=>{const e=(window as any).PPTeEditor;e.select(['title']);(window as any).before=(window as any).PPTeHTML.content();});
 await p.getByRole('button',{name:'放映',exact:true}).click();
 assert.equal(await p.locator('#ppte-save-ui').isVisible(),false);assert.equal(await p.locator('#ppte-workspace').isVisible(),false);
 assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-slide=two]').isVisible(),false);
 assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-step]').first().isVisible(),false);
 assert.equal(await p.frameLocator('#ppte-frame').locator('h1').first().evaluate(n=>getComputedStyle(n).outlineStyle),'none');
 assert.equal(await p.locator('#ppte-player-controls').evaluate(n=>getComputedStyle(n).opacity),'0');
 await p.mouse.move(100,100);await p.waitForFunction(()=>document.querySelector('#ppte-player-controls')!.hasAttribute('data-visible'));
 await p.waitForFunction(()=>!document.querySelector('#ppte-player-controls')!.hasAttribute('data-visible'));
 await p.keyboard.press('ArrowRight');assert.equal(await p.evaluate(()=>(window as any).PPTePlayer.step),1);
 await p.frameLocator('#ppte-frame').locator('video').click();assert.equal(await p.evaluate(()=>(window as any).PPTePlayer.step),1);
 await p.frameLocator('#ppte-frame').locator('video').evaluate(n=>(n as HTMLVideoElement).play());
 assert.equal(await p.frameLocator('#ppte-frame').locator('video').evaluate(n=>(n as HTMLVideoElement).paused),false);
 await p.keyboard.press('b');assert.equal(await p.locator('#ppte-black').isVisible(),true);
 const shot=await p.screenshot({path:join(evidence,'black.png')});
 // Decode browser screenshot in a canvas and assert every pixel, not just CSS color.
 assert.equal(await p.evaluate(async data=>{const im=new Image();im.src=data;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const x=c.getContext('2d')!;x.drawImage(im,0,0);const b=x.getImageData(0,0,c.width,c.height).data;return b.every((v,i)=>i%4===3?v===255:v===0);},'data:image/png;base64,'+shot.toString('base64')),true);
 await p.keyboard.press('ArrowRight');assert.equal(await p.evaluate(()=>(window as any).PPTePlayer.black),false);
 await p.frameLocator('#ppte-frame').locator('video').evaluate(n=>(n as HTMLVideoElement).play());
 await p.keyboard.press('ArrowRight');await p.keyboard.press('ArrowRight');assert.equal(await p.evaluate(()=>(window as any).PPTePlayer.index),1);
 assert.equal(await p.frameLocator('#ppte-frame').locator('video').evaluate(n=>(n as HTMLVideoElement).paused),true);
 await p.frameLocator('#ppte-frame').locator('[data-ppte-slide=two]').evaluate(n=>Promise.all(n.getAnimations().map(a=>a.finished)));
 assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-slide=two] h1').isVisible(),true);
 await p.screenshot({path:join(evidence,'audience.png')});await p.keyboard.press('Escape');
 assert.equal(await p.locator('#ppte-properties').isVisible(),true);assert.deepEqual(await p.evaluate(()=>(window as any).PPTeEditor.selection),['title']);
 assert.equal(await p.evaluate(()=>(window as any).PPTeHTML.content()===(window as any).before),true);
 }finally{await f.close();}
});
test('H04 acceptance 2: blocked presenter leaves audience usable; real popup has notes/next preview and shared navigation',async()=>{
 const f=await setup();try{const p=f.page;await p.getByRole('button',{name:'放映',exact:true}).click();
 await p.evaluate(()=>{(window as any).savedOpen=window.open;window.open=()=>null;});await p.keyboard.press('p');
 assert.match(await p.locator('#ppte-player-controls [aria-live]').textContent()??'',/被阻止/);
 await p.keyboard.press('ArrowRight');assert.equal(await p.evaluate(()=>(window as any).PPTePlayer.step),1);
 await p.evaluate(()=>window.open=(window as any).savedOpen);
 const popupPromise=p.waitForEvent('popup');await p.keyboard.press('p');const popup=await popupPromise;
 assert.equal(await popup.locator('#notes').textContent(),'Speaker secret');assert.equal(await popup.locator('iframe').getAttribute('sandbox'),'allow-same-origin');
 await popup.getByRole('button',{name:'下一步',exact:true}).click();assert.equal(await p.evaluate(()=>(window as any).PPTePlayer.step),2);
 await popup.frameLocator('iframe').locator('h1').waitFor({state:'visible'});
 assert.equal(await popup.frameLocator('iframe').locator('h1').textContent(),'Second slide');
 await popup.screenshot({path:join(evidence,'presenter.png')});await popup.close();await p.keyboard.press('Escape');assert.equal(await p.locator('#ppte-save-ui').isVisible(),true);
 }finally{await f.close();}
});
test('H04 acceptance 3: actual browser PDF has two sized pages, selectable revealed text, no editor UI and print restores content',async()=>{
 const f=await setup();try{const p=f.page;await p.evaluate(()=>{(window as any).before=(window as any).PPTeHTML.content();(window as any).PPTePrint.prepare();});
 await p.emulateMedia({media:'print'});
 assert.equal(await p.locator('#ppte-save-ui').isVisible(),false);assert.equal(await p.locator('#ppte-print>div').count(),2);
 assert.equal(await p.locator('#ppte-print video').count(),0);assert.equal(await p.locator('#ppte-print img').count(),1);
 assert.equal(await p.locator('#ppte-print').locator('[data-ppte-step]').first().evaluate(n=>getComputedStyle(n).visibility),'visible');
 const pdf=join(evidence,'slides.pdf');await p.pdf({path:pdf,preferCSSPageSize:true,printBackground:true});
 // PDFKit parses the emitted PDF independently of the browser DOM on this macOS reference host.
 const script=join(f.root,'inspect.swift');await writeFile(script,`import Foundation\nimport PDFKit\nlet d=PDFDocument(url:URL(fileURLWithPath:CommandLine.arguments[1]))!\nlet pages=(0..<d.pageCount).map { i -> [String:Any] in let p=d.page(at:i)!;let b=p.bounds(for:.mediaBox);return ["text":p.string ?? "", "width":b.width,"height":b.height] }\nprint(String(data:try! JSONSerialization.data(withJSONObject:pages),encoding:.utf8)!)\n`);
 const result=spawnSync('swift',[script,pdf],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);const pages=JSON.parse(result.stdout);await writeFile(join(evidence,'pdf.json'),JSON.stringify(pages,null,2));
 assert.equal(pages.length,2);assert.match(pages[0].text,/First slide/);assert.match(pages[0].text,/Reveal alpha/);assert.match(pages[0].text,/Reveal beta/);assert.match(pages[1].text,/Second slide/);assert.match(pages[1].text,/Final reveal/);
 for(const page of pages){assert.ok(Math.abs(page.width-720)<1);assert.ok(Math.abs(page.height-405)<1);assert.doesNotMatch(page.text,/编辑|保存|下一页|Speaker secret/);}
 await p.emulateMedia({media:'screen'});await p.evaluate(()=>(window as any).PPTePrint.restore());assert.equal(await p.evaluate(()=>(window as any).PPTeHTML.content()===(window as any).before),true);
 await writeFile(join(evidence,'example.html'),await readFile(f.file));
 }finally{await f.close();}
});
test('H04 acceptance 4: generation and reading create only HTML; new export/runtime graph excludes retired formats',async()=>{
 const f=await setup();try{assert.deepEqual(await readdir(f.root),['作品.html']);assert.equal(await f.page.locator('#ppte-print').count(),0);
 for(const file of ['packages/html-player/src/index.ts','packages/html-print/src/index.ts','apps/html-cli/index.ts']) assert.doesNotMatch(await readFile(file,'utf8'),/pptx|keynote|\.odp|exporter-ppt|portable|html-to-image/i);
 await f.page.locator('summary').click();assert.equal(await f.page.getByRole('button',{name:'导出 PDF',exact:true}).count(),1);
 await f.page.evaluate(()=>{(window as any).printCalls=0;window.print=()=>{(window as any).printCalls++;window.dispatchEvent(new Event('afterprint'));};});
 await f.page.getByRole('button',{name:'导出 PDF',exact:true}).click();
 await f.page.waitForFunction(()=>(window as any).printCalls===1);
 assert.equal(await f.page.locator('#ppte-print').count(),0);assert.deepEqual(await readdir(f.root),['作品.html']);
 }finally{await f.close();}
});

test('H04 actual fullscreen exit, Grid slide layout, print from presentation, mount and read return',async()=>{
 const f=await setup();try{const p=f.page;
 await p.evaluate(async()=>{const api=(window as any).PPTeHTML;await api.mount(api.content().replace('section{','section{display:grid;grid-template-columns:1fr 1fr;'));});
 await p.evaluate(()=>{delete (document.documentElement as any).requestFullscreen;});
 await p.getByRole('button',{name:'放映',exact:true}).click();
 await p.waitForFunction(()=>!!document.fullscreenElement);
 assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-slide=one]').evaluate(n=>getComputedStyle(n).display),'grid');
 await p.evaluate(()=>document.exitFullscreen());await p.waitForFunction(()=>!(window as any).PPTePlayer.running);
 assert.equal(await p.locator('#ppte-workspace').isVisible(),false);
 await p.getByRole('button',{name:'放映',exact:true}).click();
 await p.evaluate(()=>(window as any).PPTePrint.prepare());
 assert.equal(await p.evaluate(()=>(window as any).PPTePlayer.running),false);
 await p.evaluate(()=>(window as any).PPTePrint.restore());
 assert.equal(await p.locator('#ppte-save-ui').isVisible(),true);assert.equal(await p.locator('#ppte-workspace').isVisible(),false);
 }finally{await f.close();}
});
