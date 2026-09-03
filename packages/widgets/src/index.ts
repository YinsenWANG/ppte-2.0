import type { ComponentElement, JsonValue } from '../../schema/src/index.js'

export type WidgetExportPolicy = 'native' | 'static-fallback'

export interface WidgetDefinition {
  componentType: string
  componentVersion: string
  exportPolicy: WidgetExportPolicy
  validateProps(props: Record<string, JsonValue>): string[]
  renderHtml(props: Record<string, JsonValue>): string
  renderSvg(props: Record<string, JsonValue>, width: number, height: number): string
}

export interface WidgetValidationResult {
  ok: boolean
  issues: string[]
  definition?: WidgetDefinition
}

/** Host-owned registry. Definitions are executable host code and never enter a document package. */
export class WidgetRegistry {
  private readonly definitions = new Map<string, WidgetDefinition>()

  register(definition: WidgetDefinition): this {
    if (!definition.componentType || !definition.componentVersion) throw new Error('WIDGET_INVALID: type and version are required.')
    const key = registryKey(definition.componentType, definition.componentVersion)
    if (this.definitions.has(key)) throw new Error(`WIDGET_CONFLICT: ${key} is already registered.`)
    this.definitions.set(key, definition)
    return this
  }

  get(componentType: string, componentVersion: string): WidgetDefinition | undefined {
    return this.definitions.get(registryKey(componentType, componentVersion)) ?? [...this.definitions.values()]
      .filter((definition) => definition.componentType === componentType && compatibleMajor(definition.componentVersion, componentVersion))
      .sort((left, right) => right.componentVersion.localeCompare(left.componentVersion))[0]
  }

  validate(element: ComponentElement): WidgetValidationResult {
    const definition = this.get(element.componentType, element.componentVersion)
    if (!definition) return { ok: false, issues: [`No host widget is registered for ${element.componentType}@${element.componentVersion}.`] }
    const issues = definition.validateProps(element.props)
    return { ok: issues.length === 0, issues, definition }
  }

  list(): WidgetDefinition[] { return [...this.definitions.values()].sort((left, right) => registryKey(left.componentType, left.componentVersion).localeCompare(registryKey(right.componentType, right.componentVersion))) }
}

let builtinRegistry: WidgetRegistry | undefined

export function createBuiltinWidgetRegistry(): WidgetRegistry {
  const registry = new WidgetRegistry()
  registry.register(tableWidget()).register(codeWidget()).register(equationWidget()).register(videoWidget())
  return registry
}

export function getBuiltinWidgetRegistry(): WidgetRegistry {
  builtinRegistry ??= createBuiltinWidgetRegistry()
  return builtinRegistry
}

export function validateWidgetElement(element: ComponentElement, registry: WidgetRegistry = getBuiltinWidgetRegistry()): WidgetValidationResult {
  return registry.validate(element)
}

export function renderWidgetHtml(element: ComponentElement, registry: WidgetRegistry = getBuiltinWidgetRegistry()): string {
  const result = registry.validate(element)
  if (!result.ok || !result.definition) return fallbackHtml(element, result.issues[0] ?? 'Widget definition is unavailable.')
  return `<div data-ppte-widget-type="${escapeHtml(element.componentType)}" data-ppte-widget-version="${escapeHtml(element.componentVersion)}">${result.definition.renderHtml(element.props)}</div>`
}

export function renderWidgetSvg(element: ComponentElement, width: number, height: number, registry: WidgetRegistry = getBuiltinWidgetRegistry()): string {
  const result = registry.validate(element)
  if (!result.ok || !result.definition) return fallbackSvg(element, width, height, result.issues[0] ?? 'Widget definition is unavailable.')
  return `<g data-ppte-widget-type="${escapeXml(element.componentType)}" data-ppte-widget-version="${escapeXml(element.componentVersion)}">${result.definition.renderSvg(element.props, width, height)}</g>`
}

