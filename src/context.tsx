/**
 * One place to configure Native Notify credentials (and analytics).
 *
 * Two ways to use it:
 *
 * 1. Wrap your app once — components and hooks pick the ids up automatically:
 *
 *      <NativeNotifyProvider appId={APP_ID} appToken={APP_TOKEN}>
 *        <App />
 *      </NativeNotifyProvider>
 *
 * 2. Module-level init — the plain (non-React) functions resolve ids from it:
 *
 *      NativeNotify.init({ appId: APP_ID, appToken: APP_TOKEN });
 *      registerIndieID(currentUser.id);
 *
 * Every function still accepts explicit appId/appToken arguments; the config is
 * only a fallback, so existing code keeps working unchanged.
 */
import React, { createContext, useContext, useMemo } from 'react';

/**
 * Opt-in analytics features (all default to false — see analytics.ts):
 * `screens` (screen views), `sessions` (session length), `opens`
 * (per-notification open reports), `deviceId` (stable device id for uniques).
 */
export interface NativeNotifyAnalyticsConfig {
    screens?: boolean;
    sessions?: boolean;
    opens?: boolean;
    deviceId?: boolean;
}

export interface NativeNotifyConfig {
    appId?: number | string;
    appToken?: string;
    /** Opt-in analytics features (screens / sessions / opens / deviceId). */
    analytics?: NativeNotifyAnalyticsConfig;
}

const ANALYTICS_DEFAULTS: Required<NativeNotifyAnalyticsConfig> = {
    screens: false,
    sessions: false,
    opens: false,
    deviceId: false,
};

let globalConfig: NativeNotifyConfig = {};

export const NativeNotify = {
    /** Set the credentials used when a function is called without them. */
    init(config: NativeNotifyConfig): void {
        globalConfig = { ...globalConfig, ...(config || {}) };
    },
    /** A copy of the current module-level config. */
    getConfig(): NativeNotifyConfig {
        return { ...globalConfig };
    },
    /** The analytics flags with defaults applied (all false unless enabled). */
    getAnalyticsConfig(): Required<NativeNotifyAnalyticsConfig> {
        return { ...ANALYTICS_DEFAULTS, ...(globalConfig.analytics || {}) };
    },
};

/**
 * Merge analytics flags into the module-level config (used by
 * registerNNPushToken's `analytics` option). Only the provided keys change.
 */
export function configureAnalytics(partial?: NativeNotifyAnalyticsConfig | null): void {
    if (!partial) return;
    globalConfig = {
        ...globalConfig,
        analytics: { ...(globalConfig.analytics || {}), ...partial },
    };
}

const NativeNotifyContext = createContext<NativeNotifyConfig | null>(null);

export interface NativeNotifyProviderProps extends NativeNotifyConfig {
    children?: React.ReactNode;
}

/** Wrap your app to provide appId/appToken to every hook and component. */
export function NativeNotifyProvider(props: NativeNotifyProviderProps): any {
    const { appId, appToken, children } = props || ({} as NativeNotifyProviderProps);
    const value = useMemo(() => ({ appId, appToken }), [appId, appToken]);
    return <NativeNotifyContext.Provider value={value}>{children}</NativeNotifyContext.Provider>;
}

/**
 * The current Native Notify credentials: provider props win, then
 * NativeNotify.init(), then nothing.
 */
export function useNativeNotify(): NativeNotifyConfig {
    const context = useContext(NativeNotifyContext);
    return {
        appId: context && context.appId !== undefined ? context.appId : globalConfig.appId,
        appToken: context && context.appToken !== undefined ? context.appToken : globalConfig.appToken,
    };
}
