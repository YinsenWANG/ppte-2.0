import test from 'node:test';
import { request } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, chmod, readdir, mkdir } from 'node:fs/promises';
import { tmpdir, networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { bindFile, startEditor } from '../packages/html-save/src/index.js';
import { enhanceHTML, readEnhanced } from '../packages/html-document/src/index.js';
import { SaveController, fileAdapter, type Snapshot } from '../packages/html-editor/src/save.js';
const evidence=resolve('artifacts/h02');
async function fixture() {
  await mkdir(evidence,{recursive:true});const root=await mkdtemp(join(tmpdir(),'h02-'));const file=join(root,'作品.html'),cacheDir=join(root,'cache');
  await writeFile(file,(await enhanceHTML('<title>保存测试</title><style>html{background:#f5f7fb;color:#182238;font:20px system-ui}body{margin:48px}h1{font-size:48px}</style><h1>Original</h1><p>Paragraph</p>',{root,base:root})).html);
  return {root,file,cacheDir,clean:()=>rm(root,{recursive:true,force:true})};
}
async function ready(page:any,url:string){await page.goto(url);await page.waitForFunction(()=>!!(window as any).PPTeSave);}
const post=(s:Awaited<ReturnType<typeof startEditor>>,route:string,data:object,headers:object={})=>fetch(s.origin+route,{method:'POST',headers:{Origin:s.origin,Authorization:`Bearer ${s.token}`,'Content-Type':'application/json',...headers},body:JSON.stringify(data)});

test('H02 acceptance 1: original path autosave, close/reopen and service restart preserve text with no download',async()=>{
  const f=await fixture();let s=await startEditor(f.file,{cacheDir:f.cacheDir});const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    let page=await browser.newPage();await ready(page,s.url);
    const downloads:string[]=[];page.on('download',d=>downloads.push(d.suggestedFilename()));
    await page.frameLocator('#ppte-frame').locator('h1').click();
    const titleBounds=await page.frameLocator('#ppte-frame').locator('h1').boundingBox();const barBounds=await page.locator('#ppte-save-ui').boundingBox();assert.ok(titleBounds!.y>=barBounds!.y+barBounds!.height);
    await page.frameLocator('#ppte-frame').locator('h1').fill('原文件自动保存');
    await page.waitForFunction(()=>(window as any).PPTeSave.state==='saved'&&(window as any).PPTeSave.base.metadata.saveRevision===1);
    assert.match(readEnhanced(await readFile(f.file,'utf8')).content,/原文件自动保存/);assert.deepEqual(downloads,[]);
    await page.close();const port=Number(new URL(s.origin).port);await s.close();s=await startEditor(f.file,{cacheDir:f.cacheDir,port});
    page=await browser.newPage();await ready(page,s.url);assert.equal(await page.frameLocator('#ppte-frame').locator('h1').textContent(),'原文件自动保存');
    assert.equal(await page.locator('[role=status]').textContent(),'已保存到原文件');
    await page.reload();await page.waitForFunction(()=>(window as any).PPTeSave?.state==='saved');
    await page.screenshot({path:join(evidence,'chrome-original-reopened.png')});
    await writeFile(join(evidence,'example.html'),await readFile(f.file));
    assert.deepEqual((await readdir(f.root)).sort(),['cache','作品.html']);
  }finally{await browser.close();await s.close();await f.clean();}
});

