import React, { useState, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import axios from 'axios';
import Constants from "expo-constants";

import { NativeNotify, useNativeNotify, configureAnalytics } from './context';
import { readTotalCount } from './inboxUtils';
import { buildSendPayload, legacyDateSent } from './sendUtils';
import type { SendNotificationOptions } from './sendUtils';
import {
    getRegistrationMeta,
    reportNotificationOpen,
    setAnalyticsAppIds,
    setAnalyticsPushToken,
    startSessionAutoTracking,
} from './analytics';
import type { NativeNotifyAnalyticsConfig } from './context';

/**
 * A notification as returned by the inbox list endpoints (mass + indie).
 *
 * The controller maps the DB columns to these camelCase keys in every inbox
 * response, so `date` and `pushData` are the ones you will actually see; the
 * snake_case names are the raw column names and are kept as fallbacks for any
 * older or direct payloads. The index signature keeps unknown server fields
 * usable without a cast. `TData` lets you type the JSON you send as pushData:
 * `InboxNotification<{ screen: string }>`.
 */
export interface InboxNotification<TData = any> {
    notification_id: any;
    date?: any;
    title?: any;
    message?: any;
    pushData?: TData;
    date_sent?: any;
    push_data?: TData;
    /**
     * Per-notification read state (2026-09-21). Only authoritative when the
     * page was fetched with per-notification read state: indie pages with
     * `{ perNotification: true }`, mass pages with `{ perNotification: true }`
     * on a device with a push token. On legacy fetches every row reports
     * `false` (the whole inbox is marked read on fetch instead).
     */
    read?: boolean;
    [key: string]: any;
}

/** One page of inbox notifications plus the server's total row count. */
export interface InboxPage<T = InboxNotification> {
    rows: T[];
    /** The X-Total-Count response header, when the server sends one. */
    total: number | null;
}

// Show notifications that arrive while the app is in the foreground. Modern
// expo-notifications (SDK 53+) wants shouldShowBanner / shouldShowList —
// `shouldShowAlert` is deprecated and logs a runtime warning. If you want to
// control foreground behavior yourself, call
// Notifications.setNotificationHandler() after importing native-notify and
// yours wins (on SDK 58+ this handler is optional — foreground notifications
// are shown by default).
Notifications.setNotificationHandler({handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
})});

/** How long any request to the Native Notify API may take before it fails (ms). */
const REQUEST_TIMEOUT_MS = 10000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One retry with a short backoff — used for push-token registration. */
async function postWithRetry(url: string, data: any, retries: number = 1): Promise<any> {
    let lastError: any;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await axios.post(url, data, { timeout: REQUEST_TIMEOUT_MS });
        } catch (error) {
            lastError = error;
            if (attempt < retries) await sleep(500 * (attempt + 1));
        }
    }
    throw lastError;
}

/**
 * Remove an expo-notifications subscription. Prefers the subscription's own
 * .remove(); the deprecated Notifications.removeNotificationSubscription() is
 * only used as a fallback for very old expo-notifications versions.
 */
function removeSubscription(subscription: any) {
    if (!subscription) return;
    if (typeof subscription.remove === 'function') {
        subscription.remove();
        return;
    }
    const legacyRemove = (Notifications as any).removeNotificationSubscription;
    if (typeof legacyRemove === 'function') legacyRemove(subscription);
}

/**
 * The EAS projectId, with Expo's recommended fallback chain. Throws a clear
 * error instead of the raw TypeError the old nested access produced.
 */
function getProjectId(): string {
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    if (!projectId) {
        throw new Error(
            'Native Notify: no EAS projectId found. Add "extra.eas.projectId" to app.json (run `eas init`) ' +
            'so Expo push tokens can be minted. See https://docs.expo.dev/push-notifications/push-notifications-setup/#configure-projectid'
        );
    }
    return projectId;
}

/** True when running inside the Expo Go store client (not a dev build). */
function isExpoGo(): boolean {
    try {
        if (Constants && typeof Constants.executionEnvironment === 'string') {
            return Constants.executionEnvironment === 'storeClient';
        }
        if (Constants && typeof Constants.appOwnership === 'string') {
            return Constants.appOwnership === 'expo';
        }
    } catch (error) {
        // expo-constants unavailable — assume a real build.
    }
    return false;
}

/** Mint this device's Expo push token, or null when the environment can't. */
async function getExpoPushTokenSafe(): Promise<string | null> {
    try {
        const token = (await Notifications.getExpoPushTokenAsync({ projectId: getProjectId() })).data;
        return token || null;
    } catch (error) {
        // Web / simulators without push / Expo Go Android / missing projectId.
        return null;
    }
}

async function getDevicePushTokenSafe(): Promise<any> {
    try {
        return (await Notifications.getDevicePushTokenAsync()).data;
    } catch (error) {
        return undefined;
    }
}

/**
 * Resolve ids at call time: explicit arguments first, then
 * NativeNotify.init() / <NativeNotifyProvider> config.
 */
function resolveIds(appId?: any, appToken?: any): { appId?: any; appToken?: any } {
    const config = NativeNotify.getConfig();
    return {
        appId: appId ?? config.appId,
        appToken: appToken ?? config.appToken,
    };
}

