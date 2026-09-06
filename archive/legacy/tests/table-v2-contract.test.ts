import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { canonicalRevision } from '../packages/canonical-json/src/index.js'
import { assertTableModel, migrateTableV1, tableProps, tableCellDisplay, planTableOperation, applyTableEdit } from '../packages/widgets/src/table-model.js'
import { renderWidgetHtml, renderWidgetSvg } from '../packages/widgets/src/index.js'
import { applyOperation } from '../packages/operations/src/index.js'
import { TABLE_OPERATION_KINDS, validateDocument, withPersistedHistoryMetadata } from '../packages/schema/src/index.js'
import type { ComponentElement, TableModel, TableOperation, Transaction, Operation } from '../packages/schema/src/index.js'
import { TABLE_PROFILE, TEXT_RUN_PROFILE, inferCompatibilityProfile, checkCompatibility, profileIncludes } from '../packages/compatibility/src/index.js'
import { buildCheckpointBytes, openCheckpointBytes } from '../packages/file-format/src/index.js'
import { buildPortableCheckpointBytes } from '../packages/portable-runtime/src/index.js'
import { findFactReferences, findSourceReferences, checkFactSourceConsistency } from '../packages/facts/src/index.js'
import { validateTransactionShape } from '../packages/validation/src/index.js'
import { createPatch } from '../packages/reviewer/src/index.js'
import { encodePatch, decodePatch, applyPatchToDocument, computePatchHeadRevisionProof } from '../packages/patch-format/src/codec.js'

function fixture(v2 = true) {
  const { document, imageBytes } = makeContractDocument()
  const element: ComponentElement = { id:'table',type:'component',frame:{x:20,y:400,width:600,height:160},componentType:'core/table',componentVersion:'1.0.0',props:{columns:['项目','值'],rows:[['中文长内容',12.5],[true,null]],caption:'表格说明'},fallback:{kind:'placeholder',label:'Table'} }
  document.slides.slide_main.elements.table=element;document.slides.slide_main.rootOrder.push('table')
  if(v2){element.props=tableProps(migrateTableV1(element).model);element.componentVersion='2.0.0'}
  return {document,imageBytes,element,session:new PpteSession(document)}
}
const model=(session:PpteSession)=>(session.getDocument().slides.slide_main.elements.table as ComponentElement).props as unknown as TableModel
function operation(payload: Record<string,unknown>): TableOperation {return {opId:'table-op',slideId:'slide_main',elementId:'table',...payload} as TableOperation}
function plan(session:PpteSession,payload:Record<string,unknown>) {return planTableOperation(session.getDocument(),operation(payload),{transactionId:`tx-${session.getHistory().length}`,baseRevision:session.getRevision(),createdAt:'2026-09-06T00:00:00Z'})}
function commit(session:PpteSession,payload:Record<string,unknown>) {const {transaction}=plan(session,payload);const result=session.commit(transaction);assert.equal(result.ok,true,JSON.stringify(result.issues));return transaction}
function generic(session:PpteSession,op:Operation):Transaction {return {transactionId:'generic',baseRevision:session.getRevision(),createdAt:'2026-09-06T00:00:00Z',actor:{type:'human'},scope:{kind:'document',permissions:['content','structure'],allowInsert:true,allowDelete:true},changeContract:{},operations:[op]}}

test('F01 A13 explicit v1 migration preserves scalar types, header/caption/element identity and source bytes',()=>{
  const {element,session}=fixture(false),before=JSON.stringify(element),revision=session.getRevision()
  const {model:m,report}=migrateTableV1(element)
  assert.equal(JSON.stringify(element),before);assert.equal(report.elementId,'table');assert.equal(report.cellIds.length,4)
  assert.deepEqual(m.columnOrder.map(id=>m.columns[id].label),['项目','值']);assert.equal(m.caption,'表格说明')
  assert.deepEqual(Object.values(m.cells).map(c=>c.value),['中文长内容',12.5,true,null])
  assert.deepEqual(migrateTableV1(element).model,m)
  commit(session,{kind:'table.migrate'});assert.equal(session.getDocument().slides.slide_main.elements.table.id,'table')
  assert.equal(session.undo().ok,true);assert.equal(session.getRevision(),revision);assert.equal(session.redo().ok,true)
  assert.throws(()=>migrateTableV1({...element,props:{rows:[[1],[2,3]]}}),/RECTANGULAR/)
  const empty=migrateTableV1({...element,props:{columns:[],rows:[]}}).model;assertTableModel(empty);assert.equal(Object.keys(empty.cells).length,0)
  const tx=generic(fixture(false).session,operation({kind:'table.setCellValue',cellId:'table:cell:0:0',value:'bad'}))
  assert.equal(fixture(false).session.preview(tx).ok,false)
})

