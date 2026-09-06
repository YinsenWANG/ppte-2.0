import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { canonicalHash, cloneJson } from '../packages/canonical-json/src/index.js'
import { buildDerivedIndexes, PpteSession } from '../packages/core/src/index.js'
import { IncrementalDerivedIndexes } from '../packages/core/src/derived-indexes.js'
import { EditorController } from '../packages/editor-controller/src/index.js'
import { BackgroundJobs, nativeJobExecutor, type JobRequest, type JobProposal, type TrustedJobExecutor } from '../packages/editor-controller/src/background-jobs.js'
import type { Operation, Transaction } from '../packages/schema/src/index.js'

function transaction(session: PpteSession, operations: Operation[]): Transaction {
  return { transactionId: `p03-${session.getHistory().length}`, baseRevision: session.getRevision(), actor: { type: 'human', id: 'p03' }, createdAt: '2026-09-06T00:00:00Z', scope: { kind: 'document', permissions: ['content','geometry','structure','style','facts','sources','assets','theme','notes'], allowInsert: true, allowDelete: true }, changeContract: { allowedOperationKinds: operations.map(op => op.kind) }, operations }
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve))
function deferredExecutor() {
  const calls: { request: Readonly<JobRequest>; signal: AbortSignal; resolve: (value: JobProposal) => void; reject: (error: Error) => void }[] = []
  let disposed = 0
  const executor: TrustedJobExecutor = { run: (request, signal) => new Promise((resolve, reject) => { calls.push({ request, signal, resolve, reject }) }), dispose() { disposed++ } }
  const reply = (index: number, patch: Partial<JobProposal> = {}) => { const call = calls[index]; call.resolve({ jobId: call.request.jobId, baseRevision: call.request.baseRevision, inputDigest: call.request.inputDigest, hash: canonicalHash(call.request.input), ...patch }) }
  return { calls, executor, reply, get disposed() { return disposed } }
}

test('P03 criterion 1: all seven incremental indexes equal full rebuild across edits, undo, redo and failed commits', () => {
  const { document } = makeContractDocument()
  const session = new PpteSession(document)
  const check = () => assert.deepEqual(session.getDerivedIndexes(), buildDerivedIndexes(session.getDocument()))
  const batches: Operation[][] = [
    [{ opId: 'copy', kind: 'slide.duplicate', sourceSlideId: 'slide_main', newSlideId: 'copy' }],
    [{ opId: 'move', kind: 'element.move', slideId: 'slide_main', elementId: 'text_title', x: 123, y: 80 }],
    [{ opId: 'semantic', kind: 'element.setSemanticKey', slideId: 'slide_main', elementId: 'text_title', semanticKey: 'p03.title' }],
    [{ opId: 'refs', kind: 'element.setSemanticRefs', slideId: 'slide_main', elementId: 'text_title', semanticRefs: {} }],
    [{ opId: 'group', kind: 'group.create', slideId: 'slide_main', group: { id: 'p03-group', memberIds: ['text_title', 'text_body'] } }],
    [{ opId: 'ungroup', kind: 'group.delete', slideId: 'slide_main', groupId: 'p03-group' }],
    [{ opId: 'delete-copy', kind: 'slide.delete', slideId: 'copy' }],
  ]
  check()
  for (const operations of batches) {
    const result = session.commit(transaction(session, operations))
    assert.equal(result.ok, true, JSON.stringify(result.issues)); check()
    assert.equal(session.getIndexStats().updatedSlides, 1)
    assert.equal(session.undo().ok, true); check()
    assert.equal(session.redo().ok, true); check()
  }
  const unchanged = transaction(session, [{ opId: 'theme', kind: 'theme.setToken', category: 'colors', token: 'p03', value: '#123456' }])
  // Non-slide edits cannot invalidate any derived slide contributions.
  assert.equal(session.commit(unchanged).ok, true); check()
  assert.equal(session.getIndexStats().updatedSlides, 0)
  const before = session.getDerivedIndexes()
  assert.equal(session.commit(transaction(session, [{ opId: 'bad', kind: 'element.delete', slideId: 'missing', elementId: 'absent' }])).ok, false)
  assert.deepEqual(session.getDerivedIndexes(), before)
  before.slideByElement.clear(); before.roleIndex.clear(); check()
  session.rebuildDerivedIndexes(); check()
})

