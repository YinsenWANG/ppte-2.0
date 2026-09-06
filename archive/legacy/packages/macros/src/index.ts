import { validateCompiledSlideDraft } from '../../schema/src/index.js'
import type { ElementDraft, JsonValue, Rect } from '../../schema/src/index.js'

export interface MacroContext {
  slideKey: string
  canvas: { width: number; height: number }
  seed?: string
  defaultStyleRefs?: Partial<Record<'title' | 'body' | 'metricValue' | 'metricLabel' | 'quote' | 'shape', string>>
}

export interface AuthoringMacro<Input = unknown> {
  id: string
  version: string
  inputSchema: Record<string, JsonValue>
  expand(input: Input, context: MacroContext): ElementDraft[]
}

export interface MacroExpansion {
  macroId: string
  macroVersion: string
  elementDrafts: ElementDraft[]
  validationIssues: ReturnType<typeof validateCompiledSlideDraft>
}

export function validateMacroInput(input: unknown, macro: AuthoringMacro): string[] {
  const issues: string[] = []
  if (!isJsonSafe(input)) issues.push('input must be bounded JSON data.')
  const schema = macro.inputSchema
  if (schema.type === 'object' && !isRecord(input)) issues.push('input must be an object.')
  if (schema.type === 'array' && !Array.isArray(input)) issues.push('input must be an array.')
  if (isRecord(input) && Array.isArray(schema.required)) for (const required of schema.required) if (typeof required === 'string' && !Object.prototype.hasOwnProperty.call(input, required)) issues.push(`missing required field ${required}.`)
  return issues
}

export class MacroRegistry {
  private readonly macros = new Map<string, AuthoringMacro>()

  constructor(macros: AuthoringMacro[] = builtInMacros()) { for (const macro of macros) this.register(macro) }

  register(macro: AuthoringMacro): void {
    if (!nonEmpty(macro.id) || !nonEmpty(macro.version) || !isRecord(macro.inputSchema) || typeof macro.expand !== 'function') throw new Error('MACRO_INVALID: id, version, inputSchema, and expand are required.')
    const key = `${macro.id}@${macro.version}`
    if (this.macros.has(key)) throw new Error(`MACRO_ID_CONFLICT: ${key}`)
    this.macros.set(key, macro)
  }

  get(id: string, version?: string): AuthoringMacro | undefined {
    if (version) return this.macros.get(`${id}@${version}`)
    return [...this.macros.values()].filter((macro) => macro.id === id).sort((left, right) => left.version.localeCompare(right.version)).at(-1)
  }

  list(): AuthoringMacro[] { return [...this.macros.values()] }
}

export function expandMacro(id: string, input: unknown, context: MacroContext, registry = new MacroRegistry(), version?: string): MacroExpansion {
  const macro = registry.get(id, version)
  if (!macro) throw new Error(`MACRO_MISSING: ${id}${version ? `@${version}` : ''}`)
  const inputIssues = validateMacroInput(input, macro)
  if (inputIssues.length > 0) throw new Error(`MACRO_INPUT_INVALID: ${inputIssues.join(' ')}`)
  const rawDrafts = macro.expand(input, context)
  const draftDocument = {
    slideKey: context.slideKey,
    slide: { slideKey: context.slideKey, purpose: 'custom' as const, message: `Macro expansion ${macro.id}`, visualStrategy: 'structured' as const },
    elementDrafts: rawDrafts,
    groups: [],
    readingOrder: rawDrafts.filter((draft) => draft.role !== 'artwork' && draft.role !== 'background').map((draft) => draft.draftId),
    semanticKeyMap: {},
    validationIssues: [],
    provenance: { compilerVersion: `macro:${macro.id}@${macro.version}`, slideIrDigest: 'sha256-macro', fontMetricsFingerprint: 'macro' },
  }
  return { macroId: macro.id, macroVersion: macro.version, elementDrafts: rawDrafts, validationIssues: validateCompiledSlideDraft(draftDocument) }
}

export function builtInMacros(): AuthoringMacro[] {
  return [
    metricCardMacro(),
    quoteMacro(),
    comparisonMacro(),
    featureGridMacro(),
    kpiRowMacro(),
    timelineMacro(),
    processMacro(),
  ]
}

