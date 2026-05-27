import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../../constants';

interface PrimaryButtonProps {
  children?: React.ReactNode;
  label?: string;
  onPress?: () => void;
  style?: any;
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  loading?: boolean;
}

export function PrimaryButton({ children, label, onPress, style, icon, disabled, loading }: PrimaryButtonProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={disabled || loading ? 1 : 0.8}
      style={[styles.button, style, (disabled || loading) && styles.buttonDisabled]}
      disabled={disabled || loading}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.white} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={18} color={colors.white} />}
          <Text style={styles.text}>{label || children}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.navy,
  },
  text: {
    fontSize: fontSize.xl,
    fontWeight: '600',
    color: colors.white,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