test('P03 criterion 1: randomized reference/group/asset mutations and injected partial failure rebuild safely', () => {
  let document = makeContractDocument().document
  const index = new IncrementalDerivedIndexes(document)
  let seed = 31
  for (let i = 0; i < 80; i++) {
    const next = cloneJson(document), slide = next.slides.slide_main
    seed = (seed * 1664525 + 1013904223) >>> 0
    const title = slide.elements.text_title
    title.role = seed % 2 ? 'title' : 'body'
    title.semanticRefs = { factIds: [`fact-${seed % 3}`], sourceIds: [`source-${seed % 7}`] }
    title.semanticKey = `key-${seed % 11}`
    if (slide.elements.image_hero.type === 'image') slide.elements.image_hero.assetId = `asset-${seed % 3}`
    slide.groups = { group: { id: 'group', memberIds: i % 2 ? ['text_title'] : ['text_title', 'image_hero'] } }
    if (i === 40) {
      // Throw after shard replacement, during reconciliation, to exercise rollback.
      const internal = index as unknown as { indexes: ReturnType<typeof buildDerivedIndexes> }
      internal.indexes.slideByElement.delete = () => { throw new Error('injected-index-fault') }
    }
    index.update(next)
    assert.deepEqual(index.snapshot(), buildDerivedIndexes(next))
    document = next
  }
  assert.equal(index.stats.rebuilds, 2)
  // Repeated identifiers across slides retain the exact full-build precedence.
  const next = cloneJson(document)
  next.slides.copy = cloneJson(next.slides.slide_main); next.slides.copy.id = 'copy'
  index.update(next); assert.deepEqual(index.snapshot(), buildDerivedIndexes(next))
  const reordered = cloneJson(next)
  reordered.slides = Object.fromEntries(Object.entries(reordered.slides).reverse())
  index.update(reordered); assert.deepEqual(index.snapshot(), buildDerivedIndexes(reordered))
  const mixed = cloneJson(next)
  mixed.slides.extra = { ...cloneJson(mixed.slides.slide_main), id: 'extra', elements: {}, groups: {}, rootOrder: [], readingOrder: [] }
  index.update(mixed); assert.deepEqual(index.snapshot(), buildDerivedIndexes(mixed))
  const removed = cloneJson(reordered); delete removed.slides.copy
  index.update(removed); assert.deepEqual(index.snapshot(), buildDerivedIndexes(removed))
})

test('P03 criterion 2: immutable input, unique identity, native proposal and single-use consumption', async () => {
  const pool = new BackgroundJobs(() => 'rev')
  const input = { text: 'original' }, handle = pool.submit(input)
  input.text = 'changed'
  const result = await handle.result
  assert.equal(result.status, 'ready')
  if (result.status !== 'ready') return
  assert.equal(result.proposal.inputDigest, canonicalHash({ text: 'original' }))
  assert.equal(pool.take({ ...result.proposal }), undefined)
  assert.equal(pool.take(result.proposal), result.proposal.inputDigest)
  assert.equal(pool.take(result.proposal), undefined)
  const cancelled = pool.submit({})
  assert.notEqual(cancelled.jobId, handle.jobId)
  const delivered = await cancelled.result
  cancelled.cancel()
  if (delivered.status === 'ready') assert.equal(pool.take(delivered.proposal), undefined)
  pool.dispose()
  await assert.rejects(nativeJobExecutor().run({ kind: 'eval', input: 'process.exit()', jobId: 'bad', baseRevision: 'r', inputDigest: '' } as unknown as JobRequest, new AbortController().signal), /UNSUPPORTED/)
})

test('P03 criteria 2/3: out-of-order, changed revision/input, forged envelopes and late consumption never publish stale output', async () => {
  for (const field of ['jobId', 'baseRevision', 'inputDigest', 'hash'] as const) {
    const fake = deferredExecutor(), pool = new BackgroundJobs(() => 'rev', fake.executor)
    const job = pool.submit('input'); await tick(); fake.reply(0, { [field]: 'forged' })
    assert.equal((await job.result).status, 'failed'); pool.dispose()
  }
  let revision = 'rev'
  const fake = deferredExecutor(), pool = new BackgroundJobs(() => revision, fake.executor, { concurrency: 2, queue: 1 })
  const first = pool.submit('old'), second = pool.submit('new'); await tick()
  fake.reply(1); const result = await second.result
  fake.reply(0); assert.equal((await first.result).status, 'stale')
  assert.equal(result.status, 'ready'); revision = 'new-revision'
  if (result.status === 'ready') assert.equal(pool.take(result.proposal), undefined)
  await tick()
  const third = pool.submit('third'); await tick(); revision = 'changed-again'; fake.reply(2)
  assert.equal((await third.result).status, 'stale')
  pool.dispose()
})

