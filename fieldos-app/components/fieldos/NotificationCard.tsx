import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../../constants';

interface NotificationCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  title: string;
  description: string;
  time: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function NotificationCard({ icon, iconColor, title, description, time, actionLabel, onAction }: NotificationCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.iconContainer}>
        <Ionicons name={icon} size={16} color={iconColor} />
      </View>
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Text style={styles.time}>{time}</Text>
        </View>
        <Text style={styles.description} numberOfLines={2}>{description}</Text>
        {actionLabel && onAction && (
          <TouchableOpacity onPress={onAction} style={[styles.actionButton, { backgroundColor: `${iconColor}15` }]}>
            <Text style={[styles.actionText, { color: iconColor }]}>{actionLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
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
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    marginTop: 2,
  },
  content: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  title: {
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.gray800,
    flex: 1,
  },
  time: {
    fontSize: fontSize.xs,
    color: colors.gray400,
  },
  description: {
    fontSize: fontSize.sm,
    color: colors.gray500,
    marginTop: 2,
  },
  actionButton: {
    marginTop: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
  },
  actionText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
});
