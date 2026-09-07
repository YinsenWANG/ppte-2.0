// Same Chromium candidate, whole-document output; PDFKit merge loses Type3 text maps.
export async function wholeChromium(page,input,output,selector){
 await page.goto(input);
 const sizes=await page.locator(selector).evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {width:Math.round(r.width),height:Math.round(r.height)}}));
 await page.setViewportSize({width:Math.min(...sizes.map(s=>s.width)),height:1000});
 await page.evaluate(({selector,sizes})=>{
  const style=document.createElement('style');style.textContent='html,body{margin:0!important;padding:0!important;overflow:visible!important} *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;animation:none!important;transition:none!important}'+sizes.map((s,i)=>`@page f04a${i}{size:${s.width}px ${s.height}px;margin:0}`).join('');document.head.append(style);
  [...document.querySelectorAll(selector)].forEach((n,i)=>{n.style.page=`f04a${i}`;n.style.breakAfter='page';n.style.breakInside='avoid'});
 },{selector,sizes});
 await page.emulateMedia({media:'screen'});await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(im=>im.decode()))});
 return await page.pdf({path:output,preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false});
}
