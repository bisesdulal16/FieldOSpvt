import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fontSize, spacing, borderRadius } from '../../constants';
import { Ionicons } from '@expo/vector-icons';

interface ValidationErrorProps {
  message: string;
}

export function ValidationError({ message }: ValidationErrorProps) {
  if (!message) return null;
  return (
    <View style={styles.container}>
      <Ionicons name="warning" size={14} color={colors.red} />
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
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  text: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    color: colors.red,
    flex: 1,
  },
});
