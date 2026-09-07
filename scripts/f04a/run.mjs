import {wholeChromium} from './whole-chromium.mjs';
// Two bounded candidates. Evidence-only adapter; no product code or dependency changes.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir, stat, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
const out=resolve(process.env.F04A_OUT||'docs/focused-product/evidence/F04A');
const inputs=resolve('docs/focused-product/evidence/F04A/inputs');
const deps=resolve('artifacts/f04a-deps/node_modules');
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=(p,v)=>writeFile(p,JSON.stringify(v,null,2));
const normalize=s=>s.replace(/\s/g,'');
const startedAt=new Date().toISOString();
await mkdir(out,{recursive:true});
const dependency=[];
for(const [pkg,file] of [['html-to-pdfmake','browser.js'],['pdfmake','build/pdfmake.min.js']]){
 const b=await readFile(`${deps}/${pkg}/${file}`);const info=JSON.parse(await readFile(`${deps}/${pkg}/package.json`));
 dependency.push({package:pkg,version:info.version,license:info.license,browserFile:file,bytes:b.length,gzipBytes:gzipSync(b).length,sha256:sha(b)});
}
await copyFile(resolve('artifacts/f04a-deps/package-lock.json'),`${out}/candidate-package-lock.json`);
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({offline:true,viewport:{width:1440,height:960}});
const page=await context.newPage();const requests=[];page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url())});
const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('DOM.enable');await cdp.send('CSS.enable');
const rows=[];const hashes=[];const wholeExports=[];
for(const name of ['prototype.html','cherry.html','fixtures.html','embedded.ttf']) hashes.push({path:`inputs/${name}`,sha256:sha(await readFile(`${inputs}/${name}`))});
await json(`${out}/input-hashes.json`,hashes);
try {
 for(const source of ['prototype','cherry','fixtures']) {
  await page.goto(pathToFileURL(`${inputs}/${source}.html`).href);
  const selector=source==='prototype'?'#slide':'.slide';const count=await page.locator(selector).count();
  const pdfs={browser:[],chromium:[]};
  for(let i=0;i<count;i++) {
   const id=`${source}-${String(i+1).padStart(2,'0')}`;const dir=`${out}/${id}`;await mkdir(dir,{recursive:true});
   await page.goto(pathToFileURL(`${inputs}/${source}.html`).href);
   const setup=await page.evaluate(({selector,i})=>{
    const targets=[...document.querySelectorAll(selector)];const target=targets[i];
    // Preserve sibling structure and stylesheet; only select page and remove editor scaling.
    targets.forEach((n,j)=>{if(i!==j)n.style.setProperty('display','none','important')});
    target.id='f04a-target'; // prototype #slide styles retained via the original ID below
    if(selector==='#slide'){target.id='slide';target.setAttribute('data-f04a-target','')}
    else target.setAttribute('data-f04a-target','');
    const rect=target.getBoundingClientRect();const w=Math.round(rect.width),h=Math.round(rect.height);
    const s=document.createElement('style');s.textContent=`html,body{margin:0!important;padding:0!important;overflow:visible!important} [data-f04a-target]{break-inside:avoid} @page{size:${w}px ${h}px;margin:0} *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;animation:none!important;transition:none!important}`;document.head.append(s);
    return {width:w,height:h,case:target.getAttribute('data-case')};
   },{selector,i});
   await page.setViewportSize({width:setup.width,height:setup.height});await page.emulateMedia({media:'screen'});
   await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(im=>im.decode()))});
   const screen=await page.locator('[data-f04a-target]').screenshot({path:`${dir}/screen.png`});
   const dom=await page.evaluate(()=>{
    const target=document.querySelector('[data-f04a-target]');const walker=document.createTreeWalker(target,NodeFilter.SHOW_TEXT);const nodes=[];
    while(walker.nextNode()){const n=walker.currentNode;if(!n.textContent.trim())continue;const r=document.createRange();r.selectNodeContents(n);const rects=[...r.getClientRects()].map(r=>({x:r.x,y:r.y,width:r.width,height:r.height}));nodes.push({text:n.textContent,rects,font:getComputedStyle(n.parentElement).fontFamily})}
    return {text:target.innerText,nodes,buttons:target.querySelectorAll('button,input,select,[contenteditable=true]').length,fonts:[...document.fonts].map(f=>({family:f.family,status:f.status})),missingFontCheck:document.fonts.check('24px F04AMissing')};
   });
   const {root}=await cdp.send('DOM.getDocument');const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'[data-f04a-target]'});
   const fonts=await cdp.send('CSS.getPlatformFontsForNode',{nodeId});
   await json(`${dir}/screen-text.json`,{...dom,platformFonts:fonts.fonts,missingFontNote:'FontFaceSet.check returns true for nonexistent system families; it is not evidence that F04AMissing exists. This family is deliberately absent.'});
   const row={id,source,sourcePage:i+1,...setup,screenSHA256:sha(screen),referenceText:dom.text,controls:dom.buttons,platformFonts:fonts.fonts,candidates:{}};
   for(const candidate of ['chromium','browser']) {
    const path=`${dir}/${candidate}.pdf`;const t=performance.now();const before=(await cdp.send('Performance.getMetrics')).metrics;
    // Sample all host Chrome RSS. Includes unrelated processes: conservative diagnostic, not isolated peak.
    let maxRSS=0;const sample=()=>{try{const ps=execFileSync('ps',['-axo','rss=,comm='],{encoding:'utf8'});const rss=ps.split('\n').filter(l=>/Google Chrome/.test(l)).reduce((n,l)=>n+(parseInt(l)||0),0)*1024;maxRSS=Math.max(maxRSS,rss)}catch{}};sample();const timer=setInterval(sample,100);
    let error=null;
    try {
     if(candidate==='chromium') await page.pdf({path,preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false});
     else {
      await page.addScriptTag({path:`${deps}/pdfmake/build/pdfmake.min.js`});await page.addScriptTag({path:`${deps}/html-to-pdfmake/browser.js`});
      const base64=await page.evaluate(async({font,w,h})=>{
       pdfMake.vfs={'embedded.ttf':font};pdfMake.fonts={F04A:{normal:'embedded.ttf',bold:'embedded.ttf',italics:'embedded.ttf',bolditalics:'embedded.ttf'}};
       const source=document.querySelector('[data-f04a-target]'),clone=source.cloneNode(true);
       const a=[source,...source.querySelectorAll('*')],b=[clone,...clone.querySelectorAll('*')];
       // Materialize computed styles as converter input; no custom layout algorithm.
       const properties=['font-size','font-weight','font-style','color','background-color','margin-top','margin-bottom','margin-left','margin-right','text-align','white-space','display','position','left','top','width','height','transform','background-image','box-shadow','overflow','object-fit','object-position','grid-template-columns','gap','justify-content','padding'];
       a.forEach((el,j)=>{const c=getComputedStyle(el);if(el.namespaceURI==='http://www.w3.org/2000/svg'){if(el.tagName.toLowerCase()==='svg'){b[j].setAttribute('width',String(el.getBoundingClientRect().width));b[j].setAttribute('height',String(el.getBoundingClientRect().height))}return}b[j].removeAttribute('style');for(const key of properties)b[j].style.setProperty(key,c.getPropertyValue(key));b[j].style.fontFamily='F04A'});
       const content=htmlToPdfmake(clone.outerHTML,{window});
       const map=n=>{if(Array.isArray(n))return n.forEach(map);if(n&&typeof n==='object'){if('font'in n)n.font='F04A';Object.values(n).forEach(map)}};map(content);
       return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('candidate exceeded 30 seconds')),30000);pdfMake.createPdf({pageSize:{width:w*.75,height:h*.75},pageMargins:0,defaultStyle:{font:'F04A'},content}).getBase64(x=>{clearTimeout(timer);resolve(x)})});
      },{font:(await readFile(`${inputs}/embedded.ttf`)).toString('base64'),w:setup.width,h:setup.height});
      await writeFile(path,Buffer.from(base64,'base64'));
     }
    }catch(e){error=String(e)}finally{clearInterval(timer);sample()}
    const elapsedMs=performance.now()-t;const after=(await cdp.send('Performance.getMetrics')).metrics;
    if(error){row.candidates[candidate]={error,elapsedMs,hostChromeSampledRSSBytes:maxRSS};continue}
    const bytes=await readFile(path);pdfs[candidate].push(path);
    const inspection=JSON.parse(execFileSync(resolve('artifacts/f04a-inspect'),[path,`${dir}/screen.png`],{encoding:'utf8',maxBuffer:30*1024*1024}));
    await json(`${dir}/${candidate}-inspection.json`,inspection);
    await writeFile(`${dir}/${candidate}-text.txt`,inspection.map(p=>p.text).join('\n\f\n'));
    const text=inspection.map(p=>p.text).join('');const plain=bytes.toString('latin1');
    row.candidates[candidate]={elapsedMs,bytes:bytes.length,sha256:sha(bytes),pageCount:inspection.length,fullTextExactIgnoringWhitespace:normalize(text)===normalize(dom.text),missingTextNodes:dom.nodes.filter(n=>!normalize(text).includes(normalize(n.text))).map(n=>n.text),screenDifference:inspection[0].screenDifference,fontAudit:{resources:inspection.flatMap(p=>p.fonts),note:candidate==='browser'?'HTML text explicitly mapped to embedded Noto subset; system family, bold and italic NOT preserved.':'PDFKit/CoreGraphics resolved font resources, descendant descriptors and embedded FontFile streams (including compressed objects). Legal embedding rights of system fonts not established.'},hostChromeSampledRSSBytes:maxRSS,memoryMethod:'100 ms host-wide Chrome RSS sampling plus before/after CDP JSHeapUsedSize; not isolated peak, excludes unobserved transient allocations',jsHeapBefore:before.find(x=>x.name==='JSHeapUsedSize')?.value,jsHeapAfter:after.find(x=>x.name==='JSHeapUsedSize')?.value};
   }
   // Same canonical page at a different outer viewport and visual viewport scale.
   await page.setViewportSize({width:1440,height:1000});await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1.5});
   const variant=`${dir}/chromium-viewport1440-scale150.pdf`;await page.pdf({path:variant,preferCSSPageSize:true,printBackground:true});
   const variantInspection=JSON.parse(execFileSync(resolve('artifacts/f04a-inspect'),[variant],{encoding:'utf8',maxBuffer:30*1024*1024}));
   row.viewportScaleCheck={viewport:[1440,1000],visualViewportScale:1.5,chromiumRasterEqual:sha(await readFile(`${variant}.page-0.png`))===sha(await readFile(`${dir}/chromium.pdf.page-0.png`)),chromiumTextEqual:variantInspection[0].text===JSON.parse(await readFile(`${dir}/chromium-inspection.json`))[0].text,browser:'pending: eliminated on font/layout failure; no further variant validation'};
   await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});
   rows.push(row);await json(`${out}/probe.json`,{startedAt,rows});console.log(id,JSON.stringify(Object.fromEntries(Object.entries(row.candidates).map(([k,v])=>[k,{pages:v.pageCount,missing:v.missingTextNodes?.length,error:v.error,diff:v.screenDifference}]))));
  }
  if(pdfs.browser.length)execFileSync(resolve('artifacts/f04a-inspect'),['merge',`${out}/${source}-browser.pdf`,...pdfs.browser]);
  const wholeStart=performance.now();
  const whole=await wholeChromium(page,pathToFileURL(`${inputs}/${source}.html`).href,`${out}/${source}-chromium.pdf`,selector);
  wholeExports.push({source,elapsedMs:performance.now()-wholeStart,bytes:whole.length,method:'same Chrome Page.pdf candidate; direct entire source with named CSS page sizes'});
  await json(`${out}/whole-chromium.json`,{time:new Date().toISOString(),records:wholeExports});
 }
} finally {await browser.close()}
await json(`${out}/probe.json`,{startedAt,finishedAt:new Date().toISOString(),baselineCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),candidates:['html-to-pdfmake@2.5.32 + pdfmake@0.2.20 (browser)','Chrome Page.pdf (external browser print pipeline)'],dependency,fontBytes:(await stat(`${inputs}/embedded.ttf`)).size,requests,rows,human:{status:'pending',reason:'No human PDF-viewer drag-selection/copy/search or visual approval available in this automated run. PDFKit character bounds/extraction is automated only.'},realBrowser:{status:'pending',reason:'Installed Chrome executed headless via file:// offline. No physical desktop interaction; no Safari/Firefox claim.'}});
