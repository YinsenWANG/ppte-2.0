import type { ChartData, ChartElement, ChartEncoding, ChartOptions, Fact } from '../../schema/src/index.js'

export const GA_B_CHART_TYPES = ['bar', 'line', 'pie'] as const
export type GaBChartType = typeof GA_B_CHART_TYPES[number]
export const GA_C_CHART_TYPES = ['bar', 'line', 'area', 'pie', 'donut'] as const
export type GaCChartType = typeof GA_C_CHART_TYPES[number]

export interface ChartValidationIssue {
  code: 'SCHEMA_INVALID' | 'CHART_TYPE_UNSUPPORTED'
  message: string
  path?: string
}

export interface ChartFactSyncResult {
  data: ChartData
  changed: boolean
  changedCellCount: number
}

export interface ChartSvgOptions {
  width?: number
  height?: number
  palette?: string[]
  axisColor?: string
  labelColor?: string
  gridColor?: string
  lineWidth?: number
  cornerRadius?: number
  runtimeProfile?: 'ga-b' | 'ga-c'
}

/** Validate the chart contract without depending on the runtime or renderer. */
export function validateChartContract(element: ChartElement, options: { runtimeSubset?: boolean; runtimeProfile?: 'ga-b' | 'ga-c' } = {}): ChartValidationIssue[] {
  const issues: ChartValidationIssue[] = []
  const runtimeProfile = options.runtimeProfile ?? (options.runtimeSubset ? 'ga-b' : 'ga-c')
  const supported = runtimeProfile === 'ga-c' ? GA_C_CHART_TYPES : GA_B_CHART_TYPES
  if (!supported.includes(element.chartType as never)) {
    if (options.runtimeSubset) issues.push({ code: 'CHART_TYPE_UNSUPPORTED', message: runtimeProfile === 'ga-b' ? `GA-B supports Bar, Line, and Pie charts; received ${element.chartType}.` : `GA-C runtime does not support ${element.chartType} charts; received ${element.chartType}.`, path: '/chartType' })
    else if (!['bar', 'line', 'area', 'pie', 'donut'].includes(element.chartType)) issues.push({ code: 'SCHEMA_INVALID', message: `Unknown chart type ${element.chartType}.`, path: '/chartType' })
  }
  issues.push(...validateChartData(element.data, element.encoding))
  if (!element.style || typeof element.style.styleRef !== 'string' || !element.style.styleRef) issues.push({ code: 'SCHEMA_INVALID', message: 'Chart requires a valid style binding.', path: '/style' })
  if (element.options) issues.push(...validateChartOptions(element.options))
  return uniqueIssues(issues)
}

