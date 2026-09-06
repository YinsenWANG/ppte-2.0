import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { chromium, type Page } from 'playwright'
import { PresenterChannel,PresenterTools,type PresenterEnvelope } from '../packages/editor-controller/src/presenter-channel.js'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { createPortableFullPortable } from '../packages/portable-runtime/src/shared.js'
import { buildCheckpointBytes } from '../packages/file-format/src/index.js'

test('F06 A16 monotonic timer pause/reset and visual tools are transient',()=>{
  let now=0;const tools=new PresenterTools(()=>now)
  tools.blackout=true;tools.laser=true;tools.toggleTimer();now=1500;assert.equal(tools.elapsedMs,1500)
  tools.toggleTimer();now=2000;assert.equal(tools.elapsedMs,1500)
  tools.toggleTimer();now=2500;assert.equal(tools.elapsedMs,2000)
  tools.resetTimer();assert.equal(tools.elapsedMs,0);now=2700;assert.equal(tools.elapsedMs,200)
  assert.equal(tools.blackout,true);assert.equal(tools.laser,true)
})

test('F06 A16 version/session/token/source/origin and malformed sequence validation',()=>{
  const source={},sent:PresenterEnvelope[]=[],received:unknown[]=[]
  const c=new PresenterChannel({session:'session',token:'secret',source,origin:'https://local',now:()=>0,send:m=>sent.push(m),receive:p=>received.push(p)})
  const message:PresenterEnvelope={version:1,session:'session',token:'secret',kind:'data',seq:1,ack:0,payload:'next'}
  for(const data of [null,{}, {...message,version:2},{...message,session:'old'},{...message,token:'wrong'},{...message,seq:2},{...message,seq:0},{...message,seq:1.5},{...message,ack:1},{...message,kind:'other'}]) assert.equal(c.accept({source,origin:'https://local',data}),false)
  assert.equal(c.accept({source:{},origin:'https://local',data:message}),false)
  assert.equal(c.accept({source,origin:'null',data:message}),false)
  assert.equal(received.length,0);assert.equal(sent.length,0)
  assert.equal(c.accept({source,origin:'https://local',data:message}),true)
  assert.equal(c.accept({source,origin:'https://local',data:message}),true)
  assert.deepEqual(received,['next']);assert.equal(sent.at(-1)?.ack,1)
  c.dispose();assert.equal(c.accept({source,origin:'https://local',data:message}),false)
})

test('F06 A16 dropped data/ACK, duplicates, out-of-order and disconnect converge without losing rapid commands',()=>{
  let now=0;const aSource={},bSource={},toA:PresenterEnvelope[]=[],toB:PresenterEnvelope[]=[],applied:unknown[]=[]
  const a=new PresenterChannel({session:'s',token:'t',source:bSource,origin:'o',now:()=>now,send:m=>toB.push(m),receive:()=>{}})
  const b=new PresenterChannel({session:'s',token:'t',source:aSource,origin:'o',now:()=>now,send:m=>toA.push(m),receive:p=>applied.push(p)})
  const receiveB=(m:PresenterEnvelope)=>b.accept({source:aSource,origin:'o',data:m})
  a.send('next');a.send('next');a.send('previous');const first=toB.shift()!
  assert.equal(receiveB({...first,seq:2}),false)
  now=4000;assert.equal(a.connected,false);a.tick();receiveB(toB.shift()!);toA.length=0 // drop ACK
  a.tick();receiveB(toB.shift()!);assert.deepEqual(applied,['next'])
  a.accept({source:bSource,origin:'o',data:toA.shift()!})
  for(let i=0;i<2;i++){receiveB(toB.shift()!);a.accept({source:bSource,origin:'o',data:toA.shift()!})}
  receiveB(first);assert.deepEqual(applied,['next','next','previous']);assert.equal(a.connected,true)
  now+=4000;assert.equal(a.connected,false)
  a.send('snapshot');receiveB(toB.shift()!);a.accept({source:bSource,origin:'o',data:toA.at(-1)!});assert.equal(a.connected,true)
})

