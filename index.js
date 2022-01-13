import React, { useState, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import axios from 'axios';

Notifications.setNotificationHandler({handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false, })});

async function registerForPushNotificationsAsync() { 
    let token; 
    
    if (Device.isDevice) { 
        const { status: existingStatus } = await Notifications.getPermissionsAsync(); 
        let finalStatus = existingStatus; if (existingStatus !== 'granted') { 
            const { status } = await Notifications.requestPermissionsAsync(); 
            finalStatus = status; 
        } 
        token = (await Notifications.getExpoPushTokenAsync()).data; 
    } else { 
        console.log('Must use physical device for Push Notifications'); 
    } 
    
    if (Platform.OS === 'android') { 
        Notifications.setNotificationChannelAsync('default', { 
            name: 'default', 
            importance: Notifications.AndroidImportance.MAX, 
            vibrationPattern: [0, 250, 250, 250], 
            lightColor: '#FF231F7C', 
        }); 
    } 
    
    return token; 
}

export default function registerNNPushToken(appId, appToken) {
    const [data, setData] = useState({});
    const signUpMessage = 'You must sign up for a free https://NativeNotify.com account to receive an App Id and an App Token, or this plugin will not work. Go to https://NativeNotify.com to sign up for free, no credit card required. Click "Create an App" after logging in and follow the instructions.'

    const responseListener = useRef();

    useEffect(() => {
        if(Device.isDevice && Platform.OS !== 'web') {
            registerForPushNotificationsAsync().then(token => {
                axios.post(`https://app.nativenotify.com/api/expo/key`, { appId: appId, appToken: appToken, expoToken: token })
            });
            responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
                console.log(response.notification.request.content.data);
                if(response.notification.request.content.data) {
                    setData(response.notification.request.content.data);
                } else {
                    setData({ dataObjectExample: "If you send a data object with your NativeNotify.com push notification, it will appear here once your user taps on your push notification. You can use this data object to do things like redirect your user to a specific screen other than the home screen." })
                }
            });
            return () => { Notifications.removeNotificationSubscription(responseListener); };
        }
    });

    if(appId && appToken) {
        return data;
    } else {
        return signUpMessage;
    }

    
}