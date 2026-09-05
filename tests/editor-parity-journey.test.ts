import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {chromium,type Page} from 'playwright'
import {createEmptyDocument} from '../packages/authoring/src/default-document.js'
import {PortableRuntime,buildPortable} from '../packages/portable-runtime/src/index.js'
import {openCheckpoint} from '../packages/file-format/src/index.js'

const api = (page:Page, code:string):Promise<any> => page.evaluate(code)
const editor = '(window.PPTEHost || window.PPTEPortable)'

test('E07 A08 legacy plain-text signatures preserve marks, reject stale revisions and share Core undo',()=>{
  const document=createEmptyDocument(),slideId=document.slideOrder[0]
  const text=document.slides[slideId].elements.text_title
  assert.equal(text.type,'text');if(text.type!=='text')throw Error('fixture')
  text.content.paragraphs[0].runs[0].marks={bold:true}
  const runtime=new PortableRuntime(document,{profile:'full-portable'})
  const revision=runtime.getRevision()
  assert.equal(runtime.editText({elementId:'text_title'},'Updated title',revision).ok,true)
  assert.equal(runtime.getHistory().length,1)
  const edited=runtime.getDocument().slides[slideId].elements.text_title
  assert.equal(edited.type,'text');if(edited.type==='text')assert.deepEqual(edited.content.paragraphs[0].runs[0].marks,{bold:true})
  assert.equal(runtime.editText({elementId:'text_title'},'Stale',revision).ok,false)
  assert.equal(runtime.getHistory().length,1)
  assert.equal(runtime.undo().ok,true);assert.deepEqual(runtime.getDocument(),document)
  assert.equal(runtime.redo().ok,true)
  assert.equal(runtime.editText({elementId:'text_title'},'Updated again').ok,true)
  assert.equal(runtime.getHistory().length,2)
  runtime.dispose()
})

