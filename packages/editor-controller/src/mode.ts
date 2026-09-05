/** Pure transient presentation state; platform effects belong to editor-dom. */
export class PresentationState {
  private mode: 'edit' | 'present' = 'edit'
  protected epoch = 0
  get isPresenting(): boolean { return this.mode === 'present' }
  get canMutate(): boolean { return this.mode === 'edit' }
  enter(flushDrafts: () => { ok: boolean }): boolean {
    if (this.isPresenting) return true
    if (!flushDrafts().ok) return false
    this.epoch++
    this.mode = 'present'
    return true
  }
  leave(): void { this.epoch++; this.mode = 'edit' }
}
