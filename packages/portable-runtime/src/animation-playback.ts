import type { Slide } from '../../schema/src/index.js'

export const ANIMATION_MAX_MS = 10000
export const animationTime = (value = 0): number => Math.max(0, Math.min(ANIMATION_MAX_MS, Number.isFinite(value) ? value : 0))
export const ENTER_EFFECTS = ['fade', 'slide-up', 'slide-left'] as const

/** Shared Host/Portable playback. Effects are transient and never modify the model. */
export class AnimationPlayback {
  private nodes = new WeakMap<HTMLElement, boolean>()
  private slideId?: string
  private playing = new Set<Animation>()
  private transitions = new Map<Animation, { horizontal: boolean; sign: number; outgoing: boolean }>()
  private outgoing?: HTMLElement
  private snapshot?: HTMLElement
  apply(root: HTMLElement, slide: Slide, step: number, presenting: boolean, reduced = root.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches ?? false): void {
    const changed = this.slideId !== slide.id
    if (!presenting || reduced || changed) this.cancel()
    const active = root.matches('.ppte-slide') ? root : root.querySelector<HTMLElement>('.ppte-slide')
    if (!active) return
    const animate = (node: HTMLElement, frames: Keyframe[], duration: number, delay = 0, easing = 'ease') => {
      if (reduced || (duration === 0 && delay === 0)) return
      const effect = node.animate(frames, {duration, delay, easing, fill: 'backwards'})
      this.playing.add(effect)
      effect.onfinish = () => { this.playing.delete(effect); this.transitions.delete(effect); effect.cancel() }
      return effect
    }
    for (const node of Array.from(active.querySelectorAll<HTMLElement>('[data-ppte-element-id]'))) {
      const element = slide.elements[node.dataset.ppteElementId!]
      if (!element) continue
      const visible = !presenting || (element.appearStep ?? 0) <= step
      const before = this.nodes.get(node)
      node.style.visibility = visible ? 'visible' : 'hidden'
      if (!visible) node.getAnimations().forEach(a => a.cancel())
      const enter = element.animation?.enter
      if (presenting && visible && (changed || before !== true) && enter && ENTER_EFFECTS.includes(enter.type as typeof ENTER_EFFECTS[number])) {
        const opacity = element.opacity ?? 1
        const from: Keyframe = {opacity: 0}
        const to: Keyframe = {opacity}
        if (enter.type !== 'fade') { from.translate = enter.type === 'slide-up' ? '0 16px' : '16px 0'; to.translate = '0 0' }
        animate(node, [from, to], animationTime(enter.durationMs), animationTime(enter.delayMs), enter.easing)
      }
      this.nodes.set(node, presenting && visible)
    }
    const transition = slide.transition
    if (presenting && changed && transition && transition.type !== 'none') {
      const duration = animationTime(transition.durationMs)
      const direction = transition.direction ?? 'left'
      const horizontal = direction === 'left' || direction === 'right'
      const sign = direction === 'left' || direction === 'up' ? 1 : -1
      // Individual translate precedes the slide's scale transform. Use its scaled
      // extent so incoming and outgoing pages stay adjacent on a fitted canvas.
      const matrix = new DOMMatrix(active.ownerDocument.defaultView!.getComputedStyle(active).transform)
      const distance = horizontal ? active.offsetWidth * Math.hypot(matrix.a, matrix.b) : active.offsetHeight * Math.hypot(matrix.c, matrix.d)
      const offset = (n: number) => horizontal ? `${n * sign * distance}px 0` : `0 ${n * sign * distance}px`
      const incoming = animate(active, transition.type === 'fade' ? [{opacity:0},{opacity:1}] : [{translate:offset(1)},{translate:'0 0'}], duration)
      if (incoming && transition.type !== 'fade') this.transitions.set(incoming, {horizontal, sign, outgoing:false})
      if (transition.type === 'push' && this.snapshot && !reduced && duration > 0) {
        const clone = this.snapshot
        clone.removeAttribute('data-ppte-slide-id')
        clone.querySelectorAll('[data-ppte-element-id]').forEach(n => n.removeAttribute('data-ppte-element-id'))
        clone.querySelectorAll('video,audio').forEach(n => n.remove())
        clone.inert = true; clone.setAttribute('aria-hidden','true')
        clone.style.position = 'absolute'; clone.style.left = '0'; clone.style.top = '0'; clone.style.pointerEvents = 'none'
        active.parentElement?.append(clone); this.outgoing = clone
        const effect = clone.animate([{translate:'0 0'},{translate:offset(-1)}], {duration, easing:'ease'})
        this.playing.add(effect)
        this.transitions.set(effect, {horizontal, sign, outgoing:true})
        effect.onfinish = () => { this.playing.delete(effect); this.transitions.delete(effect); clone.remove() }
      }
    }
    // Fullscreen/resize can change scale mid-effect. Update distances without
    // changing the playhead or replaying an entrance.
    const matrix = new DOMMatrix(active.ownerDocument.defaultView!.getComputedStyle(active).transform)
    for (const [effect, spec] of this.transitions) {
      const distance = spec.horizontal ? active.offsetWidth * Math.hypot(matrix.a,matrix.b) : active.offsetHeight * Math.hypot(matrix.c,matrix.d)
      const offset = spec.horizontal ? `${distance * spec.sign * (spec.outgoing ? -1 : 1)}px 0` : `0 ${distance * spec.sign * (spec.outgoing ? -1 : 1)}px`
      ;(effect.effect as KeyframeEffect).setKeyframes(spec.outgoing ? [{translate:'0 0'},{translate:offset}] : [{translate:offset},{translate:'0 0'}])
    }
    if (this.outgoing) this.outgoing.style.transform = active.style.transform
    this.slideId = presenting ? slide.id : undefined
    this.snapshot = active.cloneNode(true) as HTMLElement
  }
  cancel(): void { for (const effect of this.playing) effect.cancel(); this.playing.clear(); this.transitions.clear(); this.outgoing?.remove(); this.outgoing = undefined }
  dispose(): void { this.cancel(); this.snapshot = undefined; this.slideId = undefined; this.nodes = new WeakMap() }
}

export const ANIMATION_PRINT_CSS = '@media print{body:has([data-ppte-print-document]) #ppte-shell{display:none!important}.ppte-toolbar,.ppte-notes,[data-ppte-properties-panel],[data-ppte-pages-panel],[data-ppte-design-panel],.ppte-exit{display:none!important}#ppte-shell,[data-ppte-stage],[data-ppte-canvas]{display:block!important;height:auto!important;overflow:visible!important;position:static!important}[data-ppte-element-id]{visibility:visible!important;animation:none!important;translate:none!important}.ppte-slide{display:block!important;position:relative!important;transform:none!important;translate:none!important;animation:none!important;break-after:page}}'