function tableWidget(): WidgetDefinition {
  return {
    componentType: 'core/table',
    componentVersion: '1.0.0',
    exportPolicy: 'native',
    validateProps: (props) => {
      const issues: string[] = []
      if (props.columns !== undefined && (!Array.isArray(props.columns) || props.columns.some((value) => typeof value !== 'string'))) issues.push('core/table columns must be a string array.')
      if (props.rows !== undefined && (!Array.isArray(props.rows) || props.rows.some((row) => !Array.isArray(row) || row.some((value) => !isScalar(value))))) issues.push('core/table rows must be a two-dimensional scalar array.')
      if (props.caption !== undefined && typeof props.caption !== 'string') issues.push('core/table caption must be a string.')
      if (props.columns === undefined && props.rows === undefined) issues.push('core/table requires columns or rows.')
      return issues
    },
    renderHtml: (props) => {
      const columns = stringArray(props.columns)
      const rows = scalarRows(props.rows)
      const header = columns.length ? `<thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead>` : ''
      const body = rows.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(String(value ?? ''))}</td>`).join('')}</tr>`).join('')
      return `<table data-ppte-widget="table"><caption>${escapeHtml(typeof props.caption === 'string' ? props.caption : '')}</caption>${header}<tbody>${body}</tbody></table>`
    },
    renderSvg: (props, width, height) => renderTableSvg(stringArray(props.columns), scalarRows(props.rows), width, height),
  }
}

function codeWidget(): WidgetDefinition {
  return {
    componentType: 'core/code',
    componentVersion: '1.0.0',
    exportPolicy: 'native',
    validateProps: (props) => [
      ...(typeof props.code === 'string' ? [] : ['core/code requires a string code prop.']),
      ...(props.language === undefined || typeof props.language === 'string' ? [] : ['core/code language must be a string.']),
    ],
    renderHtml: (props) => `<pre data-ppte-widget="code" data-language="${escapeHtml(typeof props.language === 'string' ? props.language : '')}"><code>${escapeHtml(typeof props.code === 'string' ? props.code : '')}</code></pre>`,
    renderSvg: (props, width, height) => renderCodeSvg(typeof props.code === 'string' ? props.code : '', width, height),
  }
}

function equationWidget(): WidgetDefinition {
  return {
    componentType: 'core/equation',
    componentVersion: '1.0.0',
    exportPolicy: 'native',
    validateProps: (props) => typeof props.expression === 'string' ? [] : ['core/equation requires a string expression prop.'],
    renderHtml: (props) => `<div data-ppte-widget="equation" role="math">${escapeHtml(typeof props.expression === 'string' ? props.expression : '')}</div>`,
    renderSvg: (props, width, height) => `<text x="${num(width / 2)}" y="${num(height / 2)}" text-anchor="middle" dominant-baseline="middle" font-family="serif" font-size="${num(Math.max(12, Math.min(30, height * 0.28)))}" fill="#1e293b">${escapeXml(typeof props.expression === 'string' ? props.expression : '')}</text>`,
  }
}

function videoWidget(): WidgetDefinition {
  return {
    componentType: 'core/video',
    componentVersion: '1.0.0',
    exportPolicy: 'static-fallback',
    validateProps: (props) => {
      const issues: string[] = []
      if (typeof props.source !== 'string' || !props.source.trim()) issues.push('core/video requires a non-empty local source prop.')
      else if (/^(?:https?:|data:|javascript:)/i.test(props.source)) issues.push('core/video does not allow network or executable sources.')
      if (props.posterAssetId !== undefined && (typeof props.posterAssetId !== 'string' || !props.posterAssetId.trim())) issues.push('core/video posterAssetId must be a non-empty string when provided.')
      if (props.controls !== undefined && typeof props.controls !== 'boolean') issues.push('core/video controls must be boolean.')
      if (props.muted !== undefined && typeof props.muted !== 'boolean') issues.push('core/video muted must be boolean.')
      return issues
    },
    renderHtml: (props) => {
      const source = typeof props.source === 'string' ? props.source : ''
      const posterAssetId = typeof props.posterAssetId === 'string' ? props.posterAssetId : ''
      const controls = props.controls !== false ? ' controls' : ''
      const muted = props.muted === true ? ' muted' : ''
      return `<video data-ppte-widget="video" data-ppte-video-source="${escapeHtml(source)}"${posterAssetId ? ` data-ppte-poster-asset-id="${escapeHtml(posterAssetId)}"` : ''}${controls}${muted} preload="metadata"><span data-ppte-video-fallback="true">Video poster fallback</span></video>`
    },
    renderSvg: (_props, width, height) => `<rect x="0" y="0" width="${num(width)}" height="${num(height)}" rx="8" fill="#0f172a"/><path d="M ${num(width * 0.44)} ${num(height * 0.36)} L ${num(width * 0.66)} ${num(height / 2)} L ${num(width * 0.44)} ${num(height * 0.64)} Z" fill="#f8fafc"/><text x="${num(width / 2)}" y="${num(height * 0.86)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${num(Math.max(10, Math.min(18, height * 0.12)))}" fill="#cbd5e1">Video poster</text>`,
  }
}

