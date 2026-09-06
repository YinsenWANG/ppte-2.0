import { PresenterChannel } from '../../editor-controller/src/presenter-channel.js'
// This entry executes in the child realm: postMessage must carry the child's source.
const config=JSON.parse(document.getElementById('ppte-presenter-config')!.textContent!) as {session:string;token:string;origin:string}
document.getElementById('ppte-presenter-config')!.remove()
const parent=window.opener as Window
const status=document.querySelector<HTMLElement>('[role=status]')!
const notes=document.querySelector<HTMLElement>('[data-ppte-speaker-notes]')!
const preview=document.querySelector<HTMLElement>('[data-ppte-next-preview]')!
let lastPreview=''
const channel=new PresenterChannel({...config,source:parent,now:()=>performance.now(),send:m=>parent.postMessage(m,config.origin),receive:value=>{
  if(!value||typeof value!=='object')return
  const s=value as {label:string;index:number;blackout:boolean;laser:boolean;running:boolean;notes:string;nextHtml:string}
  if(typeof s.label!=='string'||typeof s.notes!=='string'||typeof s.nextHtml!=='string')return
  status.textContent=s.label;notes.textContent=s.notes
  if(document.activeElement!==input)input.value=String(s.index+1)
  for(const [label,pressed] of [['黑屏',s.blackout],['激光笔',s.laser],['计时开始/暂停',s.running]] as const)document.querySelector(`[aria-label="${label}"]`)?.setAttribute('aria-pressed',String(pressed))
  if(lastPreview!==s.nextHtml){lastPreview=s.nextHtml;const frame=document.createElement('iframe');frame.title='下一页预览';frame.setAttribute('sandbox','');frame.style.cssText='width:320px;height:200px;border:0';frame.srcdoc=s.nextHtml;preview.replaceChildren(frame)}
}})
window.addEventListener('message',event=>channel.accept(event))
const actions=['previous','next','blackout','laser','timer','reset','exit']
document.querySelectorAll('button').forEach((button,index)=>button.onclick=()=>{if(!channel.send({action:actions[index]}))status.textContent='命令队列已满，请稍后重试'})
const input=document.querySelector('input')!
input.onchange=()=>{channel.send({action:'goto',index:Number(input.value)-1})}
const timer=setInterval(()=>{channel.tick();if(!channel.connected)status.textContent='连接中或已断连；正在重试，可关闭后从单屏重连'},500)
window.addEventListener('pagehide',()=>{clearInterval(timer);channel.dispose()},{once:true})
