/** Browser-native vector/text printing. Built only for an explicit print action. */
export function installPrint(frame: HTMLIFrameElement, hooks: { suspend(): void; resume(): void; exitPresentation(): void }) {
    let host: HTMLElement | undefined, style: HTMLStyleElement | undefined;
    function restore() { if (!host) return; host?.remove();style?.remove();host=undefined;style=undefined;hooks.resume(); }
    function prepare() {
        if (host) return;
        hooks.exitPresentation();
        hooks.suspend();
        const doc=frame.contentDocument!;
        const slides=Array.from(doc.querySelectorAll<HTMLElement>('[data-ppte-slide]'));
        const sizes=slides.map(n=>{const r=n.getBoundingClientRect();return {width:Math.max(1,r.width),height:Math.max(1,r.height),display:doc.defaultView!.getComputedStyle(n).display};});
        const size=sizes[0]; if(!size)throw Error('NO_SLIDES');
        host=document.createElement('div');host.id='ppte-print';host.dataset.ppteTransient='';
        style=document.createElement('style');style.dataset.ppteTransient='';
        style.textContent=`@page{size:${size.width}px ${size.height}px;margin:0}@media print{html,body{margin:0!important;padding:0!important;width:auto!important;height:auto!important;background:white!important}body>:not(#ppte-print){display:none!important}#ppte-print{display:block!important}}@media screen{#ppte-print{display:none}}`;
        document.head.append(style);document.body.append(host);
        slides.forEach((slide,i)=>{
            const page=document.createElement('div');page.style.cssText=`width:${size.width}px;height:${size.height}px;position:relative;overflow:hidden;break-inside:avoid;break-after:${i===slides.length-1?'auto':'page'};`;
            const shadow=page.attachShadow({mode:'open'});
            const clone=doc.documentElement.cloneNode(true) as HTMLElement;
            clone.querySelectorAll('[data-ppte-transient],meta[http-equiv]').forEach(n=>n.remove());
            clone.querySelectorAll('[contenteditable],[data-ppte-editor-selected],[tabindex]').forEach(n=>{n.removeAttribute('contenteditable');n.removeAttribute('data-ppte-editor-selected');n.removeAttribute('tabindex');});
            clone.querySelectorAll('[data-ppte-slide]').forEach((n,j)=>{if(i!==j)n.remove();});
            clone.querySelectorAll('video').forEach(video=>{const image=document.createElement('img');image.alt=video.getAttribute('aria-label')??'视频';const poster=video.getAttribute('poster');if(poster)image.src=poster;image.style.cssText=video.getAttribute('style')??'';const rect=doc.querySelector(`[data-ppte-id="${CSS.escape(video.getAttribute('data-ppte-id')!)}"]`)!.getBoundingClientRect();image.style.width=`${rect.width}px`;image.style.height=`${rect.height}px`;video.replaceWith(image);});
            const scale=Math.min(size.width/sizes[i].width,size.height/sizes[i].height);
            const css=document.createElement('style');
            css.textContent=`:host{display:block}html,body{margin:0!important;padding:0!important;width:${size.width}px!important;height:${size.height}px!important;overflow:visible!important}*{animation:none!important;transition:none!important;outline:none!important;caret-color:transparent!important;print-color-adjust:exact!important;-webkit-print-color-adjust:exact!important}[data-ppte-slide]{display:${sizes[i].display}!important;position:absolute!important;box-sizing:border-box!important;left:0!important;top:0!important;margin:0!important;min-height:0!important;width:${sizes[i].width}px!important;height:${sizes[i].height}px!important;transform:scale(${scale})!important;transform-origin:top left!important}[data-ppte-step]{visibility:visible!important;opacity:1!important}[data-ppte-notes]:not([data-ppte-slide]),audio{display:none!important}`;
            shadow.append(clone,css);host!.append(page);
        });
    }
    window.addEventListener('beforeprint',prepare);
    window.addEventListener('afterprint',restore);
    return { prepare, restore, async print() { prepare();try {await document.fonts.ready;await Promise.all(Array.from(host!.children).flatMap(n=>Array.from(n.shadowRoot!.querySelectorAll('img'))).filter(n=>n.hasAttribute('src')).map(n=>n.decode().catch(()=>{throw Error('PRINT_MEDIA_DECODE_FAILED');})));window.print();} catch(e) {restore();throw e;} } };
}
