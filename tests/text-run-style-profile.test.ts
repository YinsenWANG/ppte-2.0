import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { TextElement, TextMarks, validateDocument, validTextMarks, withPersistedHistoryMetadata } from '../packages/schema/src/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { planTextReplacement } from '../packages/editor-controller/src/index.js'
import { setMarks, clearMarks, mixedMarks, positionAt, offsetOf, textOf, assertSafeRichText } from '../packages/richtext-adapter/src/index.js'
import { runFontFamilyCss, effectiveRunStyle, effectiveTextStyle, inspectGlyphCoverage, checkGlyphCoverage, measureRichTextLayout, measureTextLayout } from '../packages/validation/src/index.js'
import { TEXT_RUN_PROFILE, EDIT_PROFILE, GA_A_PROFILE, GA_B_PROFILE, GA_C_PROFILE, inferCompatibilityProfile, checkCompatibility, profileIncludes } from '../packages/compatibility/src/index.js'
import { buildCheckpointBytes, openCheckpointBytes } from '../packages/file-format/src/index.js'
import { buildPortableCheckpointBytes, createPortableFullPortable } from '../packages/portable-runtime/src/index.js'
import { renderSlideHtml, renderSlideSvg } from '../packages/renderer-react/src/index.js'
import { exportSemanticPptx } from '../packages/exporter-pptx/src/index.js'
import { exportPdf, exportPng } from '../packages/exporter-pdf/src/index.js'
import { readStoredZip } from '../packages/archive/src/index.js'
import { createPatch } from '../packages/reviewer/src/index.js'
import { encodePatch, decodePatch, validatePatch, applyPatchToDocument } from '../packages/patch-format/src/codec.js'
import { canonicalRevision } from '../packages/canonical-json/src/index.js'

function fixture() {
  const {document,imageBytes}=makeContractDocument()
  const element=document.slides.slide_main.elements.text_body as TextElement
  element.frame={x:40,y:240,width:1000,height:280}
  element.content={paragraphs:[{id:'p',runs:[{id:'r',text:'Cherry Studio'},{id:'keep',text:' unchanged',marks:{italic:true}}]},{id:'p2',runs:[{id:'r2',text:'中文'}]}]}
  document.theme.tokens.fontFamilies['font.run']='Arial'
  document.fonts.run={id:'run',family:'Arial',style:'normal',weight:400,source:'system',editableSafe:true,glyphCoverage:[{start:0,end:127}]}
  return {document,element,imageBytes}
}
const selection=(c:TextElement['content'],a=7,h=13)=>({anchor:positionAt(c,a,'backward'),head:positionAt(c,h,'forward')})
const marks:TextMarks={fontFamily:{kind:'token',token:'font.run'},fontSize:42}
function format(session:PpteSession,patch:Parameters<typeof setMarks>[2]=marks) {
  const element=session.getDocument().slides.slide_main.elements.text_body as TextElement
  const content=setMarks(element.content,selection(element.content),patch).content
  const tx=planTextReplacement({transactionId:`font-${session.getHistory().length}`,baseRevision:session.getRevision(),createdAt:'2026-09-06T00:00:00Z',slideId:'slide_main',elementId:element.id,content})!
  assert.equal(session.commit(tx).ok,true)
  return tx
}

