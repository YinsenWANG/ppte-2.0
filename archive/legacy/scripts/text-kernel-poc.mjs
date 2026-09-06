// E02: same C01 deck, device, fonts and sampling protocol; active-text experiment only.
import { chromium } from 'playwright'
import { build } from 'esbuild'
import { gzipSync } from 'node:zlib'
import { makeCoreDocument, IDS } from './blackbox-fixtures.mjs'
import { buildPortable } from '../dist/packages/portable-runtime/src/index.js'
import { canonicalRevision } from '../dist/packages/canonical-json/src/index.js'
import { percentile } from '../dist/packages/performance-budget/src/index.js'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir, cpus, platform, release, arch, totalmem } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const budget=JSON.parse(readFileSync('docs/evolution/quality/m1-dependency-budget.json','utf8'))
const fixture=JSON.parse(readFileSync('tests/fixtures/evolution/text-poc.json','utf8'))
const dir=mkdtempSync(join(tmpdir(),'e02-browser-'))
const report={protocolVersion:budget.version,baseCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),measuredAt:new Date().toISOString(),environment:{node:process.version,os:platform(),release:release(),arch:arch(),cpu:cpus()[0].model,logicalCpus:cpus().length,memoryBytes:totalmem(),viewport:budget.protocol.viewport,headless:true},fixtureSha256:sha(JSON.stringify(fixture)),sourceHashes:Object.fromEntries(['tests/helpers/text-kernel-poc.ts','tests/helpers/text-kernel-prosemirror.ts','scripts/text-kernel-poc.mjs'].map(p=>[p,sha(readFileSync(p))])),candidates:[],unverified:fixture.unverified,scope:'C01 full-portable corpus plus one external active text box. API-to-paint input, not OS IME. Shared Core commit renderer may replace canvas nodes; active editor and unrelated semantic objects must remain stable.'}
const summarize=samplesMs=>({samplesMs,p50Ms:percentile(samplesMs,.5),p95Ms:percentile(samplesMs,.95)})
let browser
try {
 for(const candidate of ['native','prosemirror']) {
  const source=`import {planTextReplacement} from './packages/editor-controller/src/commands.ts';import {mount,nativeFactory,textOf} from './tests/helpers/text-kernel-poc.ts';${candidate==='prosemirror'?"import {prosemirrorFactory} from './tests/helpers/text-kernel-prosemirror.ts';":''}
  const api=globalThis.PPTEPortable; const doc=api.getDocument(); const slide=doc.slides[doc.slideOrder[0]];const element=slide.elements['${IDS.body}-0'];
  const root=document.createElement('div');root.id='e02-active';root.style.cssText='position:fixed;bottom:0;left:0;background:white;white-space:pre-wrap;z-index:1000';document.body.append(root);
  const kernel=${candidate}Factory(root,element.content);globalThis.E02={root,kernel,textOf,step(j){const current=api.getDocument().slides[doc.slideOrder[0]].elements[element.id]; const before=JSON.stringify(api.getDocument().slides[doc.slideOrder[1]]);kernel.select(0,0);kernel.insert('中'); const local=kernel.read();
  const tx=planTextReplacement({transactionId:'e02-'+j,baseRevision:api.getRevision(),slideId:doc.slideOrder[0],elementId:element.id,content:local,createdAt:'2026-09-06T00:00:00Z'});
  const result=api.commit(tx);if(!result.ok)throw Error(JSON.stringify(result));if(JSON.stringify(api.getDocument().slides[doc.slideOrder[1]])!==before)throw Error('unrelated semantic slide changed');if(root!==document.getElementById('e02-active'))throw Error('active DOM replaced');if(textOf(api.getDocument().slides[doc.slideOrder[0]].elements[element.id].content)!==textOf(local))throw Error('incorrect document');return true;}};`
  const bundled=await build({stdin:{contents:source,resolveDir:process.cwd()},bundle:true,write:false,minify:true,format:'iife',platform:'browser',metafile:true})
  const script=bundled.outputFiles[0].text
  const entry={candidate,bundleRawBytes:Buffer.byteLength(script),bundleGzipBytes:gzipSync(script).length,inputs:Object.keys(bundled.metafile.inputs),cases:[]}
  report.candidates.push(entry)
  for(const count of budget.protocol.pageCounts) {
   const document=makeCoreDocument();document.assets={};const template=document.slides[IDS.slide];delete template.elements[IDS.image];template.rootOrder=template.rootOrder.filter(id=>id!==IDS.image);template.readingOrder=template.readingOrder.filter(id=>id!==IDS.image);document.slides={};document.slideOrder=[]
   for(let i=0;i<count;i++){const slide=structuredClone(template);slide.id=`page-${i}`;slide.elements=Object.fromEntries(Object.entries(slide.elements).map(([id,e])=>[`${id}-${i}`,{...e,id:`${id}-${i}`} ]));slide.rootOrder=slide.rootOrder.map(id=>`${id}-${i}`);slide.readingOrder=slide.readingOrder.map(id=>`${id}-${i}`);document.slides[slide.id]=slide;document.slideOrder.push(slide.id)}
   const built=buildPortable(document,{profile:'full-portable',derivedAt:'2026-09-06T00:00:00Z'});if(!built.ok)throw Error(JSON.stringify(built.issues))
   const end=built.html.lastIndexOf('</body>')
   const html=built.html.slice(0,end)+`<style>#e02-active p{margin:0}</style><script>${script.replace(/<\/script/gi,'<\\/script')}</script>`+built.html.slice(end)
   const file=join(dir,`${candidate}-${count}.html`);writeFileSync(file,html)
   const profileGzipBytes={}
   for(const profile of Object.keys(budget.runtimeGzipCapsBytes)){const b=buildPortable(document,{profile,derivedAt:'2026-09-06T00:00:00Z'});if(!b.ok)throw Error('profile build failed');profileGzipBytes[profile]=b.runtimeGzipBytes+entry.bundleGzipBytes}
   const cold=[],warm=[],input=[]
   const ready=async page=>{await page.waitForFunction(()=>Boolean(globalThis.E02));return page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()})}
   for(let i=0;i<budget.protocol.startupSamples;i++) {
    browser=await chromium.launch({headless:true});report.environment.browser=browser.version();const page=await browser.newPage({viewport:budget.protocol.viewport});await page.route(/^https?:/,r=>r.abort());page.on('pageerror',e=>process.stderr.write(String(e)+'\n'));await page.goto(pathToFileURL(file).href);cold.push(await ready(page));await page.reload();warm.push(await ready(page))
    if(i===budget.protocol.startupSamples-1)for(let j=0;j<budget.protocol.interactionSamples;j++)input.push(await page.evaluate(async j=>{const start=performance.now();globalThis.E02.step(j);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-start},j))
    await browser.close();browser=undefined
   }
   entry.cases.push({pageCount:count,fixtureRevision:canonicalRevision(document),htmlSha256:sha(html),fontPolicy:'system Inter fallback; no embedded fonts; document.fonts.ready awaited',profileGzipBytes,cold:summarize(cold),warm:summarize(warm),input:summarize(input),documentCorrect:true,activeNodeStable:true,unrelatedSemanticSlideStable:true})
   process.stderr.write(`${candidate} ${count}: measured\n`)
  }
 }
 const [native,pm]=report.candidates
 report.increments={runtimeRawBytes:pm.bundleRawBytes-native.bundleRawBytes,runtimeGzipBytes:pm.bundleGzipBytes-native.bundleGzipBytes,cases:pm.cases.map((p,i)=>({pageCount:p.pageCount,coldStartupP95Ms:p.cold.p95Ms-native.cases[i].cold.p95Ms,warmStartupP95Ms:p.warm.p95Ms-native.cases[i].warm.p95Ms,inputP95Ms:p.input.p95Ms-native.cases[i].input.p95Ms}))}
 report.budgetPass=Object.entries(report.increments).filter(([k])=>k!=='cases').every(([k,v])=>v<=budget.incrementalLimits[k])&&report.increments.cases.every(c=>Object.entries(c).filter(([k])=>k!=='pageCount').every(([k,v])=>v<=budget.incrementalLimits[k]))&&report.candidates.every(c=>c.cases.every(p=>Object.entries(p.profileGzipBytes).every(([k,v])=>v<=budget.runtimeGzipCapsBytes[k])))
 writeFileSync(process.argv[2]??'/tmp/e02-text-kernel-measurements.json',JSON.stringify(report,null,2)+'\n')
} finally {await browser?.close();rmSync(dir,{recursive:true,force:true})}
