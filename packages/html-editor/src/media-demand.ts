/** Deferred URLs are transient. Materialize detached clones before history/save/print.
 * No blob URLs, second document model, persisted dimensions or author-style changes. */
const prefix = 'data-ppte-editor-media-';
const selector = 'img,video,audio,source';
function nodes(root: Element | Document) {
    return [...(root.nodeType === 1 && (root as Element).matches(selector) ? [root as Element] : []), ...Array.from(root.querySelectorAll(selector))];
}
function renameURLs(n: Element, demand: boolean) {
    let changed = false;
    const attributes = Array.from(n.attributes, a => {
        const attr = demand && a.name.startsWith(prefix) ? a.name.slice(prefix.length) : a.name;
        if (['src','poster'].includes(attr) && (demand ? a.name.startsWith(prefix) : !a.name.startsWith(prefix))) {
            changed = true; return [demand ? attr : prefix + attr, a.value];
        }
        return [a.name,a.value];
    });
    if (!changed) return false;
    // DOM has no renameAttribute. Rebuild in the same order so hydration never
    // changes canonical snapshots or creates spurious save/history revisions.
    for (const a of Array.from(n.attributes)) n.removeAttribute(a.name);
    for (const [name,value] of attributes) n.setAttribute(name,value);
    return true;
}
export function materializeMedia(root: Element | Document) {
    const reset = new Set<HTMLMediaElement>();
    for (const n of nodes(root)) if (renameURLs(n,true)) {
        const media = n.closest('video,audio') as HTMLMediaElement | null;
        if (media?.isConnected) reset.add(media);
    }
    // Restoring <source src> alone does not restart resource selection.
    for (const media of reset) media.load();
}
export function deferMedia(root: Element | Document) {
    const reset = new Set<HTMLMediaElement>();
    for (const n of nodes(root)) if (renameURLs(n,false)) {
        const media = n.closest('video,audio') as HTMLMediaElement | null;
        if (media?.isConnected) reset.add(media);
    }
    for (const media of reset) { media.pause(); media.load(); }
}
export function demandSlide(doc: Document, index: number) {
    doc.querySelectorAll('[data-ppte-slide]').forEach((slide,i) => {
        if (i === index) materializeMedia(slide); else deferMedia(slide);
    });
}
