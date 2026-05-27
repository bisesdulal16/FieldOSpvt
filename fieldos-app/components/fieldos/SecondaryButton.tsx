import React from 'react';
import { Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../../constants';

interface SecondaryButtonProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: any;
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
}

export function SecondaryButton({ children, onPress, style, icon, loading, disabled }: SecondaryButtonProps) {
  return (
    <TouchableOpacity
      onPress={disabled || loading ? undefined : onPress}
      activeOpacity={0.8}
      style={[styles.button, style, (disabled || loading) && styles.buttonDisabled]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.navy} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={18} color={colors.navy} />}
          <Text style={styles.text}>{children}</Text>
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
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.navy,
  },
  buttonDisabled: { opacity: 0.5 },
  text: {
    fontSize: fontSize.xl,
    fontWeight: '600',
    color: colors.navy,
  },
});
