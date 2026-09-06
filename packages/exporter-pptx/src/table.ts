import { assertTableModel, tableCellDisplay, type TableModel, type TableCell } from '../../schema/src/table.js'
import type { ComponentElement } from '../../schema/src/index.js'

export const TABLE_URI = 'http://schemas.openxmlformats.org/drawingml/2006/table'
export const TABLE_ADAPTER = 'drawingml-table-v1' as const
export interface NativeTablePlan {
  model: TableModel
  widths: number[]
  heights: number[]
  rows: Array<Array<{ text: string; cell?: TableCell; attrs: string; style: Record<string, unknown> }>>
  degradations: string[]
}
const xml = (s: string) => {
  if (/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/u.test(s)) throw new Error('TABLE_XML_CHARACTER_INVALID')
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;').replaceAll('\r', '&#13;')
}
const color = (v: unknown): v is string => typeof v === 'string' && /^#[\da-f]{6}$/i.test(v)
const styles: Record<string, (v: unknown) => boolean> = {
  fill: color, color, bold: v => typeof v === 'boolean', italic: v => typeof v === 'boolean',
  fontSize: v => typeof v === 'number' && v >= 4/3 && v <= 400,
  align: v => ['left', 'center', 'right'].includes(String(v)),
  verticalAlign: v => ['top', 'middle', 'bottom'].includes(String(v)),
}
// Axis sizes are relative weights within the element frame, matching the table SVG renderer.
// Cumulative rounding preserves the exact frame extent at fractional canvas sizes.
function sizes(weights: number[], extent: number): number[] {
  const total = weights.reduce((a, b) => a + b, 0)
  if (!Number.isFinite(total) || !Number.isSafeInteger(Math.round(extent * 9525))) throw new Error('TABLE_DIMENSION_UNREPRESENTABLE')
  let position = 0, previous = 0
  return weights.map(weight => { position += weight; const end = Math.round(position / total * extent * 9525); const size = end - previous; previous = end; if (size < 1) throw new Error('TABLE_DIMENSION_UNREPRESENTABLE'); return size })
}
export function planNativeTable(element: ComponentElement): NativeTablePlan | undefined {
  if (element.componentType !== 'core/table' || element.componentVersion !== '2.0.0') return undefined
  assertTableModel(element.props)
  const model = structuredClone(element.props), degradations: string[] = []
  if (!model.columnOrder.length || !model.rowOrder.length) return undefined
  if (model.columnOrder.length > 1000) throw new Error('TABLE_COLUMN_LIMIT: Office allows at most 1000 columns')
  const cleanStyle = (value: Record<string, unknown>, path: string) => Object.fromEntries(Object.entries(value).filter(([key, v]) => {
    if (styles[key]?.(v)) return true
    degradations.push(`${path}.${key}`); return false
  }))
  const base = cleanStyle(model.tableStyle, 'props.tableStyle')
  const cells = new Map(Object.values(model.cells).map(cell => [JSON.stringify([cell.rowId, cell.columnId]), cell]))
  const rows: NativeTablePlan['rows'] = []
  const weights: number[] = []
  if (model.caption) {
    degradations.push('props.caption: placed in an additional editable first row')
    rows.push(model.columnOrder.map((_, i) => ({ text: i === 0 ? model.caption! : '', attrs: i === 0 ? (model.columnOrder.length > 1 ? ` gridSpan="${model.columnOrder.length}"` : '') : ' hMerge="1"', style: base })))
    weights.push(32)
  }
  if (model.columnOrder.some(id => model.columns[id].label !== undefined)) {
    rows.push(model.columnOrder.map(id => ({ text: model.columns[id].label ?? '', attrs: '', style: { ...base, bold: true, fill: '#e2e8f0' } })))
    weights.push(32)
  }
  for (const rowId of model.rowOrder) {
    weights.push(model.rows[rowId].size ?? 32)
    rows.push(model.columnOrder.map(columnId => {
      const cell = cells.get(JSON.stringify([rowId, columnId]))!
      const merge = model.merges.find(m => m.rowIds.includes(rowId) && m.columnIds.includes(columnId))
      let attrs = '', covered = false
      if (merge) {
        const top = rowId === merge.rowIds[0], left = columnId === merge.columnIds[0]
        covered = !top || !left
        if (left && merge.columnIds.length > 1) attrs += ` gridSpan="${merge.columnIds.length}"`
        if (top && merge.rowIds.length > 1) attrs += ` rowSpan="${merge.rowIds.length}"`
        if (!left) attrs += ' hMerge="1"'
        if (!top) attrs += ' vMerge="1"'
      }
      if (cell.richText) degradations.push(`props.cells.${cell.id}.richText: flattened to editable text`)
      return { text: covered ? '' : tableCellDisplay(cell), cell, attrs, style: { ...base, ...cleanStyle(cell.style ?? {}, `props.cells.${cell.id}.style`) } }
    }))
  }
  for (const key of ['rotationDeg', 'flipX', 'flipY', 'opacity'] as const) if (element[key] !== undefined && element[key] !== (key === 'opacity' ? 1 : key === 'rotationDeg' ? 0 : false)) degradations.push(key)
  return { model, rows, widths: sizes(model.columnOrder.map(id => model.columns[id].size ?? 120), element.frame.width), heights: sizes(weights, element.frame.height), degradations }
}

