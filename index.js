import React, { useState, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import axios from 'axios';
import Constants from "expo-constants";

Notifications.setNotificationHandler({handleNotification: async () => ({ 
    shouldShowAlert: true, 
    shouldPlaySound: true, 
    shouldSetBadge: true, 
})});

async function registerForPushNotificationsAsync() { 
    let expoAndroidToken, fcmToken, expoIosToken, apnToken; 

    if (Platform.OS === 'android') { 
        await Notifications.setNotificationChannelAsync('default', { 
            name: 'default', 
            importance: Notifications.AndroidImportance.MAX, 
            vibrationPattern: [0, 250, 250, 250], 
            lightColor: '#FF231F7C', 
        }); 
    } 
    
    if (Device.isDevice) { 
        const { status: existingStatus } = await Notifications.getPermissionsAsync(); 
        let finalStatus = existingStatus; 
        if (existingStatus !== 'granted') { 
            try {
                const { status } = await Notifications.requestPermissionsAsync();
                finalStatus = status;
            } catch (error) {
                // console.log('An error occurred while requesting notification permissions:', error);
                return 'Failed to get push token';
            } 
        } 
        if (finalStatus !== 'granted') {
            return 'Failed to get push token';
        }

        if(Platform.OS === 'android') {
            expoAndroidToken = (await Notifications.getExpoPushTokenAsync({
                projectId: Constants.expoConfig.extra.eas.projectId,
              })).data;
            fcmToken = (await Notifications.getDevicePushTokenAsync()).data;
        } else if(Platform.OS === 'ios') {
            expoIosToken = (await Notifications.getExpoPushTokenAsync({
                projectId: Constants.expoConfig.extra.eas.projectId,
              })).data;
            apnToken = (await Notifications.getDevicePushTokenAsync()).data;
        }
    } else { 
        console.log('Must use physical device for Push Notifications'); 
        return 'Must use physical device for Push Notifications';
    } 
    
    return { expoAndroidToken, fcmToken, expoIosToken, apnToken }; 
}

export default function registerNNPushToken(appId, appToken) {
    const responseListener = useRef();

    useEffect(() => {
        if(Device.isDevice && Platform.OS !== 'web' || Platform.OS === 'android') {
            registerForPushNotificationsAsync()
                .then(async (res) => {
                    if(res === 'Must use physical device for Push Notifications' || res === 'Failed to get push token')
                        return

                    const { expoAndroidToken, fcmToken, expoIosToken, apnToken } = res;

                    await axios
                        .post(`https://app.nativenotify.com/api/device/tokens`, { 
                            appId, 
                            appToken, 
                            platformOS: Platform.OS, 
                            expoAndroidToken, 
                            fcmToken, 
                            expoIosToken, 
                            apnToken 
                        })
                        .then(() => console.log('You can now send a push notification. You successfully registered your Native Notify Push Token!'))
                        .catch(err => console.log(err));            
                });

            responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
                console.log(response);
            });
            
            return () => {
                responseListener.current &&
                    Notifications.removeNotificationSubscription(responseListener.current);
            };

            // return () => { Notifications.removeNotificationSubscription(responseListener); };
        }
    }, []);
}

export async function registerIndieID(subID, appId, appToken) {
    if(Device.isDevice && Platform.OS !== 'web' || Platform.OS === 'android') {
        let expoToken = (await Notifications.getExpoPushTokenAsync({
            projectId: Constants.expoConfig.extra.eas.projectId,
          })).data;
        let deviceToken = (await Notifications.getDevicePushTokenAsync()).data;
        if(expoToken) {
            await axios.post(`https://app.nativenotify.com/api/indie/id`, {
                subID,
                appId,
                appToken,
                platformOS: Platform.OS,
                expoToken,
                deviceToken
            })
            .then(() => console.log('You successfully registered your Indie ID.'))
            .catch(err => console.log(err));
        } else {
            console.log('Setup Error: Please, follow the "Start Here" instructions BEFORE trying to use this registerIndieID function.')
        }
    }
}

