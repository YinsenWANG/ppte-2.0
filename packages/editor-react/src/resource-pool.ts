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
