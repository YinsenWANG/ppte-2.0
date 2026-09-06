import { resizeViewport } from './helpers/browser-viewport.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {chromium} from 'playwright'
import {buildSync} from 'esbuild'
import {createEmptyDocument} from '../packages/authoring/src/default-document.js'
import {PpteSession} from '../packages/core/src/index.js'
import {PortableRuntime,buildPortable} from '../packages/portable-runtime/src/index.js'
import {buildCheckpointBytes,openCheckpointBytes} from '../packages/file-format/src/index.js'
import {migrateTableV1,tableProps} from '../packages/widgets/src/table-model.js'
import {renderWidgetHtml,renderWidgetSvg} from '../packages/widgets/src/index.js'
import {cellAt,selectedCells,navigateTable,parseTablePaste,tableEditingOperations,type TableCommand} from '../packages/editor-dom/src/table-selection.js'
import type {ComponentElement,TableModel,Transaction,Operation} from '../packages/schema/src/index.js'
import {findFactReferences,findSourceReferences} from '../packages/facts/src/index.js'
import {commandPolicy} from '../packages/editor-controller/src/policy.js'

function fixture(){
  const document=createEmptyDocument(),slideId=document.slideOrder[0]
  const element:ComponentElement={id:'table',type:'component',componentType:'core/table',componentVersion:'1.0.0',frame:{x:60,y:280,width:700,height:180},props:{columns:['名称','数值'],rows:[['第一格','12345678901234567890'],['保留',42]]},fallback:{kind:'placeholder',label:'Table'}}
  element.props=tableProps(migrateTableV1(element).model);element.componentVersion='2.0.0'
  for(const id of document.slides[slideId].rootOrder.filter(id=>id!=='text_title')){delete document.slides[slideId].elements[id]}
  document.slides[slideId].rootOrder=['text_title'];document.slides[slideId].readingOrder=['text_title','table']
  document.slides[slideId].elements.table=element;document.slides[slideId].rootOrder.push('table')
  return {document,slideId,element}
}
const model=(e:ComponentElement)=>e.props as unknown as TableModel
function tx(session:PpteSession,ops:Operation[]):Transaction{return {transactionId:`t:${session.getRevision()}:${session.getHistory().length}`,baseRevision:session.getRevision(),createdAt:'2026-09-06T00:00:00Z',actor:{type:'human'},scope:{kind:'document',permissions:['content','style']},changeContract:{},operations:ops}}

test('F02 A13 TSV preserves spaces, blanks, CRLF, Chinese and long numbers; rejects ragged, overflow and merged boundaries atomically',()=>{
  assert.deepEqual(parseTablePaste(' a b \t\r\n中文\t12345678901234567890\r\n'),[[' a b ',''],['中文','12345678901234567890']])
  assert.deepEqual(parseTablePaste(''),[['']]);assert.throws(()=>parseTablePaste('a\tb\nc'),/NON_RECTANGULAR/)
  const {document,slideId,element}=fixture(),session=new PpteSession(document),selection={anchor:'table:cell:0:0',focus:'table:cell:0:0'},before=session.getRevision()
  const plan=(command:TableCommand)=>tableEditingOperations(session.getDocument().slides[slideId].elements.table as ComponentElement,slideId,selection,command,'p',true)
  for(const text of ['a\tb\tc','a\tb\nc']){assert.throws(()=>plan({kind:'paste',text}));assert.equal(session.getRevision(),before);assert.equal(session.getHistory().length,0)}
  assert.equal(session.commit(tx(session,plan({kind:'paste',text:' a b \t\n中文\t12345678901234567890'}))).ok,true)
  assert.equal(session.getHistory().length,1);assert.equal(session.undo().ok,true);assert.equal(session.getRevision(),before);assert.equal(session.redo().ok,true)
  const merge=tableEditingOperations(element,slideId,{anchor:'table:cell:0:0',focus:'table:cell:1:1'},{kind:'merge'},'merge',true)
  assert.equal(session.commit(tx(session,merge)).ok,true)
  assert.throws(()=>plan({kind:'paste',text:'x\ty'}),/MERGE_BOUNDARY/)
  assert.equal(session.commit(tx(session,plan({kind:'paste',text:'anchor'}))).ok,true)
  assert.equal(model(session.getDocument().slides[slideId].elements.table as ComponentElement).cells['table:cell:1:1'].value,'12345678901234567890')
})

