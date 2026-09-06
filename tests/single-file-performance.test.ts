import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { embedResources } from '../packages/html-document/src/resources.js';
import { enhanceHTML } from '../packages/html-document/src/index.js';
import { SaveController, type Snapshot } from '../packages/html-editor/src/save.js';

test('S04 cache: bytes, MIME, requirement/transform context, root authorization and budget cannot be stale', async()=>{
 const root=await mkdtemp(join(tmpdir(),'s04-cache-')),outside=await mkdtemp(join(tmpdir(),'s04-out-'));
 try {
  const svg='<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
  await writeFile(join(root,'a.svg'),svg);await writeFile(join(outside,'a.svg'),svg);
  const input='<img src="a.svg"><img src="a.svg">';
  const a=await embedResources(input,{root,base:root});assert.equal(a.metrics.reads,1);assert.equal(a.metrics.encodings,1);assert.equal(a.metrics.hits,1);
  const hot=await embedResources(input,{root,base:root});assert.equal(hot.html,a.html);assert.equal(hot.metrics.encodings,0);assert.equal(hot.metrics.authorizationChecks,2);
  await writeFile(join(root,'a.svg'),svg.replace('10','20'));
  const changed=await embedResources(input,{root,base:root});assert.notEqual(changed.html,a.html);assert.equal(changed.metrics.encodings,1);
  for(const cacheContext of ['crop:contain;intent:chart','crop:cover;intent:portrait'])assert.equal((await embedResources(input,{root,base:root,cacheContext})).metrics.encodings,1);
  await writeFile(join(root,'a.png'),svg.replace('10','20'));assert.equal((await embedResources('<img src="a.png">',{root,base:root})).metrics.encodings,1);
  await assert.rejects(embedResources(input,{root,base:root,maxBytes:1}),/BUDGET/);
  await assert.rejects(embedResources('<img src="https://example.invalid/a.svg">',{root,base:root}),/AUTHORIZATION/);
  await rm(join(root,'a.svg'));await symlink(join(outside,'a.svg'),join(root,'a.svg'));
  await assert.rejects(embedResources(input,{root,base:root}),/OUTSIDE_ROOT/);
  // Exercise entry eviction; the process cache is bounded even with new demands.
  for(let i=0;i<140;i++)assert.ok((await embedResources('<img src="a.png">',{root,base:root,cacheContext:String(i)})).metrics.cacheBytes<=8*1024*1024);
  assert.equal((await embedResources('<img src="a.png">',{root,base:root,cacheContext:'0'})).metrics.encodings,1);
 }finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});

test('S04 draft: bounded checkpoints, revision reuse, latest recovery and permission checks on each flush',async()=>{
 const base:Snapshot={content:'old',hash:'base',metadata:{documentId:'doc',saveRevision:0},fileKey:'a',name:'a'};
 let value='first',serializations=0,writes=0,permission=true;
 const map=new Map<string,string>();
 const c=new SaveController({load:async()=>base,write:async(_,content)=>{writes++;if(!permission)throw Error('PERMISSION_REVOKED');return {...base,content,hash:'next'};}},base,()=>{serializations++;return value;},()=>{},{getItem:k=>map.get(k)??null,setItem:(k,v)=>{map.set(k,v);},removeItem:k=>{map.delete(k);}},'a');
 c.change();assert.equal(serializations,1);
 for(let i=0;i<20;i++){value=String(i);c.change();}assert.equal(serializations,1);
 await new Promise(r=>setTimeout(r,250));assert.equal(JSON.parse(map.get('a')!).content,'19');assert.equal(serializations,2);
 await c.flush();assert.equal(serializations,2);assert.equal(c.state,'saved');assert.equal(map.size,0);
 value='unauthorized newest';permission=false;c.change();await c.flush();assert.equal(writes,2);assert.equal(c.state,'unauthorized');assert.equal(c.dirty,true);assert.equal(JSON.parse(map.get('a')!).content,value);
 c.composition(true);
});

test('S04 file browser: one input revision, local thumbnail, stable tools and synchronous index invalidation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'s04-browser-'));const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const file=join(root,'test.ppte.html');await writeFile(file,(await enhanceHTML('<section data-ppte-slide data-ppte-id="s"><h1 data-ppte-id="t">Alpha</h1></section><section data-ppte-slide data-ppte-id="s2"><h1>Beta</h1></section>',{root,base:root})).html);
  const page=await browser.newPage();await page.goto(pathToFileURL(file).href);await page.waitForFunction(()=>!!(window as any).PPTeSave);await page.getByRole('button',{name:'编辑',exact:true}).click();
  await page.frameLocator('#ppte-frame').locator('[data-ppte-id=t]').click();
  const result=await page.evaluate(()=>{
   const c=(window as any).PPTeEditor.commands,s=(window as any).PPTeSave;
   const buttons=Array.from(document.querySelectorAll('#ppte-pages button'));
   const other=buttons[1].querySelector('.preview')!.shadowRoot!.querySelector('div')!.firstChild;
   const tool=document.querySelector('#ppte-properties input'),rev=s.revision,n=c.node('t');
   n.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,data:'X'}));n.textContent+='X';n.dispatchEvent(new InputEvent('input',{bubbles:true,data:'X'}));
   const single=s.revision===rev+1,stable=document.querySelector('#ppte-properties input')===tool,local=buttons[1].querySelector('.preview')!.shadowRoot!.querySelector('div')!.firstChild===other;
   const updated=buttons[0].querySelector('.preview')!.shadowRoot!.textContent!.includes('AlphaX');
   const replacement=c.doc.createElement('p');replacement.dataset.ppteId='t';replacement.textContent='replacement';n.replaceWith(replacement);
   const replaced=c.node('t')===replacement;replacement.dataset.ppteId='new';let removed=false;try{c.node('t');}catch{removed=true;}
   return {single,stable,local,updated,replaced,removed,renamed:c.node('new')===replacement};
  });assert.deepEqual(result,{single:true,stable:true,local:true,updated:true,replaced:true,removed:true,renamed:true});
 }finally{await browser.close();await rm(root,{recursive:true,force:true});}
});
