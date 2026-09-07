import test from 'node:test';
import assert from 'node:assert/strict';
import { Versions } from '../packages/html-editor/src/versions.js';
import { cleanContent } from '../packages/html-document/src/content.js';
import { mediaDigest, packMedia } from '../packages/html-document/src/media-table.js';
import { enhanceHTML, readEnhanced } from '../packages/html-document/src/index.js';
import { readHistory, historyHTML } from '../packages/html-document/src/history-wire.js';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const doc='a'.repeat(32),html=(text:string)=>cleanContent(`<section data-ppte-slide><h1>${text}</h1></section>`).html;
test('UI07 A1: named checkpoints deduplicate; restore is atomic and retains target, later and before-restore states',()=>{
 const h=new Versions(doc);const a=h.add(html('A'),'manual','First',1)!;h.add(html('B'),'manual','Second',2);
 assert.equal(h.add(html('A'),'manual','Renamed',3)!.id,a.id);assert.equal(h.index.versions.length,2);
 const state=JSON.stringify(h.wire());assert.match(h.preview(a.id),/>A</);assert.equal(JSON.stringify(h.wire()),state);
 assert.equal(h.restore(a.id,html('unsaved')),html('A'));assert.equal(h.index.versions.length,3);
 assert.equal(h.index.versions.at(-1)!.restoredFrom,a.id);assert.match(h.preview(h.index.versions.at(-1)!.id),/unsaved/);
 assert.match(h.preview(a.id),/>A</);assert.match(h.preview(h.index.versions[1].id),/>B</);
});
test('UI07 A3: 5 minute generation, count/bytes quotas, named retention and failed pre-restore preserve all history',()=>{
 const h=new Versions(doc);h.add(html('named'),'manual','keep',1);h.limits(2,8192,html('now'));
 h.automatic(html('auto1'),300001);assert.equal(h.automatic(html('too soon'),300002),undefined);
 h.automatic(html('auto2'),600001);h.automatic(html('auto3'),900001);
 assert.equal(h.index.versions.length,3);assert.equal(h.index.versions[0].name,'keep');assert.match(h.preview(h.index.versions[1].id),/auto2/);
 const before=JSON.stringify(h.wire());assert.throws(()=>h.restore(h.index.versions[0].id,html('x'.repeat(12000))),/容量/);assert.equal(JSON.stringify(h.wire()),before);
 assert.equal(h.automatic(html('y'.repeat(12000)),1200001),undefined);assert.match(h.warning,/当前内容仍可保存/);assert.equal(JSON.stringify(h.wire()),before);
 h.remove(h.index.versions[1].id);for(const v of h.index.versions)assert.ok(h.preview(v.id));
 assert.throws(()=>h.limits(201,1024,html('x')),/容量/);
});
test('UI07 A2/A4: portable wire, shared media across current and checkpoints, lazy decode and independent checkpoints after deletion',()=>{
 const image='data:image/png;base64,'+Buffer.alloc(6000,17).toString('base64');
 const content=(n:number)=>cleanContent(`<section data-ppte-slide><h1>${n}</h1><img src="${image}"><img src="${image}"></section>`).html;
 const h=new Versions(doc);const a=h.add(content(1),'manual','one',1)!;h.add(content(2),'manual','two',2);
 assert.equal(h.decoded,0);const current=packMedia(content(3)).table.resources,w=h.wire(current)!;
 assert.equal(Object.keys(w.resources).length,0);assert.equal(Object.keys(h.wire()!.resources).length,1);
 assert.equal(Object.keys(w.blocks).length,2);assert.ok(Object.values(w.blocks).every(s=>!s.includes('base64')));
 const reopened=new Versions(doc,structuredClone(w),()=>current);assert.equal(reopened.index.versions.length,2);assert.equal(reopened.decoded,0);
 assert.equal(reopened.preview(a.id),content(1));assert.equal(reopened.decoded,1);
 reopened.remove(a.id);assert.equal(Object.keys(reopened.wire()!.blocks).length,1);assert.equal(reopened.preview(reopened.index.versions[0].id),content(2));
 // Saving an unchanged opaque history after current media deletion must retain old shared bytes.
 const opaque=new Versions(doc,w,()=>current);const portable=opaque.wire({})!;assert.equal(Object.keys(portable.resources).length,1);
 assert.equal(new Versions(doc,portable).preview(a.id),content(1));
});
test('UI07 A5: truncation, unknown schema, missing resource, bad checkpoint, hostile HTML and expansion limits are isolated',()=>{
 for(const raw of ['{',JSON.stringify({schemaVersion:99})]){const wire={index:raw,blocks:{},resources:{}};const h=new Versions(doc,wire);assert.throws(()=>h.index);assert.equal(h.wire()!.index,raw);assert.match(h.warning,/原始历史保留/);}
 const h=new Versions(doc);const a=h.add(html('safe'),'manual','safe',1)!;const wire=h.wire()!;
 const missing=structuredClone(wire);delete missing.blocks[a.block];assert.throws(()=>new Versions(doc,missing).preview(a.id),/检查点/);
 const hostile=structuredClone(wire),script='<section data-ppte-slide><script>parent.pwned=1</script></section>',id=mediaDigest(script);const index=JSON.parse(hostile.index);index.versions[0].block=id;hostile.index=JSON.stringify(index);hostile.blocks[id]=script;assert.throws(()=>new Versions(doc,hostile).preview(a.id),/不安全/);
 const image='data:image/png;base64,'+Buffer.alloc(6000).toString('base64'),withMedia=new Versions(doc);const v=withMedia.add(cleanContent(`<section data-ppte-slide><img src="${image}"></section>`).html,'manual','media',2)!;
 const absent=withMedia.wire()!;absent.resources={};assert.throws(()=>new Versions(doc,absent).preview(v.id),/资源缺失/);
 const huge=structuredClone(wire);huge.blocks[a.block]='x'.repeat(32*1024*1024+1);assert.throws(()=>new Versions(doc,huge).preview(a.id),/检查点/);
 assert.equal(readHistory('<html><body>'+historyHTML(wire)+'</body></html>')!.index,wire.index);
});
test('UI07 A2/A5: CLI re-enhancement preserves opaque history and single-file identity',async()=>{
 const root=resolve('artifacts/ui07');await mkdir(root,{recursive:true});const first=await enhanceHTML(html('current'),{root,base:root});
 const h=new Versions(first.metadata.documentId);h.add(html('old'),'manual','portable');const withHistory=first.html.replace('</body>',historyHTML(h.wire())+'</body>');
 const second=await enhanceHTML(withHistory,{root,base:root});assert.equal(second.metadata.documentId,first.metadata.documentId);assert.match(new Versions(first.metadata.documentId,readHistory(second.html)).preview(h.index.versions[0].id),/old/);
});

