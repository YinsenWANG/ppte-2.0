import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
const fromRoot=path=>import(pathToFileURL(resolve(path)).href);
const {createEmptyDocument}=await fromRoot('dist/packages/authoring/src/default-document.js');
const {buildPortable}=await fromRoot('dist/packages/portable-runtime/src/index.js');
const out=resolve('docs/audits/2026-09-06-main-4aee9da/evidence');
const dir=mkdtempSync(join(tmpdir(),'ppte-audit-present-'));
const built=buildPortable(createEmptyDocument(),{profile:'full-portable'});
if(!built.ok)throw Error(JSON.stringify(built.issues));
const file=join(dir,'deck.html');writeFileSync(file,built.html);
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto(pathToFileURL(file).href);
 await page.waitForFunction(()=>Boolean(window.PPTEPortable));
 await page.evaluate(()=>{document.documentElement.requestFullscreen=async()=>{throw Error('audit: fullscreen unavailable')};return window.PPTEPortable.enterPresentation()});
 await page.waitForFunction(()=>window.PPTEPortable.getMode()==='present');
 await page.evaluate(()=>document.activeElement?.blur());await page.mouse.move(2,2);await page.waitForTimeout(3200);
 const inspect=()=>page.evaluate(()=>{
  const node=document.querySelector('[data-ppte-live-tools]');const style=getComputedStyle(node);const rect=node.getBoundingClientRect();
  return {activeElement:document.activeElement?.tagName,mode:window.PPTEPortable.getMode(),editableCount:document.querySelectorAll('[contenteditable=true]').length,liveTools:{display:style.display,visibility:style.visibility,opacity:style.opacity,buttons:[...node.querySelectorAll('button')].map(n=>n.textContent),rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}},blackoutVisible:!document.querySelector('[data-ppte-blackout]').hidden};
 });
 const idle=await inspect();await page.screenshot({path:join(out,'present-idle.png')});
 await page.locator('[data-ppte-live-tools]').getByRole('button',{name:'黑屏',exact:true}).click();
 await page.evaluate(()=>document.activeElement?.blur());await page.mouse.move(2,2);await page.waitForTimeout(3200);
 const blackout=await inspect();await page.screenshot({path:join(out,'present-blackout.png')});
 writeFileSync(join(out,'presentation-probe.json'),JSON.stringify({baseline:'4aee9da',browser:browser.version(),idleWaitMs:3200,idle,blackout,expected:'Present controls hide without hover/focus; audience black screen does not leave a permanent toolbar.'},null,2)+'\n');
 console.log(JSON.stringify({idle,blackout}));
}finally{await browser.close();rmSync(dir,{recursive:true,force:true})}
