import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { IncrementalRenderCache,renderSlideHtml,renderDocumentSurfaceHtml,slideWindow } from '../packages/renderer-react/src/index.js'
import { buildPortable } from '../packages/portable-runtime/src/index.js'

const perf=await import(pathToFileURL(resolve('scripts/perf-browser.mjs')).href)

test('P02 criterion 1: dirty slides/elements match full rendering, including reorder, removal, theme and resource changes',()=>{
  const {document}=makeContractDocument(),cache=new IncrementalRenderCache()
  const check=()=>{cache.begin(document);for(const id of document.slideOrder)assert.equal(cache.render(document,id),renderSlideHtml(document,id))}
  check();assert.equal(cache.dirtySlides.size,document.slideOrder.length)
  check();assert.equal(cache.dirtySlides.size,0);assert.equal(cache.dirtyElements.size,0)
  const slide=document.slides[document.slideOrder[0]],id=slide.rootOrder[0]
  slide.elements[id].frame.x+=1;check();assert.deepEqual([...cache.dirtySlides],[slide.id]);assert.deepEqual([...cache.dirtyElements],[id])
  slide.rootOrder.reverse();check();assert.equal(cache.dirtyElements.size,0)
  delete slide.elements[id];slide.rootOrder=slide.rootOrder.filter(e=>e!==id);check()
  document.canvas.width+=1;check();assert.equal(cache.dirtySlides.size,document.slideOrder.length)
  document.theme.tokens.colors['p02']='#123456';check();assert.equal(cache.dirtySlides.size,document.slideOrder.length)
  const asset=document.assets.asset_pixel;asset.hash='sha256-'+'f'.repeat(64);check()
  assert.ok(cache.dirtySlides.size>0)
})

