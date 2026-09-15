/**
 * Prebuilt Notification Inbox for native-notify — a drop-in bell icon plus a
 * full-screen inbox screen, built on top of the existing native-notify
 * functions (getNotificationInbox / getIndieNotificationInbox / etc.).
 *
 * Quick start (Expo Router / React Navigation header):
 *
 *   import { NotificationInboxBell } from 'native-notify';
 *
 *   options={{
 *     headerRight: () => (
 *       <NotificationInboxBell
 *         appId={APP_ID}
 *         appToken={APP_TOKEN}
 *         mode="indie"
 *         subId={currentUser.id}
 *       />
 *     ),
 *   }}
 *
 * Modes:
 * - mode="mass" (default): app-wide notifications. Read state needs a real
 *   device (it uses the device's Expo push token), so on web / simulators the
 *   bell simply never shows the dot.
 * - mode="indie": per-user notifications (subId required). Works in Expo Go,
 *   on simulators and on web.
 *
 * Behavior notes:
 * - Opening the inbox marks the notifications as read on the server (existing
 *   API behavior in both modes), so the red dot clears once it opens.
 * - Deleting is only available in "indie" mode. The mass delete endpoint
 *   removes a notification from EVERY user's inbox (it is an admin action on
 *   the dashboard), so it is intentionally not wired into this component.
 * - Android mass mode needs a development build: Expo Go on Android cannot
 *   mint Expo push tokens (SDK 53+). Indie mode works in Expo Go.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    AppState,
    FlatList,
    Image,
    Modal,
    Platform,
    Pressable,
    RefreshControl,
    StatusBar,
    StyleSheet,
    Text,
    useColorScheme,
    View,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

import {
    getNotificationInbox,
    getUnreadNotificationInboxCount,
    getIndieNotificationInbox,
    getUnreadIndieNotificationInboxCount,
    deleteIndieNotificationInbox,
} from './index';

const LIGHT_THEME = {
    icon: '#111827',
    dot: '#EF4444',
    badgeText: '#FFFFFF',
    background: '#FFFFFF',
    headerBackground: '#FFFFFF',
    title: '#111827',
    text: '#1F2937',
    mutedText: '#6B7280',
    border: '#E5E7EB',
    card: '#FFFFFF',
    accent: '#2563EB',
    delete: '#DC2626',
    emptyTitle: '#111827',
    emptyText: '#6B7280',
};

const DARK_THEME = {
    icon: '#F9FAFB',
    dot: '#F87171',
    badgeText: '#FFFFFF',
    background: '#111827',
    headerBackground: '#111827',
    title: '#F9FAFB',
    text: '#E5E7EB',
    mutedText: '#9CA3AF',
    border: '#374151',
    card: '#1F2937',
    accent: '#60A5FA',
    delete: '#F87171',
    emptyTitle: '#F9FAFB',
    emptyText: '#9CA3AF',
};

// An inert config for the second hook instance a Bell renders inside its
// screen: it keeps the hook call unconditional without doing any work.
const INERT_CONFIG = { inert: true };

const missingSubId = (subId) => subId === undefined || subId === null || subId === '';

function useInboxTheme(overrides) {
    const scheme = useColorScheme();
    return useMemo(() => {
        const base = scheme === 'dark' ? DARK_THEME : LIGHT_THEME;
        return overrides ? { ...base, ...overrides } : base;
    }, [scheme, overrides]);
}

// The server stores date_sent exactly as the sender provided it. Live data
// uses "M-D-YYYY H:MMAM/PM" (e.g. "8-28-2026 6:53AM"), which JS engines parse
// inconsistently (Hermes returns Invalid Date), so parse that shape directly
// and only fall back to Date for anything else.
const SERVER_DATE_RE = /^(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?$/i;

function parseDateValue(raw) {
    const match = SERVER_DATE_RE.exec(raw);
    if (match) {
        let hours = match[4] ? parseInt(match[4], 10) : 0;
        const isPM = match[6] && match[6].toUpperCase() === 'PM';
        if (isPM && hours < 12) hours += 12;
        if (!isPM && hours === 12) hours = 0;
        const parsed = new Date(
            parseInt(match[3], 10),
            parseInt(match[1], 10) - 1,
            parseInt(match[2], 10),
            hours,
            match[5] ? parseInt(match[5], 10) : 0
        );
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function formatDate(value) {
    if (!value) return '';
    const raw = String(value);
    const date = parseDateValue(raw);
    if (!date) return raw; // unknown format: show it as-is
    try {
        const hasTime = /\d{1,2}:\d{2}/.test(raw);
        const sameYear = date.getFullYear() === new Date().getFullYear();
        return date.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            year: sameYear ? undefined : 'numeric',
            hour: hasTime ? 'numeric' : undefined,
            minute: hasTime ? '2-digit' : undefined,
        });
    } catch (e) {
        return raw;
    }
}

function describeError(e) {
    const fallback = "Couldn't load notifications. Check your connection and try again.";
    if (!e) return fallback;
    const data = e.response && e.response.data;
    // The server sends plain-text messages for plan / permission problems.
    if (typeof data === 'string' && data.trim() && data.length < 240) return data.trim();
    if (typeof e.message === 'string' && e.message) return e.message;
    return fallback;
}

/**
 * Headless data hook behind NotificationInboxBell / NotificationInboxScreen.
 *
 * const inbox = useNotificationInbox({ appId, appToken, mode, subId, take });
 *
 * The list screen itself should call inbox.openInbox() when it becomes visible:
 * fetching the inbox marks the notifications as read on the server.
 */