export function validateChartData(data: ChartData, encoding: ChartEncoding): ChartValidationIssue[] {
  const issues: ChartValidationIssue[] = []
  if (!data || !Array.isArray(data.columns) || !Array.isArray(data.rows)) return [{ code: 'SCHEMA_INVALID', message: 'Chart data requires columns and rows.', path: '/data' }]
  if (data.columns.length < 2) issues.push({ code: 'SCHEMA_INVALID', message: 'Chart data requires a category column and at least one value column.', path: '/data/columns' })
  const columnIds = new Set<string>()
  for (const [index, column] of data.columns.entries()) {
    if (!column || typeof column.id !== 'string' || !column.id || typeof column.label !== 'string' || !['string', 'number', 'date'].includes(column.type)) {
      issues.push({ code: 'SCHEMA_INVALID', message: 'Chart columns require unique id, label, and type.', path: `/data/columns/${index}` })
      continue
    }
    if (columnIds.has(column.id)) issues.push({ code: 'SCHEMA_INVALID', message: `Chart column id is duplicated: ${column.id}.`, path: `/data/columns/${index}/id` })
    columnIds.add(column.id)
  }
  const rowIds = new Set<string>()
  for (const [index, row] of data.rows.entries()) {
    if (!row || typeof row.id !== 'string' || !row.id || !row.values || typeof row.values !== 'object' || Array.isArray(row.values)) {
      issues.push({ code: 'SCHEMA_INVALID', message: 'Chart rows require unique id and values.', path: `/data/rows/${index}` })
      continue
    }
    if (rowIds.has(row.id)) issues.push({ code: 'SCHEMA_INVALID', message: `Chart row id is duplicated: ${row.id}.`, path: `/data/rows/${index}/id` })
    rowIds.add(row.id)
    for (const [columnId, value] of Object.entries(row.values)) {
      if (!columnIds.has(columnId)) issues.push({ code: 'SCHEMA_INVALID', message: `Chart row references unknown column ${columnId}.`, path: `/data/rows/${index}/values/${escapePointer(columnId)}` })
      if (value !== null && typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) issues.push({ code: 'SCHEMA_INVALID', message: `Chart cell ${columnId} must be a string, finite number, or null.`, path: `/data/rows/${index}/values/${escapePointer(columnId)}` })
    }
    for (const column of data.columns) {
      const value = row.values[column.id]
      if (value === undefined || value === null) continue
      if (column.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) issues.push({ code: 'SCHEMA_INVALID', message: `Chart numeric column ${column.id} contains a non-numeric value.`, path: `/data/rows/${index}/values/${escapePointer(column.id)}` })
      if ((column.type === 'string' || column.type === 'date') && typeof value !== 'string') issues.push({ code: 'SCHEMA_INVALID', message: `Chart ${column.type} column ${column.id} contains a non-string value.`, path: `/data/rows/${index}/values/${escapePointer(column.id)}` })
    }
  }
  if (!encoding || typeof encoding !== 'object') return [...issues, { code: 'SCHEMA_INVALID', message: 'Chart encoding is required.', path: '/encoding' }]
  if (typeof encoding.categoryField !== 'string' || !columnIds.has(encoding.categoryField)) issues.push({ code: 'SCHEMA_INVALID', message: 'Chart categoryField must reference a known column.', path: '/encoding/categoryField' })
  if (!Array.isArray(encoding.valueFields) || encoding.valueFields.length === 0) issues.push({ code: 'SCHEMA_INVALID', message: 'Chart valueFields must contain at least one field.', path: '/encoding/valueFields' })
  const valueFields = Array.isArray(encoding.valueFields) ? encoding.valueFields : []
  if (new Set(valueFields).size !== valueFields.length) issues.push({ code: 'SCHEMA_INVALID', message: 'Chart valueFields must be unique.', path: '/encoding/valueFields' })
  for (const [index, field] of valueFields.entries()) {
    const column = data.columns.find((candidate) => candidate.id === field)
    if (!column || column.type !== 'number') issues.push({ code: 'SCHEMA_INVALID', message: `Chart valueField ${field} must reference a numeric column.`, path: `/encoding/valueFields/${index}` })
  }
  for (const field of ['seriesField', 'labelField'] as const) if (encoding[field] !== undefined && (!columnIds.has(encoding[field]) || (field === 'seriesField' && data.columns.find((column) => column.id === encoding[field])?.type === 'number'))) issues.push({ code: 'SCHEMA_INVALID', message: `Chart ${field} must reference a compatible column.`, path: `/encoding/${field}` })
  return issues
}

export function validateChartOptions(options: ChartOptions): ChartValidationIssue[] {
  const issues: ChartValidationIssue[] = []
  if (options.orientation !== undefined && !['vertical', 'horizontal'].includes(options.orientation)) issues.push({ code: 'SCHEMA_INVALID', message: 'Chart orientation is invalid.', path: '/options/orientation' })
  for (const field of ['stacked', 'showLegend', 'showLabels', 'showXAxis', 'showYAxis', 'showGrid'] as const) if (options[field] !== undefined && typeof options[field] !== 'boolean') issues.push({ code: 'SCHEMA_INVALID', message: `Chart option ${field} must be boolean.`, path: `/options/${field}` })
  if (options.sort !== undefined && !['none', 'ascending', 'descending'].includes(options.sort)) issues.push({ code: 'SCHEMA_INVALID', message: 'Chart sort option is invalid.', path: '/options/sort' })
  return issues
}

/** Apply an explicit Fact value to only the chart cells that can be identified safely. */
export function syncChartFact(element: ChartElement, fact: Fact, previousValue?: Fact['value']): ChartFactSyncResult {
  const data = structuredClone(element.data) as ChartData
  const valueFields = new Set(element.encoding.valueFields)
  const keys = new Set([fact.id, fact.key])
  const previous = numericValue(previousValue)
  const next = numericValue(fact.value)
  if (next === undefined) return { data, changed: false, changedCellCount: 0 }
  let changedCellCount = 0
  const update = (row: { values: Record<string, string | number | null> }, columnId: string) => {
    const current = row.values[columnId]
    if (typeof current !== 'number' || !Number.isFinite(current)) return
    if (previous !== undefined && Math.abs(current - previous) > 0.000001) return
    if (current !== next) { row.values[columnId] = next; changedCellCount += 1 }
  }
  for (const row of data.rows) {
    if (keys.has(row.id)) for (const field of valueFields) update(row, field)
    for (const field of valueFields) if (keys.has(field)) update(row, field)
  }
  if (changedCellCount === 0) {
    const numericCells = data.rows.flatMap((row) => [...valueFields].filter((field) => typeof row.values[field] === 'number').map((field) => ({ row, field })))
    if (numericCells.length === 1) update(numericCells[0]!.row, numericCells[0]!.field)
  }
  return { data, changed: changedCellCount > 0, changedCellCount }
}

