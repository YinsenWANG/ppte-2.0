import { downloadUpdated } from './helpers/focused-product.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { enhanceHTML } from '../packages/html-document/src/index.js';
const out = resolve('artifacts/s01');
const fixture = resolve('tests/fixtures/html-first');

test('S01 file URL: offline visible entry, native canvas, text/format/undo, present/Esc, copied file and complete download', async () => {
  mkdirSync(join(out,'copied'),{recursive:true});
  const result=await enhanceHTML(readFileSync(join(fixture,'layout.html'),'utf8'),{root:fixture,base:fixture});
  assert.deepEqual(result.issues,[]);
  const file=join(out,'作品.ppte.html');writeFileSync(file,result.html);
  const copy=join(out,'copied','作品.ppte.html');copyFileSync(file,copy);
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const requests: string[]=[];
  const errors: string[]=[];
  try {
    const context=await browser.newContext({offline:true,viewport:{width:1440,height:1000},acceptDownloads:true});
    context.on('request',r=>requests.push(r.url()));
    const page=await context.newPage();page.on('dialog',d=>void d.accept());page.on('pageerror',e=>errors.push(String(e)));
    for (const path of [file,copy]) {
      await page.goto(pathToFileURL(path).href);
      await page.waitForFunction(()=>!!(window as any).PPTeSave);
      assert.equal(await page.locator('#ppte-save-ui strong').textContent(),'Native design · Grid / Flex / SVG');
      for(const name of ['编辑','放映','导出为 PDF']) assert.equal(await page.getByRole('button',{name,exact:true}).isVisible(),true);
      assert.equal(await page.getByRole('button',{name:'保存',exact:true}).isVisible(),false);
      assert.equal(await page.getByRole('button',{name:'下载更新后的文件',exact:true}).isVisible(),false);
      assert.match(await page.locator('[role=status]').textContent()??'',/尚未关联写入文件/);
      assert.equal(await page.locator('[role=status]').isVisible(),false);
      const frame=page.frameLocator('#ppte-frame');
      await frame.locator('img').evaluate(async n=>{await (n as HTMLImageElement).decode();});
      assert.equal(await frame.locator('.slide').evaluate(n=>getComputedStyle(n).display),'grid');
      assert.equal(await frame.locator('.copy').evaluate(n=>getComputedStyle(n).display),'flex');
      if(path===file)await page.screenshot({path:join(out,'read.png')});
      await page.getByRole('button',{name:'编辑',exact:true}).click();
      const heading=frame.locator('h1');await heading.fill('Offline edited');
      await heading.click();await page.getByRole('button',{name:'斜体',exact:true}).click();
      assert.equal(await heading.evaluate(n=>getComputedStyle(n).fontStyle),'italic');
      await page.getByRole('button',{name:'撤销',exact:true}).click();
      assert.equal(await heading.evaluate(n=>getComputedStyle(n).fontStyle),'normal');
      assert.equal(await heading.textContent(),'Offline edited');
      if(path===file)await page.screenshot({path:join(out,'edit.png')});
      await page.getByRole('button',{name:'放映',exact:true}).click();
      assert.equal(await page.locator('#ppte-save-ui').isVisible(),false);
      assert.equal(await page.locator('#ppte-workspace').isVisible(),false);
      await page.mouse.move(0,0);await page.waitForTimeout(2000);
      assert.equal(await page.locator('#ppte-player-controls').count(),0);
      if(path===file)await page.screenshot({path:join(out,'present.png')});
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#ppte-save-ui').isVisible(),true);
      assert.equal(await page.locator('#ppte-pages').isVisible(),true);
      assert.equal(await page.locator('#ppte-workspace').getAttribute('data-open'),'');
      await page.getByRole('button',{name:'阅读',exact:true}).click();
      assert.equal(await heading.getAttribute('contenteditable'),'false');
      assert.equal(await page.getByRole('button',{name:'编辑',exact:true}).isVisible(),true);
      const downloadEvent=page.waitForEvent('download');
      await downloadUpdated(page);
      const download=await downloadEvent;assert.match(download.suggestedFilename(),/\.ppte\.html$/);
      await download.saveAs(join(out,'download.ppte.html'));
      assert.match(await page.getByRole('status').textContent()??'',/原文件未覆盖/);
      assert.equal(readFileSync(path,'utf8'),result.html);
      // Avoid unloading a dirty page: close the tab; each copy gets a clean tab below via navigation dialog dismissal.
    }
    await page.goto(pathToFileURL(join(out,'download.ppte.html')).href);
    await page.waitForFunction(()=>!!(window as any).PPTeSave);
    assert.equal(await page.frameLocator('#ppte-frame').locator('h1').textContent(),'Offline edited');
    await page.getByRole('button',{name:'编辑',exact:true}).click();
    assert.equal(await page.frameLocator('#ppte-frame').locator('h1').getAttribute('contenteditable'),'true');
    assert.deepEqual(requests.filter(u=>/^(https?|wss?):/.test(u)),[]);
    assert.deepEqual(errors,[]);
    writeFileSync(join(out,'network-log.json'),JSON.stringify({offline:true,requests,errors},null,2));
    writeFileSync(join(out,'journey.json'),JSON.stringify({status:'passed',browser:browser.version(),channel:'chrome',headless:true,entry:pathToFileURL(file).href,copiedFile:copy,steps:['visible reading controls','offline text edit','italic format','undo format','present without editor or permanent toolbar','Escape restores edit','reading disables text editing','complete download and reopen'],noNodeTarget:{status:'pending',reason:'Actual Chrome browser automated from a development host with Node/PPTe installed; offline and no service do not prove a separate no-Node environment.'},human:'pending'},null,2));
  } finally {await browser.close();}
});

test('S01 CLI edit exits with file URL, rejects service flags and leaves original bytes unchanged',()=>{
  mkdirSync(out,{recursive:true});const file=join(out,'cli space 中文.html');writeFileSync(file,'<h1>Legacy HTML</h1>');
  const guard=join(out,'no-listen.cjs');writeFileSync(guard,"require('net').Server.prototype.listen=()=>{throw Error('SERVICE_FORBIDDEN')};");
  const run=(...args:string[])=>spawnSync(process.execPath,[resolve('dist/apps/html-cli/index.js'),'edit',file,...args],{encoding:'utf8',timeout:5000,env:{...process.env,NODE_OPTIONS:`--require=${guard}`}});
  const result=run('--no-open');assert.equal(result.status,0,result.stdout+result.stderr);
  assert.equal(JSON.parse(result.stdout).url,pathToFileURL(file).href);
  const rejected=run('--port=23456');assert.equal(rejected.status,1);
  assert.equal(readFileSync(file,'utf8'),'<h1>Legacy HTML</h1>');
  writeFileSync(join(out,'cli.json'),JSON.stringify({status:'passed',result:JSON.parse(result.stdout),serviceFlagRejected:true,listenGuard:true},null,2));
});