export function useNotificationInbox(options) {
    const cfg = options || {};
    const inert = !!cfg.inert;
    const { appId, appToken, mode = 'mass', subId, take = 20 } = cfg;
    const inboxMode = mode === 'indie' ? 'indie' : 'mass';

    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [error, setError] = useState(null);

    const mountedRef = useRef(true);
    const inFlightRef = useRef(false);
    const skipRef = useRef(0);
    const hasMoreRef = useRef(true);
    const rowsRef = useRef([]);
    const configRef = useRef({});
    configRef.current = { appId, appToken, inboxMode, subId, take };

    const setRows = useCallback((rows) => {
        rowsRef.current = rows;
        if (mountedRef.current) setNotifications(rows);
    }, []);

    const setMore = useCallback((more) => {
        hasMoreRef.current = more;
        if (mountedRef.current) setHasMore(more);
    }, []);

    const getConfig = () => {
        const current = configRef.current;
        if (!current.appId || !current.appToken) return null;
        if (current.inboxMode === 'indie' && missingSubId(current.subId)) return null;
        return current;
    };

    const refreshUnread = useCallback(async () => {
        if (inert) return;
        const current = getConfig();
        if (!current) return;
        try {
            let count;
            if (current.inboxMode === 'indie') {
                count = await getUnreadIndieNotificationInboxCount(current.subId, current.appId, current.appToken);
            } else {
                count = await getUnreadNotificationInboxCount(current.appId, current.appToken);
            }
            const n = Number(count);
            if (mountedRef.current && !Number.isNaN(n)) setUnreadCount(Math.max(0, Math.floor(n)));
        } catch (e) {
            // Counting can fail by design on simulators / web / Expo Go (no push
            // token) or while offline. Fail silent and keep the last known count
            // (which starts at 0, so the dot simply stays hidden).
        }
    }, [inert]);

    const loadFirstPage = useCallback(async ({ spinner = false } = {}) => {
        if (inert) return;
        const current = getConfig();
        if (!current || inFlightRef.current) return;
        inFlightRef.current = true;
        if (mountedRef.current) {
            if (spinner) setLoading(true);
            else setRefreshing(true);
            setError(null);
        }
        try {
            const page = current.inboxMode === 'indie'
                ? await getIndieNotificationInbox(current.subId, current.appId, current.appToken, current.take, 0)
                : await getNotificationInbox(current.appId, current.appToken, current.take, 0);
            const rows = Array.isArray(page) ? page : [];
            setRows(rows);
            skipRef.current = rows.length;
            setMore(rows.length >= current.take);
            // Opening the inbox marks everything read in both modes, so the
            // dot clears as soon as the first page has loaded.
            if (mountedRef.current) setUnreadCount(0);
        } catch (e) {
            if (mountedRef.current) setError(describeError(e));
        } finally {
            inFlightRef.current = false;
            if (mountedRef.current) {
                setLoading(false);
                setRefreshing(false);
            }
        }
    }, [inert, setRows, setMore]);

    const loadMore = useCallback(async () => {
        if (inert) return;
        const current = getConfig();
        if (!current || inFlightRef.current || !hasMoreRef.current) return;
        inFlightRef.current = true;
        if (mountedRef.current) setLoadingMore(true);
        try {
            const skip = skipRef.current;
            const page = current.inboxMode === 'indie'
                ? await getIndieNotificationInbox(current.subId, current.appId, current.appToken, current.take, skip)
                : await getNotificationInbox(current.appId, current.appToken, current.take, skip);
            const rows = Array.isArray(page) ? page : [];
            const seen = {};
            const next = rowsRef.current.slice();
            next.forEach((row) => {
                if (row && row.notification_id !== undefined) seen[row.notification_id] = true;
            });
            rows.forEach((row) => {
                if (row && (row.notification_id === undefined || !seen[row.notification_id])) next.push(row);
            });
            setRows(next);
            skipRef.current = skip + rows.length;
            setMore(rows.length >= current.take);
        } catch (e) {
            // Keep what is already on screen; the user can scroll again to retry.
        } finally {
            inFlightRef.current = false;
            if (mountedRef.current) setLoadingMore(false);
        }
    }, [inert, setRows, setMore]);

    // Fetches page 1 (which also marks the inbox as read server-side). Called
    // when the inbox screen becomes visible.
    const openInbox = useCallback(() => {
        loadFirstPage({ spinner: rowsRef.current.length === 0 });
    }, [loadFirstPage]);

    // Pull-to-refresh / retry.
    const refresh = useCallback(() => {
        loadFirstPage({ spinner: rowsRef.current.length === 0 });
    }, [loadFirstPage]);

    // Indie only. Optimistically removes the row and puts it back on failure.
    // Mass delete is an admin action that removes the notification for every
    // user, so it is not exposed here.
    const deleteNotification = useCallback(async (notificationId) => {
        if (inert) return false;
        const current = getConfig();
        if (!current || current.inboxMode !== 'indie') return false;
        const rowsNow = rowsRef.current;
        const index = rowsNow.findIndex((row) => row && row.notification_id === notificationId);
        if (index < 0) return false;
        const removed = rowsNow[index];
        const optimistic = rowsNow.slice();
        optimistic.splice(index, 1);
        setRows(optimistic);
        skipRef.current = Math.max(0, skipRef.current - 1);
        try {
            await deleteIndieNotificationInbox(current.subId, notificationId, current.appId, current.appToken);
            return true;
        } catch (e) {
            const reverted = rowsRef.current.slice();
            reverted.splice(Math.min(index, reverted.length), 0, removed);
            setRows(reverted);
            skipRef.current += 1;
            return false;
        }
    }, [inert, setRows]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        if (inert) return;
        if (!appId || !appToken) {
            console.warn('[native-notify] NotificationInbox: `appId` and `appToken` are required.');
            return;
        }
        if (inboxMode === 'indie' && missingSubId(subId)) {
            console.warn('[native-notify] NotificationInbox: `subId` is required when mode="indie".');
            return;
        }
        refreshUnread();
        const appStateSub = AppState.addEventListener('change', (state) => {
            if (state === 'active') refreshUnread();
        });
        let notifSub = null;
        try {
            notifSub = Notifications.addNotificationReceivedListener(() => {
                refreshUnread();
            });
        } catch (e) {
            // Notifications unavailable in this environment.
        }
        return () => {
            if (appStateSub && typeof appStateSub.remove === 'function') appStateSub.remove();
            if (notifSub) {
                if (typeof notifSub.remove === 'function') notifSub.remove();
                else if (typeof Notifications.removeNotificationSubscription === 'function') {
                    Notifications.removeNotificationSubscription(notifSub);
                }
            }
        };
    }, [inert, refreshUnread, appId, appToken, inboxMode, subId]);

    return {
        notifications,
        unreadCount,
        loading,
        refreshing,
        loadingMore,
        hasMore,
        error,
        openInbox,
        refresh,
        refreshUnread,
        loadMore,
        deleteNotification,
    };
}

