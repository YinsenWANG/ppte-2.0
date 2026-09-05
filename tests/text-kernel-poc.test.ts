import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { buildCheckpointBytes, openCheckpointBytes } from '../packages/file-format/src/index.js'
import { withPersistedHistoryMetadata } from '../packages/schema/src/file-format.js'
import type { TextElement, RichTextDocument } from '../packages/schema/src/index.js'
import { ImeTextEditSession } from '../packages/richtext-adapter/src/index.js'
const fixture=JSON.parse(readFileSync('tests/fixtures/evolution/text-poc.json','utf8'))

for(const candidate of ['native','prosemirror']) test(`E02 ${candidate}: identical Chinese/selection/paste corpus, explicit gaps, Core-only history`, async()=>{
  const result=await build({stdin:{contents:`import {mount,nativeFactory,textOf,marksOf} from './tests/helpers/text-kernel-poc.ts';import {prosemirrorFactory} from './tests/helpers/text-kernel-prosemirror.ts';globalThis.POC={mount,factory:${candidate}Factory,textOf,marksOf};`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'})
  const browser=await chromium.launch({headless:true})
  try {
    const page=await browser.newPage()
    await page.route('**/*',route=>route.abort())
    await page.setContent('<style>p{margin:0} .ProseMirror{white-space:pre-wrap}</style><div id="active"></div><div id="unrelated">Keep me</div>')
    await page.addScriptTag({content:result.outputFiles[0].text})
    for(const scenario of fixture.cases) {
      const {document,imageBytes}=makeContractDocument()
      const element=document.slides.slide_main.elements.text_body as TextElement
      element.content=structuredClone(fixture.initial)
      const session=new PpteSession(document)
      const output:any=await page.evaluate<any, any>(({element,revision,scenario}):any=>{
        const api=(globalThis as any).POC
        const unrelated=window.document.getElementById('unrelated')
        const mounted=api.mount(api.factory,window.document.getElementById('active'),element,revision)
        const {kernel,draft}=mounted
        const initial=kernel.read()
        let blocked=true
        if(scenario.kind!=='identity')kernel.select(scenario.anchor,scenario.head)
        if(scenario.kind==='composition') {
          kernel.root.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'gong'}))
          kernel.insert('gong');mounted.capture()
          blocked=draft.finish('during',revision)===undefined
          kernel.select(scenario.anchor,scenario.anchor+4)
          kernel.insert(scenario.text)
          kernel.root.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:scenario.text}))
          kernel.root.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:scenario.text}))
        } else if(scenario.kind==='insert')kernel.insert(scenario.text)
        else if(scenario.kind==='paste')kernel.paste(scenario.html)
        else if(scenario.kind==='bold')kernel.bold()
        mounted.capture()
        const local=draft.getLocalContent()
        const tx=draft.finish('poc',revision,'2026-09-06T00:00:00Z')
        const duplicate=draft.finish('duplicate',revision)
        const historyEvent=new InputEvent('beforeinput',{inputType:'historyUndo',bubbles:true,cancelable:true})
        kernel.root.dispatchEvent(historyEvent)
        const output={initial,local,tx,duplicate,text:api.textOf(local),marks:api.marksOf(local),blocked,historyBlocked:historyEvent.defaultPrevented,stable:unrelated===window.document.getElementById('unrelated')}
        mounted.destroy()
        return output
      },{element,revision:session.getRevision(),scenario})
      assert.equal(output.blocked,true,scenario.id)
      assert.equal(output.historyBlocked,true)
      assert.equal(output.stable,true)
      assert.equal(output.duplicate,undefined)
      assert.deepEqual(session.getDocument(),document,'draft cannot mutate canonical document')
      if(scenario.expected)assert.equal(output.text,scenario.expected,scenario.id)
      if(scenario.expectedBold) {
        const bold=output.marks.filter((r:any)=>r.marks.bold).map((r:any)=>r.text).join('')
        if(candidate==='native') { assert.ok(scenario.nativeGap);assert.notEqual(bold,scenario.expectedBold,scenario.id) }
        else assert.equal(bold,scenario.expectedBold,scenario.id)
      }
      if(scenario.kind==='identity') {
        if(candidate==='native')assert.deepEqual(output.initial,fixture.initial)
        else {assert.ok(scenario.prosemirrorGap);assert.notDeepEqual(output.initial,fixture.initial)}
      }
      if(output.tx) {
        assert.equal(session.commit(output.tx).ok,true,scenario.id)
        assert.equal(session.getHistory().length,1)
        const bytes=buildCheckpointBytes(session.getDocument(),{assetBytes:{asset_pixel:imageBytes},recentTransactions:session.getHistory().map(e=>withPersistedHistoryMetadata(e.transaction,e))})
        const reopened=new PpteSession(openCheckpointBytes(bytes).document)
        assert.equal(reopened.undo().ok,true)
        assert.deepEqual(reopened.getDocument(),document)
        assert.equal(reopened.redo().ok,true)
        assert.deepEqual(reopened.getDocument(),session.getDocument())
      } else assert.equal(session.getHistory().length,0)
    }
  } finally {await browser.close()}
})

