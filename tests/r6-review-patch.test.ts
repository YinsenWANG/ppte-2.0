import test from 'node:test'
import assert from 'node:assert/strict'
import { cloneJson } from '../packages/canonical-json/src/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { computeOverrideDebt } from '../packages/validation/src/index.js'
import { applyPatchToDocument, decodePatch, encodePatch, validatePatch } from '../packages/patch-format/src/index.js'
import { buildAcceptTransaction, compareDocuments, PpteReviewer } from '../packages/reviewer/src/index.js'
import type { ComponentElement, PpteDocument, TextElement } from '../packages/schema/src/index.js'
import { makeContractDocument } from '../apps/contract-deck/index.js'

const TITLE_ID = 'text_title'
const SLIDE_ID = 'slide_main'

function baseDocument(): PpteDocument {
  return makeContractDocument().document
}

function title(document: PpteDocument): TextElement {
  return document.slides[SLIDE_ID]!.elements[TITLE_ID]! as TextElement
}

test('R6 delete-versus-any-modify is a conflict and revised deletion is explicit', () => {
  const base = baseDocument()
  const local = cloneJson(base)
  title(local).content.paragraphs[0]!.runs[0]!.text = 'Local title'
  const revised = cloneJson(base)
  delete revised.slides[SLIDE_ID]!.elements[TITLE_ID]
  revised.slides[SLIDE_ID]!.rootOrder = revised.slides[SLIDE_ID]!.rootOrder.filter((id) => id !== TITLE_ID)
  revised.slides[SLIDE_ID]!.readingOrder = revised.slides[SLIDE_ID]!.readingOrder?.filter((id) => id !== TITLE_ID)

  const comparison = compareDocuments(base, local, revised)
  const unit = comparison.conflicts.find((candidate) => candidate.elementId === TITLE_ID && candidate.field === 'identity')
  assert.ok(unit)
  assert.equal(unit.status, 'conflict')
  assert.throws(() => buildAcceptTransaction(comparison, { unitIds: [unit.unitId] }), /REVIEW_EMPTY/)

  const accepted = buildAcceptTransaction(comparison, { unitIds: [unit.unitId], resolutions: { [unit.unitId]: 'revised' } })
  accepted.changeContract.requireConfirmation = false
  const session = new PpteSession(local)
  assert.equal(session.commit(accepted).ok, true)
  assert.equal(session.getDocument().slides[SLIDE_ID]!.elements[TITLE_ID], undefined)
})

test('R6 unsupported changed fields are explicit capability gaps, never fake empty review', () => {
  const base = baseDocument()
  const revised = cloneJson(base)
  title(revised).tags = ['reviewed']
  const comparison = compareDocuments(base, base, revised)
  const unit = comparison.units.find((candidate) => candidate.elementId === TITLE_ID && candidate.field === 'tags')
  assert.ok(unit)
  assert.equal(unit.capabilityGap?.code, 'REVIEW_CAPABILITY_GAP')
  assert.ok(comparison.capabilityGaps.some((gap) => gap.path === unit.path))
  assert.throws(() => buildAcceptTransaction(comparison, { unitIds: [unit.unitId] }), /REVIEW_CAPABILITY_GAP/)
})

test('R6 paragraph style uses a typed reversible Operation and style permission', () => {
  const base = baseDocument()
  const revised = cloneJson(base)
  title(revised).paragraphStyle = { align: 'center', paragraphSpacing: 12 }
  const comparison = compareDocuments(base, base, revised)
  const unit = comparison.units.find((candidate) => candidate.elementId === TITLE_ID && candidate.field === 'paragraphStyle')
  assert.ok(unit)
  assert.equal(unit.operations?.some((operation) => operation.kind === 'text.updateStyle'), true)
  const transaction = buildAcceptTransaction(comparison, { unitIds: [unit.unitId] })
  assert.deepEqual(transaction.scope.permissions, ['style'])
  const session = new PpteSession(base)
  transaction.changeContract.requireConfirmation = false
  assert.equal(session.commit(transaction).ok, true)
  assert.deepEqual(title(session.getDocument()).paragraphStyle, { align: 'center', paragraphSpacing: 12 })
  assert.equal(session.undo().ok, true)
  assert.equal(title(session.getDocument()).paragraphStyle, undefined)
})

