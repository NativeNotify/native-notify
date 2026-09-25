/**
 * useNativeNotifyScreenTracking (2026-09-24 review). The documented reader
 * form — useNativeNotifyScreenTracking(() => currentRouteName) for React
 * Navigation or any other navigator — ran its effect only when the
 * expo-router pathname changed. Without an expo-router pathname to change it
 * tracked the first screen and never another one.
 *
 * Own file on purpose: node's test runner isolates files in separate
 * processes, and this one needs a small hooks emulator (useRef slots +
 * useEffect deps compared across renders, like React) plus an expo-router
 * stub whose pathname the test controls.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

const Module: any = require('module');

const axiosCalls: { method: string; url: string; data?: any }[] = [];
const tick = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---- a minimal hooks emulator (one component instance per test) -------------
let slots: any[] = [];
let cursor = 0;
let pendingEffects: (() => any)[] = [];
const depsChanged = (prev: any[] | undefined, next: any[] | undefined) =>
    !prev || !next || prev.length !== next.length || next.some((value, i) => !Object.is(value, prev[i]));
const render = (component: () => void) => {
    cursor = 0;
    component();
    const effects = pendingEffects;
    pendingEffects = [];
    effects.forEach((effect) => effect());
};
const resetComponent = () => {
    slots = [];
    cursor = 0;
    pendingEffects = [];
};

const reactStub: any = {
    __esModule: true,
    useState: (value: any) => [value, () => {}],
    useRef: (initial: any) => {
        const i = cursor++;
        if (!slots[i]) slots[i] = { current: initial };
        return slots[i];
    },
    useEffect: (effect: () => any, deps?: any[]) => {
        const i = cursor++;
        const prev = slots[i];
        slots[i] = { deps };
        if (!prev || depsChanged(prev.deps, deps)) pendingEffects.push(effect);
    },
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
};
axiosStub.default = axiosStub;

// expo-router stub: the test drives the pathname (undefined = no route info,
// which is what a reader-based app without expo-router has).
let routerPathname: string | undefined;

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
        AndroidImportance: { MAX: 5 },
    },
    'expo-constants': {
        expoConfig: { extra: { eas: { projectId: 'screens-project' } }, version: '1.0.0' },
        executionEnvironment: 'standalone',
    },
    'expo-router': { usePathname: () => routerPathname },
};

const originalLoad = Module._load;
Module._load = function (request: string, parent: any, isMain: boolean) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    if (/\.png$/.test(request)) return 'stub-asset';
    return originalLoad.call(this, request, parent, isMain);
};

const nn: typeof import('../src/index') = require('../src/index');
nn.NativeNotify.init({ appId: 4547, appToken: 'newsletter-token', analytics: { screens: true } });

/** Flush the screen queue and return every screen name posted since `from`. */
const postedScreens = async (from: number): Promise<string[]> => {
    nn.flushScreenQueue();
    await tick(25);
    return axiosCalls.slice(from)
        .filter((c) => c.url.endsWith('/api/analytics/screen'))
        .flatMap((c) => c.data.events.map((e: any) => e.screenName));
};

test('the reader form tracks every screen change, not only the first screen', async () => {
    resetComponent();
    routerPathname = undefined;
    const from = axiosCalls.length;
    let currentRouteName = 'Home';
    const App = () => nn.useNativeNotifyScreenTracking(() => currentRouteName);

    render(App);
    currentRouteName = 'Settings';
    render(App);
    render(App); // a re-render on the same screen is not a new view
    currentRouteName = 'Profile';
    render(App);

    assert.deepEqual(await postedScreens(from), ['Home', 'Settings', 'Profile']);
});

test('expo-router pathname tracking is unchanged: one view per route change', async () => {
    resetComponent();
    const from = axiosCalls.length;
    const RootLayout = () => nn.useNativeNotifyScreenTracking();

    routerPathname = '/home';
    render(RootLayout);
    render(RootLayout); // same route, re-rendered
    routerPathname = '/settings';
    render(RootLayout);
    routerPathname = '/home';
    render(RootLayout);

    assert.deepEqual(await postedScreens(from), ['/home', '/settings', '/home']);
});