/** What registerForPushNotificationsAsync() reports back. */
export interface PushTokenResult {
    status: 'success' | 'skipped' | 'error';
    /** Why registration was skipped or failed (when status is not 'success'). */
    reason?: string;
    /** Expo push token for the current platform. */
    expoPushToken?: string;
    /** Device (APNs / FCM) push token for the current platform. */
    devicePushToken?: any;
    expoAndroidToken?: string;
    fcmToken?: any;
    expoIosToken?: string;
    apnToken?: any;
}

/**
 * Mint this device's push tokens. Exported so you can run the raw flow
 * yourself (it never throws — it reports):
 *
 *   const result = await registerForPushNotificationsAsync();
 *   if (result.status === 'success') { ... }
 */
export async function registerForPushNotificationsAsync(): Promise<PushTokenResult> {
    if (Platform.OS === 'web') {
        return { status: 'skipped', reason: 'Push notifications are not supported on web.' };
    }

    try {
        if (Platform.OS === 'android') {
            await Notifications.setNotificationChannelAsync('default', {
                name: 'default',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                lightColor: '#FF231F7C',
            });
        }

        if (Platform.OS === 'android' && isExpoGo()) {
            const reason = 'Push notifications are not available in Expo Go on Android (SDK 53+). Use a development build (`npx expo run:android` or an EAS dev build).';
            console.log('[native-notify] ' + reason);
            return { status: 'skipped', reason };
        }

        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
            const { status } = await Notifications.requestPermissionsAsync();
            finalStatus = status;
        }
        if (finalStatus !== 'granted') {
            return { status: 'skipped', reason: 'Notification permissions were not granted.' };
        }

        const projectId = getProjectId();
        const result: PushTokenResult = { status: 'success' };

        if (Platform.OS === 'android') {
            result.expoAndroidToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
            result.fcmToken = (await Notifications.getDevicePushTokenAsync()).data;
            result.expoPushToken = result.expoAndroidToken;
            result.devicePushToken = result.fcmToken;
        } else if (Platform.OS === 'ios') {
            result.expoIosToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
            result.apnToken = (await Notifications.getDevicePushTokenAsync()).data;
            result.expoPushToken = result.expoIosToken;
            result.devicePushToken = result.apnToken;
        } else {
            return { status: 'skipped', reason: 'Push notifications are not supported on ' + Platform.OS + '.' };
        }

        return result;
    } catch (error: any) {
        return { status: 'error', reason: error && error.message ? error.message : String(error) };
    }
}

/** Optional callbacks for registerNNPushToken(). */
export interface RegisterNNPushTokenOptions {
    /** Called after the token was successfully registered with Native Notify. */
    onRegistered?: (result: PushTokenResult) => void;
    /** Called when registration (or a token-rotation re-registration) fails. */
    onError?: (error: any) => void;
    /** Re-register when the device push token rotates (default true). */
    watchTokenRotation?: boolean;
    /**
     * Opt-in analytics features for this app run (screens / sessions / opens /
     * deviceId). Same shape as NativeNotify.init({ analytics }) — merging with
     * whatever was configured there.
     */
    analytics?: NativeNotifyAnalyticsConfig;
}

