import { Versions, type HistoryWire } from '../../html-editor/src/versions.js';
import { cleanContent, frameContent } from './content.js';
import { packMedia, unpackMedia } from './media-table.js';
import { installEditor } from '../../html-editor/src/index.js';

// Only build-owned code executes in the parent. Content never receives a script capability.
const template = document.querySelector<HTMLTemplateElement>('#ppte-content')!;
const frame = document.querySelector<HTMLIFrameElement>('#ppte-frame')!;
const metadata = JSON.parse(document.querySelector('#ppte-metadata')!.textContent!);
const mediaElement = document.querySelector('#ppte-media');
let initial;
try { initial = cleanContent(unpackMedia(template.content.textContent ?? '', mediaElement ? JSON.parse(mediaElement.textContent!) : undefined)); }
catch (error) { const status = document.createElement('p'); status.textContent = '媒体资源加载失败：' + String(error); status.setAttribute('role', 'alert'); document.body.prepend(status); throw error; }
const historyElement=document.querySelector('#ppte-history-index');
const readParts=(key:string)=>Object.fromEntries(Array.from(document.querySelectorAll<HTMLTemplateElement>(`template[${key}]`)).map(e=>[e.getAttribute(key)!,e.content.textContent??'']));
const historyWire:HistoryWire|undefined=historyElement?{index:historyElement.textContent??'',blocks:readParts('data-ppte-version-block'),resources:readParts('data-ppte-version-resource')}:undefined;
const originalMedia=mediaElement?JSON.parse(mediaElement.textContent!).resources:{};
const versions=new Versions(metadata.documentId,historyWire,()=>originalMedia);
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
function encode(value: string, revision: number, documentId = metadata.documentId, withoutHistory=false) {
  const cleaned = cleanContent(value);
  if (cleaned.issues.length) throw Error('UNSAFE_CONTENT');
  value = cleaned.html;
  const packed = metadata.mediaTable === 1 || historyWire || versions.wire() ? packMedia(value) : undefined;
  const shell = document.documentElement.cloneNode(true) as HTMLElement;
  shell.querySelectorAll('[data-ppte-transient]').forEach(e=>e.remove());
  shell.querySelector<HTMLTemplateElement>('#ppte-content')!.content.replaceChildren(document.createTextNode(packed?.content ?? value));
  if (packed) {let media=shell.querySelector('#ppte-media');if(!media){media=document.createElement('script');media.id='ppte-media';media.setAttribute('type','application/json');shell.querySelector('body')!.prepend(media);}media.textContent=JSON.stringify(packed.table).replace(/</g,'\\u003c');}
  shell.querySelectorAll('#ppte-history-index,template[data-ppte-version-block],template[data-ppte-version-resource]').forEach(e=>e.remove());
  const wire=withoutHistory?undefined:versions.wire(packed?.table.resources,documentId);
  if(wire){
    const index=document.createElement('script');index.id='ppte-history-index';index.type='application/json';index.textContent=wire.index.replace(/</g,'\\u003c');shell.querySelector('body')!.insertBefore(index,shell.querySelector('#ppte-runtime'));
    for(const [kind,values] of [['data-ppte-version-block',wire.blocks],['data-ppte-version-resource',wire.resources]] as const)for(const [id,value] of Object.entries(values)){const t=document.createElement('template');t.setAttribute(kind,id);t.content.append(document.createTextNode(value));shell.querySelector('body')!.insertBefore(t,shell.querySelector('#ppte-runtime'));}
  }
  const iframe=shell.querySelector('#ppte-frame')!;iframe.removeAttribute('srcdoc');iframe.removeAttribute('src');iframe.removeAttribute('style');
  shell.querySelector('#ppte-metadata')!.textContent=JSON.stringify({...metadata,...(packed?{mediaTable:1}:{}),documentId,saveRevision:revision}).replace(/</g,'\\u003c');
  return '<!doctype html>\n'+shell.outerHTML;
}
const api = {
  get contentDocument() { return frame.contentDocument; },
  get metadata() { return structuredClone(metadata); },
  content, encode, versions,
  normalize(value: string) { const result=cleanContent('<!doctype html>'+value.replace(/^<!doctype[^>]*>/i,''));if(result.issues.length)throw Error('UNSAFE_CONTENT');return result.html; },
  mount(value: string) { const cleaned=cleanContent(value);if(cleaned.issues.length)throw Error('UNSAFE_CONTENT');return new Promise<void>(done=>{frame.addEventListener('load',()=>done(),{once:true});frame.srcdoc=frameContent(cleaned.html);}); },
  serialize() { return encode(content(),metadata.saveRevision+1); }
};
frame.addEventListener('load',()=>installEditor(api),{once:true});
// Serialization alone makes no persistence claim.

Object.defineProperty(window, 'PPTeHTML', { value: Object.freeze(api) });