test('UI07 A1–A6: product controls, actual offline download, copied file in fresh process, preview/restore and media timings',async()=>{
 const out=resolve('artifacts/ui07');await mkdir(join(out,'copied'),{recursive:true});let browser=await chromium.launch({channel:'chrome',headless:true});
 const timings:Record<string,number>={};const start=()=>performance.now();let t=0;
 try{
  let page=await browser.newPage({offline:true,acceptDownloads:true,viewport:{width:1440,height:1000}});
  // Real encoded raster pixels and a playable checked-in WebM; no fabricated perf telemetry.
  const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=800;c.height=450;const x=c.getContext('2d')!;for(let i=0;i<450;i++){x.fillStyle=`hsl(${i},45%,60%)`;x.fillRect(0,i,800,1);}return c.toDataURL('image/png');});
  const video=await readFile('tests/fixtures/media/blue-vp9.webm');
  const input=`<title>可携带的版本</title><style>body{margin:0}section{width:960px;height:640px;padding:30px;box-sizing:border-box;background:#f8f7f2;color:#24493c}img{width:300px}video{width:120px}</style><section data-ppte-slide><h1>起点</h1><img src="${image}"><img src="${image}"><video controls muted src="data:video/webm;base64,${video.toString('base64')}"></video></section>`;
  const file=join(out,'input.ppte.html');await writeFile(file,(await enhanceHTML(input,{root:out,base:out,mediaTable:true})).html);
  const network:string[]=[];page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  t=start();await page.goto(pathToFileURL(file).href);await page.waitForFunction(()=>!!(window as any).PPTeSave);timings.firstOpenMs=start()-t;
  assert.equal(await page.evaluate(()=>(window as any).PPTeHTML.versions.decoded),0);
  await page.getByRole('button',{name:'编辑',exact:true}).click();await page.frameLocator('#ppte-frame').locator('h1').fill('第一稿');
  await page.getByText('更多',{exact:true}).click();await page.getByRole('menuitem',{name:'版本历史',exact:true}).click();
  page.once('dialog',d=>d.accept('可回到这里'));t=start();await page.getByRole('button',{name:'保存命名版本',exact:true}).click();await page.locator('#ppte-versions section').filter({hasText:'可回到这里'}).waitFor();timings.createVersionMs=start()-t;
  await page.getByRole('button',{name:'关闭版本历史',exact:true}).click();await page.frameLocator('#ppte-frame').locator('h1').fill('第二稿 · 未保存');
  await page.getByText('更多',{exact:true}).click();await page.getByRole('menuitem',{name:'版本历史',exact:true}).click();page.once('dialog',d=>d.accept('第二稿'));await page.getByRole('button',{name:'保存命名版本',exact:true}).click();await page.getByRole('button',{name:'关闭版本历史',exact:true}).click();
  t=start();const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载更新后的文件',exact:true}).click();const saved=join(out,'saved.ppte.html');await(await download).saveAs(saved);timings.downloadMs=start()-t;
  const savedText=await readFile(saved,'utf8');assert.equal(savedText.split(image).length-1,1);assert.match(await page.getByRole('status').innerText(),/原文件未覆盖/);
  await browser.close();await copyFile(saved,join(out,'copied','portable.ppte.html'));
  browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({offline:true,acceptDownloads:true,viewport:{width:1440,height:1000}});
  t=start();await page.goto(pathToFileURL(join(out,'copied','portable.ppte.html')).href);await page.waitForFunction(()=>!!(window as any).PPTeSave);timings.freshOpenMs=start()-t;
  assert.equal(await page.evaluate(()=>localStorage.length),0);assert.equal(await page.evaluate(()=>(window as any).PPTeHTML.versions.decoded),0);
  await page.getByText('更多',{exact:true}).click();await page.getByRole('menuitem',{name:'版本历史',exact:true}).click();assert.equal(await page.getByRole('button',{name:'恢复到此版本',exact:true}).count(),0);
  const target=page.locator('#ppte-versions section').filter({hasText:'可回到这里'});t=start();await target.getByRole('button',{name:'预览',exact:true}).click();await page.locator('iframe[title="版本预览（只读）"]').waitFor();timings.previewMs=start()-t;
  assert.equal(await page.frameLocator('iframe[title="版本预览（只读）"]').locator('h1').innerText(),'第一稿');assert.equal(await page.frameLocator('#ppte-frame').locator('h1').innerText(),'第二稿 · 未保存');assert.equal(await page.evaluate(()=>(window as any).PPTeSave.dirty),false);
  await page.getByRole('button',{name:'关闭版本历史',exact:true}).click();await page.getByRole('button',{name:'编辑',exact:true}).click();await page.frameLocator('#ppte-frame').locator('h1').fill('恢复前的临时内容');
  await page.getByText('更多',{exact:true}).click();await page.getByRole('menuitem',{name:'版本历史',exact:true}).click();page.once('dialog',d=>{assert.match(d.message(),/当前内容会先保留/);return d.accept();});t=start();await target.getByRole('button',{name:'恢复到此版本',exact:true}).click();await page.waitForFunction(()=>(window as any).PPTeHTML.content().includes('第一稿'));timings.restoreMs=start()-t;
  await page.locator('#ppte-versions section').filter({hasText:'恢复前'}).getByRole('button',{name:'预览',exact:true}).click();assert.equal(await page.frameLocator('iframe[title="版本预览（只读）"]').locator('h1').innerText(),'恢复前的临时内容');
  assert.equal(await page.evaluate(()=>(window as any).PPTeSave.dirty),true);await page.screenshot({path:join(out,'history-restored.png')});
  const stripped=page.waitForEvent('download');await page.locator('#ppte-versions').getByRole('button',{name:'下载不含历史的文件',exact:true}).click();const clean=join(out,'no-history.ppte.html');await(await stripped).saveAs(clean);const cleanText=await readFile(clean,'utf8');assert.equal(readHistory(cleanText),undefined);assert.doesNotMatch(readEnhanced(cleanText).content,/恢复前的临时内容|第二稿/);
  await page.getByRole('button',{name:'关闭版本历史',exact:true}).click();const redownload=page.waitForEvent('download');await page.getByRole('button',{name:'下载更新后的文件',exact:true}).click();const final=join(out,'sample.ppte.html');await(await redownload).saveAs(final);
  const finalText=await readFile(final,'utf8');const wire=readHistory(finalText)!;const media=packMedia(readEnhanced(finalText).content).table.resources;const reopened=new Versions(readEnhanced(finalText).metadata.documentId,wire,()=>media);assert.ok(reopened.index.versions.some(v=>v.kind==='before-restore'));assert.equal(finalText.split(image).length-1,1);
  // Truncated index cannot prevent current reading; opaque bytes survive normal export.
  const broken=finalText.replace(/(<script id="ppte-history-index"[^>]*>)[\s\S]*?(<\/script>)/,'$1{$2');const badFile=join(out,'broken.ppte.html');await writeFile(badFile,broken);const bad=await browser.newPage({offline:true});await bad.goto(pathToFileURL(badFile).href);await bad.waitForFunction(()=>!!(window as any).PPTeSave);assert.equal(await bad.frameLocator('#ppte-frame').locator('h1').innerText(),'第一稿');assert.match(await bad.getByRole('alert').innerText(),/原始历史保留/);assert.equal(readHistory(await bad.evaluate(()=>(window as any).PPTeHTML.serialize()))!.index,'{');
  assert.deepEqual(network,[]);
  await writeFile(join(out,'journey.json'),JSON.stringify({status:'passed',time:new Date().toISOString(),browser:browser.version(),offline:true,freshBrowserProcess:true,copiedDirectory:true,cacheEntriesOnReopen:0,nativePicker:null,nativePickerReason:'Actual download is tested; native authorization unavailable',timings,bytes:{initial:(await readFile(file)).length,saved:Buffer.byteLength(savedText),restored:Buffer.byteLength(finalText),withoutHistory:Buffer.byteLength(cleanText),image:Buffer.byteLength(image),video:video.length},historyVersions:reopened.index.versions.length,network,fixture:'Canvas raster gradient plus checked-in playable WebM; not a real-user photo set',baseline:'S04 development measurements remain separate, no end-to-end or device claim'},null,2));
 }finally{await browser.close();}
});

