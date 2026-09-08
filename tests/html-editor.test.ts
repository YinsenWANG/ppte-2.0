import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { enhanceHTML, readEnhanced } from '../packages/html-document/src/index.js';
import { startEditor } from '../packages/html-save/src/index.js';
import { resizeViewport } from './helpers/browser-viewport.js';
const evidence = resolve('artifacts/h03');
const source = `<title>日常编辑 · HTML 原作</title><style>body{margin:32px;font:20px system-ui;color:#20252c;background:#f6f0e6}section{min-height:520px;position:relative}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.flex{display:flex;gap:16px}svg{width:120px;height:90px}img{width:80px;height:80px}td{padding:8px;border:1px solid #666}h1{font-size:40px}h2{font-size:28px}</style><section data-ppte-slide data-ppte-id="slide"><h1 data-ppte-id="title">一句话保持原作</h1><div class="grid" data-ppte-id="grid"><p data-ppte-id="a">第一个句子</p><p data-ppte-id="b" style="color:#993344">第二个句子</p></div><div class="flex" data-ppte-id="flex"><img data-ppte-id="image" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="><svg data-ppte-id="shape" viewBox="0 0 120 90"><rect width="120" height="90" fill="currentColor"/></svg></div><table data-ppte-id="table"><tr><td data-ppte-id="cell">数据</td><td>42</td></tr></table><div data-ppte-id="absolute" data-ppte-kind="shape" style="position:absolute;left:420px;top:350px;width:60px;height:60px;background:#993344"></div></section><section data-ppte-slide data-ppte-id="second"><h2>再次打开仍然是原作</h2></section>`;
async function setup() {
    await mkdir(evidence, { recursive: true });
    const root = await mkdtemp(join(tmpdir(), 'h03-'));
    const file = join(root, '作品.html');
    await writeFile(file, (await enhanceHTML(source, { root, base: root })).html);
    const server = await startEditor(file, { cacheDir: join(root, 'cache') });
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(10000);
    await page.goto(server.url);
    await page.waitForFunction(() => !!(window as any).PPTeSave && (window as any).PPTeEditor);
    return { root, file, server, browser, page, async close() {
            await browser.close();
            await server.close();
            await rm(root, { recursive: true, force: true });
        } };
}
async function select(page: Page, ids: string[]) {
    await page.evaluate(ids => (window as any).PPTeEditor.select(ids), ids);
}
test('H03 acceptance 2/3: viewport changes retain focused format control, selection and original DOM without edits', async () => {
    const f = await setup();
    try {
        const { page } = f;
        await select(page, ['title']);
        const input = page.getByLabel('字号', { exact: true });
        await input.focus();
        const original = await input.elementHandle();
        await input.evaluate(n => (n as HTMLInputElement).setSelectionRange(0, 2));
        await page.evaluate(() => {
            const c = (window as any).PPTeEditor.commands;
            (window as any).resizeBaseline = { title: c.node('title'), slide: c.node('slide'), history: c.undoStack.length };
        });
        for (const width of [900, 1440, 900, 1440]) {
            await resizeViewport(page, { width, height: 1000 });
            // No refocus or assertion retry: resize must preserve keyboard ownership.
            assert.deepEqual(await original!.evaluate(n => ({
                connected: n.isConnected, focused: n === n.ownerDocument.activeElement,
                start: (n as HTMLInputElement).selectionStart, end: (n as HTMLInputElement).selectionEnd,
            })), { connected: true, focused: true, start: 0, end: 2 });
            assert.equal(await page.evaluate(() => innerWidth), width);
            assert.deepEqual(await page.evaluate(() => {
                const c = (window as any).PPTeEditor.commands, before = (window as any).resizeBaseline;
                return { title: c.node('title') === before.title, slide: c.node('slide') === before.slide, history: c.undoStack.length === before.history };
            }), { title: true, slide: true, history: true });
        }
        await original!.dispose();
    }
    finally {
        await f.close();
    }
});
test('H03 acceptance 1: real object selection, empty/multiple/mixed contextual shell and screenshots', async () => {
    const f = await setup();
    try {
        const { page } = f;
        const frame = page.frameLocator('#ppte-frame');
        for (const [id, kind] of [['title', '文字'], ['image', '图片 / 视频'], ['shape', '形状'], ['table', '表格']]) {
            await frame.locator(`[data-ppte-id="${id}"]`).click();
            assert.equal(await page.locator('#ppte-properties h3').textContent(), kind);
            await page.screenshot({ path: join(evidence, `${id}.png`) });
        }
        await select(page, []);
        assert.equal(await page.locator('#ppte-properties h3').textContent(), '空选区');
        assert.equal(await page.locator('#ppte-floating button').count(), 0);
        await page.screenshot({ path: join(evidence, 'empty.png') });
        await frame.locator('[data-ppte-id=a]').click();
        await frame.locator('[data-ppte-id=b]').click({ modifiers: ['Shift'] });
        assert.equal(await page.locator('#ppte-properties h3').textContent(), '多选');
        assert.equal(await page.locator('.color-field span').textContent(), '混合');
        await page.getByRole('button', { name: '粗体', exact: true }).click();
        assert.deepEqual(await page.evaluate(() => ['a', 'b'].map(id => (window as any).PPTeEditor.commands.node(id).style.fontWeight)), ['700', '700']);
        await page.screenshot({ path: join(evidence, 'mixed.png') });
        assert.deepEqual(await page.getByLabel('字体',{exact:true}).locator('option').allTextContents(), ['系统无衬线','衬线','等宽']);
        assert.equal(await page.getByRole('button', { name: '第 2 页', exact: true }).count(), 1);
    }
    finally {
        await f.close();
    }
});
test('H03 acceptance 2: computed normal text contrast >=4.5, visible keyboard focus and keyboard object/format path', async () => {
    const f = await setup();
    try {
        const { page } = f;
        await select(page, ['title']);
        const ratios = await page.evaluate(() => {
            const rgb = (s: string) => s.match(/[\d.]+/g)!.slice(0, 3).map(Number);
            const lum = (s: string) => rgb(s).map(c => {
                c /= 255;
                return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
            }).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
            return Array.from(document.querySelectorAll<HTMLElement>('#ppte-save-ui button:not(:disabled),#ppte-save-ui strong,#ppte-save-ui [role=status],#ppte-properties label,#ppte-properties h3,#ppte-properties p,#ppte-floating button')).filter(n => n.getBoundingClientRect().height).map(n => {
                const s = getComputedStyle(n);
                let p: HTMLElement | null = n, bg = 'rgb(255,255,255)';
                while (p) {
                    const b = getComputedStyle(p).backgroundColor;
                    if (b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') {
                        bg = b;
                        break;
                    }
                    p = p.parentElement;
                }
                const a = lum(s.color), b = lum(bg);
                return { text: n.textContent, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
            });
        });
        assert.ok(ratios.length > 8);
        for (const r of ratios)
            assert.ok(r.ratio >= 4.5, JSON.stringify(r));
        await writeFile(join(evidence, 'contrast.json'), JSON.stringify(ratios, null, 2));
        await page.getByRole('button', { name: '粗体', exact: true }).focus();
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => {
            const e = document.activeElement!;
            const s = getComputedStyle(e);
            return { label: e.getAttribute('aria-label')??e.textContent, outline: s.outlineWidth, style: s.outlineStyle };
        });
        assert.equal(focused.label, '斜体');
        assert.equal(focused.outline, '3px');
        assert.equal(focused.style, 'solid');
        await page.keyboard.press('Enter');
        assert.equal(await page.frameLocator('#ppte-frame').locator('[data-ppte-id=title]').evaluate(n => (n as HTMLElement).style.fontStyle), 'italic');
        await page.frameLocator('#ppte-frame').locator('h1').focus();
        await page.keyboard.press('Tab');
        assert.notDeepEqual(await page.evaluate(() => (window as any).PPTeEditor.selection), ['title']);
        await page.evaluate(() => {
            const e = (window as any).PPTeEditor;
            const nodes = Array.from(e.commands.doc.querySelectorAll('[data-ppte-id]')).filter((n: any) => n.getBoundingClientRect().width > 0) as HTMLElement[];
            e.select([nodes.at(-1)!.dataset.ppteId]);
            nodes.at(-1)!.setAttribute('tabindex', '0');
            nodes.at(-1)!.focus();
        });
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement?.textContent), '阅读');
        assert.equal(await page.getByRole('group',{name:'文档模式'}).getByRole('button',{name:'编辑',exact:true}).getAttribute('aria-pressed'),'true');
        await page.screenshot({ path: join(evidence, 'keyboard-focus.png') });
    }
    finally {
        await f.close();
    }
});
test('H03 acceptance 3: local text/range history preserves sibling identity, native Grid/Flex strategies and protected Agent hash', async () => {
    const f = await setup();
    try {
        const { page } = f;
        const result = await page.evaluate(async () => {
            const e = (window as any).PPTeEditor, c = e.commands, d = c.doc;
            const slide = c.node('slide'), sibling = c.node('b'), title = c.node('title');
            c.text('a', '改一句话');
            if (c.node('slide') !== slide || c.node('b') !== sibling)
                throw Error('REBUILT_PAGE');
            c.history();
            if (c.node('a').textContent !== '第一个句子')
                throw Error('UNDO');
            c.history(true);
            c.move('a', 8, 0);
            c.move('image', -8, 0);
            c.move('absolute', 8, 16);
            c.style(['grid'], 'gap', '32px');
            c.style(['grid'], 'grid-template-columns', '2fr 1fr');
            if (c.node('b') !== sibling)
                throw Error('STYLE_REBUILT_CHILD');
            const hash = await e.hash('title');
            await e.patch('title', hash, { text: 'Agent 局部修改' });
            let stale = false, protectedNode = false;
            try {
                await e.patch('title', hash, { text: '旧请求' });
            }
            catch {
                stale = true;
            }
            c.lock(['title'], true);
            try {
                await e.patch('title', await e.hash('title'), { text: '覆盖保护' });
            }
            catch {
                protectedNode = true;
            }
            const before = c.node('slide').outerHTML;
            let parentRejected = false;
            try {
                c.transaction(['slide'], (n: HTMLElement) => n.textContent = '破坏');
            }
            catch {
                parentRejected = true;
            }
            return { sameTitle: c.node('title') === title, stale, protectedNode, parentRejected, parentUnchanged: before === c.node('slide').outerHTML, grid: getComputedStyle(c.node('grid')).display, flex: getComputedStyle(c.node('flex')).display, a: c.node('a').style.position, order: c.node('a').style.order, transform: c.node('absolute').style.transform };
        });
        assert.deepEqual(result, { sameTitle: true, stale: true, protectedNode: true, parentRejected: true, parentUnchanged: true, grid: 'grid', flex: 'flex', a: '', order: '1', transform: 'translate(8px, 16px)' });
        await select(page, ['a']);
        await page.evaluate(() => {
            const d = (window as any).PPTeEditor.commands.doc, n = d.querySelector('[data-ppte-id=a]');
            const r = d.createRange();
            r.setStart(n.firstChild, 0);
            r.setEnd(n.firstChild, 2);
            d.getSelection().removeAllRanges();
            d.getSelection().addRange(r);
        });
        await page.waitForTimeout(30);
        await page.getByRole('button', { name: '粗体', exact: true }).click();
        assert.equal(await page.frameLocator('#ppte-frame').locator('[data-ppte-id=a] span').textContent(), '改一');
        await page.getByRole('button', { name: '撤销', exact: true }).click();
        assert.equal(await page.frameLocator('#ppte-frame').locator('[data-ppte-id=a] span').count(), 0);
        await page.getByRole('button', { name: '重做', exact: true }).click();
        assert.equal(await page.frameLocator('#ppte-frame').locator('[data-ppte-id=a] span').count(), 1);
    }
    finally {
        await f.close();
    }
});
test('H03 acceptance 4: original-file reopen retains text, range style, layout, media, table/background/lock; errors retain work', async () => {
    const f = await setup();
    try {
        let page = f.page;
        await select(page, ['image']);
        const replacement=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;const context=canvas.getContext('2d')!;context.fillStyle='#993344';context.fillRect(0,0,2,2);return canvas.toDataURL('image/png');});
        const previous=await page.frameLocator('#ppte-frame').locator('[data-ppte-id=image]').getAttribute('src');assert.notEqual(previous,replacement);
        await page.getByLabel('替换本地资源').setInputFiles({name:'red.png',mimeType:'image/png',buffer:Buffer.from(replacement.split(',')[1],'base64')});
        await page.waitForFunction(src=>(window as any).PPTeEditor.commands.node('image').getAttribute('src')===src,replacement);
        await page.evaluate(async () => {
            const c = (window as any).PPTeEditor.commands;
            c.text('title', '关闭重开');
            c.style(['title'], 'color', '#993344');
            c.style(['shape'], 'fill', '#335cff');
            c.style(['slide'], 'background', '#f0e8de');
            c.style(['grid'], 'gap', '32px');
            c.move('a', 8, 0);
            c.table('table', 'row');
            c.table('table', 'column');
            c.lock(['title'], true);
        });
        await page.waitForFunction(() => (window as any).PPTeSave.state === 'saved');
        const saved = readEnhanced(await readFile(f.file, 'utf8')).content;
        assert.doesNotMatch(saved, /contenteditable|ppte-editor-|ppte-workspace/);
        await writeFile(join(evidence, 'example.html'), await readFile(f.file));
        await page.close();
        page = await f.browser.newPage({ viewport: { width: 1440, height: 1000 } });
        await page.goto(f.server.url);
        await page.waitForFunction(() => !!(window as any).PPTeSave);
        const state = await page.evaluate(() => {
            const c = (window as any).PPTeEditor.commands;
            return { title: c.node('title').textContent, color: c.node('title').style.color, locked: c.node('title').contentEditable, gap: c.node('grid').style.gap, order: c.node('a').style.order, rows: c.node('table').rows.length, cols: c.node('table').rows[0].cells.length, src: c.node('image').getAttribute('src'), fill: c.node('shape').style.fill, background: c.node('slide').style.background };
        });
        assert.equal(state.title, '关闭重开');
        assert.equal(state.color, 'rgb(153, 51, 68)');
        assert.equal(state.locked, 'false');
        assert.equal(state.gap, '32px');
        assert.equal(state.order, '1');
        assert.equal(state.rows, 2);
        assert.equal(state.cols, 3);
        assert.equal(state.src,replacement);
        assert.equal(state.fill, 'rgb(51, 92, 255)');
        assert.equal(state.background, 'rgb(240, 232, 222)');
        await select(page, ['title']);
        await page.getByRole('button', { name: '粗体', exact: true }).click();
        assert.match(await page.locator('#ppte-feedback').textContent() ?? '', /OBJECT_PROTECTED/);
        await select(page, ['a']);
        await page.getByLabel('字号', { exact: true }).fill('bad-value');
        await page.getByLabel('字号', { exact: true }).press('Tab');
        assert.match(await page.locator('#ppte-feedback').textContent() ?? '', /INVALID_STYLE/);
        await page.route('**/api/save', r => r.abort());
        await page.frameLocator('#ppte-frame').locator('[data-ppte-id=a]').fill('失败后保留');
        await page.waitForFunction(() => (window as any).PPTeSave.state === 'failed');
        assert.match(await page.locator('[role=status]').textContent() ?? '', /保存失败/);
        assert.equal(await page.frameLocator('#ppte-frame').locator('[data-ppte-id=a]').textContent(), '失败后保留');
        assert.equal(readEnhanced(await readFile(f.file, 'utf8')).content, saved);
        await page.screenshot({ path: join(evidence, 'failed.png') });
    }
    finally {
        await f.close();
    }
});
test('H03 native typing history, atomic multi-edit failure, table cell and page insertion history', async () => {
    const f = await setup();
    try {
        const { page } = f;
        const title = page.frameLocator('#ppte-frame').locator('[data-ppte-id=title]');
        await title.fill('真实键盘');
        await title.press('ControlOrMeta+z');
        assert.equal(await title.textContent(), '一句话保持原作');
        await title.press('ControlOrMeta+Shift+z');
        assert.equal(await title.textContent(), '真实键盘');
        const result = await page.evaluate(async () => {
            const c = (window as any).PPTeEditor.commands;
            const before = c.node('a').outerHTML;
            let rejected = false;
            try {
                c.transaction(['a', 'b'], (n: HTMLElement) => {
                    if (n.dataset.ppteId === 'b')
                        throw Error('second failure');
                    n.textContent = 'must rollback';
                });
            }
            catch {
                rejected = true;
            }
            const atomic = c.node('a').outerHTML === before;
            c.table('table', 'row');
            c.table('table', 'column');
            c.table('table', 'delete-row');
            c.table('table', 'delete-column');
            const rows = c.node('table').rows.length, cols = c.node('table').rows[0].cells.length;
            let last = false;
            try {
                c.table('table', 'delete-row');
            }
            catch {
                last = true;
            }
            let badMedia = false;
            try {
                await c.media('image', new File(['broken'], 'broken.png', { type: 'image/png' }));
            }
            catch {
                badMedia = true;
            }
            return { rejected, atomic, rows, cols, last, badMedia };
        });
        assert.deepEqual(result, { rejected: true, atomic: true, rows: 1, cols: 2, last: true, badMedia: true });
        await page.frameLocator('#ppte-frame').locator('[data-ppte-id=cell]').fill('单元格已改');
        await page.frameLocator('#ppte-frame').locator('[data-ppte-id=cell]').press('ControlOrMeta+z');
        assert.equal(await page.frameLocator('#ppte-frame').locator('[data-ppte-id=cell]').textContent(), '数据');
        await page.getByRole('button', { name: '添加页', exact: true }).click();
        assert.equal(await page.frameLocator('#ppte-frame').locator('[data-ppte-slide]').count(), 3);
        await page.getByRole('button', { name: '撤销', exact: true }).click();
        assert.equal(await page.frameLocator('#ppte-frame').locator('[data-ppte-slide]').count(), 2);
    }
    finally {
        await f.close();
    }
});
test('H03 original-file persisted range formatting and keyboard/pointer layout; clean preview returns to edit', async () => {
    const f = await setup();
    try {
        const { page } = f;
        await select(page, ['a']);
        await page.evaluate(() => {
            const d = (window as any).PPTeEditor.commands.doc, n = d.querySelector('[data-ppte-id=a]');
            const r = d.createRange();
            r.setStart(n.firstChild, 0);
            r.setEnd(n.firstChild, 2);
            d.getSelection().removeAllRanges();
            d.getSelection().addRange(r);
        });
        await page.waitForTimeout(30);
        await page.getByRole('button', { name: '粗体', exact: true }).click();
        await page.frameLocator('#ppte-frame').locator('[data-ppte-id=a]').focus();
        await page.evaluate(()=>{const e=(window as any).PPTeEditor;e.commands.move(e.selection[0],8,0);});
        assert.equal(await page.frameLocator('#ppte-frame').locator('[data-ppte-id=a]').evaluate(n => (n as HTMLElement).style.order), '1');
        const shape = page.frameLocator('#ppte-frame').locator('[data-ppte-id=absolute]');
        const bounds = await shape.boundingBox();
        await page.mouse.move(bounds!.x + 20, bounds!.y + 20);
        await page.mouse.down();
        await page.mouse.move(bounds!.x + 40, bounds!.y + 30);
        await page.mouse.up();
        assert.match(await shape.evaluate(n => (n as HTMLElement).style.transform), /translate/);
        await page.waitForFunction(() => ['saved', 'failed', 'conflict'].includes((window as any).PPTeSave.state));
        assert.equal(await page.evaluate(() => (window as any).PPTeSave.state), 'saved', await page.locator('[role=status]').textContent() ?? '');
        await page.reload();
        await page.waitForFunction(() => !!(window as any).PPTeSave);
        assert.equal(await page.frameLocator('#ppte-frame').locator('[data-ppte-id=a] span').textContent(), '第一');
        assert.equal(await page.frameLocator('#ppte-frame').locator('[data-ppte-id=a] span').evaluate(n => (n as HTMLElement).style.fontWeight), '700');
        await page.getByRole('button', { name: '放映', exact: true }).click();
        assert.equal(await page.locator('#ppte-properties').isVisible(), false);
        assert.equal(await page.locator('#ppte-save-ui').isVisible(), false);
        assert.equal(await page.frameLocator('#ppte-frame').locator('[data-ppte-slide=second]').isVisible(), false);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#ppte-properties').isVisible(), false);
        assert.equal(await page.locator('#ppte-workspace').getAttribute('data-open'), '');
        assert.equal(await page.locator('#ppte-save-ui').isVisible(), true);
    }
    finally {
        await f.close();
    }
});
test('H03 guarded SVG replacement, protected native input, composition events coalesce and hash race rejects', async () => {
    const f = await setup();
    try {
        const result = await f.page.evaluate(async () => {
            const e = (window as any).PPTeEditor, c = e.commands, d = c.doc;
            c.style(['shape'], 'fill', '#335cff');
            const fill = d.defaultView.getComputedStyle(c.node('shape').querySelector('rect')).fill;
            const original = c.node('shape').outerHTML;
            let unsafe = false;
            try {
                await c.svg('shape', new File(['<svg onload="alert(1)"><rect/></svg>'], 'bad.svg', { type: 'image/svg+xml' }));
            }
            catch {
                unsafe = true;
            }
            const untouched = original === c.node('shape').outerHTML;
            await c.svg('shape', new File(['<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="#993344"/></svg>'], 'circle.svg', { type: 'image/svg+xml' }));
            const replaced = !!c.node('shape').querySelector('circle');
            c.history();
            const undone = !!c.node('shape').querySelector('rect');
            c.lock(['title'], true);
            const allowed = c.node('title').dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: '禁止' }));
            c.lock(['title'], false);
            const n = c.node('title'), count = c.undoStack.length;
            n.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
            n.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, isComposing: true, inputType: 'insertCompositionText' }));
            n.textContent = '中';
            n.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
            n.textContent = '中文';
            n.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
            const interim = c.undoStack.length - count;
            n.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
            const final = c.undoStack.length - count;
            c.history();
            const restored = n.textContent === '一句话保持原作';
            const expected = await e.hash('a');
            const pending = e.patch('a', expected, { text: 'stale async' });
            c.text('a', '人工更新');
            let race = false;
            try {
                await pending;
            }
            catch {
                race = true;
            }
            return { fill, unsafe, untouched, replaced, undone, allowed, interim, final, restored, race, text: c.node('a').textContent };
        });
        assert.deepEqual(result, { fill: 'rgb(51, 92, 255)', unsafe: true, untouched: true, replaced: true, undone: true, allowed: false, interim: 0, final: 1, restored: true, race: true, text: '人工更新' });
        await assert.rejects(f.page.evaluate(async()=>{const e=(window as any).PPTeEditor;await e.patch('a',await e.hash('a'),{html:'<p>unsupported</p>'});}),/UNSUPPORTED_PATCH/);
    }
    finally {
        await f.close();
    }
});
