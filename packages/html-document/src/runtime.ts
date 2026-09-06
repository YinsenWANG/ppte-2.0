import { cleanContent, frameContent } from './content.js';
import { installEditor } from '../../html-editor/src/index.js';

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
function content() {
  if (!frame.contentDocument?.documentElement || frame.contentDocument.URL === 'about:blank') throw Error('CONTENT_NOT_READY');
  const clone = frame.contentDocument.documentElement.cloneNode(true) as HTMLElement;
  clone.querySelector('meta[http-equiv="Content-Security-Policy"]')?.remove();
  const result = cleanContent('<!doctype html>' + clone.outerHTML);
  if(result.issues.length) throw Error('UNSAFE_CONTENT: '+JSON.stringify(result.issues));
  return result.html;
}
function encode(value: string, revision: number, documentId = metadata.documentId) {
  const cleaned = cleanContent(value);
  if (cleaned.issues.length) throw Error('UNSAFE_CONTENT');
  value = cleaned.html;
  const shell = document.documentElement.cloneNode(true) as HTMLElement;
  shell.querySelectorAll('[data-ppte-transient]').forEach(e=>e.remove());
  shell.querySelector<HTMLTemplateElement>('#ppte-content')!.content.replaceChildren(document.createTextNode(value));
  const iframe=shell.querySelector('#ppte-frame')!;iframe.removeAttribute('srcdoc');iframe.removeAttribute('src');iframe.removeAttribute('style');
  shell.querySelector('#ppte-metadata')!.textContent=JSON.stringify({...metadata,documentId,saveRevision:revision}).replace(/</g,'\\u003c');
  return '<!doctype html>\n'+shell.outerHTML;
}
const api = {
  get contentDocument() { return frame.contentDocument; },
  get metadata() { return structuredClone(metadata); },
  content, encode,
  normalize(value: string) { const result=cleanContent('<!doctype html>'+value.replace(/^<!doctype[^>]*>/i,''));if(result.issues.length)throw Error('UNSAFE_CONTENT');return result.html; },
  mount(value: string) { const cleaned=cleanContent(value);if(cleaned.issues.length)throw Error('UNSAFE_CONTENT');return new Promise<void>(done=>{frame.addEventListener('load',()=>done(),{once:true});frame.srcdoc=frameContent(cleaned.html);}); },
  serialize() { return encode(content(),metadata.saveRevision+1); }
};
frame.addEventListener('load',()=>installEditor(api),{once:true});
// Serialization alone makes no persistence claim.

Object.defineProperty(window, 'PPTeHTML', { value: Object.freeze(api) });
