import test from 'node:test'
import assert from 'node:assert/strict'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { PortableRuntime } from '../packages/portable-runtime/src/shared.js'
import { createBasicObject, mixedValue, objectPropertyValues, planObjectProperty, type ObjectPropertyCommand } from '../packages/editor-controller/src/object-commands.js'
import { renderSlideSvg } from '../packages/renderer-react/src/index.js'
import type { PpteDocument, Transaction } from '../packages/schema/src/index.js'

function setup() { const {document}=makeContractDocument(); return new PpteSession(document,{runtimeProfile:'ga-c'}) }
let sequence=0
function plan(session: Pick<PpteSession,'getDocument'|'getRevision'>, command:ObjectPropertyCommand, ids=['text_body']):Transaction {
  return planObjectProperty(session.getDocument(),{revision:session.getRevision(),slideId:'slide_main',ids,command,transactionId:`e04:${++sequence}`,createdAt:'2026-09-06T00:00:00Z'})
}
function commit(session:PpteSession, command:ObjectPropertyCommand, ids?:string[]) {
  const tx=plan(session,command,ids);const result=session.commit(JSON.parse(JSON.stringify(tx)));assert.equal(result.ok,true,JSON.stringify(result.issues));return tx
}

test('E04 A08 whole-box font and paragraph changes preserve runs and unrelated paragraph fields',()=>{
  const session=setup(), before=session.getDocument(), content=before.slides.slide_main.elements.text_body
  commit(session,{kind:'paragraph',patch:{paragraphSpacing:12,lineHeight:1.5}})
  commit(session,{kind:'paragraph',patch:{align:'center'}})
  commit(session,{kind:'text-style',patch:{fontSize:32,color:{kind:'value',value:'#ff0000'}}})
  const text=session.getDocument().slides.slide_main.elements.text_body
  assert.equal(text.type,'text');if(text.type!=='text'||content.type!=='text')throw Error('fixture')
  assert.deepEqual(text.content,content.content)
  assert.deepEqual(text.paragraphStyle,{paragraphSpacing:12,lineHeight:1.5,align:'center'})
  assert.equal(text.style.overrides?.fontSize,32)
  for(let i=0;i<3;i++)assert.equal(session.undo().ok,true)
  assert.deepEqual(session.getDocument(),before)
  for(let i=0;i<3;i++)assert.equal(session.redo().ok,true)
  assert.deepEqual(session.getDocument().slides.slide_main.elements.text_body,text)
})

test('E04 A11 mixed values use effective presets and one atomic multi-object transaction',()=>{
  const session=setup()
  assert.equal(objectPropertyValues(session.getDocument(),'slide_main',['text_body','text_title'],'fontSize').state,'mixed')
  assert.deepEqual(mixedValue([]),{state:'empty'})
  commit(session,{kind:'text-style',patch:{fontSize:36}},['text_body','text_title'])
  assert.deepEqual(objectPropertyValues(session.getDocument(),'slide_main',['text_body','text_title'],'fontSize'),{state:'value',value:36})
  assert.equal(session.getHistory().length,1)
  assert.equal(session.undo().ok,true)
  assert.equal(objectPropertyValues(session.getDocument(),'slide_main',['text_body','text_title'],'fontSize').state,'mixed')
})

test('E04 A11 locked member, narrowed scope and unsupported selection reject the whole edit',()=>{
  for(const locked of [true,false]){
    const document=structuredClone(setup().getDocument())
    if(locked)document.slides.slide_main.elements.text_title.locked=true
    const session=new PpteSession(document,{runtimeProfile:'ga-c'})
    const tx=plan(session,{kind:'text-style',patch:{fontSize:36}},['text_body','text_title'])
    if(!locked)tx.scope.elementIds=['text_body']
    const before=session.getRevision()
    assert.equal(session.commit(tx).ok,false)
    assert.equal(session.getRevision(),before);assert.equal(session.getHistory().length,0)
  }
  const session=setup()
  assert.throws(()=>plan(session,{kind:'text-style',patch:{fontSize:36}},['text_body','image_hero']),/TYPE_MISMATCH/)
  const denied=plan(session,{kind:'text-style',patch:{fontSize:36}});denied.scope.permissions=[]
  assert.equal(session.commit(denied).ok,false)
  assert.equal(session.getHistory().length,0)
})

test('E04 A12 background inheritance differs from none and restores exact state through serialized history',()=>{
  const session=setup(),before=session.getDocument()
  for(const paint of [{kind:'none'} as const,{kind:'solid',color:{kind:'token',token:'color.accent'}} as const,{kind:'linear-gradient',angleDeg:45,stops:[{offset:0,color:{kind:'value',value:'#ff0000'}},{offset:1,color:{kind:'value',value:'#0000ff'}}]} as const]){
    commit(session,{kind:'background',paint:structuredClone(paint) as import('../packages/schema/src/index.js').Paint},[])
    assert.deepEqual(session.getDocument().theme,before.theme)
    commit(session,{kind:'background',paint:'inherit'},[])
    assert.equal(Object.hasOwn(session.getDocument().slides.slide_main,'background'),false)
    const reopened=new PpteSession(JSON.parse(JSON.stringify(session.getDocument())),{runtimeProfile:'ga-c',recentTransactions:JSON.parse(JSON.stringify(session.getHistory().map(e=>e.transaction)))})
    assert.equal(reopened.undo().ok,true)
    assert.deepEqual(reopened.getDocument().slides.slide_main.background,paint)
    assert.equal(reopened.redo().ok,true)
    assert.deepEqual(reopened.getDocument(),before)
  }
})

