import {useRef,useState,type ReactElement} from 'react'
import {builtInRecipeSpecs,RecipeRegistry,resolveRecipeZones} from '../../layout-recipes/src/index.js'
import {renderSlideHtml} from '../../renderer-react/src/index.js'
import {compileSlide,materializeSlideDraft} from '../../design-compiler/src/index.js'
import {inferSlideIR} from '../../agent-tools/src/index.js'
import {canonicalHash} from '../../canonical-json/src/index.js'
import type {PpteDocument,RecipeSpec,SlideIR,LayoutZone} from '../../schema/src/index.js'

/** Data-only local recipe versions: importing a recipe never executes code. */
export function RecipeStudio({documentNode,slideId,assetSources,onApply,onClose}:{documentNode:PpteDocument;slideId:string;assetSources:Record<string,string>;onApply:(recipe:RecipeSpec)=>void;onClose:()=>void}):ReactElement {
  const [spec,setSpec]=useState(()=>builtInRecipeSpecs()[0]!)
  const [zoneId,setZoneId]=useState(spec.zones[0]!.id)
  const [saved,setSaved]=useState<RecipeSpec[]>(()=>{try{return new RecipeRegistry(JSON.parse(localStorage.getItem('ppte.recipe.versions')??'[]')).list()}catch{return []}})
  const [message,setMessage]=useState('')
  const [report,setReport]=useState<ReturnType<typeof testRecipe>>()
  const [json,setJson]=useState('')
  const [baseline,setBaseline]=useState<ReturnType<typeof testRecipe>>()
  const accepted=(()=>{try{return JSON.parse(localStorage.getItem('ppte.recipe.acceptance')??'{}')[`${spec.id}@${spec.version}`]??0}catch{return 0}})()
  const drag=useRef<{x:number;y:number;zone:LayoutZone}|undefined>(undefined)
  const zone=spec.zones.find(z=>z.id===zoneId)
  function select(r:RecipeSpec){setSpec(structuredClone(r));setZoneId(r.zones[0]?.id??'');setReport(undefined);setJson('')}
  function update(patch:Partial<LayoutZone>){setSpec(s=>({...s,zones:s.zones.map(z=>z.id===zoneId?{...z,...patch}:z)}));setReport(undefined)}
  function download(name:string,value:unknown){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  function save(){try{new RecipeRegistry([spec]);if([...builtInRecipeSpecs(),...saved].some(r=>r.id===spec.id&&r.version===spec.version))throw new Error('此版本已存在，请使用新的名称或版本号');const next=[...saved,structuredClone(spec)];localStorage.setItem('ppte.recipe.versions',JSON.stringify(next));setSaved(next);setMessage('版本已保存；选择旧版本即可回退')}catch(e){setMessage(String(e))}}
  return <section data-ppte-recipe-studio className="ppte-recipe-studio"><h3>布局工作室</h3><p>本浏览器已确认应用此版本 {accepted} 次（不代表其他用户或宿主的统计）。</p><p>拖动区域或调整归一化尺寸。约束会在编译时生效。应用布局前仍需预览确认。</p>
    <label>选择版本<select aria-label="布局版本" value={`${spec.id}@${spec.version}`} onChange={e=>{const r=[...builtInRecipeSpecs(),...saved].find(r=>`${r.id}@${r.version}`===e.target.value);if(r)select(r)}}>{[...builtInRecipeSpecs(),...saved].map(r=><option key={`${r.id}@${r.version}`}>{r.id}@{r.version}</option>)}</select></label>
    <label>名称<input aria-label="布局名称" value={spec.id} onChange={e=>setSpec({...spec,id:e.target.value})}/></label><label>版本<input aria-label="布局版本号" value={spec.version} onChange={e=>setSpec({...spec,version:e.target.value})}/></label>
    <div className="ppte-recipe-zones" onPointerMove={e=>{const d=drag.current;if(d){const rect=e.currentTarget.getBoundingClientRect();update({x:Math.max(0,Math.min(1-d.zone.width,d.zone.x+(e.clientX-d.x)/rect.width)),y:Math.max(0,Math.min(1-d.zone.height,d.zone.y+(e.clientY-d.y)/rect.height))})}}} onPointerUp={()=>{drag.current=undefined}} onPointerCancel={()=>{drag.current=undefined}}>
      {spec.zones.map(z=><button key={z.id} aria-label={`区域 ${z.id}`} style={{position:'absolute',left:`${z.x*100}%`,top:`${z.y*100}%`,width:`${z.width*100}%`,height:`${z.height*100}%`,border:z.id===zoneId?'2px solid #2563eb':'1px dashed #64748b'}} onPointerDown={e=>{e.preventDefault();setZoneId(z.id);drag.current={x:e.clientX,y:e.clientY,zone:{...z}};e.currentTarget.parentElement!.setPointerCapture(e.pointerId)}}>{z.id}</button>)}
    </div>
    <label>区域<select aria-label="编辑区域" value={zoneId} onChange={e=>setZoneId(e.target.value)}>{spec.zones.map(z=><option key={z.id}>{z.id}</option>)}</select></label>
    {zone&&(['x','y','width','height'] as const).map(k=><label key={k}>{k}<input aria-label={`区域 ${k}`} type="number" min="0" max="1" step="0.01" value={zone[k]} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n))update({[k]:n})}}/></label>)}
    <details><summary>编辑完整声明（区域、约束、槽位、质量规则）</summary><textarea aria-label="布局声明" value={json||JSON.stringify(spec,null,2)} onChange={e=>setJson(e.target.value)}/><button onClick={()=>{try{const r=JSON.parse(json);new RecipeRegistry([r]);select(r)}catch(e){setMessage(String(e))}}}>校验并载入声明</button></details>
    <button onClick={save}>保存新版本</button><button onClick={()=>download(`${spec.id}-${spec.version}.json`,spec)}>导出布局</button><label>导入布局<input type="file" accept=".json" onChange={async e=>{try{const f=e.target.files?.[0];if(!f)return;const r=JSON.parse(await f.text());new RecipeRegistry([r]);select(r)}catch(e){setMessage(String(e))}}}/></label>
    <button onClick={()=>{try{setReport(testRecipe(spec,documentNode,slideId,assetSources));setMessage('测试完成；失败案例和诊断均保留在报告中')}catch(e){setMessage(String(e))}}}>批量测试当前页与边界样本</button>
    <label>载入回归基线<input type="file" accept=".json" onChange={async e=>{try{const f=e.target.files?.[0];if(!f)return;const b=JSON.parse(await f.text());if(!Array.isArray(b.cases)||b.cases.some((c:unknown)=>!c||typeof c!=='object'||!('draftDigest' in c)))throw new Error('无效测试报告');setBaseline(b)}catch(e){setMessage(String(e))}}}/></label>{report&&<div data-ppte-recipe-report>{baseline&&<p>与基线比较：{report.cases.filter(c=>baseline.cases.find(b=>b.name===c.name)?.draftDigest!==c.draftDigest).length} 个布局快照改变</p>}<p>{report.cases.filter(c=>c.ok).length}/{report.cases.length} 个样本通过 · {report.cases.length-report.cases.filter(c=>c.ok).length} 个需检查</p><button onClick={()=>download('recipe-test-report.json',report)}>导出测试报告与布局快照</button>{report.cases.map(c=><details key={c.name}><summary>{c.name} · {c.ok?'通过':'需检查'}</summary><p>{c.issues.map(i=>i.message).join('; ')||'无编译诊断'}</p><div className="ppte-studio-draft" style={{height:documentNode.canvas.height*.2}}><div style={{transform:'scale(.2)',transformOrigin:'top left'}} dangerouslySetInnerHTML={{__html:c.html}}/></div></details>)}</div>}
    <p role="status">{message}</p><button onClick={()=>{try{new RecipeRegistry([spec]);onApply(spec)}catch(e){setMessage(String(e))}}}>预览应用到当前页</button><button onClick={onClose}>关闭工作室</button>
  </section>
}

