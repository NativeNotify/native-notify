import React, { useState, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import axios from 'axios';
import Constants from "expo-constants";

import { NativeNotify, useNativeNotify, configureAnalytics } from './context';
import { readTotalCount } from './inboxUtils';
import {
    getRegistrationMeta,
    reportNotificationOpen,
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
        // Merge this call's analytics flags (read at mount, like `options`).
        configureAnalytics(opts.analytics);
        let cancelled = false;

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
        let tokenRotationSub: any = null;
        if (opts.watchTokenRotation !== false) {
            try {
                tokenRotationSub = Notifications.addPushTokenListener(async () => {
                    const result = await registerForPushNotificationsAsync();
                    if (cancelled || result.status !== 'success' || !config.appId || !config.appToken) return;
                    try {
                        await postTokens(result);
                        setAnalyticsPushToken(result.expoPushToken);
                        if (typeof opts.onRegistered === 'function') opts.onRegistered(result);
                    } catch (error) {
                        if (typeof opts.onError === 'function') opts.onError(error);
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
 */
export async function getNotificationInboxPage(appId?: any, appToken?: any, take: any = 20, skip: any = 0): Promise<InboxPage> {
    const ids = resolveIds(appId, appToken);

    if (Platform.OS !== 'web') {
        const token = await getExpoPushTokenSafe();
        if (token) {
            try {
                await axios.post(`https://app.nativenotify.com/api/notification/inbox/read`, {
                    appId: ids.appId,
                    appToken: ids.appToken,
                    expoToken: token,
                }, { timeout: REQUEST_TIMEOUT_MS });
            } catch (error) {
                // Marking everything read is best-effort; never block reading.
            }
        }
    }

    let response = await axios.get(`https://app.nativenotify.com/api/notification/inbox/${ids.appId}/${ids.appToken}?take=${take}&skip=${skip}`, { timeout: REQUEST_TIMEOUT_MS });

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

/** One page of an indie (per-user) inbox. */
export async function getIndieNotificationInboxPage(subId?: any, appId?: any, appToken?: any, take: any = 20, skip: any = 0): Promise<InboxPage> {
    const ids = resolveIds(appId, appToken);

    let response = await axios.get(`https://app.nativenotify.com/api/indie/notification/inbox/${subId}/${ids.appId}/${ids.appToken}?take=${take}&skip=${skip}`, { timeout: REQUEST_TIMEOUT_MS });

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

// Credentials config (NativeNotify.init / <NativeNotifyProvider> / useNativeNotify).
export { NativeNotify, NativeNotifyProvider, useNativeNotify, configureAnalytics } from './context';
export type { NativeNotifyConfig, NativeNotifyProviderProps, NativeNotifyAnalyticsConfig } from './context';

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
