/**
 * Analytics ids (2026-09-24 review): the docs offer a "keep everything on the
 * registration call" setup — registerNNPushToken(appId, appToken, { analytics })
 * with no NativeNotify.init() — but every analytics report read its ids from
 * NativeNotify.init() only, so that setup silently sent nothing. Reports now
 * fall back to the ids registerNNPushToken registered with (init still wins).
 *
 * Own file on purpose: node's test runner isolates files in separate
 * processes, and this one needs a React stub whose useEffect actually runs
 * (serverCapabilities.test.ts stubs it as a no-op).
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

const reactStub: any = {
    __esModule: true,
    useState: (value: any) => [value, () => {}],
    // Run effects immediately — registerNNPushToken does its work in one.
    useEffect: (effect: () => any) => { effect(); },
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
        getPermissionsAsync: async () => ({ status: 'granted' }),
        requestPermissionsAsync: async () => ({ status: 'granted' }),
        getExpoPushTokenAsync: async () => ({ data: 'ExponentPushToken[ids]' }),
        getDevicePushTokenAsync: async () => ({ data: 'device-token' }),
        setNotificationChannelAsync: async () => null,
        AndroidImportance: { MAX: 5 },
    },
    'expo-constants': {
        expoConfig: { extra: { eas: { projectId: 'ids-project' } }, version: '1.0.0' },
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

test('registerNNPushToken(appId, appToken, { analytics }) alone makes open reports carry those ids', async () => {
    const registerNNPushToken = nn.default as unknown as (appId?: any, appToken?: any, options?: any) => void;
    registerNNPushToken(4547, 'bakery-token', { analytics: { opens: true } });
    // The registration itself posts the device tokens with the same ids.
    await waitFor(() => axiosCalls.some((c) => c.url.endsWith('/api/device/tokens')));
    const registration = axiosCalls.find((c) => c.url.endsWith('/api/device/tokens'));
    assert.equal(registration!.data.appId, 4547);

    nn.reportNotificationOpen({ nn_notification_id: '88', nn_source: 'mass' });
    await waitFor(() => axiosCalls.some((c) => c.url.endsWith('/api/notification/opened')));
    const open = axiosCalls.find((c) => c.url.endsWith('/api/notification/opened'));
    assert.ok(open, 'the open report was sent');
    assert.equal(open!.data.appId, 4547);
    assert.equal(open!.data.appToken, 'bakery-token');
    assert.equal(open!.data.notification_id, '88');
});

test('NativeNotify.init() ids still win over the registration ids', async () => {
    nn.NativeNotify.init({ appId: 1111, appToken: 'init-token' });
    axiosCalls.length = 0;
    nn.reportNotificationOpen({ nn_notification_id: '99' });
    await waitFor(() => axiosCalls.some((c) => c.url.endsWith('/api/notification/opened')));
    const open = axiosCalls.find((c) => c.url.endsWith('/api/notification/opened'));
    assert.equal(open!.data.appId, 1111);
    assert.equal(open!.data.appToken, 'init-token');
});