/** Deterministic SVG renderer used by the reference HTML renderer and image exports. */
export function renderChartSvg(element: ChartElement, options: ChartSvgOptions = {}): string {
  const runtimeProfile = options.runtimeProfile ?? 'ga-b'
  const supported = runtimeProfile === 'ga-c' ? GA_C_CHART_TYPES : GA_B_CHART_TYPES
  if (!supported.includes(element.chartType as never)) throw new Error(`CHART_TYPE_UNSUPPORTED: ${element.chartType}`)
  const width = finitePositive(options.width) ? options.width! : 640
  const height = finitePositive(options.height) ? options.height! : 360
  const palette = options.palette?.length ? options.palette : ['#2563eb', '#14b8a6', '#f97316', '#8b5cf6', '#e11d48', '#0891b2']
  const axisColor = options.axisColor ?? '#64748b'
  const labelColor = options.labelColor ?? '#334155'
  const gridColor = options.gridColor ?? '#cbd5e1'
  const lineWidth = finitePositive(options.lineWidth) ? options.lineWidth! : 2
  const cornerRadius = finiteNonNegative(options.cornerRadius) ? options.cornerRadius! : 3
  const margin = { left: 52, right: element.options?.showLegend === false ? 18 : 96, top: element.options?.showLegend === false ? 18 : 38, bottom: 42 }
  const plotWidth = Math.max(1, width - margin.left - margin.right)
  const plotHeight = Math.max(1, height - margin.top - margin.bottom)
  const categories = element.data.rows.map((row) => String(row.values[element.encoding.categoryField] ?? row.id))
  const valueFields = element.encoding.valueFields
  const values = element.data.rows.flatMap((row) => valueFields.map((field) => numericValue(row.values[field]) ?? 0))
  const maxValue = Math.max(1, ...values.map((value) => Math.abs(value)))
  const minValue = Math.min(0, ...values)
  const range = Math.max(1, maxValue - minValue)
  const parts: string[] = []
  const optionsForChart = element.options ?? {}
  parts.push(`<rect x="0" y="0" width="${num(width)}" height="${num(height)}" fill="transparent"/>`)
  if (optionsForChart.showGrid !== false) for (let index = 0; index <= 4; index += 1) {
    const y = margin.top + plotHeight * index / 4
    parts.push(`<line x1="${num(margin.left)}" y1="${num(y)}" x2="${num(margin.left + plotWidth)}" y2="${num(y)}" stroke="${esc(gridColor)}" stroke-width="1" stroke-dasharray="2 3"/>`)
  }
  if (element.chartType === 'bar') parts.push(...renderBars(element, categories, margin, plotWidth, plotHeight, minValue, range, palette, cornerRadius, labelColor))
  else if (element.chartType === 'line') parts.push(...renderLines(element, categories, margin, plotWidth, plotHeight, minValue, range, palette, lineWidth, labelColor))
  else if (element.chartType === 'area') parts.push(...renderAreas(element, categories, margin, plotWidth, plotHeight, minValue, range, palette, lineWidth, labelColor))
  else if (element.chartType === 'donut') parts.push(...renderDonut(element, margin, plotWidth, plotHeight, palette, labelColor))
  else parts.push(...renderPie(element, margin, plotWidth, plotHeight, palette, labelColor))
  if (optionsForChart.showXAxis !== false && element.chartType !== 'pie' && element.chartType !== 'donut') parts.push(`<line x1="${num(margin.left)}" y1="${num(margin.top + plotHeight)}" x2="${num(margin.left + plotWidth)}" y2="${num(margin.top + plotHeight)}" stroke="${esc(axisColor)}" stroke-width="1"/>`)
  if (optionsForChart.showYAxis !== false && element.chartType !== 'pie' && element.chartType !== 'donut') parts.push(`<line x1="${num(margin.left)}" y1="${num(margin.top)}" x2="${num(margin.left)}" y2="${num(margin.top + plotHeight)}" stroke="${esc(axisColor)}" stroke-width="1"/>`)
  if (optionsForChart.showLegend !== false && valueFields.length > 0) valueFields.forEach((field, index) => {
    const x = width - margin.right + 12
    const y = margin.top + index * 20
    parts.push(`<rect x="${num(x)}" y="${num(y)}" width="10" height="10" rx="2" fill="${esc(palette[index % palette.length]!)}"/><text x="${num(x + 16)}" y="${num(y + 9)}" fill="${esc(labelColor)}" font-size="11">${esc(columnLabel(element, field))}</text>`)
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(width)} ${num(height)}" role="img" aria-label="${esc(element.altText ?? 'Chart')}">${parts.join('')}</svg>`
}

function renderBars(element: ChartElement, categories: string[], margin: { left: number; top: number }, plotWidth: number, plotHeight: number, minValue: number, range: number, palette: string[], radius: number, labelColor: string): string[] {
  const parts: string[] = []
  const horizontal = element.options?.orientation === 'horizontal'
  const stacked = element.options?.stacked === true
  const groupWidth = plotWidth / Math.max(1, categories.length)
  const seriesWidth = groupWidth * 0.72 / Math.max(1, element.encoding.valueFields.length)
  element.data.rows.forEach((row, rowIndex) => {
    let stack = 0
    element.encoding.valueFields.forEach((field, seriesIndex) => {
      const value = numericValue(row.values[field]) ?? 0
      if (horizontal) {
        const x = margin.left + (value - minValue) / range * plotWidth
        const y = margin.top + rowIndex * (plotHeight / Math.max(1, categories.length)) + (stacked ? 0 : seriesIndex * seriesWidth)
        const h = stacked ? plotHeight / Math.max(1, categories.length) * 0.7 : seriesWidth * 0.8
        const w = Math.abs(value) / range * plotWidth
        parts.push(`<rect x="${num(value >= 0 ? x - w : x)}" y="${num(y)}" width="${num(Math.max(0.5, w))}" height="${num(h)}" rx="${num(radius)}" fill="${esc(palette[seriesIndex % palette.length]!)}"/>`)
      } else {
        const base = margin.top + plotHeight - (0 - minValue) / range * plotHeight
        const barHeight = Math.abs(value) / range * plotHeight
        const x = margin.left + rowIndex * groupWidth + groupWidth * 0.14 + (stacked ? 0 : seriesIndex * seriesWidth)
        const y = value >= 0 ? base - (stack + value) / range * plotHeight : base - stack / range * plotHeight
        const w = stacked ? groupWidth * 0.72 : seriesWidth * 0.8
        parts.push(`<rect x="${num(x)}" y="${num(Math.min(y, base))}" width="${num(w)}" height="${num(Math.max(0.5, barHeight))}" rx="${num(radius)}" fill="${esc(palette[seriesIndex % palette.length]!)}"/>`)
      }
      if (stacked) stack += value
      if (element.options?.showLabels) {
        const labelX = horizontal ? margin.left + Math.abs(value) / range * plotWidth + 5 : margin.left + rowIndex * groupWidth + groupWidth * 0.5
        const labelY = horizontal ? margin.top + rowIndex * (plotHeight / Math.max(1, categories.length)) + 12 : margin.top + plotHeight - Math.abs(value) / range * plotHeight - 4
        parts.push(`<text x="${num(labelX)}" y="${num(labelY)}" text-anchor="${horizontal ? 'start' : 'middle'}" fill="${esc(labelColor)}" font-size="10">${esc(String(value))}</text>`)
      }
    })
    if (element.options?.showXAxis !== false && !horizontal) parts.push(`<text x="${num(margin.left + rowIndex * groupWidth + groupWidth / 2)}" y="${num(margin.top + plotHeight + 18)}" text-anchor="middle" fill="${esc(labelColor)}" font-size="10">${esc(categories[rowIndex]!)}</text>`)
    if (element.options?.showYAxis !== false && horizontal) parts.push(`<text x="${num(margin.left - 6)}" y="${num(margin.top + rowIndex * (plotHeight / Math.max(1, categories.length)) + 12)}" text-anchor="end" fill="${esc(labelColor)}" font-size="10">${esc(categories[rowIndex]!)}</text>`)
  })
  return parts
}

function renderLines(element: ChartElement, categories: string[], margin: { left: number; top: number }, plotWidth: number, plotHeight: number, minValue: number, range: number, palette: string[], lineWidth: number, labelColor: string): string[] {
  const parts: string[] = []
  element.encoding.valueFields.forEach((field, seriesIndex) => {
    const points = element.data.rows.map((row, rowIndex) => {
      const value = numericValue(row.values[field]) ?? 0
      const x = margin.left + (element.data.rows.length <= 1 ? plotWidth / 2 : rowIndex * plotWidth / (element.data.rows.length - 1))
      const y = margin.top + plotHeight - (value - minValue) / range * plotHeight
      return { x, y, value }
    })
    parts.push(`<polyline points="${points.map((point) => `${num(point.x)},${num(point.y)}`).join(' ')}" fill="none" stroke="${esc(palette[seriesIndex % palette.length]!)}" stroke-width="${num(lineWidth)}" stroke-linejoin="round" stroke-linecap="round"/>`)
    for (const point of points) parts.push(`<circle cx="${num(point.x)}" cy="${num(point.y)}" r="${num(Math.max(2, lineWidth))}" fill="${esc(palette[seriesIndex % palette.length]!)}"/>${element.options?.showLabels ? `<text x="${num(point.x)}" y="${num(point.y - 7)}" text-anchor="middle" fill="${esc(labelColor)}" font-size="10">${esc(String(point.value))}</text>` : ''}`)
  })
  if (element.options?.showXAxis !== false) element.data.rows.forEach((_, rowIndex) => {
    const x = margin.left + (element.data.rows.length <= 1 ? plotWidth / 2 : rowIndex * plotWidth / (element.data.rows.length - 1))
    parts.push(`<text x="${num(x)}" y="${num(margin.top + plotHeight + 18)}" text-anchor="middle" fill="${esc(labelColor)}" font-size="10">${esc(categories[rowIndex]!)}</text>`)
  })
  return parts
}

function renderAreas(element: ChartElement, categories: string[], margin: { left: number; top: number }, plotWidth: number, plotHeight: number, minValue: number, range: number, palette: string[], lineWidth: number, labelColor: string): string[] {
  const parts: string[] = []
  element.encoding.valueFields.forEach((field, seriesIndex) => {
    const points = element.data.rows.map((row, rowIndex) => {
      const value = numericValue(row.values[field]) ?? 0
      const x = margin.left + (element.data.rows.length <= 1 ? plotWidth / 2 : rowIndex * plotWidth / (element.data.rows.length - 1))
      const y = margin.top + plotHeight - (value - minValue) / range * plotHeight
      return { x, y, value }
    })
    const baseline = margin.top + plotHeight - (0 - minValue) / range * plotHeight
    const first = points[0]
    const last = points[points.length - 1]
    if (first && last) {
      const areaPath = `M ${num(first.x)} ${num(baseline)} L ${points.map((point) => `${num(point.x)} ${num(point.y)}`).join(' L ')} L ${num(last.x)} ${num(baseline)} Z`
      parts.push(`<path d="${areaPath}" fill="${esc(palette[seriesIndex % palette.length]!)}" fill-opacity="0.22"/>`)
      parts.push(`<polyline points="${points.map((point) => `${num(point.x)},${num(point.y)}`).join(' ')}" fill="none" stroke="${esc(palette[seriesIndex % palette.length]!)}" stroke-width="${num(lineWidth)}" stroke-linejoin="round" stroke-linecap="round"/>`)
      for (const point of points) parts.push(`<circle cx="${num(point.x)}" cy="${num(point.y)}" r="${num(Math.max(2, lineWidth))}" fill="${esc(palette[seriesIndex % palette.length]!)}"${element.options?.showLabels ? `/><text x="${num(point.x)}" y="${num(point.y - 7)}" text-anchor="middle" fill="${esc(labelColor)}" font-size="10">${esc(String(point.value))}</text>` : '/>'}`)
    }
  })
  if (element.options?.showXAxis !== false) element.data.rows.forEach((_, rowIndex) => {
    const x = margin.left + (element.data.rows.length <= 1 ? plotWidth / 2 : rowIndex * plotWidth / (element.data.rows.length - 1))
    parts.push(`<text x="${num(x)}" y="${num(margin.top + plotHeight + 18)}" text-anchor="middle" fill="${esc(labelColor)}" font-size="10">${esc(categories[rowIndex]!)}</text>`)
  })
  return parts
}

function renderPie(element: ChartElement, margin: { left: number; right?: number; top: number }, plotWidth: number, plotHeight: number, palette: string[], labelColor: string): string[] {
  const values = element.data.rows.map((row) => Math.max(0, numericValue(row.values[element.encoding.valueFields[0]!] ?? null) ?? 0))
  const total = values.reduce((sum, value) => sum + value, 0)
  const cx = margin.left + plotWidth / 2
  const cy = margin.top + plotHeight / 2
  const radius = Math.max(1, Math.min(plotWidth, plotHeight) * 0.38)
  if (total <= 0) return [`<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(radius)}" fill="none" stroke="${esc(labelColor)}" stroke-width="1"/>`]
  let start = -Math.PI / 2
  return values.map((value, index) => {
    const end = start + value / total * Math.PI * 2
    const large = end - start > Math.PI ? 1 : 0
    const x1 = cx + radius * Math.cos(start)
    const y1 = cy + radius * Math.sin(start)
    const x2 = cx + radius * Math.cos(end)
    const y2 = cy + radius * Math.sin(end)
    const path = `<path d="M ${num(cx)} ${num(cy)} L ${num(x1)} ${num(y1)} A ${num(radius)} ${num(radius)} 0 ${large} 1 ${num(x2)} ${num(y2)} Z" fill="${esc(palette[index % palette.length]!)}"/>`
    const label = element.options?.showLabels ? `<text x="${num(cx + radius * 0.62 * Math.cos((start + end) / 2))}" y="${num(cy + radius * 0.62 * Math.sin((start + end) / 2))}" text-anchor="middle" fill="${esc(labelColor)}" font-size="10">${esc(String(value))}</text>` : ''
    start = end
    return `${path}${label}`
  })
}

function renderDonut(element: ChartElement, margin: { left: number; right?: number; top: number }, plotWidth: number, plotHeight: number, palette: string[], labelColor: string): string[] {
  const values = element.data.rows.map((row) => Math.max(0, numericValue(row.values[element.encoding.valueFields[0]!] ?? null) ?? 0))
  const total = values.reduce((sum, value) => sum + value, 0)
  const cx = margin.left + plotWidth / 2
  const cy = margin.top + plotHeight / 2
  const radius = Math.max(1, Math.min(plotWidth, plotHeight) * 0.38)
  const inner = radius * 0.55
  if (total <= 0) return [`<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(radius)}" fill="none" stroke="${esc(labelColor)}" stroke-width="${num(Math.max(1, radius - inner))}"/>`]
  let start = -Math.PI / 2
  return values.map((value, index) => {
    const end = start + value / total * Math.PI * 2
    const large = end - start > Math.PI ? 1 : 0
    const outerStart = `${num(cx + radius * Math.cos(start))} ${num(cy + radius * Math.sin(start))}`
    const outerEnd = `${num(cx + radius * Math.cos(end))} ${num(cy + radius * Math.sin(end))}`
    const innerEnd = `${num(cx + inner * Math.cos(end))} ${num(cy + inner * Math.sin(end))}`
    const innerStart = `${num(cx + inner * Math.cos(start))} ${num(cy + inner * Math.sin(start))}`
    const path = `<path d="M ${outerStart} A ${num(radius)} ${num(radius)} 0 ${large} 1 ${outerEnd} L ${innerEnd} A ${num(inner)} ${num(inner)} 0 ${large} 0 ${innerStart} Z" fill="${esc(palette[index % palette.length]!)}"/>`
    const label = element.options?.showLabels ? `<text x="${num(cx + radius * 0.78 * Math.cos((start + end) / 2))}" y="${num(cy + radius * 0.78 * Math.sin((start + end) / 2))}" text-anchor="middle" fill="${esc(labelColor)}" font-size="10">${esc(String(value))}</text>` : ''
    start = end
    return `${path}${label}`
  })
}

function columnLabel(element: ChartElement, field: string): string { return element.data.columns.find((column) => column.id === field)?.label ?? field }
function numericValue(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined }
function finitePositive(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value > 0 }
function finiteNonNegative(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 }
function num(value: number): string { if (!Number.isFinite(value)) throw new Error('RENDER_INVALID_NUMBER'); return String(Math.round(value * 1000) / 1000) }
function esc(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;') }
function escapePointer(value: string): string { return value.replaceAll('~', '~0').replaceAll('/', '~1') }
function uniqueIssues(issues: ChartValidationIssue[]): ChartValidationIssue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => { const key = `${issue.code}|${issue.path ?? ''}|${issue.message}`; if (seen.has(key)) return false; seen.add(key); return true })
}
