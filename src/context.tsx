/**
 * One place to configure Native Notify credentials.
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

export interface NativeNotifyConfig {
    appId?: number | string;
    appToken?: string;
}

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
};

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
