import { PresentationState } from '../../editor-controller/src/mode.js'

/** Transient mode and fullscreen ownership; neither is persisted in the document. */
export class PresentationController extends PresentationState {
  private fullscreenOwned = false
  override leave(): void { super.leave(); this.fullscreenOwned = false }

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

/** Platform resources are owned by the shell and released with its controller. */
export class DomResources {
  private cleanups = new Set<() => void>()
  private disposed = false
  own(cleanup: () => void): () => void {
    if (this.disposed) { cleanup(); return () => {} }
    this.cleanups.add(cleanup)
    return () => { if (this.cleanups.delete(cleanup)) cleanup() }
  }
  listen<K extends keyof (GlobalEventHandlersEventMap & WindowEventMap & DocumentEventMap)>(target: EventTarget, type: K, listener: (event: (GlobalEventHandlersEventMap & WindowEventMap & DocumentEventMap)[K]) => void, options?: boolean | AddEventListenerOptions): void {
    target.addEventListener(type, listener as EventListener, options)
    this.own(() => target.removeEventListener(type, listener as EventListener, options))
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const cleanup of this.cleanups) { try { cleanup() } catch { /* release all resources */ } }
    this.cleanups.clear()
  }
}
export * from './pointer.js'
