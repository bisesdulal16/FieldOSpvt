import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { FaceVerificationModal } from '../components/fieldos/FaceVerificationModal';
import { useInitDB } from '../hooks/useInitDB';

export default function RootLayout() {
  const { isReady } = useInitDB();

  // While DB initializes, render nothing (fast — takes <100ms)
  if (!isReady) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="client-detail"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="visit-checkin"
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="record-collection"
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="receipt"
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="promise-to-pay"
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="verify-identity"
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="end-of-day"
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="sync-center"
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="center-meeting"
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="notifications"
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="audit-logs"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="voice-notes"
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="ai-assistant"
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="security-center"
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="change-pin"
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="pilot-info"
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_right' }}
        />
      </Stack>
      <FaceVerificationModal />
    </SafeAreaProvider>
  );
}
