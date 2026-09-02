import { canonicalHash } from '../../canonical-json/src/index.js'
import type { RichTextDocument, TextElement, Transaction } from '../../schema/src/index.js'

/** Small adapter boundary for a rich-text/IME implementation. Private editor
 * state never becomes part of the semantic document until finish(). */
export class ImeTextEditSession {
  private readonly initial: RichTextDocument
  private current: RichTextDocument
  private composing = false
  private finished = false

  constructor(private readonly element: TextElement, private readonly slideId = 'current-slide') {
    this.initial = cloneRichText(element.content)
    this.current = cloneRichText(element.content)
  }

  beginComposition() { this.composing = true }
  updateComposition(content: RichTextDocument) { this.current = cloneRichText(content); assertSafeRichText(this.current) }
  endComposition(content?: RichTextDocument) {
    if (content) this.updateComposition(content)
    this.composing = false
  }
  input(content: RichTextDocument) { this.current = cloneRichText(content); assertSafeRichText(this.current) }
  isComposing() { return this.composing }
  getLocalContent(): RichTextDocument { return cloneRichText(this.current) }
  hasChanges(): boolean { return canonicalHash(this.initial) !== canonicalHash(this.current) }

  finish(transactionId: string, baseRevision: string, createdAt = new Date().toISOString()): Transaction | undefined {
    if (this.finished || this.composing || !this.hasChanges()) return undefined
    assertSafeRichText(this.current)
    this.finished = true
    return {
      transactionId,
      baseRevision,
      actor: { type: 'human', id: 'editor' },
      scope: { kind: 'selection', slideIds: [this.slideId], elementIds: [this.element.id], permissions: ['content'], allowInsert: false, allowDelete: false },
      changeContract: {
        allowedOperationKinds: ['text.replaceContent'],
        allowedElementIds: [this.element.id],
        maxChangedSlides: 1,
        maxChangedElements: 1,
        maxInsertedElements: 0,
        maxDeletedElements: 0,
        preserve: { style: 'preserve', geometry: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' },
      },
      createdAt,
      operations: [{ opId: `${transactionId}:replace`, kind: 'text.replaceContent', slideId: this.slideId, elementId: this.element.id, content: cloneRichText(this.current) }],
    }
  }

  cancel(): RichTextDocument {
    this.current = cloneRichText(this.initial)
    this.composing = false
    this.finished = true
    return this.getLocalContent()
  }
}

export function plainTextToRichText(value: string, paragraphPrefix = 'p'): RichTextDocument {
  if (value.includes('\u0000')) throw new Error('Text input may not contain NUL characters.')
  return { paragraphs: value.split('\n').map((line, index) => ({ id: `${paragraphPrefix}-${index + 1}`, runs: [{ id: `${paragraphPrefix}-${index + 1}-run`, text: line }] })) }
}

export function cloneRichText(value: RichTextDocument): RichTextDocument {
  return {
    paragraphs: value.paragraphs.map((paragraph) => ({
      ...paragraph,
      runs: paragraph.runs.map((run) => run.marks ? { ...run, marks: { ...run.marks } } : { id: run.id, text: run.text }),
    })),
  }
}

/** The adapter boundary rejects private-editor fields before they reach a transaction. */
export function assertSafeRichText(value: RichTextDocument): void {
  if (!value || !Array.isArray(value.paragraphs)) throw new Error('Rich text must contain paragraphs.')
  const paragraphIds = new Set<string>()
  for (const paragraph of value.paragraphs) {
    if (!paragraph || !paragraph.id || paragraphIds.has(paragraph.id) || !Array.isArray(paragraph.runs)) throw new Error('Rich text paragraphs require unique ids and runs.')
    paragraphIds.add(paragraph.id)
    const runIds = new Set<string>()
    for (const run of paragraph.runs) {
      if (!run || !run.id || runIds.has(run.id) || typeof run.text !== 'string' || run.text.includes('\u0000')) throw new Error('Rich text runs require unique ids and NUL-free text.')
      runIds.add(run.id)
      if (Object.keys(run as unknown as Record<string, unknown>).some((key) => !['id', 'text', 'marks'].includes(key))) throw new Error('Run-level font and font-size fields are not supported.')
      if (run.marks && Object.keys(run.marks).some((key) => !['bold', 'italic', 'underline', 'strike', 'color'].includes(key))) throw new Error('Unsupported run mark.')
    }
  }
}
