import { canonicalHash } from '../../canonical-json/src/index.js'
import { validateDocument } from '../../schema/src/index.js'
import { validateSemanticIdentity } from '../../semantic-identity/src/index.js'
import type {
  Element,
  FontAsset,
  PpteDocument,
  StyleBinding,
  TextElement,
  TextStyle,
  Transaction,
  ValidationIssue,
  ValueOrToken,
} from '../../schema/src/index.js'

const TEXT_STYLE_FIELDS = ['fontFamily', 'fontSize', 'fontWeight', 'color', 'lineHeight', 'letterSpacing', 'verticalAlign', 'direction'] as const
const SHAPE_STYLE_FIELDS = ['fill', 'stroke', 'radius', 'shadow'] as const
const IMAGE_STYLE_FIELDS = ['border', 'radius', 'shadow'] as const
const KEY_ROLES = new Set(['title', 'subtitle', 'body', 'caption', 'metric', 'source', 'logo', 'image', 'chart', 'cta'])

export interface ResolvedTextStyle extends Omit<TextStyle, 'fontFamily' | 'color'> {
  fontFamily: string
  color: string
}

export interface OverrideDebtEntry {
  slideId: string
  elementId: string
  semanticKey?: string
  fields: string[]
}

export interface OverrideDebtReport {
  /** Ratio in the range 0..1. */
  overrideDebt: number
  overriddenFields: number
  controllableFields: number
  keyElementCount: number
  entries: OverrideDebtEntry[]
}

export function validateRuntimeDocument(document: PpteDocument): ValidationIssue[] {
  const issues = validateDocument(document, { runtimeSubset: true })
  issues.push(...validateSemanticIdentity(document))
  issues.push(...validateStyleBindings(document))
  for (const slide of Object.values(document.slides ?? {})) {
    for (const element of Object.values(slide.elements ?? {})) {
      if (element.type === 'text') {
        issues.push(...validateTextOverflow(document, slide.id, element))
        issues.push(...checkGlyphCoverage(document, element))
      }
    }
  }
  issues.push(...diagnoseOverrideDebt(document))
  return dedupeIssues(issues)
}

export function validateTransactionShape(transaction: Transaction): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!transaction || typeof transaction !== 'object') return [error('SCHEMA_INVALID', 'Transaction must be an object.', '/')]
  if (!transaction.transactionId) issues.push(error('SCHEMA_INVALID', 'transactionId is required.', '/transactionId'))
  if (!transaction.baseRevision) issues.push(error('SCHEMA_INVALID', 'baseRevision is required.', '/baseRevision'))
  if (!transaction.actor?.type) issues.push(error('SCHEMA_INVALID', 'actor.type is required.', '/actor/type'))
  if (!transaction.scope?.permissions) issues.push(error('SCHEMA_INVALID', 'scope.permissions is required.', '/scope/permissions'))
  if (!transaction.changeContract) issues.push(error('SCHEMA_INVALID', 'changeContract is required.', '/changeContract'))
  if (!transaction.createdAt) issues.push(error('SCHEMA_INVALID', 'createdAt is required.', '/createdAt'))
  if (!Array.isArray(transaction.operations) || transaction.operations.length === 0) issues.push(error('SCHEMA_INVALID', 'A transaction must contain at least one operation.', '/operations'))
  const ids = new Set<string>()
  for (const [index, operation] of (transaction.operations ?? []).entries()) {
    if (!operation || typeof operation !== 'object') {
      issues.push(error('SCHEMA_INVALID', 'Operation must be an object.', `/operations/${index}`))
      continue
    }
    if (!operation.opId) issues.push(error('SCHEMA_INVALID', 'Operation opId is required.', `/operations/${index}/opId`))
    if (!operation.kind) issues.push(error('SCHEMA_INVALID', 'Operation kind is required.', `/operations/${index}/kind`))
    if (ids.has(operation.opId)) issues.push(error('SCHEMA_INVALID', `Duplicate operation id ${operation.opId}.`, `/operations/${index}/opId`))
    ids.add(operation.opId)
  }
  return issues
}

