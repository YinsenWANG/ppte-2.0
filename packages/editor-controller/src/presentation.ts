/** Transient mode and fullscreen ownership; neither is persisted in the document. */
export class PresentationController {
  private mode: 'edit' | 'present' = 'edit'
  private epoch = 0
  private fullscreenOwned = false
  get isPresenting(): boolean { return this.mode === 'present' }
  get canMutate(): boolean { return this.mode === 'edit' }
  enter(flushDrafts: () => { ok: boolean }): boolean {
    if (this.isPresenting) return true
    if (!flushDrafts().ok) return false
    this.epoch++
    this.mode = 'present'
    return true
  }
  leave(): void { this.epoch++; this.mode = 'edit'; this.fullscreenOwned = false }

  async requestFullscreen(surface: HTMLElement): Promise<void> {
    const epoch = this.epoch
    if (!this.isPresenting) return
    try {
      await surface.requestFullscreen()
      if (epoch !== this.epoch || !this.isPresenting) {
        // A completion from an abandoned request must not resurrect presentation.
        if (!this.isPresenting && surface.ownerDocument.fullscreenElement === surface) await surface.ownerDocument.exitFullscreen()
        return
      }
      this.fullscreenOwned = surface.ownerDocument.fullscreenElement === surface
    } catch { /* Fullscreen is optional; never change mode on rejection. */ }
  }

  /** True only when the browser exited fullscreen owned by the current mode. */
  fullscreenChanged(surface: HTMLElement): boolean {
    if (surface.ownerDocument.fullscreenElement === surface) {
      if (this.isPresenting) this.fullscreenOwned = true
      else void surface.ownerDocument.exitFullscreen().catch(() => {})
      return false
    }
    return this.isPresenting && this.fullscreenOwned
  }
}
