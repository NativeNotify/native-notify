/**
 * Unit tests for the send-payload builder (src/sendUtils.ts) — the rich-field
 * passthrough behind the send helpers. Pure module, plain Node.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    buildSendPayload,
    legacyDateSent,
    RICH_PUSH_FIELD_NAMES,
} from '../src/sendUtils';
import type { SendNotificationOptions } from '../src/sendUtils';
import { parseDateValue } from '../src/inboxUtils';

test('buildSendPayload passes every rich field through untouched', () => {
    const options: SendNotificationOptions = {
        pushData: { url: '/offers' },
        bigPictureURL: 'https://example.com/promo.png',
        subtitle: 'Sub line',
        badge: 3,
        ttl: 3600,
        interruptionLevel: 'timeSensitive',
        categoryId: 'ORDER_UPDATE',
        channelId: 'alerts',
        collapseId: 'collapse-1',
        contentAvailable: true,
        mutableContent: true,
        sound: 'chime.wav',
    };

    assert.deepEqual(buildSendPayload(options), {
        pushData: { url: '/offers' },
        bigPictureURL: 'https://example.com/promo.png',
        subtitle: 'Sub line',
        badge: 3,
        ttl: 3600,
        interruptionLevel: 'timeSensitive',
        categoryId: 'ORDER_UPDATE',
        channelId: 'alerts',
        collapseId: 'collapse-1',
        contentAvailable: true,
        mutableContent: true,
        sound: 'chime.wav',
    });
});

test('buildSendPayload keeps falsy-but-set values (sound:false, badge:0)', () => {
    // The classic passthrough bug: `if (value)` drops these. `sound: false` is
    // a real "silent push" request and `badge: 0` clears the badge.
    const payload = buildSendPayload({
        sound: false,
        badge: 0,
        contentAvailable: false,
        subtitle: '',
    });

    assert.deepEqual(payload, {
        sound: false,
        badge: 0,
        contentAvailable: false,
        subtitle: '',
    });
    assert.equal('sound' in payload, true);
    assert.equal('badge' in payload, true);
});

test('buildSendPayload omits options that were never set', () => {
    // No options at all.
    assert.deepEqual(buildSendPayload(), {});
    assert.deepEqual(buildSendPayload(undefined), {});

    // A partial object: only the set keys travel.
    assert.deepEqual(buildSendPayload({ channelId: 'news', pushData: { a: 1 } }), {
        channelId: 'news',
        pushData: { a: 1 },
    });

    // Explicitly-undefined keys are omitted too (the JSON body stays minimal).
    assert.deepEqual(buildSendPayload({ subtitle: undefined, ttl: undefined }), {});
});

test('buildSendPayload never leaks non-message keys (appId/appToken/unknown)', () => {
    const options = {
        appId: 4547,
        appToken: 'secret',
        title: 'not part of the payload builder',
        bogusField: 'nope',
    } as unknown as SendNotificationOptions;

    assert.deepEqual(buildSendPayload(options), {});
});

test('RICH_PUSH_FIELD_NAMES covers exactly the ten documented rich fields', () => {
    // Pins the passthrough contract against accidental additions/renames.
    assert.deepEqual([...RICH_PUSH_FIELD_NAMES], [
        'subtitle',
        'badge',
        'ttl',
        'interruptionLevel',
        'categoryId',
        'channelId',
        'collapseId',
        'contentAvailable',
        'mutableContent',
        'sound',
    ]);
});

test('legacyDateSent matches the server/dashboard inbox date format (device-local time)', () => {
    assert.equal(legacyDateSent(new Date(2026, 8, 24, 0, 5)), '9-24-2026 0:05AM');
    assert.equal(legacyDateSent(new Date(2026, 8, 24, 9, 30)), '9-24-2026 9:30AM');
    assert.equal(legacyDateSent(new Date(2026, 8, 24, 12, 0)), '9-24-2026 12:00PM');
    assert.equal(legacyDateSent(new Date(2026, 0, 3, 13, 7)), '1-3-2026 1:07PM');
    assert.equal(legacyDateSent(new Date(2026, 11, 31, 23, 59)), '12-31-2026 11:59PM');
});

test('legacyDateSent round-trips through the inbox date parser', () => {
    const when = new Date(2026, 8, 24, 15, 42);
    const parsed = parseDateValue(legacyDateSent(when));
    assert.ok(parsed);
    assert.equal(parsed!.getTime(), when.getTime());
});
