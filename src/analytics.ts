/**
 * Analytics for Native Notify — screens, sessions and notification opens.
 *
 * Everything here is OPT-IN (all flags default to false):
 *
 *   NativeNotify.init({
 *     appId: APP_ID,
 *     appToken: APP_TOKEN,
 *     analytics: { screens: true, sessions: true, opens: true, deviceId: true },
 *   });
 *
 * or pass the same `analytics` object in registerNNPushToken's options. What
 * each flag enables:
 *   - screens:  trackScreen(name) + useNativeNotifyScreenTracking() (auto
 *               tracks expo-router route changes; "which screens do users use
 *               most").
 *   - sessions: foreground session tracking (sessions per day + average
 *               session length). Auto-wired by registerNNPushToken; a
 *               useNativeNotifySessionTracking() hook exists for manual use.
 *   - opens:    reports notification taps to POST /api/notification/opened so
 *               per-notification open rates get real numbers. Needs the
 *               server-injected nn_notification_id in the payload (sent by
 *               Native Notify since the 2026-09 analytics wave).
 *   - deviceId: sends a stable device id (expo-application
 *               getIosIdForVendorAsync() / getAndroidId()) with registrations
 *               and analytics events so unique counts survive Expo-token
 *               rotation. Off by default (privacy-first).
 *
 * Analytics calls are best-effort by design: a failed request NEVER throws
 * into the app, and requests are batched/throttled (screen views flush after
 * a short delay; consecutive duplicates collapse).
 */
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import axios from 'axios';
import Constants from 'expo-constants';

import { NativeNotify } from './context';
import {
    MAX_SCREEN_NAME_LENGTH,
    clampSessionDuration,
    isDuplicateScreenChange,
    makeSessionId,
    normalizeScreenName,
    recordOpenReport,
    OpenReport,
} from './analyticsUtils';

const API_BASE = 'https://app.nativenotify.com';
const REQUEST_TIMEOUT_MS = 10000;
/** Screen views are batched for this long before one request goes out. */
const SCREEN_FLUSH_DELAY_MS = 2000;
/** A tap reported twice (listener + cold-start path) inside this window is one open. */
const OPEN_DEDUPE_WINDOW_MS = 5000;

// ---- module state ----------------------------------------------------------
let expoPushToken: string | null = null;
let deviceKey: string | null = null;
let deviceKeyResolved = false;
let screenWarned = false;

let pendingScreens: string[] = [];
let screenFlushTimer: ReturnType<typeof setTimeout> | null = null;
let lastScreenName: string | null = null;

let recentOpenReports: OpenReport[] = [];

let sessionId: string | null = null;
let sessionStartedAt = 0;

// ---- shared helpers --------------------------------------------------------

/** Remember this device's Expo push token (used as device context on reports). */
export function setAnalyticsPushToken(token?: string | null): void {
    if (token) expoPushToken = token;
}

/**
 * The stable per-device id (expo-application IDFV / ANDROID_ID), resolved
 * once and cached. Returns null when the deviceId flag is off, the
 * expo-application module is not installed, or the platform doesn't expose
 * one — reports then fall back to the Expo push token for uniques.
 */
export async function getStableDeviceKey(): Promise<string | null> {
    if (!NativeNotify.getAnalyticsConfig().deviceId) return null;
    if (deviceKeyResolved) return deviceKey;
    deviceKeyResolved = true;
    try {
        // Dynamic specifier: a literal require('expo-application') would make
        // Metro/webpack fail the BUNDLE for apps that don't have the optional
        // module installed — this way resolution happens at runtime and the
        // catch covers its absence.
        const specifier = 'expo-application';
        const Application: any = require(specifier);
        if (Platform.OS === 'ios' && typeof Application.getIosIdForVendorAsync === 'function') {
            deviceKey = await Application.getIosIdForVendorAsync();
        } else if (Platform.OS === 'android' && typeof Application.getAndroidId === 'function') {
            deviceKey = Application.getAndroidId();
        }
        deviceKey = deviceKey ? String(deviceKey).slice(0, 200) : null;
    } catch (error) {
        deviceKey = null;
    }
    return deviceKey;
}

/**
 * Optional context sent with registrations (postDeviceTokens / registerIndieID)
 * and analytics events: stable device id (only when enabled), app version, and
 * the device timezone. All fields are optional server-side.
 */
