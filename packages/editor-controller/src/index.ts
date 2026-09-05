import type { PpteSession, SessionEvent } from '../../core/src/index.js'
import type { CommitResult, PreviewResult, Transaction, ValidationIssue } from '../../schema/src/index.js'
import { cloneJson } from '../../canonical-json/src/index.js'
import { PresentationState } from './mode.js'
import { commandPolicy, type EditorProfile } from './policy.js'
import { CommandRegistry, planTransaction } from './commands.js'
import type { SelectionState } from './selection.js'
export * from './commands.js'
export * from './selection.js'
export * from './policy.js'
export { PresentationState } from './mode.js'

/** Structural port: no Core construction, platform imports or second history. */
export type SessionPort = Pick<PpteSession, 'getDocument' | 'getRevision' | 'getHistory' | 'getRedoHistory' | 'preview' | 'commit' | 'undo' | 'redo' | 'subscribe'>
export type CommandResult = CommitResult & { status: 'committed' | 'no-op' | 'blocked' | 'conflict' | 'cancelled'; revision: string }
export type EditorCommand = { kind: 'commit'; transaction: Transaction } | { kind: 'undo' | 'redo' } | { kind: 'registered'; name: string; input: unknown }
export interface Draft { epoch: number; transaction: Transaction; composing?: boolean }
export class EditorController {
  readonly registry = new CommandRegistry()
  readonly presentation: PresentationState
  private disposed = false
  private busy = false
  private queued = 0
  private tail: Promise<unknown> = Promise.resolve()
  private listeners = new Set<(event: SessionEvent) => void>()
  private release: () => void
  private releases = new Set<() => void>()
  private flushHandler?: () => { ok: boolean; issues?: ValidationIssue[] }
  private flushing = false
  private draft?: Draft
  private draftEpoch = 0
  private flights = new Map<number, Promise<CommandResult>>()
  private selection?: SelectionState
  constructor(readonly session: SessionPort, readonly profile: EditorProfile = 'host', presentation = new PresentationState(), private readonly beforeWrite: (action: 'commit' | 'undo' | 'redo') => void = () => {}) {
    this.presentation = presentation
    this.release = session.subscribe(event => {
      if (this.selection && event.type !== 'previewed') {
        const slide = session.getDocument().slides[this.selection.slideId]
        this.selection.elementIds = this.selection.elementIds.filter(id => slide?.elements[id])
        if (!this.selection.elementIds.includes(this.selection.primaryElementId ?? '')) this.selection.primaryElementId = undefined
      }
      for (const listener of this.listeners) { try { listener(event) } catch { /* observers cannot reject a committed edit */ } }
    })
  }
  getState() { return { revision: this.session.getRevision(), selection: this.selection && cloneJson(this.selection), draft: this.draft && cloneJson(this.draft), mode: this.presentation.isPresenting ? 'present' : 'edit' } }
  setSelection(selection: SelectionState): void { if (!this.disposed) this.selection = cloneJson(selection) }
  subscribe(listener: (event: SessionEvent) => void): () => void { if (this.disposed) return () => {}; this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  own(release: () => void): () => void { if (this.disposed) release(); else this.releases.add(release); return () => { if (this.releases.delete(release)) release() } }
  private result(issues: ValidationIssue[] = [], status: CommandResult['status'] = 'blocked'): CommandResult {
    const revision = this.session.getRevision()
    return { ok: status === 'no-op', status, revision, beforeRevision: revision, transactionId: '', issues }
  }
  private blocked(code: string, message = code): CommandResult { return this.result([{code, message, severity: 'error'}], code.includes('CONFLICT') ? 'conflict' : 'blocked') }
  private transaction(command: EditorCommand): Transaction | undefined {
    const context = { document: this.session.getDocument(), revision: this.session.getRevision() }
    return command.kind === 'commit' ? planTransaction(context, command.transaction) : command.kind === 'registered' ? this.registry.plan(command.name, context, command.input) : undefined
  }
  can(command: EditorCommand): PreviewResult {
    if (this.disposed) return { ok: false, baseRevision: this.session.getRevision(), issues: this.blocked('CONTROLLER_DISPOSED').issues }
    const transaction = this.transaction(command)
    const issues = commandPolicy(this.profile, this.presentation.canMutate, transaction)
    return issues.length || !transaction ? { ok: !issues.length, baseRevision: this.session.getRevision(), issues } : this.session.preview(transaction)
  }
  preview(transaction: Transaction): PreviewResult { return this.can({ kind: 'commit', transaction }) }
  /** Synchronous legacy facades share the same serialization gate as queued commands. */
  commit(transaction: Transaction): CommandResult { return this.executeSync({ kind: 'commit', transaction }) }
  undo(): CommandResult { return this.executeSync({kind:'undo'}) }
  redo(): CommandResult { return this.executeSync({kind:'redo'}) }
  executeSync(command: EditorCommand): CommandResult {
    if (this.busy || (this.queued && !this.flushing)) return this.blocked('COMMAND_BUSY')
    if (command.kind === 'undo' || command.kind === 'redo') {
      const flushed = this.flushNow(); if (!flushed.ok) return flushed
    }
    return this.run(command)
  }
  private run(command: EditorCommand): CommandResult {
    if (this.disposed) return this.blocked('CONTROLLER_DISPOSED')
    this.busy = true
    try {
      const transaction = this.transaction(command)
      const issues = commandPolicy(this.profile, this.presentation.canMutate, transaction)
      if (issues.length) return this.result(issues)
      if (transaction || command.kind === 'undo' || command.kind === 'redo') this.beforeWrite(command.kind === 'undo' || command.kind === 'redo' ? command.kind : 'commit')
      const result = command.kind === 'undo' ? this.session.undo() : command.kind === 'redo' ? this.session.redo() : transaction ? this.session.commit(transaction) : undefined
      if (!result) return this.result([], 'no-op')
      return { ...result, revision: this.session.getRevision(), status: result.ok ? 'committed' : result.issues.some(i => i.code.includes('CONFLICT')) ? 'conflict' : 'blocked' }
    } catch (cause) { return this.blocked('COMMAND_FAILED', String(cause)) }
    finally { this.busy = false }
  }
  private enqueue(action: () => CommandResult | Promise<CommandResult>): Promise<CommandResult> {
    this.queued++
    const next = this.tail.then(() => action()).finally(() => { this.queued-- })
    this.tail = next.catch(() => {})
    return next
  }
  execute(command: EditorCommand): Promise<CommandResult> {
    const captured = cloneJson(command)
    return this.enqueue(() => {
      const flush = this.flushNow()
      return flush.ok ? this.run(captured) : flush
    })
  }
  setDraft(transaction: Transaction, composing = false): number {
    if (this.disposed) return this.draftEpoch
    this.draft = { epoch: ++this.draftEpoch, transaction: cloneJson(transaction), composing }
    return this.draftEpoch
  }
  setFlushHandler(handler: () => { ok: boolean; issues?: ValidationIssue[] }): void { this.flushHandler = handler }
  flushSync(): CommandResult {
    if (this.busy || this.queued) return this.blocked('COMMAND_BUSY')
    return this.flushNow()
  }
  private flushNow(): CommandResult {
    if (this.disposed) return this.blocked('CONTROLLER_DISPOSED')
    if (this.flushHandler && !this.flushing) {
      this.flushing = true
      try {
        const result = this.flushHandler()
        if (!result.ok) return this.result(result.issues ?? [{ code: 'FLUSH_BLOCKED', message: 'Draft flush failed.', severity: 'error' }])
      } catch (cause) { return this.blocked('FLUSH_FAILED', String(cause)) }
      finally { this.flushing = false }
    }
    const draft = this.draft
    if (!draft) return this.result([], 'no-op')
    if (draft.composing) return this.blocked('COMPOSITION_ACTIVE')
    const result = this.run({ kind: 'commit', transaction: draft.transaction })
    if (result.ok && this.draft?.epoch === draft.epoch) this.draft = undefined
    return result
  }
  flush(_reason: string = 'blur'): Promise<CommandResult> {
    const epoch = this.draftEpoch
    const existing = this.flights.get(epoch)
    if (existing) return existing
    const result = this.enqueue(() => epoch === this.draftEpoch ? this.flushNow() : this.result([], 'cancelled')).finally(() => { this.flights.delete(epoch) })
    this.flights.set(epoch, result)
    return result
  }
  /** A save/navigation/mode effect runs only after a successful draft boundary. */
  boundary(effect: () => void | Promise<void>): Promise<CommandResult> {
    return this.enqueue(async () => {
      const result = this.flushNow()
      if (!result.ok) return result
      try { await effect(); return result }
      catch (cause) { return this.blocked('BOUNDARY_FAILED', String(cause)) }
    })
  }
  cancelTransient(_reason = 'cancel'): void { this.draftEpoch++; this.draft = undefined; this.selection = undefined }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true; this.release(); this.listeners.clear(); this.cancelTransient('dispose'); this.presentation.leave()
    for (const release of this.releases) { try { release() } catch { /* release the remaining resources */ } }
    this.releases.clear(); this.flights.clear(); this.flushHandler = undefined
  }
}

export * from "./object-commands.js"
export * from './transform-session.js'