test('H02 acceptance 2: OS read-only, ENOSPC fault, interrupted replace retain original and recoverable version',async()=>{
 const f=await fixture();try{
  const initial=await readFile(f.file,'utf8');
  for(const phase of ['before-write','before-replace']){
   const b=await bindFile(f.file,{cacheDir:f.cacheDir,fault:p=>{if(p===phase)throw Object.assign(Error('disk full / interruption'),{code:phase==='before-write'?'ENOSPC':'EIO'});}});
   await assert.rejects(b.save((await b.snapshot()).hash,'<h1>Not committed</h1>'),/disk full/);
   assert.equal(await readFile(f.file,'utf8'),initial);assert.equal((await b.versions()).length,1);
   assert.deepEqual((await readdir(f.root)).sort(),['cache','作品.html']);
  }
  const b=await bindFile(f.file,{cacheDir:f.cacheDir});await chmod(f.file,0o444);
  await assert.rejects(b.save((await b.snapshot()).hash,'<h1>Read only</h1>'),/READ_ONLY|EACCES/);assert.equal(await readFile(f.file,'utf8'),initial);await chmod(f.file,0o644);
  const next=await b.save((await b.snapshot()).hash,'<h1>Updated</h1>');
  const restored=await b.restore(next.hash,(await b.versions())[0]);assert.match(restored.content,/Original/);assert.equal(restored.metadata.saveRevision,2);
 }finally{await chmod(f.file,0o644).catch(()=>{});await f.clean();}
});

test('H02 acceptance 2: two services/windows serialize one winner and detect external Agent edits at replace',async()=>{
 const f=await fixture();try{
  const a=await bindFile(f.file,{cacheDir:f.cacheDir}),b=await bindFile(f.file,{cacheDir:f.cacheDir});const base=await a.snapshot();
  const results=await Promise.allSettled([a.save(base.hash,'<h1>Window A</h1>'),b.save(base.hash,'<h1>Window B</h1>')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(String((results.find(r=>r.status==='rejected') as PromiseRejectedResult).reason),/CONFLICT/);
  const agent=(await readFile(f.file,'utf8')).replace(/Window [AB]/g,'Agent edit');
  const racing=await bindFile(f.file,{cacheDir:f.cacheDir,fault:async p=>{if(p==='before-replace')await writeFile(f.file,agent);}});
  await assert.rejects(racing.save((await racing.snapshot()).hash,'<h1>Human edit</h1>'),/CONFLICT/);assert.equal(await readFile(f.file,'utf8'),agent);
 }finally{await f.clean();}
});

test('H02 acceptance 2: kill process before rename, restart recovers stale lock and preserves original',async()=>{
 const f=await fixture();try{
  const original=await readFile(f.file,'utf8');
  const code=`import {bindFile} from ${JSON.stringify(pathToFileURL(resolve('dist/packages/html-save/src/index.js')).href)};const b=await bindFile(${JSON.stringify(f.file)},{cacheDir:${JSON.stringify(f.cacheDir)},fault:async p=>{if(p==='before-replace'){console.log('READY');await new Promise(()=>{});}}});await b.save((await b.snapshot()).hash,'<h1>Interrupted</h1>');`;
  const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe']});
  await new Promise<void>((yes,no)=>{child.stdout.on('data',b=>{if(String(b).includes('READY'))yes();});child.on('exit',c=>no(Error(`early exit ${c}`)));});
  child.kill('SIGKILL');await new Promise(r=>child.once('exit',r));assert.equal(await readFile(f.file,'utf8'),original);
  const b=await bindFile(f.file,{cacheDir:f.cacheDir});await b.save((await b.snapshot()).hash,'<h1>After restart</h1>');assert.match((await b.snapshot()).content,/After restart/);
  assert.ok(!(await readdir(f.root)).some(n=>n.endsWith('.tmp')));
 }finally{await f.clean();}
});

test('H02 acceptance 2/3: browser two-window conflict keeps draft; explicit reread and retry after network failure',async()=>{
 const f=await fixture();const s=await startEditor(f.file,{cacheDir:f.cacheDir});const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext();const a=await context.newPage(),b=await context.newPage();await ready(a,s.url);await ready(b,s.url);
  await a.frameLocator('#ppte-frame').locator('h1').fill('Winner');await a.waitForFunction(()=>(window as any).PPTeSave.state==='saved');
  await b.frameLocator('#ppte-frame').locator('h1').fill('Retained loser');await b.waitForFunction(()=>(window as any).PPTeSave.state==='conflict');
  assert.match(await b.locator('[role=status]').textContent()??'',/冲突/);assert.equal(await b.frameLocator('#ppte-frame').locator('h1').textContent(),'Retained loser');
  assert.ok(await b.evaluate(()=>Object.values(localStorage).some((s:any)=>s.includes('Retained loser'))));
  b.on('dialog',d=>d.accept());await b.getByText('重新读取文件',{exact:true}).click();await b.waitForFunction(()=>(window as any).PPTeSave.state==='saved');assert.equal(await b.frameLocator('#ppte-frame').locator('h1').textContent(),'Winner');
  await b.route('**/api/save',r=>r.abort());await b.frameLocator('#ppte-frame').locator('h1').fill('Retry retained');await b.waitForFunction(()=>(window as any).PPTeSave.state==='failed');
  await b.unroute('**/api/save');await b.getByText('保存 / 授权',{exact:true}).click();await b.waitForFunction(()=>(window as any).PPTeSave.state==='saved');assert.match(readEnhanced(await readFile(f.file,'utf8')).content,/Retry retained/);
 }finally{await browser.close();await s.close();await f.clean();}
});

test('H02 acceptance 3: IME does not save half composition; 800ms pause and delayed acknowledgement remain dirty/saving',async()=>{
 const f=await fixture();let release:()=>void=()=>{};const gate=new Promise<void>(r=>release=r);
 const s=await startEditor(f.file,{cacheDir:f.cacheDir,fault:p=>p==='before-replace'?gate:undefined});const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();await ready(page,s.url);
  await page.frameLocator('#ppte-frame').locator('h1').evaluate(e=>{e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));e.textContent='中';e.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));});
  await page.waitForTimeout(1000);assert.match(readEnhanced(await readFile(f.file,'utf8')).content,/Original/);
  await page.frameLocator('#ppte-frame').locator('h1').evaluate(e=>{e.textContent='中文';e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));});
  await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>(window as any).PPTeSave.state),'dirty');
  await page.waitForFunction(()=>(window as any).PPTeSave.state==='saving');assert.match(await page.locator('[role=status]').textContent()??'',/等待文件确认/);
  release();await page.waitForFunction(()=>(window as any).PPTeSave.state==='saved');assert.match(readEnhanced(await readFile(f.file,'utf8')).content,/中文/);
 }finally{release();await browser.close();await s.close();await f.clean();}
});