export default function registerNNPushToken(appId?: any, appToken?: any, options: RegisterNNPushTokenOptions = {}): void {
    const contextConfig = useNativeNotify();
    const config = {
        appId: appId ?? contextConfig.appId,
        appToken: appToken ?? contextConfig.appToken,
    };

    const responseListener = useRef<any>(undefined);

    useEffect(() => {
        if (Platform.OS === 'web') return;

        const opts = options || {};
        // Merge this call's analytics flags (read at mount, like `options`),
        // and let the analytics reports use this call's ids when
        // NativeNotify.init() was not given any.
        configureAnalytics(opts.analytics);
        setAnalyticsAppIds(config.appId, config.appToken);
        let cancelled = false;

        // Guard state for the token-rotation listener below. Our own
        // registerForPushNotificationsAsync() fetches the device push token,
        // and expo-notifications documents that fetching inside a push-token
        // listener re-fires the listener — an infinite re-registration loop.
        // (It shipped in 5.0.0 and was observed in the wild 2026-09-16:
        // thousands of calls/sec, wildly inflating the app's analytics.) The
        // guards: skip same-token no-op events, skip self-triggered re-fires
        // within the interval, never overlap, and only re-post when the
        // tokens actually changed.
        const TOKEN_ROTATION_MIN_INTERVAL_MS = 60 * 1000;
        const tokenSignature = (r: PushTokenResult) => JSON.stringify([
            r.expoAndroidToken || null,
            r.fcmToken || null,
            r.expoIosToken || null,
            r.apnToken || null,
        ]);
        let lastPostedSignature: string | null = null;
        let lastDevicePushToken: string | null = null;
        let lastRotationHandledAt = 0;
        let rotationInFlight = false;

        const postTokens = async (result: PushTokenResult) => {
            // Registration enrichment (analytics wave): device id (opt-in),
            // app version + timezone — optional server-side.
            const meta = await getRegistrationMeta();
            return postWithRetry(`https://app.nativenotify.com/api/device/tokens`, {
                appId: config.appId,
                appToken: config.appToken,
                platformOS: Platform.OS,
                expoAndroidToken: result.expoAndroidToken,
                fcmToken: result.fcmToken,
                expoIosToken: result.expoIosToken,
                apnToken: result.apnToken,
                ...meta,
            });
        };

        if (!config.appId || !config.appToken) {
            console.warn('[native-notify] registerNNPushToken: appId and appToken are required. Pass them in, call NativeNotify.init({ appId, appToken }), or wrap your app in <NativeNotifyProvider>.');
        } else {
            (async () => {
                const result = await registerForPushNotificationsAsync();
                if (cancelled) return;

                if (result.status === 'success') {
                    try {
                        await postTokens(result);
                        lastPostedSignature = tokenSignature(result);
                        lastDevicePushToken = result.devicePushToken ? String(result.devicePushToken) : null;
                        setAnalyticsPushToken(result.expoPushToken);
                        console.log('You can now send a push notification. You successfully registered your Native Notify Push Token!');
                        if (typeof opts.onRegistered === 'function') opts.onRegistered(result);
                    } catch (error) {
                        console.log(error);
                        if (typeof opts.onError === 'function') opts.onError(error);
                    }
                } else {
                    if (result.reason) console.log('[native-notify] ' + result.reason);
                    if (result.status === 'error' && typeof opts.onError === 'function') {
                        opts.onError(new Error(result.reason || 'Push registration failed'));
                    }
                }
            })();
        }

        try {
            responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
                console.log(response);
                // Analytics: report the tap for per-notification open rates
                // (no-op unless analytics.opens is enabled; deduped against
                // the cold-start path inside useNativeNotifyPress).
                reportNotificationOpen(response && response.notification && response.notification.request
                    ? response.notification.request.content.data
                    : undefined);
            });
        } catch (error) {
            // Notifications unavailable in this environment.
        }

        // Analytics: foreground session tracking (no-op unless
        // analytics.sessions is enabled).
        const stopSessions = startSessionAutoTracking();

        // Expo push tokens can rotate (Android reinstall / applicationId
        // change, iOS backup restore). Re-register when the device token
        // changes so the server never keeps a dead token.
        //
        // IMPORTANT: this listener must never retrigger itself.
        // registerForPushNotificationsAsync() fetches the device push token,
        // and expo-notifications re-fires push-token listeners when
        // getDevicePushTokenAsync() runs — doing that unguarded inside this
        // handler is a documented infinite-loop footgun (see the guard state
        // above for the 2026-09-16 incident it caused).
        let tokenRotationSub: any = null;
        if (opts.watchTokenRotation !== false) {
            try {
                tokenRotationSub = Notifications.addPushTokenListener(async (incomingToken: any) => {
                    if (cancelled || rotationInFlight) return;

                    // Skip no-op events outright — e.g. this listener re-firing
                    // for our own fetch, which reports the token we already have.
                    const incomingData = incomingToken && typeof incomingToken === 'object' && typeof incomingToken.data === 'string'
                        ? incomingToken.data
                        : null;
                    if (incomingData && lastDevicePushToken && incomingData === lastDevicePushToken) return;

                    const now = Date.now();
                    if (now - lastRotationHandledAt < TOKEN_ROTATION_MIN_INTERVAL_MS) return;
                    lastRotationHandledAt = now;

                    rotationInFlight = true;
                    try {
                        const result = await registerForPushNotificationsAsync();
                        if (cancelled || result.status !== 'success' || !config.appId || !config.appToken) return;

                        // Only re-post when the tokens actually changed.
                        const signature = tokenSignature(result);
                        if (signature === lastPostedSignature) return;

                        await postTokens(result);
                        lastPostedSignature = signature;
                        lastDevicePushToken = result.devicePushToken ? String(result.devicePushToken) : null;
                        setAnalyticsPushToken(result.expoPushToken);
                        if (typeof opts.onRegistered === 'function') opts.onRegistered(result);
                    } catch (error) {
                        if (typeof opts.onError === 'function') opts.onError(error);
                    } finally {
                        rotationInFlight = false;
                    }
                });
            } catch (error) {
                // addPushTokenListener is unavailable (older expo-notifications).
            }
        }

        return () => {
            cancelled = true;
            removeSubscription(responseListener.current);
            removeSubscription(tokenRotationSub);
            if (stopSessions) stopSessions();
        };
        // Mount-once semantics (same as before): options are read at mount.
    }, []);
}

export async function registerIndieID(subID: any, appId?: any, appToken?: any): Promise<void> {
    const ids = resolveIds(appId, appToken);
    if (Platform.OS === 'web') {
        console.log('[native-notify] registerIndieID: push tokens are not available on web — skipping device registration.');
        return;
    }
    try {
        const expoToken = await getExpoPushTokenSafe();
        const deviceToken = await getDevicePushTokenSafe();
        if (expoToken) {
            // Registration enrichment (analytics wave): device id (opt-in),
            // app version + timezone — optional server-side.
            const meta = await getRegistrationMeta();
            setAnalyticsPushToken(expoToken);
            await axios.post(`https://app.nativenotify.com/api/indie/id`, {
                subID,
                appId: ids.appId,
                appToken: ids.appToken,
                platformOS: Platform.OS,
                expoToken,
                deviceToken,
                ...meta
            }, { timeout: REQUEST_TIMEOUT_MS })
            .then(() => console.log('You successfully registered your Indie ID.'))
            .catch(err => console.log(err));
        } else {
            console.log('Setup Error: Please, follow the "Start Here" instructions BEFORE trying to use this registerIndieID function.');
        }
    } catch (error) {
        console.log(error);
    }
}

