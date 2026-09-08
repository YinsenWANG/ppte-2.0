import type { Page } from 'playwright';
/** U02 retires the parameter UI. Keep its exact numeric assertions as Commands
 * compatibility regressions; direct manipulation is tested in usability-reset-u02.
 * These helpers do not mount controls or pretend to be product pointer evidence. */
export async function legacyImageCrop(p:Page,action:string){
 await p.evaluate(action=>{const e=(window as any).PPTeEditor;e.commands.crop(e.selection,action==='填充裁切'?'cover':'contain');},action);
}
export async function legacyImageProperty(p:Page,label:string,value:string){
 return p.evaluate(({label,value})=>{
  const e=(window as any).PPTeEditor,c=e.commands,n=e.selection.length===1?c.node(e.selection[0]):null;
  if(n?.tagName!=='IMG')return false;
  const names:Record<string,string>={'宽度':'width','高度':'height','顺序':'order','外边距':'margin','容器内对齐':'align-self'};
  if(names[label])c.style(e.selection,names[label],value);
  else if(label.includes('焦点')){const s=c.doc.defaultView.getComputedStyle(n),pos=s.objectPosition.split(' ').map(parseFloat);c.crop(e.selection,s.objectFit==='cover'?'cover':'contain',label.startsWith('水平')?Number(value):pos[0],label.startsWith('垂直')?Number(value):pos[1]);}
  else return false;
  return true;
 },{label,value});
}
/** Select the retained legacy command for legacy insertion/layout fixtures only.
 * No product entry or production feature flag exists for the retired behavior. */
export async function legacyImageInsertion(p:Page){
 await p.evaluate(()=>{const c=(window as any).PPTeEditor.commands;c.insertImageFrame=c.insertImage.bind(c);});
}
