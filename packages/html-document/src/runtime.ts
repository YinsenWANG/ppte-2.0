import { cleanContent, frameContent } from './content.js';

// Only build-owned code executes in the parent. Content never receives a script capability.
const template = document.querySelector<HTMLTemplateElement>('#ppte-content')!;
const frame = document.querySelector<HTMLIFrameElement>('#ppte-frame')!;
const metadata = JSON.parse(document.querySelector('#ppte-metadata')!.textContent!);
const initial = cleanContent(template.content.textContent ?? '');
frame.srcdoc = frameContent(initial.html);
frame.addEventListener('load', () => {
  const doc = frame.contentDocument!;
  doc.addEventListener('click', event => {
    if ((event.target as Element).closest('a,area')) event.preventDefault();
  }, true);
  doc.addEventListener('submit', event => event.preventDefault(), true);
});
// H02 supplies write adapters. This API serializes; it does not claim disk persistence.
Object.defineProperty(window, 'PPTeHTML', { value: Object.freeze({
  get contentDocument() { return frame.contentDocument; },
  get metadata() { return structuredClone(metadata); },
  serialize() {
    if (!frame.contentDocument?.documentElement || frame.contentDocument.URL === 'about:blank') throw Error('CONTENT_NOT_READY');
    // The policy meta was injected by us and is re-created on each mount.
    const clone = frame.contentDocument.documentElement.cloneNode(true) as HTMLElement;
    clone.querySelector('meta[http-equiv="Content-Security-Policy"]')?.remove();
    const result = cleanContent('<!doctype html>' + clone.outerHTML);
    if (result.issues.length) throw Error('UNSAFE_CONTENT: ' + JSON.stringify(result.issues));
    const shell = document.documentElement.cloneNode(true) as HTMLElement;
    const persistent = shell.querySelector<HTMLTemplateElement>('#ppte-content')!;
    persistent.content.replaceChildren(document.createTextNode(result.html));
    const iframe = shell.querySelector('#ppte-frame')!;
    iframe.removeAttribute('srcdoc'); iframe.removeAttribute('src');
    const next = { ...metadata, saveRevision: metadata.saveRevision + 1 };
    shell.querySelector('#ppte-metadata')!.textContent = JSON.stringify(next).replace(/</g, '\\u003c');
    return '<!doctype html>\n' + shell.outerHTML;
  },
}) });