test('F02 A13 rectangle selection and keyboard navigation skip covered cells and clamp edges',()=>{
  const {element}=fixture(),m=model(element)
  assert.deepEqual(selectedCells(m,{anchor:'table:cell:1:1',focus:'table:cell:0:0'}),['table:cell:0:0','table:cell:0:1','table:cell:1:0','table:cell:1:1'])
  assert.equal(navigateTable(m,'table:cell:0:0','ArrowLeft'),'table:cell:0:0')
  assert.equal(navigateTable(m,'table:cell:0:1','Tab'),'table:cell:1:0')
  assert.equal(navigateTable(m,'table:cell:1:0','Tab',true),'table:cell:0:1')
  m.merges.push({anchorCellId:'table:cell:0:0',rowIds:[m.rowOrder[0]],columnIds:m.columnOrder})
  assert.equal(navigateTable(m,'table:cell:0:0','Tab'),'table:cell:1:0')
  assert.equal(navigateTable(m,'table:cell:1:1','ArrowUp'),'table:cell:0:0')
})

test('F02 A13 structure retains untouched cell identities and fact/source references; referenced deletion rejected; empty table can grow',()=>{
  const {document,element,slideId}=fixture(),m=model(element)
  document.facts={fact:{id:'fact',key:'retained',value:42}};document.sources={source:{id:'source',title:'Origin'}}
  m.cells['table:cell:1:1'].factIds=['fact'];m.cells['table:cell:1:1'].sourceIds=['source']
  const original=structuredClone(m.cells['table:cell:1:1'])
  // Planner validates every resulting model before any transaction can be published.
  const selection={anchor:'table:cell:0:0',focus:'table:cell:0:0'}
  for(const command of [{kind:'insert',axis:'row'},{kind:'insert',axis:'column'},{kind:'move',axis:'row',index:1},{kind:'move',axis:'column',index:1},{kind:'resize',axis:'row',size:60},{kind:'delete',axis:'row'}] as TableCommand[]){
    const ops=tableEditingOperations(element,slideId,selection,command,`structure:${command.kind}:${'axis' in command?command.axis:''}`,true)
    const session=new PpteSession(document),before=session.getRevision();assert.equal(session.commit(tx(session,ops)).ok,true)
    assert.deepEqual(model(session.getDocument().slides[slideId].elements.table as ComponentElement).cells[original.id],original)
    assert.equal(findFactReferences(session.getDocument(),'fact')[0].cellId,original.id);assert.equal(findSourceReferences(session.getDocument(),'source')[0].cellId,original.id)
    assert.equal(session.undo().ok,true);assert.equal(session.getRevision(),before);assert.equal(session.redo().ok,true)
  }
  assert.throws(()=>tableEditingOperations(element,slideId,{anchor:original.id,focus:original.id},{kind:'delete',axis:'row'},'delete',true),/REFERENCE_REVIEW_REQUIRED.*table:cell:1:1/)
  const empty:ComponentElement={...element,componentVersion:'1.0.0',props:{rows:[],columns:[]}}
  empty.props=tableProps(migrateTableV1(empty).model);empty.componentVersion='2.0.0'
  assert.equal(tableEditingOperations(empty,slideId,undefined,{kind:'insert',axis:'column'},'empty',true).length,1)
})

