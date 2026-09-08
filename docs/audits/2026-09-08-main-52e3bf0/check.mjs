import {chromium} from 'playwright';
import {enhanceHTML} from '../../../dist/packages/html-document/src/index.js';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const out=resolve('docs/audits/2026-09-08-main-52e3bf0'),root=resolve('docs/usability-reset/evidence/U01/source');
await writeFile(out+'/review.ppte.html',(await enhanceHTML(await readFile(root+'/full-deck.html','utf8'),{root,base:root})).html);
const b=await chromium.launch({channel:'chrome',headless:true});let results=[];
try{for(const width of [1440,1024,390]){const p=await b.newPage({viewport:{width,height:960},offline:true});await p.goto(pathToFileURL(out+'/review.ppte.html').href);await p.getByRole('button',{name:'编辑',exact:true}).waitFor();const measure=async label=>{const r=await p.locator('#ppte-save-ui').evaluate(el=>Array.from(el.querySelectorAll('button,summary,strong')).filter(n=>n.getBoundingClientRect().width).map(n=>{const r=n.getBoundingClientRect();return {text:n.textContent,x:r.x,y:r.y,width:r.width,height:r.height}}));results.push({width,state:label,controls:r});await p.screenshot({path:out+'/'+width+'-'+label+'.png',caret:'initial'});};await measure('read');await p.getByRole('button',{name:'编辑',exact:true}).click();await measure('edit');const title=p.frameLocator('#ppte-frame').locator('h1').first();await title.fill('开源之路 · 编辑测试');await measure('dirty');await p.getByRole('button',{name:'阅读',exact:true}).click();await measure('read-again');await p.close();}await writeFile(out+'/positions.json',JSON.stringify(results,null,2));console.log(results.map(r=>({width:r.width,state:r.state,controls:r.controls.filter(c=>['阅读','编辑','放映','导出为 PDF'].includes(c.text))})));}finally{await b.close();}
