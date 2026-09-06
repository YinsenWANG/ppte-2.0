import type { Element, Frame, Point, PpteDocument, SlideId } from '../../schema/src/index.js'

export function translateFrame(frame: Frame, dx: number, dy: number): Frame {
  return { ...frame, x: frame.x + dx, y: frame.y + dy }
}

export function boundingFrame(frames: Frame[]): Frame {
  if (frames.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  const x = Math.min(...frames.map((frame) => frame.x))
  const y = Math.min(...frames.map((frame) => frame.y))
  const right = Math.max(...frames.map((frame) => frame.x + frame.width))
  const bottom = Math.max(...frames.map((frame) => frame.y + frame.height))
  return { x, y, width: right - x, height: bottom - y }
}

export function containsPoint(frame: Frame, point: Point): boolean {
  return point.x >= frame.x && point.y >= frame.y && point.x <= frame.x + frame.width && point.y <= frame.y + frame.height
}

/** Hit testing is derived from the current visual root order; groups are not render nodes. */
export function hitTest(document: PpteDocument, slideId: SlideId, point: Point): Element | undefined {
  const slide = document.slides[slideId]
  if (!slide) return undefined
  for (let index = slide.rootOrder.length - 1; index >= 0; index -= 1) {
    const element = slide.elements[slide.rootOrder[index]]
    if (element && element.visible !== false && containsPoint(element.frame, point)) return element
  }
  return undefined
}

export function snap(value: number, target: number, thresholdDu: number): number {
  return Math.abs(value - target) <= thresholdDu ? target : value
}
