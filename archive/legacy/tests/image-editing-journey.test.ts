import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { prepareImage, planImage, CropGesture, retainedResourceHashes } from '../packages/editor-controller/src/resource-port.js'
import { collectResourcePool, poolBytes } from '../packages/editor-react/src/resource-pool.js'
import { buildPortableCheckpointBytes, buildPortable, PortableRuntime, decodePortable } from '../packages/portable-runtime/src/shared.js'
import { assessCheckpointRecovery } from '../packages/portable-runtime/src/checkpoint-recovery.js'
import { buildCheckpointBytes } from '../packages/file-format/src/index.js'
import { hashPool, requireAssetBytes } from '../packages/file-format/src/resource-retention.js'
import type { ImageElement } from '../packages/schema/src/index.js'
const fixture=makeContractDocument(),slideId='slide_main'
const decoded=async()=>({width:1,height:1})
const prepare=()=>prepareImage(fixture.imageBytes,{mimeType:'image/png',decode:decoded,name:'picture.png'})

test('E06 A12 shared preparation validates MIME, signature, hash, decode, dimensions, limits and cancellation without objects',async()=>{
  const session=new PpteSession(fixture.document),before=session.getRevision()
  for(const options of [{mimeType:'image/svg+xml'},{maxBytes:1},{expectedHash:'sha256-bad'},{decode:async()=>{throw Error('decode failed')}},{decode:async()=>({width:0,height:2})},{maxPixels:0}]){
    await assert.rejects(prepareImage(fixture.imageBytes,{mimeType:'image/png',decode:decoded,...options}))
    assert.equal(session.getRevision(),before);assert.equal(session.getHistory().length,0)
  }
  await assert.rejects(prepareImage(new Uint8Array([1,2,3]),{mimeType:'image/png',decode:decoded}),/SIGNATURE/)
  const abort=new AbortController()
  await assert.rejects(prepareImage(fixture.imageBytes,{mimeType:'image/png',signal:abort.signal,decode:async()=>{abort.abort();return decoded()}}),/CANCELLED/)
  assert.equal(session.getRevision(),before)
  const a=await prepare(),b=await prepare();assert.equal(a.asset.id,b.asset.id);assert.deepEqual(a,b)
})

test('E06 A12 image insertion is one atomic operation-engine transaction; shared asset reuse and locked replacement undo safely',async()=>{
  const session=new PpteSession(fixture.document,{runtimeProfile:'ga-c'}),prepared=await prepare()
  for(const elementId of ['first','second']){
    const tx=planImage(session.getDocument(),{revision:session.getRevision(),slideId,elementId,prepared,transactionId:elementId})
    const result=session.commit(tx);assert.equal(result.ok,true,JSON.stringify(result.issues))
    assert.equal(tx.operations.length,elementId==='first'?2:1)
  }
  assert.equal(session.getHistory().length,2)
  assert.equal(session.undo().ok,true)
  assert.ok(session.getDocument().assets[prepared.asset.id]);assert.ok(session.getDocument().slides[slideId].elements.first)
  assert.equal(session.undo().ok,true);assert.equal(session.getDocument().assets[prepared.asset.id],undefined)
  const doc=structuredClone(fixture.document);doc.slides[slideId].elements.image_hero.locked=true
  const locked=new PpteSession(doc,{runtimeProfile:'ga-c'})
  const tx=planImage(locked.getDocument(),{revision:locked.getRevision(),slideId,elementId:'image_hero',prepared,replace:true,transactionId:'locked'})
  assert.equal(locked.commit(tx).ok,false);assert.equal(locked.getDocument().assets[prepared.asset.id],undefined)
})

test('E06 A12 crop previews are transient, bounded and cancellable; replacement preserves identity, frame and crop',async()=>{
  const original=fixture.document.slides[slideId].elements.image_hero as ImageElement
  for(const mode of ['cancel','lostcapture','Escape','zero']){
    const gesture=new CropGesture(original,'nw');if(mode!=='zero'){gesture.update(90,40);gesture.cancel()}
    assert.equal(gesture.end(),undefined);assert.equal(original.crop,undefined)
  }
  const gesture=new CropGesture(original,'nw');for(let i=1;i<=100;i++)gesture.update(i,i/2)
  const crop=gesture.end()!;assert.ok(crop.x>0&&crop.y>0&&crop.x+crop.width<=1&&crop.y+crop.height<=1)
  const doc=structuredClone(fixture.document);(doc.slides[slideId].elements.image_hero as ImageElement).crop=crop
  const session=new PpteSession(doc,{runtimeProfile:'ga-c'}),prepared=await prepare()
  const tx=planImage(session.getDocument(),{revision:session.getRevision(),slideId,elementId:'image_hero',prepared,replace:true,transactionId:'replace'})
  assert.equal(session.commit(tx).ok,true)
  assert.deepEqual(session.getDocument().slides[slideId].elements.image_hero,{...doc.slides[slideId].elements.image_hero,assetId:prepared.asset.id})
  assert.equal(session.undo().ok,true);assert.deepEqual(session.getDocument(),doc)
})

