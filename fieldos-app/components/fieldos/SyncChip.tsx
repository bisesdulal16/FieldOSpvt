import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing } from '../../constants';
import type { SyncStatus } from '../../types';

interface SyncChipProps {
  status: SyncStatus;
}

const config: Record<SyncStatus, { icon: keyof typeof Ionicons.glyphMap; label: string; color: string; bg: string }> = {
  offline: { icon: 'cloud-offline-outline', label: 'Offline Ready', color: colors.orange, bg: colors.orangeLight },
  online: { icon: 'wifi-outline', label: 'Online', color: colors.green, bg: colors.greenLight },
  syncing: { icon: 'sync-outline', label: 'Syncing...', color: colors.navy, bg: colors.navyBg },
  synced: { icon: 'checkmark-circle-outline', label: 'All Synced', color: colors.green, bg: colors.greenLight },
  failed: { icon: 'cloud-offline-outline', label: 'Sync Failed', color: colors.red, bg: colors.redLight },
  pending_sync: { icon: 'time-outline', label: 'Pending Sync', color: colors.orange, bg: colors.orangeLight },
};

export function SyncChip({ status }: SyncChipProps) {
  const c = config[status];
  return (
    <View style={[styles.container, { backgroundColor: c.bg }]}>
      <Ionicons name={c.icon} size={10} color={c.color} />
      <Text style={[styles.text, { color: c.color }]}>{c.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  text: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
});
