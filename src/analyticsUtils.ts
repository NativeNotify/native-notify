/**
 * Pure helpers behind the analytics features (screens, sessions, opens).
 * Kept dependency-free so they run under plain `node --test` — the
 * react-native/expo wiring lives in analytics.ts.
 */

/** Max screen name length the server accepts (longer names are truncated). */
export const MAX_SCREEN_NAME_LENGTH = 120;

/**
 * Normalize a screen name: trim, collapse nothing (route segments stay
 * intact), cap at the server's column width. Returns null when the value is
 * not a usable string.
 */
export function normalizeScreenName(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const name = raw.trim().slice(0, MAX_SCREEN_NAME_LENGTH);
    return name.length > 0 ? name : null;
}

/**
 * Screen-change dedupe: the same screen reported twice in a row (a layout
 * re-render, a tab that remounts) is one view, not two.
 */
export function isDuplicateScreenChange(lastScreen: string | null, nextScreen: string): boolean {
    return lastScreen === nextScreen;
}

/** A recent open report kept for tap dedupe. */
export interface OpenReport {
    id: string;
    at: number;
}

/**
 * Record a notification-open report and decide whether it should be sent.
 * Taps can surface through BOTH the response listener and the cold-start
 * getLastNotificationResponse path (and useNativeNotifyPress + the
 * registration hook both listen), so reports for the same notification id
 * inside the dedupe window collapse into one.
 */
export function recordOpenReport(
    recent: OpenReport[],
    id: string,
    now: number,
    windowMs: number
): { recent: OpenReport[]; isDuplicate: boolean } {
    const fresh = recent.filter((report) => now - report.at < windowMs);
    if (fresh.some((report) => report.id === id)) {
        return { recent: fresh, isDuplicate: true };
    }
    fresh.push({ id, at: now });
    return { recent: fresh, isDuplicate: false };
}

/**
 * A session id that is unique enough per device without a uuid dependency:
 * timestamp in base36 + random suffix.
 */
export function makeSessionId(now: number, random: () => number = Math.random): string {
    const randomPart = Math.floor(random() * 0xffffffff).toString(36).padStart(7, '0');
    return `${now.toString(36)}-${randomPart}`.slice(0, 80);
}

/** Clamp a session duration to the 0..24h range the server accepts. */
export function clampSessionDuration(durationMs: number): number {
    const max = 24 * 60 * 60 * 1000;
    if (!Number.isFinite(durationMs) || durationMs < 0) return 0;
    return Math.min(Math.round(durationMs), max);
}