export async function unregisterIndieDevice(subID: any, appId?: any, appToken?: any): Promise<void> {
    const ids = resolveIds(appId, appToken);
    if (Platform.OS === 'web') {
        console.log('[native-notify] unregisterIndieDevice: push tokens are not available on web — skipping.');
        return;
    }
    try {
        const expoToken = await getExpoPushTokenSafe();
        const deviceToken = await getDevicePushTokenSafe();
        if (expoToken) {
            await axios.put(`https://app.nativenotify.com/api/unregister/indie/device`, {
                appId: ids.appId,
                appToken: ids.appToken,
                subID,
                expoToken,
                deviceToken
            }, { timeout: REQUEST_TIMEOUT_MS })
            .then(() => console.log('You successfully unregistered your device from this Indie Sub ID.'))
            .catch(err => console.log(err));
        } else {
            console.log('Setup Error: Please, follow the "Start Here" instructions BEFORE trying to use this unregisterIndieDevice function.');
        }
    } catch (error) {
        console.log(error);
    }
}

export async function getFollowMaster(masterSubID: any, appId?: any, appToken?: any): Promise<{
    follower_indie_ids: any;
    follower_count: any;
    following_indie_ids: any;
    following_count: any;
}> {
    const ids = resolveIds(appId, appToken);
    let response = await axios.get(`https://app.nativenotify.com/api/follow/master/${masterSubID}/${ids.appId}/${ids.appToken}`, { timeout: REQUEST_TIMEOUT_MS })

    return {
        follower_indie_ids: response.data.follower_indie_ids,
        follower_count: response.data.follower_count,
        following_indie_ids: response.data.following_indie_ids,
        following_count: response.data.following_count };
}

/**
 * Structured result returned by the follow helpers. `message` carries the
 * same human-readable string the functions used to return; `status` is the
 * machine-readable one; `error` holds the underlying failure when there is
 * one — a network failure is no longer reported as "already registered".
 */
export interface NativeNotifyActionResult {
    success: boolean;
    status: 'registered' | 'already_registered' | 'posted' | 'already_posted' | 'unfollowed' | 'not_following' | 'removed' | 'not_found' | 'error';
    /** Human-readable message (the string the previous versions returned). */
    message: string;
    /** The underlying request error, when one occurred. */
    error?: any;
}

export async function registerFollowMasterID(masterSubID: any, appId?: any, appToken?: any): Promise<NativeNotifyActionResult> {
    const ids = resolveIds(appId, appToken);

    try {
        await axios.post(`https://app.nativenotify.com/api/post/follow/master`, {
            masterSubID: masterSubID,
            appId: ids.appId,
            appToken: ids.appToken
        }, { timeout: REQUEST_TIMEOUT_MS });

        return { success: true, status: 'registered', message: "Follow Master Indie ID registered!" };
    } catch (error: any) {
        // The endpoint answers 400 with "Master ID already exists." when the
        // master is registered — that is the only 400 it produces.
        if (error && error.response && error.response.status === 400) {
            return { success: false, status: 'already_registered', message: "Follow Master Indie ID already registered." };
        }
        return { success: false, status: 'error', message: "Follow Master registration failed. Inspect `error` for details.", error };
    }
}

export async function registerFollowerID(masterSubID: any, followerSubID: any, appId?: any, appToken?: any): Promise<NativeNotifyActionResult> {
    const ids = resolveIds(appId, appToken);

    try {
        const response = await axios.post(`https://app.nativenotify.com/api/post/follower`, {
            masterSubID: masterSubID,
            followerSubID: followerSubID,
            appId: ids.appId,
            appToken: ids.appToken
        }, { timeout: REQUEST_TIMEOUT_MS });

        // Already-registered is ALSO a 201 — the body text is the only signal.
        const body = typeof response.data === 'string' ? response.data : '';
        if (/already exists/i.test(body)) {
            return { success: false, status: 'already_registered', message: "Follower Indie ID already registered." };
        }
        return { success: true, status: 'registered', message: "Follower Indie ID registered!" };
    } catch (error: any) {
        if (error && error.response && error.response.status === 404) {
            return { success: false, status: 'error', message: "Follow Master Indie ID does not exist for this app.", error };
        }
        return { success: false, status: 'error', message: "Follower registration failed. Inspect `error` for details.", error };
    }
}

export async function postFollowingID(masterSubID: any, followingSubID: any, appId?: any, appToken?: any): Promise<NativeNotifyActionResult> {
    const ids = resolveIds(appId, appToken);

    try {
        const response = await axios.post(`https://app.nativenotify.com/api/post/following`, {
            masterSubID: masterSubID,
            followingSubID: followingSubID,
            appId: ids.appId,
            appToken: ids.appToken
        }, { timeout: REQUEST_TIMEOUT_MS });

        const body = typeof response.data === 'string' ? response.data : '';
        if (/already exists/i.test(body)) {
            return { success: false, status: 'already_posted', message: "Following Indie ID already posted." };
        }
        return { success: true, status: 'posted', message: "Following Indie ID posted!" };
    } catch (error: any) {
        if (error && error.response && error.response.status === 404) {
            return { success: false, status: 'error', message: "That master sub id is not registered to this app.", error };
        }
        return { success: false, status: 'error', message: "Posting the following Indie ID failed. Inspect `error` for details.", error };
    }
}

