# native-notify

### You must create a free NativeNotify.com account to receive an App Id and an App Token, or native-notify won't work.
### Go to https://NativeNotify.com to sign up for free, no credit card required.

<br/>

## What is Native Notify?
Native Notify is a React Native Expo Push Notification service. Native Notify makes React Native Expo Push Notifications simple. With this native-notify plugin, you can send your first push notification in under 1 minute.
<br/><br/>
Sign up for https://NativeNotify.com for free. No credit card required.

## Does native-notify work in Expo managed-workflow?
Yes, native-notify works in Expo managed-workflow or Expo bare-workflow. You do NOT have to eject out of Expo to use native-notify.

# Setup Guide:

### Step 1: Install
```
npm i native-notify 
npx expo install expo-device expo-notifications expo-constants
```

`expo-notifications` also needs its config plugin in **app.json** — required for push notifications in development builds and EAS builds:

```json
{
  "expo": {
    "plugins": ["expo-notifications"]
  }
}
```

> **Expo Go on Android (SDK 53+):** push tokens are not available in Expo Go — use a development build (`npx expo run:android` or an EAS dev build). The Notification Inbox still works in Expo Go with `mode="indie"`.

### Step 2: Import
Import registerNNPushToken in your App.js file:
```
import registerNNPushToken from 'native-notify';
```

### Step 3: Make sure your App.js function is a hook function
<strong>Your App.js function MUST be a hook function, or your push notifications will NOT work. Here is an example: </strong>
<br/>
```
export default function App() {
     ...
}
```

This link explains how hooks work: <a href="https://reactjs.org/docs/hooks-intro.html" target="_blank">https://reactjs.org/docs/hooks-intro.html</a>

### Step 4: Paste
Paste this code into your App.js component in the App function:
```
registerNNPushToken(yourAppId, 'yourAppToken');
```
You must go to https://NativeNotify.com to receive a free App Id and App Token, or the registerNNPushToken function will not work. 
<br/><br/>
It's free to sign up. No credit card required.

### Example of an App.js component with native-notify code included:
```
import registerNNPushToken from 'native-notify';

export default function App() {
     registerNNPushToken(yourAppId, 'yourAppToken');

     return (
        ...
     )
}
```

### Optional: configure your credentials once

Instead of passing `appId` / `appToken` to every call, set them once — with a provider:

```
import { NativeNotifyProvider } from 'native-notify';

export default function App() {
  return (
    <NativeNotifyProvider appId={yourAppId} appToken="yourAppToken">
      <Root />
    </NativeNotifyProvider>
  );
}
```

or at module scope (works for the plain, non-React functions):

```
import { NativeNotify } from 'native-notify';
NativeNotify.init({ appId: yourAppId, appToken: 'yourAppToken' });
```

Every function still accepts explicit ids, so nothing changes if you keep passing them.

### Registration callbacks & token rotation

```
registerNNPushToken(yourAppId, 'yourAppToken', {
  onRegistered: (result) => console.log('native-notify ready:', result.expoPushToken),
  onError: (error) => console.warn('native-notify registration failed:', error),
});
```

Token registration retries once on failure, has a 10s timeout, and automatically re-registers when the device push token rotates (Android reinstall / applicationId change, iOS backup restore). On Android in Expo Go you get a clear log message instead of a cryptic native error. You can also run the raw flow yourself — `const result = await registerForPushNotificationsAsync();` — it never throws, it reports (`{ status, reason, expoPushToken, ... }`).

# Use
The registerNNPushToken function will register your user's Native Notify push notification token and will return a data object. You can then send your users push notifications in the https://NativeNotify.com push notification portal.
<br/><br/>
You can send data objects with your Native Notify push notifications. Once a user taps on your Native Notify push notification, the value of the data object will be returned to the pushDataObject variable. You can use this value to do things like redirect your users to a particular screen once a Native Notify push notification is tapped.

## Push data & taps (cold starts included)

```
import { useNativeNotifyPress } from 'native-notify';

export default function App() {
  const { data } = useNativeNotifyPress<{ url?: string }>();

  useEffect(() => {
    if (data?.url) router.push(data.url); // or navigation.navigate(...)
  }, [data]);
}
```

`useNativeNotifyPress` handles both the tap that launched a cold app (which the raw expo-notifications response listener misses) and taps while the app runs. `getPushDataObject()` is a drop-in wrapper over it. Convention: put a `url` key in your push data to deep-link with Expo Router / React Navigation.