export function testRecipe(spec:RecipeSpec,doc:PpteDocument,slideId:string,assetSources:Record<string,string>={}){
  const recipes=new RecipeRegistry([spec]);const current=inferSlideIR(doc,slideId)
  const inputs:{name:string;ir:SlideIR}[]=[{name:'当前页',ir:current}]
  for(const length of [12,120,600])for(const locale of ['中文','English']){
    const ir=structuredClone(current);ir.blocks=ir.blocks.map(b=>['heading','paragraph','quote','source','cta'].includes(b.kind)?{...b,content:(locale==='中文'?'这是长度与字体测试。':'Text length and typography test. ').repeat(length).slice(0,length)}:b)
    inputs.push({name:`${locale} ${length} 字符`,ir})
  }
  for(let n=1;n<=6;n++){const ir=structuredClone(current);ir.blocks=[...ir.blocks.filter(b=>b.kind==='heading'),...Array.from({length:n},(_,i)=>({key:`metric-${i}`,kind:'metric' as const,importance:'secondary' as const,content:{label:`指标 ${i+1}`,value:`${i+1}0%`}}))];inputs.push({name:`${n} 个指标`,ir})}
  for(const ratio of [0.5,1,16/9,3]){const ir=structuredClone(current);ir.blocks=ir.blocks.map(b=>b.kind==='image'?{...b,preferredAspectRatio:ratio}:b);inputs.push({name:`图片比例 ${ratio}${ir.blocks.some(b=>b.kind==='image')?'':'（当前页无图片）'}`,ir})}
  return {recipe:spec,recipeDigest:canonicalHash(spec),resolvedZones:resolveRecipeZones(spec,doc.canvas),cases:inputs.map(({name,ir})=>{const draft=compileSlide(ir,{canvas:doc.canvas,theme:doc.theme,recipes,recipeId:spec.id,recipeVersion:spec.version});return {name,ok:!draft.validationIssues.some(i=>i.severity==='error'),issues:draft.validationIssues,frames:draft.elementDrafts.map(e=>e.frame),html:renderSlideHtml({...doc,slides:{...doc.slides,[slideId]:materializeSlideDraft(draft,slideId,doc.canvas)}},slideId,{assetSources}),draftDigest:canonicalHash(draft)}})}
}
