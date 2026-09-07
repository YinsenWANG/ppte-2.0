import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
const root=resolve('docs/ui-redesign/evidence/r8-R2');
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[],network=[];
try {
 const p=await browser.newPage({offline:true,viewport:{width:1440,height:960}});
 p.on('pageerror',e=>errors.push(String(e)));p.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
 await p.goto(pathToFileURL(root+'/sample.ppte.html').href);await p.waitForFunction(()=>!!window.PPTeEditor);
 assert.equal(await p.locator('#ppte-save-ui').getAttribute('data-mode'),'read');
 await p.getByRole('button',{name:'编辑',exact:true}).click();
 const frame=p.frameLocator('#ppte-frame');await frame.locator('[data-id=title1]').click();
 await p.getByRole('button',{name:'插入',exact:true}).click();await p.getByRole('menuitem',{name:'形状',exact:true}).click();await p.getByRole('menuitem',{name:'矩形',exact:true}).click();
 const object=frame.locator('[data-ppte-kind=shape]');await object.click();const before=await object.boundingBox();await p.keyboard.press('Alt+ArrowRight');const after=await object.boundingBox();assert.equal(after.x,before.x+8);
 assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
 await writeFile(root+'/verification/cli-sample.json',JSON.stringify({timestamp:new Date().toISOString(),status:'passed',browser:browser.version(),headless:true,offline:true,entry:'file://',path:'sample.ppte.html',initialMode:'read',mouseInsert:true,before,after,keyboardDelta:8,errors,network},null,2));
}finally{await browser.close();}
