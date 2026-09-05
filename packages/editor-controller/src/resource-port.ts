import { sha256HexBytes } from '../../canonical-json/src/index.js'
import type { Asset, ImageElement, Operation, PpteDocument, Transaction } from '../../schema/src/index.js'

export interface PreparedImage { asset: Asset; bytes: Uint8Array }
export interface ImageDecoder { (bytes: Uint8Array, mime: string): Promise<{width:number; height:number}> }
const extensions: Record<string,string> = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'}
/** Preparation owns no document state. All entry points await decoding and storage before committing. */
export async function prepareImage(data: Uint8Array, options: {mimeType:string; name?:string; decode:ImageDecoder; signal?:AbortSignal; maxBytes?:number; maxPixels?:number; expectedHash?:string}): Promise<PreparedImage> {
  const check = () => { if (options.signal?.aborted) throw new Error('IMAGE_CANCELLED') }
  check()
  const bytes = new Uint8Array(data), mime = options.mimeType
  if (!extensions[mime]) throw new Error('IMAGE_MIME_REJECTED: Choose a PNG, JPEG, WebP or GIF image.')
  if (!bytes.length || bytes.length > (options.maxBytes ?? 32*1024*1024)) throw new Error(`IMAGE_BYTE_LIMIT: Use a nonempty image smaller than ${options.maxBytes ?? 32*1024*1024} bytes; resize or compress the source image.`)
  const signature = mime === 'image/png' ? bytes[0]===137 && bytes[1]===80 && bytes[2]===78 && bytes[3]===71 : mime === 'image/jpeg' ? bytes[0]===255 && bytes[1]===216 : mime === 'image/gif' ? String.fromCharCode(...bytes.slice(0,6)).match(/^GIF8[79]a$/) : String.fromCharCode(...bytes.slice(0,4))==='RIFF' && String.fromCharCode(...bytes.slice(8,12))==='WEBP'
  if (!signature) throw new Error('IMAGE_SIGNATURE_MISMATCH')
  const hash = `sha256-${sha256HexBytes(bytes)}`
  if (options.expectedHash && options.expectedHash !== hash) throw new Error('CAS_HASH_MISMATCH')
  const {width,height} = await options.decode(new Uint8Array(bytes),mime)
  check()
  if (![width,height].every(n=>Number.isInteger(n)&&n>0) || width*height > (options.maxPixels ?? 40_000_000)) throw new Error(`IMAGE_DIMENSION_LIMIT: Resize the source image to at most ${options.maxPixels ?? 40_000_000} pixels.`)
  const id = `image_${hash.slice(7)}`
  return {bytes,asset:{id,hash,mimeType:mime,byteLength:bytes.length,width,height,path:`assets/${id}.${extensions[mime]}`,altText:options.name ?? 'Image'}}
}
export const decodeBrowserImage: ImageDecoder = async (bytes,mime) => {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes).buffer],{type:mime}))
  try { return {width:bitmap.width,height:bitmap.height} } finally { bitmap.close() }
}

export function planImage(document:PpteDocument, input:{revision:string; slideId:string; elementId:string; prepared:PreparedImage; replace?:boolean; transactionId:string}):Transaction {
  const slide=document.slides[input.slideId]
  if(!slide)throw Error('SLIDE_MISSING')
  const {asset,bytes}=input.prepared
  if(asset.hash!==`sha256-${sha256HexBytes(bytes)}`||asset.byteLength!==bytes.length)throw Error('CAS_HASH_MISMATCH')
  const operations:Operation[]=[]
  if(!document.assets[asset.id])operations.push({opId:`${input.transactionId}:asset`,kind:'asset.upsert',asset})
  else if(document.assets[asset.id].hash!==asset.hash)throw Error('CAS_HASH_MISMATCH')
  if(input.replace){
    if(slide.elements[input.elementId]?.type!=='image')throw Error('IMAGE_TARGET_MISSING')
    operations.push({opId:`${input.transactionId}:replace`,kind:'image.replaceAsset',slideId:input.slideId,elementId:input.elementId,assetId:asset.id,preserveCrop:true})
  }else{
    const width=Math.min(600,document.canvas.width/2),height=width*asset.height!/asset.width!
    const element:ImageElement={id:input.elementId,type:'image',semanticKey:`image.${input.elementId}`,frame:{x:40,y:40,width,height},assetId:asset.id,fit:'contain',altText:asset.altText,style:{styleRef:Object.keys(document.theme.presets.image)[0]}}
    operations.push({opId:`${input.transactionId}:insert`,kind:'element.insert',slideId:input.slideId,element,index:slide.rootOrder.length,...(slide.readingOrder?{readingOrderIndex:slide.readingOrder.length}:{})})
  }
  return {transactionId:input.transactionId,baseRevision:input.revision,actor:{type:'human',id:'image-editor'},createdAt:'1970-01-01T00:00:00.000Z',scope:{kind:'slide',slideIds:[input.slideId],permissions:['assets','structure'],allowInsert:!input.replace,allowDelete:false},changeContract:{allowedOperationKinds:[...new Set(operations.map(o=>o.kind))],maxChangedSlides:1,maxChangedElements:1,maxInsertedElements:input.replace?0:1,maxDeletedElements:0,maxReplacedAssets:1,requireConfirmation:false},operations}
}

/** Conservative retention includes every hash reachable from all persistent and transient roots. */
export function retainedResourceHashes(roots:{document:unknown; undo?:unknown; redo?:unknown; journal?:unknown; draft?:unknown; jobs?:unknown}):Set<string> {
  const hashes=new Set<string>()
  const visit=(value:unknown):void=>{if(typeof value==='string'&&/^sha256-[a-f0-9]{64}$/.test(value))hashes.add(value);else if(value&&typeof value==='object')for(const child of Object.values(value))visit(child)}
  visit(roots);return hashes
}

export type ImageCrop = NonNullable<ImageElement['crop']>
/** One source-space crop gesture. Pointer movement never changes the document. */
export class CropGesture {
  readonly initial:ImageCrop
  private value:ImageCrop
  private cancelled=false
  constructor(readonly image:ImageElement, readonly corner:'nw'|'ne'|'sw'|'se') {
    this.initial={...(image.crop??{x:0,y:0,width:1,height:1})};this.value={...this.initial}
  }
  update(dx:number,dy:number):ImageCrop {
    if(this.cancelled)throw Error('CROP_CANCELLED')
    if(!Number.isFinite(dx)||!Number.isFinite(dy))throw Error('CROP_INVALID')
    const angle=-(this.image.rotationDeg??0)*Math.PI/180
    const x=(dx*Math.cos(angle)-dy*Math.sin(angle))/this.image.frame.width*this.initial.width
    const y=(dx*Math.sin(angle)+dy*Math.cos(angle))/this.image.frame.height*this.initial.height
    const c=this.initial,clamp=(v:number,low:number,high:number)=>Math.min(high,Math.max(low,v))
    const left=this.corner.includes('w')?clamp(c.x+x,0,c.x+c.width-.01):c.x
    const top=this.corner.includes('n')?clamp(c.y+y,0,c.y+c.height-.01):c.y
    const right=this.corner.includes('e')?clamp(c.x+c.width+x,left+.01,1):c.x+c.width
    const bottom=this.corner.includes('s')?clamp(c.y+c.height+y,top+.01,1):c.y+c.height
    this.value={x:left,y:top,width:right-left,height:bottom-top};return {...this.value}
  }
  cancel():void {this.cancelled=true}
  end():ImageCrop|undefined {return this.cancelled||JSON.stringify(this.value)===JSON.stringify(this.initial)?undefined:{...this.value}}
}
