import test from 'node:test';
import assert from 'node:assert/strict';
import { requestJSON, launchWithCleanup, withSafariSession } from './helpers/harness.js';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

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

test('Safari consumer discovery faults produce bounded test FAIL with zero skips and reap the driver', async () => {
    for (const phase of ['headers', 'body']) {
        const dir = resolve('artifacts/harness-lifecycle', phase);
        await mkdir(dir, {recursive: true});
        let requests = 0;
        const sockets = new Set<import('node:net').Socket>();
        const server = createServer((_req, response) => {
            requests++;
            if (phase === 'body') {response.writeHead(200, {'Content-Type': 'application/json'}); response.write('{');}
        });
        server.on('connection', socket => {sockets.add(socket); socket.on('close', () => sockets.delete(socket));});
        await new Promise<void>((yes, no) => {server.once('error', no); server.listen(0, '127.0.0.1', yes);});
        const address = server.address() as import('node:net').AddressInfo;
        const entry = resolve(dir, 'consumer.test.mjs');
        // A real child test consumes the same lifecycle as html-save, against a
        // faulting HTTP server. This is harness evidence, never native Safari.
        await writeFile(entry, `import test from 'node:test';
import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {withSafariSession} from ${JSON.stringify(new URL('./helpers/harness.js', import.meta.url).href)};
test('faulted Safari consumer',async()=>{
 const driver=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);
 const records=[];
 await writeFile(${JSON.stringify(resolve(dir, 'driver.json'))},JSON.stringify({pid:driver.pid}));
 try {await withSafariSession(driver,${JSON.stringify(`http://127.0.0.1:${address.port}`)},async()=>{throw Error('journey must not run')},async r=>{records.push(r)},150);}
 finally {await writeFile(${JSON.stringify(resolve(dir, 'cleanup.json'))},JSON.stringify({pid:driver.pid,exitCode:driver.exitCode,signalCode:driver.signalCode,records}));}
});\n`);
        let child: ReturnType<typeof spawn> | undefined;
        try {
            const started = Date.now();
            child = spawn(process.execPath, ['--test', entry], {stdio: ['ignore', 'pipe', 'pipe']});
            let stdout = '', stderr = '';
            child.stdout!.on('data', b => stdout += b);
            child.stderr!.on('data', b => stderr += b);
            const guard = setTimeout(() => child!.kill('SIGKILL'), 4000);
            let exit: number | null;
            try {exit = await new Promise<number | null>((yes, no) => {child!.once('error', no);child!.once('exit', yes);});}
            finally {clearTimeout(guard);}
            const elapsedMs = Date.now() - started;
            await writeFile(resolve(dir, 'stdout.txt'), stdout);
            await writeFile(resolve(dir, 'stderr.txt'), stderr);
            await writeFile(resolve(dir, 'result.json'), JSON.stringify({command:[process.execPath,'--test',entry],exit,elapsedMs},null,2));
            assert.equal(exit, 1, stdout + stderr);
            assert.match(stdout, /Safari driver did not respond/);
            assert.match(stdout, /# fail 1/);assert.match(stdout, /# skipped 0/);
            assert.ok(elapsedMs < 5000, `unbounded consumer: ${elapsedMs}ms`);
            assert.ok(requests > 0, 'fault must reach session discovery');
            const cleanup = JSON.parse(await readFile(resolve(dir, 'cleanup.json'), 'utf8'));
            assert.equal(cleanup.records[0].status, 'failed');
            assert.equal(cleanup.signalCode, 'SIGTERM');
            assert.throws(() => process.kill(cleanup.pid, 0), {code: 'ESRCH'});
        } finally {
            child?.kill('SIGKILL');
            // A broken consumer must not strand the fault driver's process.
            const acquired = JSON.parse(await readFile(resolve(dir, 'driver.json'), 'utf8').catch(() => '{}'));
            if (acquired.pid) {try {process.kill(acquired.pid, 'SIGKILL');} catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;}}
            for (const socket of sockets) socket.destroy();
            await new Promise<void>(yes => server.close(() => yes()));
        }
    }
});

test('Safari lifecycle keeps explicit W3C blocked return, and deletes acquired sessions on journey failure', async () => {
    for (const available of [false, true]) {
        const routes: string[] = [];
        const server = createServer((req, response) => {
            routes.push(`${req.method} ${req.url}`);
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({value: req.method === 'DELETE' ? null : available ? {sessionId:'control'} : {error:'session not created'}}));
        });
        await new Promise<void>((yes, no) => {server.once('error', no);server.listen(0, '127.0.0.1', yes);});
        const address = server.address() as import('node:net').AddressInfo;
        const driver = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
        const records: any[] = [];let journeys = 0;
        const failure = Error('consumer journey failed');
        try {
            const run = withSafariSession(driver, `http://127.0.0.1:${address.port}`, async () => {journeys++;throw failure;}, async r => {records.push(r);});
            if (available) {await assert.rejects(run, error => error === failure);assert.deepEqual(routes,['POST /session','DELETE /session/control']);}
            else {await run;assert.equal(records[0].status,'blocked');assert.deepEqual(routes,['POST /session']);}
            assert.equal(journeys, available ? 1 : 0);
            assert.equal(driver.signalCode, 'SIGTERM');
        } finally {server.closeAllConnections();await new Promise<void>(yes => server.close(() => yes()));}
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
