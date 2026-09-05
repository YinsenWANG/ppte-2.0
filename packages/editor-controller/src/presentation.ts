/** Transient editor state. Fullscreen is a display option, independent of this mode. */
export class PresentationController {
  private mode: 'edit' | 'present' = 'edit'
  get isPresenting(): boolean { return this.mode === 'present' }
  get canMutate(): boolean { return this.mode === 'edit' }
  enter(flushDrafts: () => { ok: boolean }): boolean {
    if (this.isPresenting) return true
    if (!flushDrafts().ok) return false
    this.mode = 'present'
    return true
  }
  leave(): void { this.mode = 'edit' }
}
