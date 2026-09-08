import { disclosure } from './accessibility.js';
import { Versions } from './versions.js';
import { readHistory } from '../../html-document/src/history-wire.js';
import { packMedia, unpackMedia } from '../../html-document/src/media-table.js';
import { workspace } from './workspace.js';
import { SaveController, loopbackAdapter, fileAdapter, recoveryFingerprint, type Draft, type Snapshot, type FileHandle } from './save.js';
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
    let associationExplained = false;
    let pendingRecovery: Draft | undefined;
    let recoveryPreviewed = false;
    let beforeRecovery: string | undefined;
    const canWrite = () => !!controller?.adapter || (isSecureContext && typeof (window as any).showOpenFilePicker === 'function');
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
    let panelInfo: HTMLElement;
    let saveDetail: HTMLElement;
    let savePanel: HTMLDetailsElement;
    const render = () => {
        const pristine = controller.revision === 0 && !controller.dirty && !pendingRecovery && !['failed','conflict'].includes(controller.state);
        bar.toggleAttribute('data-download-only', !canWrite());
        bar.toggleAttribute('data-pristine', pristine && canWrite() && !ui?.cropping);
        save.textContent = canWrite() ? '保存' : '下载更新后的文件';
        save.title = canWrite() ? '保存当前修改；Cmd/Ctrl+S' : '此浏览器不能覆盖原文件';
        if(panelInfo) panelInfo.textContent = `当前文件：${boundFileName || controller.base.name} · 最近成功：${controller.lastSavedAt ? new Date(controller.lastSavedAt).toLocaleTimeString() : '尚无写入记录'}`;
        const names = { saved: controller.lastSavedAt ? '已保存 · ' + new Date(controller.lastSavedAt).toLocaleTimeString() : '未改动', dirty: '有修改未保存 · 尚未写入文件', saving: '保存中 · 等待文件确认', draft: '有修改未保存 · 尚未写入文件', unauthorized: controller.dirty ? '有修改未保存' : '未改动', conflict: '冲突 · 修改已保留', failed: '保存失败 · 修改已保留' };
        status.textContent = (ui?.cropping ? '裁切中 · 裁切仍在调整；' + (controller.lastSavedAt && !controller.dirty ? '已提交修改已保存 · ' : '') : '') + (!canWrite() ? '此浏览器不能覆盖原文件 · ' : '') + names[controller.state] + (controller.detail && !controller.detail.startsWith('尚未关联写入文件') ? ' · ' + controller.detail : '') + (controller.draftError ? ' · 草稿恢复不可用；手动保存仍可使用' : '') + (api.versions.warning ? ' · '+api.versions.warning : '');
        if(saveDetail)saveDetail.textContent=status.textContent;
        status.title=status.textContent??'';
        if(savePanel) {
            if(['failed','conflict'].includes(controller.state))savePanel.open=true;
            const problem = ['failed','conflict','unauthorized'].includes(controller.state) && !pristine;
            associate.hidden = !canWrite() || !(associationExplained || problem);
            associate.textContent = controller.adapter ? '重新选择当前文件并保存' : '选择当前文件并保存';
            introduction.hidden = !associationExplained;
            downloadButton.hidden = !canWrite() || !problem;
            disk.hidden = controller.state !== 'conflict' || !controller.adapter;
            reread.hidden = disk.hidden;
            recoverySection.hidden = !pendingRecovery && beforeRecovery === undefined;
            recover.hidden = !pendingRecovery || !recoveryPreviewed;
            keepFile.hidden = !pendingRecovery;
            previewDraft.hidden = !pendingRecovery;
            undoRecovery.hidden = beforeRecovery === undefined;
            recoveryInfo.textContent = pendingRecovery ? `发现匹配草稿 · ${new Date(pendingRecovery.time).toLocaleString()} · 来源：本浏览器中此文件的恢复草稿。预览后选择，恢复不等于写入文件。` : '恢复前内容已保留，可返回。';
        }
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
    const saveNow = () => ui.resolvePending(() => performSave(), true);
    const performSave = async () => {
        if(associating || !controller)return;
        if(controller.composing){controller.set(controller.state, '请完成输入法组合后再保存；修改仍保留。');return;}
        if (!canWrite()) { try { download(); } catch(e) { controller.set('failed', String(e)); } return; }
        if (!controller.adapter && !associationExplained) {
            associationExplained=true; render(); savePanel.open=true; associate.focus(); return;
        }
        if(controller.state==='conflict' && controller.adapter) { savePanel.open=true; return; }
        associating=true;
        try {
            if (!controller.adapter) {
                const picker = (window as any).showOpenFilePicker;
                if (!isSecureContext || typeof picker !== 'function') {
                    controller.set('unauthorized', '此浏览器无法直接写回原文件；请明确选择“下载更新后的文件”。');
                    savePanel.open=true;
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
                associationExplained = false;
                boundFileName = handle.name;
                controller.adapter = adapter;
                controller.base = target;
                // The association action disappears when the file becomes bound.
                if (savePanel.contains(document.activeElement)) save.focus();
                controller.set(controller.dirty ? 'dirty' : 'unauthorized');
            }
            await controller.adapter?.authorize?.();
            associating=false;
            await controller.flush();
            if (controller.state === 'saved') {
                if (savePanel.contains(document.activeElement)) save.focus();
                savePanel.open=false;
            }
            if (!controller.dirty && controller.confirmedFileRevision === null) controller.set('unauthorized', '已关联所选文件，尚无本次写入记录。');
        }
        catch (e) {
            const message = String(e);
            const denied = /PERMISSION|NotAllowedError|SecurityError/.test(message);
            controller.set(message.includes('CONFLICT') ? 'conflict' : denied || message.includes('AbortError') ? 'unauthorized' : 'failed', message.includes('AbortError') ? '已取消选择；修改仍保留，可重试或下载更新文件。' : denied ? '未获得文件写入授权；修改仍保留，请重试授权或选择下载。' : '文件选择或读取失败；修改仍保留：' + message);
            savePanel.open=true;
        } finally { associating=false; }
    };
    const save = button('保存', () => void saveNow());
    save.classList.add('save-action');
    save.title = '选择当前文件以启用自动保存；Cmd/Ctrl+S，失败后可重试';
    const reread = button('重新读取文件', () => void (async () => {
        if (controller.busy || controller.composing) { controller.set(controller.state, '请等待保存或输入法组合完成后再重新读取。'); return; }
        if (!controller.adapter) { controller.set(controller.state, '尚未关联文件；请保存授权或下载当前修改。'); return; }
        if (controller.dirty && !confirm('当前修改保留为草稿；重新读取磁盘文件？'))
            return;
        try {
            if (controller.dirty)
                { beforeRecovery = controller.snapshotContent(); controller.preserveRecovery(beforeRecovery); controller.draft(); }
            const revision = controller.revision;
            const latest = await controller.adapter!.load();
            if (revision !== controller.revision || controller.busy || controller.composing) { controller.set(controller.state, '读取期间有新修改；当前内容已保留，请重试。'); return; }
            await api.mount(latest.content);
            api.versions.replace(latest.history,packMedia(latest.content).table.resources);
            openingHistory=JSON.stringify(api.versions.wire());
            controller.base = latest;
            controller.revision++;
            controller.dirty = false;
            controller.confirmedFileRevision = null;
            controller.lastSavedAt = null;
            controller.set('saved');
        }
        catch (e) {
            controller.set('failed', String(e));
        }
    })());
    const recover = button('恢复草稿', () => void (async () => {
        if (controller.busy || controller.composing) { controller.set(controller.state, '请等待保存或输入法组合完成后再恢复草稿。'); return; }
        const d = pendingRecovery;
        if (!d || !recoveryPreviewed) return;
        beforeRecovery = controller.snapshotContent();
        controller.preserveRecovery(beforeRecovery);
        controller.draft();
        // Mount can fail; retain both versions until the user explicitly chooses.
        try {
            await api.mount(d.content);
            pendingRecovery = undefined;
            controller.set(controller.adapter ? 'dirty' : 'draft');
            controller.change();
            controller.set(controller.state, '已恢复本机草稿，尚未写入文件');
        } catch(e) { controller.set('failed', '恢复失败；原内容仍可返回：' + String(e)); }
    })());
    const download = () => ui.resolvePending(() => {
        if (controller.composing) { controller.set(controller.state, '请完成输入法组合后再下载；修改仍保留。'); return; }
        const revision = controller.revision;
        const url = URL.createObjectURL(new Blob([api.encode(controller.snapshotContent(), controller.base.metadata.saveRevision + 1)], { type: 'text/html' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = (document.title.replace(/[\\/:*?"<>|]/g, '_').replace(/(?:\.ppte)?\.html$/i, '') || '作品') + '.ppte.html';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        controller.exported(revision);
    }, true);
    const downloadButton = button('下载更新后的文件', () => { try { download(); } catch (e) { controller.set('failed', String(e)); } });
    document.body.append(bar);
    const frame = document.querySelector<HTMLIFrameElement>('#ppte-frame')!;
    ui = workspace(frame, bar, () => controller?.change(), () => {if(controller)render();});
    savePanel = document.createElement('details');
    savePanel.id = 'ppte-save-panel';
    savePanel.innerHTML = '<summary>保存状态</summary><div></div>';
    const panel = savePanel.lastElementChild!;
    panelInfo = document.createElement('p');panel.append(panelInfo);
    const introduction=document.createElement('p');introduction.textContent='首次保存需要选择当前文件。授权并写入确认后，后续修改会自动保存。';
    const associate=document.createElement('button');associate.textContent='选择当前文件并保存';
    associate.onclick=()=>{ if(controller.busy || controller.composing || associating)return; controller.adapter=undefined; associationExplained=true; void saveNow(); };
    panel.append(introduction,associate,downloadButton);
    const preview = (content:string,title:string) => {
        const frame=document.createElement('iframe');frame.title=title;frame.setAttribute('sandbox','');frame.referrerPolicy='no-referrer';
        // Use the author content, not a packed standalone file with no visible body.
        frame.srcdoc=content;frame.style.cssText='width:100%;height:240px';
        panel.querySelector('iframe')?.remove();panel.append(frame);
    };
    const disk=document.createElement('button');disk.textContent='查看磁盘版本';
    disk.onclick=()=>void (async()=>{try{if(!controller.adapter)return;const latest=await controller.adapter.load();preview(latest.content,'磁盘版本（只读）');}catch(e){controller.set('failed',String(e));}})();panel.append(disk,reread);
    const recoverySection=document.createElement('section');
    const recoveryInfo=document.createElement('p');
    const previewDraft=document.createElement('button');previewDraft.textContent='预览恢复草稿';
    previewDraft.onclick=()=>{if(!pendingRecovery)return;preview(pendingRecovery.content,'恢复草稿（只读）');recoveryPreviewed=true;render();};
    const keepFile=document.createElement('button');keepFile.textContent='保留文件版本';
    keepFile.onclick=()=>{pendingRecovery=undefined;controller.dismissRecovery();panel.querySelector('iframe')?.remove();controller.set(controller.dirty?'dirty':controller.lastSavedAt?'saved':'unauthorized');};
    const undoRecovery=document.createElement('button');undoRecovery.textContent='返回恢复前内容';
    undoRecovery.onclick=()=>void (async()=>{if(beforeRecovery===undefined || controller.busy || controller.composing)return;const previous=beforeRecovery;beforeRecovery=controller.snapshotContent();await api.mount(previous);controller.change();controller.set(controller.state,'已返回恢复前内容，尚未写入文件');})();
    recoverySection.append(recoveryInfo,previewDraft,recover,keepFile,undoRecovery);panel.append(recoverySection);
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
        const base: Snapshot = adapter ? await adapter.load() : { content: api.content(), metadata: api.metadata, hash: crypto?.subtle ? await recoveryFingerprint({ content: api.content(), metadata: api.metadata }) : JSON.stringify([api.metadata.documentId, api.metadata.saveRevision, api.content()]), fileKey: location.href, name: decodeURIComponent(location.pathname.split('/').pop() || document.title) };
        controller = new SaveController(adapter, base, () => api.content(), render, storage, `ppte-draft:${location.origin}:${base.fileKey}:${base.metadata.documentId}`);
        controller.set(adapter ? 'saved' : 'unauthorized', adapter ? '' : '尚未关联写入文件；未授权不能自动覆盖原文件。可编辑、授权保存或下载更新后的文件。');
        try{if(api.versions.wire())void api.versions.index;}catch{const alert=document.createElement('p');alert.setAttribute('role','alert');alert.dataset.ppteTransient='';alert.textContent=api.versions.warning;alert.style.cssText='position:fixed;bottom:40px;left:16px;z-index:120;background:white;color:#a22;padding:12px';document.body.append(alert);}
        const draft = controller.recover();
        if (draft) {
            pendingRecovery = draft;
            controller.preserveRecovery(draft.content, draft);
            controller.set(draft.base === (base.recoveryHash ?? base.hash) ? 'unauthorized' : 'conflict', '发现匹配草稿；请进入编辑后预览恢复草稿。尚未写入文件。' + (draft.base === (base.recoveryHash ?? base.hash) ? '' : '草稿基准与当前文件不同，请核对预览。'));
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
        if (controller?.dirty || ui?.pendingInteraction) {
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
