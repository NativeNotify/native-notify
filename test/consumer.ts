/**
 * Compile-only consumer fixture: every public export must stay importable and
 * type-check from a consumer's perspective. `npm run typecheck` compiles this
 * (see tsconfig.test.json) — a type regression fails CI instead of a user.
 *
 * This file is never executed; it exists purely for `tsc`.
 */
import registerNNPushToken, {
    NativeNotify,
    NativeNotifyProvider,
    configureAnalytics,
    deleteFollowMaster,
    deleteIndieNotificationInbox,
    endSessionTracking,
    flushScreenQueue,
    getFollowMaster,
    getIndieNotificationInbox,
    getIndieNotificationInboxPage,
    getNotificationInbox,
    getNotificationInboxPage,
    getPushDataInForeground,
    getPushDataObject,
    getRegistrationMeta,
    getStableDeviceKey,
    getUnreadIndieNotificationInboxCount,
    getUnreadNotificationInboxCount,
    postFollowingID,
    registerFollowerID,
    registerFollowMasterID,
    registerForPushNotificationsAsync,
    registerIndieID,
    reportNotificationOpen,
    setAnalyticsPushToken,
    startSessionAutoTracking,
    startSessionTracking,
    trackScreen,
    unfollowMasterID,
    unregisterIndieDevice,
    updateFollowersList,
    useNativeNotify,
    useNativeNotifyPress,
    useNativeNotifyScreenTracking,
    useNativeNotifySessionTracking,
    NotificationInboxBell,
    NotificationInboxScreen,
    useNotificationInbox,
} from '../src/index';
import type {
    InboxNotification,
    InboxPage,
    NativeNotifyActionResult,
    NativeNotifyAnalyticsConfig,
    NativeNotifyConfig,
    NotificationInboxBellProps,
    NotificationInboxScreenProps,
    NotificationInboxTheme,
    PushTokenResult,
    RegisterNNPushTokenOptions,
    UseNotificationInboxOptions,
    UseNotificationInboxResult,
} from '../src/index';

const analytics: NativeNotifyAnalyticsConfig = {
    screens: true,
    sessions: true,
    opens: true,
    deviceId: true,
};

export const config: NativeNotifyConfig = { appId: 1, appToken: 'token', analytics };

export async function compileOnly(): Promise<void> {
    NativeNotify.init(config);
    NativeNotify.init({ appId: 1, appToken: 'token', analytics: { opens: true } });
    configureAnalytics({ screens: true });
    const flags = NativeNotify.getAnalyticsConfig();
    void flags.sessions;

    const options: RegisterNNPushTokenOptions = {
        onRegistered: (result: PushTokenResult) => { void result.expoPushToken; },
        onError: (error: any) => { void error; },
        watchTokenRotation: true,
        analytics,
    };
    void options; // registerNNPushToken is a hook — called from a component,
    void registerNNPushToken; // never from this plain function.

    // Analytics surface: track + flush, sessions, opens, device identity.
    trackScreen('Home');
    trackScreen('/products/123');
    flushScreenQueue();
    reportNotificationOpen({ nn_notification_id: '1', nn_source: 'mass' });
    startSessionTracking();
    endSessionTracking();
    const stopSessions: (() => void) | null = startSessionAutoTracking();
    void stopSessions;
    setAnalyticsPushToken('ExponentPushToken[placeholder]');
    const deviceKey: string | null = await getStableDeviceKey();
    void deviceKey;
    const meta = await getRegistrationMeta();
    void meta.appVersion;
    void useNativeNotifyScreenTracking;
    void useNativeNotifySessionTracking;

    const tokenResult: PushTokenResult = await registerForPushNotificationsAsync();
    void tokenResult.status;

    await registerIndieID('sub-1');
    await registerIndieID('sub-1', 1, 'token');
    await unregisterIndieDevice('sub-1');

    const master = await getFollowMaster('sub-1');
    void master.follower_count;
    const action: NativeNotifyActionResult = await registerFollowMasterID('sub-1');
    void action.status;
    void action.message;
    await registerFollowerID('master', 'follower');
    await postFollowingID('master', 'following');
    await unfollowMasterID('master', 'follower');
    await updateFollowersList('master', 'following');
    await deleteFollowMaster();

    const massPage: InboxPage = await getNotificationInboxPage(1, 'token', 20, 0);
    void massPage.total;
    const rows: InboxNotification[] = await getNotificationInbox(1, 'token', 20, 0);
    void rows.length;
    const typedRows: InboxNotification<{ url?: string }>[] = rows as any;
    void typedRows;
    const indiePage: InboxPage = await getIndieNotificationInboxPage('sub-1');
    void indiePage.rows;
    await getIndieNotificationInbox('sub-1', 1, 'token', 20, 0);
    const unread: number = await getUnreadNotificationInboxCount();
    void unread;
    await getUnreadIndieNotificationInboxCount('sub-1');
    await deleteIndieNotificationInbox('sub-1', 'notif-1');

    const theme: NotificationInboxTheme = { dot: '#f00' };
    const screenProps: NotificationInboxScreenProps = {
        mode: 'indie',
        subId: 'sub-1',
        colors: theme,
        syncBadge: false,
    };
    const bellProps: NotificationInboxBellProps = { ...screenProps, showCount: true };
    const hookOptions: UseNotificationInboxOptions = { mode: 'mass', take: 10 };
    const result: UseNotificationInboxResult | null = useNotificationInbox(hookOptions);
    void result;

    const pushData = getPushDataObject<{ url?: string }>();
    void pushData.url;
    void useNativeNotifyPress<{ url?: string }>;
    void getPushDataInForeground;

    void NativeNotifyProvider;
    void useNativeNotify;
    void NotificationInboxBell;
    void NotificationInboxScreen;
    void bellProps;
}
