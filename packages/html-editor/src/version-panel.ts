import { frameContent } from '../../html-document/src/content.js';
import type { Versions } from './versions.js';
import type { SaveController } from './save.js';

/** Product inputs only. File permission pickers remain the SaveController's native flow. */
export function versionPanel(versions:Versions, getSave:()=>SaveController, active:()=>boolean, mount:(html:string)=>Promise<void>, download:()=>void){
 const dialog=document.createElement('dialog');dialog.id='ppte-versions';dialog.dataset.ppteTransient='';dialog.setAttribute('aria-label','版本历史');
 const style=document.createElement('style');style.dataset.ppteTransient='';style.textContent=`
 #ppte-versions,#ppte-version-form{box-sizing:border-box;width:800px;max-width:calc(100vw - 24px);max-height:85dvh;overflow:auto;border:1px solid #e7e9ee;border-radius:16px;padding:24px;color:#20242d;background:#fff;font:14px system-ui;box-shadow:0 16px 48px #20242d26}
 #ppte-version-form{width:480px}#ppte-versions::backdrop,#ppte-version-form::backdrop{background:#20242d45}
 :is(#ppte-versions,#ppte-version-form) h2{font-size:18px;margin:0 0 16px}
 :is(#ppte-versions,#ppte-version-form) p{line-height:1.6;overflow-wrap:anywhere}
 :is(#ppte-versions,#ppte-version-form) button,:is(#ppte-versions,#ppte-version-form) summary{box-sizing:border-box;min-height:34px;padding:6px 12px;border:1px solid #e7e9ee;border-radius:8px;background:#fff;color:#20242d;font:inherit;cursor:pointer}
 :is(#ppte-versions,#ppte-version-form) button:hover{background:#f0f1f5}
 :is(#ppte-versions,#ppte-version-form) .primary{background:#5261d8;color:white;border-color:#5261d8}
 :is(#ppte-versions,#ppte-version-form) .danger{color:#ad2636}
 :is(#ppte-versions,#ppte-version-form) :focus-visible{outline:2px solid #5261d8;outline-offset:2px}
 :is(#ppte-versions,#ppte-version-form) .actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
 #ppte-versions section{border-top:1px solid #e7e9ee;padding:16px 0}#ppte-versions details{display:inline-block}#ppte-versions details .actions{margin-top:8px}
 #ppte-version-form label{display:grid;gap:8px;margin:16px 0}#ppte-version-form input{box-sizing:border-box;width:100%;min-height:36px;padding:8px;border:1px solid #b9bfcc;border-radius:8px;font:inherit;color:inherit;background:white}
 #ppte-version-form [aria-invalid=true]{border-color:#ad2636}#ppte-version-form [role=alert]{color:#ad2636}
 #ppte-version-form .actions{justify-content:flex-end;margin-top:20px}
 @media(max-width:580px){#ppte-versions,#ppte-version-form{padding:16px}:is(#ppte-versions,#ppte-version-form) button,:is(#ppte-versions,#ppte-version-form) summary,#ppte-version-form input{min-height:44px}}
 `;
 const heading=document.createElement('h2');heading.textContent='版本历史';
 const notice=document.createElement('p');notice.setAttribute('role','alert');
 const pending=document.createElement('p');pending.id='ppte-version-pending';pending.setAttribute('aria-live','polite');
 const actions=document.createElement('div'),list=document.createElement('div'),preview=document.createElement('div');actions.className='actions';
 dialog.append(heading,notice,pending,actions,list,preview);document.head.append(style);document.body.append(dialog);
 let opener:HTMLElement|undefined;const changed=new Map<string,number>(),stored=new Set<string>();let exported=-1;
 const button=(parent:HTMLElement,label:string,fn:()=>unknown)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>void run(fn);parent.append(b);return b;};
 const run=async(fn:()=>unknown)=>{try{await fn();}catch(e){notice.textContent=String(e);}};
 const guard=()=>{const c=getSave();if(!active())throw Error('请先进入编辑模式管理版本');if(c.busy||c.composing)throw Error('请等待保存或完整输入事务结束');return c;};
 const dirty=(id?:string)=>{getSave().change();if(id)changed.set(id,getSave().revision);};
 type Field={label:string;value:string;type?:string;validate:(value:string)=>string};
 // Keep the opener node until close, then resolve its replacement after list rendering.
 const form=(title:string,context:string,fields:Field[],submitLabel:string,apply:(values:string[])=>unknown,danger=false)=>{
  guard();const trigger=document.activeElement as HTMLElement;
  const rowId=trigger.closest<HTMLElement>('[data-version-id]')?.dataset.versionId,triggerText=trigger.textContent;
  const modal=document.createElement('dialog');modal.id='ppte-version-form';modal.dataset.ppteTransient='';modal.setAttribute('aria-labelledby','ppte-version-form-title');modal.setAttribute('aria-describedby','ppte-version-form-context');
  const f=document.createElement('form');f.noValidate=true;
  const titleNode=document.createElement('h2');titleNode.id='ppte-version-form-title';titleNode.textContent=title;
  const description=document.createElement('p');description.id='ppte-version-form-context';description.textContent=context;
  const error=document.createElement('p');error.id='ppte-version-form-error';error.setAttribute('role','alert');
  f.append(titleNode,description);const inputs=fields.map((field,i)=>{const label=document.createElement('label');label.textContent=field.label;const input=document.createElement('input');input.id=`ppte-version-field-${i}`;input.type=field.type||'text';input.value=field.value;input.setAttribute('aria-describedby',error.id);if(field.type==='number')input.step='any';label.append(input);f.append(label);return input;});
  const footer=document.createElement('div');footer.className='actions';const cancel=button(footer,'取消',()=>modal.close());const submit=button(footer,submitLabel,()=>{});submit.type='submit';submit.className=danger?'danger':'primary';submit.onclick=null;
  f.append(error,footer);modal.append(f);document.body.append(modal);
  let busy=false;
  f.onsubmit=async e=>{e.preventDefault();if(busy)return;error.textContent='';let invalid=false;inputs.forEach((input,i)=>{const message=fields[i].validate(input.value);input.setAttribute('aria-invalid',String(!!message));if(message){error.textContent+=(error.textContent?'；':'')+message;if(!invalid)input.focus();invalid=true;}});if(invalid)return;
   busy=true;submit.disabled=true;cancel.disabled=true;
   try{guard();await apply(inputs.map(input=>input.value));modal.close();}catch(e){error.textContent=String(e);}finally{busy=false;submit.disabled=false;cancel.disabled=false;}
  };
  modal.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  modal.addEventListener('close',()=>{modal.remove();if(trigger.isConnected){trigger.focus();return;}const scope=rowId?Array.from(list.querySelectorAll<HTMLElement>('section')).find(n=>n.dataset.versionId===rowId):actions;const replacement=Array.from(scope?.querySelectorAll('button')||[]).find(n=>n.textContent===triggerText);if(replacement){const details=replacement.closest('details');if(details)details.open=true;replacement.focus();}else actions.querySelector('button')?.focus();});
  modal.showModal();(inputs[0]||cancel).focus();inputs[0]?.select();
 };
 const naming=(name:string,apply:(name:string)=>unknown)=>form(name?'命名版本':'保存命名版本','为当前版本填写 1–200 字名称。创建或更名后尚需保存到文件。',[{label:'版本名称',value:name,validate:value=>!value.trim()||value.trim().length>200?'请输入 1–200 字名称':''}],'保存名称',values=>apply(values[0].trim()));
 const render=()=>{
  list.replaceChildren();actions.replaceChildren();preview.replaceChildren();
  button(actions,'关闭版本历史',()=>dialog.close());button(actions,'下载不含历史的文件',download);
  notice.textContent=versions.warning;pending.textContent=getSave().dirty?'有修改尚未写入文件；版本创建、命名、容量调整、恢复和删除均需保存。':'';
  let index;try{index=versions.index;}catch{notice.textContent=versions.warning;return;}
  const usage=document.createElement('p');usage.textContent=`历史占用 ${(versions.usage(getSave().snapshotContent())/1048576).toFixed(2)} MiB / ${(index.maxBytes/1048576).toFixed(2)} MiB；仅自动清理最旧的未命名自动版本，最多 ${index.maxAuto} 个。`;
  list.append(usage);
  if(active()){
   button(actions,'保存命名版本',()=>naming('',name=>{const c=guard();const v=versions.add(c.snapshotContent(),'manual',name);dirty(v?.id);render();})).className='primary';
   button(actions,'调整历史上限',()=>form('历史容量管理',`${usage.textContent} 调低上限可能永久清理最旧的未命名自动版本；命名版本不会自动删除，当前内容保持不变。确认后尚需写入文件。`,[
    {label:'未命名自动版本上限（0–200）',value:String(index.maxAuto),type:'number',validate:value=>value.trim()!==''&&Number.isInteger(Number(value))&&Number(value)>=0&&Number(value)<=200?'':'自动版本数须为 0–200 的整数'},
    {label:'历史容量上限（MiB，1 KiB–128 MiB）',value:String(index.maxBytes/1048576),type:'number',validate:value=>value.trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=1/1024&&Number(value)<=128?'':'历史容量须为 1 KiB–128 MiB'}
   ],'确认调整上限',values=>{versions.limits(Number(values[0]),Math.floor(Number(values[1])*1048576),guard().snapshotContent());dirty();render();}));
  }
  for(const v of [...index.versions].reverse()){
   const row=document.createElement('section');row.dataset.versionId=v.id;
   const label=document.createElement('p'),rev=changed.get(v.id);
   const saved=rev===undefined&&stored.has(v.id)||rev!==undefined&&(getSave().confirmedFileRevision??-1)>=rev;
   const downloaded=rev!==undefined&&exported>=rev;
   label.textContent=`${v.name||'未命名版本'} · ${new Date(v.time).toLocaleString()} · ${{auto:'自动',manual:'手动','before-restore':'恢复前'}[v.kind]}${v.restoredFrom?' · 已记录恢复来源':''} · ${saved?'已随打开文件载入 / 已写入文件':downloaded?'已打包下载，请确认落盘':'尚未写入文件'}`;row.append(label);
   const rowActions=document.createElement('div');rowActions.className='actions';row.append(rowActions);
   button(rowActions,'预览',()=>{const html=versions.preview(v.id);preview.replaceChildren();const f=document.createElement('iframe');f.title='版本预览（只读）';f.setAttribute('sandbox','');f.setAttribute('referrerpolicy','no-referrer');f.style.cssText='width:100%;height:360px;border:1px solid #e7e9ee';f.srcdoc=frameContent(html);preview.append(f);notice.textContent='只读预览；当前内容和未保存状态保持不变。';});
   if(active()){
    const details=document.createElement('details'),summary=document.createElement('summary'),management=document.createElement('div');summary.textContent='管理版本';management.className='actions';details.append(summary,management);rowActions.append(details);
    button(management,'命名',()=>naming(v.name,name=>{guard();versions.rename(v.id,name);dirty(v.id);render();}));
    button(management,'恢复到此版本',()=>form('恢复版本',`恢复到 ${new Date(v.time).toLocaleString()} 的“${v.name||'未命名版本'}”？当前内容会先保留一个版本，已有历史继续保留。恢复结果尚需保存。`,[],'确认恢复',async()=>{
     const c=guard(),html=versions.restore(v.id,c.snapshotContent());await mount(html);dirty();for(const item of versions.index.versions)if(item.kind==='before-restore'&&!changed.has(item.id))changed.set(item.id,c.revision);render();notice.textContent='已恢复；恢复前内容已保留，尚未写入文件。';}));
    button(management,'删除版本',()=>form('删除版本',`永久删除 1 个历史版本：“${v.name||'未命名版本'}”（${new Date(v.time).toLocaleString()}）？写入文件后跨会话不可恢复，当前内容和其他历史版本保持不变。`,[],'确认删除',()=>{guard();versions.remove(v.id);dirty();render();},true));
   }
   list.append(row);
  }
 };
 dialog.addEventListener('close',()=>{preview.replaceChildren();opener?.focus();});
 return {loaded(){changed.clear();stored.clear();exported=-1;try{for(const v of versions.index.versions)stored.add(v.id);}catch{}},exported(revision:number){exported=revision;},open(){opener=document.activeElement as HTMLElement;try{render();}catch(e){notice.textContent=String(e);}dialog.showModal();},record(id:string){if(!stored.has(id)&&!changed.has(id))changed.set(id,getSave().revision);},mark(id:string){changed.set(id,getSave().revision);}};
}