test('F02 A13 Portable profile permissions, locks, presentation guard, style rendering and checkpoint undo',()=>{
  const {document,element,slideId}=fixture(),selection={anchor:'table:cell:0:0',focus:'table:cell:0:0'}
  for(const profile of ['viewer','quick-fix','light-edit','full-portable'] as const){
    const runtime=new PortableRuntime(document,{profile}),before=runtime.getRevision()
    const ops=tableEditingOperations(element,slideId,selection,{kind:'style',fill:'#ffeeaa'},'style',false)
    assert.equal(runtime.editTable(ops).ok,profile!=='viewer')
    const generic:Operation={kind:'component.updateProps',opId:'generic',slideId,elementId:'table',patch:element.props,replace:true}
    if(profile==='full-portable')assert.equal(runtime.commit(tx(new PpteSession(document),[generic])).ok,false)
    const structural=tableEditingOperations(element,slideId,selection,{kind:'insert',axis:'row'},'row',true)
    assert.equal(runtime.editTable(structural).ok,false)
    assert.ok(commandPolicy(profile,true,tx(new PpteSession(document),structural)).length)
    if(profile!=='viewer'){
      assert.match(renderWidgetHtml(runtime.getDocument().slides[slideId].elements.table as ComponentElement),/background-color:#ffeeaa/)
      assert.match(renderWidgetSvg(runtime.getDocument().slides[slideId].elements.table as ComponentElement,700,180),/fill="#ffeeaa"/)
      const saved=runtime.saveAsProject();assert.equal(saved.ok,true,JSON.stringify(saved.issues))
      const opened=openCheckpointBytes(saved.bytes!);assert.ok(opened.document)
      const again=new PortableRuntime(opened.document!,{profile,recentTransactions:opened.recentTransactions})
      assert.equal(again.undo().ok,true);assert.equal(again.getRevision(),before);assert.equal(again.redo().ok,true)
      runtime.presentation.enter(()=>({ok:true}));assert.equal(runtime.editTable(ops).ok,false)
    }
    runtime.dispose()
  }
  const locked=structuredClone(document);locked.slides[slideId].elements.table.locked=true
  const runtime=new PortableRuntime(locked,{profile:'full-portable'})
  assert.equal(runtime.editTable(tableEditingOperations(element,slideId,selection,{kind:'value',value:'denied'},'locked',false)).ok,false);assert.equal(runtime.getHistory().length,0)
})

test('F02 A21 table rerenders retain keyboard focus, draft selection and navigation without stealing outside focus',async()=>{
  const script=buildSync({entryPoints:['packages/editor-dom/src/table-selection.ts'],bundle:true,format:'iife',globalName:'TableEditor',write:false}).outputFiles[0].text
  const browser=await chromium.launch({headless:true})
  try{
    const page=await browser.newPage()
    await page.setContent('<button id="outside">Outside</button><div id="table"></div>')
    await page.addScriptTag({content:script})
    const {element,slideId}=fixture()
    const result=await page.evaluate(serialized=>{
      const {element,slideId}=JSON.parse(serialized)
      const root=document.getElementById('table')!,editor=(window as any).TableEditor
      const render=()=>editor.renderTableEditor(root,element,slideId,true,()=>true)
      render()
      const cell=()=>root.querySelector<HTMLButtonElement>('[data-table-cell="table:cell:0:0"]')!
      const old=cell();old.focus();render()
      const cellRetained=document.activeElement===cell()&&cell()!==old
      let historyTarget=false
      root.addEventListener('keydown',event=>{if(event.ctrlKey&&event.key==='z')historyTarget=(event.target as HTMLElement).dataset.tableCell==='table:cell:0:0'})
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))
      const navigated=(document.activeElement as HTMLElement).dataset.tableCell==='table:cell:0:1'
      const value=()=>root.querySelector<HTMLTextAreaElement>('[aria-label="单元格值"]')!
      value().focus();value().value='unfinished draft';value().dispatchEvent(new Event('input'));value().setSelectionRange(2,7);render()
      const draft={focused:document.activeElement===value(),value:value().value,start:value().selectionStart,end:value().selectionEnd}
      document.getElementById('outside')!.focus();render()
      return {cellRetained,historyTarget,navigated,draft,outside:document.activeElement?.id}
    },JSON.stringify({element,slideId}))
    assert.deepEqual(result,{cellRetained:true,historyTarget:true,navigated:true,draft:{focused:true,value:'unfinished draft',start:2,end:7},outside:'outside'})
  }finally{await browser.close()}
})

