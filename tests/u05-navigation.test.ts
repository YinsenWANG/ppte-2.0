import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {cleanContent,safeWebNavigation} from '../packages/html-document/src/content.js';
import {enhanceHTML,readEnhanced} from '../packages/html-document/src/index.js';
const source=resolve('docs/audits/2026-09-07-main-d1db13d/sample/source-with-links.html');
const out=resolve('artifacts/u05-navigation');
test('U05 B2: original source-with-links enhances and round-trips both explicit web links',async()=>{
 const input=await readFile(source,'utf8');const enhanced=await enhanceHTML(input,{root:dirname(source),base:dirname(source)});
 assert.deepEqual(enhanced.issues,[]);
 for(const href of ['https://github.com/CherryHQ/cherry-studio','https://www.cherry-ai.com/']){
  assert.ok(readEnhanced(enhanced.html).content.includes(`href="${href}"`));
 }
});
test('U05 B2: navigation allowlist rejects executable/relative URLs and automatic loads',()=>{
 for(const url of ['https://example.com/a?q=1#x','http://example.com/','HTTPS://example.com/']) assert.ok(safeWebNavigation(url));
 for(const url of ['javascript:alert(1)','data:text/html,hi','file:///etc/passwd','//example.com','/relative','https://user:pass@example.com','https://example.com\\@evil.com','https://example.com\n','https://']) assert.equal(safeWebNavigation(url),false,url);
 for(const html of ['<a href="javascript:alert(1)">x</a>','<a href="https://example.com" onclick="alert(1)">x</a>','<a href="https://example.com" ping="https://example.com/ping">x</a>','<img src="https://example.com/a.png">','<style>p{background:url(https://example.com/a)}</style>','<svg><use href="https://example.com/a.svg#x"/></svg>','<meta http-equiv="refresh" content="0;url=https://example.com">']) assert.ok(cleanContent(html).issues.length,html);
 assert.deepEqual(cleanContent('<a href="https://example.com">x</a><area href="http://example.com">').issues,[]);
});
test('U05 B2: actual file clicks open isolated navigation; no automatic fetch; links survive save/reopen',async()=>{
 await mkdir(out,{recursive:true});const enhanced=await enhanceHTML(await readFile(source,'utf8'),{root:dirname(source),base:dirname(source)});
 const path=`${out}/source-with-links.ppte.html`;await writeFile(path,enhanced.html);
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext();const requests:string[]=[];
  // Intercept external destinations: prove navigation without transmitting the document or contacting sites.
  await context.route('https://**/*',async route=>{requests.push(route.request().url());await route.fulfill({contentType:'text/html',body:'<title>Intercepted navigation</title><p>Navigation destination</p>'})});
  const p=await context.newPage();await p.goto(pathToFileURL(path).href);await p.waitForFunction(()=>!!(window as any).PPTeSave);
  for(let i=0;i<9;i++)await p.getByRole('button',{name:'下一页',exact:true}).click();
  const f=p.frameLocator('#ppte-frame');const link=f.getByRole('link',{name:'GitHub · CherryHQ/cherry-studio'});
  await link.waitFor({state:'visible'});assert.deepEqual(requests,[]);
  await link.evaluate(n=>(n as HTMLElement).click());assert.deepEqual(requests,[],'synthetic clicks do not navigate');
  const popupPromise=context.waitForEvent('page');await link.click();const popup=await popupPromise;await popup.waitForLoadState();
  assert.equal(popup.url(),'https://github.com/CherryHQ/cherry-studio');assert.equal(await popup.evaluate(()=>window.opener),null);
  assert.equal(p.url(),pathToFileURL(path).href);await popup.close();
  await p.getByRole('button',{name:'编辑',exact:true}).click();
  await link.click();
  assert.equal(context.pages().length,1,'editing a linked text never opens another page');
  assert.deepEqual(requests,['https://github.com/CherryHQ/cherry-studio']);
  await p.getByRole('button',{name:'阅读',exact:true}).click();
  await p.screenshot({path:`${out}/navigation.png`});
  const saved=await p.evaluate(()=>(window as any).PPTeHTML.serialize());
  await writeFile(`${out}/reopen.ppte.html`,saved);await p.goto(pathToFileURL(`${out}/reopen.ppte.html`).href);await p.waitForFunction(()=>!!(window as any).PPTeSave);
  for(let i=0;i<9;i++)await p.getByRole('button',{name:'下一页',exact:true}).click();
  const website=p.frameLocator('#ppte-frame').getByRole('link',{name:'Cherry Studio · 官方网站'});
  await website.focus();const second=context.waitForEvent('page');await website.press('Enter');const opened=await second;await opened.waitForLoadState();assert.equal(opened.url(),'https://www.cherry-ai.com/');await opened.close();
  assert.deepEqual(requests,['https://github.com/CherryHQ/cherry-studio','https://www.cherry-ai.com/']);
  await writeFile(`${out}/journey.json`,JSON.stringify({requests,externalRequestsIntercepted:true,syntheticBlocked:true,opener:null,reopen:true,headless:true},null,2));
 }finally{await browser.close()}
});
