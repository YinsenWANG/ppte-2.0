import { spawnSync } from 'node:child_process'
import { buildCheckpointBytes } from '../packages/file-format/src/index.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { nextStep, previousStep, nextSlide, previousSlide, gotoSlide, normalizePresenterState } from '../packages/portable-runtime/src/presenter-state.js'
import { createPortableFullPortable, PortableRuntime, decodePortable } from '../packages/portable-runtime/src/shared.js'
import { buildCapabilityReport } from '../packages/capability/src/index.js'
import type { Transaction } from '../packages/schema/src/index.js'

function fixture() {
  const result = makeContractDocument(), doc = result.document, slide = doc.slides.slide_main
  slide.elements.text_body.appearStep = 3
  slide.elements.text_body.animation = {enter:{type:'slide-up',durationMs:800,delayMs:90,easing:'linear'},exit:{type:'fade',durationMs:100}}
  slide.elements.text_title.animation = {enter:{type:'fade',durationMs:700}}
  slide.transition = {type:'slide',direction:'right',durationMs:900}
  const other=structuredClone(slide);other.id='second';other.transition={type:'push',direction:'up',durationMs:800}
  // Element identities remain globally unique.
  other.elements=Object.fromEntries(Object.values(other.elements).map(e=>{const old=e.id;e.id=`second_${old}`;return [e.id,e]}))
  other.rootOrder=other.rootOrder.map(id=>`second_${id}`)
  other.readingOrder=other.readingOrder?.map(id=>`second_${id}`)
  doc.slides.second=other;doc.slideOrder.push('second')
  return result
}

test('F05 A16 step/slide boundaries are independent, sparse, stable by slideId and noncycling',()=>{
  const {document:doc}=fixture();const base={slideId:'slide_main',slideIndex:0,step:0}
  const first=nextStep(doc,base);assert.equal(first.step,3)
  assert.deepEqual(previousStep(doc,first),base)
  assert.deepEqual(nextSlide(doc,base),{slideId:'second',slideIndex:1,step:0})
  assert.equal(previousStep(doc,nextSlide(doc,base)).step,3)
  assert.equal(previousSlide(doc,nextSlide(doc,first)).step,0)
  assert.equal(nextStep(doc,first).slideId,'second')
  assert.deepEqual(previousStep(doc,base),base)
  const end=gotoSlide(doc,base,'second',3);assert.deepEqual(nextStep(doc,end),end);assert.deepEqual(nextSlide(doc,end),end)
  assert.deepEqual(gotoSlide(doc,base,'missing'),base)
  doc.slideOrder.reverse();assert.deepEqual(normalizePresenterState(doc,first),{slideId:'slide_main',slideIndex:1,step:3})
  assert.equal(previousSlide(doc,first).slideId,'second')
  assert.equal(gotoSlide(doc,first,'second').step,0)
})

test('F05 A17 unsupported fields survive Engine commit, undo/redo, save/reopen and have precise static reports',()=>{
  const {document:doc,imageBytes}=fixture();const runtime=new PortableRuntime(doc,{profile:'full-portable',assetBytes:{asset_pixel:imageBytes}})
  const animation={enter:{type:'scale' as const,durationMs:20000,delayMs:15000},exit:{type:'fade' as const}}
  const tx:Transaction={transactionId:'animation-contract',baseRevision:runtime.getRevision(),createdAt:'2026-09-06T00:00:00Z',actor:{type:'human'},scope:{kind:'slide',slideIds:['slide_main'],permissions:['animation']},changeContract:{allowedOperationKinds:['element.setAnimation']},operations:[{opId:'animation',kind:'element.setAnimation',slideId:'slide_main',elementId:'text_body',animation}]}
  assert.equal(runtime.commit(tx).ok,true)
  assert.equal(runtime.undo().ok,true);assert.equal(runtime.redo().ok,true)
  const built=runtime.saveAsPortable();assert.equal(built.ok,true,JSON.stringify(built.issues))
  assert.deepEqual(decodePortable(built.html).document.slides.slide_main.elements.text_body.animation,animation)
  const report=runtime.getCapabilityReport()
  for(const suffix of ['/animation/enter','/animation/exit','/animation/enter/durationMs','/animation/enter/delayMs'])assert.ok(report.items.some(i=>i.sourcePath?.endsWith(`text_body${suffix}`)&&i.status==='static'))
  for(const target of ['pdf','png','pptx-image','pptx-semantic'] as const)assert.ok(buildCapabilityReport(runtime.getDocument(),target).items.filter(i=>i.id.startsWith('animation:')).every(i=>i.status==='static'))
  runtime.gotoSlide('slide_main',3)
  assert.equal(runtime.nextSlide().step,0);assert.equal(runtime.previousStep().step,3)
  runtime.dispose()
})

