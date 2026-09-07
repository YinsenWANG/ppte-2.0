import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium, type Page } from 'playwright';
import { enhanceHTML, readEnhanced } from '../packages/html-document/src/index.js';
const out = resolve('artifacts/s03');
const source = `<title>S03 编辑组合验收</title><style>
body{margin:0;background:#e7ddcf;font:20px system-ui;color:#20252c}
.slide{width:960px;height:540px;box-sizing:border-box;padding:40px;container-type:inline-size;position:relative}
.grid{display:grid;grid-template-columns:1fr 1fr;background:#993344;color:white}.flex{display:flex;flex-direction:column;background:linear-gradient(120deg,#f6eadb,#b8c9dd)}
h1{font-size:5cqw;margin:0}td{padding:12px;border:1px solid #555}.box{position:absolute;left:400px;top:300px;width:60px;height:60px;background:#335cff}
</style><section class="slide grid" data-ppte-slide="one" data-ppte-id="one"><h1 data-ppte-id="title" data-ppte-locked="true">Protected title</h1><p>Grid context</p></section>
<section class="slide flex" data-ppte-slide="two" data-ppte-id="two"><h1>Gradient</h1><table data-ppte-id="table"><tr><td data-ppte-id="cell">Alpha beta</td><td>42</td></tr></table><div class="box" data-ppte-id="box" data-ppte-kind="shape"></div></section>
<section class="slide" data-ppte-slide="three" data-ppte-id="three"><h1>Transparent</h1></section>`;
async function visibleCurrent(p: Page) {
  await p.getByRole('button',{name:'放映',exact:true}).click();
  const state = await p.evaluate(()=>{
    const api=(window as any).PPTePlayer,d=(window as any).PPTeEditor.commands.doc;
    const slides=Array.from(d.querySelectorAll('[data-ppte-slide]')) as HTMLElement[];
    return {index:api.index,visible:slides.flatMap((n,i)=>d.defaultView.getComputedStyle(n).display==='none'?[]:[i])};
  });
  assert.deepEqual(state.visible,[state.index]);
  await p.keyboard.press('Escape');
  return state;
}
test('S03 F02-F05 file UI: protected local insert/history, unique identity, native context, background, download/reopen and PDF',async()=>{
  await mkdir(out,{recursive:true});
  const file=join(out,'作品.ppte.html');await writeFile(file,(await enhanceHTML(source,{root:out,base:out})).html);
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const results:any={browser:browser.version(),entry:'file://',network:[],presentation:[]};
  try{
    const context=await browser.newContext({offline:true,viewport:{width:1440,height:1000},acceptDownloads:true});
    context.on('request',r=>{if(/^https?:/.test(r.url()))results.network.push(r.url());});
    const p=await context.newPage();p.on('dialog',d=>void d.accept());
    await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeEditor);
    await p.evaluate(()=>document.documentElement.requestFullscreen=async()=>{});
    await p.getByRole('button',{name:'编辑',exact:true}).click();
    await p.evaluate(()=>{const c=(window as any).PPTeEditor.commands;(window as any).protectedBaseline={node:c.node('title'),html:c.node('title').outerHTML};});
    for(let i=0;i<2;i++){
      await p.getByRole('button',{name:'添加页',exact:true}).click();
      results.presentation.push(await visibleCurrent(p));
    }
    // A single-page editor deliberately removes inactive pages from layout.
    // Visit each page with its real navigation control before measuring it.
    const identity=[];
    for(let i=0;i<5;i++){
      await p.getByRole('button',{name:`第 ${i+1} 页`,exact:true}).click();
      identity.push(await p.frameLocator('#ppte-frame').locator('[data-ppte-slide]').nth(i).evaluate(n=>{
        const style=getComputedStyle(n);return {id:(n as HTMLElement).dataset.ppteSlide,object:(n as HTMLElement).dataset.ppteId,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,display:style.display,titleSize:getComputedStyle(n.querySelector('h1')!).fontSize};
      }));
    }
    await p.getByRole('button',{name:'第 3 页',exact:true}).click();
    assert.equal(identity.length,5);assert.equal(new Set(identity.map(n=>n.id)).size,5);assert.ok(identity.every(n=>n.id));
    for(const item of identity){assert.equal(item.width,960);assert.equal(item.height,540);assert.equal(item.titleSize,'44px');}
    assert.equal(identity[1].display,'grid');assert.equal(identity[2].display,'grid');
    for(let i=0;i<2;i++)await p.getByRole('button',{name:'撤销',exact:true}).click();
    assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-slide]').count(),3);
    for(let i=0;i<2;i++)await p.getByRole('button',{name:'重做',exact:true}).click();
    assert.equal(await p.evaluate(()=>{const c=(window as any).PPTeEditor.commands,b=(window as any).protectedBaseline;return c.node('title')===b.node&&c.node('title').outerHTML===b.html;}),true);
    // Viewing backgrounds is read-only, including changing page and undoing a real background edit.
    const content=await p.evaluate(()=>(window as any).PPTeHTML.content());
    for(const [index,pattern] of [[1,/#993344/],[4,/linear-gradient/],[5,/透明/]] as const){
      await p.getByRole('button',{name:`第 ${index} 页`,exact:true}).click();
      await p.getByRole('button',{name:'页面设置',exact:true}).click();
      assert.match((await p.getByLabel('背景',{exact:true}).inputValue())+(await p.locator('.color-field span').allTextContents()).join(''),pattern);
    }
    assert.equal(await p.evaluate(()=>(window as any).PPTeHTML.content()),content);
    await p.getByLabel('背景',{exact:true}).fill('#123456');await p.getByLabel('背景',{exact:true}).press('Enter');await p.getByLabel('背景',{exact:true}).press('Tab');
    await p.getByRole('button',{name:'撤销',exact:true}).click();
    await p.getByRole('button',{name:'页面设置',exact:true}).click();
    assert.match((await p.getByLabel('背景',{exact:true}).inputValue())+(await p.locator('.color-field span').allTextContents()).join(''),/透明/);
    await p.screenshot({path:join(out,'background-transparent.png')});
    // Flex sample insertion is also measured and retains cqw text.
    await p.getByRole('button',{name:'第 4 页',exact:true}).click();await p.getByRole('button',{name:'添加页',exact:true}).click();
    assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-slide]').nth(4).evaluate(n=>getComputedStyle(n).display),'flex');
    await p.frameLocator('#ppte-frame').locator('[data-ppte-slide]').nth(4).locator('h1').fill('Added Flex');
    results.presentation.push(await visibleCurrent(p));
    const downloadEvent=p.waitForEvent('download');await p.getByRole('button',{name:'下载更新后的文件',exact:true}).click();
    const saved=join(out,'验收入口.ppte.html');await (await downloadEvent).saveAs(saved);
    assert.doesNotMatch(readEnhanced(await readFile(saved,'utf8')).content,/ppte-editor-|contenteditable/);
    results.presentation.push(await visibleCurrent(p));
    await p.goto(pathToFileURL(saved).href);await p.waitForFunction(()=>!!(window as any).PPTeEditor);
    await p.evaluate(()=>document.documentElement.requestFullscreen=async()=>{});
    await p.getByRole('button',{name:'编辑',exact:true}).click();
    for(let i=1;i<=6;i++){
      await p.getByRole('button',{name:`第 ${i} 页`,exact:true}).click();
      await p.getByRole('button',{name:'页面设置',exact:true}).click();
      assert.match((await p.getByLabel('背景',{exact:true}).inputValue())+(await p.locator('.color-field span').allTextContents()).join(''),i<=3 ? /#993344/ : i<=5 ? /linear-gradient/ : /透明/);
      await p.getByRole('button',{name:'缩小画布',exact:true}).click();
      results.presentation.push(await visibleCurrent(p));
      await p.getByRole('button',{name:'重置缩放',exact:true}).click();
    }
    assert.deepEqual(await p.evaluate(()=>Array.from((window as any).PPTeEditor.commands.doc.querySelectorAll('[data-ppte-slide]')).map((n:any)=>n.dataset.ppteSlide)),[...identity.slice(0,4).map(n=>n.id),await p.frameLocator('#ppte-frame').locator('[data-ppte-slide]').nth(4).getAttribute('data-ppte-slide'),identity[4].id]);
    assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-slide]').nth(4).locator('h1').textContent(),'Added Flex');
    await p.evaluate(()=>(window as any).PPTePrint.prepare());await p.emulateMedia({media:'print'});
    assert.equal(await p.locator('#ppte-print>div').count(),6);
    results.pdf=await p.locator('#ppte-print>div').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,text:n.shadowRoot!.querySelector('html')!.textContent?.includes('Added Flex')})));
    assert.ok(results.pdf.every((n:any)=>n.width===960&&n.height===540));assert.ok(results.pdf.some((n:any)=>n.text));
    await p.pdf({path:join(out,'slides.pdf'),preferCSSPageSize:true,printBackground:true});
    const swift=join(out,'inspect.swift');
    await writeFile(swift,`import Foundation\nimport PDFKit\nlet d=PDFDocument(url:URL(fileURLWithPath:CommandLine.arguments[1]))!\nlet pages=(0..<d.pageCount).map { i -> [String:Any] in let p=d.page(at:i)!;let b=p.bounds(for:.mediaBox);return ["text":p.string ?? "", "width":b.width,"height":b.height] }\nprint(String(data:try! JSONSerialization.data(withJSONObject:pages),encoding:.utf8)!)\n`);
    const parsed=spawnSync('swift',[swift,join(out,'slides.pdf')],{encoding:'utf8'});assert.equal(parsed.status,0,parsed.stderr);
    results.pdfParsed=JSON.parse(parsed.stdout);assert.equal(results.pdfParsed.length,6);
    assert.match(results.pdfParsed[4].text,/Added Flex/);
    for(const page of results.pdfParsed){assert.ok(Math.abs(page.width-720)<1);assert.ok(Math.abs(page.height-405)<1);assert.doesNotMatch(page.text,/编辑|保存|撤销/);}

    await p.emulateMedia({media:'screen'});await p.evaluate(()=>(window as any).PPTePrint.restore());
    results.identity=identity;assert.deepEqual(results.network,[]);
    await writeFile(join(out,'regressions.json'),JSON.stringify(results,null,2));
  }finally{await browser.close();}
});

