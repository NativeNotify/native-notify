/**
 * Analytics mount order (2026-09-24 review): with the documented "keep
 * everything on the registration call" setup —
 * registerNNPushToken(appId, appToken, { analytics }) and no
 * NativeNotify.init() — the analytics flags and ids must already be in place
 * when components UNDER the registering one run their mount effects. React
 * runs child effects before parent effects, so a child's
 * useNativeNotifyPress() reads the cold-start tap (once per process) and
 * useNativeNotifyScreenTracking() tracks the first screen before
 * registerNNPushToken's own effect runs. Those events used to see analytics
 * as disabled and were dropped for good.
 *
 * Own file on purpose: node's test runner isolates files in separate
 * processes, and this one needs a React stub that queues effects so they can
 * be flushed child-first, like React does.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

const Module: any = require('module');

const axiosCalls: { method: string; url: string; data?: any }[] = [];
const tick = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const waitFor = async (predicate: () => boolean, timeoutMs: number = 1000): Promise<void> => {
    const start = Date.now();
    while (!predicate() && Date.now() - start < timeoutMs) await tick(5);
};

// Effects are queued per render and flushed by the test in React's order.
let queuedEffects: (() => any)[] = [];
const takeEffects = () => {
    const effects = queuedEffects;
    queuedEffects = [];
    return effects;
};

const reactStub: any = {
    __esModule: true,
    useState: (value: any) => [value, () => {}],
    useEffect: (effect: () => any) => { queuedEffects.push(effect); },
    useRef: (value: any) => ({ current: value }),
    useMemo: (fn: any) => fn(),
    useCallback: (fn: any) => fn,
    createContext: () => ({ Provider: function Provider() {}, Consumer: {} }),
    useContext: () => null,
    createElement: () => null,
};
reactStub.default = reactStub;

const axiosStub: any = {
    __esModule: true,
    post: async (url: string, data?: any) => { axiosCalls.push({ method: 'post', url, data }); return { data: 'ok', headers: {} }; },
    get: async (url: string) => { axiosCalls.push({ method: 'get', url }); return { data: [], headers: {} }; },
    put: async (url: string, data?: any) => { axiosCalls.push({ method: 'put', url, data }); return { data: 'ok', headers: {} }; },
    delete: async (url: string) => { axiosCalls.push({ method: 'delete', url }); return { data: 'ok', headers: {} }; },
};
axiosStub.default = axiosStub;

// The tap that launched the app (read synchronously on mount).
const coldStartResponse = {
    notification: { request: { content: { data: { nn_notification_id: '55', nn_source: 'mass' } } } },
};

const stubs: { [key: string]: any } = {
    axios: axiosStub,
    react: reactStub,
    'react-native': {
        Platform: { OS: 'ios' },
        AppState: { addEventListener: () => ({ remove() {} }) },
        StyleSheet: { create: (styles: any) => styles },
        StatusBar: { currentHeight: 24 },
        useColorScheme: () => 'light',
    },
    'expo-notifications': {
        setNotificationHandler: () => {},
        addNotificationResponseReceivedListener: () => ({ remove() {} }),
        addNotificationReceivedListener: () => ({ remove() {} }),
        addPushTokenListener: () => ({ remove() {} }),
        getLastNotificationResponse: () => coldStartResponse,
        getPermissionsAsync: async () => ({ status: 'granted' }),
        requestPermissionsAsync: async () => ({ status: 'granted' }),
        getExpoPushTokenAsync: async () => ({ data: 'ExponentPushToken[order]' }),
        getDevicePushTokenAsync: async () => ({ data: 'device-token' }),
        setNotificationChannelAsync: async () => null,
        AndroidImportance: { MAX: 5 },
    },
    'expo-constants': {
        expoConfig: { extra: { eas: { projectId: 'order-project' } }, version: '1.0.0' },
        executionEnvironment: 'standalone',
    },
};

const originalLoad = Module._load;
Module._load = function (request: string, parent: any, isMain: boolean) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    if (/\.png$/.test(request)) return 'stub-asset';
    return originalLoad.call(this, request, parent, isMain);
};

const nn: typeof import('../src/index') = require('../src/index');

test('events from components under registerNNPushToken use its analytics flags + ids on the first mount', async () => {
    const registerNNPushToken = nn.default as unknown as (appId?: any, appToken?: any, options?: any) => void;

    // Render phase, top-down: the App registers, then its child screen reads
    // the cold-start tap and tracks its screen.
    registerNNPushToken(4547, 'bookstore-token', { analytics: { opens: true, screens: true } });
    const parentEffects = takeEffects();
    nn.useNativeNotifyPress();
    nn.useNativeNotifyScreenTracking(() => 'Home');
    const childEffects = takeEffects();

    // Commit phase: React runs the child's effects before the parent's.
    childEffects.forEach((effect) => effect());
    parentEffects.forEach((effect) => effect());
    nn.flushScreenQueue();

    await waitFor(() => axiosCalls.some((c) => c.url.endsWith('/api/notification/opened'))
        && axiosCalls.some((c) => c.url.endsWith('/api/analytics/screen')));

    const open = axiosCalls.find((c) => c.url.endsWith('/api/notification/opened'));
    assert.ok(open, 'the cold-start tap was reported');
    assert.equal(open!.data.appId, 4547);
    assert.equal(open!.data.appToken, 'bookstore-token');
    assert.equal(open!.data.notification_id, '55');

    const screen = axiosCalls.find((c) => c.url.endsWith('/api/analytics/screen'));
    assert.ok(screen, 'the first screen was tracked');
    assert.equal(screen!.data.appId, 4547);
    assert.equal(screen!.data.appToken, 'bookstore-token');
    assert.deepEqual(screen!.data.events.map((e: any) => e.screenName), ['Home']);
});
