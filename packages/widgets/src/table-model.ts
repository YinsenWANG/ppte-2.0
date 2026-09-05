import type { ComponentElement, TableModel, TableCell, Operation, JsonValue } from '../../schema/src/index.js'
import { assertTableComponent, assertTableModel } from '../../schema/src/table.js'
export { assertTableModel, tableCellDisplay } from '../../schema/src/table.js'
export type { TableModel, TableCell, TableMerge, TableAxis, TableScalar } from '../../schema/src/table.js'

/** Explicit, deterministic migration; never mutates the source component. */
export function migrateTableV1(element: ComponentElement): { model: TableModel; report: { elementId: string; from: string; to: string; cellIds: string[] } } {
  assertTableComponent(element)
  if (Object.keys(element.props).some(key=>!['columns','rows','caption'].includes(key))) throw new Error('TABLE_MIGRATION_UNSUPPORTED_PROP: preserve source and review unknown props')
  if (element.componentVersion !== '1.0.0') throw new Error('TABLE_MIGRATION_SOURCE: expected v1')
  const columns = (element.props.columns ?? []) as string[], values = (element.props.rows ?? []) as TableCell['value'][][]
  const width = Math.max(columns.length, ...values.map(r=>r.length), 0)
  if (values.some(r=>r.length !== width) || (columns.length > 0 && columns.length !== width)) throw new Error('TABLE_NON_RECTANGULAR: migration requires rectangular input')
  const model: TableModel = { version:2, rowOrder:[], columnOrder:[], rows:{}, columns:{}, cells:{}, merges:[], tableStyle:{}, ...(element.props.caption === undefined ? {} : {caption:element.props.caption as string}) }
  for (let c=0;c<width;c++) { const id=`${element.id}:column:${c}`; model.columnOrder.push(id); model.columns[id]={id,...(columns[c] === undefined ? {} : {label:columns[c]})} }
  values.forEach((row,r)=>{ const id=`${element.id}:row:${r}`; model.rowOrder.push(id); model.rows[id]={id}; row.forEach((value,c)=>{const cellId=`${element.id}:cell:${r}:${c}`;model.cells[cellId]={id:cellId,rowId:id,columnId:model.columnOrder[c],value}}) })
  assertTableModel(model)
  return {model,report:{elementId:element.id,from:'1.0.0',to:'2.0.0',cellIds:Object.keys(model.cells)}}
}

