import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { chromium, type Page, type Frame } from 'playwright'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { sha256HexBytes, canonicalRevision } from '../packages/canonical-json/src/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { prepareVideo, planVideo, VIDEO_IMPORT_MAX_BYTES } from '../packages/editor-controller/src/video-resource.js'
import { buildPortable, PortableRuntime, buildPortableCheckpointBytes, auditPortableBundle } from '../packages/portable-runtime/src/index.js'
import { assessCheckpointRecovery } from '../packages/portable-runtime/src/checkpoint-recovery.js'
import { buildMediaDirectory, deliverMediaDirectory } from '../packages/node-runtime/src/delivery.js'
import { renderSlideHtml, renderSlideSvg } from '../packages/renderer-react/src/index.js'
import { exportPdf, exportPng } from '../packages/exporter-pdf/src/index.js'
import { exportImagePptx, exportSemanticPptx } from '../packages/exporter-pptx/src/index.js'
import { readStoredZip } from '../packages/archive/src/index.js'
import { buildCapabilityReport } from '../packages/capability/src/index.js'
import { assessDeliveryArtifact, resolveDeliveryPolicy, STANDARD_ARTIFACT_TARGET_BYTES } from '../packages/portable-runtime/src/delivery-policy.js'
import { validateDocument, type PpteDocument, type ComponentElement } from '../packages/schema/src/index.js'

const clips=['blue-vp9.webm','red-h264.mp4']
const mediaBytes=(name:string)=>new Uint8Array(readFileSync(join(process.cwd(),'tests/fixtures/media',name)))
const metadata=async()=>({width:160,height:90,durationMs:1000})
async function fixture(name=clips[0]) {
  const {document,imageBytes}=makeContractDocument()
  const prepared=await prepareVideo(mediaBytes(name),{mimeType:name.endsWith('mp4')?'video/mp4':'video/webm',decode:metadata,posterAssetId:'asset_pixel'})
  const slide=document.slides.slide_main
  slide.elements={};slide.rootOrder=[];delete slide.groups;delete slide.readingOrder;delete slide.protectedAnchors
  document.slides={slide_main:slide,slide_empty:{...structuredClone(slide),id:'slide_empty'}};document.slideOrder=['slide_main','slide_empty']
  const session=new PpteSession(document,{runtimeProfile:'ga-c'})
  const tx=planVideo(document,{revision:session.getRevision(),slideId:'slide_main',elementId:'video',prepared,transactionId:'video-fixture'})
  const result=session.commit(tx);assert.equal(result.ok,true,JSON.stringify(result.issues))
  return {document:structuredClone(session.getDocument()),session,prepared,assetBytes:{asset_pixel:imageBytes,[prepared.asset.id]:prepared.bytes},tx}
}
const evidenceDir=join(process.cwd(),'artifacts/f04-media')
const saveEvidence=(name:string,value:unknown)=>{mkdirSync(evidenceDir,{recursive:true});writeFileSync(join(evidenceDir,name),JSON.stringify(value,null,2)+'\n')}

test('F04 A12 CAS preparation and Engine validation reject bad MIME, bytes, metadata and dangling references atomically',async()=>{
  const f=await fixture(),before=f.session.getRevision()
  for(const options of [{mimeType:'video/avi'},{decode:async()=>({width:0,height:90,durationMs:1000})},{decode:async()=>{throw Error('decoder failed')}}])await assert.rejects(prepareVideo(mediaBytes(clips[0]),{mimeType:'video/webm',decode:metadata,...options}))
  await assert.rejects(prepareVideo(new Uint8Array([1,2]),{mimeType:'video/webm',decode:metadata}),/SIGNATURE/)
  const abort=new AbortController();abort.abort();await assert.rejects(prepareVideo(mediaBytes(clips[0]),{mimeType:'video/webm',decode:metadata,signal:abort.signal}),/CANCELLED/)
  assert.equal(VIDEO_IMPORT_MAX_BYTES,128*1024*1024)
  for(const props of [{assetId:'missing'},{assetId:f.prepared.asset.id,source:'https://example.com/v.mp4'},{assetId:f.prepared.asset.id,posterAssetId:'missing'}] as Record<string,string>[]){
    const tx={...f.tx,transactionId:'invalid',baseRevision:before,operations:[{opId:'invalid',kind:'component.updateProps' as const,slideId:'slide_main',elementId:'video',patch:props}]}
    tx.scope.permissions.push('content');tx.changeContract.allowedOperationKinds=['component.updateProps']
    assert.equal(f.session.commit(tx).ok,false);assert.equal(f.session.getRevision(),before)
  }
  const bad=structuredClone(f.document);bad.assets[f.prepared.asset.id].width=0;assert.ok(validateDocument(bad).length)
  assert.equal(auditPortableBundle(buildPortable(f.document,{profile:'full-portable',assetBytes:f.assetBytes}).html).ok,true)
  const corrupt={...f.assetBytes,[f.prepared.asset.id]:new Uint8Array(f.prepared.bytes.length)}
  assert.equal(buildPortable(f.document,{profile:'full-portable',assetBytes:corrupt}).ok,false)
})

