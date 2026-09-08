import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chromium,type Page} from 'playwright';
import {readEnhanced} from '../packages/html-document/src/index.js';
import {downloadUpdated} from './helpers/focused-product.js';
const evidence=resolve('docs/usability-reset/evidence/U01');
const out=resolve('artifacts/usability-reset-u01');
const file=join(evidence,'Cherry-Studio-开源之路.ppte.html');
const btn=(p:Page,name:string)=>p.getByRole('button',{name,exact:true});
const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
function packReceipt(stdout:string):{name:string;filename:string}{
 const parsed:unknown=JSON.parse(stdout);
 assert.ok(parsed!==null&&typeof parsed==='object','npm pack must return a receipt collection');
 const receipts=Object.values(parsed);
 assert.equal(receipts.length,1,'npm pack must produce exactly one package');
 const receipt=receipts[0];
 assert.equal(receipt?.name,'ppte-html','npm pack must identify the staged package');
 assert.equal(typeof receipt.filename,'string','npm pack must report a tarball filename');
 assert.match(receipt.filename,/^ppte-html-[\w.-]+\.tgz$/);
 return receipt;
}
test('U01 A4 receipts: array and keyed results identify one tarball; malformed or ambiguous output fails',()=>{
 const receipt={name:'ppte-html',filename:'ppte-html-1.0.0-html.0.tgz'};
 for(const collection of [[receipt],{'ppte-html':receipt}])assert.deepEqual(packReceipt(JSON.stringify(collection)),receipt);
 for(const collection of [null,[],{},[receipt,receipt],[{}],[{...receipt,name:'wrong'}],[{name:'ppte-html'}],[{...receipt,filename:'../outside.tgz'}]]){
  assert.throws(()=>packReceipt(JSON.stringify(collection)),assert.AssertionError);
 }
});
async function open(){
 await mkdir(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true});
 const p=await browser.newPage({offline:true,acceptDownloads:true,viewport:{width:1440,height:960}});p.setDefaultTimeout(10000);
 const errors:string[]=[],network:string[]=[];p.on('pageerror',e=>errors.push(String(e)));p.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
 await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeEditor);
 return {browser,p,errors,network};
}
test('U01 A1/A2: three newly authored native pages in one offline runtime, text/image bounds and clean presentation',async()=>{
 const bytes=await readFile(file,'utf8'),source=readEnhanced(bytes).content;
 assert.equal((source.match(/data-ppte-slide=/g)??[]).length,3);
 assert.match(source,/class="cover-body"/);assert.match(source,/class="split-body"/);assert.match(source,/class="dense-body"/);
 assert.doesNotMatch(source,/生长的叶片|今天，从一个问题开始|新版体验稿|制作与实机验收|TEST|占位图/);
 assert.notEqual(sha(source),sha(await readFile('docs/audits/2026-09-07-main-d1db13d/sample/source.html')));
 const f=await open(),p=f.p,rows:unknown[]=[];
 try{
 assert.equal(await p.locator('#ppte-save-ui').getAttribute('data-mode'),'read');
 assert.equal(await btn(p,'导出为 PDF').isDisabled(),true);
 assert.equal(await p.locator('template#ppte-content').count(),1);
 for(let i=0;i<3;i++){
  if(i)await btn(p,'下一页').click();
  const slide=p.frameLocator('#ppte-frame').locator('[data-ppte-slide]').nth(i);assert.equal(await slide.isVisible(),true);
  const geometry=await slide.evaluate(el=>{
   const r=el.getBoundingClientRect();const textBounds:unknown[]=[];const overflow:string[]=[];
   for(const n of Array.from(el.querySelectorAll('h1,h2,p,td,th,li,figcaption,header,footer'))){
    const b=n.getBoundingClientRect(),style=getComputedStyle(n);if(b.left<r.left-1||b.right>r.right+1||b.top<r.top-1||b.bottom>r.bottom+1||(style.overflowX!=='visible'&&n.scrollWidth>n.clientWidth+1)||(style.overflowY!=='visible'&&n.scrollHeight>n.clientHeight+1))overflow.push(n.textContent??'');
    // Range bounds catch wrapped glyphs clipped inside an otherwise fitting box.
    const walker=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);let t:Node|null;
    while((t=walker.nextNode())){if(!t.textContent?.trim())continue;const range=document.createRange();range.selectNodeContents(t);for(const q of Array.from(range.getClientRects()))if(q.left<r.left-1||q.right>r.right+1||q.top<r.top-1||q.bottom>r.bottom+1)overflow.push(t.textContent);}
    textBounds.push({text:n.textContent,rect:b.toJSON(),client:[n.clientWidth,n.clientHeight],scroll:[n.scrollWidth,n.scrollHeight],overflow:style.overflow});
   }
   return {page:r.toJSON(),overflow,textBounds,background:getComputedStyle(el).backgroundColor};
  });
  assert.deepEqual(geometry.overflow,[]);assert.equal(geometry.page.width,1280);assert.equal(geometry.page.height,720);
  const beforeScreenshot=await p.evaluate(()=>(window as any).PPTeHTML.content());
  await p.screenshot({caret:'initial',path:join(out,`read-${i+1}.png`)});
  assert.equal(await p.evaluate(()=>(window as any).PPTeHTML.content()),beforeScreenshot);
  await btn(p,'放映').click();assert.equal(await p.locator('#ppte-save-ui').isVisible(),false);assert.equal(await p.locator('#ppte-canvas-controls').isVisible(),false);
  await p.screenshot({caret:'initial',path:join(out,`present-${i+1}.png`)});await p.keyboard.press('Escape');rows.push(geometry);
 }
 assert.equal(new Set(rows.map((r:any)=>r.background)).size,1);
 await btn(p,'上一页').click();const img=p.frameLocator('#ppte-frame').locator('.diagram-image');
 assert.equal(await img.evaluate((n:HTMLImageElement)=>n.complete&&n.naturalWidth===640&&n.naturalHeight===440),true);
 assert.equal(await img.evaluate(n=>getComputedStyle(n).objectFit),'contain');
 assert.match(await p.frameLocator('#ppte-frame').locator('figcaption').innerText(),/概念图.*非产品截图/);
 assert.deepEqual(f.errors,[]);assert.deepEqual(f.network,[]);
 await writeFile(join(out,'layout.json'),JSON.stringify({browser:f.browser.version(),headless:true,offline:true,fileSha256:sha(bytes),rows,errors:f.errors,network:f.network},null,2));
 }finally{await f.browser.close();}
});
test('U01 A1: actual text editing, undo/redo, explicit download and new browser process retain the representative source',async()=>{
 const original=await readFile(file);const f=await open(),p=f.p;let saved='';
 try{
 await btn(p,'编辑').click();const title=p.frameLocator('#ppte-frame').locator('[data-ppte-id="u01-cover-title"]');
 await title.click();await title.dblclick();await p.keyboard.press('Meta+A');await p.keyboard.insertText('U01 editable roundtrip');await btn(p,'关闭属性').click();
 assert.match(await title.innerText(),/U01 editable roundtrip/);
 await btn(p,'撤销').click();assert.match(await title.innerText(),/开源之路/);
 await btn(p,'重做').click();assert.match(await title.innerText(),/U01 editable roundtrip/);
 const event=p.waitForEvent('download');await downloadUpdated(p);const d=await event;saved=join(out,'edited-download.ppte.html');await d.saveAs(saved);
 assert.equal((readEnhanced(await readFile(saved,'utf8')).content.match(/data-ppte-slide=/g)??[]).length,3);
 await p.screenshot({caret:'initial',path:join(out,'edit.png')});assert.deepEqual(f.errors,[]);assert.deepEqual(f.network,[]);
 }finally{await f.browser.close();}
 const b=await chromium.launch({channel:'chrome',headless:true});try{const q=await b.newPage({offline:true});await q.goto(pathToFileURL(saved).href);await q.waitForFunction(()=>!!(window as any).PPTeEditor);assert.equal(await q.locator('#ppte-save-ui').getAttribute('data-mode'),'read');assert.match(await q.frameLocator('#ppte-frame').locator('h1').innerText(),/U01 editable roundtrip/);await btn(q,'下一页').click();assert.equal(await q.frameLocator('#ppte-frame').locator('img').evaluate((n:HTMLImageElement)=>n.complete&&n.naturalWidth===640),true);}finally{await b.close();}
 assert.deepEqual(await readFile(file),original,'review delivery must stay clean');
 await writeFile(join(out,'roundtrip.json'),JSON.stringify({headless:true,downloadFallback:'capability override; not native save evidence',newBrowserProcess:true,originalSha256:sha(original),downloadSha256:sha(await readFile(saved))},null,2));
});
test('U01 A4: actual packed, offline installed and skill-installed instructions equal source',async()=>{
 await mkdir(out,{recursive:true});const root=await mkdtemp(join(tmpdir(),'u01-package-'));const commands:unknown[]=[];
 const run=(cmd:string,args:string[])=>{const r=spawnSync(cmd,args,{encoding:'utf8'});commands.push({cmd,args,status:r.status,stdout:r.stdout,stderr:r.stderr});assert.equal(r.status,0,r.stdout+'\n'+r.stderr);return r.stdout;};
 try{
 const stage=join(root,'stage');run(process.execPath,['scripts/stage-package.mjs',stage]);const receipt=packReceipt(run('npm',['pack',stage,'--pack-destination',root,'--json']));
 const install=join(root,'install');run('npm',['install','--prefix',install,'--offline','--ignore-scripts','--no-audit','--no-fund',join(root,receipt.filename)]);
 const pkg=join(install,'node_modules/ppte-html'),skill=join(root,'skill');run(process.execPath,[join(pkg,'ppte.js'),'skill-install','--out',skill]);
 const source=await readFile('skills/ppte/SKILL.md');assert.deepEqual(await readFile(join(pkg,'skills/ppte/SKILL.md')),source);assert.deepEqual(await readFile(join(skill,'SKILL.md')),source);
 const readme=await readFile('README-AGENT.md');assert.deepEqual(await readFile(join(pkg,'README.md')),readme);
 for(const bytes of [source,readme,await readFile('README.md')]){assert.doesNotMatch(bytes.toString(),/More → Export PDF|PDF is an explicit browser print action/);assert.match(bytes.toString(),/unfinished/);}
 assert.ok(source.length<6500);await writeFile(join(out,'package.json'),JSON.stringify({commands,skillSha256:sha(source),readmeSha256:sha(readme),tarballSha256:sha(await readFile(join(root,receipt.filename))),receipt},null,2));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('U01 A3/full-deck: explicit decision gate preserves rejected human status and blocks expansion',async()=>{
 const task=JSON.parse(await readFile('docs/usability-reset/TASKS.json','utf8')).tasks.find((t:any)=>t.id==='U01');
 assert.equal(task.status,'awaiting-user-decision');assert.equal(task.verification.human,'reopened');assert.equal(task.humanRevalidation.status,'pending');
 assert.equal(task.fullDeck.status,'pending');assert.equal(task.fullDeck.blockedBy,'U01-user-visual-approval');
 const decisions=await readFile('docs/usability-reset/DECISIONS.md','utf8');for(let i=1;i<=3;i++){assert.ok(decisions.includes(`present-${i}.png`));await readFile(join(evidence,`screenshots/present-${i}.png`));}
 // This tests the release boundary only, never substitutes for human visual approval.
});
