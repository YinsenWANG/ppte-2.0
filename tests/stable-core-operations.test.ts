import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalRevision, cloneJson } from '../packages/canonical-json/src/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { applyOperation } from '../packages/operations/src/index.js'
import { buildReplacementElement } from '../packages/semantic-identity/src/index.js'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import type { Operation, TextElement, Transaction } from '../packages/schema/src/index.js'

function text(value: string, id = 'p') {
  return { paragraphs: [{ id, runs: [{ id: `${id}-run`, text: value }] }] }
}

test('flat groups reject duplicate membership and explicit text scaling is reversible', () => {
  const { document } = makeContractDocument()
  const slide = document.slides.slide_main
  assert.throws(
    () => applyOperation(document, { opId: 'group-duplicate', kind: 'group.create', slideId: 'slide_main', group: { id: 'bad', memberIds: ['text_title', 'text_title'] } }),
    (cause: unknown) => (cause as { code?: string }).code === 'FLAT_GROUP_DUPLICATE_MEMBER',
  )
  slide.groups = { cards: { id: 'cards', memberIds: ['text_title', 'image_hero'] } }
  assert.throws(
    () => applyOperation(document, { opId: 'group-nested', kind: 'group.create', slideId: 'slide_main', group: { id: 'nested', memberIds: ['cards'] } }),
    (cause: unknown) => (cause as { code?: string }).code === 'ELEMENT_MISSING',
  )
  const original = cloneJson(document)
  const plain: Operation = { opId: 'group-plain', kind: 'group.resize', slideId: 'slide_main', groupId: 'cards', targetFrame: { x: 0, y: 0, width: 1920, height: 1080 } }
  const plainResult = applyOperation(document, plain)
  assert.deepEqual((plainResult.document.slides.slide_main.elements.text_title as TextElement).style, (original.slides.slide_main.elements.text_title as TextElement).style)
  const scaled: Operation = { opId: 'group-scaled', kind: 'group.resize', slideId: 'slide_main', groupId: 'cards', targetFrame: { x: 0, y: 0, width: 1920, height: 1080 }, scaleTextStyle: true }
  const scaledResult = applyOperation(original, scaled)
  const scaledTitle = scaledResult.document.slides.slide_main.elements.text_title as TextElement
  assert.equal(scaledTitle.style.overrides?.fontSize, 64 * Math.sqrt((1920 / 1520) * (1080 / 550)))
  let restored = scaledResult.document
  for (const inverse of scaledResult.inverse) restored = applyOperation(restored, inverse).document
  assert.equal(canonicalRevision(restored), canonicalRevision(original))
})

test('Text Fit is explicit and cannot increase font size; image bounds are validated', () => {
  const { document } = makeContractDocument()
  const title = document.slides.slide_main.elements.text_title as TextElement
  const fit: Operation = { opId: 'fit', kind: 'text.fitByReducingFont', slideId: 'slide_main', elementId: title.id, minFontSize: 24, resolvedFontSize: 48 }
  const result = applyOperation(document, fit)
  assert.equal((result.document.slides.slide_main.elements.text_title as TextElement).style.overrides?.fontSize, 48)
  assert.throws(() => applyOperation(document, { ...fit, opId: 'fit-up', resolvedFontSize: 65 }), (cause: unknown) => (cause as { code?: string }).code === 'STYLE_OVERRIDE_INVALID')
  assert.throws(() => applyOperation(document, { opId: 'focal-bad', kind: 'image.setFocalPoint', slideId: 'slide_main', elementId: 'image_hero', focalPoint: { x: 2, y: 0.5 } }), (cause: unknown) => (cause as { code?: string }).code === 'GEOMETRY_INVALID')
})

