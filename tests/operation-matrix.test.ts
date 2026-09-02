import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalRevision, cloneJson } from '../packages/canonical-json/src/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { applyOperation, WEEK1_2_OPERATION_KINDS } from '../packages/operations/src/index.js'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import type { JsonValue, Operation, PpteDocument, Transaction } from '../packages/schema/src/index.js'

const ALL_PERMISSIONS = ['content', 'geometry', 'style', 'structure', 'theme', 'assets', 'facts', 'sources', 'notes', 'animation', 'review'] as const

function richText(value: string, id = 'matrix-p') {
  return { paragraphs: [{ id, runs: [{ id: `${id}-run`, text: value }] }] }
}

function operationCases(): Operation[] {
  const document = makeMatrixDocument()
  const slide = document.slides.slide_main
  const title = slide.elements.text_title
  const image = slide.elements.image_hero
  const body = slide.elements.text_body
  const surface = slide.elements.shape_surface
  return [
    { opId: 'matrix-metadata', kind: 'document.updateMetadata', patch: { description: 'changed' } },
    { opId: 'matrix-theme-replace', kind: 'theme.replace', theme: { ...cloneJson(document.theme), name: 'Matrix Theme' } },
    { opId: 'matrix-theme-token', kind: 'theme.setToken', category: 'colors', token: 'color.accent', value: '#111111' },
    { opId: 'matrix-theme-preset', kind: 'theme.updatePreset', category: 'text', presetId: 'text.title.primary', value: cloneJson(document.theme.presets.text['text.title.primary']) as unknown as JsonValue },
    { opId: 'matrix-slide-insert', kind: 'slide.insert', slide: { id: 'slide_inserted', rootOrder: [], elements: {}, groups: {}, readingOrder: [], visualStrategy: 'structured' }, index: 1 },
    { opId: 'matrix-slide-delete', kind: 'slide.delete', slideId: 'slide_main' },
    { opId: 'matrix-slide-move', kind: 'slide.move', slideId: 'slide_main', index: 0 },
    { opId: 'matrix-slide-update', kind: 'slide.update', slideId: 'slide_main', patch: { name: 'Renamed' } },
    { opId: 'matrix-reading-order', kind: 'slide.setReadingOrder', slideId: 'slide_main', readingOrder: ['text_title', 'text_body', 'image_hero'] },
    { opId: 'matrix-anchors', kind: 'slide.setProtectedAnchors', slideId: 'slide_main', protectedAnchors: [{ target: { kind: 'element', elementId: 'text_title' }, preserve: ['content'], reason: 'matrix' }] },
    { opId: 'matrix-element-insert', kind: 'element.insert', slideId: 'slide_main', element: { id: 'matrix_shape', type: 'shape', shape: 'ellipse', frame: { x: 20, y: 20, width: 40, height: 40 }, style: { styleRef: 'shape.surface' } }, index: 0 },
    { opId: 'matrix-element-delete', kind: 'element.delete', slideId: 'slide_main', elementId: 'text_body' },
    { opId: 'matrix-element-duplicate', kind: 'element.duplicate', slideId: 'slide_main', sourceElementId: 'image_hero', newElementId: 'image_copy', offset: { x: 5, y: 5 } },
    { opId: 'matrix-element-move', kind: 'element.move', slideId: 'slide_main', elementId: 'image_hero', x: 1200, y: 260 },
    { opId: 'matrix-element-resize', kind: 'element.resize', slideId: 'slide_main', elementId: 'image_hero', frame: { x: 1100, y: 200, width: 500, height: 400 } },
    { opId: 'matrix-element-rotate', kind: 'element.rotate', slideId: 'slide_main', elementId: 'image_hero', rotationDeg: 5 },
    { opId: 'matrix-element-reorder', kind: 'element.reorder', slideId: 'slide_main', elementId: 'image_hero', index: 1 },
    { opId: 'matrix-element-visibility', kind: 'element.setVisibility', slideId: 'slide_main', elementId: 'image_hero', visible: false },
    { opId: 'matrix-element-locked', kind: 'element.setLocked', slideId: 'slide_main', elementId: 'image_hero', locked: true },
    { opId: 'matrix-element-policy', kind: 'element.setEditPolicy', slideId: 'slide_main', elementId: 'image_hero', editPolicy: { mode: 'property' } },
    { opId: 'matrix-element-key', kind: 'element.setSemanticKey', slideId: 'slide_main', elementId: 'image_hero', semanticKey: 'image.hero.changed' },
    { opId: 'matrix-element-style-ref', kind: 'element.setStyleRef', slideId: 'slide_main', elementId: 'text_title', styleRef: 'text.body' },
    { opId: 'matrix-element-style-patch', kind: 'element.updateStyleOverrides', slideId: 'slide_main', elementId: 'text_title', patch: { letterSpacing: 2 } },
    { opId: 'matrix-element-style-clear', kind: 'element.clearStyleOverrides', slideId: 'slide_main', elementId: 'text_title', paths: ['/letterSpacing'] },
    { opId: 'matrix-text-replace', kind: 'text.replaceContent', slideId: 'slide_main', elementId: 'text_title', content: richText('New title') },
    { opId: 'matrix-text-overflow', kind: 'text.setOverflowPolicy', slideId: 'slide_main', elementId: 'text_title', overflowPolicy: 'clip' },
    { opId: 'matrix-text-fit', kind: 'text.fitByReducingFont', slideId: 'slide_main', elementId: 'text_title', minFontSize: 24, resolvedFontSize: 48 },
    { opId: 'matrix-text-resize', kind: 'text.resizeBox', slideId: 'slide_main', elementId: 'text_title', frame: { x: 100, y: 100, width: 900, height: 140 } },
    { opId: 'matrix-image-replace', kind: 'image.replaceAsset', slideId: 'slide_main', elementId: 'image_hero', assetId: 'asset_two', preserveCrop: false },
    { opId: 'matrix-image-crop', kind: 'image.setCrop', slideId: 'slide_main', elementId: 'image_hero', crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } },
    { opId: 'matrix-image-focal', kind: 'image.setFocalPoint', slideId: 'slide_main', elementId: 'image_hero', focalPoint: { x: 0.5, y: 0.5 } },
    { opId: 'matrix-shape-style', kind: 'shape.updateStyle', slideId: 'slide_main', elementId: 'shape_surface', patch: { radius: 12 } },
    { opId: 'matrix-group-create', kind: 'group.create', slideId: 'slide_main', group: { id: 'group_new', memberIds: ['text_title'] } },
    { opId: 'matrix-group-delete', kind: 'group.delete', slideId: 'slide_main', groupId: 'group_base' },
    { opId: 'matrix-group-add', kind: 'group.addMembers', slideId: 'slide_main', groupId: 'group_base', elementIds: ['text_title'] },
    { opId: 'matrix-group-remove', kind: 'group.removeMembers', slideId: 'slide_main', groupId: 'group_base', elementIds: ['text_body'] },
    { opId: 'matrix-group-move', kind: 'group.move', slideId: 'slide_main', groupId: 'group_base', dx: 10, dy: 12 },
    { opId: 'matrix-group-resize', kind: 'group.resize', slideId: 'slide_main', groupId: 'group_base', targetFrame: { x: 100, y: 100, width: 900, height: 500 } },
    { opId: 'matrix-fact-upsert', kind: 'fact.upsert', fact: { id: 'fact_one', key: 'one', value: 2 } },
    { opId: 'matrix-fact-delete', kind: 'fact.delete', factId: 'fact_one' },
    { opId: 'matrix-source-upsert', kind: 'source.upsert', source: { id: 'source_one', title: 'Updated' } },
    { opId: 'matrix-source-delete', kind: 'source.delete', sourceId: 'source_one' },
    { opId: 'matrix-align', kind: 'layout.align', slideId: 'slide_main', elementIds: ['text_title', 'text_body'], alignment: 'left', reference: 'selection' },
    { opId: 'matrix-distribute', kind: 'layout.distribute', slideId: 'slide_main', elementIds: ['text_title', 'text_body', 'image_hero'], axis: 'horizontal', mode: 'centers' },
  ]
}

