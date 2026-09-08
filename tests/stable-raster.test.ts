import test from 'node:test';
import assert from 'node:assert/strict';
import { stableRaster } from './helpers/stable-raster.js';

test('raster observation waits for consecutive exact frames, with a finite failure boundary', async () => {
    const frames = [0, 1, 1, 2, 2, 2];
    let calls = 0;
    assert.deepEqual(await stableRaster(async () => Buffer.from([frames[calls++]])), Buffer.from([2]));
    assert.equal(calls, 6);
    calls = 0;
    await assert.rejects(stableRaster(async () => Buffer.from([calls++ % 2])), /did not settle/);
    assert.equal(calls, 8);
});

test('stable observations retain even a single changed byte; cross-state equality is never retried', async () => {
    const before = await stableRaster(async () => Buffer.from([255, 0, 0]));
    const after = await stableRaster(async () => Buffer.from([254, 0, 0]));
    assert.throws(() => assert.deepEqual(after, before), { code: 'ERR_ASSERTION' });
});
