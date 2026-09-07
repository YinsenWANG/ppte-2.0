/** Single-page editor viewport. Author coordinates stay unscaled inside the frame;
 * only its outer display is scaled, so editing/layout commands retain CSS pixels.
 * The document viewport follows the window, not zoom or inspector visibility.
 */
export function editCanvas(frame: HTMLIFrameElement, moved: () => void) {
    const area = document.createElement('div'), extent = document.createElement('div'), paper = document.createElement('div');
    area.id = 'ppte-edit-canvas'; area.dataset.ppteTransient = '';
    area.setAttribute('role', 'region'); area.setAttribute('aria-label', '当前页工作区');
    area.style.cssText = 'position:fixed;overflow:auto;background:#f3f4f6;overscroll-behavior:contain';
    extent.style.cssText = 'pointer-events:none;position:relative';
    paper.style.cssText = 'position:absolute;box-shadow:0 2px 12px #20242d18'; extent.append(paper); area.append(extent); document.body.insertBefore(area, frame);
    let css: HTMLStyleElement | undefined;
    let state: {width:number;height:number;scale:number;x:number;y:number} | undefined;
    let boundDoc: Document | undefined;
    const clearStyle = () => { css?.remove(); css = undefined; };
    function position() {
        if (!state) return;
        const {width,height,scale,x,y} = state, a = area.getBoundingClientRect();
        const left = a.left+x-area.scrollLeft, top = a.top+y-area.scrollTop;
        frame.style.left = `${left}px`; frame.style.top = `${top}px`;
        // Clip both the unused document viewport and the work area's scroll edges.
        const l = Math.max(0,(a.left-left)/scale), t = Math.max(0,(a.top-top)/scale);
        const r = Math.min(width,(a.left+area.clientWidth-left)/scale), b = Math.min(height,(a.top+area.clientHeight-top)/scale);
        frame.style.clipPath = `inset(${t}px ${Math.max(0,frame.clientWidth-r)}px ${Math.max(0,frame.clientHeight-b)}px ${l}px)`;
        moved();
    }
    area.addEventListener('scroll', position);
    function clear() {
        clearStyle(); state = undefined; area.hidden = true;
        for (const prop of ['position','left','top','clip-path','transform','margin']) frame.style.removeProperty(prop);
    }
    function draw(index:number, box:{left:number;right:number;top:number;bottom:number}, zoom:number) {
        clearStyle(); area.hidden = false;
        Object.assign(area.style,{left:`${box.left}px`,right:`${box.right}px`,top:`${box.top}px`,bottom:`${box.bottom}px`});
        const doc = frame.contentDocument!, view = doc.defaultView!;
        if (boundDoc !== doc) {
            boundDoc = doc;
            doc.addEventListener('wheel', e => {
                if (!state || e.ctrlKey || (e.target as Element).closest('textarea,input,video,audio')) return;
                if (area.scrollWidth <= area.clientWidth && area.scrollHeight <= area.clientHeight) return;
                e.preventDefault();
                const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? area.clientHeight : 1;
                area.scrollBy({left:(e.shiftKey ? e.deltaY : e.deltaX)*unit,top:(e.shiftKey ? 0 : e.deltaY)*unit});
            },{passive:false});
        }
        // Always measure the native page afresh, with no prior view stylesheet.
        // Neither zoom nor a panel toggle changes author media-query breakpoints.
        frame.style.cssText = `position:fixed;margin:0;border:0;width:${innerWidth}px;height:${innerHeight}px;transform-origin:top left`;
        const slide = doc.querySelectorAll<HTMLElement>('[data-ppte-slide]')[index];
        if (!slide) { clear(); return 1; }
        const rect = slide.getBoundingClientRect(), computed = view.getComputedStyle(slide);
        const width = Math.max(1,rect.width), height = Math.max(1,rect.height), display = computed.display;
        frame.style.width = `${Math.max(innerWidth,width)}px`;
        frame.style.height = `${Math.max(innerHeight,height)}px`;
        const pad = innerWidth < 580 ? 12 : innerWidth < 1100 ? 26 : 38;
        const fit = Math.max(.01,Math.min(1,(area.clientWidth-pad*2)/width,(area.clientHeight-pad*2)/height));
        const scale = fit*zoom;
        const w = Math.max(area.clientWidth,width*scale+pad*2), h = Math.max(area.clientHeight,height*scale+pad*2);
        extent.style.width = `${w}px`; extent.style.height = `${h}px`;
        css = doc.createElement('style'); css.dataset.ppteTransient = '';
        css.textContent = `html,body{margin:0!important;padding:0!important;overflow:hidden!important}html{background:#f3f4f6!important}[data-ppte-slide]{display:none!important}[data-ppte-id="${CSS.escape(slide.dataset.ppteId!)}"]{display:${display}!important;position:fixed!important;box-sizing:border-box!important;left:0!important;top:0!important;margin:0!important;width:${width}px!important;height:${height}px!important;min-height:0!important;transform:none!important}`;
        doc.head.append(css); view.scrollTo(0,0);
        frame.style.transform = `scale(${scale})`;
        state = {width,height,scale,x:(w-width*scale)/2,y:(h-height*scale)/2};
        Object.assign(paper.style,{left:`${state.x}px`,top:`${state.y}px`,width:`${width*scale}px`,height:`${height*scale}px`});
        position(); return scale;
    }
    return {draw,clear};
}
