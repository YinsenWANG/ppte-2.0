// Placement changes only the new object. Measurements belong to the author
// document (not the outer editor viewport), including its clipping containers.
const intersects = (a: DOMRect, b: DOMRect, gap = 0) =>
    a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap;

export function placeInserted(n: HTMLElement, parent: HTMLElement, previous: HTMLElement | null, isText: (n: Element) => boolean) {
    const doc = n.ownerDocument, win = doc.defaultView!, slide = parent.closest<HTMLElement>('[data-ppte-slide]')!;
    const visible = (e: Element) => {
        const s = win.getComputedStyle(e), r = e.getBoundingClientRect();
        return s.display !== 'none' && s.visibility === 'visible' && s.opacity !== '0' && r.width > 0 && r.height > 0;
    };
    const siblings = Array.from(parent.children).filter(e => e !== n && visible(e));
    const absolute = !/grid|flex/.test(win.getComputedStyle(parent).display) && siblings.length > 0 &&
        siblings.every(e => win.getComputedStyle(e).position === 'absolute');
    const obstacles = () => {
        const rects: DOMRect[] = [];
        for (const e of Array.from(slide.querySelectorAll('*'))) {
            if (e === n || n.contains(e) || e.contains(n) || !visible(e) || e.closest('[data-ppte-transient]')) continue;
            if (isText(e) || e.matches('img,video,svg,table,[data-ppte-kind="shape"]') ||
                e.tagName === 'DIV' && !e.children.length && !e.textContent?.trim() && win.getComputedStyle(e).position === 'absolute') rects.push(e.getBoundingClientRect());
        }
        // Also protect text in mixed containers, not just supported text objects
        // or heading tags. Range boxes include inline runs and wrapped lines.
        const walker = doc.createTreeWalker(slide, win.NodeFilter.SHOW_TEXT);
        let t: Node | null;
        while (t = walker.nextNode()) {
            if (!t.textContent?.trim() || n.contains(t) || !t.parentElement || !visible(t.parentElement) || t.parentElement.closest('script,style,[data-ppte-transient]')) continue;
            const range = doc.createRange(); range.selectNodeContents(t);
            rects.push(...Array.from(range.getClientRects()));
        }
        return rects.filter(r => r.width > 0 && r.height > 0);
    };
    const contained = (r: DOMRect) => {
        if (!r.width || !r.height) return false;
        for (let e: HTMLElement | null = parent; e; e = e.parentElement) {
            const s = win.getComputedStyle(e), b = e.getBoundingClientRect();
            if (/hidden|clip|auto|scroll/.test(s.overflowX) && (r.left < b.left - .5 || r.right > b.right + .5)) return false;
            if (/hidden|clip|auto|scroll/.test(s.overflowY) && (r.top < b.top - .5 || r.bottom > b.bottom + .5)) return false;
            if (e === slide) break;
        }
        return true;
    };
    if (absolute) {
        n.style.position = 'absolute'; n.style.margin = '0'; n.style.transform = 'none';
        n.style.left = '16px'; n.style.top = '16px'; n.style.right = 'auto'; n.style.bottom = 'auto';
        if (n.tagName === 'TABLE') n.style.width = `${Math.min(360, parent.clientWidth - 32)}px`;
        if (n.offsetParent !== parent) throw Error('PLACEMENT_UNSUPPORTED: 此容器没有可用的定位基准；插入已撤销，请选择其他内容位置');
        const area = parent.getBoundingClientRect(), origin = n.getBoundingClientRect(), blocks = obstacles();
        const sx = area.width / parent.offsetWidth, sy = area.height / parent.offsetHeight;
        const startX = origin.left - 16 * sx, startY = origin.top - 16 * sy;
        const width = n.offsetWidth, height = n.offsetHeight;
        const scalable = n.matches('img,[data-ppte-kind="shape"]') && height > 8;
        const preferred = previous?.getBoundingClientRect();
        // Prefer the selected object's content region, even if media must be
        // smaller; only then consider other whitespace (such as above it).
        for (const nearSelection of preferred ? [true, false] : [false])
        for (const scale of scalable ? [1, .85, .7, .55, .4, .3] : [1]) {
            if (scalable) { n.style.width = `${width * scale}px`; n.style.height = `${height * scale}px`; }
            const size = n.getBoundingClientRect();
            const xs = [preferred?.left ?? area.left + 16, area.left + 16, ...blocks.flatMap(b => [b.right + 8, b.left])];
            const ys = [preferred ? preferred.bottom + 16 : area.top + 16, area.top + 16, ...blocks.map(b => b.bottom + 8)];
            for (const y of ys) for (const x of xs) {
                if (nearSelection && preferred && y < preferred.bottom + 8) continue;
                const r = new win.DOMRect(x, y, size.width, size.height);
                if (x < area.left + 16 || y < area.top + 16 || r.right > area.right - 16 || r.bottom > area.bottom - 16 || blocks.some(b => intersects(r, b, 8))) continue;
                n.style.left = `${(x - startX) / sx}px`; n.style.top = `${(y - startY) / sy}px`;
                const placed = n.getBoundingClientRect();
                if (contained(placed) && !blocks.some(b => intersects(placed, b, 7.5))) return;
            }
        }
    } else {
        n.style.position = 'relative'; n.style.flexShrink = '0';
        const width = n.offsetWidth, height = n.offsetHeight, marginTop = n.style.marginTop;
        const scalable = n.matches('img,[data-ppte-kind="shape"]') && height > 8;
        // A positioned heading can sit above an otherwise normal flow. Reserve
        // space on this object, then remeasure the displaced following content.
        for (const scale of scalable ? [1, .85, .7, .55, .4, .3] : [1]) {
        n.style.marginTop = marginTop;
        if (scalable) { n.style.width = `${width * scale}px`; n.style.height = `${height * scale}px`; }
        for (let attempt = 0; attempt < 8; attempt++) {
            const r = n.getBoundingClientRect(), collisions = obstacles().filter(b => intersects(r, b));
            if (!collisions.length && contained(r)) return;
            if (!collisions.length) break;
            const margin = parseFloat(win.getComputedStyle(n).marginTop) || 0;
            n.style.marginTop = `${margin + Math.max(...collisions.map(b => b.bottom)) - r.top + 8}px`;
        }
        }
    }
    throw Error('OBJECT_PLACEMENT: 此内容区没有足够空白容纳对象并避开文字和媒体；插入已撤销，请选择其他内容位置或新建页面');
}
