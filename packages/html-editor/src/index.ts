import { disclosure } from './accessibility.js';
import { Versions } from './versions.js';
import { readHistory } from '../../html-document/src/history-wire.js';
import { packMedia, unpackMedia } from '../../html-document/src/media-table.js';
import { workspace } from './workspace.js';
import { SaveController, loopbackAdapter, fileAdapter, recoveryFingerprint, type Snapshot, type FileHandle } from './save.js';
interface API {
    contentDocument: Document | null;
    metadata: any;
    serialize(): string;
    content(): string;
    normalize(s: string): string;
    mount(s: string): Promise<void>;
    encode(s: string, revision: number, documentId?: string, withoutHistory?:boolean): string;
    versions:Versions;
}
export function installEditor(api: API) {
    let controller: SaveController;
    let openingHistory=JSON.stringify(api.versions.wire());
    let boundFileName = '';
    let associating = false;
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
    bar.hidden = false;
    bar.style.cssText = 'position:fixed;z-index:100;top:8px;left:8px;right:8px;padding:10px;background:#20242c;color:#fff;font:14px system-ui;border-radius:8px;display:flex;gap:8px;align-items:center';
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
    const names = { saved: '已保存到原文件', dirty: '有修改 · 尚未写入文件', saving: '保存中 · 等待文件确认', draft: '修改尚未写入文件 · 仅草稿', unauthorized: '尚未保存 · 无文件授权', conflict: '冲突 · 修改已保留', failed: '保存失败 · 可重试' };
    let panelInfo: HTMLElement;
    let saveDetail: HTMLElement;
    let savePanel: HTMLDetailsElement;
    const render = () => {
        bar.toggleAttribute('data-pristine', controller.revision === 0 && !controller.dirty && ((controller.state === 'unauthorized' && controller.detail.startsWith('尚未关联写入文件')) || (controller.state === 'saved' && !controller.detail)));
        if(panelInfo) panelInfo.textContent = `文件：${boundFileName || controller.base.name} · ${controller.adapter?'已关联':'未关联'} · 最近成功：${controller.lastSavedAt ? new Date(controller.lastSavedAt).toLocaleTimeString() : '尚无写入记录'}`;
        status.textContent = (controller.detail.startsWith('已发起下载') ? controller.detail : (controller.state === 'saved' && boundFileName ? '已保存到所选文件：' + boundFileName + (controller.lastSavedAt ? ' · ' + new Date(controller.lastSavedAt).toLocaleTimeString() : '') : names[controller.state]) + (controller.detail ? '：' + controller.detail : '')) + (controller.dirty && !controller.draftAvailable ? ' · 草稿恢复不可用；请保存或下载' : '') + (api.versions.warning?' · '+api.versions.warning:'');
        if(saveDetail)saveDetail.textContent=status.textContent;
        status.title=status.textContent??'';
        if(savePanel && ['failed','conflict'].includes(controller.state))savePanel.open=true;
    };
    const enable = () => {
        ui?.enable();
        bar.hidden = false;
        bar.style.display = 'flex';
        ui?.refresh();
    };
    button('编辑', () => {
        enable();

    });
    bar.append(status);
    const save = button('保存', () => void (async () => {
        if(associating)return;
        associating=true;
        try {
            if (!controller.adapter) {
                const picker = (window as any).showOpenFilePicker;
                if (!isSecureContext || typeof picker !== 'function') {
                    download();
                    return;
                }
                const [handle]: FileHandle[] = await picker({ multiple: false, types: [{ description: 'HTML', accept: { 'text/html': ['.html'] } }] });
                if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted')
                    throw Error('PERMISSION_REVOKED');
                const adapter = fileAdapter(handle, text => {
                    const inert = new DOMParser().parseFromString(text, 'text/html');
                    return { history:readHistory(text), content: api.normalize(unpackMedia(inert.querySelector<HTMLTemplateElement>('#ppte-content')?.content.textContent ?? '', inert.querySelector('#ppte-media') ? JSON.parse(inert.querySelector('#ppte-media')!.textContent!) : undefined)), metadata: JSON.parse(inert.querySelector('#ppte-metadata')!.textContent!), hash: '', fileKey: handle.name, name: handle.name };
                }, (content,revision)=>api.encode(content,revision));
                const target = await adapter.load();
                const targetHistory=JSON.stringify(new Versions(target.metadata.documentId,target.history,()=>packMedia(target.content).table.resources).wire());
                if(targetHistory!==openingHistory)throw Error('CONFLICT: 所选文件的历史已变化');
                if (target.metadata.documentId !== controller.base.metadata.documentId || target.content !== controller.base.content || target.metadata.saveRevision !== controller.base.metadata.saveRevision)
                    throw Error('CONFLICT: 所选文件不匹配打开时的内容');
                boundFileName = handle.name;
                controller.adapter = adapter;
                controller.base = target;
                controller.set(controller.dirty ? 'dirty' : 'unauthorized');
            }
            await controller.adapter?.authorize?.();
            associating=false;
            await controller.flush();
            if (controller.state === 'unauthorized') download();
            if (!controller.dirty && controller.confirmedFileRevision === null) controller.set('unauthorized', '已关联所选文件，尚无本次写入记录。');
        }
        catch (e) {
            const message = String(e);
            controller.set(message.includes('CONFLICT') ? 'conflict' : 'unauthorized', message.includes('AbortError') ? '已取消选择；修改仍保留，可重试或下载更新文件。' : message);
            if (message.includes('PERMISSION') || message.includes('NotAllowedError') || message.includes('SecurityError')) download();
        } finally { associating=false; }
    })());
    save.classList.add('save-action');
    save.title = '选择当前文件以启用自动保存；Cmd/Ctrl+S，失败后可重试';
    const reread = button('重新读取文件', () => void (async () => {
        if (controller.busy || controller.composing) { controller.set(controller.state, '请等待保存或输入法组合完成后再重新读取。'); return; }
        if (!controller.adapter) { controller.set(controller.state, '尚未关联文件；请保存授权或下载当前修改。'); return; }
        if (controller.dirty && !confirm('当前修改保留为草稿；重新读取磁盘文件？'))
            return;
        try {
            if (controller.dirty)
                controller.draft();
            const revision = controller.revision;
            const latest = await controller.adapter!.load();
            if (revision !== controller.revision || controller.busy || controller.composing) { controller.set(controller.state, '读取期间有新修改；当前内容已保留，请重试。'); return; }
            api.versions.replace(latest.history,packMedia(latest.content).table.resources);
            openingHistory=JSON.stringify(api.versions.wire());
            controller.base = latest;
            controller.revision++;
            controller.dirty = false;
            await api.mount(latest.content);
            controller.set('saved');
        }
        catch (e) {
            controller.set('failed', String(e));
        }
    })());
    const recover = button('恢复草稿', () => void (async () => {
        if (controller.busy || controller.composing) { controller.set(controller.state, '请等待保存或输入法组合完成后再恢复草稿。'); return; }
        const d = controller.recover();
        if (!d)
            return;
        if (d.base !== (controller.base.recoveryHash ?? controller.base.hash)) {
            controller.set('conflict', '草稿与磁盘不同；请先复制保留草稿，再重新读取。');
            return;
        }
        await api.mount(d.content);
        controller.change();
        controller.set(controller.state, '已恢复本机草稿，尚未写入文件');
    })());
    const copyDraft = button('复制恢复草稿', () => {
        const d = controller.recover();
        if (d)
            void navigator.clipboard.writeText(api.encode(d.content, controller.base.metadata.saveRevision + 1)).catch(() => controller.set('failed', '剪贴板不可用，草稿仍保留'));
    });
    const copyCurrent = button('复制保留当前修改', () => void navigator.clipboard.writeText(api.serialize()).then(() => controller.set(controller.state, '已复制 HTML；尚未写入文件')).catch(() => controller.set(controller.state, '剪贴板不可用，修改仍在当前页面')));
    const download = () => {
        if (controller.composing) { controller.set(controller.state, '请完成输入法组合后再下载；修改仍保留。'); return; }
        const revision = controller.revision;
        const url = URL.createObjectURL(new Blob([api.encode(controller.snapshotContent(), controller.base.metadata.saveRevision + 1)], { type: 'text/html' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = (document.title.replace(/[\\/:*?"<>|]/g, '_').replace(/(?:\.ppte)?\.html$/i, '') || '作品') + '.ppte.html';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        controller.exported(revision);
    };
    const downloadButton = button('下载更新后的文件', () => { try { download(); } catch (e) { controller.set('failed', String(e)); } });
    document.body.append(bar);
    const frame = document.querySelector<HTMLIFrameElement>('#ppte-frame')!;
    ui = workspace(frame, bar, () => controller?.change());
    savePanel = document.createElement('details');
    savePanel.id = 'ppte-save-panel';
    savePanel.innerHTML = '<summary>保存状态</summary><div></div>';
    const panel = savePanel.lastElementChild!;
    panelInfo = document.createElement('p');panel.append(panelInfo,reread,recover,copyDraft,copyCurrent,downloadButton);
    const autoLabel = document.createElement('label');
    const auto = document.createElement('input');auto.type='checkbox';auto.checked=true;
    auto.onchange=()=>controller.setAutoSave(auto.checked);
    autoLabel.append(auto,'自动保存');panel.append(autoLabel);
    const associate=document.createElement('button');associate.textContent='关联文件并保存';associate.onclick=()=>save.click();
    if(isSecureContext && typeof (window as any).showOpenFilePicker==='function')panel.append(associate);
    else { const hint=document.createElement('p');hint.textContent='此浏览器不能关联原文件；请下载更新后的文件。';panel.append(hint); }
    const disk=document.createElement('button');disk.textContent='查看磁盘版本';
    disk.onclick=()=>void (async()=>{try{if(!controller.adapter)return;const latest=await controller.adapter.load();const preview=document.createElement('iframe');preview.title='磁盘版本（只读）';preview.sandbox.add('');preview.srcdoc=latest.content;preview.style.cssText='width:100%;height:240px';panel.querySelector('iframe')?.remove();panel.append(preview);}catch(e){controller.set('failed',String(e));}})();panel.append(disk);
    const summary=savePanel.querySelector('summary')!;summary.textContent='';summary.setAttribute('aria-label','保存状态');summary.append(status);
    saveDetail=document.createElement('p');saveDetail.className='save-detail';panel.prepend(saveDetail);
    bar.append(savePanel); disclosure(savePanel);
    const initialize = async () => {
        let storage: Storage | undefined;
        try {
            storage = localStorage;
        }
        catch {
        }
        const adapter = token && location.hostname === '127.0.0.1' ? loopbackAdapter(token,()=>api.versions.wire()) : undefined;
        const base: Snapshot = adapter ? await adapter.load() : { content: api.content(), metadata: api.metadata, hash: crypto?.subtle ? await recoveryFingerprint({ content: api.content(), metadata: api.metadata }) : JSON.stringify([api.metadata.documentId, api.metadata.saveRevision, api.content()]), fileKey: location.href, name: document.title };
        controller = new SaveController(adapter, base, () => api.content(), render, storage, `ppte-draft:${location.origin}:${base.fileKey}:${base.metadata.documentId}`);
        controller.set(adapter ? 'saved' : 'unauthorized', adapter ? '' : '尚未关联写入文件；未授权不能自动覆盖原文件。可编辑、授权保存或下载更新后的文件。');
        try{if(api.versions.wire())void api.versions.index;}catch{const alert=document.createElement('p');alert.setAttribute('role','alert');alert.dataset.ppteTransient='';alert.textContent=api.versions.warning;alert.style.cssText='position:fixed;bottom:40px;left:16px;z-index:120;background:white;color:#a22;padding:12px';document.body.append(alert);}
        const draft = controller.recover();
        if (draft && draft.base === (base.recoveryHash ?? base.hash)) {
            if (adapter) { await api.mount(draft.content); controller.change(); }
            else controller.set('unauthorized', '发现匹配草稿；请进入编辑，在保存状态中选择恢复草稿。尚未写入文件。');
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
        if (ui?.active)
            enable();
        // Commands owns input/IME history and emits one dirty revision.
        doc.addEventListener('compositionstart', () => controller?.composition(true));
        doc.addEventListener('compositionend', () => controller?.composition(false));
        doc.addEventListener('keydown', keys);
    };
    const keys = (event: KeyboardEvent) => {
        if ((event.target as Element).closest?.('dialog[open]')) return;
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            save.click();
        }
        if (event.key === 'Escape') {
            bar.style.display = 'flex';
            ui.hide();
        }
    };
    document.addEventListener('keydown', keys);
    document.querySelector('#ppte-frame')!.addEventListener('load', attach);
    attach();
    window.addEventListener('beforeunload', event => {
        if (controller?.dirty) {
            controller.draft();
            event.preventDefault();
            event.returnValue = '';
        }
    });
    document.addEventListener('visibilitychange', () => { if(document.hidden && controller?.dirty)controller.draft(); });
    window.addEventListener('pagehide', () => { if(controller?.dirty)controller.draft(); });
    void initialize().catch(e => {
        bar.hidden = false;
        bar.style.display = 'flex';
        status.textContent = '保存初始化失败；内容仍可阅读。' + String(e);
    });
}
