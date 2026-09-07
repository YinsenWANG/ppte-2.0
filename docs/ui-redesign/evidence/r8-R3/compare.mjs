import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFile} from 'node:fs/promises';
const out=resolve('docs/ui-redesign/evidence/r8-R3'),browser=await chromium.launch({channel:'chrome',headless:true});
const p=await browser.newPage({offline:true});const records=[];
try{
 for(const [width,height] of [[1440,960],[1024,768],[390,844]]){
  await p.setViewportSize({width,height});await p.goto(pathToFileURL(resolve('docs/ui-redesign/UI_PROTOTYPE.html')).href);
  await p.getByRole('button',{name:'编辑',exact:true}).click();
  if(width!==390)await p.locator('#slide [data-id=title1]').click();
  await p.waitForTimeout(200);await p.screenshot({path:out+`/prototype-${width}.png`});
  if(width===390){await p.locator('#slide [data-id=title1]').click();await p.waitForTimeout(200);await p.screenshot({path:out+'/prototype-390-inspector.png'});}
 }
 await p.setViewportSize({width:1440,height:960});await p.goto(pathToFileURL(out+'/sample.ppte.html').href);await p.waitForFunction(()=>window.PPTeEditor);
 await p.getByRole('button',{name:'编辑',exact:true}).click();await p.frameLocator('#ppte-frame').locator('[data-id=title1]').click();
 for(const [width,height] of [[1440,960],[1024,768],[390,844]]){
  await p.setViewportSize({width,height});await p.waitForTimeout(200);
  if(width===390)await p.getByRole('button',{name:'关闭属性',exact:true}).click();
  await p.screenshot({path:out+`/product-${width}.png`});
  const geometry=await p.evaluate(()=>{const f=document.querySelector('#ppte-frame'),a=document.querySelector('#ppte-edit-canvas'),r=f.getBoundingClientRect(),scale=r.width/f.clientWidth;return {area:a.getBoundingClientRect().toJSON(),scale,slides:[...f.contentDocument.querySelectorAll('[data-ppte-slide]')].map(n=>{const b=n.getBoundingClientRect();return {visible:getComputedStyle(n).display!=='none',x:r.x+b.x*scale,y:r.y+b.y*scale,width:b.width*scale,height:b.height*scale};})};});
  if(geometry.slides.filter(n=>n.visible).length!==1)throw Error('Expected one visible current page');
  records.push({width,height,geometry});
  if(width===390){await p.getByRole('button',{name:'页面设置',exact:true}).click();await p.screenshot({path:out+'/product-390-inspector-pending-R5.png'});}
 }
 await writeFile(out+'/verification/cli-sample.json',JSON.stringify({browser:browser.version(),headless:true,offline:true,url:'file://',records,smallInspector:'pending R5; screenshot is not a pass'},null,2));
}finally{await browser.close();}
