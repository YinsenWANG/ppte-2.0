// C01 reference measurement. Run after pnpm build; never overwrites frozen evidence by default.
import { chromium } from 'playwright'
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
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const budget = JSON.parse(readFileSync('docs/evolution/quality/m1-dependency-budget.json','utf8'))
const dir = mkdtempSync(join(tmpdir(),'c01-browser-'))
const report = { protocolVersion: budget.version, commit: execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(), measuredAt: new Date().toISOString(), environment:{node:process.version,os:platform(),release:release(),arch:arch(),cpu:cpus()[0].model,logicalCpus:cpus().length,memoryBytes:totalmem(),viewport:budget.protocol.viewport,headless:true}, cases:[], unverified:['Real Safari','Lower-performance physical device','Host startup','Real Chinese IME','OS disk-cache cold boot'] }
const summarize = samplesMs => ({ samplesMs, p50Ms:percentile(samplesMs,.5),p95Ms:percentile(samplesMs,.95) })
let browser
try {
 for(const count of budget.protocol.pageCounts){
  const document=makeCoreDocument();document.assets={};const template=document.slides[IDS.slide];delete template.elements[IDS.image];template.rootOrder=template.rootOrder.filter(id=>id!==IDS.image);template.readingOrder=template.readingOrder.filter(id=>id!==IDS.image);document.slides={};document.slideOrder=[];
  for(let i=0;i<count;i++){const slide=structuredClone(template);slide.id=`page-${i}`;slide.elements=Object.fromEntries(Object.entries(slide.elements).map(([id,e])=>[`${id}-${i}`,{...e,id:`${id}-${i}`} ]));slide.rootOrder=slide.rootOrder.map(id=>`${id}-${i}`);slide.readingOrder=slide.readingOrder.map(id=>`${id}-${i}`);document.slides[slide.id]=slide;document.slideOrder.push(slide.id)}
  const built=buildPortable(document,{profile:'full-portable',derivedAt:'2026-09-06T00:00:00Z'});if(!built.ok)throw Error(JSON.stringify(built.issues));const file=join(dir,`${count}.html`);writeFileSync(file,built.html);
  const cold=[],warm=[],input=[];
  const ready=async page=>{await page.waitForFunction(()=>Boolean(globalThis.PPTEPortable));return page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()})};
  for(let i=0;i<budget.protocol.startupSamples;i++){browser=await chromium.launch({headless:true});report.environment.browser=browser.version();const page=await browser.newPage({viewport:budget.protocol.viewport});await page.goto(pathToFileURL(file).href);cold.push(await ready(page));await page.reload();warm.push(await ready(page));if(i===budget.protocol.startupSamples-1){for(let j=0;j<budget.protocol.interactionSamples;j++){input.push(await page.evaluate(async({id,j})=>{const start=performance.now();const result=globalThis.PPTEPortable.editText({elementId:id},`C01 input ${j}`);if(!result.ok)throw Error(JSON.stringify(result));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-start},{id:`${IDS.body}-0`,j}));}}await browser.close();browser=undefined;}
  report.cases.push({pageCount:count,fixtureRevision:canonicalRevision(document),htmlSha256:sha(built.html),fontPolicy:'system Inter fallback; no embedded fonts; document.fonts.ready awaited',runtimeBytes:built.runtimeBytes,runtimeGzipBytes:built.runtimeGzipBytes,htmlBytes:built.bytes,cold:summarize(cold),warm:summarize(warm),input:summarize(input)});
 }
 writeFileSync(process.argv[2]??'/tmp/c01-browser-baseline.json',JSON.stringify(report,null,2)+'\n')
} finally {await browser?.close();rmSync(dir,{recursive:true,force:true})}