# Notification Inbox (prebuilt components)

native-notify ships a drop-in Notification Inbox: a bell icon for your header with a red dot when there are unread notifications, and a full-screen inbox screen that opens when it's tapped.

```
import { NotificationInboxBell } from 'native-notify';

// Expo Router / React Navigation header:
options={{
  headerRight: () => (
    <NotificationInboxBell
      appId={yourAppId}
      appToken="yourAppToken"
      mode='indie'              // or 'mass' (default)
      subId={currentUser.id}    // required when mode='indie'
    />
  ),
}}
```

## Modes

| mode | What it shows | Notes |
| --- | --- | --- |
| `mass` (default) | App-wide notifications | Read state uses the device's Expo push token — works on real devices, Android emulators with Google Play services, and iOS Simulators on Xcode 14+. On web it simply never shows a dot. On Android, use a development build — Expo Go can't mint push tokens (SDK 53+). |
| `indie` | Per-user notifications | Requires `subId`. Works in Expo Go, on simulators, and on web. |

Opening the inbox marks the fetched notifications as read on the server (existing API behavior), so the red dot clears when it opens. The unread count is also synced to the app icon badge (opt out with `syncBadge={false}`). The **Delete** button is only shown in `indie` mode — mass deletion is an admin action that removes a notification for every user, so it is intentionally not exposed.

## Props

`NotificationInboxBell` and `NotificationInboxScreen` (plus the headless `useNotificationInbox` hook):

| prop | default | description |
| --- | --- | --- |
| `appId` | — | Your NativeNotify App ID (or set it once with `NativeNotifyProvider` / `NativeNotify.init`) |
| `appToken` | — | Your NativeNotify App Token (same) |
| `mode` | `'mass'` | `'mass'` or `'indie'` |
| `subId` | — | Required when `mode='indie'` |
| `take` | `20` | Page size |
| `syncBadge` | `true` | Sync the unread count to the app icon badge |
| `colors` | theme defaults | Partial override, e.g. `{ dot: '#EF4444', accent: '#2563EB' }` |
| `title` | `'Notifications'` | Header title |
| `emptyText` | `"You're all caught up"` | Empty-state body text |
| `allowDelete` | `true` (indie only) | Hide the per-row delete button in indie mode |
| `onNotificationPress` | — | `(notification) => {}` called when a row is tapped |
| `showCount` | `false` | Show a numeric badge instead of a plain dot |
| `maxCount` | `99` | Badge cap ("99+") |
| `renderIcon` | bundled bell | `({ unreadCount, color }) => node` custom bell icon |
| `iconSize` / `iconStyle` / `containerStyle` | — | Styling escape hatches |
| `onOpen` | — | If set, the bell calls this instead of opening the built-in screen |

Colors follow the device's light/dark mode automatically; every key is overridable via `colors` (`icon`, `dot`, `badgeText`, `background`, `headerBackground`, `title`, `text`, `mutedText`, `border`, `card`, `accent`, `delete`, `emptyTitle`, `emptyText`).

Want your own trigger? Render `NotificationInboxScreen` and control `visible` / `onClose` yourself, or build a fully custom UI on the `useNotificationInbox({ appId, appToken, mode, subId, take, syncBadge })` hook.

Exact pagination is available for custom UIs: `getNotificationInboxPage()` and `getIndieNotificationInboxPage()` return `{ rows, total }` (the server's `X-Total-Count`), so "load more" is exact instead of a guess.

## Upgrading

**v5 (from v4)** — new exports: `NativeNotify`, `NativeNotifyProvider`, `useNativeNotify`, `useNativeNotifyPress`, `registerForPushNotificationsAsync`, `getNotificationInboxPage`, `getIndieNotificationInboxPage`; `registerNNPushToken` gains an optional third `options` argument; `appId`/`appToken` are optional everywhere (resolved from `NativeNotify.init` / `<NativeNotifyProvider>` when omitted).

One breaking change: the five follow helpers — `registerFollowMasterID`, `registerFollowerID`, `postFollowingID`, `unfollowMasterID`, `updateFollowersList` — return a structured `NativeNotifyActionResult` (`{ success, status, message, error }`) instead of a plain string. `message` contains the old text; network failures now surface as `status: 'error'` with the underlying `error` instead of being reported as "already registered".

## Show your support
Give a ⭐️ if this project helped you!
