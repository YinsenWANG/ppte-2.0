import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {chromium,type Page} from 'playwright'
import {editRichText} from '../packages/richtext-adapter/src/index.js'
import {buildCheckpointBytes,openCheckpoint} from '../packages/file-format/src/index.js'
import type {RichTextDocument} from '../packages/schema/src/index.js'

test('text replacement retains untouched paragraph identity and marks across Unicode insert/delete',()=>{
  const original:RichTextDocument={paragraphs:[{id:'a',list:{type:'bullet'},runs:[{id:'r1',text:'Hello ',marks:{bold:true}},{id:'r2',text:'世界😀',marks:{italic:true}}]},{id:'b',runs:[{id:'r3',text:'Keep',marks:{underline:true}}]}]}
  const changed=editRichText(original,'Hello 世界新😀\nKeep')
  assert.deepEqual(changed.paragraphs[1],original.paragraphs[1])
  assert.deepEqual(changed.paragraphs[0].runs[0],original.paragraphs[0].runs[0])
  assert.deepEqual(changed.paragraphs[0].runs[1].marks,{italic:true})
  assert.equal(changed.paragraphs[0].runs[1].text,'世界新😀')
  assert.deepEqual(changed.paragraphs[0].list,{type:'bullet'})
  assert.deepEqual(editRichText(original,'Hello 世界😀\nKeep'),original)
})

