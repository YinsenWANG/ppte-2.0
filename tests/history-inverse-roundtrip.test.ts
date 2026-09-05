import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { canonicalRevision } from '../packages/canonical-json/src/index.js'
import { applyOperation } from '../packages/operations/src/index.js'
import { buildCheckpointBytes, openCheckpointBytes } from '../packages/file-format/src/index.js'
import { buildPortableCheckpointBytes } from '../packages/portable-runtime/src/shared.js'
import { inferCompatibilityProfile, requiresEditProtocol } from '../packages/compatibility/src/index.js'
import { PPTE_EDIT_COMPATIBILITY_PROFILE, type Operation, type Transaction } from '../packages/schema/src/index.js'
import { readJournal, replayJournal } from '../packages/recovery-journal/src/index.js'
import { createPatch } from '../packages/reviewer/src/index.js'
import { applyPatchToDocument, encodePatch, decodePatch, validatePatch } from '../packages/patch-format/src/codec.js'
import { openFileSession } from '../packages/node-runtime/src/index.js'
import { writeCheckpoint, openCheckpoint } from '../packages/file-format/src/index.js'

function transaction(session: PpteSession, operation: Operation): Transaction {
  return { transactionId: `tx-${operation.opId}`, baseRevision: session.getRevision(), actor: { type: 'human', id: 'test' }, scope: { kind: 'document', permissions: ['structure', 'style', 'content', 'geometry'], allowInsert: false, allowDelete: false }, changeContract: { allowedOperationKinds: [operation.kind], maxChangedSlides: 1 }, createdAt: '2026-09-05T00:00:00Z', operations: [operation] }
}

test('absent background survives serialized inverse, both checkpoint writers and redo-only history', () => {
  const { document, imageBytes } = makeContractDocument()
  delete document.slides.slide_main.background
  const before = canonicalRevision(document)
  const session = new PpteSession(document)
  const result = session.commit(transaction(session, { opId: 'background', kind: 'slide.update', slideId: 'slide_main', patch: { background: { kind: 'solid', color: { kind: 'value', value: '#112233' } } } }))
  assert.equal(result.ok, true, JSON.stringify(result.issues))
  assert.deepEqual(result.inverseTransaction?.operations[0], { opId: result.inverseTransaction?.operations[0]?.opId, kind: 'slide.update', slideId: 'slide_main', patch: {}, unset: ['background'] })
  const options = { recentTransactions: session.getHistory().map(entry => entry.transaction), assetBytes: { asset_pixel: imageBytes } }
  for (const write of [buildCheckpointBytes, buildPortableCheckpointBytes]) {
    const opened = openCheckpointBytes(write(session.getDocument(), options))
    assert.equal(opened.manifest.operationProtocolVersion, '1.1')
    assert.equal(opened.manifest.compatibilityProfile, PPTE_EDIT_COMPATIBILITY_PROFILE)
    const restored = new PpteSession(opened.document)
    assert.equal(restored.undo().ok, true)
    assert.equal(restored.getRevision(), before)
    const redo = [...restored.getRedoHistory()]
    const redoOpened = openCheckpointBytes(write(restored.getDocument(), { ...options, recentTransactions: [], redoHistory: redo }))
    assert.equal(redoOpened.manifest.operationProtocolVersion, '1.1')
    const redoSession = new PpteSession(redoOpened.document)
    assert.equal(redoSession.redo().ok, true)
    assert.equal(redoSession.getRevision(), session.getRevision())
    assert.throws(() => write(session.getDocument(), { ...options, compatibilityProfile: inferCompatibilityProfile(document) }), /requires compatibility profile/)
  }
})

test('metadata presence is preserved through fixed-seed set/unset sequences', () => {
  const { document } = makeContractDocument()
  let current = document
  const inverse: Operation[][] = []
  let seed = 729
  for (let i = 0; i < 100; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const key = seed % 2 ? 'name' : 'hidden'
    const operation: Operation = { opId: String(i), kind: 'slide.update', slideId: 'slide_main', patch: seed % 3 ? { [key]: key === 'name' ? `Slide ${i}` : i % 2 === 0 } : {}, ...(seed % 3 ? {} : { unset: [key] }) }
    const result = applyOperation(current, operation)
    current = result.document
    inverse.push(JSON.parse(JSON.stringify(result.inverse)))
  }
  for (const operations of inverse.reverse()) for (const operation of operations) current = applyOperation(current, operation).document
  assert.equal(canonicalRevision(current), canonicalRevision(document))
})

