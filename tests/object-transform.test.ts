import test from 'node:test'
import assert from 'node:assert/strict'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { EditorController } from '../packages/editor-controller/src/index.js'
import { TransformSession, planTransform, transformGeometry, type TransformCommand } from '../packages/editor-controller/src/transform-session.js'
import { TransformPointer, screenToDu } from '../packages/editor-dom/src/pointer.js'
import { PortableRuntime } from '../packages/portable-runtime/src/shared.js'
import { buildCheckpointBytes, openCheckpointBytes } from '../packages/file-format/src/index.js'
const date='2026-09-06T00:00:00Z',slideId='slide_main',ids=['text_title','text_body','image_hero']
let seq=0
function setup(){return new PpteSession(makeContractDocument().document,{runtimeProfile:'ga-c'})}
function plan(s:Pick<PpteSession,'getDocument'|'getRevision'>,command:TransformCommand,selection=ids){return planTransform(s.getDocument(),{revision:s.getRevision(),slideId,ids:selection,command,transactionId:`E05:${++seq}`,createdAt:date})}
function commit(s:PpteSession,command:TransformCommand,selection=ids){const tx=plan(s,command,selection);assert.ok(tx);const r=s.commit(JSON.parse(JSON.stringify(tx)));assert.equal(r.ok,true,JSON.stringify(r.issues));return tx}

test('E05 A11 100 pointer moves commit once, every cancellation and zero displacement commit nothing',()=>{
  for(const end of ['up','cancel','lostcapture','Escape','zero']){
    const s=setup(),before=s.getRevision(),c=new EditorController(s),gesture=new TransformSession(s.getDocument(),before,slideId,ids,{x:0,y:0})
    let previews=0,resets=0
    const pointer=new TransformPointer(gesture,7,e=>screenToDu(e,{left:0,top:0,width:1280,height:720},{width:1280,height:720}),()=>previews++,tx=>{assert.equal(c.commit(tx).ok,true)},()=>resets++)
    for(let i=1;i<=100;i++)pointer.move({pointerId:7,clientX:i,clientY:i/2})
    assert.equal(previews,100);assert.equal(s.getHistory().length,0)
    pointer.end({pointerId:8},'wrong');assert.equal(s.getHistory().length,0)
    if(end==='zero')pointer.move({pointerId:7,clientX:0,clientY:0})
    if(end==='up'||end==='zero')pointer.end({pointerId:7},`gesture:${end}`);else pointer.cancel()
    pointer.end({pointerId:7},'duplicate');assert.equal(s.getHistory().length,end==='up'?1:0)
    if(end!=='up')assert.equal(s.getRevision(),before)
    assert.ok(resets);c.dispose()
  }
})

test('E05 A11 screen conversion at 50/100/200 percent yields identical multi-selection move resize and rotation',()=>{
  for(const mode of ['move','resize','rotate'] as const){
    const results=[]
    for(const scale of [.5,1,2]){
      const s=setup(),rect={left:17,top:29,width:1280*scale,height:720*scale},canvas={width:1280,height:720}
      const convert=(x:number,y:number)=>screenToDu({clientX:17+x*scale,clientY:29+y*scale},rect,canvas)
      const gesture=new TransformSession(s.getDocument(),s.getRevision(),slideId,ids,convert(600,200),mode)
      gesture.update(convert(660,230));const tx=gesture.end(`scale:${scale}`)!;assert.equal(s.commit(tx).ok,true);results.push(s.getDocument())
    }
    assert.deepEqual(results[0],results[1]);assert.deepEqual(results[1],results[2])
  }
  assert.throws(()=>screenToDu({clientX:0,clientY:0},{left:0,top:0,width:0,height:1},{width:1,height:1}),/INVALID_VIEWPORT/)
})

