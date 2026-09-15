/**
 * Ambient declarations for React Native / Expo peer modules.
 *
 * `react-native`, `expo-device`, `expo-notifications` and `expo-constants` are
 * peerDependencies — they are supplied by the consuming React Native app, not
 * by this package. These deliberately loose declarations keep this package's
 * build hermetic (it never has to download or match a particular Expo SDK) and
 * keep every peer-derived value typed `any`, which is exactly how the previous
 * hand-written index.d.ts treated them.
 *
 * They are declared with `export =` so that both import styles the sources use
 * keep working: `import * as Notifications from 'expo-notifications'` and
 * `import Constants from 'expo-constants'`. (A namespace-style declaration
 * collides with the real Expo SDK types — TS2484 — when a consumer's install
 * happens to provide them, which would make the build SDK-version dependent.)
 *
 * This file is declaration-only: it is never emitted into dist/, so it can
 * never shadow the real types in a consumer's own project.
 */

declare module 'react-native' {
  export const Platform: any;
  export const AppState: any;
  export const ActivityIndicator: any;
  export const FlatList: any;
  export const Image: any;
  export const Modal: any;
  export const Pressable: any;
  export const RefreshControl: any;
  export const StatusBar: any;
  export const StyleSheet: any;
  export const Text: any;
  export const View: any;
  export function useColorScheme(): any;
}

declare module 'expo-device' {
  const Device: any;
  export = Device;
}

declare module 'expo-constants' {
  const Constants: any;
  export = Constants;
}

declare module 'expo-notifications' {
  const Notifications: any;
  export = Notifications;
}

// Metro / React Native resolves image assets to an opaque module id at bundle
// time. `require('../assets/bell.png')` stays a static require in the built
// output so the consumer's bundler can resolve and hash the asset. (It must
// stay a CommonJS `require` call, not an import: an ESM-style default import
// would compile to `.default` and hand the bundler's asset object to <Image>
// instead of the asset id.)
declare function require(id: string): any;
