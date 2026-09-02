import test from 'node:test'
import assert from 'node:assert/strict'
import { cloneJson } from '../packages/canonical-json/src/index.js'
import { inheritSemanticIdentity, validateSemanticIdentity } from '../packages/semantic-identity/src/index.js'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import type { TextElement } from '../packages/schema/src/index.js'

test('direct edits keep instance and semantic identity; explicit replacements carry lineage', () => {
  const { document } = makeContractDocument()
  const previous = document.slides.slide_main.elements.text_title as TextElement
  const direct = cloneJson(previous)
  direct.content.paragraphs[0].runs[0].text = 'Direct edit'
  assert.equal(direct.id, previous.id)
  assert.equal(direct.semanticKey, previous.semanticKey)
  const replacement = inheritSemanticIdentity({ ...cloneJson(previous), id: 'text_title_replacement', content: { paragraphs: [{ id: 'p-new', runs: [{ id: 'r-new', text: 'Regenerated' }] }] } }, previous)
  assert.equal(replacement.semanticKey, previous.semanticKey)
  assert.equal(replacement.provenance?.replacesElementId, previous.id)
})

test('replacement lineage cycles are rejected', () => {
  const { document } = makeContractDocument()
  const first = document.slides.slide_main.elements.text_title
  first.provenance = { replacesElementId: 'text_body' }
  document.slides.slide_main.elements.text_body.provenance = { replacesElementId: 'text_title' }
  assert.ok(validateSemanticIdentity(document).some((issue) => issue.code === 'SEMANTIC_LINEAGE_CYCLE'))
})