test('E04 existing shape operations render fill and stroke and reject undeclared properties',()=>{
  const session=setup()
  commit(session,{kind:'shape-style',patch:{fill:{kind:'solid',color:{kind:'value',value:'#ff0000'}},stroke:{color:{kind:'value',value:'#00ff00'},width:5}}},['shape_surface'])
  const svg=renderSlideSvg(session.getDocument(),'slide_main')
  assert.match(svg,/#ff0000/);assert.match(svg,/#00ff00/)
  const tx=plan(session,{kind:'shape-style',patch:{radius:12}},['shape_surface'])
  ;(tx.operations[0] as any).patch.arbitraryWidgetCode='alert(1)'
  const before=session.getRevision();assert.equal(session.commit(tx).ok,false);assert.equal(session.getRevision(),before)
})

test('E04 typed insertion chooses supported shape types and preserves reading order through undo',()=>{
  for(const kind of ['text','rectangle','rounded-rectangle','ellipse','line','arrow','triangle','diamond','chevron'] as const){
    const session=setup(),before=session.getDocument()
    const element=createBasicObject(before,'inserted',kind)
    commit(session,{kind:'insert',element},[])
    assert.deepEqual(session.getDocument().slides.slide_main.elements.inserted,element)
    assert.equal(session.undo().ok,true);assert.deepEqual(session.getDocument(),before)
  }
})

test('E04 Host planner and Portable Core produce identical edits and policy refusals',()=>{
  const host=setup(),portable=new PortableRuntime(host.getDocument(),{profile:'full-portable'})
  for(const command of [{kind:'text-style',patch:{fontSize:30}},{kind:'background',paint:'inherit'}] as ObjectPropertyCommand[]){
    const tx=plan(host,command)
    assert.equal(host.commit(tx).ok,true);assert.equal(portable.commit(tx).ok,true)
    assert.deepEqual(portable.getDocument(),host.getDocument())
  }
  const readonly=new PortableRuntime(host.getDocument(),{profile:'viewer'})
  assert.equal(readonly.commit(plan(host,{kind:'text-style',patch:{fontSize:20}})).ok,false)
  portable.dispose();readonly.dispose()
})

test('E04 shape kind has typed validation, exact inverse, export and checkpoint support including redo-only compatibility',async()=>{
  const {inferCompatibilityProfile,EDIT_PROFILE}=await import('../packages/compatibility/src/index.js')
  const {buildCheckpointBytes,openCheckpointBytes}=await import('../packages/file-format/src/index.js')
  const {compileSemanticPptx,exportSemanticPptx}=await import('../packages/exporter-pptx/src/index.js')
  const {exportPdf}=await import('../packages/exporter-pdf/src/index.js')
  const {imageBytes}=makeContractDocument(),session=setup(),before=session.getDocument()
  commit(session,{kind:'shape-kind',shape:'ellipse'},['shape_surface'])
  const after=session.getDocument()
  assert.deepEqual(after.slides.slide_main.elements.shape_surface,{...before.slides.slide_main.elements.shape_surface,shape:'ellipse'})
  assert.match(renderSlideSvg(after,'slide_main'),/<ellipse/)
  const compiled=compileSemanticPptx(after)
  assert.equal(compiled.ok,true)
  assert.equal(compiled.slides[0].nodes.find(n=>n.sourceElementId==='shape_surface')?.shape,'ellipse')
  assert.equal(exportSemanticPptx(after,{assetBytes:{asset_pixel:imageBytes}}).ok,true)
  assert.equal(exportPdf(after,{assetBytes:{asset_pixel:imageBytes}}).ok,true)
  const persisted={recentTransactions:session.getHistory().map(e=>e.transaction),redoHistory:[...session.getRedoHistory()]}
  assert.equal(inferCompatibilityProfile(after,persisted),EDIT_PROFILE.id)
  const opened=openCheckpointBytes(buildCheckpointBytes(after,{...persisted,assetBytes:{asset_pixel:imageBytes}}))
  const reopened=new PpteSession(opened.document,{runtimeProfile:'ga-c'})
  assert.equal(reopened.undo().ok,true);assert.deepEqual(reopened.getDocument(),before)
  assert.equal(inferCompatibilityProfile(reopened.getDocument(),{redoHistory:[...reopened.getRedoHistory()]}),EDIT_PROFILE.id)
  assert.equal(reopened.redo().ok,true);assert.deepEqual(reopened.getDocument(),after)
  const invalid=plan(session,{kind:'shape-kind',shape:'rectangle'},['shape_surface'])
  ;(invalid.operations[0] as any).shape='executable-widget'
  assert.equal(session.commit(invalid).ok,false)
})

test('E04 clearing background requires permission and stays within the exact background path',()=>{
  const session=setup();commit(session,{kind:'background',paint:{kind:'none'}})
  const tx=plan(session,{kind:'background',paint:'inherit'})
  tx.scope.permissions=[]
  assert.equal(session.commit(tx).ok,false)
  tx.scope.permissions=['structure'];tx.changeContract.allowedPaths=['/slides/slide_main/notes']
  assert.equal(session.commit(tx).ok,false)
  assert.deepEqual(session.getDocument().slides.slide_main.background,{kind:'none'})
})

test('E04 stroke color changes preserve each selected shape width and other stroke settings',()=>{
  const session=setup()
  commit(session,{kind:'shape-style',patch:{stroke:{color:{kind:'value',value:'#ff0000'},width:7,dash:[2,3]}}},['shape_surface'])
  commit(session,{kind:'shape-stroke',patch:{color:{kind:'value',value:'#00ff00'}}},['shape_surface'])
  const shape=session.getDocument().slides.slide_main.elements.shape_surface
  if(shape.type!=='shape')throw Error('fixture')
  assert.deepEqual(shape.style.overrides?.stroke,{color:{kind:'value',value:'#00ff00'},width:7,dash:[2,3]})
})

test('E04 both browser panels route shape, background and keyboard insertion through Core',async()=>{
  const {mkdtempSync,writeFileSync,rmSync,mkdirSync}=await import('node:fs')
  const {tmpdir}=await import('node:os')
  const {join}=await import('node:path')
  const {pathToFileURL}=await import('node:url')
  const {spawnSync}=await import('node:child_process')
  const {chromium}=await import('playwright')
  const {createPortableFullPortable}=await import('../packages/portable-runtime/src/index.js')
  const {openCheckpoint}=await import('../packages/file-format/src/index.js')
  const dir=mkdtempSync(join(tmpdir(),'e04-panels-'))
  const built=spawnSync('pnpm',['host:build','--outDir',join(dir,'host')],{encoding:'utf8'})
  assert.equal(built.status,0,built.stderr||built.stdout)
  const {document,imageBytes}=makeContractDocument()
  const portable=createPortableFullPortable(document,{assetBytes:{asset_pixel:imageBytes}})
  assert.equal(portable.ok,true);writeFileSync(join(dir,'portable.html'),portable.html)
  const browser=await chromium.launch({headless:true})
  mkdirSync('artifacts/evolution/E04',{recursive:true})
  try{
    for(const target of ['host','portable']){
      const page=await browser.newPage({viewport:{width:1600,height:1100},acceptDownloads:true})
      await page.context().tracing.start({screenshots:true,snapshots:true})
      await page.goto(pathToFileURL(join(dir,target==='host'?'host/index.html':'portable.html')).href)
      const panel=page.locator('[data-ppte-object-properties]')
      await panel.getByRole('button',{name:'插入对象',exact:true}).waitFor()
      await panel.getByLabel('插入对象类型').selectOption('rectangle')
      await panel.getByRole('button',{name:'插入对象',exact:true}).click()
      const shapes=page.locator('[data-ppte-stage] [data-ppte-type="shape"]')
      const inserted=shapes.last();const id=await inserted.getAttribute('data-ppte-element-id');assert.ok(id)
      await inserted.click({position:{x:8,y:8},force:true})
      await panel.getByLabel('形状类型',{exact:true}).selectOption('ellipse')
      await panel.getByLabel('描边宽度',{exact:true}).fill('6')
      await panel.getByLabel('描边宽度',{exact:true}).dispatchEvent('change')
      await panel.getByRole('button',{name:'透明背景',exact:true}).click()
      await panel.getByRole('button',{name:'恢复背景继承',exact:true}).click()
      await panel.focus();await panel.press('Alt+Shift+T')
      let result:PpteDocument
      if(target==='host'){
        const [download]=await Promise.all([page.waitForEvent('download'),page.locator('[data-ppte-action="save"]').click()])
        result=openCheckpoint((await download.path())!).document
      }else result=await page.evaluate(()=>(globalThis as any).PPTEPortable.getDocument())
      const slide=result.slides[result.slideOrder[0]],shape=slide.elements[id!]
      assert.equal(shape.type,'shape');if(shape.type!=='shape')throw Error('shape missing')
      assert.equal(shape.shape,'ellipse');assert.equal(shape.style.overrides?.stroke?.width,6)
      assert.equal(Object.hasOwn(slide,'background'),false)
      assert.ok(Object.values(slide.elements).some(e=>e.type==='text'&&e.id.startsWith('object_')))
      await page.screenshot({path:`artifacts/evolution/E04/${target}-properties.png`,fullPage:true})
      await page.context().tracing.stop({path:`artifacts/evolution/E04/${target}-properties.zip`})
      await page.close()
    }
  }finally{await browser.close();rmSync(dir,{recursive:true,force:true})}
})
