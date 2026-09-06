import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { sha256HexBytes } from '../../canonical-json/src/index.js'
import { auditPortableBundle, buildPortable, decodePortable, type PortableBuildOptions } from '../../portable-runtime/src/index.js'
import type { PpteDocument } from '../../schema/src/index.js'

/** Directory entry is loopback HTTP only. Every fetched byte is verified before execution.
 * Hashes prove integrity against the entry, not publisher authenticity. */
export function buildMediaDirectory(document:PpteDocument, options:PortableBuildOptions) {
  const built=buildPortable(document,options)
  if(!built.ok || !auditPortableBundle(built.html).ok)throw Error('MEDIA_DIRECTORY_BUILD_FAILED: '+JSON.stringify(built.issues))
  let template=built.html
  const entries:Record<string,Uint8Array>={},payload=decodePortable(built.html),resources:{path:string;sha256:string;byteLength:number;marker:string}[]=[]
  for(const value of new Set(Object.values(payload.assets))) {
    const bytes=new Uint8Array(Buffer.from(value,'base64')),hash=sha256HexBytes(bytes),path=`media/${hash}.bin`,marker=`@ppte-media:${hash}`
    entries[path]=bytes;resources.push({path,sha256:hash,byteLength:bytes.length,marker})
    template=template.replaceAll(JSON.stringify(value),JSON.stringify(marker))
  }
  entries['template.html']=new TextEncoder().encode(template)
  const manifest={version:1,entry:'index.html',openProtocol:'http-loopback',fileProtocol:'unsupported',packingVerification:'all CAS bytes and complete Portable audit',openingVerification:'manifest pinned by index; template and every media file SHA-256/length; reconstructed HTML SHA-256 before executing',publisherAuthentication:false,htmlSha256:sha256HexBytes(new TextEncoder().encode(built.html)),template:{path:'template.html',sha256:sha256HexBytes(entries['template.html']),byteLength:entries['template.html'].length},resources}
  const manifestBytes=new TextEncoder().encode(JSON.stringify(manifest,null,2)+'\n')
  entries['manifest.json']=manifestBytes
  const pinned=sha256HexBytes(manifestBytes)
  entries['index.html']=new TextEncoder().encode(`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'self'; frame-src blob:; media-src blob:; img-src data: blob:; font-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>PPTe offline media</title><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}#status{padding:20px}</style></head><body><p id="status" role="status">正在校验离线包…</p><script>
(async()=>{
const status=document.getElementById('status');let url;
try {
 if(location.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(location.hostname))throw Error('DIRECTORY_FILE_PROTOCOL_UNSUPPORTED: 请通过本机 HTTP 服务打开此目录，或使用自包含单 HTML。');
 const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 const fetchBytes=async path=>{const r=await fetch(path,{cache:'no-store',credentials:'omit',redirect:'error'});if(!r.ok)throw Error('MEDIA_FILE_MISSING: '+path);return r.arrayBuffer()};
 const raw=await fetchBytes('manifest.json');if(await hash(raw)!=='${pinned}')throw Error('MEDIA_MANIFEST_HASH_MISMATCH');
 const manifest=JSON.parse(new TextDecoder().decode(raw));
 const verified=async item=>{const b=await fetchBytes(item.path);if(b.byteLength!==item.byteLength||await hash(b)!==item.sha256)throw Error('MEDIA_FILE_HASH_MISMATCH: '+item.path);return b};
 let html=new TextDecoder().decode(await verified(manifest.template));
 for(const item of manifest.resources){const bytes=new Uint8Array(await verified(item));let value='';for(let i=0;i<bytes.length;i+=16384)value+=String.fromCharCode(...bytes.subarray(i,i+16384));html=html.split(JSON.stringify(item.marker)).join(JSON.stringify(btoa(value)))}
 if(await hash(new TextEncoder().encode(html))!==manifest.htmlSha256)throw Error('MEDIA_HTML_HASH_MISMATCH');
 url=URL.createObjectURL(new Blob([html],{type:'text/html'}));const frame=document.createElement('iframe');frame.title='PPTe presentation';frame.allow='fullscreen';frame.src=url;status.remove();document.body.append(frame);
 window.addEventListener('pagehide',()=>URL.revokeObjectURL(url),{once:true});
}catch(cause){status.textContent=String(cause);status.dataset.ppteDirectoryError='true';if(url)URL.revokeObjectURL(url)}
})();</script></body></html>`)
  return {entries,manifest,metrics:{htmlBytes:Buffer.byteLength(built.html),directoryBytes:Object.values(entries).reduce((n,b)=>n+b.length,0)}}
}
/** Exclusive target creation never overwrites another directory. A failed write removes only this call's new directory. */
export function deliverMediaDirectory(target:string,document:PpteDocument,options:PortableBuildOptions) {
  const result=buildMediaDirectory(document,options)
  mkdirSync(target)
  try {
    mkdirSync(join(target,'media'))
    for(const [path,bytes]of Object.entries(result.entries))writeFileSync(join(target,path),bytes,{flag:'wx'})
    for(const [path,bytes]of Object.entries(result.entries))if(!Buffer.from(readFileSync(join(target,path))).equals(Buffer.from(bytes)))throw Error('MEDIA_DIRECTORY_WRITE_VERIFICATION_FAILED')
    return {path:join(target,'index.html'),...result.manifest,metrics:result.metrics}
  }catch(cause){rmSync(target,{recursive:true,force:true});throw cause}
}