test('F01 A13 all typed operations preserve untouched IDs and serialized inverses restore exact revisions',()=>{
  const {session}=fixture(),initial=session.getRevision(),seen=new Set<string>()
  const check=(payload:Record<string,unknown>)=>{const before=session.getRevision();const tx=commit(session,payload);seen.add(tx.operations[0].kind);const after=session.getRevision();assert.equal(session.undo().ok,true);assert.equal(session.getRevision(),before);assert.equal(session.redo().ok,true);assert.equal(session.getRevision(),after)}
  const untouched=structuredClone(model(session).cells['table:cell:1:0'])
  check({kind:'table.setCellValue',cellId:'table:cell:0:1',value:1234567890123})
  check({kind:'table.setCellStyle',cellId:'table:cell:0:1',style:{fill:'#ffeeaa'}})
  check({kind:'table.resizeRows',sizes:{'table:row:0':48}});check({kind:'table.resizeColumns',sizes:{'table:column:0':240}})
  check({kind:'table.moveRows',ids:['table:row:0'],index:1});check({kind:'table.moveColumns',ids:['table:column:0'],index:1})
  check({kind:'table.insertRows',index:1,items:[{id:'new-row'}],cells:model(session).columnOrder.map((columnId,i)=>({id:`new-row-cell-${i}`,rowId:'new-row',columnId,value:null}))})
  check({kind:'table.insertColumns',index:1,items:[{id:'new-col',label:'新列'}],cells:model(session).rowOrder.map((rowId,i)=>({id:`new-col-cell-${i}`,rowId,columnId:'new-col',value:false}))})
  check({kind:'table.deleteRows',ids:['new-row']});check({kind:'table.deleteColumns',ids:['new-col']})
  const m=model(session);check({kind:'table.mergeCells',merge:{anchorCellId:'table:cell:1:1',rowIds:m.rowOrder,columnIds:m.columnOrder}})
  check({kind:'table.splitCell',cellId:'table:cell:1:1'})
  assert.deepEqual(model(session).cells['table:cell:1:0'],untouched)
  assert.deepEqual([...seen].sort(),TABLE_OPERATION_KINDS.filter(k=>!['table.restore','table.migrate'].includes(k)).sort())
  while(session.getHistory().length)assert.equal(session.undo().ok,true)
  assert.equal(session.getRevision(),initial)
})

test('F01 A13 typed display, text consistency and rectangular merges retain covered values in HTML/SVG',()=>{
  const {session}=fixture(),original=structuredClone(model(session).cells)
  commit(session,{kind:'table.mergeCells',merge:{anchorCellId:'table:cell:0:0',rowIds:model(session).rowOrder,columnIds:model(session).columnOrder}})
  assert.deepEqual(model(session).cells,original)
  const e=session.getDocument().slides.slide_main.elements.table as ComponentElement
  assert.match(renderWidgetHtml(e),/rowspan="2" colspan="2"/);assert.match(renderWidgetHtml(e),/中文长内容/);assert.doesNotMatch(renderWidgetHtml(e),/>12.5</)
  assert.match(renderWidgetSvg(e,600,200),/中文长内容/)
  assert.throws(()=>applyTableEdit(model(session),operation({kind:'table.mergeCells',merge:model(session).merges[0]})),/TABLE_INVALID/)
  assert.throws(()=>applyTableEdit(model(session),operation({kind:'table.deleteRows',ids:['table:row:0']})),/TABLE_INVALID/)
  commit(session,{kind:'table.splitCell',cellId:'table:cell:0:0'});assert.deepEqual(model(session).cells,original)
  for(const [value,displayFormat,expected] of [[0.125,'percent','12.5%'],[12.5,'fixed:2','12.50'],[true,'general','true'],[null,'general',''],['12345678901234567890','general','12345678901234567890']] as const) {
    commit(session,{kind:'table.setCellValue',cellId:'table:cell:0:1',value,displayFormat});assert.equal(tableCellDisplay(model(session).cells['table:cell:0:1']),expected)
    assert.ok(renderWidgetHtml(session.getDocument().slides.slide_main.elements.table as ComponentElement).includes(`>${expected}</td>`))
  }
  commit(session,{kind:'table.setCellValue',cellId:'table:cell:0:0',value:'文本',richText:{paragraphs:[{id:'p',runs:[{id:'r',text:'文本',marks:{bold:true}}]}]}})
  for(const patch of [{value:2,richText:{paragraphs:[]}},{value:'wrong',richText:{paragraphs:[{id:'p',runs:[{id:'r',text:'text'}]}]}},{value:'x',displayFormat:'percent'},{value:Infinity}])assert.throws(()=>applyTableEdit(model(session),operation({kind:'table.setCellValue',cellId:'table:cell:0:0',...patch})))
})

