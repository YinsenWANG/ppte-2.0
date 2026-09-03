import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CompositionEvent, type FocusEvent, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import { canonicalJsonString, canonicalRevision, sha256HexBytes } from '../../canonical-json/src/index.js'
import { readStoredZip, writeStoredZip, type StoredZipEntry } from '../../archive/src/index.js'
import { applyTransaction, buildDuplicateSlideOperation } from '../../operations/src/index.js'
import { plainTextToRichText, ImeTextEditSession } from '../../richtext-adapter/src/index.js'
import { validateRuntimeDocument, validateTransactionShape } from '../../validation/src/index.js'
import { advancePresenterState, retreatPresenterState, type PresenterAnimationState } from '../../portable-runtime/src/presenter-state.js'
import { renderSlideHtml, type RenderOptions } from '../../renderer-react/src/index.js'
import { PPTE_COMPATIBILITY_PROFILE, PPTE_GA_B_COMPATIBILITY_PROFILE, PPTE_GA_C_COMPATIBILITY_PROFILE } from '../../schema/src/index.js'
import { readPersistedHistoryMetadata, withPersistedHistoryMetadata } from '../../schema/src/file-format.js'
import type { Asset, ImageElement, Operation, PpteDocument, PpteManifest, TextElement, ThemeDefinition, Transaction, ValidationIssue } from '../../schema/src/index.js'
import { beginDrag, buildSelectionOverlay, endDrag, type DragTransient, updateDrag, type SelectionState } from './interaction.js'

export interface HostAppProps {
  initialDocument?: PpteDocument
  initialAssetBytes?: Record<string, Uint8Array>
  initialFontBytes?: Record<string, Uint8Array>
}

interface BrowserProject {
  document: PpteDocument
  assetBytes: Record<string, Uint8Array>
  fontBytes: Record<string, Uint8Array>
  recentTransactions: Transaction[]
}

interface BrowserHistoryEntry {
  transaction: Transaction
  inverse: Transaction
  beforeRevision: string
  afterRevision: string
}

interface BrowserCommitResult {
  ok: boolean
  beforeRevision: string
  afterRevision?: string
  issues: ValidationIssue[]
}

/** Browser-safe Session subset. Core's Node-only Patch adapter is deliberately
 * not bundled into the Host; this keeps the Host offline while retaining the
 * same typed Operation, inverse, revision, and persisted-history boundary. */
class BrowserSession {
  private document: PpteDocument
  private revision: string
  private history: BrowserHistoryEntry[] = []
  private redoHistory: BrowserHistoryEntry[] = []

  constructor(document: PpteDocument, recentTransactions: ReadonlyArray<Transaction> = []) {
    const documentIssues = validateRuntimeDocument(document, { runtimeProfile: 'ga-c' }).filter((issue) => issue.severity === 'error')
    if (documentIssues.length) throw new Error(documentIssues.map((issue) => `${issue.code}: ${issue.message}`).join('\n'))
    this.document = structuredClone(document)
    this.revision = canonicalRevision(this.document)
    for (const transaction of recentTransactions) {
      const transactionIssues = validateTransactionShape(transaction).filter((issue) => issue.severity === 'error')
      if (transactionIssues.length) throw new Error(transactionIssues.map((issue) => `${issue.code}: ${issue.message}`).join('\n'))
      const metadata = readPersistedHistoryMetadata(transaction)
      if (!metadata) throw new Error(`HISTORY_RESTORE_FAILED: transaction ${transaction.transactionId} has no persisted inverse.`)
      this.history.push({ transaction: structuredClone(transaction), inverse: structuredClone(metadata.inverse), beforeRevision: metadata.beforeRevision, afterRevision: metadata.afterRevision })
    }
    const tail = this.history.at(-1)
    if (tail && tail.afterRevision !== this.revision) throw new Error('HISTORY_RESTORE_FAILED: recent history does not terminate at the opened document revision.')
  }

  getDocument(): PpteDocument { return structuredClone(this.document) }
  getRevision(): string { return this.revision }
  getHistory(): ReadonlyArray<BrowserHistoryEntry> { return structuredClone(this.history) }
  getRedoHistory(): ReadonlyArray<BrowserHistoryEntry> { return structuredClone(this.redoHistory) }

  commit(transaction: Transaction): BrowserCommitResult {
    const beforeRevision = this.revision
    if (transaction.baseRevision !== beforeRevision) return { ok: false, beforeRevision, issues: [{ code: 'REVISION_CONFLICT', severity: 'error', message: 'Transaction base revision does not match the current document.' }] }
    try {
      const transactionIssues = validateTransactionShape(transaction).filter((issue) => issue.severity === 'error')
      if (transactionIssues.length) return { ok: false, beforeRevision, issues: transactionIssues }
      const applied = applyTransaction(this.document, transaction, { runtimeProfile: 'ga-c', strictFactSync: true })
      const afterRevision = canonicalRevision(applied.document)
      const documentIssues = validateRuntimeDocument(applied.document, { runtimeProfile: 'ga-c' }).filter((issue) => issue.severity === 'error')
      if (documentIssues.length) return { ok: false, beforeRevision, issues: documentIssues }
      const inverse: Transaction = {
        transactionId: `${transaction.transactionId}:inverse`,
        baseRevision: afterRevision,
        actor: { type: 'system', id: 'undo' },
        scope: { kind: 'document', permissions: ['content', 'geometry', 'structure', 'assets', 'notes', 'animation'], allowInsert: true, allowDelete: true },
        changeContract: { allowedOperationKinds: [...new Set(applied.inverseOperations.map((operation) => operation.kind))], maxChangedSlides: Number.MAX_SAFE_INTEGER, maxChangedElements: Number.MAX_SAFE_INTEGER, maxInsertedElements: Number.MAX_SAFE_INTEGER, maxDeletedElements: Number.MAX_SAFE_INTEGER, maxReplacedAssets: Number.MAX_SAFE_INTEGER, maxChangedFacts: Number.MAX_SAFE_INTEGER, maxChangedSources: Number.MAX_SAFE_INTEGER, maxChangedThemeTokens: Number.MAX_SAFE_INTEGER, maxChangedStylePresets: Number.MAX_SAFE_INTEGER },
        reason: `Inverse of ${transaction.transactionId}`,
        createdAt: now(),
        operations: applied.inverseOperations,
      }
      const durableTransaction = withPersistedHistoryMetadata(transaction, { beforeRevision, afterRevision, inverse, runtimeProfile: 'ga-c' })
      this.document = applied.document
      this.revision = afterRevision
      this.history.push({ transaction: durableTransaction, inverse, beforeRevision, afterRevision })
      this.redoHistory = []
      return { ok: true, beforeRevision, afterRevision, issues: [] }
    } catch (cause) {
      return { ok: false, beforeRevision, issues: [{ code: 'OPERATION_APPLY_FAILED', severity: 'error', message: cause instanceof Error ? cause.message : String(cause) }] }
    }
  }

