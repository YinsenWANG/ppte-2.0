import { chromium } from 'playwright';
import { enhanceHTML } from '../dist/packages/html-document/src/index.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { hash } from './html-benchmark.mjs';
export async function measureGapsPerformance(out='docs/ui-redesign/evidence/r8-GAPS/verification', headless=true) {
 const dir=resolve(out);await mkdir(dir,{recursive:true});
 const source='<title>S04 12页性能样本</title><style>body{margin:0;font:24px system-ui}section{height:640px;width:1080px;padding:32px;box-sizing:border-box}h1{font-size:48px}</style>'+Array.from({length:12},(_,i)=>`<section data-ppte-slide data-ppte-id="s${i}"><h1 data-ppte-id="t${i}">第 ${i+1} 页：完整保留事实</h1><p>固定轻资源样本，输入、翻页与保存均保留全部十二页。</p></section>`).join('');
 const file=resolve(dir,'performance.ppte.html');await writeFile(file,(await enhanceHTML(source,{root:dir,base:dir})).html);
 const browser=await chromium.launch({channel:'chrome',headless});
 const p95=a=>[...a].sort((a,b)=>a-b)[Math.ceil(a.length*.95)-1];
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);
  const idle=async()=>page.evaluate(async()=>{const values=[];for(let i=0;i<30;i++){const t=performance.now();await new Promise(r=>requestAnimationFrame(r));values.push(performance.now()-t);}return values;});
  const blankIdle=await idle();
  await page.goto(pathToFileURL(file).href);await page.waitForFunction(()=>window.PPTeEditor);
  await page.getByRole('button',{name:'编辑',exact:true}).click();
  const editorIdle=await idle();
  const title=page.frameLocator('#ppte-frame').locator('h1').first();
  for(let click=0;click<2;click++){const r=await title.boundingBox();await page.mouse.click(r.x+r.width/2,r.y+r.height/2,{clickCount:click?2:1});}
  await page.keyboard.press('End');
  await page.evaluate(()=>{
   window.gaps={input:[],turn:[],inputHandler:[],turnHandler:[],longTasks:[]};
   try{new PerformanceObserver(list=>window.gaps.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask'});}catch{}
   const doc=document.querySelector('#ppte-frame').contentDocument;
   let inputStart=0,turnStart=0;
   doc.addEventListener('input',()=>{const t=inputStart=performance.now();requestAnimationFrame(()=>window.gaps.input.push(performance.now()-t));},true);
   doc.addEventListener('input',()=>window.gaps.inputHandler.push(performance.now()-inputStart));
   document.addEventListener('click',e=>{if(!e.target.closest('button[aria-label="下一页"],button[aria-label="上一页"]'))return;const t=turnStart=performance.now();requestAnimationFrame(()=>window.gaps.turn.push(performance.now()-t));},true);
   document.addEventListener('click',e=>{if(e.target.closest('button[aria-label="下一页"],button[aria-label="上一页"]'))window.gaps.turnHandler.push(performance.now()-turnStart);});
  });
  for(let i=0;i<30;i++){await page.keyboard.type('x');await page.waitForFunction(n=>window.gaps.input.length===n,i+1);}
  const inputText=await page.frameLocator('#ppte-frame').locator('h1').first().innerText();
  for(let i=0;i<30;i++){await page.getByRole('button',{name:i%2?'上一页':'下一页',exact:true}).click();await page.waitForFunction(n=>window.gaps.turn.length===n,i+1);}
  const samples=await page.evaluate(()=>window.gaps);
  const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');const before=await cdp.send('Performance.getMetrics');const metricIdle=await idle();const after=await cdp.send('Performance.getMetrics');
  const metric=name=>after.metrics.find(m=>m.name===name).value-before.metrics.find(m=>m.name===name).value;
  const result={time:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceSha256:hash(source),environment:{platform:os.platform(),release:os.release(),cpu:os.cpus()[0].model,chrome:browser.version(),node:process.version,viewport:[1440,1000],headless,customLaunchFlags:[],referenceFrozen:false},method:'Real double-click + keyboard typing and visible previous/next buttons; capture listener through next top-window rAF. Handler is capture through last bubble listener, including downstream product event handling. No internal Commands mutations.',samples:{...samples,blankIdle,editorIdle,metricIdle},p95:{input:p95(samples.input),turn:p95(samples.turn),inputHandler:p95(samples.inputHandler),turnHandler:p95(samples.turnHandler),blankIdle:p95(blankIdle),editorIdle:p95(editorIdle)},idleMetricsSeconds:Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'].map(name=>[name,metric(name)])),inputText,pages:await page.frameLocator('#ppte-frame').locator('[data-ppte-slide]').count()};
  result.targets={inputLimitMs:50,turnLimitMs:100,inputPassed:result.p95.input<=50,turnPassed:result.p95.turn<=100};
  await writeFile(resolve(dir,'performance.json'),JSON.stringify(result,null,2)+'\n');return result;
 }finally{await browser.close();}
}
if(process.argv[1]===new URL(import.meta.url).pathname) console.log(JSON.stringify((await measureGapsPerformance()).p95));