test('F01 A13 malformed models cannot bypass validation through props, restore, element/slide insertion or checkpoint',()=>{
  const {session,imageBytes}=fixture(),base=structuredClone(model(session)),revision=session.getRevision()
  const badModels:TableModel[]=[]
  const bad=(edit:(m:TableModel)=>void)=>{const m=structuredClone(base);edit(m);badModels.push(m)}
  bad(m=>m.rowOrder.push(m.rowOrder[0]));bad(m=>delete m.cells['table:cell:0:0']);bad(m=>m.cells['table:cell:0:0'].rowId='missing');bad(m=>m.rows[m.rowOrder[0]].size=0);bad(m=>m.merges.push({anchorCellId:'table:cell:1:0',rowIds:m.rowOrder,columnIds:m.columnOrder}));bad(m=>(m as any).evil=1)
  for(const m of badModels) {
    assert.throws(()=>assertTableModel(m))
    const element={...session.getDocument().slides.slide_main.elements.table,props:tableProps(m)} as ComponentElement
    const slide={...session.getDocument().slides.slide_main,id:'new-slide',elements:{table:element},rootOrder:['table']};delete slide.groups;delete slide.readingOrder;delete slide.protectedAnchors
    const operations:Operation[]=[{opId:'bad',kind:'component.updateProps',slideId:'slide_main',elementId:'table',patch:tableProps(m),replace:true},operation({kind:'table.restore',componentVersion:'2.0.0',props:tableProps(m)}),{opId:'bad',kind:'element.insert',index:0,slideId:'slide_main',element:{...element,id:'new-table'}},{opId:'bad',kind:'slide.insert',index:0,slide}]
    for(const op of operations){assert.throws(()=>applyOperation(session.getDocument(),op,{runtimeProfile:'ga-c'}),/TABLE_INVALID/);const result=session.commit(generic(session,op));assert.equal(result.ok,false);assert.equal(session.getRevision(),revision);assert.equal(session.getHistory().length,0)}
    const document=structuredClone(session.getDocument());document.slides.slide_main.elements.table=element
    assert.ok(validateDocument(document).some(i=>i.severity==='error'));assert.throws(()=>buildCheckpointBytes(document,{assetBytes:{asset_pixel:imageBytes}}))
  }
  const v1=fixture(false);assert.equal(v1.session.commit(generic(v1.session,{opId:'bypass',kind:'component.updateProps',slideId:'slide_main',elementId:'table',patch:tableProps(base),replace:true})).ok,false)
  const malformed=generic(session,operation({kind:'table.deleteRows',ids:['table:row:0'],unreviewed:true}));assert.ok(validateTransactionShape(malformed).some(i=>i.severity==='error'))
})

test('F01 A13 cell fact/source identities survive merge/move and every reference deletion requires impact review',()=>{
  const {document,element,imageBytes}=fixture(),m=element.props as unknown as TableModel
  document.facts={...document.facts,f:{id:'f',key:'value',value:12.5}};document.sources={...document.sources,s:{id:'s',title:'Source'}}
  m.cells['table:cell:0:1'].factIds=['f'];m.cells['table:cell:0:1'].sourceIds=['s']
  const session=new PpteSession(document)
  assert.equal(findFactReferences(document,'f')[0].cellId,'table:cell:0:1');assert.equal(findSourceReferences(document,'s')[0].cellId,'table:cell:0:1');assert.equal(checkFactSourceConsistency(document).ok,true)
  commit(session,{kind:'table.moveRows',ids:['table:row:0'],index:1})
  commit(session,{kind:'table.mergeCells',merge:{anchorCellId:'table:cell:1:0',rowIds:model(session).rowOrder,columnIds:model(session).columnOrder}})
  assert.equal(findFactReferences(session.getDocument(),'f')[0].cellId,'table:cell:0:1')
  commit(session,{kind:'table.splitCell',cellId:'table:cell:1:0'})
  const deletion=plan(session,{kind:'table.deleteRows',ids:['table:row:0']})
  assert.deepEqual(deletion.removedCellReferences,['table:cell:0:1']);assert.equal(session.preview(deletion.transaction).requiresConfirmation,true)
  const unreviewed=structuredClone(deletion.transaction);unreviewed.changeContract.requireConfirmation=false
  assert.equal(session.commit(unreviewed).ok,false)
  const stripped=structuredClone(model(session));delete stripped.cells['table:cell:0:1'].factIds;delete stripped.cells['table:cell:0:1'].sourceIds
  for(const op of [operation({kind:'table.restore',componentVersion:'2.0.0',props:tableProps(stripped)}),{opId:'generic',kind:'component.updateProps',slideId:'slide_main',elementId:'table',replace:true,patch:tableProps(stripped)},{opId:'delete',kind:'element.delete',slideId:'slide_main',elementId:'table'},{opId:'delete',kind:'slide.delete',slideId:'slide_main'}] as Operation[])assert.equal(session.commit(generic(session,op)).ok,false)
  const before=session.getRevision();assert.equal(session.commit(deletion.transaction).ok,true);assert.equal(findFactReferences(session.getDocument(),'f').length,0);assert.equal(session.undo().ok,true);assert.equal(session.getRevision(),before)
  assert.equal(session.redo().ok,true)
  const reopened=new PpteSession(openCheckpointBytes(buildCheckpointBytes(session.getDocument(),{assetBytes:{asset_pixel:imageBytes},recentTransactions:session.getHistory().map(e=>withPersistedHistoryMetadata(e.transaction,e))})).document)
  assert.equal(reopened.undo().ok,true);assert.equal(reopened.getRevision(),before);assert.equal(findFactReferences(reopened.getDocument(),'f')[0].cellId,'table:cell:0:1')
  const missing=structuredClone(document);delete missing.facts!.f;assert.ok(validateDocument(missing).some(i=>i.code==='FACT_REFERENCE_MISSING'))
})

