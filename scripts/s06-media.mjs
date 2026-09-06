import { chromium } from 'playwright';
import { enhanceHTML } from '../dist/packages/html-document/src/index.js';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const out=resolve(process.argv[2] ?? 'artifacts/s06-stress');await mkdir(out,{recursive:true});const root=await mkdtemp(join(tmpdir(),'s06-stress-'));
const b=await chromium.launch({channel:'chrome',headless:true});const p=await b.newPage();
const src=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=1024;c.height=768;const x=c.getContext('2d'),d=x.createImageData(c.width,c.height);let seed=17;for(let i=0;i<d.data.length;i+=4){seed=(seed*1664525+1013904223)>>>0;d.data[i]=seed&255;d.data[i+1]=(seed>>>8)&255;d.data[i+2]=(seed>>>16)&255;d.data[i+3]=255;}x.putImageData(d,0,0);return c.toDataURL();});
const content='<section data-ppte-slide data-ppte-id="s">'+Array.from({length:12},(_,i)=>`<img data-ppte-id="i${i}" src="${src}" style="width:200px;height:100px;object-fit:contain">`).join('')+'</section>';
const records=[];
try {
 for(const mediaTable of [false,true]) {
  const start=performance.now();const html=(await enhanceHTML(content,{root,base:root,mediaTable})).html;const enhanceMs=performance.now()-start;
  const file=join(root,'stress.ppte.html');await writeFile(file,html);await p.context().setOffline(true);
  const session=await p.context().newCDPSession(p);await session.send('Performance.enable');
  const openStart=performance.now();await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>window.PPTeEditor);const openToEditorMs=performance.now()-openStart;
  const decoded=await p.evaluate(async()=>{const start=performance.now();const images=Array.from(window.PPTeEditor.commands.doc.images);await Promise.all(images.map(n=>n.decode()));return {decodeWaitMs:performance.now()-start,dimensions:images.map(n=>[n.naturalWidth,n.naturalHeight]),decodedPixelBytesUpperSum:images.reduce((sum,n)=>sum+n.naturalWidth*n.naturalHeight*4,0)};});
  const metricsBefore=await session.send('Performance.getMetrics');
  const history=await p.evaluate(()=>{const c=window.PPTeEditor.commands;const start=performance.now();for(let i=0;i<10;i++)c.style(['i0'],'object-fit',i%2?'contain':'cover');return {historyMutationMs:performance.now()-start,historyStringBytes:JSON.stringify(c.undoStack).length*2,entries:c.undoStack.length,interned:c.mediaHistory.stats};});
  const saved=await p.evaluate(()=>{const start=performance.now();const html=window.PPTeHTML.serialize();return {html,serializeMs:performance.now()-start};});
  const metricsAfter=await session.send('Performance.getMetrics');
  await writeFile(join(out,mediaTable?'stress-table.ppte.html':'stress-legacy.ppte.html'),saved.html);
  records.push({mediaTable,fileBytes:Buffer.byteLength(html),gzipBytes:gzipSync(html).length,enhanceMs,openToEditorMs,...decoded,...history,serializeMs:saved.serializeMs,savedFileBytes:Buffer.byteLength(saved.html),metricsBefore,metricsAfter});
  await session.detach();
 }
 await writeFile(join(out,'resource-lifecycle-and-size-results.json'),JSON.stringify({browser:b.version(),node:process.version,platform:process.platform,arch:process.arch,fixture:'12 repeats of one deterministic synthetic PNG; not 12 real photographs',sourceBytes:Buffer.from(src.split(',')[1],'base64').length,sourceSha256:createHash('sha256').update(Buffer.from(src.split(',')[1],'base64')).digest('hex'),lossyTransforms:0,notes:['decodeWait is remaining wait after editor became ready, not total codec CPU time','decodedPixelBytesUpperSum is RGBA accounting, not measured native image memory; browser may share decoded images','CDP JSHeapUsedSize is measured JS heap, not renderer RSS/GPU/native decoded allocation','no media blob URLs are created; opt-in table expands to data URLs, so DOM/decoder memory is not optimized','one engineering run per mode, no frozen reference or low-performance device'],records},null,2));
}finally{await b.close();await rm(root,{recursive:true,force:true});}
