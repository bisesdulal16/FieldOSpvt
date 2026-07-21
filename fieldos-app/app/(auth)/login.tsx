import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, Image } from 'react-native';
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
import { loginWithPin, loginWithBiometric, initAuth, getCurrentUser, setResumePin, verifyResumePin, hasResumePin, offlineLogin, setOfflineLogin, isSignedOut, clearSignedOut } from '../../services/authService';
import { getAccessToken } from '../../services/apiClient';
import { setSetting, getSetting } from '../../db/repositories/settingsRepo';
import { fetchBranding, DEFAULT_BRANDING, type Branding } from '../../services/brandingService';
import { useTranslation } from '../../i18n';

export default function LoginScreen() {
  const router = useRouter();
  const { showPassword, togglePassword, language, restoreDayForOfficer } = useFieldOSStore();
  const { t } = useTranslation();

  // Backend returns snake_case (staff_id); the mock/types use camelCase (staffId).
  const staffIdOf = (user: any): string | undefined => user?.staffId || user?.staff_id;
  // JWT lasts 24h; keep a margin so an expired session forces an online re-login.
  const SESSION_RESUME_MS = 20 * 60 * 60 * 1000;

  const [staffId, setStaffId] = useState('');
  const [pin, setPin] = useState('');
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioType, setBioType] = useState<string>('');
  const [bioLoading, setBioLoading] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  // Offline resume lock: a valid session exists, but confirm identity with the PIN.
  const [resumeUser, setResumeUser] = useState<{ staffId: string; name?: string } | null>(null);
  const [resumePinInput, setResumePinInput] = useState('');
  const [resumeError, setResumeError] = useState('');
  const [resumeLoading, setResumeLoading] = useState(false);

  useEffect(() => {
    (async () => {
      await initAuth(); // Load tokens from secure storage
      await initSecureStorage();
      // Offline-friendly session resume: an officer who logged in at the branch in the
      // morning keeps a valid 24h token, so reopening the app offline should NOT force a
      // network login. If a recent session + cached profile exist, go straight to the app.
      try {
        // After an explicit logout, always show the login screen (no silent resume).
        if (await isSignedOut()) throw new Error('signed-out');
        const token = getAccessToken();
        const lastLoginAt = await getSetting('last_login_at');
        const fresh = !!lastLoginAt && (Date.now() - Number(lastLoginAt)) < SESSION_RESUME_MS;
        if (token && fresh) {
          const user = await getCurrentUser();
          const sid = staffIdOf(user);
          if (sid) {
            // If a resume PIN was set, confirm identity before entering (offline-safe).
            if (await hasResumePin()) {
              setResumeUser({ staffId: sid, name: (user as any)?.name });
              return; // render the PIN lock instead of the login form
            }
            await restoreDayForOfficer(sid);
            router.replace('/(tabs)');
            return;
          }
        }
      } catch { /* fall through to the login form */ }
      const bio = await isBiometricAvailable();
      setBioAvailable(bio.available);
      setBioType(bio.biometricType || '');
      setBranding(await fetchBranding());
    })();
  }, []);

  const handlePinLogin = async () => {
    setLoginLoading(true);

    // Use authService — mock in dev, real API in production
    const result = await loginWithPin({
      staff_id: staffId,
      pin,
    });

    if (result.success) {
      setLoginLoading(false);
      auditLogin('pin').catch(() => {});
      // Remember this login for offline resume + offline re-login, then restore THIS
      // officer's day-start (do NOT wipe it — one start-day per officer per day).
      try { await setSetting('last_login_at', String(Date.now()), 'string'); } catch {}
      const sid = staffIdOf(result.data?.user) || staffId;
      await setResumePin(sid, pin);
      await setOfflineLogin(sid, pin);   // enables offline re-login after a logout
      await clearSignedOut();
      await restoreDayForOfficer(sid);
      router.replace('/(tabs)');
      return;
    }

    // Online login failed — if we're offline, try a local PIN login against the
    // cached credential (an officer who signed out in the field, no signal).
    const offline = await offlineLogin(staffId, pin);
    setLoginLoading(false);
    if (offline.ok) {
      auditLogin('pin').catch(() => {});
      await setResumePin(staffId, pin);
      await restoreDayForOfficer(staffIdOf(offline.user) || staffId);
      router.replace('/(tabs)');
    } else {
      Alert.alert(t('authFailed'), result.message || t('tryAgain'));
    }
  };

  const handleResumeUnlock = async () => {
    setResumeError('');
    setResumeLoading(true);
    const ok = await verifyResumePin(resumePinInput);
    setResumeLoading(false);
    if (ok && resumeUser) {
      auditLogin('pin').catch(() => {});
      await restoreDayForOfficer(resumeUser.staffId);
      router.replace('/(tabs)');
    } else {
      setResumeError(t('incorrectPin'));
      setResumePinInput('');
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
        try { await setSetting('last_login_at', String(Date.now()), 'string'); } catch {}
        await restoreDayForOfficer(staffIdOf(authResult.data?.user) || '');
        router.replace('/(tabs)');
      }
    } else {
      Alert.alert(t('authFailed'), result.error || t('tryAgain'));
    }
  };

  // Offline resume lock — a valid session exists; confirm the officer's PIN before entering.
  if (resumeUser) {
    return (
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.topSection}>
          <View style={styles.logoContainer}>
            {branding.logoUrl ? (
              <Image source={{ uri: branding.logoUrl }} style={styles.logoImage} resizeMode="contain" />
            ) : (
              <View style={styles.logoBox}>
                <Ionicons name="lock-closed" size={28} color={colors.white} />
              </View>
            )}
            <Text style={styles.appTitle}>{t('welcomeBack')}</Text>
            {!!resumeUser.name && <Text style={styles.appSubTitle}>{resumeUser.name.toUpperCase()}</Text>}
          </View>
        </View>

        <View style={styles.formSection}>
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>{t('confirmYourPin')}</Text>
            <View style={styles.inputContainer}>
              <Ionicons name="lock-closed" size={16} color={colors.gray400} />
              <TextInput
                style={[styles.inputField, { flex: 1 }]}
                value={resumePinInput}
                onChangeText={(v) => { setResumePinInput(v); setResumeError(''); }}
                placeholder="••••••"
                placeholderTextColor={colors.gray400}
                secureTextEntry
                keyboardType="number-pad"
                autoFocus
                onSubmitEditing={handleResumeUnlock}
              />
            </View>
            {!!resumeError && <Text style={styles.errorText}>{resumeError}</Text>}

            <PrimaryButton onPress={handleResumeUnlock} loading={resumeLoading} style={{ marginTop: spacing.md }}>
              {t('unlock')}
            </PrimaryButton>

            <TouchableOpacity
              style={styles.switchAccount}
              onPress={() => { setResumeUser(null); setResumePinInput(''); setResumeError(''); }}
            >
              <Text style={styles.switchAccountText}>{t('loginAsSomeoneElse')}</Text>
            </TouchableOpacity>
          </View>
          <View style={{ marginTop: spacing.md }}>
            <SecurityTrustCard />
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.topSection}>
        <View style={styles.logoContainer}>
          {branding.logoUrl ? (
            <Image source={{ uri: branding.logoUrl }} style={styles.logoImage} resizeMode="contain" />
          ) : (
            <View style={styles.logoBox}>
              <Ionicons name="business" size={28} color={colors.white} />
            </View>
          )}
          <Text style={styles.appTitle}>{branding.orgName}</Text>
          {!!branding.tagline && <Text style={styles.appSubTitle}>{branding.tagline.toUpperCase()}</Text>}
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
  logoImage: { width: 56, height: 56, borderRadius: borderRadius.xl, marginBottom: spacing.sm },
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
  errorText: { fontSize: fontSize.sm, color: colors.red, marginTop: spacing.sm },
  switchAccount: { alignSelf: 'center', marginTop: spacing.md, paddingVertical: spacing.sm },
  switchAccountText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.navy },
  bioUnavailableRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, marginTop: spacing.sm, paddingVertical: spacing.sm,
  },
  bioUnavailableText: { fontSize: fontSize.sm, color: colors.gray400 },
  footer: { alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  footerText: { fontSize: fontSize.xs, color: colors.gray400 },
});
