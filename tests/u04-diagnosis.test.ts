import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve('docs/usability-reset/evidence/U04');
const read=async(p:string)=>JSON.parse(await readFile(`${root}/${p}`,'utf8'));
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
test('U04 A1: same historical failed PDFs really replay in independent PDFKit and MuPDF parsers',async t=>{
 const historical=await read('historical.json');assert.equal(historical.length,6);
 for(const r of historical)assert.equal(sha(await readFile(`${root}/${r.file}`)),r.sha256);
 await t.test('native parser replay',{skip:process.platform!=='darwin'?'pending: PDFKit requires macOS; see recorded replay':false},async()=>{
  const scratch=resolve('artifacts/u04-replay');await mkdir(scratch,{recursive:true});
  execFileSync('swiftc',['scripts/f04a/inspect.swift','-o',`${scratch}/inspect`]);
  for(const r of historical){
   const pdf=`${scratch}/${r.file}`;await copyFile(`${root}/${r.file}`,pdf);
   const kit=JSON.parse(execFileSync(`${scratch}/inspect`,[pdf],{encoding:'utf8',maxBuffer:40e6}));
   const mu=JSON.parse(execFileSync('python3',['scripts/u04/mupdf_probe.py',pdf],{encoding:'utf8',maxBuffer:40e6}));
   assert.equal(kit[0].text,r.pdfkitText);assert.equal(mu.pages[0].text,r.mupdfText);
   assert.deepEqual(kit[0].search,r.pdfkitSearch);assert.deepEqual(mu.pages[0].search,r.mupdfSearch);
   assert.ok(kit[0].characters.length>0);assert.ok(mu.pages[0].words.length>0);
  }
 });
 const mixed=historical.find((r:any)=>r.id==='fixtures-01');
 assert.equal(mixed.pdfkitSearch['English 2026'].length,0);assert.equal(mixed.mupdfSearch['English 2026'].length,1);
 assert.match(mixed.mupdfText,/第二行 English 2026/);assert.match(mixed.pdfkitText,/En\nlish 2026\ng/);
});
test('U04 A2/A3: all 20 fixed-author-viewport pages retain strict geometry, raster and text diagnostics',async()=>{
 const rows=await read('rows.json');assert.equal(rows.length,20);
 assert.deepEqual(Object.fromEntries(['prototype','cherry','fixtures'].map(s=>[s,rows.filter((r:any)=>r.id.startsWith(s)).length])),{prototype:3,cherry:10,fixtures:7});
 for(const r of rows){
  assert.equal(sha(await readFile(`${root}/${r.id}/fixed.pdf`)),r.sha256);
  const fixed=await read(`${r.id}/fixed.pdf.json`),variant=await read(`${r.id}/variant.pdf.json`);
  assert.equal(fixed.pdfkit.length,1);assert.equal(fixed.mupdf.pages.length,1);
  const requireExactSize=()=>assert.deepEqual(fixed.mupdf.pages[0].size,[r.width*.75,r.height*.75]);
  assert.deepEqual(fixed.mupdf.pages[0].size,r.actualSizePt);
  if(r.pageSizeExact)requireExactSize();else assert.throws(requireExactSize,assert.AssertionError,'page size quantization remains a qualification failure, not a relaxed tolerance');
  assert.equal(r.domGeometryEqual,true);assert.equal(r.pdfkitRasterEqual,true);assert.equal(r.mupdfRasterEqual,true);
  assert.equal(sha(await readFile(`${root}/${r.id}/fixed.pdf.page-0.png`)),sha(await readFile(`${root}/${r.id}/variant.pdf.page-0.png`)));
  assert.equal(fixed.mupdf.pages[0].rasterSHA256,variant.mupdf.pages[0].rasterSHA256);
  // Re-execute the independent parser on every current PDF, not just stored JSON.
  const actual=JSON.parse(execFileSync('python3',['scripts/u04/mupdf_probe.py',`${root}/${r.id}/fixed.pdf`],{encoding:'utf8',maxBuffer:40e6}));
  assert.deepEqual(actual,fixed.mupdf);
  assert.equal(r.screenDifference.automaticPassThreshold,null);
 }
 assert.equal(rows.find((r:any)=>r.id==='fixtures-01').pdfkitFullText,false);
 assert.equal(rows.find((r:any)=>r.id==='prototype-01').mupdfFullText,false);
 const color=await read('fixtures-05/fixed.pdf.json'),noRed=await read('fixtures-06/fixed.pdf.json'),noBlue=await read('fixtures-07/fixed.pdf.json');
 assert.ok(color.pdfkit[0].redPixels>4000&&color.pdfkit[0].bluePixels>4000);
 assert.equal(noRed.pdfkit[0].redPixels,0);assert.ok(noRed.pdfkit[0].bluePixels>4000);
 assert.equal(noBlue.pdfkit[0].bluePixels,0);assert.ok(noBlue.pdfkit[0].redPixels>4000);
 assert.deepEqual((await read('environment.json')).requests,[]);
});
test('U04 A3: live installed Chromium exports fixed viewport independently of caller zoom', {skip:process.platform!=='darwin'?'pending: frozen installed Chrome environment requires macOS':false},async()=>{
 const {chromium}=await import('playwright');const {pathToFileURL}=await import('node:url');
 const b=await chromium.launch({channel:'chrome',headless:true});
 try{const p=await b.newPage({offline:true});const cdp=await p.context().newCDPSession(p);const hashes=[];
 for(const width of [960,1800]){await p.setViewportSize({width,height:1000});await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:width===960?1:1.5});
 await p.goto(pathToFileURL(resolve('docs/focused-product/evidence/F04A/inputs/fixtures.html')).href);
 await p.setViewportSize({width:640,height:800});await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});
 await p.addStyleTag({content:'.slide:not([data-case=transforms]){display:none!important} @page{size:640px 800px;margin:0} *{-webkit-print-color-adjust:exact}'});
 await p.emulateMedia({media:'screen'});await p.evaluate(()=>document.fonts.ready);
 const dir=resolve('artifacts/u04-live');await mkdir(dir,{recursive:true});const pdf=`${dir}/${width}.pdf`;await p.pdf({path:pdf,preferCSSPageSize:true,printBackground:true});
 const parsed=JSON.parse(execFileSync('python3',['scripts/u04/mupdf_probe.py',pdf],{encoding:'utf8',maxBuffer:40e6}));assert.equal(parsed.pages.length,1);assert.match(parsed.pages[0].text,/变换后的中文 Text/);hashes.push(parsed.pages[0].rasterSHA256);
 }assert.equal(hashes[0],hashes[1]);}finally{await b.close()}
});
test('U04 decision gate: no qualified route, no product integration, explicit native/human pending',async()=>{
 const report=await read('verification/result.json');
 for(const row of report.acceptance){assert.ok(row.tests.length);for(const layer of ['code','automated','real-browser','human']){assert.ok(row.layers[layer]);if(row.layers[layer].status==='pending')assert.ok(row.layers[layer].reason.length>20)}}
 assert.equal(report.qualified,false);assert.equal(report.productIntegration,false);
 const tasks=JSON.parse(await readFile('docs/usability-reset/TASKS.json','utf8')).tasks;
 assert.equal(tasks.find((t:any)=>t.id==='U04').status,'awaiting-user-decision');
 assert.match(await readFile('docs/usability-reset/DECISIONS.md','utf8'),/U04[\s\S]*awaiting-user-decision/);
 const environment=await read('environment.json');assert.equal(environment.dependenciesAdded,0);
});
