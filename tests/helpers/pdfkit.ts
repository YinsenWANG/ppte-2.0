import assert from 'node:assert/strict';

// See docs/testing/U04-PARSER-DRIFT.md. Preserve the recorded extraction and
// accept only the observed correction for unchanged transformed fixture bytes.
export function transformedTextDrift(id: string, actual: string, historical: string) {
    return id === 'fixtures-04' && historical.includes('变换后的中文 T ex t') &&
        actual === historical.replace('变换后的中文 T ex t', '变换后的中文 Text');
}

export function assertHistoricalPDFKitText(id: string, actual: string, historical: string) {
    assert.equal(actual, transformedTextDrift(id, actual, historical)
        ? historical.replace('变换后的中文 T ex t', '变换后的中文 Text') : historical);
}
