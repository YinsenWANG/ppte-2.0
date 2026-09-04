import { canonicalRevision, cloneJson } from '../../canonical-json/src/index.js'
import { computeStructuralDiff } from '../../diff/src/index.js'
import { compareDocuments, compareTwoWayDocuments } from '../../reviewer/src/index.js'
import type { PpteSession } from '../../core/src/index.js'
import {
  buildRegenerateTransaction,
  buildReflowTransaction,
  compileSlide,
  type CompileContext,
} from '../../design-compiler/src/index.js'
import { expandMacro, MacroRegistry } from '../../macros/src/index.js'
import { RecipeRegistry } from '../../layout-recipes/src/index.js'
import { renderSlideHtml, renderTextPlain } from '../../renderer-react/src/index.js'
import { diagnoseOverrideDebt, validateRuntimeDocument, validateTransactionShape } from '../../validation/src/index.js'
import { withErrorSemantics } from '../../schema/src/errors.js'
import type {
  ChangeContract,
  BlockIR,
  CommitResult,
  Element,
  ElementId,
  FactId,
  JsonValue,
  MutationSummary,
  PpteDocument,
  PreviewResult,
  Revision,
  RichTextDocument,
  SlideIR,
  ScopePermission,
  Slide,
  SlideId,
  SourceId,
  Transaction,
  TransactionScope,
  ValidationIssue,
} from '../../schema/src/index.js'
import { validateSlideIR } from '../../schema/src/index.js'

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

export type AgentToolName =
  | 'inspect_document'
  | 'list_slides'
  | 'get_slide_summary'
  | 'query_elements'
  | 'get_slide'
  | 'get_element'
  | 'get_selection'
  | 'get_theme'
  | 'get_facts'
  | 'get_sources'
  | 'get_validation_issues'
  | 'get_editability_report'
  | 'render_slide'
  | 'inspect_facts'
  | 'inspect_sources'
  | 'inspect_assets'
  | 'inspect_theme'
  | 'inspect_history'
  | 'search_text'
  | 'query_semantic_keys'
  | 'preview_transaction'
  | 'commit_transaction'
  | 'undo_transaction'
  | 'regenerate_selection'
  | 'redesign_others'
  | 'regenerate_slide'
  | 'apply_layout_recipe'
  | 'expand_macro'
  | 'replace_artwork'
  | 'sync_fact_references'
  | 'compare_revised_copy'

export interface AgentToolResult<T = unknown> {
  tool: AgentToolName
  ok: boolean
  revision: Revision
  data?: T
  issues: ValidationIssue[]
  diff?: CommitResult['diff']
  mutationBudget?: MutationSummary
  requiresConfirmation?: boolean
  transaction?: Transaction
}

export interface AgentToolServerOptions {
  grantedScope?: TransactionScope
  selection?: { slideId: SlideId; elementIds: ElementId[] }
  recipes?: RecipeRegistry
  macros?: MacroRegistry
  compilerContext?: Omit<CompileContext, 'canvas' | 'theme' | 'recipes'>
}

export interface AgentToolDefinition {
  name: AgentToolName
  mutates: boolean
  requiresConfirmation: boolean
  description: string
}

export const AGENT_TOOL_NAMES: readonly AgentToolName[] = [
  'inspect_document',
  'list_slides',
  'get_slide_summary',
  'query_elements',
  'get_slide',
  'get_element',
  'get_selection',
  'get_theme',
  'get_facts',
  'get_sources',
  'get_validation_issues',
  'get_editability_report',
  'render_slide',
  'inspect_facts',
  'inspect_sources',
  'inspect_assets',
  'inspect_theme',
  'inspect_history',
  'search_text',
  'query_semantic_keys',
  'preview_transaction',
  'commit_transaction',
  'undo_transaction',
  'regenerate_selection',
  'redesign_others',
  'regenerate_slide',
  'apply_layout_recipe',
  'expand_macro',
  'replace_artwork',
  'sync_fact_references',
  'compare_revised_copy',
]

export const AGENT_TOOL_DEFINITIONS: readonly AgentToolDefinition[] = AGENT_TOOL_NAMES.map((name) => ({
  name,
  mutates: ['commit_transaction', 'undo_transaction'].includes(name),
  requiresConfirmation: ['commit_transaction', 'undo_transaction', 'regenerate_selection', 'redesign_others', 'regenerate_slide', 'apply_layout_recipe', 'replace_artwork', 'sync_fact_references'].includes(name),
  description: name === 'render_slide' ? 'Return a read-only single-slide preview fragment for inspection; it is not an independent delivery file.' : name === 'commit_transaction' ? 'Commit a validated Transaction through the Session.' : name === 'preview_transaction' ? 'Preview a Transaction and return actual Diff and Issues.' : `Execute the ${name} Agent tool within the granted Scope.`,
}))

/**
 * Agent-facing adapter. Reads are scope-filtered, generated changes are
 * returned as transactions, and only commit_transaction reaches Session.commit.
 */
export class AgentToolServer {
  readonly session: PpteSession
  readonly recipes: RecipeRegistry
  readonly macros: MacroRegistry
  private readonly grantedScope: TransactionScope
  private readonly selection?: { slideId: SlideId; elementIds: ElementId[] }
  private readonly compilerContext: Omit<CompileContext, 'canvas' | 'theme' | 'recipes'>

