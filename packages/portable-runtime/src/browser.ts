import { renderObjectProperties } from '../../editor-dom/src/object-properties.js';
import { planObjectProperty } from '../../editor-controller/src/object-commands.js';
import { TextEditingSurface, reconcileTextSurface } from '../../editor-dom/src/text-selection.js';
import { DomResources } from '../../editor-dom/src/index.js';
import { inferCompatibilityProfile } from '../../compatibility/src/index.js';
import { STANDARD_EDITABLE_SUFFIX } from "./delivery-policy.js";
import {
  PortableRuntime,
  buildPortableCheckpointBytes,
  assessCheckpointRecovery,
  configurePortableScript,
  decodePortable,
  base64,
  type PortableElementTarget,
  type QuickFixResult,
} from "./shared.js";
import { renderDocumentSurfaceHtml } from "../../renderer-react/src/index.js";
import { geometryOnlyContract } from "../../change-contract/src/index.js";
import type { ChartData, Transaction } from "../../schema/src/index.js";

function startPortable() {
// This entry is bundled once; every edit executes the same Core used by Node.
const payload = decodePortable(document.documentElement.outerHTML);
configurePortableScript(document.getElementById("ppte-runtime")!.textContent!);
const decode = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const diagnosis = assessCheckpointRecovery(buildPortableCheckpointBytes(payload.document, {
  runtimeProfile: 'ga-c', compatibilityProfile: payload.minimumCompatibilityProfile,
  assetBytes: Object.fromEntries(Object.entries(payload.assets).map(([k,v]) => [k,decode(v)])),
  fontBytes: Object.fromEntries(Object.entries(payload.fonts).map(([k,v]) => [k,decode(v)])),
  recentTransactions: payload.recentTransactions, redoHistory: payload.redoHistory,
}));
if (diagnosis.snapshotStatus !== 'valid' || !['valid','absent'].includes(diagnosis.history.status)) throw new Error(JSON.stringify(diagnosis));
const runtime = new PortableRuntime(payload.document, {
  profile: payload.origin.profile,
  assetBytes: Object.fromEntries(
    Object.entries(payload.assets).map(([k, v]) => [k, decode(v)]),
  ),
  fontBytes: Object.fromEntries(
    Object.entries(payload.fonts).map(([k, v]) => [k, decode(v)]),
  ),
  recentTransactions: payload.recentTransactions,
  redoHistory: payload.redoHistory,
});
const dom = new DomResources();
runtime.controller.own(() => dom.dispose());
const root = document.getElementById("ppte-shell")!;
const canvas = document.querySelector<HTMLElement>("[data-ppte-canvas]")!;
const stage = document.querySelector<HTMLElement>("[data-ppte-stage]")!;
const status = document.querySelector<HTMLElement>("[data-ppte-status]")!;
const editable = runtime.profile !== "viewer";
const advanced =
  runtime.profile === "light-edit" || runtime.profile === "full-portable";
const textSurface = new TextEditingSurface(stage, {
  colors:()=>runtime.getDocument().theme.tokens.colors,
  revision:()=>runtime.getRevision(),
  target:id=>{const d=runtime.getDocument();for(const slideId of d.slideOrder){const element=d.slides[slideId].elements[id];if(element?.type==='text')return {element,slideId}}},
  commit:tx=>runtime.controller.commit(tx),
  history:redo=>change(redo?runtime.redo():runtime.undo()),
  changed:r=>{change(r);if(r.ok&&pendingPresentation)void enterPresentation()},
  canEdit:()=>editable&&!presenting,
});
runtime.controller.own(()=>textSurface.dispose());
dom.listen(window, 'pagehide', () => runtime.dispose(), { once: true });
let presenting = false;
let pendingPresentation = false;
let scale = 1;
let sequence = 0;
let drag:
  { id: string; x: number; y: number; dx: number; dy: number } | undefined;
const error = (code: string, message: string): QuickFixResult => ({
  ok: false,
  issues: [{ code, message, severity: "error" }],
});
const properties = document.createElement('section');
properties.dataset.ppteObjectProperties = '';
const propertiesPanel = document.createElement('details');
propertiesPanel.dataset.pptePropertiesPanel = '';
propertiesPanel.open = true;
const propertiesTitle = document.createElement('summary');
propertiesTitle.textContent = '对象属性';
propertiesPanel.append(propertiesTitle, properties);
root.append(propertiesPanel);
const selected = () => runtime.getSelection()[0];
const nodeFor = (id: string) =>
  Array.from(
    canvas.querySelectorAll<HTMLElement>("[data-ppte-element-id]"),
  ).find((n) => n.dataset.ppteElementId === id);
function show(result?: { ok: boolean; issues?: Array<{ message: string }> }) {
  const state = runtime.presenterState();
  propertiesPanel.hidden = runtime.profile !== "full-portable" || presenting;
  if (!propertiesPanel.hidden) renderObjectProperties(properties, runtime.getDocument(), state.slideId, runtime.getSelection().filter(t=>t.slideId===state.slideId).map(t=>t.elementId), command => {
    if (!flush().ok) return;
    change(runtime.controller.commit(planObjectProperty(runtime.getDocument(), {revision:runtime.getRevision(),slideId:state.slideId,ids:runtime.getSelection().filter(t=>t.slideId===state.slideId).map(t=>t.elementId),command,transactionId:`properties:${++sequence}`,createdAt:new Date().toISOString()})));
  });
  canvas.querySelectorAll<HTMLElement>("[data-ppte-slide-id]").forEach((n) => {
    n.style.display =
      n.dataset.ppteSlideId === state.slideId ? "block" : "none";
    n.style.transform = `scale(${scale})`;
    n.querySelectorAll<HTMLElement>("[data-ppte-appear-step]").forEach((e) => {
      const visible = !presenting || Number(e.dataset.ppteAppearStep) <= state.step;
      e.style.visibility = visible ? "visible" : "hidden";
      e.style.animationName =
        presenting && visible && e.dataset.ppteAnimationEnter
          ? `ppte-enter-${e.dataset.ppteAnimationEnter}`
          : "none";
      e.style.animationDuration = `${Number(e.dataset.ppteAnimationDurationMs ?? 0)}ms`;
      e.style.animationDelay = `${Number(e.dataset.ppteAnimationDelayMs ?? 0)}ms`;
      e.style.animationTimingFunction = e.dataset.ppteAnimationEasing ?? "ease";
      e.style.animationFillMode = "both";
    });
    if (
      presenting && n.dataset.ppteTransitionType &&
      n.dataset.ppteTransitionType !== "none"
    ) {
      n.style.animationName = `ppte-transition-${n.dataset.ppteTransitionType}`;
      n.style.animationDuration = `${Number(n.dataset.ppteTransitionDurationMs ?? 0)}ms`;
      n.style.animationFillMode = "both";
    } else n.style.animationName = "none";
  });
  canvas
    .querySelectorAll<HTMLElement>("[data-ppte-element-id]")
    .forEach(
      (n) =>
        (n.dataset.ppteSelected = String(
          !presenting && runtime
            .getSelection()
            .some((s) => s.elementId === n.dataset.ppteElementId),
        )),
    );
  root.dataset.ppteRevision = runtime.getRevision();
  root.dataset.ppteStep = String(state.step);
  document.documentElement.dataset.ppteRevision = runtime.getRevision();
  document.querySelector<HTMLElement>("[data-ppte-notes]")!.textContent =
    state.notes?.speaker ?? state.notes?.handout ?? "";
  status.textContent =
    result?.ok === false
      ? (result.issues?.map((i) => i.message).join("; ") ?? "Edit failed")
      : `第 ${state.slideIndex + 1} / ${runtime.getDocument().slideOrder.length} 页 · ${editable ? "编辑模式" : "浏览模式"}`;
}
function fit() {
  const spec = runtime.getDocument().canvas;
  scale = Math.max(
    0.05,
    Math.min(
      (stage.clientWidth - (presenting ? 0 : 48)) / spec.width,
      (stage.clientHeight - (presenting ? 0 : 48)) / spec.height,
    ),
  );
  canvas.style.width = `${spec.width * scale}px`;
  canvas.style.height = `${spec.height * scale}px`;
  show();
}
function render() {
  const doc = runtime.getDocument();
  const assets = runtime.getAssetBytes();
  textSurface.refresh();
  reconcileTextSurface(canvas, renderDocumentSurfaceHtml(doc, {
    editable: editable && !presenting,
    assetSources: Object.fromEntries(
      Object.entries(assets).map(([id, data]) => [
        id,
        `data:${doc.assets[id]?.mimeType};base64,${base64(data)}`,
      ]),
    ),
  }), textSurface.protect);
  document.getElementById("ppte-portable-fonts")?.remove();
  const fontStyle = document.createElement("style");
  fontStyle.id = "ppte-portable-fonts";
  fontStyle.textContent = Object.entries(runtime.getFontBytes())
    .map(
      ([id, data]) =>
        `@font-face{font-family:${JSON.stringify(doc.fonts[id]?.family)};src:url(data:font/woff2;base64,${base64(data)})}`,
    )
    .join("\n");
  document.head.append(fontStyle);
  fit();
}
async function enterPresentation() {
  if (presenting) return { ok: true, issues: [] };
  pendingPresentation = [...textSurface.drafts.values()].some(b=>b.isComposing());
  const pending = flush();
  if (!pending.ok) { show(pending); return pending; }
  pendingPresentation = false;
  (document.activeElement as HTMLElement | null)?.blur();
  drag = undefined;
  runtime.presentation.enter(() => ({ ok: true }));
  presenting = true;
  root.dataset.ppteMode = "present";
  root.querySelectorAll("details[open]").forEach(n => n.removeAttribute("open"));
  render();
  stage.tabIndex = -1;
  stage.focus();
  // Slideshow mode works even when the browser refuses fullscreen.
  await runtime.presentation.requestFullscreen(root);
  fit();
  return { ok: true, issues: [] };
}
function leavePresentation() {
  pendingPresentation = false;
  runtime.presentation.leave();
  presenting = false;
  root.dataset.ppteMode = "edit";
  drag = undefined;
  render();
  if (document.fullscreenElement === root) void document.exitFullscreen().catch(() => {});
  root.querySelector<HTMLButtonElement>('[data-ppte-action="fullscreen"]')?.focus();
}
dom.listen(document, "fullscreenchange", () => {
  if (runtime.presentation.fullscreenChanged(root)) leavePresentation();
  fit();
});
function change<T extends { ok: boolean; issues?: Array<{ message: string }> }>(
  result: T,
): T {
  if (result.ok) render();
  show(result);
  return result;
}
function editText(target: PortableElementTarget, value: string) {
  return change(runtime.editText(target, value));
}
function flush(): QuickFixResult { return runtime.controller.flushSync() }
runtime.controller.setFlushHandler(()=>{const r=textSurface.flush();return {...r,issues:r.issues?.map(i=>i.code==='COMPOSITION_ACTIVE'?{...i,code:'PORTABLE_COMPOSITION_ACTIVE'}:i)}});
function download(value: Uint8Array | string, name: string, type: string) {
  const blob = new Blob(
    [typeof value === "string" ? value : new Uint8Array(value).buffer],
    { type },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  const release = dom.own(() => URL.revokeObjectURL(url));
  const timer = setTimeout(release, 1000);
  dom.own(() => clearTimeout(timer));
}
function saveAsProject() {
  const pending = flush();
  if (!pending.ok) return pending;
  const result = runtime.saveAsProject();
  if (result.ok && result.bytes)
    download(
      result.bytes,
      `${runtime.getDocument().metadata.title}.ppte`,
      "application/vnd.ppte+zip",
    );
  show(result);
  return result;
}
function saveAsPortable() {
  const pending = flush();
  if (!pending.ok) return pending;
  const result = runtime.saveAsPortable();
  if (result.ok)
    download(
      result.html,
      `${runtime.getDocument().metadata.title}${STANDARD_EDITABLE_SUFFIX}`,
      "text/html",
    );
  show(result);
  return result;
}
function select(target: PortableElementTarget | string) {
  const r = runtime.select(target);
  show(r);
  return r;
}
function selectMany(targets: Array<PortableElementTarget | string>) {
  const r = runtime.selectMany(targets);
  show(r);
  return r;
}
function moveSelection(dx: number, dy: number) {
  const items = runtime.getSelection();
  if (!items.length)
    return error("PORTABLE_SELECTION_INVALID", "Select an object first.");
  if (items.length === 1 || runtime.profile !== "full-portable") {
    const t = items[0]!;
    const f =
      runtime.getDocument().slides[t.slideId]!.elements[t.elementId]!.frame;
    return change(runtime.moveElement(t, { x: f.x + dx, y: f.y + dy }));
  }
  const doc = runtime.getDocument();
  const ids = items.map((i) => i.elementId);
  const transaction: Transaction = {
    transactionId: `portable:move-selection:${++sequence}`,
    baseRevision: runtime.getRevision(),
    actor: { type: "human", id: "portable" },
    scope: {
      kind: "selection",
      slideIds: [...new Set(items.map((i) => i.slideId))],
      elementIds: ids,
      permissions: ["geometry"],
      allowInsert: false,
      allowDelete: false,
    },
    changeContract: geometryOnlyContract(ids, false),
    createdAt: new Date().toISOString(),
    operations: items.map((t) => ({
      opId: `move:${t.elementId}`,
      kind: "element.move",
      ...t,
      x: doc.slides[t.slideId]!.elements[t.elementId]!.frame.x + dx,
      y: doc.slides[t.slideId]!.elements[t.elementId]!.frame.y + dy,
    })),
  };
  return change(runtime.commit(transaction));
}
function dialogForm(
  title: string,
  fields: Array<{ label: string; value: string; type?: string }>,
  apply: (values: string[]) => QuickFixResult,
) {
  const dialog = document.createElement("dialog");
  dialog.dataset.ppteDialog = title;
  const heading = document.createElement("h3");
  heading.textContent = title;
  dialog.append(heading);
  const inputs = fields.map((f, index) => {
    const label = document.createElement("label");
    label.style.display = "block";
    label.textContent = f.label;
    const input = document.createElement("input");
    input.type = f.type ?? "text";
    input.value = f.value;
    input.setAttribute("aria-label", f.label);
    input.dataset.ppteField = String(index);
    label.append(input);
    dialog.append(label);
    return input;
  });
  const errors = document.createElement("p");
  dialog.append(errors);
  const accept = document.createElement("button");
  accept.textContent = "Apply";
  accept.dataset.ppteDialogApply = "true";
  accept.onclick = () => {
    const r = apply(inputs.map((i) => i.value));
    if (r.ok) {
      dialog.close();
      dialog.remove();
    } else errors.textContent = r.issues.map((i) => i.message).join("; ");
  };
  const cancel = document.createElement("button");
  cancel.textContent = "Cancel";
  cancel.onclick = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.append(accept, cancel);
  document.body.append(dialog);
  dialog.showModal();
}
function cropDialog() {
  const target = selected();
  if (!target)
    return show(error("PORTABLE_SELECTION_INVALID", "Select an image."));
  const e =
    runtime.getDocument().slides[target.slideId]!.elements[target.elementId]!;
  if (e.type !== "image")
    return show(error("PORTABLE_EDIT_UNSUPPORTED", "Select an image."));
  const crop = e.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const keys = ["x", "y", "width", "height"] as const;
  dialogForm(
    "Crop",
    keys.map((k) => ({ label: k, value: String(crop[k]), type: "number" })),
    (values) =>
      change(
        runtime.cropImage(
          target,
          Object.fromEntries(
            keys.map((k, i) => [k, Number(values[i])]),
          ) as unknown as typeof crop,
        ),
      ),
  );
}
function chartDialog() {
  const target = selected();
  if (!target)
    return show(error("PORTABLE_SELECTION_INVALID", "Select a chart."));
  const e =
    runtime.getDocument().slides[target.slideId]!.elements[target.elementId]!;
  if (e.type !== "chart")
    return show(error("PORTABLE_EDIT_UNSUPPORTED", "Select a chart."));
  const data = structuredClone(e.data);
  const cells = data.rows.flatMap((row) =>
    data.columns.map((col) => ({ row, col })),
  );
  dialogForm(
    "Chart data",
    cells.map(({ row, col }) => ({
      label: `${row.id} / ${col.label ?? col.id}`,
      value: String(row.values[col.id] ?? ""),
      type: col.type === "number" ? "number" : "text",
    })),
    (values) => {
      cells.forEach(
        ({ row, col }, i) =>
          (row.values[col.id] =
            col.type === "number" ? Number(values[i]) : values[i]!),
      );
      return change(runtime.updateChartData(target, data));
    },
  );
}
async function importImage(
  target: PortableElementTarget | undefined,
  data: Blob | Uint8Array,
  options: Record<string, any> = {},
) {
  const resolved =
    target ??
    selected() ??
    Object.entries(runtime.getDocument().slides).flatMap(([slideId, s]) =>
      Object.values(s.elements)
        .filter((e) => e.type === "image")
        .map((e) => ({ slideId, elementId: e.id })),
    )[0];
  if (!resolved)
    return error("PORTABLE_SELECTION_INVALID", "Select an image to replace.");
  const bytes =
    data instanceof Uint8Array
      ? data
      : new Uint8Array(await data.arrayBuffer());
  return change(runtime.importImage(resolved, bytes, options));
}
root.querySelectorAll<HTMLButtonElement>("button[data-ppte-action]").forEach(
  (button) =>
    (button.onclick = () => {
      const action = button.dataset.ppteAction;
      const t = selected();
      if (action === "previous") {
        runtime.previous();
        show();
      } else if (action === "next") {
        runtime.next();
        show();
      } else if (action === "fullscreen") void enterPresentation();
      else if (action === "exit-present") leavePresentation();
      else if (action === "save") saveAsProject();
      else if (action === "save-portable") saveAsPortable();
      else if (action === "undo") change(runtime.undo());
      else if (action === "redo") change(runtime.redo());
      else if (action === "crop") cropDialog();
      else if (action === "chart-data") chartDialog();
      else if (action === "move-left" || action === "move-right")
        moveSelection(action === "move-left" ? -20 : 20, 0);
      else if ((action === "scale-up" || action === "scale-down") && t)
        change(runtime.scaleElement(t, action === "scale-up" ? 1.1 : 0.9));
      else if (action === "rotate" && t) {
        const e =
          runtime.getDocument().slides[t.slideId]!.elements[t.elementId]!;
        dialogForm(
          "Rotate",
          [
            {
              label: "Degrees",
              value: String(e.rotationDeg ?? 0),
              type: "number",
            },
          ],
          (v) => change(runtime.rotateElement(t, Number(v[0]))),
        );
      }
    }),
);
const imageInput = root.querySelector<HTMLInputElement>('[data-ppte-action="import-image"]');
if (imageInput) dom.listen(imageInput, "change", (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file)
      void importImage(undefined, file, {
        fileName: file.name,
        mimeType: file.type,
      });
    input.value = "";
  });
dom.own(() => { root.querySelectorAll<HTMLButtonElement>("button[data-ppte-action]").forEach(button => { button.onclick = null }); });
const elementTarget = (event: Event) =>
  event.target instanceof Element
    ? event.target.closest<HTMLElement>("[data-ppte-element-id]")
    : null;
dom.listen(stage, "click", (event) => {
  const n = elementTarget(event);
  if (presenting) return;
  if (!editable || !n) return;
  if (event.shiftKey && runtime.profile === "full-portable") {
    const items = runtime.getSelection();
    selectMany(
      items.some((i) => i.elementId === n.dataset.ppteElementId)
        ? items.filter((i) => i.elementId !== n.dataset.ppteElementId)
        : [...items, { elementId: n.dataset.ppteElementId! }],
    );
  } else select(n.dataset.ppteElementId!);
});
dom.listen(stage, "pointerdown", (event) => {
  const n = elementTarget(event);
  if (presenting || !advanced || !n || n.isContentEditable || event.shiftKey) return;
  const id = n.dataset.ppteElementId!;
  if (!runtime.getSelection().some((s) => s.elementId === id)) select(id);
  drag = { id, x: event.clientX, y: event.clientY, dx: 0, dy: 0 };
  n.setPointerCapture(event.pointerId);
});
dom.listen(stage, "pointermove", (event) => {
  if (!drag) return;
  drag.dx = (event.clientX - drag.x) / scale;
  drag.dy = (event.clientY - drag.y) / scale;
  for (const t of runtime.getSelection()) {
    const e = runtime.getDocument().slides[t.slideId]!.elements[t.elementId]!;
    const n = nodeFor(t.elementId);
    if (n) {
      n.style.left = `${e.frame.x + drag.dx}px`;
      n.style.top = `${e.frame.y + drag.dy}px`;
    }
  }
});
dom.listen(stage, "pointerup", () => {
  if (!drag) return;
  const { dx, dy } = drag;
  drag = undefined;
  if (Math.abs(dx) + Math.abs(dy) > 0.5) moveSelection(dx, dy);
  else render();
});
dom.listen(window, "resize", fit);
dom.listen(document, "keydown", (event) => {
  if (event.isComposing || [...textSurface.drafts.values()].some(b=>b.isComposing())) return;
  if (presenting) {
    if (event.key !== "Escape" && (event.target as HTMLElement).closest("a,button,video,audio,input,textarea,select")) return;
    if (event.key === "Escape") { event.preventDefault(); leavePresentation(); }
    else if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(event.key)) { event.preventDefault(); runtime.next(); show(); }
    else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) { event.preventDefault(); runtime.previous(); show(); }
    else if (event.key === "Home") { event.preventDefault(); runtime.setSlide(0); show(); }
    else if (event.key === "End") { event.preventDefault(); runtime.setSlide(runtime.getDocument().slideOrder.length - 1); show(); }
    else if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) event.preventDefault();
    return;
  }
  if (
    (event.target as HTMLElement).isContentEditable ||
    ["INPUT", "TEXTAREA"].includes((event.target as HTMLElement).tagName)
  )
    return;
  if (event.key === "ArrowRight") {
    runtime.next();
    show();
  } else if (event.key === "ArrowLeft") {
    runtime.previous();
    show();
  } else if ((event.ctrlKey || event.metaKey) && event.key === "z") {
    event.preventDefault();
    change(event.shiftKey ? runtime.redo() : runtime.undo());
  }
});
for (const type of ["beforeinput", "paste", "drop"] as const) {
  dom.listen(stage, type, event => { if (!runtime.presentation.canMutate) event.preventDefault(); }, true);
}
dom.listen(document, "keydown", event => { if (event.key === "Escape") pendingPresentation = false; }, true);
if(editable){
  const toolbar=document.createElement('div');toolbar.setAttribute('aria-label','选区格式');
  for(const mark of ['bold','italic','underline','strike','clear'] as const){const button=document.createElement('button');button.textContent=mark;button.dataset.ppteTextMark=mark;button.onmousedown=e=>{textSurface.remember();e.preventDefault()};button.onclick=()=>textSurface.format(mark==='clear'?{bold:null,italic:null,underline:null,strike:null,color:null}:{[mark]:true});toolbar.append(button)}
  const color=document.createElement('input');color.type='color';color.setAttribute('aria-label','选区颜色');color.onpointerdown=()=>textSurface.remember();color.onchange=()=>textSurface.format({color:{kind:'value',value:color.value as `#${string}`}});toolbar.append(color);
  const discard=document.createElement('button');discard.textContent='放弃文字草稿';discard.onclick=()=>{textSurface.discardActive();render()};toolbar.append(discard);
  const tools=root.querySelector('[data-ppte-toolbar]')??root.querySelector('header');(tools??root).append(toolbar);
}
const api = {
  setTextMarks: (patch: Parameters<TextEditingSurface["format"]>[0]) => textSurface.format(patch),
  getTextMarks: () => textSurface.marks(),
  enterPresentation,
  leavePresentation,
  getMode: () => presenting ? "present" : "edit",
  origin: payload.origin,
  get capabilityReport() {
    return runtime.getCapabilityReport();
  },
  getPayload: () => ({
    ...payload,
    artifactIdentity: undefined,
    origin: { ...payload.origin, sourceRevision: runtime.getRevision() },
    minimumCompatibilityProfile: inferCompatibilityProfile(runtime.getDocument(), { recentTransactions: runtime.getHistory(), redoHistory: runtime.getRedoHistory() }),
    capabilityReport: runtime.getCapabilityReport(),
    assets: Object.fromEntries(Object.entries(runtime.getAssetBytes()).map(([id, bytes]) => [id, base64(bytes)])),
    fonts: Object.fromEntries(Object.entries(runtime.getFontBytes()).map(([id, bytes]) => [id, base64(bytes)])),
    document: runtime.getDocument(),
    recentTransactions: runtime.getHistory(),
    redoHistory: runtime.getRedoHistory(),
  }),
  getDocument: () => runtime.getDocument(),
  getRevision: () => runtime.getRevision(),
  getHistory: () => runtime.getHistory(),
  select,
  selectMany,
  editText,
  replaceImage: (t: PortableElementTarget, id: string) =>
    change(runtime.replaceImage(t, id)),
  importImage,
  cropImage: (t: PortableElementTarget, c: any) =>
    change(runtime.cropImage(t, c)),
  updateChartData: (t: PortableElementTarget, d: ChartData) =>
    change(runtime.updateChartData(t, d)),
  moveElement: (t: PortableElementTarget, p: any) =>
    change(runtime.moveElement(t, p)),
  resizeElement: (t: PortableElementTarget, f: any) =>
    change(runtime.resizeElement(t, f)),
  scaleElement: (t: PortableElementTarget, f: number) =>
    change(runtime.scaleElement(t, f)),
  rotateElement: (t: PortableElementTarget, r: number) =>
    change(runtime.rotateElement(t, r)),
  moveSelection,
  preview: (t: Transaction) => runtime.preview(t),
  commit: (t: Transaction) => change(runtime.commit(t)),
  undo: () => change(runtime.undo()),
  redo: () => change(runtime.redo()),
  saveAsProject,
  saveAsNewProject: saveAsProject,
  saveAsPortable,
  saveAsEditableCopy: saveAsPortable,
  next: () => {
    const r = runtime.next();
    show();
    return r;
  },
  previous: () => {
    const r = runtime.previous();
    show();
    return r;
  },
  setSlide: (i: number) => {
    const r = runtime.setSlide(i);
    show();
    return r;
  },
};
const observer = new ResizeObserver(fit);
observer.observe(stage);
dom.own(() => observer.disconnect());
root.dataset.ppteMode = "edit";
(globalThis as any).PPTEPortable = api;
render();

}
try { startPortable() } catch (cause) {
  const panel = document.createElement('pre')
  panel.dataset.ppteRecoveryDiagnostic = 'true'
  panel.textContent = `只读诊断：项目未完整验证，不能编辑或另存为完整项目。原文件已保留。\n${String(cause)}`
  document.body.replaceChildren(panel)
}
