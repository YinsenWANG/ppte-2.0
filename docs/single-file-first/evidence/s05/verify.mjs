// Repository acceptance probe, never part of ordinary authoring or the shipped Skill.
// Run from repository root after pnpm build.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
const out=resolve('docs/single-file-first/evidence/s05');
const manifest=JSON.parse(await readFile(join(out,'inputs.json'),'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const assets=[];
for(const a of manifest.items){const bytes=await readFile(a.path);assert.equal(sha(bytes),a.sha256);assets.push({...a,bytes});}
const temp=await mkdtemp(join(tmpdir(),'ppte-s05-'));
let browser;
try {
  const input=join(temp,'input');await mkdir(input);
  for(const a of assets.slice(0,2)) await copyFile(a.path,join(input,`${a.id}.png`));
  await copyFile(join(out,'source.html'),join(input,'source.html'));
  const cli=resolve('dist/apps/html-cli/index.js');
  const result=spawnSync(process.execPath,[cli,'enhance',join(input,'source.html'),'--out',join(temp,'review.ppte.html')],{encoding:'utf8'});
  assert.equal(result.status,0,result.stdout+result.stderr);
  const html=await readFile(join(temp,'review.ppte.html'),'utf8');
  await writeFile(join(out,'review.ppte.html'),html);
  await rm(input,{recursive:true}); // The delivered file must outlive its source directory.
  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({offline:true,viewport:{width:1640,height:1320}});
  const page=await context.newPage(), requests=[], errors=[];
  page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(pathToFileURL(join(out,'review.ppte.html')).href);
  await page.waitForFunction(()=>!!window.PPTeSave);
  const frame=page.frameLocator('#ppte-frame');
  const images=frame.locator('img');assert.equal(await images.count(),2);
  const observations=[];
  for(let i=0;i<2;i++){
    const seen=await images.nth(i).evaluate(async n=>{await n.decode();const s=getComputedStyle(n);return {src:n.getAttribute('src'),width:n.naturalWidth,height:n.naturalHeight,fit:s.objectFit,position:s.objectPosition,displayWidth:n.clientWidth,displayHeight:n.clientHeight};});
    assert.ok(seen.src.startsWith('data:image/png;base64,'));
    const hash=sha(Buffer.from(seen.src.split(',')[1],'base64'));assert.equal(hash,assets[i].sha256);
    assert.equal(seen.width,1440);assert.equal(seen.height,1000);
    assert.equal(seen.fit,i===0?'contain':'none');
    if(i===1){assert.equal(seen.position,'0% 0%');assert.equal(seen.displayHeight,300);assert.equal(seen.displayWidth,1440);}
    delete seen.src;observations.push({id:assets[i].id,embeddedSha256:hash,...seen});
  }
  for(let i=0;i<2;i++) await frame.locator('[data-ppte-slide]').nth(i).screenshot({path:join(out,`page-${i+1}.png`)});
  assert.deepEqual(requests.filter(u=>/^(https?|wss?):/.test(u)),[]);assert.deepEqual(errors,[]);
  // Contact sheet is navigation only. Source originals, never these tiles, feed the deck.
  const contact=await context.newPage();
  await contact.setViewportSize({width:1200,height:1100});
  await contact.setContent(`<style>body{background:#eee;font:18px sans-serif}main{display:grid;grid-template-columns:1fr 1fr;gap:12px}figure{margin:0;background:white;padding:10px}img{width:560px;height:290px;object-fit:contain}figcaption{height:35px}</style><main>${assets.map(a=>`<figure><figcaption>${a.id} — ${a.path.split('/').slice(-2).join('/')}</figcaption><img src="data:image/png;base64,${a.bytes.toString('base64')}"></figure>`).join('')}</main>`);
  await contact.locator('img').evaluateAll(ns=>Promise.all(ns.map(n=>n.decode())));
  await contact.screenshot({path:join(out,'contact.png'),fullPage:true});
  // Two actual text-only CLI runs with subprocess/network guards. No image branch or installer.
  const guard=join(temp,'guard.cjs');
  await writeFile(guard,`const cp=require('node:child_process');for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[k]=()=>{throw Error('SUBPROCESS_FORBIDDEN')};require('node:net').Socket.prototype.connect=()=>{throw Error('NETWORK_FORBIDDEN')};`);
  const textSource=join(temp,'text.html');await writeFile(textSource,'<!doctype html><html><head><title>Text only</title></head><body><section data-ppte-slide="text"><h1>Only text — no image work</h1></section></body></html>');
  const textRuns=[];
  for(let i=0;i<2;i++){
    const start=performance.now();const r=spawnSync(process.execPath,['--require',guard,cli,'enhance',textSource,'--out',join(temp,`text-${i}.ppte.html`)],{encoding:'utf8'});
    assert.equal(r.status,0,r.stdout+r.stderr);const summary=JSON.parse(r.stdout);assert.equal(summary.ok,true);assert.equal(summary.mediaBytes,0);
    textRuns.push({run:i+1,elapsedMs:performance.now()-start,summary,subprocessAndNetworkGuard:'passed'});
  }
  await writeFile(join(out,'verification/probe.json'),JSON.stringify({status:'passed',browser:browser.version(),headless:true,entry:'review.ppte.html via file://',sourceDirectoryRemoved:true,offline:true,requests,errors,images:observations,enhance:JSON.parse(result.stdout),fileSha256:sha(html),textRuns,limits:'CLI reuse only; Agent/model telemetry unavailable. No native picker, Safari, human review or user-upload fixture acceptance claimed.'},null,2)+'\n');
  console.log('S05 proxy originals/embedding/crop/offline and text-only CLI guards passed');
}finally{await browser?.close();await rm(temp,{recursive:true,force:true});}
