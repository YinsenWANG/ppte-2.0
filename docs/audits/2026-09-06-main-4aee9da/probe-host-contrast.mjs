import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFileSync} from 'node:fs';
const out=resolve('docs/audits/2026-09-06-main-4aee9da/evidence');
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1600,height:1100}});
 await page.goto(pathToFileURL(resolve('apps/host/dist/index.html')).href);
 await page.waitForFunction(()=>Boolean(window.PPTEHost));
 await page.locator('[data-ppte-action=new]').click();
 const labels=await page.locator('[data-ppte-properties-panel]').evaluate(root=>{
   const rgb=s=>(s.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
   const light=a=>a.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
   return [...root.querySelectorAll('*')].flatMap(el=>{
    const text=[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent.trim()).join(' ').trim();
    const rect=el.getBoundingClientRect();if(!text||rect.width===0||rect.height===0||rect.top>innerHeight)return [];
    const fg=getComputedStyle(el).color;let bg='';for(let p=el;p;p=p.parentElement){bg=getComputedStyle(p).backgroundColor;if(bg!=='rgba(0, 0, 0, 0)'&&bg!=='transparent')break;}
    const a=light(rgb(fg)),b=light(rgb(bg));const contrast=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    return contrast<1.5?[{tag:el.tagName,text,foreground:fg,background:bg,contrast}]:[];
   });
 });
 await page.screenshot({path:resolve(out,'host-properties-contrast.png')});
 writeFileSync(resolve(out,'host-contrast-probe.json'),JSON.stringify({baseline:'4aee9da',browser:browser.version(),labels},null,2)+'\n');
 console.log(JSON.stringify(labels));
} finally {await browser.close()}
