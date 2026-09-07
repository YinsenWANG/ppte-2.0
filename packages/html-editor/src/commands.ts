import { cleanContent } from '../../html-document/src/content.js';
import { sha } from './save.js';
import { MediaHistory } from './media-history.js';
export const editable = 'h1,h2,h3,h4,h5,h6,p,li,td,th,figcaption,[data-ppte-kind="text"]';
const clean = (e: Element) => {
    const c = e.cloneNode(true) as Element;
    c.querySelectorAll('[data-ppte-transient]').forEach(n => n.remove());
    for (const n of [c, ...Array.from(c.querySelectorAll('*'))])
        for (const a of Array.from(n.attributes))
            if (a.name === 'contenteditable' || a.name === 'tabindex' || a.name.startsWith('data-ppte-editor-'))
                n.removeAttribute(a.name);
    return c;
};
export const snapshot = (e: Element) => clean(e).outerHTML;
type Entry = {
    id: string;
    before: string;
    after: string;
    removed?: boolean;
    insertion?: { parent: HTMLElement; previous: HTMLElement | null; node: HTMLElement };
};
export class Commands {
    undoStack: Entry[][] = [];
    redoStack: Entry[][] = [];
    readonly mediaHistory = new MediaHistory();
    historyTrimmed = false;
    private index = new Map<string, HTMLElement>();
    private observer: MutationObserver;
    constructor(public doc: Document, private changed: (ids: string[]) => void) {
        this.indexTree(doc.documentElement);
        this.observer = new doc.defaultView!.MutationObserver(records => this.updateIndex(records));
        this.observer.observe(doc.documentElement, {subtree:true, childList:true, attributes:true, attributeFilter:['data-ppte-id'], attributeOldValue:true});
    }
    private indexTree(root: Element, remove = false) {
        for(const n of [root, ...Array.from(root.querySelectorAll<HTMLElement>('[data-ppte-id]'))]) {
            const id = n.getAttribute('data-ppte-id');
            if(id && (!remove || this.index.get(id)===n)) {
                if(remove)this.index.delete(id); else this.index.set(id,n as HTMLElement);
            }
        }
    }
    private updateIndex(records: MutationRecord[]) {
        for(const r of records) {
            if(r.type==='attributes') {
                if(r.oldValue && this.index.get(r.oldValue)===r.target)this.index.delete(r.oldValue);
                this.indexTree(r.target as Element);
            } else {
                r.removedNodes.forEach(n=>{if(n.nodeType===1)this.indexTree(n as Element,true);});
                r.addedNodes.forEach(n=>{if(n.nodeType===1)this.indexTree(n as Element);});
            }
        }
    }
    node(id: string) {
        this.updateIndex(this.observer.takeRecords());
        const n = this.index.get(id);
        if (!n)
            throw Error('OBJECT_NOT_FOUND');
        return n;
    }
    protected(n: Element) {
        return !!(n.closest('[data-ppte-locked="true"]') || n.querySelector('[data-ppte-locked="true"]'));
    }
    async hash(id: string) {
        return sha(snapshot(this.node(id)));
    }
    record(entries: Entry[]) {
        const actual = entries.filter(e => e.before !== e.after);
        if (actual.length) {
            this.undoStack.push(actual.map(e => ({...e, before: this.mediaHistory.compact(e.before), after: this.mediaHistory.compact(e.after)})));
            this.redoStack = [];
            this.pruneHistory();
            this.changed(actual.map(e => e.id));
        }
    }
    private pruneHistory() {
        const retain = () => this.mediaHistory.retain(JSON.stringify([this.undoStack, this.redoStack]));
        retain();
        while (this.undoStack.length > 100 || this.mediaHistory.stats.estimatedStringBytes > 64 * 1024 * 1024 && this.undoStack.length > 1) {
            this.undoStack.shift(); this.historyTrimmed = true; retain();
        }
    }
    clearHistory() {
        this.undoStack = []; this.redoStack = []; this.mediaHistory.retain('');
    }
    transaction(ids: string[], mutate: (n: HTMLElement) => void, unlock = false) {
        const nodes = [...new Set(ids)].map(id => this.node(id));
        if (!nodes.length)
            throw Error('NO_SELECTION');
        if (nodes.some(n => nodes.some(p => p !== n && p.contains(n))))
            throw Error('OVERLAPPING_SELECTION');
        if (nodes.some(n => this.protected(n) && !(unlock && n.dataset.ppteLocked === 'true' && !n.parentElement?.closest('[data-ppte-locked="true"]'))))
            throw Error('OBJECT_PROTECTED');
        // Validate on detached clones first; failed commands leave the live DOM and history intact.
        const entries = nodes.map(n => {
            const copy = clean(n) as HTMLElement;
            mutate(copy);
            return { id: n.dataset.ppteId!, before: snapshot(n), after: snapshot(copy) };
        });
        for (const e of entries)
            this.restore(this.node(e.id), e.after);
        this.record(entries);
    }
    insertSlide(reference: string) {
        const previous = this.node(reference), parent = previous.parentElement!;
        if (!previous.hasAttribute('data-ppte-slide') || previous.tagName === 'BODY' || !parent) throw Error('PAGE_INSERT_UNSUPPORTED');
        if (parent.closest('[data-ppte-locked="true"]')) throw Error('OBJECT_PROTECTED');
        const computed = this.doc.defaultView!.getComputedStyle(previous);
        const n = this.doc.createElement(previous.tagName);
        n.className = previous.className;
        n.style.cssText = previous.style.cssText;
        // Preserve native class/custom-property layout, but give blank content a measured canvas.
        for (const property of ['width', 'height', 'box-sizing', 'background', 'color', 'font-family', 'container-type', 'container-name'])
            n.style.setProperty(property, computed.getPropertyValue(property));
        n.dataset.ppteId = `slide-${crypto.randomUUID()}`;
        n.dataset.ppteSlide = n.dataset.ppteId;
        const title = this.doc.createElement('h1');
        title.dataset.ppteId = `text-${crypto.randomUUID()}`;
        title.textContent = '新的一页';
        n.append(title);
        previous.after(n);
        this.record([{ id: n.dataset.ppteId, before: '', after: snapshot(n), insertion: { parent, previous, node: n } }]);
        return n;
    }
    restore(n: HTMLElement, html: string) {
        const t = this.doc.createElement('template');
        t.innerHTML = html;
        const c = n.tagName === 'BODY' ? new DOMParser().parseFromString(html, 'text/html').body : t.content.firstElementChild!;
        for (const a of Array.from(n.attributes))
            if (!c.hasAttribute(a.name) && a.name !== 'contenteditable' && a.name !== 'tabindex' && !a.name.startsWith('data-ppte-editor-'))
                n.removeAttribute(a.name);
        for (const a of Array.from(c.attributes))
            n.setAttribute(a.name, a.value);
        if (clean(n).innerHTML !== c.innerHTML)
            n.replaceChildren(...Array.from(c.childNodes));
    }
    history(redo = false) {
        const from = redo ? this.redoStack : this.undoStack, to = redo ? this.undoStack : this.redoStack;
        const entries = from.at(-1);
        if (!entries)
            return;
        for (const e of entries) {
            if (e.insertion) {
                const { parent, previous, node } = e.insertion;
                if (!parent.isConnected || previous && previous.parentElement !== parent || parent.closest('[data-ppte-locked="true"]') ||
                    ((redo !== !!e.removed) ? node.isConnected : node.parentElement !== parent || this.protected(node) || snapshot(node) !== this.mediaHistory.expand(e.removed ? e.before : e.after)))
                    throw Error('HISTORY_CONFLICT');
            } else if (snapshot(this.node(e.id)) !== this.mediaHistory.expand(redo ? e.before : e.after)) throw Error('HISTORY_CONFLICT');
        }
        for (const e of entries) {
            if (e.insertion) {
                if (redo !== !!e.removed) { if (e.insertion.previous) e.insertion.previous.after(e.insertion.node); else e.insertion.parent.prepend(e.insertion.node); }
                else e.insertion.node.remove();
            } else this.restore(this.node(e.id), this.mediaHistory.expand(redo ? e.after : e.before));
        }
        from.pop();
        to.push(entries);
        this.changed(entries.map(e => e.id));
    }
    style(ids: string[], property: string, value: string) {
        if (!['font-size', 'font-weight', 'font-style', 'color', 'text-align', 'background', 'width', 'height', 'left', 'top', 'transform', 'gap', 'grid-template-columns', 'object-fit', 'fill', 'order', 'font-family', 'border-color', 'border-width', 'border-style', 'border-radius', 'align-self', 'margin'].includes(property) || !CSS.supports(property, value) || /url\(|expression|@import/i.test(value))
            throw Error('INVALID_STYLE');
        this.transaction(ids, n => {
            n.style.setProperty(property, value);
            if (property === 'fill') {
                if (n.tagName.toLowerCase() === 'svg') {
                    const shapes = Array.from(n.querySelectorAll('rect,circle,ellipse,path,polygon,polyline'));
                    if (shapes.length !== 1)
                        throw Error('COMPLEX_SVG: 请替换整体图形');
                    shapes[0].setAttribute('fill', value);
                }
                else if (n.dataset.ppteKind === 'shape')
                    n.style.background = value;
            }
        });
    }
    text(id: string, value: string) {
        this.transaction([id], n => {
            if (!n.matches(editable))
                throw Error('NOT_TEXT');
            n.textContent = value;
        });
    }
    lock(ids: string[], locked: boolean) {
        this.transaction(ids, n => n.setAttribute('data-ppte-locked', String(locked)), !locked);
    }
    move(id: string, dx: number, dy: number) {
        const n = this.node(id), s = this.doc.defaultView!.getComputedStyle(n);
        if (s.position === 'absolute') {
            this.style([id], 'transform', `${s.transform === 'none' ? '' : s.transform} translate(${dx}px,${dy}px)`);
        }
        else if (/grid|flex/.test(this.doc.defaultView!.getComputedStyle(n.parentElement!).display)) {
            this.style([id], 'order', String((Number(s.order) || 0) + Math.sign(dx || dy)));
        }
        else
            throw Error('LAYOUT_UNSUPPORTED: 此对象使用普通文档流');
    }
    align(ids: string[], edge: 'left'|'center'|'right'|'top'|'middle'|'bottom', baseline: 'selection'|'page'|'content' = 'selection') {
        const nodes = ids.map(id=>this.node(id));
        if (!nodes.length || !nodes.every(n=>this.doc.defaultView!.getComputedStyle(n).position==='absolute')) throw Error('LAYOUT_UNSUPPORTED: 流式对象请使用容器内对齐');
        if(!['selection','page','content'].includes(baseline) || !['left','center','right','top','middle','bottom'].includes(edge))throw Error('INVALID_ALIGNMENT');
        const rects=nodes.map(n=>n.getBoundingClientRect());
        let area={left:Math.min(...rects.map(r=>r.left)),right:Math.max(...rects.map(r=>r.right)),top:Math.min(...rects.map(r=>r.top)),bottom:Math.max(...rects.map(r=>r.bottom))};
        if(baseline!=='selection'){
            const parents=nodes.map(n=>baseline==='page'?n.closest('[data-ppte-slide]'):n.parentElement);
            if(!parents[0] || !parents.every(n=>n===parents[0]))throw Error('ALIGNMENT_SCOPE: 请选择同一页面或内容区');
            area=parents[0].getBoundingClientRect();
        }
        const changes=new Map(nodes.map((n,i)=>{const r=rects[i];const dx=edge==='left'?area.left-r.left:edge==='right'?area.right-r.right:edge==='center'?(area.left+area.right-r.left-r.right)/2:0;const dy=edge==='top'?area.top-r.top:edge==='bottom'?area.bottom-r.bottom:edge==='middle'?(area.top+area.bottom-r.top-r.bottom)/2:0;const transform=this.doc.defaultView!.getComputedStyle(n).transform;return [n.dataset.ppteId!,new DOMMatrix().translate(dx,dy).multiply(new DOMMatrix(transform==='none'?'':transform)).toString()];}));
        this.transaction(ids,n=>n.style.transform=changes.get(n.dataset.ppteId!)!);
    }
    table(id: string, action: 'row' | 'column' | 'delete-row' | 'delete-column', cellId?: string) {
        this.transaction([id], n => {
            if (n.tagName !== 'TABLE')
                throw Error('NOT_TABLE');
            const t = n as HTMLTableElement;
            if (t.querySelector('[rowspan]:not([rowspan="1"]),[colspan]:not([colspan="1"])')) throw Error('TABLE_SPAN: 合并单元格请先在源文件中调整');
            const liveCell = cellId ? this.node(cellId) as HTMLTableCellElement : undefined;
            if (liveCell && liveCell.closest('table') !== this.node(id)) throw Error('INVALID_CELL');
            const ri = liveCell ? (liveCell.parentElement as HTMLTableRowElement).rowIndex : t.rows.length - 1;
            const ci = liveCell?.cellIndex ?? (t.rows[0]?.cells.length ?? 1) - 1;
            if (action === 'row') {
                const row = t.insertRow(ri + 1);
                const source = t.rows[ri];
                for (let i = 0; i < (source?.cells.length || 2); i++) {
                    const cell=row.insertCell();cell.textContent='内容';cell.style.cssText=source?.cells[i]?.style.cssText ?? '';
                }
            }
            if (action === 'column')
                for (const row of Array.from(t.rows)) {
                    const style=row.cells[Math.min(ci,row.cells.length-1)]?.style.cssText ?? '';
                    const cell=row.insertCell(Math.min(ci + 1, row.cells.length));cell.textContent='内容';cell.style.cssText=style;
                }
            if (action === 'delete-row') {
                if (t.rows.length <= 1)
                    throw Error('LAST_ROW');
                t.deleteRow(ri);
            }
            if (action === 'delete-column') {
                if (Array.from(t.rows).some(r => r.cells.length <= 1))
                    throw Error('LAST_COLUMN');
                for (const row of Array.from(t.rows))
                    row.deleteCell(Math.min(ci, row.cells.length - 1));
            }
            for (const cell of Array.from(t.querySelectorAll('td,th')))
                if (!cell.hasAttribute('data-ppte-id'))
                    cell.setAttribute('data-ppte-id', `cell-${crypto.randomUUID()}`);
        });
    }
    crop(ids: string[], fit: 'contain' | 'cover', x = 50, y = 50) {
        if (!['contain', 'cover'].includes(fit) || ![x, y].every(v => Number.isFinite(v) && v >= 0 && v <= 100)) throw Error('INVALID_CROP');
        this.transaction(ids, n => {
            if (!['IMG', 'VIDEO'].includes(n.tagName)) throw Error('NOT_MEDIA');
            n.style.setProperty('object-fit', fit, 'important');
            n.style.setProperty('object-position', `${x}% ${y}%`, 'important');
        });
    }
    private async readMedia(file: File, imageOnly = false) {
        if (!/^(image\/(png|jpeg|webp|gif|avif)|video\/(mp4|webm))$/.test(file.type) || !file.size || imageOnly && !file.type.startsWith('image/')) throw Error('UNSUPPORTED_MEDIA');
        if (file.size > 16 * 1024 * 1024) throw Error('MEDIA_LIMIT: 单个资源最多 16 MiB；原始像素不会自动压缩');
        const src = await new Promise<string>((ok, no) => {
            const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = no; r.readAsDataURL(file);
        });
        if (file.type.startsWith('image/')) { const image = new Image(); image.src = src; try { await image.decode(); } catch { throw Error('无法读取这张图片，请重新选择 PNG、JPEG、WebP、GIF 或 AVIF；原对象已保留。'); } }
        return src;
    }
    insertionPoint(slideId: string, referenceId?: string) {
        const slide = this.node(slideId);
        if (!slide.hasAttribute('data-ppte-slide')) throw Error('NOT_SLIDE');
        const reference = referenceId ? this.node(referenceId) : undefined;
        let parent = slide;
        let previous: HTMLElement | null = null;
        if (reference && reference !== slide && slide.contains(reference)) {
            const object = reference.closest<HTMLElement>('table,svg') ?? reference;
            parent = object.parentElement!;
            previous = object;
        } else {
            const containers = Array.from(slide.querySelectorAll<HTMLElement>('[data-ppte-content],main,article,div'));
            parent = containers.find(n => n.hasAttribute('data-ppte-content') && !n.closest('[data-ppte-locked="true"]'))
                ?? containers.find(n => /grid|flex/.test(this.doc.defaultView!.getComputedStyle(n).display) && !n.closest('[data-ppte-locked="true"]'))
                ?? containers.find(n => n.querySelector('p,h1,h2,h3,img,table') && !n.closest('[data-ppte-locked="true"]') && this.doc.defaultView!.getComputedStyle(n).position !== 'absolute') ?? slide;
            previous = parent.lastElementChild as HTMLElement | null;
        }
        if (parent.closest('[data-ppte-locked="true"]')) throw Error('OBJECT_PROTECTED');
        return {parent, previous};
    }
    private appendObject(n: HTMLElement, point: {parent: HTMLElement; previous: HTMLElement | null}) {
        const {parent, previous} = point;
        if (!parent.isConnected || previous && previous.parentElement !== parent) throw Error('CONFLICT');
        if (parent.closest('[data-ppte-locked="true"]')) throw Error('OBJECT_PROTECTED');
        // Keep author containers and styles. New objects participate in native flow;
        // their own stacking level keeps positioned author headings from hiding them.
        if (!n.style.position) n.style.position = 'relative';
        const levels = Array.from((parent.closest('[data-ppte-slide]') ?? parent).querySelectorAll('*')).map(e => Number(this.doc.defaultView!.getComputedStyle(e).zIndex) || 0);
        n.style.zIndex = String(Math.max(0, ...levels) + 1);
        n.dataset.ppteId ||= `object-${crypto.randomUUID()}`;
        if (previous) previous.after(n); else parent.prepend(n);
        this.record([{id:n.dataset.ppteId, before:'', after:snapshot(n), insertion:{parent, previous, node:n}}]);
        return n;
    }
    insertObject(slideId: string, kind: 'text' | 'rect' | 'ellipse' | 'line' | 'table', referenceId?: string, rows = 2, columns = 2) {
        const point = this.insertionPoint(slideId, referenceId);
        if (!['text','rect','ellipse','line','table'].includes(kind)) throw Error('INVALID_OBJECT');
        const n = this.doc.createElement(kind === 'table' ? 'table' : 'div');
        n.style.cssText = 'box-sizing:border-box;max-width:100%;width:280px;min-height:32px';
        if (kind === 'text') {
            n.dataset.ppteKind = 'text'; n.textContent = '输入文字';
            n.style.cssText += ';font:28px system-ui;color:#20242d';
        } else if (kind === 'table') {
            if (![rows,columns].every(v => Number.isInteger(v) && v >= 1 && v <= 50) || rows * columns > 1000) throw Error('TABLE_SIZE: 最多 50 行/列、1000 单元格');
            n.style.cssText += ';border-collapse:collapse;width:100%';
            for (let r=0;r<rows;r++) {
                const row = (n as HTMLTableElement).insertRow();
                for(let c=0;c<columns;c++) {
                    const cell = row.insertCell(); cell.textContent = '内容';
                    cell.dataset.ppteId = `cell-${crypto.randomUUID()}`;
                    cell.style.cssText = 'padding:8px;border:1px solid #737a88';
                }
            }
        } else {
            n.dataset.ppteKind = 'shape'; n.dataset.ppteShape = kind;
            n.setAttribute('role','img'); n.setAttribute('aria-label', {rect:'矩形',ellipse:'椭圆',line:'线条'}[kind]);
            n.style.cssText += kind === 'line' ? ';min-height:0;height:2px;border-top:2px solid #5261d8' : ';height:120px;background:#d5dfc9;border:1px solid #5261d8';
            if (kind === 'ellipse') n.style.borderRadius = '50%';
        }
        return this.appendObject(n, point);
    }
    duplicate(id: string) {
        const n = this.node(id);
        if (n.hasAttribute('data-ppte-slide') || n.matches('td,th') || this.protected(n)) throw Error('OBJECT_PROTECTED_OR_UNSUPPORTED');
        const copy = clean(n) as HTMLElement;
        for (const e of [copy,...Array.from(copy.querySelectorAll<HTMLElement>('[data-ppte-id]'))]) e.dataset.ppteId = `object-${crypto.randomUUID()}`;
        for (const e of [copy,...Array.from(copy.querySelectorAll('[id]'))]) e.removeAttribute('id');
        return this.appendObject(copy,{parent:n.parentElement!,previous:n});
    }
    remove(id: string) {
        const n = this.node(id), parent = n.parentElement!;
        if (n.hasAttribute('data-ppte-slide') || n.matches('td,th') || this.protected(n)) throw Error('OBJECT_PROTECTED_OR_UNSUPPORTED');
        const entry: Entry = {id,before:snapshot(n),after:'',removed:true,insertion:{parent,previous:n.previousElementSibling as HTMLElement | null,node:n}};
        n.remove(); this.record([entry]);
    }
    async insertImage(slideId: string, file: File, referenceId?: string) {
        const point = this.insertionPoint(slideId, referenceId);
        const src = await this.readMedia(file, true);
        const image = this.doc.createElement('img');
        image.dataset.ppteId = `image-${crypto.randomUUID()}`;
        image.src = src; image.alt = '';
        image.style.cssText = 'width:320px;height:240px;max-width:100%;object-fit:contain!important;object-position:50% 50%!important';
        return this.appendObject(image, point);
    }
    async poster(id: string, file: File) {
        const n = this.node(id);
        if (n.tagName !== 'VIDEO') throw Error('NOT_VIDEO');
        if (this.protected(n)) throw Error('OBJECT_PROTECTED');
        const original = snapshot(n), src = await this.readMedia(file, true);
        if (snapshot(this.node(id)) !== original) throw Error('CONFLICT');
        this.transaction([id], n => n.setAttribute('poster', src));
    }
    async media(id: string, file: File) {
        const n = this.node(id);
        if (!['IMG', 'VIDEO'].includes(n.tagName)) throw Error('NOT_MEDIA');
        if (n.tagName === 'IMG' && !file.type.startsWith('image/') || n.tagName === 'VIDEO' && !file.type.startsWith('video/')) throw Error('MEDIA_KIND_MISMATCH');
        if (this.protected(n)) throw Error('OBJECT_PROTECTED');
        const original = snapshot(n);
        const src = await this.readMedia(file);
        if (snapshot(this.node(id)) !== original)
            throw Error('CONFLICT');
        this.transaction([id], n => {
            n.setAttribute('src', src);
            n.style.setProperty('object-fit', 'contain', 'important');
            n.style.setProperty('object-position', '50% 50%', 'important');
            if (n.tagName === 'IMG') n.setAttribute('alt', '');
            else n.removeAttribute('poster');
            n.removeAttribute('srcset');
            n.querySelectorAll('source').forEach(e => e.remove());
        });
    }
    async svg(id: string, file: File) {
        const original = snapshot(this.node(id));
        if (this.node(id).tagName.toLowerCase() !== 'svg' || file.type !== 'image/svg+xml')
            throw Error('NOT_SVG');
        const result = cleanContent(await file.text(), false);
        if (result.issues.length)
            throw Error('UNSAFE_SVG');
        const parsed = new DOMParser().parseFromString(result.html, 'text/html');
        const svg = parsed.body.firstElementChild;
        if (svg?.tagName.toLowerCase() !== 'svg' || parsed.body.children.length !== 1)
            throw Error('NOT_SVG');
        svg.querySelectorAll('[data-ppte-id]').forEach(n => n.removeAttribute('data-ppte-id'));
        if (snapshot(this.node(id)) !== original)
            throw Error('CONFLICT');
        this.transaction([id], n => {
            n.innerHTML = svg.innerHTML;
            if (svg.hasAttribute('viewBox'))
                n.setAttribute('viewBox', svg.getAttribute('viewBox')!);
        });
    }
    async agent(id: string, expected: string, patch: {
        text?: string;
        style?: Record<string, string>;
    }) {
        if (!patch || Object.keys(patch).some(k => !['text', 'style'].includes(k)) || patch.text !== undefined && typeof patch.text !== 'string')
            throw Error('UNSUPPORTED_PATCH');
        const original = snapshot(this.node(id));
        if (await sha(original) !== expected || snapshot(this.node(id)) !== original)
            throw Error('CONFLICT');
        this.transaction([id], n => {
            if (patch.text !== undefined) {
                if (!n.matches(editable))
                    throw Error('NOT_TEXT');
                n.textContent = patch.text;
            }
            for (const [k, v] of Object.entries(patch.style ?? {})) {
                if (!['color', 'font-size', 'background', 'gap', 'grid-template-columns'].includes(k) || !CSS.supports(k, v) || /url\(/i.test(v))
                    throw Error('INVALID_STYLE');
                n.style.setProperty(k, v);
            }
        });
    }
}
