import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { chromium, type Page, type Frame } from 'playwright';
import { build } from 'esbuild';
import { enhanceHTML, readEnhanced, serializeContent, envelope } from '../packages/html-document/src/index.js';
import { cleanContent, attr, elements } from '../packages/html-document/src/content.js';
import { parse } from 'parse5';
import { summary } from '../apps/html-cli/index.js';
const fixture = resolve('tests/fixtures/html-first');
const evidence = resolve('artifacts/h01'); mkdirSync(evidence, { recursive: true });
const options = { root: fixture, base: fixture };
const source = readFileSync(join(fixture, 'layout.html'), 'utf8');
async function mount(page: Page, html: string) {
  await page.setContent(html);
  await page.waitForFunction(() => !!(window as any).PPTeHTML?.contentDocument?.querySelector('[data-ppte-slide]'));
  const frame = page.frames().find(f => f.parentFrame())!;
  await frame.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images, i => i.decode())); });
  return frame;
}
function measurements(context: Page | Frame) {
  return context.evaluate(() => Array.from(document.querySelectorAll('.slide,.copy,.visual,h1,p,svg,rect,text,img,table,td,.eyebrow,.chip')).map(el => {
    const style = getComputedStyle(el), r = el.getBoundingClientRect();
    return { tag:el.tagName, text:el.textContent, rect:[r.x,r.y,r.width,r.height], display:style.display, font:style.font, color:style.color, background:style.backgroundColor, grid:style.gridTemplateColumns, gap:style.gap, fill:style.fill };
  }));
}
test('H01 acceptance 1: native Grid/Flex/SVG/font hierarchy and nested resources retain computed layout and exact pixels', async () => {
  const enhanced = await enhanceHTML(source, options); assert.deepEqual(enhanced.issues, []);
  const browser = await chromium.launch({ headless: true });
  try {
    const before = await browser.newPage({ viewport:{width:960,height:640}, deviceScaleFactor:1 });
    await before.goto(pathToFileURL(join(fixture,'layout.html')).href);
    await before.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images, i => i.decode())); });
    const after = await browser.newPage({ viewport:{width:960,height:640}, deviceScaleFactor:1 });
    const frame = await mount(after, enhanced.html);
    await after.waitForFunction(() => !!(window as any).PPTeSave);
    const top = await after.locator('#ppte-save-ui').evaluate(n => n.getBoundingClientRect().height);
    const inset = top + await after.locator('#ppte-canvas-controls').evaluate(n => n.getBoundingClientRect().height);
    await after.setViewportSize({width:960,height:640+inset});
    await after.waitForFunction(() => { const frame=document.querySelector('iframe')!; return frame.clientHeight === 640 && frame.contentDocument!.querySelector('[data-ppte-slide]')!.getBoundingClientRect().width === 960; });
    assert.deepEqual(await measurements(frame), await measurements(before));
    assert.equal(await frame.evaluate(() => document.fonts.check('14px Fixture')), true);
    assert.equal(await frame.locator('.imported').evaluate(el => getComputedStyle(el).borderLeftWidth), '4px');
    // Match the frame's physical screen origin too: Chromium gradient dithering depends
    // on that origin. The baseline iframe loads the untouched author file and CSS.
    await before.setViewportSize({width:960,height:640+inset});
    await before.setContent(`<style>html,body{margin:0;width:100%;height:100%;background:#111}</style><nav style="position:fixed;z-index:100;top:0;left:0;right:0;height:${top}px;background:white"></nav><iframe src="${pathToFileURL(join(fixture,'layout.html')).href}" style="display:block;border:0;width:960px;height:640px;margin-top:${top}px"></iframe>`);
    const originalFrame = before.frames().find(f => f.parentFrame())!;
    await originalFrame.waitForLoadState();
    await originalFrame.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images,i=>i.decode())); });
    assert.deepEqual(await measurements(frame), await measurements(originalFrame));
    // Isolate each canvas in an identical compositor layer (no changes inside author DOM).
    for (const page of [before,after]) await page.locator('iframe').evaluate(n => n.style.transform = 'translateZ(0)');
    const a = await before.locator('iframe').screenshot({ path:join(evidence,'before.png') });
    const b = await after.locator('#ppte-frame').screenshot({ path:join(evidence,'after.png') });
    assert.ok(b.equals(a), "Content canvas PNG bytes must match exactly");
    writeFileSync(join(evidence,'layout.json'), JSON.stringify(await measurements(frame),null,2));
    writeFileSync(join(evidence,'example.html'), enhanced.html);
  } finally { await browser.close(); }
});

