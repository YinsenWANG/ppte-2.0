import test from 'node:test'
import assert from 'node:assert/strict'
import { beginDrag, buildSelectionOverlay, endDrag, ImeTextEditSession, updateDrag } from '../packages/editor-react/src/index.js'
import { hitTest } from '../packages/geometry/src/index.js'
import { renderSlideHtml } from '../packages/renderer-react/src/index.js'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import type { ImageElement, ShapeElement, TextElement } from '../packages/schema/src/index.js'

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

test('renderer materializes image crop/style and every Stable Core shape primitive', () => {
  const { document } = makeContractDocument()
  const image = document.slides.slide_main.elements.image_hero as ImageElement
  image.style = {
    styleRef: 'image.hero',
    overrides: {
      border: { color: { kind: 'value', value: '#3B82F6' }, width: 4, dash: [8, 4] },
      radius: 18,
      shadow: { color: { kind: 'value', value: '#172033' }, offsetX: 4, offsetY: 6, blur: 12, opacity: 0.4 },
    },
  }
  image.crop = { x: 0.25, y: 0.1, width: 0.5, height: 0.75 }
  image.focalPoint = { x: 0.25, y: 0.75 }
  const surface = document.slides.slide_main.elements.shape_surface as ShapeElement
  surface.style.overrides = {
    fill: {
      kind: 'linear-gradient',
      angleDeg: 45,
      stops: [
        { offset: 0, color: { kind: 'value', value: '#FFFFFF' } },
        { offset: 1, color: { kind: 'value', value: '#F7F8FA' } },
      ],
    },
  }
  const arrow: ShapeElement = { id: 'shape_arrow', type: 'shape', shape: 'arrow', frame: { x: 20, y: 20, width: 120, height: 60 }, style: { styleRef: 'shape.surface' } }
  document.slides.slide_main.elements.arrow = arrow
  document.slides.slide_main.rootOrder.push('arrow')
  const html = renderSlideHtml(document, 'slide_main')
  assert.ok(html.includes('data-ppte-crop="0.25,0.1,0.5,0.75"'))
  assert.ok(html.includes('object-position:25% 75%'))
  assert.ok(html.includes('transform:scale(2,1.333)'))
  assert.ok(html.includes('border:4px dashed #3B82F6'))
  assert.ok(html.includes('box-shadow:4px 6px 12px 0px #172033'))
  assert.ok(html.includes('<linearGradient'))
  assert.ok(html.includes('<rect'))
  assert.ok(html.includes('marker-end="url(#ppte-arrow-shape_arrow)"'))
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