test('E08 A08 inheritance, explicit mixed values, clear, reverse/cross-paragraph/caret ranges and stable IDs',()=>{
  const {document,element}=fixture(),base=structuredClone(element.content),style=effectiveTextStyle(document,element)
  assert.equal(effectiveRunStyle(document,element).fontSize,style.fontSize)
  assert.equal(runFontFamilyCss("Bob's Type"),`"Bob's Type"`)
  assert.equal(runFontFamilyCss('A"B'), '"A\\"B"')
  assert.equal(effectiveRunStyle(document,element,{fontFamily:{kind:'value',value:"Bob's Type"}}).fontFamily,"Bob's Type")
  element.content=setMarks(base,selection(base),{fontSize:42}).content
  assert.match(renderSlideHtml(document,'slide_main'),/<span style="font-size:42px">Studio<\/span>/,'size-only override must inherit the original family stack')
  element.content=base
  const result=setMarks(base,selection(base),marks)
  assert.deepEqual(result.content.paragraphs[0].runs.map(r=>[r.id,r.text]),[['r','Cherry '],['r:split:1','Studio'],['keep',' unchanged']])
  assert.deepEqual(result.content.paragraphs[1],base.paragraphs[1])
  assert.deepEqual(result.content.paragraphs[0].runs[2],base.paragraphs[0].runs[1])
  assert.equal(offsetOf(result.content,result.map(positionAt(base,10))),10)
  assert.deepEqual(setMarks(base,selection(base,13,7),marks).content,result.content)
  assert.deepEqual(effectiveRunStyle(document,element,marks),{...style,fontFamily:'Arial',fontSize:42,fontWeight:style.fontWeight})
  const mixed=mixedMarks(result.content,selection(result.content,0,13));assert.equal(mixed.fontSize,'mixed');assert.equal(mixed.fontFamily,'mixed')
  const equal=setMarks(base,selection(base),{fontSize:style.fontSize}).content
  assert.equal(mixedMarks(equal,selection(equal,0,13)).fontSize,'mixed','explicit equal override differs from inheritance')
  const cleared=clearMarks(result.content,selection(result.content)).content
  assert.equal(cleared.paragraphs[0].runs[1].marks,undefined)
  assert.equal(effectiveRunStyle(document,element,cleared.paragraphs[0].runs[1].marks).fontSize,style.fontSize)
  const whole=setMarks(base,selection(base,0,textOf(base).length),marks).content
  assert.ok(whole.paragraphs.every(p=>p.runs.every(r=>r.marks?.fontSize===42)))
  const caret=setMarks(base,selection(base,7,7),marks);assert.deepEqual(caret.content,base);assert.deepEqual(caret.pendingMarks,marks)
  for(const value of [0,-1,NaN,Infinity,'42',null]) {
    assert.equal(validTextMarks({fontSize:value}),false)
    if(value!==null)assert.throws(()=>setMarks(base,selection(base,7,7),{fontSize:value as number}),/marks/)
  }
})

