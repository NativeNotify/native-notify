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

## Step 1: Install
```
npm i native-notify 
expo install expo-device expo-notifications
```

## Step 2: Import
Import registerNNPushToken in your App.js file:
```
import registerNNPushToken from 'native-notify';
```

## Step 3: Make sure your App.js function is a hook function
<strong>Your App function MUST be a hook function, or your push notifications will NOT work. This link explains how hooks work: <a href="https://reactjs.org/docs/hooks-intro.html" target="_blank">https://reactjs.org/docs/hooks-intro.html</a></strong>

## Step 4: Paste
Paste this code into your App.js component in the App function:
```
let pushDataObject = registerNNPushToken(yourAppId, 'yourAppToken');
```
<br/><br/>
You must go to https://NativeNotify.com to receive a free App Id and App Token, or the registerNNPushToken function will not work. 
<br/><br/>
It's free to sign up. No credit card required.

## Example of an App.js component with native-notify code included:
```
import React, { useEffect } from 'react';
import registerNNPushToken from 'native-notify';

export default function App() {
     let pushDataObject = registerNNPushToken(957, 'GMzZMrvzLpzcLMSbSE9xE8');

     useEffect(() => {
        console.log(pushDataObject);
     }

     return (
        ...
     )
}
```

## Use
The registerNNPushToken will register your user's Native Notify push notification token and will return a data object. You can then send your users push notifications in the https://NativeNotify.com push notification portal.
<br/><br/>
You can send data objects with your Native Notify push notifications. Once a user taps on your Native Notify push notification, the value of the data object will be returned to this pushDataObject variable. You can use this value to do things like redirect your users to a particular screen once a Native Notify push notification is tapped.

## Show your support
Give a ⭐️ if this project helped you!