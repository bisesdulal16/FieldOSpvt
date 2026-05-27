import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../../constants';
import { useTranslation } from '../../i18n';

export function SecurityTrustCard() {
  const { t } = useTranslation();
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Ionicons name="shield-checkmark" size={18} color={colors.green} style={{ marginTop: 2 }} />
        <View style={styles.content}>
          <Text style={styles.title}>{t('securityTrustTitle')}</Text>
          <Text style={styles.text}>{t('securityTrustDesc')}</Text>
          <Text style={styles.text}>{t('offlineRecordsEncrypted')}</Text>
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
    borderColor: colors.greenBorder,
    backgroundColor: colors.greenLight,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  content: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: fontSize.base,
    fontWeight: '600',
    color: '#065F46',
  },
  text: {
    fontSize: fontSize.sm,
    color: '#047857',
  },
});