export async function getRegistrationMeta(): Promise<{ deviceId?: string; appVersion?: string; timezone?: string }> {
    const meta: { deviceId?: string; appVersion?: string; timezone?: string } = {};
    const key = await getStableDeviceKey();
    if (key) meta.deviceId = key;
    try {
        const version = (Constants as any)?.expoConfig?.version;
        if (version) meta.appVersion = String(version).slice(0, 50);
    } catch (error) {
        // expo-constants unavailable — version is optional.
    }
    try {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (timezone) meta.timezone = String(timezone).slice(0, 60);
    } catch (error) {
        // No Intl tz data — optional.
    }
    return meta;
}

/** Device context for analytics events: stable id when present, else the push token. */
async function deviceContext(): Promise<{ deviceId?: string; token?: string }> {
    const context: { deviceId?: string; token?: string } = {};
    const key = await getStableDeviceKey();
    if (key) context.deviceId = key;
    if (expoPushToken) context.token = expoPushToken;
    return context;
}

// ---- screen views ----------------------------------------------------------

/**
 * Track a screen view. Screens are reported to Native Notify when the
 * `analytics: { screens: true }` flag is on:
 *
 *   trackScreen('Home');
 *   trackScreen(`/products/${id}`);
 *
 * Batched: views queue and flush after ~2s (or immediately via
 * flushScreenQueue(), e.g. when the app backgrounds); the SAME screen twice
 * in a row counts once.
 */
export function trackScreen(screenName?: string | null): void {
    if (!NativeNotify.getAnalyticsConfig().screens) {
        if (!screenWarned) {
            screenWarned = true;
            console.log(
                '[native-notify] Screen tracking is disabled. Enable it with ' +
                'NativeNotify.init({ analytics: { screens: true } }) or pass ' +
                'analytics: { screens: true } to registerNNPushToken.'
            );
        }
        return;
    }
    const name = normalizeScreenName(screenName);
    if (!name) return;
    if (isDuplicateScreenChange(lastScreenName, name)) return;
    lastScreenName = name;
    pendingScreens.push(name);
    if (!screenFlushTimer) {
        screenFlushTimer = setTimeout(() => {
            screenFlushTimer = null;
            flushScreenQueue();
        }, SCREEN_FLUSH_DELAY_MS);
    }
}

/** Send queued screen views now (safe to call any time; no-op when empty). */
export function flushScreenQueue(): void {
    if (screenFlushTimer) {
        clearTimeout(screenFlushTimer);
        screenFlushTimer = null;
    }
    const batch = pendingScreens;
    pendingScreens = [];
    if (batch.length === 0) return;

    (async () => {
        const ids = NativeNotify.getConfig();
        if (!ids.appId || !ids.appToken) return;
        const context = await deviceContext();
        const events = batch.map((screenName) => ({ screenName, ...context }));
        try {
            await axios.post(
                `${API_BASE}/api/analytics/screen`,
                { appId: ids.appId, appToken: ids.appToken, events },
                { timeout: REQUEST_TIMEOUT_MS }
            );
        } catch (error) {
            // Analytics never breaks the app — a dropped batch is acceptable.
        }
    })();
}

// expo-router is resolved ONCE per process: apps that use it get automatic
// route tracking from useNativeNotifyScreenTracking(); apps that don't must
// pass an explicit getScreen callback. The single resolution keeps the hook
// order identical across every render (either always called or never).
// Dynamic specifier + catch: bundlers must not fail the build for apps
// without expo-router, and the runtime absence is expected.
let expoRouter: any = null;
try {
    const specifier = 'expo-router';
    expoRouter = require(specifier);
} catch (error) {
    expoRouter = null;
}

/**
 * Automatically track screens for the lifetime of the calling component.
 *
 * Expo Router apps need no arguments — the documentated pattern (track the
 * route in the root layout) is baked in via usePathname():
 *
 *   export default function RootLayout() {
 *     useNativeNotifyScreenTracking();
 *     return <Slot />;
 *   }
 *
 * React Navigation (or anything else) passes its own reader:
 *
 *   useNativeNotifyScreenTracking(() => currentRouteNameRef.current);
 */
