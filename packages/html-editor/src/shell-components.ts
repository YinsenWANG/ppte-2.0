/** Product shell components. Every selector is scoped outside the author iframe. */
const paths:Record<string,string>={
 '撤销':'M7 3 2 8l5 5M2 8h8a4 4 0 0 1 0 8', '重做':'m11 3 5 5-5 5m5-5H8a4 4 0 0 0 0 8',
 '更多':'M3 9h.01M9 9h.01M15 9h.01', '帮助':'M9 16A7 7 0 1 0 9 2a7 7 0 0 0 0 14M7 6a2 2 0 0 1 4 0c0 2-2 2-2 4M9 13h.01',
 '页面导航':'M2 3h14v12H2ZM6 3v12','上一页':'m11 4-5 5 5 5','下一页':'m7 4 5 5-5 5','关闭属性':'m4 4 10 10M14 4 4 14',
 '缩小画布':'M3 9h12','放大画布':'M3 9h12M9 3v12','重置缩放':'M6 2H2v4M12 2h4v4M2 12v4h4M16 12v4h-4',
 '字号 −':'M3 9h12','字号 ＋':'M3 9h12M9 3v12','粗体':'M5 2h5a3 3 0 0 1 0 6H5V2Zm0 6h6a4 4 0 0 1 0 8H5V8Z','斜体':'M8 3h7M3 15h7M12 3 6 15',
 '左对齐':'M3 3h12M3 7h8M3 11h12M3 15h8','居中':'M3 3h12M5 7h8M3 11h12M5 15h8','右对齐':'M3 3h12M7 7h8M3 11h12M7 15h8',
 '向左对齐':'M3 3v12M6 5h9M6 9h6M6 13h9','水平居中':'M9 2v14M3 5h12M5 9h8M3 13h12','向右对齐':'M15 3v12M3 5h9M6 9h6M3 13h9','顶部对齐':'M3 3h12M5 6v9M9 6v6M13 6v9','垂直居中':'M2 9h14M5 3v12M9 5v8M13 3v12','底部对齐':'M3 15h12M5 3v9M9 6v6M13 3v9',
 '下载更新后的文件':'M9 2v9m-4-4 4 4 4-4M3 12v4h12v-4'
};
export function icon(label:string){const key=['展开缩略图','折叠缩略图'].includes(label)?'页面导航':label;return `<svg aria-hidden="true" viewBox="0 0 18 18"><path d="${paths[key]??paths['更多']}"/></svg>`;}
export function iconButton(b:HTMLButtonElement,label:string){if(!paths[label]&&!['展开缩略图','折叠缩略图'].includes(label))return;b.innerHTML=icon(label);b.setAttribute('aria-label',label);b.title=label;b.classList.add('icon-button');}
export function group(parent:HTMLElement,label:string){const row=document.createElement('div');row.className='control-row';row.setAttribute('role','group');row.setAttribute('aria-label',label);parent.append(row);return row;}
export function selectField(parent:HTMLElement,label:string,value:string,options:string[][],action:(v:string)=>void){const l=document.createElement('label');l.textContent=label;const select=document.createElement('select');select.setAttribute('aria-label',label);if(!options.some(([v])=>v===value))options=[ [value, label==='字体'?'作者字体 · '+value.split(',')[0]:'作者设置 · '+value],...options ];for(const [v,title] of options){const o=document.createElement('option');o.value=v;o.textContent=title;select.append(o);}select.value=value;select.onchange=()=>{select.blur();action(select.value);};l.append(select);parent.append(l);return select;}
export const shellCSS=`
body{background:#f3f4f6!important}
#ppte-save-ui,#ppte-workspace,#ppte-edit-toolbar,#ppte-canvas-controls{font:13px/1.5 system-ui;color:#20242d;box-sizing:border-box}
:is(#ppte-save-ui,#ppte-workspace,#ppte-edit-toolbar,#ppte-canvas-controls) button{font:inherit;color:inherit;background:#fff;border:1px solid #e7e9ee;border-radius:6px;min-height:32px;padding:4px 8px;cursor:pointer}
:is(#ppte-save-ui,#ppte-workspace,#ppte-edit-toolbar,#ppte-canvas-controls) button:hover:not(:disabled){background:#f0f1f5}
:is(#ppte-save-ui,#ppte-workspace,#ppte-edit-toolbar,#ppte-canvas-controls) button:disabled{color:#737a88;cursor:not-allowed;background:#f3f4f6}
:is(#ppte-save-ui,#ppte-workspace,#ppte-edit-toolbar,#ppte-canvas-controls) :focus-visible{outline:3px solid #5261d8;outline-offset:2px}
:is(#ppte-save-ui,#ppte-workspace,#ppte-edit-toolbar,#ppte-canvas-controls) svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round;vertical-align:middle}
:is(#ppte-save-ui,#ppte-workspace,#ppte-edit-toolbar,#ppte-canvas-controls) .icon-button{width:32px;flex:none;padding:4px}
:is(#ppte-save-ui,#ppte-workspace) button[aria-pressed=true]{background:#eef0ff;color:#5261d8}
#ppte-save-ui{color:#20242d!important;inset:0 0 auto!important;height:56px;padding:0 20px!important;background:#fff!important;border-radius:0!important;border-bottom:1px solid #e7e9ee;flex-wrap:nowrap;gap:8px!important}
#ppte-save-ui strong{font-size:14px;min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ppte-save-ui button{border:0;flex-shrink:0}#ppte-save-ui button:disabled{color:#737a88;cursor:not-allowed;background:#f3f4f6}#ppte-save-ui .primary{background:#5261d8;color:#fff;padding:6px 16px}#ppte-save-ui .primary:hover{background:#424fb8}
#ppte-save-ui[data-mode=read] .save-action,#ppte-save-ui[data-mode=read] #ppte-save-panel{display:none}
#ppte-save-ui .modes{display:flex;gap:2px;border:1px solid #e7e9ee;border-radius:8px;padding:2px}
#ppte-save-ui summary{cursor:pointer;list-style:none;padding:6px;border-radius:6px;white-space:nowrap}
#ppte-save-ui details>div{width:300px;background:#fff;border:1px solid #e7e9ee;border-radius:12px;box-shadow:0 8px 32px #20242d20;padding:16px;display:grid;gap:8px}
#ppte-save-ui [role=status]{display:block;width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
#ppte-save-ui[data-pristine] [role=status]{display:none}#ppte-save-ui[data-pristine] #ppte-save-panel summary:after{content:'保存状态'}
#ppte-save-panel .save-detail{white-space:normal;overflow-wrap:anywhere;margin:0;color:#20242d}
#ppte-edit-toolbar{position:fixed;left:0;right:0;top:56px;height:46px;background:#fff;border-bottom:1px solid #e7e9ee;display:flex;align-items:center;gap:8px;padding:0 16px;z-index:90}
#ppte-edit-toolbar button{border:0}#ppte-edit-toolbar[hidden]{display:none}
#ppte-workspace{display:none}#ppte-workspace[data-open],#ppte-workspace[data-reading-nav]{display:block}
#ppte-pages{position:fixed;left:0;top:var(--top);bottom:36px;width:204px;background:#fafbfc;display:flex;flex-direction:column;border-right:1px solid #e7e9ee;box-sizing:border-box}
#ppte-page-list{flex:1;min-height:0;overflow:auto;padding:16px 12px}#ppte-page-footer{flex:none;padding:8px 12px;border-top:1px solid #e7e9ee}#ppte-page-footer button{width:100%}
#ppte-workspace[data-reading-nav] #ppte-page-list .thumb-row{padding-right:0}
#ppte-page-list .thumb-row{position:relative;margin-bottom:12px;padding-right:20px}#ppte-page-list button[aria-current]{display:block;width:100%;padding:4px;text-align:left;font-size:11px;overflow:hidden}
#ppte-pages button[aria-current=true]{border:2px solid #5261d8;background:#eef0ff}
#ppte-pages .preview{display:block;height:80px;overflow:hidden;pointer-events:none;position:relative;background:#fff}
#ppte-page-list .page-actions{position:absolute;top:0;right:0}#ppte-page-list summary{cursor:pointer;list-style:none;width:20px;height:32px;display:grid;place-items:center}
#ppte-page-list .page-actions>div{z-index:210;background:white;border:1px solid #e7e9ee;box-shadow:0 8px 24px #20242d20;padding:8px;border-radius:12px;display:grid;gap:4px;width:140px}
#ppte-workspace[data-reading-nav] .page-actions,#ppte-workspace[data-reading-nav] #ppte-page-footer,#ppte-workspace[data-reading-nav]>:not(#ppte-pages){display:none}
#ppte-properties{position:fixed;right:0;top:var(--top);bottom:36px;width:264px;background:#fff;padding:0 16px;overflow:auto;box-sizing:border-box;border-left:1px solid #e7e9ee}
#ppte-properties .panel-title{position:sticky;top:0;background:#fff;z-index:1}
#ppte-properties h3{font-size:14px;margin:0;flex:1}#ppte-properties .panel-title{height:54px}
#ppte-properties section{border-top:1px solid #e7e9ee;padding:16px 0;display:grid;gap:12px}
#ppte-properties details{border-top:1px solid #e7e9ee;padding:12px 0}#ppte-properties details[open]{display:grid;gap:12px}
#ppte-properties label{display:grid;gap:4px;font-size:12px;color:#525a68;min-width:0;flex:1}
#ppte-properties input,#ppte-properties select{font:13px system-ui;border:1px solid #e7e9ee;border-radius:6px;height:32px;padding:4px 8px;color:#20242d;background:#fff;width:100%;box-sizing:border-box}
#ppte-properties .control-row,#ppte-canvas-controls .control-row{display:flex;align-items:center;gap:4px}#ppte-properties .control-row{flex-wrap:wrap}
#ppte-properties .color-field input{width:40px;padding:2px;cursor:pointer}#ppte-properties .color-field label{flex:none}#ppte-properties .color-field span{font-size:12px;margin-top:18px}
#ppte-properties .hint{color:#525a68;font-size:12px;margin:0}
#ppte-pages[hidden],#ppte-properties[hidden]{display:none}
#ppte-floating{position:fixed;z-index:101;display:flex;gap:4px;padding:8px;background:white;border:1px solid #e7e9ee;border-radius:8px}#ppte-floating:empty{display:none}
#ppte-feedback{position:fixed;bottom:64px;background:white;border:1px solid #e7e9ee;border-radius:8px;padding:8px}#ppte-feedback:empty{display:none}
#ppte-canvas-controls{position:fixed;left:0;bottom:0;width:100%;height:36px;padding:0 12px;border-top:1px solid #e7e9ee;background:white;display:flex;align-items:center;gap:8px;font-size:12px;z-index:90}
#ppte-canvas-controls button{border:0;min-height:30px}#ppte-canvas-controls .zoom-group{margin-left:auto}#ppte-canvas-controls summary{list-style:none;padding:4px}
#ppte-canvas-controls .zoom-options>div{position:fixed;display:flex;padding:8px;background:white;border:1px solid #e7e9ee;border-radius:8px}#ppte-canvas-controls .zoom-options:not([open])>div{display:none}
#ppte-canvas-controls details p{position:absolute;bottom:36px;right:8px;width:300px;padding:16px;background:white;border:1px solid #e7e9ee}
@media(max-width:580px){#ppte-save-ui{height:100px;display:grid!important;grid-template-columns:minmax(0,1fr) auto auto;padding:4px 8px!important;gap:2px!important}#ppte-save-ui strong{grid-column:1/3}#ppte-save-ui[data-mode=read] .save-action,#ppte-save-ui[data-mode=read] #ppte-save-panel{display:none}
#ppte-save-ui .modes{grid-row:2;grid-column:1}#ppte-save-panel{grid-row:1;grid-column:2/4}#ppte-save-ui [role=status]{width:120px}#ppte-save-ui .primary{grid-row:2;grid-column:2}#ppte-save-ui>button[aria-label='导出为 PDF']{grid-row:2;grid-column:3;padding:4px 8px}#ppte-save-ui strong{grid-column:1}#ppte-save-ui[data-mode=read] strong{grid-column:1/-1}#ppte-save-ui .save-action{grid-row:1;grid-column:2}#ppte-save-ui[data-mode=edit] #ppte-save-panel{grid-column:3}#ppte-edit-toolbar{height:52px}#ppte-canvas-controls{height:48px;padding:0 4px;gap:0}#ppte-canvas-controls .control-row{gap:0}#ppte-canvas-controls .zoom-group{gap:0}#ppte-canvas-controls .zoom-group span{max-width:48px;line-height:1.2}#ppte-page-list .thumb-row{padding-right:44px}#ppte-page-list summary{width:44px}}
`;