function metricCardMacro(): AuthoringMacro {
  return {
    id: 'metric-card', version: '1.0.0', inputSchema: { type: 'object', required: ['key', 'label', 'value'] },
    expand(input: unknown, context) {
      const value = object(input)
      const key = text(value.key, 'metric')
      const label = text(value.label, key)
      const displayValue = `${text(value.value, '')}${value.unit === undefined ? '' : text(value.unit, '')}`
      const frame = rect(value.frame, { x: 0, y: 0, width: context.canvas.width, height: context.canvas.height })
      const base = `macro:${context.slideKey}:${key}`
      return [
        shapeDraft(`${base}:surface`, { x: frame.x, y: frame.y, width: frame.width, height: frame.height }, `${key}.surface`, frame, context.defaultStyleRefs?.shape ?? 'shape.card'),
        textDraft(`${base}:value`, `${key}.value`, 'metric', { x: frame.x + frame.width * 0.08, y: frame.y + frame.height * 0.20, width: frame.width * 0.84, height: frame.height * 0.42 }, displayValue, context.defaultStyleRefs?.metricValue ?? 'text.metric.value'),
        textDraft(`${base}:label`, `${key}.label`, 'caption', { x: frame.x + frame.width * 0.08, y: frame.y + frame.height * 0.68, width: frame.width * 0.84, height: frame.height * 0.20 }, label, context.defaultStyleRefs?.metricLabel ?? 'text.metric.label'),
      ]
    },
  }
}

function quoteMacro(): AuthoringMacro {
  return {
    id: 'quote', version: '1.0.0', inputSchema: { type: 'object', required: ['key', 'text'] },
    expand(input: unknown, context) {
      const value = object(input); const key = text(value.key, 'quote'); const frame = rect(value.frame, { x: context.canvas.width * 0.14, y: context.canvas.height * 0.2, width: context.canvas.width * 0.72, height: context.canvas.height * 0.5 }); const base = `macro:${context.slideKey}:${key}`
      return [textDraft(`${base}:quote`, `${key}.quote`, 'body', frame, text(value.text, ''), context.defaultStyleRefs?.quote ?? 'text.quote'), ...(value.attribution === undefined ? [] : [textDraft(`${base}:source`, `${key}.source`, 'source', { x: frame.x + frame.width * 0.1, y: frame.y + frame.height + 24, width: frame.width * 0.8, height: 44 }, text(value.attribution, ''), context.defaultStyleRefs?.body ?? 'text.source')])]
    },
  }
}

function comparisonMacro(): AuthoringMacro {
  return {
    id: 'comparison', version: '1.0.0', inputSchema: { type: 'object', required: ['key', 'left', 'right'] },
    expand(input: unknown, context) {
      const value = object(input); const key = text(value.key, 'comparison'); const frame = rect(value.frame, { x: context.canvas.width * 0.08, y: context.canvas.height * 0.28, width: context.canvas.width * 0.84, height: context.canvas.height * 0.56 }); const gap = frame.width * 0.06; const width = (frame.width - gap) / 2; const base = `macro:${context.slideKey}:${key}`
      return [shapeDraft(`${base}:left-surface`, { x: frame.x, y: frame.y, width, height: frame.height }, `${key}.left.surface`, { x: frame.x, y: frame.y, width, height: frame.height }, context.defaultStyleRefs?.shape ?? 'shape.card'), shapeDraft(`${base}:right-surface`, { x: frame.x + width + gap, y: frame.y, width, height: frame.height }, `${key}.right.surface`, { x: frame.x + width + gap, y: frame.y, width, height: frame.height }, context.defaultStyleRefs?.shape ?? 'shape.card'), textDraft(`${base}:left`, `${key}.left`, 'body', { x: frame.x + width * 0.08, y: frame.y + frame.height * 0.1, width: width * 0.84, height: frame.height * 0.8 }, text(value.left, ''), context.defaultStyleRefs?.body ?? 'text.body'), textDraft(`${base}:right`, `${key}.right`, 'body', { x: frame.x + width + gap + width * 0.08, y: frame.y + frame.height * 0.1, width: width * 0.84, height: frame.height * 0.8 }, text(value.right, ''), context.defaultStyleRefs?.body ?? 'text.body')]
    },
  }
}

