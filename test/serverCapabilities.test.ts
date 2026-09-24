/**
 * Boundary tests for the 2026-09-21 "consume the server capabilities" wave:
 * per-notification inbox read state, open reporting, and the rich-field send
 * helpers. Uses the repo's fake-fetch-at-the-boundary pattern (see
 * tmp/scratch/smoke-dist.js): stub the peer modules, load the REAL
 * src/index.ts, and assert the exact requests it makes. No network, no Expo.
 *
 * The stubs are installed BEFORE the module under test is loaded, so index is
 * pulled in with a lazy require and typed through `typeof import(...)`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

const Module: any = require('module');

// ---- captured boundary calls -------------------------------------------------
const axiosCalls: { method: string; url: string; data?: any }[] = [];
const channelCalls: { channelId: string; channel: any }[] = [];

const tick = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const waitFor = async (predicate: () => boolean, timeoutMs: number = 1000): Promise<void> => {
    const start = Date.now();
    while (!predicate() && Date.now() - start < timeoutMs) {
        await tick(5);
    }
};

const axiosResponse = (url: string) => (
    url.includes('?take=')
        ? { data: [], headers: { 'x-total-count': '0' } }
        : { data: { message: 'ok' }, headers: {} }
);

const notificationsStub: any = {
    setNotificationHandler: () => {},
    addNotificationResponseReceivedListener: () => ({ remove() {} }),
    addNotificationReceivedListener: () => ({ remove() {} }),
    addPushTokenListener: () => ({ remove() {} }),
    getLastNotificationResponse: () => null,
    getLastNotificationResponseAsync: async () => null,
    getPermissionsAsync: async () => ({ status: 'granted' }),
    requestPermissionsAsync: async () => ({ status: 'granted' }),
    getExpoPushTokenAsync: async () => ({ data: 'ExponentPushToken[boundary]' }),
    getDevicePushTokenAsync: async () => ({ data: 'device-token' }),
    setBadgeCountAsync: async () => true,
    setNotificationChannelAsync: async (channelId: string, channel: any) => {
        channelCalls.push({ channelId, channel });
        return null;
    },
    AndroidImportance: { MIN: 1, LOW: 2, DEFAULT: 3, HIGH: 4, MAX: 5 },
};

const reactStub: any = {
    __esModule: true,
    useState: (value: any) => [value, () => {}],
    useEffect: () => {},
    useRef: (value: any) => ({ current: value }),
    useMemo: (fn: any) => fn(),
    useCallback: (fn: any) => fn,
    createContext: () => ({ Provider: function Provider() {}, Consumer: {} }),
    useContext: () => null,
    createElement: () => null,
};
reactStub.default = reactStub;

// Mutable on purpose: one test flips Platform.OS to 'android' to exercise the
// channel helper, then flips it back.
const reactNativeStub: any = {
    Platform: { OS: 'ios' },
    AppState: { addEventListener: () => ({ remove() {} }) },
    ActivityIndicator: () => null,
    FlatList: () => null,
    Image: () => null,
    Modal: () => null,
    Pressable: () => null,
    RefreshControl: () => null,
    StatusBar: { currentHeight: 24 },
    StyleSheet: { create: (styles: any) => styles },
    Text: () => null,
    View: () => null,
    useColorScheme: () => 'light',
};

const stubs: { [key: string]: any } = {
    axios: (() => {
        const axiosStub: any = {
            __esModule: true,
            post: async (url: string, data?: any) => {
                axiosCalls.push({ method: 'post', url, data });
                return axiosResponse(url);
            },
            get: async (url: string) => {
                axiosCalls.push({ method: 'get', url });
                return axiosResponse(url);
            },
            put: async (url: string, data?: any) => {
                axiosCalls.push({ method: 'put', url, data });
                return axiosResponse(url);
            },
            delete: async (url: string, data?: any) => {
                axiosCalls.push({ method: 'delete', url, data });
                return axiosResponse(url);
            },
        };
        axiosStub.default = axiosStub;
        return axiosStub;
    })(),
    react: reactStub,
    'react-native': reactNativeStub,
    'expo-notifications': notificationsStub,
    'expo-constants': {
        expoConfig: { extra: { eas: { projectId: 'boundary-project' } } },
        executionEnvironment: 'standalone',
        statusBarHeight: 44,
    },
};

const originalLoad = Module._load;
Module._load = function (request: string, parent: any, isMain: boolean) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    if (/\.png$/.test(request)) return 'stub-asset';
    return originalLoad.call(this, request, parent, isMain);
};

// The module under test — required AFTER the stubs are in place.
const nn: typeof import('../src/index') = require('../src/index');

const lastCall = () => axiosCalls[axiosCalls.length - 1];
// Mass sends carry the inbox date in the legacy "M-D-YYYY H:MMAM" format
// (device-local time); pin its shape, then compare the rest exactly.
const LEGACY_DATE_RE = /^\d{1,2}-\d{1,2}-\d{4} \d{1,2}:\d{2}(AM|PM)$/;
const withDateSent = (data: any) => {
    const sent = axiosCalls[0] && axiosCalls[0].data ? axiosCalls[0].data.dateSent : undefined;
    assert.match(String(sent), LEGACY_DATE_RE, 'mass sends stamp dateSent for the inbox row');
    return { ...data, dateSent: sent };
};
const expectPost = (url: string, data: any) => {
    assert.equal(axiosCalls.length, 1, 'exactly one request expected');
    assert.equal(axiosCalls[0].method, 'post');
    assert.equal(axiosCalls[0].url, url);
    assert.deepEqual(axiosCalls[0].data, data);
};

// ---- send helpers: rich-field passthrough ------------------------------------

test('sendMassNotification passes every rich field through to /api/notification', async () => {
    axiosCalls.length = 0;
    const response = await nn.sendMassNotification('Weekly update', 'Hello everyone', {
        appId: 4547,
        appToken: 'tok',
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

    expectPost('https://app.nativenotify.com/api/notification', withDateSent({
        appId: 4547,
        appToken: 'tok',
        title: 'Weekly update',
        body: 'Hello everyone',
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
    }));
    assert.deepEqual(response, { message: 'ok' });
});

test('sendMassNotification keeps falsy-but-set fields and omits unset ones', async () => {
    axiosCalls.length = 0;
    await nn.sendMassNotification('Silent', 'No sound, no badge', {
        appId: 1,
        appToken: 'tok',
        sound: false,
        badge: 0,
    });
    expectPost('https://app.nativenotify.com/api/notification', withDateSent({
        appId: 1,
        appToken: 'tok',
        title: 'Silent',
        body: 'No sound, no badge',
        sound: false,
        badge: 0,
    }));

    axiosCalls.length = 0;
    await nn.sendMassNotification('Plain', 'Body', { appId: 1, appToken: 'tok' });
    expectPost('https://app.nativenotify.com/api/notification', withDateSent({
        appId: 1,
        appToken: 'tok',
        title: 'Plain',
        body: 'Body',
    }));
});

test('sendIndieNotification passes rich fields to /api/indie/notification', async () => {
    axiosCalls.length = 0;
    await nn.sendIndieNotification('user-1', 'Your order', 'It shipped', {
        appId: 1,
        appToken: 'tok',
        pushData: { orderId: 'A1' },
        channelId: 'orders',
        subtitle: 'Tracking',
        sound: 'ping.wav',
    });
    expectPost('https://app.nativenotify.com/api/indie/notification', {
        appId: 1,
        appToken: 'tok',
        subID: 'user-1',
        title: 'Your order',
        message: 'It shipped',
        pushData: { orderId: 'A1' },
        channelId: 'orders',
        subtitle: 'Tracking',
        sound: 'ping.wav',
    });
});

test('sendIndieGroupNotification sends to every subID and guards an empty audience', async () => {
    axiosCalls.length = 0;
    await nn.sendIndieGroupNotification(['a', 'b', 'c'], 'Group news', 'All aboard', {
        appId: 1,
        appToken: 'tok',
        interruptionLevel: 'active',
    });
    expectPost('https://app.nativenotify.com/api/indie/group/notification', {
        appId: 1,
        appToken: 'tok',
        subIDs: ['a', 'b', 'c'],
        title: 'Group news',
        message: 'All aboard',
        interruptionLevel: 'active',
    });

    axiosCalls.length = 0;
    await assert.rejects(
        () => nn.sendIndieGroupNotification([], 'T', 'M', { appId: 1, appToken: 'tok' }),
        /non-empty array/
    );
    assert.equal(axiosCalls.length, 0, 'empty audience never hits the network');
});

test('sendNotificationToFollowers posts to /api/follow/notification with rich fields', async () => {
    axiosCalls.length = 0;
    await nn.sendNotificationToFollowers('master-1', 'New post', 'Read it', {
        appId: 1,
        appToken: 'tok',
        categoryId: 'POST',
        collapseId: 'post-42',
        mutableContent: true,
    });
    expectPost('https://app.nativenotify.com/api/follow/notification', {
        appId: 1,
        appToken: 'tok',
        masterSubID: 'master-1',
        title: 'New post',
        message: 'Read it',
        categoryId: 'POST',
        collapseId: 'post-42',
        mutableContent: true,
    });
});

// ---- inbox per-notification read state ---------------------------------------

test('per-notification mass page asks for this device\'s read state and skips the mark-all', async () => {
    axiosCalls.length = 0;
    const page = await nn.getNotificationInboxPage(4547, 'tok', 20, 0, { perNotification: true });

    // Only the GET — no "mark everything read" POST (that is the point).
    assert.equal(axiosCalls.length, 1);
    assert.equal(axiosCalls[0].method, 'get');
    assert.equal(
        axiosCalls[0].url,
        'https://app.nativenotify.com/api/notification/inbox/4547/tok?take=20&skip=0&expoToken=ExponentPushToken%5Bboundary%5D'
    );
    assert.deepEqual(page.rows, []);
    assert.equal(page.total, 0);
});

test('legacy mass page still marks all read first and keeps the old URL byte-identical', async () => {
    axiosCalls.length = 0;
    await nn.getNotificationInboxPage(4547, 'tok', 20, 0);

    assert.equal(axiosCalls.length, 2);
    assert.equal(axiosCalls[0].method, 'post');
    assert.equal(axiosCalls[0].url, 'https://app.nativenotify.com/api/notification/inbox/read');
    assert.deepEqual(axiosCalls[0].data, {
        appId: 4547,
        appToken: 'tok',
        expoToken: 'ExponentPushToken[boundary]',
    });
    assert.equal(
        axiosCalls[1].url,
        'https://app.nativenotify.com/api/notification/inbox/4547/tok?take=20&skip=0'
    );
});

test('markMassNotificationRead posts ONE notificationId for this device', async () => {
    axiosCalls.length = 0;
    const ok = await nn.markMassNotificationRead(99, 4547, 'tok');
    assert.equal(ok, true);
    expectPost('https://app.nativenotify.com/api/notification/inbox/read', {
        appId: 4547,
        appToken: 'tok',
        expoToken: 'ExponentPushToken[boundary]',
        notificationId: 99,
    });
});

test('indie pages add ?perNotification=true only when asked, and mark one row read', async () => {
    axiosCalls.length = 0;
    await nn.getIndieNotificationInboxPage('sub-1', 4547, 'tok', 20, 0, { perNotification: true });
    assert.equal(
        axiosCalls[0].url,
        'https://app.nativenotify.com/api/indie/notification/inbox/sub-1/4547/tok?take=20&skip=0&perNotification=true'
    );

    axiosCalls.length = 0;
    await nn.getIndieNotificationInboxPage('sub-1', 4547, 'tok', 20, 0);
    assert.equal(
        axiosCalls[0].url,
        'https://app.nativenotify.com/api/indie/notification/inbox/sub-1/4547/tok?take=20&skip=0',
        'legacy indie URL unchanged'
    );

    axiosCalls.length = 0;
    const ok = await nn.markIndieNotificationRead(99, 'sub-1', 4547, 'tok');
    assert.equal(ok, true);
    expectPost('https://app.nativenotify.com/api/indie/notification/inbox/read', {
        appId: 4547,
        appToken: 'tok',
        subId: 'sub-1',
        notificationId: 99,
    });
});

// ---- open reporting ----------------------------------------------------------

test('reportNotificationOpen is a no-op until analytics.opens is enabled', async () => {
    axiosCalls.length = 0;
    nn.reportNotificationOpen({ nn_notification_id: '77' });
    await tick(25);
    assert.equal(axiosCalls.length, 0, 'ops are opt-in');
});

test('reportNotificationOpen posts once per tap (deduped) with the server-injected id', async () => {
    nn.NativeNotify.init({ appId: 4547, appToken: 'tok', analytics: { opens: true } });
    nn.setAnalyticsPushToken('ExponentPushToken[boundary]');

    axiosCalls.length = 0;
    nn.reportNotificationOpen({ nn_notification_id: '77', nn_source: 'mass' });
    nn.reportNotificationOpen({ nn_notification_id: '77', nn_source: 'mass' }); // same tap, second path
    await waitFor(() => axiosCalls.length > 0);
    await tick(25); // give a (wrong) second POST time to appear

    assert.equal(axiosCalls.length, 1, 'the listener + cold-start double report collapses to one');
    assert.equal(axiosCalls[0].method, 'post');
    assert.equal(axiosCalls[0].url, 'https://app.nativenotify.com/api/notification/opened');
    assert.deepEqual(axiosCalls[0].data, {
        appId: 4547,
        appToken: 'tok',
        notification_id: '77',
        token: 'ExponentPushToken[boundary]',
    });
});

// ---- Android channel helper --------------------------------------------------

test('setAndroidNotificationChannel wraps setNotificationChannelAsync (Android only)', async () => {
    // iOS: Android channels do not exist — false, nothing called.
    assert.equal(await nn.setAndroidNotificationChannel('alerts', { importance: 5 }), false);
    assert.equal(channelCalls.length, 0);

    reactNativeStub.Platform.OS = 'android';
    try {
        const created = await nn.setAndroidNotificationChannel('alerts', {
            name: 'Alerts',
            importance: 5,
            vibrationPattern: [0, 250],
            sound: 'chime.wav',
            showBadge: true,
        });
        assert.equal(created, true);
        assert.equal(channelCalls.length, 1);
        assert.equal(channelCalls[0].channelId, 'alerts');
        assert.deepEqual(channelCalls[0].channel, {
            name: 'Alerts',
            importance: 5,
            vibrationPattern: [0, 250],
            sound: 'chime.wav',
            showBadge: true,
        });

        // Name defaults to the channel id; unset fields are omitted.
        await nn.setAndroidNotificationChannel('news');
        assert.deepEqual(channelCalls[1].channel, { name: 'news' });
    } finally {
        reactNativeStub.Platform.OS = 'ios';
    }
});
