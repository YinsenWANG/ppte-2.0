// Diagnostic only. Uses installed Chrome/PDFKit/PyMuPDF. Never imported by product.
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import os from 'node:os';
const out=resolve(process.env.U04_OUT||'docs/usability-reset/evidence/U04');
const old=resolve('docs/focused-product/evidence/F04A');
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=(p,v)=>writeFile(p,JSON.stringify(v,null,2));
await mkdir(out,{recursive:true});
await mkdir(resolve('artifacts'),{recursive:true});
const inspector=resolve('artifacts/u04-inspect');
execFileSync('swiftc',['scripts/f04a/inspect.swift','-o',inspector]);
const inspect=async(path,screen)=>{
 const pdfkit=JSON.parse(execFileSync(inspector,[path,...screen?[screen]:[]],{encoding:'utf8',maxBuffer:40e6}));
 const mupdf=JSON.parse(execFileSync('python3',['scripts/u04/mupdf_probe.py',path],{encoding:'utf8',maxBuffer:40e6}));
 const result={sha256:sha(await readFile(path)),pdfkit,mupdf};await json(`${path}.json`,result);return result;
};
const historical=[];
for(const id of ['fixtures-01','fixtures-04','cherry-10'])for(const name of ['chromium','chromium-viewport1440-scale150']){
 const dest=`${out}/original-${id}-${name}.pdf`;await copyFile(`${old}/${id}/${name}.pdf`,dest);
 const r=await inspect(dest);historical.push({id,name,file:dest.split('/').pop(),sha256:r.sha256,pdfkitText:r.pdfkit[0].text,mupdfText:r.mupdf.pages[0].text,pdfkitSearch:r.pdfkit[0].search,mupdfSearch:r.mupdf.pages[0].search});
}
await json(`${out}/historical.json`,historical);
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({offline:true,viewport:{width:1440,height:960},deviceScaleFactor:1});
const page=await context.newPage();const requests=[];page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url())});
const cdp=await context.newCDPSession(page);const rows=[];const startedAt=new Date().toISOString();
try{
 const probe=JSON.parse(await readFile(`${old}/probe.json`));
 for(const row of probe.rows){
  const dir=`${out}/${row.id}`;await mkdir(dir,{recursive:true});const selector=row.source==='prototype'?'#slide':'.slide';
  const index=Number(row.id.split('-')[1])-1;
  async function prepare(outer,scale){
   await page.setViewportSize(outer);await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:scale});
   await page.goto(pathToFileURL(`${old}/inputs/${row.source}.html`).href);
   // Fix author viewport BEFORE measuring/layout and reset visual zoom for export.
   await page.setViewportSize({width:row.width,height:row.height});await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});
   await page.evaluate(({selector,index,width,height})=>{
    [...document.querySelectorAll(selector)].forEach((n,j)=>{if(j!==index)n.style.setProperty('display','none','important');else n.setAttribute('data-u04-target','')});
    const s=document.createElement('style');s.textContent=`html,body{margin:0!important;padding:0!important;overflow:visible!important} @page{size:${width}px ${height}px;margin:0} *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;animation:none!important;transition:none!important}`;document.head.append(s);
   },{selector,index,width:row.width,height:row.height});
   await page.emulateMedia({media:'screen'});await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(im=>im.decode()))});
  }
  await prepare({width:1440,height:960},1);
  await page.locator('[data-u04-target]').screenshot({path:`${dir}/screen.png`});
  const dom=await page.locator('[data-u04-target]').evaluate(n=>({text:n.innerText,rects:[...n.querySelectorAll('*')].map(x=>{const r=x.getBoundingClientRect();return [x.tagName,r.x,r.y,r.width,r.height]})}));
  const start=performance.now();await page.pdf({path:`${dir}/fixed.pdf`,preferCSSPageSize:true,printBackground:true});const elapsedMs=performance.now()-start;
  const fixed=await inspect(`${dir}/fixed.pdf`,`${dir}/screen.png`);
  await prepare({width:1800,height:1100},1.5);
  const rects=await page.locator('[data-u04-target]').evaluate(n=>[...n.querySelectorAll('*')].map(x=>{const r=x.getBoundingClientRect();return [x.tagName,r.x,r.y,r.width,r.height]}));
  await page.pdf({path:`${dir}/variant.pdf`,preferCSSPageSize:true,printBackground:true});const variant=await inspect(`${dir}/variant.pdf`);
  const norm=s=>s.replace(/\s/g,'');
  rows.push({pageSizeExact:JSON.stringify(fixed.mupdf.pages[0].size)===JSON.stringify([row.width*.75,row.height*.75]),actualSizePt:fixed.mupdf.pages[0].size,id:row.id,width:row.width,height:row.height,elapsedMs,bytes:(await readFile(`${dir}/fixed.pdf`)).length,domText:dom.text,domGeometryEqual:JSON.stringify(dom.rects)===JSON.stringify(rects),pdfkitText:fixed.pdfkit[0].text,mupdfText:fixed.mupdf.pages[0].text,pdfkitFullText:norm(dom.text)===norm(fixed.pdfkit[0].text),mupdfFullText:norm(dom.text)===norm(fixed.mupdf.pages[0].text),pdfkitRasterEqual:sha(await readFile(`${dir}/fixed.pdf.page-0.png`))===sha(await readFile(`${dir}/variant.pdf.page-0.png`)),mupdfRasterEqual:fixed.mupdf.pages[0].rasterSHA256===variant.mupdf.pages[0].rasterSHA256,screenDifference:fixed.pdfkit[0].screenDifference,sha256:fixed.sha256});
  console.log(row.id,JSON.stringify(rows.at(-1)));await json(`${out}/rows.json`,rows);
 }
}finally{await browser.close()}
await json(`${out}/environment.json`,{startedAt,finishedAt:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),platform:os.platform(),release:os.release(),arch:os.arch(),node:process.version,browser:browser.version(),requests,dependenciesAdded:0,headless:true,authorViewport:'frozen per-page width/height before layout; visual scale reset to 1',memory:'not measured in this diagnostic; historical host RSS only, no isolated peak claim'});