test('F04 A12 import undo/checkpoint/reopen/redo retains CAS; explicit local v1 migration preserves identity and undo',async()=>{
  const f=await fixture();const runtime=new PortableRuntime(f.session.getDocument(),{profile:'full-portable',assetBytes:f.assetBytes,recentTransactions:f.session.getHistory().map(e=>e.transaction)})
  assert.equal(runtime.undo().ok,true)
  const checkpoint=buildPortableCheckpointBytes(runtime.getDocument(),{runtimeProfile:'ga-c',assetBytes:runtime.getAssetBytes(),recentTransactions:runtime.getHistory(),redoHistory:runtime.getRedoHistory()})
  const manifest=JSON.parse(new TextDecoder().decode(readStoredZip(buildPortableCheckpointBytes(f.document,{runtimeProfile:'ga-c',assetBytes:f.assetBytes})).get('manifest.json')!));assert.equal(manifest.files.find((entry:any)=>entry.path===f.prepared.asset.path).mediaType,'video/webm')
  const diagnosis=assessCheckpointRecovery(checkpoint);assert.equal(diagnosis.snapshotStatus,'valid')
  const reopened=new PortableRuntime(diagnosis.snapshot as PpteDocument,{profile:'full-portable',assetBytes:diagnosis.assetBytes,recentTransactions:diagnosis.recentTransactions,redoHistory:diagnosis.history.retainedRedo})
  assert.equal(reopened.redo().ok,true);assert.deepEqual(reopened.getAssetBytes()[f.prepared.asset.id],f.prepared.bytes)
  const doc=structuredClone(f.document),video=doc.slides.slide_main.elements.video as ComponentElement
  video.componentVersion='1.0.0';video.props={source:'local/clip.webm',posterAssetId:'asset_pixel'}
  const session=new PpteSession(doc,{runtimeProfile:'ga-c'})
  assert.throws(()=>planVideo(doc,{revision:session.getRevision(),slideId:'slide_main',elementId:'video',prepared:f.prepared,transactionId:'migration'}),/SOURCE_REQUIRED/)
  const tx=planVideo(doc,{revision:session.getRevision(),slideId:'slide_main',elementId:'video',prepared:f.prepared,transactionId:'migration',migrateSource:'local/clip.webm'})
  const result=session.commit(tx);assert.equal(result.ok,true,JSON.stringify(result.issues));assert.equal(session.getDocument().slides.slide_main.elements.video.id,'video')
  assert.equal(session.undo().ok,true);assert.deepEqual(session.getDocument(),doc)
})