export function useNativeNotifyScreenTracking(getScreen?: () => string | undefined | null): void {
    const pathname = expoRouter && typeof expoRouter.usePathname === 'function'
        ? expoRouter.usePathname()
        : undefined;

    useEffect(() => {
        if (!NativeNotify.getAnalyticsConfig().screens) return;
        const name = getScreen ? getScreen() : pathname;
        if (name) trackScreen(name);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pathname]);
}

// ---- sessions --------------------------------------------------------------

/**
 * Start foreground session tracking (opt-in via analytics.sessions). Called
 * automatically by registerNNPushToken; exported for manual wiring.
 * Idempotent — an active session is left alone.
 */
export function startSessionTracking(): void {
    if (!NativeNotify.getAnalyticsConfig().sessions) return;
    if (sessionId) return;
    sessionId = makeSessionId(Date.now());
    sessionStartedAt = Date.now();
}

/**
 * End the active session and report its duration (best-effort). Also flushes
 * queued screen views, so a session that ends with unsent screens doesn't
 * lose them.
 */
export function endSessionTracking(): void {
    if (!sessionId) return;
    const id = sessionId;
    const durationMs = clampSessionDuration(Date.now() - sessionStartedAt);
    sessionId = null;
    sessionStartedAt = 0;

    flushScreenQueue();

    (async () => {
        const ids = NativeNotify.getConfig();
        if (!ids.appId || !ids.appToken) return;
        const context = await deviceContext();
        try {
            await axios.post(
                `${API_BASE}/api/analytics/session`,
                { appId: ids.appId, appToken: ids.appToken, sessionId: id, durationMs, ...context },
                { timeout: REQUEST_TIMEOUT_MS }
            );
        } catch (error) {
            // Best-effort.
        }
    })();
}

/**
 * Wire session start/end to AppState (foreground/background). Returns a
 * cleanup that removes the listener and closes any open session, or null when
 * sessions are disabled / unsupported. registerNNPushToken calls this
 * automatically; useNativeNotifySessionTracking() wraps it for manual setups.
 */
export function startSessionAutoTracking(): (() => void) | null {
    if (Platform.OS === 'web' || !NativeNotify.getAnalyticsConfig().sessions) return null;
    startSessionTracking();
    let subscription: any = null;
    try {
        subscription = AppState.addEventListener('change', (state: string) => {
            if (state === 'active') {
                startSessionTracking();
            } else {
                endSessionTracking();
            }
        });
    } catch (error) {
        // AppState unavailable in this environment.
    }
    return () => {
        if (subscription && typeof subscription.remove === 'function') subscription.remove();
        endSessionTracking();
    };
}

/** Hook form of startSessionAutoTracking() for manual setups. */
export function useNativeNotifySessionTracking(): void {
    useEffect(() => {
        const stop = startSessionAutoTracking();
        return () => {
            if (stop) stop();
        };
    }, []);
}

// ---- notification opens ----------------------------------------------------

/**
 * Report a notification tap for per-notification open analytics (opt-in via
 * analytics.opens). Reads the server-injected `nn_notification_id` from the
 * notification's data; taps on notifications without it (older sends, group
 * sends) are ignored. Duplicate reports for the same id inside a short window
 * collapse into one — the listener + cold-start paths both see the same tap.
 */
export function reportNotificationOpen(pushData?: any): void {
    if (!NativeNotify.getAnalyticsConfig().opens) return;
    if (!pushData) return;
    const raw = pushData.nn_notification_id ?? pushData.nnNotificationId;
    if (raw === undefined || raw === null || raw === '') return;

    const result = recordOpenReport(recentOpenReports, String(raw), Date.now(), OPEN_DEDUPE_WINDOW_MS);
    recentOpenReports = result.recent;
    if (result.isDuplicate) return;

    (async () => {
        const ids = NativeNotify.getConfig();
        if (!ids.appId || !ids.appToken) return;
        const context = await deviceContext();
        try {
            await axios.post(
                `${API_BASE}/api/notification/opened`,
                { appId: ids.appId, appToken: ids.appToken, notification_id: String(raw), ...context },
                { timeout: REQUEST_TIMEOUT_MS }
            );
        } catch (error) {
            // Best-effort.
        }
    })();
}

export { MAX_SCREEN_NAME_LENGTH };
