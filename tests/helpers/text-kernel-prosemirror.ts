import { Schema, type Node as PmNode } from 'prosemirror-model'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import type { Factory } from './text-kernel-poc.js'
import type { RichTextDocument, TextMarks } from '../../packages/schema/src/index.js'

// Deliberately minimal active-text schema. No history, keymap, collab or cloud plugins.
const schema = new Schema({
  nodes: {
    doc: {content:'paragraph+'},
    paragraph: {content:'text*', attrs:{semantic:{default:null}}, toDOM:()=>['p',0], parseDOM:[{tag:'p'}]},
    text: {group:'inline'},
  },
  marks: {
    bold: {toDOM:()=>['strong',0],parseDOM:[{tag:'strong'},{tag:'b'}]},
    italic: {toDOM:()=>['em',0],parseDOM:[{tag:'em'},{tag:'i'}]},
    underline: {toDOM:()=>['u',0],parseDOM:[{tag:'u'}]},
    strike: {toDOM:()=>['s',0],parseDOM:[{tag:'s'}]},
  },
})
function fromSemantic(content: RichTextDocument) {
  return schema.node('doc',null,content.paragraphs.map(p=>schema.node('paragraph',{semantic:{...p,runs:undefined}},p.runs.filter(r=>r.text).map(r=>schema.text(r.text,Object.entries(r.marks??{}).filter(([name,value])=>value===true&&schema.marks[name]).map(([name])=>schema.marks[name].create()))))))
}
function toSemantic(doc: PmNode): RichTextDocument {
  const paragraphs: RichTextDocument['paragraphs'] = []
  doc.forEach((p,_offset,index)=>{
    const id=p.attrs.semantic?.id??`pm-p-${index}`
    const runs:RichTextDocument['paragraphs'][number]['runs']=[]
    p.forEach((r,_offset,i)=>{
      const marks:TextMarks={}
      for(const m of r.marks) if (m.type.name in schema.marks) (marks as Record<string,boolean>)[m.type.name]=true
      runs.push({id:`${id}:pm:${i}`,text:r.text!,...(Object.keys(marks).length?{marks}:{})})
    })
    paragraphs.push({...p.attrs.semantic,id,runs:runs.length?runs:[{id:`${id}:empty`,text:''}]})
  })
  return {paragraphs}
}
export const prosemirrorFactory:Factory = (root,content)=>{
  const view=new EditorView(root,{state:EditorState.create({schema,doc:fromSemantic(content),plugins:[]})})
  function position(offset:number) {
    let flat=0, found:number|undefined
    view.state.doc.forEach((p,pos)=>{if(found===undefined&&offset>=flat&&offset<=flat+p.content.size)found=pos+1+offset-flat;flat+=p.content.size+1})
    if(found===undefined)throw Error('selection outside text')
    return found
  }
  return {root:view.dom,read:()=>toSemantic(view.state.doc),select:(a,h)=>{view.focus();view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,position(a),position(h))))},insert:text=>view.dispatch(view.state.tr.insertText(text)),paste:html=>{view.pasteHTML(html)},bold:()=>{const {from,to}=view.state.selection;view.dispatch(view.state.tr.addMark(from,to,schema.marks.bold.create()))},destroy:()=>view.destroy()}
}