export function validateTextOverflow(document: PpteDocument, slideId: string, element: TextElement): ValidationIssue[] {
  const text = textContent(element)
  const style = effectiveTextStyle(document, element)
  const padding = element.boxStyle?.padding
  const availableWidth = Math.max(1, element.frame.width - (padding?.left ?? 0) - (padding?.right ?? 0))
  const estimatedLineWidth = Math.max(1, availableWidth / Math.max(style.fontSize, 1))
  const estimatedLines = text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil([...line].length / estimatedLineWidth)), 0)
  const lineHeight = style.lineHeight ?? 1.2
  const availableHeight = Math.max(0, element.frame.height - (padding?.top ?? 0) - (padding?.bottom ?? 0))
  const estimatedHeight = estimatedLines * style.fontSize * lineHeight
  if (estimatedHeight <= availableHeight + 0.001) return []
  return [{
    code: 'TEXT_OVERFLOW',
    severity: 'warning',
    message: `Text ${element.id} exceeds its fixed frame; font size and frame were not changed implicitly.`,
    slideId,
    elementId: element.id,
    recovery: 'Shorten text, resize the text box, explicitly fit the font, or change overflow policy.',
  }]
}

/** Check the complete text content, including supplementary-plane characters. */
export function checkGlyphCoverage(document: PpteDocument, element: TextElement, addedText?: string): ValidationIssue[] {
  const text = addedText ?? textContent(element)
  const fonts = Object.values(document.fonts ?? {})
  const style = effectiveTextStyle(document, element)
  const candidate = fonts.find((font) => font.family === style.fontFamily)
  // A missing declaration can still be a host system font. There is no false
  // claim of coverage to make until the host declares the font as embedded.
  if (!candidate) return []
  if (!candidate.editableSafe && candidate.source !== 'system') return [{ code: 'FONT_GLYPH_MISSING', severity: 'error', message: `Font ${candidate.family} is not marked editableSafe.`, elementId: element.id, recovery: 'Choose a font with declared editable coverage.' }]
  if (!candidate.glyphCoverage?.length) return candidate.source === 'system' ? [] : [{ code: 'FONT_GLYPH_MISSING', severity: 'error', message: `Font ${candidate.family} has no declared glyph coverage.`, elementId: element.id, recovery: 'Embed coverage or choose a declared system-safe font.' }]
  const missing = [...new Set([...text].map((character) => character.codePointAt(0) ?? 0).filter((codePoint) => !candidate.glyphCoverage?.some((range) => codePoint >= range.start && codePoint <= range.end)))]
  return missing.length === 0 ? [] : [{ code: 'FONT_GLYPH_MISSING', severity: 'error', message: `Font ${candidate.family} does not cover ${missing.map((codePoint) => `U+${codePoint.toString(16).toUpperCase()}`).join(', ')}.`, elementId: element.id, recovery: 'Choose a compatible font, add coverage, or cancel the edit.' }]
}

export function effectiveTextStyle(document: PpteDocument, element: TextElement): ResolvedTextStyle {
  return resolveTextStyle(document, element)
}

/** Resolve preset → typed override → token values for any supported element. */
export function resolveEffectiveStyle(document: PpteDocument, element: Element): Record<string, unknown> {
  if (element.type === 'text') return resolveTextStyle(document, element) as unknown as Record<string, unknown>
  if (element.type === 'shape') return resolveStyle(document.theme.presets.shape[element.style.styleRef] as unknown as Record<string, unknown> | undefined, element.style.overrides as Record<string, unknown> | undefined, document)
  if (element.type === 'image') return resolveStyle(document.theme.presets.image[element.style?.styleRef ?? ''] as unknown as Record<string, unknown> | undefined, element.style?.overrides as Record<string, unknown> | undefined, document)
  if (element.type === 'chart') return resolveStyle(document.theme.presets.chart[element.style.styleRef] as unknown as Record<string, unknown> | undefined, element.style.overrides as Record<string, unknown> | undefined, document)
  return {}
}

