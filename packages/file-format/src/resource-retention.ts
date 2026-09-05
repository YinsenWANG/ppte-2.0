import { sha256HexBytes } from '../../canonical-json/src/index.js'
import type { Asset } from '../../schema/src/index.js'
export type ResourcePool = Record<string,Uint8Array>
export function hashPool(input:ResourcePool):ResourcePool {
  const pool={...input}
  for(const bytes of Object.values(input))pool[`sha256-${sha256HexBytes(bytes)}`]=bytes
  return pool
}
export function referencedAssets(...roots:unknown[]):Asset[] {
  const assets=new Map<string,Asset>()
  const visit=(value:unknown):void=>{
    if(!value||typeof value!=='object')return
    const v=value as Asset
    if(typeof v.id==='string'&&typeof v.hash==='string'&&typeof v.mimeType==='string'&&typeof v.byteLength==='number'&&typeof v.path==='string')assets.set(v.hash,v)
    for(const child of Object.values(value))visit(child)
  }
  roots.forEach(visit);return [...assets.values()]
}
export function requireAssetBytes(pool:ResourcePool, asset:Asset):Uint8Array {
  const bytes=pool[asset.hash]??pool[asset.id]
  if(!bytes)throw Error(`ASSET_MISSING: ${asset.id}`)
  if(bytes.length!==asset.byteLength||`sha256-${sha256HexBytes(bytes)}`!==asset.hash)throw Error(`ASSET_HASH_MISMATCH: ${asset.id}`)
  return bytes
}
/** Only history-reachable blobs are serialized; draft/job/journal roots remain pinned in their owning pool. */
export function historyResourceEntries(pool:ResourcePool, ...history:unknown[]):Array<{name:string;data:Uint8Array}> {
  const indexed=hashPool(pool)
  return referencedAssets(...history).map(asset=>({name:`assets/cas/${asset.hash}`,data:requireAssetBytes(indexed,asset)}))
}
export function readHistoryResourcePool(archive:Map<string,Uint8Array>):ResourcePool {
  const pool:ResourcePool={}
  for(const [path,bytes] of archive)if(path.startsWith('assets/cas/')){
    const hash=path.slice('assets/cas/'.length)
    if(hash!==`sha256-${sha256HexBytes(bytes)}`)throw Error('CAS_HASH_MISMATCH')
    pool[hash]=bytes
  }
  return pool
}