function featureGridMacro(): AuthoringMacro {
  return {
    id: 'feature-grid', version: '1.0.0', inputSchema: { type: 'object', required: ['key', 'items'] },
    expand(input: unknown, context) {
      const value = object(input); const key = text(value.key, 'features'); const items = Array.isArray(value.items) ? value.items.slice(0, 6) : []; const frame = rect(value.frame, { x: context.canvas.width * 0.08, y: context.canvas.height * 0.3, width: context.canvas.width * 0.84, height: context.canvas.height * 0.52 }); const columns = Math.min(3, Math.max(1, items.length)); const gap = frame.width * 0.03; const width = (frame.width - gap * (columns - 1)) / columns; const base = `macro:${context.slideKey}:${key}`; const drafts: ElementDraft[] = []
      items.forEach((item, index) => { const valueItem = isRecord(item) ? item : { label: item }; const x = frame.x + (index % columns) * (width + gap); const y = frame.y + Math.floor(index / columns) * (frame.height / 2 + gap); const cardFrame = { x, y, width, height: frame.height / 2 - gap / 2 }; drafts.push(shapeDraft(`${base}:${index}:surface`, `${key}.${index}.surface`, cardFrame, cardFrame, context.defaultStyleRefs?.shape ?? 'shape.card')); drafts.push(textDraft(`${base}:${index}:text`, `${key}.${index}`, 'body', { x: x + width * 0.08, y: y + cardFrame.height * 0.14, width: width * 0.84, height: cardFrame.height * 0.72 }, text(valueItem.label, text(valueItem, '')), context.defaultStyleRefs?.body ?? 'text.body')) })
      return drafts
    },
  }
}

function kpiRowMacro(): AuthoringMacro {
  return {
    id: 'kpi-row', version: '1.0.0', inputSchema: { type: 'object', required: ['key', 'items'] },
    expand(input: unknown, context) {
      const value = object(input); const key = text(value.key, 'kpis'); const items = Array.isArray(value.items) ? value.items.slice(0, 6) : []; const frame = rect(value.frame, { x: context.canvas.width * 0.08, y: context.canvas.height * 0.36, width: context.canvas.width * 0.84, height: context.canvas.height * 0.34 }); const gap = frame.width * 0.025; const width = (frame.width - gap * Math.max(0, items.length - 1)) / Math.max(1, items.length); const base = `macro:${context.slideKey}:${key}`
      return items.flatMap((item, index) => { const valueItem = isRecord(item) ? item : { value: item }; return expandMacro('metric-card', { key: `${key}.${index}`, label: text(valueItem.label, `${index + 1}`), value: valueItem.value ?? '', unit: valueItem.unit ?? '', frame: { x: frame.x + index * (width + gap), y: frame.y, width, height: frame.height } }, context, new MacroRegistry([metricCardMacro()])).elementDrafts })
    },
  }
}

function timelineMacro(): AuthoringMacro {
  return {
    id: 'timeline', version: '1.0.0', inputSchema: { type: 'object', required: ['key', 'items'] },
    expand(input: unknown, context) {
      const value = object(input); const key = text(value.key, 'timeline'); const items = Array.isArray(value.items) ? value.items.slice(0, 6) : []; const frame = rect(value.frame, { x: context.canvas.width * 0.08, y: context.canvas.height * 0.34, width: context.canvas.width * 0.84, height: context.canvas.height * 0.4 }); const gap = frame.width * 0.02; const width = (frame.width - gap * Math.max(0, items.length - 1)) / Math.max(1, items.length); const base = `macro:${context.slideKey}:${key}`
      return items.flatMap((item, index) => { const valueItem = isRecord(item) ? item : { label: item }; const itemFrame = { x: frame.x + index * (width + gap), y: frame.y, width, height: frame.height }; return [shapeDraft(`${base}:${index}:marker`, `${key}.${index}.marker`, { x: itemFrame.x + width * 0.44, y: itemFrame.y, width: width * 0.12, height: width * 0.12 }, { x: itemFrame.x + width * 0.44, y: itemFrame.y, width: width * 0.12, height: width * 0.12 }, context.defaultStyleRefs?.shape ?? 'shape.emphasis'), textDraft(`${base}:${index}:label`, `${key}.${index}`, 'body', { x: itemFrame.x, y: itemFrame.y + width * 0.2, width, height: itemFrame.height * 0.65 }, text(valueItem.label, text(valueItem, '')), context.defaultStyleRefs?.body ?? 'text.body')] })
    },
  }
}

