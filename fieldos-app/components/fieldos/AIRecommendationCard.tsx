import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../../constants';

interface AIRecommendationCardProps {
  title: string;
  reason: string;
  clientName?: string;
  action?: string;
  onAction?: () => void;
}

export function AIRecommendationCard({ title, reason, clientName, action, onAction }: AIRecommendationCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.iconContainer}>
          <Ionicons name="sparkles-outline" size={14} color={colors.white} />
        </View>
        <View style={styles.content}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.reason}>{reason}</Text>
          {clientName && <Text style={styles.clientName}>{clientName}</Text>}
          {action && (
            <TouchableOpacity onPress={onAction} style={styles.actionButton}>
              <Text style={styles.actionText}>{action}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#93C5FD',
    backgroundColor: colors.navyBg,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  iconContainer: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.navy,
  },
  reason: {
    fontSize: fontSize.sm,
    color: colors.gray500,
    marginTop: 2,
  },
  clientName: {
    fontSize: fontSize.base,
    fontWeight: '500',
    color: colors.navy,
    marginTop: spacing.xs,
  },
  actionButton: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.navy,
  },
  actionText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.white,
  },
});
