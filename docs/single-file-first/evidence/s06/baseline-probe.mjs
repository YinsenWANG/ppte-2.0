// Run after pnpm build on baseline commit 5e575916; output /tmp/s06-baseline-result.json.
import { chromium } from 'playwright';
import { enhanceHTML } from '../../../../dist/packages/html-document/src/index.js';
import { writeFile } from 'node:fs/promises';
const b=await chromium.launch({channel:'chrome',headless:true});const p=await b.newPage();
const src=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=1024;c.height=768;const x=c.getContext('2d'),d=x.createImageData(c.width,c.height);let seed=17;for(let i=0;i<d.data.length;i+=4){seed=(seed*1664525+1013904223)>>>0;d.data[i]=seed&255;d.data[i+1]=(seed>>>8)&255;d.data[i+2]=(seed>>>16)&255;d.data[i+3]=255;}x.putImageData(d,0,0);return c.toDataURL();});
const content='<section data-ppte-slide data-ppte-id="s">'+Array.from({length:12},(_,i)=>`<img data-ppte-id="i${i}" src="${src}" style="width:200px;height:100px;object-fit:contain">`).join('')+'</section>';
const html=(await enhanceHTML(content,{root:'/tmp',base:'/tmp'})).html;await writeFile('/tmp/s06-baseline.ppte.html',html);await p.goto('file:///tmp/s06-baseline.ppte.html');await p.waitForFunction(()=>window.PPTeEditor);const result=await p.evaluate(()=>{const c=window.PPTeEditor.commands;for(let i=0;i<10;i++)c.style(['i0'],'object-fit',i%2?'contain':'cover');return {historyStringBytes:JSON.stringify(c.undoStack).length*2,entries:c.undoStack.length};});
await writeFile('/tmp/s06-source.txt',src);await writeFile('/tmp/s06-baseline-result.json',JSON.stringify({fixture:'deterministic synthetic noise; not authorized-photo acceptance',fileBytes:Buffer.byteLength(html),sourceBytes:Buffer.from(src.split(',')[1],'base64').length,...result},null,2));await b.close();
