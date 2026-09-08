import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { enhanceHTML, readEnhanced } from '../packages/html-document/src/index.js';

const out=resolve('artifacts/audit-r01');
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
for(const width of [1440,1024,390])for(const path of ['write','download'])test(`R01 ${width} ${path}: stable geometry, focus, bounded labels and saved reopen`,{timeout:90000},async()=>{
 await mkdir(out,{recursive:true});
 const root=resolve('docs/usability-reset/evidence/U01/source');
 const original=(await enhanceHTML(await readFile(join(root,'full-deck.html'),'utf8'),{root,base:root})).html;
 const file=join(out,`${width}-${path}.html`);await writeFile(file,original);
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const p=await browser.newPage({offline:true,viewport:{width,height:960}});
  let release:()=>void=()=>{};let failure=false;let writes=0;let waiting=false;
  await p.exposeFunction('r01read',()=>readFile(file,'utf8'));
  await p.exposeFunction('r01write',async(bytes:string)=>{await new Promise<void>(r=>{release=r;waiting=true;});waiting=false;if(failure)throw Error('R01 simulated disk failure');await writeFile(file,bytes);writes++;});
  await p.addInitScript(({path})=>{const w=window as any;w.showOpenFilePicker=path==='download'?undefined:async()=>[{name:'deck.html',queryPermission:async()=>'granted',requestPermission:async()=>'granted',getFile:async()=>({text:()=>w.r01read()}),createWritable:async()=>{let bytes='';return {write:async(s:string)=>{bytes=s;},close:()=>w.r01write(bytes),abort:async()=>{}};}}];},{path});
  await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeSave);
  await p.evaluate(()=>(window as any).PPTeSave.setAutoSave(false));
  const rows:any[]=[];
  const measure=async(state:string,focus:string)=>{
   assert.equal(await p.locator(focus).evaluate(n=>n===document.activeElement),true,`${state}: focus ${focus}`);
   const row=await p.locator('#ppte-save-ui').evaluate(bar=>{
    const rect=(n:Element)=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
    const controls=Array.from(bar.querySelectorAll('.modes button, :scope > button, :scope > details > summary, :scope > strong')).map(n=>({label:n.matches('.save-action')?'save':n.matches('summary')?'status':n.matches('strong')?'title':n.textContent,...rect(n),visible:getComputedStyle(n).visibility!=='hidden'}));
    return {controls,bar:rect(bar),overflow:document.documentElement.scrollWidth>innerWidth,frame:rect(document.querySelector('#ppte-frame')!)};
   });
   assert.equal(row.overflow,false,`${state}: horizontal overflow`);
   for(const c of row.controls){assert.ok(c.x>=0&&c.x+c.width<=width+1,`${state}: bounded ${c.label}`);assert.ok(c.y>=0&&c.y+c.height<=row.bar.height+1,`${state}: bar contains ${c.label}`);}
   const visible=row.controls.filter(c=>c.visible);
   for(let i=0;i<visible.length;i++)for(let j=i+1;j<visible.length;j++){
    const a=visible[i],b=visible[j];assert.ok(Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)<=1||Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)<=1,`${state}: overlap ${a.label}/${b.label}`);
   }
   if(rows.length){for(const c of row.controls){const initial=rows[0].controls.find((v:any)=>v.label===c.label);for(const k of ['x','y','width','height'] as const)assert.ok(Math.abs(c[k]-initial[k])<=1,`${state}: ${c.label}.${k}: ${initial[k]} -> ${c[k]}`);}assert.equal(row.bar.height,rows[0].bar.height);}
   if(await p.locator('#ppte-save-panel > div').isVisible()) {
    const panel=await p.locator('#ppte-save-panel > div').boundingBox();
    assert.ok(panel&&panel.y>=row.bar.height&&panel.x>=0&&panel.x+panel.width<=width&&panel.y+panel.height<=960,`${state}: panel stays below toolbar and inside viewport`);
   }
   rows.push({state,...row});
   await p.screenshot({path:join(out,`${width}-${path}-${state}.png`),clip:{x:0,y:0,width,height:Math.min(450,960)},caret:'initial'});
  };
  const readSelector='#ppte-save-ui .modes button:first-child',editSelector='#ppte-save-ui .modes button:last-child';
  await p.locator(readSelector).focus();await measure('read',readSelector);
  for(const selector of ['.save-action','#ppte-save-panel summary']){await p.locator(selector).evaluate((n:HTMLElement)=>n.focus());assert.equal(await p.locator(readSelector).evaluate(n=>n===document.activeElement),true);}
  assert.equal(await p.getByRole('button',{name:/^保存$|^下载更新后的文件$/}).count(),0);
  assert.equal(await p.getByRole('status').count(),0);
  await p.keyboard.press('Tab');assert.equal(await p.locator(editSelector).evaluate(n=>n===document.activeElement),true);
  await p.keyboard.press('Enter');await measure('edit',editSelector);
  assert.ok(rows[1].frame.y>rows[0].frame.y,'canvas still adapts for edit toolbar');
  if(path==='download')assert.equal(await p.locator('.save-action').evaluate(n=>n.scrollWidth<=n.clientWidth&&n.scrollHeight<=n.clientHeight),true,'full download label fits');
  const heading=p.frameLocator('#ppte-frame').locator('h1').first();
  await heading.fill(`R01 ${width} ${path} saved content`);await p.locator(editSelector).click();await measure('dirty',editSelector);
  let savedFile=file;
  if(path==='write'){
   await p.locator('.save-action').click();await p.getByRole('button',{name:'选择当前文件并保存',exact:true}).click();
   await p.waitForFunction(()=>(window as any).PPTeSave.state==='saving');
   await measure('saving','.save-action');
   // Wait until the disk bridge reached close(), then release the held write.
   while(!waiting)await new Promise(r=>setTimeout(r,10));release();await p.waitForFunction(()=>(window as any).PPTeSave.state==='saved');
   await measure('success','.save-action');assert.equal(writes,1);
  }else{
   const event=p.waitForEvent('download');await p.locator('.save-action').click();savedFile=join(out,`${width}-download-saved.html`);await(await event).saveAs(savedFile);
   await measure('success','.save-action');assert.equal(await readFile(file,'utf8'),original);
   // Download is synchronous and never claims disk-saving/saved. Inject otherwise
   // unreachable controller states only to regression-test fallback layout rendering.
   await p.evaluate(()=>(window as any).PPTeSave.set('saving','fallback renderer fixture'));
   await measure('saving-render-fixture','.save-action');
  }
  const saved=await readFile(savedFile,'utf8');assert.match(readEnhanced(saved).content,new RegExp(`R01 ${width} ${path} saved content`));
  const reopened=await browser.newPage({offline:true});await reopened.goto(pathToFileURL(savedFile).href);await reopened.waitForFunction(()=>!!(window as any).PPTeSave);assert.equal(await reopened.frameLocator('#ppte-frame').locator('h1').first().innerText(),`R01 ${width} ${path} saved content`);await reopened.close();
  if(path==='write'){
   failure=true;await heading.fill('R01 retained after failure');await p.locator('.save-action').click();await p.waitForFunction(()=>(window as any).PPTeSave.state==='saving');while(!waiting)await new Promise(r=>setTimeout(r,10));release();await p.waitForFunction(()=>(window as any).PPTeSave.state==='failed');
  }else await p.evaluate(()=>(window as any).PPTeSave.set('failed','fallback renderer fixture '+ '长错误说明'.repeat(80)));
  await measure('failed','.save-action');
  assert.equal(await p.locator('.save-detail').innerText(),await p.locator('[role=status]').innerText());
  if(path==='write'){
   failure=false;await writeFile(file,saved+'\n<!-- external conflict -->');await p.locator('.save-action').click();await p.waitForFunction(()=>(window as any).PPTeSave.state==='conflict');assert.equal(await heading.innerText(),'R01 retained after failure');assert.equal(writes,1);
  }else await p.evaluate(()=>(window as any).PPTeSave.set('conflict','fallback renderer fixture'));
  await measure('conflict','.save-action');
  await p.locator(readSelector).click();await measure('read-again',readSelector);
  assert.equal(await p.getByRole('status').count(),0);
  await writeFile(join(out,`${width}-${path}-positions.json`),JSON.stringify({time:new Date().toISOString(),platform:process.platform,browser:browser.version(),headless:true,nativePicker:false,path,sha256:digest(saved),rows},null,2));
 } finally {await browser.close();}
});
