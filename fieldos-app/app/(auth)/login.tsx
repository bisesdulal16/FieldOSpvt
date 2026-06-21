import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../../constants';
import { useFieldOSStore } from '../../store/useFieldOSStore';
import { SecurityTrustCard } from '../../components/fieldos/SecurityTrustCard';
import { auditLogin } from '../../services/auditService';
import { PrimaryButton } from '../../components/fieldos/PrimaryButton';
import { SecondaryButton } from '../../components/fieldos/SecondaryButton';
import { initSecureStorage } from '../../services/secureStorage';
import { biometricLogin, isBiometricAvailable } from '../../services/biometricAuth';
import { loginWithPin, loginWithBiometric, initAuth } from '../../services/authService';
import { setSetting } from '../../db/repositories/settingsRepo';
import { useTranslation } from '../../i18n';

export default function LoginScreen() {
  const router = useRouter();
  const { showPassword, togglePassword, language, resetDay } = useFieldOSStore();
  const { t } = useTranslation();

  const [staffId, setStaffId] = useState('');
  const [pin, setPin] = useState('');
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioType, setBioType] = useState<string>('');
  const [bioLoading, setBioLoading] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);

  useEffect(() => {
    (async () => {
      await initAuth(); // Load tokens from secure storage
      const bio = await isBiometricAvailable();
      setBioAvailable(bio.available);
      setBioType(bio.biometricType || '');
      await initSecureStorage();
    })();
  }, []);

  const handlePinLogin = async () => {
    setLoginLoading(true);
    resetDay();
    try { await setSetting('day_started', 'false', 'boolean'); } catch {}

    // Use authService — mock in dev, real API in production
    const result = await loginWithPin({
      staff_id: staffId,
      pin,
    });

    setLoginLoading(false);

    if (result.success) {
      auditLogin('pin').catch(() => {});
      router.replace('/(tabs)');
    } else {
      Alert.alert(t('authFailed'), result.message || t('tryAgain'));
    }
  };

  const handleBiometricLogin = async () => {
    setBioLoading(true);
    const result = await biometricLogin();
    setBioLoading(false);

    if (result.success) {
      // Use authService biometric login
      const authResult = await loginWithBiometric({
        deviceId: 'fieldos_device',
        deviceModel: 'Expo Device',
      });

      if (authResult.success) {
        auditLogin('biometric').catch(() => {});
        router.replace('/(tabs)');
      }
    } else {
      Alert.alert(t('authFailed'), result.error || t('tryAgain'));
    }
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.topSection}>
        <View style={styles.logoContainer}>
          <View style={styles.logoBox}>
            <Ionicons name="business" size={28} color={colors.white} />
          </View>
          <Text style={styles.appTitle}>FieldOS</Text>
          <Text style={styles.appSubTitle}>NEPAL</Text>
        </View>
        <Text style={styles.institutionName}>
          {t('institutionName')}
        </Text>
        <View style={styles.langToggle}>
          <TouchableOpacity onPress={() => useFieldOSStore.getState().toggleLanguage()}
            style={[styles.langButton, language === 'en' && styles.langButtonActive]}
          >
            <Text style={[styles.langButtonText, language === 'en' && styles.langButtonTextActive]}>
              English
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => useFieldOSStore.getState().toggleLanguage()}
            style={[styles.langButton, language === 'ne' && styles.langButtonActive]}
          >
            <Text style={[styles.langButtonText, language === 'ne' && styles.langButtonTextActive]}>
              नेपाली
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.formSection}>
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>
            {t('staffLogin')}
          </Text>

          <Text style={styles.label}>
            {t('usernameStaffId')}
          </Text>
          <View style={styles.inputContainer}>
            <Ionicons name="lock-closed" size={16} color={colors.gray400} />
            <TextInput
              style={styles.inputField}
              value={staffId}
              onChangeText={setStaffId}
              placeholder={t('enterStaffId')}
              placeholderTextColor={colors.gray400}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <Text style={[styles.label, { marginTop: spacing.md }]}>
            {t('passwordPin')}
          </Text>
          <View style={styles.inputContainer}>
            <Ionicons name="lock-closed" size={16} color={colors.gray400} />
            <TextInput
              style={[styles.inputField, { flex: 1 }]}
              value={pin}
              onChangeText={setPin}
              placeholder="••••••"
              placeholderTextColor={colors.gray400}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity onPress={togglePassword}>
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={16}
                color={colors.gray400}
              />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.forgotPin} onPress={() => alert('Contact your branch administrator to reset your PIN.')}>
            <Text style={styles.forgotPinText}>
              {t('forgotPin')}
            </Text>
          </TouchableOpacity>

          <PrimaryButton onPress={handlePinLogin} loading={loginLoading} style={{ marginTop: spacing.md }}>
            {t('loginBtn')}
          </PrimaryButton>

          {bioAvailable ? (
            <SecondaryButton
              onPress={handleBiometricLogin}
              icon="finger-print"
              loading={bioLoading}
              style={{ marginTop: spacing.sm }}
            >
              {t('biometricLogin')}
            </SecondaryButton>
          ) : (
            <View style={styles.bioUnavailableRow}>
              <Ionicons name="finger-print-outline" size={14} color={colors.gray400} />
              <Text style={styles.bioUnavailableText}>
                {t('biometricNotAvailable')}
              </Text>
            </View>
          )}
        </View>

        <View style={{ marginTop: spacing.md }}>
          <SecurityTrustCard />
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>FieldOS Nepal v3.0.0</Text>
        <Text style={styles.footerText}>
          {t('authorizedOnly')}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  topSection: {
    paddingTop: spacing.xxl * 2,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    backgroundColor: colors.navyBg,
  },
  logoContainer: { alignItems: 'center', marginBottom: spacing.md },
  logoBox: {
    width: 56, height: 56, borderRadius: borderRadius.xl, backgroundColor: colors.navy,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm,
    shadowColor: colors.navy, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  appTitle: { fontSize: fontSize['4xl'], fontWeight: 'bold', color: colors.navy },
  appSubTitle: { fontSize: fontSize.md, fontWeight: 'bold', color: colors.orange },
  institutionName: { fontSize: fontSize.md, color: colors.gray500, marginBottom: spacing.xs },
  langToggle: {
    flexDirection: 'row', borderRadius: 9999, borderWidth: 1, borderColor: colors.gray200,
    padding: 2, marginTop: spacing.sm,
  },
  langButton: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: 9999 },
  langButtonActive: { backgroundColor: colors.navy },
  langButtonText: { fontSize: fontSize.lg, fontWeight: '700', color: colors.gray500 },
  langButtonTextActive: { color: colors.white },
  formSection: { flex: 1, paddingHorizontal: spacing.xl },
  formCard: {
    backgroundColor: colors.white, borderRadius: borderRadius.xl, padding: spacing.xl,
    borderWidth: 1, borderColor: colors.gray100,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  formTitle: { fontSize: fontSize.lg, fontWeight: 'bold', color: colors.gray800, textAlign: 'center', marginBottom: spacing.lg },
  label: { fontSize: fontSize.sm, fontWeight: '600', color: colors.gray500, marginBottom: spacing.xs },
  inputContainer: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
    borderWidth: 1, borderColor: colors.gray200, backgroundColor: colors.gray50,
  },
  inputField: { fontSize: fontSize.md, color: colors.gray800, flex: 1, padding: 0, height: 24 },
  inputPlaceholder: { fontSize: fontSize.md, color: colors.gray400 },
  forgotPin: { alignSelf: 'flex-end', marginTop: spacing.sm },
  forgotPinText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.navy },
  bioUnavailableRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, marginTop: spacing.sm, paddingVertical: spacing.sm,
  },
  bioUnavailableText: { fontSize: fontSize.sm, color: colors.gray400 },
  footer: { alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  footerText: { fontSize: fontSize.xs, color: colors.gray400 },
});