test('E06 A04 complete resource retention includes document, undo, redo, journal, drafts and jobs; only unreferenced bytes collect',()=>{
  const names=['document','undo','redo','journal','draft','jobs'] as const
  const pool=poolBytes(Object.fromEntries(names.map((n,i)=>[n,new Uint8Array([i])]))),roots=Object.fromEntries(names.map(n=>[n,{hash:Object.keys(hashPool({x:pool[n]})).find(k=>k.startsWith('sha256-'))}])) as Record<typeof names[number],unknown>
  const retained=collectResourcePool({...pool,unused:new Uint8Array([99])},roots)
  assert.equal(retainedResourceHashes(roots).size,6)
  for(const n of names)assert.deepEqual(retained[n],pool[n])
  assert.equal(retained.unused,undefined)
  assert.throws(()=>collectResourcePool(pool,{document:{}} as typeof roots),/ROOT_MISSING/)
  assert.deepEqual(collectResourcePool(pool,Object.fromEntries(names.map(n=>[n,[]])) as typeof roots),{})
})

test('E06 A04 insert → undo → Node/browser checkpoint → offline reopen → redo retains verified image bytes',async()=>{
  const runtime=new PortableRuntime(fixture.document,{profile:'full-portable',assetBytes:{asset_pixel:fixture.imageBytes}}),prepared=await prepareImage(new Uint8Array([...fixture.imageBytes,0]),{mimeType:'image/png',decode:decoded})
  assert.equal(runtime.commitPreparedImage(slideId,'inserted',prepared).ok,true)
  assert.equal(runtime.undo().ok,true)
  const options={runtimeProfile:'ga-c' as const,assetBytes:runtime.getAssetBytes(),recentTransactions:runtime.getHistory(),redoHistory:[...runtime.getRedoHistory()]}
  for(const build of [buildCheckpointBytes,buildPortableCheckpointBytes]){
    const bytes=build(runtime.getDocument(),options),opened=assessCheckpointRecovery(bytes)
    assert.equal(opened.snapshotStatus,'valid',JSON.stringify(opened.issues));assert.equal(opened.history.status,'valid')
    const next=new PortableRuntime(opened.document!,{profile:'full-portable',assetBytes:opened.assetBytes,recentTransactions:opened.recentTransactions,redoHistory:opened.history.retainedRedo})
    assert.equal(next.redo().ok,true);assert.deepEqual(next.getAssetBytes()[prepared.asset.id],prepared.bytes)
    assert.deepEqual(next.getDocument().slides[slideId].elements.inserted.type,'image')
  }
  const html=runtime.saveAsPortable();assert.equal(html.ok,true,JSON.stringify(html.issues))
  const payload=decodePortable(html.html),reopened=new PortableRuntime(payload.document,{profile:'full-portable',assetBytes:Object.fromEntries(Object.entries(payload.assets).map(([id,b64])=>[id,new Uint8Array(Buffer.from(b64,'base64'))])),recentTransactions:payload.recentTransactions,redoHistory:payload.redoHistory})
  assert.equal(reopened.redo().ok,true);assert.deepEqual(reopened.getAssetBytes()[prepared.asset.id],prepared.bytes)
  const missing={...options,assetBytes:{asset_pixel:fixture.imageBytes}}
  assert.throws(()=>buildPortableCheckpointBytes(runtime.getDocument(),missing),/ASSET_(MISSING|HASH_MISMATCH)/)
  assert.throws(()=>buildCheckpointBytes(runtime.getDocument(),missing),/ASSET_(MISSING|HASH_MISMATCH)/)
  assert.throws(()=>requireAssetBytes({[prepared.asset.id]:new Uint8Array([0])},prepared.asset),/HASH_MISMATCH/)
})

