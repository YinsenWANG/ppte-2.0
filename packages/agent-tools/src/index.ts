import type { PpteSession } from '../../core/src/index.js'
import type { ElementId, PpteDocument, Revision, RichTextDocument, SlideId, Transaction, ValidationIssue } from '../../schema/src/index.js'
import type { ChangeContract, CommitResult, PreviewResult, TransactionScope } from '../../schema/src/index.js'

export interface ToolContext {
  documentId: string
  revision: Revision
  selection?: { slideId: SlideId; elementIds: ElementId[] }
  grantedScope: TransactionScope
}

export interface InspectDocumentResult {
  documentId: string
  revision: Revision
  title: string
  slideCount: number
  validationIssues: ValidationIssue[]
}

export class MockAgent {
  createTextReplaceTransaction(document: PpteDocument, revision: Revision, slideId: SlideId, elementId: ElementId, content: RichTextDocument, transactionId = `agent:text:${elementId}`): Transaction {
    const element = document.slides[slideId]?.elements[elementId]
    if (!element || element.type !== 'text') throw new Error(`OPERATION_TYPE_MISMATCH: ${elementId} is not Text.`)
    return {
      transactionId,
      baseRevision: revision,
      actor: { type: 'agent', id: 'mock-agent' },
      scope: { kind: 'selection', slideIds: [slideId], elementIds: [elementId], permissions: ['content'], allowInsert: false, allowDelete: false },
      changeContract: contentOnlyContract(elementId),
      reason: 'Mock agent text.replaceContent',
      createdAt: '2026-09-02T00:00:00.000Z',
      validationLevel: 'L3',
      operations: [{ opId: `${transactionId}:replace`, kind: 'text.replaceContent', slideId, elementId, content }],
    }
  }

  createOutOfScopeTextTransaction(document: PpteDocument, revision: Revision, slideId: SlideId, allowedElementId: ElementId, secondElementId: ElementId, content: RichTextDocument, transactionId = 'agent:out-of-scope'): Transaction {
    const first = this.createTextReplaceTransaction(document, revision, slideId, allowedElementId, content, `${transactionId}:first`)
    return {
      ...first,
      transactionId,
      operations: [
        { ...first.operations[0], opId: `${transactionId}:first` },
        { opId: `${transactionId}:second`, kind: 'text.replaceContent', slideId, elementId: secondElementId, content },
      ],
    }
  }

  previewTextReplace(session: PpteSession, transaction: Transaction): PreviewResult { return session.preview(transaction) }
  commitTextReplace(session: PpteSession, transaction: Transaction): CommitResult { return session.commit(transaction) }
}

export function contentOnlyContract(elementId: ElementId): ChangeContract {
  return {
    allowedOperationKinds: ['text.replaceContent'],
    allowedElementIds: [elementId],
    maxChangedSlides: 1,
    maxChangedElements: 1,
    maxInsertedElements: 0,
    maxDeletedElements: 0,
    maxReplacedAssets: 0,
    preserve: { style: 'preserve', geometry: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' },
    requireConfirmation: false,
    userIntentSummary: 'Only replace selected text content.',
  }
}
