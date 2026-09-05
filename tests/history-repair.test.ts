import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { PpteSession, assessHistory } from '../packages/core/src/index.js'
import { buildCheckpointBytes, openCheckpointBytes } from '../packages/file-format/src/index.js'
import { withPersistedHistoryMetadata } from '../packages/schema/src/file-format.js'
import { inspectHistoryFile, repairHistoryCopy } from '../packages/node-runtime/src/history-repair.js'

function fixture() {
  const { document, imageBytes } = makeContractDocument()
  const session = new PpteSession(document)
  for (let i = 0; i < 3; i++) {
    const result = session.commit({ transactionId: `rename-${i}`, baseRevision: session.getRevision(), actor: { type: 'human', id: 'test' }, scope: { kind: 'document', permissions: ['structure'], allowInsert: false, allowDelete: false }, changeContract: { allowedOperationKinds: ['slide.update'], maxChangedSlides: 1 }, createdAt: '2026-09-05T00:00:00Z', operations: [{ kind: 'slide.update', opId: `rename-${i}`, slideId: 'slide_main', patch: { name: `Name ${i}` } }] })
    assert.equal(result.ok, true, JSON.stringify(result.issues))
  }
  return { session, imageBytes }
}

test('assessment keeps only the verified contiguous suffix and never mutates history', () => {
  const { session } = fixture()
  const entries = structuredClone([...session.getHistory()])
  entries[1]!.inverse.operations = [{ kind: 'slide.update', opId: 'bad', slideId: 'slide_main', patch: { name: 'incorrect prior value' } }]
  const before = JSON.stringify(entries)
  const result = assessHistory(session.getDocument(), entries)
  assert.equal(result.status, 'invalid')
  assert.equal(result.retained.length, 1)
  assert.equal(result.discardedHistoryCount, 2)
  assert.equal(JSON.stringify(entries), before)
  const repaired = new PpteSession(session.getDocument(), { history: result.retained })
  assert.equal(repaired.undo().ok, true)
  assert.equal(repaired.undo().ok, false)
  assert.equal(assessHistory(session.getDocument(), [], [], 'ga-c', '9.0').status, 'unsupported')
  assert.equal(assessHistory(session.getDocument(), []).status, 'absent')
})

