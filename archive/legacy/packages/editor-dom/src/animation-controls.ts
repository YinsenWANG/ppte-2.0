import type { Operation, Slide } from '../../schema/src/index.js'
import { ANIMATION_MAX_MS, AnimationPlayback } from '../../portable-runtime/src/animation-playback.js'

/** Configuration commits only typed operations; the preview owns an isolated DOM clone. */
export function renderAnimationControls(root: HTMLElement, slide: Slide, ids: string[], commit: (ops: Operation[]) => boolean, surface: () => HTMLElement | null): void {
  const signature = JSON.stringify([slide.id, slide.transition, ids.map(id => [id, slide.elements[id]?.appearStep, slide.elements[id]?.animation])])
  if (root.dataset.signature === signature) return
  root.dataset.signature = signature
  root.replaceChildren()
  const doc = root.ownerDocument
  const field = doc.createElement('fieldset'); const legend = doc.createElement('legend'); legend.textContent = '动画'; field.append(legend); root.append(field)
  const emit = (value: object) => commit([{opId:`animation:${crypto.randomUUID()}`,slideId:slide.id,...value} as Operation])
  const choice = (label: string, values: string[], value: string, save: (v: string) => void) => {
    const wrap = doc.createElement('label'); wrap.textContent = label
    const select = doc.createElement('select'); select.setAttribute('aria-label',label)
    for (const v of values) { const option = doc.createElement('option'); option.value = v; option.textContent = v; select.append(option) }
    select.value = value; select.onchange = () => save(select.value); wrap.append(select); field.append(wrap)
  }
  const number = (label: string, value: number, max: number, save: (v: number) => void) => {
    const wrap = doc.createElement('label'); wrap.textContent = label
    const input = doc.createElement('input'); input.type = 'number'; input.min = '0'; input.max = String(max); input.step = '1'; input.value = String(value); input.setAttribute('aria-label',label)
    input.onchange = () => { if (input.checkValidity() && input.value !== '') save(Number(input.value)) }
    wrap.append(input); field.append(wrap)
  }
  const transition = slide.transition ?? {type:'none'}
  const changeTransition = (patch: object) => emit({kind:'slide.setTransition',transition:{...transition,...patch}})
  choice('翻页效果',['none','fade','slide','push'],transition.type,type=>changeTransition({type}))
  choice('翻页方向',['left','right','up','down'],transition.direction ?? 'left',direction=>changeTransition({direction}))
  number('翻页时长 (ms)',transition.durationMs ?? 0,ANIMATION_MAX_MS,durationMs=>changeTransition({durationMs}))
  const element = ids.length === 1 ? slide.elements[ids[0]] : undefined
  if (element) {
    number('揭示步骤',element.appearStep ?? 0,100000,appearStep=>emit({kind:'element.setAppearStep',elementId:element.id,appearStep}))
    const enter = element.animation?.enter
    const changeEnter = (patch: object) => emit({kind:'element.setAnimation',elementId:element.id,animation:{...element.animation,enter:{type:'fade',...enter,...patch}}})
    choice('入场效果',['none','fade','slide-up','slide-left',...(enter?.type==='scale'?['scale']:[])],enter?.type ?? 'none',type=>{
      if(type==='none'){const animation={...element.animation};delete animation.enter;emit({kind:'element.setAnimation',elementId:element.id,animation})}
      else changeEnter({type})
    })
    number('入场时长 (ms)',enter?.durationMs ?? 0,ANIMATION_MAX_MS,durationMs=>changeEnter({durationMs}))
    number('入场延迟 (ms)',enter?.delayMs ?? 0,ANIMATION_MAX_MS,delayMs=>changeEnter({delayMs}))
    choice('入场缓动',['linear','ease','ease-in','ease-out','ease-in-out'],enter?.easing ?? 'ease',easing=>changeEnter({easing}))
  }
  const notice = doc.createElement('p'); notice.textContent = '支持 fade、slide-up、slide-left。scale / exit 保留为静态；时长和延迟最多 10000 ms。'; field.append(notice)
  const preview = doc.createElement('button'); preview.type='button';preview.textContent='预览动画'; field.append(preview)
  preview.onclick=()=>{
    const source=surface();if(!source)return
    const dialog=doc.createElement('dialog'), clone=source.cloneNode(true) as HTMLElement
    clone.removeAttribute('data-ppte-slide-id');clone.querySelectorAll('[contenteditable]').forEach(n=>n.removeAttribute('contenteditable'))
    clone.inert=true
    const playback=new AnimationPlayback();let step=0
    const close=doc.createElement('button');close.textContent='关闭预览'
    const next=doc.createElement('button');next.textContent='下一步预览'
    const steps=[...new Set(Object.values(slide.elements).map(e=>e.appearStep??0))].sort((a,b)=>a-b)
    next.onclick=()=>{step=steps.find(s=>s>step)??0;playback.apply(clone,slide,step,true)}
    close.onclick=()=>dialog.close();dialog.onclose=()=>{playback.dispose();dialog.remove()}
    dialog.append(clone,next,close);doc.body.append(dialog);dialog.showModal();playback.apply(clone,slide,step,true)
  }
}
