import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalHash, canonicalJsonString, canonicalRevision, cloneJson, sha256HexBytes } from '../packages/canonical-json/src/index.js'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { validateRuntimeDocument } from '../packages/validation/src/index.js'

test('canonical JSON sorts object keys and implements SHA-256', () => {
  assert.equal(canonicalJsonString({ z: 1, a: { y: -0, x: 2 } }), '{"a":{"x":2,"y":0},"z":1}')
  assert.equal(sha256HexBytes(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(canonicalHash('abc'), canonicalHash('abc'))
  const first = makeContractDocument().document
  const second = cloneJson(first)
  ;(second.slides.slide_main.elements.text_title as { name?: string }).name = 'diagnostic'
  assert.notEqual(canonicalRevision(first), canonicalRevision(second))
})

test('runtime validation catches identity and group violations without mutating input', () => {
  const document = makeContractDocument().document
  const invalid = cloneJson(document)
  invalid.slides.slide_main.elements.text_body.semanticKey = 'title.main'
  invalid.slides.slide_main.groups = {
    group_a: { id: 'group_a', memberIds: ['text_title', 'image_hero'] },
    group_b: { id: 'group_b', memberIds: ['image_hero'] },
  }
  const issues = validateRuntimeDocument(invalid)
  assert.ok(issues.some((issue) => issue.code === 'SEMANTIC_KEY_DUPLICATE'))
  assert.ok(issues.some((issue) => issue.code === 'FLAT_GROUP_DUPLICATE_MEMBER'))
  assert.equal(document.slides.slide_main.elements.text_body.semanticKey, 'body.summary')
})