export async function unregisterIndieDevice(subID, appId, appToken) {
    if(Device.isDevice && Platform.OS !== 'web' || Platform.OS === 'android') {
        let expoToken = (await Notifications.getExpoPushTokenAsync({
            projectId: Constants.expoConfig.extra.eas.projectId,
          })).data;
        let deviceToken = (await Notifications.getDevicePushTokenAsync()).data;
        if(expoToken) {
            await axios.put(`https://app.nativenotify.com/api/unregister/indie/device`, {
                appId,
                appToken,
                subID,
                expoToken,
                deviceToken
            })
            .then(() => console.log('You successfully unregistered your device from this Indie Sub ID.'))
            .catch(err => console.log(err));
        } else {
            console.log('Setup Error: Please, follow the "Start Here" instructions BEFORE trying to use this unregisterIndieDevice function.')
        }
    }
}

export async function getFollowMaster(masterSubID, appId, appToken) {
    let response = await axios.get(`https://app.nativenotify.com/api/follow/master/${masterSubID}/${appId}/${appToken}`)

    return { 
        follower_indie_ids: response.data.follower_indie_ids, 
        follower_count: response.data.follower_count, 
        following_indie_ids: response.data.following_indie_ids, 
        following_count: response.data.following_count };
}

export async function registerFollowMasterID(masterSubID, appId, appToken) {
    let response = '';

    await axios.post(`https://app.nativenotify.com/api/post/follow/master`, {
            masterSubID: masterSubID,
            appId: appId,
            appToken: appToken
        })
        .then(() => response = "Follow Master Indie ID registered!")
        .catch(() => response = "Follow Master Indie ID already registered.");

    if(response === "Follow Master Indie ID registered!") {
        return "Follow Master Indie ID registered!"
    } 

    if(response === "Follow Master Indie ID already registered.") {
        return "Follow Master Indie ID already registered."
    }
}

export async function registerFollowerID(masterSubID, followerSubID, appId, appToken) {
    let response = '';

    await axios.post(`https://app.nativenotify.com/api/post/follower`, {
            masterSubID: masterSubID,
            followerSubID: followerSubID,
            appId: appId,
            appToken: appToken
        })
        .then(() => response = "Follower Indie ID registered!")
        .catch(() => response = "Follower Indie ID already registered.");
        
    if(response === "Follower Indie ID registered!") {
        return "Follower Indie ID registered!"
    } 

    if(response === "Follower Indie ID already registered.") {
        return "Follower Indie ID already registered."
    }
}

export async function postFollowingID(masterSubID, followingSubID, appId, appToken) {
    let response = "";
    
    await axios.post(`https://app.nativenotify.com/api/post/following`, {
            masterSubID: masterSubID,
            followingSubID: followingSubID,
            appId: appId,
            appToken: appToken
        })
        .then(() => response = "Following Indie ID posted!")
        .catch(() => response = "Following Indie ID already posted.");

    if(response === "Following Indie ID posted!") {
        return "Following Indie ID posted!"
    } 

    if(response === "Following Indie ID already posted.") {
        return "Following Indie ID already posted."
    }
}

export async function unfollowMasterID(masterSubID, followerSubID, appId, appToken) {
    let response = '';
    
    await axios.put(`https://app.nativenotify.com/api/unfollow/master`, {
            masterSubID: masterSubID,
            followerSubID: followerSubID,
            appId: appId,
            appToken: appToken
        })
        .then(() => response = "Follow Master unfollowed successfully!")
        .catch(() => response = "FollowSubID is not following Follow Master.");

    if(response === "Follow Master unfollowed successfully!") {
        return "Follow Master unfollowed successfully!"
    } 

    if(response === "FollowSubID is not following Follow Master.") {
        return "FollowSubID is not following Follow Master."
    }
}