test('F01 A03 complete registered descriptor and history/inverse/redo/patch minimum profile declarations',()=>{
  assert.deepEqual(TABLE_PROFILE,{...TEXT_RUN_PROFILE,id:'ppte-2.1-table.1',widgetAbiVersion:'2.0',migration:{from:['ppte-2.0-ga-a.1','ppte-2.0-ga-b.1','ppte-2.0-ga-c.1','ppte-2.0-edit.1',TEXT_RUN_PROFILE.id],direction:'forward-only',preservesSource:true}})
  assert.equal(checkCompatibility(TABLE_PROFILE).ok,true);assert.equal(profileIncludes(TABLE_PROFILE.id,TEXT_RUN_PROFILE.id),true);assert.equal(profileIncludes(TEXT_RUN_PROFILE.id,TABLE_PROFILE.id),false)
  assert.equal(checkCompatibility({...TABLE_PROFILE,id:'unknown-table'}).disposition,'reject')
  const {session}=fixture(false),before=session.getRevision(),tx=commit(session,{kind:'table.migrate'}),after=session.getRevision()
  assert.equal(inferCompatibilityProfile(session.getDocument()),TABLE_PROFILE.id)
  const old=fixture(false).document
  assert.equal(inferCompatibilityProfile(old,{operations:tx.operations}),TABLE_PROFILE.id)
  assert.equal(inferCompatibilityProfile(old,{recentTransactions:[withPersistedHistoryMetadata({...tx,operations:[]},{inverse:tx,beforeRevision:before,afterRevision:after})]}),TABLE_PROFILE.id)
  assert.equal(session.undo().ok,true);assert.equal(inferCompatibilityProfile(session.getDocument(),{redoHistory:session.getRedoHistory()}),TABLE_PROFILE.id)
  for(const name of ['manifest','compatibility-profile'])assert.ok(JSON.stringify(JSON.parse(readFileSync(`schemas/${name}.schema.json`,'utf8'))).includes(TABLE_PROFILE.id))
  const schema=JSON.parse(readFileSync('schemas/transaction.schema.json','utf8'));const kinds=schema.properties.operations.items.oneOf.map((o:any)=>o.properties.kind.const)
  for(const kind of TABLE_OPERATION_KINDS)assert.ok(kinds.includes(kind),kind)
})

