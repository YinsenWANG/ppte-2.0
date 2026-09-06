import { cleanContent } from '../../html-document/src/content.js';
import { sha } from './save.js';
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
};
export class Commands {
    undoStack: Entry[][] = [];
    redoStack: Entry[][] = [];
    constructor(public doc: Document, private changed: () => void) {
    }
    node(id: string) {
        const n = Array.from(this.doc.querySelectorAll<HTMLElement>('[data-ppte-id]')).find(n => n.dataset.ppteId === id);
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
            this.undoStack.push(actual);
            this.redoStack = [];
            this.changed();
        }
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
        for (const e of entries)
            if (snapshot(this.node(e.id)) !== (redo ? e.before : e.after))
                throw Error('HISTORY_CONFLICT');
        for (const e of entries)
            this.restore(this.node(e.id), redo ? e.after : e.before);
        from.pop();
        to.push(entries);
        this.changed();
    }
    style(ids: string[], property: string, value: string) {
        if (!['font-size', 'font-weight', 'font-style', 'color', 'text-align', 'background', 'width', 'height', 'left', 'top', 'transform', 'gap', 'grid-template-columns', 'object-fit', 'fill', 'order'].includes(property) || !CSS.supports(property, value) || /url\(|expression|@import/i.test(value))
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
    table(id: string, action: 'row' | 'column' | 'delete-row' | 'delete-column') {
        this.transaction([id], n => {
            if (n.tagName !== 'TABLE')
                throw Error('NOT_TABLE');
            const t = n as HTMLTableElement;
            if (action === 'row') {
                const row = t.insertRow();
                for (let i = 0; i < (t.rows[0]?.cells.length || 2); i++)
                    row.insertCell().textContent = '内容';
            }
            if (action === 'column')
                for (const row of Array.from(t.rows))
                    row.insertCell().textContent = '内容';
            if (action === 'delete-row') {
                if (t.rows.length <= 1)
                    throw Error('LAST_ROW');
                t.deleteRow(t.rows.length - 1);
            }
            if (action === 'delete-column') {
                if (Array.from(t.rows).some(r => r.cells.length <= 1))
                    throw Error('LAST_COLUMN');
                for (const row of Array.from(t.rows))
                    row.deleteCell(row.cells.length - 1);
            }
            for (const cell of Array.from(t.querySelectorAll('td,th')))
                if (!cell.hasAttribute('data-ppte-id'))
                    cell.setAttribute('data-ppte-id', `cell-${crypto.randomUUID()}`);
        });
    }
    async media(id: string, file: File) {
        const n = this.node(id);
        if (!['IMG', 'VIDEO'].includes(n.tagName) || !/^image\/(png|jpeg|webp|gif)$|^video\/(mp4|webm)$/.test(file.type) || !file.size)
            throw Error('UNSUPPORTED_MEDIA');
        if (n.tagName === 'IMG' && !file.type.startsWith('image/') || n.tagName === 'VIDEO' && !file.type.startsWith('video/'))
            throw Error('MEDIA_KIND_MISMATCH');
        const original = snapshot(n);
        const src = await new Promise<string>((ok, no) => {
            const r = new FileReader();
            r.onload = () => ok(String(r.result));
            r.onerror = no;
            r.readAsDataURL(file);
        });
        if (n.tagName === 'IMG') {
            const image = new Image();
            image.src = src;
            await image.decode();
        }
        if (snapshot(this.node(id)) !== original)
            throw Error('CONFLICT');
        this.transaction([id], n => {
            n.setAttribute('src', src);
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
