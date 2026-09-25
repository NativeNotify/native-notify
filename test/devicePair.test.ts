/**
 * Paired-token registration (2026-09-29).
 *
 * registration now reports the same device's Expo + native push token
 * together as the optional `devicePair` field. Covered here:
 *   - the pure pair builder (missing / blank tokens, unsupported platform);
 *   - the REAL registerIndieID boundary request: the pair rides along and
 *     every field previous SDK versions sent is byte-identical.
 *
 * Stubs peer modules BEFORE src/index.ts is loaded (the repo's
 * fake-fetch-at-the-boundary pattern), so no network and no Expo.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDevicePair, withDevicePair } from '../src/devicePair';

const Module: any = require('module');

const axiosCalls: { method: string; url: string; data?: any }[] = [];

const notificationsStub: any = {
    setNotificationHandler: () => {},
    addNotificationResponseReceivedListener: () => ({ remove() {} }),
    addNotificationReceivedListener: () => ({ remove() {} }),
    addPushTokenListener: () => ({ remove() {} }),
    getLastNotificationResponse: () => null,
    getLastNotificationResponseAsync: async () => null,
    getPermissionsAsync: async () => ({ status: 'granted' }),
    requestPermissionsAsync: async () => ({ status: 'granted' }),
    getExpoPushTokenAsync: async () => ({ data: 'ExponentPushToken[pair-test]' }),
    getDevicePushTokenAsync: async () => ({ data: 'native-device-token' }),
    setBadgeCountAsync: async () => true,
    setNotificationChannelAsync: async () => null,
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

const reactNativeStub: any = {
    Platform: { OS: 'android' },
    AppState: { addEventListener: () => ({ remove() {} }) },
    StyleSheet: { create: (styles: any) => styles },
};

const stubs: { [key: string]: any } = {
    axios: (() => {
        const axiosStub: any = {
            __esModule: true,
            post: async (url: string, data?: any) => {
                axiosCalls.push({ method: 'post', url, data });
                return { data: { message: 'ok' }, headers: {} };
            },
            get: async (url: string) => {
                axiosCalls.push({ method: 'get', url });
                return { data: { message: 'ok' }, headers: {} };
            },
            put: async (url: string, data?: any) => {
                axiosCalls.push({ method: 'put', url, data });
                return { data: { message: 'ok' }, headers: {} };
            },
            delete: async (url: string) => {
                axiosCalls.push({ method: 'delete', url });
                return { data: { message: 'ok' }, headers: {} };
            },
        };
        axiosStub.default = axiosStub;
        return axiosStub;
    })(),
    react: reactStub,
    'react-native': reactNativeStub,
    'expo-notifications': notificationsStub,
    'expo-constants': {
        expoConfig: { extra: { eas: { projectId: 'pair-project' } } },
        executionEnvironment: 'standalone',
        statusBarHeight: 44,
    },
};

const originalLoad = Module._load;
Module._load = function (request: string, parent: any, isMain: boolean) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return originalLoad.call(this, request, parent, isMain);
};

const nn: typeof import('../src/index') = require('../src/index');

const tick = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const waitFor = async (predicate: () => boolean, timeoutMs: number = 1000): Promise<void> => {
    const start = Date.now();
    while (!predicate() && Date.now() - start < timeoutMs) {
        await tick(5);
    }
};

// ---------------------------------------------------------------------------
// The pure pair builder
// ---------------------------------------------------------------------------

test('buildDevicePair returns the pair when both tokens exist', () => {
    assert.deepEqual(buildDevicePair('android', 'ExponentPushToken[a]', 'fcm-token'), {
        expoToken: 'ExponentPushToken[a]',
        nativeToken: 'fcm-token',
        platform: 'android',
    });
    assert.deepEqual(buildDevicePair('ios', 'ExponentPushToken[i]', 'apns-token'), {
        expoToken: 'ExponentPushToken[i]',
        nativeToken: 'apns-token',
        platform: 'ios',
    });
});

test('buildDevicePair trims whitespace and treats blank values as missing', () => {
    assert.deepEqual(buildDevicePair('android', '  ExponentPushToken[a]  ', '  fcm-token  '), {
        expoToken: 'ExponentPushToken[a]',
        nativeToken: 'fcm-token',
        platform: 'android',
    });
    assert.equal(buildDevicePair('android', 'ExponentPushToken[a]', '   '), null);
    assert.equal(buildDevicePair('android', '   ', 'fcm-token'), null);
});

test('buildDevicePair returns null when a token is missing or the platform is unsupported', () => {
    assert.equal(buildDevicePair('android', 'ExponentPushToken[a]', undefined), null);
    assert.equal(buildDevicePair('android', undefined, 'fcm-token'), null);
    assert.equal(buildDevicePair('android', null, null), null);
    assert.equal(buildDevicePair('web', 'ExponentPushToken[a]', 'fcm-token'), null);
});

test('withDevicePair spreads to an empty object without both tokens (identical request body)', () => {
    assert.deepEqual(withDevicePair('android', 'ExponentPushToken[a]', 'fcm-token'), {
        devicePair: {
            expoToken: 'ExponentPushToken[a]',
            nativeToken: 'fcm-token',
            platform: 'android',
        },
    });
    assert.deepEqual(withDevicePair('android', 'ExponentPushToken[a]', undefined), {});
});

// ---------------------------------------------------------------------------
// The real registerIndieID request
// ---------------------------------------------------------------------------

test('registerIndieID posts the pair alongside every legacy field', async () => {
    axiosCalls.length = 0;

    await nn.registerIndieID('sub-77', '1234', 'apptoken1234');

    await waitFor(() => axiosCalls.some((c) => c.url.endsWith('/api/indie/id')));
    const call = axiosCalls.find((c) => c.url === 'https://app.nativenotify.com/api/indie/id');
    assert.ok(call, 'the registration request was made');

    // The legacy body, unchanged.
    assert.equal(call!.data.subID, 'sub-77');
    assert.equal(call!.data.appId, '1234');
    assert.equal(call!.data.appToken, 'apptoken1234');
    assert.equal(call!.data.platformOS, 'android');
    assert.equal(call!.data.expoToken, 'ExponentPushToken[pair-test]');
    assert.equal(call!.data.deviceToken, 'native-device-token');

    // ...plus the new optional pair field.
    assert.deepEqual(call!.data.devicePair, {
        expoToken: 'ExponentPushToken[pair-test]',
        nativeToken: 'native-device-token',
        platform: 'android',
    });
});