test('H02 acceptance 2/3: two real windows retain the failed draft after the other file save is acknowledged',async()=>{
 const f=await fixture();let release:()=>void=()=>{};const gate=new Promise<void>(r=>release=r);
 const s=await startEditor(f.file,{cacheDir:f.cacheDir,fault:p=>p==='before-replace'?gate:undefined});const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext();const a=await context.newPage(),b=await context.newPage();await ready(a,s.url);await ready(b,s.url);
  await a.frameLocator('#ppte-frame').locator('h1').fill('Acknowledged A');await a.waitForFunction(()=>(window as any).PPTeSave.state==='saving');
  await b.route('**/api/save',r=>r.abort());await b.frameLocator('#ppte-frame').locator('h1').fill('Recovery B');await b.waitForFunction(()=>(window as any).PPTeSave.state==='failed');
  await b.close();release();await a.waitForFunction(()=>(window as any).PPTeSave.state==='saved');
  assert.match(readEnhanced(await readFile(f.file,'utf8')).content,/Acknowledged A/);
  const reopened=await context.newPage();await ready(reopened,s.url);
  assert.equal(await reopened.evaluate(()=>(window as any).PPTeSave.state),'conflict');
  assert.equal(await reopened.evaluate(()=>(window as any).PPTeSave.recover()?.content.includes('Recovery B')),true);
  assert.match(await reopened.locator('[role=status]').textContent()??'',/冲突/);
 }finally{release();await browser.close();await s.close();await f.clean();}
});