test('F01 A03/A13 Host and Portable checkpoints retain exact migration/merge/value history and redo-only tables',()=>{
  for(const write of [buildCheckpointBytes,buildPortableCheckpointBytes]) {
    const {session,imageBytes}=fixture(false),original=session.getRevision()
    commit(session,{kind:'table.migrate'});commit(session,{kind:'table.setCellValue',cellId:'table:cell:0:1',value:0.25,displayFormat:'percent'})
    commit(session,{kind:'table.mergeCells',merge:{anchorCellId:'table:cell:0:0',rowIds:model(session).rowOrder,columnIds:model(session).columnOrder}})
    const after=session.getRevision(),options={assetBytes:{asset_pixel:imageBytes},recentTransactions:session.getHistory().map(e=>withPersistedHistoryMetadata(e.transaction,e))}
    const opened=openCheckpointBytes(write(session.getDocument(),options));assert.equal(opened.manifest.compatibilityProfile,TABLE_PROFILE.id)
    const reopened=new PpteSession(opened.document);assert.equal(reopened.getRevision(),after)
    for(let i=0;i<3;i++)assert.equal(reopened.undo().ok,true)
    assert.equal(reopened.getRevision(),original)
    const redoOptions={assetBytes:options.assetBytes,redoHistory:[...reopened.getRedoHistory()]}
    const redoOpened=openCheckpointBytes(write(reopened.getDocument(),redoOptions));assert.equal(redoOpened.manifest.compatibilityProfile,TABLE_PROFILE.id)
    const redo=new PpteSession(redoOpened.document);for(let i=0;i<3;i++)assert.equal(redo.redo().ok,true);assert.equal(redo.getRevision(),after)
    assert.throws(()=>write(session.getDocument(),{...options,compatibilityProfile:TEXT_RUN_PROFILE.id}),/requires compatibility profile/)
    assert.throws(()=>write(reopened.getDocument(),{...redoOptions,compatibilityProfile:TEXT_RUN_PROFILE.id}),/requires compatibility profile/)
  }
})

test('F01 A03 typed table patch codec preserves operations, declarations and replay',()=>{
  const {document,session}=fixture(),tx=commit(session,{kind:'table.setCellValue',cellId:'table:cell:0:0',value:'保存补丁'})
  const patch=createPatch(document,session.getDocument())
  patch.operations=tx.operations
  patch.manifest.headRevisionProof=computePatchHeadRevisionProof(patch.manifest.baseRevision,patch.manifest.headRevision!,patch.operations)
  const decoded=decodePatch(encodePatch(patch));assert.equal(decoded.manifest.compatibilityProfile,TABLE_PROFILE.id)
  const downgraded=structuredClone(decoded);downgraded.manifest.compatibilityProfile=TEXT_RUN_PROFILE.id
  assert.throws(()=>encodePatch(downgraded),/table profile/)
  const result=applyPatchToDocument(document,decoded)
  assert.equal(canonicalRevision(result.document!),session.getRevision())
})

test('F01 A13 seeded generated value/axis sequences undo and redo without identity drift',()=>{
  const {session}=fixture(),initial=session.getRevision();let seed=0xf01
  for(let i=0;i<40;i++) {seed=(Math.imul(seed,1664525)+1013904223)>>>0;const id=Object.keys(model(session).cells)[seed%4]
    commit(session,i%3===0?{kind:'table.moveRows',ids:[model(session).rowOrder[0]],index:1}:{kind:'table.setCellValue',cellId:id,value:seed%2?`中文 ${seed}`:seed})
  }
  const final=session.getRevision();for(let i=0;i<40;i++)assert.equal(session.undo().ok,true);assert.equal(session.getRevision(),initial)
  for(let i=0;i<40;i++)assert.equal(session.redo().ok,true);assert.equal(session.getRevision(),final)
})


test('F01 A03 literal JSON Schema validates v2 document, typed transactions, manifest and descriptor',()=>{
  const {document,session,imageBytes}=fixture()
  const tx=plan(session,{kind:'table.setCellValue',cellId:'table:cell:0:1',value:42}).transaction
  const manifest=openCheckpointBytes(buildCheckpointBytes(document,{assetBytes:{asset_pixel:imageBytes}})).manifest
  const bad=structuredClone(document);(bad.slides.slide_main.elements.table as ComponentElement).props.rowOrder='bad'
  const input={document,tx,manifest,profile:TABLE_PROFILE,bad}
  const result=spawnSync('python',['-c',`
import json,sys
from jsonschema import Draft202012Validator
x=json.load(sys.stdin)
for name,key in [('document','document'),('transaction','tx'),('manifest','manifest'),('compatibility-profile','profile')]:
 schema=json.load(open('schemas/'+name+'.schema.json'))
 Draft202012Validator.check_schema(schema)
 v=Draft202012Validator(schema)
 errors=list(v.iter_errors(x[key]))
 assert not errors, (name, [e.message for e in errors])
 if name=='document': assert list(v.iter_errors(x['bad']))
 if name=='compatibility-profile':
  broken=dict(x[key],widgetAbiVersion='1.0')
  assert list(v.iter_errors(broken))
  broken=dict(x[key],id='unknown-table')
  assert list(v.iter_errors(broken))
`],{input:JSON.stringify(input),encoding:'utf8'})
  assert.equal(result.status,0,result.stdout+result.stderr)
})
