import {actualTextOverflow,fittedBrowserFont} from './text-measurement.js'
import {poolBytes,resolveBytes,type ResourceBytes} from './resource-pool.js'
import { ReviewPanel, type ReviewProject } from './ReviewPanel.js'
import { RecipeStudio } from './RecipeStudio.js'
import { builtInRecipeSpecs, RecipeRegistry } from '../../layout-recipes/src/index.js'
import { decodePatch, buildPatchTransaction } from '../../patch-format/src/codec.js'
import { BrowserRecovery } from './recovery.js'
import { Inspector } from './Inspector.js'
import { buildPortable, buildPortableCheckpointBytes, configurePortableScript, base64 } from '../../portable-runtime/src/shared.js'
import { portableBrowserScript } from '../../portable-runtime/src/browser-bundle.js'
import { authoringProject } from '../../authoring/src/index.js'
import { AgentToolServer } from '../../agent-tools/src/index.js'
configurePortableScript(portableBrowserScript)
import { createEmptyDocument } from '../../authoring/src/default-document.js'
export { createEmptyDocument } from '../../authoring/src/default-document.js'
import { buildAuthoringTransaction, type AuthoringInput } from '../../authoring/src/index.js'
import { PpteSession, type HistoryEntry } from '../../core/src/index.js'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CompositionEvent, type FocusEvent, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import { canonicalJsonString, canonicalRevision, sha256HexBytes } from '../../canonical-json/src/index.js'
import { readStoredZip } from '../../archive/src/index.js'
import { buildDuplicateSlideOperation } from '../../operations/src/index.js'
import { editRichText, ImeTextEditSession } from '../../richtext-adapter/src/index.js'
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
  redoHistory: HistoryEntry[]
}

class UnsupportedProjectError extends Error {constructor(readonly file:File,readonly snapshot:unknown){super('此版本需要更新的编辑器；当前仅查看原始数据')}}

const now = () => new Date().toISOString()

