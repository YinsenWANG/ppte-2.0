import { STANDARD_EDITABLE_SUFFIX } from "./delivery-policy.js";
import {
  PortableRuntime,
  configurePortableScript,
  decodePortable,
  base64,
  type PortableElementTarget,
  type QuickFixResult,
} from "./shared.js";
import { renderDocumentSurfaceHtml } from "../../renderer-react/src/index.js";
import { geometryOnlyContract } from "../../change-contract/src/index.js";
import type { ChartData, Transaction } from "../../schema/src/index.js";

// This entry is bundled once; every edit executes the same Core used by Node.
const payload = decodePortable(document.documentElement.outerHTML);
configurePortableScript(document.getElementById("ppte-runtime")!.textContent!);
const decode = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const runtime = new PortableRuntime(payload.document, {
  profile: payload.origin.profile,
  assetBytes: Object.fromEntries(
    Object.entries(payload.assets).map(([k, v]) => [k, decode(v)]),
  ),
  fontBytes: Object.fromEntries(
    Object.entries(payload.fonts).map(([k, v]) => [k, decode(v)]),
  ),
  recentTransactions: payload.recentTransactions,
});
const root = document.getElementById("ppte-shell")!;
const canvas = document.querySelector<HTMLElement>("[data-ppte-canvas]")!;
const stage = document.querySelector<HTMLElement>("[data-ppte-stage]")!;
const status = document.querySelector<HTMLElement>("[data-ppte-status]")!;
const editable = runtime.profile !== "viewer";
const advanced =
  runtime.profile === "light-edit" || runtime.profile === "full-portable";
const composing = new Set<string>();
const drafts = new Map<string, string>();
let presenting = false;
let fullscreenOwned = false;
let scale = 1;
let sequence = 0;
let drag:
  { id: string; x: number; y: number; dx: number; dy: number } | undefined;
const error = (code: string, message: string): QuickFixResult => ({
  ok: false,
  issues: [{ code, message, severity: "error" }],
});
const selected = () => runtime.getSelection()[0];
const nodeFor = (id: string) =>
  Array.from(
    canvas.querySelectorAll<HTMLElement>("[data-ppte-element-id]"),
  ).find((n) => n.dataset.ppteElementId === id);