test('E05 A11 resize keeps image aspect by default, explicit unlock and whole-box text styles stay intact',()=>{
  const s=setup(),before=s.getDocument(),image=before.slides[slideId].elements.image_hero
  commit(s,{kind:'resize',frame:{...image.frame,width:image.frame.width*2,height:image.frame.height*3}},['image_hero'])
  assert.equal(s.getDocument().slides[slideId].elements.image_hero.frame.height,image.frame.height*2)
  commit(s,{kind:'resize',frame:{...image.frame,width:300,height:100},preserveAspectRatio:false},['image_hero'])
  assert.equal(s.getDocument().slides[slideId].elements.image_hero.frame.height,100)
  commit(s,{kind:'resize',frame:{x:20,y:20,width:900,height:500}})
  for(const id of ['text_body','text_title'])assert.deepEqual((s.getDocument().slides[slideId].elements[id] as any).style,(before.slides[slideId].elements[id] as any).style)
})

test('E05 A11 locked member, narrowed group scope, invalid geometry and stale session are atomic',()=>{
  const s=setup();commit(s,{kind:'group',groupId:'flat'})
  const tx=plan(s,{kind:'move',dx:20,dy:10})!;tx.scope.elementIds=['text_body'];const before=s.getRevision();assert.equal(s.commit(tx).ok,false);assert.equal(s.getRevision(),before)
  assert.throws(()=>plan(s,{kind:'ungroup',groupId:'flat'},['text_body']),/GROUP_SCOPE_DENIED/)
  const locked=structuredClone(s.getDocument());locked.slides[slideId].elements.image_hero.locked=true
  assert.throws(()=>new TransformSession(locked,before,slideId,ids,{x:0,y:0}),/LOCKED/)
  for(const command of [{kind:'move',dx:NaN,dy:1},{kind:'resize',frame:{x:0,y:0,width:-1,height:10}},{kind:'rotate',degrees:Infinity}] as TransformCommand[])assert.throws(()=>plan(s,command),/INVALID_GEOMETRY/)
  const gesture=new TransformSession(s.getDocument(),s.getRevision(),slideId,ids,{x:0,y:0});gesture.update({x:10,y:10});commit(s,{kind:'move',dx:1,dy:0});assert.equal(s.commit(gesture.end('stale')!).ok,false)
})

test('E05 A11 snap affects only targets, uses pixel threshold, and align/distribute expose canvas or selection',()=>{
  const s=setup(),d=s.getDocument(),e=d.slides[slideId].elements.text_body
  for(const scale of [.5,1,2]){
    const g=transformGeometry(d,slideId,['text_body'],{kind:'move',dx:40-e.frame.x+3/scale,dy:0,snapThreshold:6/scale})
    assert.equal(g.text_body.frame.x,40)
    assert.deepEqual(Object.keys(g),['text_body'])
  }
  commit(s,{kind:'align',axis:'x',edge:'center',range:'canvas'})
  for(const id of ids){const f=s.getDocument().slides[slideId].elements[id].frame;assert.equal(f.x+f.width/2,d.canvas.width/2)}
  commit(s,{kind:'distribute',axis:'y',range:'canvas'})
  const frames=ids.map(id=>s.getDocument().slides[slideId].elements[id].frame).sort((a,b)=>a.y-b.y)
  assert.equal(frames[0].y,0);assert.equal(frames[2].y+frames[2].height,d.canvas.height)
  assert.ok(Math.abs((frames[1].y-frames[0].y-frames[0].height)-(frames[2].y-frames[1].y-frames[1].height))<1e-8)
})

