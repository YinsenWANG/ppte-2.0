/** Versioned, window-bound stop-and-wait transport. Retries never reapply commands. */
export interface PresenterEnvelope {
  version: 1
  session: string
  token: string
  seq: number
  ack: number
  kind: 'data' | 'ack'
  payload?: unknown
}
export class PresenterChannel {
  private sent = 0
  private received = 0
  private pending?: PresenterEnvelope
  private queue: unknown[] = []
  private lastSeen: number
  private stopped = false
  constructor(private readonly options: {
    session: string; token: string; source: unknown; origin: string
    send: (message: PresenterEnvelope) => void
    receive: (payload: unknown) => void
    now: () => number
  }) { this.lastSeen = -Infinity }
  get connected(): boolean { return !this.stopped && this.options.now() - this.lastSeen < 3500 }
  send(payload: unknown, replaceQueued = false): boolean {
    if (this.stopped) return false
    if (this.pending) {
      if (replaceQueued) this.queue = [payload]
      else { if(this.queue.length >= 64) return false; this.queue.push(payload) }
      return true
    }
    this.pending = {version:1,session:this.options.session,token:this.options.token,seq:++this.sent,ack:this.received,kind:'data',payload}
    this.options.send(this.pending)
    return true
  }
  accept(event: {source: unknown; origin: string; data: unknown}): boolean {
    if (this.stopped || event.source !== this.options.source || event.origin !== this.options.origin || !event.data || typeof event.data !== 'object') return false
    const m = event.data as PresenterEnvelope
    if (m.version !== 1 || m.session !== this.options.session || m.token !== this.options.token || !Number.isSafeInteger(m.seq) || m.seq < 0 || !Number.isSafeInteger(m.ack) || m.ack < 0 || m.ack > this.sent || !['data','ack'].includes(m.kind)) return false
    if (m.kind === 'data' && (m.seq === 0 || m.seq > this.received + 1)) return false
    if (m.kind === 'ack' && m.seq !== 0) return false
    this.lastSeen = this.options.now()
    if (this.pending && m.ack === this.pending.seq) {
      this.pending = undefined
      const next = this.queue.shift()
      if (next !== undefined) this.send(next)
    }
    if (m.kind === 'data') {
      if (m.seq === this.received + 1) { this.received = m.seq; this.options.receive(m.payload) }
      this.options.send({version:1,session:this.options.session,token:this.options.token,seq:0,ack:this.received,kind:'ack'})
    }
    return true
  }
  tick(): void { if (!this.stopped && this.pending) this.options.send({...this.pending,ack:this.received}) }
  dispose(): void { this.stopped = true; this.pending = undefined; this.queue = [] }
}

/** Transient state has no document/session writer and uses a monotonic clock. */
export class PresenterTools {
  blackout = false
  laser = false
  private elapsed = 0
  private started?: number
  constructor(private readonly now: () => number) {}
  get running(): boolean { return this.started !== undefined }
  get elapsedMs(): number { return this.elapsed + (this.started === undefined ? 0 : Math.max(0,this.now()-this.started)) }
  toggleTimer(): void { if (this.started === undefined) this.started=this.now(); else {this.elapsed=this.elapsedMs;this.started=undefined} }
  resetTimer(): void { this.elapsed=0; if (this.running) this.started=this.now() }
}