/** Compute the derived Style Preset debt metric without changing the document. */
export function computeOverrideDebt(document: PpteDocument): OverrideDebtReport {
  let overriddenFields = 0
  let controllableFields = 0
  let keyElementCount = 0
  const entries: OverrideDebtEntry[] = []
  for (const [slideId, slide] of Object.entries(document.slides ?? {})) {
    for (const element of Object.values(slide.elements ?? {})) {
      if (!KEY_ROLES.has(element.role ?? '') || !hasStyleBinding(element)) continue
      keyElementCount += 1
      const preset = presetFor(document, element)
      const presetFields = Object.keys(preset ?? {})
      controllableFields += presetFields.length
      const overrides = styleOverrides(element)
      const fields = Object.keys(overrides).filter((field) => presetFields.includes(field) || presetFields.length === 0)
      overriddenFields += fields.length
      if (fields.length) entries.push({ slideId, elementId: element.id, semanticKey: element.semanticKey, fields: fields.sort() })
    }
  }
  return {
    overrideDebt: controllableFields === 0 ? 0 : Math.min(1, overriddenFields / controllableFields),
    overriddenFields,
    controllableFields,
    keyElementCount,
    entries,
  }
}

export function diagnoseOverrideDebt(document: PpteDocument, warningThreshold = 0.25): ValidationIssue[] {
  const report = computeOverrideDebt(document)
  if (report.overrideDebt <= warningThreshold || report.overriddenFields === 0) return []
  return [{
    code: 'STYLE_OVERRIDE_DEBT',
    severity: 'warning',
    message: `Style override debt is ${(report.overrideDebt * 100).toFixed(1)}% across ${report.keyElementCount} key elements.`,
    recovery: 'Reset local overrides, reattach the element to a preset, or save the style as a new preset.',
  }]
}

export function validateStyleBindings(document: PpteDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const [slideId, slide] of Object.entries(document.slides ?? {})) {
    for (const element of Object.values(slide.elements ?? {})) {
      if (!hasStyleBinding(element)) continue
      const style = element.style
      if (!style) continue
      const category = element.type
      const preset = document.theme.presets[category][style.styleRef]
      if (!preset) issues.push({ code: 'STYLE_PRESET_MISSING', severity: 'error', message: `Style preset ${style.styleRef} does not exist for ${category}.`, slideId, elementId: element.id, recovery: 'Choose an existing preset or create one through theme.updatePreset.' })
      const allowed: readonly string[] = category === 'text' ? TEXT_STYLE_FIELDS : category === 'shape' ? SHAPE_STYLE_FIELDS : category === 'image' ? IMAGE_STYLE_FIELDS : []
      for (const [field, value] of Object.entries(style.overrides ?? {})) {
        if (!allowed.includes(field as never)) {
          issues.push({ code: 'STYLE_OVERRIDE_INVALID', severity: 'error', message: `Style override ${field} is not allowed for ${category}.`, slideId, elementId: element.id, path: `/slides/${escapePointer(slideId)}/elements/${escapePointer(element.id)}/style/overrides/${escapePointer(field)}` })
          continue
        }
        if (!validStyleField(element.type, field, value)) issues.push({ code: 'STYLE_OVERRIDE_INVALID', severity: 'error', message: `Style override ${field} has an invalid typed value.`, slideId, elementId: element.id })
      }
    }
  }
  return issues
}

function resolveTextStyle(document: PpteDocument, element: TextElement): ResolvedTextStyle {
  const preset = document.theme.presets.text[element.style.styleRef]
  const base: Partial<TextStyle> = preset ?? {
    fontFamily: { kind: 'token', token: 'font.body' },
    fontSize: 28,
    color: { kind: 'token', token: 'color.text.primary' },
  }
  const merged = { ...base, ...element.style.overrides } as TextStyle
  return {
    ...merged,
    fontFamily: resolveToken(merged.fontFamily, document.theme.tokens.fontFamilies, 'Inter'),
    color: resolveToken(merged.color, document.theme.tokens.colors, '#111827'),
  }
}

function resolveStyle<T extends Record<string, unknown> | undefined>(preset: T, overrides: Record<string, unknown> | undefined, document: PpteDocument): Record<string, unknown> {
  const merged = { ...(preset ?? {}), ...(overrides ?? {}) }
  return resolveNestedTokens(merged, document) as Record<string, unknown>
}

function resolveNestedTokens(value: unknown, document: PpteDocument): unknown {
  if (Array.isArray(value)) return value.map((item) => resolveNestedTokens(item, document))
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (record.kind === 'token' && typeof record.token === 'string') return resolveAnyToken(document, record.token)
  return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, resolveNestedTokens(child, document)]))
}