test('E08 A03 registered complete profile, all literal mark readers and schema sites reject malformed overrides',()=>{
  assert.deepEqual(TEXT_RUN_PROFILE,{...EDIT_PROFILE,id:'ppte-2.1-text-run.1',schemaVersion:'2.1.0',migration:{from:[GA_A_PROFILE.id,GA_B_PROFILE.id,GA_C_PROFILE.id,EDIT_PROFILE.id],direction:'forward-only',preservesSource:true}})
  assert.ok(Object.isFrozen(TEXT_RUN_PROFILE.migration.from))
  for(const old of [GA_A_PROFILE,GA_B_PROFILE,GA_C_PROFILE,EDIT_PROFILE]){assert.ok(profileIncludes(TEXT_RUN_PROFILE.id,old.id));assert.equal(profileIncludes(old.id,TEXT_RUN_PROFILE.id),false)}
  assert.equal(checkCompatibility(TEXT_RUN_PROFILE).ok,true)
  assert.equal(checkCompatibility({...TEXT_RUN_PROFILE,schemaVersion:'2.0.0'}).ok,false)
  assert.equal(checkCompatibility({...TEXT_RUN_PROFILE,id:'unknown'}).disposition,'reject')
  for(const name of ['document','transaction']) {
    let count=0
    const visit=(value:any)=>{if(!value||typeof value!=='object')return;if(value.properties?.bold&&value.properties?.strike){count++;assert.deepEqual(value.properties.fontSize,{type:'number',exclusiveMinimum:0});assert.equal(value.additionalProperties,false);assert.equal(value.properties.fontFamily.oneOf.length,2)};Object.values(value).forEach(visit)}
    visit(JSON.parse(readFileSync(`schemas/${name}.schema.json`,'utf8')));assert.ok(count>0)
  }
  const {document,element}=fixture()
  assert.equal(inferCompatibilityProfile(document,{operations:[{opId:'props',kind:'component.updateProps',slideId:'slide_main',elementId:'widget',patch:{marks:{fontSize:42}}}]}),GA_C_PROFILE.id,'unrelated component props do not use Run font capabilities')
  for(const bad of [{fontSize:0},{fontSize:NaN},{fontSize:null},{fontFamily:{kind:'value',value:''}},{fontFamily:{kind:'token',token:''}},{fontFamily:{kind:'value',value:'Arial',evil:1}},{fontFamily:null},{fontFamily:'Arial'},{fontWeight:900}]) {
    element.content.paragraphs[0].runs[0].marks=bad as TextMarks
    assert.ok(validateDocument(document).some(i=>i.severity==='error'),JSON.stringify(bad))
    assert.throws(()=>assertSafeRichText(element.content))
    assert.throws(()=>buildCheckpointBytes(document,{assetBytes:{asset_pixel:fixture().imageBytes}}))
  }
  element.content.paragraphs[0].runs[0].marks=marks
  assert.equal(validateDocument(document).filter(i=>i.severity==='error').length,0)
  assert.doesNotThrow(()=>assertSafeRichText(element.content))
  document.schemaVersion='2.1.0';assert.equal(validateDocument(document).filter(i=>i.severity==='error').length,0)
})

test('E08 A03/A08 both checkpoint writers retain marks and exact undo/redo, including redo-only and inverse-only profile requirements',()=>{
  const {document,imageBytes}=fixture(),session=new PpteSession(document),original=session.getRevision()
  const tx=format(session),after=session.getRevision()
  const history=session.getHistory().map(e=>withPersistedHistoryMetadata(e.transaction,e))
  assert.equal(inferCompatibilityProfile(document,{operations:tx.operations}),TEXT_RUN_PROFILE.id)
  const inverseOnly=withPersistedHistoryMetadata({...tx,operations:[]},{inverse:tx,beforeRevision:original,afterRevision:after})
  assert.equal(inferCompatibilityProfile(document,{recentTransactions:[inverseOnly]}),TEXT_RUN_PROFILE.id)
  for(const write of [buildCheckpointBytes,buildPortableCheckpointBytes]) {
    const options={assetBytes:{asset_pixel:imageBytes},recentTransactions:history}
    const opened=openCheckpointBytes(write(session.getDocument(),options))
    assert.equal(opened.manifest.schemaVersion,'2.1.0');assert.equal(opened.manifest.compatibilityProfile,TEXT_RUN_PROFILE.id)
    const restored=new PpteSession(opened.document);assert.equal(restored.undo().ok,true);assert.equal(restored.getRevision(),original)
    const redoOpened=openCheckpointBytes(write(restored.getDocument(),{assetBytes:options.assetBytes,redoHistory:[...restored.getRedoHistory()]}))
    assert.equal(redoOpened.manifest.compatibilityProfile,TEXT_RUN_PROFILE.id)
    const redo=new PpteSession(redoOpened.document);assert.equal(redo.redo().ok,true);assert.equal(redo.getRevision(),after)
    assert.throws(()=>write(session.getDocument(),{...options,compatibilityProfile:EDIT_PROFILE.id}),/requires compatibility profile/)
    assert.throws(()=>write(restored.getDocument(),{assetBytes:options.assetBytes,redoHistory:[...restored.getRedoHistory()],compatibilityProfile:EDIT_PROFILE.id}),/requires compatibility profile/)
  }
  format(session,{fontSize:null,fontFamily:null});assert.equal(inferCompatibilityProfile(session.getDocument(),{recentTransactions:session.getHistory().map(e=>withPersistedHistoryMetadata(e.transaction,e))}),TEXT_RUN_PROFILE.id)
})

