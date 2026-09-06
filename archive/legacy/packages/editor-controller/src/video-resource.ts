import { sha256HexBytes } from '../../canonical-json/src/index.js'
import { assertVideoAsset, VIDEO_MIME_TYPES } from '../../schema/src/video.js'
import type { Asset, ComponentElement, Operation, PpteDocument, Transaction } from '../../schema/src/index.js'

export const VIDEO_IMPORT_MAX_BYTES = 128 * 1024 * 1024
export interface PreparedVideo { asset:Asset; bytes:Uint8Array }
export type VideoDecoder = (bytes:Uint8Array,mime:string)=>Promise<{width:number;height:number;durationMs:number;codec?:string}>
export async function prepareVideo(data:Uint8Array, options:{mimeType:string;decode:VideoDecoder;posterAssetId?:string;signal?:AbortSignal}):Promise<PreparedVideo> {
  const check=()=>{if(options.signal?.aborted)throw Error('VIDEO_CANCELLED')};check()
  if(!VIDEO_MIME_TYPES.includes(options.mimeType as typeof VIDEO_MIME_TYPES[number]))throw Error('VIDEO_MIME_REJECTED')
  const bytes=new Uint8Array(data)
  if(!bytes.length||bytes.length>VIDEO_IMPORT_MAX_BYTES)throw Error('VIDEO_BYTE_LIMIT: Compress or split the video; the import limit is 128 MiB and standard HTML target remains 20 MiB.')
  const valid=options.mimeType==='video/mp4'?String.fromCharCode(...bytes.slice(4,8))==='ftyp':bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3
  if(!valid)throw Error('VIDEO_SIGNATURE_MISMATCH')
  const metadata=await options.decode(new Uint8Array(bytes),options.mimeType);check()
  const hash=`sha256-${sha256HexBytes(bytes)}`,id=`video_${hash.slice(7)}`
  const asset:Asset={id,hash,mimeType:options.mimeType,byteLength:bytes.length,path:`assets/cas/${hash}`,...metadata,...(options.posterAssetId?{posterAssetId:options.posterAssetId}:{})}
  assertVideoAsset(asset)
  return {asset,bytes}
}
export const decodeBrowserVideo:VideoDecoder=async(bytes,mime)=>{
  const video=document.createElement('video'),url=URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer],{type:mime}))
  try {
    return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('VIDEO_DECODE_TIMEOUT')),10000)
      video.onloadedmetadata=()=>{clearTimeout(timer);resolve({width:video.videoWidth,height:video.videoHeight,durationMs:Math.round(video.duration*1000)})}
      video.onerror=()=>{clearTimeout(timer);reject(Error('VIDEO_DECODE_FAILED'))}
      video.preload='metadata';video.src=url
    })
  }finally{video.onloadedmetadata=null;video.onerror=null;video.removeAttribute('src');video.load();URL.revokeObjectURL(url)}
}
/** Caller stores prepared bytes first, then commits this one reversible Engine transaction. */
export function planVideo(document:PpteDocument,input:{revision:string;slideId:string;elementId:string;prepared:PreparedVideo;transactionId:string;migrateSource?:string}):Transaction {
  const {asset,bytes}=input.prepared,slide=document.slides[input.slideId]
  assertVideoAsset(asset)
  if(asset.hash!==`sha256-${sha256HexBytes(bytes)}`||asset.byteLength!==bytes.length)throw Error('VIDEO_CAS_HASH_MISMATCH')
  if(!slide)throw Error('SLIDE_MISSING')
  const old=slide.elements[input.elementId],ops:Operation[]=[]
  if(old && !(old.type==='component'&&old.componentType==='core/video'&&old.componentVersion==='1.0.0'&&typeof input.migrateSource==='string'&&old.props.source===input.migrateSource))throw Error('VIDEO_MIGRATION_SOURCE_REQUIRED')
  if(old && Object.values(slide.groups??{}).some(g=>g.memberIds.includes(old.id)))throw Error('VIDEO_MIGRATION_GROUPED: Ungroup explicitly before migration.')
  if(document.assets[asset.id]&&document.assets[asset.id].hash!==asset.hash)throw Error('VIDEO_CAS_HASH_MISMATCH')
  if(!document.assets[asset.id])ops.push({opId:'video:asset',kind:'asset.upsert',asset})
  const element:ComponentElement={...(old??{}),id:input.elementId,type:'component',frame:old?.frame??{x:40,y:40,width:480,height:270},componentType:'core/video',componentVersion:'2.0.0',props:{assetId:asset.id,controls:true,...(asset.posterAssetId?{posterAssetId:asset.posterAssetId}:{})},fallback:asset.posterAssetId?{kind:'asset',assetId:asset.posterAssetId,label:'Video poster'}:{kind:'placeholder',label:'Video — poster unavailable'}}
  if(old)ops.push({opId:'video:remove-v1',kind:'element.delete',slideId:input.slideId,elementId:old.id})
  ops.push({opId:'video:insert',kind:'element.insert',slideId:input.slideId,element,index:old?slide.rootOrder.indexOf(old.id):slide.rootOrder.length,...(slide.readingOrder?{readingOrderIndex:old?slide.readingOrder.indexOf(old.id):slide.readingOrder.length}:{})})
  return {transactionId:input.transactionId,baseRevision:input.revision,actor:{type:'human',id:'video-import'},createdAt:'1970-01-01T00:00:00.000Z',scope:{kind:'slide',slideIds:[input.slideId],permissions:['assets','structure'],allowInsert:true,allowDelete:!!old},changeContract:{allowedOperationKinds:[...new Set(ops.map(o=>o.kind))],maxChangedSlides:1,maxChangedElements:1,maxInsertedElements:1,maxDeletedElements:old?1:0,maxReplacedAssets:1,requireConfirmation:false},operations:ops}
}