test('E06 A12 real offline browser file, paste and drop use decoded CAS imports; crop pointer cancellation and save/redo survive',async()=>{
  const built=buildPortable(fixture.document,{profile:'full-portable',assetBytes:{asset_pixel:fixture.imageBytes}})
  assert.equal(built.ok,true,JSON.stringify(built.issues))
  const dir=mkdtempSync(join(tmpdir(),'e06-')),path=join(dir,'deck.html');writeFileSync(path,built.html)
  const browser=await chromium.launch({headless:true})
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900}}),errors:string[]=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message))
    await page.goto(pathToFileURL(path).href);await page.waitForFunction(()=>Boolean((globalThis as any).PPTEPortable))
    // Use a browser-produced PNG: preparation must exercise the actual decoder.
    const png=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=32;canvas.height=16;canvas.getContext('2d')!.fillRect(0,0,32,16);return canvas.toDataURL().split(',')[1]})
    for(const source of ['file','paste','drop']){
      const before=await page.evaluate(()=>(globalThis as any).PPTEPortable.getHistory().length)
      if(source==='file')await page.locator('[data-ppte-action="import-image"]').setInputFiles({name:'test.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')})
      else await page.evaluate(({source,png})=>{const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],'test.png',{type:'image/png'}));const event=source==='paste'?new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}):new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true});document.querySelector('[data-ppte-canvas]')!.dispatchEvent(event)}, {source,png})
      await page.waitForFunction(n=>(globalThis as any).PPTEPortable.getHistory().length===n+1,before)
    }
    const state=await page.evaluate(()=>{const api=(globalThis as any).PPTEPortable;return {doc:api.getDocument(),history:api.getHistory().length}})
    const inserted=Object.values(state.doc.slides[slideId].elements).filter((e:any)=>e.type==='image'&&e.id!=='image_hero') as ImageElement[]
    assert.equal(inserted.length,3);assert.equal(new Set(inserted.map(e=>e.assetId)).size,1)
    await page.getByText('对象工具',{exact:true}).click()
    await page.evaluate(id=>(globalThis as any).PPTEPortable.select(id),inserted[0].id)
    await page.locator('[data-ppte-action="crop"]').click()
    const handle=page.locator('[data-ppte-crop-handle="nw"]');const box=(await handle.boundingBox())!
    await page.mouse.move(box.x+9,box.y+9);await page.mouse.down();await page.mouse.move(box.x+50,box.y+35);await page.keyboard.press('Escape');await page.mouse.up()
    assert.equal(await page.evaluate(()=>(globalThis as any).PPTEPortable.getHistory().length),state.history)
    await page.locator('[data-ppte-action="crop"]').click();const box2=(await handle.boundingBox())!
    await page.mouse.move(box2.x+9,box2.y+9);await page.mouse.down();await page.mouse.move(box2.x+45,box2.y+30);await page.mouse.up()
    assert.equal(await page.evaluate(()=>(globalThis as any).PPTEPortable.getHistory().length),state.history+1)
    await page.evaluate(()=>{const api=(globalThis as any).PPTEPortable;api.undo();api.undo()})
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('[data-ppte-action="save-portable"]').click()]);const saved=join(dir,'saved.html');await download.saveAs(saved)
    await page.goto(pathToFileURL(saved).href);await page.waitForFunction(()=>Boolean((globalThis as any).PPTEPortable))
    assert.equal(await page.evaluate(()=>(globalThis as any).PPTEPortable.redo().ok),true)
    assert.deepEqual(errors,[])
  }finally{await browser.close();rmSync(dir,{recursive:true,force:true})}
})

