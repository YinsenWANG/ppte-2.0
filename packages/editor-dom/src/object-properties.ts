import { boundingFrame } from '../../geometry/src/index.js'
import { canonicalJsonString } from '../../canonical-json/src/index.js'
import { createBasicObject, objectPropertyValues, type ObjectPropertyCommand } from '../../editor-controller/src/object-commands.js'
import type { PpteDocument, ShapeKind } from '../../schema/src/index.js'

const propertyCommitters = new WeakMap<HTMLElement, (command: ObjectPropertyCommand) => void>()
const renderedProperties = new WeakMap<HTMLElement, string>()

/** One DOM adapter for Host and Portable. The owner supplies the Operation Engine boundary. */
export function renderObjectProperties(root: HTMLElement, document: PpteDocument, slideId: string, ids: string[], commit: (command: ObjectPropertyCommand) => void): void {
  propertyCommitters.set(root, commit)
  // Text draft flushes must not detach the property input receiving focus.
  // Content is deliberately absent: this panel edits whole-box properties.
  const signature = canonicalJsonString({slideId,ids,theme:document.theme,background:document.slides[slideId].background,
    groups:document.slides[slideId].groups,properties:ids.map(id=>{const e=document.slides[slideId].elements[id];return {id,type:e?.type,style:e&&'style' in e?e.style:undefined,shape:e?.type==='shape'?e.shape:undefined,frame:e?.frame,rotationDeg:e?.rotationDeg,paragraphStyle:e?.type==='text'?e.paragraphStyle:undefined}})})
  if (renderedProperties.get(root) === signature) return
  renderedProperties.set(root, signature)
  root.replaceChildren()
  const dom = root.ownerDocument
  if (!dom.getElementById('ppte-object-properties-style')) {
    const style = dom.createElement('style');style.id='ppte-object-properties-style'
    style.textContent=`[data-ppte-object-properties]{font:13px/1.5 system-ui,sans-serif;display:flex;flex-direction:column;gap:8px;padding:12px;color:#292b35;background:#fff;border:1px solid #e2e3e8;border-radius:8px}[data-ppte-object-properties] label{display:flex;justify-content:space-between;align-items:center;gap:8px}[data-ppte-object-properties] input{min-width:0;max-width:130px}[data-ppte-object-properties] button,[data-ppte-object-properties] select,[data-ppte-object-properties] input{font:inherit;border:1px solid #d9dbe3;border-radius:5px;padding:4px;background:#fff;color:#292b35}[data-ppte-object-properties] button{cursor:pointer;text-align:left}[data-ppte-object-properties] button:hover{background:#f0f2f7}[data-ppte-object-properties] fieldset{border:1px solid #d9dbe3;min-width:0;padding:8px}[data-ppte-object-properties] p{margin:0}[data-ppte-properties-panel]{padding:12px;overflow:auto;background:#f6f7fa}[data-ppte-properties-panel]>summary{cursor:pointer;font:600 14px system-ui;margin-bottom:12px}`
    dom.head.append(style)
  }
  const heading = dom.createElement('p')
  heading.textContent = ids.length ? `选中 ${ids.length} 个对象 · 格式作用于全部选中对象（整框）` : '当前页 · 背景与插入'
  root.append(heading)
  const apply = (command:ObjectPropertyCommand) => { try { propertyCommitters.get(root)!(command) } catch (error) { message.textContent=String(error) } }
  const message = dom.createElement('p'); message.setAttribute('role','status')
  const button = (label:string, action:()=>void) => { const b=dom.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>{try{action()}catch(error){message.textContent=String(error)}};root.append(b) }
  const input = (label:string,key:string,type:string,action:(value:string)=>void) => {
    const wrap=dom.createElement('label');wrap.textContent=label
    const node=dom.createElement('input');node.type=type;node.setAttribute('aria-label',label)
    const value=objectPropertyValues(document,slideId,ids,key)
    node.dataset.valueState=value.state
    if(value.state==='mixed'){node.placeholder='混合值';wrap.append('（混合值）')}
    else if(value.state==='value') {
      if (typeof value.value==='number') node.value=String(value.value)
      if (type==='color') {
        let color:unknown=value.value
        if (color && typeof color==='object' && 'color' in color) color=color.color
        if (color && typeof color==='object' && 'value' in color) color=color.value
        if (typeof color==='string' && /^#[0-9a-f]{6}$/i.test(color)) node.value=color
      }
    }
    let lastValue=node.value
    node.onchange=()=>{if(node.value===lastValue)return;lastValue=node.value;action(node.value)};wrap.append(node);root.append(wrap)
  }
  const elements=ids.map(id=>document.slides[slideId].elements[id])
  if(elements.length) {
    const bounds=boundingFrame(elements.map(e=>e.frame))
    let range:'selection'|'canvas'='selection', preserve=elements.some(e=>e.type==='image')
    const scope=dom.createElement('select');scope.setAttribute('aria-label','对齐范围')
    for(const [value,label] of [['selection','选择包围盒'],['canvas','画布']]){const o=dom.createElement('option');o.value=value;o.textContent=label;scope.append(o)}
    scope.onchange=()=>{range=scope.value as typeof range};root.append(scope)
    const ratio=dom.createElement('input');ratio.type='checkbox';ratio.checked=preserve;ratio.setAttribute('aria-label','保持比例');ratio.onchange=()=>{preserve=ratio.checked};const label=dom.createElement('label');label.textContent='保持比例（图片默认开启）';label.append(ratio);root.append(label)
    for(const axis of ['x','y'] as const)for(const edge of ['start','center','end'] as const)button(({x:{start:'对象左对齐',center:'对象水平居中',end:'对象右对齐'},y:{start:'对象顶对齐',center:'对象垂直居中',end:'对象底对齐'}})[axis][edge],()=>apply({kind:'transform',command:{kind:'align',axis,edge,range}}))
    for(const axis of ['x','y'] as const)button(axis==='x'?'水平等距分布':'垂直等距分布',()=>apply({kind:'transform',command:{kind:'distribute',axis,range}}))
    for(const direction of ['front','back','forward','backward'] as const)button(({front:'置于顶层',back:'置于底层',forward:'上移一层',backward:'下移一层'})[direction],()=>apply({kind:'transform',command:{kind:'layer',direction}}))
    button('组合',()=>apply({kind:'transform',command:{kind:'group',groupId:`group_${crypto.randomUUID()}`}}))
    const group=Object.values(document.slides[slideId].groups??{}).find(g=>g.memberIds.length===ids.length&&g.memberIds.every(id=>ids.includes(id)))
    if(group)button('取消组合',()=>apply({kind:'transform',command:{kind:'ungroup',groupId:group.id}}))
    for(const key of ['width','height'] as const){const label=dom.createElement('label');label.textContent=key==='width'?'对象宽度':'对象高度';const n=dom.createElement('input');n.type='number';n.value=String(bounds[key]);n.setAttribute('aria-label',label.textContent);n.onchange=()=>{const frame={...bounds,[key]:Number(n.value)};if(preserve&&key==='height')frame.width=frame.height*bounds.width/bounds.height;apply({kind:'transform',command:{kind:'resize',frame,preserveAspectRatio:preserve}})};label.append(n);root.append(label)}
    button('旋转 +15°',()=>apply({kind:'transform',command:{kind:'rotate',degrees:15}}))
    const hint=dom.createElement('p');hint.textContent='拖动移动；Ctrl/⌘ 拖动缩放；Ctrl/⌘+Alt 拖动旋转；Shift 缩放解锁比例；方向键微移，Shift 大步；Esc 取消';root.append(hint)
  }
  if(elements.length&&elements.every(e=>e?.type==='shape')){
    const shape=dom.createElement('select');shape.setAttribute('aria-label','形状类型')
    for(const kind of ['','rectangle','rounded-rectangle','ellipse','line','arrow','triangle','diamond','chevron']){const option=dom.createElement('option');option.value=kind;option.textContent=kind||'混合值';shape.append(option)}
    const current=objectPropertyValues(document,slideId,ids,'shape');shape.value=current.state==='value'?String(current.value):''
    shape.onchange=()=>{if(shape.value)apply({kind:'shape-kind',shape:shape.value as ShapeKind})};root.append(shape)

    input('形状填充','fill','color',value=>apply({kind:'shape-style',patch:{fill:{kind:'solid',color:{kind:'value',value:value as `#${string}`}}}}))
    input('形状描边','stroke','color',value=>apply({kind:'shape-stroke',patch:{color:{kind:'value',value:value as `#${string}`}}}))
    input('描边宽度','stroke.width','number',value=>apply({kind:'shape-stroke',patch:{width:Number(value)}}))
    button('无填充',()=>apply({kind:'shape-style',patch:{fill:{kind:'none'}}}))
  }
  if(elements.length&&elements.every(e=>e?.type==='text')){
    input('整框字号','fontSize','number',value=>apply({kind:'text-style',patch:{fontSize:Number(value)}}))
    input('整框文字颜色','color','color',value=>apply({kind:'text-style',patch:{color:{kind:'value',value:value as `#${string}`}}}))
    input('段落行高','lineHeight','number',value=>apply({kind:'paragraph',patch:{lineHeight:Number(value)}}))
    input('段后间距','paragraphSpacing','number',value=>apply({kind:'paragraph',patch:{paragraphSpacing:Number(value)}}))
    const align=dom.createElement('select');align.setAttribute('aria-label','整框段落对齐')
    const current=objectPropertyValues(document,slideId,ids,'align')
    for(const [value,label] of [['','混合值'],['left','左对齐'],['center','居中'],['right','右对齐']]){const option=dom.createElement('option');option.value=value;option.textContent=label;align.append(option)}
    align.value=current.state==='value'?String(current.value):''
    align.onchange=()=>{if(align.value)apply({kind:'paragraph',patch:{align:align.value as 'left'|'center'|'right'}})};root.append(align)
  }
  const background=dom.createElement('fieldset'),legend=dom.createElement('legend');legend.textContent='背景 · 仅当前页；不修改主题';background.append(legend)
  const color=dom.createElement('input');color.type='color';color.setAttribute('aria-label','当前页背景色');color.onchange=()=>apply({kind:'background',paint:{kind:'solid',color:{kind:'value',value:color.value as `#${string}`}}});background.append(color);root.append(background)
  const state=dom.createElement('p');state.textContent=document.slides[slideId].background===undefined?'背景：继承画布默认值':`背景：${document.slides[slideId].background!.kind}`;background.append(state)
  const token=dom.createElement('select');token.setAttribute('aria-label','当前页背景主题色')
  const prompt=dom.createElement('option');prompt.value='';prompt.textContent='选择主题色';token.append(prompt)
  for(const name of Object.keys(document.theme.tokens.colors)){const option=dom.createElement('option');option.value=name;option.textContent=name;token.append(option)}
  token.onchange=()=>{if(token.value)apply({kind:'background',paint:{kind:'solid',color:{kind:'token',token:token.value}}})};background.append(token)
  button('背景渐变（所选颜色到白色）',()=>apply({kind:'background',paint:{kind:'linear-gradient',angleDeg:90,stops:[{offset:0,color:{kind:'value',value:color.value as `#${string}`}},{offset:1,color:{kind:'value',value:'#ffffff'}}]}}))
  button('恢复背景继承',()=>apply({kind:'background',paint:'inherit'}))
  button('透明背景',()=>apply({kind:'background',paint:{kind:'none'}}))
  const insert=dom.createElement('select');insert.setAttribute('aria-label','插入对象类型')
  for(const kind of ['text','rectangle','rounded-rectangle','ellipse','line','arrow','triangle','diamond','chevron']){const option=dom.createElement('option');option.value=kind;option.textContent=kind;insert.append(option)}root.append(insert)
  button('插入对象',()=>apply({kind:'insert',element:createBasicObject(document,`object_${crypto.randomUUID()}`,insert.value as 'text'|ShapeKind)}))
  root.tabIndex=0
  root.onkeydown=event=>{
    if(event.target!==root||event.isComposing||!event.altKey||!event.shiftKey)return
    const kind=event.code==='KeyT'?'text':event.code==='KeyR'?'rectangle':undefined
    if(kind){event.preventDefault();apply({kind:'insert',element:createBasicObject(document,`object_${crypto.randomUUID()}`,kind)})}
  }
  const hint=dom.createElement('p');hint.textContent='聚焦此面板后：Alt+Shift+T 插入文字；Alt+Shift+R 插入矩形';root.append(hint)
  root.append(message)
}
