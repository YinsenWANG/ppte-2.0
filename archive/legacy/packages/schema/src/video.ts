import type { Asset, ComponentElement, PpteDocument } from './document.js'

export const VIDEO_MIME_TYPES = ['video/mp4', 'video/webm'] as const
export function assertVideoProps(props: Record<string, unknown>): void {
  if (!props || typeof props.assetId !== 'string' || !props.assetId) throw Error('VIDEO_ASSET_REQUIRED')
  if (Object.keys(props).some(key => !['assetId','posterAssetId','controls','muted'].includes(key))) throw Error('VIDEO_PROP_UNSUPPORTED')
  for (const key of ['controls','muted']) if (props[key] !== undefined && typeof props[key] !== 'boolean') throw Error('VIDEO_PROP_INVALID')
  if (props.posterAssetId !== undefined && (typeof props.posterAssetId !== 'string' || !props.posterAssetId)) throw Error('VIDEO_POSTER_INVALID')
}
export function assertVideoAsset(asset: Asset | undefined): asserts asset is Asset {
  if (!asset || !VIDEO_MIME_TYPES.includes(asset.mimeType as typeof VIDEO_MIME_TYPES[number])) throw Error('VIDEO_MIME_REJECTED')
  if (![asset.width,asset.height,asset.durationMs].every(n=>Number.isInteger(n) && Number(n)>0)) throw Error('VIDEO_METADATA_INVALID')
}
export function assertVideoReferences(element: ComponentElement, document: PpteDocument): void {
  if (element.componentType !== 'core/video' || element.componentVersion !== '2.0.0') return
  assertVideoProps(element.props)
  const asset = document.assets?.[String(element.props.assetId)]
  assertVideoAsset(asset)
  const poster = element.props.posterAssetId ?? asset.posterAssetId
  if (poster !== undefined && (!document.assets?.[String(poster)]?.mimeType.startsWith('image/'))) throw Error('VIDEO_POSTER_MISSING')
}
export function videoPosterId(element: ComponentElement, document: PpteDocument): string | undefined {
  const id=element.props.posterAssetId ?? document.assets[String(element.props.assetId)]?.posterAssetId
  return typeof id==='string'?id:element.fallback.assetId
}
