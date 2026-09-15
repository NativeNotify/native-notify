export default function registerNNPushToken(appId: any, appToken: any): void;
export function registerIndieID(subID: any, appId: any, appToken: any): Promise<void>;
export function unregisterIndieDevice(subID: any, appId: any, appToken: any): Promise<void>;
export function getFollowMaster(masterSubID: any, appId: any, appToken: any): Promise<{
    follower_indie_ids: any;
    follower_count: any;
    following_indie_ids: any;
    following_count: any;
}>;
export function registerFollowMasterID(masterSubID: any, appId: any, appToken: any): Promise<"Follow Master Indie ID registered!" | "Follow Master Indie ID already registered.">;
export function registerFollowerID(masterSubID: any, followerSubID: any, appId: any, appToken: any): Promise<"Follower Indie ID registered!" | "Follower Indie ID already registered.">;
export function postFollowingID(masterSubID: any, followingSubID: any, appId: any, appToken: any): Promise<"Following Indie ID posted!" | "Following Indie ID already posted.">;
export function unfollowMasterID(masterSubID: any, followerSubID: any, appId: any, appToken: any): Promise<"Follow Master unfollowed successfully!" | "FollowSubID is not following Follow Master.">;
export function updateFollowersList(masterSubID: any, followingSubID: any, appId: any, appToken: any): Promise<"Follow Master ID removed from Follower List successfully!" | "Follow Master ID is not in the Follower List.">;
export function deleteFollowMaster(appId: any, appToken: any, masterSubID: any): Promise<void>;
export function getPushDataObject(): any;
export function getPushDataInForeground(): any;
export function getNotificationInbox(appId: any, appToken: any, take: any, skip: any): Promise<any>;
export function getUnreadNotificationInboxCount(appId: any, appToken: any): Promise<any>;
export function getIndieNotificationInbox(subId: any, appId: any, appToken: any, take: any, skip: any): Promise<any>;
export function getUnreadIndieNotificationInboxCount(subId: any, appId: any, appToken: any): Promise<any>;
export function deleteIndieNotificationInbox(subId: any, notificationId: any, appId: any, appToken: any): Promise<any>;

export interface InboxNotification {
    notification_id: any;
    date?: any;
    title?: any;
    message?: any;
    pushData?: any;
    date_sent?: any;
    push_data?: any;
    [key: string]: any;
}

export interface NotificationInboxTheme {
    icon?: string;
    dot?: string;
    badgeText?: string;
    background?: string;
    headerBackground?: string;
    title?: string;
    text?: string;
    mutedText?: string;
    border?: string;
    card?: string;
    accent?: string;
    delete?: string;
    emptyTitle?: string;
    emptyText?: string;
}

export interface UseNotificationInboxOptions {
    appId: number | string;
    appToken: string;
    mode?: "mass" | "indie";
    subId?: number | string;
    take?: number;
}

export interface UseNotificationInboxResult {
    notifications: InboxNotification[];
    unreadCount: number;
    loading: boolean;
    refreshing: boolean;
    loadingMore: boolean;
    hasMore: boolean;
    error: string | null;
    openInbox: () => void;
    refresh: () => void;
    refreshUnread: () => Promise<void>;
    loadMore: () => Promise<void>;
    deleteNotification: (notificationId: number | string) => Promise<boolean>;
}

export interface NotificationInboxScreenProps {
    appId: number | string;
    appToken: string;
    mode?: "mass" | "indie";
    subId?: number | string;
    take?: number;
    colors?: NotificationInboxTheme;
    title?: string;
    emptyText?: string;
    allowDelete?: boolean;
    onNotificationPress?: (notification: InboxNotification) => void;
    visible?: boolean;
    onClose?: () => void;
    inbox?: UseNotificationInboxResult;
}

export interface NotificationInboxBellProps extends NotificationInboxScreenProps {
    onOpen?: () => void;
    showCount?: boolean;
    maxCount?: number;
    renderIcon?: (args: { unreadCount: number; color: string }) => any;
    iconSize?: number;
    iconStyle?: any;
    containerStyle?: any;
}

export function useNotificationInbox(options: UseNotificationInboxOptions): UseNotificationInboxResult;
export function NotificationInboxScreen(props: NotificationInboxScreenProps): any;
export function NotificationInboxBell(props: NotificationInboxBellProps): any;
