import { chromium } from 'playwright';
import { enhanceHTML } from '../dist/packages/html-document/src/index.js';
import { writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { hash } from './html-benchmark.mjs';
const dir=resolve('docs/single-file-first/evidence/s04'), label=process.argv[2];
if(!['before','after'].includes(label)) throw Error('before or after required');
const source='<title>S04 12页性能样本</title><style>body{margin:0;font:24px system-ui}section{height:640px;width:1080px;padding:32px;box-sizing:border-box}h1{font-size:48px}</style>'+Array.from({length:12},(_,i)=>`<section data-ppte-slide data-ppte-id="s${i}"><h1 data-ppte-id="t${i}">第 ${i+1} 页：完整保留事实</h1><p>固定轻资源样本，输入、翻页与保存均保留全部十二页。</p></section>`).join('');
const start=performance.now(), result=await enhanceHTML(source,{root:dir,base:dir}), enhanceMs=performance.now()-start;
const file=resolve(dir,`${label}.ppte.html`); await writeFile(file,result.html);
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const open=performance.now(); await page.goto(pathToFileURL(file).href); await page.waitForFunction(()=>window.PPTeSave&&window.PPTeEditor); const editableMs=performance.now()-open;
 await page.getByRole('button',{name:'编辑',exact:true}).click();
 const samples=await page.evaluate(async()=>{
  const c=window.PPTeEditor.commands,s=window.PPTeSave,doc=c.doc;
  const counts={notifications:0,serializations:0,draftWrites:0,slideClones:0};
  const change=s.change.bind(s);s.change=()=>{counts.notifications++;change();};
  const content=s.content.bind(s);s.content=()=>{counts.serializations++;return content();};
  const set=Storage.prototype.setItem;Storage.prototype.setItem=function(...a){counts.draftWrites++;return set.apply(this,a);};
  const proto=doc.defaultView.Node.prototype,clone=proto.cloneNode;proto.cloneNode=function(...a){if(this.nodeType===1&&this.hasAttribute('data-ppte-slide'))counts.slideClones++;return clone.apply(this,a);};
  const frame=()=>new Promise(r=>requestAnimationFrame(()=>r(performance.now())));
  const input=[],turn=[],save=[];
  for(let i=0;i<30;i++) {const n=c.node('t0'),t=performance.now();n.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,inputType:'insertText',data:'字'}));n.textContent+='字';n.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'字'}));input.push(await frame()-t);}
  const inputCounts={...counts};await new Promise(r=>setTimeout(r,900));
  for(let i=0;i<30;i++){const t=performance.now();document.querySelectorAll('#ppte-pages button')[i%12].click();turn.push(await frame()-t);}
  // Controlled adapter acknowledgement, NOT native file-picker/disk acceptance.
  s.adapter={load:async()=>s.base,write:async(expected,content)=>({...s.base,content,hash:String(Math.random()),metadata:{...s.base.metadata,saveRevision:s.base.metadata.saveRevision+1}})};
  for(let i=0;i<10;i++){const t=performance.now();c.transaction(['t0'],n=>n.textContent+='存');await new Promise((resolve,reject)=>{const until=performance.now()+5000;const timer=setInterval(()=>{if(!s.dirty){clearInterval(timer);resolve();}else if(performance.now()>until){clearInterval(timer);reject(Error('save timeout'));}},5);});save.push(performance.now()-t);}
  return {input,turn,save,inputCounts,totalCounts:counts,pages:doc.querySelectorAll('[data-ppte-slide]').length,text:c.node('t0').textContent};
 });
 const p95=a=>[...a].sort((a,b)=>a-b)[Math.ceil(a.length*.95)-1];
 await writeFile(resolve(dir,`${label}.json`),JSON.stringify({label,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceSha256:hash(source),environment:{platform:os.platform(),release:os.release(),arch:os.arch(),cpu:os.cpus()[0].model,chrome:browser.version(),node:process.version,viewport:[1440,1000],referenceFrozen:false},phases:{enhanceMs,editableMs,installation:'unavailable; existing installation reused',research:'unavailable',generation:'unavailable',correction:'unavailable',modelTokens:'unavailable',modelCalls:'unavailable',imagePreprocessing:'unavailable; light fixture has no media'},samples,p95:{input:p95(samples.input),turn:p95(samples.turn),save:p95(samples.save)},saveMode:'controlled in-memory adapter; includes 800ms debounce; no native disk claim'},null,2)+'\n');
} finally{await browser.close();}
