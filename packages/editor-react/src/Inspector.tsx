import {
  effectiveTextStyle,
  resolveEffectiveStyle,
} from "../../validation/src/index.js";
import type { PpteDocument, Operation, Slide } from "../../schema/src/index.js";
import type { ReactElement } from "react";
export function Inspector({
  document,
  slide,
  ids,
  commit,
}: {
  document: PpteDocument;
  slide: Slide;
  ids: string[];
  commit: (operations: Operation[], reason?: string) => boolean;
}): ReactElement {
  const element = slide.elements[ids[0] ?? ""];
  const emit = (value: Record<string, unknown>) =>
    commit(
      [
        {
          opId: `inspector:${crypto.randomUUID()}`,
          slideId: slide.id,
          elementId: element?.id,
          ...value,
        } as Operation,
      ],
      "修改选中对象",
    );
  const number = (label: string, value: number, save: (v: number) => void) => (
    <label key={label}>
      {label}
      <input
        type="number"
        aria-label={label}
        defaultValue={Number(value.toFixed(3))}
        onBlur={(event) => {
          const n = Number(event.target.value);
          if (Number.isFinite(n) && n !== value) save(n);
        }}
      />
    </label>
  );
  const group = Object.values(slide.groups ?? {}).find(
    (g) => ids.length > 0 && ids.every((id) => g.memberIds.includes(id)),
  );
  return (
    <section className="ppte-inspector" data-ppte-inspector>
      <strong>{ids.length ? `${ids.length} 个对象` : "选择对象后调整"}</strong>
      {ids.length > 1 && !group && (
        <button
          onClick={() =>
            emit({
              kind: "group.create",
              group: { id: `group_${crypto.randomUUID()}`, memberIds: ids },
            })
          }
        >
          组合
        </button>
      )}
      {group && (
        <>
          <button
            onClick={() => emit({ kind: "group.delete", groupId: group.id })}
          >
            取消组合
          </button>
          {number("组旋转角度", 0, (v) =>
            emit({ kind: "group.rotate", groupId: group.id, rotationDeg: v }),
          )}
        </>
      )}
      {element && (
        <>
          {(["x", "y", "width", "height"] as const).map((key) =>
            number(key, element.frame[key], (value) =>
              emit({
                kind: "element.resize",
                frame: { ...element.frame, [key]: value },
              }),
            ),
          )}
          {number("旋转", element.rotationDeg ?? 0, (v) =>
            emit({ kind: "element.rotate", rotationDeg: v }),
          )}
          <label>
            锁定
            <input
              type="checkbox"
              checked={element.locked ?? false}
              onChange={(e) =>
                emit({ kind: "element.setLocked", locked: e.target.checked })
              }
            />
          </label>
          {element.type === "text" && (
            <>
              <label>
                文字
                <textarea
                  aria-label="文字"
                  defaultValue={element.content.paragraphs
                    .map((p) => p.runs.map((r) => r.text).join(""))
                    .join("\n")}
                  onBlur={(e) => {
                    const text = e.target.value;
                    const previous = element.content.paragraphs
                      .map((p) => p.runs.map((r) => r.text).join(""))
                      .join("\n");
                    if (text !== previous)
                      emit({
                        kind: "text.replaceContent",
                        content: {
                          paragraphs: text
                            .split("\n")
                            .map((line, i) => ({
                              id: `p${i}`,
                              runs: [{ id: `r${i}`, text: line }],
                            })),
                        },
                      });
                  }}
                />
              </label>
              {number(
                "字号",
                effectiveTextStyle(document, element).fontSize,
                (v) =>
                  emit({
                    kind: "element.updateStyleOverrides",
                    patch: { fontSize: v },
                  }),
              )}
            </>
          )}
          {element.type === "image" && (
            <fieldset>
              <legend>裁剪（0–1）</legend>
              {(["x", "y", "width", "height"] as const).map((key) => {
                const crop = element.crop ?? {
                  x: 0,
                  y: 0,
                  width: 1,
                  height: 1,
                };
                return number(`裁剪 ${key}`, crop[key], (v) =>
                  emit({ kind: "image.setCrop", crop: { ...crop, [key]: v } }),
                );
              })}
            </fieldset>
          )}
          {element.type === "chart" && (
            <fieldset>
              <legend>图表数据</legend>
              {element.data.rows.flatMap((row) =>
                element.data.columns.map((column) => (
                  <label key={`${row.id}:${column.id}`}>
                    {row.id} / {column.label}
                    <input
                      aria-label={`${row.id} / ${column.id}`}
                      type={column.type === "number" ? "number" : "text"}
                      defaultValue={String(row.values[column.id] ?? "")}
                      onBlur={(event) => {
                        const data = structuredClone(element.data);
                        data.rows.find((r) => r.id === row.id)!.values[
                          column.id
                        ] =
                          column.type === "number"
                            ? Number(event.target.value)
                            : event.target.value;
                        emit({ kind: "chart.replaceData", data });
                      }}
                    />
                  </label>
                )),
              )}
            </fieldset>
          )}
          {element.type === "shape" && (
            <label>
              填充色
              <input
                type="color"
                defaultValue={
                  (resolveEffectiveStyle(document, element).fill as any)
                    ?.color ?? "#2563eb"
                }
                onChange={(e) =>
                  emit({
                    kind: "shape.updateStyle",
                    patch: {
                      fill: {
                        kind: "solid",
                        color: { kind: "value", value: e.target.value },
                      },
                    },
                  })
                }
              />
            </label>
          )}
          {element.type === "component" &&
            Object.entries(element.props).map(([key, value]) => (
              <label key={key}>
                {key}
                <textarea
                  aria-label={key}
                  defaultValue={
                    typeof value === "object"
                      ? JSON.stringify(value, null, 2)
                      : String(value)
                  }
                  onBlur={(e) => {
                    try {
                      const next =
                        typeof value === "object" || typeof value === "boolean"
                          ? JSON.parse(e.target.value)
                          : typeof value === "number"
                            ? Number(e.target.value)
                            : e.target.value;
                      e.target.setCustomValidity("");
                      emit({
                        kind: "component.updateProps",
                        patch: { [key]: next },
                      });
                    } catch {
                      e.target.setCustomValidity("请输入有效 JSON");
                      e.target.reportValidity();
                    }
                  }}
                />
              </label>
            ))}
        </>
      )}
    </section>
  );
}
