import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFile} from 'node:fs/promises';
const out=resolve('docs/ui-redesign/evidence/r8-R5');
const b=await chromium.launch({channel:'chrome',headless:true}),p=await b.newPage({offline:true,viewport:{width:1440,height:960}}),network=[],errors=[];p.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});p.on('pageerror',e=>errors.push(String(e)));
try{for(const kind of ['product','prototype']){await p.setViewportSize({width:1440,height:960});await p.goto(pathToFileURL(kind==='product'?out+'/sample.ppte.html':resolve('docs/ui-redesign/UI_PROTOTYPE.html')).href);if(kind==='product')await p.waitForFunction(()=>window.PPTeEditor);await p.getByRole('button',{name:'编辑',exact:true}).click();await(kind==='product'?p.frameLocator('#ppte-frame').locator('[data-id=title1]'):p.locator('#slide [data-id=title1]')).click();for(const width of [1440,1024,390]){await p.setViewportSize({width,height:width===390?844:960});await p.waitForTimeout(250);await p.screenshot({path:out+`/${kind}-${width}.png`});}}await writeFile(out+'/verification/comparison.json',JSON.stringify({browser:b.version(),offline:true,network,errors,time:new Date().toISOString()},null,2));if(errors.length||network.length)throw Error('Offline comparison failed');}finally{await b.close();}
