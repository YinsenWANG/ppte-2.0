/** A transient view over the author's DOM, never a second slide/content model. */
export function readingView(frame: HTMLIFrameElement) {
    let css: HTMLStyleElement | undefined;
    function clear() { css?.remove(); css = undefined; }
    function draw(index: number) {
        clear();
        const doc = frame.contentDocument!;
        const slides = Array.from(doc.querySelectorAll<HTMLElement>('[data-ppte-slide]'));
        const slide = slides[index];
        if (!slide) return;
        const bounds = slide.getBoundingClientRect(), computed = doc.defaultView!.getComputedStyle(slide);
        const width = Math.max(1, bounds.width), height = Math.max(1, bounds.height);
        const scale = Math.min(1, frame.clientWidth / width, frame.clientHeight / height);
        css = doc.createElement('style'); css.dataset.ppteTransient = '';
        css.textContent = `html,body{margin:0!important;padding:0!important;overflow:hidden!important}html{background:#f3f4f6!important}[data-ppte-slide]{display:none!important}[data-ppte-id="${CSS.escape(slide.dataset.ppteId!)}"]{display:${computed.display}!important;position:fixed!important;box-sizing:border-box!important;left:${(frame.clientWidth-width*scale)/2}px!important;top:${(frame.clientHeight-height*scale)/2}px!important;margin:0!important;width:${width}px!important;height:${height}px!important;min-height:0!important;transform:scale(${scale})!important;transform-origin:top left!important;box-shadow:0 2px 12px #20242d18}`;
        doc.head.append(css);
    }
    return { draw, clear };
}
