import test from 'node:test'
import assert from 'node:assert/strict'
import { beginDrag, buildSelectionOverlay, endDrag, ImeTextEditSession, updateDrag } from '../packages/editor-react/src/index.js'
import { hitTest } from '../packages/geometry/src/index.js'
import { renderSlideHtml } from '../packages/renderer-react/src/index.js'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import type { TextElement } from '../packages/schema/src/index.js'

function text(value: string) { return { paragraphs: [{ id: 'ime-p', runs: [{ id: 'ime-r', text: value }] }] } }

test('renderer emits only derived deterministic primitives and escapes text', () => {
  const { document } = makeContractDocument()
  ;(document.slides.slide_main.elements.text_body as TextElement).content = text('<safe text>')
  const html = renderSlideHtml(document, 'slide_main')
  assert.ok(html.includes('data-ppte-type="text"'))
  assert.ok(html.includes('data-ppte-type="image"'))
  assert.ok(html.includes('data-ppte-type="shape"'))
  assert.ok(html.includes('&lt;safe text&gt;'))
  assert.equal(html.includes('<safe text>'), false)
})

test('selection, hit testing, and image drag remain transient until pointer-up', () => {
  const { document } = makeContractDocument()
  const image = hitTest(document, 'slide_main', { x: 1200, y: 300 })
  assert.equal(image?.id, 'image_hero')
  const overlay = buildSelectionOverlay(document, { slideId: 'slide_main', elementIds: ['image_hero'] })
  assert.deepEqual(overlay[0].frame, document.slides.slide_main.elements.image_hero.frame)
  const start = beginDrag(document, 'sha256-base', 'slide_main', 'image_hero', { x: 1200, y: 300 })
  const moved = updateDrag(start, { x: 1240, y: 350 })
  assert.equal(moved.currentFrame.x, start.originalFrame.x + 40)
  assert.equal(document.slides.slide_main.elements.image_hero.frame.x, start.originalFrame.x)
  const tx = endDrag(moved, 'tx-drag', '2026-09-02T00:00:00Z')
  assert.equal(tx?.operations[0].kind, 'element.move')
})

test('IME adapter keeps composition local and produces one replace transaction after composition', () => {
  const { document } = makeContractDocument()
  const element = document.slides.slide_main.elements.text_title as TextElement
  const editor = new ImeTextEditSession(element, 'slide_main')
  editor.beginComposition()
  editor.updateComposition(text('中文输入中'))
  assert.equal(editor.isComposing(), true)
  assert.equal(editor.finish('tx-too-early', 'sha256-base'), undefined)
  editor.endComposition()
  const tx = editor.finish('tx-ime', 'sha256-base', '2026-09-02T00:00:00Z')
  assert.equal(tx?.operations.length, 1)
  assert.equal(tx?.operations[0].kind, 'text.replaceContent')
  assert.equal((tx?.operations[0] as { slideId: string }).slideId, 'slide_main')
  assert.deepEqual(editor.cancel(), element.content)
})