test('E08 A03 patch inference, serialized roundtrip and old target rejection preserve source identity',()=>{
  const {document}=fixture(),session=new PpteSession(document);format(session)
  const before=canonicalRevision(document),patch=createPatch(document,session.getDocument())
  assert.equal(patch.manifest.compatibilityProfile,TEXT_RUN_PROFILE.id)
  const decoded=decodePatch(encodePatch(patch));assert.equal(validatePatch(decoded).ok,true)
  assert.equal(canonicalRevision(applyPatchToDocument(document,decoded).document!),session.getRevision())
  const downgraded=structuredClone(decoded);downgraded.manifest.compatibilityProfile=EDIT_PROFILE.id
  assert.equal(validatePatch(downgraded).ok,false);assert.throws(()=>encodePatch(downgraded))
  const malformed=structuredClone(decoded);(malformed.operations.find(o=>o.kind==='text.replaceContent') as any).content.paragraphs[0].runs[1].marks.fontSize=0
  assert.equal(validatePatch(malformed).ok,false)
  assert.equal(canonicalRevision(document),before)
})

test('E08 A08/A17 the shared resolver drives per-run coverage, reference measurement, HTML, SVG and native PPTX properties',()=>{
  const {document,element,imageBytes}=fixture(),oldHeight=measureRichTextLayout(document,element).contentHeight
  element.content=setMarks(element.content,selection(element.content),marks).content
  assert.ok(measureRichTextLayout(document,element).contentHeight>oldHeight)
  assert.equal(inspectGlyphCoverage(document,element,undefined,{strict:true}).covered,true)
  const html=renderSlideHtml(document,'slide_main'),svg=renderSlideSvg(document,'slide_main')
  assert.match(html,/font-family:&quot;Arial&quot;;font-size:42px/)
  assert.match(svg,/<tspan[^>]*font-family="&quot;Arial&quot;"[^>]*font-size="42"[^>]*>Studio<\/tspan>/)
  const pptx=exportSemanticPptx(document,{assetBytes:{asset_pixel:imageBytes}});assert.equal(pptx.ok,true)
  const xml=new TextDecoder().decode(readStoredZip(pptx.bytes).get('ppt/slides/slide1.xml'))
  assert.match(xml,/<a:rPr[^>]*sz="3150"[^>]*>.*?<a:latin typeface="Arial"\/>.*?<a:ea typeface="Arial"\/>.*?<\/a:rPr><a:t>Studio<\/a:t>/)
  const report=pptx.capabilityReport.items.find(i=>i.elementId===element.id)!
  assert.ok(report.runFonts?.some(f=>f.fontFamily==='Arial'&&f.fontSize===42))
  assert.equal(report.status,'font-replacement','Office substitution remains reported, not full fidelity')
  element.content.paragraphs[1].runs[0].marks=marks
  assert.deepEqual(inspectGlyphCoverage(document,element,undefined,{strict:true}).missingCodePoints,[20013,25991])
  assert.ok(checkGlyphCoverage(document,element).length)
  element.content.paragraphs[1].runs[0].marks={fontFamily:{kind:'token',token:'font.missing'}}
  assert.equal(inspectGlyphCoverage(document,element).source,'unresolved')
  assert.ok(checkGlyphCoverage(document,element).length)
})