test('explicit replacement transactions preserve semantic identity through lineage', () => {
  const { document } = makeContractDocument()
  const previous = document.slides.slide_main.elements.text_title as TextElement
  const replacement = buildReplacementElement(document, 'slide_main', previous.id, { ...cloneJson(previous), id: 'text_title_v2', content: { paragraphs: [{ id: 'replacement-p', runs: [{ id: 'replacement-r', text: 'Regenerated title' }] }] } })
  const transaction: Transaction = {
    transactionId: 'replace-title',
    baseRevision: canonicalRevision(document),
    actor: { type: 'agent', id: 'regenerator' },
    scope: { kind: 'selection', slideIds: ['slide_main'], semanticKeys: ['title.main'], permissions: ['structure'], allowInsert: true, allowDelete: true },
    changeContract: {
      allowedOperationKinds: ['element.delete', 'element.insert', 'slide.setReadingOrder'],
      allowedSemanticKeys: ['title.main'],
      maxChangedSlides: 1,
      maxChangedElements: 1,
      maxInsertedElements: 1,
      maxDeletedElements: 1,
      preserve: { semanticIdentity: 'allow-replacement', geometry: 'preserve', style: 'preserve', asset: 'preserve', readingOrder: 'preserve', facts: 'preserve' },
    },
    createdAt: '2026-09-02T00:00:00Z',
    operations: [
      { opId: 'delete-title', kind: 'element.delete', slideId: 'slide_main', elementId: previous.id },
      { opId: 'insert-title', kind: 'element.insert', slideId: 'slide_main', element: replacement, index: 1 },
      { opId: 'restore-reading-order', kind: 'slide.setReadingOrder', slideId: 'slide_main', readingOrder: ['text_title_v2', 'text_body', 'image_hero'] },
    ],
  }
  const session = new PpteSession(document)
  const result = session.commit(transaction)
  assert.equal(result.ok, true)
  assert.equal(session.getDocument().slides.slide_main.elements.text_title_v2.semanticKey, 'title.main')
  assert.equal(session.getDocument().slides.slide_main.elements.text_title_v2.provenance?.replacesElementId, 'text_title')
})

test('fact display synchronization is explicit and reversible', () => {
  const { document } = makeContractDocument()
  document.facts = { revenue: { id: 'revenue', key: 'revenue', value: 42, unit: '%' } }
  const body = document.slides.slide_main.elements.text_body as TextElement
  body.semanticRefs = { factIds: ['revenue'] }
  const operation: Operation = { opId: 'sync-revenue', kind: 'fact.syncReferences', factId: 'revenue', targetElementIds: ['text_body'], strategy: 'replace-display-value' }
  const applied = applyOperation(document, operation)
  assert.equal(applied.document.slides.slide_main.elements.text_body.type, 'text')
  assert.equal((applied.document.slides.slide_main.elements.text_body as TextElement).content.paragraphs[0].runs[0].text, '42%')
  const restored = applyOperation(applied.document, applied.inverse[0]).document
  assert.equal(canonicalRevision(restored), canonicalRevision(document))
})

test('optional default fields use explicit unset inverses and preserve the exact revision', () => {
  const { document } = makeContractDocument()
  const slide = document.slides.slide_main
  const image = slide.elements.image_hero
  const title = slide.elements.text_title as TextElement
  delete slide.readingOrder
  delete slide.protectedAnchors
  delete image.visible
  delete image.locked
  delete image.editPolicy
  delete image.rotationDeg
  delete title.overflowPolicy
  const operations: Operation[] = [
    { opId: 'unset-visible', kind: 'element.setVisibility', slideId: 'slide_main', elementId: image.id, visible: false },
    { opId: 'unset-locked', kind: 'element.setLocked', slideId: 'slide_main', elementId: image.id, locked: true },
    { opId: 'unset-policy', kind: 'element.setEditPolicy', slideId: 'slide_main', elementId: image.id, editPolicy: { mode: 'property' } },
    { opId: 'unset-rotation', kind: 'element.rotate', slideId: 'slide_main', elementId: image.id, rotationDeg: 15 },
    { opId: 'unset-overflow', kind: 'text.setOverflowPolicy', slideId: 'slide_main', elementId: title.id, overflowPolicy: 'clip' },
    { opId: 'unset-reading-order', kind: 'slide.setReadingOrder', slideId: 'slide_main', readingOrder: ['text_title', 'text_body', 'image_hero'] },
    { opId: 'unset-anchors', kind: 'slide.setProtectedAnchors', slideId: 'slide_main', protectedAnchors: [{ target: { kind: 'element', elementId: title.id }, preserve: ['content'] }] },
  ]
  const original = cloneJson(document)
  for (const operation of operations) {
    const applied = applyOperation(document, operation)
    let restored = applied.document
    for (const inverse of applied.inverse) restored = applyOperation(restored, inverse).document
    assert.equal(canonicalRevision(restored), canonicalRevision(original), `${operation.kind} exact optional inverse`)
  }
})