test('S03 contextual UI: real cell mouse/keyboard range format, collapse/zoom focus, handles and composition refresh',async()=>{
  await mkdir(out,{recursive:true});const file=join(out,'context.ppte.html');await writeFile(file,(await enhanceHTML(source,{root:out,base:out})).html);
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const p=await browser.newPage({viewport:{width:1440,height:1000}});await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!(window as any).PPTeEditor);
    await p.getByRole('button',{name:'编辑',exact:true}).click();await p.getByRole('button',{name:'第 2 页',exact:true}).click();
    const cell=p.frameLocator('#ppte-frame').locator('[data-ppte-id=cell]');await cell.click();for(let i=0;i<20;i++)await cell.press('ArrowLeft');for(let i=0;i<10;i++)await cell.press('Shift+ArrowRight');
    assert.deepEqual(await p.evaluate(()=>(window as any).PPTeEditor.selection),['cell']);
    await p.getByRole('button',{name:'粗体',exact:true}).click();
    assert.equal(await cell.locator('span').textContent(),'Alpha beta');assert.equal(await cell.locator('span').evaluate(n=>(n as HTMLElement).style.fontWeight),'700');
    await p.screenshot({path:join(out,'cell-context.png')});
    const input=p.getByLabel('字号',{exact:true});await input.focus();await input.evaluate(n=>(n as HTMLInputElement).setSelectionRange(0,2));const handle=await input.elementHandle();
    for(const name of ['折叠缩略图','缩小画布','放大画布','展开缩略图']){
      await p.getByRole('button',{name,exact:true}).click();
      assert.deepEqual(await handle!.evaluate(n=>({connected:n.isConnected,focused:n===document.activeElement,start:(n as HTMLInputElement).selectionStart,end:(n as HTMLInputElement).selectionEnd})),{connected:true,focused:true,start:0,end:2});
    }
    await cell.click();for(let i=0;i<20;i++)await cell.press('ArrowLeft');for(let i=0;i<10;i++)await cell.press('Shift+ArrowRight');
    const selection=await cell.evaluate(n=>n.ownerDocument.getSelection()!.toString());
    for(const name of ['折叠缩略图','缩小画布','展开缩略图','重置缩放'])await p.getByRole('button',{name,exact:true}).click();
    assert.equal(await cell.evaluate(n=>n.ownerDocument.getSelection()!.toString()),selection);
    // Synthetic composition is a regression check only, not proof of a native IME session.
    const composition=await p.evaluate(()=>{const e=(window as any).PPTeEditor,c=e.commands,n=c.node('cell'),d=c.doc;const before=c.undoStack.length;
      n.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));n.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,isComposing:true}));n.textContent='中文';n.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));e.select(['cell']);
      const interim=c.undoStack.length-before;n.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));return {interim,final:c.undoStack.length-before,text:n.textContent};});
    assert.deepEqual(composition,{interim:0,final:1,text:'中文'});
    const box=p.frameLocator('#ppte-frame').locator('[data-ppte-id=box]');await box.click();
    const bounds=await p.getByRole('button',{name:'调整对象大小',exact:true}).boundingBox();assert.ok(bounds);
    const scale=await p.locator('#ppte-frame').evaluate(n=>n.getBoundingClientRect().width/n.clientWidth);
    await p.mouse.move(bounds.x+12,bounds.y+12);await p.mouse.down();await p.mouse.move(bounds.x+12+30*scale,bounds.y+12+20*scale);await p.mouse.up();
    assert.equal(await box.evaluate(n=>(n as HTMLElement).style.width),'90px');
    await p.getByRole('button',{name:'撤销',exact:true}).click();assert.equal(await box.evaluate(n=>n.getBoundingClientRect().width),60);
    await p.screenshot({path:join(out,'shape-handles.png')});
    await writeFile(join(out,'contextual.json'),JSON.stringify({browser:browser.version(),mouseKeyboardCell:true,focusSelection:true,composition,resizeUndo:true,nativeIME:'pending',humanReview:'pending'},null,2));
  }finally{await browser.close();}
});