test('E08 A03 legacy documents retain their layout, schema/profile and source bytes on save',()=>{
  const {document,element,imageBytes}=fixture(),before=JSON.stringify(document),profile=inferCompatibilityProfile(document)
  const html=renderSlideHtml(document,'slide_main'),svg=renderSlideSvg(document,'slide_main')
  assert.deepEqual(measureRichTextLayout(document,element),measureTextLayout(textOf(element.content),element.frame,effectiveTextStyle(document,element),element.boxStyle?.padding))
  for(const write of [buildCheckpointBytes,buildPortableCheckpointBytes]) {
    const opened=openCheckpointBytes(write(document,{assetBytes:{asset_pixel:imageBytes}}))
    assert.equal(opened.manifest.schemaVersion,'2.0.0');assert.equal(opened.manifest.compatibilityProfile,profile)
    assert.equal(renderSlideHtml(opened.document,'slide_main'),html);assert.equal(renderSlideSvg(opened.document,'slide_main'),svg)
  }
  const legacyPptx=exportSemanticPptx(document,{assetBytes:{asset_pixel:imageBytes}})
  assert.equal(legacyPptx.ok,true)
  const legacyXml=new TextDecoder().decode(readStoredZip(legacyPptx.bytes).get('ppt/slides/slide1.xml'))
  assert.doesNotMatch(legacyXml,/<a:(ea|cs) /,'legacy PPTX must retain the pre-extension inherited East Asian/complex-script mapping')
  assert.equal(JSON.stringify(document),before)
})

