import {execFileSync} from 'node:child_process';import {readFile,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
const out=resolve('docs/focused-product/evidence/F04A');const probe=JSON.parse(await readFile(`${out}/probe.json`));const records=[];
for(const source of ['prototype','cherry','fixtures'])for(const candidate of ['browser','chromium']){
 const pages=JSON.parse(execFileSync(resolve('artifacts/f04a-inspect'),[`${out}/${source}-${candidate}.pdf`],{encoding:'utf8',maxBuffer:30*1024*1024}));
 const expected=[];for(const row of probe.rows.filter(r=>r.source===source))expected.push(...JSON.parse(await readFile(`${out}/${row.id}/${candidate}-inspection.json`)));
 records.push({source,candidate,pages:pages.map(p=>({text:p.text,widthPt:p.widthPt,heightPt:p.heightPt,fonts:p.fonts})),strictTextAndSizeEqual:JSON.stringify(pages.map(p=>[p.text,p.widthPt,p.heightPt]))===JSON.stringify(expected.map(p=>[p.text,p.widthPt,p.heightPt]))});
}
await writeFile(`${out}/whole-inspection.json`,JSON.stringify(records,null,2));
