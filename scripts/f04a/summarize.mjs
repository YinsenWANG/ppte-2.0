import {decidePDFRoute} from './decision.mjs';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const out=resolve('docs/focused-product/evidence/F04A');
const p=JSON.parse(await readFile(`${out}/probe.json`));
const write=(path,data)=>writeFile(`${out}/${path}`,JSON.stringify(data,null,2));
for(const row of p.rows)for(const c of ['browser','chromium']){
 const path=`${out}/${row.id}/${c}.pdf`;
 const inspection=JSON.parse(execFileSync(resolve('artifacts/f04a-inspect'),[path,`${out}/${row.id}/screen.png`],{encoding:'utf8',maxBuffer:30*1024*1024}));
 await write(`${row.id}/${c}-inspection.json`,inspection);
 row.candidates[c].fontAudit={resources:inspection.flatMap(p=>p.fonts),note:c==='browser'?'HTML text explicitly mapped to embedded Noto subset; system family, bold and italic NOT preserved.':'CoreGraphics resolved font resources, descendant descriptors and embedded FontFile streams including compressed objects. Legal embedding rights of system fonts not established.'};
 row.candidates[c].search=inspection[0].search;
}
p.inspectionNote='Final font audit uses CoreGraphics parsed resources, not raw-PDF regex (compressed object dictionaries make regex incomplete).';
await write('probe.json',p);
const aggregates={};for(const c of ['browser','chromium']){
 const values=p.rows.map(r=>r.candidates[c]);
 aggregates[c]={pages:values.reduce((n,v)=>n+v.pageCount,0),exportMs:values.reduce((n,v)=>n+v.elapsedMs,0),maxPageExportMs:Math.max(...values.map(v=>v.elapsedMs)),unmergedPDFBytes:values.reduce((n,v)=>n+v.bytes,0),maxSampledHostChromeRSSBytes:Math.max(...values.map(v=>v.hostChromeSampledRSSBytes)),note:'20 source pages; timings exclude PDFKit inspection/merge, include library/font injection for browser candidate; RSS is host-wide sampled, not isolated peak.'};
}
const failures=p.rows.flatMap(r=>[
 {page:r.id,candidate:'browser',reason:['Computed CSS layout not reproduced; explicit font mapping loses original family/styles',...(r.candidates.browser.pageCount!==1?[`One input page becomes ${r.candidates.browser.pageCount} PDF pages`]:[])].join('; ')},
 ...(r.candidates.chromium.missingTextNodes.length?[{page:r.id,candidate:'chromium',reason:'PDFKit extraction/search order failure',text:r.candidates.chromium.missingTextNodes}]:[]),
 ...(!r.viewportScaleCheck.chromiumRasterEqual?[{page:r.id,candidate:'chromium',reason:'Complex transform raster changes at outer viewport 1440 and visual viewport scale 1.5; text unchanged. Difference classification pending.'}]:[])
]);
failures.push({page:'fixtures-04-whole',candidate:'chromium',reason:'Direct whole-document PDF extraction has Text where the isolated-page reference has T ex t. Strict text equality fails; no further route tuning in this bounded trial.'});
await write('assessment.json',{...decidePDFRoute({browserQualified:false,externalQualified:false}),decision:'neither-qualified',F04:'pending',F04A:'validated-no-passing-route',reason:'Browser candidate fails layout/font fidelity. Chromium is not qualified: PDFKit mixed-script/search/order failures and transform viewport discrepancy, plus human selection/visual approval pending. No architecture implementation authorized or started.',aggregates,failures,human:p.human,realBrowser:p.realBrowser,extraProductRemovals:[],architectureChanged:false,productDependenciesAdded:0});
await write('manual-selection.json',{status:'pending',reason:p.human.reason,reader:'pending: human chooses supported desktop PDF viewer; PDFKit automated results do not substitute',records:p.rows.flatMap(r=>['browser','chromium'].map(c=>({page:r.id,candidate:c,pdf:`${r.id}/${c}.pdf`,status:'pending',operator:null,time:null,searchQuery:r.referenceText.split('\n').find(s=>s.trim())??'',copyExpected:`${r.id}/screen-text.json`,copyObserved:null,selectionScreenshot:null,selectionAlignment:null,visualApproval:null,steps:['Open PDF in desktop viewer; compare every generated page with screen.png','Search the full Chinese heading and a mixed-script phrase; record hit count','Drag-select each multiline paragraph including transformed text; copy to plain text and compare complete order/punctuation','Capture selection bounds over visible glyphs; inspect fonts and images; do not approve from keyword extraction alone']})))});
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
await writeFile(`${out}/COMPARE.html`,`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>F04A 同稿 PDF 对照</title><style>body{font:16px system-ui;background:#eee;color:#123;margin:24px}article{background:white;margin:20px 0;padding:16px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}img{width:100%;border:1px solid #bbb}pre{white-space:pre-wrap;font-size:12px}a{color:#246}h2{font-size:18px}</style><h1>F04A：③ 两条路线均未取得合格结论</h1><p>屏幕 / 浏览器内 pdfmake / 外部 Chromium。后者仍走浏览器打印管线。点击图片放大；人工视觉与选区验收 pending。</p><p>${['prototype','cherry','fixtures'].map(s=>['browser','chromium'].map(c=>`<a href="${s}-${c}.pdf">${s} ${c} 整稿 PDF</a>`).join(' · ')).join(' | ')}</p>${p.rows.map(r=>`<article id="${r.id}"><h2>${r.id} · ${r.width} × ${r.height}</h2><div class="grid"><div>屏幕参考<a href="${r.id}/screen.png"><img src="${r.id}/screen.png"></a></div>${['browser','chromium'].map(c=>`<div><a href="${r.id}/${c}.pdf">${c} PDF</a>${Array.from({length:r.candidates[c].pageCount},(_,i)=>`<a href="${r.id}/${c}.pdf.page-${i}.png"><img src="${r.id}/${c}.pdf.page-${i}.png"></a>`).join('')}<a href="${r.id}/${c}-text.txt">完整提取文字</a><pre>${esc(JSON.stringify({pages:r.candidates[c].pageCount,missing:r.candidates[c].missingTextNodes,diff:r.candidates[c].screenDifference},null,2))}</pre></div>`).join('')}</div></article>`).join('')}</html>`);
console.log(JSON.stringify(aggregates,null,2));
