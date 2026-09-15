/**
 * Pure helpers shared by the native-notify inbox components and the public SDK
 * functions. This module deliberately has no react-native / expo imports so it
 * can be unit-tested in plain Node (see test/inboxUtils.test.ts).
 */

// The server stores date_sent exactly as the sender provided it. Live data
// uses "M-D-YYYY H:MMAM/PM" (e.g. "8-28-2026 6:53AM"), which JS engines parse
// inconsistently (Hermes returns Invalid Date), so parse that shape directly
// and only fall back to Date for anything else.
export const SERVER_DATE_RE = /^(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?$/i;

export function parseDateValue(raw: string): Date | null {
    const match = SERVER_DATE_RE.exec(raw);
    if (match) {
        let hours = match[4] ? parseInt(match[4], 10) : 0;
        const isPM = match[6] && match[6].toUpperCase() === 'PM';
        if (isPM && hours < 12) hours += 12;
        if (!isPM && hours === 12) hours = 0;
        const parsed = new Date(
            parseInt(match[3], 10),
            parseInt(match[1], 10) - 1,
            parseInt(match[2], 10),
            hours,
            match[5] ? parseInt(match[5], 10) : 0
        );
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
}

export function formatDate(value: any): string {
    if (!value) return '';
    const raw = String(value);
    const date = parseDateValue(raw);
    if (!date) return raw; // unknown format: show it as-is
    try {
        const hasTime = /\d{1,2}:\d{2}/.test(raw);
        const sameYear = date.getFullYear() === new Date().getFullYear();
        return date.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            year: sameYear ? undefined : 'numeric',
            hour: hasTime ? 'numeric' : undefined,
            minute: hasTime ? '2-digit' : undefined,
        });
    } catch (e) {
        return raw;
    }
}

export function describeError(e: any): string {
    const fallback = "Couldn't load notifications. Check your connection and try again.";
    if (!e) return fallback;
    const data = e.response && e.response.data;
    // The server sends plain-text messages for plan / permission problems.
    if (typeof data === 'string' && data.trim() && data.length < 240) return data.trim();
    if (typeof e.message === 'string' && e.message) return e.message;
    return fallback;
}

/**
 * Exact "is there another page?" decision for the inbox lists.
 *
 * Both list endpoints send an X-Total-Count header. It is authoritative for
 * the mass inbox; the indie value is currently the app-wide total (a known
 * server-side bug), so a wrong-but-larger total only costs one extra (empty)
 * fetch at the end — the `received === 0` short-circuit stops the loop.
 */
export interface InboxPageInfo {
    /** Rows requested so far (the `skip` of the page that just returned). */
    skip: number;
    /** Rows the server actually returned for that page. */
    received: number;
    /** Page size. */
    take: number;
    /** X-Total-Count, when present. */
    total?: number | null;
}

export function computeHasMore(info: InboxPageInfo): boolean {
    const { skip, received, take, total } = info || ({} as InboxPageInfo);
    if (!received) return false; // nothing came back — we are at the end
    if (typeof total === 'number' && Number.isFinite(total) && total >= skip + received) {
        return skip + received < total;
    }
    return received >= take;
}

/** Parse the X-Total-Count response header (number | null). */
export function readTotalCount(headers: any): number | null {
    if (!headers) return null;
    const raw = headers['x-total-count'] !== undefined
        ? headers['x-total-count']
        : headers['X-Total-Count'];
    if (raw === undefined || raw === null) return null;
    const parsed = parseInt(String(raw), 10);
    return Number.isFinite(parsed) ? parsed : null;
}