test('unset rejects structure, duplicates, overlapping fields and out-of-scope changes without writes', () => {
  const { document } = makeContractDocument()
  let writes = 0
  const session = new PpteSession(document, { journal: { append() { writes++ } } })
  const before = session.getRevision()
  for (const unset of [['id'], ['elements'], ['background', 'background'], ['background']]) {
    const op: Operation = { opId: 'invalid', kind: 'slide.update', slideId: 'slide_main', patch: { background: { kind: 'none' } }, unset: unset as never }
    assert.equal(session.commit(transaction(session, op)).ok, false)
  }
  const tx = transaction(session, { opId: 'scope', kind: 'slide.update', slideId: 'slide_main', patch: {}, unset: ['background'] })
  tx.scope = { kind: 'selection', slideIds: ['another-slide'], permissions: ['style'], allowInsert: false, allowDelete: false }
  assert.equal(session.commit(tx).ok, false)
  assert.equal(session.getRevision(), before)
  assert.equal(session.getHistory().length, 0)
  assert.equal(writes, 0)
  assert.equal(requiresEditProtocol({ operations: tx.operations }), true)
})

test('background removal survives review patch serialization and rejects a downgraded protocol', () => {
  const { document } = makeContractDocument()
  document.slides.slide_main.background = { kind: 'solid', color: { kind: 'value', value: '#112233' } }
  const revised = structuredClone(document)
  delete revised.slides.slide_main.background
  const patch = createPatch(document, revised)
  assert.equal(patch.manifest.operationProtocolVersion, '1.1')
  const decoded = decodePatch(encodePatch(patch))
  const applied = applyPatchToDocument(document, decoded)
  assert.equal(applied.ok, true, JSON.stringify(applied.issues))
  assert.equal(canonicalRevision(applied.document!), canonicalRevision(revised))
  const old = structuredClone(patch)
  old.manifest.operationProtocolVersion = '1.0'
  old.manifest.compatibilityProfile = inferCompatibilityProfile(document)
  assert.equal(validatePatch(old).ok, false)
})