function NotificationRow({ item, theme, canDelete, onPress, onDelete }) {
    // The server maps date_sent -> date and push_data -> pushData in every
    // inbox response; the snake_case fallbacks cover any older/raw payloads.
    const dateText = formatDate(item ? item.date || item.date_sent : '');
    const inner = (
        <View>
            <View style={styles.rowTop}>
                <Text style={[styles.rowTitle, { color: theme.title }]} numberOfLines={2}>
                    {item && item.title ? String(item.title) : 'Notification'}
                </Text>
                {dateText ? <Text style={[styles.rowDate, { color: theme.mutedText }]}>{dateText}</Text> : null}
            </View>
            {item && item.message ? (
                <Text style={[styles.rowMessage, { color: theme.text }]}>{String(item.message)}</Text>
            ) : null}
            {canDelete ? (
                <Pressable
                    onPress={() => onDelete(item.notification_id)}
                    hitSlop={10}
                    style={styles.deleteButton}
                    accessibilityRole="button"
                    accessibilityLabel="Delete notification"
                >
                    <Text style={[styles.deleteText, { color: theme.delete }]}>Delete</Text>
                </Pressable>
            ) : null}
        </View>
    );
    const cardStyle = [styles.row, { backgroundColor: theme.card, borderColor: theme.border }];
    if (typeof onPress === 'function') {
        return (
            <Pressable onPress={() => onPress(item)} style={cardStyle} accessibilityRole="button">
                {inner}
            </Pressable>
        );
    }
    return <View style={cardStyle}>{inner}</View>;
}

