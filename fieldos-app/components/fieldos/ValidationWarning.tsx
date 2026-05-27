import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fontSize, spacing, borderRadius } from '../../constants';
import { Ionicons } from '@expo/vector-icons';

interface ValidationWarningProps {
  message: string;
}

export function ValidationWarning({ message }: ValidationWarningProps) {
  if (!message) return null;
  return (
    <View style={styles.container}>
      <Ionicons name="warning" size={14} color={colors.orange} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.sm - 2,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.sm,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  text: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    color: '#92400E',
    flex: 1,
  },
});
