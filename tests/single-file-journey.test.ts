import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { enhanceHTML } from '../packages/html-document/src/index.js';

const out=resolve('artifacts/s07');
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
test('S07 continuous file journey: offline download, browser shutdown, fresh reopen, presentation and optional PDF',async()=>{
 await mkdir(out,{recursive:true});
 const delivery=join(out,'delivery');await mkdir(delivery,{recursive:true});
 const media='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="#ff0000"/><rect x="80" width="80" height="80" fill="#0000ff"/></svg>').toString('base64');
 const result=await enhanceHTML(`<title>S07 offline journey</title><style>body{margin:0}section{box-sizing:border-box;width:960px;height:540px;padding:40px;background:white;color:#123;font:24px Arial}img{width:160px;height:80px}h1{font-size:48px}</style><section data-ppte-slide data-ppte-notes="Private notes"><h1>Offline original</h1><p data-ppte-step>Complete reveal</p><img src="${media}"></section><section data-ppte-slide><h1>Second slide</h1><p data-ppte-step>Final reveal</p></section>`,{root:out,base:out});
 assert.deepEqual(result.issues,[]);
 const original=join(delivery,'作品.ppte.html');await writeFile(original,result.html);
 assert.deepEqual(await readdir(delivery),['作品.ppte.html']);
 const requests:string[]=[],errors:string[]=[];
 let browser=await chromium.launch({channel:'chrome',headless:true});
 const version=browser.version();let capabilities:unknown;
 const downloaded=join(out,'updated.ppte.html');
 try{
  const context=await browser.newContext({offline:true,acceptDownloads:true});
  context.on('request',r=>requests.push(r.url()));
  const p=await context.newPage();p.on('pageerror',e=>errors.push(String(e)));
  await p.goto(pathToFileURL(original).href);await p.waitForFunction(()=>!!(window as any).PPTeSave);
  capabilities=await p.evaluate(()=>({protocol:location.protocol,secure:isSecureContext,openPicker:typeof(window as any).showOpenFilePicker,savePicker:typeof(window as any).showSaveFilePicker,userAgent:navigator.userAgent}));
  assert.equal(await p.getByRole('button',{name:'编辑',exact:true}).isVisible(),true);
  await p.getByRole('button',{name:'编辑',exact:true}).click();
  await p.frameLocator('#ppte-frame').locator('h1').first().fill('Offline updated');
  const event=p.waitForEvent('download');await p.getByRole('button',{name:'下载更新后的文件',exact:true}).click();
  const d=await event;assert.match(d.suggestedFilename(),/\.ppte\.html$/);await d.saveAs(downloaded);assert.equal(await d.failure(),null);
  assert.match(await p.getByRole('status').innerText(),/原文件未覆盖/);
  assert.equal(await readFile(original,'utf8'),result.html);
 }finally{await browser.close();}
 // Entire browser process and storage context are replaced: recovery cannot supply the edited content.
 browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({offline:true});context.on('request',r=>requests.push(r.url()));
  const p=await context.newPage();p.on('pageerror',e=>errors.push(String(e)));
  await p.goto(pathToFileURL(downloaded).href);await p.waitForFunction(()=>!!(window as any).PPTePlayer);
  assert.equal(await p.frameLocator('#ppte-frame').locator('h1').first().innerText(),'Offline updated');
  await p.frameLocator('#ppte-frame').locator('img').evaluate(async n=>{await (n as HTMLImageElement).decode();});
  await p.getByRole('button',{name:'编辑',exact:true}).click();
  assert.equal(await p.frameLocator('#ppte-frame').locator('h1').first().getAttribute('contenteditable'),'true');
  await p.getByRole('button',{name:'放映',exact:true}).click();
  assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-step]').first().isVisible(),false);
  await p.keyboard.press('ArrowRight');assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-step]').first().isVisible(),true);
  await p.keyboard.press('Escape');assert.equal(await p.locator('#ppte-save-ui').isVisible(),true);
  assert.equal(await p.locator('#ppte-print').count(),0);
  await p.evaluate(()=>(window as any).PPTePrint.prepare());await p.emulateMedia({media:'print'});
  assert.equal(await p.locator('#ppte-print>div').count(),2);
  for(const n of await p.locator('#ppte-print [data-ppte-step]').all())assert.equal(await n.isVisible(),true);
  assert.equal(await p.locator('#ppte-save-ui').isVisible(),false);
  // Check both ends of the actual decoded print image, not only its URL or presence.
  const pixels=await p.locator('#ppte-print img').evaluate(async n=>{const im=n as HTMLImageElement;await im.decode();const c=document.createElement('canvas');c.width=160;c.height=80;const x=c.getContext('2d')!;x.drawImage(im,0,0);return [Array.from(x.getImageData(0,40,1,1).data),Array.from(x.getImageData(159,40,1,1).data)];});
  assert.deepEqual(pixels,[[255,0,0,255],[0,0,255,255]]);
  await p.pdf({path:join(out,'journey.pdf'),preferCSSPageSize:true,printBackground:true});
  const inspected=spawnSync('swift',['scripts/verify-journey-pdf.swift',join(out,'journey.pdf')],{encoding:'utf8'});
  assert.equal(inspected.status,0,inspected.stderr);const pdfPages=JSON.parse(inspected.stdout);
  assert.equal(pdfPages.length,2);assert.match(pdfPages[0].text,/Offline updated/);assert.match(pdfPages[0].text,/Complete reveal/);
  assert.match(pdfPages[1].text,/Second slide/);assert.match(pdfPages[1].text,/Final reveal/);
  for(const page of pdfPages){assert.ok(Math.abs(page.width-720)<1);assert.ok(Math.abs(page.height-405)<1);assert.doesNotMatch(page.text,/编辑|保存|Private notes/);}
  assert.ok(pdfPages[0].redPixels>4000);assert.ok(pdfPages[0].bluePixels>4000);
  await writeFile(join(out,'pdf-inspection.json'),JSON.stringify(pdfPages,null,2));
  await p.screenshot({path:join(out,'print.png'),fullPage:true});
  await p.emulateMedia({media:'screen'});await p.evaluate(()=>(window as any).PPTePrint.restore());
  assert.equal(await p.locator('#ppte-save-ui').isVisible(),true);
  assert.deepEqual(requests.filter(u=>/^(https?|wss?):/.test(u)),[]);assert.deepEqual(errors,[]);
  await writeFile(join(out,'journey.json'),JSON.stringify({status:'passed-automation',browser:version,headless:true,capabilities,offline:true,freshBrowserReopen:true,pickerMocked:false,savePath:'explicit download; Playwright saveAs captures actual browser download',originalHash:sha(result.html),originalAfterHash:sha(await readFile(original)),downloadHash:sha(await readFile(downloaded)),printImageEdgePixels:pixels,requests,errors,noNodeMachine:'pending: development host has Node installed',nativePicker:'pending: not exercised',nativeIME:'pending: no operating-system IME input',nativePrintDialog:'pending: PDF API only',human:'pending'},null,2));
 }finally{await browser.close();}
});
