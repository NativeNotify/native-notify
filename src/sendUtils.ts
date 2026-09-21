/**
 * Pure payload helpers for the send functions in index.ts.
 *
 * Same split as analyticsUtils.ts / inboxUtils.ts: index.ts imports React
 * Native + Expo modules and cannot load in plain Node, so the wire-payload
 * logic lives here (exercised by test/sendUtils.test.ts) and index.ts only
 * wraps it with the HTTP call.
 */

/**
 * Optional rich Expo message fields, passed through to the Native Notify send
 * endpoints (server wave 2026-09-15 — the server validates them and spreads
 * them into every Expo message: mass, indie, group and follower sends).
 * Unset fields keep the server defaults.
 */
export interface RichPushFields {
    /** iOS subtitle shown under the title. */
    subtitle?: string;
    /** iOS app icon badge count (0 clears the badge). */
    badge?: number;
    /** Seconds the push may be delivered for. */
    ttl?: number;
    /** iOS interruption level — use 'timeSensitive' / 'critical' sparingly. */
    interruptionLevel?: 'passive' | 'active' | 'timeSensitive' | 'critical';
    /** iOS notification category id (action buttons). */
    categoryId?: string;
    /** Android channel id — create it first with setAndroidNotificationChannel(). */
    channelId?: string;
    /** APNs collapse id — a newer push with the same id replaces the older one. */
    collapseId?: string;
    /** iOS background delivery (silent data update). */
    contentAvailable?: boolean;
    /** iOS notification service extension may modify the payload (e.g. attach an image). */
    mutableContent?: boolean;
    /** Custom sound file name, or false for a silent notification. */
    sound?: string | false;
}

/**
 * Options accepted by every send helper (sendMassNotification,
 * sendIndieNotification, sendIndieGroupNotification,
 * sendNotificationToFollowers).
 */
export interface SendNotificationOptions extends RichPushFields {
    /** The pushData JSON your app reads from the notification (deep links, ids). */
    pushData?: any;
    /** Image url shown as the big picture (Android) / attachment source (iOS). */
    bigPictureURL?: string;
    /** appId override — defaults to NativeNotify.init() / <NativeNotifyProvider>. */
    appId?: any;
    /** appToken override — defaults to NativeNotify.init() / <NativeNotifyProvider>. */
    appToken?: any;
}

/** The rich fields copied to the wire payload, in one place. */
export const RICH_PUSH_FIELD_NAMES = [
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
] as const;

/**
 * Build the request payload for a send: only the keys the caller actually set
 * are included, so the server keeps its defaults for everything else.
 *
 * Values are compared against `undefined` — never against falsiness — because
 * `sound: false` is a real request for a silent push, `badge: 0` clears the
 * badge, and `contentAvailable: false` is still a defined choice. (Dropping
 * falsy values here is the classic passthrough bug this helper exists to
 * prevent; test/sendUtils.test.ts pins it.)
 */
export function buildSendPayload(options?: SendNotificationOptions): { [key: string]: any } {
    const payload: { [key: string]: any } = {};
    const opts: SendNotificationOptions = options || ({} as SendNotificationOptions);

    if (opts.pushData !== undefined) payload.pushData = opts.pushData;
    if (opts.bigPictureURL !== undefined) payload.bigPictureURL = opts.bigPictureURL;

    for (const field of RICH_PUSH_FIELD_NAMES) {
        const value = (opts as any)[field];
        if (value !== undefined) payload[field] = value;
    }

    return payload;
}