test('E05 A11 same planner across Host/Portable handles geometry, layers, flat groups and persisted undo redo',()=>{
  const host=setup(),before=host.getDocument(),portable=new PortableRuntime(before,{profile:'full-portable'})
  const commands:TransformCommand[]=[{kind:'group',groupId:'flat'},{kind:'move',dx:12,dy:8},{kind:'resize',frame:{x:40,y:40,width:800,height:400}},{kind:'rotate',degrees:30},{kind:'align',axis:'y',edge:'start',range:'selection'},{kind:'distribute',axis:'x',range:'selection'},{kind:'layer',direction:'front'},{kind:'layer',direction:'back'},{kind:'layer',direction:'forward'},{kind:'layer',direction:'backward'},{kind:'ungroup',groupId:'flat'}]
  for(const command of commands){const tx=plan(host,command);if(!tx)continue;const r=host.commit(tx);assert.equal(r.ok,true,JSON.stringify(r.issues));const p=portable.controller.commit(tx);assert.equal(p.ok,true,JSON.stringify(p.issues));assert.deepEqual(portable.getDocument(),host.getDocument())}
  const after=host.getDocument(),count=host.getHistory().length
  const opened=openCheckpointBytes(buildCheckpointBytes(after,{recentTransactions:host.getHistory().map(e=>e.transaction),assetBytes:{asset_pixel:makeContractDocument().imageBytes}}))
  const reopened=new PpteSession(opened.document,{runtimeProfile:'ga-c'})
  for(let i=0;i<count;i++)assert.equal(reopened.undo().ok,true)
  assert.deepEqual(reopened.getDocument(),before)
  for(let i=0;i<count;i++)assert.equal(reopened.redo().ok,true)
  assert.deepEqual(reopened.getDocument(),after);portable.dispose()
})

test('E05 A11 rotated resize follows local axes and pins the opposite corner; zero rotation is a no-op',()=>{
  const s=setup();commit(s,{kind:'rotate',degrees:90},['image_hero'])
  const frame=s.getDocument().slides[slideId].elements.image_hero.frame
  const gesture=new TransformSession(s.getDocument(),s.getRevision(),slideId,['image_hero'],{x:100,y:100},'resize',false)
  const next=gesture.update({x:100,y:140}).image_hero.frame
  assert.ok(Math.abs(next.width-frame.width-40)<1e-8)
  assert.ok(Math.abs(next.height-frame.height)<1e-8)
  const anchor=(f:typeof frame)=>({x:f.x+f.width/2+f.height/2,y:f.y+f.height/2-f.width/2})
  assert.deepEqual(anchor(next),anchor(frame))
  const rotate=new TransformSession(s.getDocument(),s.getRevision(),slideId,['image_hero'],{x:100,y:100},'rotate')
  rotate.update({x:100,y:100});assert.equal(rotate.end('zero-rotate'),undefined)
})

