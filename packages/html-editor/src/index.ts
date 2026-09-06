import { workspace } from './workspace.js';
import { SaveController, loopbackAdapter, fileAdapter, sha, type Snapshot, type FileHandle } from './save.js';
interface API {
    contentDocument: Document | null;
    metadata: any;
    serialize(): string;
    content(): string;
    mount(s: string): Promise<void>;
    encode(s: string, revision: number): string;
}
export function installEditor(api: API) {
    let controller: SaveController;
    let editing = false;
    let ui: ReturnType<typeof workspace>;
    let token = new URLSearchParams(location.hash.slice(1)).get('token');
    // Parent session storage permits reload; capabilities never enter serialized HTML or content.
    if (location.hostname === '127.0.0.1') {
        try {
            if (token)
                sessionStorage.setItem('ppte-session', token);
            else
                token = sessionStorage.getItem('ppte-session');
        }
        catch {
        }
    }
    if (location.hash.startsWith('#token='))
        history.replaceState(null, '', location.pathname);
    const bar = document.createElement('nav');
    bar.id = 'ppte-save-ui';
    bar.setAttribute('data-ppte-transient', '');
    bar.hidden = true;
    bar.style.cssText = 'position:fixed;z-index:100;top:8px;left:8px;right:8px;padding:10px;background:#20242c;color:#fff;font:14px system-ui;border-radius:8px;display:none;gap:8px;align-items:center';
    const status = document.createElement('span');
    status.setAttribute('role', 'status');
    status.style.flex = '1';
    const button = (label: string, action: () => void) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.onclick = action;
        bar.append(b);
        return b;
    };
    const names = { saved: '已保存到原文件', dirty: '有修改 · 尚未写入文件', saving: '保存中 · 等待文件确认', draft: '仅草稿 · 尚未写入文件', unauthorized: '无文件授权', conflict: '冲突 · 修改已保留', failed: '保存失败 · 可重试' };
    const render = () => {
        const menu = bar.querySelector('details');
        if (menu && controller.state === 'conflict')
            menu.open = true;
        status.textContent = names[controller.state] + (controller.detail ? '：' + controller.detail : '');
    };
    const enable = () => {
        editing = true;
        ui?.enable();
        bar.hidden = false;
        bar.style.display = 'flex';
        ui?.refresh();
    };
    button('编辑', () => {
        enable();
        if (!controller.adapter)
            controller.set('draft', '直开不能自动覆盖原文件。首次保存请选择原文件授权，或运行 ppte edit "作品.html"。');
    });
    bar.append(status);
    const save = button('保存 / 授权', () => void (async () => {
        try {
            if (!controller.adapter) {
                const picker = (window as any).showOpenFilePicker;
                if (!isSecureContext || typeof picker !== 'function') {
                    controller.set('unauthorized', '此浏览器不能覆盖原文件。请在终端运行 ppte edit "作品.html"；此处只有草稿。');
                    return;
                }
                const [handle]: FileHandle[] = await picker({ multiple: false, types: [{ description: 'HTML', accept: { 'text/html': ['.html'] } }] });
                if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted')
                    throw Error('PERMISSION_REVOKED');
                const adapter = fileAdapter(handle, text => {
                    const inert = new DOMParser().parseFromString(text, 'text/html');
                    return { content: inert.querySelector<HTMLTemplateElement>('#ppte-content')?.content.textContent ?? '', metadata: JSON.parse(inert.querySelector('#ppte-metadata')!.textContent!), hash: '', fileKey: handle.name, name: handle.name };
                }, api.encode);
                const target = await adapter.load();
                if (target.metadata.documentId !== controller.base.metadata.documentId || target.content !== controller.base.content)
                    throw Error('CONFLICT: 所选文件不匹配打开时的内容');
                controller.adapter = adapter;
                controller.base = target;
            }
            await controller.adapter?.authorize?.();
            await controller.flush();
        }
        catch (e) {
            controller.set(String(e).includes('CONFLICT') ? 'conflict' : 'unauthorized', String(e));
        }
    })());
    save.title = 'Cmd/Ctrl+S，失败后可重试';
    button('重新读取文件', () => void (async () => {
        if (controller.dirty && !confirm('当前修改保留为草稿；重新读取磁盘文件？'))
            return;
        try {
            if (controller.dirty)
                controller.draft();
            const latest = await controller.adapter!.load();
            controller.base = latest;
            controller.dirty = false;
            await api.mount(latest.content);
            controller.set('saved');
        }
        catch (e) {
            controller.set('failed', String(e));
        }
    })());
    button('恢复草稿', () => void (async () => {
        const d = controller.recover();
        if (!d)
            return;
        if (d.base !== controller.base.hash) {
            controller.set('conflict', '草稿与磁盘不同；请先复制保留草稿，再重新读取。');
            return;
        }
        await api.mount(d.content);
        controller.change();
    })());
    button('复制恢复草稿', () => {
        const d = controller.recover();
        if (d)
            void navigator.clipboard.writeText(api.encode(d.content, controller.base.metadata.saveRevision + 1)).catch(() => controller.set('failed', '剪贴板不可用，草稿仍保留'));
    });
    button('复制保留当前修改', () => void navigator.clipboard.writeText(api.serialize()).then(() => controller.set(controller.state, '已复制 HTML；尚未写入文件')).catch(() => controller.set(controller.state, '剪贴板不可用，修改仍在当前页面')));
    if (token)
        button('恢复上一版本', () => void (async () => {
            try {
                const headers = { Authorization: `Bearer ${token}` };
                const versions = await (await fetch('/api/versions', { headers })).json();
                if (!versions.length)
                    throw Error('没有历史版本');
                if (!confirm('将恢复上一版本；当前磁盘版本会保留在恢复记录中。'))
                    return;
                if (controller.dirty)
                    controller.draft();
                const response = await fetch('/api/restore', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ expected: controller.base.hash, version: versions[0] }) });
                const result = await response.json();
                if (!response.ok)
                    throw Error(result.error);
                controller.base = result;
                controller.dirty = false;
                await api.mount(result.content);
                controller.set('saved');
            }
            catch (e) {
                controller.set('failed', String(e));
            }
        })());
    button('收起', () => {
        bar.style.display = 'none';
    });
    document.body.append(bar);
    // Reserve actual toolbar height so the first editable line remains pointer-accessible.
    const frame = document.querySelector<HTMLIFrameElement>('#ppte-frame')!;
    new ResizeObserver(() => {
        const inset = bar.getBoundingClientRect().height;
        frame.style.marginTop = inset ? `${inset + 16}px` : '0';
        frame.style.height = inset ? `calc(100% - ${inset + 16}px)` : '100%';
    }).observe(bar);
    const launch = document.createElement('button');
    launch.textContent = '编辑 / 保存';
    launch.setAttribute('data-ppte-transient', '');
    launch.style.cssText = 'position:fixed;right:12px;bottom:12px;opacity:0';
    launch.onfocus = () => launch.style.opacity = '1';
    launch.onmouseenter = () => launch.style.opacity = '1';
    launch.onmouseleave = () => launch.style.opacity = '0';
    launch.onclick = () => {
        bar.hidden = false;
        bar.style.display = 'flex';
    };
    document.body.append(launch);
    ui = workspace(frame, bar, () => controller?.change());
    bar.hidden = false;
    bar.style.display = 'flex';
    const initialize = async () => {
        let storage: Storage | undefined;
        try {
            storage = localStorage;
        }
        catch {
        }
        const adapter = token && location.hostname === '127.0.0.1' ? loopbackAdapter(token) : undefined;
        const base: Snapshot = adapter ? await adapter.load() : { content: api.content(), metadata: api.metadata, hash: crypto?.subtle ? await sha(api.content()) : api.content(), fileKey: location.href, name: document.title };
        controller = new SaveController(adapter, base, () => api.content(), render, storage, `ppte-draft:${location.origin}:${base.fileKey}`);
        controller.set(adapter ? 'saved' : 'unauthorized', adapter ? '' : '直开未绑定原文件；编辑仅暂存草稿。使用 ppte edit "作品.html" 获得原文件自动保存。');
        const draft = controller.recover();
        if (draft && draft.base === base.hash) {
            await api.mount(draft.content);
            controller.change();
        }
        if (adapter) {
            if (!draft && api.content() !== base.content)
                await api.mount(base.content);
            bar.hidden = false;
            enable();
        }
        (window as any).PPTeSave = controller;
    };
    const attach = () => {
        const doc = api.contentDocument!;
        if (editing)
            enable();
        doc.addEventListener('input', () => controller?.change());
        doc.addEventListener('compositionstart', () => controller?.composition(true));
        doc.addEventListener('compositionend', () => controller?.composition(false));
        doc.addEventListener('keydown', keys);
    };
    const keys = (event: KeyboardEvent) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            save.click();
        }
        if (event.key === 'Escape') {
            bar.style.display = 'none';
            ui.hide();
        }
    };
    document.addEventListener('keydown', keys);
    document.querySelector('#ppte-frame')!.addEventListener('load', attach);
    attach();
    window.addEventListener('beforeunload', event => {
        if (controller?.dirty) {
            event.preventDefault();
            event.returnValue = '';
        }
    });
    void initialize().catch(e => {
        bar.hidden = false;
        bar.style.display = 'flex';
        status.textContent = '无法连接原文件；请重新运行 ppte edit 并打开新链接。' + String(e);
    });
}