test('repair saves a verified new copy and report while preserving source and journal byte for byte', () => {
  const { session, imageBytes } = fixture()
  const history = structuredClone([...session.getHistory()])
  history[0]!.inverse.operations = [{ kind: 'slide.update', opId: 'bad', slideId: 'slide_main', patch: { name: 'wrong prior name' } }]
  const bytes = buildCheckpointBytes(session.getDocument(), { assetBytes: { asset_pixel: imageBytes }, recentTransactions: history.map(entry => withPersistedHistoryMetadata(entry.transaction, entry)) })
  assert.throws(() => new PpteSession(openCheckpointBytes(bytes).document), /HISTORY_RESTORE_FAILED/)
  const dir = mkdtempSync(join(tmpdir(), 'ppte-history-repair-'))
  try {
    const source = join(dir, 'source.ppte'); writeFileSync(source, bytes)
    writeFileSync(`${source}.journal`, 'preserve even a damaged journal')
    const inspected = inspectHistoryFile(source)
    assert.equal(inspected.assessment.status, 'invalid')
    assert.equal(inspected.assessment.retained.length, 2)
    const target = join(dir, 'recovery')
    const report = repairHistoryCopy(source, target)
    assert.equal(report.assessment.retained.length, 2)
    assert.deepEqual(readFileSync(source), Buffer.from(bytes))
    assert.equal(readFileSync(`${source}.journal`, 'utf8'), 'preserve even a damaged journal')
    assert.deepEqual(readFileSync(join(target, 'original.ppte')), Buffer.from(bytes))
    assert.equal(existsSync(join(target, 'INCOMPLETE')), false)
    assert.equal(JSON.parse(readFileSync(join(target, 'report.json'), 'utf8')).sourceHash, inspected.sourceHash)
    const restored = new PpteSession(openCheckpointBytes(readFileSync(report.outputPath)).document)
    assert.equal(restored.getRevision(), session.getRevision())
    assert.equal(restored.undo().ok, true)
    assert.equal(restored.undo().ok, true)
    assert.equal(restored.undo().ok, false)
    assert.throws(() => repairHistoryCopy(source, target), /EEXIST/)
    assert.deepEqual(readFileSync(source), Buffer.from(bytes))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('redo assessment preserves only the reachable prefix of the redo stack', () => {
  const { session } = fixture()
  session.undo(); session.undo(); session.undo()
  const redo = structuredClone([...session.getRedoHistory()])
  redo[1]!.afterRevision = 'sha256:' + '0'.repeat(64)
  const result = assessHistory(session.getDocument(), [], redo)
  assert.equal(result.status, 'invalid')
  assert.equal(result.retainedRedo.length, 1)
  const repaired = new PpteSession(session.getDocument(), { redoHistory: result.retainedRedo })
  assert.equal(repaired.redo().ok, true)
  assert.equal(repaired.redo().ok, false)
})

test('history rebuild requires an exact base and exact final snapshot', async () => {
  const { rebuildHistoryFromBase } = await import('../packages/core/src/index.js')
  const { session } = fixture()
  const history = session.getHistory()
  const base = makeContractDocument().document
  const rebuilt = rebuildHistoryFromBase(base, session.getDocument(), history.map(entry => entry.transaction))
  assert.equal(rebuilt.length, 3)
  assert.equal(new PpteSession(session.getDocument(), { history: rebuilt }).getHistory().length, 3)
  const wrong = structuredClone(base)
  wrong.metadata.title = 'Not the exact base'
  assert.throws(() => rebuildHistoryFromBase(wrong, session.getDocument(), history.map(entry => entry.transaction)), /BASE_MISMATCH/)
  assert.throws(() => rebuildHistoryFromBase(base, session.getDocument(), history.slice(0, 2).map(entry => entry.transaction)), /HEAD_MISMATCH/)
})

import { readStoredZip, writeStoredZip } from '../packages/archive/src/index.js'
import { sha256HexBytes } from '../packages/canonical-json/src/index.js'
import { assessCheckpointRecovery, buildRecoveryCheckpoint } from '../packages/portable-runtime/src/shared.js'
import { readPersistedHistoryMetadata } from '../packages/schema/src/file-format.js'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'
import { chromium } from 'playwright'

function checkpoint() {
  const {session, imageBytes} = fixture()
  return buildCheckpointBytes(session.getDocument(), {assetBytes:{asset_pixel:imageBytes}, recentTransactions:session.getHistory().map(entry=>entry.transaction)})
}
function modifyArchive(bytes:Uint8Array, path:string, change:(data:Uint8Array)=>Uint8Array, updateHash=false) {
  const entries=readStoredZip(bytes)
  entries.set(path,change(entries.get(path)!))
  if(updateHash){
    const manifest=JSON.parse(new TextDecoder().decode(entries.get('manifest.json')))
    const entry=manifest.files.find((entry:{path:string})=>entry.path===path)
    if(entry){entry.sha256=sha256HexBytes(entries.get(path)!);entry.byteLength=entries.get(path)!.length}
    entries.set('manifest.json',new TextEncoder().encode(JSON.stringify(manifest)))
  }
  return writeStoredZip([...entries].map(([name,data])=>({name,data})))
}
const encoded=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value))

test('A03/A04 shared diagnosis exposes valid, absent, invalid and unsupported without trusting damaged history checksums',()=>{
  const bytes=checkpoint()
  assert.equal(assessCheckpointRecovery(bytes).history.status,'valid')
  const {document,imageBytes}=makeContractDocument()
  assert.equal(assessCheckpointRecovery(buildCheckpointBytes(document,{assetBytes:{asset_pixel:imageBytes}})).history.status,'absent')
  const damaged=modifyArchive(bytes,'history/recent.jsonl',data=>new TextEncoder().encode(new TextDecoder().decode(data).replace('Name 0','Evil 0')))
  assert.throws(()=>openCheckpointBytes(damaged),/hash mismatch/)
  const diagnosis=assessCheckpointRecovery(damaged)
  assert.equal(diagnosis.snapshotStatus,'valid')
  assert.equal(diagnosis.history.status,'invalid')
  assert.equal(diagnosis.history.retained.length,0)
  assert.equal(diagnosis.recentTransactions.length,0)
  assert.equal(openCheckpointBytes(damaged,{history:'inspect'}).historyAssessment?.status,'invalid')
  const copy=buildRecoveryCheckpoint(diagnosis)
  const reopened=new PpteSession(openCheckpointBytes(copy.bytes).document)
  assert.equal(reopened.getRevision(),diagnosis.manifest!.contentRevision)
  assert.equal(reopened.undo().ok,false)
  const unknown=modifyArchive(bytes,'manifest.json',data=>encoded({...JSON.parse(new TextDecoder().decode(data)),operationProtocolVersion:'99.0'}))
  assert.equal(assessCheckpointRecovery(unknown).snapshotStatus,'unsupported')
  assert.equal(assessCheckpointRecovery(unknown).history.status,'unsupported')
  assert.throws(()=>buildRecoveryCheckpoint(assessCheckpointRecovery(unknown)),/READ_ONLY/)
})

test('A04 unknown operations and malformed redo are diagnostic; incomplete content cannot become a recovered project',()=>{
  const {session}=fixture()
  const history=structuredClone([...session.getHistory()])
  ;(history[0]!.transaction.operations[0] as {kind:string}).kind='future.execute'
  assert.equal(assessHistory(session.getDocument(),history).status,'unsupported')
  const bytes=checkpoint()
  for(const path of ['document.json','assets/index.json','assets/pixel.png']) {
    const entries=readStoredZip(bytes)
    const actual=path==='assets/pixel.png'?Object.values(session.getDocument().assets)[0]!.path:path
    const damaged=modifyArchive(bytes,actual,()=>encoded({damaged:true}),true)
    const diagnosis=assessCheckpointRecovery(damaged)
    assert.equal(diagnosis.snapshotStatus,'invalid',actual)
    assert.throws(()=>buildRecoveryCheckpoint(diagnosis),/READ_ONLY/)
    assert.ok(entries.size>0)
  }
  const redoOnly=fixture();redoOnly.session.undo()
  const redoBytes=buildCheckpointBytes(redoOnly.session.getDocument(),{assetBytes:{asset_pixel:redoOnly.imageBytes},recentTransactions:redoOnly.session.getHistory().map(e=>e.transaction),redoHistory:[...redoOnly.session.getRedoHistory()]})
  const badRedo=modifyArchive(redoBytes,'history/redo.json',()=>encoded({bad:true}),true)
  assert.equal(assessCheckpointRecovery(badRedo).history.status,'invalid')
  assert.equal(assessCheckpointRecovery(badRedo).history.retained.length,2)
  assert.equal(assessCheckpointRecovery(badRedo).history.retainedRedo.length,0)
})

test('A04 exact rebuild rejects wrong document identity and every incorrect recorded intermediate revision',async()=>{
  const {rebuildHistoryFromBase}=await import('../packages/core/src/index.js')
  const {session}=fixture();const base=makeContractDocument().document
  assert.throws(()=>rebuildHistoryFromBase({...base,documentId:'different'},session.getDocument(),session.getHistory().map(e=>e.transaction)),/BASE_MISMATCH/)
  const transactions=structuredClone(session.getHistory().map(e=>e.transaction))
  readPersistedHistoryMetadata(transactions[0]!)!.afterRevision='sha256-'+'0'.repeat(64)
  assert.throws(()=>rebuildHistoryFromBase(base,session.getDocument(),transactions),/STEP_MISMATCH/)
  const missing=structuredClone(session.getHistory().map(e=>e.transaction));delete missing[0]!.metadata
  assert.throws(()=>rebuildHistoryFromBase(base,session.getDocument(),missing),/BASE_MISMATCH/)
})

test('A04 repair failures and actual process crashes preserve original, sidecar and CAS at all publication stages',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ppte-c03-faults-'))
  const bytes=checkpoint();const source=join(dir,'source.ppte')
  writeFileSync(source,bytes);writeFileSync(`${source}.journal`,'damaged forensic tail');writeFileSync(join(dir,'cas'),'resource evidence')
  try{
    for(const stage of ['before-write','after-temp','before-publish'] as const){
      const failed=join(dir,`failed-${stage}`)
      assert.throws(()=>repairHistoryCopy(source,failed,{onStage:point=>{if(point===stage)throw new Error('disk denied')}}),/disk denied/)
      assert.equal(existsSync(failed),false)
      const crashed=join(dir,`crashed-${stage}`)
      const script=`import {repairHistoryCopy} from ${JSON.stringify(pathToFileURL(resolve('dist/packages/node-runtime/src/history-repair.js')).href)};repairHistoryCopy(${JSON.stringify(source)},${JSON.stringify(crashed)},{onStage:point=>{if(point===${JSON.stringify(stage)})process.kill(process.pid,'SIGKILL')}})`
      const child=spawnSync(process.execPath,['--input-type=module','-e',script])
      assert.equal(child.signal,'SIGKILL',child.stderr.toString())
      if(stage!=='before-write')assert.equal(existsSync(join(crashed,'INCOMPLETE')),true)
      assert.deepEqual(readFileSync(source),Buffer.from(bytes))
      assert.equal(readFileSync(`${source}.journal`,'utf8'),'damaged forensic tail')
      assert.equal(readFileSync(join(dir,'cas'),'utf8'),'resource evidence')
    }
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('A03/A04 CLI diagnoses then saves a separate recovery package and report',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ppte-c03-cli-'))
  try{
    const source=join(dir,'source.ppte');const bytes=checkpoint();writeFileSync(source,bytes)
    const run=(...args:string[])=>spawnSync(process.execPath,['dist/apps/cli/index.js',...args],{encoding:'utf8'})
    const inspection=run('history-inspect',source);assert.equal(inspection.status,0,inspection.stderr)
    assert.equal(JSON.parse(inspection.stdout).assessment.status,'valid')
    const target=join(dir,'repaired');const result=run('history-repair',source,'--out',target)
    assert.equal(result.status,0,result.stderr)
    assert.equal(existsSync(join(target,'report.json')),true)
    assert.deepEqual(readFileSync(source),Buffer.from(bytes))
    assert.equal(new PpteSession(openCheckpointBytes(readFileSync(join(target,'recovered.ppte'))).document).getHistory().length,3)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('A04 real browser recoverySessionId isolates original tail/base and rejects quota, missing resources and corrupt snapshots',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ppte-c03-browser-'))
  const bundle=buildSync({stdin:{contents:`export {BrowserRecovery} from './packages/editor-react/src/recovery.ts'`,resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',globalName:'RecoveryHarness',write:false})
  writeFileSync(join(dir,'recovery.js'),bundle.outputFiles[0]!.contents)
  writeFileSync(join(dir,'index.html'),'<script src="recovery.js"></script>')
  const browser=await chromium.launch({headless:true})
  try{
    const page=await browser.newPage();await page.goto(pathToFileURL(join(dir,'index.html')).href)
    const {document,imageBytes}=makeContractDocument()
    const result=await page.evaluate(async(input)=>{
      const {document,image}=JSON.parse(input) as {document:import('../packages/schema/src/index.js').PpteDocument;image:number[]}
      const {BrowserRecovery}=(window as unknown as {RecoveryHarness:{BrowserRecovery:new()=>import('../packages/editor-react/src/recovery.js').BrowserRecovery}}).RecoveryHarness
      const key='ppte.host.recovery.v1'
      localStorage.clear()
      const base={document,assetBytes:{asset_pixel:new Uint8Array(image)},fontBytes:{},history:[],redo:[]}
      const first=new BrowserRecovery();await first.initialize();await first.replace(base)
      const oldId=first.recoverySessionId!;const oldRaw=localStorage.getItem(`${key}.${oldId}`)!
      const oldBaseId=JSON.parse(oldRaw).baseId
      const readBase=async(id:string)=>new Promise<string>((resolve,reject)=>{
        const r=indexedDB.open('ppte-host-recovery',1);r.onsuccess=()=>{const db=r.result;const q=db.transaction('bases').objectStore('bases').get(id);q.onsuccess=()=>{resolve(JSON.stringify(q.result));db.close()};q.onerror=()=>reject(q.error)}
      })
      const oldBase=await readBase(oldBaseId)
      const second=new BrowserRecovery();const restored=await second.initialize()
      const forked=second.recoverySessionId!==oldId
      const activeId=localStorage.getItem(`${key}.active`);const currentId=second.recoverySessionId!;const currentRaw=localStorage.getItem(`${key}.${currentId}`)
      const originalSet=Storage.prototype.setItem
      Storage.prototype.setItem=function(k,v){if(k===`${key}.active`)throw new DOMException('quota','QuotaExceededError');originalSet.call(this,k,v)}
      let quota=false;try{await second.replace(base)}catch{quota=true}finally{Storage.prototype.setItem=originalSet}
      let missing=false;try{await second.replace({...base,assetBytes:{}})}catch{missing=true}
      let invalid=false;try{await second.replace({...base,document:{...document,slideOrder:['missing']}})}catch{invalid=true}
      return {forked,restored:Boolean(restored),quota,missing,invalid,oldTailPreserved:localStorage.getItem(`${key}.${oldId}`)===oldRaw,oldBasePreserved:await readBase(oldBaseId)===oldBase,activePreserved:localStorage.getItem(`${key}.active`)===activeId,currentTailPreserved:localStorage.getItem(`${key}.${currentId}`)===currentRaw}
    },JSON.stringify({document,image:[...imageBytes]}))
    assert.deepEqual(result,{forked:true,restored:true,quota:true,missing:true,invalid:true,oldTailPreserved:true,oldBasePreserved:true,activePreserved:true,currentTailPreserved:true})
  }finally{await browser.close();rmSync(dir,{recursive:true,force:true})}
})

test('A04 Host offers read-only inspection and separate downloads, with incomplete files restricted to diagnosis',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ppte-c03-host-'))
  const built=spawnSync('pnpm',['--dir','apps/host','exec','vite','build','--outDir',join(dir,'host')],{encoding:'utf8'})
  assert.equal(built.status,0,built.stderr||built.stdout)
  const browser=await chromium.launch({headless:true})
  const context=await browser.newContext({acceptDownloads:true})
  await context.tracing.start({screenshots:true,snapshots:true})
  try{
    const {session,imageBytes}=fixture()
    const history=structuredClone([...session.getHistory()])
    history[0]!.inverse.operations=[{kind:'slide.update',opId:'bad',slideId:'slide_main',patch:{name:'wrong'}}]
    const bytes=buildCheckpointBytes(session.getDocument(),{assetBytes:{asset_pixel:imageBytes},recentTransactions:history.map(e=>withPersistedHistoryMetadata(e.transaction,e))})
    const source=join(dir,'damaged.ppte');writeFileSync(source,bytes)
    const page=await context.newPage();await page.goto(pathToFileURL(join(dir,'host/index.html')).href)
    await page.waitForFunction(()=>document.querySelector('[data-ppte-host]')?.getAttribute('data-ppte-ready')==='true')
    const originalStorage=await page.evaluate(()=>JSON.stringify({...localStorage}))
    await page.locator('[data-ppte-action="open"]').setInputFiles(source)
    const panel=page.locator('[data-ppte-recovery-inspection]');await panel.waitFor()
    assert.match(await panel.innerText(),/invalid/)
    const downloads:import('playwright').Download[]=[];page.on('download',d=>downloads.push(d))
    await panel.getByRole('button',{name:'另存恢复副本（保留已验证历史）'}).click()
    const deadline=Date.now()+10000
    while(downloads.length<2&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20))
    assert.equal(downloads.length,2)
    const copy=downloads.find(d=>d.suggestedFilename()==='recovered.ppte')!
    const report=downloads.find(d=>d.suggestedFilename()==='recovery-report.json')!
    const copyPath=await copy.path();const reportPath=await report.path();assert.ok(copyPath);assert.ok(reportPath)
    const recovered=new PpteSession(openCheckpointBytes(readFileSync(copyPath)).document)
    assert.equal(recovered.getHistory().length,2)
    assert.equal(recovered.getRevision(),session.getRevision())
    assert.equal(JSON.parse(readFileSync(reportPath,'utf8')).sourceHash,sha256HexBytes(bytes))
    assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage})),originalStorage)
    // Download rejection/cancellation does not activate a recovered document or discard the inspection.
    await page.evaluate(()=>{HTMLAnchorElement.prototype.click=function(){throw new Error('download denied')}})
    await panel.getByRole('button',{name:'另存恢复副本（保留已验证历史）'}).click()
    assert.match(await page.locator('[data-ppte-status]').innerText(),/下载失败/)
    assert.equal(await panel.count(),1)
    assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage})),originalStorage)
    const incomplete=modifyArchive(bytes,Object.values(session.getDocument().assets)[0]!.path,()=>encoded('missing resource'),true)
    writeFileSync(join(dir,'incomplete.ppte'),incomplete)
    await page.locator('[data-ppte-action="open"]').setInputFiles(join(dir,'incomplete.ppte'))
    await page.waitForFunction(()=>document.querySelector('[data-ppte-recovery-inspection]')?.textContent?.includes('ASSET_HASH_MISMATCH'))
    assert.equal(await panel.getByRole('button',{name:'另存恢复副本（保留已验证历史）'}).count(),0)
    assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage})),originalStorage)
    assert.deepEqual(readFileSync(source),Buffer.from(bytes))
    // Persist browser evidence outside the disposable input directory.
    const {mkdirSync}=await import('node:fs');mkdirSync('artifacts/c03',{recursive:true})
    await page.screenshot({path:'artifacts/c03/host-readonly-diagnosis.png'})
    await context.tracing.stop({path:'artifacts/c03/host-recovery-trace.zip'})
  }finally{await browser.close();rmSync(dir,{recursive:true,force:true})}
})

