import { CropGesture, type ImageCrop } from '../../editor-controller/src/resource-port.js'
import type { ImageElement } from '../../schema/src/index.js'
/** Handles own temporary DOM and pointer capture, never semantic document writes. */
export function mountImageCrop(node:HTMLElement,image:ImageElement,scale:()=>number,commit:(crop:ImageCrop)=>void):()=>void {
  const img=node.querySelector('img'),original=img?.getAttribute('style')??''
  const overlay=document.createElement('div');overlay.dataset.ppteCropHandles='true'
  overlay.style.cssText='position:absolute;inset:0;border:2px dashed #2563eb;pointer-events:none;z-index:10'
  let cancel=()=>{}
  const reset=()=>{if(img)img.setAttribute('style',original)}
  for(const corner of ['nw','ne','sw','se'] as const){
    const handle=document.createElement('button');handle.type='button';handle.setAttribute('aria-label',`Crop ${corner}`)
    handle.dataset.ppteCropHandle=corner
    handle.style.cssText=`position:absolute;width:18px;height:18px;padding:0;background:white;border:2px solid #2563eb;pointer-events:auto;touch-action:none;${corner.includes('n')?'top':'bottom'}:0;${corner.includes('w')?'left':'right'}:-9px`
    handle.onpointerdown=event=>{
      if(event.button!==0)return
      event.preventDefault();event.stopPropagation();cancel()
      const gesture=new CropGesture(image,corner),start={x:event.clientX,y:event.clientY},pointerId=event.pointerId
      handle.setPointerCapture(pointerId)
      const clear=()=>{handle.onpointermove=null;handle.onpointerup=null;handle.onpointercancel=null;handle.onlostpointercapture=null;if(handle.hasPointerCapture(pointerId))handle.releasePointerCapture(pointerId);reset()}
      cancel=()=>{gesture.cancel();clear()}
      handle.onpointermove=e=>{if(e.pointerId!==pointerId)return;e.stopPropagation();const c=gesture.update((e.clientX-start.x)/scale(),(e.clientY-start.y)/scale());if(img){img.style.transform=`scale(${1/c.width},${1/c.height})`;img.style.transformOrigin="0 0";img.style.left=`${-c.x/c.width*100}%`;img.style.top=`${-c.y/c.height*100}%`}}
      handle.onpointerup=e=>{if(e.pointerId!==pointerId)return;e.stopPropagation();const crop=gesture.end();clear();cancel=()=>{};if(crop)commit(crop)}
      handle.onpointercancel=cancel;handle.onlostpointercapture=cancel
    }
    overlay.append(handle)
  }
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();cancel();overlay.remove()}}
  document.addEventListener('keydown',escape,true);node.append(overlay)
  return ()=>{cancel();reset();overlay.remove();document.removeEventListener('keydown',escape,true)}
}