export function HostApp({ initialDocument = createEmptyDocument(), initialAssetBytes = {}, initialFontBytes = {} }: HostAppProps): ReactElement {
  const recoveryRef = useRef<BrowserRecovery | undefined>(undefined)
  const [storageReady,setStorageReady]=useState(false)
  const [saveLabel,setSaveLabel]=useState('正在准备本地保护')
  const sessionRef = useRef<PpteSession | undefined>(undefined)
  if (!sessionRef.current) sessionRef.current = new PpteSession(initialDocument)
  const [documentNode, setDocumentNode] = useState<PpteDocument>(() => structuredClone(initialDocument))
  const assetSpecKey=canonicalJsonString(documentNode.assets)
  const fontSpecKey=canonicalJsonString(documentNode.fonts)
  const [assetPool, setAssetPool] = useState(()=>poolBytes(cloneBytes(initialAssetBytes)))
  const assetBytes=useMemo(()=>resolveBytes(assetPool,documentNode.assets),[assetPool,assetSpecKey])
  function setAssetBytes(value:ResourceBytes|((current:ResourceBytes)=>ResourceBytes)){setAssetPool(current=>poolBytes(typeof value==='function'?{...current,...value(resolveBytes(current,documentNode.assets))}:value))}
  const [fontPool, setFontPool] = useState(()=>poolBytes(cloneBytes(initialFontBytes)))
  const fontBytes=useMemo(()=>resolveBytes(fontPool,documentNode.fonts),[fontPool,fontSpecKey])
  function setFontBytes(value:ResourceBytes|((current:ResourceBytes)=>ResourceBytes)){setFontPool(current=>poolBytes(typeof value==='function'?{...current,...value(resolveBytes(current,documentNode.fonts))}:value))}
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
  const [pendingEdit, setPendingEdit] = useState<{transaction:Transaction; summary:string; recipeKey?:string; document:PpteDocument; resources?:ReviewProject}>()
  const [reviewing,setReviewing]=useState(false)
  const [recipeId,setRecipeId]=useState('')
  const [designIR,setDesignIR]=useState<unknown>()
  const [studio,setStudio]=useState(false)
  const [unsupported,setUnsupported]=useState<UnsupportedProjectError>()
  const [assetSources, setAssetSources] = useState<Record<string, string>>({})
  const dragRef = useRef<DragTransient | undefined>(undefined)
  const editSessions = useRef(new Map<string, ImeTextEditSession>())
  const operationNumber = useRef(0)
  const renderedRef = useRef<HTMLDivElement>(null)
  const [canvasScale, setCanvasScale] = useState(1)
  const [actualOverflow,setActualOverflow]=useState<string[]>([])

  useEffect(() => {
    if(recoveryRef.current)return
    const recovery=new BrowserRecovery();recoveryRef.current=recovery
    void (async()=>{
      try {
        const restored=await recovery.initialize()
        if(restored){sessionRef.current=restored.session;setDocumentNode(structuredClone(restored.session.getDocument()));setAssetBytes(restored.base.assetBytes);setFontBytes(restored.base.fontBytes);setHistoryDepth(restored.session.getHistory().length);setRedoDepth(restored.session.getRedoHistory().length);setStatus('已恢复上次编辑，可另存为项目');setSaveLabel('可恢复 · 尚未写入项目文件')}
        else {sessionRef.current=await recovery.replace({document:initialDocument,assetBytes:poolBytes(initialAssetBytes),fontBytes:poolBytes(initialFontBytes),history:[],redo:[]});setSaveLabel('本地保护已就绪')}
        setStorageReady(true)
      } catch(error){setStatus(`恢复未完成 · ${String(error)} · 原恢复数据已保留`);setSaveLabel('只读恢复')}
    })()
  },[])

  useEffect(()=>{
    const urls:string[]=[];const faces:FontFace[]=[]
    for(const [id,bytes] of Object.entries(fontBytes)){
      const font=documentNode.fonts[id];if(!font)continue
      const url=URL.createObjectURL(new Blob([blobBytes(bytes)]));urls.push(url)
      const face=new FontFace(font.family,`url(${url})`,{weight:String(font.weight??400),style:font.style??'normal'});faces.push(face);
      (document.fonts as FontFaceSet & {add(f:FontFace):void}).add(face)
      void face.load().catch(()=>setStatus(`字体未加载：${font.family}，请检查字体资源`))
    }
    return()=>{faces.forEach(f=>(document.fonts as FontFaceSet & {delete(f:FontFace):void}).delete(f));urls.forEach(u=>URL.revokeObjectURL(u))}
  },[fontBytes,fontSpecKey])

  const activeSlideId = documentNode.slideOrder[activeSlideIndex] ?? documentNode.slideOrder[0] ?? ''
  const activeSlide = documentNode.slides[activeSlideId]
  const activeElementIds = selection.slideId === activeSlideId ? selection.elementIds : []
  const nextOperationId = (kind: string) => `host:${kind}:${++operationNumber.current}:${crypto.randomUUID()}`

  useEffect(() => {
    const created: Record<string, string> = {}
    for (const [assetId, bytes] of Object.entries(assetBytes)) {
      const asset = documentNode.assets[assetId]
      if (asset) created[assetId] = URL.createObjectURL(new Blob([blobBytes(bytes)], { type: asset.mimeType }))
    }
    setAssetSources(created)
    return () => Object.values(created).forEach((source) => URL.revokeObjectURL(source))
  }, [assetBytes, assetSpecKey])

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

  const renderOptions: RenderOptions = useMemo(() => ({ editable: storageReady, assetSources }), [assetSources,storageReady])
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
      if(!storageReady)throw new Error('本地保护未就绪，暂不能修改')
      recoveryRef.current!.action='commit'
      const result = sessionRef.current?.commit(transaction)
      if (!result?.ok) {
        setStatus(`操作未提交 · ${result?.issues.map((issue) => issue.message).join('; ') ?? '未知错误'}`)
        return false
      }
      syncSessionState()
      setSaveLabel('可恢复 · 尚未写入项目文件')
      setStatus(result.issues.length ? result.issues.map(i=>i.message).join('; ') : (successMessage ?? '修改已本地保护'))
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
    session.input(editRichText(element.content, value))
    const transaction = session.finish(nextOperationId('text'), canonicalRevision(documentNode), now())
    editSessions.current.delete(elementId)
    if (transaction) commitTransaction(transaction, '文字已本地保护，尚未写入项目文件')
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
    session[session.isComposing() ? 'updateComposition' : 'input'](editRichText(target.element.content, target.node.innerText.replaceAll('\u00a0', ' ')))
    editSessions.current.set(target.element.id, session)
  }

  function onCompositionEnd(event: CompositionEvent<HTMLDivElement>): void {
    const target = textTarget(event)
    if (!target) return
    const session = editSessions.current.get(target.element.id)
    if (!session) return
    session.endComposition(editRichText(target.element.content, target.node.innerText.replaceAll('\u00a0', ' ')))
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
    const group=!event.altKey ? Object.values(activeSlide.groups??{}).find(g=>g.memberIds.includes(elementId)) : undefined
    const multi = event.metaKey || event.ctrlKey || event.shiftKey
    const nextIds = multi
      ? activeElementIds.includes(elementId) ? activeElementIds.filter((id) => id !== elementId) : [...activeElementIds, elementId]
      : group ? group.memberIds : [elementId]
    setSelection({ slideId: activeSlideId, elementIds: nextIds, primaryElementId: elementId,groupId:!multi?group?.id:undefined })
    const element = activeSlide.elements[elementId]
    if (!multi && (group || element.type !== 'text') && element.locked !== true) {
      // The image wrapper is the semantic drag target. Prevent the browser's
      // native image-selection/drag gesture so pointer capture remains owned
      // by the Host until pointer-up commits the transient frame.
      event.preventDefault()
      dragRef.current = beginDrag(documentNode, canonicalRevision(documentNode), activeSlideId, elementId, pointerInDu(event), group?.id)
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

  async function newDocument(): Promise<void> {
    if(!storageReady)return
    setStorageReady(false)
    try {
    const fresh = createEmptyDocument()
    sessionRef.current = await recoveryRef.current!.replace({document:fresh,assetBytes:{},fontBytes:{},history:[],redo:[]})
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
    setPendingEdit(undefined);setDesignIR(undefined);setReviewing(false);setStudio(false)
    setStatus('已创建新的本地语义文档');setSaveLabel('新项目已本地保护')
    }catch(error){setStatus(String(error))}finally{setStorageReady(true)}
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

  async function generateAgentDeck(): Promise<void> {
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
      await recoveryRef.current!.resources(nextAssets,nextFonts)
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
    const slideId = `host_slide_${crypto.randomUUID()}`
    try {
      const operation = buildDuplicateSlideOperation(session.getDocument(), activeSlideId, slideId, { index: activeSlideIndex + 1, opId: nextOperationId('page') })
      if (commitOperations([operation], '新建页面')) setActiveSlideIndex(activeSlideIndex + 1)
    } catch (cause) {
      setStatus(`新建页面失败 · ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  function undo(): void {
    recoveryRef.current!.action='undo'
    const result = sessionRef.current?.undo()
    if (!result?.ok) {
      setStatus(`Undo 不可用 · ${result?.issues.map((issue) => issue.message).join('; ') ?? '没有可撤销操作'}`)
      return
    }
    syncSessionState()
    setSaveLabel('可恢复 · 尚未写入项目文件')
    setStatus('已撤销最近一个语义操作')
  }

  function redo(): void {
    recoveryRef.current!.action='redo'
    const result = sessionRef.current?.redo()
    if (!result?.ok) {
      setStatus(`Redo 不可用 · ${result?.issues.map((issue) => issue.message).join('; ') ?? '没有可重做操作'}`)
      return
    }
    syncSessionState()
    setSaveLabel('可恢复 · 尚未写入项目文件')
    setStatus('已重做最近一个语义操作')
  }

  async function openFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const project = await readBrowserProject(file)
      const opened=new PpteSession(project.document,{recentTransactions:project.recentTransactions,redoHistory:project.redoHistory})
      sessionRef.current = await recoveryRef.current!.replace({...project,history:[...opened.getHistory()],redo:[...opened.getRedoHistory()]})
      setDocumentNode(project.document)
      setAssetBytes(project.assetBytes)
      setFontBytes(project.fontBytes)
      setActiveSlideIndex(0)
      setSelection({ slideId: project.document.slideOrder[0] ?? '', elementIds: [] })
      setPresenterState({ slideIndex: 0, step: 0 })
      setHistoryDepth(sessionRef.current.getHistory().length)
      setRedoDepth(sessionRef.current.getRedoHistory().length)
      setAgentInput(undefined)
      setPendingEdit(undefined);setDesignIR(undefined);setReviewing(false);setStudio(false)
      setAgentSourceName('')
      setStatus(`已打开 ${file.name}`);setSaveLabel('已打开项目 · 本地保护就绪')
    } catch (cause) {
      if(cause instanceof UnsupportedProjectError)setUnsupported(cause)
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
      const assetId = `asset_host_${crypto.randomUUID()}`
      const elementId = `image_host_${crypto.randomUUID()}`
      const asset: Asset = { id: assetId, hash: `sha256-${sha256HexBytes(bytes)}`, mimeType: file.type, byteLength: bytes.length, path: `assets/${assetId}.${extensionForMime(file.type)}`, altText: file.name, source: { kind: 'upload', importedAt: now() } }
      const image: ImageElement = { id: elementId, type: 'image', semanticKey: `image.${assetId}`, role: 'image', frame: { x: 1120, y: 260, width: 600, height: 460 }, assetId, fit: 'contain', altText: file.name, style: { styleRef: 'image.hero' } }
      const replace=activeElementIds.length===1&&activeSlide?.elements[activeElementIds[0]]?.type==='image'
      const operations: Operation[] = [
        { opId: nextOperationId('asset'), kind: 'asset.upsert', asset },
        replace ? {opId:nextOperationId('replace-image'),kind:'image.replaceAsset',slideId:activeSlideId,elementId:activeElementIds[0],assetId} : { opId: nextOperationId('image'), kind: 'element.insert', slideId: activeSlideId, element: image, index: activeSlide?.rootOrder.length ?? 0, readingOrderIndex: activeSlide?.readingOrder?.length ?? 0 },
      ]
      await recoveryRef.current!.resources({[assetId]:bytes},{})
      if (commitOperations(operations, '导入并插入图片')) {
        setAssetBytes((current) => ({ ...current, [assetId]: bytes }))
        setSelection({ slideId: activeSlideId, elementIds: [replace?activeElementIds[0]:elementId], primaryElementId: replace?activeElementIds[0]:elementId })
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
      setSaveLabel('正在保存')
      const bytes = await buildBrowserCheckpoint(sessionRef.current!.getDocument(), assetBytes, fontBytes, recentTransactions, [...sessionRef.current!.getRedoHistory()])
      const filename = `${safeFilename(documentNode.metadata.title || 'presentation')}.ppte`
      const picker = (window as unknown as { showSaveFilePicker?: (options: unknown) => Promise<{ createWritable: () => Promise<{ write: (data: Uint8Array) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker
      if (picker && window.isSecureContext && !navigator.webdriver) {
        try {
          const handle = await picker({ suggestedName: filename, types: [{ description: 'PPTe project', accept: { 'application/vnd.ppte+zip': ['.ppte'] } }] })
          const writable = await handle.createWritable()
          await writable.write(bytes)
          await writable.close()
          await compactRecovery()
          setSaveLabel('已写入项目文件')
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
      await compactRecovery()
      setSaveLabel('已请求下载 · 请确认浏览器保存完成')
      setStatus('已下载 .ppte 副本')
    } catch (cause) {
      setSaveLabel('保存失败 · 本地恢复记录保留')
      setStatus(`保存失败 · ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  async function compactRecovery(){const s=sessionRef.current!;sessionRef.current=await recoveryRef.current!.replace({document:structuredClone(s.getDocument()),assetBytes:assetPool,fontBytes:fontPool,history:[...s.getHistory()],redo:[...s.getRedoHistory()]})}

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
      stagePreview(transaction)
    }catch(error){setPendingEdit(undefined);setStatus(`修改未通过预览 · ${String(error)}`)}
  }

  function stagePreview(transaction:Transaction,resources?:ReviewProject,recipeKey?:string):void {
    try{
      const p=sessionRef.current!.preview(transaction)
      if(!p.ok||!p.document)throw new Error(p.issues.map(i=>i.message).join('; '))
      buildPortableCheckpointBytes(p.document,{runtimeProfile:'ga-c',assetBytes:resolveBytes(poolBytes({...assetBytes,...resources?.assetBytes}),p.document.assets),fontBytes:resolveBytes(poolBytes({...fontBytes,...resources?.fontBytes}),p.document.fonts)})
      setPendingEdit({transaction,recipeKey,document:structuredClone(p.document),resources,summary:JSON.stringify({reason:transaction.reason,changes:p.diff?.changedPaths,warnings:p.issues.map(i=>i.message)},null,2)})
    }catch(e){setStatus(`预览失败 · ${String(e)}`)}
  }
  async function acceptPreview(){
    const pending=pendingEdit;if(!pending)return
    try{
      if(pending.resources)await recoveryRef.current!.resources(pending.resources.assetBytes,pending.resources.fontBytes)
      if(commitTransaction(pending.transaction,'已接受预览修改')){
        if(pending.recipeKey)try{const stats=JSON.parse(localStorage.getItem('ppte.recipe.acceptance')??'{}');stats[pending.recipeKey]=(stats[pending.recipeKey]??0)+1;localStorage.setItem('ppte.recipe.acceptance',JSON.stringify(stats))}catch{setStatus('修改已接受；布局统计未能保存')}
        if(pending.resources){setAssetBytes(b=>({...b,...pending.resources!.assetBytes}));setFontBytes(b=>({...b,...pending.resources!.fontBytes}))}
        setPendingEdit(undefined)
      }
    }catch(e){setStatus(String(e))}
  }
  function design(mode:'layout'|'redesign'){
    try{
      flushHostEdits()
      const server=new AgentToolServer(sessionRef.current!)
      const result=server.execute(mode==='layout'?'apply_layout_recipe':'regenerate_slide',{slideId:activeSlideId,...(recipeId?{recipeId}:{}),...(designIR?{slideIR:designIR}:{}),protectedElementIds:mode==='redesign'?activeElementIds:undefined,requireConfirmation:true})
      if(!result.ok||!result.transaction)throw new Error(result.issues.map(i=>i.message).join('; ')||'设计没有生成可用事务')
      stagePreview(result.transaction)
    }catch(e){setStatus(String(e))}
  }
  async function patchInput(file:File|undefined){if(!file)return;try{const patch=decodePatch(new Uint8Array(await file.arrayBuffer()));const checked=sessionRef.current!.previewPatch(patch);if(!checked.ok)throw new Error(checked.issues.map(i=>i.message).join('; '));stagePreview(buildPatchTransaction(patch),{document:documentNode,assetBytes:patch.assets??{},fontBytes:patch.fonts??{}})}catch(e){setStatus(String(e))}}
  useEffect(()=>{
    let cancelled=false
    void document.fonts.ready.then(()=>{if(cancelled)return;const nodes=renderedRef.current?.querySelectorAll<HTMLElement>('[data-ppte-type="text"]')??[];setActualOverflow(Array.from(nodes).filter(actualTextOverflow).map(n=>n.dataset.ppteElementId!))})
    return()=>{cancelled=true}
  },[documentNode,fontBytes,canvasScale])
  async function fitActual(id:string){
    const node=Array.from(renderedRef.current!.querySelectorAll<HTMLElement>('[data-ppte-type="text"]')).find(n=>n.dataset.ppteElementId===id)
    if(!node)return
    const revision=sessionRef.current!.getRevision();const size=await fittedBrowserFont(node)
    if(revision!==sessionRef.current!.getRevision()){setStatus('测量期间文档发生改变，请重试');return}
    commitOperations([{opId:nextOperationId('fit'),kind:'text.fitByReducingFont',slideId:activeSlideId,elementId:id,minFontSize:8,resolvedFontSize:size}],'已按实际字体测量适配字号')
  }
  function pageAction(kind:'delete'|'up'|'down'){
    if(kind==='delete'&&documentNode.slideOrder.length<=1){setStatus('请保留至少一页');return}
    const op:Operation=kind==='delete'?{opId:nextOperationId('delete-page'),kind:'slide.delete',slideId:activeSlideId}:{opId:nextOperationId('move-page'),kind:'slide.move',slideId:activeSlideId,index:Math.max(0,Math.min(documentNode.slideOrder.length-1,activeSlideIndex+(kind==='up'?-1:1)))}
    if(commitOperations([op],'调整页面'))setActiveSlideIndex(Math.max(0,kind==='delete'?activeSlideIndex-1:op.kind==='slide.move'?op.index:0))
  }

  function togglePresenter(): void {
    setPresenting((current) => !current)
    setStatus(presenting ? '已退出演示模式' : '演示模式 · 点击 Next 或使用方向键')
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if(!presenting){if(event.key==='Escape'){const target=textTarget(event);if(target){editSessions.current.get(target.element.id)?.cancel();editSessions.current.delete(target.element.id);target.node.innerHTML='';syncSessionState();target.node.blur();event.preventDefault();setStatus('已取消本次文字编辑')}}if((event.metaKey||event.ctrlKey)&&event.key==='s'){event.preventDefault();void saveCopy()}return}
    if (event.key === 'ArrowRight' || event.key === ' ') { event.preventDefault(); nextPresenter() }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); previousPresenter() }
    else if (event.key === 'Escape') setPresenting(false)
  }

  return <div className={`ppte-host-app${presenting ? ' is-presenting' : ''}`} data-ppte-host data-ppte-ready={storageReady} data-ppte-presenting={presenting} data-ppte-slide-count={documentNode.slideOrder.length} data-ppte-history-depth={historyDepth} data-ppte-redo-depth={redoDepth} data-ppte-presenter-slide={presenterState.slideIndex} data-ppte-presenter-step={presenterState.step} data-ppte-agent-generated={documentNode.metadata.source === 'generated'} onKeyDown={onKeyDown} tabIndex={-1}>
    <fieldset disabled={!storageReady} style={{display:"contents"}}><header className="ppte-host-toolbar">
      <div className="ppte-brand"><span className="ppte-brand-mark">P</span><span>PPTe Host</span></div>
      <button type="button" data-ppte-action="new" onClick={newDocument}>New</button>
      <label className="ppte-toolbar-label" title="先打开 PPTe Host，再选择 .ppte；系统双击关联尚未提供">打开 PPTe 项目 (.ppte)<input type="file" accept=".ppte,.json,application/json" data-ppte-action="open" onChange={openFile} /></label>
      <label className="ppte-toolbar-label">Agent 设计<input type="file" accept=".json,application/json" data-ppte-action="agent-source" onChange={onAgentSource} /></label>
      <button type="button" data-ppte-action="generate" onClick={generateAgentDeck} disabled={!agentInput}>导入 Agent 设计</button>
      <button type="button" data-ppte-action="add-page" onClick={addPage}>复制页</button><button onClick={()=>pageAction('delete')}>删除页</button><button onClick={()=>pageAction('up')}>上移页</button><button onClick={()=>pageAction('down')}>下移页</button>
      <button type="button" data-ppte-action="undo" onClick={undo} disabled={historyDepth === 0}>Undo</button>
      <button type="button" data-ppte-action="redo" onClick={redo} disabled={redoDepth === 0}>Redo</button>
      <label className="ppte-toolbar-label">{activeElementIds.length===1&&activeSlide?.elements[activeElementIds[0]]?.type==='image'?'替换图片':'Add image'}<input type="file" accept="image/*" data-ppte-action="import-image" onChange={importImage} /></label>
      <button type="button" data-ppte-action="save" onClick={() => void saveCopy()}>保存 PPTe 项目 (.ppte)</button>
      <button type="button" data-ppte-action="save-editable" onClick={saveEditable}>保存可编辑 HTML</button>
      <label className="ppte-toolbar-label">预览 Agent 修改<input type="file" accept=".json" onChange={previewAgentEdit}/></label>
      <button type="button" data-ppte-action="present" onClick={togglePresenter}>{presenting ? 'Exit' : 'Present'}</button>
      <button onClick={()=>setReviewing(v=>!v)}>比较修订副本</button><label className="ppte-toolbar-label">预览补丁<input type="file" accept=".patch" onChange={e=>void patchInput(e.target.files?.[0])}/></label><span className="ppte-host-file-help" title="PPTe 源项目需要由 PPTe Host 打开；浏览器可编辑副本请使用 Portable 交付">先打开 Host，再选 .ppte</span>
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
      <div className="ppte-canvas-wrap" ref={renderedRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onDoubleClick={(event) => { const target = textTarget(event); if (target) { setSelection({slideId:activeSlideId,elementIds:[target.element.id],primaryElementId:target.element.id}); target.node.focus(); setStatus('文字编辑中 · compositionend 后提交') } }} onCompositionStart={onCompositionStart} onCompositionEnd={onCompositionEnd} onInput={onInput} onBlur={onBlur}>
        <div className="ppte-rendered-slide" data-ppte-canvas-scale={canvasScale} style={{ ['--ppte-scale' as string]: canvasScale }} dangerouslySetInnerHTML={{ __html: slideHtml }} />
        {selectedOverlay.map((item) => {
          const moving=dragRef.current
          const frame = moving&&dragFrame&&moving.memberIds?.includes(item.elementId) ? {...item.frame,x:item.frame.x+dragFrame.x-moving.originalFrame.x,y:item.frame.y+dragFrame.y-moving.originalFrame.y} : item.elementId === moving?.elementId && dragFrame ? dragFrame : item.frame
          return <div key={item.elementId} className={`ppte-selection-box${item.elementId === selection.primaryElementId ? ' is-primary' : ''}`} data-ppte-selection-id={item.elementId} style={{ left: frame.x * canvasScale, top: frame.y * canvasScale, width: frame.width * canvasScale, height: frame.height * canvasScale }} />
        })}
      </div>
    </main>
    {!presenting&&<aside className="ppte-host-inspector"><Inspector key={`${activeSlideId}:${activeElementIds.join(',')}:${sessionRef.current!.getRevision()}`} document={documentNode} slide={activeSlide} ids={activeElementIds} commit={commitOperations}/><section>{actualOverflow.length>0&&<section data-ppte-actual-overflow><h3>实际渲染溢出</h3><p>已等待字体就绪；请检查以下文字框。</p>{actualOverflow.map(id=><div key={id}><button onClick={()=>setSelection({slideId:activeSlideId,elementIds:[id]})}>{activeSlide.elements[id]?.semanticKey??id}</button><button onClick={()=>void fitActual(id)}>按实际字体适配</button></div>)}</section>}<h3>页面设计</h3><button onClick={()=>setStudio(true)}>布局工作室</button><select aria-label="布局" value={recipeId} onChange={e=>setRecipeId(e.target.value)}><option value="">自动匹配</option>{builtInRecipeSpecs().map(r=><option key={r.id}>{r.id}</option>)}</select><button onClick={()=>design('layout')}>保留内容重排</button><label>新页面设计（可选）<input type="file" accept=".json" onChange={async e=>{try{const f=e.target.files?.[0];if(f)setDesignIR(JSON.parse(await f.text()))}catch(e){setStatus(String(e))}}}/></label><p>选中对象将在重设计时受到保护。</p><button onClick={()=>design('redesign')}>预览重设计</button></section>{unsupported&&<section className="ppte-review-panel" data-ppte-unsupported><h3>不支持的项目版本 · 只读检查</h3><p>原文件和当前编辑项目均未改写。可查看原始结构，或使用支持该版本的编辑器；这里不会尝试降级保存。</p><pre>{JSON.stringify(unsupported.snapshot,null,2)}</pre><button onClick={()=>{const a=document.createElement('a');const u=URL.createObjectURL(unsupported.file);a.href=u;a.download=unsupported.file.name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}}>下载原文件</button><button onClick={()=>setUnsupported(undefined)}>关闭只读检查</button></section>}{studio&&<RecipeStudio documentNode={documentNode} slideId={activeSlideId} assetSources={assetSources} onClose={()=>setStudio(false)} onApply={spec=>{try{const server=new AgentToolServer(sessionRef.current!,{recipes:new RecipeRegistry([spec])});const r=server.execute('apply_layout_recipe',{slideId:activeSlideId,recipeId:spec.id,recipeVersion:spec.version,requireConfirmation:true});if(!r.ok||!r.transaction)throw new Error(r.issues.map(i=>i.message).join('; '));stagePreview(r.transaction,undefined,`${spec.id}@${spec.version}`);setStudio(false)}catch(e){setStatus(String(e))}}}/>}{reviewing&&<ReviewPanel local={documentNode} resources={{assetBytes,fontBytes}} read={readBrowserProject} onPreview={stagePreview} onClose={()=>setReviewing(false)}/>}{pendingEdit&&<section data-ppte-preview><h3>修改预览</h3><pre>{pendingEdit.summary}</pre><div className="ppte-preview-surface" dangerouslySetInnerHTML={{__html:renderSlideHtml(pendingEdit.document,pendingEdit.document.slides[activeSlideId]?activeSlideId:pendingEdit.document.slideOrder[0],{assetSources:{...assetSources,...Object.fromEntries(Object.entries(pendingEdit.resources?.assetBytes??{}).map(([id,bytes])=>[id,`data:${pendingEdit.document.assets[id]?.mimeType};base64,${base64(bytes)}`]))}})}}/><button onClick={()=>void acceptPreview()}>接受修改</button><button onClick={()=>setPendingEdit(undefined)}>取消</button></section>}</aside>}
    <section className="ppte-host-notes" data-ppte-notes-panel>
      <div className="ppte-notes-heading"><span>Speaker notes</span><span className="ppte-notes-hint">Changes save on blur</span></div>
      <textarea id="ppte-speaker-notes" data-ppte-notes-input value={notesDraft} onChange={(event) => setNotesDraft(event.target.value)} onBlur={updateNotes} placeholder="Add notes for this slide…" />
    </section>
    <footer className="ppte-host-footer"><span>Source: document.json</span><span>{documentNode.metadata.title}</span><span data-ppte-save-state>{saveLabel}</span><span data-ppte-history-state>{presenting ? `Step ${presenterState.step}` : `${activeElementIds.length} selected · Undo ${historyDepth}`}</span></footer></fieldset>
  </div>
}

async function readBrowserProject(file: File): Promise<BrowserProject> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const text = new TextDecoder().decode(bytes)
  const first = text.trimStart().slice(0, 1)
  let entries: Map<string, Uint8Array> | undefined
  if (first !== '{') entries = readStoredZip(bytes)
  const documentNode = entries ? JSON.parse(new TextDecoder().decode(entries.get('document.json') ?? new Uint8Array())) as PpteDocument : JSON.parse(text) as PpteDocument
  if(documentNode&&typeof documentNode.schemaVersion==='string'&&documentNode.schemaVersion!=='2.0.0')throw new UnsupportedProjectError(file,documentNode)
  if (!documentNode || !documentNode.slides || !Array.isArray(documentNode.slideOrder)) throw new Error('文件不是 PPTe 2.0 semantic document')
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
  return { document: documentNode, assetBytes, fontBytes, recentTransactions,redoHistory:entries?.has('history/redo.json')?JSON.parse(new TextDecoder().decode(entries.get('history/redo.json'))):[] }
}

async function buildBrowserCheckpoint(documentNode:PpteDocument,assetBytes:Record<string,Uint8Array>,fontBytes:Record<string,Uint8Array>,recentTransactions:ReadonlyArray<Transaction>=[],redoHistory:HistoryEntry[]=[]):Promise<Uint8Array> {
  return buildPortableCheckpointBytes(documentNode,{runtimeProfile:'ga-c',assetBytes,fontBytes,redoHistory,recentTransactions:[...recentTransactions]})
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