for(const host of [false,true])test(`E08 A08/A17 ${host?'Host':'Portable'} browser range font controls, mixed/clear, caret, save/reopen and measured pixels`,async()=>{
  const dir=mkdtempSync(join(tmpdir(),'e08-browser-')),{document:doc,imageBytes}=fixture()
  let file:string
  if(host){const built=spawnSync('pnpm',['host:build','--outDir',join(dir,'host')],{encoding:'utf8'});assert.equal(built.status,0,built.stdout+built.stderr);file=join(dir,'host/index.html');writeFileSync(join(dir,'deck.ppte'),buildCheckpointBytes(doc,{assetBytes:{asset_pixel:imageBytes}}))}
  else{const built=createPortableFullPortable(doc,{assetBytes:{asset_pixel:imageBytes}});assert.equal(built.ok,true,JSON.stringify(built.issues));file=join(dir,'deck.html');writeFileSync(file,built.html)}
  const browser=await chromium.launch({headless:true})
  try {
    const page=await browser.newPage({viewport:{width:1600,height:1100}})
    mkdirSync('artifacts/e08',{recursive:true})
    await page.context().tracing.start({screenshots:true,snapshots:true})
    await page.goto(pathToFileURL(file).href)
    if(host){await page.waitForFunction(()=>document.querySelector('[data-ppte-ready]')?.getAttribute('data-ppte-ready')==='true');await page.locator('[data-ppte-action=open]').setInputFiles(join(dir,'deck.ppte'))}
    const apiName=host?'PPTEHost':'PPTEPortable'
    await page.waitForFunction(name=>!!(globalThis as any)[name],apiName)
    const editor=page.locator('[data-ppte-stage] [data-ppte-element-id=text_body]').first()
    const select=async(a=7,b=13)=>{
      await editor.evaluate((node,[a,b])=>{
        node.focus();const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let n:Node|null,at=0,start:{n:Node;o:number}|undefined,end:{n:Node;o:number}|undefined
        while((n=walker.nextNode())){const len=n.textContent!.length;if(!start&&a>=at&&a<=at+len)start={n,o:a-at};if(!end&&b>=at&&b<=at+len)end={n,o:b-at};at+=len}
        document.getSelection()!.setBaseAndExtent(start!.n,start!.o,end!.n,end!.o)
      },[a,b]);await page.waitForTimeout(30)
    }
    const getDoc=()=>page.evaluate(name=>(globalThis as any)[name].getDocument(),apiName)
    const depth=()=>page.evaluate(name=>(globalThis as any)[name].getHistory().length,apiName)
    await select()
    const originalDepth=await depth()
    const family=page.getByLabel('选区字体',{exact:true}),size=page.getByLabel('选区字号',{exact:true})
    const contrast=await family.evaluate(input=>{
      const label=input.parentElement!,panel=label.parentElement!,rgb=(value:string)=>value.match(/\d+/g)!.slice(0,3).map(Number)
      const luminance=(v:number[])=>v.map(n=>{const c=n/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4}).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0)
      const a=luminance(rgb(getComputedStyle(label).color)),b=luminance(rgb(getComputedStyle(panel).backgroundColor))
      return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)
    })
    assert.ok(contrast>=4.5,'font control labels must remain readable in both shells')
    await family.fill('@font.run');await family.dispatchEvent('change')
    await select()
    await size.fill('42');await size.dispatchEvent('change')
    const current=await getDoc(),runs=current.slides.slide_main.elements.text_body.content.paragraphs[0].runs
    assert.deepEqual(runs[1].marks,marks)
    assert.equal(runs[0].marks,undefined);assert.equal(runs[2].id,'keep')
    assert.equal(await depth(),originalDepth+2)
    const pixels=await editor.evaluate(node=>{
      const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let n:Node|null;const result:Record<string,{family:string;size:string;height:number}>={}
      while((n=walker.nextNode()))if(['Studio','Cherry '].includes(n.textContent!)){const range=document.createRange();range.selectNodeContents(n);const style=getComputedStyle(n.parentElement!);result[n.textContent!]={family:style.fontFamily,size:style.fontSize,height:range.getBoundingClientRect().height}}
      return result
    })
    assert.match(pixels.Studio.family,/Arial/);assert.equal(pixels.Studio.size,'42px');assert.ok(pixels.Studio.height>pixels['Cherry '].height)
    await page.screenshot({path:`artifacts/e08/${host?'host':'portable'}-run-fonts.png`})
    await select(0,13);assert.equal(await size.getAttribute('data-value-state'),'mixed')
    await select();await size.fill('');await size.dispatchEvent('change')
    assert.equal((await getDoc()).slides.slide_main.elements.text_body.content.paragraphs[0].runs[1].marks.fontSize,undefined)
    await select();await size.fill('42');await size.dispatchEvent('change')
    await select(7,7);const beforeCaret=await depth()
    assert.equal(await page.evaluate(name=>(globalThis as any)[name].setTextMarks({fontSize:36}).ok,apiName),true)
    assert.equal(await depth(),beforeCaret)
    await page.keyboard.type('X');await editor.blur()
    const savedDoc=await getDoc();assert.ok(savedDoc.slides.slide_main.elements.text_body.content.paragraphs[0].runs.some((r:any)=>r.text==='X'&&r.marks.fontSize===36))
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('[data-ppte-action=save]').dispatchEvent('click')])
    const saved=join(dir,'saved.ppte');await download.saveAs(saved)
    const opened=openCheckpointBytes(new Uint8Array(readFileSync(saved)))
    assert.equal(opened.manifest.compatibilityProfile,TEXT_RUN_PROFILE.id)
    const reopened=new PpteSession(opened.document);assert.equal(reopened.getRevision(),canonicalRevision(savedDoc));assert.equal(reopened.undo().ok,true);assert.equal(reopened.redo().ok,true)
    assert.equal(reopened.getRevision(),canonicalRevision(savedDoc))
    await page.context().tracing.stop({path:`artifacts/e08/${host?'host':'portable'}-run-fonts.zip`})
  } finally {await browser.close();rmSync(dir,{recursive:true,force:true})}
})

test('E08 A17 real browser PDF/PNG paths render run font overrides and preserve report identity',()=>{
  const {document,element,imageBytes}=fixture(),options={assetBytes:{asset_pixel:imageBytes}}
  const old=exportPng(document,{...options,slideId:'slide_main',width:640,height:360});assert.equal(old.ok,true)
  element.content=setMarks(element.content,selection(element.content),marks).content
  const png=exportPng(document,{...options,slideId:'slide_main',width:640,height:360});assert.equal(png.ok,true)
  assert.notDeepEqual(png.bytes,old.bytes)
  assert.notEqual(png.capabilityReport.sourceRevision,old.capabilityReport.sourceRevision)
  const pdf=exportPdf(document,options);assert.equal(pdf.ok,true);assert.equal(new TextDecoder().decode(pdf.bytes.slice(0,5)),'%PDF-')
  assert.equal(pdf.capabilityReport.sourceRevision,canonicalRevision(document))
  assert.ok(pdf.capabilityReport.items.find(i=>i.elementId===element.id)?.runFonts?.some(f=>f.fontSize===42&&f.fontFamily==='Arial'))
})

