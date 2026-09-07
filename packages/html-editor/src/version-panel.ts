import { frameContent } from '../../html-document/src/content.js';
import type { Versions } from './versions.js';
import type { SaveController } from './save.js';
export function versionPanel(versions:Versions, getSave:()=>SaveController, active:()=>boolean, mount:(html:string)=>Promise<void>, download:()=>void){
 const dialog=document.createElement('dialog');dialog.id='ppte-versions';dialog.dataset.ppteTransient='';dialog.setAttribute('aria-label','版本历史');
 dialog.style.cssText='width:800px;max-width:90vw;max-height:85vh;overflow:auto;border:1px solid #e7e9ee;border-radius:16px;padding:24px;color:#20242d;background:white;font:14px system-ui';
 const heading=document.createElement('h2');heading.textContent='版本历史';const notice=document.createElement('p');notice.setAttribute('role','alert');
 const actions=document.createElement('div'),list=document.createElement('div'),preview=document.createElement('div');
 dialog.append(heading,notice,actions,list,preview);document.body.append(dialog);
 let opener:HTMLElement|undefined;const changed=new Map<string,number>(),stored=new Set<string>();let exported=-1;
 const button=(parent:HTMLElement,label:string,fn:()=>unknown)=>{const b=document.createElement('button');b.textContent=label;b.style.cssText='margin:4px;padding:8px 12px';b.onclick=()=>void run(fn);parent.append(b);return b;};
 const run=async(fn:()=>unknown)=>{try{await fn();}catch(e){notice.textContent=String(e);}};
 const guard=()=>{const c=getSave();if(!active())throw Error('请先进入编辑模式管理版本');if(c.busy||c.composing)throw Error('请等待保存或完整输入事务结束');return c;};
 const dirty=(id?:string)=>{getSave().change();if(id)changed.set(id,getSave().revision);};
 const render=()=>{
  list.replaceChildren();actions.replaceChildren();preview.replaceChildren();
  button(actions,'关闭版本历史',()=>dialog.close());button(actions,'下载不含历史的文件',download);
  notice.textContent=versions.warning;
  let index;try{index=versions.index;}catch(e){notice.textContent=versions.warning;return;}
  const usage=document.createElement('p');usage.textContent=`历史占用 ${(versions.usage(getSave().snapshotContent())/1048576).toFixed(2)} MiB / ${(index.maxBytes/1048576).toFixed(2)} MiB；仅自动清理最旧的未命名自动版本，最多 ${index.maxAuto} 个。`;
  actions.append(usage);
  if(active()){
   button(actions,'保存命名版本',()=>{const c=guard(),name=prompt('版本名称（最多 200 字）');if(!name?.trim())return;const v=versions.add(c.snapshotContent(),'manual',name.trim());dirty(v?.id);render();});
   button(actions,'调整历史上限',()=>{const c=guard(),count=prompt('未命名自动版本上限（0–200）',String(index.maxAuto));if(count===null)return;const size=prompt('历史容量上限（MiB，最大 128）',String(index.maxBytes/1048576));if(size===null)return;if(!confirm('调低上限可能永久清理最旧的未命名自动版本；命名版本不会自动删除。继续？'))return;versions.limits(Number(count),Math.floor(Number(size)*1048576),c.snapshotContent());dirty();render();});
  }
  for(const v of [...index.versions].reverse()){
   const row=document.createElement('section');row.dataset.versionId=v.id;row.style.cssText='border-top:1px solid #e7e9ee;padding:12px 0';
   const label=document.createElement('p'),rev=changed.get(v.id);
   const saved=rev===undefined&&stored.has(v.id)||rev!==undefined&&(getSave().confirmedFileRevision??-1)>=rev;
   const downloaded=rev!==undefined&&exported>=rev;
   label.textContent=`${v.name||'未命名版本'} · ${new Date(v.time).toLocaleString()} · ${{auto:'自动',manual:'手动','before-restore':'恢复前'}[v.kind]}${v.restoredFrom?' · 已记录恢复来源':''} · ${saved?'已随打开文件载入 / 已写入文件':downloaded?'已打包下载，请确认落盘':'尚未写入文件'}`;row.append(label);
   button(row,'预览',()=>{const html=versions.preview(v.id);preview.replaceChildren();const f=document.createElement('iframe');f.title='版本预览（只读）';f.setAttribute('sandbox','');f.setAttribute('referrerpolicy','no-referrer');f.style.cssText='width:100%;height:360px;border:1px solid #e7e9ee';f.srcdoc=frameContent(html);preview.append(f);notice.textContent='只读预览；当前内容和未保存状态保持不变。';});
   if(active()){
    button(row,'命名',()=>{guard();const name=prompt('版本名称（最多 200 字）',v.name);if(name===null)return;versions.rename(v.id,name.trim());dirty(v.id);render();});
    button(row,'恢复到此版本',async()=>{const c=guard();if(!confirm(`恢复到 ${new Date(v.time).toLocaleString()} 的“${v.name||'未命名版本'}”？当前内容会先保留一个版本，恢复结果尚需保存。`))return;
     const html=versions.restore(v.id,c.snapshotContent());await mount(html);dirty();for(const item of versions.index.versions)if(item.kind==='before-restore'&&!changed.has(item.id))changed.set(item.id,c.revision);render();notice.textContent='已恢复；恢复前内容已保留，尚未写入文件。';});
    button(row,'删除版本',()=>{guard();if(!confirm('永久删除 1 个历史版本？写入文件后跨会话不可恢复，当前内容保持不变。'))return;versions.remove(v.id);dirty();render();});
   }
   list.append(row);
  }
 };
 dialog.addEventListener('close',()=>{preview.replaceChildren();opener?.focus();});
 return {loaded(){changed.clear();stored.clear();exported=-1;try{for(const v of versions.index.versions)stored.add(v.id);}catch{}},exported(revision:number){exported=revision;},open(){opener=document.activeElement as HTMLElement;try{render();}catch(e){notice.textContent=String(e);}dialog.showModal();},record(id:string){if(!stored.has(id)&&!changed.has(id))changed.set(id,getSave().revision);},mark(id:string){changed.set(id,getSave().revision);}};
}
