import assert from 'node:assert/strict';

// Historical bytes are the only accepted extraction, including whitespace.
export function assertHistoricalPDFKitText(id: string, actual: string, historical: string) {
    assert.equal(actual, historical, `${id}: exact historical PDFKit text`);
}
