import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PpteSession, assessHistory, type HistoryEntry } from '../packages/core/src/index.js'
import { canonicalRevision } from '../packages/canonical-json/src/index.js'
import { applyOperation } from '../packages/operations/src/index.js'
import { buildCheckpointBytes, openCheckpointBytes, writeCheckpoint } from '../packages/file-format/src/index.js'
import { decodePortable } from '../packages/portable-runtime/src/index.js'
import { runtimeBudgetFor } from '../packages/portable-runtime/src/delivery-policy.js'
import { deliverPresentation } from '../packages/node-runtime/src/delivery.js'
import { openFileSession } from '../packages/node-runtime/src/index.js'
import { percentile } from '../packages/performance-budget/src/index.js'
import type { PpteDocument, Transaction } from '../packages/schema/src/index.js'
const root = 'tests/fixtures/evolution/'
const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const fixture = load(root + 'history-background.json') as { document: PpteDocument; transaction: Transaction; expected: { beforeRevision: string; afterRevision: string }; legacySerializedInverse: Transaction; invalidHistory: HistoryEntry[] }

test('C01 A01: frozen absent-background loss reproduces; current serialized checkpoint undo/redo restores exact revisions', () => {
  const session = new PpteSession(fixture.document)
  assert.equal(session.getRevision(), fixture.expected.beforeRevision)
  assert.equal(session.commit(fixture.transaction).ok, true)
  assert.equal(session.getRevision(), fixture.expected.afterRevision)
  let broken = session.getDocument()
  for (const operation of fixture.legacySerializedInverse.operations) broken = applyOperation(broken, operation).document
  assert.equal(canonicalRevision(broken), fixture.expected.afterRevision)
  assert.notEqual(canonicalRevision(broken), fixture.expected.beforeRevision)
  const reopened = new PpteSession(openCheckpointBytes(buildCheckpointBytes(session.getDocument(), { recentTransactions: session.getHistory().map(e => e.transaction) })).document)
  assert.equal(reopened.undo().ok, true)
  assert.equal(reopened.getRevision(), fixture.expected.beforeRevision)
  assert.equal(Object.hasOwn(reopened.getDocument().slides.bb_slide_main!, 'background'), false)
  assert.equal(reopened.redo().ok, true)
  assert.equal(reopened.getRevision(), fixture.expected.afterRevision)
})

test('C01 A03: immutable legal 1.0 checkpoint opens without migration or revision changes', () => {
  const opened = openCheckpointBytes(readFileSync(root + 'legacy-profile.ppte'))
  assert.equal(opened.manifest.operationProtocolVersion, '1.0')
  assert.equal(canonicalRevision(opened.document), fixture.expected.beforeRevision)
  assert.equal(new PpteSession(opened.document).getRevision(), fixture.expected.beforeRevision)
})

test('C01 A03: frozen incorrect inverse is rejected without modifying snapshot or evidence', () => {
  const session = new PpteSession(fixture.document)
  assert.equal(session.commit(fixture.transaction).ok, true)
  const original = JSON.stringify(fixture.invalidHistory)
  const assessment = assessHistory(session.getDocument(), fixture.invalidHistory)
  assert.equal(assessment.status, 'invalid')
  assert.equal(assessment.retained.length, 0)
  assert.throws(() => new PpteSession(session.getDocument(), { history: fixture.invalidHistory }), /HISTORY_RESTORE_FAILED/)
  assert.equal(JSON.stringify(fixture.invalidHistory), original)
  assert.equal(session.getRevision(), fixture.expected.afterRevision)
})

test('C01 A05: independently stored identity-less HTML is never reused or overwritten by delivery', () => {
  const bytes = readFileSync(root + 'legacy-identity.html')
  const payload = decodePortable(bytes.toString())
  assert.equal(payload.artifactIdentity, undefined)
  assert.equal(payload.origin.sourceRevision, fixture.expected.beforeRevision)
  const dir = mkdtempSync(join(tmpdir(), 'c01-identity-'))
  try {
    const source = join(dir, 'deck.ppte'); const target = join(dir, 'deck.editable.ppte.html')
    writeCheckpoint(fixture.document, source); writeFileSync(target, bytes)
    const { session } = openFileSession(source)
    assert.equal(deliverPresentation(session, source).ok, false)
    const result = deliverPresentation(session, source, { collisionPolicy: 'versioned-copy' })
    assert.equal(result.ok, true, JSON.stringify(result.issues))
    assert.notEqual(result.artifacts[0]!.path, target)
    assert.ok(decodePortable(readFileSync(result.artifacts[0]!.path, 'utf8')).artifactIdentity)
    assert.deepEqual(readFileSync(target), bytes)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('C01 provenance: every public original and frozen measurement has verified SHA256, source, environment and expected result', () => {
  const manifest = load(root + 'manifest.json')
  assert.match(manifest.baselineCommit, /^[0-9a-f]{40}$/)
  assert.ok(manifest.environment.node && manifest.environment.os)
  assert.equal(manifest.privateUserFilesIncluded, false)
  assert.equal(manifest.fixtures.length, 3)
  for (const entry of [...manifest.fixtures, ...manifest.evidence]) {
    assert.equal(createHash('sha256').update(readFileSync(entry.path)).digest('hex'), entry.sha256, entry.path)
    assert.ok(entry.source && entry.license === 'Apache-2.0')
    assert.ok(entry.expected && entry.observed)
  }
  assert.equal(manifest.fixtures[0].expected.beforeRevision, fixture.expected.beforeRevision)
  assert.equal(manifest.fixtures[0].expected.afterRevision, fixture.expected.afterRevision)
})

test('C01 A20: versioned E02 budget locks current profile limits and statistically complete real-browser baseline', () => {
  const budget = load('docs/evolution/quality/m1-dependency-budget.json')
  assert.equal(budget.version, 'c01-m1-v1')
  assert.deepEqual(budget.incrementalLimits, { runtimeGzipBytes: 100000, runtimeRawBytes: 350000, coldStartupP95Ms: 100, warmStartupP95Ms: 50, inputP95Ms: 16 })
  for (const profile of ['viewer', 'quick-fix', 'light-edit', 'full-portable'] as const) assert.equal(budget.runtimeGzipCapsBytes[profile], runtimeBudgetFor(profile))
  const report = load(budget.baselinePath)
  assert.equal(report.protocolVersion, budget.version)
  for (const key of budget.protocol.requiredEnvironment) assert.notEqual(report.environment[key], undefined)
  assert.deepEqual(report.cases.map((c: any) => c.pageCount), [12, 30, 100])
  for (const c of report.cases) {
    assert.match(c.htmlSha256, /^[0-9a-f]{64}$/)
    assert.ok(c.fixtureRevision && c.fontPolicy && c.runtimeGzipBytes > 0)
    for (const kind of ['cold', 'warm', 'input']) {
      const metric = c[kind]
      assert.equal(metric.samplesMs.length, kind === 'input' ? 30 : 20)
      assert.ok(metric.samplesMs.every((n: number) => Number.isFinite(n) && n > 0))
      assert.equal(metric.p50Ms, percentile(metric.samplesMs, .5))
      assert.equal(metric.p95Ms, percentile(metric.samplesMs, .95))
    }
  }
  const e02 = load('docs/evolution/TASKS.json').tasks.find((t: any) => t.id === 'E02')
  assert.equal(e02.budgetReference.version, budget.version)
  assert.equal(e02.budgetReference.path, 'docs/evolution/quality/m1-dependency-budget.json')
})
