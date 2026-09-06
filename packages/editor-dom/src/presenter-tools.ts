import { presenterWindowScript } from "./presenter-window-bundle.js"
import { PresenterChannel, PresenterTools } from '../../editor-controller/src/presenter-channel.js'

export interface PresenterToolsPort {
  state: () => {index: number; count: number; notes: string; nextHtml: string}
  goto: (index: number) => void
  next: () => void
  previous: () => void
  exit: () => void
}
/** Both shells use this transient adapter; the parent remains the audience surface. */
export function mountPresenterTools(root: HTMLElement, surface: HTMLElement, port: PresenterToolsPort): () => void {
  const win = root.ownerDocument.defaultView!
  const doc = root.ownerDocument
  const tools = new PresenterTools(()=>win.performance.now())
  let popup: Window | null = null
  let sender: PresenterChannel | undefined
  let popupStatus: HTMLElement | undefined, popupNotes: HTMLElement | undefined, popupPreview: HTMLElement | undefined
  let feedback = '单屏'
  let lastPreview = ''
  const panel = doc.createElement('nav'); panel.dataset.ppteLiveTools=''; panel.setAttribute('aria-label','现场工具')
  panel.style.cssText='position:fixed;bottom:8px;left:8px;right:8px;z-index:150;display:flex;flex-wrap:wrap;gap:6px;align-items:center;background:#172033e8;color:white;padding:8px;border-radius:8px;font:14px system-ui'
  const curtain=doc.createElement('div');curtain.dataset.ppteBlackout='';curtain.style.cssText='position:fixed;inset:0;background:black;z-index:140;pointer-events:none';curtain.hidden=true
  const dot=doc.createElement('div');dot.dataset.ppteLaser='';dot.style.cssText='position:fixed;width:14px;height:14px;border-radius:50%;background:red;box-shadow:0 0 8px white;z-index:145;pointer-events:none;transform:translate(-50%,-50%)';dot.hidden=true
  const status=doc.createElement('span');status.setAttribute('role','status')
  function button(parent: HTMLElement,label: string, action: ()=>void): HTMLButtonElement {
    const b=parent.ownerDocument.createElement('button');b.style.cssText='min-height:32px;padding:5px 10px;border:1px solid #94a3b8;border-radius:5px;background:#f8fafc;color:#172033;cursor:pointer';b.type='button';b.textContent=label;b.setAttribute('aria-label',label);b.onclick=action;parent.append(b);return b
  }
  function controls(parent: HTMLElement, command: (action: string,index?: number)=>void) {
    button(parent,'上一页',()=>command('previous'))
    const input=parent.ownerDocument.createElement('input');input.type='number';input.min='1';input.max=String(port.state().count);input.value=String(port.state().index+1);input.setAttribute('aria-label','跳转页码');input.style.width='65px'
    input.onchange=()=>command('goto',Number(input.value)-1);parent.append(input)
    button(parent,'下一页',()=>command('next'))
    button(parent,'黑屏',()=>command('blackout'));button(parent,'激光笔',()=>command('laser'))
    button(parent,'计时开始/暂停',()=>command('timer'));button(parent,'计时归零',()=>command('reset'))
    button(parent,'退出放映',()=>command('exit'))
  }
  function apply(value: unknown) {
    if (!value || typeof value!=='object') return
    const {action,index}=value as {action?:string;index?:number}
    if(action==='goto' && Number.isInteger(index) && typeof index==='number' && index >= 0 && index < port.state().count) port.goto(index)
    else if(action==='next')port.next()
    else if(action==='previous')port.previous()
    else if(action==='blackout')tools.blackout=!tools.blackout
    else if(action==='laser'){tools.laser=!tools.laser;if(!tools.laser)dot.hidden=true}
    else if(action==='timer')tools.toggleTimer()
    else if(action==='reset')tools.resetTimer()
    else if(action==='exit')port.exit()
    update()
  }
  controls(panel,(action,index)=>apply({action,index}))
  button(panel,'演讲者窗口 / 重连',openPresenter)
  panel.append(status)
  const previewDetails=doc.createElement('details'),summary=doc.createElement('summary'),preview=doc.createElement('div')
  summary.textContent='下一页预览';preview.style.cssText='width:320px;max-height:200px;overflow:hidden;background:white;color:black';previewDetails.append(summary,preview);panel.append(previewDetails)
  root.append(curtain,dot,panel)
  function clearChannel() {
    sender?.dispose();sender=undefined
    try{popup?.close()}catch{}popup=null
  }
  function openPresenter() {
    clearChannel()
    if(win.location.protocol==='file:' || win.location.origin==='null') {feedback='此入口限制双屏，单屏可用';update();return}
    try {
      popup=win.open('about:blank','_blank','popup,width=900,height=700')
      if(!popup)throw Error('blocked')
      const child=popup, childDoc=child.document
      childDoc.title='PPTe 演讲者'
      childDoc.body.replaceChildren();childDoc.body.style.cssText='font:16px system-ui;padding:20px;background:#172033;color:white'
      const nav=childDoc.createElement('nav');nav.setAttribute('aria-label','演讲者控制');nav.style.cssText='display:flex;flex-wrap:wrap;gap:6px';childDoc.body.append(nav)
      popupStatus=childDoc.createElement('p');popupStatus.setAttribute('role','status')
      popupNotes=childDoc.createElement('pre');popupNotes.dataset.ppteSpeakerNotes='';popupNotes.style.whiteSpace='pre-wrap'
      popupPreview=childDoc.createElement('div');popupPreview.dataset.ppteNextPreview=''
      childDoc.body.append(popupStatus,popupNotes,popupPreview)
      const session=win.crypto.randomUUID(), token=win.crypto.randomUUID(), origin=win.location.origin
      sender=new PresenterChannel({session,token,source:child,origin,now:()=>win.performance.now(),send:m=>child.postMessage(m,origin),receive:apply})
      controls(nav,()=>{})
      const config=childDoc.createElement('script');config.type='application/json';config.id='ppte-presenter-config';config.textContent=JSON.stringify({session,token,origin});childDoc.body.append(config)
      const script=childDoc.createElement('script');script.textContent=presenterWindowScript;childDoc.body.append(script)
      feedback='双屏连接中';update()
    } catch {clearChannel();feedback='弹窗被拒绝或受限，单屏可用';update()}
  }
  function update() {
    const state=port.state(), seconds=Math.floor(tools.elapsedMs/1000)
    curtain.hidden=!tools.blackout
    previewDetails.hidden=tools.blackout
    if(popup?.closed){clearChannel();feedback='演讲者窗口已关闭，单屏可用，可重连'}
    else if(sender)feedback=sender.connected?'双屏已连接':'双屏断连，单屏可用，正在重试'
    const label=`${state.index+1} / ${state.count} · ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} · ${feedback}`
    status.textContent=label
    for(const [label,pressed] of [['黑屏',tools.blackout],['激光笔',tools.laser],['计时开始/暂停',tools.running]] as const)panel.querySelector(`[aria-label="${label}"]`)?.setAttribute('aria-pressed',String(pressed))
    if(doc.activeElement!==panel.querySelector('input'))panel.querySelector('input')!.value=String(state.index+1)
    if(lastPreview!==state.nextHtml){lastPreview=state.nextHtml;const frame=doc.createElement('iframe');frame.title='下一页预览';frame.setAttribute('sandbox','');frame.style.cssText='width:320px;height:200px;border:0';frame.srcdoc=state.nextHtml;preview.replaceChildren(frame)}
    sender?.send({label,index:state.index,blackout:tools.blackout,laser:tools.laser,running:tools.running,notes:state.notes,nextHtml:state.nextHtml},true)
  }
  const message=(e:MessageEvent)=>sender?.accept(e)
  const move=(e:PointerEvent)=>{if(tools.laser){dot.hidden=false;dot.style.left=`${e.clientX}px`;dot.style.top=`${e.clientY}px`}}
  const hide=()=>{dot.hidden=true}
  win.addEventListener('message',message);surface.addEventListener('pointermove',move);surface.addEventListener('pointerleave',hide)
  const timer=win.setInterval(()=>{sender?.tick();update()},250)
  update()
  let disposed=false
  function dispose() {
    if(disposed)return
    disposed=true;win.clearInterval(timer);win.removeEventListener('pagehide',dispose);win.removeEventListener('message',message);surface.removeEventListener('pointermove',move);surface.removeEventListener('pointerleave',hide);clearChannel();panel.remove();curtain.remove();dot.remove()
  }
  win.addEventListener('pagehide',dispose,{once:true})
  return dispose
}