test('E02 both kernel outputs retain a rejected draft and cancel without a canonical write',()=>{
  for(const candidate of ['native','prosemirror']) {
    const {document}=makeContractDocument()
    const element=document.slides.slide_main.elements.text_body as TextElement
    const session=new PpteSession(document)
    const draft=new ImeTextEditSession(element,'slide_main','stale-revision')
    const content:RichTextDocument={paragraphs:[{id:'p',runs:[{id:'r',text:`保留 ${candidate}`}]}]}
    draft.input(content)
    assert.equal(session.commit(draft.finish('reject',session.getRevision())!).ok,false)
    assert.deepEqual(draft.getLocalContent(),content)
    draft.retryAfterRejectedCommit()
    assert.equal(draft.finish('retry',session.getRevision())!.baseRevision,'stale-revision')
    assert.deepEqual(draft.cancel(),element.content)
    assert.equal(session.getHistory().length,0)
    assert.deepEqual(session.getDocument(),document)
  }
})

test('E02 selected production bundles exclude the experiment, PM/history/cloud and a second canvas model',async()=>{
  for(const entry of ['packages/portable-runtime/src/browser.ts','packages/editor-react/src/HostApp.tsx']) {
    const result=await build({entryPoints:[entry],bundle:true,platform:'browser',write:false,metafile:true})
    const inputs=Object.keys(result.metafile!.inputs).join('\n')
    assert.doesNotMatch(inputs,/prosemirror|text-kernel-poc|text-kernel-prosemirror|yjs|tiptap/)
    assert.match(inputs,/richtext-adapter\/src\/index.ts/)
  }
  assert.equal(fixture.productionChoice,'native')
  assert.equal(JSON.parse(readFileSync('docs/evolution/quality/m1-dependency-budget.json','utf8')).version,fixture.budgetVersion)
})

test('E02 measurement evidence obeys frozen C01 sample counts, budgets and source identity', async()=>{
  const {createHash}=await import('node:crypto')
  const {percentile}=await import('../packages/performance-budget/src/index.js')
  const budget=JSON.parse(readFileSync('docs/evolution/quality/m1-dependency-budget.json','utf8'))
  const report=JSON.parse(readFileSync('docs/evolution/quality/e02-text-kernel-measurements.json','utf8'))
  assert.equal(report.protocolVersion,budget.version)
  for(const [path,hash] of Object.entries(report.sourceHashes))assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),hash)
  assert.equal(report.fixtureSha256,createHash('sha256').update(JSON.stringify(fixture)).digest('hex'))
  for(const key of budget.protocol.requiredEnvironment)assert.notEqual(report.environment[key],undefined,key)
  assert.deepEqual(report.candidates.map((c:any)=>c.candidate),['native','prosemirror'])
  for(const candidate of report.candidates) {
    assert.deepEqual(candidate.cases.map((c:any)=>c.pageCount),budget.protocol.pageCounts)
    for(const c of candidate.cases) {
      assert.match(c.fixtureRevision,/^sha256-[a-f0-9]{64}$/)
      assert.match(c.htmlSha256,/^[a-f0-9]{64}$/)
      for(const metric of ['cold','warm','input']) {
        assert.equal(c[metric].samplesMs.length,metric==='input'?budget.protocol.interactionSamples:budget.protocol.startupSamples)
        assert.ok(c[metric].samplesMs.every((n:number)=>Number.isFinite(n)&&n>0))
        assert.equal(c[metric].p95Ms,percentile(c[metric].samplesMs,.95))
        assert.equal(c[metric].p50Ms,percentile(c[metric].samplesMs,.5))
      }
      assert.equal(c.documentCorrect,true);assert.equal(c.activeNodeStable,true);assert.equal(c.unrelatedSemanticSlideStable,true)
      for(const [profile,cap] of Object.entries(budget.runtimeGzipCapsBytes))assert.ok(c.profileGzipBytes[profile]<=(cap as number))
    }
  }
  const [native,pm]=report.candidates
  for(const [metric,field] of [['runtimeRawBytes','bundleRawBytes'],['runtimeGzipBytes','bundleGzipBytes']])assert.equal(report.increments[metric],pm[field]-native[field])
  for(let i=0;i<pm.cases.length;i++)for(const [metric,field] of [['coldStartupP95Ms','cold'],['warmStartupP95Ms','warm'],['inputP95Ms','input']])assert.equal(report.increments.cases[i][metric],pm.cases[i][field].p95Ms-native.cases[i][field].p95Ms)
  const values=[...Object.entries(report.increments).filter(([k])=>k!=='cases'),...report.increments.cases.flatMap((c:any)=>Object.entries(c).filter(([k])=>k!=='pageCount'))]
  assert.equal(report.budgetPass,values.every(([key,value])=>(value as number)<=budget.incrementalLimits[key as string]))
  const adr=readFileSync('docs/evolution/decisions/text-kernel.md','utf8')
  for(const term of ['native','ProseMirror','c01-m1-v1','E03','unverified','Core','maintenance'])assert.ok(adr.includes(term),term)
  assert.doesNotMatch(pm.inputs.join('\n'),/prosemirror-history|prosemirror-collab|yjs|tiptap/)
})