export async function unfollowMasterID(masterSubID: any, followerSubID: any, appId?: any, appToken?: any): Promise<NativeNotifyActionResult> {
    const ids = resolveIds(appId, appToken);

    try {
        await axios.put(`https://app.nativenotify.com/api/unfollow/master`, {
            masterSubID: masterSubID,
            followerSubID: followerSubID,
            appId: ids.appId,
            appToken: ids.appToken
        }, { timeout: REQUEST_TIMEOUT_MS });

        return { success: true, status: 'unfollowed', message: "Follow Master unfollowed successfully!" };
    } catch (error: any) {
        // 400 = not a follower (the endpoint's own signal).
        if (error && error.response && error.response.status === 400) {
            return { success: false, status: 'not_following', message: "FollowSubID is not following Follow Master." };
        }
        return { success: false, status: 'error', message: "Unfollow failed. Inspect `error` for details.", error };
    }
}

export async function updateFollowersList(masterSubID: any, followingSubID: any, appId?: any, appToken?: any): Promise<NativeNotifyActionResult> {
    const ids = resolveIds(appId, appToken);

    try {
        await axios.put(`https://app.nativenotify.com/api/master/followers/list`, {
            masterSubID: masterSubID,
            followingSubID: followingSubID,
            appId: ids.appId,
            appToken: ids.appToken
        }, { timeout: REQUEST_TIMEOUT_MS });

        return { success: true, status: 'removed', message: "Follow Master ID removed from Follower List successfully!" };
    } catch (error) {
        // The server only responds when the removal actually happened; an
        // unknown master (404), a sub that is not in the list, or a hung
        // request (converted to a timeout by REQUEST_TIMEOUT_MS) all land
        // here. `error` carries the specifics.
        return { success: false, status: 'not_found', message: "Follow Master ID is not in the Follower List.", error };
    }
}

export async function deleteFollowMaster(appId?: any, appToken?: any, masterSubID?: any): Promise<void> {
    const ids = resolveIds(appId, appToken);

    await axios
        .delete(`https://app.nativenotify.com/api/follow/master/${ids.appId}/${ids.appToken}/${masterSubID}`, { timeout: REQUEST_TIMEOUT_MS })
        .then(() => console.log("Follower Master unfollowed successfully!"))
        .catch(() => console.log("Follower Master does not exist."));
}

// The response that launched the app (cold start) is NOT delivered to
// addNotificationResponseReceivedListener, so it is read once via
// getLastNotificationResponse() and then never again for this process.
let coldStartResponseConsumed = false;

function readColdStartResponseOnce(): any {
    if (coldStartResponseConsumed) return null;
    try {
        const getLast = (Notifications as any).getLastNotificationResponse;
        if (typeof getLast === 'function') {
            const last = getLast();
            if (last) {
                coldStartResponseConsumed = true;
                return last;
            }
        }
    } catch (error) {
        // Older expo-notifications: no synchronous getter.
    }
    return null;
}

/**
 * A typed hook for push-notification taps.
 *
 *   const { data, notification } = useNativeNotifyPress<{ url?: string }>();
 *   useEffect(() => { if (data?.url) router.push(data.url); }, [data]);
 *
 * Handles BOTH the tap that launched a cold app and taps while it runs. The
 * `data` is the pushData JSON you attached when sending; `notification` is
 * the raw expo-notifications response (for advanced use).
 */
export function useNativeNotifyPress<T = { [key: string]: any }>(): { data: T; notification: any } {
    const [response, setResponse] = useState<any>(null);

    useEffect(() => {
        let cancelled = false;
        const handle = (r: any) => {
            if (!cancelled && r) setResponse(r);
            // Analytics: report the tap for per-notification open rates
            // (no-op unless analytics.opens is enabled; deduped against the
            // registration listener's report of the same tap).
            reportNotificationOpen(r && r.notification && r.notification.request
                ? r.notification.request.content.data
                : undefined);
        };

        const last = readColdStartResponseOnce();
        if (last) {
            handle(last);
        } else {
            // Async variant for expo-notifications versions without the sync getter.
            try {
                const getLastAsync = (Notifications as any).getLastNotificationResponseAsync;
                if (typeof getLastAsync === 'function' && !coldStartResponseConsumed) {
                    getLastAsync()
                        .then((r: any) => {
                            if (r) {
                                coldStartResponseConsumed = true;
                                handle(r);
                            }
                        })
                        .catch(() => {});
                }
            } catch (error) {
                // Notifications unavailable in this environment.
            }
        }

        let subscription: any = null;
        try {
            subscription = Notifications.addNotificationResponseReceivedListener(handle);
        } catch (error) {
            // Notifications unavailable in this environment.
        }

        return () => {
            cancelled = true;
            removeSubscription(subscription);
        };
    }, []);

    const content = response && response.notification && response.notification.request
        ? response.notification.request.content
        : null;
    const data = ((content && content.data) || {}) as T;

    return { data, notification: response };
}

/**
 * The pushData JSON of the last tapped push notification (cold starts
 * included). A convenience wrapper over useNativeNotifyPress().
 */