test('H01 acceptance 1: deterministic IDs reserve author identities, repair duplicates and preserve nested template escaping', async () => {
  const input = source.replace('<p>', '<p data-ppte-id="ppte-1">').replace('<table>', '<table data-ppte-id="author-title">');
  const first = await enhanceHTML(input, options), second = await enhanceHTML(input, options);
  assert.equal(first.html, second.html); assert.ok(first.issues.some(i => i.code === 'DUPLICATE_ID_REPLACED'));
  const content = readEnhanced(first.html).content;
  const ids = elements(parse(content)).map(e => attr(e,'data-ppte-id')).filter(Boolean);
  assert.equal(ids.length, new Set(ids).size); assert.ok(ids.includes('author-title')); assert.ok(ids.includes('ppte-1'));
  assert.match(content, /&lt;\/template&gt; &lt;\/script&gt; &amp; 字体/);
  assert.equal((await enhanceHTML(first.html,options)).html, first.html);
  const ordinary = await enhanceHTML('<h1>普通 HTML</h1>',options); assert.equal(ordinary.pages,1);
});

test('H01 acceptance 2: 100 actual browser serialize/write/close/reopen cycles retain one payload and no editing residue', async () => {
  const box = mkdtempSync(join(tmpdir(),'h01-cycles-')); const file = join(box,'作品.html');
  const browser = await chromium.launch({ headless:true });
  try {
    let html = (await enhanceHTML(source,options)).html; writeFileSync(file,html);
    const original = readEnhanced(html); let stableContent = ''; const sizes: number[] = [];
    for (let i = 1; i <= 100; i++) {
      const page = await browser.newPage({viewport:{width:960,height:640}});
      await page.goto(pathToFileURL(file).href);
      await page.waitForFunction(() => !!(window as any).PPTeHTML?.contentDocument?.querySelector('h1'));
      await page.evaluate(() => {
        const doc = (window as any).PPTeHTML.contentDocument as Document;
        const h1 = doc.querySelector('h1')!; h1.textContent = 'Edited & reopened <100>'; h1.setAttribute('contenteditable','true'); h1.setAttribute('data-ppte-editor-selected','true');
        const handle = doc.createElement('div'); handle.setAttribute('data-ppte-transient','handle'); handle.textContent='DRAG HANDLE'; doc.body.append(handle);
      });
      html = await page.evaluate(() => (window as any).PPTeHTML.serialize());
      writeFileSync(file,html); await page.close();
      const current = readEnhanced(readFileSync(file,'utf8'));
      assert.equal(current.metadata.saveRevision,i); assert.equal(current.metadata.documentId,original.metadata.documentId);
      if (i === 1) stableContent = current.content; else assert.equal(current.content,stableContent);
      assert.doesNotMatch(current.content,/contenteditable|data-ppte-editor-|DRAG HANDLE|blob:/);
      const nodes = elements(parse(html));
      for (const id of ['ppte-content','ppte-runtime','ppte-metadata','ppte-frame']) assert.equal(nodes.filter(e => attr(e,'id') === id).length,1);
      assert.equal(attr(nodes.find(e => attr(e,'id') === 'ppte-frame')!,'srcdoc'),undefined);
      sizes.push(Buffer.byteLength(html));
    }
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 2);
    writeFileSync(join(evidence,'cycles.json'),JSON.stringify({cycles:100,sizes,saveRevision:readEnhanced(html).metadata.saveRevision,contentStable:true},null,2));
  } finally { await browser.close(); rmSync(box,{recursive:true,force:true}); }
});