async function playback(page:Page|Frame) {
  await page.waitForFunction(()=>Boolean((globalThis as any).PPTEPortable))
  const video=page.locator('video[data-ppte-video-asset-id]'),button=page.locator('[data-ppte-media-play]')
  await page.waitForFunction(()=>document.querySelector<HTMLVideoElement>('video')?.readyState!>=1)
  const meta=await video.evaluate((v:HTMLVideoElement)=>({width:v.videoWidth,height:v.videoHeight,duration:v.duration,src:v.src,poster:v.poster}))
  assert.equal(meta.width,160);assert.equal(meta.height,90);assert.ok(Math.abs(meta.duration-1)<.25);assert.match(meta.src,/^blob:/);assert.match(meta.poster,/^blob:/)
  const revision=await page.evaluate(()=>(globalThis as any).PPTEPortable.getRevision())
  await button.click();await page.waitForFunction(()=>document.querySelector<HTMLVideoElement>('video')!.currentTime>.1)
  await button.click();assert.equal(await video.evaluate((v:HTMLVideoElement)=>v.paused),true)
  const position=await video.evaluate((v:HTMLVideoElement)=>v.currentTime)
  await page.evaluate(()=>(globalThis as any).PPTEPortable.setSlide(1))
  assert.equal(await video.evaluate((v:HTMLVideoElement)=>v.paused),true)
  await page.evaluate(()=>(globalThis as any).PPTEPortable.setSlide(0))
  assert.ok(Math.abs(await video.evaluate((v:HTMLVideoElement)=>v.currentTime)-position)<.1)
  const samples=[]
  for(let i=0;i<30;i++)samples.push(await page.evaluate(async()=>{const api=(globalThis as any).PPTEPortable,start=performance.now();api.setSlide(1);api.setSlide(0);await new Promise(requestAnimationFrame);return {ms:performance.now()-start,...api.getMediaDiagnostics()}}))
  assert.ok(samples.every(s=>s.urls===2&&s.players===1))
  await button.click();await page.waitForFunction(()=>document.querySelector('video')?.getAttribute('data-ppte-media-state')==='ended')
  assert.deepEqual(await page.evaluate(()=>(globalThis as any).PPTEPortable.getMediaDiagnostics()),{players:1,urls:0,released:2})
  await button.click();await page.waitForFunction(()=>document.querySelector<HTMLVideoElement>('video')!.currentTime>.05)
  await page.evaluate(()=>(globalThis as any).PPTEPortable.disposeMedia())
  assert.equal(await video.evaluate((v:HTMLVideoElement)=>v.paused),true);assert.equal(await video.getAttribute('src'),null)
  assert.equal(await page.evaluate(()=>(globalThis as any).PPTEPortable.getMediaDiagnostics().urls),0)
  assert.equal(await page.evaluate(()=>(globalThis as any).PPTEPortable.getRevision()),revision)
  return {meta,samples}
}

test('F04 A16/A20 two real offline file videos load metadata, manually play/pause/end/replay, resume after navigation and release',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ppte-media-')),browser=await chromium.launch({headless:true})
  try {
    const context=await browser.newContext({offline:true,viewport:{width:1280,height:900}})
    const results=[]
    for(const name of clips){
      const f=await fixture(name),built=buildPortable(f.document,{profile:'full-portable',assetBytes:f.assetBytes})
      assert.equal(built.ok,true,JSON.stringify(built.issues));assert.match(built.html,/media-src blob:;/);assert.doesNotMatch(built.html,/media-src[^;]*(?:https:|data:|\*)/)
      const file=join(dir,name+'.html');writeFileSync(file,built.html);const page=await context.newPage();await page.goto(pathToFileURL(file).href)
      const result=await playback(page);mkdirSync(evidenceDir,{recursive:true});await page.screenshot({path:join(evidenceDir,name+'.png')})
      results.push({name,sha256:sha256HexBytes(f.prepared.bytes),htmlBytes:built.bytes,...result});await page.close()
    }
    saveEvidence('playback.json',{browser:browser.version(),platform:process.platform,arch:process.arch,network:'Playwright offline:true, file://',viewport:[1280,900],results})
  }finally{await browser.close();rmSync(dir,{recursive:true,force:true})}
})

test('F04 A16 real decode failure, metadata mismatch and rejected play promises are visible',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ppte-media-errors-')),browser=await chromium.launch({headless:true})
  try {
    for(const mode of ['decode','metadata','play']){
      const f=await fixture();if(mode==='metadata')f.document.assets[f.prepared.asset.id].width=161
      if(mode==='decode'){const bytes=new Uint8Array(40);f.assetBytes[f.prepared.asset.id]=bytes;Object.assign(f.document.assets[f.prepared.asset.id],{hash:`sha256-${sha256HexBytes(bytes)}`,path:`assets/cas/sha256-${sha256HexBytes(bytes)}`,byteLength:bytes.length})}
      const built=buildPortable(f.document,{profile:'full-portable',assetBytes:f.assetBytes});assert.equal(built.ok,true)
      const file=join(dir,mode+'.html');writeFileSync(file,built.html);const page=await browser.newPage();await page.context().setOffline(true);await page.goto(pathToFileURL(file).href)
      if(mode==='play'){await page.waitForFunction(()=>document.querySelector<HTMLVideoElement>('video')?.readyState!>=1);await page.evaluate(()=>{document.querySelector<HTMLVideoElement>('video')!.play=()=>Promise.reject(new DOMException('Policy denied','NotAllowedError'))});await page.locator('[data-ppte-media-play]').click()}
      await page.waitForFunction(()=>document.querySelector('[data-ppte-media-status]')?.textContent?.includes('VIDEO_'),undefined,{timeout:5000}).catch(async()=>{throw Error(mode+': '+(await page.locator('body').innerText()).slice(0,1200))})
      const message=await page.locator('[data-ppte-media-status]').innerText();assert.match(message,mode==='decode'?/DECODE_FAILED/:mode==='metadata'?/METADATA_MISMATCH/:/PLAY_REJECTED.*NotAllowedError/)
      await page.close()
    }
  }finally{await browser.close();rmSync(dir,{recursive:true,force:true})}
})