test('E08 A03/A13 literal JSON Schema readers validate new document/transaction/profile/report and frozen old readers reject new properties',()=>{
  const {document,imageBytes}=fixture(),session=new PpteSession(document),tx=format(session)
  const opened=openCheckpointBytes(buildCheckpointBytes(session.getDocument(),{assetBytes:{asset_pixel:imageBytes}}))
  const report=exportSemanticPptx(session.getDocument(),{assetBytes:{asset_pixel:imageBytes}}).capabilityReport
  const legacy=JSON.parse(readFileSync('tests/fixtures/evolution/text-run-legacy-reader.json','utf8'))
  const oldManifest=openCheckpointBytes(buildCheckpointBytes(document,{assetBytes:{asset_pixel:imageBytes}})).manifest
  const result=spawnSync('python',['-c',`
import json,sys
from jsonschema import Draft202012Validator as Validator
v=json.load(sys.stdin)
for name,value in [('document',v['document']),('transaction',v['transaction']),('manifest',v['manifest']),('compatibility-profile',v['profile']),('capability-report',v['report'])]:
    schema=json.load(open('schemas/'+name+'.schema.json'))
    Validator.check_schema(schema)
    Validator(schema).validate(value)
for profile in v['oldProfiles']:
    Validator(json.load(open('schemas/compatibility-profile.schema.json'))).validate(profile)
old=v['legacy']
Validator(old['manifest']).validate(v['oldManifest'])
assert not Validator(old['manifest']).is_valid(v['manifest'])
assert Validator(old['marks']).is_valid({'bold':True})
assert not Validator(old['marks']).is_valid(v['marks'])
assert not Validator(json.load(open('schemas/compatibility-profile.schema.json'))).is_valid(dict(v['profile'],schemaVersion='2.0.0'))
# Every inline Run marks reader has the same positive and negative contract.
def walk(value):
    if isinstance(value,dict):
        if 'properties' in value and 'bold' in value['properties'] and 'strike' in value['properties']:
            reader=Validator(value)
            assert reader.is_valid(v['marks'])
            for bad in [{'fontSize':0},{'fontSize':None},{'fontFamily':'Arial'},{'fontFamily':{'kind':'value','value':''}},{'fontFamily':{'kind':'token','token':''}}]:
                assert not reader.is_valid(bad)
        for child in value.values():walk(child)
    elif isinstance(value,list):
        for child in value:walk(child)
for name in ['document','transaction']:walk(json.load(open('schemas/'+name+'.schema.json')))
print('validated current and frozen legacy contracts')
`],{input:JSON.stringify({document:opened.document,transaction:tx,manifest:opened.manifest,profile:TEXT_RUN_PROFILE,report,legacy,oldManifest,marks,oldProfiles:[GA_A_PROFILE,GA_B_PROFILE,GA_C_PROFILE,EDIT_PROFILE]}),encoding:'utf8'})
  assert.equal(result.status,0,result.stdout+result.stderr)
  assert.match(result.stdout,/validated current and frozen legacy contracts/)
})

test('E08 A03 schema verification retains all existing operation kinds and the complete legacy profile example',()=>{
  const result=spawnSync('python',['scripts/validate.py'],{encoding:'utf8'})
  assert.equal(result.status,0,result.stdout+result.stderr)
  assert.match(result.stdout,/operation parity/)
})
