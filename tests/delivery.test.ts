import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PpteSession, type CheckpointAdapter } from '../packages/core/src/index.js'
import { MockAgent } from '../packages/agent-tools/src/index.js'
import { openCheckpoint, writeCheckpoint, type CheckpointWriteOptions } from '../packages/file-format/src/index.js'
import { auditPortableBundle, buildPortable, resolveDeliveryPolicy, type EditableDeliveryProfile } from '../packages/portable-runtime/src/index.js'
import { deliverPresentation, editableSiblingPath } from '../apps/mcp/delivery.js'
import { makeContractDocument } from '../apps/contract-deck/index.js'

function checkpointSession(document: ReturnType<typeof makeContractDocument>['document'], imageBytes: Uint8Array, target: string): PpteSession {
  writeCheckpoint(document, target, { assetBytes: { asset_pixel: imageBytes }, timestamp: '2026-09-04T00:00:00.000Z' })
  const adapter: CheckpointAdapter<string, CheckpointWriteOptions> = {
    write: (snapshot, path, options, recentTransactions) => writeCheckpoint(snapshot, path, {
      ...(options ?? {}),
      assetBytes: { asset_pixel: imageBytes },
      recentTransactions: recentTransactions ? [...recentTransactions] : [],
      timestamp: '2026-09-04T00:00:00.000Z',
    }),
  }
  return new PpteSession(document, { checkpoint: adapter })
}

test('deliver_presentation is same-revision idempotent, sibling-only, and no-clobber', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ppte-delivery-contract-'))
  try {
    const { document, imageBytes } = makeContractDocument()
    const sourcePath = join(directory, '季度经营回顾.ppte')
    const session = checkpointSession(document, imageBytes, sourcePath)
    const target = editableSiblingPath(sourcePath)
    const unconfirmed = deliverPresentation(session, sourcePath, { replaceExisting: true })
    assert.equal(unconfirmed.ok, false)
    assert.equal(unconfirmed.issues.some((issue) => issue.code === 'DELIVERY_CONFIRMATION_REQUIRED'), true)
    const first = deliverPresentation(session, sourcePath)
    assert.equal(first.ok, true)
    assert.equal(first.effectiveProfile, 'full-portable')
    assert.equal(first.artifacts[0]?.primary, true)
    assert.equal(first.artifacts[0]?.path, target)
    assert.equal(first.sourceRevision, session.getRevision())
    assert.equal(first.artifacts.every((artifact) => artifact.sourceRevision === session.getRevision()), true)
    const firstBytes = readFileSync(target)
    assert.equal(auditPortableBundle(firstBytes.toString('utf8')).ok, true)
    assert.equal(openCheckpoint(sourcePath).manifest.contentRevision, session.getRevision())

    const second = deliverPresentation(session, sourcePath)
    assert.equal(second.ok, true)
    assert.deepEqual([...readFileSync(target)], [...firstBytes])

    const transaction = new MockAgent().createTextReplaceTransaction(session.getDocument(), session.getRevision(), 'slide_main', 'text_title', { paragraphs: [{ id: 'delivery-p', runs: [{ id: 'delivery-r', text: '交付后的标题' }] }] }, 'delivery-second-revision')
    assert.equal(session.commit(transaction).ok, true)
    const noClobber = deliverPresentation(session, sourcePath)
    assert.equal(noClobber.ok, false)
    assert.equal(noClobber.issues.some((issue) => issue.code === 'DELIVERY_TARGET_EXISTS'), true)
    assert.deepEqual([...readFileSync(target)], [...firstBytes])

    const replacement = deliverPresentation(session, sourcePath, { replaceExisting: true, confirmed: true })
    assert.equal(replacement.ok, true)
    assert.notDeepEqual([...readFileSync(target)], [...firstBytes])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('delivery fault points leave no half-file and preserve an old sibling', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ppte-delivery-fault-'))
  try {
    const { document, imageBytes } = makeContractDocument()
    const sourcePath = join(directory, 'fault.ppte')
    const session = checkpointSession(document, imageBytes, sourcePath)
    const target = editableSiblingPath(sourcePath)
    assert.equal(deliverPresentation(session, sourcePath).ok, true)
    const oldBytes = readFileSync(target)
    const transaction = new MockAgent().createTextReplaceTransaction(session.getDocument(), session.getRevision(), 'slide_main', 'text_title', { paragraphs: [{ id: 'fault-p', runs: [{ id: 'fault-r', text: 'fault revision' }] }] }, 'delivery-fault-revision')
    assert.equal(session.commit(transaction).ok, true)
    for (const fault of ['build', 'audit', 'before-rename'] as const) {
      const result = deliverPresentation(session, sourcePath, { replaceExisting: true, confirmed: true }, { fault })
      assert.equal(result.ok, false)
      assert.equal(result.issues.some((issue) => issue.code === 'DELIVERY_FAULT_INJECTED'), true)
      assert.deepEqual([...readFileSync(target)], [...oldBytes])
      assert.equal(readdirSync(directory).some((name) => name.endsWith('.tmp')), false)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('all four Portable profiles keep their explicit editability boundary', () => {
  const { document, imageBytes } = makeContractDocument()
  const results = (['viewer', 'quick-fix', 'light-edit', 'full-portable'] as const).map((profile) => buildPortable(document, { profile, assetBytes: { asset_pixel: imageBytes } }))
  assert.equal(results.every((result) => result.ok), true)
  assert.equal(results[0]?.html.includes('data-ppte-deliverable="false"'), true)
  assert.equal(results.slice(1).every((result) => result.html.includes('data-ppte-deliverable="true"')), true)
  assert.equal(results.slice(1).every((result) => result.html.includes('保存副本')), true)
  assert.equal(results[0]?.html.includes('保存副本'), false)
  assert.equal(results.every((result) => result.runtimeGzipBytes! <= result.budgetBytes!), true)
})

test('delivery rejects an unconfirmed replacement and arbitrary output paths', () => {
  assert.throws(() => editableSiblingPath('/tmp/deck.json'), /DELIVERY_SOURCE_INVALID/)
  assert.throws(() => editableSiblingPath('/tmp/deck'), /DELIVERY_SOURCE_INVALID/)
  assert.equal(editableSiblingPath('/tmp/deck/child.ppte'), '/tmp/deck/child.editable.ppte.html')
  const policy = resolveDeliveryPolicy()
  assert.equal(policy.profile, 'full-portable' satisfies EditableDeliveryProfile)
})