export function nativeTableXml(plan: NativeTablePlan, elementId: string, numericId: number, frame: ComponentElement['frame']): string {
  const rows = plan.rows.map((row, r) => `<a:tr h="${plan.heights[r]}">${row.map(cell => {
    const s = cell.style, fill = color(s.fill) ? s.fill.slice(1) : 'ffffff', ink = color(s.color) ? s.color.slice(1) : '1e293b'
    const align = s.align === 'center' ? 'ctr' : s.align === 'right' ? 'r' : 'l'
    const anchor = s.verticalAlign === 'top' ? 't' : s.verticalAlign === 'bottom' ? 'b' : 'ctr'
    const paragraphs = cell.text.split('\n').map(line => `<a:p><a:pPr algn="${align}"/><a:r><a:rPr sz="${Math.round(Number(s.fontSize ?? 18) * 75)}"${s.bold ? ' b="1"' : ''}${s.italic ? ' i="1"' : ''}><a:solidFill><a:srgbClr val="${ink}"/></a:solidFill></a:rPr><a:t>${xml(line)}</a:t></a:r></a:p>`).join('')
    const borders = ['L', 'R', 'T', 'B'].map(side => `<a:ln${side} w="9525"><a:solidFill><a:srgbClr val="94a3b8"/></a:solidFill><a:prstDash val="solid"/></a:ln${side}>`).join('')
    return `<a:tc${cell.attrs}><a:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</a:txBody><a:tcPr marL="57150" marR="57150" marT="0" marB="0" anchor="${anchor}">${borders}<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></a:tcPr></a:tc>`
  }).join('')}</a:tr>`).join('')
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${numericId}" name="${xml(elementId)}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${Math.round(frame.x * 9525)}" y="${Math.round(frame.y * 9525)}"/><a:ext cx="${plan.widths.reduce((a,b)=>a+b,0)}" cy="${plan.heights.reduce((a,b)=>a+b,0)}"/></p:xfrm><a:graphic><a:graphicData uri="${TABLE_URI}"><a:tbl><a:tblPr/><a:tblGrid>${plan.widths.map(w=>`<a:gridCol w="${w}"/>`).join('')}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
}

/** Checks the actual adapter output, never a widget exportPolicy or a capability declaration.
 * This is a verifier for our emitted OOXML subset, not a general Office compatibility validator.
 */
export function verifyNativeTableXml(slideXml: string, element: ComponentElement): boolean {
  const plan = planNativeTable(element)
  if (!plan) return false
  const frames = [...slideXml.matchAll(/<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/g)].map(m => m[0]).filter(s => s.includes(`name="${xml(element.id)}"`))
  if (frames.length !== 1) return false
  const frame = frames[0]
  if (!frame.includes(`uri="${TABLE_URI}"`) || !frame.includes('<a:tbl>') || frame.includes('<a:blip')) return false
  const widths = [...frame.matchAll(/<a:gridCol w="(\d+)"\/>/g)].map(m => Number(m[1]))
  const rows = [...frame.matchAll(/<a:tr h="(\d+)">([\s\S]*?)<\/a:tr>/g)]
  if (JSON.stringify(widths) !== JSON.stringify(plan.widths) || rows.length !== plan.rows.length) return false
  if (!frame.includes(`<a:off x="${Math.round(element.frame.x*9525)}" y="${Math.round(element.frame.y*9525)}"/>`) || !frame.includes(`<a:ext cx="${plan.widths.reduce((a,b)=>a+b,0)}" cy="${plan.heights.reduce((a,b)=>a+b,0)}"/>`)) return false
  return rows.every((row,r) => {
    const cells = [...row[2].matchAll(/<a:tc([^>]*)>([\s\S]*?)<\/a:tc>/g)]
    return Number(row[1]) === plan.heights[r] && cells.length === plan.widths.length && cells.every((cell,c) => {
      const expected = plan.rows[r][c]
      const paragraphs = [...cell[2].matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map(p => [...p[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(t=>t[1]).join(''))
      const s = expected.style
      const fill = color(s.fill) ? s.fill.slice(1) : 'ffffff', ink = color(s.color) ? s.color.slice(1) : '1e293b'
      const anchor = s.verticalAlign === 'top' ? 't' : s.verticalAlign === 'bottom' ? 'b' : 'ctr'
      const align = s.align === 'center' ? 'ctr' : s.align === 'right' ? 'r' : 'l'
      const runProperties = `<a:rPr sz="${Math.round(Number(s.fontSize ?? 18)*75)}"${s.bold ? ' b="1"' : ''}${s.italic ? ' i="1"' : ''}><a:solidFill><a:srgbClr val="${ink}"/></a:solidFill></a:rPr>`
      const tcPr = cell[2].match(/<a:tcPr[^>]*>[\s\S]*?<\/a:tcPr>/)?.[0] ?? ''
      if (!tcPr.includes(`anchor="${anchor}"`) || !tcPr.endsWith(`<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></a:tcPr>`)) return false
      const runProps = [...cell[2].matchAll(/<a:rPr[^>]*>[\s\S]*?<\/a:rPr>/g)]
      if (runProps.length !== expected.text.split('\n').length || runProps.some(r=>r[0] !== runProperties)) return false
      const aligns = [...cell[2].matchAll(/<a:pPr algn="([^"]+)"\/>/g)]
      if (aligns.length !== runProps.length || aligns.some(a=>a[1] !== align)) return false
      return cell[1] === expected.attrs && cell[2].includes('<a:txBody>') && paragraphs.join('\n') === xml(expected.text)
    })
  })
}
