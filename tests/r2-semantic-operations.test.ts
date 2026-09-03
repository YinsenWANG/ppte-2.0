import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalHash, canonicalRevision } from '../packages/canonical-json/src/index.js'
import { applyOperation, buildDuplicateSlideOperation } from '../packages/operations/src/index.js'
import { Presenter, PortableRuntime, advancePresenterState, retreatPresenterState } from '../packages/portable-runtime/src/index.js'
import { plainTextToRichText } from '../packages/richtext-adapter/src/index.js'
import { validateRuntimeDocument, validateTransactionShape } from '../packages/validation/src/index.js'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import type { Operation, TextElement } from '../packages/schema/src/index.js'

test('duplicateSlide deeply rekeys page-local identities and keeps references local', () => {
  const { document } = makeContractDocument()
  const source = document.slides.slide_main
  ;(source.elements.text_title as TextElement).content.paragraphs = [
    { id: 'p/a', runs: [{ id: 'r/a', text: 'Annual operating review' }, { id: 'r_a', text: '' }] },
    { id: 'p_a', runs: [{ id: 'r/a', text: '复制页附注' }] },
  ]
  source.notes = { speaker: '复制页备注' }
  source.transition = { type: 'fade', durationMs: 250, direction: 'left' }
  source.elements.text_title.appearStep = 2
  source.elements.text_title.animation = { enter: { type: 'fade', durationMs: 180, easing: 'ease-out' } }
  source.groups = { 'content-cluster': { id: 'content-cluster', semanticKey: 'content.cluster', memberIds: ['text_title', 'text_body'] } }
  source.protectedAnchors = [
    { target: { kind: 'element', elementId: 'text_title' }, preserve: ['content'] },
    { target: { kind: 'semantic', semanticKey: 'title.main' }, preserve: ['geometry'] },
    { target: { kind: 'fact', factId: 'revenue' }, preserve: ['data'] },
  ]
  const before = canonicalRevision(document)
  const operation = buildDuplicateSlideOperation(document, 'slide_main', 'slide_copy', { index: 1, offset: { x: 20, y: 10 } })
  const applied = applyOperation(document, operation)
  const duplicate = applied.document.slides.slide_copy
  assert.ok(duplicate)
  const sourceTitle = source.elements.text_title as TextElement
  const duplicateTitle = duplicate.elements[duplicate.rootOrder[1]]
  if (!duplicateTitle || duplicateTitle.type !== 'text') throw new Error('duplicate title is not a Text element')
  assert.equal(canonicalRevision(document), before)
  assert.deepEqual(applied.document.slideOrder, ['slide_main', 'slide_copy'])
  assert.notEqual(duplicateTitle.id, sourceTitle.id)
  assert.notEqual(duplicateTitle.content.paragraphs[0].id, sourceTitle.content.paragraphs[0].id)
  assert.notEqual(duplicateTitle.content.paragraphs[0].runs[0].id, sourceTitle.content.paragraphs[0].runs[0].id)
  assert.equal(new Set(duplicateTitle.content.paragraphs.map((paragraph) => paragraph.id)).size, duplicateTitle.content.paragraphs.length)
  assert.equal(new Set(duplicateTitle.content.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => run.id))).size, duplicateTitle.content.paragraphs.flatMap((paragraph) => paragraph.runs).length)
  assert.equal(duplicateTitle.semanticKey, 'title.main')
  assert.equal(duplicate.elements.text_title === undefined, true)
  assert.equal(duplicate.groups?.['slide_copy__group__content-cluster']?.memberIds.includes(duplicate.rootOrder[1]), true)
  assert.equal(duplicate.protectedAnchors?.[0]?.target.kind, 'element')
  if (duplicate.protectedAnchors?.[0]?.target.kind === 'element') assert.equal(duplicate.protectedAnchors[0].target.elementId, duplicate.rootOrder[1])
  assert.equal(duplicateTitle.frame.x, sourceTitle.frame.x + 20)
  assert.equal(validateRuntimeDocument(applied.document).some((issue) => issue.severity === 'error'), false)

  const duplicateTitleId = duplicate.rootOrder.find((elementId) => duplicate.elements[elementId]?.semanticKey === 'title.main')!
  const changedDuplicate = applyOperation(applied.document, { opId: 'r2:duplicate-edit', kind: 'text.replaceContent', slideId: 'slide_copy', elementId: duplicateTitleId, content: plainTextToRichText('复制页标题', 'copy-p') }).document
  assert.equal((changedDuplicate.slides.slide_main.elements.text_title as TextElement).content.paragraphs[0].runs[0].text, 'Annual operating review')
  assert.equal((changedDuplicate.slides.slide_copy.elements[duplicateTitleId] as TextElement).content.paragraphs[0].runs[0].text, '复制页标题')
  const changedSource = applyOperation(changedDuplicate, { opId: 'r2:source-edit', kind: 'text.replaceContent', slideId: 'slide_main', elementId: 'text_title', content: plainTextToRichText('源页标题', 'source-p') }).document
  assert.equal((changedSource.slides.slide_copy.elements[duplicateTitleId] as TextElement).content.paragraphs[0].runs[0].text, '复制页标题')
  const undone = applyOperation(applied.document, applied.inverse[0]).document
  assert.equal(canonicalRevision(undone), before)
})