function renderTableSvg(columns: string[], rows: JsonValue[][], width: number, height: number): string {
  const columnCount = Math.max(columns.length, ...rows.map((row) => row.length), 1)
  const rowCount = Math.max(1, rows.length + (columns.length ? 1 : 0))
  const cellWidth = width / columnCount
  const cellHeight = height / rowCount
  const cells: string[] = []
  const allRows: JsonValue[][] = columns.length ? [columns, ...rows] : rows
  allRows.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
    const x = columnIndex * cellWidth
    const y = rowIndex * cellHeight
    cells.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(cellWidth)}" height="${num(cellHeight)}" fill="${rowIndex === 0 && columns.length ? '#e2e8f0' : '#ffffff'}" stroke="#94a3b8" stroke-width="1"/><text x="${num(x + 6)}" y="${num(y + cellHeight / 2)}" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="${num(Math.max(9, Math.min(18, cellHeight * 0.36)))}" fill="#1e293b">${escapeXml(String(value ?? ''))}</text>`)
  }))
  return cells.join('')
}

function renderCodeSvg(code: string, width: number, height: number): string {
  const lineHeight = Math.max(14, Math.min(24, height * 0.12))
  return code.split('\n').slice(0, Math.max(1, Math.floor(height / lineHeight))).map((line, index) => `<text x="8" y="${num((index + 1) * lineHeight)}" font-family="monospace" font-size="${num(Math.max(9, lineHeight * 0.62))}" fill="#1e293b">${escapeXml(line)}</text>`).join('')
}

function fallbackHtml(element: ComponentElement, reason: string): string {
  return `<div data-ppte-widget-fallback="true" data-ppte-widget-type="${escapeHtml(element.componentType)}" data-ppte-widget-reason="${escapeHtml(reason)}"><strong>${escapeHtml(element.fallback.label ?? element.componentType)}</strong></div>`
}

function fallbackSvg(element: ComponentElement, width: number, height: number, reason: string): string {
  return `<rect x="0" y="0" width="${num(width)}" height="${num(height)}" fill="#f1f5f9" stroke="#94a3b8"/><text x="${num(width / 2)}" y="${num(height / 2 - 8)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${num(Math.max(10, Math.min(18, height * 0.16)))}" fill="#334155">${escapeXml(element.fallback.label ?? element.componentType)}</text><text x="${num(width / 2)}" y="${num(height / 2 + 14)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" fill="#64748b">${escapeXml(reason)}</text>`
}

function registryKey(type: string, version: string): string { return `${type}@${version}` }
function compatibleMajor(left: string, right: string): boolean { return left.split('.')[0] === right.split('.')[0] }
function isScalar(value: JsonValue): boolean { return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' }
function stringArray(value: JsonValue | undefined): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] }
function scalarRows(value: JsonValue | undefined): JsonValue[][] { return Array.isArray(value) ? value.filter((row): row is JsonValue[] => Array.isArray(row) && row.every(isScalar)) : [] }
function num(value: number): string { if (!Number.isFinite(value)) throw new Error('WIDGET_INVALID_NUMBER'); return String(Math.round(value * 1000) / 1000) }
function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;') }
function escapeXml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;') }