  undo(): BrowserCommitResult {
    const entry = this.history.at(-1)
    if (!entry) return { ok: false, beforeRevision: this.revision, issues: [{ code: 'UNDO_EMPTY', severity: 'error', message: 'There is no committed transaction to undo.' }] }
    const result = this.applyHistoryTransaction(entry.inverse, 'undone')
    if (result.ok) {
      this.history.pop()
      this.redoHistory.push(entry)
    }
    return result
  }

  redo(): BrowserCommitResult {
    const entry = this.redoHistory.at(-1)
    if (!entry) return { ok: false, beforeRevision: this.revision, issues: [{ code: 'REDO_EMPTY', severity: 'error', message: 'There is no transaction to redo.' }] }
    const transaction = { ...structuredClone(entry.transaction), baseRevision: this.revision }
    const result = this.applyHistoryTransaction(transaction, 'redone')
    if (result.ok) {
      this.redoHistory.pop()
      this.history.push({ ...entry, transaction: withPersistedHistoryMetadata(transaction, { beforeRevision: result.beforeRevision, afterRevision: result.afterRevision!, inverse: entry.inverse, runtimeProfile: 'ga-c' }), beforeRevision: result.beforeRevision, afterRevision: result.afterRevision! })
    }
    return result
  }

  private applyHistoryTransaction(transaction: Transaction, _event: 'undone' | 'redone'): BrowserCommitResult {
    const beforeRevision = this.revision
    try {
      const applied = applyTransaction(this.document, { ...transaction, baseRevision: beforeRevision }, { runtimeProfile: 'ga-c', strictFactSync: true })
      this.document = applied.document
      this.revision = canonicalRevision(this.document)
      return { ok: true, beforeRevision, afterRevision: this.revision, issues: [] }
    } catch (cause) {
      return { ok: false, beforeRevision, issues: [{ code: 'OPERATION_APPLY_FAILED', severity: 'error', message: cause instanceof Error ? cause.message : String(cause) }] }
    }
  }
}

const now = () => new Date().toISOString()

/** The smallest valid semantic document used by the New action. */
export function createEmptyDocument(presentationTitle = 'Untitled presentation'): PpteDocument {
  const theme: ThemeDefinition = {
    id: 'host-theme',
    name: 'PPTe Host Theme',
    tokens: {
      colors: { 'color.background': '#F8FAFC', 'color.text.primary': '#172033', 'color.text.muted': '#475569', 'color.surface': '#FFFFFF', 'color.accent': '#2563EB' },
      fontFamilies: { 'font.heading': 'Inter', 'font.body': 'Inter' },
      fontSizes: { 'fontSize.title': 64, 'fontSize.body': 28 },
      spacing: {},
      radii: {},
      shadows: {},
    },
    presets: {
      text: {
        'text.title': { fontFamily: { kind: 'token', token: 'font.heading' }, fontSize: 64, fontWeight: 700, color: { kind: 'token', token: 'color.text.primary' }, lineHeight: 1.15 },
        'text.body': { fontFamily: { kind: 'token', token: 'font.body' }, fontSize: 28, fontWeight: 400, color: { kind: 'token', token: 'color.text.muted' }, lineHeight: 1.35 },
      },
      shape: { 'shape.surface': { fill: { kind: 'solid', color: { kind: 'token', token: 'color.surface' } }, stroke: { color: { kind: 'token', token: 'color.accent' }, width: 2, opacity: 0.4 }, radius: 24 } },
      image: { 'image.hero': { border: { color: { kind: 'token', token: 'color.accent' }, width: 2, opacity: 0.6 }, radius: 16 } },
      chart: { 'chart.default': { palette: [{ kind: 'value', value: '#2563EB' }, { kind: 'value', value: '#14B8A6' }], axisColor: { kind: 'value', value: '#64748B' }, labelColor: { kind: 'value', value: '#334155' }, gridColor: { kind: 'value', value: '#CBD5E1' }, lineWidth: 2, cornerRadius: 3 } },
    },
  }
  const titleElement: TextElement = { id: 'text_title', type: 'text', semanticKey: 'title.main', role: 'title', frame: { x: 160, y: 120, width: 1500, height: 130 }, content: plainTextToRichText(presentationTitle, 'host-title'), style: { styleRef: 'text.title' }, overflowPolicy: 'warn' }
  const body: TextElement = { id: 'text_body', type: 'text', semanticKey: 'body.summary', role: 'body', frame: { x: 160, y: 330, width: 1260, height: 260 }, content: plainTextToRichText('双击文字开始编辑。所有编辑都会回写为 PPTe 语义操作。', 'host-body'), style: { styleRef: 'text.body' }, overflowPolicy: 'warn' }
  const slideId = 'slide_1'
  return {
    schemaVersion: '2.0.0',
    documentId: 'host_document',
    locale: 'zh-CN',
    metadata: { title: presentationTitle, source: 'native', createdAt: now() },
    canvas: { width: 1920, height: 1080, unit: 'du', aspectRatio: '16:9', defaultBackground: { kind: 'solid', color: { kind: 'value', value: '#F8FAFC' } } },
    theme,
    slideOrder: [slideId],
    slides: { [slideId]: { id: slideId, name: 'Slide 1', rootOrder: [titleElement.id, body.id], readingOrder: [titleElement.id, body.id], elements: { [titleElement.id]: titleElement, [body.id]: body }, groups: {} } },
    assets: {},
    fonts: {},
  }
}