test('new protocol journal upgrades atomically and node session checkpoints infer persisted history', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ppte-unset-'))
  try {
    const { document, imageBytes } = makeContractDocument()
    delete document.slides.slide_main.background
    const path = join(directory, 'deck.ppte')
    writeCheckpoint(document, path, { assetBytes: { asset_pixel: imageBytes } })
    const opened = openFileSession(path)
    const result = opened.session.commit(transaction(opened.session, { opId: 'node-bg', kind: 'slide.update', slideId: 'slide_main', patch: { background: { kind: 'none' } } }))
    assert.equal(result.ok, true, JSON.stringify(result.issues))
    const journal = readJournal(`${path}.journal`)
    assert.equal(journal.complete, true)
    assert.equal(journal.header?.journalVersion, '2')
    assert.equal(replayJournal(document, journal).revision, opened.session.getRevision())
    const saved = opened.session.checkpoint(path)
    assert.equal(saved.ok, true, JSON.stringify(saved.issues))
    const restored = new PpteSession(openCheckpoint(path).document)
    assert.equal(restored.undo().ok, true)
    assert.equal(restored.getRevision(), canonicalRevision(document))
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('lossy floating-point inverse is rejected before the recovery journal or document changes', () => {
  const { document } = makeContractDocument()
  document.slides.slide_main.groups = { stress: { id: 'stress', memberIds: ['text_title', 'image_hero'] } }
  let writes = 0
  const session = new PpteSession(document, { journal: { append() { writes++ } } })
  const before = session.getRevision()
  const result = session.commit(transaction(session, { opId: 'lossy', kind: 'group.move', slideId: 'slide_main', groupId: 'stress', dx: 1e20, dy: 0 }))
  assert.equal(result.ok, false)
  assert.ok(result.issues.some(issue => issue.code === 'INVERSE_ROUNDTRIP_FAILED'), JSON.stringify(result.issues))
  assert.equal(session.getRevision(), before)
  assert.equal(writes, 0)
})

import { EDIT_PROFILE, GA_A_PROFILE, GA_B_PROFILE, GA_C_PROFILE, PROFILE_CAPABILITIES, profileIncludes, checkCompatibility } from '../packages/compatibility/src/index.js'
import { INVERSE_INTERPRETER_VERSION } from '../packages/core/src/index.js'
import { withPersistedHistoryMetadata } from '../packages/schema/src/file-format.js'
import { readFileSync } from 'node:fs'

test('edit descriptor is complete, immutable and registered in the JSON schema; capabilities include old readers', () => {
  assert.deepEqual(EDIT_PROFILE, {
    id: 'ppte-2.0-edit.1', formatVersion: '2', schemaVersion: '2.0.0', operationProtocolVersion: '1.1', slideIrVersion: '1.0', portableRuntimeVersion: '2.1.0', layoutRecipeVersion: '1.0', widgetAbiVersion: '1.0', patchVersion: '1', runtimeSubset: 'ga-c',
    migration: { from: [GA_A_PROFILE.id, GA_B_PROFILE.id, GA_C_PROFILE.id], direction: 'forward-only', preservesSource: true },
  })
  assert.ok(Object.isFrozen(EDIT_PROFILE))
  assert.ok(Object.isFrozen(EDIT_PROFILE.migration.from))
  for (const profile of [GA_A_PROFILE, GA_B_PROFILE, GA_C_PROFILE, EDIT_PROFILE]) {
    assert.ok(profileIncludes(EDIT_PROFILE.id, profile.id))
    assert.ok(PROFILE_CAPABILITIES[profile.id].length)
  }
  assert.equal(profileIncludes(GA_C_PROFILE.id, EDIT_PROFILE.id), false)
  assert.equal(profileIncludes('unknown', GA_A_PROFILE.id), false)
  assert.equal(checkCompatibility({ ...GA_A_PROFILE, id: 'ppte-2.0-unknown.1' }).disposition, 'reject')
  const schema = JSON.parse(readFileSync('schemas/compatibility-profile.schema.json', 'utf8'))
  assert.ok(schema.properties.id.enum.includes(EDIT_PROFILE.id))
  for (const key of schema.required) assert.ok(Object.hasOwn(EDIT_PROFILE, key))
  for (const [key, spec] of Object.entries(schema.allOf[0].then.properties) as [keyof typeof EDIT_PROFILE, { const: unknown }][]) assert.equal(EDIT_PROFILE[key], spec.const)
})

test('compatibility accounts for inverse-only and redo-only semantic capabilities', () => {
  const { document } = makeContractDocument()
  const session = new PpteSession(document)
  const tx = transaction(session, { opId: 'old', kind: 'slide.update', slideId: 'slide_main', patch: { name: 'old' } })
  const inverse = { ...tx, operations: [{ opId: 'poster', kind: 'slide.update', slideId: 'slide_main', patch: { visualStrategy: 'poster' } }] } as Transaction
  const metadata = { inverse, beforeRevision: session.getRevision(), afterRevision: session.getRevision() }
  const persisted = withPersistedHistoryMetadata(tx, metadata)
  assert.equal(inferCompatibilityProfile(document, { recentTransactions: [persisted] }), GA_C_PROFILE.id)
  assert.equal(inferCompatibilityProfile(document, { redoHistory: [{ transaction: tx, ...metadata }] }), GA_C_PROFILE.id)
  assert.equal(inferCompatibilityProfile(document, { operations: inverse.operations }), GA_C_PROFILE.id)
  inverse.operations = [{ opId: 'unset', kind: 'slide.update', slideId: 'slide_main', patch: {}, unset: ['name'] }]
  assert.equal(inferCompatibilityProfile(document, { recentTransactions: [withPersistedHistoryMetadata(tx, { ...metadata, inverse })] }), EDIT_PROFILE.id)
})

test('empty and absent overrides, including nested path removal, restore their exact presence', () => {
  for (const overrides of [undefined, {}, { color: { kind: 'value', value: '#123456' } }]) {
    const { document } = makeContractDocument()
    const element = document.slides.slide_main.elements.text_title
    assert.equal(element.type, 'text')
    if (element.type !== 'text') throw new Error('fixture')
    if (overrides === undefined) delete element.style.overrides
    else element.style.overrides = overrides as typeof element.style.overrides
    for (const operation of [
      { opId: 'style', kind: 'element.updateStyleOverrides', slideId: 'slide_main', elementId: element.id, patch: { fontSize: 32 } },
      { opId: 'clear', kind: 'element.clearStyleOverrides', slideId: 'slide_main', elementId: element.id },
      { opId: 'nested', kind: 'element.clearStyleOverrides', slideId: 'slide_main', elementId: element.id, paths: ['/color/value'] },
    ] as Operation[]) {
      const applied = applyOperation(document, operation)
      let restored = applied.document
      for (const inverse of JSON.parse(JSON.stringify(applied.inverse))) restored = applyOperation(restored, inverse).document
      assert.equal(canonicalRevision(restored), canonicalRevision(document))
      assert.equal(Object.hasOwn((restored.slides.slide_main.elements.text_title as typeof element).style, 'overrides'), overrides !== undefined)
    }
  }
})

test('Core refuses forged or changed proof bindings and never trusts caller preview revisions', () => {
  assert.equal(INVERSE_INTERPRETER_VERSION, 'ppte-operations/1.1:inverse-proof/1')
  for (const mode of ['binding', 'inverse', 'transaction', 'receipt'] as const) {
    const { document } = makeContractDocument()
    let writes = 0
    const session = new PpteSession(document, { journal: { append() { writes++ } } })
    const tx = transaction(session, { opId: mode, kind: 'slide.update', slideId: 'slide_main', patch: { name: 'changed' } })
    const original = session.preview.bind(session)
    session.preview = (input, options) => {
      const result = original(input, options)
      const map = (session as unknown as { verifiedApplies: WeakMap<object, { binding: string; applied: { inverseOperations: Operation[] } }> }).verifiedApplies
      const proof = map.get(result)!
      if (mode === 'binding') proof.binding = 'obsolete-interpreter-proof'
      if (mode === 'inverse') proof.applied.inverseOperations = []
      if (mode === 'transaction') input.operations = []
      if (mode === 'receipt') result.proposedRevision = 'sha256-forged'
      return result
    }
    const before = session.getRevision()
    const result = session.commit(tx)
    if (mode === 'receipt') {
      assert.equal(result.ok, true)
      assert.equal(session.getRevision(), canonicalRevision(session.getDocument()))
    } else {
      assert.equal(result.ok, false)
      assert.ok(result.issues.some(issue => issue.code === 'INVERSE_ROUNDTRIP_FAILED'))
      assert.equal(session.getRevision(), before)
      assert.equal(session.getHistory().length, 0)
      assert.equal(session.getRedoHistory().length, 0)
      assert.equal(writes, 0)
    }
  }
})

test('ordinary legacy checkpoint remains protocol 1.0 and preview does not authorize a later changed transaction', () => {
  const { document, imageBytes } = makeContractDocument()
  const bytes = buildCheckpointBytes(document, { assetBytes: { asset_pixel: imageBytes } })
  const opened = openCheckpointBytes(bytes)
  assert.equal(opened.manifest.operationProtocolVersion, '1.0')
  assert.equal(canonicalRevision(opened.document), canonicalRevision(document))
  const session = new PpteSession(opened.document)
  const tx = transaction(session, { opId: 'legacy', kind: 'slide.update', slideId: 'slide_main', patch: { name: 'new' } })
  assert.equal(session.preview(tx).ok, true)
  tx.operations = [{ opId: 'invalid', kind: 'slide.update', slideId: 'slide_main', patch: {}, unset: ['rootOrder'] as never }]
  assert.equal(session.commit(tx).ok, false)
  assert.equal(session.getRevision(), canonicalRevision(document))
})

test('group creation distinguishes absent and empty collections through durable inverses', () => {
  for (const present of [false, true]) {
    const { document } = makeContractDocument()
    if (present) document.slides.slide_main.groups = {}
    else delete document.slides.slide_main.groups
    const result = applyOperation(document, { opId: 'group', kind: 'group.create', slideId: 'slide_main', group: { id: 'new-group', memberIds: ['text_title', 'image_hero'] } })
    let restored = result.document
    for (const inverse of JSON.parse(JSON.stringify(result.inverse))) restored = applyOperation(restored, inverse).document
    assert.equal(canonicalRevision(restored), canonicalRevision(document))
    assert.equal(requiresEditProtocol({ operations: result.inverse }), !present)
  }
})

test('every optional slide metadata key restores absence and explicit values after JSON serialization', () => {
  const values = { name: 'Title', hidden: false, background: { kind: 'none' }, notes: {}, transition: { type: 'none' }, semantic: {}, visualStrategy: 'structured', provenance: {}, extensions: [] }
  for (const [key, value] of Object.entries(values)) {
    for (const present of [false, true]) {
      const { document } = makeContractDocument()
      const slide = document.slides.slide_main as unknown as Record<string, unknown>
      if (present) slide[key] = value
      else delete slide[key]
      const operation = { opId: key, kind: 'slide.update', slideId: 'slide_main', patch: present ? {} : { [key]: value }, ...(present ? { unset: [key] } : {}) } as Operation
      const applied = applyOperation(document, operation)
      let restored = applied.document
      for (const inverse of JSON.parse(JSON.stringify(applied.inverse))) restored = applyOperation(restored, inverse).document
      assert.equal(canonicalRevision(restored), canonicalRevision(document), `${key}: present=${present}`)
    }
  }
})

test('transaction JSON schema and TypeScript share the exact patch/unset whitelist', async () => {
  const { SLIDE_OPTIONAL_KEYS } = await import('../packages/schema/src/index.js')
  const schema = JSON.parse(readFileSync('schemas/transaction.schema.json', 'utf8'))
  const find = (value: unknown): Record<string, any> | undefined => {
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, any>
    if (record.properties?.kind?.const === 'slide.update') return record
    for (const child of Object.values(record)) { const result = find(child); if (result) return result }
  }
  const operation = find(schema)!
  assert.deepEqual(operation.properties.patch.propertyNames.enum, [...SLIDE_OPTIONAL_KEYS])
  assert.deepEqual(operation.properties.unset.items.enum, [...SLIDE_OPTIONAL_KEYS])
  assert.equal(operation.properties.unset.uniqueItems, true)
})
