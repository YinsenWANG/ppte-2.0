import { Commands, imagePagePosition } from './commands.js';

type Box = {x:number;y:number;w:number;h:number;iw:number;ih:number;ox:number;oy:number};
/** Persisted author coordinates. Previews live exclusively in the outer editor,
 * so autosave never observes an unfinished pointer/crop transaction. */
export function imageDirect(frame:HTMLIFrameElement, root:HTMLElement, get:()=>Commands,
    enabled:()=>boolean, selected:()=>string[], select:(id:string)=>void, report:(e:unknown)=>void) {
    const layer=document.createElement('div'); layer.dataset.ppteTransient='';
    layer.style.cssText='position:fixed;z-index:103;pointer-events:none'; root.append(layer);
    const hint=document.createElement('span');hint.textContent='位置预览 · 松开以应用';hint.style.cssText='position:absolute;white-space:nowrap;font:12px system-ui;background:#5261d8;color:white;padding:4px 8px;border-radius:4px;pointer-events:none';layer.append(hint);
    const ghost=document.createElement('img'), preview=document.createElement('div'), bitmap=document.createElement('img');
    ghost.alt=bitmap.alt=''; ghost.draggable=bitmap.draggable=false;
    ghost.style.cssText='position:absolute;max-width:none;opacity:.3;pointer-events:none';
    preview.style.cssText='position:absolute;box-sizing:border-box;border:2px solid #5261d8;overflow:hidden;pointer-events:auto;touch-action:none;cursor:move';
    bitmap.style.cssText='position:absolute;max-width:none;pointer-events:none'; preview.append(bitmap); layer.append(ghost,preview);
    const controls=document.createElement('div');controls.style.cssText='position:absolute;display:flex;width:max-content;white-space:nowrap;gap:8px;pointer-events:auto;background:white;padding:6px;border-radius:8px;box-shadow:0 2px 10px #0002';layer.append(controls);
    const done=document.createElement('button'),cancel=document.createElement('button');done.textContent='完成';cancel.textContent='取消';for(const b of [done,cancel])b.style.cssText='min-width:56px;min-height:36px;white-space:nowrap';controls.append(done,cancel);
    const handles=['nw','ne','sw','se'].map(corner=>{
        const b=document.createElement('button');b.type='button';b.setAttribute('aria-label',`图片${{nw:'左上',ne:'右上',sw:'左下',se:'右下'}[corner]}角`);
        b.style.cssText=`position:absolute;width:44px;height:44px;min-height:44px;padding:0;border:0;background:transparent;pointer-events:auto;touch-action:none;cursor:${corner}-resize;display:grid;place-items:center`;
        b.innerHTML='<span style="display:block;width:9px;height:9px;border:1px solid #5261d8;background:white;box-sizing:border-box"></span>';
        b.onpointerdown=e=>start(e,corner);layer.append(b);return b;
    });
    let id:string|undefined, box:Box|undefined, cropping=false, session=false;
    let gesture:{start:Box;corner:string;pointer:number;target:HTMLElement;sx:number;sy:number;originX:number;originY:number}|undefined;
    let lastClick:{id:string;time:number}|undefined;
    let slide:HTMLElement|undefined, original:string|undefined, conceal:HTMLStyleElement|undefined;
    const commands=()=>get();
    function measure(n:HTMLImageElement):Box {
        slide=n.closest<HTMLElement>('[data-ppte-slide]')!;
        if(!slide)throw Error('图片不在页面中');
        imagePagePosition(slide);
        for(let p:HTMLElement|null=n;p&&p!==slide;p=p.parentElement){
            const s=n.ownerDocument.defaultView!.getComputedStyle(p);
            const matrix=new DOMMatrix(s.transform==='none'?'':s.transform);
            if((matrix.a!==1||matrix.b!==0||matrix.c!==0||matrix.d!==1||!matrix.is2D)||s.rotate!=='none'||s.scale!=='none'||s.perspective!=='none')throw Error('此图片含变换的作者结构尚未适配；请在源稿调整后再操作。');
        }
        const visual=n.ownerDocument.defaultView!.getComputedStyle(n);
        if(['paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth'].some(k=>parseFloat(visual[k as any])>0) || visual.clipPath!=='none' || visual.maskImage!=='none')
            throw Error('此图片的边框、内边距或蒙版尚未适配，请在源稿调整后再操作。');
        const parent=n.parentElement!;
        const stored=parent.dataset.ppteImageFrame;
        if(stored)return JSON.parse(stored) as Box;
        const r=n.getBoundingClientRect(),s=slide.getBoundingClientRect(),cs=n.ownerDocument.defaultView!.getComputedStyle(n);
        const ratio=n.naturalWidth/n.naturalHeight;
        if(!Number.isFinite(ratio)||!r.width||!r.height)throw Error('图片尚未解码，请稍后重试');
        const scale=cs.objectFit==='cover'?Math.max(r.width/n.naturalWidth,r.height/n.naturalHeight):Math.min(r.width/n.naturalWidth,r.height/n.naturalHeight);
        const iw=cs.objectFit==='fill'?r.width:n.naturalWidth*scale,ih=cs.objectFit==='fill'?r.height:n.naturalHeight*scale;
        const pos=cs.objectPosition.split(' ').map(v=>parseFloat(v)/100);
        return {x:r.left-s.left-slide.clientLeft,y:r.top-s.top-slide.clientTop,w:r.width,h:r.height,iw,ih,ox:(r.width-iw)*(pos[0]??.5),oy:(r.height-ih)*(pos[1]??.5)};
    }
    function locate(){
        if(!slide)return {x:0,y:0,scale:1};
        const f=frame.getBoundingClientRect(),s=slide.getBoundingClientRect(),scale=f.width/frame.clientWidth;
        return {x:f.left+(s.left+slide.clientLeft)*scale,y:f.top+(s.top+slide.clientTop)*scale,scale};
    }
    function draw(){
        if(!box||!id||!enabled()){layer.hidden=true;return;}
        layer.hidden=false;const b=box,{x,y,scale:k}=locate();
        layer.style.left=`${x}px`;layer.style.top=`${y}px`;
        Object.assign(preview.style,{left:`${b.x*k}px`,top:`${b.y*k}px`,width:`${b.w*k}px`,height:`${b.h*k}px`});
        Object.assign(bitmap.style,{left:`${b.ox*k-2}px`,top:`${b.oy*k-2}px`,width:`${b.iw*k}px`,height:`${b.ih*k}px`});
        // Selected-state overlay is transparent. During gestures it shows the result
        // before any author node changes, including the original layout position.
        hint.hidden=!session||cropping;hint.style.left=`${b.x*k}px`;hint.style.top=`${b.y*k-28}px`;
        bitmap.hidden=!session;ghost.hidden=!cropping;preview.style.pointerEvents=cropping?'auto':'none';
        Object.assign(ghost.style,{left:`${(b.x+b.ox)*k}px`,top:`${(b.y+b.oy)*k}px`,width:`${b.iw*k}px`,height:`${b.ih*k}px`});
        handles.forEach((h,i)=>{
            const dx=Math.max(0,(44-b.w*k)/2)*(i%2?1:-1),dy=Math.max(0,(44-b.h*k)/2)*(i>1?1:-1);
            h.style.left=`${(b.x+(i%2?b.w:0))*k+dx-22}px`;h.style.top=`${(b.y+(i>1?b.h:0))*k+dy-22}px`;
            (h.firstElementChild as HTMLElement).style.transform=`translate(${-dx}px,${-dy}px)`;
        });
        controls.hidden=!cropping;controls.style.display=cropping?'flex':'none';controls.style.left=`${Math.max(8-x,Math.min(innerWidth-x-150,b.x*k))}px`;controls.style.top=`${Math.max(110-y,Math.min(innerHeight-y-105,(b.y+b.h)*k+26))}px`;
        preview.setAttribute('aria-label',cropping?'拖动原图调整主体':'拖动图片（保留原布局占位）');
    }
    function update(){
        if(session){if(!enabled()||selected()[0]!==id)cancelSession();else draw();return;}
        id=undefined;box=undefined;layer.hidden=true;
        if(!enabled()||selected().length!==1)return;
        try{
            const n=commands().node(selected()[0]);if(n.tagName!=='IMG'||commands().protected(n))return;
            box=measure(n as HTMLImageElement);id=n.dataset.ppteId;
            bitmap.src=ghost.src=(n as HTMLImageElement).src;draw();
        }catch(e){report(e);}
    }
    function begin(){
        if(!id||!box||!slide)return false;
        if(!session){original=commands().node(id).outerHTML+(commands().node(id).parentElement?.dataset.ppteImageFrame??'');session=true;conceal=commands().doc.createElement('style');conceal.dataset.ppteTransient='';conceal.textContent='';commands().doc.head.append(conceal);}return true;
    }
    function crop(){
        update();if(!begin())return;cropping=true;if(conceal)conceal.textContent=`[data-ppte-id="${CSS.escape(id!)}"]{visibility:hidden!important}`;
        cover(box!);draw();done.focus();
    }
    function cover(b:Box){
        const k=Math.max(1,b.w/b.iw,b.h/b.ih);
        if(k>1){b.ox-=(b.iw*k-b.iw)/2;b.oy-=(b.ih*k-b.ih)/2;b.iw*=k;b.ih*=k;}
        b.ox=Math.max(b.w-b.iw,Math.min(0,b.ox));b.oy=Math.max(b.h-b.ih,Math.min(0,b.oy));
    }
    function constrain(b:Box){
        const r={width:slide!.clientWidth,height:slide!.clientHeight};b.x=Math.max(24-b.w,Math.min(r.width-24,b.x));b.y=Math.max(24-b.h,Math.min(r.height-24,b.y));
    }
    function commit(){
        if(!id||!box||!session||!slide)return;
        const c=commands(),n=c.node(id),b={...box},imageId=id,slideId=slide.dataset.ppteId!;
        if(n.outerHTML+(n.parentElement?.dataset.ppteImageFrame??'')!==original){cancelSession();report('图片在调整期间已改变，请重试');return;}
        conceal?.remove();conceal=undefined;
        const placeholderStyle=n.ownerDocument.defaultView!.getComputedStyle(n);
        const effects=`opacity:${placeholderStyle.opacity}!important;filter:${placeholderStyle.filter}!important;border-radius:${placeholderStyle.borderRadius}!important`;
        const width=n.getBoundingClientRect().width,height=n.getBoundingClientRect().height;
        const stylePosition=imagePagePosition(slide);
        // A slide transaction makes placeholder creation, frame and crop one undo.
        session=cropping=false;gesture=undefined;
        try { c.transaction([slideId],copy=>{
            const image=copy.querySelector<HTMLImageElement>(`[data-ppte-id="${CSS.escape(imageId)}"]`)!;
            let wrapper=image.parentElement!;
            if(!wrapper.hasAttribute('data-ppte-image-frame')){
                const placeholder=image.cloneNode(true) as HTMLImageElement;
                placeholder.removeAttribute('data-ppte-id');placeholder.dataset.ppteImagePlaceholder=imageId;
                placeholder.setAttribute('aria-hidden','true');placeholder.alt='';placeholder.removeAttribute('src');placeholder.removeAttribute('srcset');
                placeholder.style.setProperty('visibility','hidden','important');placeholder.style.setProperty('pointer-events','none','important');
                placeholder.style.width=`${width}px`;placeholder.style.height=`${height}px`;
                // Preserve the original tag/classes and layout participation (including
                // grid area, flex basis, margins and inline baseline).
                if(placeholderStyle.position==='absolute')placeholder.remove();else {image.before(placeholder);image.removeAttribute('id');}
                wrapper=copy.ownerDocument.createElement('div');wrapper.dataset.ppteId=`frame-${imageId}`;
                copy.append(wrapper);wrapper.append(image);
                if(stylePosition==='static')copy.style.position='relative';
            }
            wrapper.dataset.ppteImageFrame=JSON.stringify(b);
            wrapper.style.cssText=`position:absolute!important;left:${b.x}px!important;top:${b.y}px!important;width:${b.w}px!important;height:${b.h}px!important;overflow:hidden!important;margin:0!important;padding:0!important;border:0!important;box-sizing:border-box!important`;
            image.style.cssText=`position:absolute!important;left:${b.ox}px!important;top:${b.oy}px!important;width:${b.iw}px!important;height:${b.ih}px!important;max-width:none!important;max-height:none!important;min-width:0!important;min-height:0!important;margin:0!important;padding:0!important;border:0!important;transform:none!important;object-fit:fill!important;${effects}`;
        });
        select(imageId);update(); } catch(e){cancelSession();report(e);}
    }
    function cancelSession(){conceal?.remove();conceal=undefined;session=cropping=false;gesture=undefined;original=undefined;update();}
    function start(e:PointerEvent,corner='', fromFrame=false){
        if(e.button!==0||!begin())return;e.preventDefault();e.stopPropagation();
        const p=locate(),target=(fromFrame?e.target:e.currentTarget) as HTMLElement;
        gesture={start:{...box!},corner,pointer:e.pointerId,target,sx:e.screenX,sy:e.screenY,originX:p.x,originY:p.y};target.setPointerCapture(e.pointerId);
        draw();
    }
    function move(e:PointerEvent,fromFrame=false){
        if(!gesture)return;if(e.screenX===gesture.sx&&e.screenY===gesture.sy)return;const g=gesture,p=locate(),dx=(e.screenX-g.sx-(p.x-g.originX))/p.scale,dy=(e.screenY-g.sy-(p.y-g.originY))/p.scale,b={...g.start};
        if(!g.corner){if(cropping){b.ox+=dx;b.oy+=dy;cover(b);}else{b.x+=dx;b.y+=dy;}}
        else if(cropping){
            const west=g.corner.includes('w'),north=g.corner.includes('n');
            const w=Math.max(24,b.w+(west?-dx:dx)),h=Math.max(24,b.h+(north?-dy:dy));
            if(west){b.x+=b.w-w;b.ox-=b.w-w;}if(north){b.y+=b.h-h;b.oy-=b.h-h;}b.w=w;b.h=h;cover(b);
        }else{
            const west=g.corner.includes('w'),north=g.corner.includes('n');
            const factor=Math.max(24/Math.min(b.w,b.h),1+((west?-dx:dx)*b.w+(north?-dy:dy)*b.h)/(b.w*b.w+b.h*b.h));
            if(west)b.x+=b.w*(1-factor);if(north)b.y+=b.h*(1-factor);
            b.w*=factor;b.h*=factor;b.iw*=factor;b.ih*=factor;b.ox*=factor;b.oy*=factor;
        }
        constrain(b);box=b;draw();
    }
    function end(e:PointerEvent,fromFrame=false){
        if(!gesture)return;
        const g=gesture,clicked=id;
        if(e.screenX===g.sx&&e.screenY===g.sy){
            gesture=undefined;
            if(g.target.hasPointerCapture(g.pointer))g.target.releasePointerCapture(g.pointer);
            
            if(!cropping){
                cancelSession();
                if(clicked){
                    if(selected()[0]!==clicked)select(clicked);
                    const now=performance.now();
                    if(lastClick?.id===clicked&&now-lastClick.time<400){lastClick=undefined;crop();}
                    else lastClick={id:clicked,time:now};
                }
            }
            return;
        }
        move(e,fromFrame);gesture=undefined;
        if(g.target.hasPointerCapture(g.pointer))g.target.releasePointerCapture(g.pointer);
        
        if(!cropping){if(JSON.stringify(box)===JSON.stringify(g.start))cancelSession();else commit();}
    }
    preview.onpointerdown=e=>start(e);preview.ondblclick=crop;
    for(const el of [preview,...handles]){el.onpointermove=e=>move(e);el.onpointerup=e=>end(e);el.onpointercancel=cancelSession;el.onlostpointercapture=()=>{if(gesture)cancelSession();};}
    preview.addEventListener('wheel',e=>{
        if(!cropping||!box)return;e.preventDefault();const k=Math.exp(-e.deltaY*.002),b=box;
        b.ox-=(b.iw*k-b.iw)/2;b.oy-=(b.ih*k-b.ih)/2;b.iw*=k;b.ih*=k;cover(b);draw();
    },{passive:false});
    function key(e:KeyboardEvent){
        if(!enabled()||e.isComposing||(e.target as Element).closest?.('input,textarea,select,[contenteditable="true"]'))return false;
        if(cropping&&(e.key==='Enter'||e.key==='Escape')){e.preventDefault();e.stopImmediatePropagation();if(e.key==='Enter')commit();else cancelSession();return true;}
        if(session&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();cancelSession();return true;}
        if(id&&e.key.startsWith('Arrow')&&!e.ctrlKey&&!e.metaKey){e.preventDefault();e.stopImmediatePropagation();begin();const step=e.shiftKey?10:e.altKey?8:1;box!.x+=(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0);box!.y+=(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0);constrain(box!);if(!cropping)commit();else draw();return true;}
        return false;
    }
    done.onclick=commit;cancel.onclick=cancelSession;
    function bind(doc:Document){
        doc.addEventListener('dragstart',e=>{if(enabled()&&(e.target as Element).tagName==='IMG')e.preventDefault();});
        doc.addEventListener('pointerdown',e=>{
            const n=e.target as HTMLElement;
            if(!enabled()||n.tagName!=='IMG'||commands().protected(n))return;
            // Do not open/resize the inspector between down and up: that moves
            // the iframe under a stationary pointer and turns a click into a drag.
            try {box=measure(n as HTMLImageElement);id=n.dataset.ppteId;bitmap.src=ghost.src=(n as HTMLImageElement).src;}
            catch(e){report(e);return;}
            start(e,'',true);
        });
        doc.addEventListener('pointermove',e=>move(e,true));
        doc.addEventListener('pointerup',e=>end(e,true));
        doc.addEventListener('pointercancel',cancelSession);
        doc.addEventListener('lostpointercapture',()=>{if(gesture)cancelSession();});
    }
    return {bind,update,crop,key,cancel:cancelSession,get cropping(){return cropping;}};
}
