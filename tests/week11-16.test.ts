import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalRevision, cloneJson, sha256HexBytes } from '../packages/canonical-json/src/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { checkGlyphCoverage } from '../packages/validation/src/index.js'
import { openCheckpointBytes } from '../packages/file-format/src/index.js'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { auditPortableBundle, createPortableQuickFix, createPortableViewer, decodePortable, PortableRuntime } from '../packages/portable-runtime/src/index.js'
import { PpteReviewer, compareDocuments } from '../packages/reviewer/src/index.js'
import { applyPatchToDocument, decodePatch, encodePatch, validatePatch } from '../packages/patch-format/src/index.js'
import { exportPdf, exportPng } from '../packages/exporter-pdf/src/index.js'
import type { Asset, PpteDocument, TextElement } from '../packages/schema/src/index.js'

test('Portable Viewer is self-contained, offline, and carries origin/capability metadata', () => {
  const { document, imageBytes } = makeContractDocument()
  const built = createPortableViewer(document, { assetBytes: { asset_pixel: imageBytes }, derivedAt: '2026-09-03T00:00:00.000Z' })
  assert.equal(built.ok, true)
  assert.ok(built.html.includes('data:image/png;base64,'))
  assert.ok(built.html.includes('sourceRevision'))
  assert.ok(built.html.includes('no sync'))
  assert.equal(auditPortableBundle(built.html).ok, true)
  const payload = decodePortable(built.html)
  assert.equal(payload.origin.profile, 'viewer')
  assert.equal(payload.origin.sourceRevision, canonicalRevision(document))
  const tampered = built.html.replace(`"sourceRevision":"${payload.origin.sourceRevision}"`, `"sourceRevision":"sha256-${'0'.repeat(64)}"`)
  assert.equal(auditPortableBundle(tampered).ok, false)
})

test('Quick Fix uses the operation engine for text/image, rejects Viewer edits, and undoes exactly', () => {
  const { document, imageBytes } = makeContractDocument()
  const viewer = new PortableRuntime(document, { profile: 'viewer', assetBytes: { asset_pixel: imageBytes } })
  assert.equal(viewer.editText({ elementId: 'text_title' }, 'blocked').ok, false)
  const quick = new PortableRuntime(document, { profile: 'quick-fix', assetBytes: { asset_pixel: imageBytes } })
  const before = quick.getRevision()
  const edited = quick.editText({ semanticKey: 'title.main' }, 'Offline revised title')
  assert.equal(edited.ok, true)
  assert.notEqual(quick.getRevision(), before)
  assert.equal(quick.undo().ok, true)
  assert.equal(quick.getRevision(), before)
  const replacement = quick.replaceImage({ elementId: 'image_hero' }, 'asset_pixel')
  assert.equal(replacement.ok, true)
  const saved = quick.saveAsProject({ clean: true })
  assert.equal(saved.ok, true)
  assert.equal(openCheckpointBytes(saved.bytes!).manifest.clean, true)
  const unsupported = quick.saveAsPortable({})
  assert.equal(unsupported.ok, true)
})

test('Glyph Coverage is explicit for embedded subsets and never silently falls back', () => {
  const { document } = makeContractDocument()
  const text = document.slides.slide_main.elements.text_title as TextElement
  document.fonts.font_system_inter = { id: 'font_system_inter', family: 'Inter', style: 'normal', weight: 400, source: 'embedded', editableSafe: true, glyphCoverage: [{ start: 32, end: 126 }] }
  const issues = checkGlyphCoverage(document, text, '标题', { strict: true })
  assert.ok(issues.some((issue) => issue.code === 'FONT_GLYPH_MISSING'))
  const viewer = createPortableViewer(document, { fontBytes: { font_system_inter: Uint8Array.from([1, 2, 3]) }, assetBytes: { asset_pixel: Uint8Array.from([137, 80, 78, 71]) } })
  assert.equal(viewer.ok, false)
  assert.ok(viewer.issues.some((issue) => issue.code === 'ASSET_HASH_MISMATCH' || issue.code === 'ASSET_MISSING'))
})

