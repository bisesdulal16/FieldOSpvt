import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fontSize, spacing } from '../../constants';
import type { StatusVariant } from '../../types';

const variantStyles: Record<StatusVariant, { bg: string; color: string; border: string }> = {
  overdue: { bg: colors.redLight, color: colors.red, border: colors.redBorder },
  'due-today': { bg: colors.orangeLight, color: colors.orange, border: colors.orangeBorder },
  promise: { bg: '#FEF3C7', color: '#D97706', border: '#FCD34D' },
  'high-value': { bg: '#EDE9FE', color: '#7C3AED', border: '#C4B5FD' },
  sync: { bg: colors.greenLight, color: colors.green, border: colors.greenBorder },
  verified: { bg: colors.greenLight, color: colors.green, border: colors.greenBorder },
  absent: { bg: colors.redLight, color: colors.red, border: colors.redBorder },
  present: { bg: colors.greenLight, color: colors.green, border: colors.greenBorder },
  paid: { bg: colors.greenLight, color: colors.green, border: colors.greenBorder },
  'follow-up': { bg: colors.orangeLight, color: colors.orange, border: colors.orangeBorder },
  success: { bg: colors.greenLight, color: colors.green, border: colors.greenBorder },
  warning: { bg: colors.orangeLight, color: colors.orange, border: colors.orangeBorder },
  info: { bg: colors.navyBg, color: colors.navy, border: '#93C5FD' },
  saved: { bg: '#E0F2FE', color: '#0284C7', border: '#7DD3FC' },
  pending: { bg: colors.gray50, color: colors.gray500, border: colors.gray200 },
};

interface StatusChipProps {
  label: string;
  variant: StatusVariant;
}

export function StatusChip({ label, variant }: StatusChipProps) {
  const s = variantStyles[variant] || variantStyles.info;
  return (
    <View style={[styles.container, { backgroundColor: s.bg, borderColor: s.border }]}>
      <Text style={[styles.text, { color: s.color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 9999,
    borderWidth: 1,
  },
  text: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    lineHeight: fontSize.sm + 4,
  },
});