function show(result?: { ok: boolean; issues?: Array<{ message: string }> }) {
  const state = runtime.presenterState();
  canvas.querySelectorAll<HTMLElement>("[data-ppte-slide-id]").forEach((n) => {
    n.style.display =
      n.dataset.ppteSlideId === state.slideId ? "block" : "none";
    n.style.transform = `scale(${scale})`;
    n.querySelectorAll<HTMLElement>("[data-ppte-appear-step]").forEach((e) => {
      const visible = Number(e.dataset.ppteAppearStep) <= state.step;
      e.style.visibility = visible ? "visible" : "hidden";
      e.style.animationName =
        visible && e.dataset.ppteAnimationEnter
          ? `ppte-enter-${e.dataset.ppteAnimationEnter}`
          : "none";
      e.style.animationDuration = `${Number(e.dataset.ppteAnimationDurationMs ?? 0)}ms`;
      e.style.animationDelay = `${Number(e.dataset.ppteAnimationDelayMs ?? 0)}ms`;
      e.style.animationTimingFunction = e.dataset.ppteAnimationEasing ?? "ease";
      e.style.animationFillMode = "both";
    });
    if (
      n.dataset.ppteTransitionType &&
      n.dataset.ppteTransitionType !== "none"
    ) {
      n.style.animationName = `ppte-transition-${n.dataset.ppteTransitionType}`;
      n.style.animationDuration = `${Number(n.dataset.ppteTransitionDurationMs ?? 0)}ms`;
      n.style.animationFillMode = "both";
    }
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
  canvas.innerHTML = renderDocumentSurfaceHtml(doc, {
    editable: editable && !presenting,
    assetSources: Object.fromEntries(
      Object.entries(assets).map(([id, data]) => [
        id,
        `data:${doc.assets[id]?.mimeType};base64,${base64(data)}`,
      ]),
    ),
  });
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
  const pending = flush();
  if (!pending.ok) { show(pending); return pending; }
  (document.activeElement as HTMLElement | null)?.blur();
  drag = undefined;
  presenting = true;
  root.dataset.ppteMode = "present";
  root.querySelectorAll("details[open]").forEach(n => n.removeAttribute("open"));
  render();
  stage.tabIndex = -1;
  stage.focus();
  // Slideshow mode works even when the browser refuses fullscreen.
  try { await root.requestFullscreen(); fullscreenOwned = document.fullscreenElement === root; }
  catch { fullscreenOwned = false; }
  fit();
  return { ok: true, issues: [] };
}
function leavePresentation() {
  presenting = false;
  root.dataset.ppteMode = "edit";
  drag = undefined;
  render();
  if (document.fullscreenElement === root) void document.exitFullscreen().catch(() => {});
  fullscreenOwned = false;
  root.querySelector<HTMLButtonElement>('[data-ppte-action="fullscreen"]')?.focus();
}
document.addEventListener("fullscreenchange", () => {
  if (document.fullscreenElement === root) fullscreenOwned = true;
  else if (fullscreenOwned && presenting) leavePresentation();
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
function flush(): QuickFixResult {
  if (composing.size)
    return error(
      "PORTABLE_COMPOSITION_ACTIVE",
      "Finish the current input composition before saving.",
    );
  for (const [id, text] of [...drafts]) {
    drafts.delete(id);
    const r = runtime.editText({ elementId: id }, text);
    if (!r.ok) return r;
  }
  return { ok: true, issues: [] };
}
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
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
root
  .querySelector<HTMLInputElement>('[data-ppte-action="import-image"]')
  ?.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file)
      void importImage(undefined, file, {
        fileName: file.name,
        mimeType: file.type,
      });
    input.value = "";
  });
const elementTarget = (event: Event) =>
  event.target instanceof Element
    ? event.target.closest<HTMLElement>("[data-ppte-element-id]")
    : null;
stage.addEventListener("click", (event) => {
  const n = elementTarget(event);
  if (presenting) { if (!(event.target as Element).closest("a,button")) { runtime.next(); show(); } return; }
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
stage.addEventListener("compositionstart", (event) => {
  if (presenting) return;
  const n = elementTarget(event);
  if (n) composing.add(n.dataset.ppteElementId!);
});
stage.addEventListener("input", (event) => {
  if (presenting) return;
  const n = elementTarget(event);
  if (n)
    drafts.set(n.dataset.ppteElementId!, n.innerText.replaceAll("\u00a0", " "));
});
stage.addEventListener("compositionend", (event) => {
  if (presenting) return;
  const n = elementTarget(event);
  if (n) {
    const id = n.dataset.ppteElementId!;
    composing.delete(id);
    drafts.delete(id);
    change(
      runtime.editText(
        { elementId: id },
        n.innerText.replaceAll("\u00a0", " "),
      ),
    );
  }
});
stage.addEventListener("focusout", (event) => {
  if (presenting) return;
  const n = elementTarget(event);
  if (n && !composing.has(n.dataset.ppteElementId!)) {
    const id = n.dataset.ppteElementId!;
    if (drafts.has(id)) {
      const text = drafts.get(id)!;
      drafts.delete(id);
      change(runtime.editText({ elementId: id }, text));
    }
  }
});
stage.addEventListener("pointerdown", (event) => {
  const n = elementTarget(event);
  if (presenting || !advanced || !n || n.isContentEditable || event.shiftKey) return;
  const id = n.dataset.ppteElementId!;
  if (!runtime.getSelection().some((s) => s.elementId === id)) select(id);
  drag = { id, x: event.clientX, y: event.clientY, dx: 0, dy: 0 };
  n.setPointerCapture(event.pointerId);
});
stage.addEventListener("pointermove", (event) => {
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
stage.addEventListener("pointerup", () => {
  if (!drag) return;
  const { dx, dy } = drag;
  drag = undefined;
  if (Math.abs(dx) + Math.abs(dy) > 0.5) moveSelection(dx, dy);
  else render();
});
window.addEventListener("resize", fit);
document.addEventListener("keydown", (event) => {
  if (presenting) {
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
const api = {
  enterPresentation,
  leavePresentation,
  getMode: () => presenting ? "present" : "edit",
  origin: payload.origin,
  get capabilityReport() {
    return runtime.getCapabilityReport();
  },
  getPayload: () => ({
    ...payload,
    document: runtime.getDocument(),
    recentTransactions: runtime.getHistory(),
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
new ResizeObserver(fit).observe(stage);
root.dataset.ppteMode = "edit";
(globalThis as any).PPTEPortable = api;
render();