test('Three-way Reviewer separates independent fields and blocks same-field conflicts', () => {
  const { document: base } = makeContractDocument()
  const local = cloneJson(base)
  const revised = cloneJson(base)
  const localTitle = local.slides.slide_main.elements.text_title as TextElement
  localTitle.style.overrides = { letterSpacing: 2 }
  const revisedTitle = revised.slides.slide_main.elements.text_title as TextElement
  revisedTitle.content = { paragraphs: [{ id: 'revised-p', runs: [{ id: 'revised-run', text: 'Revised title' }] }] }
  const independent = compareDocuments(base, local, revised)
  assert.ok(independent.units.some((unit) => unit.field === 'content' && unit.status === 'revised-only'))
  assert.ok(independent.units.some((unit) => unit.field === 'style' && unit.status === 'local-only'))
  const contentUnit = independent.units.find((unit) => unit.field === 'content' && unit.status === 'revised-only')!
  const partialSession = new PpteSession(local)
  const partialCommit = partialSession.commit(new PpteReviewer().buildAcceptTransaction(independent, { unitIds: [contentUnit.unitId] }))
  assert.equal(partialCommit.ok, true)
  assert.equal(partialSession.undo().ok, true)
  assert.equal(partialSession.getRevision(), canonicalRevision(local))
  const conflictLocal = cloneJson(base)
  const conflictRevised = cloneJson(base)
  ;(conflictLocal.slides.slide_main.elements.text_title as TextElement).content = { paragraphs: [{ id: 'local-p', runs: [{ id: 'local-run', text: 'Local title' }] }] }
  ;(conflictRevised.slides.slide_main.elements.text_title as TextElement).content = { paragraphs: [{ id: 'other-p', runs: [{ id: 'other-run', text: 'Other title' }] }] }
  const conflict = new PpteReviewer().compare(base, conflictLocal, conflictRevised)
  assert.ok(conflict.conflicts.some((unit) => unit.field === 'content'))
  assert.equal(conflict.autoAcceptable, false)
})

test('Revised Copy patch round-trips, imports new assets, and rejects replay/base mismatch', () => {
  const { document: base, imageBytes } = makeContractDocument()
  const revised = cloneJson(base)
  ;(revised.slides.slide_main.elements.text_title as TextElement).content = { paragraphs: [{ id: 'patch-p', runs: [{ id: 'patch-run', text: 'Patched title' }] }] }
  const reviewer = new PpteReviewer()
  const patch = reviewer.createPatch(base, revised)
  const decoded = decodePatch(encodePatch(patch))
  const applied = applyPatchToDocument(base, decoded)
  assert.equal(applied.ok, true)
  assert.equal((applied.document?.slides.slide_main.elements.text_title as TextElement).content.paragraphs[0].runs[0].text, 'Patched title')
  const replay = applyPatchToDocument(applied.document!, decoded)
  assert.equal(replay.ok, false)
  assert.ok(replay.issues.some((issue) => issue.code === 'PATCH_BASE_MISMATCH'))

  const withNewAsset = cloneJson(base)
  const newBytes = Uint8Array.from(imageBytes)
  const newAsset: Asset = { ...cloneJson(withNewAsset.assets.asset_pixel), id: 'asset_revised', hash: `sha256-${sha256HexBytes(newBytes)}`, path: 'assets/revised.png' }
  withNewAsset.assets.asset_revised = newAsset
  const image = withNewAsset.slides.slide_main.elements.image_hero
  assert.equal(image.type, 'image')
  image.assetId = 'asset_revised'
  const assetPatch = reviewer.createPatch(base, withNewAsset, { assetBytes: { asset_revised: newBytes } })
  const encodedAssetPatch = encodePatch(assetPatch)
  const decodedAssetPatch = decodePatch(encodedAssetPatch)
  const assetApplied = applyPatchToDocument(base, decodedAssetPatch)
  assert.equal(assetApplied.ok, true)
  assert.ok(assetApplied.document?.assets.asset_revised)
  assert.equal((assetApplied.document?.slides.slide_main.elements.image_hero as { assetId: string }).assetId, 'asset_revised')
  const missingAssetPayload = validatePatch({ ...assetPatch, assets: undefined })
  assert.equal(missingAssetPayload.ok, false)
  assert.ok(missingAssetPayload.issues.some((issue) => issue.code === 'ASSET_PAYLOAD_MISSING'))
})

test('PDF/PNG baseline exports always report degradation explicitly and emit valid signatures', () => {
  const { document } = makeContractDocument()
  const pdf = exportPdf(document)
  assert.equal(new TextDecoder().decode(pdf.bytes.slice(0, 8)), '%PDF-1.4')
  assert.equal(pdf.pageCount, 1)
  const png = exportPng(document)
  assert.deepEqual([...png.bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.equal(png.degraded, true)
  assert.ok(png.issues.some((issue) => issue.code === 'EXPORT_DEGRADED'))
})