test('F04 A17 PDF/PNG/image PPTX/semantic PPTX use the specified poster and truthfully report static video',async()=>{
  const f=await fixture(),assetSources={asset_pixel:`data:image/png;base64,${Buffer.from(f.assetBytes.asset_pixel).toString('base64')}`}
  const html=renderSlideHtml(f.document,'slide_main',{assetSources,staticMedia:true}),svg=renderSlideSvg(f.document,'slide_main',{assetSources})
  assert.match(html,/<img src="data:image\/png/);assert.doesNotMatch(html,/<video/);assert.match(svg,/data-ppte-video-poster/);assert.ok(svg.includes(assetSources.asset_pixel))
  for(const target of ['pdf','png','pptx-image','pptx-semantic'] as const){const report=buildCapabilityReport(f.document,target);assert.equal(report.items.find(i=>i.elementId==='video')?.status,'static');assert.equal(report.degraded,true);assert.match(report.items.find(i=>i.elementId==='video')!.reason!,/poster/)}
  const pdf=exportPdf(f.document,{assetBytes:f.assetBytes}),png=exportPng(f.document,{slideId:'slide_main',assetBytes:f.assetBytes}),image=exportImagePptx(f.document,{assetBytes:f.assetBytes}),semantic=exportSemanticPptx(f.document,{assetBytes:f.assetBytes})
  for(const result of [pdf,png,image,semantic]){assert.equal(result.ok,true,JSON.stringify(result.issues));assert.ok(result.bytes.length>100);assert.equal(result.degraded,true)}
  const zip=readStoredZip(semantic.bytes);assert.ok([...zip.entries()].some(([name,b])=>name.startsWith('ppt/media/')&&Buffer.from(b).equals(Buffer.from(f.assetBytes.asset_pixel))))
  assert.ok(![...zip.keys()].some(name=>/\.(mp4|webm)$/.test(name)))
  saveEvidence('exports.json',{pdfBytes:pdf.bytes.length,pngBytes:png.bytes.length,imagePptxBytes:image.bytes.length,semanticPptxBytes:semantic.bytes.length,officeClient:'unverified; no native video embedding claimed'})
})

test('F04 A16 directory verifies manifest/template/media on open, plays on loopback offline, rejects file and tampering',async()=>{
  const f=await fixture(),dir=mkdtempSync(join(tmpdir(),'ppte-media-dir-')),target=join(dir,'bundle'),browser=await chromium.launch({headless:true})
  const delivered=deliverMediaDirectory(target,f.document,{profile:'full-portable',assetBytes:f.assetBytes})
  assert.throws(()=>deliverMediaDirectory(target,f.document,{profile:'full-portable',assetBytes:f.assetBytes}),/EEXIST/)
  assert.equal(delivered.fileProtocol,'unsupported');assert.ok(readFileSync(join(target,'manifest.json')).length)
  const server=createServer((req,res)=>{try{const url=new URL(req.url!,'http://localhost');const path=url.pathname==='/'?'index.html':url.pathname.slice(1);if(path.includes('..'))throw Error();res.end(readFileSync(join(target,path)))}catch{res.statusCode=404;res.end()}})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as {port:number}).port
  try {
    const page=await browser.newPage();await page.route('**/*',route=>['file:','blob:'].includes(new URL(route.request().url()).protocol)||new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
    await page.goto(pathToFileURL(join(target,'index.html')).href);await page.waitForFunction(()=>document.querySelector('[data-ppte-directory-error]'));assert.match(await page.locator('#status').innerText(),/FILE_PROTOCOL_UNSUPPORTED/)
    const url=`http://127.0.0.1:${port}/`;await page.goto(url);await page.waitForSelector('iframe');const frame=page.frames().find(f=>f!==page.mainFrame())!;await playback(frame)
    const manifest=JSON.parse(readFileSync(join(target,'manifest.json'),'utf8'))
    for(const path of [manifest.resources[0].path,'template.html','manifest.json']){
      const original=readFileSync(join(target,path));writeFileSync(join(target,path),Buffer.concat([original,Buffer.from('corrupt')]))
      await page.goto(url);await page.waitForFunction(()=>document.querySelector('[data-ppte-directory-error]'));assert.match(await page.locator('#status').innerText(),/HASH_MISMATCH/);assert.equal(await page.locator('iframe').count(),0);writeFileSync(join(target,path),original)
    }
    saveEvidence('directory.json',{...delivered,browser:browser.version(),network:'external requests aborted; only loopback HTTP allowed',tamperCases:['media','template','manifest'],fileProtocolResult:'explicitly rejected'})
  }finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(dir,{recursive:true,force:true})}
})