test('F05 A06/A16 browser executes effects, timing and directions; reduced motion, edit and print preserve content',async()=>{
  const {document:doc,imageBytes}=fixture()
  const built=createPortableFullPortable(doc,{assetBytes:{asset_pixel:imageBytes}});assert.equal(built.ok,true,JSON.stringify(built.issues))
  const dir=mkdtempSync(join(tmpdir(),'f05-'));writeFileSync(join(dir,'deck.html'),built.html)
  const browser=await chromium.launch({headless:true})
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}})
    await page.goto(pathToFileURL(join(dir,'deck.html')).href);await page.waitForFunction(()=>Boolean((globalThis as any).PPTEPortable))
    const body=page.locator('[data-ppte-element-id="text_body"]')
    assert.equal(await body.evaluate(n=>getComputedStyle(n).visibility),'visible')
    await page.evaluate(()=>{document.getElementById('ppte-shell')!.requestFullscreen=async()=>{throw Error('refused')}})
    await page.locator('[data-ppte-action="fullscreen"]').click()
    assert.equal(await body.evaluate(n=>getComputedStyle(n).visibility),'hidden')
    const initial=await page.evaluate(()=>{
      const slide=document.querySelector('[data-ppte-slide-id="slide_main"]')!,title=document.querySelector('[data-ppte-element-id="text_title"]')!
      return {width:slide.getBoundingClientRect().width,slide:slide.getAnimations().map(a=>({frames:(a.effect as KeyframeEffect).getKeyframes(),time:a.effect!.getTiming()})),title:title.getAnimations().length}
    })
    assert.equal(initial.title,1);assert.equal(initial.slide[0].time.duration,900);assert.ok(Math.abs(parseFloat(String(initial.slide[0].frames[0].translate))+initial.width)<.01)
    await page.evaluate(()=>(globalThis as any).PPTEPortable.nextStep())
    const effect=await body.evaluate(n=>{const a=n.getAnimations()[0];return {time:a.effect!.getTiming(),frames:(a.effect as KeyframeEffect).getKeyframes()}})
    assert.equal(effect.time.duration,800);assert.equal(effect.time.delay,90);assert.equal(effect.time.easing,'linear');assert.equal(effect.frames[0].translate,'0px 16px')
    // Rendering the same step must not restart an entrance.
    const start=await body.evaluate(n=>n.getAnimations()[0].startTime)
    await page.evaluate(()=>window.dispatchEvent(new Event('resize')))
    assert.equal(await body.evaluate(n=>n.getAnimations()[0].startTime),start)
    await page.evaluate(()=>(globalThis as any).PPTEPortable.previousStep());assert.equal(await body.evaluate(n=>getComputedStyle(n).visibility),'hidden')
    await page.emulateMedia({reducedMotion:'reduce'})
    await page.evaluate(()=>(globalThis as any).PPTEPortable.nextStep());assert.equal(await body.evaluate(n=>getComputedStyle(n).visibility),'visible');assert.equal(await body.evaluate(n=>n.getAnimations().length),0)
    await page.evaluate(()=>(globalThis as any).PPTEPortable.previousStep())
    await page.emulateMedia({media:'print'});assert.equal(await body.evaluate(n=>getComputedStyle(n).visibility),'visible')
    await page.emulateMedia({media:'screen',reducedMotion:'no-preference'})
    await page.keyboard.press('PageDown')
    const push=await page.locator('[data-ppte-slide-id="second"]').evaluate(n=>{const a=n.getAnimations()[0];return {height:n.getBoundingClientRect().height,frames:(a.effect as KeyframeEffect).getKeyframes(),duration:a.effect!.getTiming().duration}})
    assert.ok(Math.abs(parseFloat(String(push.frames[0].translate).split(' ')[1])-push.height)<.01);assert.equal(push.duration,800)
    await page.keyboard.press('Escape');assert.equal(await page.locator('[data-ppte-element-id="second_text_body"]').evaluate(n=>getComputedStyle(n).visibility),'visible')
  } finally {await browser.close();rmSync(dir,{recursive:true,force:true})}
})

