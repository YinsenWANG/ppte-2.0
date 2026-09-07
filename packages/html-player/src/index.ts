import { demandSlide, materializeMedia } from '../../html-editor/src/media-demand.js';
import { cleanContent, frameContent } from '../../html-document/src/content.js';

/** Ephemeral presentation state. No content attributes or inline layout are changed. */
export function installPlayer(frame: HTMLIFrameElement, hooks: {
    suspend(): void; resume(): void; current(): number; moved(index: number): void;
}) {
    let running = false, index = 0, step = 0, black = false, fullscreenOwned = false, session = 0;
    let presenterBlocked = false;
    let css: HTMLStyleElement | undefined, timer: ReturnType<typeof setTimeout>;
    let speaker: Window | null = null, started = 0;
    let sizes: { width: number; height: number; display: string; background: string }[] = [];
    const slides = () => Array.from(frame.contentDocument!.querySelectorAll<HTMLElement>('[data-ppte-slide]'));
    const shell = document.createElement('div');
    shell.dataset.ppteTransient = ''; shell.id = 'ppte-player'; shell.hidden = true;
    shell.innerHTML = `<style>
#ppte-player[hidden]{display:none}body:has(#ppte-player:not([hidden]))>#ppte-frame{position:fixed!important;inset:0!important;margin:0!important;width:100%!important;height:100%!important}
body:has(#ppte-player:not([hidden]))>[data-ppte-transient]:not(#ppte-player){display:none!important}
#ppte-black{display:none;position:fixed;inset:0;background:#000;z-index:9999}#ppte-player[data-black] #ppte-black{display:block}
</style><div id="ppte-black" aria-label="黑屏"></div>`;
    document.body.append(shell);
    let cursor: HTMLStyleElement | undefined;
    function wake() {
        if (!running) return;
        cursor?.remove(); shell.style.cursor=''; clearTimeout(timer);
        timer = setTimeout(() => {
            if (!running) return;
            shell.style.cursor='none';
            cursor = frame.contentDocument!.createElement('style');
            cursor.dataset.ppteTransient = '';
            cursor.textContent = '*{cursor:none!important}';
            frame.contentDocument!.head.append(cursor);
        }, 1800);
    }
    function pause() { frame.contentDocument?.querySelectorAll('video,audio').forEach(n => (n as HTMLMediaElement).pause()); }
    function draw() {
        if (!running || !css) return;
        demandSlide(frame.contentDocument!, index);
        const list = slides(), n = list[index];
        if (!n) return;
        // Intrinsic media may only become known on this visit. Measure without
        // the transient presentation geometry, then fit the current page again.
        css.textContent = '';
        const rect = n.getBoundingClientRect(), computed = frame.contentWindow!.getComputedStyle(n);
        const size = sizes[index] = {width:Math.max(1,rect.width),height:Math.max(1,rect.height),display:computed.display,background:computed.backgroundColor==='rgba(0, 0, 0, 0)'?frame.contentWindow!.getComputedStyle(frame.contentDocument!.body).backgroundColor:computed.backgroundColor};
        if (!n || !size) return;
        const scale = Math.min(frame.clientWidth / size.width, frame.clientHeight / size.height);
        const selector = `[data-ppte-id="${CSS.escape(n.dataset.ppteId!)}"]`;
        const steps = Array.from(n.querySelectorAll<HTMLElement>('[data-ppte-step]'));
        css.textContent = `html,body{margin:0!important;padding:0!important;background:#000!important;overflow:hidden!important;width:100%!important;height:100%!important}body *{outline:none!important;caret-color:transparent!important}[data-ppte-slide]{display:none!important}${selector}{display:${size.display}!important;background-color:${size.background}!important;position:fixed!important;box-sizing:border-box!important;margin:0!important;left:${(frame.clientWidth-size.width*scale)/2}px!important;top:${(frame.clientHeight-size.height*scale)/2}px!important;width:${size.width}px!important;height:${size.height}px!important;min-height:0!important;transform:scale(${scale})!important;transform-origin:top left!important}[data-ppte-notes]:not([data-ppte-slide]){display:none!important}`;
        steps.slice(step).forEach(n => { css!.textContent += `[data-ppte-id="${CSS.escape(n.dataset.ppteId!)}"]{visibility:hidden!important}`; });
        syncSpeaker();
    }
    function next(back = false) {
        if (!running) return;
        if (black) { blackout(false); return; }
        const count = slides()[index].querySelectorAll('[data-ppte-step]').length;
        if (!back && step < count) step++;
        else if (back && step > 0) step--;
        else {
            const target = Math.max(0, Math.min(slides().length-1, index + (back ? -1 : 1)));
            if (target === index) return;
            pause(); index = target; step = 0; hooks.moved(index);
        }
        draw();
        const n = slides()[index];
        if (n.dataset.ppteTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches)
            n.animate(n.dataset.ppteTransition === 'slide' ? [{opacity:0, translate:'24px'},{opacity:1, translate:'0'}] : [{opacity:0},{opacity:1}], {duration:180});
    }
    function blackout(value = !black) { black = value; shell.toggleAttribute('data-black', black); if (black) { pause(); frame.focus(); } }
    function exit() {
        if (!running) return;
        pause(); session++; running = false; fullscreenOwned = false; cursor?.remove(); black = false; shell.hidden = true; shell.removeAttribute('data-black'); css?.remove(); css = undefined; clearTimeout(timer);
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
        speaker?.close(); speaker = null; hooks.resume();
    }
    function keys(e: KeyboardEvent) {
        if (!running) return;
        if (['Escape','ArrowRight','ArrowLeft','ArrowDown','ArrowUp','PageDown','PageUp',' ','b','B','.','p','P','Tab'].includes(e.key)) {
            if (e.key !== 'Tab') e.preventDefault(); e.stopImmediatePropagation();
            if (e.key === 'Escape') exit();
            else if (['b','B','.'].includes(e.key)) blackout();
            else if (['p','P'].includes(e.key)) presenter();
            else if (e.key === 'Tab') { if (black) e.preventDefault(); }
            else next(['ArrowLeft','ArrowUp','PageUp'].includes(e.key));
        }
    }
    function syncSpeaker() {
        if (!speaker || speaker.closed) return;
        const d = speaker.document;
        d.querySelector('#status')!.textContent = `${index+1} / ${slides().length} · ${Math.floor((Date.now()-started)/1000)} 秒`;
        d.querySelector('#notes')!.textContent = slides()[index].getAttribute('data-ppte-notes') ?? slides()[index].querySelector('[data-ppte-notes]')?.textContent ?? '无备注';
        // Rebuild only the private preview, with content scripts still forbidden.
        const clone = frame.contentDocument!.documentElement.cloneNode(true) as HTMLElement;
        materializeMedia(clone);
        clone.querySelectorAll('[data-ppte-transient],meta[http-equiv]').forEach(n => n.remove());
        const list = Array.from(clone.querySelectorAll('[data-ppte-slide]'));
        list.forEach((n,i) => { if (i !== Math.min(index+1,list.length-1)) n.remove(); });
        const preview = d.querySelector('iframe') as HTMLIFrameElement;
        const size = sizes[Math.min(index+1,list.length-1)];
        const scale = Math.min(preview.clientWidth/size.width, preview.clientHeight/size.height);
        const previewStyle = clone.ownerDocument.createElement('style');
        previewStyle.textContent = `html,body{margin:0!important;padding:0!important;overflow:hidden!important}[data-ppte-slide]{position:absolute!important;left:0!important;top:0!important;margin:0!important;width:${size.width}px!important;height:${size.height}px!important;transform:scale(${scale})!important;transform-origin:top left!important}[data-ppte-step]{visibility:visible!important;opacity:1!important}[data-ppte-notes]:not([data-ppte-slide]){display:none!important}`;
        clone.querySelector('head')!.append(previewStyle);
        preview.srcdoc = frameContent(cleanContent(clone.outerHTML).html);
    }
    function presenter() {
        if (!running) return;
        try { speaker = window.open('', 'ppte-presenter', 'popup,width=900,height=700'); } catch { speaker = null; }
        presenterBlocked = !speaker;
        if (!speaker) return;
        const d = speaker.document;
        d.body.replaceChildren(); d.title = '演讲者视图';
        d.body.innerHTML = '<style>body{font:16px/1.5 system-ui;margin:24px;background:#f4f5f7;color:#20252c}h1{font-size:24px}h2{font-size:16px}button{font:inherit;color:#20252c;background:#fff;border:1px solid #ccd3de;border-radius:8px;margin:8px 8px 0 0;padding:8px 12px}button:focus-visible{outline:3px solid #335cff;outline-offset:3px}iframe{background:#fff;border-radius:8px}</style><h1>演讲者视图</h1><p id="status"></p><p id="notes"></p><h2>下一页</h2><iframe title="下一页预览" sandbox="allow-same-origin" style="width:100%;height:360px;border:0"></iframe>';
        for (const [label, action] of [['上一页',()=>next(true)],['下一步',()=>next()],['黑屏 / 恢复',()=>blackout()],['退出放映',exit]] as const) { const b=d.createElement('button'); b.textContent=label;b.onclick=action;d.body.append(b); }
        d.addEventListener('keydown',keys); syncSpeaker();
    }
    shell.querySelector('#ppte-black')!.addEventListener('click',()=>blackout(false));
    function attach() {
        frame.contentDocument!.addEventListener('load',e=>{if ((e.target as Element).tagName === 'IMG') draw();},true);
        frame.contentDocument!.addEventListener('keydown',keys,true);
        frame.contentDocument!.addEventListener('pointermove',wake);
        let touch: { x: number; y: number } | undefined;
        const interactive = (target: EventTarget | null) => (target as Element).closest('video,audio,a,area,input,button,select,textarea');
        frame.contentDocument!.addEventListener('touchstart', e => { touch = running && e.touches.length === 1 && !interactive(e.target) ? { x:e.touches[0].clientX, y:e.touches[0].clientY } : undefined; }, {passive:true});
        frame.contentDocument!.addEventListener('touchend', e => { const start=touch; touch=undefined; if (!running || !start || !e.changedTouches.length) return; const dx=e.changedTouches[0].clientX-start.x, dy=e.changedTouches[0].clientY-start.y; if (Math.abs(dx)>60 && Math.abs(dx)>Math.abs(dy)*1.5) { e.preventDefault(); next(dx>0); } }, {passive:false});
        frame.contentDocument!.addEventListener('click',e=>{ if (running && !interactive(e.target)) next(); });
    }
    attach(); frame.addEventListener('load',()=>{if(running)exit();attach();});
    document.addEventListener('keydown',keys,true);
    document.addEventListener('fullscreenchange',()=>{if (!running) return; if (document.fullscreenElement) { fullscreenOwned=true; draw(); } else if (fullscreenOwned) exit();});
    window.addEventListener('resize',draw);
    const clock = setInterval(()=>{if(speaker && !speaker.closed) {const n=speaker.document.querySelector('#status');if(n)n.textContent=`${index+1} / ${slides().length} · ${Math.floor((Date.now()-started)/1000)} 秒`;}},1000);
    window.addEventListener('pagehide',()=>{clearInterval(clock);speaker?.close();});
    return { get running(){return running;}, get presenterBlocked(){return presenterBlocked;}, get index(){return index;}, get step(){return step;}, get black(){return black;}, next, exit, presenter,
        start() {
            if (running) return;
            index = Math.min(hooks.current(),slides().length-1); step=0; started=Date.now();
            hooks.suspend();
            sizes=slides().map(n=>{const r=n.getBoundingClientRect();const style=frame.contentWindow!.getComputedStyle(n);return {width:Math.max(1,r.width),height:Math.max(1,r.height),display:style.display,background:style.backgroundColor==='rgba(0, 0, 0, 0)'?frame.contentWindow!.getComputedStyle(frame.contentDocument!.body).backgroundColor:style.backgroundColor};});
            running=true; shell.hidden=false; wake();
            css=frame.contentDocument!.createElement('style');css.dataset.ppteTransient='';frame.contentDocument!.head.append(css);draw();frame.focus();
            const requestSession = ++session;
            try { void document.documentElement.requestFullscreen?.().then(() => { if (running && session === requestSession) fullscreenOwned = !!document.fullscreenElement; if (!running && session === requestSession + 1 && document.fullscreenElement) void document.exitFullscreen().catch(()=>{}); }).catch(()=>{}); } catch { /* Fullscreen is optional. */ }
        }
    };
}