function resolveAnyToken(document: PpteDocument, token: string): unknown {
  return document.theme.tokens.colors[token]
    ?? document.theme.tokens.fontFamilies[token]
    ?? document.theme.tokens.fontSizes[token]
    ?? document.theme.tokens.spacing[token]
    ?? document.theme.tokens.radii[token]
    ?? document.theme.tokens.shadows[token]
    ?? token
}

function resolveToken<T>(value: ValueOrToken<T> | undefined, bucket: Record<string, T>, fallback: T): T {
  if (!value) return fallback
  return value.kind === 'value' ? value.value : bucket[value.token] ?? fallback
}

function hasStyleBinding(element: Element): element is Extract<Element, { type: 'text' | 'shape' | 'image' | 'chart' }> {
  return element.type === 'text' || element.type === 'shape' || element.type === 'image' || element.type === 'chart'
}

function styleOverrides(element: Element): Record<string, unknown> {
  return hasStyleBinding(element) ? (element.style?.overrides as Record<string, unknown> | undefined) ?? {} : {}
}

function presetFor(document: PpteDocument, element: Element): Record<string, unknown> | undefined {
  if (!hasStyleBinding(element)) return undefined
  if (!element.style) return undefined
  return document.theme.presets[element.type][element.style.styleRef] as Record<string, unknown> | undefined
}

function validStyleField(type: Element['type'], field: string, value: unknown): boolean {
  if (type === 'text') {
    if (field === 'fontFamily') return validValueOrToken(value, 'string')
    if (field === 'color') return validValueOrToken(value, 'color')
    if (field === 'fontSize' || field === 'lineHeight') return finitePositive(value)
    if (field === 'fontWeight') return typeof value === 'number' && Number.isFinite(value) && value >= 100 && value <= 1000
    if (field === 'letterSpacing') return finite(value)
    if (field === 'verticalAlign') return value === 'top' || value === 'middle' || value === 'bottom'
    if (field === 'direction') return value === 'ltr' || value === 'rtl' || value === 'auto'
  }
  if ((type === 'shape' || type === 'image') && field === 'radius') return finiteNonNegative(value)
  if (type === 'shape' && field === 'fill') return validPaint(value)
  if ((type === 'shape' || type === 'image') && (field === 'stroke' || field === 'border')) return validStroke(value)
  if ((type === 'shape' || type === 'image') && field === 'shadow') return validShadow(value)
  return false
}

function validValueOrToken(value: unknown, valueType: 'string' | 'color'): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.kind === 'token') return typeof record.token === 'string' && record.token.length > 0
  if (record.kind !== 'value') return false
  return valueType === 'string' ? typeof record.value === 'string' : typeof record.value === 'string' && /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(record.value)
}

function validPaint(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.kind === 'none') return true
  if (record.kind === 'solid') return validValueOrToken(record.color, 'color')
  if (record.kind === 'linear-gradient') return Array.isArray(record.stops) && record.stops.length >= 2 && record.stops.every((stop) => Boolean(stop) && typeof stop === 'object' && validValueOrToken((stop as Record<string, unknown>).color, 'color'))
  return false
}

function validStroke(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return validValueOrToken(record.color, 'color') && finiteNonNegative(record.width)
}

function validShadow(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return validValueOrToken(record.color, 'color') && finite(record.offsetX) && finite(record.offsetY) && finiteNonNegative(record.blur)
}

function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function finitePositive(value: unknown): value is number { return finite(value) && value > 0 }
function finiteNonNegative(value: unknown): value is number { return finite(value) && value >= 0 }

export function textContent(element: TextElement): string {
  return element.content.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n')
}

export function invariantHash(document: PpteDocument, selector: (element: Element) => unknown): string {
  return canonicalHash(Object.values(document.slides).flatMap((slide) => Object.values(slide.elements).map(selector)))
}

function error(code: string, message: string, path: string): ValidationIssue {
  return { code, severity: 'error', message, path }
}
function dedupeIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>()
  return issues.filter((item) => {
    const key = `${item.code}|${item.message}|${item.path ?? ''}|${item.slideId ?? ''}|${item.elementId ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
function escapePointer(value: string): string { return value.replaceAll('~', '~0').replaceAll('/', '~1') }

export type { FontAsset }