test('UI07 A3/A5/A6: real disk bridge writes media history; quota never blocks current save; no-history export removes private resources',async()=>{
 const out=resolve('artifacts/ui07');await mkdir(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({offline:true,acceptDownloads:true});const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=512;c.height=512;const x=c.getContext('2d')!,d=x.createImageData(512,512);let seed=42;for(let i=0;i<d.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;d.data[i]=seed>>>24;d.data[i+1]=seed>>>16;d.data[i+2]=seed>>>8;d.data[i+3]=255;}x.putImageData(d,0,0);return c.toDataURL();});
  const file=join(out,'disk.ppte.html');await writeFile(file,(await enhanceHTML(`<title>媒体历史</title><section data-ppte-slide><h1>原始大图</h1><img style="width:300px" src="${image}"><img style="width:300px" src="${image}"></section>`,{root:out,base:out,mediaTable:true})).html);
  await page.exposeFunction('diskRead',()=>readFile(file,'utf8'));await page.exposeFunction('diskWrite',(s:string)=>writeFile(file,s));
  await page.goto(pathToFileURL(file).href);await page.waitForFunction(()=>!!(window as any).PPTeSave);
  await page.evaluate(()=>{const w=window as any;w.showOpenFilePicker=async()=>[{name:'disk.ppte.html',requestPermission:async()=> 'granted',queryPermission:async()=> 'granted',getFile:async()=>({text:()=>w.diskRead()}),createWritable:async()=>{let pending='';return {write:async(s:string)=>{pending=s;},close:()=>w.diskWrite(pending),abort:async()=>{}};}}];});
  await page.getByRole('button',{name:'编辑',exact:true}).click();await page.frameLocator('#ppte-frame').locator('h1').fill('命名大图');await page.getByText('更多',{exact:true}).click();await page.getByRole('menuitem',{name:'版本历史',exact:true}).click();page.once('dialog',d=>d.accept('私有旧图'));await page.getByRole('button',{name:'保存命名版本',exact:true}).click();await page.getByRole('button',{name:'关闭版本历史',exact:true}).click();
  const begin=performance.now();await page.getByRole('button',{name:'保存',exact:true}).click();await page.waitForFunction(()=>(window as any).PPTeSave.state==='saved');const saveMs=performance.now()-begin;
  const saved=await readFile(file,'utf8');assert.equal(saved.split(image).length-1,1);const w=readHistory(saved)!;assert.ok(JSON.parse(w.index).versions.some((v:any)=>v.name==='私有旧图'));
  // Set a quota that fits checkpoints while current media is excluded; then remove media from current.
  await page.evaluate(async()=>{const w=window as any;w.PPTeSave.setAutoSave(false);w.PPTeHTML.versions.limits(20,16384,w.PPTeHTML.content());await w.PPTeHTML.mount('<section data-ppte-slide><h1>可公开当前内容</h1></section>');w.PPTeSave.change();});
  await page.getByRole('button',{name:'保存',exact:true}).click();await page.waitForFunction(()=>(window as any).PPTeSave.state==='saved');const currentFile=await readFile(file,'utf8');assert.match(readEnhanced(currentFile).content,/可公开当前内容/);assert.equal(currentFile.split(image).length-1,1);
  await page.evaluate(()=>{const w=window as any;w.PPTeHTML.versions.automatic(w.PPTeHTML.content(),Date.now()+600000);});
  assert.match(await page.evaluate(()=>(window as any).PPTeHTML.versions.warning),/容量/);
  await page.getByText('更多',{exact:true}).click();const event=page.waitForEvent('download');await page.getByRole('menuitem',{name:'下载不含历史的文件',exact:true}).click();const stripped=join(out,'public.ppte.html');await(await event).saveAs(stripped);const publicText=await readFile(stripped,'utf8');assert.equal(readHistory(publicText),undefined);assert.equal(publicText.includes(image),false);assert.equal(publicText.includes('私有旧图'),false);assert.match(readEnhanced(publicText).content,/可公开当前内容/);
  const restored=new Versions(readEnhanced(currentFile).metadata.documentId,readHistory(currentFile));assert.ok(restored.index.versions.some(v=>v.name==='私有旧图'));assert.ok(restored.preview(restored.index.versions.find(v=>v.name==='私有旧图')!.id).includes(image));
  await writeFile(join(out,'media-performance.json'),JSON.stringify({time:new Date().toISOString(),browser:browser.version(),bridge:true,nativePermission:false,saveMs,bytes:{resource:Buffer.byteLength(image),saved:Buffer.byteLength(saved),historyOnlyMedia:Buffer.byteLength(currentFile),public:Buffer.byteLength(publicText)},resourceCopies:1,quotaBlockedHistoryOnly:true,currentSaveSucceeded:true,privateResourceAbsentFromPublic:true,S04:{source:'docs/single-file-first/evidence/s04/comparison.json',saveP95Ms:852.8000001907349,saveLimitMs:1500,comparable:false,reason:'One actual disk bridge operation on a 512×512 PNG; S04 uses another workload and p95. Not an equivalent native or controlled performance comparison.'}},null,2));
 }finally{await browser.close();}
});