test('Host persists edits/undo/redo, rejects stale tabs, retains marks, moves groups, and reviews conflicts',async()=>{
  const build=spawnSync('pnpm',['host:build'],{encoding:'utf8'})
  assert.equal(build.status,0,build.stderr||build.stdout)
  const dir=mkdtempSync(join(tmpdir(),'ppte-host-completion-'))
  const browser=await chromium.launch({headless:true})
  const context=await browser.newContext({viewport:{width:1600,height:1100},acceptDownloads:true})
  const page=await context.newPage()
  const url=pathToFileURL(resolve('apps/host/dist/index.html')).href
  const title=(p:Page)=>p.locator('[data-ppte-stage] [data-ppte-element-id="text_title"]').first()
  const flush=()=>page.locator('[data-ppte-notes-input]').click()
  async function save(){const [d]=await Promise.all([page.waitForEvent('download'),page.locator('[data-ppte-action="save"]').click()]);const path=await d.path();assert.ok(path);return openCheckpoint(path).document}
  try{
    await page.goto(url)
    await title(page).fill('Recovered title');await flush()
    await page.waitForFunction(()=>document.querySelector('[data-ppte-host]')?.getAttribute('data-ppte-history-depth')==='1')
    await page.reload();await page.locator('[data-ppte-action="new"]').waitFor();await page.waitForFunction(()=>document.querySelector('[data-ppte-status]')?.textContent?.includes('恢复'))
    assert.equal(await title(page).innerText(),'Recovered title')
    await page.locator('[data-ppte-action="undo"]').click();await page.reload()
    await page.waitForFunction(()=>document.querySelector('[data-ppte-redo-depth]')?.getAttribute('data-ppte-redo-depth')==='1')
    assert.equal(await title(page).innerText(),'Untitled presentation')
    await page.locator('[data-ppte-action="redo"]').click();assert.equal(await title(page).innerText(),'Recovered title')
    const other=await context.newPage();await other.goto(url);await other.waitForFunction(()=>document.querySelector('[data-ppte-status]')?.textContent?.includes('恢复'))
    await title(page).fill('First tab wins');await flush()
    await title(other).fill('Stale tab');await other.locator('[data-ppte-notes-input]').click()
    assert.match(await other.locator('[data-ppte-status]').innerText(),/Another editor|REVISION_CONFLICT/)
    await other.close()
    const {makeCoreFixture,IDS}=await import(pathToFileURL(resolve('scripts/blackbox-fixtures.mjs')).href)
    const fixture=makeCoreFixture();const doc=fixture.document
    doc.slides[IDS.slide].groups={cards:{id:'cards',memberIds:[IDS.body,IDS.image]}}
    doc.slides[IDS.slide].elements[IDS.title].content.paragraphs[0].runs[0].marks={bold:true,italic:true}
    const base=join(dir,'base.ppte');writeFileSync(base,buildCheckpointBytes(doc,{assetBytes:{[IDS.asset]:fixture.imageBytes}}))
    await page.locator('[data-ppte-action="open"]').setInputFiles(base);await page.waitForFunction(()=>document.querySelector('[data-ppte-status]')?.textContent?.includes('已打开'))
    await page.locator(`[data-ppte-stage] [data-ppte-element-id="${IDS.title}"]`).click()
    await page.getByRole('textbox',{name:'文字',exact:true}).fill('局部修订');await flush()
    const saved=await save();const el=saved.slides[IDS.slide].elements[IDS.title];assert.equal(el.type,'text');if(el.type==='text')assert.deepEqual(el.content.paragraphs[0].runs[0].marks,{bold:true,italic:true})
    await page.locator(`[data-ppte-stage] [data-ppte-element-id="${IDS.body}"]`).click()
    await page.getByRole('spinbutton',{name:'x',exact:true}).fill('200');await flush()
    const moved=await save();assert.equal(moved.slides[IDS.slide].elements[IDS.body].frame.x,200);assert.equal(moved.slides[IDS.slide].elements[IDS.image].frame.x,1160)
    const revised=structuredClone(doc);revised.slides[IDS.slide].elements[IDS.title].content.paragraphs[0].runs[0].text='对方标题';revised.slides[IDS.slide].elements[IDS.body].content.paragraphs[0].runs[0].text='Accepted revised body'
    const copy=join(dir,'revised.ppte');writeFileSync(copy,buildCheckpointBytes(revised,{assetBytes:{[IDS.asset]:fixture.imageBytes}}))
    await page.getByRole('button',{name:'比较修订副本',exact:true}).click()
    await page.locator('[data-ppte-review-base]').setInputFiles(base);await page.locator('[data-ppte-review-revised]').setInputFiles(copy)
    await page.locator('[data-ppte-review] select').first().waitFor()
    const selects=page.locator('[data-ppte-review] select')
    for(let i=0;i<await selects.count();i++){const label=await selects.nth(i).getAttribute('aria-label');await selects.nth(i).selectOption(label?.includes(IDS.body)&&label?.includes('content')?'revised':'local')}
    await page.getByRole('button',{name:'预览选中修订'}).click()
    await page.locator('[data-ppte-preview]').waitFor();await page.getByRole('button',{name:'接受修改',exact:true}).click()
    const accepted=await save();const body=accepted.slides[IDS.slide].elements[IDS.body];assert.equal(body.type,'text');if(body.type==='text')assert.equal(body.content.paragraphs[0].runs[0].text,'Accepted revised body')
    const kept=accepted.slides[IDS.slide].elements[IDS.title];if(kept.type==='text')assert.equal(kept.content.paragraphs[0].runs[0].text,'局部修订')
    await page.getByRole('button',{name:'关闭比较'}).click();await page.locator('[data-ppte-action="undo"]').click()
    const undone=await save();assert.deepEqual(undone.slides[IDS.slide].elements[IDS.body],moved.slides[IDS.slide].elements[IDS.body])
    const {createPatch}=await import('../packages/reviewer/src/index.js');const {encodePatch}=await import('../packages/patch-format/src/codec.js');const {sha256HexBytes}=await import('../packages/canonical-json/src/index.js')
    const imageRevision=structuredClone(undone);const replacement=new Uint8Array([...fixture.imageBytes,0]);imageRevision.assets[IDS.asset].hash=`sha256-${sha256HexBytes(replacement)}`;imageRevision.assets[IDS.asset].byteLength=replacement.length;imageRevision.assets[IDS.asset].path=`assets/${sha256HexBytes(replacement)}.png`
    const patchPath=join(dir,'image.ppte.patch');writeFileSync(patchPath,encodePatch(createPatch(undone,imageRevision,{assetBytes:{[IDS.asset]:replacement}})))
    await page.locator('input[accept=".patch"]').setInputFiles(patchPath);await page.locator('[data-ppte-preview]').waitFor();await page.getByRole('button',{name:'接受修改',exact:true}).click()
    assert.equal((await save()).assets[IDS.asset].hash,imageRevision.assets[IDS.asset].hash)
    await page.reload();await page.waitForFunction(()=>document.querySelector('[data-ppte-host]')?.getAttribute('data-ppte-ready')==='true')
    await page.locator('[data-ppte-action="undo"]').click();assert.equal((await save()).assets[IDS.asset].hash,undone.assets[IDS.asset].hash)
    await page.getByRole('button',{name:'布局工作室',exact:true}).click()
    await page.getByRole('combobox',{name:'布局版本',exact:true}).selectOption('explanation.text-visual@1.0.0')
    const region=page.getByRole('button',{name:'区域 title',exact:true});const box=await region.boundingBox();assert.ok(box)
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+30,box.y+box.height/2+10);await page.mouse.up()
    assert.ok(Number(await page.getByRole('spinbutton',{name:'区域 x',exact:true}).inputValue())>.08)
    await page.getByRole('textbox',{name:'布局名称',exact:true}).fill('test.saved-layout')
    await page.getByRole('button',{name:'保存新版本',exact:true}).click()
    await page.getByRole('button',{name:'批量测试当前页与边界样本',exact:true}).click()
    assert.match(await page.locator('[data-ppte-recipe-report]').innerText(),/17/)
    await page.getByRole('button',{name:'关闭工作室',exact:true}).click()
    await page.reload();await page.waitForFunction(()=>document.querySelector('[data-ppte-host]')?.getAttribute('data-ppte-ready')==='true')
    await page.getByRole('button',{name:'布局工作室',exact:true}).click()
    await page.getByRole('combobox',{name:'布局版本',exact:true}).selectOption('test.saved-layout@1.0.0')
    assert.equal(await page.getByRole('textbox',{name:'布局名称',exact:true}).inputValue(),'test.saved-layout')
    await page.getByRole('button',{name:'关闭工作室',exact:true}).click()
    const future=join(dir,'future.json');writeFileSync(future,JSON.stringify({...undone,schemaVersion:'3.0.0'}));await page.locator('[data-ppte-action="open"]').setInputFiles(future);await page.locator('[data-ppte-unsupported]').waitFor();assert.match(await page.locator('[data-ppte-unsupported]').innerText(),/只读检查/);await page.getByRole('button',{name:'关闭只读检查',exact:true}).click();assert.equal((await save()).schemaVersion,'2.0.0')
    // A damaged journal must not be silently replaced by an empty document.
    const raw=await page.evaluate(()=>localStorage.getItem('ppte.host.recovery.v1'))
    await page.evaluate(()=>localStorage.setItem('ppte.host.recovery.v1','{"version":999}'))
    await page.reload();await page.waitForFunction(()=>document.querySelector('[data-ppte-status]')?.textContent?.includes('原恢复数据已保留'))
    assert.equal(await page.locator('[data-ppte-host]').getAttribute('data-ppte-ready'),'false')
    assert.equal(await page.evaluate(()=>localStorage.getItem('ppte.host.recovery.v1')),'{"version":999}')
    await page.evaluate(raw=>localStorage.setItem('ppte.host.recovery.v1',raw!),raw)
  }finally{await browser.close();rmSync(dir,{recursive:true,force:true})}
})