test('P02 criterion 3: thumbnail invalidation is local; 100-page window is bounded and full export preserves order',async()=>{
  const document=structuredClone((await perf.makeFixture(100)).document),cache=new IncrementalRenderCache()
  const options={staticMedia:true,editable:false}
  cache.begin(document);const before=document.slideOrder.map((id:string)=>cache.render(document,id,options))
  document.slides.perf_0.elements.perf_0_text_01.frame.x+=1
  cache.begin(document);const after=document.slideOrder.map((id:string)=>cache.render(document,id,options))
  assert.deepEqual([...cache.dirtySlides],['perf_0']);assert.notEqual(before[0],after[0]);assert.deepEqual(before.slice(1),after.slice(1))
  assert.deepEqual(slideWindow(document,'perf_0'),['perf_0','perf_1'])
  assert.deepEqual(slideWindow(document,'perf_50'),['perf_49','perf_50','perf_51'])
  assert.deepEqual(slideWindow(document,'perf_99'),['perf_98','perf_99'])
  const exported=renderDocumentSurfaceHtml(document,options)
  assert.deepEqual([...exported.matchAll(/data-ppte-slide-id="([^"]+)"/g)].map(m=>m[1]),document.slideOrder)
})

async function harness() {
  const browser=await chromium.launch({headless:true}),page=await browser.newPage()
  const bundle=await build({stdin:{contents:`export {BrowserResourceCache} from './packages/editor-react/src/resource-pool.ts'; export {reconcileTextSurface} from './packages/editor-dom/src/text-selection.ts'`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',globalName:'P02'})
  await page.addScriptTag({content:bundle.outputFiles[0].text});return {browser,page}
}

test('P02 criterion 1: real DOM preserves unrelated pages, composing text and media position; forced rollback restores geometry',async()=>{
  const {browser,page}=await harness()
  try {
    assert.deepEqual(await page.evaluate(()=>{
      const {reconcileTextSurface:sync}=(globalThis as any).P02,root=document.createElement('main');document.body.append(root)
      const html=(x:number)=>`<div data-ppte-slide-id="a"><div data-ppte-element-id="text" contenteditable="true">canonical</div><div data-ppte-element-id="shape" style="left:${x}px"></div></div><div data-ppte-slide-id="b"><video data-ppte-element-id="video"></video></div>`
      sync(root,html(0));const text=root.querySelector<HTMLElement>('[contenteditable]')!,video=root.querySelector('video')!,slide=video.parentElement!,shape=root.querySelector<HTMLElement>('[data-ppte-element-id="shape"]')!
      text.focus();text.textContent='IME draft';video.currentTime=.25
      const protect=(node:HTMLElement)=>node===text||node===video
      let changes=0;const observer=new MutationObserver(records=>{changes+=records.length});observer.observe(slide,{subtree:true,attributes:true,childList:true})
      sync(root,html(2),protect);changes+=observer.takeRecords().length;observer.disconnect()
      const stable=text===root.querySelector('[contenteditable]')&&document.activeElement===text&&slide===video.parentElement&&video===root.querySelector('video')
      shape.style.left='999px';sync(root,html(2),protect,true)
      return {stable,draft:text.textContent,position:video.currentTime,changes,left:shape.style.left}
    }),{stable:true,draft:'IME draft',position:.25,changes:0,left:'2px'})
  } finally {await browser.close()}
})

test('P02 criterion 2: digest URL/font reuse, changed bytes, retry, release and late font failures',async()=>{
  const {browser,page}=await harness()
  try {
    const result=await page.evaluate(async()=>{
      const {BrowserResourceCache}=(globalThis as any).P02
      let created=0,released=0,loads=0,deleted=0
      const pending:Array<()=>void>=[]
      URL.createObjectURL=()=>`blob:p02-${++created}`;URL.revokeObjectURL=()=>{released++}
      Object.defineProperty(document,'fonts',{value:{add(){},delete(){deleted++}}})
      ;(globalThis as any).FontFace=class {load(){loads++;return new Promise((_resolve,reject)=>pending.push(()=>reject(Error('decode'))))}}
      const cache=new BrowserResourceCache(),bytes=new Uint8Array([1,2,3]),metadata={a:{mimeType:'image/png'},alias:{mimeType:'image/png'}},spec={f:{family:'P02',weight:400}}
      const first=cache.sync({a:bytes,alias:bytes},metadata,{f:bytes},spec)
      const second=cache.sync({a:new Uint8Array(bytes),alias:bytes},metadata,{f:new Uint8Array(bytes)},spec)
      const warm={created,loads,same:first.a===second.a&&first.a===first.alias}
      pending.shift()!();await Promise.resolve();await Promise.resolve()
      cache.sync({a:bytes},metadata,{f:bytes},spec)
      const retried=loads===2
      const changed=cache.sync({a:new Uint8Array([4])},metadata)
      const different=changed.a!==first.a
      cache.dispose();pending.shift()!();await Promise.resolve();await Promise.resolve();cache.dispose()
      return {warm,retried,different,created,released,deleted}
    })
    assert.deepEqual(result,{warm:{created:2,loads:1,same:true},retried:true,different:true,created:3,released:3,deleted:2})
  } finally {await browser.close()}
})

test('P02 criteria 1/3: offline Portable Engine edit preserves neighbour and thumbnails; navigation, undo and print see all pages',async()=>{
  const fixture=await perf.makeFixture(12),directory=mkdtempSync(resolve(tmpdir(),'p02-live-')),browser=await chromium.launch({headless:true})
  try {
    const built=buildPortable(fixture.document,{...fixture,profile:'full-portable'});assert.equal(built.ok,true)
    const path=resolve(directory,'deck.html');writeFileSync(path,built.html!)
    const page=await browser.newPage();await page.goto(pathToFileURL(path).href);await page.waitForFunction(()=>Boolean((globalThis as any).PPTEPortable))
    const observed=await page.evaluate(()=>{
      const api=(globalThis as any).PPTEPortable,canvas=document.querySelector('[data-ppte-canvas]')!
      const neighbour=canvas.querySelector('[data-ppte-slide-id="perf_1"]'),thumbnail=document.querySelector('[data-ppte-thumbnails] button:nth-child(2)')!,preview=thumbnail.firstChild
      const before=api.getRevision(),edit=api.editText({slideId:'perf_0',elementId:'perf_0_text_01'},'P02 edit')
      const stable=neighbour===canvas.querySelector('[data-ppte-slide-id="perf_1"]')&&thumbnail.firstChild===preview
      const count=canvas.querySelectorAll('[data-ppte-slide-id]').length
      api.setSlide(6);const windowIds=Array.from(canvas.querySelectorAll<HTMLElement>('[data-ppte-slide-id]')).map(n=>n.dataset.ppteSlideId)
      const undo=api.undo();window.dispatchEvent(new Event('beforeprint'))
      const printed=Array.from(document.querySelectorAll<HTMLElement>('[data-ppte-print-document] [data-ppte-slide-id]')).map(n=>n.dataset.ppteSlideId)
      window.dispatchEvent(new Event('afterprint'))
      return {ok:edit.ok,stable,count,windowIds,exact:undo.ok&&api.getRevision()===before,printed,clean:!document.querySelector('[data-ppte-print-document]')}
    })
    assert.deepEqual(observed,{ok:true,stable:true,count:2,windowIds:['perf_5','perf_6','perf_7'],exact:true,printed:fixture.document.slideOrder,clean:true})
  } finally {await browser.close();rmSync(directory,{recursive:true,force:true})}
})

test('P02 criteria 1/3: Host keeps active surface singular, neighbours stable, thumbnails cached and print complete',async()=>{
  const fixture=await perf.makeFixture(12),browser=await chromium.launch({headless:true})
  try {
    const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {HostApp} from './packages/editor-react/src/HostApp.tsx';const f=globalThis.fixture;createRoot(document.getElementById('root')).render(React.createElement(HostApp,{initialDocument:f.document,initialFontBytes:Object.fromEntries(Object.entries(f.fontBytes).map(([id,b])=>[id,new Uint8Array(b)])),initialAssetBytes:Object.fromEntries(Object.entries(f.assetBytes).map(([id,b])=>[id,new Uint8Array(b)]))}));`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',define:{'process.env.NODE_ENV':'"production"'}})
    const page=await browser.newPage();await page.route('http://localhost/**',route=>route.fulfill({body:'<div id="root"></div>',contentType:'text/html'}));await page.goto('http://localhost/p02')
    await page.evaluate(f=>{(globalThis as any).fixture=f},{document:fixture.document,fontBytes:Object.fromEntries(Object.entries(fixture.fontBytes as Record<string,Uint8Array>).map(([id,b])=>[id,Array.from(b)])),assetBytes:Object.fromEntries(Object.entries(fixture.assetBytes as Record<string,Uint8Array>).map(([id,b])=>[id,Array.from(b)]))})
    await page.addScriptTag({content:bundle.outputFiles[0].text})
    await page.waitForFunction(()=>document.querySelector('[data-ppte-ready]')?.getAttribute('data-ppte-ready')==='true')
    await page.evaluate(()=>{const g=globalThis as any;g.p02Neighbour=document.querySelector('.ppte-neighbour-slides [data-ppte-slide-id]');g.p02Thumbnail=document.querySelector('.ppte-thumbnail:nth-child(2) .ppte-thumbnail-surface')?.firstChild})
    const editable=page.locator('.ppte-rendered-slide [data-ppte-element-id="perf_0_text_01"]');await editable.fill('Host P02 input');await editable.blur()
    await page.waitForFunction(()=>(globalThis as any).PPTEHost.getHistory().length>0)
    assert.deepEqual(await page.evaluate(()=>({singular:document.querySelectorAll('.ppte-rendered-slide [data-ppte-slide-id]').length,neighbour:(globalThis as any).p02Neighbour===document.querySelector('.ppte-neighbour-slides [data-ppte-slide-id]'),thumbnail:(globalThis as any).p02Thumbnail===document.querySelector('.ppte-thumbnail:nth-child(2) .ppte-thumbnail-surface')?.firstChild})),{singular:1,neighbour:true,thumbnail:true})
    await page.locator('.ppte-thumbnail[data-ppte-slide-index="6"]').click()
    await page.waitForFunction(()=>document.querySelector('.ppte-rendered-slide [data-ppte-slide-id]')?.getAttribute('data-ppte-slide-id')==='perf_6')
    assert.deepEqual(await page.locator('.ppte-neighbour-slides [data-ppte-slide-id]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-ppte-slide-id'))),['perf_5','perf_7'])
    await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')))
    assert.deepEqual(await page.locator('[data-ppte-print-document] [data-ppte-slide-id]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-ppte-slide-id'))),fixture.document.slideOrder)
    await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));assert.equal(await page.locator('[data-ppte-print-document]').count(),0)
  } finally {await browser.close()}
})
