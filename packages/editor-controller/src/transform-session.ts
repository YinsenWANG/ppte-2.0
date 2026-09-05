import { cloneJson, equalJson } from '../../canonical-json/src/index.js'
import { boundingFrame } from '../../geometry/src/index.js'
import type { Frame, Operation, Point, PpteDocument, Transaction } from '../../schema/src/index.js'

export type TransformCommand =
  | { kind:'move'; dx:number; dy:number; snapThreshold?:number }
  | { kind:'resize'; frame:Frame; preserveAspectRatio?:boolean }
  | { kind:'rotate'; degrees:number }
  | { kind:'align'; axis:'x'|'y'; edge:'start'|'center'|'end'; range:'selection'|'canvas' }
  | { kind:'distribute'; axis:'x'|'y'; range:'selection'|'canvas' }
  | { kind:'layer'; direction:'front'|'back'|'forward'|'backward' }
  | { kind:'group'; groupId:string }
  | { kind:'ungroup'; groupId:string }
export interface TransformInput { revision:string; slideId:string; ids:string[]; command:TransformCommand; transactionId:string; createdAt:string }
export interface TransformGeometry { frame:Frame; rotationDeg?:number }
function targets(document:PpteDocument, slideId:string, ids:string[]) {
  const slide=document.slides[slideId]
  if(!slide)throw Error('SLIDE_MISSING')
  if(!ids.length)throw Error('SELECTION_EMPTY')
  return [...new Set(ids)].map(id=>{const e=slide.elements[id];if(!e)throw Error('ELEMENT_MISSING');if(e.locked)throw Error('ELEMENT_LOCKED');return e})
}
function valid(frame:Frame) { if(!Object.values(frame).every(Number.isFinite)||frame.width<=0||frame.height<=0)throw Error('INVALID_GEOMETRY') }
export function transformGeometry(document:PpteDocument, slideId:string, ids:string[], command:TransformCommand):Record<string,TransformGeometry> {
  const elements=targets(document,slideId,ids), bounds=boundingFrame(elements.map(e=>e.frame))
  const result=Object.fromEntries(elements.map(e=>[e.id,{frame:cloneJson(e.frame),rotationDeg:e.rotationDeg}]))
  const canvas={x:0,y:0,width:document.canvas.width,height:document.canvas.height}
  if(command.kind==='move') {
    let {dx,dy}=command
    if(!Number.isFinite(dx)||!Number.isFinite(dy))throw Error('INVALID_GEOMETRY')
    if(command.snapThreshold!==undefined && (dx!==0||dy!==0)) {
      const threshold=command.snapThreshold
      if(!Number.isFinite(threshold)||threshold<0)throw Error('INVALID_GEOMETRY')
      const others=Object.values(document.slides[slideId].elements).filter(e=>!ids.includes(e.id)&&e.visible!==false).map(e=>e.frame)
      const inset=document.canvas.safeArea??{left:40,right:40,top:40,bottom:40}
      const guides=[canvas,{x:inset.left,y:inset.top,width:canvas.width-inset.left-inset.right,height:canvas.height-inset.top-inset.bottom},...others]
      const correction=(axis:'x'|'y',size:'width'|'height',delta:number)=>{
        let best=threshold+1, correction=0
        for(const guide of guides)for(const a of [0,.5,1])for(const b of [0,.5,1]) {
          const d=guide[axis]+guide[size]*a-(bounds[axis]+delta+bounds[size]*b)
          if(Math.abs(d)<=threshold&&Math.abs(d)<best){best=Math.abs(d);correction=d}
        }
        return correction
      }
      dx+=correction('x','width',dx);dy+=correction('y','height',dy)
    }
    for(const e of elements){result[e.id].frame.x+=dx;result[e.id].frame.y+=dy}
  } else if(command.kind==='resize') {
    const frame=cloneJson(command.frame);valid(frame);valid(bounds)
    if(command.preserveAspectRatio ?? elements.some(e=>e.type==='image')) frame.height=frame.width*bounds.height/bounds.width
    const sx=frame.width/bounds.width,sy=frame.height/bounds.height
    for(const e of elements)result[e.id].frame={x:frame.x+(e.frame.x-bounds.x)*sx,y:frame.y+(e.frame.y-bounds.y)*sy,width:e.frame.width*sx,height:e.frame.height*sy}
  } else if(command.kind==='rotate') {
    if(!Number.isFinite(command.degrees))throw Error('INVALID_GEOMETRY')
    if(command.degrees===0)return result
    const angle=command.degrees*Math.PI/180,cx=bounds.x+bounds.width/2,cy=bounds.y+bounds.height/2
    for(const e of elements){const x=e.frame.x+e.frame.width/2-cx,y=e.frame.y+e.frame.height/2-cy;result[e.id]={frame:{...e.frame,x:cx+x*Math.cos(angle)-y*Math.sin(angle)-e.frame.width/2,y:cy+x*Math.sin(angle)+y*Math.cos(angle)-e.frame.height/2},rotationDeg:(e.rotationDeg??0)+command.degrees}}
  } else if(command.kind==='align'||command.kind==='distribute') {
    const area=command.range==='canvas'?canvas:bounds,axis=command.axis,size=axis==='x'?'width':'height'
    if(command.kind==='align') {const factor=command.edge==='start'?0:command.edge==='center'?.5:1;for(const e of elements)result[e.id].frame[axis]=area[axis]+(area[size]-e.frame[size])*factor}
    else {
      if(elements.length<3)throw Error('DISTRIBUTE_REQUIRES_THREE')
      const sorted=[...elements].sort((a,b)=>a.frame[axis]-b.frame[axis]),gap=(area[size]-elements.reduce((sum,e)=>sum+e.frame[size],0))/(elements.length-1)
      let position=area[axis];for(const e of sorted){result[e.id].frame[axis]=position;position+=e.frame[size]+gap}
    }
  }
  for(const value of Object.values(result))valid(value.frame)
  return result
}
/** Shared pure planner used by pointer, keyboard and property controls on both surfaces. */
export function planTransform(document:PpteDocument,input:TransformInput):Transaction|undefined {
  const {slideId,command,transactionId}=input, elements=targets(document,slideId,input.ids),ids=elements.map(e=>e.id),slide=document.slides[slideId]
  const operations:Operation[]=[],base={slideId,opId:transactionId}
  if(command.kind==='group')operations.push({...base,kind:'group.create',group:{id:command.groupId,memberIds:ids}})
  else if(command.kind==='ungroup') {
    const group=slide.groups?.[command.groupId];if(!group||group.memberIds.some(id=>!ids.includes(id)))throw Error('GROUP_SCOPE_DENIED')
    operations.push({...base,kind:'group.delete',groupId:command.groupId})
  } else if(command.kind==='layer') {
    const order=[...slide.rootOrder], selected=order.filter(id=>ids.includes(id))
    const desired=command.direction==='front'?[...order.filter(id=>!ids.includes(id)),...selected]:command.direction==='back'?[...selected,...order.filter(id=>!ids.includes(id))]:[...order]
    if(command.direction==='forward')for(let i=desired.length-2;i>=0;i--)if(ids.includes(desired[i])&&!ids.includes(desired[i+1]))[desired[i],desired[i+1]]=[desired[i+1],desired[i]]
    if(command.direction==='backward')for(let i=1;i<desired.length;i++)if(ids.includes(desired[i])&&!ids.includes(desired[i-1]))[desired[i],desired[i-1]]=[desired[i-1],desired[i]]
    const moving=command.direction==='front'||command.direction==='forward'?[...selected].reverse():selected
    for(const id of moving){const index=desired.indexOf(id),from=order.indexOf(id);if(index===from)continue;operations.push({...base,kind:'element.reorder',elementId:id,index});order.splice(from,1);order.splice(index,0,id)}
  } else {
    const geometry=transformGeometry(document,slideId,ids,command)
    for(const e of elements){const next=geometry[e.id];if(!equalJson(next.frame,e.frame))operations.push({...base,kind:'element.resize',elementId:e.id,frame:next.frame});if(next.rotationDeg!==e.rotationDeg)operations.push({...base,kind:'element.rotate',elementId:e.id,rotationDeg:next.rotationDeg})}
  }
  if(!operations.length)return undefined
  operations.forEach((op,i)=>op.opId=`${transactionId}:${i}`)
  const structure=['group','ungroup','layer'].includes(command.kind)
  return {transactionId,baseRevision:input.revision,createdAt:input.createdAt,actor:{type:'human',id:'transform'},scope:{kind:'selection',slideIds:[slideId],elementIds:ids,permissions:[structure?'structure':'geometry'],allowInsert:false,allowDelete:false},changeContract:{allowedOperationKinds:[...new Set(operations.map(op=>op.kind))],allowedElementIds:ids,maxChangedSlides:1,maxInsertedElements:0,maxDeletedElements:0,requireConfirmation:false},operations}
}