const snapshot:Snapshot={content:'old',hash:'base',fileKey:'file-a',name:'a.html',metadata:{documentId:'doc',saveRevision:0}};
test('H02 acceptance 2/3: a delayed acknowledgement never deletes another window recovery draft',async()=>{
 const map=new Map<string,string>();
 const storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>{map.delete(k);}};
 let finish:(value:Snapshot)=>void=()=>{};
 const a=new SaveController({load:async()=>snapshot,write:()=>new Promise(resolve=>finish=resolve)},snapshot,()=> 'Window A',()=>{},storage,'shared-file');
 const b=new SaveController(undefined,snapshot,()=> 'Window B unsaved',()=>{},storage,'shared-file');
 a.change();const pending=a.flush();
 b.change();b.composition(true);
 const retained=storage.getItem('shared-file');assert.ok(retained);
 finish({...snapshot,content:'Window A',hash:'committed-a'});await pending;
 assert.equal(a.state,'saved');assert.equal(storage.getItem('shared-file'),retained);
 const reopened=new SaveController(undefined,{...snapshot,hash:'committed-a'},()=>'',()=>{},storage,'shared-file');
 assert.equal(reopened.recover()?.content,'Window B unsaved');assert.equal(reopened.state,'conflict');
 const owner=new SaveController({load:async()=>snapshot,write:async()=>({...snapshot,hash:'committed-owner'})},snapshot,()=> 'Owner saved',()=>{},storage,'owner-file');
 owner.change();await owner.flush();assert.equal(owner.state,'saved');assert.equal(storage.getItem('owner-file'),null);
});
test('H02 acceptance 3: edits during in-flight save remain queued; draft base matching, quotas and copied identity',async()=>{
 let content='first',finish:(v:Snapshot)=>void=()=>{};const map=new Map<string,string>();const storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>{map.delete(k);}};
 const c=new SaveController({load:async()=>snapshot,write:()=>new Promise(r=>finish=r)},snapshot,()=>content,()=>{},storage,'path-a');c.change();const pending=c.flush();content='second';c.change();finish({...snapshot,hash:'next'});await pending;assert.equal(c.state,'dirty');assert.equal(c.dirty,true);assert.equal(JSON.parse(map.get('path-a')!).base,'next');
 c.composition(true); // cancel timer; no accidental background request in this test
 const same=new SaveController(undefined,{...snapshot,hash:'next'},()=>content,()=>{},storage,'path-a');assert.equal(same.recover()?.content,'second');
 const copy=new SaveController(undefined,snapshot,()=>content,()=>{},storage,'path-b');assert.equal(copy.recover(),undefined);
 const changed=new SaveController(undefined,snapshot,()=>content,()=>{},storage,'path-a');changed.recover();assert.equal(changed.state,'conflict');
 const quota=new SaveController(undefined,snapshot,()=>content,()=>{},{...storage,setItem:()=>{throw Error('QuotaExceededError');}},'path-a');quota.change();assert.match(quota.detail,/配额/);assert.equal(quota.state,'draft');quota.composition(true);
});

test('H02 acceptance 2/3: File System Access permission revoked, conflict, failed close and confirmation (API contract test)',async()=>{
 let bytes='old',permission='granted',fail=false;let closed=false;
 const handle={name:'test.html',queryPermission:async()=>permission,requestPermission:async()=>permission,getFile:async()=>({text:async()=>bytes}),createWritable:async()=>{let pending='';return{write:async(s:string)=>{pending=s;},close:async()=>{if(fail)throw Error('ENOSPC');bytes=pending;closed=true;},abort:async()=>{}};}};
 const adapter=fileAdapter(handle,content=>({...snapshot,content}),content=>content);const base=await adapter.load();
 permission='denied';await assert.rejects(adapter.write(base.hash,'new'),/PERMISSION_REVOKED/);assert.equal(bytes,'old');permission='granted';
 fail=true;await assert.rejects(adapter.write(base.hash,'new'),/ENOSPC/);assert.equal(bytes,'old');fail=false;
 bytes='external';await assert.rejects(adapter.write(base.hash,'new'),/CONFLICT/);bytes='old';
 const saved=await adapter.write(base.hash,'new');assert.equal(closed,true);assert.equal(saved.content,'new');
});