function fixture(){
  const f=makeContractDocument(),doc=f.document,other=structuredClone(doc.slides.slide_main)
  doc.slides.slide_main.notes={speaker:'F06_SECRET_SPEAKER',handout:'F06_SECRET_HANDOUT'}
  other.id='second';other.notes={speaker:'SECOND_SECRET'}
  other.elements=Object.fromEntries(Object.values(other.elements).map(e=>{e.id=`second_${e.id}`;return [e.id,e]}));other.rootOrder=other.rootOrder.map(id=>`second_${id}`);other.readingOrder=other.readingOrder?.map(id=>`second_${id}`)
  doc.slides.second=other;doc.slideOrder.push('second');return f
}
async function exercise(page:Page,host:boolean){
  const root=page.locator(host?'[data-ppte-host]':'#ppte-shell')
  const before=await root.getAttribute(host?'data-ppte-history-depth':'data-ppte-revision')
  await page.evaluate(()=>{Element.prototype.requestFullscreen=async()=>{throw Error('denied')}})
  await page.locator(host?'[data-ppte-action=present]':'[data-ppte-action=fullscreen]').click()
  const panel=page.locator('[data-ppte-live-tools]');await panel.waitFor()
  assert.equal(await page.locator('[contenteditable=true]').count(),0)
  assert.equal(await page.evaluate(()=>document.body.textContent!.includes('F06_SECRET')),false)
  const step=await root.getAttribute(host?'data-ppte-presenter-step':'data-ppte-step')
  await panel.getByRole('button',{name:'黑屏',exact:true}).click();assert.equal(await page.locator('[data-ppte-blackout]').isVisible(),true);assert.equal(await root.getAttribute(host?'data-ppte-presenter-step':'data-ppte-step'),step)
  await panel.getByRole('button',{name:'黑屏',exact:true}).click();assert.equal(await page.locator('[data-ppte-blackout]').isVisible(),false)
  await panel.getByRole('button',{name:'激光笔',exact:true}).click();await page.locator('[data-ppte-stage]').hover({position:{x:150,y:150}});assert.equal(await page.locator('[data-ppte-laser]').isVisible(),true)
  await panel.getByRole('button',{name:'计时开始/暂停'}).click();await page.waitForFunction(()=>document.querySelector('[data-ppte-live-tools] [role=status]')?.textContent?.includes('0:01'))
  await panel.getByRole('button',{name:'计时开始/暂停'}).click();await panel.getByRole('button',{name:'计时归零'}).click();assert.match(await panel.innerText(),/0:00/)
  await panel.getByText('下一页预览',{exact:true}).click();assert.equal(await panel.locator('iframe').isVisible(),true);await panel.frameLocator('iframe').locator('.ppte-slide').waitFor();assert.equal(await panel.frameLocator('iframe').locator('img').first().evaluate((n:HTMLImageElement)=>n.complete&&n.naturalWidth>0),true)
  await panel.getByRole('button',{name:'下一页',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-ppte-live-tools] [role=status]')?.textContent?.startsWith('2 / 2'))
  await panel.getByRole('spinbutton',{name:'跳转页码'}).fill('1');await panel.getByRole('spinbutton').press('Tab');await page.waitForFunction(()=>document.querySelector('[data-ppte-live-tools] [role=status]')?.textContent?.startsWith('1 / 2'))
  assert.equal(await root.getAttribute(host?'data-ppte-history-depth':'data-ppte-revision'),before)
  return {panel,root,before}
}

test('F06 snapshot coalescing, bounded command queue, dispose and fresh-session replay rejection',()=>{
  const source={},out:PresenterEnvelope[]=[]
  const c=new PresenterChannel({session:'new',token:'new-token',source,origin:'o',now:()=>0,send:m=>out.push(m),receive:()=>{throw Error('must not apply old session')}})
  c.send('old snapshot');c.send('intermediate',true);c.send('latest',true)
  assert.equal(c.accept({source,origin:'o',data:{version:1,session:'old',token:'old-token',kind:'data',seq:1,ack:0,payload:'next'}}),false)
  c.accept({source,origin:'o',data:{version:1,session:'new',token:'new-token',kind:'ack',seq:0,ack:1}})
  assert.equal(out.at(-1)?.payload,'latest')
  for(let i=0;i<64;i++)assert.equal(c.send({action:'next'}),true)
  assert.equal(c.send({action:'next'}),false)
  c.dispose();const count=out.length;c.tick();assert.equal(c.send('late'),false);assert.equal(out.length,count)
})

test('F06 A06/A16/A21 generated file Portable tools, denied fullscreen, opaque-origin fallback and note isolation',async()=>{
  const f=fixture(),built=createPortableFullPortable(f.document,{assetBytes:{asset_pixel:f.imageBytes}});assert.equal(built.ok,true)
  const dir=mkdtempSync(join(tmpdir(),'f06-file-'));writeFileSync(join(dir,'deck.html'),built.html)
  const browser=await chromium.launch({headless:true})
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);await page.goto(pathToFileURL(join(dir,'deck.html')).href);await page.waitForFunction(()=>Boolean((globalThis as any).PPTEPortable))
    const {panel}=await exercise(page,false)
    await panel.getByRole('button',{name:'演讲者窗口 / 重连'}).click();assert.match(await panel.innerText(),/限制双屏，单屏可用/)
    await page.keyboard.press('Escape');assert.equal(await panel.count(),0);assert.equal(await page.locator('#ppte-portable-payload').count(),1)
    assert.match(await page.locator('[data-ppte-notes]').innerText(),/F06_SECRET_SPEAKER/)
  }finally{await browser.close();rmSync(dir,{recursive:true,force:true})}
})

