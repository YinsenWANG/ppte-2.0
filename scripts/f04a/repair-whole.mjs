import {chromium} from 'playwright';
import {rename,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {wholeChromium} from './whole-chromium.mjs';
const out=resolve('docs/focused-product/evidence/F04A');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{const page=await browser.newPage({offline:true});
 const records=[];
 for(const source of ['prototype','cherry','fixtures']){
  await rename(`${out}/${source}-chromium.pdf`,`${out}/${source}-chromium-pdfkit-merge-failed.pdf`);
  const start=performance.now();const pdf=await wholeChromium(page,pathToFileURL(`${out}/inputs/${source}.html`).href,`${out}/${source}-chromium.pdf`,source==='prototype'?'#slide':'.slide');
  records.push({source,elapsedMs:performance.now()-start,bytes:pdf.length,method:'same Chrome Page.pdf candidate, named CSS pages with author dimensions, direct entire source document',priorFailure:`${source}-chromium-pdfkit-merge-failed.pdf`});
 }
 await writeFile(`${out}/whole-chromium.json`,JSON.stringify({time:new Date().toISOString(),records},null,2));
}finally{await browser.close()}
