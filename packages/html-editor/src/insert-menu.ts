/** Product menu lives outside the author iframe; no styles or model enter slides. */
export function insertMenu(toolbar: HTMLElement, insert: (kind: 'text'|'rect'|'ellipse'|'line'|'table', rows?:number, cols?:number)=>void, image:()=>void) {
    const trigger = document.createElement('button'); trigger.type='button'; trigger.textContent='插入'; trigger.title='插入对象';
    trigger.setAttribute('aria-haspopup','menu'); trigger.setAttribute('aria-expanded','false'); toolbar.append(trigger);
    const menu = document.createElement('div'); menu.id='ppte-insert-menu'; menu.dataset.ppteTransient=''; menu.hidden=true;
    menu.setAttribute('role','menu'); menu.setAttribute('aria-label','插入对象'); document.body.append(menu); trigger.setAttribute('aria-controls',menu.id);
    const css=document.createElement('style'); css.dataset.ppteTransient=''; css.textContent=`
#ppte-insert-menu{position:fixed;z-index:200;background:white;color:#20242d;border:1px solid #e7e9ee;border-radius:12px;box-shadow:0 8px 24px #20242d30;padding:12px;width:264px;box-sizing:border-box;font:13px system-ui;max-height:calc(100vh - 24px);overflow:auto}
#ppte-insert-menu[hidden]{display:none}#ppte-insert-menu button{font:inherit;color:inherit;background:white;border:0;border-radius:6px;min-height:32px;padding:6px;display:flex;align-items:center;gap:8px;width:100%;cursor:pointer}
#ppte-insert-menu button:hover{background:#eef0ff}#ppte-insert-menu :focus-visible,#ppte-edit-toolbar :focus-visible{outline:3px solid #5261d8;outline-offset:2px}
#ppte-insert-menu svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.65;flex-shrink:0}#ppte-insert-menu .grid{display:grid;grid-template-columns:repeat(6,1fr);gap:4px}#ppte-insert-menu .grid button{border:1px solid #737a88;min-height:28px;padding:0}#ppte-insert-menu label{display:block;margin:8px 0}#ppte-insert-menu input{width:70px;margin-left:8px}
`; document.head.append(css);
    const icons:Record<string,string>={text:'M4 5h16M12 5v14M8 19h8',shape:'M4 4h16v16H4z',image:'M3 3h18v18H3zM3 17l6-7 5 5 3-3 4 5',table:'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',back:'m10 5-7 7 7 7M3 12h18',ellipse:'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16',line:'M3 19 21 5'};
    function close(focus=true){const open=!menu.hidden;menu.hidden=true;trigger.setAttribute('aria-expanded','false');if(open&&focus)trigger.focus();}
    function item(label:string, icon:string, action:()=>void, parent=menu){const b=document.createElement('button');b.type='button';b.setAttribute('role','menuitem');b.title=label;b.innerHTML=`<svg aria-hidden="true" viewBox="0 0 24 24"><path d="${icons[icon]}"/></svg><span></span>`;b.lastElementChild!.textContent=label;b.onclick=action;parent.append(b);return b;}
    function place(){const r=trigger.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(r.left,innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(8,Math.min(r.bottom+6,innerHeight-menu.offsetHeight-8))+'px';}
    function show(){menu.hidden=false;trigger.setAttribute('aria-expanded','true');place();menu.querySelector('button')?.focus();}
    function choose(kind:Parameters<typeof insert>[0],r?:number,c?:number){close();insert(kind,r,c);}
    function shapes(){menu.replaceChildren();item('返回插入','back',main);for(const [kind,label] of [['rect','矩形'],['ellipse','椭圆'],['line','线条']] as const)item(label,kind==='rect'?'shape':kind,()=>choose(kind));show();}
    function tables(){menu.replaceChildren();item('返回插入','back',main);const info=document.createElement('p');info.setAttribute('role','status');info.textContent='选择行 × 列';menu.append(info);const grid=document.createElement('div');grid.className='grid';menu.append(grid);
        for(let r=1;r<=5;r++)for(let c=1;c<=6;c++){const b=item(`${r} 行 ${c} 列`,'table',()=>choose('table',r,c),grid);b.innerHTML='';b.setAttribute('aria-label',`${r} 行 ${c} 列`);b.onfocus=b.onmouseenter=()=>info.textContent=`${r} 行 × ${c} 列`;}
        const number=(label:string)=>{const l=document.createElement('label');l.textContent=label;const n=document.createElement('input');n.type='number';n.min='1';n.max='50';n.value='2';l.append(n);menu.append(l);return n;};const rows=number('行数'),cols=number('列数');item('插入指定表格','table',()=>choose('table',Number(rows.value),Number(cols.value)));show();}
    function main(){menu.replaceChildren();item('文本框','text',()=>choose('text'));item('形状','shape',shapes);item('图片','image',()=>{close();image();});item('表格','table',tables);show();}
    trigger.onclick=()=>menu.hidden?main():close();
    menu.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();return;}if(e.key==='Tab'){close(false);return;}if((e.target as Element).matches('input'))return;const items=Array.from(menu.querySelectorAll<HTMLButtonElement>('button'));const at=items.indexOf(document.activeElement as HTMLButtonElement);let next=at;if(e.key==='Home')next=0;else if(e.key==='End')next=items.length-1;else if(['ArrowDown','ArrowRight','ArrowUp','ArrowLeft'].includes(e.key)){const grid=(e.target as Element).closest('.grid');if(grid){const cells=Array.from(grid.querySelectorAll<HTMLButtonElement>('button')),i=cells.indexOf(e.target as HTMLButtonElement),delta=e.key==='ArrowDown'?6:e.key==='ArrowUp'?-6:e.key==='ArrowRight'?1:-1;e.preventDefault();cells[Math.max(0,Math.min(cells.length-1,i+delta))]?.focus();return;}next=(at+(['ArrowDown','ArrowRight'].includes(e.key)?1:-1)+items.length)%items.length;}else return;e.preventDefault();items[next]?.focus();};
    document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target as Node)&&e.target!==trigger)close(false);});
    window.addEventListener('resize',()=>{if(!menu.hidden)place();});
    return {trigger,close};
}