export async function updateFollowersList(masterSubID, followingSubID, appId, appToken) {
    let response = '';
    
    await axios.put(`https://app.nativenotify.com/api/master/followers/list`, {
            masterSubID: masterSubID,
            followingSubID: followingSubID,
            appId: appId,
            appToken: appToken
        })
        .then(() => response = "Follow Master ID removed from Follower List successfully!")
        .catch(() => response = "Follow Master ID is not in the Follower List.");

    if(response === "Follow Master ID removed from Follower List successfully!") {
        return "Follow Master ID removed from Follower List successfully!"
    } 

    if(response === "Follow Master ID is not in the Follower List.") {
        return "Follow Master ID is not in the Follower List."
    }
}

export async function deleteFollowMaster(appId, appToken, masterSubID) {
    await axios
        .delete(`https://app.nativenotify.com/api/follow/master/${appId}/${appToken}/${masterSubID}`)
        .then(() => console.log("Follower Master unfollowed successfully!"))
        .catch(() => console.log("Follower Master does not exist."));
}

export function getPushDataObject() {
    const [data, setData] = useState({});

    const responseListener = useRef();

    useEffect(() => {
        if(Device.isDevice && Platform.OS !== 'web' || Platform.OS === 'android') {

            responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
                setData(response.notification.request.content.data);
            });
            
            return () => { Notifications.removeNotificationSubscription(responseListener.current); };
        }
    }, []);

    return data;
}

export function getPushDataInForeground() {
    const [data, setData] = useState({});

    const notificationListener = useRef();

    useEffect(() => {
        if(Device.isDevice && Platform.OS !== 'web' || Platform.OS === 'android') {

            notificationListener.current = Notifications.addNotificationReceivedListener(response => {
                setData(response.request.content.data);
            });
            
            return () => { Notifications.removeNotificationSubscription(notificationListener.current); };
        }
    }, []);

    return data;
}

export async function getNotificationInbox(appId, appToken, take, skip) {
    if(Device.isDevice && Platform.OS !== 'web' || Platform.OS === 'android') {
        let token = (await Notifications.getExpoPushTokenAsync({
            projectId: Constants.expoConfig.extra.eas.projectId,
          })).data;
        if(token) {
            await axios.post(`https://app.nativenotify.com/api/notification/inbox/read`, {
                appId,
                appToken,
                expoToken: token,
            })
        }
    } 

    let response = await axios.get(`https://app.nativenotify.com/api/notification/inbox/${appId}/${appToken}?take=${take}&skip=${skip}`);

    return response.data;
}

export async function getUnreadNotificationInboxCount(appId, appToken) {
    let response; 
    if(Device.isDevice && Platform.OS !== 'web' || Platform.OS === 'android') {
        let token = (await Notifications.getExpoPushTokenAsync({
            projectId: Constants.expoConfig.extra.eas.projectId,
          })).data;
        if(token) {
            response = await axios.get(`https://app.nativenotify.com/api/notification/inbox/read/${appId}/${appToken}/${token}`);
        } 
    } 

    return response.data.unreadCount;
}

export async function getIndieNotificationInbox(subId, appId, appToken, take, skip) {    
    let response = await axios.get(`https://app.nativenotify.com/api/indie/notification/inbox/${subId}/${appId}/${appToken}?take=${take}&skip=${skip}`);

    return response.data;
}

export async function getUnreadIndieNotificationInboxCount(subId, appId, appToken) {
    let response = await axios.get(`https://app.nativenotify.com/api/indie/notification/inbox/read/${subId}/${appId}/${appToken}`);

    return response.data.unreadCount;
}

export async function deleteIndieNotificationInbox(subId, notificationId, appId, appToken) {
    let response = await axios.delete(`https://app.nativenotify.com/api/indie/notification/inbox/notification/${appId}/${appToken}/${notificationId}/${subId}`);

    return response.data;
}