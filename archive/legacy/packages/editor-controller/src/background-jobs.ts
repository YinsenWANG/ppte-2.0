import { canonicalHash, cloneJson, deepFreeze } from '../../canonical-json/src/index.js'

/** Closed operation vocabulary: no source strings, module URLs, widgets or eval.
 * A Worker is a scheduling mechanism for trusted application code, NOT a sandbox.
 */
export interface JobRequest {
  jobId: string
  kind: 'canonical-hash'
  baseRevision: string
  inputDigest: string
  input: unknown
}
export interface JobProposal {
  jobId: string
  baseRevision: string
  inputDigest: string
  hash: string
}
export interface TrustedJobExecutor {
  /** Abort must release/terminate the underlying work before the promise settles. */
  run(request: Readonly<JobRequest>, signal: AbortSignal): Promise<JobProposal>
  dispose(): void
}
export const nativeJobExecutor = (): TrustedJobExecutor => ({
  async run(request, signal) {
    if (signal.aborted) throw new Error('JOB_CANCELLED')
    if (request.kind !== 'canonical-hash') throw new Error('JOB_KIND_UNSUPPORTED')
    return { jobId: request.jobId, baseRevision: request.baseRevision, inputDigest: request.inputDigest, hash: canonicalHash(request.input) }
  },
  dispose() {},
})
export type JobOutcome = { status: 'ready'; proposal: Readonly<JobProposal> } | { status: 'cancelled' | 'timeout' | 'stale' | 'failed' }
export interface JobHandle { jobId: string; result: Promise<JobOutcome>; cancel(): void }
interface Entry {
  request: Readonly<JobRequest>
  controller: AbortController
  resolve: (outcome: JobOutcome) => void
  settled: boolean
  timer?: ReturnType<typeof setTimeout>
  detach: () => void
  deadline: number
}

/** One latest-input-wins lane with a bounded native queue by default; no per-edit Worker creation. Outputs are
 * derived proposals only. Document writes still require the Operation Engine.
 */
let poolSequence = 0
export class BackgroundJobs {
  private readonly poolId = ++poolSequence
  private sequence = 0
  private closed = false
  private running = new Set<Entry>()
  private queue: Entry[] = []
  private accepted = new WeakMap<JobProposal, Entry>()
  private latest = ''
  constructor(
    private readonly currentRevision: () => string,
    private readonly executor: TrustedJobExecutor = nativeJobExecutor(),
    private readonly limits = { concurrency: 1, queue: 4 },
  ) {
    if (!Number.isInteger(limits.concurrency) || limits.concurrency < 1 || !Number.isInteger(limits.queue) || limits.queue < 0) throw new Error('JOB_LIMIT_INVALID')
  }
  get state() { return { running: this.running.size, queued: this.queue.length, closed: this.closed } }

  submit(input: unknown, options: { signal?: AbortSignal; timeoutMs?: number } = {}): JobHandle {
    if (this.closed) throw new Error('JOB_CLOSED')
    if (this.running.size >= this.limits.concurrency && this.queue.length >= this.limits.queue) throw new Error('JOB_BACKPRESSURE')
    const timeout = options.timeoutMs ?? 30_000
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 2_147_483_647) throw new Error('JOB_TIMEOUT_INVALID')
    const snapshot = deepFreeze(cloneJson(input))
    const request = deepFreeze({ jobId: `pool-${this.poolId}:job-${++this.sequence}`, kind: 'canonical-hash' as const, baseRevision: this.currentRevision(), inputDigest: canonicalHash(snapshot), input: snapshot })
    let resolve!: Entry['resolve']
    const result = new Promise<JobOutcome>(done => { resolve = done })
    const entry: Entry = { request, controller: new AbortController(), resolve, settled: false, detach: () => {}, deadline: Date.now() + timeout }
    const cancel = () => this.stop(entry, 'cancelled')
    this.latest = request.jobId
    if (options.signal?.aborted) {
      this.stop(entry, 'cancelled')
    } else {
      options.signal?.addEventListener('abort', cancel, { once: true })
      entry.detach = () => options.signal?.removeEventListener('abort', cancel)
      entry.timer = setTimeout(() => this.stop(entry, 'timeout'), timeout)
      this.queue.push(entry)
      this.pump()
    }
    return { jobId: request.jobId, result, cancel }
  }

  /** Check again when consumed, since revision/input may change after delivery.
   * Single-use identity also rejects forged or mutated proposal envelopes.
   */
  take(proposal: Readonly<JobProposal>): string | undefined {
    const entry = this.accepted.get(proposal)
    this.accepted.delete(proposal)
    if (!entry || entry.controller.signal.aborted || Date.now() >= entry.deadline || this.closed || proposal.jobId !== this.latest || proposal.baseRevision !== this.currentRevision()) return undefined
    return proposal.hash
  }

  invalidate(): void {
    this.latest = ''
    for (const entry of [...this.queue, ...this.running]) this.stop(entry, 'stale')
  }
  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.invalidate()
    this.executor.dispose()
  }
  private finish(entry: Entry, outcome: JobOutcome): void {
    if (entry.settled) return
    entry.settled = true
    clearTimeout(entry.timer)
    entry.detach()
    this.queue = this.queue.filter(item => item !== entry)
    entry.resolve(outcome)
  }
  private stop(entry: Entry, status: 'cancelled' | 'timeout' | 'stale'): void {
    this.finish(entry, { status })
    entry.controller.abort()
    // Keep the physical slot occupied until the executor acknowledges abort.
    // An uncooperative executor cannot grow an unbounded set of abandoned jobs.
  }
  private pump(): void {
    while (!this.closed && this.running.size < this.limits.concurrency && this.queue.length) {
      const entry = this.queue.shift()!
      this.running.add(entry)
      void Promise.resolve().then(() => {
        if (entry.settled) return undefined
        return this.executor.run(entry.request, entry.controller.signal)
      }).then(proposal => {
        if (entry.settled) return
        if (Date.now() >= entry.deadline) { this.stop(entry, 'timeout'); return }
        const request = entry.request
        if (this.closed || request.jobId !== this.latest || request.baseRevision !== this.currentRevision()) { this.finish(entry, { status: 'stale' }); return }
        if (!proposal || proposal.jobId !== request.jobId || proposal.baseRevision !== request.baseRevision || proposal.inputDigest !== request.inputDigest || proposal.hash !== request.inputDigest) {
          this.finish(entry, { status: 'failed' }); return
        }
        const copy = Object.freeze({ ...proposal })
        this.accepted.set(copy, entry)
        this.finish(entry, { status: 'ready', proposal: copy })
      }, () => this.finish(entry, { status: 'failed' })).finally(() => {
        this.running.delete(entry)
        this.pump()
      })
    }
  }
}
