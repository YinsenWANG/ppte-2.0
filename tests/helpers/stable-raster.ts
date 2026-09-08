import assert from 'node:assert/strict';
import type { Locator } from 'playwright';

// Settle each observation independently. Never retry against the before image:
// a stable one-byte regression must still fail the caller's exact comparison.
export async function stableRaster(capture: () => Promise<Buffer>): Promise<Buffer> {
    let previous: Buffer | undefined, consecutive = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
        const current = await capture();
        consecutive = previous?.equals(current) ? consecutive + 1 : 1;
        if (consecutive === 3) return current;
        previous = current;
    }
    assert.fail('Raster did not settle to three byte-identical observations in eight captures');
}

export async function imageRaster(image: Locator): Promise<Buffer> {
    await image.evaluate(async (node: HTMLImageElement) => {
        await node.decode();
        await node.ownerDocument.fonts.ready;
    });
    return stableRaster(() => image.screenshot({ caret: 'initial' }));
}