test('duplicateSlide transaction shape uses sourceSlideId/newSlideId without a legacy slideId', () => {
  const { document } = makeContractDocument()
  const operation = buildDuplicateSlideOperation(document, 'slide_main', 'slide_copy')
  const issues = validateTransactionShape({
    transactionId: 'r2:duplicate-shape',
    baseRevision: canonicalRevision(document),
    actor: { type: 'human', id: 'test' },
    scope: { kind: 'document', permissions: ['structure'], allowInsert: true, allowDelete: true },
    changeContract: { allowedOperationKinds: ['slide.duplicate'], maxChangedSlides: 1, maxInsertedElements: 99, maxDeletedElements: 0 },
    reason: 'Validate duplicate slide operation shape.',
    createdAt: '2026-09-03T00:00:00.000Z',
    operations: [operation],
  })
  assert.deepEqual(issues.filter((issue) => issue.severity === 'error'), [])
})

test('typed notes/transition/animation operations are reversible and presenter uses declared steps', () => {
  const { document } = makeContractDocument()
  const base = canonicalHash(document)
  const operations: Operation[] = [
    { opId: 'r2:notes', kind: 'slide.setNotes', slideId: 'slide_main', notes: { speaker: '讲者备注' } },
    { opId: 'r2:transition', kind: 'slide.setTransition', slideId: 'slide_main', transition: { type: 'slide', durationMs: 300, direction: 'right' } },
    { opId: 'r2:step', kind: 'element.setAppearStep', slideId: 'slide_main', elementId: 'text_title', appearStep: 5 },
    { opId: 'r2:animation', kind: 'element.setAnimation', slideId: 'slide_main', elementId: 'text_title', animation: { enter: { type: 'slide-left', durationMs: 200, delayMs: 20, easing: 'ease-in-out' } } },
  ]
  let current = document
  const inverses: Operation[][] = []
  for (const operation of operations) {
    const applied = applyOperation(current, operation)
    current = applied.document
    inverses.unshift(applied.inverse)
  }
  assert.equal(current.slides.slide_main.notes?.speaker, '讲者备注')
  assert.equal(current.slides.slide_main.transition?.type, 'slide')
  assert.equal(current.slides.slide_main.elements.text_title.appearStep, 5)
  assert.equal(current.slides.slide_main.elements.text_title.animation?.enter?.type, 'slide-left')
  for (const inverseOperations of inverses) for (const inverse of inverseOperations) current = applyOperation(current, inverse).document
  assert.equal(canonicalHash(current), base)

  current = structuredClone(document)
  current.slides.slide_main.elements.text_title.appearStep = 2
  current.slides.slide_main.elements.text_body.appearStep = 5
  const presenter = new Presenter(current)
  const portable = new PortableRuntime(current)
  assert.deepEqual(presenter.presenterState(), portable.presenterState())
  assert.deepEqual(presenter.next(), portable.next())
  assert.equal(presenter.presenterState().step, 2)
  assert.deepEqual(presenter.next(), portable.next())
  assert.equal(presenter.presenterState().step, 5)
  assert.deepEqual(presenter.next(), portable.next())
  assert.deepEqual(advancePresenterState(current, { slideIndex: 0, step: 2 }), { slideIndex: 0, step: 5 })
  assert.deepEqual(retreatPresenterState(current, { slideIndex: 0, step: 5 }), { slideIndex: 0, step: 2 })
})