test('F02 A13/A21 real Host and file Portable table selection, paste, styles, structure, save/reopen/undo journey',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ppte-f02-')),evidence=resolve('artifacts/f02');mkdirSync(evidence,{recursive:true})
  const built=spawnSync('pnpm',['host:build','--outDir',join(dir,'host')],{encoding:'utf8'});assert.equal(built.status,0,built.stdout+built.stderr)
  const {document,slideId}=fixture(),project=buildCheckpointBytes(document);assert.ok(project.length)
  const source=join(dir,'table.ppte');writeFileSync(source,project)
  const portable=buildPortable(document,{profile:'quick-fix'});assert.equal(portable.ok,true,JSON.stringify(portable.issues));const html=join(dir,'table.html');writeFileSync(html,portable.html)
  const browser=await chromium.launch({headless:true})
  try{for(const host of [true,false]){
    const context=await browser.newContext({viewport:{width:1600,height:1100},acceptDownloads:true});await context.tracing.start({screenshots:true,snapshots:true})
    const page=await context.newPage(),api=host?'window.PPTEHost':'window.PPTEPortable'
    await page.goto(pathToFileURL(host?join(dir,'host/index.html'):html).href)
    await page.waitForFunction(code=>Boolean((window as any)[code]),host?'PPTEHost':'PPTEPortable')
    if(host)await page.locator('[data-ppte-action=open]').setInputFiles(source)
    await page.locator('[data-ppte-stage] [data-ppte-element-id=table]').click()
    const panel=page.locator('[data-ppte-table-editor]'),cell=(r:number,c:number)=>panel.getByRole('button',{name:`单元格 ${r},${c}`,exact:true})
    await page.locator('[data-ppte-stage] td[data-cell-id="table:cell:0:1"]').click();assert.equal(await panel.getByLabel('单元格值',{exact:true}).inputValue(),'12345678901234567890')
    await cell(1,1).click();await page.keyboard.press('ArrowRight');assert.equal(await cell(1,2).evaluate(n=>n===n.ownerDocument.activeElement),true)
    await page.keyboard.press('Shift+ArrowDown');assert.equal(await panel.locator('[aria-selected=true]').count(),2)
    await cell(1,1).click();await panel.getByLabel('粘贴 TSV').fill(' a b \t\n中文\t12345678901234567890');await panel.getByRole('button',{name:'应用 TSV',exact:true}).click()
    const history=await page.evaluate(`${api}.getHistory().length`);assert.equal(history,1)
    await panel.getByLabel('单元格填充色').fill('#ffeeaa')
    const getModel=():Promise<TableModel>=>page.evaluate(`(${api}.getDocument().slides[${JSON.stringify(slideId)}].elements.table.props)`)
    assert.equal((await getModel()).cells['table:cell:0:0'].style?.fill,'#ffeeaa')
    assert.equal(await page.locator('[data-ppte-stage] td[data-cell-id="table:cell:0:0"]').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(255, 238, 170)')
    await cell(1,1).focus();await page.keyboard.press('ControlOrMeta+z');assert.equal((await getModel()).cells['table:cell:0:0'].style,undefined);await page.evaluate(`${api}.redo()`)
    await cell(1,1).evaluate(n=>{const clipboardData=new DataTransfer();clipboardData.setData('text/plain','clipboard spaces ');n.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData}))})
    assert.equal((await getModel()).cells['table:cell:0:0'].value,'clipboard spaces ')
    await panel.getByLabel('单元格类型').selectOption('boolean');await panel.getByLabel('单元格值',{exact:true}).fill('true');await panel.getByRole('button',{name:'应用单元格值',exact:true}).click();assert.equal((await getModel()).cells['table:cell:0:0'].value,true)
    const before=await page.evaluate(`${api}.getRevision()`)
    await panel.getByLabel('粘贴 TSV').fill('a\tb\nc');await panel.getByRole('button',{name:'应用 TSV',exact:true}).click();assert.match(await panel.getByRole('status').innerText(),/NON_RECTANGULAR/);assert.equal(await page.evaluate(`${api}.getRevision()`),before)
    if(host){
      const untouched=(await getModel()).cells['table:cell:1:1']
      await panel.getByRole('button',{name:'插入行',exact:true}).click();assert.equal((await getModel()).rowOrder.length,3);assert.deepEqual((await getModel()).cells[untouched.id],untouched)
      await cell(2,1).click();await panel.getByLabel('行尺寸',{exact:true}).fill('64');await panel.getByRole('button',{name:'调整行尺寸',exact:true}).click();assert.equal((await getModel()).rows[(await getModel()).rowOrder[1]].size,64)
      await panel.getByLabel('行目标位置（从 0 起）').fill('2');await panel.getByRole('button',{name:'移动行',exact:true}).click();assert.equal((await getModel()).rows[(await getModel()).rowOrder[2]].size,64)
      await panel.getByRole('button',{name:'删除行',exact:true}).click();assert.equal((await getModel()).rowOrder.length,2)
      await cell(1,1).click();await panel.getByRole('button',{name:'插入列',exact:true}).click();assert.equal((await getModel()).columnOrder.length,3)
      await cell(1,2).click();await panel.getByLabel('列尺寸',{exact:true}).fill('240');await panel.getByRole('button',{name:'调整列尺寸',exact:true}).click();assert.equal((await getModel()).columns[(await getModel()).columnOrder[1]].size,240)
      await panel.getByLabel('列目标位置（从 0 起）').fill('2');await panel.getByRole('button',{name:'移动列',exact:true}).click();assert.equal((await getModel()).columns[(await getModel()).columnOrder[2]].size,240)
      await panel.getByRole('button',{name:'删除列',exact:true}).click();assert.equal((await getModel()).columnOrder.length,2);assert.deepEqual((await getModel()).cells[untouched.id],untouched)
      await cell(1,1).click();await cell(1,2).click({modifiers:['Shift']});await panel.getByRole('button',{name:'合并单元格',exact:true}).click();assert.equal((await getModel()).merges.length,1)
      await panel.getByRole('button',{name:'拆分单元格',exact:true}).click();assert.equal((await getModel()).merges.length,0)
    }else{assert.equal(await panel.getByRole('button',{name:'插入行',exact:true}).count(),0);assert.match(await panel.innerText(),/结构|行列/)}
    const revision=await page.evaluate(`${api}.getRevision()`)
    await page.screenshot({path:join(evidence,`${host?'host':'portable'}.png`)})
    if(!host){await resizeViewport(page,{width:700,height:1100});await panel.getByLabel('单元格值',{exact:true}).focus();assert.equal(await panel.getByLabel('单元格值',{exact:true}).evaluate(n=>n===n.ownerDocument.activeElement),true);await page.screenshot({path:join(evidence,'portable-narrow.png')});await resizeViewport(page,{width:1600,height:1100})}
    const download=page.waitForEvent('download');await page.locator(host?'[data-ppte-action=save]':'[data-ppte-action=save-portable]').click();const saved=await download,savedPath=join(dir,host?'saved.ppte':'saved.html');await saved.saveAs(savedPath)
    if(host){await page.locator('[data-ppte-action=open]').setInputFiles(savedPath);await page.waitForFunction(()=>globalThis.document.querySelector('[data-ppte-status]')?.textContent?.includes('已打开 saved.ppte'))}else{await page.goto(pathToFileURL(savedPath).href);await page.waitForFunction(()=>Boolean((window as any).PPTEPortable))}
    assert.equal(await page.evaluate(`${api}.getRevision()`),revision)
    assert.equal(await page.evaluate(`${api}.undo().ok`),true);assert.notEqual(await page.evaluate(`${api}.getRevision()`),revision);assert.equal(await page.evaluate(`${api}.redo().ok`),true,`${host?'Host':'Portable'} redo: ${await page.locator('body').innerText()}`);assert.equal(await page.evaluate(`${api}.getRevision()`),revision)
    const lockedDocument=structuredClone(document);lockedDocument.slides[slideId].elements.table.locked=true
    const lockedPath=join(dir,host?'locked.ppte':'locked.html')
    if(host){writeFileSync(lockedPath,buildCheckpointBytes(lockedDocument));await page.locator('[data-ppte-action=open]').setInputFiles(lockedPath);await page.waitForFunction(()=>globalThis.document.querySelector('[data-ppte-status]')?.textContent?.includes('已打开 locked.ppte'))}
    else {const lockedPortable=buildPortable(lockedDocument,{profile:'quick-fix'});assert.equal(lockedPortable.ok,true);writeFileSync(lockedPath,lockedPortable.html);await page.goto(pathToFileURL(lockedPath).href);await page.waitForFunction(()=>Boolean((window as any).PPTEPortable))}
    await page.locator('[data-ppte-stage] td[data-cell-id="table:cell:0:0"]').click()
    const lockedRevision=await page.evaluate(`${api}.getRevision()`)
    await panel.getByLabel('单元格值',{exact:true}).fill('被拒绝的输入保留');await panel.getByRole('button',{name:'应用单元格值',exact:true}).click()
    assert.equal(await page.evaluate(`${api}.getRevision()`),lockedRevision);assert.equal(await panel.getByLabel('单元格值',{exact:true}).inputValue(),'被拒绝的输入保留');assert.match(await panel.getByRole('status').innerText(),/拒绝/)
    await page.evaluate(`${api}.enterPresentation()`);await panel.waitFor({state:'hidden'});assert.equal(await panel.isVisible(),false);assert.equal(await page.evaluate(`${api}.getRevision()`),lockedRevision)
    await page.evaluate(`${api}.leavePresentation()`)
    await context.tracing.stop({path:join(evidence,`${host?'host':'portable'}-trace.zip`)});await context.close()
  }}finally{await browser.close();rmSync(dir,{recursive:true,force:true})}
})