test('A04 generated Portable shows read-only diagnostics for incomplete resources and invalid history',async()=>{
  const {buildPortable}=await import('../packages/portable-runtime/src/index.js')
  const {session,imageBytes}=fixture()
  const built=buildPortable(session.getDocument(),{profile:'full-portable',assetBytes:{asset_pixel:imageBytes},recentTransactions:session.getHistory().map(e=>e.transaction)})
  assert.equal(built.ok,true,JSON.stringify(built.issues))
  const dir=mkdtempSync(join(tmpdir(),'ppte-c03-portable-'));const browser=await chromium.launch({headless:true})
  try{
    for(const defect of ['resource','history']){
      const html=built.html.replace(/(<script id="ppte-portable-payload" type="application\/json">)([\s\S]*?)(<\/script>)/,(_all,open,json,close)=>{
        const payload=JSON.parse(json)
        if(defect==='resource')payload.assets={}
        else readPersistedHistoryMetadata(payload.recentTransactions[0])!.afterRevision='sha256-'+'0'.repeat(64)
        return open+JSON.stringify(payload).replace(/</g,'\\u003c')+close
      })
      const file=join(dir,`${defect}.html`);writeFileSync(file,html)
      const page=await browser.newPage();await page.goto(pathToFileURL(file).href)
      await page.locator('[data-ppte-recovery-diagnostic]').waitFor()
      assert.equal(await page.locator('[contenteditable="true"],button').count(),0)
      assert.equal(readFileSync(file,'utf8'),html)
      await page.close()
    }
  }finally{await browser.close();rmSync(dir,{recursive:true,force:true})}
})