test('E05 A11 actual Host and file Portable pointer and keyboard journeys preserve one history boundary',async()=>{
  const {mkdtempSync,writeFileSync,rmSync,mkdirSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{pathToFileURL}=await import('node:url'),{spawnSync}=await import('node:child_process'),{chromium}=await import('playwright')
  const {createPortableFullPortable}=await import('../packages/portable-runtime/src/index.js')
  const dir=mkdtempSync(join(tmpdir(),'e05-transform-'))
  const built=spawnSync('pnpm',['host:build','--outDir',join(dir,'host')],{encoding:'utf8'});assert.equal(built.status,0,built.stdout+built.stderr)
  const {document:doc,imageBytes}=makeContractDocument(),assets={asset_pixel:imageBytes}
  writeFileSync(join(dir,'deck.ppte'),buildCheckpointBytes(doc,{assetBytes:assets}))
  const portable=createPortableFullPortable(doc,{assetBytes:assets});assert.equal(portable.ok,true);writeFileSync(join(dir,'portable.html'),portable.html)
  const browser=await chromium.launch({headless:true});mkdirSync('artifacts/evolution/E05',{recursive:true})
  try {
    for(const host of [true,false]){
      const name=host?'PPTEHost':'PPTEPortable',page=await browser.newPage({viewport:{width:1600,height:1100}})
      await page.context().tracing.start({screenshots:true,snapshots:true})
      await page.goto(pathToFileURL(join(dir,host?'host/index.html':'portable.html')).href)
      if(host){await page.waitForFunction(()=>document.querySelector('[data-ppte-ready]')?.getAttribute('data-ppte-ready')==='true');await page.locator('[data-ppte-action="open"]').setInputFiles(join(dir,'deck.ppte'))}
      await page.waitForFunction(n=>Boolean((globalThis as any)[n]),name)
      const state=()=>page.evaluate(n=>{const a=(globalThis as any)[n];return {doc:a.getDocument(),depth:a.getHistory().length,revision:a.getRevision()}},name)
      const element=page.locator('[data-ppte-stage] [data-ppte-element-id="image_hero"]').first()
      await element.waitFor()
      const before=await state()
      for(const cancellation of ['pointercancel','lostpointercapture','Escape']){
        const box=(await element.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+30,box.y+box.height/2+20,{steps:10})
        if(cancellation==='Escape')await page.keyboard.press('Escape');else await element.dispatchEvent(cancellation,{pointerId:1,bubbles:true})
        await page.mouse.up();assert.deepEqual(await state(),before,`${name} ${cancellation}`)
      }
      for(const mode of ['move','resize','rotate']){
        const prior=await state(),box=(await element.boundingBox())!
        await page.mouse.move(box.x+box.width*.7,box.y+box.height*.6)
        if(mode!=='move')await page.keyboard.down('Control');if(mode==='rotate')await page.keyboard.down('Alt')
        await page.mouse.down();await page.mouse.move(box.x+box.width*.7+35,box.y+box.height*.6+22,{steps:100})
        assert.equal((await state()).depth,prior.depth)
        await page.mouse.up();await page.keyboard.up('Control');await page.keyboard.up('Alt')
        const after=await state();assert.equal(after.depth,prior.depth+1,`${name} ${mode}`);assert.notEqual(after.revision,prior.revision)
        await page.evaluate(n=>(globalThis as any)[n].undo(),name);assert.deepEqual((await state()).doc,prior.doc)
        await page.evaluate(n=>(globalThis as any)[n].redo(),name);assert.deepEqual((await state()).doc,after.doc)
      }
      const prior=await state();await page.locator('[data-ppte-stage]').evaluate(n=>{(n as HTMLElement).tabIndex=0;(n as HTMLElement).focus()});await page.keyboard.press('Shift+ArrowRight')
      const nudged=await state();assert.equal(nudged.depth,prior.depth+1);assert.equal(nudged.doc.slides.slide_main.elements.image_hero.frame.x,prior.doc.slides.slide_main.elements.image_hero.frame.x+10)
      const panel=page.locator('[data-ppte-object-properties]');await panel.getByLabel('对齐范围').selectOption('canvas');await panel.getByRole('button',{name:'对象水平居中',exact:true}).click()
      const aligned=(await state()).doc,e=aligned.slides.slide_main.elements.image_hero;assert.equal(e.frame.x+e.frame.width/2,aligned.canvas.width/2)
      await panel.getByRole('button',{name:'置于顶层',exact:true}).click();assert.equal((await state()).doc.slides.slide_main.rootOrder.at(-1),'image_hero')
      await page.screenshot({path:`artifacts/evolution/E05/${name}.png`,fullPage:true});await page.context().tracing.stop({path:`artifacts/evolution/E05/${name}.zip`});await page.close()
    }
  }finally{await browser.close();rmSync(dir,{recursive:true,force:true})}
})

test('E05 A11 layer steps preserve selected relative order and never reorder reading order',()=>{
  for(const direction of ['front','back','forward','backward'] as const){
    const s=setup(),before=s.getDocument().slides[slideId],order=before.rootOrder
    const selected=[order[1],order[2]],rest=order.filter(id=>!selected.includes(id))
    commit(s,{kind:'layer',direction},selected)
    const after=s.getDocument().slides[slideId]
    const expected=direction==='front'?[...rest,...selected]:direction==='back'?[...selected,...rest]:direction==='forward'?[order[0],order[3],...selected,...order.slice(4)]:[...selected,order[0],...order.slice(3)]
    assert.deepEqual(after.rootOrder,expected)
    assert.deepEqual(after.readingOrder,before.readingOrder)
    assert.deepEqual(after.elements,before.elements)
    assert.equal(s.undo().ok,true);assert.deepEqual(s.getDocument().slides[slideId],before)
  }
})
