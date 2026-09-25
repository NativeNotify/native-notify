/**
 * Paired-token registration (2026-09-29).
 *
 * One physical device can hold BOTH an Expo push token and a native
 * (FCM / APNs) push token. The server used to have no way to tell that two
 * tokens belong to the same phone, so a device registered with both received
 * TWO copies of every group / topic-group / follow push.
 *
 * Registration now reports the pair explicitly, as the OPTIONAL `devicePair`
 * field alongside the tokens the SDK has always sent:
 *
 *   { expoToken: 'ExponentPushToken[...]', nativeToken: '<fcm-or-apns-token>', platform: 'android' | 'ios' }
 *
 * It is purely additive: older servers ignore the field (the tokens are still
 * sent exactly as before), and older SDK versions keep working — the server
 * infers the same pair from the `expoToken` + `deviceToken` a single
 * registration already carries. On the server the pair is recorded in
 * `app_device_token_pairs` and used to skip the redundant Expo copy for a
 * device whose native copy is already being delivered.
 */

/** The same device's Expo push token + native (FCM / APNs) push token. */
export interface DeviceTokenPair {
    /** The device's Expo push token (ExponentPushToken[...] / ExpoPushToken[...]). */
    expoToken: string;
    /** The device's native push token: an FCM registration token (Android) or an APNs device token (iOS). */
    nativeToken: string;
    platform: 'android' | 'ios';
}

/**
 * The device pair to report, or null when this device does not have both
 * tokens (or the platform is unsupported) — in which case nothing extra is
 * sent. Blank/whitespace-only values count as missing.
 */
export function buildDevicePair(
    platform: string,
    expoToken?: string | null,
    nativeToken?: string | null
): DeviceTokenPair | null {
    if (platform !== 'android' && platform !== 'ios') return null;
    const expo = typeof expoToken === 'string' ? expoToken.trim() : '';
    const native = typeof nativeToken === 'string' ? nativeToken.trim() : '';
    if (!expo || !native) return null;
    return { expoToken: expo, nativeToken: native, platform };
}

/**
 * The registration body's `devicePair` field, ready to spread into an axios
 * payload: `{ devicePair }` when the pair is complete, `{}` otherwise (so a
 * device without both tokens sends a body identical to previous versions).
 */
export function withDevicePair(
    platform: string,
    expoToken?: string | null,
    nativeToken?: string | null
): { devicePair?: DeviceTokenPair } {
    const pair = buildDevicePair(platform, expoToken, nativeToken);
    return pair ? { devicePair: pair } : {};
}