test('UI07 A3/A4/A5: quota measures escaped transport bytes; reference fan-out is bounded before resource expansion',()=>{
 const h=new Versions(doc);h.add(html('&amp;'.repeat(1000)),'manual','escaped',1);
 assert.equal(h.usage(),Buffer.byteLength(historyHTML(h.wire())));
 const image='data:image/png;base64,'+Buffer.alloc(1024*1024).toString('base64'),resource=mediaDigest(image);
 const block='<section data-ppte-slide>'+`<img src="ppte-resource:${resource}">`.repeat(40)+'</section>',digest=mediaDigest(block),id=mediaDigest('version');
 const wire={index:JSON.stringify({schemaVersion:1,documentId:doc,maxAuto:20,maxBytes:16*1024*1024,lastAuto:0,versions:[{id,time:1,name:'oversized expansion',kind:'manual',block:digest,resources:[resource]}]}),blocks:{[digest]:block},resources:{[resource]:image}};
 const malicious=new Versions(doc,wire);assert.equal(malicious.index.versions.length,1);assert.equal(malicious.decoded,0);assert.throws(()=>malicious.preview(id),/展开超过安全上限/);assert.equal(malicious.decoded,0);
 // A fresh document identity carries valid history, including when nothing was edited after reopening.
 const original=new Versions(doc);original.add(html('copy me'),'manual','name',1);const loaded=new Versions(doc,original.wire());void loaded.index;const copy=loaded.wire({},'b'.repeat(32));assert.equal(new Versions('b'.repeat(32),copy).preview(original.index.versions[0].id),html('copy me'));
});
