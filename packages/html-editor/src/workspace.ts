import { installPlayer } from '../../html-player/src/index.js';
import { installPrint } from '../../html-print/src/index.js';
import { Commands, editable, snapshot } from './commands.js';
export function workspace(frame: HTMLIFrameElement, bar: HTMLElement, change: () => void) {
    const style = document.createElement('style');
    style.dataset.ppteTransient = '';
    style.textContent = `
 html:has(#ppte-workspace[data-open]){background:#f4f5f7!important}#ppte-save-ui,#ppte-workspace{font:14px/1.5 system-ui;color:#20252c}#ppte-save-ui{background:#fff!important;color:#20252c!important;inset:0 0 auto!important;padding:12px 20px!important;border-radius:0!important;border-bottom:1px solid #dce1e8;min-height:48px;flex-wrap:wrap}#ppte-save-ui button,#ppte-workspace button{font:inherit;color:#20252c;background:#f2f4f8;border:1px solid #dce1e8;border-radius:8px;min-height:36px;padding:6px 12px;cursor:pointer}#ppte-save-ui button:hover,#ppte-workspace button:hover{background:#e4eaf5}#ppte-save-ui :focus-visible,#ppte-workspace :focus-visible{outline:3px solid #335cff;outline-offset:3px}#ppte-save-ui svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8}#ppte-save-ui details{position:relative}#ppte-save-ui details>div{position:absolute;right:0;top:36px;width:256px;background:#fff;box-shadow:0 8px 32px #20252c30;padding:16px;display:grid;gap:8px}#ppte-workspace{display:none}#ppte-workspace[data-open]{display:block}#ppte-pages{position:fixed;left:0;top:var(--top);bottom:0;width:184px;background:#fafbfc;overflow:auto;padding:16px;box-sizing:border-box}#ppte-pages button[aria-current=true]{border-color:#335cff;box-shadow:0 0 0 2px #335cff20}#ppte-pages button{display:block;width:100%;margin-bottom:16px;overflow:hidden;text-align:left}#ppte-pages .preview{display:block;height:80px;overflow:hidden;pointer-events:none;position:relative;background:#fff}#ppte-pages .preview>div{transform:scale(.12);transform-origin:top left;width:1080px;height:640px}#ppte-properties{position:fixed;right:0;top:var(--top);bottom:0;width:232px;background:#fff;padding:20px;overflow:auto;box-sizing:border-box;border-left:1px solid #dce1e8}#ppte-properties h3{font-size:14px;margin:0 0 16px}#ppte-properties section{border-top:1px solid #dce1e8;padding:16px 0;display:grid;gap:8px}#ppte-workspace label{display:grid;gap:6px;color:#46515e}#ppte-workspace input{font:inherit;border:1px solid #ccd3de;border-radius:8px;padding:8px;color:#20252c;background:#f6f7f9;width:100%;box-sizing:border-box}#ppte-floating{position:fixed;z-index:101;bottom:24px;left:calc(50% - 24px);transform:translateX(-50%);display:flex;gap:8px;padding:8px;border:1px solid #dce1e8;border-radius:12px;background:#fff;box-shadow:0 8px 24px #20252c20;max-width:calc(100vw - 450px);flex-wrap:wrap}#ppte-floating:empty{display:none}#ppte-feedback{position:fixed;bottom:88px;left:208px;max-width:calc(100% - 464px);background:#fff;color:#20252c;border-radius:8px;padding:8px}#ppte-feedback:empty{display:none}#ppte-workspace button[aria-pressed=true]{background:#e4eafe;border-color:#335cff}#ppte-save-ui summary{cursor:pointer;border-radius:8px;padding:8px}#ppte-workspace .hint{color:#46515e;font-size:12px}`;
    style.textContent += '#ppte-pages[hidden],#ppte-properties[hidden]{display:none}#ppte-canvas-controls{position:fixed;bottom:8px;left:16px;display:flex;align-items:center;gap:8px;background:white;padding:8px;border-radius:12px}';
    document.head.append(style);
    const root = document.createElement('div');
    root.id = 'ppte-workspace';
    root.dataset.ppteTransient = '';
    root.innerHTML = '<aside id="ppte-pages" aria-label="幻灯片"></aside><aside id="ppte-properties" aria-label="对象属性"></aside><div id="ppte-floating" role="toolbar" aria-label="选区格式"></div><div id="ppte-feedback" aria-live="polite"></div>';
    document.body.append(root);
    const pages = root.querySelector<HTMLElement>('#ppte-pages')!, panel = root.querySelector<HTMLElement>('#ppte-properties')!, floating = root.querySelector<HTMLElement>('#ppte-floating')!, feedback = root.querySelector<HTMLElement>('#ppte-feedback')!;
    let active = false, selected: string[] = [], commands: Commands, range: Range | null = null, currentSlide = 0;
    const report = (e: unknown) => {
        feedback.textContent = '操作未完成 · ' + String(e);
    };
    const run = (fn: () => unknown) => {
        try {
            const result = fn();
            if (result instanceof Promise)
                void result.then(() => {
                    feedback.textContent = '';
                    refresh();
                }, report);
            else {
                feedback.textContent = '';
                refresh();
            }
        }
        catch (e) {
            report(e);
        }
    };
    const button = (container: HTMLElement, label: string, fn: () => unknown) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.type = 'button';
        b.onmousedown = e => { if (container === floating) e.preventDefault(); };
        b.onclick = () => run(fn);
        container.append(b);
        return b;
    };
    const undo = button(bar, '撤销', () => commands.history());
    undo.title = '撤销 · Cmd/Ctrl+Z';
    undo.setAttribute('aria-label', '撤销');
    undo.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12"/></svg>';
    const redo = button(bar, '重做', () => commands.history(true));
    redo.title = '重做 · Cmd/Ctrl+Shift+Z';
    redo.setAttribute('aria-label', '重做');
    redo.innerHTML = '<svg viewBox="0 0 24 24"><path d="m15 5 5 5-5 5m5-5h-9a6 6 0 0 0 0 12"/></svg>';
    const originals = Array.from(bar.querySelectorAll('button')).filter(b => !['编辑', '保存 / 授权', '下载更新后的文件'].includes(b.textContent ?? '') && b !== undo && b !== redo);
    const more = document.createElement('details');
    more.innerHTML = '<summary>更多</summary><div></div>';
    for (const b of originals)
        more.lastElementChild!.append(b);
    bar.append(more);
    const title = document.createElement('strong');
    title.textContent = document.title;
    bar.prepend(title);
    const section = (label: string) => {
        const s = document.createElement('section');
        const h = document.createElement('strong');
        h.textContent = label;
        s.append(h);
        panel.append(s);
        return s;
    };
    const field = (container: HTMLElement, label: string, value: string, action: (v: string) => unknown) => {
        const l = document.createElement('label');
        l.textContent = label;
        const input = document.createElement('input');
        input.value = value;
        input.placeholder = value === '混合' ? '混合' : '';
        input.onchange = () => run(() => action(input.value));
        l.append(input);
        container.append(l);
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
        doc.querySelectorAll<HTMLElement>(editable).forEach(n => n.contentEditable = String(active && !n.closest('[data-ppte-locked="true"]')));
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
        panel.replaceChildren();
        floating.replaceChildren();
        const nodes = selectedNodes();
        const kind = nodes.length > 1 ? '多选' : !nodes.length ? '空选区' : nodes[0].matches('img,video') ? '图片 / 视频' : nodes[0].matches('svg,[data-ppte-kind="shape"]') ? '形状' : nodes[0].matches('table,td,th') ? '表格' : '文字';
        const heading = document.createElement('h3');
        heading.textContent = kind;
        panel.append(heading);
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
                field(s, '背景', value, v => commands.style([slide.dataset.ppteId!], 'background', v));
                const state = document.createElement('p'); state.className = 'hint';
                state.textContent = computed.backgroundImage !== 'none' ? '复杂背景 · 保留渐变或图像' : computed.backgroundColor === 'rgba(0, 0, 0, 0)' ? '透明 · 显示下层背景' : '纯色背景';
                s.append(state);
            }
        }
        else {
            const s = section('外观');
            const common = (p: string) => {
                const values = nodes.map(n => doc.defaultView!.getComputedStyle(n).getPropertyValue(p));
                return new Set(values).size === 1 ? values[0] : '混合';
            };
            if (nodes.every(n => n.matches(editable))) {
                field(s, '字号', common('font-size'), v => format('font-size', v));
                field(s, '文字颜色', common('color'), v => format('color', v));
                const palette = document.createElement('div');
                palette.style.cssText = 'display:flex;gap:8px';
                s.append(palette);
                for (const [label, color] of [['墨色', '#20252c'], ['樱桃红', '#993344'], ['叶绿色', '#536348'], ['蓝色', '#335cff']]) {
                    const swatch = button(palette, '', () => format('color', color));
                    swatch.setAttribute('aria-label', label);
                    swatch.style.cssText = `background:${color};width:28px;min-height:28px;border-radius:50%;padding:0`;
                }
                button(floating, '字号 −', () => {
                    const value = parseFloat(common('font-size'));
                    if (!Number.isFinite(value))
                        throw Error('MIXED_SIZE: 请先指定字号');
                    format('font-size', `${Math.max(8, value - 2)}px`);
                });
                button(floating, '字号 ＋', () => {
                    const value = parseFloat(common('font-size'));
                    if (!Number.isFinite(value))
                        throw Error('MIXED_SIZE: 请先指定字号');
                    format('font-size', `${value + 2}px`);
                });
                button(floating, '粗体', () => format('font-weight', common('font-weight') === '700' ? '400' : '700'));
                button(floating, '斜体', () => format('font-style', common('font-style') === 'italic' ? 'normal' : 'italic'));
                for (const [label, value] of [['左对齐', 'left'], ['居中', 'center'], ['右对齐', 'right']])
                    button(floating, label, () => format('text-align', value));
            }
            if (kind === '图片 / 视频') {
                const input = field(s, '替换本地资源', '', () => {
                });
                input.type = 'file';
                input.accept = 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm';
                input.onchange = () => {
                    if (input.files?.[0])
                        run(() => commands.media(selected[0], input.files![0]));
                };
                button(floating, '完整显示', () => commands.style(selected, 'object-fit', 'contain'));
                button(floating, '填充裁切', () => commands.style(selected, 'object-fit', 'cover'));
            }
            if (kind === '形状') {
                field(s, '填充', common('fill'), v => commands.style(selected, 'fill', v));
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
            if (kind === '表格')
                for (const [label, value] of [['添加行', 'row'], ['添加列', 'column'], ['删除末行', 'delete-row'], ['删除末列', 'delete-column']] as const)
                    button(floating, label, () => commands.table(nodes[0].closest('table')!.dataset.ppteId!, value));
            const layout = section('位置与布局');
            const absolute = nodes.every(n => doc.defaultView!.getComputedStyle(n).position === 'absolute');
            const hint = document.createElement('p');
            hint.className = 'hint';
            hint.textContent = absolute ? '自由定位 · 拖动对象或 Alt + 方向键移动' : '原生流式布局 · Alt + 方向键调整 Grid / Flex 顺序';
            layout.append(hint);
            for (const p of ['width', 'height'])
                field(layout, p === 'width' ? '宽度' : '高度', common(p), v => commands.style(selected, p, v));
            if (absolute)
                field(layout, '旋转', '0', v => {
                    if (!Number.isFinite(Number(v)))
                        throw Error('INVALID_ANGLE');
                    commands.style(selected, 'transform', `rotate(${Number(v)}deg)`);
                });
            if (nodes.length === 1 && /grid|flex/.test(doc.defaultView!.getComputedStyle(nodes[0]).display)) {
                field(layout, '间距', common('gap'), v => commands.style(selected, 'gap', v));
                if (doc.defaultView!.getComputedStyle(nodes[0]).display.includes('grid'))
                    field(layout, '网格列', common('grid-template-columns'), v => commands.style(selected, 'grid-template-columns', v));
            }
            button(section('保护'), nodes.every(n => n.dataset.ppteLocked === 'true') ? '解除保护' : '保护对象', () => commands.lock(selected, !nodes.every(n => n.dataset.ppteLocked === 'true')));
        }
        undo.disabled = !commands.undoStack.length;
        redo.disabled = !commands.redoStack.length;
        positionTools();
    }
    const handle = document.createElement('button'); handle.type = 'button'; handle.textContent = '↘';
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
        handle.hidden = !active || selected.length !== 1 || commands.protected(n) || n.matches(editable);
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
        const view = commands.doc.defaultView!;
        view.scrollTo({ top: slide.getBoundingClientRect().top + view.scrollY, left: 0 });
        positionTools();
    }
    function thumbs() {
        pages.replaceChildren();
        const slides = Array.from(commands.doc.querySelectorAll<HTMLElement>('[data-ppte-slide]'));
        slides.forEach((slide, i) => {
            const b = button(pages, `${i + 1} · ${slide.querySelector('h1,h2,h3')?.textContent?.slice(0, 24) ?? '幻灯片'}`, () => {
                currentSlide = i;
                scrollSlide(slide);
                selected = [];
                refresh();
                thumbs();
            });
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
            scaled.append(slide.cloneNode(true));
            shadow.append(scaled);
            b.prepend(preview);
        });
        button(pages, '添加页', () => {
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
        commands = new Commands(frame.contentDocument!, () => {
            change();
            refresh();
            thumbs();
        });
        selected = [];
        range = null;
        const doc = commands.doc;
        doc.defaultView?.addEventListener('scroll', positionTools);
        const css = doc.createElement('style');
        css.dataset.ppteTransient = '';
        css.textContent = '[data-ppte-editor-hidden]{display:none!important}[data-ppte-editor-selected]{outline:2px solid #335cff!important;outline-offset:4px}[data-ppte-editor-focus]:focus-visible,[contenteditable=true]:focus-visible{outline:3px solid #335cff!important;outline-offset:4px}';
        doc.head.append(css);
        const selectTarget = (target: EventTarget | null) => {
            const e = target as Element;
            return e.closest?.('td,th') ?? e.closest?.('svg,img,video,table') ?? e.closest?.('[data-ppte-id]');
        };
        doc.addEventListener('click', e => {
            if (!active)
                return;
            const n = selectTarget(e.target) as HTMLElement | null;
            const id = n?.dataset.ppteId;
            selected = id ? (e.shiftKey ? [...new Set([...selected, id])] : [id]) : [];
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
            const n = (e.target as Element).closest<HTMLElement>(editable);
            if (!n)
                return;
            if (commands.protected(n)) {
                e.preventDefault();
                report('OBJECT_PROTECTED');
                return;
            }
            if (!before)
                before = { id: n.dataset.ppteId!, html: snapshot(n) };
        });
        const record = () => {
            if (before) {
                const n = commands.node(before.id);
                commands.record([{ id: before.id, before: before.html, after: snapshot(n) }]);
                before = undefined;
            }
        };
        doc.addEventListener('input', (e) => {
            if (!(e as InputEvent).isComposing)
                record();
        });
        doc.addEventListener('compositionstart', () => composing = true);
        doc.addEventListener('compositionend', () => { composing = false; record(); });
        doc.addEventListener('keydown', e => {
            if (e.isComposing || composing) return;
            if (!active)
                return;
            if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
                const objects = Array.from(doc.querySelectorAll<HTMLElement>('[data-ppte-id]')).filter(n => n.getBoundingClientRect().width > 0 && (!n.closest('svg') || n.matches('svg')));
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
            if (n && !n.matches(editable) && doc.defaultView!.getComputedStyle(n).position === 'absolute') {
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
                selected = ids;
                refresh();
            }, get selection() {
                return [...selected];
            }, hash: (id: string) => commands.hash(id), patch: (id: string, hash: string, patch: any) => commands.agent(id, hash, patch) };
        refresh();
        thumbs();
    }
    const keys = (e: KeyboardEvent) => {
        if (e.isComposing || composing) return;
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            run(() => commands.history(e.shiftKey));
        }
    };
    document.addEventListener('keydown', keys, true);
    let collapsed = false, propertiesCollapsed = false, zoom = 1;
    const controls = document.createElement('div'); controls.id = 'ppte-canvas-controls'; root.append(controls);
    const viewButton = (label: string, action: () => void) => {
        const b = document.createElement('button'); b.textContent = label; b.type = 'button';
        b.onmousedown = e => e.preventDefault(); b.onclick = () => { action(); resize(); positionTools(); }; controls.append(b); return b;
    };
    const leftToggle = viewButton('折叠缩略图', () => { collapsed = !collapsed; pages.hidden = collapsed; leftToggle.textContent = collapsed ? '展开缩略图' : '折叠缩略图'; });
    const rightToggle = viewButton('折叠属性', () => { propertiesCollapsed = !propertiesCollapsed; panel.hidden = propertiesCollapsed; rightToggle.textContent = propertiesCollapsed ? '展开属性' : '折叠属性'; });
    viewButton('缩小画布', () => zoom = Math.max(.25, zoom - .1));
    const zoomLabel = document.createElement('span'); controls.append(zoomLabel);
    viewButton('放大画布', () => zoom = Math.min(1.5, zoom + .1));
    viewButton('重置缩放', () => zoom = 1);
    const resize = () => {
        const top = bar.getBoundingClientRect().height + 16;
        frame.style.transformOrigin = 'top left';
        frame.style.transform = active ? `scale(${zoom})` : '';
        zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
        root.style.setProperty('--top', `${top}px`);
        if (!active) {
            frame.style.marginLeft = '0';
            frame.style.width = '100%';
            frame.style.marginTop = `${top}px`;
            frame.style.height = `calc(100% - ${top}px)`;
        }
        if (active) {
            frame.style.marginLeft = collapsed ? '16px' : '200px';
            frame.style.width = `calc((100% - ${(collapsed ? 32 : 216) + (propertiesCollapsed ? 0 : 232)}px) / ${zoom})`;
            frame.style.marginTop = `${top}px`;
            frame.style.height = `calc(100% - ${top + 96}px)`;
        }
    };
    new ResizeObserver(resize).observe(bar);
    button(bar, '阅读', () => {
        active = false;
        root.removeAttribute('data-open');
        frame.style.marginLeft = '0';
        frame.style.width = '100%';
        resize();
        refresh();
    });
    let wasActive = false;
    const suspend = () => {
        wasActive = active; active = false; root.removeAttribute('data-open');
        bar.style.display = 'none'; frame.style.transform = ''; refresh();
    };
    const resume = () => {
        active = wasActive; bar.style.display = 'flex'; root.toggleAttribute('data-open', active);
        refresh(); resize();
        const slide = commands.doc.querySelectorAll<HTMLElement>('[data-ppte-slide]')[currentSlide];
        if (slide) scrollSlide(slide);
        if (active && selected[0]) commands.node(selected[0]).focus();
    };
    // Attach to the current document after editor initialization below.
    let player: ReturnType<typeof installPlayer>;
    button(bar, '放映', () => player.start());
    frame.addEventListener('load', attach);
    attach();
    player = installPlayer(frame, { suspend, resume, current: () => currentSlide, moved: i => currentSlide = i });
    const printing = installPrint(frame, { suspend, resume, exitPresentation: () => player.exit() });
    button(more.lastElementChild as HTMLElement, '导出 PDF', () => printing.print());
    Object.assign(window, { PPTePlayer: player, PPTePrint: printing });
    return { get active() { return active; }, enable() {
            active = true;
            root.setAttribute('data-open', '');
            refresh();
            resize();
        }, hide() {
            active = false;
            root.removeAttribute('data-open');
            frame.style.marginLeft = '0';
            frame.style.width = '100%';
            resize();
            refresh();
        }, refresh };
}
