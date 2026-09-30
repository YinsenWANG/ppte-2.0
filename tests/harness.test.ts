import test from 'node:test';
import assert from 'node:assert/strict';
import { requestJSON, launchWithCleanup } from './helpers/harness.js';

test('WebDriver harness bounds stalled headers and response bodies, aborts and retains the failed route', async () => {
    for (const phase of ['headers', 'body']) {
        let signal: AbortSignal;
        const request = (async (_url, init) => {
            signal = init!.signal!;
            if (phase === 'headers') return new Promise(() => {});
            return { json: () => new Promise(() => {}) };
        }) as typeof fetch;
        await assert.rejects(requestJSON('http://localhost/session', { method: 'POST' }, 20, request),
            /WEBDRIVER_TIMEOUT: POST http:\/\/localhost\/session/);
        assert.equal(signal!.aborted, true);
    }
});

test('WebDriver harness returns parsed JSON and preserves transport/body errors', async () => {
    const init = { method: 'POST', body: '{}' };
    const request = (async (_url, options) => {
        assert.equal(options!.body, init.body);
        assert.equal(options!.signal!.aborted, false);
        return { json: async () => ({ value: 'ready' }) };
    }) as typeof fetch;
    assert.deepEqual(await requestJSON('http://localhost/session', init, 100, request), { value: 'ready' });
    for (const phase of ['transport', 'body']) {
        const failed = (async () => {
            if (phase === 'transport') throw Error(phase);
            return new Response('invalid JSON');
        }) as typeof fetch;
        await assert.rejects(requestJSON('http://localhost/session', init, 100, failed), phase === 'transport' ? /transport/ : SyntaxError);
    }
});

test('Browser launch rejection cleans up acquired resources without masking either failure', async () => {
    const failure = Error('browser launch failed');
    let closed = false;
    await assert.rejects(launchWithCleanup(async () => { throw failure; }, async () => { closed = true; }),
        error => error === failure);
    assert.equal(closed, true);
    const cleanupFailure = Error('close failed');
    await assert.rejects(launchWithCleanup(async () => { throw failure; }, async () => { throw cleanupFailure; }),
        error => error instanceof AggregateError && error.errors[0] === failure && error.errors[1] === cleanupFailure);
    closed = false;
    assert.equal(await launchWithCleanup(async () => 'ready', async () => { closed = true; }), 'ready');
    assert.equal(closed, false);
});