function makeMatrixDocument(): PpteDocument {
  const document = makeContractDocument().document
  document.slides.slide_main.protectedAnchors = []
  document.slides.slide_main.groups = { group_base: { id: 'group_base', memberIds: ['text_body', 'image_hero'] } }
  const image = document.slides.slide_main.elements.image_hero
  image.rotationDeg = 0
  image.visible = true
  image.locked = false
  image.editPolicy = { mode: 'full' }
  const title = document.slides.slide_main.elements.text_title
  if (title.type === 'text') title.style.overrides = { letterSpacing: 1 }
  document.assets.asset_two = { ...cloneJson(document.assets.asset_pixel), id: 'asset_two', path: 'assets/two.png' }
  document.facts = { fact_one: { id: 'fact_one', key: 'one', value: 1 } }
  document.sources = { source_one: { id: 'source_one', title: 'Original' } }
  return document
}

test('every Week 1–2 operation has positive, inverse, and stale-base conflict evidence', () => {
  const cases = operationCases()
  assert.deepEqual(new Set(cases.map((operation) => operation.kind)), new Set(WEEK1_2_OPERATION_KINDS))
  for (const operation of cases) {
    const base = makeMatrixDocument()
    const applied = applyOperation(base, operation)
    let restored = applied.document
    for (const inverse of applied.inverse) restored = applyOperation(restored, inverse).document
    assert.equal(canonicalRevision(restored), canonicalRevision(base), `${operation.kind} inverse`)

    const session = new PpteSession(base)
    const conflict: Transaction = {
      transactionId: `conflict:${operation.opId}`,
      baseRevision: 'sha256-stale-base',
      actor: { type: 'human' },
      scope: { kind: 'document', permissions: [...ALL_PERMISSIONS], allowInsert: true, allowDelete: true },
      changeContract: { allowedOperationKinds: [operation.kind], maxChangedSlides: 99, maxChangedElements: 999, maxInsertedElements: 999, maxDeletedElements: 999, maxReplacedAssets: 999 },
      createdAt: '2026-09-02T00:00:00Z',
      operations: [operation],
    }
    const result = session.preview(conflict)
    assert.equal(result.ok, false, `${operation.kind} conflict`)
    assert.ok(result.issues.some((issue) => issue.code === 'REVISION_CONFLICT'), `${operation.kind} conflict code`)
  }
})