  constructor(session: PpteSession, options: AgentToolServerOptions = {}) {
    this.session = session
    this.recipes = options.recipes ?? new RecipeRegistry()
    this.macros = options.macros ?? new MacroRegistry()
    this.grantedScope = options.grantedScope ?? defaultAgentScope()
    this.selection = options.selection
    this.compilerContext = options.compilerContext ?? {}
  }

  context(): ToolContext {
    const document = this.document()
    return {
      documentId: document.documentId,
      revision: this.session.getRevision(),
      ...(this.selection ? { selection: cloneJson(this.selection) } : {}),
      grantedScope: cloneJson(this.grantedScope),
    }
  }

  execute<T = unknown>(tool: AgentToolName, args: Record<string, unknown> = {}): AgentToolResult<T> {
    try {
      switch (tool) {
        case 'inspect_document': return this.inspectDocument() as AgentToolResult<T>
        case 'list_slides': return this.listSlides() as AgentToolResult<T>
        case 'get_slide_summary': return this.getSlideSummary(optionalString(args, 'slideId')) as AgentToolResult<T>
        case 'query_elements': return this.queryElements(args) as AgentToolResult<T>
        case 'get_slide': return this.getSlide(stringArg(args, 'slideId')) as AgentToolResult<T>
        case 'get_element': return this.getElement(optionalString(args, 'slideId'), stringArg(args, 'elementId')) as AgentToolResult<T>
        case 'get_selection': return this.getSelection() as AgentToolResult<T>
        case 'get_theme': return this.inspectTheme() as AgentToolResult<T>
        case 'get_facts': return this.inspectFacts(optionalString(args, 'factId')) as AgentToolResult<T>
        case 'get_sources': return this.inspectSources(optionalString(args, 'sourceId')) as AgentToolResult<T>
        case 'get_validation_issues': return success('get_validation_issues', this.revision(), validateRuntimeDocument(this.document())) as AgentToolResult<T>
        case 'get_editability_report': return this.getEditabilityReport() as AgentToolResult<T>
        case 'render_slide': return this.renderSlide(stringArg(args, 'slideId')) as AgentToolResult<T>
        case 'inspect_facts': return this.inspectFacts(optionalString(args, 'factId')) as AgentToolResult<T>
        case 'inspect_sources': return this.inspectSources(optionalString(args, 'sourceId')) as AgentToolResult<T>
        case 'inspect_assets': return this.inspectAssets(optionalString(args, 'assetId')) as AgentToolResult<T>
        case 'inspect_theme': return this.inspectTheme() as AgentToolResult<T>
        case 'inspect_history': return this.inspectHistory() as AgentToolResult<T>
        case 'search_text': return this.searchText(optionalString(args, 'query')) as AgentToolResult<T>
        case 'query_semantic_keys': return this.querySemanticKeys(optionalString(args, 'query')) as AgentToolResult<T>
        case 'preview_transaction': return this.previewTransaction(args.transaction) as AgentToolResult<T>
        case 'commit_transaction': return this.commitTransaction(args.transaction, args.confirmed === true) as AgentToolResult<T>
        case 'undo_transaction': return this.undoTransaction(args.confirmed === true) as AgentToolResult<T>
        case 'regenerate_selection': return this.regenerateSelection(args) as AgentToolResult<T>
        case 'redesign_others': return this.redesignOthers(args) as AgentToolResult<T>
        case 'regenerate_slide': return this.regenerateSlide(args) as AgentToolResult<T>
        case 'apply_layout_recipe': return this.applyLayoutRecipe(args) as AgentToolResult<T>
        case 'expand_macro': return this.expandMacroTool(args) as AgentToolResult<T>
        case 'replace_artwork': return this.replaceArtwork(args) as AgentToolResult<T>
        case 'sync_fact_references': return this.syncFactReferences(args) as AgentToolResult<T>
        case 'compare_revised_copy': return this.compareRevisedCopy(args.revisedDocument, args.baseDocument) as AgentToolResult<T>
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      const code = /^[A-Z][A-Z0-9_]+:/.exec(message)?.[0]?.slice(0, -1) ?? 'TOOL_FAILED'
      return failure(tool, code, this.revision(), message) as AgentToolResult<T>
    }
  }

  invoke<T = unknown>(tool: AgentToolName, args: Record<string, unknown> = {}): AgentToolResult<T> {
    return this.execute<T>(tool, args)
  }

  private inspectDocument(): AgentToolResult<InspectDocumentResult> {
    const document = this.document()
    const visibleSlides = document.slideOrder.filter((slideId) => this.canReadSlide(slideId))
    return success('inspect_document', this.revision(), {
      documentId: document.documentId,
      revision: this.revision(),
      title: document.metadata.title,
      slideCount: visibleSlides.length,
      validationIssues: validateRuntimeDocument(document),
    })
  }

  private listSlides(): AgentToolResult<Array<{ id: string; name?: string; elementCount: number; purpose?: string; visualStrategy?: string }>> {
    const document = this.document()
    const slides = document.slideOrder.filter((slideId) => this.canReadSlide(slideId)).map((slideId) => {
      const slide = document.slides[slideId]
      return {
        id: slide.id,
        ...(slide.name === undefined ? {} : { name: slide.name }),
        elementCount: Object.keys(this.readableElements(slide)).length,
        ...(slide.semantic?.purpose === undefined ? {} : { purpose: slide.semantic.purpose }),
        ...(slide.visualStrategy === undefined ? {} : { visualStrategy: slide.visualStrategy }),
      }
    })
    return success('list_slides', this.revision(), slides)
  }

  private queryElements(args: Record<string, unknown>): AgentToolResult<Array<{ slideId: string; element: Element }>> {
    const requestedSlideId = optionalString(args, 'slideId')
    const requestedRole = optionalString(args, 'role')
    const requestedType = optionalString(args, 'type')
    const requestedKey = optionalString(args, 'semanticKey')
    const elements: Array<{ slideId: string; element: Element }> = []
    for (const slideId of this.document().slideOrder) {
      if (requestedSlideId && requestedSlideId !== slideId) continue
      for (const element of Object.values(this.readableElements(this.document().slides[slideId]))) {
        if (requestedRole && element.role !== requestedRole) continue
        if (requestedType && element.type !== requestedType) continue
        if (requestedKey && element.semanticKey !== requestedKey) continue
        elements.push({ slideId, element: cloneJson(element) })
      }
    }
    return success('query_elements', this.revision(), elements)
  }

  private getSlideSummary(slideId?: string): AgentToolResult<unknown> {
    const summaries = this.listSlides()
    if (!slideId) return success('get_slide_summary', this.revision(), summaries.data ?? [])
    const summary = (summaries.data ?? []).find((item) => item.id === slideId)
    if (!summary) return failure('get_slide_summary', 'SCOPE_VIOLATION', this.revision(), `Slide ${slideId} is not available in the granted scope.`)
    return success('get_slide_summary', this.revision(), summary)
  }

  private getSlide(slideId: string): AgentToolResult<Partial<Slide>> {
    const document = this.document()
    const slide = document.slides[slideId]
    if (!slide || !this.canReadSlide(slideId)) return failure<Partial<Slide>>('get_slide', 'SCOPE_VIOLATION', this.revision(), `Slide ${slideId} is not available in the granted scope.`)
    const elements = this.readableElements(slide)
    return success('get_slide', this.revision(), {
      ...cloneJson(slide),
      rootOrder: slide.rootOrder.filter((id) => Boolean(elements[id])),
      readingOrder: slide.readingOrder?.filter((id) => Boolean(elements[id])),
      elements,
    })
  }

  private getElement(slideId: string | undefined, elementId: string): AgentToolResult<Element> {
    const resolvedSlideId = slideId ?? findElementSlide(this.document(), elementId)
    const element = resolvedSlideId ? this.document().slides[resolvedSlideId]?.elements[elementId] : undefined
    if (!element || !resolvedSlideId || !this.canReadElement(resolvedSlideId, element)) return failure<Element>('get_element', 'SCOPE_VIOLATION', this.revision(), `Element ${elementId} is not available in the granted scope.`)
    return success('get_element', this.revision(), cloneJson(element))
  }

  private getSelection(): AgentToolResult<{ slideId?: string; elementIds: string[] }> {
    const elementIds = this.selection?.elementIds.filter((elementId) => this.canReadElement(this.selection?.slideId ?? '', this.document().slides[this.selection?.slideId ?? '']?.elements[elementId])) ?? []
    return success('get_selection', this.revision(), { ...(this.selection ? { slideId: this.selection.slideId } : {}), elementIds })
  }

  private inspectFacts(factId?: string): AgentToolResult<unknown> {
    if (!this.canReadPermission('facts')) return failure('inspect_facts', 'SCOPE_VIOLATION', this.revision(), 'Fact inspection is outside the granted scope.')
    const facts = this.document().facts ?? {}
    return success('inspect_facts', this.revision(), factId ? cloneJson(facts[factId]) : cloneJson(facts))
  }

  private inspectSources(sourceId?: string): AgentToolResult<unknown> {
    if (!this.canReadPermission('sources')) return failure('inspect_sources', 'SCOPE_VIOLATION', this.revision(), 'Source inspection is outside the granted scope.')
    const sources = this.document().sources ?? {}
    return success('inspect_sources', this.revision(), sourceId ? cloneJson(sources[sourceId]) : cloneJson(sources))
  }

  private inspectAssets(assetId?: string): AgentToolResult<unknown> {
    if (!this.canReadPermission('assets')) return failure('inspect_assets', 'SCOPE_VIOLATION', this.revision(), 'Asset inspection is outside the granted scope.')
    const assets = this.document().assets
    return success('inspect_assets', this.revision(), assetId ? cloneJson(assets[assetId]) : cloneJson(assets))
  }

  private inspectTheme(): AgentToolResult<unknown> {
    if (!this.canReadPermission('theme')) return failure('inspect_theme', 'SCOPE_VIOLATION', this.revision(), 'Theme inspection is outside the granted scope.')
    return success('inspect_theme', this.revision(), cloneJson(this.document().theme))
  }

  private inspectHistory(): AgentToolResult<unknown> {
    return success('inspect_history', this.revision(), {
      entries: cloneJson(this.session.getHistory()).map((entry) => ({ transactionId: entry.transaction.transactionId, beforeRevision: entry.beforeRevision, afterRevision: entry.afterRevision, operationKinds: entry.transaction.operations.map((operation) => operation.kind) })),
      redoCount: this.session.getRedoHistory().length,
    })
  }

  private getEditabilityReport(): AgentToolResult<unknown> {
    const elements: Array<{ slideId: string; elementId: string; semanticKey?: string; type: Element['type']; mode: string; agentEditable: boolean }> = []
    for (const slideId of this.document().slideOrder) for (const element of Object.values(this.readableElements(this.document().slides[slideId]))) elements.push({ slideId, elementId: element.id, ...(element.semanticKey === undefined ? {} : { semanticKey: element.semanticKey }), type: element.type, mode: element.editPolicy?.mode ?? 'full', agentEditable: element.editPolicy?.agentEditable !== false && element.locked !== true })
    return success('get_editability_report', this.revision(), { elements, overrideDebtIssues: diagnoseOverrideDebt(this.document()) })
  }

  private renderSlide(slideId: string): AgentToolResult<{ html: string; kind: 'read-only-preview-fragment'; deliverable: false }> {
    if (!this.canReadSlide(slideId)) return failure('render_slide', 'SCOPE_VIOLATION', this.revision(), `Slide ${slideId} is outside the granted scope.`)
    const document = this.document()
    const slide = document.slides[slideId]
    const readable = this.readableElements(slide)
    const scoped = Object.keys(readable).length === Object.keys(slide.elements).length ? document : { ...document, slides: { ...document.slides, [slideId]: { ...slide, elements: readable, rootOrder: slide.rootOrder.filter((id) => Boolean(readable[id])), readingOrder: slide.readingOrder?.filter((id) => Boolean(readable[id])) } } }
    return success('render_slide', this.revision(), { html: renderSlideHtml(scoped, slideId, { editable: false }), kind: 'read-only-preview-fragment', deliverable: false })
  }

  private searchText(query?: string): AgentToolResult<Array<{ slideId: string; elementId: string; semanticKey?: string; text: string }>> {
    const needle = (query ?? '').toLocaleLowerCase()
    const matches: Array<{ slideId: string; elementId: string; semanticKey?: string; text: string }> = []
    for (const slideId of this.document().slideOrder) {
      const slide = this.document().slides[slideId]
      for (const element of Object.values(this.readableElements(slide))) {
        if (element.type !== 'text') continue
        const text = renderTextPlain(element)
        if (!needle || text.toLocaleLowerCase().includes(needle)) matches.push({ slideId, elementId: element.id, ...(element.semanticKey === undefined ? {} : { semanticKey: element.semanticKey }), text })
      }
    }
    return success('search_text', this.revision(), matches)
  }

  private querySemanticKeys(query?: string): AgentToolResult<Array<{ slideId: string; elementId: string; semanticKey: string }>> {
    const needle = query?.toLocaleLowerCase()
    const matches: Array<{ slideId: string; elementId: string; semanticKey: string }> = []
    for (const slideId of this.document().slideOrder) for (const element of Object.values(this.readableElements(this.document().slides[slideId]))) {
      if (!element.semanticKey || (needle && !element.semanticKey.toLocaleLowerCase().includes(needle))) continue
      matches.push({ slideId, elementId: element.id, semanticKey: element.semanticKey })
    }
    return success('query_semantic_keys', this.revision(), matches)
  }

  private previewTransaction(raw: unknown): AgentToolResult {
    const transaction = transactionArgument(raw)
    const guard = this.guardTransaction(transaction)
    if (guard.length > 0) return failureWithIssues('preview_transaction', this.revision(), guard)
    return operationResult('preview_transaction', this.revision(), this.session.preview(transaction))
  }

  private commitTransaction(raw: unknown, confirmed: boolean): AgentToolResult {
    const transaction = transactionArgument(raw)
    const guard = this.guardTransaction(transaction)
    if (guard.length > 0) return failureWithIssues('commit_transaction', this.revision(), guard)
    if (transaction.changeContract.requireConfirmation === true && !confirmed) return failure('commit_transaction', 'CONFIRMATION_REQUIRED', this.revision(), 'The transaction requires explicit confirmation before commit.')
    return operationResult('commit_transaction', this.revision(), this.session.commit(transaction))
  }

  private undoTransaction(confirmed: boolean): AgentToolResult {
    if (!confirmed) return failure('undo_transaction', 'CONFIRMATION_REQUIRED', this.revision(), 'Undo requires explicit confirmation.')
    const last = this.session.getHistory().at(-1)
    if (last) {
      const shapeIssues = validateTransactionShape(last.transaction).filter((issue) => issue.severity === 'error')
      if (shapeIssues.length > 0) return failureWithIssues('undo_transaction', this.revision(), shapeIssues)
      const scopeIssues = scopeWithin(last.transaction.scope, this.grantedScope)
        ? []
        : [toolIssue('SCOPE_VIOLATION', 'The most recent transaction is outside the granted Agent scope.')]
      if (scopeIssues.length > 0) return failureWithIssues('undo_transaction', this.revision(), scopeIssues)
    }
    return operationResult('undo_transaction', this.revision(), this.session.undo())
  }

  private regenerateSelection(args: Record<string, unknown>): AgentToolResult {
    const slideId = this.selection?.slideId ?? optionalString(args, 'slideId')
    if (!slideId) return failure('regenerate_selection', 'SELECTION_MISSING', this.revision(), 'A selected slide is required.')
    const selected = this.selection?.elementIds ?? stringArray(args, 'elementIds')
    if (selected.length === 0) return failure('regenerate_selection', 'SELECTION_MISSING', this.revision(), 'At least one selected element is required.')
    return this.regenerateSlide({ ...args, slideId, targetElementIds: selected, requireConfirmation: args.requireConfirmation ?? true }, 'regenerate_selection')
  }

  private redesignOthers(args: Record<string, unknown>): AgentToolResult {
    const slideId = this.selection?.slideId ?? optionalString(args, 'slideId')
    if (!slideId) return failure('redesign_others', 'SELECTION_MISSING', this.revision(), 'A selected slide is required.')
    const selected = this.selection?.elementIds ?? stringArray(args, 'elementIds')
    if (selected.length === 0) return failure('redesign_others', 'SELECTION_MISSING', this.revision(), 'At least one protected selected element is required.')
    return this.regenerateSlide({ ...args, slideId, protectedElementIds: selected, requireConfirmation: args.requireConfirmation ?? true }, 'redesign_others')
  }

  private regenerateSlide(args: Record<string, unknown>, tool: AgentToolName = 'regenerate_slide'): AgentToolResult {
    const slideId = stringArg(args, 'slideId')
    if (!this.canReadSlide(slideId)) return failure(tool, 'SCOPE_VIOLATION', this.revision(), `Slide ${slideId} is outside the granted scope.`)
    const ir = readSlideIR(args.slideIR) ?? inferSlideIR(this.document(), slideId)
    const draft = compileSlide(ir, this.compileContext(args))
    const base = { draft, validationIssues: draft.validationIssues }
    if (draft.validationIssues.some((issue) => issue.severity === 'error')) return { tool, ok: false, revision: this.revision(), data: base, issues: draft.validationIssues }
    try {
      const transaction = buildRegenerateTransaction(this.document(), draft, slideId, {
        transactionId: stringArgOr(args, 'transactionId', `${tool}:${slideId}:${this.revision()}`),
        baseRevision: this.revision(),
        actor: { type: 'agent', id: 'design-compiler' },
        reason: stringArgOr(args, 'reason', 'Regenerate from a validated semantic draft.'),
        protectedElementIds: stringArray(args, 'protectedElementIds'),
        protectedContent: ir.protectedContent,
        targetElementIds: stringArray(args, 'targetElementIds'),
        protectedSemanticKeys: stringArray(args, 'protectedSemanticKeys'),
        requireConfirmation: args.requireConfirmation !== false,
      })
      const preview = this.previewTransaction(transaction)
      return generatedResult(tool, this.revision(), { ...base, preview: preview.data }, transaction, preview)
    } catch (cause) {
      return { ...success(tool, this.revision(), base), issues: [toolIssue('TRANSACTION_BUILD_FAILED', cause instanceof Error ? cause.message : String(cause))] }
    }
  }

  private applyLayoutRecipe(args: Record<string, unknown>): AgentToolResult {
    const slideId = stringArg(args, 'slideId')
    if (!this.canReadSlide(slideId)) return failure('apply_layout_recipe', 'SCOPE_VIOLATION', this.revision(), `Slide ${slideId} is outside the granted scope.`)
    const ir = readSlideIR(args.slideIR) ?? inferSlideIR(this.document(), slideId)
    const draft = compileSlide(ir, this.compileContext(args))
    if (draft.validationIssues.some((issue) => issue.severity === 'error')) return { tool: 'apply_layout_recipe', ok: false, revision: this.revision(), data: { draft, validationIssues: draft.validationIssues }, issues: draft.validationIssues }
    try {
      const transaction = buildReflowTransaction(this.document(), draft, {
        transactionId: stringArgOr(args, 'transactionId', `recipe:${slideId}:${this.revision()}`),
        baseRevision: this.revision(),
        slideId,
        actor: { type: 'agent', id: 'layout-recipe' },
        reason: stringArgOr(args, 'reason', 'Apply a declarative layout Recipe.'),
        requireConfirmation: args.requireConfirmation !== false,
      })
      const preview = this.previewTransaction(transaction)
      return generatedResult('apply_layout_recipe', this.revision(), { draft, preview: preview.data }, transaction, preview)
    } catch (cause) {
      return failure('apply_layout_recipe', 'TRANSACTION_BUILD_FAILED', this.revision(), cause instanceof Error ? cause.message : String(cause))
    }
  }

  private expandMacroTool(args: Record<string, unknown>): AgentToolResult {
    const macroId = stringArg(args, 'macroId')
    const slideKey = stringArgOr(args, 'slideKey', this.selection?.slideId ?? 'agent-draft')
    const context = { slideKey, canvas: { width: this.document().canvas.width, height: this.document().canvas.height }, ...(optionalString(args, 'seed') === undefined ? {} : { seed: optionalString(args, 'seed') }) }
    const expansion = expandMacro(macroId, args.input, context, this.macros, optionalString(args, 'version'))
    return success('expand_macro', this.revision(), expansion)
  }

  private replaceArtwork(args: Record<string, unknown>): AgentToolResult {
    const slideId = stringArg(args, 'slideId')
    const elementId = stringArg(args, 'elementId')
    const assetId = stringArg(args, 'assetId')
    const element = this.document().slides[slideId]?.elements[elementId]
    if (!element || !this.canReadElement(slideId, element)) return failure('replace_artwork', 'SCOPE_VIOLATION', this.revision(), `Element ${elementId} is outside the granted scope.`)
    const transaction = replaceArtworkTransaction(this.revision(), slideId, elementId, assetId, stringArgOr(args, 'transactionId', `artwork:${elementId}:${this.revision()}`))
    const preview = this.previewTransaction(transaction)
    return generatedResult('replace_artwork', this.revision(), { preview: preview.data }, transaction, preview)
  }

  private syncFactReferences(args: Record<string, unknown>): AgentToolResult {
    const factId = stringArg(args, 'factId')
    const targetElementIds = stringArray(args, 'targetElementIds')
    const strategy = args.strategy === 'update-chart-values' ? 'update-chart-values' : 'replace-display-value'
    const targetSlides = [...new Set(targetElementIds.map((elementId) => findElementSlide(this.document(), elementId)).filter((slideId): slideId is string => Boolean(slideId)))]
    if (targetElementIds.some((elementId) => !findElementSlide(this.document(), elementId))) return failure('sync_fact_references', 'ELEMENT_MISSING', this.revision(), 'Every target element must exist.')
    const transaction: Transaction = {
      transactionId: stringArgOr(args, 'transactionId', `fact-sync:${factId}:${this.revision()}`),
      baseRevision: this.revision(),
      actor: { type: 'agent', id: 'fact-sync' },
      scope: { kind: targetSlides.length === 1 ? 'slide' : 'document', ...(targetSlides.length === 1 ? { slideIds: targetSlides } : {}), elementIds: targetElementIds, permissions: ['facts', 'content'], allowInsert: false, allowDelete: false },
      changeContract: { allowedOperationKinds: ['fact.syncReferences'], allowedElementIds: targetElementIds, maxChangedSlides: targetSlides.length, maxChangedElements: targetElementIds.length, maxInsertedElements: 0, maxDeletedElements: 0, maxReplacedAssets: 0, maxChangedFacts: 0, preserve: { facts: 'preserve' }, requireConfirmation: args.requireConfirmation !== false, userIntentSummary: 'Synchronize selected display references to an existing fact.' },
      reason: stringArgOr(args, 'reason', 'Synchronize fact references.'),
      createdAt: stringArgOr(args, 'createdAt', '2026-09-03T00:00:00.000Z'),
      validationLevel: 'L3',
      operations: [{ opId: `fact-sync:${factId}`, kind: 'fact.syncReferences', factId, targetElementIds, strategy, preconditions: [{ kind: 'fact-exists', factId }] }],
    }
    const preview = this.previewTransaction(transaction)
    return generatedResult('sync_fact_references', this.revision(), { preview: preview.data }, transaction, preview)
  }

  private compareRevisedCopy(raw: unknown, rawBase?: unknown): AgentToolResult {
    const revised = raw as PpteDocument
    const current = this.document()
    const diff = computeStructuralDiff(current, revised)
    const base = rawBase as PpteDocument | undefined
    const comparison = base ? compareDocuments(base, current, revised) : compareTwoWayDocuments(current, revised)
    const normalized = comparison
    if (normalized.issues.some((issue) => issue.severity === 'error')) return failureWithIssues('compare_revised_copy', this.revision(), normalized.issues)
    return success('compare_revised_copy', this.revision(), { diff, comparison: normalized, revisedRevision: revisionOf(revised), ...(base ? { baseRevision: revisionOf(base) } : {}), conflicts: normalized.conflicts })
  }

  private compileContext(args: Record<string, unknown>): CompileContext {
    const document = this.document()
    return {
      canvas: document.canvas,
      theme: document.theme,
      recipes: this.recipes,
      ...this.compilerContext,
      ...(optionalString(args, 'recipeId') === undefined ? {} : { recipeId: optionalString(args, 'recipeId') }),
      ...(optionalString(args, 'recipeVersion') === undefined ? {} : { recipeVersion: optionalString(args, 'recipeVersion') }),
      ...(optionalString(args, 'seed') === undefined ? {} : { seed: optionalString(args, 'seed') }),
    }
  }

  private guardTransaction(transaction: Transaction): ValidationIssue[] {
    const shapeIssues = validateTransactionShape(transaction)
    if (shapeIssues.some((issue) => issue.severity === 'error')) return shapeIssues
    const scope = transaction.scope
    const issues: ValidationIssue[] = []
    if (!scopeWithin(scope, this.grantedScope)) issues.push(toolIssue('SCOPE_VIOLATION', 'Transaction scope exceeds the granted Agent scope.'))
    for (const operation of transaction.operations) {
      const slideId = 'slideId' in operation ? operation.slideId : operation.kind === 'slide.insert' ? operation.slide.id : undefined
      const elementId = 'elementId' in operation ? operation.elementId : undefined
      if (slideId && !this.canReadSlide(slideId) && operation.kind !== 'slide.insert') issues.push({ ...toolIssue('SCOPE_VIOLATION', `Operation targets slide ${slideId} outside the granted scope.`), slideId })
      if (elementId && !this.canReadElement(slideId ?? findElementSlide(this.document(), elementId) ?? '', this.document().slides[slideId ?? findElementSlide(this.document(), elementId) ?? '']?.elements[elementId])) issues.push({ ...toolIssue('SCOPE_VIOLATION', `Operation targets element ${elementId} outside the granted scope.`), elementId, slideId })
    }
    return issues
  }

  private readableElements(slide: Slide): Record<string, Element> {
    return Object.fromEntries(Object.entries(slide.elements).filter(([elementId, element]) => this.canReadElement(slide.id, element, elementId)))
  }

  private canReadSlide(slideId: string): boolean {
    if (this.grantedScope.kind === 'document') return true
    if (this.grantedScope.kind === 'slide' && this.grantedScope.slideIds?.includes(slideId) && !hasElementSelectors(this.grantedScope)) return true
    const slide = this.document().slides[slideId]
    return Boolean(slide && Object.values(slide.elements).some((element) => this.canReadElement(slideId, element, element.id)))
  }

  private canReadElement(slideId: string, element: Element | undefined, elementId?: string): boolean {
    if (!element) return false
    if (this.grantedScope.kind === 'document') return true
    const candidateElementId = elementId ?? element.id
    if (this.grantedScope.kind === 'slide' && this.grantedScope.slideIds?.includes(slideId) && !hasElementSelectors(this.grantedScope)) return true
    if (candidateElementId && this.grantedScope.elementIds?.includes(candidateElementId)) return true
    if (this.grantedScope.semanticKeys?.includes(element.semanticKey ?? '')) return true
    if (this.selection?.slideId === slideId && this.selection.elementIds.includes(element.id)) return true
    return false
  }

  private canReadPermission(permission: ScopePermission): boolean {
    return this.grantedScope.permissions.includes(permission)
  }

  private document(): PpteDocument { return this.session.getDocument() }
  private revision(): Revision { return this.session.getRevision() }
}

/** The original small helper remains available for the Stable Core example. */
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
    return { ...first, transactionId, operations: [{ ...first.operations[0], opId: `${transactionId}:first` }, { opId: `${transactionId}:second`, kind: 'text.replaceContent', slideId, elementId: secondElementId, content }] }
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
    maxChangedFacts: 0,
    maxChangedSources: 0,
    maxChangedThemeTokens: 0,
    maxChangedStylePresets: 0,
    preserve: { style: 'preserve', geometry: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' },
    requireConfirmation: false,
    userIntentSummary: 'Only replace selected text content.',
  }
}