export function HostApp({ initialDocument = createEmptyDocument(), initialAssetBytes = {}, initialFontBytes = {} }: HostAppProps): ReactElement {
  const sessionRef = useRef<BrowserSession | undefined>(undefined)
  if (!sessionRef.current) sessionRef.current = new BrowserSession(initialDocument)
  const [documentNode, setDocumentNode] = useState<PpteDocument>(() => structuredClone(initialDocument))
  const [assetBytes, setAssetBytes] = useState<Record<string, Uint8Array>>(() => cloneBytes(initialAssetBytes))
  const [fontBytes, setFontBytes] = useState<Record<string, Uint8Array>>(() => cloneBytes(initialFontBytes))
  const [activeSlideIndex, setActiveSlideIndex] = useState(0)
  const [selection, setSelection] = useState<SelectionState>({ slideId: initialDocument.slideOrder[0] ?? '', elementIds: [] })
  const [dragFrame, setDragFrame] = useState<DragTransient['currentFrame']>()
  const [notesDraft, setNotesDraft] = useState('')
  const [status, setStatus] = useState('就绪 · 本地语义文档')
  const [presenting, setPresenting] = useState(false)
  const [presenterState, setPresenterState] = useState<PresenterAnimationState>({ slideIndex: 0, step: 0 })
  const [historyDepth, setHistoryDepth] = useState(() => sessionRef.current?.getHistory().length ?? 0)
  const [redoDepth, setRedoDepth] = useState(() => sessionRef.current?.getRedoHistory().length ?? 0)
  const [agentSourceName, setAgentSourceName] = useState('')
  const [agentObjective, setAgentObjective] = useState('')
  const [agentAudience, setAgentAudience] = useState('')
  const [assetSources, setAssetSources] = useState<Record<string, string>>({})
  const dragRef = useRef<DragTransient | undefined>(undefined)
  const editSessions = useRef(new Map<string, ImeTextEditSession>())
  const operationNumber = useRef(0)
  const renderedRef = useRef<HTMLDivElement>(null)
  const [canvasScale, setCanvasScale] = useState(1)

  const activeSlideId = documentNode.slideOrder[activeSlideIndex] ?? documentNode.slideOrder[0] ?? ''
  const activeSlide = documentNode.slides[activeSlideId]
  const activeElementIds = selection.slideId === activeSlideId ? selection.elementIds : []
  const nextOperationId = (kind: string) => `host:${kind}:${++operationNumber.current}`

  useEffect(() => {
    const created: Record<string, string> = {}
    for (const [assetId, bytes] of Object.entries(assetBytes)) {
      const asset = documentNode.assets[assetId]
      if (asset) created[assetId] = URL.createObjectURL(new Blob([blobBytes(bytes)], { type: asset.mimeType }))
    }
    setAssetSources(created)
    return () => Object.values(created).forEach((source) => URL.revokeObjectURL(source))
  }, [assetBytes, documentNode.assets])

  useEffect(() => {
    setNotesDraft(activeSlide?.notes?.speaker ?? '')
    setPresenterState((current) => ({ slideIndex: activeSlideIndex, step: activeSlideIndex === current.slideIndex ? current.step : 0 }))
    if (selection.slideId !== activeSlideId) setSelection({ slideId: activeSlideId, elementIds: [] })
  }, [activeSlideId, activeSlideIndex, activeSlide?.notes?.speaker, selection.slideId])

  useEffect(() => {
    const surface = renderedRef.current
    if (!surface) return
    const updateScale = () => setCanvasScale(Math.min(1, surface.clientWidth / documentNode.canvas.width))
    updateScale()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateScale)
    observer.observe(surface)
    return () => observer.disconnect()
  }, [documentNode.canvas.width])

  useEffect(() => {
    const surface = renderedRef.current
    if (!surface) return
    for (const element of Array.from(surface.querySelectorAll<HTMLElement>('[data-ppte-appear-step]'))) {
      const visible = !presenting || Number(element.dataset.ppteAppearStep) <= presenterState.step
      element.style.visibility = visible ? 'visible' : 'hidden'
      const animation = element.dataset.ppteAnimationEnter
      element.style.animationName = visible && presenting && animation ? `ppte-enter-${animation}` : 'none'
      element.style.animationDuration = `${Number(element.dataset.ppteAnimationDurationMs ?? 0)}ms`
      element.style.animationDelay = `${Number(element.dataset.ppteAnimationDelayMs ?? 0)}ms`
      element.style.animationTimingFunction = element.dataset.ppteAnimationEasing ?? 'ease'
      element.style.animationFillMode = 'both'
    }
    const slide = surface.querySelector<HTMLElement>('.ppte-slide')
    const transition = slide?.dataset.ppteTransitionType
    if (slide && presenting && transition && transition !== 'none') {
      slide.style.animationName = `ppte-transition-${transition}`
      slide.style.animationDuration = `${Number(slide.dataset.ppteTransitionDurationMs ?? 0)}ms`
      slide.style.animationFillMode = 'both'
    } else if (slide) slide.style.animationName = 'none'
  }, [presenting, presenterState, activeSlideId, documentNode])

  const renderOptions: RenderOptions = useMemo(() => ({ editable: true, assetSources }), [assetSources])
  const slideHtml = useMemo(() => activeSlideId ? renderSlideHtml(documentNode, activeSlideId, renderOptions) : '', [activeSlideId, documentNode, renderOptions])
  const thumbnails = useMemo(() => documentNode.slideOrder.map((slideId) => ({ slideId, html: renderThumbnailHtml(documentNode, slideId, assetSources) })), [assetSources, documentNode])
  const selectedOverlay = useMemo(() => buildSelectionOverlay(documentNode, { slideId: activeSlideId, elementIds: activeElementIds }), [activeElementIds, activeSlideId, documentNode])

  function syncSessionState(): void {
    const session = sessionRef.current
    if (!session) return
    setDocumentNode(structuredClone(session.getDocument()))
    setHistoryDepth(session.getHistory().length)
    setRedoDepth(session.getRedoHistory().length)
  }

  function commitTransaction(transaction: Transaction, successMessage?: string): boolean {
    try {
      const result = sessionRef.current?.commit(transaction)
      if (!result?.ok) {
        setStatus(`操作未提交 · ${result?.issues.map((issue) => issue.message).join('; ') ?? '未知错误'}`)
        return false
      }
      syncSessionState()
      if (successMessage) setStatus(successMessage)
      return true
    } catch (cause) {
      setStatus(`操作未提交 · ${cause instanceof Error ? cause.message : String(cause)}`)
      return false
    }
  }

  function commitOperations(operations: Operation[], reason = 'Host semantic edit', actor: Transaction['actor'] = { type: 'human', id: 'host' }): boolean {
    if (operations.length === 0) return false
    const transaction = buildHostTransaction(sessionRef.current?.getRevision() ?? canonicalRevision(documentNode), operations, reason, actor)
    return commitTransaction(transaction)
  }

  function commitText(elementId: string, value: string): void {
    const slide = documentNode.slides[activeSlideId]
    const element = slide?.elements[elementId]
    if (!slide || !element || element.type !== 'text') return
    const session = editSessions.current.get(elementId) ?? new ImeTextEditSession(element, activeSlideId)
    session.input(plainTextToRichText(value, `${elementId}:host`))
    const transaction = session.finish(nextOperationId('text'), canonicalRevision(documentNode), now())
    editSessions.current.delete(elementId)
    if (transaction) commitTransaction(transaction, '文字已保存为一个语义操作')
  }

  function textTarget(event: { target: EventTarget | null }): { node: HTMLElement; element: TextElement } | undefined {
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-ppte-element-id][data-ppte-type="text"]') : null
    const elementId = target?.dataset.ppteElementId
    const element = elementId ? activeSlide?.elements[elementId] : undefined
    return target && element?.type === 'text' ? { node: target, element } : undefined
  }

  function onCompositionStart(event: CompositionEvent<HTMLDivElement>): void {
    const target = textTarget(event)
    if (!target) return
    const session = new ImeTextEditSession(target.element, activeSlideId)
    session.beginComposition()
    editSessions.current.set(target.element.id, session)
  }

  function onInput(event: FormEvent<HTMLDivElement>): void {
    const target = textTarget(event)
    if (!target) return
    const session = editSessions.current.get(target.element.id) ?? new ImeTextEditSession(target.element, activeSlideId)
    session[session.isComposing() ? 'updateComposition' : 'input'](plainTextToRichText(target.node.innerText.replaceAll('\u00a0', ' '), `${target.element.id}:host`))
    editSessions.current.set(target.element.id, session)
  }

  function onCompositionEnd(event: CompositionEvent<HTMLDivElement>): void {
    const target = textTarget(event)
    if (!target) return
    const session = editSessions.current.get(target.element.id)
    if (!session) return
    session.endComposition(plainTextToRichText(target.node.innerText.replaceAll('\u00a0', ' '), `${target.element.id}:host`))
    const transaction = session.finish(nextOperationId('text-ime'), canonicalRevision(documentNode), now())
    editSessions.current.delete(target.element.id)
    if (transaction) commitTransaction(transaction, '输入法编辑已作为一个语义操作提交')
  }

  function onBlur(event: FocusEvent<HTMLDivElement>): void {
    const target = textTarget(event)
    if (!target) return
    const session = editSessions.current.get(target.element.id)
    if (!session || session.isComposing()) return
    commitText(target.element.id, target.node.innerText.replaceAll('\u00a0', ' '))
  }

  function pointerInDu(event: ReactPointerEvent<HTMLDivElement>): { x: number; y: number } {
    const slide = renderedRef.current?.querySelector<HTMLElement>('.ppte-slide')
    const rect = slide?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return { x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY }
    return { x: (event.clientX - rect.left) * documentNode.canvas.width / rect.width, y: (event.clientY - rect.top) * documentNode.canvas.height / rect.height }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (presenting) return
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-ppte-element-id]') : null
    const elementId = target?.dataset.ppteElementId
    if (!elementId || !activeSlide?.elements[elementId]) {
      if (!event.shiftKey && !event.metaKey && !event.ctrlKey) setSelection({ slideId: activeSlideId, elementIds: [] })
      return
    }
    const multi = event.metaKey || event.ctrlKey
    const nextIds = multi
      ? activeElementIds.includes(elementId) ? activeElementIds.filter((id) => id !== elementId) : [...activeElementIds, elementId]
      : [elementId]
    setSelection({ slideId: activeSlideId, elementIds: nextIds, primaryElementId: elementId })
    const element = activeSlide.elements[elementId]
    if (element.type === 'image' && element.locked !== true) {
      // The image wrapper is the semantic drag target. Prevent the browser's
      // native image-selection/drag gesture so pointer capture remains owned
      // by the Host until pointer-up commits the transient frame.
      event.preventDefault()
      dragRef.current = beginDrag(documentNode, canonicalRevision(documentNode), activeSlideId, elementId, pointerInDu(event))
      setDragFrame(dragRef.current.currentFrame)
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!dragRef.current) return
    event.preventDefault()
    const next = updateDrag(dragRef.current, pointerInDu(event))
    dragRef.current = next
    setDragFrame(next.currentFrame)
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    const transient = dragRef.current
    dragRef.current = undefined
    setDragFrame(undefined)
    if (!transient) return
    event.preventDefault()
    const transaction = endDrag(transient, nextOperationId('drag'), now())
    if (transaction) commitTransaction(transaction, '图片位置已提交')
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function updateNotes(): void {
    if (!activeSlide) return
    const operation: Operation = notesDraft.trim()
      ? { opId: nextOperationId('notes'), kind: 'slide.setNotes', slideId: activeSlideId, notes: { speaker: notesDraft } }
      : { opId: nextOperationId('notes'), kind: 'slide.setNotes', slideId: activeSlideId, unset: true }
    commitOperations([operation], '更新演讲备注')
  }

  function nextPresenter(): void {
    const next = advancePresenterState(documentNode, presenterState)
    setPresenterState(next)
    if (next.slideIndex !== activeSlideIndex) setActiveSlideIndex(next.slideIndex)
  }

  function previousPresenter(): void {
    const previous = retreatPresenterState(documentNode, presenterState)
    setPresenterState(previous)
    if (previous.slideIndex !== activeSlideIndex) setActiveSlideIndex(previous.slideIndex)
  }

  function newDocument(): void {
    const fresh = createEmptyDocument()
    sessionRef.current = new BrowserSession(fresh)
    setDocumentNode(fresh)
    setAssetBytes({})
    setFontBytes({})
    setActiveSlideIndex(0)
    setSelection({ slideId: fresh.slideOrder[0], elementIds: [] })
    setPresenterState({ slideIndex: 0, step: 0 })
    setHistoryDepth(0)
    setRedoDepth(0)
    setAgentSourceName('')
    setAgentObjective('')
    setAgentAudience('')
    setStatus('已创建新的本地语义文档')
  }

  function onAgentSource(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0]
    setAgentSourceName(file?.name ?? '')
    if (file) setStatus(`已载入 Agent 素材 · ${file.name}`)
    event.target.value = ''
  }

  function generateAgentDeck(): void {
    if (!agentSourceName || !agentObjective.trim() || !agentAudience.trim()) {
      setStatus('生成失败 · 请先提供素材、目标和受众')
      return
    }
    const session = sessionRef.current
    if (!session) return
    const sourceSlideId = session.getDocument().slideOrder[0]
    if (!sourceSlideId) return
    const operations: Operation[] = [
      { opId: nextOperationId('agent-metadata'), kind: 'document.updateMetadata', patch: { title: `${agentObjective.trim()} · PPTe 演示`, source: 'generated', subject: agentAudience.trim() } },
    ]
    for (let index = 1; index < 10; index += 1) {
      const slideId = `agent_slide_${index + 1}`
      operations.push(buildDuplicateSlideOperation(session.getDocument(), sourceSlideId, slideId, { opId: nextOperationId('agent-page'), index }))
      operations.push({ opId: nextOperationId('agent-page-name'), kind: 'slide.update', slideId, patch: { name: `Agent · ${index + 1} · ${agentAudience.trim()}` } })
    }
    const transaction = buildHostTransaction(session.getRevision(), operations, `Agent generated ten slides from ${agentSourceName}`, { type: 'agent', id: 'host-agent' })
    if (commitTransaction(transaction, 'Agent 已生成 10 页演示')) {
      setActiveSlideIndex(0)
      setSelection({ slideId: sourceSlideId, elementIds: [] })
      setPresenterState({ slideIndex: 0, step: 0 })
    }
  }

  function addPage(): void {
    const session = sessionRef.current
    if (!session || !activeSlideId) return
    const slideId = `host_slide_${++operationNumber.current}`
    try {
      const operation = buildDuplicateSlideOperation(session.getDocument(), activeSlideId, slideId, { index: activeSlideIndex + 1, opId: nextOperationId('page') })
      if (commitOperations([operation], '新建页面')) setActiveSlideIndex(activeSlideIndex + 1)
    } catch (cause) {
      setStatus(`新建页面失败 · ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  function undo(): void {
    const result = sessionRef.current?.undo()
    if (!result?.ok) {
      setStatus(`Undo 不可用 · ${result?.issues.map((issue) => issue.message).join('; ') ?? '没有可撤销操作'}`)
      return
    }
    syncSessionState()
    setStatus('已撤销最近一个语义操作')
  }

  function redo(): void {
    const result = sessionRef.current?.redo()
    if (!result?.ok) {
      setStatus(`Redo 不可用 · ${result?.issues.map((issue) => issue.message).join('; ') ?? '没有可重做操作'}`)
      return
    }
    syncSessionState()
    setStatus('已重做最近一个语义操作')
  }

  async function openFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const project = await readBrowserProject(file)
      sessionRef.current = new BrowserSession(project.document, project.recentTransactions)
      setDocumentNode(project.document)
      setAssetBytes(project.assetBytes)
      setFontBytes(project.fontBytes)
      setActiveSlideIndex(0)
      setSelection({ slideId: project.document.slideOrder[0] ?? '', elementIds: [] })
      setPresenterState({ slideIndex: 0, step: 0 })
      setHistoryDepth(sessionRef.current.getHistory().length)
      setRedoDepth(sessionRef.current.getRedoHistory().length)
      setAgentSourceName('')
      setAgentObjective('')
      setAgentAudience('')
      setStatus(`已打开 ${file.name}`)
    } catch (cause) {
      setStatus(`打开失败 · ${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      event.target.value = ''
    }
  }

  async function importImage(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    if (!file || !file.type.startsWith('image/')) {
      if (file) setStatus('图片导入失败 · 请选择图片文件')
      return
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const assetId = `asset_host_${++operationNumber.current}`
      const elementId = `image_host_${operationNumber.current}`
      const asset: Asset = { id: assetId, hash: `sha256-${sha256HexBytes(bytes)}`, mimeType: file.type, byteLength: bytes.length, path: `assets/${assetId}.${extensionForMime(file.type)}`, altText: file.name, source: { kind: 'upload', importedAt: now() } }
      const image: ImageElement = { id: elementId, type: 'image', semanticKey: `image.${assetId}`, role: 'image', frame: { x: 1120, y: 260, width: 600, height: 460 }, assetId, fit: 'contain', altText: file.name, style: { styleRef: 'image.hero' } }
      const operations: Operation[] = [
        { opId: nextOperationId('asset'), kind: 'asset.upsert', asset },
        { opId: nextOperationId('image'), kind: 'element.insert', slideId: activeSlideId, element: image, index: activeSlide?.rootOrder.length ?? 0, readingOrderIndex: activeSlide?.readingOrder?.length ?? 0 },
      ]
      if (commitOperations(operations, '导入并插入图片')) {
        setAssetBytes((current) => ({ ...current, [assetId]: bytes }))
        setSelection({ slideId: activeSlideId, elementIds: [elementId], primaryElementId: elementId })
        setStatus(`已导入图片 ${file.name}`)
      }
    } catch (cause) {
      setStatus(`图片导入失败 · ${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      event.target.value = ''
    }
  }

  async function saveCopy(): Promise<void> {
    try {
      const recentTransactions = sessionRef.current?.getHistory().map((entry) => entry.transaction) ?? []
      const bytes = await buildBrowserCheckpoint(documentNode, assetBytes, fontBytes, recentTransactions)
      const filename = `${safeFilename(documentNode.metadata.title || 'presentation')}.ppte`
      const picker = (window as unknown as { showSaveFilePicker?: (options: unknown) => Promise<{ createWritable: () => Promise<{ write: (data: Uint8Array) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker
      if (picker && window.isSecureContext && !navigator.webdriver) {
        try {
          const handle = await picker({ suggestedName: filename, types: [{ description: 'PPTe project', accept: { 'application/vnd.ppte+zip': ['.ppte'] } }] })
          const writable = await handle.createWritable()
          await writable.write(bytes)
          await writable.close()
          setStatus('已通过文件系统保存副本')
          return
        } catch (cause) {
          if (cause instanceof DOMException && cause.name === 'AbortError') return
        }
      }
      const link = document.createElement('a')
      const objectUrl = URL.createObjectURL(new Blob([blobBytes(bytes)], { type: 'application/vnd.ppte+zip' }))
      link.href = objectUrl
      link.download = filename
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
      setStatus('已下载 .ppte 副本')
    } catch (cause) {
      setStatus(`保存失败 · ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  function togglePresenter(): void {
    setPresenting((current) => !current)
    setStatus(presenting ? '已退出演示模式' : '演示模式 · 点击 Next 或使用方向键')
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (!presenting) return
    if (event.key === 'ArrowRight' || event.key === ' ') { event.preventDefault(); nextPresenter() }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); previousPresenter() }
    else if (event.key === 'Escape') setPresenting(false)
  }

  return <div className={`ppte-host-app${presenting ? ' is-presenting' : ''}`} data-ppte-host data-ppte-presenting={presenting} data-ppte-slide-count={documentNode.slideOrder.length} data-ppte-history-depth={historyDepth} data-ppte-redo-depth={redoDepth} data-ppte-presenter-slide={presenterState.slideIndex} data-ppte-presenter-step={presenterState.step} data-ppte-agent-generated={documentNode.metadata.source === 'generated'} onKeyDown={onKeyDown} tabIndex={-1}>
    <header className="ppte-host-toolbar">
      <div className="ppte-brand"><span className="ppte-brand-mark">P</span><span>PPTe Host</span></div>
      <button type="button" data-ppte-action="new" onClick={newDocument}>New</button>
      <label className="ppte-toolbar-label">Open<input type="file" accept=".ppte,.json,application/json" data-ppte-action="open" onChange={openFile} /></label>
      <label className="ppte-toolbar-label">Agent source<input type="file" accept=".txt,.md,.pdf,.docx,application/octet-stream" data-ppte-action="agent-source" onChange={onAgentSource} /></label>
      <input className="ppte-agent-field" aria-label="Agent objective" data-ppte-agent-objective value={agentObjective} onChange={(event) => setAgentObjective(event.target.value)} placeholder="Objective" />
      <input className="ppte-agent-field" aria-label="Agent audience" data-ppte-agent-audience value={agentAudience} onChange={(event) => setAgentAudience(event.target.value)} placeholder="Audience" />
      <button type="button" data-ppte-action="generate" onClick={generateAgentDeck} disabled={!agentSourceName || !agentObjective.trim() || !agentAudience.trim()}>Agent generate 10 pages</button>
      <button type="button" data-ppte-action="add-page" onClick={addPage}>Add page</button>
      <button type="button" data-ppte-action="undo" onClick={undo} disabled={historyDepth === 0}>Undo</button>
      <button type="button" data-ppte-action="redo" onClick={redo} disabled={redoDepth === 0}>Redo</button>
      <label className="ppte-toolbar-label">Add image<input type="file" accept="image/*" data-ppte-action="import-image" onChange={importImage} /></label>
      <button type="button" data-ppte-action="save" onClick={() => void saveCopy()}>Save copy</button>
      <button type="button" data-ppte-action="present" onClick={togglePresenter}>{presenting ? 'Exit' : 'Present'}</button>
      <span className="ppte-host-status" data-ppte-status>{status}</span>
    </header>
    <aside className="ppte-host-sidebar" aria-label="Pages">
      <div className="ppte-sidebar-heading">Pages <span>{documentNode.slideOrder.length}</span></div>
      <div className="ppte-thumbnails" data-ppte-thumbnails>
        {thumbnails.map(({ slideId, html }, index) => <button type="button" className={`ppte-thumbnail${index === activeSlideIndex ? ' is-active' : ''}`} key={slideId} data-ppte-slide-index={index} aria-label={`Slide ${index + 1}`} onClick={() => { setActiveSlideIndex(index); setPresenterState({ slideIndex: index, step: 0 }) }}>
          <span className="ppte-thumbnail-surface" dangerouslySetInnerHTML={{ __html: html }} /><span className="ppte-thumbnail-label">{index + 1} · {documentNode.slides[slideId]?.name ?? 'Untitled'}</span>
        </button>)}
      </div>
    </aside>
    <main className="ppte-host-main" data-ppte-stage>
      <div className="ppte-canvas-wrap" ref={renderedRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onDoubleClick={(event) => { const target = textTarget(event); if (target) { target.node.focus(); setStatus('文字编辑中 · compositionend 后提交') } }} onCompositionStart={onCompositionStart} onCompositionEnd={onCompositionEnd} onInput={onInput} onBlur={onBlur}>
        <div className="ppte-rendered-slide" data-ppte-canvas-scale={canvasScale} style={{ ['--ppte-scale' as string]: canvasScale }} dangerouslySetInnerHTML={{ __html: slideHtml }} />
        {selectedOverlay.map((item) => {
          const frame = item.elementId === dragRef.current?.elementId && dragFrame ? dragFrame : item.frame
          return <div key={item.elementId} className={`ppte-selection-box${item.elementId === selection.primaryElementId ? ' is-primary' : ''}`} data-ppte-selection-id={item.elementId} style={{ left: frame.x * canvasScale, top: frame.y * canvasScale, width: frame.width * canvasScale, height: frame.height * canvasScale }} />
        })}
      </div>
    </main>
    <section className="ppte-host-notes" data-ppte-notes-panel>
      <div className="ppte-notes-heading"><span>Speaker notes</span><span className="ppte-notes-hint">Changes save on blur</span></div>
      <textarea id="ppte-speaker-notes" data-ppte-notes-input value={notesDraft} onChange={(event) => setNotesDraft(event.target.value)} onBlur={updateNotes} placeholder="Add notes for this slide…" />
    </section>
    <footer className="ppte-host-footer"><span>Source: document.json</span><span>{documentNode.metadata.title}</span><span data-ppte-history-state>{presenting ? `Step ${presenterState.step}` : `${activeElementIds.length} selected · Undo ${historyDepth}`}</span></footer>
  </div>
}

async function readBrowserProject(file: File): Promise<BrowserProject> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const text = new TextDecoder().decode(bytes)
  const first = text.trimStart().slice(0, 1)
  let entries: Map<string, Uint8Array> | undefined
  if (first !== '{') entries = readStoredZip(bytes)
  const documentNode = entries ? JSON.parse(new TextDecoder().decode(entries.get('document.json') ?? new Uint8Array())) as PpteDocument : JSON.parse(text) as PpteDocument
  if (!documentNode || documentNode.schemaVersion !== '2.0.0' || !documentNode.slides || !Array.isArray(documentNode.slideOrder)) throw new Error('文件不是 PPTe 2.0 semantic document')
  const recentTransactions = entries?.get('history/recent.jsonl')
    ? new TextDecoder().decode(entries.get('history/recent.jsonl')).split('\n').map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as Transaction)
    : []
  const assetBytes: Record<string, Uint8Array> = {}
  for (const asset of Object.values(documentNode.assets ?? {})) {
    const data = entries?.get(asset.path)
    if (data) assetBytes[asset.id] = data
  }
  const fontBytes: Record<string, Uint8Array> = {}
  for (const font of Object.values(documentNode.fonts ?? {})) {
    if (font.source !== 'embedded' || !font.path) continue
    const data = entries?.get(font.path)
    if (data) fontBytes[font.id] = data
  }
  return { document: documentNode, assetBytes, fontBytes, recentTransactions }
}

async function buildBrowserCheckpoint(documentNode: PpteDocument, assetBytes: Record<string, Uint8Array>, fontBytes: Record<string, Uint8Array>, recentTransactions: ReadonlyArray<Transaction> = []): Promise<Uint8Array> {
  const historyMode = recentTransactions.length ? 'standard' : 'clean'
  const snapshotRevision = canonicalRevision(documentNode)
  const entries: StoredZipEntry[] = [
    { name: 'mimetype', data: utf8('application/vnd.ppte+zip') },
    { name: 'document.json', data: utf8(canonicalJsonString(documentNode)) },
    { name: 'assets/index.json', data: utf8(canonicalJsonString(documentNode.assets)) },
    { name: 'fonts/index.json', data: utf8(canonicalJsonString(documentNode.fonts)) },
    { name: 'history/descriptor.json', data: utf8(canonicalJsonString({ mode: historyMode, snapshotRevision, recentTransactionCount: recentTransactions.length, deepHistoryExternal: historyMode === 'standard' })) },
  ]
  if (recentTransactions.length) entries.push({ name: 'history/recent.jsonl', data: utf8(recentTransactions.map((transaction) => canonicalJsonString(transaction)).join('\n') + '\n') })
  for (const asset of Object.values(documentNode.assets)) {
    const data = assetBytes[asset.id]
    if (!data) throw new Error(`缺少资产字节: ${asset.id}`)
    entries.push({ name: asset.path, data })
  }
  for (const font of Object.values(documentNode.fonts)) {
    if (font.source !== 'embedded') continue
    const data = fontBytes[font.id]
    if (!data || !font.path) throw new Error(`缺少嵌入字体字节: ${font.id}`)
    entries.push({ name: font.path, data })
  }
  const files = entries.filter((entry) => entry.name !== 'mimetype').map((entry) => ({ path: entry.name, mediaType: mediaType(entry.name), byteLength: entry.data.length, sha256: sha256HexBytes(entry.data), required: entry.name === 'document.json' }))
  const manifest: PpteManifest = {
    format: 'ppte',
    formatVersion: '2',
    schemaVersion: '2.0.0',
    operationProtocolVersion: '1.0',
    compatibilityProfile: browserCompatibilityProfile(documentNode),
    documentId: documentNode.documentId,
    contentRevision: snapshotRevision,
    title: documentNode.metadata.title,
    createdAt: documentNode.metadata.createdAt ?? now(),
    updatedAt: now(),
    requiredWidgets: documentNode.widgetRequirements ?? [],
    clean: historyMode === 'clean',
    files,
    history: { mode: historyMode, snapshotRevision, recentTransactionCount: recentTransactions.length, deepHistoryExternal: historyMode === 'standard' },
  }
  entries.push({ name: 'manifest.json', data: utf8(canonicalJsonString(manifest)) })
  return writeStoredZip(entries)
}

function buildHostTransaction(baseRevision: string, operations: Operation[], reason: string, actor: Transaction['actor']): Transaction {
  const kinds = [...new Set(operations.map((operation) => operation.kind))]
  return {
    transactionId: `host:transaction:${operations[0]?.opId ?? Date.now()}`,
    baseRevision,
    actor,
    scope: {
      kind: 'document',
      permissions: ['content', 'geometry', 'structure', 'assets', 'notes', 'animation'],
      allowInsert: true,
      allowDelete: true,
    },
    changeContract: {
      allowedOperationKinds: kinds,
      maxChangedSlides: Number.MAX_SAFE_INTEGER,
      maxChangedElements: Number.MAX_SAFE_INTEGER,
      maxInsertedElements: Number.MAX_SAFE_INTEGER,
      maxDeletedElements: Number.MAX_SAFE_INTEGER,
      maxReplacedAssets: Number.MAX_SAFE_INTEGER,
      maxChangedFacts: Number.MAX_SAFE_INTEGER,
      maxChangedSources: Number.MAX_SAFE_INTEGER,
      maxChangedThemeTokens: Number.MAX_SAFE_INTEGER,
      maxChangedStylePresets: Number.MAX_SAFE_INTEGER,
      requireConfirmation: false,
      userIntentSummary: reason,
    },
    reason,
    createdAt: now(),
    validationLevel: 'L3',
    operations,
  }
}

function cloneBytes(value: Record<string, Uint8Array>): Record<string, Uint8Array> { return Object.fromEntries(Object.entries(value).map(([key, bytes]) => [key, new Uint8Array(bytes)])) }
function blobBytes(value: Uint8Array): ArrayBuffer { return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer }
function utf8(value: string): Uint8Array { return new TextEncoder().encode(value) }
function mediaType(path: string): string { if (path.endsWith('.json')) return 'application/json'; if (path.endsWith('.woff2')) return 'font/woff2'; if (path.endsWith('.png')) return 'image/png'; if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'; if (path.endsWith('.webp')) return 'image/webp'; return 'application/octet-stream' }
function extensionForMime(mime: string): string { if (mime === 'image/jpeg') return 'jpg'; if (mime === 'image/svg+xml') return 'svg'; if (mime === 'image/webp') return 'webp'; return 'png' }
function safeFilename(value: string): string { return value.replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^\.+|\.+$/g, '') || 'presentation' }
function renderThumbnailHtml(document: PpteDocument, slideId: string, assetSources: Record<string, string>): string {
  return renderSlideHtml(document, slideId, { editable: false, assetSources }).replace(/\sdata-ppte-[a-z0-9-]+="[^"]*"/gi, '')
}

function browserCompatibilityProfile(document: PpteDocument): string {
  if (document.widgetRequirements?.length) return PPTE_GA_C_COMPATIBILITY_PROFILE
  let profile: string = PPTE_COMPATIBILITY_PROFILE
  for (const slide of Object.values(document.slides)) {
    if (slide.visualStrategy === 'poster') return PPTE_GA_C_COMPATIBILITY_PROFILE
    if (slide.transition !== undefined) profile = PPTE_GA_B_COMPATIBILITY_PROFILE
    for (const element of Object.values(slide.elements)) {
      if (element.appearStep !== undefined || element.animation !== undefined) profile = PPTE_GA_B_COMPATIBILITY_PROFILE
      if (element.type === 'component' || element.type === 'chart' && (element.chartType === 'area' || element.chartType === 'donut')) return PPTE_GA_C_COMPATIBILITY_PROFILE
      if (element.type === 'chart') profile = PPTE_GA_B_COMPATIBILITY_PROFILE
    }
  }
  return profile
}
