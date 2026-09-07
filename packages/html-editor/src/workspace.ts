import { deferMedia, materializeMedia } from './media-demand.js';
import { shellCSS, icon, iconButton, group, selectField } from './shell-components.js';
import { accessibleShellCSS, disclosure } from './accessibility.js';
import { readingView } from './reading.js';
import { editCanvas } from './edit-canvas.js';
import { installPlayer } from '../../html-player/src/index.js';
import { Commands, editable, isTextObject, textObject, snapshot } from './commands.js';
export function workspace(frame: HTMLIFrameElement, bar: HTMLElement, change: () => void) {
    const style = document.createElement('style');
    style.dataset.ppteTransient = '';
    style.textContent = shellCSS + accessibleShellCSS;
    document.head.append(style);
    const root = document.createElement('div');
    root.id = 'ppte-workspace';
    root.dataset.ppteTransient = '';
    root.innerHTML = '<aside id="ppte-pages" aria-label="幻灯片"></aside><aside id="ppte-properties" aria-label="对象属性"></aside><div id="ppte-floating" role="toolbar" aria-label="选区格式"></div><div id="ppte-feedback" aria-live="polite"></div>';
    document.body.append(root);
    const pages = root.querySelector<HTMLElement>('#ppte-pages')!, panel = root.querySelector<HTMLElement>('#ppte-properties')!, floating = root.querySelector<HTMLElement>('#ppte-floating')!, feedback = root.querySelector<HTMLElement>('#ppte-feedback')!;
    const reading = readingView(frame);
    const canvas = editCanvas(frame, positionTools);
    let pageSettings = false, suspended = false;
    let active = false, selected: string[] = [], commands: Commands, range: Range | null = null, currentSlide = 0;
    const report = (e: unknown) => {
        feedback.textContent = '操作未完成 · ' + String(e);
    };
    const run = (fn: () => unknown) => {
        const focused=document.activeElement as HTMLElement | null;
        const restoreFocus=()=>{if(focused && !focused.isConnected && document.activeElement===document.body){
            const label=focused.getAttribute('aria-label')??focused.textContent;
            Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(b=>(b.getAttribute('aria-label')??b.textContent)===label)?.focus();
        }};
        try {
            const result = fn();
            if (result instanceof Promise)
                void result.then(() => {
                    feedback.textContent = '';
                    refresh(); restoreFocus();
                }, report);
            else {
                feedback.textContent = '';
                refresh(); restoreFocus();
            }
        }
        catch (e) {
            report(e);
        }
    };
    const button = (container: HTMLElement, label: string, fn: () => unknown) => {
        const b = document.createElement('button');
        b.textContent = label; b.title = label;
        iconButton(b, label);
        b.type = 'button';
        b.onmousedown = e => { if (container === floating) e.preventDefault(); };
        b.onclick = () => run(fn);
        container.append(b);
        return b;
    };
    const toolbar = document.createElement('div'); toolbar.id='ppte-edit-toolbar'; toolbar.dataset.ppteTransient=''; toolbar.setAttribute('role','toolbar'); toolbar.setAttribute('aria-label','编辑工具'); document.body.append(toolbar);
    const undo = button(toolbar, '撤销', () => commands.history());
    undo.title = '撤销 · Cmd/Ctrl+Z';
    undo.setAttribute('aria-label', '撤销');
    undo.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12"/></svg>';
    const redo = button(toolbar, '重做', () => commands.history(true));
    redo.title = '重做 · Cmd/Ctrl+Shift+Z';
    redo.setAttribute('aria-label', '重做');
    redo.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 5 5 5-5 5m5-5h-9a6 6 0 0 0 0 12"/></svg>';
    const insertionContext = () => ({slide:commands.doc.querySelectorAll<HTMLElement>('[data-ppte-slide]')[currentSlide].dataset.ppteId!, reference:selected.length===1?selected[0]:undefined});
    const selectInserted = (n:HTMLElement) => { selected=[n.dataset.ppteId!]; range=null; pageSettings=false; propertiesCollapsed=false; refresh(); n.scrollIntoView({block:'nearest'}); if(isTextObject(n)){n.focus(); const r=commands.doc.createRange();r.selectNodeContents(n);commands.doc.getSelection()?.removeAllRanges();commands.doc.getSelection()?.addRange(r);} };
    const imageInput=document.createElement('input'); imageInput.type='file';imageInput.accept='image/png,image/jpeg,image/webp,image/gif,image/avif';imageInput.hidden=true;imageInput.setAttribute('aria-label','选择插入图片');toolbar.append(imageInput);
    let imagePoint:ReturnType<typeof insertionContext>|undefined;
    imageInput.onchange=()=>{const file=imageInput.files?.[0],point=imagePoint;imageInput.value='';if(file&&point)run(async()=>selectInserted(await commands.insertImage(point.slide,file,point.reference)));};
    button(toolbar, '插入图片', () => {
        if (!active || composing) return;
        imagePoint = insertionContext();
        imageInput.click();
    });
    const title = document.createElement('strong');
    title.textContent = document.title;
    bar.prepend(title);
    let layoutExpanded=false;
    const section = (label: string) => {
        const s = document.createElement(label === '位置与布局' ? 'details' : 'section');

        const h = document.createElement(label === '位置与布局' ? 'summary' : 'strong');
        h.textContent = label;
        if(s instanceof HTMLDetailsElement){s.open=layoutExpanded;h.addEventListener('click',()=>{layoutExpanded=!s.open;});}
        s.append(h);
        panel.append(s);
        return s;
    };
    const field = (container: HTMLElement, label: string, value: string, action: (v: string) => unknown) => {
        const l = document.createElement('label');
        l.textContent = label;
        const input = document.createElement('input');
        input.value = value.replace(/(-?\d+\.\d{2,})(px|%)/g, (_, n, unit) => String(Math.round(Number(n)*10)/10)+unit);
        input.setAttribute('aria-label',label);
        input.placeholder = value === '混合' ? '混合' : '';
        input.onchange = () => { input.blur(); run(() => action(input.value)); };
        l.append(input);
        container.append(l);
        return input;
    };
    const colorField = (container:HTMLElement,label:string,value:string,action:(v:string)=>unknown) => {
        const row=group(container,label+'选择'); row.classList.add('color-field');
        const input=field(row,label,'',action); input.type='color';
        const ctx=document.createElement('canvas').getContext('2d')!; ctx.fillStyle=value;
        const color=String(ctx.fillStyle); input.value=/^#[0-9a-f]{6}$/i.test(color)?color:'#000000';
        const note=document.createElement('span');note.textContent=value==='混合'?'混合':value==='rgba(0, 0, 0, 0)'?'透明':input.value.toUpperCase();row.append(note);
        return input;
    };
    const selectedNodes = () => selected.map(id => commands.node(id));
    const format = (key: string, value: string) => {
        if (!CSS.supports(key, value) || /url\(|expression|@import/i.test(value))
            throw Error('INVALID_STYLE');
        if (range && !range.collapsed && selected.length === 1 && commands.node(selected[0]).contains(range.commonAncestorContainer)) {
            const n = commands.node(selected[0]);
            if (commands.protected(n))
                throw Error('OBJECT_PROTECTED');
            const before = snapshot(n);
            const span = commands.doc.createElement('span');
            span.style.setProperty(key, value);
            span.append(range.extractContents());
            range.insertNode(span);
            range.selectNodeContents(span);
            commands.record([{ id: selected[0], before, after: snapshot(n) }]);
        }
        else
            commands.style(selected, key, value);
    };
    let composing = false;
    function refresh() {
        if (!commands)
            return;
        const doc = commands.doc;
        currentSlide = Math.max(0, Math.min(currentSlide, doc.querySelectorAll('[data-ppte-slide]').length - 1));
        doc.querySelectorAll('[data-ppte-editor-selected]').forEach(n => n.removeAttribute('data-ppte-editor-selected'));
        doc.querySelectorAll<HTMLElement>(editable).forEach(n => {
            const text = isTextObject(n);
            if (text) n.setAttribute('data-ppte-editor-text', '');
            else n.removeAttribute('data-ppte-editor-text');
            n.contentEditable = String(active && text && textObject(n) === n && !commands.protected(n));
            // Descendant inline runs inherit the editing host rather than becoming
            // nested editing islands (or contenteditable=false barriers).
            if (text && textObject(n) !== n) n.removeAttribute('contenteditable');
        });
        doc.querySelectorAll<HTMLElement>('[data-ppte-id]').forEach(n => {
            if (active)
                n.setAttribute('data-ppte-editor-focus', '');
            else
                n.removeAttribute('data-ppte-editor-focus');
        });
        selected = selected.filter(id => {
            try {
                if (active)
                    commands.node(id).setAttribute('data-ppte-editor-selected', '');
                return true;
            }
            catch {
                return false;
            }
        });
        undo.disabled = !commands.undoStack.length;
        redo.disabled = !commands.redoStack.length;
        if (composing || panel.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT') { positionTools(); return; }
        panel.hidden = !active || propertiesCollapsed || (!selected.length && !pageSettings);
        resize();
        panel.replaceChildren();
        const closeProperty = button(panel, '关闭属性', () => { propertiesCollapsed = true; refresh(); settings.focus(); });
        floating.replaceChildren();
        if (commands.historyTrimmed) { const note = document.createElement('p'); note.textContent = '较早撤销记录已清理（最多 100 步 / 64 MiB 媒体字符串）；当前文件内容保留。'; panel.append(note); }

        const nodes = selectedNodes();
        const kind = nodes.length > 1 ? '多选' : !nodes.length ? '空选区' : nodes[0].matches('img,video') ? '图片 / 视频' : nodes[0].matches('svg,[data-ppte-kind="shape"]') ? '形状' : nodes[0].matches('table,td,th') ? '表格' : isTextObject(nodes[0]) ? '文字' : '内容容器';
        const heading = document.createElement('h3');
        heading.textContent = kind;
        const panelTitle = group(panel, '属性标题'); panelTitle.classList.add('panel-title'); panelTitle.append(heading,closeProperty);
        const slides = Array.from(doc.querySelectorAll<HTMLElement>('[data-ppte-slide]'));
        const slide = slides[currentSlide] ?? slides[0];
        if (!nodes.length) {
            const s = section('页面');
            const hint = document.createElement('p');
            hint.className = 'hint';
            hint.textContent = '选择对象以编辑；Shift 点击多选。Tab 切换对象，Alt + 方向键调整布局。';
            s.append(hint);
            if (slide) {
                const computed = doc.defaultView!.getComputedStyle(slide);
                const value = computed.backgroundImage !== 'none' ? computed.background : computed.backgroundColor;
                (computed.backgroundImage !== 'none' ? field : colorField)(s, '背景', value, v => commands.style([slide.dataset.ppteId!], 'background', v));
                const state = document.createElement('p'); state.className = 'hint';
                state.textContent = computed.backgroundImage !== 'none' ? '复杂背景 · 保留渐变或图像' : computed.backgroundColor === 'rgba(0, 0, 0, 0)' ? '透明 · 显示下层背景' : '纯色背景';
                s.append(state);
            }
        }
        else {
            const s = section('外观');
            if (nodes.length === 1 && nodes[0].matches('td,th')) {
                button(s, '选择整个表格', () => {
                    const table = nodes[0].closest('table')!;
                    selected = [table.dataset.ppteId!]; range = null;
                    table.setAttribute('tabindex','0'); table.focus({preventScroll:true});
                });
            }
            if (kind === '内容容器') {
                const hint = document.createElement('p');
                hint.textContent = '此结构不支持整体文字编辑。请选择其中的独立文字；媒体、控件和布局容器不能作为一个文本框编辑。';
                s.append(hint);
            }
            const common = (p: string) => {
                const textRange=range && !range.collapsed && nodes.length===1 && nodes[0].contains(range.commonAncestorContainer) && ['font-family','font-size','font-weight','font-style','color'].includes(p);
                const target=textRange ? (range!.commonAncestorContainer.nodeType===1 ? range!.commonAncestorContainer as Element : range!.commonAncestorContainer.parentElement!) : null;
                const values = (target?[target]:nodes).map(n => doc.defaultView!.getComputedStyle(n).getPropertyValue(p));
                return new Set(values).size === 1 ? values[0] : '混合';
            };
            if (nodes.every(n => isTextObject(n))) {
                selectField(s,'字体',common('font-family'),[['system-ui','系统无衬线'],['serif','衬线'],['monospace','等宽']],v=>run(()=>format('font-family',v)));
                const sizeRow=group(s,'字号与强调');
                field(sizeRow, '字号', common('font-size'), v => format('font-size', /^\d+(\.\d+)?$/.test(v) ? v+'px' : v));
                colorField(s, '文字颜色', common('color'), v => format('color', v));
                const palette = document.createElement('div');
                palette.style.cssText = 'display:flex;gap:8px';
                s.append(palette);
                for (const [label, color] of [['墨色', '#20252c'], ['樱桃红', '#993344'], ['叶绿色', '#536348'], ['蓝色', '#335cff']]) {
                    const swatch = button(palette, '', () => format('color', color));
                    swatch.setAttribute('aria-label', label); swatch.title=label;
                    swatch.style.cssText = `background:${color};width:28px;min-height:28px;border-radius:50%;padding:0`;
                }
                button(sizeRow, '字号 −', () => {
                    const value = parseFloat(common('font-size'));
                    if (!Number.isFinite(value))
                        throw Error('MIXED_SIZE: 请先指定字号');
                    format('font-size', `${Math.max(8, value - 2)}px`);
                });
                button(sizeRow, '字号 ＋', () => {
                    const value = parseFloat(common('font-size'));
                    if (!Number.isFinite(value))
                        throw Error('MIXED_SIZE: 请先指定字号');
                    format('font-size', `${value + 2}px`);
                });
                button(sizeRow, '粗体', () => format('font-weight', common('font-weight') === '700' ? '400' : '700')).setAttribute('aria-pressed',common('font-weight')==='混合'?'mixed':String(Number(common('font-weight'))>=600));
                button(sizeRow, '斜体', () => format('font-style', common('font-style') === 'italic' ? 'normal' : 'italic')).setAttribute('aria-pressed',String(common('font-style')==='italic'));
                const alignRow=group(s,'文字对齐');
                for (const [label, value] of [['左对齐', 'left'], ['居中', 'center'], ['右对齐', 'right']])
                    button(alignRow, label, () => format('text-align', value)).setAttribute('aria-pressed',String(common('text-align')===value));
            }
            if (kind === '图片 / 视频') {
                const input = field(s, '替换本地资源', '', () => {
                });
                input.type = 'file';
                input.accept = 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm';
                input.onchange = () => {
                    if (input.files?.[0])
                        run(() => { input.blur(); return commands.media(selected[0], input.files![0]); });
                };
                if (nodes[0].tagName === 'VIDEO') {
                    const poster = field(s, '替换视频封面', '', () => {});
                    poster.type = 'file'; poster.accept = 'image/png,image/jpeg,image/webp,image/gif,image/avif';
                    poster.onchange = () => { if (poster.files?.[0]) run(() => { poster.blur(); return commands.poster(selected[0], poster.files![0]); }); };
                }
                button(s, '完整显示', () => commands.crop(selected, 'contain'));
                button(s, '填充裁切', () => commands.crop(selected, 'cover'));
                const position = doc.defaultView!.getComputedStyle(nodes[0]).objectPosition.split(' ');
                const focus = (axis: number) => { const value = parseFloat(doc.defaultView!.getComputedStyle(nodes[0]).objectPosition.split(' ')[axis]); return Number.isFinite(value) ? value : 50; };
                field(s, '水平焦点（0–100%）', String(parseFloat(position[0]) || 0), v => commands.crop(selected, common('object-fit') === 'cover' ? 'cover' : 'contain', Number(v), focus(1)));
                field(s, '垂直焦点（0–100%）', String(parseFloat(position[1]) || 0), v => commands.crop(selected, common('object-fit') === 'cover' ? 'cover' : 'contain', focus(0), Number(v)));
                button(s, '重置裁切', () => commands.crop(selected, 'contain'));
                if (nodes[0].tagName === 'IMG') field(s, '图片说明', nodes[0].getAttribute('alt') ?? '', v => commands.transaction(selected, n => n.setAttribute('alt', v)));
                const note = document.createElement('p'); note.className = 'hint';
                note.textContent = '保留原始像素；替换后完整显示并清空旧说明，请复核主体与关键文字。单个资源上限 16 MiB。'; s.append(note);

            }
            if (kind === '形状') {
                if (nodes.every(n=>n.dataset.ppteShape !== 'line')) colorField(s, '填充', common(nodes[0].dataset.ppteKind==='shape'?'background-color':'fill'), v => commands.style(selected, 'fill', v));
                if(nodes.every(n=>n.dataset.ppteKind==='shape')) {
                    colorField(s,'边框颜色',common('border-top-color'),v=>commands.style(selected,'border-color',v));
                    field(s,'边框宽度',common('border-top-width'),v=>commands.style(selected,'border-width',v));
                    if(nodes.every(n=>n.dataset.ppteShape!=='line'))field(s,'圆角',common('border-radius'),v=>commands.style(selected,'border-radius',v));
                }
                if (nodes[0].tagName.toLowerCase() === 'svg') {
                    const input = field(s, '替换 SVG', '', () => {
                    });
                    input.type = 'file';
                    input.accept = 'image/svg+xml';
                    input.onchange = () => {
                        if (input.files?.[0])
                            run(() => commands.svg(selected[0], input.files![0]));
                    };
                }
            }
            if (kind === '表格') {
                const cell = nodes[0].matches('td,th') ? nodes[0] as HTMLTableCellElement : undefined;
                const scope=document.createElement('p');scope.className='hint';scope.textContent=cell?`当前单元格 · 第 ${(cell.parentElement as HTMLTableRowElement).rowIndex+1} 行 / 第 ${cell.cellIndex+1} 列`:'选择单元格以操作对应行或列';s.append(scope);
                if(cell){
                    colorField(s,'单元格填充',common('background-color'),v=>commands.style(selected,'background',v));
                    colorField(s,'单元格边框',common('border-color'),v=>commands.style(selected,'border-color',v));
                    for (const [label, value] of [['添加行', 'row'], ['添加列', 'column'], ['删除当前行', 'delete-row'], ['删除当前列', 'delete-column']] as const)
                        button(s, label, () => { const table=cell.closest('table')!;commands.table(table.dataset.ppteId!,value,cell.dataset.ppteId);try { commands.node(cell.dataset.ppteId!); } catch { selected=[table.dataset.ppteId!]; range=null; } });
                }
            }
            const layout = section('位置与布局');
            const absolute = nodes.every(n => doc.defaultView!.getComputedStyle(n).position === 'absolute');
            const hint = document.createElement('p');
            hint.className = 'hint';
            hint.textContent = absolute ? '自由定位 · 拖动对象或 Alt + 方向键移动' : '按内容顺序排列 · Alt + 方向键调整顺序；下方可调间距与对齐';
            layout.append(hint);
            const dimensions=group(layout,'尺寸');
            for (const p of ['width', 'height'])
                field(dimensions, p === 'width' ? '宽度' : '高度', common(p), v => commands.style(selected, p, v));
            if (absolute)
                field(layout, '旋转', '0', v => {
                    if (!Number.isFinite(Number(v)))
                        throw Error('INVALID_ANGLE');
                    commands.style(selected, 'transform', `rotate(${Number(v)}deg)`);
                });
            if(absolute){
                const label=document.createElement('label');label.textContent='对齐基准';const baseline=document.createElement('select');baseline.setAttribute('aria-label','对齐基准');
                for(const [value,title] of [['selection','当前选择范围'],['page','当前页面'],['content','父内容区']]){const o=document.createElement('option');o.value=value;o.textContent=title;baseline.append(o);}label.append(baseline);layout.append(label);
                const alignment=group(layout,'对象对齐');
                for(const [title,edge] of [['向左对齐','left'],['水平居中','center'],['向右对齐','right'],['顶部对齐','top'],['垂直居中','middle'],['底部对齐','bottom']] as const)button(alignment,title,()=>commands.align(selected,edge,baseline.value as 'selection'|'page'|'content'));
            }
            if (nodes.length === 1 && /grid|flex/.test(doc.defaultView!.getComputedStyle(nodes[0]).display)) {
                field(layout, '间距', common('gap'), v => commands.style(selected, 'gap', v));
                if (doc.defaultView!.getComputedStyle(nodes[0]).display.includes('grid'))
                    field(layout, '高级：列宽规则', common('grid-template-columns'), v => commands.style(selected, 'grid-template-columns', v));
            }
            if(nodes.every(n=>/grid|flex/.test(doc.defaultView!.getComputedStyle(n.parentElement!).display))){
                selectField(layout,'容器内对齐',common('align-self'),[['auto','跟随容器'],['start','起点'],['center','居中'],['end','末端'],['stretch','拉伸']],v=>run(()=>commands.style(selected,'align-self',v)));
                field(layout,'顺序',common('order'),v=>commands.style(selected,'order',v));
            }
            if(!absolute)field(layout,'外边距',common('margin'),v=>commands.style(selected,'margin',v));
            if (!absolute && nodes.length === 1 && !/grid|flex/.test(doc.defaultView!.getComputedStyle(nodes[0].parentElement!).display) && !nodes[0].matches('td,th,[data-ppte-slide]')) {
                button(layout,'提前一个对象',()=>commands.moveFlow(selected[0],-1));
                button(layout,'推后一个对象',()=>commands.moveFlow(selected[0],1));
                for (const [label, alignment] of [['对象靠左','left'],['对象居中','center'],['对象靠右','right']] as const)
                    button(layout,label,()=>commands.alignFlow(selected[0],alignment));
            }
            if(nodes.length===1 && !nodes[0].matches('td,th,[data-ppte-slide]')){
                const actions=group(section('对象操作'),'复制与删除');
                button(actions,'复制对象',()=>selectInserted(commands.duplicate(selected[0])));
                button(actions,'删除对象',()=>{commands.remove(selected[0]);selected=[];range=null;});
            }
            const locked=nodes.some(n=>commands.protected(n));
            if(locked){const note=document.createElement('p');note.textContent='🔒 受保护 · 解锁后调整；仍可插入其他对象';panel.append(note);}
            button(section('保护'), nodes.every(n => n.dataset.ppteLocked === 'true') ? '解除保护' : '保护对象', () => commands.lock(selected, !nodes.every(n => n.dataset.ppteLocked === 'true')));
        }
        undo.disabled = !commands.undoStack.length;
        redo.disabled = !commands.redoStack.length;
        positionTools();
    }
    const handle = document.createElement('button'); handle.type = 'button'; handle.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" style="width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.65"><path d="M5 5 19 19M19 10v9h-9"/></svg>'; handle.title='调整对象大小';
    handle.setAttribute('aria-label', '调整对象大小'); handle.hidden = true;
    handle.style.cssText = 'position:fixed;z-index:102;width:24px;min-height:24px;padding:0;border:2px solid #335cff;touch-action:none'; root.append(handle);
    let sizing: { id: string; x: number; y: number; width: number; height: number; scale: number } | undefined;
    handle.onpointerdown = e => {
        e.preventDefault();
        const n = commands.node(selected[0]), r = n.getBoundingClientRect();
        sizing = { id: selected[0], x: e.clientX, y: e.clientY, width: r.width, height: r.height, scale: frame.getBoundingClientRect().width / frame.clientWidth };
        handle.setPointerCapture(e.pointerId);
    };
    handle.onpointerup = e => {
        const start = sizing; sizing = undefined; if (!start) return;
        run(() => commands.transaction([start.id], n => {
            n.style.boxSizing = 'border-box';
            n.style.width = `${Math.max(8, start.width + (e.clientX - start.x) / start.scale)}px`;
            n.style.height = `${Math.max(8, start.height + (e.clientY - start.y) / start.scale)}px`;
        }));
    };
    handle.onkeydown = e => {
        if (!e.key.startsWith('Arrow')) return;
        e.preventDefault();
        run(() => commands.transaction(selected, n => {
            const r = commands.node(selected[0]).getBoundingClientRect(); n.style.boxSizing = 'border-box';
            n.style.width = `${Math.max(8, r.width + (e.key === 'ArrowRight' ? 8 : e.key === 'ArrowLeft' ? -8 : 0))}px`;
            n.style.height = `${Math.max(8, r.height + (e.key === 'ArrowDown' ? 8 : e.key === 'ArrowUp' ? -8 : 0))}px`;
        }));
    };
    function positionTools() {
        handle.hidden = true;
        if (!commands || !selected.length) return;
        let n: HTMLElement; try { n = commands.node(selected[0]); } catch { return; }
        const r = n.getBoundingClientRect(), f = frame.getBoundingClientRect();
        const scale = f.width / frame.clientWidth;
        handle.hidden = !active || selected.length !== 1 || commands.protected(n) || isTextObject(n);
        handle.style.left = `${f.left + r.right * scale - 12}px`;
        handle.style.top = `${f.top + r.bottom * scale - 12}px`;
        floating.style.bottom = 'auto'; floating.style.transform = 'none';
        floating.style.left = `${Math.max(8, Math.min(innerWidth - floating.offsetWidth - 8, f.left + r.left * scale))}px`;
        const top = bar.getBoundingClientRect().bottom + 8;
        const above = f.top + r.top * scale - floating.offsetHeight - 12;
        const desired = above < top ? f.top + r.bottom * scale + 12 : above;
        floating.style.top = `${Math.max(top, Math.min(innerHeight - floating.offsetHeight - 64, desired))}px`;
    }
    window.addEventListener('resize', positionTools);
    function scrollSlide(slide: HTMLElement) {
        if (suspended) return;
        resize(); updatePageCount(); positionTools();
    }
    let draggedSlide: string | undefined;
    function reorderPage(id: string, target: string) {
        if (!active || composing) return;
        commands.moveSlide(id, target);
        currentSlide = Array.from(commands.doc.querySelectorAll('[data-ppte-slide]')).indexOf(commands.node(id));
        selected = []; refresh(); thumbs(); scrollSlide(commands.node(id));
        pages.querySelector<HTMLButtonElement>(`button[data-slide="${CSS.escape(id)}"]`)?.focus();
        feedback.textContent = `页面已移至第 ${currentSlide + 1} 页`;
    }
    const visiblePreviews = new WeakSet<Element>();
    const mediaObserver = new IntersectionObserver(entries => {
        for (const entry of entries) {
            const preview = entry.target.querySelector('.preview')?.shadowRoot?.querySelector('div');
            if (!preview) continue;
            if (entry.isIntersecting) { visiblePreviews.add(entry.target); materializeMedia(preview); }
            else { visiblePreviews.delete(entry.target); deferMedia(preview); }
        }
    });
    function previewClone(slide: HTMLElement, visible = false) {
        const clone = slide.cloneNode(true) as HTMLElement;
        // A thumbnail needs the poster, never an independent playing decoder.
        clone.querySelectorAll('video,audio').forEach(media => {
            const image = document.createElement('img');
            const poster = media.getAttribute('poster') ?? media.getAttribute('data-ppte-editor-media-poster');
            if (poster) image.setAttribute('data-ppte-editor-media-src', poster);
            image.setAttribute('style', media.getAttribute('style') ?? '');
            for (const attr of ['width','height']) if (media.hasAttribute(attr)) image.setAttribute(attr,media.getAttribute(attr)!);
            image.alt = ''; media.replaceWith(image);
        });
        if (visible) materializeMedia(clone); else deferMedia(clone);
        return clone;
    }
    function thumbs(ids?: string[]) {
        const slidesNow = Array.from(commands.doc.querySelectorAll<HTMLElement>('[data-ppte-slide]'));
        const buttons = Array.from(pages.querySelectorAll<HTMLButtonElement>('button[aria-current]'));
        if (ids && buttons.length === slidesNow.length && buttons.every((b,i)=>b.dataset.slide===slidesNow[i].dataset.ppteId)) {
            const affected = new Set(ids.flatMap(id=>{
                try { const n=commands.node(id); return Array.from(n.matches('[data-ppte-slide]') ? [n] : n.querySelectorAll<HTMLElement>('[data-ppte-slide]')).concat(n.closest<HTMLElement>('[data-ppte-slide]') ?? []).map(s=>s.dataset.ppteId); }
                catch { return []; }
            }));
            slidesNow.forEach((slide,i)=>{
                const b=buttons[i]; b.setAttribute('aria-current',String(i===currentSlide));
                if(!affected.has(slide.dataset.ppteId))return;
                b.querySelector('.preview')!.shadowRoot!.querySelector('div')!.replaceChildren(previewClone(slide, visiblePreviews.has(b)));
                b.lastChild!.textContent=`${i+1} · ${slide.querySelector('h1,h2,h3')?.textContent?.slice(0,24) ?? '幻灯片'}`;
            });
            return;
        }
        const scrollTop = pages.querySelector('#ppte-page-list')?.scrollTop ?? 0;
        mediaObserver.disconnect();
        pages.replaceChildren();
        const list = document.createElement('div'); list.id = 'ppte-page-list';
        const footer = document.createElement('div'); footer.id = 'ppte-page-footer';
        pages.append(list, footer);
        const slides = Array.from(commands.doc.querySelectorAll<HTMLElement>('[data-ppte-slide]'));
        slides.forEach((slide, i) => {
            const row=document.createElement('div');row.className='thumb-row';list.append(row);
            const b = button(row, `${i + 1} · ${slide.querySelector('h1,h2,h3')?.textContent?.slice(0, 24) ?? '幻灯片'}`, () => {
                currentSlide = i;
                scrollSlide(slide);
                selected = [];
                refresh();
                thumbs([]);
            });
            b.dataset.slide = slide.dataset.ppteId;
            b.draggable = active;
            b.ondragstart = e => { if (!active || composing) { e.preventDefault(); return; } draggedSlide = slide.dataset.ppteId; e.dataTransfer?.setData('text/plain', draggedSlide!); };
            b.ondragover = e => { if (active && draggedSlide) e.preventDefault(); };
            b.ondrop = e => { e.preventDefault(); const id = draggedSlide; draggedSlide = undefined; if (id) run(()=>reorderPage(id,slide.dataset.ppteId!)); };
            b.ondragend = () => { draggedSlide = undefined; };
            b.onkeydown = e => {
                if (!active || !e.altKey || !['ArrowUp','ArrowDown'].includes(e.key)) return;
                e.preventDefault();
                const target = slides[i + (e.key === 'ArrowUp' ? -1 : 1)];
                if (target) run(()=>reorderPage(slide.dataset.ppteId!,target.dataset.ppteId!));
            };
            b.setAttribute('aria-label', `第 ${i + 1} 页`);
            b.setAttribute('aria-current', String(i === currentSlide));
            const preview = document.createElement('span');
            preview.className = 'preview';
            const shadow = preview.attachShadow({ mode: 'open' });
            const scaled = document.createElement('div');
            scaled.style.cssText = 'transform:scale(.12);transform-origin:top left;width:1080px;height:640px;pointer-events:none';
            for (const s of Array.from(commands.doc.querySelectorAll('style:not([data-ppte-transient])')))
                shadow.append(s.cloneNode(true));
            scaled.inert = true;
            scaled.append(previewClone(slide));
            shadow.append(scaled);
            b.prepend(preview);
            mediaObserver.observe(b);
            const menu=document.createElement('details');menu.className='page-actions';menu.innerHTML=`<summary aria-label="第 ${i+1} 页操作" title="第 ${i+1} 页操作">${icon('更多')}</summary><div></div>`;row.append(menu);
            const actions=menu.lastElementChild as HTMLElement;
            for (const [label, delta] of [['上移',-1],['下移',1]] as const) {
                const target = slides[i+delta];
                const move = button(actions,label,()=>reorderPage(slide.dataset.ppteId!,target.dataset.ppteId!));
                move.setAttribute('aria-label',`第 ${i+1} 页${label}`); move.disabled = !target;
            }
            disclosure(menu,true);
        });
        list.scrollTop = scrollTop;
        button(footer, '添加页', () => {
            if (!active || composing) return;
            const slide = slides[currentSlide];
            if (!slide)
                throw Error('NO_SLIDE');
            const inserted = commands.insertSlide(slide.dataset.ppteId!);
            currentSlide = Array.from(commands.doc.querySelectorAll('[data-ppte-slide]')).indexOf(inserted);
            selected = [];
            scrollSlide(inserted);
            thumbs();
        });
    }
    function attach() {
        commands = new Commands(frame.contentDocument!, ids => {
            change();
            const currentId = pages.querySelector<HTMLButtonElement>('button[aria-current="true"]')?.dataset.slide;
            const currentIndex = Array.from(commands.doc.querySelectorAll<HTMLElement>('[data-ppte-slide]')).findIndex(n=>n.dataset.ppteId===currentId);
            if (currentIndex >= 0) currentSlide = currentIndex;
            // Typing keeps property controls and selection stable; structural/style
            // commands still refresh their context synchronously.
            if (!before) refresh();
            else { undo.disabled = !commands.undoStack.length; redo.disabled = !commands.redoStack.length; }
            thumbs(ids);
        });
        selected = [];
        range = null;
        const doc = commands.doc;
        doc.addEventListener('load', e => { if (!suspended && (e.target as Element).tagName === 'IMG') resize(); }, true);
        doc.defaultView?.addEventListener('scroll', positionTools);
        const css = doc.createElement('style');
        css.dataset.ppteTransient = '';
        css.textContent = '[data-ppte-editor-hidden]{display:none!important}[data-ppte-editor-selected]{outline:2px solid #335cff!important;outline-offset:4px}[data-ppte-editor-focus]:focus-visible,[contenteditable=true]:focus-visible{outline:3px solid #335cff!important;outline-offset:4px}';
        doc.head.append(css);
        const selectTarget = (target: EventTarget | null) => {
            const e = target as Element;
            return e.closest?.('td,th') ?? e.closest?.('svg,img,video,table') ?? textObject(e) ?? e.closest?.('[data-ppte-id]');
        };
        doc.addEventListener('click', e => {
            if (!active)
                return;
            const n = selectTarget(e.target) as HTMLElement | null;
            const id = n?.dataset.ppteId;
            propertiesCollapsed=false; pageSettings=false;
            selected = id ? (e.shiftKey ? [...new Set([...selected, id])] : [id]) : [];
            // Non-text objects must own keyboard focus after a real pointer
            // selection, including when pointerdown prevented native dragging.
            if (n && !isTextObject(n)) { n.setAttribute('tabindex', '0'); n.focus({preventScroll:true}); }
            const selection = doc.getSelection();
            range = selection?.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0).cloneRange() : null;
            const slide = n?.closest('[data-ppte-slide]');
            if (slide) currentSlide = Array.from(doc.querySelectorAll('[data-ppte-slide]')).indexOf(slide);
            refresh();
        });
        doc.addEventListener('selectionchange', () => {
            const s = doc.getSelection();
            if (s?.rangeCount && !s.isCollapsed)
                range = s.getRangeAt(0).cloneRange();
        });
        let before: {
            id: string;
            html: string;
        } | undefined;
        doc.addEventListener('beforeinput', e => {
            const n = textObject(e.target as Element);
            if (!n)
                return;
            if (commands.protected(n)) {
                e.preventDefault();
                report('OBJECT_PROTECTED');
                return;
            }
            if (!before)
                before = { id: n.dataset.ppteId!, html: snapshot(n) };
            // Keep one text host: browser paragraph insertion otherwise creates
            // block children that are correctly rejected as author containers.
            if (e.inputType === 'insertParagraph' && !e.isComposing) {
                e.preventDefault();
                doc.execCommand('insertLineBreak');
            }
        });
        doc.addEventListener('paste', e => {
            const n = textObject(e.target as Element);
            if (!active || !n || commands.protected(n) || !e.clipboardData) return;
            e.preventDefault();
            if (!before) before = {id:n.dataset.ppteId!, html:snapshot(n)};
            // Insert clipboard text as inline line breaks; never import layout,
            // scripts or nested editing hosts from another application.
            const text = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
            const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
            if (escaped) doc.execCommand('insertHTML', false, escaped);
            record();
        });
        const record = () => {
            if (before) {
                const n = commands.node(before.id);
                commands.record([{ id: before.id, before: before.html, after: snapshot(n) }]);
                before = undefined;
            }
        };
        let inputFit = 0;
        doc.addEventListener('input', (e) => {
            if (!(e as InputEvent).isComposing) {
                if(before)record();
                else { change(); thumbs([(e.target as HTMLElement).dataset.ppteId!]); }
                // Flow content can change the native page height while typing.
                cancelAnimationFrame(inputFit);
                inputFit = requestAnimationFrame(() => { resize(); positionTools(); });
            }
        });
        doc.addEventListener('compositionstart', e => {
            composing = true;
            const n = textObject(e.target as Element);
            if(n && !before)before={id:n.dataset.ppteId!,html:snapshot(n)};
        });
        doc.addEventListener('compositionend', () => { composing = false; record(); });
        doc.addEventListener('keydown', e => {
            if (e.isComposing || composing) return;
            if (!active)
                return;
            if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
                const objects = Array.from(doc.querySelectorAll<HTMLElement>('[data-ppte-id]')).filter(n => n.getBoundingClientRect().width > 0 && (!textObject(n) || textObject(n) === n) && (!n.closest('svg') || n.matches('svg')));
                if (objects.length) {
                    e.preventDefault();
                    const i = objects.findIndex(n => n.dataset.ppteId === selected[0]);
                    const next = i + (e.shiftKey ? -1 : 1);
                    if (next < 0 || next >= objects.length) {
                        bar.querySelector<HTMLButtonElement>('button')?.focus();
                        return;
                    }
                    const n = objects[next];
                    selected = [n.dataset.ppteId!];
                    n.setAttribute('tabindex', '0');
                    n.focus();
                    refresh();
                }
            }
            if (e.altKey && e.key.startsWith('Arrow')) {
                e.preventDefault();
                run(() => commands.move(selected[0], e.key === 'ArrowLeft' ? -8 : e.key === 'ArrowRight' ? 8 : 0, e.key === 'ArrowUp' ? -8 : e.key === 'ArrowDown' ? 8 : 0));
            }
            keys(e);
        });
        let drag: {
            id: string;
            x: number;
            y: number;
        } | undefined;
        doc.addEventListener('pointerdown', e => {
            if (!active)
                return;
            const n = selectTarget(e.target) as HTMLElement | null;
            if (n && !isTextObject(n) && doc.defaultView!.getComputedStyle(n).position === 'absolute') {
                e.preventDefault();
                drag = { id: n.dataset.ppteId!, x: e.clientX, y: e.clientY };
            }
        });
        doc.addEventListener('pointerup', e => {
            if (drag) {
                const d = drag;
                drag = undefined;
                if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3)
                    run(() => commands.move(d.id, e.clientX - d.x, e.clientY - d.y));
            }
        });
        (window as any).PPTeEditor = { get commands() {
                return commands;
            }, select(ids: string[]) {
                selected = ids; propertiesCollapsed=false; pageSettings=false;
                refresh();
            }, get selection() {
                return [...selected];
            }, hash: (id: string) => commands.hash(id), patch: (id: string, hash: string, patch: any) => commands.agent(id, hash, patch) };
        refresh();
        thumbs();
    }
    const keys = (e: KeyboardEvent) => {
        if (e.isComposing || composing) return;
        const target=e.target as HTMLElement;
        if(target.closest?.('dialog[open]'))return;
        const input=target.closest?.('input,textarea,select,[contenteditable="true"]');
        if(active&&!input&&selected.length===1&&['Delete','Backspace'].includes(e.key)){e.preventDefault();run(()=>{commands.remove(selected[0]);selected=[];range=null;});return;}
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            run(() => commands.history(e.shiftKey));
        }
    };
    document.addEventListener('keydown', keys, true);
    let collapsed = true, propertiesCollapsed = false, zoom = 1;
    const controls = document.createElement('div'); controls.id = 'ppte-canvas-controls'; controls.dataset.ppteTransient=''; document.body.append(controls);
    const viewButton = (label: string, action: () => void) => {
        const b = document.createElement('button'); b.textContent = label; b.type = 'button'; iconButton(b,label);
        b.onmousedown = e => e.preventDefault(); b.onclick = () => { action(); resize(); positionTools(); }; controls.append(b); return b;
    };
    const leftToggle = viewButton('展开缩略图', () => { collapsed = !collapsed; if(!collapsed && innerWidth<=820){propertiesCollapsed=true;panel.hidden=true;} pages.hidden = collapsed; iconButton(leftToggle,collapsed ? '展开缩略图' : '折叠缩略图'); });
    const settings = button(toolbar, '页面设置', () => { selected=[]; pageSettings=true; propertiesCollapsed=false; refresh(); });
    settings.style.marginLeft='auto';
    const railToggle=button(toolbar,'页面导航',()=>leftToggle.click());toolbar.prepend(railToggle);
    const zoomOut = viewButton('缩小画布', () => zoom = Math.max(.25, zoom - .1));
    const zoomLabel = document.createElement('span'); controls.append(zoomLabel);
    const zoomIn = viewButton('放大画布', () => zoom = Math.min(1.5, zoom + .1));
    const zoomReset = viewButton('重置缩放', () => zoom = 1);
    const pageCount = document.createElement('span'); controls.append(pageCount);
    function updatePageCount() { pageCount.textContent = `${currentSlide+1} / ${commands.doc.querySelectorAll('[data-ppte-slide]').length}`; }
    const navigate = (delta: number) => { currentSlide=Math.max(0,Math.min(commands.doc.querySelectorAll('[data-ppte-slide]').length-1,currentSlide+delta)); selected=[]; refresh(); scrollSlide(commands.doc.querySelectorAll<HTMLElement>('[data-ppte-slide]')[currentSlide]); thumbs(); };
    const prev=viewButton('上一页', () => navigate(-1)),next=viewButton('下一页', () => navigate(1));
    const navigation=group(controls,'页面导航');navigation.append(prev,pageCount,next);controls.prepend(leftToggle,navigation);
    const zoomGroup=group(controls,'画布缩放');zoomGroup.classList.add('zoom-group');zoomGroup.append(zoomOut,zoomLabel,zoomIn,zoomReset);
    const zoomOptions=document.createElement('details'); zoomOptions.className='zoom-options'; zoomOptions.innerHTML='<summary aria-label="画布缩放选项" title="画布缩放选项">缩放</summary><div></div>'; controls.append(zoomOptions); disclosure(zoomOptions);
    const help = document.createElement('details'); help.innerHTML=`<summary aria-label="快捷键与帮助" title="快捷键与帮助">${icon('帮助')}</summary><p>放映：← / →、PageUp / PageDown、空格翻页；B 黑屏；Esc 返回。横向滑动翻页。</p>`; controls.append(help); disclosure(help);
    panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();propertiesCollapsed=true;refresh();settings.focus();}});
    const resize = () => {
        if (suspended) return;
        toolbar.hidden = !active;
        bar.dataset.mode = active ? 'edit' : 'read';
        for (const b of Array.from(bar.querySelectorAll('button'))) if (b.textContent === '阅读' || b.textContent === '编辑') b.setAttribute('aria-pressed', String((b.textContent === '编辑') === active));
        if(active && !panel.hidden && innerWidth<=820) collapsed=true;
        pages.hidden = collapsed;
        leftToggle.setAttribute('aria-expanded',String(!collapsed));
        leftToggle.setAttribute('aria-controls','ppte-pages');
        const drawer=innerWidth<=580 && (!panel.hidden || !collapsed);
        root.toggleAttribute('data-drawer',drawer);
        // Bottom drawers occupy their own space, so the visible page stays operable.
        frame.inert=false;
        frame.removeAttribute('aria-hidden');
        iconButton(leftToggle,collapsed ? '展开缩略图' : '折叠缩略图');
        root.toggleAttribute('data-reading-nav', !active && !collapsed);
        const barHeight=bar.getBoundingClientRect().height;
        toolbar.style.top=barHeight+'px';
        const top=barHeight+(active?toolbar.getBoundingClientRect().height:0);
        const compact=innerWidth<=580;
        zoomOptions.hidden=!compact || !active;
        const zoomParent=compact?zoomOptions.lastElementChild!:zoomGroup;
        for(const b of [zoomOut,zoomIn,zoomReset])if(b.parentElement!==zoomParent)zoomParent.append(b);
        const footerHeight=controls.getBoundingClientRect().height;
        const drawerHeight=drawer?Math.min(310,Math.max(0,(innerHeight-top-footerHeight)*.5)):0;
        root.style.setProperty('--drawer-height',drawerHeight+'px');
        const bottom=footerHeight+drawerHeight;
        pages.style.bottom=panel.style.bottom=footerHeight+'px';
        const rail=innerWidth>=1280?204:170, prop=innerWidth>=1280?264:238;
        const left=collapsed||innerWidth<=580?0:rail, right=panel.hidden||innerWidth<=580?0:prop;
        updatePageCount();
        zoomOut.hidden = zoomIn.hidden = zoomReset.hidden = !active;
        root.style.setProperty('--top', `${top}px`);
        if (!active) {
            canvas.clear();
            frame.style.marginTop = `${top}px`;
            frame.style.marginLeft = left+'px';
            frame.style.width = `calc(100% - ${left}px)`;
            frame.style.height = `calc(100% - ${top+bottom}px)`;
            reading.draw(currentSlide);
            zoomLabel.textContent = '适应画布';
        } else {
            reading.clear();
            const scale = canvas.draw(currentSlide, {left,right,top,bottom},zoom);
            zoomLabel.textContent = zoom === 1 ? '适应画布' : `${Math.round(scale*100)}%`;
        }
    };
    const shellObserver=new ResizeObserver(resize);
    for(const n of [bar,toolbar,controls])shellObserver.observe(n);
    window.addEventListener('resize', resize);
    button(bar, '阅读', () => {
        if (composing) return;
        active = false; collapsed=true; reading.clear();
        root.removeAttribute('data-open');
        frame.style.marginLeft = '0';
        frame.style.width = '100%';
        resize();
        refresh();
    });
    const modes = document.createElement('div'); modes.className='modes'; modes.setAttribute('role','group'); modes.setAttribute('aria-label','文档模式');
    const modeButtons = Array.from(bar.querySelectorAll('button')).filter(b=>b.textContent==='阅读'||b.textContent==='编辑');
    modeButtons.sort((a)=>a.textContent==='阅读'?-1:1).forEach(b=>modes.append(b));
    bar.insertBefore(modes,bar.querySelector('[role=status]'));
    let wasActive = false;
    const suspend = () => {
        wasActive = active; suspended=true; reading.clear(); canvas.clear(); help.open=false; active = false; root.removeAttribute('data-open');
        frame.inert=false; frame.removeAttribute('aria-hidden'); bar.style.display = 'none'; frame.style.transform = ''; refresh();
    };
    const resume = () => {
        suspended=false; active = wasActive; bar.style.display = 'flex'; root.toggleAttribute('data-open', active);
        refresh(); resize();
        const slide = commands.doc.querySelectorAll<HTMLElement>('[data-ppte-slide]')[currentSlide];
        if (slide) scrollSlide(slide);
        if (active && selected[0]) commands.node(selected[0]).focus({ preventScroll:true });
    };
    // Attach to the current document after editor initialization below.
    let player: ReturnType<typeof installPlayer>;
    const present=button(bar, '放映', () => { if (!composing) player.start(); });present.classList.add('primary');
    for(const b of Array.from(bar.children))if(b instanceof HTMLButtonElement && b.textContent==='下载更新后的文件')iconButton(b,'下载更新后的文件');
    frame.addEventListener('load', attach);
    attach();
    player = installPlayer(frame, { suspend, resume, current: () => currentSlide, moved: i => currentSlide = i });
    // F04A must validate the route before F04 enables export. Never invoke system print.
    const pdf = button(bar, '导出为 PDF', () => {});
    pdf.disabled = true;
    pdf.title = '导出为 PDF 尚未可用：正在验证视觉保真与可搜索文字的导出路线';
    pdf.setAttribute('aria-label', '导出为 PDF');
    bar.insertBefore(pdf, present);
    Object.assign(window, { PPTePlayer: player });
    return { get active() { return active; }, enable() {
            if (composing) return;
            reading.clear(); active = true; collapsed=innerWidth<=580;
            root.setAttribute('data-open', '');
            refresh();
            resize();
            const slide = commands.doc.querySelectorAll<HTMLElement>('[data-ppte-slide]')[currentSlide];
            if (slide) scrollSlide(slide);
        }, hide() {
            if (composing) return;
            active = false; collapsed=true;
            root.removeAttribute('data-open');
            frame.style.marginLeft = '0';
            frame.style.width = '100%';
            resize();
            refresh();
        }, refresh };
}