/**
 * The full-screen notification inbox. Use it directly if you want to control
 * when it opens; NotificationInboxBell already renders one.
 *
 * Props:
 * - visible, onClose — control the modal.
 * - appId, appToken   — your Native Notify credentials.
 * - mode              — 'mass' (default) or 'indie'.
 * - subId             — required when mode="indie".
 * - take              — page size (default 20).
 * - colors            — partial theme override (see README).
 * - title, emptyText  — header title and empty-state text.
 * - allowDelete       — delete button per row; only ever shown in indie mode
 *                       (default: true in indie mode, never in mass mode).
 * - onNotificationPress(notification) — called when a row is tapped.
 * - inbox             — internal: reuse a useNotificationInbox() instance.
 */
export function NotificationInboxScreen(props) {
    const {
        inbox: providedInbox,
        visible,
        onClose,
        appId,
        appToken,
        mode = 'mass',
        subId,
        take = 20,
        colors,
        title = 'Notifications',
        emptyText = "You're all caught up",
        allowDelete,
        onNotificationPress,
    } = props || {};

    const inboxMode = mode === 'indie' ? 'indie' : 'mass';
    const ownInbox = useNotificationInbox(providedInbox ? INERT_CONFIG : { appId, appToken, mode, subId, take });
    const inbox = providedInbox || ownInbox;
    const theme = useInboxTheme(colors);
    const canDelete = inboxMode === 'indie' && allowDelete !== false;

    const openInbox = inbox.openInbox;
    useEffect(() => {
        if (visible && typeof openInbox === 'function') openInbox();
    }, [visible, openInbox]);

    const rows = inbox.notifications || [];
    const showLoading = !!inbox.loading && rows.length === 0;
    const showError = !!inbox.error && rows.length === 0;

    const topInset = Platform.OS === 'android'
        ? (StatusBar.currentHeight || 0)
        : (Constants.statusBarHeight || 0);

    const handleClose = () => {
        if (typeof onClose === 'function') onClose();
    };

    let body;
    if (showLoading) {
        body = (
            <View style={styles.centered}>
                <ActivityIndicator color={theme.accent} />
            </View>
        );
    } else if (showError) {
        body = (
            <View style={styles.centered}>
                <Text style={[styles.emptyTitle, { color: theme.emptyTitle }]}>Couldn&apos;t load notifications</Text>
                <Text style={[styles.emptyText, { color: theme.emptyText }]}>{inbox.error}</Text>
                <Pressable
                    onPress={openInbox}
                    style={[styles.retryButton, { backgroundColor: theme.accent }]}
                    accessibilityRole="button"
                >
                    <Text style={styles.retryText}>Try again</Text>
                </Pressable>
            </View>
        );
    } else if (rows.length === 0) {
        body = (
            <View style={styles.centered}>
                <Image
                    source={require('./assets/bell.png')}
                    style={[styles.emptyIcon, { tintColor: theme.mutedText }]}
                    resizeMode="contain"
                />
                <Text style={[styles.emptyTitle, { color: theme.emptyTitle }]}>No notifications yet</Text>
                <Text style={[styles.emptyText, { color: theme.emptyText }]}>{emptyText}</Text>
            </View>
        );
    } else {
        body = (
            <FlatList
                data={rows}
                keyExtractor={(item) => String(item && item.notification_id)}
                renderItem={({ item }) => (
                    <NotificationRow
                        item={item}
                        theme={theme}
                        canDelete={canDelete}
                        onPress={onNotificationPress}
                        onDelete={inbox.deleteNotification}
                    />
                )}
                contentContainerStyle={styles.listContent}
                refreshControl={(
                    <RefreshControl
                        refreshing={!!inbox.refreshing}
                        onRefresh={inbox.refresh}
                        tintColor={theme.mutedText}
                        colors={[theme.accent]}
                    />
                )}
                onEndReachedThreshold={0.4}
                onEndReached={() => {
                    if (inbox.hasMore && !inbox.loadingMore) inbox.loadMore();
                }}
                ListFooterComponent={inbox.loadingMore ? (
                    <ActivityIndicator style={styles.footerSpinner} color={theme.accent} />
                ) : null}
            />
        );
    }

    return (
        <Modal
            visible={!!visible}
            animationType="slide"
            onRequestClose={handleClose}
            statusBarTranslucent={Platform.OS === 'android'}
        >
            <View style={[styles.modalRoot, { backgroundColor: theme.background, paddingTop: topInset }]}>
                <View style={[styles.header, { backgroundColor: theme.headerBackground, borderBottomColor: theme.border }]}>
                    <Text style={[styles.headerTitle, { color: theme.title }]} numberOfLines={1}>
                        {title}
                    </Text>
                    <Pressable
                        onPress={handleClose}
                        hitSlop={12}
                        style={styles.closeButton}
                        accessibilityRole="button"
                        accessibilityLabel="Close notification inbox"
                    >
                        <Text style={[styles.closeIcon, { color: theme.mutedText }]}>✕</Text>
                    </Pressable>
                </View>
                {body}
            </View>
        </Modal>
    );
}