test('F05 animation controls commit typed operations and preview without document changes',async()=>{
  const {document:doc,imageBytes}=fixture();const built=createPortableFullPortable(doc,{assetBytes:{asset_pixel:imageBytes}});assert.equal(built.ok,true)
  const dir=mkdtempSync(join(tmpdir(),'f05-controls-'));writeFileSync(join(dir,'deck.html'),built.html)
  const browser=await chromium.launch({headless:true})
  try {
    const page=await browser.newPage({viewport:{width:1600,height:1100}});await page.goto(pathToFileURL(join(dir,'deck.html')).href);await page.waitForFunction(()=>Boolean((globalThis as any).PPTEPortable))
    await page.getByLabel('翻页方向',{exact:true}).selectOption('down')
    assert.equal(await page.evaluate(()=>(globalThis as any).PPTEPortable.getDocument().slides.slide_main.transition.direction),'down')
    await page.locator('[data-ppte-element-id="text_body"]').click()
    await page.getByLabel('入场效果',{exact:true}).selectOption('slide-left')
    assert.equal(await page.evaluate(()=>(globalThis as any).PPTEPortable.getDocument().slides.slide_main.elements.text_body.animation.enter.type),'slide-left')
    const before=await page.evaluate(()=>(globalThis as any).PPTEPortable.getRevision())
    await page.getByRole('button',{name:'预览动画',exact:true}).click();await page.getByRole('button',{name:'下一步预览',exact:true}).click();await page.getByRole('button',{name:'关闭预览',exact:true}).click()
    assert.equal(await page.evaluate(()=>(globalThis as any).PPTEPortable.getRevision()),before)
    await page.evaluate(()=>(globalThis as any).PPTEPortable.undo())
    assert.equal(await page.evaluate(()=>(globalThis as any).PPTEPortable.getDocument().slides.slide_main.elements.text_body.animation.enter.type),'slide-up')
  } finally {await browser.close();rmSync(dir,{recursive:true,force:true})}
})

test('F05 all transition directions, push outgoing motion and bounded unsupported effects execute honestly',async()=>{
  const {document:doc,imageBytes}=fixture()
  doc.slides.slide_main.elements.text_body.animation={enter:{type:'scale',durationMs:20000}}
  const built=createPortableFullPortable(doc,{assetBytes:{asset_pixel:imageBytes}});assert.equal(built.ok,true)
  const dir=mkdtempSync(join(tmpdir(),'f05-directions-'));writeFileSync(join(dir,'deck.html'),built.html)
  const browser=await chromium.launch({headless:true})
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(pathToFileURL(join(dir,'deck.html')).href);await page.waitForFunction(()=>Boolean((globalThis as any).PPTEPortable))
    await page.evaluate(()=>{document.getElementById('ppte-shell')!.requestFullscreen=async()=>{throw Error('refused')}})
    for (const type of ['slide','push','fade','none']) for (const direction of ['left','right','up','down']) {
      if (!await page.locator('[data-ppte-properties-panel]').getAttribute('open').then(v=>v!==null)) await page.locator('[data-ppte-properties-panel]>summary').click()
      await page.getByLabel('翻页效果',{exact:true}).selectOption(type)
      await page.getByLabel('翻页方向',{exact:true}).selectOption(direction)
      await page.locator('[data-ppte-action="fullscreen"]').click()
      // Start on the other page so push has an outgoing snapshot.
      const effects=await page.evaluate(()=>{const api=(globalThis as any).PPTEPortable;api.gotoSlide('second');api.gotoSlide('slide_main');const slide=document.querySelector('[data-ppte-slide-id="slide_main"]')!;return {width:slide.getBoundingClientRect().width,height:slide.getBoundingClientRect().height,frames:slide.getAnimations().map(a=>(a.effect as KeyframeEffect).getKeyframes()),outgoing:document.querySelectorAll('.ppte-slide[aria-hidden="true"]').length}})
      if(type==='none')assert.equal(effects.frames.length,0)
      else if(type==='fade')assert.equal(effects.frames[0][0].opacity,'0')
      else {assert.ok(Math.abs(parseFloat(String(effects.frames[0][0].translate).split(' ')[['left','right'].includes(direction)?0:1]) - (['left','right'].includes(direction)?effects.width:effects.height)*(['right','down'].includes(direction)?-1:1))<.01);assert.equal(effects.outgoing,type==='push'?1:0)}
      await page.evaluate(()=>(globalThis as any).PPTEPortable.nextStep())
      assert.equal(await page.locator('[data-ppte-element-id="text_body"]').evaluate(n=>n.getAnimations().length),0)
      await page.keyboard.press('Escape')
    }
    await page.locator('[data-ppte-properties-panel]>summary').click()
    await page.locator('[data-ppte-element-id="text_body"]').click()
    await page.getByLabel('入场效果',{exact:true}).selectOption('slide-left')
    await page.locator('[data-ppte-action="fullscreen"]').click()
    const time=await page.evaluate(()=>{(globalThis as any).PPTEPortable.gotoSlide('slide_main',3);const a=document.querySelector('[data-ppte-element-id="text_body"]')!.getAnimations()[0];return a.effect!.getTiming().duration})
    assert.equal(time,10000)
  } finally {await browser.close();rmSync(dir,{recursive:true,force:true})}
})

