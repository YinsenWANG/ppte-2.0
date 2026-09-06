import type { PpteDocument } from '../../schema/src/index.js'
import {sha256HexBytes} from '../../canonical-json/src/index.js'
export type ResourceBytes=Record<string,Uint8Array>
/** Keep bytes for past revisions when a resource ID is replaced, so undo and
 * crash replay resolve the exact hash rather than the newest bytes for an ID. */
export function poolBytes(bytes:ResourceBytes):ResourceBytes {
  const result={...bytes}
  for(const b of Object.values(bytes))result[`sha256-${sha256HexBytes(b)}`]=b
  return result
}
export function resolveBytes(pool:ResourceBytes,metadata:Record<string,{hash?:string}>):ResourceBytes {
  return Object.fromEntries(Object.entries(metadata).flatMap(([id,m])=>{const b=(m.hash?pool[m.hash]:undefined)??pool[id];return b?[[id,b]]:[]}))
}

/** Call only with the complete owner roots; missing owners are not interpreted as empty. */
export function collectResourcePool(pool:ResourceBytes, roots:Record<'document'|'undo'|'redo'|'journal'|'draft'|'jobs',unknown>):ResourceBytes {
  for(const owner of ['document','undo','redo','journal','draft','jobs'])if(!Object.hasOwn(roots,owner))throw Error(`RESOURCE_ROOT_MISSING: ${owner}`)
  const keep=retainedResourceHashes(roots)
  return Object.fromEntries(Object.entries(poolBytes(pool)).filter(([,bytes])=>keep.has(`sha256-${sha256HexBytes(bytes)}`)))
}
import { retainedResourceHashes } from '../../editor-controller/src/resource-port.js'

/** One owner per mounted editor. Digest aliases share URLs; failed fonts are
 * evicted so the next sync retries, and late completions cannot reattach them. */
export class BrowserResourceCache {
  private urls=new Map<string,string>()
  private faces=new Map<string,FontFace>()
  syncDocument(document:PpteDocument,assets:ResourceBytes,fonts:ResourceBytes={}):Record<string,string> {
    const referenced=new Set<string>()
    const visit=(value:unknown):void=>{if(value&&typeof value==='object')for(const [key,child]of Object.entries(value)){if((key==='assetId'||key==='posterAssetId')&&typeof child==='string')referenced.add(child);else visit(child)}}
    visit(document.slides);visit(document.theme)
    // A video's poster may be declared on its asset metadata rather than props.
    for(const id of referenced){const poster=document.assets[id]?.posterAssetId;if(poster)referenced.add(poster)}
    return this.sync(assets,Object.fromEntries(Object.entries(document.assets).filter(([id])=>referenced.has(id))),fonts,document.fonts)
  }
  sync(assets:ResourceBytes, metadata:Record<string,{mimeType:string}>, fonts:ResourceBytes={}, specs:Record<string,{family:string;weight?:number;style?:string}>={}):Record<string,string> {
    const used=new Set<string>(),wantedFaces=new Set<string>()
    const url=(bytes:Uint8Array,mime:string)=>{
      const key=`${sha256HexBytes(bytes)}:${mime}`;used.add(key)
      let source=this.urls.get(key)
      if(!source){source=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:mime}));this.urls.set(key,source)}
      return source
    }
    const sources:Record<string,string>={}
    for(const [id,bytes]of Object.entries(assets)){const spec=metadata[id];if(spec&&!spec.mimeType.startsWith('video/'))sources[id]=url(bytes,spec.mimeType)}
    for(const [id,bytes]of Object.entries(fonts)){
      const spec=specs[id];if(!spec)continue
      const source=url(bytes,'font/woff2'),key=JSON.stringify([sha256HexBytes(bytes),spec.family,spec.weight??400,spec.style??'normal']);wantedFaces.add(key)
      if(!this.faces.has(key)){
        const face=new FontFace(spec.family,`url(${source})`,{weight:String(spec.weight??400),style:spec.style??'normal'});this.faces.set(key,face)
        ;(document.fonts as FontFaceSet & {add(f:FontFace):void}).add(face)
        void face.load().catch(()=>{if(this.faces.get(key)===face){(document.fonts as FontFaceSet & {delete(f:FontFace):void}).delete(face);this.faces.delete(key)}})
      }
    }
    for(const [key,face]of this.faces)if(!wantedFaces.has(key)){(document.fonts as FontFaceSet & {delete(f:FontFace):void}).delete(face);this.faces.delete(key)}
    for(const [key,source]of this.urls)if(!used.has(key)){URL.revokeObjectURL(source);this.urls.delete(key)}
    return sources
  }
  dispose():void {
    for(const face of this.faces.values())(document.fonts as FontFaceSet & {delete(f:FontFace):void}).delete(face)
    for(const url of this.urls.values())URL.revokeObjectURL(url)
    this.faces.clear();this.urls.clear()
  }
}
