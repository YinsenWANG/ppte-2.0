import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
const root=resolve('docs/focused-product/evidence/F04A');
const scratch=resolve('artifacts/f04a-tests');
const read=async(p:string)=>JSON.parse(await readFile(resolve(root,p),'utf8'));
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const norm=(s:string)=>s.replace(/\s/g,'');

test('F04A acceptance 1–3: replay real PDFs, full text, fonts, colors and frozen input integrity',async t=>{
 const probe=await read('probe.json');
 assert.equal(probe.rows.length,20);
 assert.equal(probe.candidates.length,2);
 assert.deepEqual(Object.fromEntries(['prototype','cherry','fixtures'].map(s=>[s,probe.rows.filter((r:any)=>r.source===s).length])),{prototype:3,cherry:10,fixtures:7});
 for(const input of await read('input-hashes.json'))assert.equal(sha(await readFile(resolve(root,input.path))),input.sha256,input.path);
 for(const input of (await read('freeze.json')).sources)assert.equal(sha(await readFile(input.path)),input.sha256,input.path);
 assert.deepEqual(probe.requests,[]);
 assert.deepEqual(probe.dependency.map((d:any)=>[d.package,d.version]),[['html-to-pdfmake','2.5.32'],['pdfmake','0.2.20']]);
 assert.ok(probe.dependency.every((d:any)=>d.bytes>d.gzipBytes && d.gzipBytes>0));
 for(const row of probe.rows){
  assert.equal(row.controls,0);
  assert.equal(sha(await readFile(`${root}/${row.id}/screen.png`)),row.screenSHA256);
  for(const c of ['browser','chromium']){
   const result=row.candidates[c], pdf=await readFile(`${root}/${row.id}/${c}.pdf`);
   assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.equal(pdf.length,result.bytes);assert.equal(sha(pdf),result.sha256);
   assert.ok(result.elapsedMs>0 && result.hostChromeSampledRSSBytes>0 && result.jsHeapAfter>0);
   assert.match(result.memoryMethod,/not isolated peak/);
  }
 }
 await t.test('PDFKit reopens and re-extracts every candidate page; negative controls really discriminate',{skip:process.platform!=='darwin'?'pending: independent PDFKit/CoreGraphics parser requires macOS':false},async()=>{
  await mkdir(scratch,{recursive:true});
  execFileSync('swiftc',['scripts/f04a/inspect.swift','-o',`${scratch}/inspect`]);
  const results:any={};
  for(const row of probe.rows)for(const c of ['browser','chromium']){
   const copy=`${scratch}/${row.id}-${c}.pdf`;await copyFile(`${root}/${row.id}/${c}.pdf`,copy);
   const actual=JSON.parse(execFileSync(`${scratch}/inspect`,[copy,`${root}/${row.id}/screen.png`],{encoding:'utf8',maxBuffer:30*1024*1024}));
   results[`${row.id}-${c}`]=actual;
   const recorded=await read(`${row.id}/${c}-inspection.json`);
   assert.equal(actual.length,row.candidates[c].pageCount);
   assert.deepEqual(actual.map((p:any)=>p.text),recorded.map((p:any)=>p.text));
   const text=actual.map((p:any)=>p.text).join('');
   const dom=await read(`${row.id}/screen-text.json`);
   assert.equal(norm(text)===norm(dom.text),row.candidates[c].fullTextExactIgnoringWhitespace);
   assert.deepEqual(dom.nodes.filter((n:any)=>!norm(text).includes(norm(n.text))).map((n:any)=>n.text),row.candidates[c].missingTextNodes);
   const requireTextPages=()=>assert.ok(actual.every((p:any)=>p.characters.length>0 && p.fonts.length>0));
   if(recorded.some((p:any)=>p.characters.length===0)){
    // Blank overflow pages are an observed candidate rejection, never a valid PDF pass.
    assert.throws(requireTextPages);assert.equal(c,'browser');assert.ok(actual.length>1);
    const assessment=await read('assessment.json');
    assert.ok(assessment.failures.some((f:any)=>f.page===row.id && f.candidate===c));
   }else requireTextPages();
   assert.deepEqual(actual.map((p:any)=>p.characters.length),recorded.map((p:any)=>p.characters.length));
   assert.equal(Math.round(actual[0].widthPt/.75),row.width);assert.equal(Math.round(actual[0].heightPt/.75),row.height);
   assert.deepEqual(actual[0].search,row.candidates[c].search);
  }
  for(const source of ['prototype','cherry','fixtures'])for(const c of ['browser','chromium']){
   const copy=`${scratch}/${source}-${c}-merged.pdf`;await copyFile(`${root}/${source}-${c}.pdf`,copy);
   const merged=JSON.parse(execFileSync(`${scratch}/inspect`,[copy],{encoding:'utf8',maxBuffer:30*1024*1024}));
   const expected=probe.rows.filter((r:any)=>r.source===source).flatMap((r:any)=>results[`${r.id}-${c}`]);
   const requireWholeIdentity=()=>assert.deepEqual(merged.map((p:any)=>[p.text,p.widthPt,p.heightPt]),expected.map((p:any)=>[p.text,p.widthPt,p.heightPt]),'whole deliverable preserves every page and mixed size');
   const whole=(await read('whole-inspection.json')).find((r:any)=>r.source===source && r.candidate===c);
   assert.deepEqual(merged.map((p:any)=>[p.text,p.widthPt,p.heightPt]),whole.pages.map((p:any)=>[p.text,p.widthPt,p.heightPt]));
   if(source==='fixtures' && c==='chromium'){
    // Strict equality remains a qualification requirement: the known spacing failure must reject it.
    assert.throws(requireWholeIdentity);assert.equal(whole.strictTextAndSizeEqual,false);
    assert.equal(merged[3].text,'三维变换 3D\n不同页面尺寸与复杂变换\n变换后的中文 Text\n选区应贴合可见字形');
    assert.match(expected[3].text,/T ex t/);
    assert.ok((await read('assessment.json')).failures.some((f:any)=>f.page==='fixtures-04-whole' && f.candidate==='chromium'));
   }else {requireWholeIdentity();assert.equal(whole.strictTextAndSizeEqual,true)}
  }
  // Preserve S07's >4000 RGB controls; no lower threshold to turn failures green.
  const pos=results['fixtures-05-chromium'][0],noRed=results['fixtures-06-chromium'][0],noBlue=results['fixtures-07-chromium'][0];
  assert.ok(pos.redPixels>4000 && pos.bluePixels>4000);
  assert.equal(noRed.redPixels,0);assert.ok(noRed.bluePixels>4000);
  assert.equal(noBlue.bluePixels,0);assert.ok(noBlue.redPixels>4000);
  assert.equal(results['fixtures-01-chromium'][0].search['English 2026'].length,0,'actual search failure must not be reported as a pass');
  assert.ok(results['fixtures-01-chromium'][0].search['甲乙丙丁'].length>0,'positive Chinese search control');
  assert.ok(results['prototype-01-browser'].length>1,'actual overflow failure retained');
  assert.ok(results['fixtures-01-browser'][0].fonts.some((f:any)=>f.descendant?.embeddedStreams?.includes('FontFile2')),'browser candidate embeds a TrueType subset');
 });
});