test('F05 Host config and playback use the same animation and independent navigation contract',async()=>{
  const {document:doc,imageBytes}=fixture();const dir=mkdtempSync(join(tmpdir(),'f05-host-'))
  const build=spawnSync('pnpm',['host:build','--outDir',join(dir,'host')],{encoding:'utf8'});assert.equal(build.status,0,build.stdout+build.stderr)
  writeFileSync(join(dir,'deck.ppte'),buildCheckpointBytes(doc,{assetBytes:{asset_pixel:imageBytes}}))
  const browser=await chromium.launch({headless:true})
  try {
    const page=await browser.newPage({viewport:{width:1600,height:1100}});await page.goto(pathToFileURL(join(dir,'host/index.html')).href);await page.waitForFunction(()=>document.querySelector('[data-ppte-host]')?.getAttribute('data-ppte-ready')==='true')
    await page.locator('[data-ppte-action="open"]').setInputFiles(join(dir,'deck.ppte'));await page.waitForFunction(()=>document.querySelector('[data-ppte-status]')?.textContent?.includes('已打开'))
    await page.getByLabel('翻页方向',{exact:true}).selectOption('down')
    const depth=await page.locator('[data-ppte-host]').getAttribute('data-ppte-history-depth')
    await page.locator('[data-ppte-action="present"]').click()
    const body=page.locator('.ppte-rendered-slide [data-ppte-element-id="text_body"]')
    assert.equal(await body.evaluate(n=>getComputedStyle(n).visibility),'hidden')
    assert.equal(await page.locator('.ppte-rendered-slide [data-ppte-slide-id]').evaluate(n=>{
      const translate=String((n.getAnimations()[0].effect as KeyframeEffect).getKeyframes()[0].translate)
      return Math.abs(parseFloat(translate.split(' ')[1])+n.getBoundingClientRect().height)<.01
    }),true)
    await page.keyboard.press('ArrowRight');assert.equal(await body.evaluate(n=>getComputedStyle(n).visibility),'visible')
    assert.equal(await body.evaluate(n=>n.getAnimations()[0].effect!.getTiming().duration),800)
    await page.keyboard.press('ArrowLeft');assert.equal(await body.evaluate(n=>getComputedStyle(n).visibility),'hidden')
    await page.keyboard.press('PageDown');assert.equal(await page.locator('.ppte-rendered-slide [data-ppte-slide-id]').getAttribute('data-ppte-slide-id'),'second')
    await page.keyboard.press('ArrowLeft');assert.equal(await body.evaluate(n=>getComputedStyle(n).visibility),'visible')
    await page.emulateMedia({reducedMotion:'reduce'});await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowRight');assert.equal(await body.evaluate(n=>n.getAnimations().length),0)
    await page.keyboard.press('Escape');assert.equal(await body.evaluate(n=>getComputedStyle(n).visibility),'visible')
    await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')))
    await page.emulateMedia({media:'print'})
    assert.equal(await page.locator('[data-ppte-print-document] [data-ppte-slide-id]').count(),2)
    assert.equal(await page.locator('[data-ppte-print-document] [data-ppte-element-id="second_text_body"]').evaluate(n=>getComputedStyle(n).visibility),'visible')
    await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')))
    assert.equal(await page.locator('[data-ppte-host]').getAttribute('data-ppte-history-depth'),depth)
  } finally {await browser.close();rmSync(dir,{recursive:true,force:true})}
})