test('H02 acceptance 4: loopback bind, hostile Origin/Host, no token, traversal, arbitrary fields and unsafe content rejected',async()=>{
 const f=await fixture();const s=await startEditor(f.file,{cacheDir:f.cacheDir});try{
  assert.equal((s.server.address() as any).address,'127.0.0.1');const base=await s.binding.snapshot();const body={expected:base.hash,content:'<h1>forbidden</h1>'};
  assert.equal((await post(s,'/api/save',body,{Origin:'https://evil.example'})).status,403);
  assert.equal((await post(s,'/api/save',body,{Authorization:''})).status,403);
  assert.equal(await new Promise<number|undefined>((yes,no)=>{const req=request(s.origin+'/api/save',{method:'POST',headers:{Host:'evil.example'}},res=>{res.resume();yes(res.statusCode);});req.on('error',no);req.end();}),403);
  assert.equal((await post(s,'/api/save',{...body,path:'../../other.html'})).status,400);
  assert.equal((await post(s,'/api/%2e%2e/save',body)).status,404);
  assert.equal((await post(s,'/api/save',{...body,content:'<script>attack()</script>'})).status,422);
  assert.equal((await fetch(s.origin+'/api/file')).status,403);
  assert.equal((await fetch(s.origin,{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  const other=Object.values(networkInterfaces()).flat().find(a=>a?.family==='IPv4'&&!a.internal);
  if(other)await assert.rejects(fetch(`http://${other.address}:${new URL(s.origin).port}/`,{signal:AbortSignal.timeout(1000)}));
  assert.equal((await s.binding.snapshot()).hash,base.hash);
 }finally{await s.close();await f.clean();}
});

test('H02 acceptance 5: real installed Chrome file URL shows limitation, keeps draft and never claims file save',async()=>{
 const f=await fixture();const browser=await chromium.launch({channel:'chrome',headless:true});try{
  const before=await readFile(f.file,'utf8');const page=await browser.newPage();await ready(page,pathToFileURL(f.file).href);
  await page.getByText('编辑 / 保存',{exact:true}).click({force:true});await page.getByText('编辑',{exact:true}).click();
  assert.match(await page.locator('[role=status]').textContent()??'',/不能自动覆盖原文件/);
  await page.frameLocator('#ppte-frame').locator('h1').fill('Draft only');await page.waitForTimeout(1000);
  assert.match(await page.locator('[role=status]').textContent()??'',/仅草稿/);assert.equal(await readFile(f.file,'utf8'),before);
  await page.screenshot({path:join(evidence,'chrome-file-limitation.png')});
  await writeFile(join(evidence,'chrome-capabilities.json'),JSON.stringify(await page.evaluate(()=>({userAgent:navigator.userAgent,url:location.protocol,secure:isSecureContext,picker:typeof(window as any).showOpenFilePicker,locks:!!navigator.locks,state:(window as any).PPTeSave.state})),null,2));
 }finally{await browser.close();await f.clean();}
});

test('H02 acceptance 5: Safari actual WebDriver journey or explicit blocked evidence (not simulated Safari)',async()=>{
 await mkdir(evidence,{recursive:true});
 const version=spawnSync('/usr/bin/safaridriver',['--version'],{encoding:'utf8'});
 if(version.error){await writeFile(join(evidence,'safari.json'),JSON.stringify({status:'blocked',error:String(version.error)}));return;}
 const port=49217;const driver=spawn('/usr/bin/safaridriver',['-p',String(port)],{stdio:'pipe'});let session:any;
 try{
  for(let i=0;i<30;i++){try{const response=await fetch(`http://localhost:${port}/session`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({capabilities:{alwaysMatch:{browserName:'safari'}}})});session=await response.json();break;}catch{await new Promise(r=>setTimeout(r,100));}}
  assert.ok(session,'Safari driver did not respond');
  if(!session.value?.sessionId){assert.ok(session.value?.error);await writeFile(join(evidence,'safari.json'),JSON.stringify({status:'blocked',version:version.stdout,response:session},null,2));return;}
  const id=session.value.sessionId;const call=async(route:string,body:object)=>{const response=await fetch(`http://localhost:${port}/session/${id}/${route}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();assert.ok(!result.value?.error,JSON.stringify(result));return result.value;};
  const f=await fixture();const s=await startEditor(f.file,{cacheDir:f.cacheDir});try{
   await call('url',{url:s.url});await new Promise(r=>setTimeout(r,1200));
   await call('execute/sync',{script:"const e=window.PPTeHTML.contentDocument.querySelector('h1');e.textContent='Safari original';e.dispatchEvent(new Event('input',{bubbles:true}));",args:[]});await new Promise(r=>setTimeout(r,1600));assert.match(readEnhanced(await readFile(f.file,'utf8')).content,/Safari original/);
   await call('url',{url:'about:blank'});await call('url',{url:s.url});await new Promise(r=>setTimeout(r,1000));assert.equal(await call('execute/sync',{script:"return window.PPTeHTML.contentDocument.querySelector('h1').textContent",args:[]}),'Safari original');
   await call('url',{url:pathToFileURL(f.file).href});await new Promise(r=>setTimeout(r,1000));const probe=await call('execute/sync',{script:"return {state:window.PPTeSave.state,picker:typeof window.showOpenFilePicker}",args:[]});assert.equal(probe.state,'unauthorized');
   await writeFile(join(evidence,'safari.json'),JSON.stringify({status:'passed',version:version.stdout,probe},null,2));
  }finally{await s.close();await f.clean();await fetch(`http://localhost:${port}/session/${id}`,{method:'DELETE'});}
 }finally{driver.kill();}
});

test('H02 acceptance 1/4: packaged npm install exposes ppte edit, stable restart URL and multiple file mappings',async()=>{
 const f=await fixture();let child:ReturnType<typeof spawn>|undefined;
 try{
  const stage=spawnSync(process.execPath,['scripts/stage-html.mjs'],{encoding:'utf8'});assert.equal(stage.status,0,stage.stderr);
  const pack=spawnSync('npm',['pack',resolve('artifacts/html-package'),'--pack-destination',f.root,'--json'],{encoding:'utf8'});assert.equal(pack.status,0,pack.stderr);
  // npm 10/11 return an array; npm 12 keys the same receipts by package name.
  const receipts=Object.values(JSON.parse(pack.stdout)) as {name:string;filename:string}[];
  assert.equal(receipts.length,1,pack.stdout);const receipt=receipts[0];assert.equal(receipt.name,'ppte-html');
  assert.match(receipt.filename,/^ppte-html-[\w.-]+\.tgz$/);
  const tarball=join(f.root,receipt.filename);const prefix=join(f.root,'install');
  const install=spawnSync('npm',['install','--global','--prefix',prefix,'--ignore-scripts','--no-audit','--no-fund',tarball],{encoding:'utf8'});assert.equal(install.status,0,install.stderr);
  const bin=join(prefix,'bin','ppte');
  const launch=async(file:string)=>{
   child=spawn(bin,['edit',file,'--no-open'],{stdio:['ignore','pipe','pipe']});
   return await new Promise<any>((yes,no)=>{let output='';child!.stdout!.on('data',b=>{output+=String(b);if(output.includes('\n')){try{yes(JSON.parse(output.trim()));}catch(e){no(e);}}});child!.once('exit',c=>no(Error(`CLI exited ${c}: ${output}`)));});
  };
  const first=await launch(f.file);assert.equal(first.ok,true);const url=new URL(first.url);const token=url.hash.slice('#token='.length);
  const initial=await(await fetch(url.origin+'/api/file',{headers:{Authorization:`Bearer ${token}`}})).json();
  const saved=await fetch(url.origin+'/api/save',{method:'POST',headers:{Origin:url.origin,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({expected:initial.hash,content:'<h1>Installed process saved</h1>'})});assert.equal(saved.status,200);
  child!.kill('SIGTERM');await new Promise(r=>child!.once('exit',r));
  const second=await launch(f.file);assert.equal(new URL(second.url).origin,url.origin);assert.notEqual(second.url,first.url);assert.match(await readFile(f.file,'utf8'),/Installed process saved/);
  child!.kill('SIGTERM');await new Promise(r=>child!.once('exit',r));
  const other=join(f.root,'other.html');await writeFile(other,await readFile(f.file));const third=await launch(other);assert.notEqual(new URL(third.url).origin,url.origin);
  await writeFile(join(evidence,'npm-install.json'),JSON.stringify({status:'passed',package:receipt,bin:'ppte',stablePort:true,rotatedSessionToken:true,originalWrite:true,multipleMapping:true},null,2));
 }finally{child?.kill('SIGTERM');await f.clean();}
});

test('H02 acceptance 2: history bounded by count and rejected restoration paths never write',async()=>{
 const f=await fixture();try{
  const b=await bindFile(f.file,{cacheDir:f.cacheDir});
  for(let i=0;i<12;i++)await b.save((await b.snapshot()).hash,`<h1>Version ${i}</h1>`);
  const versions=await b.versions();assert.equal(versions.length,10);
  await assert.rejects(b.restore((await b.snapshot()).hash,'../../escape'),/VERSION_NOT_FOUND/);
  const restore=await b.restore((await b.snapshot()).hash,versions[0]);assert.match(restore.content,/Version 10/);
 }finally{await f.clean();}
});

test('H02 acceptance 2: actual bounded full disk returns ENOSPC without replacing original (macOS HFS+)',async()=>{
 const f=await fixture();const image=join(f.root,'full.dmg'),mount=join(f.root,'volume');let mounted=false;
 try{
  const create=spawnSync('hdiutil',['create','-size','16m','-fs','HFS+','-volname','PPTeH02','-ov',image],{encoding:'utf8'});
  if(create.error){await writeFile(join(evidence,'disk-full.json'),JSON.stringify({status:'blocked',error:String(create.error)}));return;}
  assert.equal(create.status,0,create.stderr);await mkdir(mount);
  const attach=spawnSync('hdiutil',['attach',image,'-nobrowse','-mountpoint',mount],{encoding:'utf8'});assert.equal(attach.status,0,attach.stderr);mounted=true;
  const file=join(mount,'original.html');const original=await readFile(f.file,'utf8');await writeFile(file,original);
  const {open}=await import('node:fs/promises');const filler=await open(join(mount,'filler'),'w');let filled=0,error='';
  try{while(filled<20*1024*1024){await filler.write(Buffer.alloc(64*1024));filled+=64*1024;}}catch(e){error=(e as NodeJS.ErrnoException).code??'';}finally{await filler.close();}
  assert.equal(error,'ENOSPC');const b=await bindFile(file,{cacheDir:f.cacheDir});const before=await b.snapshot();
  await assert.rejects(b.save(before.hash,'<h1>'+ 'x'.repeat(1024*1024)+'</h1>'),{code:'ENOSPC'});
  assert.equal(await readFile(file,'utf8'),original);assert.equal((await b.versions()).length,1);
  await rm(join(mount,'filler'));const retry=await b.save(before.hash,'<h1>Retry after freeing disk</h1>');assert.match(retry.content,/Retry after freeing disk/);
  await writeFile(join(evidence,'disk-full.json'),JSON.stringify({status:'passed',filesystem:'16 MiB HFS+ disk image',filled,error,originalUnchanged:true,retryPassed:true},null,2));
 }finally{if(mounted)spawnSync('hdiutil',['detach',mount]);await f.clean();}
});

test('H02 acceptance 2/3: failed-save draft survives page close, restores on matching file base and flushes to original',async()=>{
 const f=await fixture();const s=await startEditor(f.file,{cacheDir:f.cacheDir});const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext();const page=await context.newPage();await ready(page,s.url);
  await page.route('**/api/save',r=>r.abort());await page.frameLocator('#ppte-frame').locator('h1').fill('Recovered draft');await page.waitForFunction(()=>(window as any).PPTeSave.state==='failed');await page.close();
  const reopened=await context.newPage();await ready(reopened,s.url);
  assert.equal(await reopened.frameLocator('#ppte-frame').locator('h1').textContent(),'Recovered draft');await reopened.waitForFunction(()=>(window as any).PPTeSave.state==='saved');assert.match(readEnhanced(await readFile(f.file,'utf8')).content,/Recovered draft/);
 }finally{await browser.close();await s.close();await f.clean();}
});
