import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    MAX_SCREEN_NAME_LENGTH,
    clampSessionDuration,
    isDuplicateScreenChange,
    makeSessionId,
    normalizeScreenName,
    recordOpenReport,
} from '../src/analyticsUtils';

test('normalizeScreenName trims, caps length, rejects non-strings', () => {
    assert.equal(normalizeScreenName(' Home '), 'Home');
    assert.equal(normalizeScreenName(''), null);
    assert.equal(normalizeScreenName('   '), null);
    assert.equal(normalizeScreenName(undefined), null);
    assert.equal(normalizeScreenName(42), null);
    assert.equal(normalizeScreenName('x'.repeat(500)).length, MAX_SCREEN_NAME_LENGTH);
});

test('isDuplicateScreenChange collapses consecutive repeats only', () => {
    assert.equal(isDuplicateScreenChange('Home', 'Home'), true);
    assert.equal(isDuplicateScreenChange('Home', 'Settings'), false);
    assert.equal(isDuplicateScreenChange(null, 'Home'), false);
});

test('recordOpenReport dedupes taps inside the window and prunes old ones', () => {
    const windowMs = 5000;
    let recent: { id: string; at: number }[] = [];

    let result = recordOpenReport(recent, '42', 1000, windowMs);
    assert.equal(result.isDuplicate, false);
    recent = result.recent;

    // Same notification within the window → collapsed (listener + cold start).
    result = recordOpenReport(recent, '42', 2000, windowMs);
    assert.equal(result.isDuplicate, true);
    recent = result.recent;

    // A different notification reports normally.
    result = recordOpenReport(recent, '43', 2500, windowMs);
    assert.equal(result.isDuplicate, false);
    recent = result.recent;
    assert.equal(recent.length, 2);

    // After the window, the same id reports again (a genuinely new tap).
    result = recordOpenReport(recent, '42', 2500 + windowMs + 1, windowMs);
    assert.equal(result.isDuplicate, false);
});

test('makeSessionId is compact, deterministic given inputs, and unique per call', () => {
    const a = makeSessionId(1700000000000, () => 0.5);
    const b = makeSessionId(1700000000000, () => 0.5);
    assert.equal(a, b); // same clock + random → same id (pure)
    const c = makeSessionId(1700000000000, () => 0.6);
    assert.notEqual(a, c);
    assert.ok(a.length <= 80);
    assert.ok(a.length > 10);
});

test('clampSessionDuration bounds bad inputs', () => {
    assert.equal(clampSessionDuration(30000), 30000);
    assert.equal(clampSessionDuration(-5), 0);
    assert.equal(clampSessionDuration(NaN), 0);
    assert.equal(clampSessionDuration(Infinity), 0);
    assert.equal(clampSessionDuration(48 * 60 * 60 * 1000), 24 * 60 * 60 * 1000);
});
