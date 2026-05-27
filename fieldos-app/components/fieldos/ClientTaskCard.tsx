import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, fontSize, spacing, borderRadius } from '../../constants';
import { useFieldOSStore } from '../../store/useFieldOSStore';
import { StatusChip } from './StatusChip';
import type { StatusVariant } from '../../types';

interface ClientTaskCardProps {
  name: string;
  memberId: string;
  center: string;
  ward: string;
  dueAmount: string;
  status: StatusVariant;
  statusLabel: string;
  reason: string;
  onStartVisit?: () => void;
  onCollect?: () => void;
}

export function ClientTaskCard({
  name,
  memberId,
  center,
  ward,
  dueAmount,
  status,
  statusLabel,
  reason,
  onStartVisit,
  onCollect,
}: ClientTaskCardProps) {
  const router = useRouter();
  const { setSelectedClient } = useFieldOSStore();

  const safeName = name || 'Unknown Client';
  const safeMemberId = memberId || '—';

  const handleCardPress = () => {
    setSelectedClient({ id: safeMemberId, name: safeName, memberId: safeMemberId });
    router.push('/client-detail');
  };

  const initials = safeName
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('');

  return (
    <TouchableOpacity onPress={handleCardPress} activeOpacity={0.9}>
      <View style={styles.card}>
        <View style={styles.topRow}>
          <View style={styles.avatarContainer}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <View>
              <Text style={styles.name}>{safeName}</Text>
              <Text style={styles.memberId}>{safeMemberId}</Text>
            </View>
          </View>
          <StatusChip label={statusLabel} variant={status} />
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Ionicons name="people-outline" size={10} color={colors.gray500} />
            <Text style={styles.metaText}>{center}</Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="location-outline" size={10} color={colors.gray500} />
            <Text style={styles.metaText}>{ward}</Text>
          </View>
        </View>

        <View style={styles.bottomRow}>
          <View>
            <Text style={[styles.dueAmount, status === 'overdue' && { color: colors.red }]}>
              {dueAmount}
            </Text>
            <Text style={styles.reason}>{reason}</Text>
          </View>
          <View style={styles.actionButtons}>
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation?.();
                onStartVisit?.();
              }}
              style={styles.visitButton}
            >
              <Ionicons name="location-outline" size={10} color={colors.navy} />
              <Text style={styles.visitButtonText}>Visit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation?.();
                onCollect?.();
              }}
              style={styles.collectButton}
            >
              <Ionicons name="wallet-outline" size={10} color={colors.white} />
              <Text style={styles.collectButtonText}>Collect</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.gray100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  avatarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 9999,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: fontSize.base,
    fontWeight: 'bold',
    color: colors.white,
  },
  name: {
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.gray800,
  },
  memberId: {
    fontSize: fontSize.sm,
    color: colors.gray400,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: fontSize.sm,
    color: colors.gray500,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dueAmount: {
    fontSize: fontSize.lg,
    fontWeight: 'bold',
    color: colors.gray800,
  },
  reason: {
    fontSize: fontSize.xs,
    color: colors.gray400,
    marginTop: 2,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 6,
  },
  visitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.navy,
  },
  visitButtonText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.navy,
  },
  collectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.navy,
  },
  collectButtonText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.white,
  },
});