test('E07 A06/A08/A11/A21 identical Host and file Portable keyboard, edit, undo, save, reopen, present, export journey',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ppte-e07-'))
  const evidence=resolve('artifacts/e07');mkdirSync(evidence,{recursive:true})
  const build=spawnSync('pnpm',['host:build','--outDir',join(dir,'host')],{encoding:'utf8'})
  assert.equal(build.status,0,build.stderr||build.stdout)
  const blank=createEmptyDocument()
  const portable=buildPortable(blank,{profile:'full-portable'})
  assert.equal(portable.ok,true)
  const portablePath=join(dir,'new.ppte.html');writeFileSync(portablePath,portable.html)
  const browser=await chromium.launch({headless:true})
  try {
    for(const host of [true,false]){
      const name=host?'host':'portable'
      const context=await browser.newContext({viewport:{width:1600,height:1100},acceptDownloads:true})
      await context.tracing.start({screenshots:true,snapshots:true})
      const page=await context.newPage()
      await page.goto(pathToFileURL(host?join(dir,'host/index.html'):portablePath).href)
      await page.waitForFunction(()=>Boolean((window as any).PPTEHost||(window as any).PPTEPortable))
      if(host)await page.locator('[data-ppte-action=new]').click()
      assert.equal(await api(page,`${editor}.enterEdit().ok`),true)
      assert.equal(await api(page,`${editor}.setTextMarks({bold:true}).ok`),false,'format requires text session')
      for(const width of [1600,700]){
        await page.setViewportSize({width,height:1100})
        for(const selector of ['[data-ppte-pages-panel]','[data-ppte-properties-panel]']){
          const summary=page.locator(`${selector}>summary`)
          await summary.focus();await page.keyboard.press('Space')
          assert.equal(await page.locator(selector).getAttribute('open'),null)
          await page.keyboard.press('Enter');assert.notEqual(await page.locator(selector).getAttribute('open'),null)
          await page.keyboard.press('Escape');assert.equal(await page.locator(selector).getAttribute('open'),null)
          assert.equal(await summary.evaluate(n=>n===document.activeElement),true)
          await page.keyboard.press('Enter')
        }
        assert.equal(await page.locator('[data-ppte-thumbnails] button').count(),1)
        await page.locator('[data-ppte-slide-index="0"]').focus();await page.keyboard.press('Enter')
        const tools=page.locator('.ppte-tools>summary');if(await tools.count())await tools.click()
        const file=page.locator('[data-ppte-action=import-image]');await file.focus()
        assert.equal(await file.evaluate(n=>n===document.activeElement),true)
        assert.equal(await file.evaluate(n=>getComputedStyle(n).display!=='none'),true)
        await page.screenshot({path:join(evidence,`${name}-${width}.png`)})
        if(await tools.count())await tools.click()
      }
      await page.setViewportSize({width:1600,height:1100})
      const title=()=>page.locator('[data-ppte-stage] [data-ppte-element-id="text_title"]')
      await title().fill('Cherry Studio')
      await page.locator('[data-ppte-properties-panel]>summary').focus()
      const depth=await api(page,`${editor}.getHistory().length`)
      assert.equal(depth,1)
      await title().focus()
      await title().evaluate(n=>{
        const walker=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);const text=walker.nextNode()!
        document.getSelection()!.setBaseAndExtent(text,7,text,13)
      })
      await page.keyboard.press('ControlOrMeta+b')
      assert.equal(await api(page,`${editor}.getHistory().length`),depth+1)
      const formatted=await api(page,`${editor}.getDocument()`)
      const first=formatted.slides[formatted.slideOrder[0]].elements.text_title
      assert.deepEqual(first.content.paragraphs[0].runs.map((r:any)=>[r.text,Boolean(r.marks?.bold)]),[['Cherry ',false],['Studio',true]])
      await api(page,`${editor}.undo()`);assert.equal(await api(page,`${editor}.getHistory().length`),depth)
      await api(page,`${editor}.redo()`)
      // Shared property planner, one transaction, then reversible geometry.
      await title().click()
      await page.getByRole('spinbutton',{name:'整框字号',exact:true}).fill('48')
      await page.getByRole('spinbutton',{name:'整框字号',exact:true}).press('Tab')
      const changed=await api(page,`${editor}.getDocument()`)
      assert.equal(changed.slides[changed.slideOrder[0]].elements.text_title.style.overrides.fontSize,48)
      await api(page,`${editor}.undo()`);await api(page,`${editor}.redo()`)
      const savedRevision=await api(page,`${editor}.getRevision()`)
      if(host){
        const projectDownload=page.waitForEvent('download')
        await page.locator('[data-ppte-action=save]').click()
        const project=await projectDownload;const projectPath=join(dir,'host-reopen.ppte');await project.saveAs(projectPath)
        await page.locator('[data-ppte-action=open]').setInputFiles(projectPath)
        await page.waitForFunction(()=>document.querySelector('[data-ppte-status]')?.textContent?.includes('已打开'))
        assert.equal(await api(page,`${editor}.getRevision()`),savedRevision)
        await api(page,`${editor}.undo()`);assert.notEqual(await api(page,`${editor}.getRevision()`),savedRevision)
        await api(page,`${editor}.redo()`);assert.equal(await api(page,`${editor}.getRevision()`),savedRevision)
      }
      await api(page,`${editor}.enterPresentation()`)
      await page.waitForFunction(()=>((window as any).PPTEHost||(window as any).PPTEPortable).getMode()==='present')
      assert.equal(await page.locator('[contenteditable=true]').count(),0)
      assert.equal(await page.locator('[aria-label="选区格式"]:visible').count(),0)
      assert.equal(await page.locator('[data-ppte-pages-panel]:visible').count(),0)
      await page.keyboard.type('forbidden');await page.keyboard.press('ControlOrMeta+z')
      assert.equal(await api(page,`${editor}.undo().ok`),false)
      assert.equal(await api(page,`${editor}.getRevision()`),savedRevision)
      await page.keyboard.press('Escape')
      await page.waitForFunction(()=>((window as any).PPTEHost||(window as any).PPTEPortable).getMode()==='edit')

      const download=page.waitForEvent('download')
      await page.locator(host?'[data-ppte-action=save-editable]':'[data-ppte-action=save-portable]').click()
      const saved=await download;const savedPath=join(dir,`${name}-saved.html`);await saved.saveAs(savedPath)
      await page.goto(pathToFileURL(savedPath).href)
      await page.waitForFunction(()=>Boolean((window as any).PPTEPortable))
      assert.equal(await api(page,`${editor}.getRevision()`),savedRevision)
      await api(page,`${editor}.undo()`)
      assert.notEqual(await api(page,`${editor}.getRevision()`),savedRevision)
      await api(page,`${editor}.redo()`)
      assert.equal(await api(page,`${editor}.getRevision()`),savedRevision)
      // Presentation is tested before and after reopen for both actual shells below.
      await api(page,`${editor}.enterPresentation()`)
      assert.equal(await api(page,`${editor}.getMode()`),'present')
      assert.equal(await page.locator('[contenteditable=true]').count(),0)
      assert.equal(await page.locator('[aria-label="选区格式"]').isVisible(),false)
      assert.equal(await page.locator('[data-ppte-pages-panel]').isVisible(),false)
      await page.keyboard.type('forbidden');await page.keyboard.press('ControlOrMeta+z')
      assert.equal(await api(page,`${editor}.undo().ok`),false)
      assert.equal(await api(page,`${editor}.editText({elementId:'text_title'},'forbidden').ok`),false)
      assert.equal(await api(page,`${editor}.getRevision()`),savedRevision)
      await page.keyboard.press('Escape');assert.equal(await api(page,`${editor}.getMode()`),'edit')
      const exported=page.waitForEvent('download');await api(page,`${editor}.saveAsNewProject()`)
      const source=await exported;const sourcePath=join(dir,`${name}.ppte`);await source.saveAs(sourcePath)
      const reopened=openCheckpoint(sourcePath);assert.deepEqual(reopened.document,changed)
      await context.tracing.stop({path:join(evidence,`${name}.zip`)})
      await context.close()
    }
    const page=await browser.newPage()
    const viewer=buildPortable(blank,{profile:'viewer'});const path=join(dir,'viewer.html');writeFileSync(path,viewer.html)
    await page.goto(pathToFileURL(path).href);await page.waitForFunction(()=>Boolean((window as any).PPTEPortable))
    assert.equal(await api(page,`${editor}.enterEdit().ok`),false)
    assert.equal(await api(page,`${editor}.editText({elementId:'text_title'},'forbidden').ok`),false)
  } finally {await browser.close();rmSync(dir,{recursive:true,force:true})}
})

test('E07 migrated inspector properties delegate to shared planner and browser migration example states enterEdit preconditions',()=>{
  const source=readFileSync('packages/editor-react/src/Inspector.tsx','utf8')
  assert.match(source,/commitProperty\(\{kind:'text-style',patch:value.patch\}\)/)
  assert.match(source,/commitProperty\(\{kind:'paragraph',patch:value.paragraphStyle\}\)/)
  const docs=readFileSync('docs/evolution/E07_EDITOR_API.md','utf8')
  assert.match(docs,/editor.enterEdit\(\).ok/);assert.match(docs,/active text editing session/)
  assert.match(readFileSync('skills/ppte/references/editing.md','utf8'),/PPTEPortable.enterEdit\(\)/)
})
