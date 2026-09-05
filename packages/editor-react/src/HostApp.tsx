import { Inspector } from './Inspector.js'
import { buildPortable, buildPortableCheckpointBytes, configurePortableScript } from '../../portable-runtime/src/shared.js'
import { portableBrowserScript } from '../../portable-runtime/src/browser-bundle.js'
import { authoringProject } from '../../authoring/src/index.js'
import { AgentToolServer } from '../../agent-tools/src/index.js'
configurePortableScript(portableBrowserScript)
import { createEmptyDocument } from '../../authoring/src/default-document.js'
export { createEmptyDocument } from '../../authoring/src/default-document.js'
import { buildAuthoringTransaction, type AuthoringInput } from '../../authoring/src/index.js'
import { PpteSession } from '../../core/src/index.js'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CompositionEvent, type FocusEvent, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import { canonicalJsonString, canonicalRevision, sha256HexBytes } from '../../canonical-json/src/index.js'
import { readStoredZip } from '../../archive/src/index.js'
import { buildDuplicateSlideOperation } from '../../operations/src/index.js'
import { plainTextToRichText, ImeTextEditSession } from '../../richtext-adapter/src/index.js'
import { validateRuntimeDocument } from '../../validation/src/index.js'
import { advancePresenterState, retreatPresenterState, type PresenterAnimationState } from '../../portable-runtime/src/presenter-state.js'
import { renderSlideHtml, type RenderOptions } from '../../renderer-react/src/index.js'
import type { Asset, ImageElement, Operation, PpteDocument, PpteManifest, TextElement, Transaction, ValidationIssue } from '../../schema/src/index.js'
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

const now = () => new Date().toISOString()

