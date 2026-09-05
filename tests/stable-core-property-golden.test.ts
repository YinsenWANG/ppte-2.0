import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalHash, canonicalRevision } from '../packages/canonical-json/src/index.js'
import { applyOperation } from '../packages/operations/src/index.js'
import { validateRuntimeDocument } from '../packages/validation/src/index.js'
import { renderSlideHtml } from '../packages/renderer-react/src/index.js'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import type { Operation, PpteDocument } from '../packages/schema/src/index.js'

test('fixed-seed operation fuzz sequence keeps Stable Core valid and reverses exactly', () => {
  const { document } = makeContractDocument()
  const elementIds = ['text_title', 'text_body', 'image_hero', 'shape_surface']
  let seed = 0x5eedc0de
  let current = document
  const inverses: Operation[][] = []
  for (let index = 0; index < 128; index += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const elementId = elementIds[seed % elementIds.length]!
    const x = 40 + (seed % 1600)
    const y = 40 + ((seed >>> 8) % 850)
    const operation: Operation = index % 2 === 0
      ? { opId: `fuzz-move-${index}`, kind: 'element.move', slideId: 'slide_main', elementId, x, y }
      : { opId: `fuzz-resize-${index}`, kind: 'element.resize', slideId: 'slide_main', elementId, frame: { x, y, width: 80 + (seed % 640), height: 60 + ((seed >>> 8) % 360) } }
    const applied = applyOperation(current, operation)
    assert.equal(validateRuntimeDocument(applied.document).some((issue) => issue.severity === 'error'), false, `${operation.kind} left an invalid Stable Core document`)
    inverses.push(applied.inverse)
    current = applied.document
  }
  for (const inverseOperations of inverses.reverse()) for (const inverse of inverseOperations) current = applyOperation(current, inverse).document
  assert.equal(canonicalRevision(current), canonicalRevision(document))
})

test('reference renderer output is deterministic for the contract deck golden', () => {
  const { document } = makeContractDocument()
  const first = renderSlideHtml(document, 'slide_main')
  const second = renderSlideHtml(structuredClone(document) as PpteDocument, 'slide_main')
  assert.equal(first, second)
  assert.equal(canonicalHash(first), '8b75f4d74264d24bee34bdfeff09fac7cd0c62757e9eedba5d372b3d82e759d3')
})
