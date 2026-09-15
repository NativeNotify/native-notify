import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    computeHasMore,
    formatDate,
    parseDateValue,
    readTotalCount,
} from '../src/inboxUtils';

test('parseDateValue parses the server format "M-D-YYYY H:MMAM/PM"', () => {
    const morning = parseDateValue('8-28-2026 6:53AM');
    assert.ok(morning);
    assert.equal(morning.getFullYear(), 2026);
    assert.equal(morning.getMonth(), 7); // August
    assert.equal(morning.getDate(), 28);
    assert.equal(morning.getHours(), 6);
    assert.equal(morning.getMinutes(), 53);

    const evening = parseDateValue('8-28-2026 6:53PM');
    assert.ok(evening);
    assert.equal(evening.getHours(), 18);
});

test('parseDateValue handles 12 AM / 12 PM correctly', () => {
    const midnight = parseDateValue('1-2-2026 12:00AM');
    assert.ok(midnight);
    assert.equal(midnight.getHours(), 0);

    const noon = parseDateValue('1-2-2026 12:00PM');
    assert.ok(noon);
    assert.equal(noon.getHours(), 12);
});

test('parseDateValue parses a date-only value at midnight', () => {
    const dateOnly = parseDateValue('12-31-2025');
    assert.ok(dateOnly);
    assert.equal(dateOnly.getFullYear(), 2025);
    assert.equal(dateOnly.getMonth(), 11); // December
    assert.equal(dateOnly.getDate(), 31);
    assert.equal(dateOnly.getHours(), 0);
});

test('parseDateValue returns null for unparseable strings', () => {
    assert.equal(parseDateValue('not a date at all'), null);
});

test('formatDate renders the server format and passes unknowns through', () => {
    const formatted = formatDate('8-28-2026 6:53AM');
    assert.notEqual(formatted, '8-28-2026 6:53AM'); // it was actually parsed
    assert.match(formatted, /28/); // the day survives any locale

    assert.equal(formatDate('nonsense value'), 'nonsense value');
    assert.equal(formatDate(''), '');
    assert.equal(formatDate(null), '');
});

test('computeHasMore is exact when X-Total-Count is available', () => {
    assert.equal(computeHasMore({ skip: 0, received: 20, take: 20, total: 45 }), true);
    assert.equal(computeHasMore({ skip: 20, received: 20, take: 20, total: 45 }), true);
    assert.equal(computeHasMore({ skip: 40, received: 5, take: 20, total: 45 }), false);
    // Exact multiple: the old "rows >= take" guess said "more"; the header is right.
    assert.equal(computeHasMore({ skip: 20, received: 20, take: 20, total: 40 }), false);
});

test('computeHasMore falls back to the page-size heuristic without a total', () => {
    assert.equal(computeHasMore({ skip: 0, received: 20, take: 20, total: null }), true);
    assert.equal(computeHasMore({ skip: 20, received: 3, take: 20 }), false);
    // An inconsistent (too small) header is ignored in favor of the heuristic.
    assert.equal(computeHasMore({ skip: 0, received: 20, take: 20, total: 10 }), true);
});

test('computeHasMore stops on an empty page even with a stale total', () => {
    // The indie X-Total-Count is currently app-wide (too large); an empty
    // page must still end pagination.
    assert.equal(computeHasMore({ skip: 120, received: 0, take: 20, total: 999 }), false);
});

test('readTotalCount reads the header in either casing', () => {
    assert.equal(readTotalCount({ 'x-total-count': '42' }), 42);
    assert.equal(readTotalCount({ 'X-Total-Count': '7' }), 7);
    assert.equal(readTotalCount({}), null);
    assert.equal(readTotalCount(undefined), null);
    assert.equal(readTotalCount({ 'x-total-count': 'abc' }), null);
});