/** Immutable gesture baseline. Updates are previews only; end is consumable once. */
export class TransformSession {
  private active=true
  private command:TransformCommand={kind:'move',dx:0,dy:0}
  readonly document:PpteDocument
  readonly bounds:Frame
  constructor(document:PpteDocument,readonly revision:string,readonly slideId:string,readonly ids:string[],readonly start:Point,readonly mode:'move'|'resize'|'rotate'='move',readonly preserveAspectRatio?:boolean) {
    this.document=cloneJson(document);this.ids=[...new Set(ids)];this.start={...start};this.bounds=boundingFrame(targets(this.document,slideId,ids).map(e=>e.frame))
  }
  update(point:Point,snapThreshold?:number):Record<string,TransformGeometry> {
    if(!this.active)return {}
    const dx=point.x-this.start.x,dy=point.y-this.start.y
    if(dx===0&&dy===0){this.command={kind:'move',dx:0,dy:0};return transformGeometry(this.document,this.slideId,this.ids,this.command)}
    this.command=this.mode==='move'?{kind:'move',dx,dy,snapThreshold}:this.mode==='resize'?{kind:'resize',frame:{...this.bounds,width:this.bounds.width+dx,height:this.bounds.height+dy},preserveAspectRatio:this.preserveAspectRatio}:{kind:'rotate',degrees:dx===0&&dy===0?0:(Math.atan2(point.y-this.bounds.y-this.bounds.height/2,point.x-this.bounds.x-this.bounds.width/2)-Math.atan2(this.start.y-this.bounds.y-this.bounds.height/2,this.start.x-this.bounds.x-this.bounds.width/2))*180/Math.PI}
    if(this.mode==='resize'&&this.ids.length===1&&this.command.kind==='resize') {
      const element=this.document.slides[this.slideId].elements[this.ids[0]], angle=(element.rotationDeg??0)*Math.PI/180
      const localX=dx*Math.cos(angle)+dy*Math.sin(angle),localY=-dx*Math.sin(angle)+dy*Math.cos(angle)
      const width=this.bounds.width+localX
      const height=(this.preserveAspectRatio??element.type==='image')?width*this.bounds.height/this.bounds.width:this.bounds.height+localY
      const dw=width-this.bounds.width,dh=height-this.bounds.height
      this.command={kind:'resize',preserveAspectRatio:false,frame:{x:this.bounds.x+(dw*Math.cos(angle)-dh*Math.sin(angle)-dw)/2,y:this.bounds.y+(dw*Math.sin(angle)+dh*Math.cos(angle)-dh)/2,width,height}}
    }
    return transformGeometry(this.document,this.slideId,this.ids,this.command)
  }
  end(transactionId:string,createdAt=new Date().toISOString()):Transaction|undefined {
    if(!this.active)return;this.active=false
    return planTransform(this.document,{revision:this.revision,slideId:this.slideId,ids:this.ids,command:this.command,transactionId,createdAt})
  }
  cancel():void {this.active=false}
}
