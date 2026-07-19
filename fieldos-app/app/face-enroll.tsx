import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../constants';
import { AppHeader } from '../components/fieldos/AppHeader';
import { PrimaryButton } from '../components/fieldos/PrimaryButton';
import { useTranslation } from '../i18n';
import { FaceScanner, type FaceUnavailableReason } from '../components/fieldos/FaceScanner';
import { enrollFace } from '../services/faceVerifyService';

/**
 * Onboarding: enroll the officer's reference face for attendance clock-in.
 * Falls back gracefully when the device can't run the on-device model.
 */
export default function FaceEnrollScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleEmbedding = async (embedding: number[]) => {
    setScanning(false);
    setSaving(true);
    const res = await enrollFace(embedding);
    setSaving(false);
    if (res.success) {
      Alert.alert(t('faceEnrollDoneTitle'), t('faceEnrollDoneMsg'), [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } else {
      // Offline enroll still cached locally; tell the officer it will re-sync.
      Alert.alert(t('faceEnrollSavedTitle'), res.error || t('faceEnrollDoneMsg'), [
        { text: 'OK', onPress: () => router.back() },
      ]);
    }
  };

  const handleUnavailable = (reason?: FaceUnavailableReason) => {
    setScanning(false);
    // Append the cause: 'unavailable' alone gave the pilot no way to tell a missing
    // native module apart from an unreachable face model.
    const detail =
      reason === 'model'
        ? ' (face model could not be loaded — check the model URL is reachable)'
        : reason === 'native'
          ? ' (camera/face modules not available in this build)'
          : '';
    Alert.alert(t('faceUnavailableTitle'), t('faceUnavailableMsg') + detail);
  };

  if (scanning) {
    return (
      <FaceScanner
        mode="enroll"
        onEmbedding={handleEmbedding}
        onUnavailable={handleUnavailable}
        onCancel={() => setScanning(false)}
      />
    );
  }

  return (
    <View style={styles.container}>
      <AppHeader title={t('faceEnrollTitle')} showBack />
      <View style={styles.body}>
        {saving ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.navy} />
            <Text style={styles.savingText}>{t('faceEnrollSaving')}</Text>
          </View>
        ) : (
          <>
            <View style={styles.iconCircle}>
              <Ionicons name="scan-outline" size={48} color={colors.navy} />
            </View>
            <Text style={styles.heading}>{t('faceEnrollHeading')}</Text>
            <Text style={styles.desc}>{t('faceEnrollDesc')}</Text>

            <View style={styles.noticeBox}>
              <Ionicons name="information-circle-outline" size={16} color={colors.navy} />
              <Text style={styles.noticeText}>{t('faceEnrollNotice')}</Text>
            </View>

            <PrimaryButton label={t('faceEnrollStart')} onPress={() => setScanning(true)} />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.xl, gap: spacing.md },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md },
  savingText: { fontSize: fontSize.base, color: colors.gray600 },
  iconCircle: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: colors.navyBg,
    justifyContent: 'center', alignItems: 'center', alignSelf: 'center', marginBottom: spacing.md,
  },
  heading: { fontSize: fontSize.xl, fontWeight: '700', color: colors.gray800, textAlign: 'center' },
  desc: { fontSize: fontSize.base, color: colors.gray500, textAlign: 'center', lineHeight: 20 },
  noticeBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: `${colors.navy}08`, borderRadius: borderRadius.lg,
    borderWidth: 1, borderColor: `${colors.navy}15`, padding: spacing.md, marginVertical: spacing.md,
  },
  noticeText: { flex: 1, fontSize: fontSize.sm, color: colors.navy, lineHeight: 18 },
});