export function getPushDataObject<T = { [key: string]: any }>(): T {
    return useNativeNotifyPress<T>().data;
}

/** The pushData JSON of the last notification received while the app is open. */
export function getPushDataInForeground<T = { [key: string]: any }>(): T {
    const [data, setData] = useState<any>({});

    useEffect(() => {
        let subscription: any = null;
        try {
            subscription = Notifications.addNotificationReceivedListener(response => {
                setData(response.request.content.data);
            });
        } catch (error) {
            // Notifications unavailable in this environment.
        }
        return () => removeSubscription(subscription);
    }, []);

    return data as T;
}

function toUnreadCount(data: any): number {
    const n = Number(data && data.unreadCount);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/**
 * One page of the mass (app-wide) inbox. Marks the inbox as read first, the
 * same as getNotificationInbox() always has.
 *
 * Per-notification read state (2026-09-21): pass
 * `{ perNotification: true }` to fetch each row's real read state for THIS
 * device (`?expoToken=`) and skip the mark-all-read — pair it with
 * markMassNotificationRead() when a row is opened. Without the option the
 * request is byte-identical to previous versions (legacy callers unchanged).
 */
export async function getNotificationInboxPage(appId?: any, appToken?: any, take: any = 20, skip: any = 0, options?: PerNotificationReadOptions): Promise<InboxPage> {
    const ids = resolveIds(appId, appToken);
    const perNotification = !!(options && options.perNotification);

    let deviceToken: string | null = null;
    if (Platform.OS !== 'web') {
        deviceToken = await getExpoPushTokenSafe();
    }

    if (!perNotification && deviceToken) {
        try {
            await axios.post(`https://app.nativenotify.com/api/notification/inbox/read`, {
                appId: ids.appId,
                appToken: ids.appToken,
                expoToken: deviceToken,
            }, { timeout: REQUEST_TIMEOUT_MS });
        } catch (error) {
            // Marking everything read is best-effort; never block reading.
        }
    }

    const tokenParam = perNotification && deviceToken
        ? `&expoToken=${encodeURIComponent(deviceToken)}`
        : '';
    let response = await axios.get(`https://app.nativenotify.com/api/notification/inbox/${ids.appId}/${ids.appToken}?take=${take}&skip=${skip}${tokenParam}`, { timeout: REQUEST_TIMEOUT_MS });

    return {
        rows: Array.isArray(response.data) ? response.data : [],
        total: readTotalCount(response.headers),
    };
}

export async function getNotificationInbox(appId: any, appToken: any, take: any, skip: any): Promise<InboxNotification[]> {
    return (await getNotificationInboxPage(appId, appToken, take, skip)).rows;
}

export async function getUnreadNotificationInboxCount(appId?: any, appToken?: any): Promise<number> {
    const ids = resolveIds(appId, appToken);

    if (Platform.OS === 'web') return 0;

    const token = await getExpoPushTokenSafe();
    if (!token) return 0; // no push token (simulator / Expo Go / missing projectId)

    let response = await axios.get(`https://app.nativenotify.com/api/notification/inbox/read/${ids.appId}/${ids.appToken}/${token}`, { timeout: REQUEST_TIMEOUT_MS });

    return toUnreadCount(response.data);
}

/** Options for per-notification read state (2026-09-21). */
export interface PerNotificationReadOptions {
    /**
     * Fetch each row's real read state instead of marking the whole inbox
     * read on fetch. Indie pages add `?perNotification=true`; mass pages add
     * this device's `?expoToken=` (needs a real device push token — on
     * simulators/web there is no per-device read state). Mark opened rows
     * with markIndieNotificationRead() / markMassNotificationRead().
     */
    perNotification?: boolean;
}

/**
 * Mark ONE mass-inbox notification read for this device (2026-09-21; pair
 * with getNotificationInboxPage(..., { perNotification: true })). Best-effort
 * — resolves false when there is no device token or the server rejects the
 * call; never throws.
 */
export async function markMassNotificationRead(notificationId: any, appId?: any, appToken?: any): Promise<boolean> {
    const ids = resolveIds(appId, appToken);
    if (Platform.OS === 'web') return false;
    try {
        const token = await getExpoPushTokenSafe();
        if (!token) return false;
        await axios.post(`https://app.nativenotify.com/api/notification/inbox/read`, {
            appId: ids.appId,
            appToken: ids.appToken,
            expoToken: token,
            notificationId,
        }, { timeout: REQUEST_TIMEOUT_MS });
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Mark ONE indie-inbox notification read (2026-09-21; pair with
 * getIndieNotificationInboxPage(..., { perNotification: true })). Best-effort
 * — resolves false on any failure; never throws.
 */
export async function markIndieNotificationRead(notificationId: any, subId?: any, appId?: any, appToken?: any): Promise<boolean> {
    const ids = resolveIds(appId, appToken);
    try {
        await axios.post(`https://app.nativenotify.com/api/indie/notification/inbox/read`, {
            appId: ids.appId,
            appToken: ids.appToken,
            subId,
            notificationId,
        }, { timeout: REQUEST_TIMEOUT_MS });
        return true;
    } catch (error) {
        return false;
    }
}

/** One page of an indie (per-user) inbox.
 *
 * Per-notification read state (2026-09-21): pass
 * `{ perNotification: true }` to add `?perNotification=true`, which returns
 * each row's real read flag and stops the server marking the whole inbox
 * read on fetch. Without the option the request is byte-identical to
 * previous versions (legacy callers unchanged).
 */
export async function getIndieNotificationInboxPage(subId?: any, appId?: any, appToken?: any, take: any = 20, skip: any = 0, options?: PerNotificationReadOptions): Promise<InboxPage> {
    const ids = resolveIds(appId, appToken);
    const perParam = options && options.perNotification ? '&perNotification=true' : '';

    let response = await axios.get(`https://app.nativenotify.com/api/indie/notification/inbox/${subId}/${ids.appId}/${ids.appToken}?take=${take}&skip=${skip}${perParam}`, { timeout: REQUEST_TIMEOUT_MS });

    return {
        rows: Array.isArray(response.data) ? response.data : [],
        total: readTotalCount(response.headers),
    };
}

export async function getIndieNotificationInbox(subId: any, appId: any, appToken: any, take: any, skip: any): Promise<InboxNotification[]> {
    return (await getIndieNotificationInboxPage(subId, appId, appToken, take, skip)).rows;
}

export async function getUnreadIndieNotificationInboxCount(subId: any, appId?: any, appToken?: any): Promise<number> {
    const ids = resolveIds(appId, appToken);

    let response = await axios.get(`https://app.nativenotify.com/api/indie/notification/inbox/read/${subId}/${ids.appId}/${ids.appToken}`, { timeout: REQUEST_TIMEOUT_MS });

    return toUnreadCount(response.data);
}

export async function deleteIndieNotificationInbox(subId: any, notificationId: any, appId?: any, appToken?: any): Promise<any> {
    const ids = resolveIds(appId, appToken);

    let response = await axios.delete(`https://app.nativenotify.com/api/indie/notification/inbox/notification/${ids.appId}/${ids.appToken}/${notificationId}/${subId}`, { timeout: REQUEST_TIMEOUT_MS });

    return response.data;
}

// ---- sending notifications (rich-field passthrough, 2026-09-21) ------------
// The server's send endpoints accept the rich Expo message fields
// (subtitle/badge/ttl/interruptionLevel/categoryId/channelId/collapseId/
// contentAvailable/mutableContent/sound) on every path — mass, indie, group
// and followers. These helpers pass the caller's SendNotificationOptions
// straight through (see sendUtils.ts), so an app — or an agent driving it —
// can send the same modern messages the dashboard and the MCP server send.
//
// Sends are LIVE: every matched device receives them and they cannot be
// recalled. Each helper resolves with the server's response body and throws
// when the server rejects the send.

/**
 * Send ONE push notification to every registered device of the app (mass
 * send) — LIVE, cannot be recalled. `options` carries the pushData JSON and
 * the rich Expo message fields (subtitle, badge, ttl, interruptionLevel,
 * categoryId, channelId, collapseId, contentAvailable, mutableContent, sound,
 * bigPictureURL); unset fields keep the server defaults.
 */
export async function sendMassNotification(title: string, body: string, options: SendNotificationOptions = {}): Promise<any> {
    const ids = resolveIds(options.appId, options.appToken);

    const response = await axios.post('https://app.nativenotify.com/api/notification', {
        appId: ids.appId,
        appToken: ids.appToken,
        title,
        body,
        // The mass endpoint stores the inbox date exactly as the caller sends
        // it (the indie/group paths stamp their own), so without this every
        // inbox row of an SDK send had no date.
        dateSent: legacyDateSent(),
        ...buildSendPayload(options),
    }, { timeout: REQUEST_TIMEOUT_MS });

    return response.data;
}

/**
 * Send a push notification to ONE individual-push subscriber (indie push) —
 * LIVE. The subscriber must already be registered to this app (subID is your
 * app's own user id for that person; see registerIndieID()). `options` works
 * exactly like sendMassNotification()'s.
 */
export async function sendIndieNotification(subID: any, title: string, message: string, options: SendNotificationOptions = {}): Promise<any> {
    const ids = resolveIds(options.appId, options.appToken);

    const response = await axios.post('https://app.nativenotify.com/api/indie/notification', {
        appId: ids.appId,
        appToken: ids.appToken,
        subID,
        title,
        message,
        ...buildSendPayload(options),
    }, { timeout: REQUEST_TIMEOUT_MS });

    return response.data;
}

/**
 * Send a push notification to a list of subscribers (group push) — LIVE. Use
 * it for a custom audience you already hold as subIDs; for the followers of a
 * follow-master use sendNotificationToFollowers() instead. `options` works
 * exactly like sendMassNotification()'s.
 *
 * Throws when subIDs is not a non-empty array (an empty audience would be a
 * silent no-op — better to hear about it before the send).
 */
export async function sendIndieGroupNotification(subIDs: any[], title: string, message: string, options: SendNotificationOptions = {}): Promise<any> {
    if (!Array.isArray(subIDs) || subIDs.length === 0) {
        throw new Error('[native-notify] sendIndieGroupNotification: subIDs must be a non-empty array.');
    }
    const ids = resolveIds(options.appId, options.appToken);

    const response = await axios.post('https://app.nativenotify.com/api/indie/group/notification', {
        appId: ids.appId,
        appToken: ids.appToken,
        subIDs,
        title,
        message,
        ...buildSendPayload(options),
    }, { timeout: REQUEST_TIMEOUT_MS });

    return response.data;
}

/**
 * Send a push notification to every follower of one follow-master subID (a
 * user others follow) — LIVE. Different from a topic group: this is a single
 * account's followers. Pair it with registerFollowMasterID() /
 * registerFollowerID() to build the follow graph. `options` works exactly
 * like sendMassNotification()'s.
 */
export async function sendNotificationToFollowers(masterSubID: any, title: string, message: string, options: SendNotificationOptions = {}): Promise<any> {
    const ids = resolveIds(options.appId, options.appToken);

    const response = await axios.post('https://app.nativenotify.com/api/follow/notification', {
        appId: ids.appId,
        appToken: ids.appToken,
        masterSubID,
        title,
        message,
        ...buildSendPayload(options),
    }, { timeout: REQUEST_TIMEOUT_MS });

    return response.data;
}

/** Options for setAndroidNotificationChannel() — only the keys you set are used. */
export interface AndroidNotificationChannelOptions {
    /** Human-readable channel name shown in Android settings (defaults to the channel id). */
    name?: string;
    /** Long description shown in Android settings. */
    description?: string;
    /** One of Notifications.AndroidImportance (MAX / HIGH / DEFAULT / LOW / MIN). */
    importance?: any;
    /** Custom sound file name (omit for the platform default). */
    sound?: string | null;
    /** Vibration pattern in ms, e.g. [0, 250, 250, 250]. */
    vibrationPattern?: number[];
    /** Notification LED color, e.g. '#FF231F7C'. */
    lightColor?: string;
    enableLights?: boolean;
    enableVibrate?: boolean;
    /** Show a badge dot on the app icon for this channel's notifications. */
    showBadge?: boolean;
}

/**
 * Create (or update) an Android notification channel — a thin wrapper over
 * expo-notifications' Notifications.setNotificationChannelAsync(). Create a
 * channel before sending a push with a matching `channelId`, so the
 * notification routes to it (name/sound/importance/vibration are user-visible
 * in Android's per-app notification settings).
 *
 *   await setAndroidNotificationChannel('alerts', {
 *     name: 'Alerts',
 *     importance: Notifications.AndroidImportance.HIGH,
 *     sound: 'chime.wav',
 *   });
 *   await sendMassNotification('Heads up', 'The service is back', { channelId: 'alerts' });
 *
 * Resolves true when the channel was created; false on web/iOS (Android
 * channels do not exist there) or when the call fails — it never throws.
 */
export async function setAndroidNotificationChannel(channelId: string, options: AndroidNotificationChannelOptions = {}): Promise<boolean> {
    if (!channelId || Platform.OS !== 'android') return false;
    try {
        const setChannel = (Notifications as any).setNotificationChannelAsync;
        if (typeof setChannel !== 'function') return false;

        const channel: any = { name: options.name || channelId };
        if (options.description !== undefined) channel.description = options.description;
        if (options.importance !== undefined) channel.importance = options.importance;
        if (options.sound !== undefined) channel.sound = options.sound;
        if (options.vibrationPattern !== undefined) channel.vibrationPattern = options.vibrationPattern;
        if (options.lightColor !== undefined) channel.lightColor = options.lightColor;
        if (options.enableLights !== undefined) channel.enableLights = options.enableLights;
        if (options.enableVibrate !== undefined) channel.enableVibrate = options.enableVibrate;
        if (options.showBadge !== undefined) channel.showBadge = options.showBadge;

        await setChannel(channelId, channel);
        return true;
    } catch (error) {
        // Channel creation is best-effort — callers keep their default channel.
        return false;
    }
}

// Credentials config (NativeNotify.init / <NativeNotifyProvider> / useNativeNotify).
export { NativeNotify, NativeNotifyProvider, useNativeNotify, configureAnalytics } from './context';
export type { NativeNotifyConfig, NativeNotifyProviderProps, NativeNotifyAnalyticsConfig } from './context';

// Send helpers (2026-09-21): the rich-field options shared by every send
// function (sendMassNotification, sendIndieNotification,
// sendIndieGroupNotification, sendNotificationToFollowers).
export type { RichPushFields, SendNotificationOptions } from './sendUtils';

// Analytics (opt-in): screen views, sessions, notification-open reports and
// the stable device id (see the analytics flags on NativeNotify.init).
export {
    trackScreen,
    flushScreenQueue,
    reportNotificationOpen,
    startSessionTracking,
    endSessionTracking,
    startSessionAutoTracking,
    useNativeNotifyScreenTracking,
    useNativeNotifySessionTracking,
    getStableDeviceKey,
    getRegistrationMeta,
    setAnalyticsPushToken,
} from './analytics';

// Prebuilt Notification Inbox components (bell icon + full-screen inbox + data hook).
export {
    NotificationInboxBell,
    NotificationInboxScreen,
    useNotificationInbox,
} from './inbox';

// Re-export the component prop/result types so consumers can import them from
// the package root, exactly as they could from the previous index.d.ts.
export type {
    NotificationInboxTheme,
    NotificationInboxScreenProps,
    NotificationInboxBellProps,
    UseNotificationInboxOptions,
    UseNotificationInboxResult,
} from './inbox';
