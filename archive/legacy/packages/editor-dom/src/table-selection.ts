import type { ComponentElement, Operation, TableModel, TableScalar } from '../../schema/src/index.js'
import { applyTableEdit, removedTableReferences, tableProps } from '../../widgets/src/table-model.js'

export interface TableSelection { anchor: string; focus: string }
export type TableCommand =
  | { kind: 'value'; value: TableScalar }
  | { kind: 'paste'; text: string }
  | { kind: 'style'; fill: string }
  | { kind: 'merge' }
  | { kind: 'split' }
  | { kind: 'insert' | 'delete' | 'move' | 'resize'; axis: 'row' | 'column'; index?: number; size?: number }

export function cellAt(m: TableModel, row: number, column: number) {
  return Object.values(m.cells).find(c => c.rowId === m.rowOrder[row] && c.columnId === m.columnOrder[column])
}
export function selectedCells(m: TableModel, s: TableSelection): string[] {
  const a=m.cells[s.anchor], b=m.cells[s.focus]
  if (!a || !b) throw new Error('TABLE_SELECTION_MISSING')
  const rows=[m.rowOrder.indexOf(a.rowId),m.rowOrder.indexOf(b.rowId)].sort((a,b)=>a-b)
  const cols=[m.columnOrder.indexOf(a.columnId),m.columnOrder.indexOf(b.columnId)].sort((a,b)=>a-b)
  return m.rowOrder.slice(rows[0],rows[1]+1).flatMap((_,r)=>m.columnOrder.slice(cols[0],cols[1]+1).map((_,c)=>cellAt(m,r+rows[0],c+cols[0])!.id))
}
/** TSV only: spaces and long numeric strings are content, never delimiters or coerced numbers. */
export function parseTablePaste(text: string): string[][] {
  const lines=text.replace(/\r\n?/g,'\n').split('\n')
  if (lines.length>1 && lines.at(-1)==='') lines.pop()
  const rows=lines.map(line=>line.split('\t'))
  if (rows.some(row=>row.length!==rows[0].length)) throw new Error('TABLE_NON_RECTANGULAR: 每行的列数必须相同')
  return rows
}
export function navigateTable(m: TableModel, id: string, key: string, backwards=false): string {
  const visible=m.rowOrder.flatMap((_,r)=>m.columnOrder.flatMap((_,c)=>{
    const cell=cellAt(m,r,c)!, merge=m.merges.find(x=>x.rowIds.includes(cell.rowId)&&x.columnIds.includes(cell.columnId))
    return merge && merge.anchorCellId!==cell.id ? [] : [cell.id]
  }))
  if (!visible.length) return id
  if (key==='Tab') return visible[Math.max(0,Math.min(visible.length-1,visible.indexOf(id)+(backwards?-1:1)))]
  const cell=m.cells[id]; if(!cell)return visible[0]
  let r=m.rowOrder.indexOf(cell.rowId), c=m.columnOrder.indexOf(cell.columnId)
  const merge=m.merges.find(x=>x.anchorCellId===id)
  if(key==='ArrowRight') c+=merge?.columnIds.length??1
  if(key==='ArrowLeft') c--
  if(key==='ArrowDown'||key==='Enter') r+=merge?.rowIds.length??1
  if(key==='ArrowUp') r--
  const next=cellAt(m,Math.max(0,Math.min(m.rowOrder.length-1,r)),Math.max(0,Math.min(m.columnOrder.length-1,c)))!
  return m.merges.find(x=>x.rowIds.includes(next.rowId)&&x.columnIds.includes(next.columnId))?.anchorCellId??next.id
}
/** Pure planner; callers commit all returned operations as one Core transaction. */
export function tableEditingOperations(element: ComponentElement, slideId: string, selection: TableSelection | undefined, command: TableCommand, prefix: string, structure: boolean): Operation[] {
  if(element.componentType!=='core/table'||element.componentVersion!=='2.0.0')throw new Error('TABLE_MIGRATION_REQUIRED')
  const m=element.props as unknown as TableModel
  if(!structure&&!['value','paste','style'].includes(command.kind))throw new Error('PORTABLE_EDIT_UNSUPPORTED: 结构编辑请使用 Host')
  const ids=selection?selectedCells(m,selection):[], first=ids.length?m.cells[ids[0]]:undefined
  const ops:Operation[]=[]
  const add=(op:Record<string,unknown>)=>ops.push({opId:`${prefix}:${ops.length}`,slideId,elementId:element.id,...op} as Operation)
  if(command.kind==='paste') {
    if(!first)throw new Error('TABLE_SELECTION_MISSING')
    const rows=parseTablePaste(command.text), r=m.rowOrder.indexOf(first.rowId), c=m.columnOrder.indexOf(first.columnId)
    if(r+rows.length>m.rowOrder.length||c+rows[0].length>m.columnOrder.length)throw new Error('TABLE_PASTE_BOUNDS: 请先增加行列')
    rows.forEach((row,ri)=>row.forEach((value,ci)=>{
      const cell=cellAt(m,r+ri,c+ci)!, merge=m.merges.find(x=>x.rowIds.includes(cell.rowId)&&x.columnIds.includes(cell.columnId))
      if(merge && !(rows.length===1&&row.length===1&&merge.anchorCellId===cell.id))throw new Error('TABLE_MERGE_BOUNDARY: 请先拆分合并单元格')
      add({kind:'table.setCellValue',cellId:cell.id,value})
    }))
  } else if(command.kind==='value'||command.kind==='style') {
    if(!selection)throw new Error('TABLE_SELECTION_MISSING')
    const targets=command.kind==='value'?[selection.focus]:ids
    for(const cellId of targets) {
      if(command.kind==='style') {
        if(!/^#[\da-f]{6}$/i.test(command.fill))throw new Error('TABLE_STYLE_INVALID')
        add({kind:'table.setCellStyle',cellId,style:{...m.cells[cellId].style,fill:command.fill}})
      } else add({kind:'table.setCellValue',cellId,value:command.value})
    }
  } else if(command.kind==='merge'||command.kind==='split') {
    if(!first)throw new Error('TABLE_SELECTION_MISSING')
    if(command.kind==='split')add({kind:'table.splitCell',cellId:selection!.focus})
    else add({kind:'table.mergeCells',merge:{anchorCellId:first.id,rowIds:m.rowOrder.filter(id=>ids.some(c=>m.cells[c].rowId===id)),columnIds:m.columnOrder.filter(id=>ids.some(c=>m.cells[c].columnId===id))}})
  } else {
    const row=command.axis==='row', order=row?m.rowOrder:m.columnOrder, selected=order.filter(id=>ids.some(c=>(row?m.cells[c].rowId:m.cells[c].columnId)===id)), suffix=row?'Rows':'Columns'
    if(command.kind==='insert') {
      const id=`${prefix}:axis`, index=command.index??(selected.length?order.indexOf(selected.at(-1)!)+1:order.length)
      add({kind:`table.insert${suffix}`,index,items:[{id}],cells:(row?m.columnOrder:m.rowOrder).map((other,i)=>({id:`${prefix}:cell:${i}`,rowId:row?id:other,columnId:row?other:id,value:null}))})
    } else {
      if(!selected.length)throw new Error('TABLE_SELECTION_MISSING')
      if(command.kind==='delete')add({kind:`table.delete${suffix}`,ids:selected})
      if(command.kind==='move')add({kind:`table.move${suffix}`,ids:selected,index:command.index})
      if(command.kind==='resize')add({kind:`table.resize${suffix}`,sizes:Object.fromEntries(selected.map(id=>[id,command.size]))})
    }
  }
  let next=m
  for(const op of ops)next=applyTableEdit(next,op as Parameters<typeof applyTableEdit>[1])
  const removed=removedTableReferences(element,{...element,props:tableProps(next)})
  if(removed.length)throw new Error(`TABLE_REFERENCE_REVIEW_REQUIRED: 删除会影响事实/来源引用，已拒绝：${removed.join(', ')}`)
  return ops
}

const stageSelections=new WeakMap<Document,{elementId:string;cellId:string;extend:boolean}>()
export function rememberTableCell(target: EventTarget | null, extend=false): boolean {
  const node=target as HTMLElement | null, cell=node?.closest?.<HTMLElement>('[data-cell-id]'), element=cell?.closest<HTMLElement>('[data-ppte-element-id]')
  if(!cell?.dataset.cellId||!element?.dataset.ppteElementId)return false
  stageSelections.set(cell.ownerDocument,{elementId:element.dataset.ppteElementId,cellId:cell.dataset.cellId,extend});return true
}
const states=new WeakMap<HTMLElement,{elementId:string;selection?:TableSelection;draft?:{value:string;type:string};paste?:string;error?:string}>()
/** Accessible inspector grid shared by Host and generated file:// Portable. */
export function renderTableEditor(root: HTMLElement, element: ComponentElement | undefined, slideId: string, structure: boolean, commit: (operations: Operation[])=>boolean): void {
  // Host status/recovery updates can render the same inspector between keystrokes.
  // Keep keyboard ownership on the replacement control, including text selection.
  const active = root.ownerDocument.activeElement as HTMLElement | null
  const focused = active && root.contains(active) && states.get(root)?.elementId === element?.id ? {
    cellId: active.dataset.tableCell,
    label: active.getAttribute('aria-label'),
    tag: active.tagName,
    text: active.textContent,
    range: active.tagName === 'TEXTAREA' ? [(active as HTMLTextAreaElement).selectionStart, (active as HTMLTextAreaElement).selectionEnd] as const : undefined,
  } : undefined
  root.replaceChildren()
  if(element?.componentType!=='core/table')return
  const doc=root.ownerDocument
  const note=doc.createElement('p'); note.textContent=structure?'表格：方向键导航，Shift 扩选；粘贴 TSV。合并显示左上格，其他格值保留。':'表格：可改值、粘贴和填充色；行列/合并请使用 Host。';root.append(note)
  const status=doc.createElement('p');status.setAttribute('role','status');root.append(status)
  if(element.componentVersion!=='2.0.0') {
    if(structure){const b=doc.createElement('button');b.textContent='升级表格以编辑';b.onclick=()=>commit([{kind:'table.migrate',opId:crypto.randomUUID(),slideId,elementId:element.id}]);root.append(b)}
    else status.textContent='旧表格需先在 Host 升级。'
    return
  }
  const m=element.props as unknown as TableModel
  let state=states.get(root)
  if(!state||state.elementId!==element.id){state={elementId:element.id};states.set(root,state)}
  if(!state.selection||!m.cells[state.selection.anchor]||!m.cells[state.selection.focus]){const id=cellAt(m,0,0)?.id;state.selection=id?{anchor:id,focus:id}:undefined}
  const pending=stageSelections.get(doc)
  if(pending?.elementId===element.id&&m.cells[pending.cellId]){state.selection={anchor:pending.extend&&state.selection?state.selection.anchor:pending.cellId,focus:pending.cellId};stageSelections.delete(doc)}
  if(state.selection)for(const key of ['anchor','focus'] as const){const cell=m.cells[state.selection[key]];state.selection[key]=m.merges.find(x=>x.rowIds.includes(cell.rowId)&&x.columnIds.includes(cell.columnId))?.anchorCellId??cell.id}
  const s=state
  status.textContent=s.error??''
  const grid=doc.createElement('table');grid.setAttribute('role','grid');grid.setAttribute('aria-label','表格单元格');root.append(grid)
  const value=doc.createElement('textarea');value.setAttribute('aria-label','单元格值')
  const type=doc.createElement('select');type.setAttribute('aria-label','单元格类型')
  for(const key of ['string','number','boolean','null']){const option=doc.createElement('option');option.value=key;option.textContent=key;type.append(option)}
  const sync=()=>{
    const ids=s.selection?selectedCells(m,s.selection):[]
    grid.querySelectorAll<HTMLButtonElement>('[data-table-cell]').forEach(b=>{b.setAttribute('aria-selected',String(ids.includes(b.dataset.tableCell!)));b.style.outline=ids.includes(b.dataset.tableCell!)?'2px solid #2563eb':'';b.tabIndex=b.dataset.tableCell===s.selection?.focus?0:-1})
    const c=s.selection?m.cells[s.selection.focus]:undefined;value.value=c?.value==null?'':String(c.value);type.value=c?.value===null?'null':typeof c?.value
    fill.value=typeof c?.style?.fill==='string'&&/^#[\da-f]{6}$/i.test(c.style.fill)?c.style.fill:'#ffffff'
  }
  const run=(command:TableCommand)=>{const draft=s.draft,pasted=s.paste;try{const ops=tableEditingOperations(element,slideId,s.selection,command,`table:${crypto.randomUUID()}`,structure);delete s.draft;delete s.paste;delete s.error;if(!commit(ops))throw new Error('修改被拒绝，输入仍保留。');status.textContent='已提交'}catch(e){s.draft=draft;s.paste=pasted;s.error=String(e);status.textContent=s.error}}
  for(let r=0;r<m.rowOrder.length;r++) {
    const tr=doc.createElement('tr');grid.append(tr)
    for(let c=0;c<m.columnOrder.length;c++) {
      const cell=cellAt(m,r,c)!, merge=m.merges.find(x=>x.rowIds.includes(cell.rowId)&&x.columnIds.includes(cell.columnId));if(merge&&merge.anchorCellId!==cell.id)continue
      const td=doc.createElement('td');td.rowSpan=merge?.rowIds.length??1;td.colSpan=merge?.columnIds.length??1;tr.append(td)
      const b=doc.createElement('button');b.dataset.tableCell=cell.id;b.textContent=cell.value==null?'∅':String(cell.value);b.setAttribute('aria-label',`单元格 ${r+1},${c+1}`);td.append(b)
      b.onclick=e=>{delete s.draft;s.selection={anchor:e.shiftKey&&s.selection?s.selection.anchor:cell.id,focus:cell.id};sync()}
      b.onkeydown=e=>{
        if(e.isComposing)return
        if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Tab','Enter'].includes(e.key)){
          const next=navigateTable(m,cell.id,e.key,e.shiftKey)
          if(e.key==='Tab'&&next===cell.id)return
          e.preventDefault();e.stopPropagation();delete s.draft;s.selection={anchor:e.shiftKey&&e.key!=='Tab'&&s.selection?s.selection.anchor:next,focus:next};sync();Array.from(grid.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.dataset.tableCell===next)?.focus()
        }
      }
      b.onpaste=e=>{e.preventDefault();e.stopPropagation();run({kind:'paste',text:e.clipboardData?.getData('text/plain')??''})}
    }
  }
  value.oninput=type.onchange=()=>{s.draft={value:value.value,type:type.value}}
  root.append(type,value)
  const button=(label:string,fn:()=>void)=>{const b=doc.createElement('button');b.textContent=label;b.onclick=fn;root.append(b)}
  button('应用单元格值',()=>{let v:TableScalar=value.value;if(type.value==='number'){if(!value.value.trim()||!Number.isFinite(Number(value.value))){status.textContent='请输入有限数字';return}v=Number(value.value)}if(type.value==='boolean'){if(!['true','false'].includes(value.value)){status.textContent='请输入 true 或 false';return}v=value.value==='true'}if(type.value==='null')v=null;run({kind:'value',value:v})})
  const fill=doc.createElement('input');fill.type='color';fill.setAttribute('aria-label','单元格填充色');fill.onchange=()=>run({kind:'style',fill:fill.value});root.append(fill)
  const paste=doc.createElement('textarea');paste.setAttribute('aria-label','粘贴 TSV');paste.value=s.paste??'';paste.oninput=()=>{s.paste=paste.value};root.append(paste);button('应用 TSV',()=>run({kind:'paste',text:paste.value}))
  if(structure){
    for(const axis of ['row','column'] as const){const label=axis==='row'?'行':'列';button(`插入${label}`,()=>run({kind:'insert',axis}));button(`删除${label}`,()=>run({kind:'delete',axis}));const index=doc.createElement('input');index.type='number';index.min='0';index.value='0';index.setAttribute('aria-label',`${label}目标位置（从 0 起）`);root.append(index);button(`移动${label}`,()=>run({kind:'move',axis,index:Number(index.value)}));const size=doc.createElement('input');size.type='number';size.min='1';size.value='40';size.setAttribute('aria-label',`${label}尺寸`);root.append(size);button(`调整${label}尺寸`,()=>run({kind:'resize',axis,size:Number(size.value)}))}
    button('合并单元格',()=>run({kind:'merge'}));button('拆分单元格',()=>run({kind:'split'}))
  }
  sync()
  if(s.draft){value.value=s.draft.value;type.value=s.draft.type}
  if(focused){
    const controls=Array.from(root.querySelectorAll<HTMLElement>('button,input,textarea,select'))
    const replacement=controls.find(control=>focused.cellId
      ? control.dataset.tableCell===focused.cellId
      : control.tagName===focused.tag&&(focused.label?control.getAttribute('aria-label')===focused.label:control.textContent===focused.text))
      ?? (focused.cellId?controls.find(control=>control.dataset.tableCell===s.selection?.focus):undefined)
    replacement?.focus({preventScroll:true})
    if(replacement&&focused.range)(replacement as HTMLTextAreaElement).setSelectionRange(...focused.range)
  }
}