/**
 * The drop-in bell icon for your header. Shows a red dot when there are unread
 * notifications, and opens NotificationInboxScreen when tapped.
 *
 * Takes every NotificationInboxScreen prop, plus:
 * - onOpen            — if provided, the bell calls this instead of opening
 *                       the built-in screen (bring your own inbox screen).
 * - showCount         — show a numeric badge instead of a plain dot (default false).
 * - maxCount          — badge cap, shown as "N+" (default 99).
 * - renderIcon({ unreadCount, color }) — custom bell node.
 * - iconSize          — bell size (default 24).
 * - iconStyle, containerStyle — styling escape hatches.
 */
export function NotificationInboxBell(props) {
    const {
        onOpen,
        showCount = false,
        maxCount = 99,
        renderIcon,
        iconSize = 24,
        iconStyle,
        containerStyle,
        ...screenProps
    } = props || {};

    const [visible, setVisible] = useState(false);
    const inbox = useNotificationInbox({
        appId: screenProps.appId,
        appToken: screenProps.appToken,
        mode: screenProps.mode,
        subId: screenProps.subId,
        take: screenProps.take,
    });
    const theme = useInboxTheme(screenProps.colors);
    const count = inbox.unreadCount || 0;
    const hasUnread = count > 0;
    const badgeText = count > maxCount ? `${maxCount}+` : String(count);

    const handlePress = () => {
        if (typeof onOpen === 'function') {
            onOpen();
            return;
        }
        setVisible(true);
    };

    const icon = typeof renderIcon === 'function'
        ? renderIcon({ unreadCount: count, color: theme.icon })
        : (
            <Image
                source={require('./assets/bell.png')}
                style={[{ width: iconSize, height: iconSize, tintColor: theme.icon }, iconStyle]}
                resizeMode="contain"
            />
        );

    return (
        <View>
            <Pressable
                onPress={handlePress}
                hitSlop={12}
                style={[styles.bellButton, containerStyle]}
                accessibilityRole="button"
                accessibilityLabel={hasUnread ? `Notifications, ${count} unread` : 'Notifications'}
                accessibilityHint="Opens the notification inbox"
            >
                {icon}
                {hasUnread ? (showCount ? (
                    <View style={[styles.badge, { backgroundColor: theme.dot, borderColor: theme.headerBackground }]}>
                        <Text style={[styles.badgeText, { color: theme.badgeText }]} numberOfLines={1}>
                            {badgeText}
                        </Text>
                    </View>
                ) : (
                    <View style={[styles.dot, { backgroundColor: theme.dot, borderColor: theme.headerBackground }]} />
                )) : null}
            </Pressable>
            <NotificationInboxScreen
                inbox={inbox}
                visible={visible}
                onClose={() => setVisible(false)}
                {...screenProps}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    modalRoot: { flex: 1 },
    bellButton: { padding: 4 },
    dot: {
        position: 'absolute',
        top: 1,
        right: 1,
        width: 10,
        height: 10,
        borderRadius: 5,
        borderWidth: 2,
    },
    badge: {
        position: 'absolute',
        top: -4,
        right: -6,
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        borderWidth: 2,
        paddingHorizontal: 4,
        alignItems: 'center',
        justifyContent: 'center',
    },
    badgeText: { fontSize: 10, fontWeight: '700' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    headerTitle: { flex: 1, fontSize: 18, fontWeight: '600', marginRight: 12 },
    closeButton: { padding: 4 },
    closeIcon: { fontSize: 18, fontWeight: '600' },
    listContent: { padding: 16, paddingBottom: 40 },
    row: {
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        padding: 14,
        marginBottom: 10,
    },
    rowTop: { flexDirection: 'row', alignItems: 'flex-start' },
    rowTitle: { flex: 1, fontSize: 15, fontWeight: '600', marginRight: 8 },
    rowDate: { fontSize: 12 },
    rowMessage: { marginTop: 4, fontSize: 14, lineHeight: 20 },
    deleteButton: { marginTop: 10, alignSelf: 'flex-start' },
    deleteText: { fontSize: 13, fontWeight: '600' },
    footerSpinner: { marginVertical: 16 },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
    emptyIcon: { width: 40, height: 40, opacity: 0.45, marginBottom: 12 },
    emptyTitle: { fontSize: 16, fontWeight: '600', marginBottom: 6, textAlign: 'center' },
    emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
    retryButton: { marginTop: 16, borderRadius: 8, paddingHorizontal: 18, paddingVertical: 10 },
    retryText: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
});