test('R6 stale Patch returns semantic Compare and direct application verifies head revision', () => {
  const base = baseDocument()
  const revised = cloneJson(base)
  title(revised).content.paragraphs[0]!.runs[0]!.text = 'Revised title'
  const patch = new PpteReviewer().createPatch(base, revised)
  assert.equal(validatePatch(patch).ok, true)

  const local = cloneJson(base)
  title(local).content.paragraphs[0]!.runs[0]!.text = 'Local title'
  const stale = applyPatchToDocument(local, patch, { baseDocument: base })
  assert.equal(stale.ok, false)
  assert.equal(stale.issues[0]?.code, 'PATCH_BASE_MISMATCH')
  assert.ok(stale.compare?.conflicts.some((unit) => unit.elementId === TITLE_ID && unit.field === 'content'))
  const staleSession = new PpteSession(local)
  assert.ok(staleSession.previewPatch(patch, { baseDocument: base }).compare)
  assert.ok(staleSession.applyPatch(patch, { baseDocument: base }).compare)

  const applied = applyPatchToDocument(base, patch)
  assert.equal(applied.ok, true)
  assert.equal(applied.revision, patch.manifest.headRevision)
  const tampered = cloneJson(patch)
  tampered.manifest.headRevision = '0'.repeat(64)
  assert.equal(validatePatch(tampered).ok, false)
})

test('R6 Patch infers GA-C from content and permits literal data strings', () => {
  const base = baseDocument()
  const revised = cloneJson(base)
  title(revised).content.paragraphs[0]!.runs[0]!.text = 'Literal </script> 中文 😀'
  const widget: ComponentElement = {
    id: 'widget_code',
    type: 'component',
    semanticKey: 'widget.code',
    role: 'custom',
    frame: { x: 100, y: 800, width: 700, height: 260 },
    componentType: 'core/code',
    componentVersion: '1.0.0',
    props: { code: 'return 43' },
    fallback: { kind: 'placeholder', label: 'Code' },
  }
  revised.slides[SLIDE_ID]!.elements[widget.id] = widget
  revised.slides[SLIDE_ID]!.rootOrder.push(widget.id)
  const patch = new PpteReviewer().createPatch(base, revised)
  assert.equal(patch.manifest.compatibilityProfile, 'ppte-2.0-ga-c.1')
  assert.equal(validatePatch(patch).ok, true)
  const decoded = decodePatch(encodePatch(patch))
  assert.equal(validatePatch(decoded).ok, true)
  assert.equal(JSON.stringify(decoded.operations).includes('return 43'), true)

  const widgetBase = cloneJson(base)
  widgetBase.slides[SLIDE_ID]!.elements[widget.id] = widget
  widgetBase.slides[SLIDE_ID]!.rootOrder.push(widget.id)
  const widgetRevised = cloneJson(widgetBase)
  ;(widgetRevised.slides[SLIDE_ID]!.elements[widget.id] as ComponentElement).props.code = 'return 44'
  const widgetPatch = new PpteReviewer().createPatch(widgetBase, widgetRevised)
  assert.equal(widgetPatch.operations.some((operation) => operation.kind === 'component.updateProps' && operation.patch.code === 'return 44'), true)
  assert.throws(() => new PpteReviewer().createPatch(base, revised, { compatibilityProfile: 'ppte-2.0-ga-b.1' }), /COMPATIBILITY_PROFILE_MISMATCH/)
})

test('R6 Override Debt denominator is the complete typed style surface', () => {
  const document = baseDocument()
  title(document).style.overrides = { letterSpacing: 7 }
  const report = computeOverrideDebt(document)
  assert.ok(report.overriddenFields > 0)
  assert.ok(report.controllableFields >= 8)
  assert.ok(report.entries.some((entry) => entry.elementId === TITLE_ID && entry.fields.includes('letterSpacing')))
})