export function HostApp({ initialDocument = createEmptyDocument(), initialAssetBytes = {}, initialFontBytes = {} }: HostAppProps): ReactElement {
  const sessionRef = useRef<PpteSession | undefined>(undefined)
  if (!sessionRef.current) sessionRef.current = new PpteSession(initialDocument)
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
  const [agentInput, setAgentInput] = useState<AuthoringInput | undefined>()
  const [agentSourceName, setAgentSourceName] = useState('')
  const [pendingEdit, setPendingEdit] = useState<{transaction:Transaction; summary:string}>()
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
    const target = event.target instanceof window.Element ? event.target.closest<HTMLElement>('[data-ppte-element-id]') : null
    const elementId = target?.dataset.ppteElementId
    if (!elementId || !activeSlide?.elements[elementId]) {
      if (!event.shiftKey && !event.metaKey && !event.ctrlKey) setSelection({ slideId: activeSlideId, elementIds: [] })
      return
    }
    const multi = event.metaKey || event.ctrlKey || event.shiftKey
    const nextIds = multi
      ? activeElementIds.includes(elementId) ? activeElementIds.filter((id) => id !== elementId) : [...activeElementIds, elementId]
      : [elementId]
    setSelection({ slideId: activeSlideId, elementIds: nextIds, primaryElementId: elementId })
    const element = activeSlide.elements[elementId]
    if (!multi && element.type !== 'text' && element.locked !== true) {
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
    sessionRef.current = new PpteSession(fresh)
    setDocumentNode(fresh)
    setAssetBytes({})
    setFontBytes({})
    setActiveSlideIndex(0)
    setSelection({ slideId: fresh.slideOrder[0], elementIds: [] })
    setPresenterState({ slideIndex: 0, step: 0 })
    setHistoryDepth(0)
    setRedoDepth(0)
    setAgentInput(undefined)
    setAgentSourceName('')
    setStatus('已创建新的本地语义文档')
  }

  async function onAgentSource(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = ''
    setAgentInput(undefined)
    if (!file) return
    try {
      const input = JSON.parse(await file.text()) as AuthoringInput
      setAgentInput(input)
      setAgentSourceName(file.name)
      setStatus(`已读取 Agent 设计 · ${file.name} · 导入前将校验全部页面`)
    } catch { setStatus('请选择由 PPTe Skill 生成的 Presentation IR JSON；原始资料请交给宿主 Agent 读取。') }
  }

  function generateAgentDeck(): void {
    const session = sessionRef.current
    if (!session || !agentInput) return
    try {
      const transaction = buildAuthoringTransaction(session.getDocument(), agentInput)
      const project = authoringProject(agentInput)
      const decode = (value:string) => Uint8Array.from(atob(value),c=>c.charCodeAt(0))
      const nextAssets = {...assetBytes,...Object.fromEntries(Object.entries(project.assetBytes??{}).map(([id,value])=>[id,decode(value)]))}
      const nextFonts = {...fontBytes,...Object.fromEntries(Object.entries(project.fontBytes??{}).map(([id,value])=>[id,decode(value)]))}
      const preview = session.preview(transaction)
      if (!preview.ok || !preview.document) throw new Error(preview.issues.map(i=>i.message).join('; '))
      buildPortableCheckpointBytes(preview.document,{runtimeProfile:'ga-c',assetBytes:nextAssets,fontBytes:nextFonts})
      if (commitTransaction(transaction, '已编译并导入 Agent 设计')) {
        setAssetBytes(nextAssets)
        setFontBytes(nextFonts)
        setActiveSlideIndex(0)
        setSelection({ slideId: session.getDocument().slideOrder[0], elementIds: [] })
        setPresenterState({ slideIndex: 0, step: 0 })
      }
    } catch (cause) { setStatus(`设计未导入 · ${cause instanceof Error ? cause.message : String(cause)}`) }
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
      sessionRef.current = new PpteSession(project.document, { recentTransactions: project.recentTransactions })
      setDocumentNode(project.document)
      setAssetBytes(project.assetBytes)
      setFontBytes(project.fontBytes)
      setActiveSlideIndex(0)
      setSelection({ slideId: project.document.slideOrder[0] ?? '', elementIds: [] })
      setPresenterState({ slideIndex: 0, step: 0 })
      setHistoryDepth(sessionRef.current.getHistory().length)
      setRedoDepth(sessionRef.current.getRedoHistory().length)
      setAgentInput(undefined)
    setAgentSourceName('')
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
      flushHostEdits()
      const recentTransactions = sessionRef.current?.getHistory().map((entry) => entry.transaction) ?? []
      const bytes = await buildBrowserCheckpoint(sessionRef.current!.getDocument(), assetBytes, fontBytes, recentTransactions)
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

  function flushHostEdits():void {
    for (const session of editSessions.current.values()) if(session.isComposing()) throw new Error('请先完成当前输入法组合，再保存。')
    for (const [id,editor] of editSessions.current) {
      const tx=editor.finish(nextOperationId('save-text'),sessionRef.current!.getRevision(),now())
      if(tx&&!commitTransaction(tx))throw new Error('文字保存未通过校验。')
      editSessions.current.delete(id)
    }
  }
  function saveEditable():void {
    try {
      flushHostEdits()
      const session=sessionRef.current!
      const result=buildPortable(session.getDocument(),{profile:'full-portable',assetBytes,fontBytes,recentTransactions:session.getHistory().map(h=>h.transaction)})
      if(!result.ok)throw new Error(result.issues.map(i=>i.message).join('; '))
      const url=URL.createObjectURL(new Blob([result.html],{type:'text/html'}));const a=document.createElement('a');a.href=url;a.download=`${safeFilename(session.getDocument().metadata.title)}.editable.ppte.html`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
      setStatus('已保存可直接打开、编辑的 HTML 副本')
    } catch(error) {setStatus(`保存失败 · ${String(error)}`)}
  }
  async function previewAgentEdit(event:ChangeEvent<HTMLInputElement>):Promise<void> {
    const file=event.target.files?.[0];event.target.value='';if(!file)return
    try {
      const transaction=JSON.parse(await file.text()) as Transaction
      const agent=new AgentToolServer(sessionRef.current!,{grantedScope:activeElementIds.length?{kind:'selection',slideIds:[activeSlideId],elementIds:activeElementIds,permissions:['content','geometry','style','assets'],allowInsert:false,allowDelete:false}:undefined})
      const result=agent.execute('preview_transaction',{transaction})
      if(!result.ok)throw new Error(result.issues.map(i=>i.message).join('; '))
      setPendingEdit({transaction,summary:JSON.stringify({changes:result.diff?.changedPaths,warnings:result.issues.map(i=>i.message)},null,2)})
    }catch(error){setPendingEdit(undefined);setStatus(`修改未通过预览 · ${String(error)}`)}
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
      <label className="ppte-toolbar-label" title="先打开 PPTe Host，再选择 .ppte；系统双击关联尚未提供">打开 PPTe 项目 (.ppte)<input type="file" accept=".ppte,.json,application/json" data-ppte-action="open" onChange={openFile} /></label>
      <label className="ppte-toolbar-label">Agent 设计<input type="file" accept=".json,application/json" data-ppte-action="agent-source" onChange={onAgentSource} /></label>
      <button type="button" data-ppte-action="generate" onClick={generateAgentDeck} disabled={!agentInput}>导入 Agent 设计</button>
      <button type="button" data-ppte-action="add-page" onClick={addPage}>Add page</button>
      <button type="button" data-ppte-action="undo" onClick={undo} disabled={historyDepth === 0}>Undo</button>
      <button type="button" data-ppte-action="redo" onClick={redo} disabled={redoDepth === 0}>Redo</button>
      <label className="ppte-toolbar-label">Add image<input type="file" accept="image/*" data-ppte-action="import-image" onChange={importImage} /></label>
      <button type="button" data-ppte-action="save" onClick={() => void saveCopy()}>保存 PPTe 项目 (.ppte)</button>
      <button type="button" data-ppte-action="save-editable" onClick={saveEditable}>保存可编辑 HTML</button>
      <label className="ppte-toolbar-label">预览 Agent 修改<input type="file" accept=".json" onChange={previewAgentEdit}/></label>
      <button type="button" data-ppte-action="present" onClick={togglePresenter}>{presenting ? 'Exit' : 'Present'}</button>
      <span className="ppte-host-file-help" title="PPTe 源项目需要由 PPTe Host 打开；浏览器可编辑副本请使用 Portable 交付">先打开 Host，再选 .ppte</span>
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
    {!presenting&&<aside className="ppte-host-inspector"><Inspector key={`${activeSlideId}:${activeElementIds.join(',')}:${sessionRef.current!.getRevision()}`} document={documentNode} slide={activeSlide} ids={activeElementIds} commit={commitOperations}/>{pendingEdit&&<section><h3>Agent 修改预览</h3><pre>{pendingEdit.summary}</pre><button onClick={()=>{if(commitTransaction(pendingEdit.transaction,'已接受 Agent 修改'))setPendingEdit(undefined)}}>接受修改</button><button onClick={()=>setPendingEdit(undefined)}>取消</button></section>}</aside>}
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
  if (entries) {
    const raw=entries.get('manifest.json');if(!raw)throw new Error('缺少项目清单')
    const manifest=JSON.parse(new TextDecoder().decode(raw)) as PpteManifest
    if(manifest.contentRevision!==canonicalRevision(documentNode)||manifest.documentId!==documentNode.documentId)throw new Error('项目内容与清单不一致')
    for(const file of manifest.files){const data=entries.get(file.path);if(!data||data.length!==file.byteLength||sha256HexBytes(data)!==file.sha256.replace(/^sha256-/,''))throw new Error(`文件校验失败: ${file.path}`)}
  }
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
  buildPortableCheckpointBytes(documentNode,{runtimeProfile:'ga-c',assetBytes,fontBytes,recentTransactions})
  return { document: documentNode, assetBytes, fontBytes, recentTransactions }
}

async function buildBrowserCheckpoint(documentNode:PpteDocument,assetBytes:Record<string,Uint8Array>,fontBytes:Record<string,Uint8Array>,recentTransactions:ReadonlyArray<Transaction>=[]):Promise<Uint8Array> {
  return buildPortableCheckpointBytes(documentNode,{runtimeProfile:'ga-c',assetBytes,fontBytes,recentTransactions:[...recentTransactions]})
}

function buildHostTransaction(baseRevision: string, operations: Operation[], reason: string, actor: Transaction['actor']): Transaction {
  const kinds = [...new Set(operations.map((operation) => operation.kind))]
  return {
    transactionId: `host:transaction:${operations[0]?.opId ?? Date.now()}`,
    baseRevision,
    actor,
    scope: {
      kind: 'document',
      permissions: ['content', 'geometry', 'style', 'structure', 'assets', 'notes', 'animation'],
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
function extensionForMime(mime: string): string { if (mime === 'image/jpeg') return 'jpg'; if (mime === 'image/svg+xml') return 'svg'; if (mime === 'image/webp') return 'webp'; return 'png' }
function safeFilename(value: string): string { return value.replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^\.+|\.+$/g, '') || 'presentation' }
function renderThumbnailHtml(document: PpteDocument, slideId: string, assetSources: Record<string, string>): string {
  return renderSlideHtml(document, slideId, { editable: false, assetSources }).replace(/\sdata-ppte-[a-z0-9-]+="[^"]*"/gi, '')
}
