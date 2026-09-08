// Ancillary check of the shipped file. Binding UI acceptance is separately run
// by node --test dist/tests/usability-reset-u02.test.js.
import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const file=join(root,'Cherry-U02.ppte.html'),bytes=await readFile(file);
const sha=b=>createHash('sha256').update(b).digest('hex');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const p=await browser.newPage({offline:true,viewport:{width:1440,height:1000}});
 p.setDefaultTimeout(10000);p.on('filechooser',()=>{});
 await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!window.PPTeEditor);
 const baseline=await p.evaluate(()=>window.PPTeHTML.content());
 // Avoid Playwright caret hiding, which rewrites author style serialization even
 // before editing. Captures are evidence, not a reason to mutate that baseline.
 await p.screenshot({caret:'initial',path:join(root,'screenshots/Cherry-read.png')});
 await p.getByRole('button',{name:'编辑',exact:true}).click();
 const event=p.waitForEvent('filechooser');await p.getByRole('button',{name:'插入图片',exact:true}).click();
 await(await event).setFiles({name:'smoke.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=','base64')});
 await p.frameLocator('#ppte-frame').locator('img[data-ppte-editor-selected]').waitFor();
 await p.getByRole('button',{name:'裁切',exact:true}).click();
 await p.screenshot({caret:'initial',path:join(root,'screenshots/Cherry-crop-smoke.png')});
 await p.getByRole('button',{name:'取消',exact:true}).click();
 await p.getByRole('button',{name:'撤销',exact:true}).click();
 assert.equal(await p.evaluate(()=>window.PPTeHTML.content()),baseline);
 assert.equal(sha(await readFile(file)),sha(bytes));
 await writeFile(join(root,'journeys/delivery-smoke.json'),JSON.stringify({status:'passed',headless:true,nativePicker:false,version:browser.version(),time:new Date().toISOString(),entry:'file://',actions:['read','edit','insert via actual chooser event','crop','cancel','undo insertion'],diskUnchanged:true,sha256:sha(bytes),authorContentRestored:true,caret:'initial'},null,2));
 console.log('Delivery smoke passed; file remains clean and unchanged.');
} finally {await browser.close();}