test('H01 acceptance 2: sanitizer reports executable content; runtime sandbox/CSP block independent script/event/network/navigation attempts', async () => {
  const attack = `<script>parent.PWNED=1</script><img src="data:image/png;base64,AA==" onerror="parent.PWNED=2"><svg onload="parent.PWNED=3"><a href="javascript:alert(1)">X</a><set attributeName="href" to="javascript:alert(2)"/></svg><iframe srcdoc="<script>parent.PWNED=4</script>"></iframe><meta http-equiv="refresh" content="0;url=https://example.invalid"><form action="https://example.invalid"><button>send</button></form>`;
  const cleaned = cleanContent(`<h1>Safe</h1>${attack}`);
  assert.ok(cleaned.issues.length >= 7); assert.doesNotMatch(cleaned.html, /PWNED|javascript:|<form|<iframe|<script|<set/);
  const received: string[] = [];
  const server = createServer((req,res) => { received.push(req.url!); res.end('NETWORK LEAK'); });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage(); const requests: string[] = []; const blocked: string[] = []; const dialogs: string[] = [];
    page.on('requestfailed',r => { if (r.failure()?.errorText === 'csp') blocked.push(r.url()); });
    page.on('request',r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
    page.on('dialog',async d => {dialogs.push(d.message());await d.dismiss();});
    // Deliberately bypass sanitizer for this fixture: verify actual defense in depth in the iframe.
    const safe = await enhanceHTML('<h1>Safe</h1><a href="#x">anchor</a>',options);
    const frame = await mount(page,safe.html);
    await frame.evaluate(origin => {
      const script = document.createElement('script'); script.textContent='parent.PWNED=10;alert("script")';document.body.append(script);
      const img = document.createElement('img');img.setAttribute('onerror','parent.PWNED=11;alert("event")');img.src=origin+'/track';document.body.append(img);
      const style=document.createElement('style');style.textContent=`body{background:url(${origin}/css)}`;document.head.append(style);
      const link=document.createElement('a');link.href=origin+'/nav';link.target='_top';link.textContent='navigation';document.body.append(link);link.click();
      const form=document.createElement('form');form.action=origin+'/form';document.body.append(form);form.submit();
    }, origin);
    await page.waitForTimeout(120);
    assert.equal(await page.evaluate(() => (window as any).PWNED),undefined);
    assert.deepEqual(received,[]);assert.deepEqual(requests.sort(),[origin+'/css',origin+'/track'].sort());assert.deepEqual(blocked.sort(),requests.sort());assert.deepEqual(dialogs,[]);assert.equal(page.frames().length,2);assert.equal(frame.url(),'about:srcdoc');
    assert.equal(await page.locator('#ppte-frame').getAttribute('sandbox'),'allow-same-origin');
    await assert.rejects(page.evaluate(() => (window as any).PPTeHTML.serialize()),/UNSAFE_CONTENT/);
    // An attacker-provided outer runtime is discarded by the Node enhancer, never trusted.
    const poisoned = safe.html.replace('id="ppte-runtime"','id="ppte-runtime" data-attacker="yes"').replace('</body>','<script>BAD_OUTER()</script></body>');
    const rebuilt = await enhanceHTML(poisoned,options); assert.equal(rebuilt.html,safe.html);
  } finally {await browser.close(); await new Promise<void>(resolve => server.close(() => resolve()));}
});

test('H01 acceptance 2: safe serialization fails closed for executable CSS, SVG data, remote resource and malformed metadata', async () => {
  const base = await enhanceHTML('<h1>Safe</h1>',options); const meta = readEnhanced(base.html).metadata;
  for (const bad of ['<script>x()</script>','<noscript><img src=x onerror=alert(1)></noscript>','<p onclick="x()">x</p>','<style>@import "https://example.invalid/x";</style>','<p style="background:url(https://example.invalid/x)">x</p>','<svg><image href="data:image/svg+xml,%3Csvg%20onload%3D%22alert(1)%22%3E%3C/svg%3E"/></svg>']) assert.throws(() => serializeContent(bad,meta),/UNSAFE_CONTENT/);
  assert.throws(() => readEnhanced(base.html.replace('"saveRevision":0','"saveRevision":-1')),/METADATA_INVALID/);
  assert.equal(readEnhanced(serializeContent('<h1 contenteditable="true">Changed</h1>',meta)).metadata.saveRevision,1);
});

test('H01 acceptance 3: offline CLI with no PATH/keys/browser writes exactly one HTML and <=1KB summary', () => {
  const box=mkdtempSync(join(tmpdir(),'h01-cli-')); const output=join(box,'output','作品.html');
  try {
    const guard=join(box,'guard.cjs');writeFileSync(guard,`const deny=()=>{throw Error('NETWORK_OR_PROCESS_FORBIDDEN')};require('net').Socket.prototype.connect=deny;global.fetch=deny;for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])require('child_process')[k]=deny;`);
    const env={PATH:'',HOME:box,NODE_OPTIONS:`--require=${guard}`};
    const probe=spawnSync(process.execPath,['-e',"require('https').get('https://example.invalid')"],{env,encoding:'utf8'});assert.notEqual(probe.status,0);assert.match(probe.stderr,/NETWORK_OR_PROCESS_FORBIDDEN/);
    const run=()=>spawnSync(process.execPath,[resolve('dist/apps/html-cli/index.js'),'enhance',join(fixture,'layout.html'),'--out',output],{env,encoding:'utf8'});
    const result=run();assert.equal(result.status,0,result.stdout+result.stderr);assert.ok(Buffer.byteLength(result.stdout)<=1024);
    assert.equal(JSON.parse(result.stdout).pages,1);assert.equal(JSON.parse(result.stdout).visual,'unverified');
    assert.deepEqual(readdirSync(dirname(output)),['作品.html']);const bytes=readFileSync(output);
    assert.equal(run().status,1);assert.deepEqual(readFileSync(output),bytes);
  } finally {rmSync(box,{recursive:true,force:true});}
});