test('F04A acceptance 3: installed Chrome really exports frozen file:// fixture offline; not a product PDF action',{skip:process.platform!=='darwin'?'pending: frozen reference environment is macOS Chrome':false},async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const p=await browser.newPage({offline:true,viewport:{width:960,height:540}});const requests:string[]=[];
  p.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url())});
  await p.goto(pathToFileURL(`${root}/inputs/fixtures.html`).href);
  await p.addStyleTag({content:'.slide:not(:first-of-type){display:none} @page{size:960px 540px;margin:0} *{-webkit-print-color-adjust:exact}'});
  await p.emulateMedia({media:'screen'});await p.evaluate(()=>document.fonts.ready);
  assert.equal(await p.evaluate(()=>Array.from(document.fonts as unknown as Iterable<FontFace>).some(f=>f.family==='F04AEmbedded' && f.status==='loaded')),true);
  const pdf=await p.pdf({preferCSSPageSize:true,printBackground:true});assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  assert.ok(pdf.length>1000);assert.deepEqual(requests,[]);
 }finally{await browser.close()}
});

test('F04A acceptance 2: every human selection and physical-browser requirement remains explicitly pending',async()=>{
 const manual=await read('manual-selection.json');assert.equal(manual.records.length,40);
 assert.equal(manual.status,'pending');assert.ok(manual.reason.length>20);
 for(const r of manual.records){assert.equal(r.status,'pending');assert.equal(r.selectionScreenshot,null);assert.equal(r.copyObserved,null);assert.equal(r.operator,null);assert.equal(r.steps.length,4);await readFile(`${root}/${r.pdf}`)}
 const task=JSON.parse(await readFile('docs/focused-product/TASKS.json','utf8')).tasks.find((t:any)=>t.id==='F04A');
 assert.equal(task.verification.human,'pending');assert.equal(task.verification['real-browser'],'pending');
});

test('F04A acceptance 4: only external qualification requires HOLD; neither qualified cannot enable F04',async()=>{
 const {decidePDFRoute}=await import(pathToFileURL(resolve('scripts/f04a/decision.mjs')).href);
 assert.deepEqual(decidePDFRoute({browserQualified:false,externalQualified:true}),{conclusion:2,taskStatus:'awaiting-user-decision',hold:true,canStartF04:false,needsArchitectureDecision:true});
 assert.equal(decidePDFRoute({browserQualified:true,externalQualified:true}).conclusion,1);
 assert.equal(decidePDFRoute({browserQualified:null,externalQualified:null}).canStartF04,false);
 const assessment=await read('assessment.json');
 assert.equal(assessment.conclusion,3);assert.equal(assessment.architectureChanged,false);assert.equal(assessment.productDependenciesAdded,0);assert.deepEqual(assessment.extraProductRemovals,[]);
 assert.ok(assessment.failures.some((f:any)=>f.candidate==='browser'));
 assert.ok(assessment.failures.some((f:any)=>f.candidate==='chromium' && f.page==='fixtures-01'));
 const tasks=JSON.parse(await readFile('docs/focused-product/TASKS.json','utf8')).tasks;
 assert.equal(tasks.find((t:any)=>t.id==='F04').status,'pending');
 assert.equal(tasks.find((t:any)=>t.id==='F04A').status,decidePDFRoute({browserQualified:false,externalQualified:false}).taskStatus);
 const pkg=JSON.parse(await readFile('package.json','utf8'));
 assert.equal(pkg.dependencies?.pdfmake,undefined);assert.equal(pkg.devDependencies.pdfmake,undefined);
});
