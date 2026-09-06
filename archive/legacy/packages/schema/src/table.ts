import { validTextMarks } from './validation.js'
import type { JsonValue, RichTextDocument } from './index.js'

export type TableScalar = string | number | boolean | null
export interface TableAxis { id: string; size?: number; label?: string }
export interface TableCell {
  id: string
  rowId: string
  columnId: string
  value: TableScalar
  displayFormat?: 'general' | 'percent' | 'fixed:2'
  richText?: RichTextDocument
  style?: Record<string, JsonValue>
  factIds?: string[]
  sourceIds?: string[]
}
export interface TableMerge { anchorCellId: string; rowIds: string[]; columnIds: string[] }
export interface TableModel {
  version: 2
  rowOrder: string[]
  columnOrder: string[]
  rows: Record<string, TableAxis>
  columns: Record<string, TableAxis>
  cells: Record<string, TableCell>
  merges: TableMerge[]
  tableStyle: Record<string, JsonValue>
  caption?: string
}

export const TABLE_OPERATION_KINDS = ['table.migrate', 'table.restore', 'table.setCellValue', 'table.insertRows', 'table.deleteRows', 'table.moveRows', 'table.insertColumns', 'table.deleteColumns', 'table.moveColumns', 'table.resizeRows', 'table.resizeColumns', 'table.mergeCells', 'table.splitCell', 'table.setCellStyle'] as const
export function tableCellDisplay(cell: TableCell): string {
  if (cell.value === null) return ''
  if (cell.displayFormat === 'percent') return `${Number(cell.value) * 100}%`
  if (cell.displayFormat === 'fixed:2') return Number(cell.value).toFixed(2)
  return String(cell.value)
}
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string' && x.length > 0 && !['__proto__','constructor','prototype'].includes(x)) && new Set(v).size === v.length
function keys(v: Record<string, any>, allowed: string[]) { if (Object.keys(v).some(k => !allowed.includes(k))) throw new Error('TABLE_INVALID: unknown field') }
export function assertTableModel(value: unknown): asserts value is TableModel {
  const fail = () => { throw new Error('TABLE_INVALID: inconsistent table model') }
  if (!record(value) || !jsonValue(value)) return fail()
  keys(value, ['version','rowOrder','columnOrder','rows','columns','cells','merges','tableStyle','caption'])
  if (value.version !== 2 || !ids(value.rowOrder) || !ids(value.columnOrder) || !record(value.rows) || !record(value.columns) || !record(value.cells) || !record(value.tableStyle) || !Array.isArray(value.merges) || (value.caption !== undefined && typeof value.caption !== 'string')) return fail()
  for (const [order, map] of [[value.rowOrder,value.rows],[value.columnOrder,value.columns]] as [string[],Record<string,any>][]) {
    if (Object.keys(map).length !== order.length) return fail()
    for (const id of order) {
      const item = map[id]
      if (!record(item) || item.id !== id || (item.size !== undefined && (typeof item.size !== 'number' || !Number.isFinite(item.size) || item.size <= 0)) || (item.label !== undefined && typeof item.label !== 'string')) return fail()
      keys(item,['id','size','label'])
    }
  }
  const pairs = new Set<string>(), allIds = [...value.rowOrder,...value.columnOrder,...Object.keys(value.cells)]
  if (!ids(allIds)) return fail()
  for (const [id, c] of Object.entries(value.cells) as [string,any][]) {
    if (!record(c) || c.id !== id || !value.rowOrder.includes(c.rowId) || !value.columnOrder.includes(c.columnId)) return fail()
    keys(c,['id','rowId','columnId','value','displayFormat','richText','style','factIds','sourceIds'])
    if (!(c.value === null || ['string','boolean'].includes(typeof c.value) || (typeof c.value === 'number' && Number.isFinite(c.value)))) return fail()
    if (c.displayFormat !== undefined && (!['general','percent','fixed:2'].includes(c.displayFormat) || (c.displayFormat !== 'general' && typeof c.value !== 'number'))) return fail()
    if ((c.style !== undefined && !record(c.style)) || (c.factIds !== undefined && !ids(c.factIds)) || (c.sourceIds !== undefined && !ids(c.sourceIds))) return fail()
    if (c.richText !== undefined) {
      if (typeof c.value !== 'string' || !record(c.richText) || !Array.isArray(c.richText.paragraphs) || c.richText.paragraphs.some((p:any) => !record(p) || typeof p.id !== 'string' || !Array.isArray(p.runs) || p.runs.some((r:any) => !record(r) || typeof r.id !== 'string' || typeof r.text !== 'string'))) return fail()
      if (!ids(c.richText.paragraphs.map((p:any)=>p.id))) return fail()
      for (const p of c.richText.paragraphs) {
        if (!ids(p.runs.map((r:any)=>r.id))) return fail()
        for (const r of p.runs) {
          keys(r,['id','text','marks'])
          if (r.text.includes('\u0000') || (r.marks !== undefined && !validTextMarks(r.marks))) return fail()
        }
      }
      if (c.richText.paragraphs.map((p:any) => p.runs.map((r:any)=>r.text).join('')).join('\n') !== c.value) return fail()
    }
    const pair = JSON.stringify([c.rowId,c.columnId]); if (pairs.has(pair)) return fail(); pairs.add(pair)
  }
  if (pairs.size !== value.rowOrder.length * value.columnOrder.length) return fail()
  const covered = new Set<string>()
  for (const merge of value.merges) {
    if (!record(merge)) return fail()
    keys(merge,['anchorCellId','rowIds','columnIds'])
    if (!ids(merge.rowIds) || !ids(merge.columnIds) || merge.rowIds.length * merge.columnIds.length < 2) return fail()
    for (const [range,order] of [[merge.rowIds,value.rowOrder],[merge.columnIds,value.columnOrder]] as [string[],string[]][]) {
      const start = order.indexOf(range[0]); if (start < 0 || range.some((id,i)=>order[start+i] !== id)) return fail()
    }
    const anchor = value.cells[merge.anchorCellId]
    if (!anchor || anchor.rowId !== merge.rowIds[0] || anchor.columnId !== merge.columnIds[0]) return fail()
    for (const r of merge.rowIds) for (const c of merge.columnIds) { const pair=JSON.stringify([r,c]); if (covered.has(pair)) return fail(); covered.add(pair) }
  }
}

/** Same validator at insert, update, restore, and persistence boundaries. */
export function assertTableComponent(element: {componentType: string; componentVersion: string; props: Record<string, unknown>}): void {
  if (element.componentType !== 'core/table') return
  if (element.componentVersion === '2.0.0') { assertTableModel(element.props); return }
  if (element.componentVersion !== '1.0.0' || element.props.version !== undefined) throw new Error('TABLE_VERSION_UNSUPPORTED: explicit migration required')
  const {columns, rows, caption} = element.props
  if ((columns === undefined && rows === undefined) || (caption !== undefined && typeof caption !== 'string') || (columns !== undefined && (!Array.isArray(columns) || columns.some(x=>typeof x !== 'string'))) || (rows !== undefined && (!Array.isArray(rows) || rows.some(r=>!Array.isArray(r) || r.some(x=> !(x === null || typeof x === 'string' || typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x)))))))) throw new Error('TABLE_INVALID: invalid v1 props')
}

function jsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(jsonValue)
  return record(value) && Object.getPrototypeOf(value) === Object.prototype && Object.entries(value).every(([k,v])=>!['__proto__','constructor','prototype'].includes(k)&&jsonValue(v))
}
