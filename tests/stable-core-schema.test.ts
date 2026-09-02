import test from 'node:test'
import assert from 'node:assert/strict'
import { cloneJson } from '../packages/canonical-json/src/index.js'
import { buildReplacementElement, resolveSemanticKey, resolveSemanticKeyMatches, validateSemanticIdentity } from '../packages/semantic-identity/src/index.js'
import { computeOverrideDebt, effectiveTextStyle, checkGlyphCoverage, validateStyleBindings } from '../packages/validation/src/index.js'
import { validateDocument } from '../packages/schema/src/index.js'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import type { TextElement } from '../packages/schema/src/index.js'

test('Style Preset resolves tokens before typed overrides and reports override debt', () => {
  const { document } = makeContractDocument()
  const title = document.slides.slide_main.elements.text_title as TextElement
  title.style.overrides = { fontSize: 72 }
  const style = effectiveTextStyle(document, title)
  assert.equal(style.fontFamily, 'Inter')
  assert.equal(style.color, '#172033')
  assert.equal(style.fontSize, 72)
  const report = computeOverrideDebt(document)
  assert.equal(report.overriddenFields, 1)
  assert.equal(report.controllableFields >= 1, true)
  assert.equal(report.entries[0]?.semanticKey, 'title.main')
})

test('typed style and Text v1 boundaries are diagnosed', () => {
  const { document } = makeContractDocument()
  const title = document.slides.slide_main.elements.text_title as TextElement
  title.style.overrides = { fontSize: 'large' as never }
  assert.ok(validateStyleBindings(document).some((issue) => issue.code === 'STYLE_OVERRIDE_INVALID'))
  const malformed = cloneJson(document)
  const run = (malformed.slides.slide_main.elements.text_body as TextElement).content.paragraphs[0].runs[0] as unknown as Record<string, unknown>
  run.fontSize = 12
  assert.ok(validateDocument(malformed).some((issue) => issue.code === 'SCHEMA_INVALID' && issue.message.includes('font-size')))
})

test('semantic resolution refuses ambiguity and replacement carries the prior business key', () => {
  const { document } = makeContractDocument()
  const duplicate = cloneJson(document.slides.slide_main.elements.text_title)
  duplicate.id = 'text_title_duplicate'
  document.slides.slide_main.elements[duplicate.id] = duplicate
  document.slides.slide_main.rootOrder.push(duplicate.id)
  assert.equal(resolveSemanticKeyMatches(document, 'slide_main', 'title.main').length, 2)
  assert.equal(resolveSemanticKey(document, 'slide_main', 'title.main'), undefined)
  assert.ok(validateSemanticIdentity(document).some((issue) => issue.code === 'SEMANTIC_KEY_DUPLICATE'))

  const clean = makeContractDocument().document
  const previous = clean.slides.slide_main.elements.text_title
  const replacement = buildReplacementElement(clean, 'slide_main', previous.id, { ...cloneJson(previous), id: 'text_title_v2' })
  assert.equal(replacement.semanticKey, previous.semanticKey)
  assert.equal(replacement.provenance?.replacesElementId, previous.id)
})

test('embedded subset coverage rejects new CJK text without silent fallback', () => {
  const { document } = makeContractDocument()
  document.fonts.font_system_inter = { id: 'font_system_inter', family: 'Inter', style: 'normal', weight: 400, source: 'embedded', editableSafe: true, glyphCoverage: [{ start: 0x20, end: 0x7e }] }
  const title = document.slides.slide_main.elements.text_title as TextElement
  title.content.paragraphs[0].runs[0].text = '年度经营回顾'
  const issues = checkGlyphCoverage(document, title)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].code, 'FONT_GLYPH_MISSING')
})
