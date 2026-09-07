import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {resizeViewport} from './helpers/browser-viewport.js';

test('CLOSING: delivered CLI file supports offline editing, history, download and fresh-process reopening; same-content responsive comparisons',async()=>{
 const out=resolve('artifacts/r8-CLOSING');await mkdir(out,{recursive:true});
 const file=resolve('docs/ui-redesign/evidence/delivery/r8-same-prototype.ppte.html');
 const source=await readFile('docs/audits/2026-09-07-ui-d96f211/sample/source.html','utf8');
 assert.doesNotMatch(source,/data-ppte-kind/);
 let b=await chromium.launch({channel:'chrome',headless:true});
 const errors:string[]=[],network:string[]=[],dialogs:string[]=[],records:any[]=[];
 const observe=(p:any)=>{p.on('pageerror',(e:Error)=>errors.push(String(e)));p.on('request',(r:any)=>{if(/^https?:/.test(r.url()))network.push(r.url());});p.on('dialog',async(d:any)=>{dialogs.push(d.type());await d.dismiss();});};
 try{
 let p=await b.newPage({offline:true,acceptDownloads:true,viewport:{width:1440,height:960}});observe(p);
 const titles:string[]=[];
 for(const kind of ['prototype','product']){
  await resizeViewport(p,{width:1440,height:960});
  await p.goto(pathToFileURL(kind==='product'?file:resolve('docs/ui-redesign/UI_PROTOTYPE.html')).href);
  await p.getByRole('button',{name:'编辑',exact:true}).click();
  const title=kind==='product'?p.frameLocator('#ppte-frame').locator('[data-id=title1]'):p.locator('#slide [data-id=title1]');
  await title.click();titles.push(await title.innerText());
  for(const width of [1440,1024,390]){
   await resizeViewport(p,{width,height:width===390?844:960});
   await p.screenshot({path:out+`/${kind}-${width}.png`});
   if(kind==='product'){
    const g=await p.evaluate(()=>{const f=document.querySelector<HTMLIFrameElement>('#ppte-frame')!,fr=f.getBoundingClientRect(),s=f.contentDocument!.querySelector('[data-ppte-slide]')!.getBoundingClientRect(),scale=fr.width/f.offsetWidth;return {area:document.querySelector('#ppte-edit-canvas')!.getBoundingClientRect().toJSON(),panel:document.querySelector('#ppte-properties')!.getBoundingClientRect().toJSON(),page:{left:fr.left+s.left*scale,right:fr.left+s.right*scale,top:fr.top+s.top*scale,bottom:fr.top+s.bottom*scale},visibleSlides:Array.from(f.contentDocument!.querySelectorAll('[data-ppte-slide]')).filter(n=>n.getBoundingClientRect().width>0).length};});
    assert.equal(g.visibleSlides,1);assert.ok(g.page.left>=g.area.left-1&&g.page.right<=g.area.right+1);assert.ok(g.page.top>=g.area.top-1&&g.page.bottom<=g.area.bottom+1);if(width===390)assert.ok(g.area.bottom<=g.panel.top+1&&g.panel.height<=310);records.push({width,...g});
   }
  }
 }
 assert.equal(titles[0],titles[1]);
 await resizeViewport(p,{width:1440,height:960});
 const title=p.frameLocator('#ppte-frame').locator('[data-id=title1]');await title.dblclick();await title.fill('离线回交验证');await p.getByRole('button',{name:'页面设置',exact:true}).click();
 await p.getByText('更多',{exact:true}).click();await p.getByRole('menuitem',{name:'版本历史',exact:true}).click();await p.getByRole('button',{name:'保存命名版本',exact:true}).click();await p.getByLabel('版本名称',{exact:true}).fill('回交离线版本');await p.getByLabel('版本名称',{exact:true}).press('Enter');await p.locator('#ppte-version-form').waitFor({state:'detached'});assert.match(await p.locator('#ppte-versions').innerText(),/回交离线版本/);await p.getByRole('button',{name:'关闭版本历史',exact:true}).click();
 const download=p.waitForEvent('download');await p.getByRole('button',{name:'下载更新后的文件',exact:true}).click();const saved=out+'/downloaded.ppte.html';await(await download).saveAs(saved);
 await b.close();b=await chromium.launch({channel:'chrome',headless:true});p=await b.newPage({offline:true,viewport:{width:1440,height:960}});observe(p);await p.goto(pathToFileURL(saved).href);assert.equal(await p.frameLocator('#ppte-frame').locator('[data-id=title1]').innerText(),'离线回交验证');assert.equal(await p.getByRole('button',{name:'插入',exact:true}).isVisible(),false);
 await p.getByText('更多',{exact:true}).click();await p.getByRole('menuitem',{name:'版本历史',exact:true}).click();assert.match(await p.locator('#ppte-versions').innerText(),/回交离线版本/);await p.getByRole('button',{name:'关闭版本历史',exact:true}).click();
 await p.getByRole('button',{name:'放映',exact:true}).click();assert.equal(await p.locator('button:visible').count(),0);await p.keyboard.press('ArrowRight');await p.keyboard.press('Escape');assert.equal(await p.getByRole('button',{name:'编辑',exact:true}).isVisible(),true);
 assert.deepEqual(errors,[]);assert.deepEqual(network,[]);assert.deepEqual(dialogs,[]);
 const bytes=await readFile(file);await writeFile(out+'/journey.json',JSON.stringify({status:'pass',time:new Date().toISOString(),browser:b.version(),headless:true,offline:true,protocol:'file:',sample:file,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,sourceSha256:createHash('sha256').update(source).digest('hex'),sameTitle:titles[0],records,realMouseKeyboard:true,downloadAndFreshProcessReopen:true,namedHistoryReopened:true,errors,network,dialogs,nativeAuthorization:null,nativeAuthorizationReason:'Actual download tested; no native authorization session.'},null,2));
 }finally{await b.close();}
});