test('P03 criteria 2/3: running/queued/pre-abort, timeout, backpressure, executor failure and close release resources', async () => {
  const fake = deferredExecutor(), pool = new BackgroundJobs(() => 'rev', fake.executor, { concurrency: 1, queue: 1 })
  const abort = new AbortController(), first = pool.submit(1, { signal: abort.signal })
  const second = pool.submit(2); await tick()
  assert.throws(() => pool.submit(3), /BACKPRESSURE/)
  abort.abort(); assert.equal((await first.result).status, 'cancelled'); assert.equal(fake.calls[0].signal.aborted, true)
  assert.equal(pool.state.running, 1); assert.throws(() => pool.submit(4), /BACKPRESSURE/)
  second.cancel(); assert.equal((await second.result).status, 'cancelled')
  const timed = pool.submit(5, { timeoutMs: 5 }); assert.equal((await timed.result).status, 'timeout')
  fake.reply(0); await tick(); assert.deepEqual(pool.state, { running: 0, queued: 0, closed: false })
  const pre = pool.submit(6, { signal: abort.signal }); assert.equal((await pre.result).status, 'cancelled')
  const failed = pool.submit(7); await tick(); fake.calls[1].reject(new Error('worker crash'))
  assert.equal((await failed.result).status, 'failed'); await tick()
  const late = pool.submit(8); await tick(); pool.dispose(); pool.dispose()
  assert.equal((await late.result).status, 'stale'); fake.reply(2); await tick()
  assert.equal(fake.disposed, 1); assert.deepEqual(pool.state, { running: 0, queued: 0, closed: true })
  assert.throws(() => pool.submit(9), /CLOSED/)
  const hung = deferredExecutor(), timeoutPool = new BackgroundJobs(() => 'rev', hung.executor)
  const timeout = timeoutPool.submit('running', { timeoutMs: 5 }); await tick()
  assert.equal((await timeout.result).status, 'timeout'); assert.equal(hung.calls[0].signal.aborted, true)
  hung.reply(0); await tick(); timeoutPool.dispose()
})

test('P03 criterion 3: controller commits invalidate proposals and file close disposes owned work; Engine rejects stale transactions', async () => {
  const session = new PpteSession(makeContractDocument().document), controller = new EditorController(session)
  const pool = controller.createBackgroundJobs()
  const staleTransaction = transaction(session, [{ opId: 'move', kind: 'element.move', slideId: 'slide_main', elementId: 'text_title', x: 123, y: 80 }])
  const job = pool.submit(session.getDocument()), ready = await job.result
  assert.equal(ready.status, 'ready')
  assert.equal(session.commit(staleTransaction).ok, true)
  if (ready.status === 'ready') assert.equal(pool.take(ready.proposal), undefined)
  assert.equal(session.commit(staleTransaction).ok, false)
  const closing = pool.submit(session.getDocument()); controller.dispose()
  assert.equal((await closing.result).status, 'stale'); assert.equal(pool.state.closed, true)
})

test('P03 criteria 2/3: real Chromium native/Worker total costs use pinned fixtures and retain raw samples', async () => {
  const script = await import(pathToFileURL(resolve('scripts/p03-job-benchmark.mjs')).href)
  const report = await script.profileJobs()
  const recorded = JSON.parse(readFileSync('docs/evolution/quality/p03-job-costs.json', 'utf8'))
  assert.deepEqual(report.cases.map((c: any) => c.pageCount), [12, 30, 100])
  assert.deepEqual(report.cases.map((c: any) => c.fixtureDigest), recorded.cases.map((c: any) => c.fixtureDigest))
  for (const c of report.cases) {
    assert.ok(c.coldWorkerTotalMs > 0)
    for (const values of Object.values(c.samples) as number[][]) {
      assert.equal(values.length, 30); assert.ok(values.every(value => Number.isFinite(value) && value >= 0))
    }
  }
  for (const c of recorded.cases) {
    for (const [name, samples] of Object.entries(c.samples) as [string, number[]][]) {
      assert.equal(samples.length, 30)
      assert.equal(c.p95[name], [...samples].sort((a, b) => a - b)[28])
    }
    assert.ok(c.p95.workerTotalMs > c.p95.nativeTotalMs, 'Retained evidence must justify leaving Worker migration disabled')
  }
  assert.deepEqual(recorded.migrations, [])
  assert.match(recorded.scope, /not a script sandbox/)
})


test('P03 criterion 1: pinned 12/30/100-page corpora update one slide and match the full oracle', async () => {
  const perf = await import(pathToFileURL(resolve('scripts/perf-browser.mjs')).href)
  for (const count of [12, 30, 100]) {
    const { document } = await perf.makeFixture(count)
    const session = new PpteSession(document)
    const slideId = document.slideOrder[0], elementId = document.slides[slideId].rootOrder[0]
    const frame = document.slides[slideId].elements[elementId].frame
    const result = session.commit(transaction(session, [{ opId: 'local', kind: 'element.move', slideId, elementId, x: frame.x + 1, y: frame.y }]))
    assert.equal(result.ok, true, JSON.stringify(result.issues))
    assert.equal(session.getIndexStats().updatedSlides, 1)
    assert.equal(session.getIndexStats().rebuilds, 1)
    assert.deepEqual(session.getDerivedIndexes(), buildDerivedIndexes(session.getDocument()))
  }
})
