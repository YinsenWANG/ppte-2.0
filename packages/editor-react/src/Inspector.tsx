import { boundingFrame } from '../../geometry/src/index.js'
import { editRichText } from '../../richtext-adapter/src/index.js'
import {
  effectiveTextStyle,
  resolveEffectiveStyle,
  validateTextOverflow,
  measureTextLayout,
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
    (g) => ids.length === g.memberIds.length && ids.length > 1 && ids.every((id) => g.memberIds.includes(id)),
  );
  const frame=group?boundingFrame(group.memberIds.map(id=>slide.elements[id].frame)):element?.frame
  return (
    <section className="ppte-inspector" data-ppte-inspector>
      <strong>{ids.length ? `${ids.length} 个对象` : "选择对象后调整"}</strong>
      {ids.length>1&&<fieldset><legend>对齐与分布</legend>{(['left','center-x','right','top','center-y','bottom'] as const).map((alignment)=><button key={alignment} onClick={()=>emit({kind:'layout.align',elementIds:ids,alignment,reference:'selection'})}>{({left:'左对齐','center-x':'水平居中',right:'右对齐',top:'顶对齐','center-y':'垂直居中',bottom:'底对齐'})[alignment]}</button>)}{(['horizontal','vertical'] as const).map(axis=><button key={axis} onClick={()=>emit({kind:'layout.distribute',elementIds:ids,axis,mode:'gaps'})}>{axis==='horizontal'?'水平等距':'垂直等距'}</button>)}</fieldset>}
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
            number(key, frame![key], (value) =>
              emit({
                ...(group ? {kind:"group.resize",groupId:group.id,targetFrame:{...frame,[key]:value}} : {kind:"element.resize",frame:{...frame,[key]:value}}),
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
          {'style' in element && element.style && <fieldset><legend>样式预设</legend><select aria-label="样式预设" value={element.style.styleRef} onChange={e=>emit({kind:'element.setStyleRef',styleRef:e.target.value})}>{Object.keys(document.theme.presets[element.type as 'text'|'image'|'shape'|'chart']??{}).map(id=><option key={id}>{id}</option>)}</select><button onClick={()=>emit({kind:'element.clearStyleOverrides'})}>重置为预设</button></fieldset>}
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
                        content: editRichText(element.content,text),
                      });
                  }}
                />
              </label>
              <fieldset><legend>强调格式</legend>{(['bold','italic','underline','strike'] as const).map(mark=><button key={mark} onClick={()=>{const content=structuredClone(element.content);const enabled=content.paragraphs.every(p=>p.runs.every(r=>r.marks?.[mark]));for(const p of content.paragraphs)for(const r of p.runs)r.marks={...r.marks,[mark]:!enabled};emit({kind:'text.replaceContent',content})}}>{({bold:'粗体',italic:'斜体',underline:'下划线',strike:'删除线'})[mark]}</button>)}</fieldset>
              <label>文字颜色<input type="color" defaultValue="#172033" onChange={e=>emit({kind:'element.updateStyleOverrides',patch:{color:{kind:'value',value:e.target.value}}})}/></label>
              <label>对齐<select aria-label="文字对齐" value={element.paragraphStyle?.align??'left'} onChange={e=>emit({kind:'text.updateStyle',paragraphStyle:{...element.paragraphStyle,align:e.target.value}})}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label>
              {validateTextOverflow(document,slide.id,element).length>0&&<p role="status">文字溢出：可缩短内容、扩大文本框，或显式适配字号。</p>}
              <button onClick={()=>{const style=effectiveTextStyle(document,element);let size=style.fontSize;while(size>8){const m=measureTextLayout(element.content.paragraphs.map(p=>p.runs.map(r=>r.text).join('')).join('\n'),element.frame,{...style,fontSize:size},element.boxStyle?.padding);if(!m.overflowX&&!m.overflowY)break;size-=0.5}emit({kind:'text.fitByReducingFont',minFontSize:8,resolvedFontSize:size})}}>适配字号</button>
              <button onClick={()=>emit({kind:'text.setOverflowPolicy',overflowPolicy:'clip'})}>截断溢出显示</button>
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
          <details><summary>来源与诊断</summary><p>{element.semanticKey??'未设置语义标识'}</p>{element.semanticRefs?.factIds?.map(id=><p key={id}>{document.facts?.[id]?.key}: {String(document.facts?.[id]?.value)}</p>)}{element.semanticRefs?.sourceIds?.map(id=><p key={id}>{document.sources?.[id]?.title} · {document.sources?.[id]?.citation}</p>)}</details>
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
