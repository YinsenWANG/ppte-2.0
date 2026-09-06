import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { runtimeScript } from '../packages/html-document/src/runtime-bundle.js';
const evidence=resolve('artifacts/h05');
let root:string,stage:string,install:string,bin:string,receipt:any;
function run(command:string,args:string[],options:object={}) {
 const r=spawnSync(command,args,{encoding:'utf8',...options});assert.equal(r.status,0,`${command}: ${r.stdout}\n${r.stderr}`);return r.stdout;
}
const npm=process.platform==='win32'?'npm.cmd':'npm';
before(()=>{
 mkdirSync(evidence,{recursive:true});root=mkdtempSync(join(tmpdir(),'h05-'));stage=join(root,'stage');install=join(root,'candidate');
 run(process.execPath,['scripts/stage-package.mjs',stage]);
 receipt=Object.values(JSON.parse(run(npm,['pack',stage,'--pack-destination',root,'--json'])))[0];
 run(npm,['install','--prefix',install,'--offline','--ignore-scripts','--no-audit','--no-fund',join(root,receipt.filename)]);
 bin=join(install,'node_modules/ppte-html/ppte.js');
 writeFileSync(join(evidence,'candidate.tgz'),readFileSync(join(root,receipt.filename)));
 writeFileSync(join(evidence,'pack.json'),JSON.stringify(receipt,null,2));
});
after(()=>rmSync(root,{recursive:true,force:true}));
test('H05 acceptance 1: static CLI/runtime graph and actual installed npm tarball contain only HTML dependencies',()=>{
 const manifest=JSON.parse(readFileSync(join(install,'node_modules/ppte-html/package.json'),'utf8'));
 assert.deepEqual(manifest.bin,{ppte:'ppte.js'});
 for(const key of ['dependencies','optionalDependencies','peerDependencies','scripts'])assert.equal(manifest[key],undefined);
 const paths=receipt.files.map((f:any)=>f.path).sort();
 assert.deepEqual(paths,['LICENSE','README.md','dependency-graph.json','package.json','ppte.js','skills/ppte/SKILL.md'].sort());
 const graph=JSON.parse(readFileSync(join(stage,'dependency-graph.json'),'utf8'));
 for(const [kind,g] of Object.entries(graph) as [string,any][]){
  for(const path of Object.keys(g.inputs)){if(['(disabled):path','(disabled):url','(disabled):fs'].includes(path))continue;assert.match(path.replace(/^\(disabled\):/,''),/^(apps\/html-cli\/|packages\/html-(document|save|editor|player|print)\/|node_modules\/)/);}
  for(const path of Object.keys(g.inputs))assert.doesNotMatch(path,/archive\/|playwright|puppeteer|fflate|react|prosemirror/);
  for(const output of Object.values(g.outputs) as any[])for(const imp of output.imports){assert.equal(imp.external,true);assert.ok(builtinModules.includes(imp.path.replace(/^node:/,'')),`${kind}: ${imp.path}`);}
 }
 writeFileSync(join(evidence,'dependency-graph.json'),JSON.stringify(graph,null,2));
});
test('H05 acceptance 2: offline installed CLI generates HTML with network and external processes forbidden',()=>{
 const isolated=join(root,'isolated');mkdirSync(isolated);const draft=join(root,'draft.html');writeFileSync(draft,'<h1>Node only</h1>');
 const guard=join(root,'deny.cjs');writeFileSync(guard,`const deny=()=>{throw Error('EXTERNAL_TOOL_FORBIDDEN')};require('net').Socket.prototype.connect=deny;global.fetch=deny;for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])require('child_process')[k]=deny;`);
 const env={PATH:isolated,HOME:isolated,NODE_OPTIONS:`--require=${guard}`,PLAYWRIGHT_BROWSERS_PATH:isolated};
 const probe=spawnSync(process.execPath,['-e',"require('child_process').spawnSync('python',['--version'])"],{env,encoding:'utf8'});assert.notEqual(probe.status,0);assert.match(probe.stderr,/EXTERNAL_TOOL_FORBIDDEN/);
 const network=spawnSync(process.execPath,['-e',"require('https').get('https://example.invalid')"],{env,encoding:'utf8'});assert.notEqual(network.status,0);assert.match(network.stderr,/EXTERNAL_TOOL_FORBIDDEN/);
 const out=join(isolated,'作品.html');const summary=run(process.execPath,[bin,'enhance',draft,'--out',out],{env,cwd:isolated});assert.equal(JSON.parse(summary).ok,true);assert.ok(Buffer.byteLength(summary)<=1024);assert.deepEqual(readdirSync(isolated),['作品.html']);assert.match(readFileSync(out,'utf8'),/Node only/);
 writeFileSync(join(evidence,'node-only.json'),JSON.stringify({ok:true,externalProcessGuard:true,networkGuard:true,pathHasNoTools:true,runtimeDependencies:[],summary:JSON.parse(summary)},null,2));
});
test('H05 acceptance 3: candidate runtime <=250 KB gzip and three twelve-page light HTMLs <=1 MB measured',()=>{
 const metrics={runtime:{rawBytes:Buffer.byteLength(runtimeScript),gzipBytes:gzipSync(runtimeScript).length},decks:[] as object[],tarballBytes:receipt.size,unpackedBytes:receipt.unpackedSize};
 assert.ok(metrics.runtime.gzipBytes<=250*1024);
 for(const name of ['cherry','product','data']){
  const out=join(root,`${name}.html`);const r=JSON.parse(run(process.execPath,[bin,'enhance',resolve(`docs/html-first/evidence/h00/drafts/${name}.html`),'--out',out]));assert.equal(r.ok,true);assert.equal(r.pages,12);assert.equal(r.mediaBytes,0);
  const html=readFileSync(out);assert.ok(html.length<=1024*1024);metrics.decks.push({name,pages:r.pages,rawBytes:html.length,gzipBytes:gzipSync(html).length,mediaBytes:r.mediaBytes});if(name==='cherry')writeFileSync(join(evidence,'example.html'),html);
 }
 writeFileSync(join(evidence,'sizes.json'),JSON.stringify(metrics,null,2));
});
test('H05 acceptance 4: isolated install, reusable skill and overwrite refusal preserve existing user files',()=>{
 const user=join(root,'user');mkdirSync(user);const originals={'old.ppte':Buffer.from([0,1,2,255]),'old.html':Buffer.from('<h1>Legacy original</h1>'),'current.html':Buffer.from('<h1>Current original</h1>')};
 for(const [name,bytes]of Object.entries(originals))writeFileSync(join(user,name),bytes);
 const unsafeStage=spawnSync(process.execPath,['scripts/stage-package.mjs',user],{encoding:'utf8'});assert.notEqual(unsafeStage.status,0);
 const skill=join(root,'agent/skill');assert.equal(JSON.parse(run(process.execPath,[bin,'skill-install','--out',skill])).ok,true);
 const skillBytes=readFileSync(join(skill,'SKILL.md'));assert.ok(skillBytes.length<6500);assert.match(skillBytes.toString(),/ppte enhance/);assert.match(skillBytes.toString(),/ppte edit/);
 const again=spawnSync(process.execPath,[bin,'skill-install','--out',skill],{encoding:'utf8'});assert.notEqual(again.status,0);assert.deepEqual(readFileSync(join(skill,'SKILL.md')),skillBytes);
 for(const name of ['old.html','current.html']){
  const r=spawnSync(process.execPath,[bin,'enhance',join(user,'old.html'),'--out',join(user,name)],{encoding:'utf8'});assert.notEqual(r.status,0);
 }
 const legacy=spawnSync(process.execPath,[bin,'edit',join(user,'old.ppte'),'--no-open'],{encoding:'utf8'});assert.notEqual(legacy.status,0);assert.match(legacy.stdout,/HTML_REQUIRED/);
 for(const [name,bytes]of Object.entries(originals))assert.deepEqual(readFileSync(join(user,name)),bytes);
 const docs=readFileSync(join(stage,'README.md'),'utf8');for(const s of ['--prefix','--offline','Recovery and rollback','7c1a6c46676566e346edc2af24974752d4288897','~/.local/share/ppte-html'])assert.ok(docs.includes(s));
 // Actual removal/reinstallation of the independent candidate leaves works and skill intact.
 rmSync(install,{recursive:true});run(npm,['install','--prefix',install,'--offline','--ignore-scripts','--no-audit','--no-fund',join(root,receipt.filename)]);assert.equal(JSON.parse(run(process.execPath,[bin,'--help'])).ok,true);
 for(const [name,bytes]of Object.entries(originals))assert.deepEqual(readFileSync(join(user,name)),bytes);
 assert.deepEqual(readdirSync(user).sort(),Object.keys(originals).sort());assert.deepEqual(readFileSync(join(skill,'SKILL.md')),skillBytes);
 writeFileSync(join(evidence,'recovery.json'),JSON.stringify({isolatedReinstall:true,legacyAndCurrentBytesUnchanged:true,skillReused:true,overwriteRefused:true},null,2));
});
test('H05 acceptance 2: packaged HTML prints through separately available Chrome PDF toolchain',async()=>{
 const out=join(root,'print.html');const draft=join(root,'print-draft.html');writeFileSync(draft,'<style>body{margin:0}section{width:960px;height:540px}</style><section data-ppte-slide><h1>Packaged PDF</h1></section>');run(process.execPath,[bin,'enhance',draft,'--out',out]);
 const browser=await chromium.launch({channel:'chrome',headless:true});try{
  const page=await browser.newPage();await page.goto('file://'+out);await page.waitForFunction(()=>!!(window as any).PPTePlayer);
  await page.evaluate(()=>(window as any).PPTePrint.prepare());await page.emulateMedia({media:'print'});assert.equal(await page.locator('#ppte-print>div').count(),1);assert.equal(await page.locator('#ppte-save-ui').isVisible(),false);assert.match(await page.locator('#ppte-print h1').innerText(),/Packaged PDF/);const bytes=await page.pdf({preferCSSPageSize:true,printBackground:true});assert.equal(bytes.subarray(0,5).toString(),'%PDF-');writeFileSync(join(evidence,'packaged.pdf'),bytes);
 }finally{await browser.close();}
});

test('H05 retirement: all historical test files remain byte-identical to the pre-H05 manifest',async()=>{
 const {createHash}=await import('node:crypto');const manifest=JSON.parse(readFileSync('docs/html-first/evidence/h05/retired-tests.json','utf8'));
 assert.ok(manifest.files.length>50);
 for(const entry of manifest.files){assert.equal(createHash('sha256').update(readFileSync(entry.archive)).digest('hex'),entry.sha256,entry.original);}
 const rootManifest=JSON.parse(readFileSync('package.json','utf8'));
 assert.doesNotMatch(JSON.stringify(rootManifest),/build-portable|apps\/cli|host:build|fflate|react|prosemirror|blackbox:final/);
});