test('F04 A20 frozen 20 MiB HTML / 128 MiB import budgets and 20 cold/warm startup samples',async()=>{
  assert.equal(STANDARD_ARTIFACT_TARGET_BYTES,20*1024*1024)
  // Budget is evaluated against complete artifact bytes, including base64 expansion and runtime.
  const policy=(bytes:number)=>assessDeliveryArtifact({bytes,runtimeGzipBytes:1,resourceBytes:0,budgetBytes:3_000_000},resolveDeliveryPolicy())
  assert.equal(policy(STANDARD_ARTIFACT_TARGET_BYTES).ok,true);assert.equal(policy(STANDARD_ARTIFACT_TARGET_BYTES+1).ok,false)
  const f=await fixture(),built=buildPortable(f.document,{profile:'full-portable',assetBytes:f.assetBytes}),directory=buildMediaDirectory(f.document,{profile:'full-portable',assetBytes:f.assetBytes})
  assert.ok(built.bytes<STANDARD_ARTIFACT_TARGET_BYTES);assert.ok(directory.metrics.directoryBytes<STANDARD_ARTIFACT_TARGET_BYTES)
  const dir=mkdtempSync(join(tmpdir(),'ppte-media-start-')),file=join(dir,'deck.html');writeFileSync(file,built.html)
  const browser=await chromium.launch({headless:true}),samples=[]
  try {
    for(let i=0;i<20;i++){
      const context=await browser.newContext({offline:true}),page=await context.newPage()
      for(const kind of ['cold-context','warm-reload']){const start=performance.now();await page.goto(pathToFileURL(file).href);await page.waitForFunction(()=>document.querySelector<HTMLVideoElement>('video')?.readyState!>=1);samples.push({kind,ms:performance.now()-start})}
      await context.close()
    }
    const times=samples.map(s=>s.ms).sort((a,b)=>a-b)
    saveEvidence('capacity.json',{budgetVersion:'f04-media-v1',standardHtmlBytes:STANDARD_ARTIFACT_TARGET_BYTES,importBytes:VIDEO_IMPORT_MAX_BYTES,fixtureSha256:sha256HexBytes(f.prepared.bytes),htmlBytes:built.bytes,directoryBytes:directory.metrics.directoryBytes,browser:browser.version(),platform:process.platform,arch:process.arch,samples,p50:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],unverified:['Safari','physical low-performance device','physical audio output']})
  }finally{await browser.close();rmSync(dir,{recursive:true,force:true})}
})

test('F04 A20 real decodable MP4 capacity samples retain the standard threshold and explicit large-file opt-in',async()=>{
  const base=await fixture('red-h264.mp4'),samples=[]
  for(const size of [10*1024*1024,16*1024*1024]){
    // ISO BMFF permits a free-space box: preserve the actual encoded video while varying local asset size deterministically.
    const bytes=new Uint8Array(size);bytes.set(base.prepared.bytes)
    const offset=base.prepared.bytes.length;new DataView(bytes.buffer).setUint32(offset,size-offset);bytes.set(new TextEncoder().encode('free'),offset+4)
    const document=structuredClone(base.document),asset=document.assets[base.prepared.asset.id]
    asset.byteLength=size;asset.hash=`sha256-${sha256HexBytes(bytes)}`;asset.path=`assets/cas/${asset.hash}`
    const built=buildPortable(document,{profile:'full-portable',assetBytes:{...base.assetBytes,[asset.id]:bytes}})
    assert.equal(built.ok,true)
    const metrics={bytes:built.bytes,runtimeGzipBytes:built.runtimeGzipBytes!,resourceBytes:built.resourceBytes!,budgetBytes:3_000_000}
    const assessment=assessDeliveryArtifact(metrics,resolveDeliveryPolicy())
    assert.equal(assessment.ok,size===10*1024*1024)
    assert.equal(assessDeliveryArtifact(metrics,resolveDeliveryPolicy(),true).ok,true)
    if(!assessment.ok)assert.equal(assessment.code,'DELIVERY_ARTIFACT_LARGE')
    samples.push({sourceBytes:size,sha256:sha256HexBytes(bytes),htmlBytes:built.bytes,standardAccepted:assessment.ok})
  }
  const manifest=JSON.parse(readFileSync('tests/fixtures/media/manifest.json','utf8'))
  for(const f of manifest.fixtures)assert.equal(sha256HexBytes(mediaBytes(f.file)),f.sha256)
  saveEvidence('size-boundaries.json',{budgetVersion:'f04-media-v1',standardHtmlBytes:STANDARD_ARTIFACT_TARGET_BYTES,samples})
})

