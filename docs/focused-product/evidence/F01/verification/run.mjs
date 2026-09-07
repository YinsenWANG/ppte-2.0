// Reproduce F01's required repository gates. Run from any working directory.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
const dir=dirname(fileURLToPath(import.meta.url)), root=resolve(dir,'../../../../..');
const git=(...args)=>spawnSync('git',args,{cwd:root,encoding:'utf8'}).stdout.trim();
const result={task:'F01',status:'running',commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),branch:git('branch','--show-current'),startedAt:new Date().toISOString(),platform:{os:os.platform(),release:os.release(),arch:os.arch(),node:process.version,pnpm:spawnSync('pnpm',['--version'],{encoding:'utf8'}).stdout.trim()},commands:[]};
for(const name of ['typecheck','build','test']){
 const startedAt=new Date().toISOString(),start=performance.now();
 const run=spawnSync('pnpm',[name],{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});
 const log=(run.stdout??'')+(run.stderr??'');writeFileSync(join(dir,`${name}.log`),log);
 result.commands.push({command:`pnpm ${name}`,status:run.status===0?'passed':'failed',exitCode:run.status,signal:run.signal,startedAt,finishedAt:new Date().toISOString(),durationMs:Math.round(performance.now()-start),log:`${name}.log`});
 if(run.status!==0)break;
}
result.finishedAt=new Date().toISOString();result.status=result.commands.length===3&&result.commands.every(c=>c.status==='passed')?'passed':'failed';
if(result.status==='passed'){
 const tap=readFileSync(join(dir,'test.log'),'utf8');result.tests=Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(k=>[k,Number(tap.match(new RegExp(`^# ${k} (\\d+)$`,'m'))?.[1])]));
 result.skipPolicy='Explicit scope retirements, not passes; see ../TEST-MIGRATION.json. New F01 tests have no skips.';
 const artifacts=join(root,'artifacts/focused-product/F01');result.browser=JSON.parse(readFileSync(join(artifacts,'browser.json'),'utf8'));
 const evidence=resolve(dir,'..');mkdirSync(join(evidence,'screenshots'),{recursive:true});
 for(const width of [1440,1024,390])for(const mode of ['阅读','编辑'])copyFileSync(join(artifacts,`Cherry-${mode}-${width}.png`),join(evidence,'screenshots',`Cherry-${mode}-${width}.png`));
 copyFileSync(join(artifacts,'Cherry-F01.ppte.html'),join(evidence,'Cherry-F01.ppte.html'));
}
const native={status:'pending',reason:'Automated Chrome uses headless file:// and Playwright filechooser capture. Native desktop picker, physical keyboard/touch and other supported browsers were not manually exercised. Mocked file-handle methods backed by real disk I/O are only an adapter regression.'};
const human={status:'pending',reason:'User has not confirmed the focused UI or document aesthetics; screenshots are review material only.'};
result.layers={code:{status:result.status==='passed'?'passed':'pending',commit:result.commit},automated:{status:result.status,scope:'node --test on dist, real headless Chrome offline interactions, actual downloads/new browser processes; simulated file adapter'},'real-browser':native,human};
result.acceptance=[
 {item:'只保留插入图片；所有旧入口/快捷键/提示移除',tests:['F01 A1/A2 direct chooser, empty chooser, image undo/redo, removed T in outer and content frame','F01 audited Cherry upgrade','H01 runtime graph excludes retired menu and version panel']},
 {item:'更多改为一级导出为PDF',tests:['F01 A1/A2 top-level button in read/edit at 1440/1024/390; disabled with truthful reason; no PPTePrint/beforeprint route','H04 runtime/action boundary'],limitation:'F01 delivers the entry only. F04A/F04 remain pending: PDF is disabled, not implemented and not replaced by system print or raster PDF.'},
 {item:'已有文稿和历史数据不被破坏',tests:['F01 no-history/valid/broken/unknown history edit/download/full-process reopen','F01 mocked native adapter real disk manual/auto writes preserve history','F01 audited Cherry ten-page content and navigation','UI07 retained history model/wire/CLI safety regressions'],limitation:'Native authorization/writeback is pending F02. Cherry mode changes compare full DOM with inline CSS declaration whitespace canonicalized; initial upgrade content is byte-equal.'}
].map(a=>({...a,code:result.layers.code,automated:result.layers.automated,'real-browser':native,human}));
writeFileSync(join(dir,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,commit:result.commit,tests:result.tests}));
if(result.status!=='passed')process.exitCode=1;