test('H01 acceptance 3: rejection creates no output; local resource root, symlinks, missing resources and import cycles fail explicitly', async () => {
  const box=mkdtempSync(join(tmpdir(),'h01-errors-'));
  try {
    const input=join(box,'input.html'),output=join(box,'out','作品.html');writeFileSync(input,'<h1>x</h1><script>bad()</script>');
    const result=spawnSync(process.execPath,[resolve('dist/apps/html-cli/index.js'),'enhance',input,'--out',output],{encoding:'utf8'});assert.equal(result.status,1);assert.match(result.stdout,/CONTENT_ELEMENT_REMOVED/);assert.deepEqual(readdirSync(box),['input.html']);
    const local={root:box,base:box};
    await assert.rejects(enhanceHTML('<img src="https://example.invalid/x.png">',local),/AUTHORIZATION_REQUIRED/);
    await assert.rejects(enhanceHTML('<img src="missing.png">',local),/ENOENT/);
    symlinkSync(join(fixture,'mark.svg'),join(box,'escape.svg'));
    await assert.rejects(enhanceHTML('<img src="escape.svg">',local),/OUTSIDE_ROOT/);
    writeFileSync(join(box,'cycle.css'),'@import "cycle.css";');
    await assert.rejects(enhanceHTML('<link rel="stylesheet" href="cycle.css">',local),/CYCLE_OR_DEPTH/);
    await assert.rejects(enhanceHTML(source,{...options,maxBytes:1}),/BUDGET_EXCEEDED/);
  } finally {rmSync(box,{recursive:true,force:true});}
});

test('H01 acceptance 4: actual bundled CLI/runtime import graphs exclude old representations; all three H00 drafts enhance directly', async () => {
  const graph=await build({entryPoints:['apps/html-cli/index.ts'],bundle:true,platform:'node',write:false,metafile:true,format:'esm'});
  const inputs=Object.keys(graph.metafile!.inputs);
  assert.ok(inputs.some(p => p.includes('html-document')));
  assert.deepEqual(inputs.filter(p => /packages\//.test(p) && !/^packages\/(html-document|html-save|html-editor|html-player|html-print)\//.test(p)),[]);
  assert.ok(!inputs.some(p => /playwright|puppeteer|apps\/mcp/.test(p)));
  const runtime=await build({entryPoints:['packages/html-document/src/runtime.ts'],bundle:true,platform:'browser',write:false,metafile:true});
  assert.deepEqual(Object.keys(runtime.metafile!.inputs).filter(p => /packages\//.test(p) && !/^packages\/(html-document|html-editor|html-player|html-print)\//.test(p)),[]);
  // H04 explicitly adds these two modules to the HTML contract. Keep the closed
  // allowlist above and additionally require both modules and reject retired/runtime tool chains.
  const runtimeInputs = Object.keys(runtime.metafile!.inputs);
  for (const name of ['html-player', 'html-print']) assert.ok(runtimeInputs.includes(`packages/${name}/src/index.ts`));
  for (const path of [...inputs, ...runtimeInputs]) assert.doesNotMatch(path, /packages\/(core|portable-runtime|exporter-pptx|file-format|layout-recipes|design-compiler)\/|playwright|puppeteer|apps\/mcp/);
  const records=[];
  for (const name of ['cherry','product','data']) {
    const file=resolve(`docs/html-first/evidence/h00/drafts/${name}.html`);const raw=readFileSync(file,'utf8');
    const result=await enhanceHTML(raw,{root:dirname(file),base:dirname(file)});assert.deepEqual(result.issues,[]);assert.equal(result.pages,12);
    const content=readEnhanced(result.html).content;
    const textRecords = (html: string) => elements(parse(html)).filter(e => ['h1','h2','p','td'].includes(e.tagName)).map(el => ({tag:el.tagName,text:el.childNodes.filter(n => n.nodeName === '#text').map(n => (n as {value:string}).value)}));
    assert.deepEqual(textRecords(content), textRecords(raw));
    if (name === 'cherry') writeFileSync(join(evidence,'cherry.html'),result.html);
    records.push({name,pages:result.pages,bytes:Buffer.byteLength(result.html),gzipBytes:gzipSync(result.html).length});
  }
  writeFileSync(join(evidence,'imports-and-drafts.json'),JSON.stringify({inputs,runtimeInputs:Object.keys(runtime.metafile!.inputs),drafts:records},null,2));
});


test('H01 acceptance 1/3: embedded SVG references preserve fragment identity and diagnostics obey byte limits', async () => {
  const result = await enhanceHTML('<svg><use href="mark.svg#tile"/></svg>',options);
  assert.deepEqual(result.issues,[]);
  assert.match(readEnhanced(result.html).content,/href="data:image\/svg\+xml;base64,[^"]+#tile"/);
  assert.equal((await enhanceHTML(result.html,options)).html,result.html);
  const diagnostic = summary({ok:false,error:'\u0001'.repeat(500)});
  assert.ok(Buffer.byteLength(diagnostic)<=1024); assert.equal(JSON.parse(diagnostic).ok,false);
});
