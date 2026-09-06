import { sha256HexBytes } from '../../canonical-json/src/index.js'
import { assertVideoAsset } from '../../schema/src/video.js'
import type { Asset, PpteDocument } from '../../schema/src/index.js'

interface Player {
  node: HTMLVideoElement
  key: string
  asset: Asset
  urls: string[]
  cleanup: (()=>void)[]
  status: HTMLElement
  timer?: ReturnType<typeof setTimeout>
}
/** Ephemeral playback state. No document writes, network sources or document-provided code. */
export class MediaController {
  private players = new Map<HTMLVideoElement, Player>()
  private positions = new Map<string, number>()
  private slideId = ''
  private disposed = false
  private released = 0
  get diagnostics() { return {players:this.players.size, urls:[...this.players.values()].reduce((n,p)=>n+p.urls.length,0), released:this.released} }

  /** Keep the browser-owned media subtree across unrelated semantic/ mode renders. */
  protect(node:HTMLElement,document:PpteDocument):boolean {
    if(!node.hasAttribute('data-ppte-media-container'))return false
    const video=node.querySelector<HTMLVideoElement>('video'),player=video?this.players.get(video):undefined
    const slideId=node.closest<HTMLElement>('[data-ppte-slide-id]')?.dataset.ppteSlideId
    const id=node.closest<HTMLElement>('[data-ppte-element-id]')?.dataset.ppteElementId
    const element=slideId&&id?document.slides[slideId]?.elements[id]:undefined
    return !!(player&&element?.type==='component'&&element.componentType==='core/video'&&element.componentVersion==='2.0.0'&&element.props.assetId===player.asset.id&&document.assets[player.asset.id]?.hash===player.asset.hash&&(element.props.posterAssetId??document.assets[player.asset.id]?.posterAssetId)===(video!.dataset.pptePosterAssetId??player.asset.posterAssetId)&&video!.hasAttribute('muted')===(element.props.muted===true)&&video!.controls===(element.props.controls!==false))
  }
  sync(root: HTMLElement, document: PpteDocument, bytes: Record<string, Uint8Array>): void {
    if (this.disposed) return
    for (const [node, player] of this.players) if (!root.contains(node) || document.assets[node.dataset.ppteVideoAssetId!]?.hash !== player.asset.hash || (player.urls.length>0 && node.getAttribute('src')!==player.urls[0])) {
      this.release(player); this.players.delete(node)
    }
    for (const node of Array.from(root.querySelectorAll<HTMLVideoElement>('video[data-ppte-video-asset-id]'))) {
      if (this.players.has(node)) continue
      const status = node.parentElement!.querySelector<HTMLElement>('[data-ppte-media-status]')!
      const asset = document.assets[node.dataset.ppteVideoAssetId!]
      try {
        assertVideoAsset(asset)
        const key=`${node.closest<HTMLElement>('[data-ppte-element-id]')!.dataset.ppteElementId}:${asset.hash}`
        const player:Player={node,key,asset,urls:[],cleanup:[],status}
        this.players.set(node,player)
        const listen=(type:string,handler:()=>void)=>{node.addEventListener(type,handler);player.cleanup.push(()=>node.removeEventListener(type,handler))}
        const bind=()=>{
          if (player.urls.length) return
          try {
            node.src=this.url(asset,bytes,player)
            const posterId=node.dataset.pptePosterAssetId ?? asset.posterAssetId
            if (posterId) {
              const poster=document.assets[posterId]
              if (!poster?.mimeType.startsWith('image/')) throw Error('VIDEO_POSTER_MISSING')
              node.poster=this.url(poster,bytes,player)
            }
            node.muted=node.hasAttribute('muted')
            status.textContent='正在加载视频…';node.dataset.ppteMediaState='loading'
            player.timer=setTimeout(()=>{if(node.readyState<1&&player.urls.length){status.textContent='VIDEO_LOAD_TIMEOUT';node.dataset.ppteMediaState='error';this.clearSources(player)}},10000)
          } catch(cause) { this.clearSources(player); status.textContent=String(cause); node.dataset.ppteMediaState='error' }
        }
        listen('loadedmetadata',()=>{
          clearTimeout(player.timer)
          if (node.videoWidth!==asset.width || node.videoHeight!==asset.height || !Number.isFinite(node.duration) || Math.abs(node.duration*1000-asset.durationMs!)>250) {
            node.pause(); status.textContent='VIDEO_METADATA_MISMATCH';node.dataset.ppteMediaState='error';this.clearSources(player);return
          }
          node.dataset.ppteMediaState='ready';status.textContent='可播放'
          const time=this.positions.get(key)??0
          if (time>0 && time<node.duration) node.currentTime=time
        })
        listen('play',()=>{
          if (node.closest<HTMLElement>('[data-ppte-slide-id]')?.dataset.ppteSlideId !== this.slideId) {node.pause();return}
          node.dataset.ppteMediaState='playing';status.textContent='播放中'
        })
        listen('pause',()=>{this.positions.set(key,node.currentTime);if(node.dataset.ppteMediaState!=='error'){node.dataset.ppteMediaState='paused';status.textContent='已暂停'}})
        listen('ended',()=>{this.positions.delete(key);this.clearSources(player);node.dataset.ppteMediaState='ended';status.textContent='播放结束；点击播放可重播'})
        listen('error',()=>{node.dataset.ppteMediaState='error';status.textContent=`VIDEO_DECODE_FAILED (${node.error?.code??'unknown'})`;this.clearSources(player)})
        const button=node.parentElement!.querySelector<HTMLButtonElement>('[data-ppte-media-play]')!
        const play=async()=>{
          if(!node.paused){node.pause();return}
          bind()
          if(!node.getAttribute('src'))return
          try {await node.play()} catch(cause) {status.textContent=`VIDEO_PLAY_REJECTED: ${String(cause)}`;node.dataset.ppteMediaState='error'}
        }
        button.addEventListener('click',play);player.cleanup.push(()=>button.removeEventListener('click',play))
        bind()
      } catch(cause) {status.textContent=String(cause);node.dataset.ppteMediaState='error'}
    }
    this.setSlide(this.slideId)
  }
  setSlide(id:string):void {
    this.slideId=id
    for(const p of this.players.values()) if(p.node.closest<HTMLElement>('[data-ppte-slide-id]')?.dataset.ppteSlideId!==id)p.node.pause()
  }
  pauseAll():void {for(const p of this.players.values())p.node.pause()}
  dispose():void {
    if(this.disposed)return
    this.disposed=true
    for(const p of this.players.values())this.release(p)
    this.players.clear();this.positions.clear()
  }
  private url(asset:Asset,bytes:Record<string,Uint8Array>,player:Player):string {
    const data=bytes[asset.hash]??bytes[asset.id]
    if(!data || data.length!==asset.byteLength || `sha256-${sha256HexBytes(data)}`!==asset.hash)throw Error('VIDEO_CAS_HASH_MISMATCH')
    const url=URL.createObjectURL(new Blob([new Uint8Array(data).buffer],{type:asset.mimeType}));player.urls.push(url);return url
  }
  private clearSources(p:Player):void {
    clearTimeout(p.timer)
    p.node.removeAttribute('src');p.node.removeAttribute('poster');p.node.load()
    for(const url of p.urls){URL.revokeObjectURL(url);this.released++}p.urls=[]
  }
  private release(p:Player):void {
    this.positions.set(p.key,p.node.currentTime);p.node.pause()
    for(const cleanup of p.cleanup)cleanup()
    this.clearSources(p)
  }
}
