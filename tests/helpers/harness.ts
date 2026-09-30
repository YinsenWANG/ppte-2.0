// Development harness only; these helpers provide no native acceptance evidence.
export async function requestJSON(url: string, init: RequestInit, timeoutMs = 5000,
    request: typeof fetch = fetch): Promise<any> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            const error = new Error(`WEBDRIVER_TIMEOUT: ${init.method} ${url}`);
            controller.abort(error);
            reject(error);
        }, timeoutMs);
    });
    try {
        // The deadline includes response-body parsing, not just receipt of headers.
        return await Promise.race([
            request(url, { ...init, signal: controller.signal }).then(response => response.json()),
            deadline,
        ]);
    } finally { clearTimeout(timer!); }
}

export async function launchWithCleanup<T>(launch: () => Promise<T>, cleanup: () => Promise<void>): Promise<T> {
    try { return await launch(); }
    catch (error) {
        try { await cleanup(); }
        catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Launch and cleanup failed'); }
        throw error;
    }
}