test('F06 A06/A16/A21 HTTP Host and Portable real presenter window ACK/source, popup denial, close and reconnect',async()=>{
  const f=fixture(),dir=mkdtempSync(join(tmpdir(),'f06-dual-'))
  const build=spawnSync('pnpm',['host:build','--outDir',join(dir,'host')],{encoding:'utf8'});assert.equal(build.status,0,build.stdout+build.stderr)
  const built=createPortableFullPortable(f.document,{assetBytes:{asset_pixel:f.imageBytes}});assert.equal(built.ok,true);writeFileSync(join(dir,'deck.html'),built.html)
  writeFileSync(join(dir,'deck.ppte'),buildCheckpointBytes(f.document,{assetBytes:{asset_pixel:f.imageBytes}}))
  const server=createServer((req,res)=>{try{const path=join(dir,decodeURIComponent(req.url!.split('?')[0]));res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(readFileSync(path))}catch{res.statusCode=404;res.end()}})
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`
  const browser=await chromium.launch({headless:true})
  try{for(const host of [false,true]){
    const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(15000);await page.goto(url+(host?'/host/index.html':'/deck.html'))
    if(host){await page.waitForFunction(()=>document.querySelector('[data-ppte-host]')?.getAttribute('data-ppte-ready')==='true');await page.locator('[data-ppte-action=open]').setInputFiles(join(dir,'deck.ppte'));await page.waitForFunction(()=>document.querySelector('[data-ppte-status]')?.textContent?.includes('已打开'))}
    else await page.waitForFunction(()=>Boolean((globalThis as any).PPTEPortable))
    const {panel,root,before}=await exercise(page,host)
    await page.evaluate(()=>{(globalThis as any).savedOpen=window.open;window.open=()=>null})
    await panel.getByRole('button',{name:'演讲者窗口 / 重连'}).click();assert.match(await panel.innerText(),/弹窗被拒绝/)
    await page.evaluate(()=>{window.open=(globalThis as any).savedOpen})
    const opened=page.waitForEvent('popup');await panel.getByRole('button',{name:'演讲者窗口 / 重连'}).click();const popup=await opened;popup.setDefaultTimeout(15000)
    await popup.waitForFunction(()=>document.querySelector('[data-ppte-speaker-notes]')?.textContent==='F06_SECRET_SPEAKER')
    await page.waitForFunction(()=>document.querySelector('[data-ppte-live-tools]')?.textContent?.includes('双屏已连接'))
    mkdirSync('artifacts/f06',{recursive:true});await popup.screenshot({path:`artifacts/f06/${host?'host':'portable'}-presenter.png`});await page.screenshot({path:`artifacts/f06/${host?'host':'portable'}-audience.png`})
    assert.equal(await page.evaluate(()=>document.body.textContent!.includes('F06_SECRET')),false)
    await popup.evaluate(()=>window.addEventListener('message',e=>{(globalThis as any).lastPresenterEnvelope=e.data},{once:true}))
    await popup.waitForFunction(()=>Boolean((globalThis as any).lastPresenterEnvelope))
    const envelope=await popup.evaluate(()=>(globalThis as any).lastPresenterEnvelope)
    const command={...envelope,seq:1,ack:0,kind:'data',payload:{action:'next'}}
    // Correct credentials from an unrelated source, then wrong token/session from the bound child.
    await page.evaluate(m=>window.postMessage(m,location.origin),command)
    await popup.evaluate(m=>{window.opener.postMessage({...m,token:'wrong'},window.opener.location.origin);window.opener.postMessage({...m,session:'stale'},window.opener.location.origin)},command)
    await page.waitForTimeout(300)
    assert.match(await panel.locator('[role=status]').innerText(),/^1 \/ 2/)
    await popup.getByRole('button',{name:'下一页',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-ppte-live-tools] [role=status]')?.textContent?.startsWith('2 / 2'))
    await popup.waitForFunction(()=>document.querySelector('[data-ppte-speaker-notes]')?.textContent==='SECOND_SECRET')
    // Drop authenticated child traffic, then restore: queued commands and snapshots recover.
    await page.evaluate(()=>{(globalThis as any).savedPostMessage=window.postMessage;window.postMessage=()=>{}})
    await popup.getByRole('button',{name:'上一页',exact:true}).click()
    await page.waitForFunction(()=>document.querySelector('[data-ppte-live-tools]')?.textContent?.includes('双屏断连'))
    await page.evaluate(()=>{window.postMessage=(globalThis as any).savedPostMessage})
    await page.waitForFunction(()=>document.querySelector('[data-ppte-live-tools] [role=status]')?.textContent?.startsWith('1 / 2'))
    await popup.close();await page.waitForFunction(()=>document.querySelector('[data-ppte-live-tools]')?.textContent?.includes('已关闭'))
    const reopened=page.waitForEvent('popup');await panel.getByRole('button',{name:'演讲者窗口 / 重连'}).click();const next=await reopened;next.setDefaultTimeout(15000)
    await next.waitForFunction(()=>document.querySelector('[data-ppte-speaker-notes]')?.textContent==='F06_SECRET_SPEAKER')
    assert.equal(await root.getAttribute(host?'data-ppte-history-depth':'data-ppte-revision'),before)
    await panel.getByRole('button',{name:'退出放映',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-ppte-live-tools]'));assert.equal(next.isClosed(),true)
    // Closing the audience ends both endpoints; reopen the saved/recovered deck and start fresh.
    await page.locator(host?'[data-ppte-action=present]':'[data-ppte-action=fullscreen]').click()
    const closingPopup=page.waitForEvent('popup');await page.getByRole('button',{name:'演讲者窗口 / 重连'}).click();const orphan=await closingPopup
    await orphan.waitForFunction(()=>document.querySelector('[data-ppte-speaker-notes]')?.textContent==='F06_SECRET_SPEAKER')
    const closed=orphan.waitForEvent('close');await page.close();await closed
    const restored=await context.newPage();restored.setDefaultTimeout(15000);await restored.goto(url+(host?'/host/index.html':'/deck.html'))
    if(host)await restored.waitForFunction(()=>document.querySelector('[data-ppte-host]')?.getAttribute('data-ppte-ready')==='true')
    else await restored.waitForFunction(()=>Boolean((globalThis as any).PPTEPortable))
    await restored.evaluate(()=>{Element.prototype.requestFullscreen=async()=>{throw Error('denied')}})
    await restored.locator(host?'[data-ppte-action=present]':'[data-ppte-action=fullscreen]').click()
    await restored.waitForFunction(()=>document.querySelector('[data-ppte-live-tools] [role=status]')?.textContent?.startsWith('1 / 2 · 0:00'))
    assert.equal(await restored.locator('[data-ppte-blackout]').isVisible(),false)
    await restored.keyboard.press('Escape');await context.close()
  }}finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));rmSync(dir,{recursive:true,force:true})}
})
