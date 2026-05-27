import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../../constants';
import { useTranslation } from '../../i18n';

export function PrivacyNoteCard() {
  const { t } = useTranslation();
  return (
    <View style={styles.card}>
      <Ionicons name="information-circle-outline" size={14} color={colors.gray400} style={{ marginTop: 2 }} />
      <View style={styles.content}>
        <Text style={styles.text}>{t('privacyNote')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.gray200,
    backgroundColor: colors.gray50,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  content: {
    flex: 1,
    gap: 2,
  },
  text: {
    fontSize: fontSize.sm,
    color: colors.gray500,
  },
});
