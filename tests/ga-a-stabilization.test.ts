import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { canonicalJsonString, canonicalRevision, cloneJson, sha256HexBytes } from '../packages/canonical-json/src/index.js'
import { checkCompatibility, GA_A_PROFILE } from '../packages/compatibility/src/index.js'
import { migrateLegacyDocument, migrateLegacyJson } from '../packages/importer-legacy/src/index.js'
import { ERROR_CATALOG, createPpteError } from '../packages/schema/src/errors.js'
import { validateRuntimeDocument } from '../packages/validation/src/index.js'
import { GA_A_FAULT_MATRIX, GA_A_FAULT_POINTS, PlannedFaultInjector, assertFaultMatrixComplete } from '../packages/fault-injection/src/index.js'
import { writeCheckpoint, openCheckpoint } from '../packages/file-format/src/index.js'
import { RecoveryJournal, readJournal, replayJournal } from '../packages/recovery-journal/src/index.js'
import { MockAgent } from '../packages/agent-tools/src/index.js'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import type { PpteDocument, Transaction } from '../packages/schema/src/index.js'

test('GA-A Compatibility Profile has native, migration, read-only, and reject paths', () => {
  assert.deepEqual(checkCompatibility(GA_A_PROFILE), { ok: true, disposition: 'native', profile: GA_A_PROFILE, issues: [] })
  assert.equal(checkCompatibility({ ...GA_A_PROFILE, operationProtocolVersion: '9.0' }).disposition, 'reject')
  assert.equal(checkCompatibility({ compatibilityProfile: 'ppte-2.0-ga-a.0', formatVersion: '2', schemaVersion: '2.0.0', operationProtocolVersion: '1.0' }).disposition, 'migrate')
  assert.equal(checkCompatibility({ compatibilityProfile: 'legacy-semantic-json' }).disposition, 'migrate')
  assert.equal(checkCompatibility({ compatibilityProfile: 'ppte-3.0-future', formatVersion: '3', schemaVersion: '3.0.0', operationProtocolVersion: '2.0' }).disposition, 'readonly')
  assert.equal(checkCompatibility({}).disposition, 'reject')
})

test('data-only migration preserves content, materializes flat groups, and is deterministic', () => {
  const imageBytes = Uint8Array.from([1, 2, 3, 4])
  const source = {
    format: 'legacy-semantic-json',
    documentId: 'legacy-deck',
    title: 'Migrated deck',
    slides: [{
      id: 'slide-one',
      name: 'Overview',
      elements: [{
        id: 'content-group',
        type: 'group',
        frame: { x: 100, y: 50, width: 900, height: 600 },
        children: [
          { id: 'title-one', type: 'text', role: 'title', semanticKey: 'title.main', frame: { x: 10, y: 20, width: 600, height: 80 }, style: { styleRef: 'old.title', fontFamily: 'Inter', fontSize: 42 }, content: { paragraphs: [{ runs: [{ text: 'A preserved title', fontSize: 42, marks: { bold: true } }] }] } },
          { id: 'shape-one', type: 'rectangle', frame: { x: 20, y: 120, width: 240, height: 120 }, shape: 'rectangle' },
          { id: 'image-one', type: 'image', assetId: 'hero', frame: { x: 300, y: 120, width: 300, height: 200 }, semanticKey: 'image.hero' },
        ],
      }],
    }],
    assets: { hero: { hash: `sha256-${sha256HexBytes(imageBytes)}`, mimeType: 'image/png', byteLength: imageBytes.length, path: 'assets/hero.png', width: 1, height: 1 } },
  }
  const before = canonicalJsonString(source)
  const first = migrateLegacyDocument(source, { assetBytes: { hero: imageBytes } })
  const second = migrateLegacyDocument(source, { assetBytes: { hero: imageBytes } })
  assert.equal(canonicalJsonString(source), before)
  assert.equal(first.ok, true)
  assert.equal(first.report.disposition, 'migrate')
  assert.equal(first.report.convertedSlides, 1)
  assert.equal(first.report.convertedElements, 3)
  assert.equal(first.report.flattenedGroups, 1)
  assert.deepEqual(first.document, second.document)
  const slide = first.document.slides['slide-one']!
  assert.deepEqual(slide.rootOrder, ['title-one', 'shape-one', 'image-one'])
  assert.deepEqual(slide.groups?.['content-group']?.memberIds, slide.rootOrder)
  assert.equal(slide.elements['title-one']?.frame.x, 110)
  assert.equal(slide.elements['title-one']?.frame.y, 70)
  assert.equal(slide.elements['title-one']?.type, 'text')
  assert.equal(first.document.assets.hero?.hash, `sha256-${sha256HexBytes(imageBytes)}`)
  assert.ok(first.report.issues.some((issue) => issue.code === 'MIGRATION_STYLE_REATTACHED'))
  const invalid = migrateLegacyJson(new TextEncoder().encode('{'))
  assert.equal(invalid.ok, false)
  assert.equal(invalid.report.issues[0]?.code, 'MIGRATION_INPUT_INVALID')
  assert.equal(migrateLegacyDocument(null).report.issues[0]?.code, 'MIGRATION_INPUT_INVALID')
  assert.equal(migrateLegacyDocument({}, { targetProfile: 'ppte-3.0-future' }).report.issues[0]?.code, 'COMPATIBILITY_PROFILE_UNSUPPORTED')
  assert.ok(invalid.report.issues[0]?.impact)
})

