import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildPortable, decodePortable, auditPortableBundle, configurePortableScript } from '../packages/portable-runtime/src/index.js'
import { portableBrowserScript } from '../packages/portable-runtime/src/browser-bundle.js'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { deliverPresentation } from '../packages/node-runtime/src/delivery.js'
import { openFileSession } from '../packages/node-runtime/src/index.js'
import { writeCheckpoint } from '../packages/file-format/src/index.js'

test('identity binds actual runtime and history while ignoring build timestamp', () => {
  const { document, imageBytes } = makeContractDocument()
  const options = { profile: 'full-portable' as const, assetBytes: { asset_pixel: imageBytes } }
  const first = buildPortable(document, { ...options, derivedAt: '2026-09-05T00:00:00Z' })
  const second = buildPortable(document, { ...options, derivedAt: '2026-09-06T00:00:00Z' })
  assert.equal(first.ok, true)
  const identity = decodePortable(first.html).artifactIdentity!
  assert.equal(identity.digest, decodePortable(second.html).artifactIdentity!.digest)
  assert.equal(auditPortableBundle(first.html).ok, true)
  const altered = first.html.replace('<script id="ppte-runtime">', '<script id="ppte-runtime">/* modified executable */')
  assert.equal(auditPortableBundle(altered).ok, false)
  try {
    configurePortableScript(portableBrowserScript + '\n/* next runtime build */')
    const next = buildPortable(document, options)
    assert.equal(next.ok, true)
    assert.notEqual(identity.digest, decodePortable(next.html).artifactIdentity!.digest)
  } finally { configurePortableScript(portableBrowserScript) }
})

test('same-document old runtime cannot be reused; versioned delivery preserves both artifacts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ppte-artifact-identity-'))
  try {
    const { document, imageBytes } = makeContractDocument()
    const path = join(directory, 'deck.ppte')
    writeCheckpoint(document, path, { assetBytes: { asset_pixel: imageBytes } })
    const { session } = openFileSession(path)
    const first = deliverPresentation(session, path)
    assert.equal(first.ok, true)
    const originalPath = first.artifacts[0]!.path
    const original = readFileSync(originalPath)
    configurePortableScript(portableBrowserScript + '\n/* upgraded runtime */')
    assert.equal(deliverPresentation(session, path).ok, false)
    const next = deliverPresentation(session, path, { collisionPolicy: 'versioned-copy' })
    assert.equal(next.ok, true, JSON.stringify(next.issues))
    assert.notEqual(next.artifacts[0]!.path, originalPath)
    assert.deepEqual(readFileSync(originalPath), original)
    assert.equal(deliverPresentation(session, path, { collisionPolicy: 'versioned-copy' }).artifacts[0]!.path, next.artifacts[0]!.path)
    assert.equal(deliverPresentation(session, path, { collisionPolicy: 'versioned-copy', replaceExisting: true, confirmed: true }).ok, false)
    const upgraded = readFileSync(next.artifacts[0]!.path, 'utf8')
    writeFileSync(next.artifacts[0]!.path, upgraded.replace('ppte-toolbar', 'modified-toolbar'))
    const collision = deliverPresentation(session, path, { collisionPolicy: 'versioned-copy' })
    assert.equal(collision.ok, true)
    assert.notEqual(collision.artifacts[0]!.path, next.artifacts[0]!.path)
  } finally { configurePortableScript(portableBrowserScript); rmSync(directory, { recursive: true, force: true }) }
})

test('redo-only history changes artifact identity without changing the document revision', async () => {
  const { PpteSession } = await import('../packages/core/src/index.js')
  const { MockAgent } = await import('../packages/agent-tools/src/index.js')
  const { document, imageBytes } = makeContractDocument()
  const session = new PpteSession(document)
  const transaction = new MockAgent().createTextReplaceTransaction(document, session.getRevision(), 'slide_main', 'text_body', { paragraphs: [{ id: 'p', runs: [{ id: 'r', text: 'Temporary edit' }] }] }, 'temporary')
  assert.equal(session.commit(transaction).ok, true)
  assert.equal(session.undo().ok, true)
  const options = { profile: 'full-portable' as const, assetBytes: { asset_pixel: imageBytes } }
  const clean = decodePortable(buildPortable(document, options).html)
  const redo = decodePortable(buildPortable(session.getDocument(), { ...options, redoHistory: [...session.getRedoHistory()] }).html)
  assert.equal(clean.origin.sourceRevision, redo.origin.sourceRevision)
  assert.notEqual(clean.artifactIdentity!.components.history, redo.artifactIdentity!.components.history)
  assert.notEqual(clean.artifactIdentity!.digest, redo.artifactIdentity!.digest)
})