test('F04 A12/A16 Host offline file imports through Engine, plays without gestures, pauses on exit and saves retained video',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ppte-media-host-'))
  const built=spawnSync('pnpm',['host:build','--outDir',join(dir,'host')],{encoding:'utf8'});assert.equal(built.status,0,built.stdout+built.stderr)
  const browser=await chromium.launch({headless:true})
  try {
    const page=await browser.newPage({viewport:{width:1600,height:1100},acceptDownloads:true});await page.context().setOffline(true)
    await page.goto(pathToFileURL(join(dir,'host/index.html')).href);await page.waitForFunction(()=>document.querySelector('[data-ppte-host]')?.getAttribute('data-ppte-ready')==='true')
    const before=Number(await page.locator('[data-ppte-host]').getAttribute('data-ppte-history-depth'))
    await page.getByLabel('导入视频',{exact:true}).setInputFiles(join(process.cwd(),'tests/fixtures/media/blue-vp9.webm'))
    await page.waitForFunction(()=>document.querySelector<HTMLVideoElement>('[data-ppte-stage] video')?.readyState!>=1)
    assert.equal(Number(await page.locator('[data-ppte-host]').getAttribute('data-ppte-history-depth')),before+1)
    const video=page.locator('[data-ppte-stage] video'),button=page.locator('[data-ppte-stage] [data-ppte-media-play]')
    await button.click();await page.waitForFunction(()=>document.querySelector<HTMLVideoElement>('[data-ppte-stage] video')!.currentTime>.1)
    await button.click();assert.equal(await video.evaluate((v:HTMLVideoElement)=>v.paused),true)
    await page.locator('[data-ppte-action="present"]').click()
    await page.waitForFunction(()=>document.querySelector<HTMLVideoElement>('[data-ppte-stage] video')?.readyState!>=1)
    await button.click();await page.waitForFunction(()=>!document.querySelector<HTMLVideoElement>('[data-ppte-stage] video')!.paused,undefined,{timeout:5000}).catch(async()=>{throw Error(await page.locator('[data-ppte-stage]').innerText())})
    assert.equal(await page.locator('[data-ppte-host]').getAttribute('data-ppte-presenter-slide'),'0')
    await page.keyboard.press('Escape');assert.equal(await video.evaluate((v:HTMLVideoElement)=>v.paused),true)
    assert.equal(Number(await page.locator('[data-ppte-host]').getAttribute('data-ppte-history-depth')),before+1)
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('[data-ppte-action="save"]').click()]);const file=join(dir,'saved.ppte');await download.saveAs(file)
    const diagnosis=assessCheckpointRecovery(new Uint8Array(readFileSync(file)));assert.equal(diagnosis.snapshotStatus,'valid')
    const archive=readStoredZip(new Uint8Array(readFileSync(file)));assert.ok([...archive.values()].some(bytes=>Buffer.from(bytes).equals(Buffer.from(mediaBytes(clips[0])))))
    await page.locator('[data-ppte-action="undo"]').click();assert.equal(await video.count(),0)
    await page.locator('[data-ppte-action="redo"]').click();await page.waitForFunction(()=>document.querySelector<HTMLVideoElement>('[data-ppte-stage] video')?.readyState!>=1)
    await page.screenshot({path:join(evidenceDir,'host.png')});saveEvidence('host.json',{browser:browser.version(),network:'offline:true,file://',historyDelta:1,import:true,play:true,pause:true,exitPaused:true,checkpointCas:true,undoRedo:true})
  }finally{await browser.close();rmSync(dir,{recursive:true,force:true})}
})