test('E06 A04 Host quota/decode/cancel failures leave no half object; all import sources and crop survive source save/reopen',async()=>{
  const {spawnSync}=await import('node:child_process')
  const {readFileSync}=await import('node:fs')
  const dir=mkdtempSync(join(tmpdir(),'e06-host-'))
  const build=spawnSync('pnpm',['host:build','--outDir',join(dir,'host')],{encoding:'utf8'})
  assert.equal(build.status,0,build.stdout+build.stderr)
  const browser=await chromium.launch({headless:true})
  try{
    const page=await browser.newPage({viewport:{width:1600,height:1100},acceptDownloads:true});page.setDefaultTimeout(15000)
    await page.addInitScript(()=>{
      const create=URL.createObjectURL,revoke=URL.revokeObjectURL,active=new Set<string>();(globalThis as any).activeImageUrls=active;
      URL.createObjectURL=blob=>{const url=create(blob);if(blob instanceof Blob&&blob.type.startsWith('image/'))active.add(url);return url};
      URL.revokeObjectURL=url=>{active.delete(url);revoke(url)};
    })
    await page.goto(pathToFileURL(join(dir,'host/index.html')).href)
    const host=page.locator('[data-ppte-host]');await page.waitForFunction(()=>document.querySelector('[data-ppte-host]')?.getAttribute('data-ppte-ready')==='true')
    const history=()=>host.getAttribute('data-ppte-history-depth'),before=await history()
    const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=48;c.height=32;c.getContext('2d')!.fillRect(0,0,48,32);return c.toDataURL().split(',')[1]})
    const input=page.locator('[data-ppte-action="import-image"]')
    await input.setInputFiles({name:'bad.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71])})
    await page.waitForFunction(()=>document.querySelector('[data-ppte-status]')?.textContent?.includes('图片导入失败'))
    assert.equal(await history(),before)
    await page.evaluate(()=>{const native=IDBObjectStore.prototype.put;(globalThis as any).restoreImageQuota=()=>{IDBObjectStore.prototype.put=native};IDBObjectStore.prototype.put=function(){throw new DOMException('E06 quota','QuotaExceededError')}})
    await input.setInputFiles({name:'quota.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')})
    await page.waitForFunction(()=>document.querySelector('[data-ppte-status]')?.textContent?.includes('quota'))
    assert.equal(await history(),before);assert.equal(await page.locator('[data-ppte-stage] [data-ppte-type="image"]').count(),0)
    await page.evaluate(()=>(globalThis as any).restoreImageQuota())
    // Hold the real decoder until Escape, then let it finish; late completion must not commit.
    await page.evaluate(()=>{const native=createImageBitmap;(globalThis as any).restoreImageDecode=()=>{globalThis.createImageBitmap=native};globalThis.createImageBitmap=((...args:any[])=>new Promise(resolve=>{(globalThis as any).releaseImageDecode=()=>resolve((native as any)(...args))})) as typeof createImageBitmap})
    await input.setInputFiles({name:'cancel.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')})
    await page.waitForFunction(()=>Boolean((globalThis as any).releaseImageDecode));await host.focus();await page.keyboard.press('Escape')
    await page.evaluate(()=>{(globalThis as any).releaseImageDecode();(globalThis as any).restoreImageDecode()})
    await page.waitForFunction(()=>document.querySelector('[data-ppte-status]')?.textContent?.includes('CANCELLED'));assert.equal(await history(),before)
    let id:string|undefined
    for(const source of ['file','paste','drop']){
      // Different pixels ensure replacement is observable while preserving the selected element.
      const image=await page.evaluate(source=>{const c=document.createElement('canvas');c.width=48;c.height=32;const ctx=c.getContext('2d')!;ctx.fillStyle=source==='file'?'red':source==='paste'?'blue':'green';ctx.fillRect(0,0,48,32);return c.toDataURL().split(',')[1]},source)
      const depth=Number(await history())
      if(source==='file')await input.setInputFiles({name:'valid.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')})
      else await page.evaluate(({source,image})=>{const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(atob(image),c=>c.charCodeAt(0))],'valid.png',{type:'image/png'}));document.querySelector('[data-ppte-stage]')!.dispatchEvent(source==='paste'?new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}):new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}))},{source,image})
      await page.waitForFunction(n=>Number(document.querySelector('[data-ppte-host]')?.getAttribute('data-ppte-history-depth'))===n+1,depth)
      const images=page.locator('[data-ppte-stage] [data-ppte-type="image"]');assert.equal(await images.count(),1)
      const next=(await images.first().getAttribute('data-ppte-element-id'))!;if(id)assert.equal(next,id);id=next
    }
    await page.locator('[data-ppte-action="crop"]').click()
    const handle=page.locator('[data-ppte-crop-handle="nw"]'),box=(await handle.boundingBox())!,depth=Number(await history())
    await page.mouse.move(box.x+9,box.y+9);await page.mouse.down();await page.mouse.move(box.x+40,box.y+25);await page.mouse.up()
    await page.waitForFunction(n=>Number(document.querySelector('[data-ppte-host]')?.getAttribute('data-ppte-history-depth'))===n+1,depth)
    assert.equal(await page.evaluate(()=>(globalThis as any).activeImageUrls.size),1)
    const crop=await page.locator(`[data-ppte-stage] [data-ppte-element-id="${id}"]`).getAttribute('data-ppte-crop');assert.ok(crop)
    for(let i=0;i<4;i++)await page.locator('[data-ppte-action="undo"]').click()
    assert.equal(await page.locator('[data-ppte-stage] [data-ppte-type="image"]').count(),0)
    await page.waitForFunction(()=>(globalThis as any).activeImageUrls.size===0)
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('[data-ppte-action="save"]').click()]).catch(async error=>{throw Error(`${String(error)}; status: ${await page.locator('[data-ppte-status]').textContent()}`)})
    const saved=join(dir,'saved.ppte');await download.saveAs(saved)
    const opened=assessCheckpointRecovery(new Uint8Array(readFileSync(saved)));assert.equal(opened.snapshotStatus,'valid');assert.equal(opened.history.retainedRedo.length,4)
    await page.locator('[data-ppte-action="open"]').setInputFiles(saved)
    await page.waitForFunction(()=>Number(document.querySelector('[data-ppte-host]')?.getAttribute('data-ppte-redo-depth'))===4)
    for(let i=0;i<4;i++)await page.locator('[data-ppte-action="redo"]').click()
    const restored=page.locator(`[data-ppte-stage] [data-ppte-element-id="${id}"]`)
    assert.equal(await restored.getAttribute('data-ppte-crop'),crop)
    await restored.locator('img').evaluate((img:HTMLImageElement)=>img.decode())
    assert.equal(await restored.locator('img').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0),true)
  }finally{await browser.close();rmSync(dir,{recursive:true,force:true})}
})
