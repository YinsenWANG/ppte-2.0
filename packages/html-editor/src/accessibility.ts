/** Shell-only styles and disclosure keyboard behavior; author CSS stays in its iframe. */
export const accessibleShellCSS = `
#ppte-canvas-controls :focus-visible,#ppte-versions :focus-visible{outline:3px solid #5261d8;outline-offset:2px}
#ppte-canvas-controls summary{cursor:pointer}#ppte-canvas-controls details p{box-sizing:border-box;max-width:calc(100vw - 16px)}
#ppte-save-ui details>div{position:fixed;box-sizing:border-box;max-width:calc(100vw - 16px);max-height:calc(100dvh - 16px);overflow:auto;z-index:210}
#ppte-properties,#ppte-pages{z-index:91}#ppte-properties summary{cursor:pointer;padding:8px 0}
#ppte-feedback{z-index:110;left:16px;max-width:calc(100vw - 48px);overflow-wrap:anywhere}
#ppte-floating{max-width:calc(100vw - 32px)}#ppte-properties p,#ppte-versions p{overflow-wrap:anywhere}
#ppte-properties button{white-space:normal}#ppte-properties input{min-width:0}
#ppte-versions{box-sizing:border-box}#ppte-versions button{font:inherit;color:#20242d;background:#f0f1f5;border:1px solid #737a88;border-radius:6px}
@media(min-width:821px) and (max-width:1279px){#ppte-pages{width:170px}#ppte-properties{width:238px}}
@media(max-width:820px){#ppte-pages{width:170px}#ppte-properties{width:238px}}
@media(max-width:580px){#ppte-save-ui{padding:4px 8px!important;gap:4px}#ppte-edit-toolbar{padding:4px 8px;gap:4px}#ppte-properties,#ppte-pages{width:100%;top:auto;height:var(--drawer-height);border:1px solid #e7e9ee;border-radius:12px 12px 0 0}#ppte-properties .panel-title{position:sticky;top:0;background:white;z-index:1}#ppte-floating{display:none}}
@media(pointer:coarse),(max-width:580px){
#ppte-save-ui button,#ppte-save-ui summary,#ppte-edit-toolbar button,#ppte-workspace button,#ppte-canvas-controls button,#ppte-canvas-controls summary,#ppte-insert-menu button,#ppte-insert-menu .grid button,#ppte-versions button{min-width:44px!important;min-height:44px!important;height:auto;box-sizing:border-box}
#ppte-properties input,#ppte-properties select,#ppte-properties summary,#ppte-insert-menu input{min-height:44px}
#ppte-save-panel label{display:flex;align-items:center;min-height:44px}#ppte-save-panel input{width:24px;height:24px;margin:10px}
#ppte-insert-menu[id]{width:320px;max-width:calc(100vw - 16px)}#ppte-properties section>div{flex-wrap:wrap}
}
@media(prefers-reduced-motion:reduce){#ppte-workspace *,#ppte-save-ui *,#ppte-insert-menu *{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;

export function disclosure(details:HTMLDetailsElement, menu=false) {
 const trigger=details.querySelector('summary')!, body=details.querySelector<HTMLElement>('div,p')!;
 const name=trigger.getAttribute('aria-label')??trigger.textContent??'';
 if(!trigger.title)trigger.title=name;
 if(menu){trigger.setAttribute('aria-haspopup','menu');body.setAttribute('role','menu');body.setAttribute('aria-label',name);}
 const items=()=>Array.from(body.querySelectorAll<HTMLElement>('button:not(:disabled),input,a[href]'));
 const semantics=()=>{if(menu)for(const b of Array.from(body.querySelectorAll('button,input,a[href]')))b.setAttribute('role','menuitem');};
 semantics();new MutationObserver(semantics).observe(body,{childList:true,subtree:true});
 const place=()=>{if(!details.open)return;body.style.position='fixed';body.style.bottom='auto';body.style.margin='0';const r=trigger.getBoundingClientRect();body.style.left=Math.max(8,Math.min(r.left,innerWidth-body.offsetWidth-8))+'px';body.style.right='auto';if(details.id==='ppte-save-panel') {
  // Both narrow-screen rows remain reachable while save details are open.
  const top=(details.closest('nav')?.getBoundingClientRect().bottom??r.bottom)+4;
  body.style.top=top+'px';body.style.maxHeight=Math.max(0,innerHeight-top-8)+'px';
 } else body.style.top=Math.max(8,Math.min(r.bottom+4,innerHeight-body.offsetHeight-8))+'px';};
 const close=(focus=true)=>{details.open=false;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus();};
 details.addEventListener('toggle',()=>{trigger.setAttribute('aria-expanded',String(details.open));semantics();place();});
 trigger.setAttribute('aria-expanded','false');
 details.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();return;}if(e.key==='Tab'&&details.open){close();return;}if(!menu||!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;e.preventDefault();details.open=true;const all=items(),at=all.indexOf(document.activeElement as HTMLElement);all[e.key==='Home'?0:e.key==='End'?all.length-1:(at+(e.key==='ArrowUp'?-1:1)+all.length)%all.length]?.focus();place();});
 if(menu)body.addEventListener('click',e=>{if((e.target as Element).closest('button'))close();},true);
 document.addEventListener('pointerdown',e=>{if(details.open&&!details.contains(e.target as Node))close(false);});
 const frame=document.querySelector<HTMLIFrameElement>('#ppte-frame');
 const attach=()=>frame?.contentDocument?.addEventListener('pointerdown',()=>{if(details.open)close(false);});
 frame?.addEventListener('load',attach);attach();
 window.addEventListener('resize',place);
 return {close};
}
