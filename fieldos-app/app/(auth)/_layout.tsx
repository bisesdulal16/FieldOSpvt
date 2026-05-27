import React from 'react';
import { Slot } from 'expo-router';

/**
 * Auth group layout — pass-through only.
 * Uses Slot instead of Stack to avoid nested navigator issues.
 * The root _layout.tsx Stack handles all navigation.
 */
export default function AuthLayout() {
  return <Slot />;
}
