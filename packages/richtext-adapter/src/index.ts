import type { RichTextDocument, TextElement, Transaction } from '../../schema/src/index.js'

/** Small adapter boundary for a rich-text/IME implementation. Private editor
 * state never becomes part of the semantic document until finish(). */
export class ImeTextEditSession {
  private readonly initial: RichTextDocument
  private current: RichTextDocument
  private composing = false

  constructor(private readonly element: TextElement, private readonly slideId = 'current-slide') {
    this.initial = cloneRichText(element.content)
    this.current = cloneRichText(element.content)
  }

  beginComposition() { this.composing = true }
  updateComposition(content: RichTextDocument) { this.current = cloneRichText(content) }
  endComposition() { this.composing = false }
  input(content: RichTextDocument) { this.current = cloneRichText(content) }
  isComposing() { return this.composing }
  getLocalContent(): RichTextDocument { return cloneRichText(this.current) }
  hasChanges(): boolean { return JSON.stringify(this.initial) !== JSON.stringify(this.current) }

  finish(transactionId: string, baseRevision: string, createdAt = new Date().toISOString()): Transaction | undefined {
    if (this.composing || !this.hasChanges()) return undefined
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
    return this.getLocalContent()
  }
}

export function plainTextToRichText(value: string, paragraphPrefix = 'p'): RichTextDocument {
  return { paragraphs: value.split('\n').map((line, index) => ({ id: `${paragraphPrefix}-${index + 1}`, runs: [{ id: `${paragraphPrefix}-${index + 1}-run`, text: line }] })) }
}

function cloneRichText(value: RichTextDocument): RichTextDocument {
  return { paragraphs: value.paragraphs.map((paragraph) => ({ ...paragraph, runs: paragraph.runs.map((run) => run.marks ? { ...run, marks: { ...run.marks } } : { id: run.id, text: run.text }) })) }
}
