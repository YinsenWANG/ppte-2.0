// Acceptance-only probe. Run after building and generating the delivered file.
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
const out=resolve('docs/single-file-first/evidence/s08');
const filename='把作品带走.ppte.html';
const original=join(out,'delivery',filename), sha=b=>createHash('sha256').update(b).digest('hex');
assert.deepEqual(await readdir(join(out,'delivery')),[filename]);
const bytes=await readFile(original), temp=await mkdtemp(join(tmpdir(),'ppte-s08-final-'));
const isolated=join(temp,filename);await copyFile(original,isolated);
const requests=[], errors=[], screenshots=[], bounds=[];
let browser;
try {
 browser=await chromium.launch({channel:'chrome',headless:true});const version=browser.version();
 const context=await browser.newContext({offline:true,acceptDownloads:true,viewport:{width:1440,height:1000}});
 context.on('request',r=>requests.push(r.url()));const p=await context.newPage();p.on('pageerror',e=>errors.push(String(e)));
 await p.goto(pathToFileURL(isolated).href);await p.waitForFunction(()=>!!window.PPTeSave);
 assert.equal(await p.getByRole('button',{name:'编辑',exact:true}).isVisible(),true);
 const slides=p.frameLocator('#ppte-frame').locator('[data-ppte-slide]');assert.equal(await slides.count(),4);
 for(let i=0;i<4;i++){
  const violations=await slides.nth(i).evaluate(s=>{const r=s.getBoundingClientRect();return [...s.querySelectorAll('h1,h2,h3,p,.label,.foot')].filter(n=>{const b=n.getBoundingClientRect();return b.left<r.left-1||b.right>r.right+1||b.top<r.top-1||b.bottom>r.bottom+1||n.scrollWidth>n.clientWidth+1||n.scrollHeight>n.clientHeight+1;}).map(n=>n.textContent);});
  bounds.push({slide:i+1,violations});assert.deepEqual(violations,[]);
  const name=`page-${i+1}.png`;await slides.nth(i).screenshot({path:join(out,name)});screenshots.push(name);
 }
 await p.getByRole('button',{name:'编辑',exact:true}).click();
 const title=p.frameLocator('#ppte-frame').locator('h1');await title.fill('离线修改验证');
 const event=p.waitForEvent('download');await p.getByRole('button',{name:'下载更新后的文件',exact:true}).click();
 const download=await event;assert.match(download.suggestedFilename(),/\.ppte\.html$/);
 const updated=join(out,'verification','updated.ppte.html');await download.saveAs(updated);assert.equal(await download.failure(),null);
 assert.match(await p.getByRole('status').innerText(),/原文件未覆盖/);assert.equal(sha(await readFile(isolated)),sha(bytes));
 await browser.close();browser=await chromium.launch({channel:'chrome',headless:true});
 const fresh=await browser.newContext({offline:true});fresh.on('request',r=>requests.push(r.url()));
 const q=await fresh.newPage();q.on('pageerror',e=>errors.push(String(e)));await q.goto(pathToFileURL(updated).href);await q.waitForFunction(()=>!!window.PPTePlayer);
 assert.equal(await q.frameLocator('#ppte-frame').locator('h1').innerText(),'离线修改验证');
 await q.getByRole('button',{name:'编辑',exact:true}).click();assert.equal(await q.frameLocator('#ppte-frame').locator('h1').getAttribute('contenteditable'),'true');
 await q.getByRole('button',{name:'放映',exact:true}).click();
 const visible=[];for(let i=0;i<4;i++){const s=q.frameLocator('#ppte-frame').locator('[data-ppte-slide]');const states=await s.evaluateAll(ns=>ns.map(n=>getComputedStyle(n).display!=='none'));assert.equal(states.filter(Boolean).length,1);assert.equal(states[i],true);visible.push(states);if(i<3)await q.keyboard.press('ArrowRight');}
 await q.keyboard.press('Escape');assert.equal(await q.locator('#ppte-save-ui').isVisible(),true);
 assert.deepEqual(requests.filter(u=>/^(https?|wss?):/.test(u)),[]);assert.deepEqual(errors,[]);
 await writeFile(join(out,'final-single-file.json'),JSON.stringify({status:'passed-automation',timestamp:new Date().toISOString(),file:'docs/single-file-first/evidence/s08/delivery/'+filename,sha256:sha(bytes),bytes:bytes.length,slides:4,browser:version,headless:true,offline:true,isolatedCopy:true,sourceAccessRequired:false,downloadReopenedInFreshBrowser:true,originalUnchanged:true,updatedSha256:sha(await readFile(updated)),visible,bounds,screenshots,requests,errors,nativePicker:'pending: explicit download only; no mock picker',safari:'pending: not exercised by this probe',noNodeDevice:'pending: development host has Node',human:'pending'},null,2)+'\n');
}finally{await browser?.close();await rm(temp,{recursive:true,force:true});}
