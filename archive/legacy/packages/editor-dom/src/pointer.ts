import { TransformSession, type TransformGeometry } from '../../editor-controller/src/transform-session.js'
import type { Point, Transaction } from '../../schema/src/index.js'
/** The sole screen-to-document conversion; never use offsetX or accumulated deltas. */
export function screenToDu(point:{clientX:number;clientY:number},rect:{left:number;top:number;width:number;height:number},canvas:{width:number;height:number}):Point {
  if(![rect.width,rect.height,canvas.width,canvas.height].every(n=>Number.isFinite(n)&&n>0))throw Error('INVALID_VIEWPORT')
  return {x:(point.clientX-rect.left)*canvas.width/rect.width,y:(point.clientY-rect.top)*canvas.height/rect.height}
}
export class TransformPointer {
  constructor(readonly session:TransformSession,readonly pointerId:number,private readonly convert:(event:{clientX:number;clientY:number})=>Point,private readonly preview:(geometry:Record<string,TransformGeometry>)=>void,private readonly commit:(tx:Transaction)=>void,private readonly reset:()=>void) {}
  move(event:{pointerId:number;clientX:number;clientY:number},threshold?:number):void {if(event.pointerId!==this.pointerId)return;try{this.preview(this.session.update(this.convert(event),threshold))}catch{this.cancel()}}
  end(event:{pointerId:number},id:string):void {if(event.pointerId!==this.pointerId)return;try{const tx=this.session.end(id);if(tx)this.commit(tx)}finally{this.reset()}}
  cancel():void {this.session.cancel();this.reset()}
}
