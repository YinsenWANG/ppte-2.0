import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
export type RequestDiagnostic = {
    startedAtMs: number; durationMs: number; outcome: 'parsed' | 'error' | 'timeout';
    headersReceived: boolean; bodyParsingComplete: boolean; httpStatus?: number;
    abortReason: 'deadline' | 'none';
};
export type SafariDiagnostic =
    | ({phase: 'discovery'; attempt: number} & RequestDiagnostic)
    | ({phase: 'journey'} & RequestDiagnostic)
    | ({phase: 'session-delete'} & RequestDiagnostic)
    | {phase: 'driver-cleanup'; startedAtMs: number; durationMs: number;
        outcome: 'completed' | 'error'; exitCode: number | null; signalCode: string | null};
// Diagnostics are optional observers: neither synchronous nor async failures escape.
function observe<T>(callback: ((value: T) => void | Promise<void>) | undefined, value: T): void {
    try { void Promise.resolve(callback?.(value)).catch(() => {}); } catch {}
}
// Development harness only; these helpers provide no native acceptance evidence.
export async function requestJSON(url: string, init: RequestInit, timeoutMs = 5000,
    request: typeof fetch = fetch,
    diagnostic?: (value: RequestDiagnostic) => void | Promise<void>): Promise<any> {
    const startedAtMs = performance.now();
    let headersReceived = false, bodyParsingComplete = false, httpStatus: number | undefined;
    let outcome: RequestDiagnostic['outcome'] = 'error';
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            outcome = 'timeout';
            const error = new Error(`WEBDRIVER_TIMEOUT: ${init.method} ${url}`);
            controller.abort(error);
            reject(error);
        }, timeoutMs);
    });
    try {
        // The deadline includes response-body parsing, not just receipt of headers.
        const result = await Promise.race([
            request(url, { ...init, signal: controller.signal }).then(async response => {
                headersReceived = true;
                httpStatus = response.status;
                const body = await response.json();
                bodyParsingComplete = true;
                return body;
            }),
            deadline,
        ]);
        outcome = 'parsed';
        return result;
    } finally {
        clearTimeout(timer!);
        observe(diagnostic, {startedAtMs, durationMs: performance.now() - startedAtMs,
            outcome, headersReceived, bodyParsingComplete, httpStatus,
            abortReason: controller.signal.aborted ? 'deadline' : 'none'});
    }
}

// The Safari consumer and fault regressions share session discovery and teardown.
// A W3C error is blocked evidence; exhausted discovery is an assertion failure.
export async function withSafariSession(driver: ChildProcess, origin: string,
    journey: (id: string) => Promise<void>, record: (value: object) => Promise<void>,
    budgetMs = 5000, diagnostic?: (value: SafariDiagnostic) => void | Promise<void>): Promise<void> {
    let session: any;
    try {
        const deadline = Date.now() + Math.min(budgetMs, 5000);
        let probeError: unknown;
        for (let i = 0; i < 30 && Date.now() < deadline; i++) {
            try {
                session = await requestJSON(`${origin}/session`, {method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({capabilities: {alwaysMatch: {browserName: 'safari'}}})},
                    Math.min(1000, deadline - Date.now()), fetch,
                    value => observe(diagnostic, {phase: 'discovery', attempt: i + 1, ...value}));
                break;
            } catch (error) {
                probeError = error;
                await new Promise(r => setTimeout(r, Math.max(0, Math.min(100, deadline - Date.now()))));
            }
        }
        if (!session) await record({status: 'failed', reason: `Safari driver did not respond: ${String(probeError)}`});
        assert.ok(session, 'Safari driver did not respond');
        if (!session.value?.sessionId) {
            assert.ok(session.value?.error);
            await record({status: 'blocked', response: session});
            return;
        }
        await journey(session.value.sessionId);
    } finally {
        try {
            if (session?.value?.sessionId) await requestJSON(`${origin}/session/${session.value.sessionId}`, {method: 'DELETE'},
                5000, fetch, value => observe(diagnostic, {phase: 'session-delete', ...value}));
        } finally {
            const startedAtMs = performance.now();
            let outcome: 'completed' | 'error' = 'error';
            try {
            if (driver.exitCode === null && driver.signalCode === null) {
                // Reap the acquired driver even after failed discovery or DELETE.
                const exited = new Promise<void>(resolve => driver.once('exit', () => resolve()));
                driver.kill();
                let timer: ReturnType<typeof setTimeout>;
                try {
                    await Promise.race([exited, new Promise<never>((_, reject) => {
                        timer = setTimeout(() => {driver.kill('SIGKILL'); reject(Error('Safari driver cleanup timed out'));}, 1000);
                    })]);
                } finally {clearTimeout(timer!);}
            }
                outcome = 'completed';
            } finally {
                observe(diagnostic, {phase: 'driver-cleanup', startedAtMs,
                    durationMs: performance.now() - startedAtMs, outcome,
                    exitCode: driver.exitCode, signalCode: driver.signalCode});
            }
        }
    }
}

export async function launchWithCleanup<T>(launch: () => Promise<T>, cleanup: () => Promise<void>): Promise<T> {
    try { return await launch(); }
    catch (error) {
        try { await cleanup(); }
        catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Launch and cleanup failed'); }
        throw error;
    }
}
