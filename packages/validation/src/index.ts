import { canonicalHash } from '../../canonical-json/src/index.js'
import { validateDocument } from '../../schema/src/index.js'
import { validateSemanticIdentity } from '../../semantic-identity/src/index.js'
import type {
  Element,
  FontAsset,
  PpteDocument,
  TextElement,
  Transaction,
  ValidationIssue,
} from '../../schema/src/index.js'

export function validateRuntimeDocument(document: PpteDocument): ValidationIssue[] {
  const issues = validateDocument(document, { runtimeSubset: true })
  issues.push(...validateSemanticIdentity(document))
  for (const slide of Object.values(document.slides ?? {})) {
    for (const element of Object.values(slide.elements ?? {})) {
      if (element.type === 'text') issues.push(...validateTextOverflow(document, slide.id, element))
    }
  }
  return issues
}

export function validateTransactionShape(transaction: Transaction): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!transaction.transactionId) issues.push(error('SCHEMA_INVALID', 'transactionId is required.', '/transactionId'))
  if (!transaction.baseRevision) issues.push(error('SCHEMA_INVALID', 'baseRevision is required.', '/baseRevision'))
  if (!transaction.actor?.type) issues.push(error('SCHEMA_INVALID', 'actor.type is required.', '/actor/type'))
  if (!transaction.operations?.length) issues.push(error('SCHEMA_INVALID', 'A transaction must contain at least one operation.', '/operations'))
  const ids = new Set<string>()
  for (const operation of transaction.operations ?? []) {
    if (!operation.opId) issues.push(error('SCHEMA_INVALID', 'Operation opId is required.', '/operations'))
    if (ids.has(operation.opId)) issues.push(error('SCHEMA_INVALID', `Duplicate operation id ${operation.opId}.`, '/operations'))
    ids.add(operation.opId)
  }
  return issues
}

export function validateTextOverflow(document: PpteDocument, slideId: string, element: TextElement): ValidationIssue[] {
  const text = textContent(element)
  const style = resolveTextStyle(document, element)
  // This is a deterministic conservative preflight, not an implicit fit.
  const estimatedLineWidth = Math.max(1, element.frame.width / Math.max(style.fontSize, 1))
  const estimatedLines = text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil([...line].length / estimatedLineWidth)), 0)
  const lineHeight = style.lineHeight ?? 1.2
  const estimatedHeight = estimatedLines * style.fontSize * lineHeight
  if (estimatedHeight <= element.frame.height + 0.001) return []
  return [{
    code: 'TEXT_OVERFLOW',
    severity: 'warning',
    message: `Text ${element.id} exceeds its fixed frame; font size and frame were not changed implicitly.`,
    slideId,
    elementId: element.id,
    recovery: 'Shorten text, resize the text box, explicitly fit the font, or change overflow policy.',
  }]
}

export function checkGlyphCoverage(document: PpteDocument, element: TextElement, addedText?: string): ValidationIssue[] {
  const text = addedText ?? textContent(element)
  const fonts = Object.values(document.fonts ?? {})
  const style = resolveTextStyle(document, element)
  const family = style.fontFamily.kind === 'value' ? style.fontFamily.value : document.theme.tokens.fontFamilies[style.fontFamily.token]
  const candidate = fonts.find((font) => font.family === family) ?? fonts.find((font) => font.editableSafe)
  if (!candidate) return []
  if (!candidate.editableSafe && candidate.source !== 'system') return [{ code: 'FONT_GLYPH_MISSING', severity: 'error', message: `Font ${candidate.family} is not marked editableSafe.`, elementId: element.id, recovery: 'Choose a font with declared editable coverage.' }]
  if (!candidate.glyphCoverage?.length) return candidate.source === 'system' ? [] : [{ code: 'FONT_GLYPH_MISSING', severity: 'error', message: `Font ${candidate.family} has no declared glyph coverage.`, elementId: element.id, recovery: 'Embed coverage or choose a declared system-safe font.' }]
  const missing = [...new Set([...text].map((character) => character.codePointAt(0) ?? 0).filter((codePoint) => !candidate.glyphCoverage?.some((range) => codePoint >= range.start && codePoint <= range.end)))]
  return missing.length === 0 ? [] : [{ code: 'FONT_GLYPH_MISSING', severity: 'error', message: `Font ${candidate.family} does not cover ${missing.map((codePoint) => `U+${codePoint.toString(16).toUpperCase()}`).join(', ')}.`, elementId: element.id, recovery: 'Choose a compatible font, add coverage, or cancel the edit.' }]
}

export function effectiveTextStyle(document: PpteDocument, element: TextElement) {
  return resolveTextStyle(document, element)
}

function resolveTextStyle(document: PpteDocument, element: TextElement) {
  const preset = document.theme.presets.text[element.style.styleRef] ?? {}
  return { ...preset, ...element.style.overrides }
}
function textContent(element: TextElement): string {
  return element.content.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n')
}
function error(code: string, message: string, path: string): ValidationIssue {
  return { code, severity: 'error', message, path }
}

export function invariantHash(document: PpteDocument, selector: (element: Element) => unknown): string {
  return canonicalHash(Object.values(document.slides).flatMap((slide) => Object.values(slide.elements).map(selector)))
}

export type { FontAsset }
