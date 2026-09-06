import type { Page, ViewportSize } from 'playwright';

// setViewportSize acknowledges the protocol command before the page necessarily
// handles resize. Wait for that event and its layout/ResizeObserver work before
// resolving locators which a responsive UI may replace. Do not retry focus.
export async function resizeViewport(page: Page, viewport: ViewportSize) {
    const state = await page.evaluateHandle(({ width, height }) => {
        const state = { ready: false, cancel: () => {} };
        let first = 0, second = 0;
        const resized = () => {
            if (innerWidth !== width || innerHeight !== height)
                return;
            state.ready = false;
            cancelAnimationFrame(first);
            cancelAnimationFrame(second);
            first = requestAnimationFrame(() => {
                second = requestAnimationFrame(() => { state.ready = true; });
            });
        };
        window.addEventListener('resize', resized);
        state.cancel = () => {
            window.removeEventListener('resize', resized);
            cancelAnimationFrame(first);
            cancelAnimationFrame(second);
        };
        if (innerWidth === width && innerHeight === height)
            resized();
        return state;
    }, viewport);
    try {
        await page.setViewportSize(viewport);
        await page.waitForFunction(state => state.ready, state, { timeout: 10000 });
    }
    finally {
        await state.evaluate(state => state.cancel());
        await state.dispose();
    }
}