function processMacro(): AuthoringMacro {
  return {
    id: 'process', version: '1.0.0', inputSchema: { type: 'object', required: ['key', 'steps'] },
    expand(input: unknown, context) {
      const value = object(input); const key = text(value.key, 'process'); const items = Array.isArray(value.steps) ? value.steps.slice(0, 6) : []; const frame = rect(value.frame, { x: context.canvas.width * 0.08, y: context.canvas.height * 0.34, width: context.canvas.width * 0.84, height: context.canvas.height * 0.42 }); const gap = frame.width * 0.03; const width = (frame.width - gap * Math.max(0, items.length - 1)) / Math.max(1, items.length); const base = `macro:${context.slideKey}:${key}`
      return items.flatMap((item, index) => { const itemFrame = { x: frame.x + index * (width + gap), y: frame.y, width, height: frame.height }; return [shapeDraft(`${base}:${index}:step`, `${key}.${index}.step`, itemFrame, itemFrame, context.defaultStyleRefs?.shape ?? 'shape.emphasis'), textDraft(`${base}:${index}:text`, `${key}.${index}`, 'body', { x: itemFrame.x + width * 0.08, y: itemFrame.y + frame.height * 0.12, width: width * 0.84, height: frame.height * 0.72 }, text(isRecord(item) ? item.label : item, ''), context.defaultStyleRefs?.body ?? 'text.body')] })
    },
  }
}

function textDraft(draftId: string, semanticKey: string, role: ElementDraft['role'], frame: Rect, value: string, styleRef: string): ElementDraft {
  return { draftId, kind: 'text', semanticKey, role, frame, sourceBlockKey: semanticKey.split('.').slice(0, -1).join('.'), data: { content: { paragraphs: [{ id: `${draftId}:paragraph`, runs: [{ id: `${draftId}:run`, text: value }] }] }, style: { styleRef }, overflowPolicy: 'warn' } }
}
function shapeDraft(draftId: string, semanticKey: string, frame: Rect, _unusedFrame: Rect, styleRef: string): ElementDraft
function shapeDraft(draftId: string, frame: Rect, semanticKey: string, _unusedFrame: Rect, styleRef: string): ElementDraft
function shapeDraft(draftId: string, first: string | Rect, second: string | Rect, third: Rect, styleRef: string): ElementDraft {
  const semanticKey = typeof first === 'string' ? first : typeof second === 'string' ? second : draftId
  const frame = typeof first === 'string' ? second as Rect : first
  return { draftId, kind: 'shape', semanticKey, role: 'decorative', frame, sourceBlockKey: semanticKey.split('.').slice(0, -1).join('.'), data: { shape: 'rounded-rectangle', style: { styleRef } } }
}
function rect(value: unknown, fallback: Rect): Rect { return isRecord(value) && finite(value.x) && finite(value.y) && finitePositive(value.width) && finitePositive(value.height) ? { x: value.x, y: value.y, width: value.width, height: value.height } : fallback }
function object(value: unknown): Record<string, unknown> { return isRecord(value) ? value : {} }
function text(value: unknown, fallback: string): string { return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback }
function nonEmpty(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 256 }
function isRecord(value: unknown): value is Record<string, any> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function finitePositive(value: unknown): value is number { return finite(value) && value > 0 }
function isJsonSafe(value: unknown, depth = 0): boolean {
  if (depth > 8) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return typeof value !== 'string' || value.length <= 4096
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.length <= 128 && value.every((item) => isJsonSafe(item, depth + 1))
  if (isRecord(value)) return Object.keys(value).length <= 128 && Object.entries(value).every(([key, child]) => key.length <= 256 && isJsonSafe(child, depth + 1))
  return false
}
