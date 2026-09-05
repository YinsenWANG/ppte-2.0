import {useState,type ReactElement} from 'react'
import {compareDocuments,compareTwoWayDocuments,buildAcceptTransaction,createPatch} from '../../reviewer/src/index.js'
import {encodePatch} from '../../patch-format/src/codec.js'
import type {PpteDocument,Transaction,CompareResult} from '../../schema/src/index.js'
export interface ReviewProject {document:PpteDocument;assetBytes:Record<string,Uint8Array>;fontBytes:Record<string,Uint8Array>}
export function ReviewPanel({local,resources,read,onPreview,onClose}:{local:PpteDocument;resources:Pick<ReviewProject,'assetBytes'|'fontBytes'>;read:(file:File)=>Promise<ReviewProject>;onPreview:(tx:Transaction,resources:ReviewProject)=>void;onClose:()=>void}):ReactElement {
  const [base,setBase]=useState<ReviewProject>();const [revised,setRevised]=useState<ReviewProject>()
  const [decisions,setDecisions]=useState<Record<string,'local'|'revised'>>({});const [error,setError]=useState('')
  let comparison:CompareResult|undefined;let message=error
  try {if(revised){if(revised.document.documentId!==local.documentId||base&&base.document.documentId!==local.documentId)throw new Error('请选择同一项目的原始版本和修订副本');comparison=base?compareDocuments(base.document,local,revised.document):compareTwoWayDocuments(local,revised.document)}}catch(e){message=String(e)}
  const choose=async(file:File|undefined,kind:'base'|'revised')=>{if(!file)return;try{const project=await read(file);kind==='base'?setBase(project):setRevised(project);setDecisions({});setError('')}catch(e){setError(String(e))}}
  const units=comparison?.units.filter(u=>!['unchanged','local-only','same-change'].includes(u.status))??[]
  function preview(){try{if(!comparison||!revised)return;const tx=buildAcceptTransaction(comparison,{unitIds:Object.keys(decisions).filter(k=>decisions[k]==='revised'),resolutions:decisions,includeDeleted:true});onPreview(tx,revised);setError('')}catch(e){setError(String(e))}}
  function patch(){try{if(!base)throw new Error('导出补丁需要选择共同原始版本');const bytes=encodePatch(createPatch(base.document,local,resources));const a=document.createElement('a');const url=URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer]));a.href=url;a.download='changes.ppte.patch';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){setError(String(e))}}
  return <section className="ppte-review-panel" data-ppte-review><h3>比较修订副本</h3><p>选择共同原始版本进行三方比较。没有原始版本时，所有修改均需逐项选择。</p>
    <label>共同原始版本<input data-ppte-review-base type="file" accept=".ppte" onChange={e=>void choose(e.target.files?.[0],'base')}/></label>
    <label>修订副本<input data-ppte-review-revised type="file" accept=".ppte" onChange={e=>void choose(e.target.files?.[0],'revised')}/></label>
    {comparison&&<p>{comparison.twoWay?'两方比较 · 无共同原始版本':'三方比较'} · {units.length} 项 · {comparison.conflicts.length} 个冲突</p>}
    {units.map(u=><fieldset key={u.unitId}><legend>{u.semanticKey??u.elementId??u.slideId??u.kind} · {u.field} {['conflict','ambiguous'].includes(u.status)?'（冲突）':''}</legend><p>{u.path}</p><details><summary>比较内容</summary><div>当前<pre>{JSON.stringify(u.localValue,null,2)}</pre></div><div>修订<pre>{JSON.stringify(u.revisedValue,null,2)}</pre></div></details>{u.capabilityGap?<p>{u.capabilityGap.message}</p>:<select aria-label={`处理 ${u.path}`} value={decisions[u.unitId]??''} onChange={e=>setDecisions({...decisions,[u.unitId]:e.target.value as 'local'|'revised'})}><option value="">请选择</option><option value="local">保留当前</option><option value="revised">接受修订</option></select>}</fieldset>)}
    <p role="status">{message||comparison?.issues.map(i=>i.message).join('; ')}</p><button onClick={preview} disabled={!units.length}>预览选中修订</button><button onClick={patch} disabled={!base}>导出当前修改补丁</button><button onClick={onClose}>关闭比较</button>
  </section>
}