test('the public error contract carries impact, safety, save, and recovery semantics', () => {
  const invalid = cloneJson(makeContractDocument().document)
  invalid.slides.slide_main.elements.text_body.semanticKey = 'title.main'
  const issues = validateRuntimeDocument(invalid)
  assert.ok(issues.some((issue) => issue.code === 'SEMANTIC_KEY_DUPLICATE'))
  for (const issue of issues) {
    assert.ok(issue.impact)
    assert.ok(issue.contentSafety)
    assert.equal(typeof issue.canSave, 'boolean')
    assert.ok(issue.recoverability)
    assert.equal(typeof issue.retryable, 'boolean')
    assert.ok(issue.recovery)
  }
  const error = createPpteError('ASSET_MISSING', 'asset is unavailable', { elementId: 'image-one' })
  assert.equal(error.contentSafety, 'at-risk')
  assert.equal(error.canSave, false)
  assert.equal(error.recoverability, 'manual')
  assert.equal(error.elementId, 'image-one')
  for (const code of ['SCHEMA_INVALID', 'REVISION_CONFLICT', 'JOURNAL_CORRUPT', 'CHECKPOINT_FAILED', 'PATCH_CONFLICT', 'PORTABLE_PROFILE_UNSUPPORTED', 'EXPORT_DEGRADED']) assert.ok(ERROR_CATALOG[code])
})

test('checkpoint fault points preserve the prior checkpoint unless replacement completed', () => {
  assertFaultMatrixComplete()
  assert.deepEqual(new Set(GA_A_FAULT_MATRIX.map((item) => item.id)), new Set(GA_A_FAULT_POINTS))
  assert.throws(() => assertFaultMatrixComplete(GA_A_FAULT_MATRIX.slice(0, -1)), /FAULT_MATRIX_INCOMPLETE/)
  for (const matrixCase of GA_A_FAULT_MATRIX) assert.ok(ERROR_CATALOG[matrixCase.expectedCode], matrixCase.expectedCode)
  assert.equal(GA_A_FAULT_MATRIX.filter((item) => item.domain === 'checkpoint').length, 5)
  const root = mkdtempSync(join(tmpdir(), 'ppte-ga-a-faults-'))
  const { document, imageBytes } = makeContractDocument()
  const target = join(root, 'deck.ppte')
  writeCheckpoint(document, target, { assetBytes: { asset_pixel: imageBytes } })
  const originalRevision = canonicalRevision(document)
  const changed = cloneJson(document)
  changed.metadata.description = 'fault matrix replacement'
  for (const point of GA_A_FAULT_MATRIX.filter((item) => item.domain === 'checkpoint').map((item) => item.id)) {
    const before = openCheckpoint(target)
    assert.equal(canonicalRevision(before.document), originalRevision)
    assert.throws(() => writeCheckpoint(changed, target, { assetBytes: { asset_pixel: imageBytes }, faultInjector: new PlannedFaultInjector([point]) }), /CHECKPOINT_FAULT_INJECTED/)
    const reopened = openCheckpoint(target)
    assert.equal(canonicalRevision(reopened.document), point === 'checkpoint.after-rename' ? canonicalRevision(changed) : originalRevision)
  }
})

function journalTransaction(document: PpteDocument): Transaction {
  const revision = canonicalRevision(document)
  return new MockAgent().createTextReplaceTransaction(document, revision, 'slide_main', 'text_title', { paragraphs: [{ id: 'fault-p', runs: [{ id: 'fault-r', text: 'fault test' }] }] }, 'fault:journal')
}

function newJournal(path: string, document: PpteDocument): RecoveryJournal {
  return new RecoveryJournal(path, { journalVersion: '1', documentId: document.documentId, baseCheckpointRevision: canonicalRevision(document), sessionId: 'fault-session', createdAt: '2026-09-03T00:00:00.000Z' })
}

test('journal truncation, checksum, base, and required-asset faults stop safely', () => {
  const { document } = makeContractDocument()
  const root = mkdtempSync(join(tmpdir(), 'ppte-ga-a-journal-'))
  const tx = journalTransaction(document)

  const partialPath = join(root, 'partial.journal')
  newJournal(partialPath, document).append(tx)
  appendFileSync(partialPath, '{"sequence":')
  const partial = readJournal(partialPath)
  assert.equal(partial.complete, false)
  assert.equal(partial.issues[0]?.code, 'JOURNAL_CORRUPT')

  const checksumPath = join(root, 'checksum.journal')
  newJournal(checksumPath, document).append(tx)
  const checksumText = readFileSync(checksumPath, 'utf8')
  writeFileSync(checksumPath, checksumText.replace(/"checksum":"[0-9a-f]/, '"checksum":"0'))
  const checksum = readJournal(checksumPath)
  assert.equal(checksum.complete, false)
  assert.equal(checksum.issues[0]?.code, 'JOURNAL_CORRUPT')

  const basePath = join(root, 'base.journal')
  newJournal(basePath, document).append(tx)
  const baseJournal = readJournal(basePath)
  const other = cloneJson(document)
  other.documentId = 'other-document'
  const baseMismatch = replayJournal(other, baseJournal)
  assert.equal(baseMismatch.applied, 0)
  assert.ok(baseMismatch.issues.some((issue) => issue.code === 'JOURNAL_BASE_MISMATCH'))

  const assetPath = join(root, 'asset.journal')
  const assetJournal = newJournal(assetPath, document)
  assetJournal.append(tx, undefined, ['sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'])
  const assetReplay = replayJournal(document, readJournal(assetPath))
  assert.equal(assetReplay.applied, 0)
  assert.ok(assetReplay.issues.some((issue) => issue.code === 'ASSET_MISSING'))
})