export function applyTableEdit(input: TableModel, operation: Extract<Operation,{kind: `table.${string}`}>) : TableModel {
  assertTableModel(input)
  const m = structuredClone(input)
  const cell = (id:string) => {const c=m.cells[id]; if(!c)throw new Error('TABLE_CELL_MISSING');return c}
  switch(operation.kind) {
    case 'table.setCellValue': {const c=cell(operation.cellId);c.value=operation.value;delete c.richText;delete c.displayFormat;if(operation.richText !== undefined)c.richText=structuredClone(operation.richText);if(operation.displayFormat !== undefined)c.displayFormat=operation.displayFormat;break}
    case 'table.setCellStyle': cell(operation.cellId).style=structuredClone(operation.style);break
    case 'table.mergeCells': m.merges.push(structuredClone(operation.merge));break
    case 'table.splitCell': {if(!m.merges.some(x=>x.anchorCellId===operation.cellId))throw new Error('TABLE_MERGE_MISSING');m.merges=m.merges.filter(x=>x.anchorCellId!==operation.cellId);break}
    case 'table.insertRows': case 'table.insertColumns': {
      const rows=operation.kind==='table.insertRows', order=rows?m.rowOrder:m.columnOrder, map=rows?m.rows:m.columns
      if(!Number.isInteger(operation.index)||operation.index<0||operation.index>order.length||!operation.items.length)throw new Error('TABLE_INDEX_INVALID')
      for(const item of operation.items){if(map[item.id])throw new Error('TABLE_ID_CONFLICT');map[item.id]=structuredClone(item)}
      order.splice(operation.index,0,...operation.items.map(x=>x.id))
      for(const c of operation.cells){if(m.cells[c.id])throw new Error('TABLE_ID_CONFLICT');m.cells[c.id]=structuredClone(c)}
      break
    }
    case 'table.deleteRows': case 'table.deleteColumns': {
      const rows=operation.kind==='table.deleteRows', order=rows?m.rowOrder:m.columnOrder,map=rows?m.rows:m.columns
      if(!operation.ids.length||new Set(operation.ids).size!==operation.ids.length||operation.ids.some(id=>!order.includes(id)))throw new Error('TABLE_AXIS_MISSING')
      for(const id of operation.ids){order.splice(order.indexOf(id),1);delete map[id]}
      for(const c of Object.values(m.cells))if(operation.ids.includes(rows?c.rowId:c.columnId))delete m.cells[c.id]
      // Structural edits through merged ranges require an explicit split first.
      break
    }
    case 'table.moveRows': case 'table.moveColumns': {
      const order=operation.kind==='table.moveRows'?m.rowOrder:m.columnOrder
      if(!operation.ids.length||new Set(operation.ids).size!==operation.ids.length||operation.ids.some(id=>!order.includes(id)))throw new Error('TABLE_AXIS_MISSING')
      const rest=order.filter(id=>!operation.ids.includes(id))
      if(!Number.isInteger(operation.index)||operation.index<0||operation.index>rest.length)throw new Error('TABLE_INDEX_INVALID')
      rest.splice(operation.index,0,...operation.ids);order.splice(0,order.length,...rest);break
    }
    case 'table.resizeRows': case 'table.resizeColumns': {
      const map=operation.kind==='table.resizeRows'?m.rows:m.columns
      for(const [id,size] of Object.entries(operation.sizes)){if(!map[id])throw new Error('TABLE_AXIS_MISSING');map[id].size=size}break
    }
    default: throw new Error('TABLE_OPERATION_INVALID')
  }
  assertTableModel(m)
  return m
}
export function tableProps(model: TableModel): Record<string,JsonValue> {return model as unknown as Record<string,JsonValue>}

/** Includes covered cells: merging never severs semantic references. */
export function removedTableReferences(before: ComponentElement, after?: ComponentElement): string[] {
  if(before.componentType!=='core/table'||before.componentVersion!=='2.0.0')return []
  assertTableModel(before.props)
  const next=after?.componentType==='core/table'&&after.componentVersion==='2.0.0'?after.props as unknown as TableModel:undefined
  return Object.values(before.props.cells).filter(c=> (c.factIds??[]).some(id=>!next?.cells[c.id]?.factIds?.includes(id)) || (c.sourceIds??[]).some(id=>!next?.cells[c.id]?.sourceIds?.includes(id))).map(c=>c.id).sort()
}

/** UI/Agent planner returns an Operation Engine transaction and a concrete impact list. */
export function planTableOperation(document: import('../../schema/src/index.js').PpteDocument, operation: Extract<Operation,{kind:`table.${string}`}>, options: {transactionId:string; baseRevision:string; createdAt:string}) {
  const element=document.slides[operation.slideId]?.elements[operation.elementId]
  if(element?.type!=='component'||element.componentType!=='core/table')throw new Error('TABLE_MISSING')
  let after=structuredClone(element)
  if(operation.kind==='table.migrate'){after.props=tableProps(migrateTableV1(element).model);after.componentVersion='2.0.0'}
  else if(operation.kind==='table.restore'){after.props=structuredClone(operation.props);after.componentVersion=operation.componentVersion}
  else {assertTableModel(element.props);after.props=tableProps(applyTableEdit(element.props,operation))}
  assertTableComponent(after)
  const removedCellReferences=removedTableReferences(element,after)
  const transaction: import('../../schema/src/index.js').Transaction = {
    ...options, actor:{type:'human'},
    scope:{kind:'selection',slideIds:[operation.slideId],elementIds:[operation.elementId],permissions:['content']},
    changeContract:{allowedOperationKinds:[operation.kind],allowedElementIds:[operation.elementId],maxChangedSlides:1,maxChangedElements:1,requireConfirmation:removedCellReferences.length>0,userIntentSummary:removedCellReferences.length?`Review removed cell references: ${removedCellReferences.join(', ')}`:'Edit selected table.'},
    operations:[operation],
  }
  return {transaction,removedCellReferences}
}