function replaceArtworkTransaction(revision: Revision, slideId: string, elementId: string, assetId: string, transactionId: string): Transaction {
  return {
    transactionId,
    baseRevision: revision,
    actor: { type: 'agent', id: 'artwork' },
    scope: { kind: 'selection', slideIds: [slideId], elementIds: [elementId], permissions: ['assets'], allowInsert: false, allowDelete: false },
    changeContract: { allowedOperationKinds: ['image.replaceAsset'], allowedElementIds: [elementId], maxChangedSlides: 1, maxChangedElements: 1, maxInsertedElements: 0, maxDeletedElements: 0, maxReplacedAssets: 1, maxChangedFacts: 0, maxChangedSources: 0, maxChangedThemeTokens: 0, maxChangedStylePresets: 0, preserve: { content: 'preserve', data: 'preserve', style: 'preserve', geometry: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' }, requireConfirmation: true, userIntentSummary: 'Replace one artwork asset while preserving its placement and semantic identity.' },
    reason: 'Replace artwork asset.',
    createdAt: '2026-09-03T00:00:00.000Z',
    validationLevel: 'L3',
    operations: [{ opId: `${transactionId}:replace`, kind: 'image.replaceAsset', slideId, elementId, assetId, preserveCrop: true, preconditions: [{ kind: 'element-exists', slideId, elementId }] }],
  }
}

function inferSlideIR(document: PpteDocument, slideId: string): SlideIR {
  const slide = document.slides[slideId]
  if (!slide) throw new Error(`SLIDE_MISSING: ${slideId}`)
  const blocks = slide.rootOrder.map((elementId) => slide.elements[elementId]).filter((element): element is Element => Boolean(element)).filter((element) => element.role !== 'decorative' && element.role !== 'background').map(elementToBlock)
  const purpose = slide.semantic?.purpose ?? 'custom'
  return { irVersion: '1.0' as const, slideKey: slideId, purpose, message: slide.semantic?.keyMessage ?? slide.name ?? '', visualStrategy: slide.visualStrategy ?? 'structured', density: 'medium' as const, blocks, ...(slide.visualStrategy === 'hybrid' ? { artworkIntent: { subject: 'existing artwork', function: 'illustration' as const, placement: 'side' as const } } : {}) }
}

function elementToBlock(element: Element): BlockIR {
  if (element.type === 'text') {
    const kind: BlockIR['kind'] = element.role === 'title' ? 'heading' : element.role === 'source' ? 'source' : element.role === 'metric' ? 'metric' : element.role === 'cta' ? 'cta' : 'paragraph'
    return { key: element.id, kind, content: renderTextPlain(element), semanticKey: element.semanticKey, ...(element.semanticRefs?.factIds ? { factIds: cloneJson(element.semanticRefs.factIds) } : {}), ...(element.semanticRefs?.sourceIds ? { sourceIds: cloneJson(element.semanticRefs.sourceIds) } : {}), importance: element.role === 'title' ? 'primary' as const : 'supporting' as const, editabilityTarget: 'full' as const }
  }
  if (element.type === 'image') return { key: element.id, kind: 'image' as const, content: { assetId: element.assetId }, semanticKey: element.semanticKey, ...(element.semanticRefs?.factIds ? { factIds: cloneJson(element.semanticRefs.factIds) } : {}), ...(element.semanticRefs?.sourceIds ? { sourceIds: cloneJson(element.semanticRefs.sourceIds) } : {}), importance: element.role === 'artwork' ? 'supporting' as const : 'secondary' as const, editabilityTarget: 'replace' as const }
  if (element.type === 'chart') return { key: element.id, kind: 'chart' as const, content: { chartType: element.chartType, data: element.data } as unknown as JsonValue, semanticKey: element.semanticKey, ...(element.semanticRefs?.factIds ? { factIds: cloneJson(element.semanticRefs.factIds) } : {}), ...(element.semanticRefs?.sourceIds ? { sourceIds: cloneJson(element.semanticRefs.sourceIds) } : {}), importance: 'secondary' as const, editabilityTarget: 'property' as const }
  return { key: element.id, kind: 'paragraph' as const, content: element.description ?? '', semanticKey: element.semanticKey, ...(element.semanticRefs?.factIds ? { factIds: cloneJson(element.semanticRefs.factIds) } : {}), ...(element.semanticRefs?.sourceIds ? { sourceIds: cloneJson(element.semanticRefs.sourceIds) } : {}), importance: 'supporting' as const, editabilityTarget: 'property' as const }
}

function readSlideIR(value: unknown): SlideIR | undefined {
  if (value === undefined) return undefined
  const issues = validateSlideIR(value)
  if (issues.some((issue) => issue.severity === 'error')) throw new Error(issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n'))
  return cloneJson(value as SlideIR)
}

function scopeWithin(requested: TransactionScope, granted: TransactionScope): boolean {
  if (requested.permissions.some((permission) => !granted.permissions.includes(permission))) return false
  if (requested.allowInsert === true && granted.allowInsert !== true) return false
  if (requested.allowDelete === true && granted.allowDelete !== true) return false
  if (granted.kind === 'document') return true
  if (requested.kind === 'document') return false
  if (granted.kind === 'selection' && requested.kind !== 'selection') return false
  if (granted.kind === 'custom' && requested.kind !== 'custom' && requested.kind !== 'selection') return false
  if (granted.kind === 'slide' && requested.kind === 'selection') {
    if (requested.slideIds?.some((slideId) => !granted.slideIds?.includes(slideId))) return false
  }
  const grantedSlideIds = granted.slideIds ?? []
  const grantedElementIds = granted.elementIds ?? []
  const grantedSemanticKeys = granted.semanticKeys ?? []
  if (granted.slideIds && (!requested.slideIds || requested.slideIds.some((slideId) => !grantedSlideIds.includes(slideId)))) return false
  if (granted.elementIds && (!requested.elementIds || requested.elementIds.some((elementId) => !grantedElementIds.includes(elementId)))) return false
  if (granted.semanticKeys && (!requested.semanticKeys || requested.semanticKeys.some((key) => !grantedSemanticKeys.includes(key)))) return false
  return true
}

function hasElementSelectors(scope: TransactionScope): boolean {
  return Boolean(scope.elementIds?.length || scope.semanticKeys?.length)
}

function defaultAgentScope(): TransactionScope {
  return { kind: 'document', permissions: ['content', 'geometry', 'style', 'structure', 'theme', 'assets', 'facts', 'sources', 'notes', 'animation', 'review'], allowInsert: true, allowDelete: true }
}

function operationResult(tool: AgentToolName, revision: Revision, result: PreviewResult | CommitResult): AgentToolResult {
  const proposedRevision = 'proposedRevision' in result ? result.proposedRevision : undefined
  const nextRevision = 'afterRevision' in result ? result.afterRevision ?? revision : proposedRevision ?? revision
  return { tool, ok: result.ok, revision: nextRevision, issues: result.issues, diff: result.diff, mutationBudget: result.diff?.mutationSummary, requiresConfirmation: 'requiresConfirmation' in result ? result.requiresConfirmation : undefined, data: 'document' in result && result.document ? { document: result.document } : undefined }
}

function generatedResult(tool: AgentToolName, revision: Revision, data: unknown, transaction: Transaction, preview: AgentToolResult): AgentToolResult {
  return { tool, ok: preview.ok, revision, data, issues: preview.issues, diff: preview.diff, mutationBudget: preview.mutationBudget, requiresConfirmation: preview.requiresConfirmation, transaction: cloneJson(transaction) }
}

function success<T>(tool: AgentToolName, revision: Revision, data: T): AgentToolResult<T> { return { tool, ok: true, revision, data, issues: [] } }
function failure<T = unknown>(tool: AgentToolName, code: string, revision: Revision, message: string): AgentToolResult<T> { return { tool, ok: false, revision, issues: [toolIssue(code, message)] } }
function failureWithIssues(tool: AgentToolName, revision: Revision, issues: ValidationIssue[]): AgentToolResult { return { tool, ok: false, revision, issues } }
function toolIssue(code: string, message: string): ValidationIssue { return withErrorSemantics({ code, severity: 'error', message }) }
function transactionArgument(value: unknown): Transaction { return value as Transaction }
function stringArg(args: Record<string, unknown>, key: string): string { const value = args[key]; if (typeof value !== 'string' || value.length === 0) throw new Error(`ARGUMENT_INVALID: ${key} is required.`); return value }
function stringArgOr(args: Record<string, unknown>, key: string, fallback: string): string { const value = args[key]; return typeof value === 'string' && value.length > 0 ? value : fallback }
function optionalString(args: Record<string, unknown>, key: string): string | undefined { return typeof args[key] === 'string' && args[key].length > 0 ? args[key] : undefined }
function stringArray(args: Record<string, unknown>, key: string): string[] { return Array.isArray(args[key]) ? args[key].filter((value): value is string => typeof value === 'string') : [] }
function findElementSlide(document: PpteDocument, elementId: string): string | undefined { return document.slideOrder.find((slideId) => Boolean(document.slides[slideId]?.elements[elementId])) }
function revisionOf(document: PpteDocument): string { return canonicalRevision(document) }
function readPointer(root: unknown, path: string): unknown { if (!path || path === '/') return root; let current: unknown = root; for (const token of path.slice(1).split('/').map((item) => item.replaceAll('~1', '/').replaceAll('~0', '~'))) { if (current === null || typeof current !== 'object') return undefined; current = Array.isArray(current) ? current[Number(token)] : (current as Record<string, unknown>)[token] } return current }
