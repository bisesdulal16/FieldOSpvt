// DEPRECATED: Custom BottomNav replaced by native expo-router <Tabs> component.
// Do not import or render this component in any active screen.
// Kept only for reference. Will be removed in a future cleanup.
import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, fontSize } from '../../constants';

interface TabItem {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
}

const tabs: TabItem[] = [
  { id: 'dashboard', label: 'Home', icon: 'home-outline', route: '/dashboard' },
  { id: 'due-collections', label: 'Tasks', icon: 'list-outline', route: '/tasks' },
  { id: 'record-collection', label: 'Collect', icon: 'wallet-outline', route: '/record-collection' },
  { id: 'center-meeting', label: 'Meet', icon: 'people-outline', route: '/center-meeting' },
  { id: 'profile', label: 'Profile', icon: 'person-circle-outline', route: '/profile' },
];

interface BottomNavProps {
  activeTab?: string;
}

export function BottomNav({ activeTab }: BottomNavProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const isActive = (id: string) => {
    if (id === 'dashboard') return activeTab === 'dashboard';
    if (id === 'due-collections') return ['due-collections', 'client-detail', 'visit-checkin'].includes(activeTab || '');
    if (id === 'record-collection') return ['record-collection', 'receipt', 'promise-to-pay'].includes(activeTab || '');
    if (id === 'center-meeting') return activeTab === 'center-meeting';
    if (id === 'profile') return activeTab === 'profile';
    return false;
  };

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + spacing.xs }]}>
      {tabs.map((tab) => {
        const active = isActive(tab.id);
        return (
          <TouchableOpacity
            key={tab.id}
            onPress={() => router.push(tab.route as any)}
            style={[styles.tabButton, active && styles.tabButtonActive]}
            activeOpacity={0.7}
          >
            <Ionicons
              name={tab.icon}
              size={20}
              color={active ? colors.navy : colors.gray400}
            />
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.gray100,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  tabButton: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    minWidth: 56,
  },
  tabButtonActive: {
    backgroundColor: colors.navyBg,
  },
  tabLabel: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    color: colors.gray400,
  },
  tabLabelActive: {
    color: colors.navy,
  },
});
