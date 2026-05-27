import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, fontSize, spacing, borderRadius } from '../constants';
import { PrimaryButton, SecondaryButton, StatusChip } from '../components/fieldos';
import { useTranslation } from '../i18n';

/**
 * Face / Identity Verification Screen
 *
 * UI mock flow only — no real biometric integration.
 * Progresses through states automatically via setTimeout:
 *   idle → looking → detected → verifying → verified
 *
 * After verified state the user taps "Continue" to reach /(tabs).
 * "Use Security PIN Instead" navigates back at any time.
 */

type VerificationStep = 'idle' | 'looking' | 'detected' | 'verifying' | 'verified';

const STEP_CONFIG_KEYS: Record<
  VerificationStep,
  { tKey: string; chipVariant: 'info' | 'success' | 'warning' }
> = {
  idle: { tKey: 'faceVerificationInit', chipVariant: 'info' },
  looking: { tKey: 'faceVerificationLooking', chipVariant: 'info' },
  detected: { tKey: 'faceVerificationDetected', chipVariant: 'info' },
  verifying: { tKey: 'faceVerificationVerifying', chipVariant: 'warning' },
  verified: { tKey: 'faceVerificationVerified', chipVariant: 'success' },
};

const STEP_TIMINGS: Record<string, number> = {
  looking: 1200,
  detected: 2200,
  verifying: 3200,
  verified: 4000,
};

export default function VerifyIdentityScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [step, setStep] = useState<VerificationStep>('idle');
  const [isActive, setIsActive] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // ---- Cleanup on unmount ----
  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearTimeout);
    };
  }, []);

  // ---- Start verification progression ----
  const startVerification = useCallback(() => {
    if (isActive) return;
    setIsActive(true);
    setStep('looking');

    const steps: VerificationStep[] = ['detected', 'verifying', 'verified'];
    steps.forEach((s) => {
      const timer = setTimeout(() => setStep(s), STEP_TIMINGS[s]);
      timersRef.current.push(timer);
    });
  }, [isActive]);

  // ---- Navigation handlers ----
  const handleContinue = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    router.replace('/(tabs)');
  }, [router]);

  const handleUsePin = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    router.back();
  }, [router]);

  // ---- Derive visual state from step ----
  const stepConfig = STEP_CONFIG_KEYS[step];
  const statusLabel = t(stepConfig.tKey as any);

  const borderColor =
    step === 'verified'
      ? colors.green
      : step === 'verifying'
        ? colors.navyLight
        : step === 'detected'
          ? colors.orange
          : colors.gray300;

  const innerBg =
    step === 'verified'
      ? `${colors.green}20`
      : step === 'verifying'
        ? `${colors.navy}10`
        : step === 'detected'
          ? `${colors.orange}15`
          : colors.gray100;

  const innerIcon =
    step === 'verified' ? (
      <Ionicons name="checkmark-circle" size={52} color={colors.green} />
    ) : step === 'verifying' ? (
      <Ionicons name="sync" size={40} color={colors.navyLight} />
    ) : step === 'detected' ? (
      <Ionicons name="scan-outline" size={40} color={colors.orange} />
    ) : (
      <Ionicons name="camera-outline" size={40} color={colors.gray400} />
    );

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ---- Header ---- */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={handleUsePin}
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={20} color={colors.gray600} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('faceVerificationTitle')}</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* ---- Camera Frame ---- */}
        <View style={styles.cameraFrame}>
          <View style={[styles.outerCircle, { borderColor }]}>
            <View style={[styles.innerCircle, { backgroundColor: innerBg }]}>
              {innerIcon}
            </View>
          </View>
          {/* Scanning corners (decorative) */}
          {step !== 'idle' && step !== 'verified' && (
            <>
              <View style={[styles.corner, styles.cornerTopLeft]} />
              <View style={[styles.corner, styles.cornerTopRight]} />
              <View style={[styles.corner, styles.cornerBottomLeft]} />
              <View style={[styles.corner, styles.cornerBottomRight]} />
            </>
          )}
        </View>

        {/* ---- Title & subtitle ---- */}
        <Text style={styles.mainTitle}>{t('faceVerificationTitle')}</Text>
        <Text style={styles.subtitle}>{t('faceVerificationSubtitle')}</Text>

        {/* ---- Status chip ---- */}
        <View style={styles.chipContainer}>
          <StatusChip label={statusLabel} variant={stepConfig.chipVariant} />
        </View>

        {/* ---- Progress dots ---- */}
        <View style={styles.progressContainer}>
          {(['looking', 'detected', 'verifying', 'verified'] as const).map(
            (s, idx) => {
              const stepOrder = ['idle', 'looking', 'detected', 'verifying', 'verified'];
              const isCompleted = stepOrder.indexOf(step) > stepOrder.indexOf(s);
              const isCurrent = step === s;

              return (
                <React.Fragment key={s}>
                  <View
                    style={[
                      styles.progressDot,
                      isCompleted && styles.progressDotCompleted,
                      isCurrent && styles.progressDotActive,
                    ]}
                  >
                    {isCompleted ? (
                      <Ionicons name="checkmark" size={10} color={colors.white} />
                    ) : isCurrent ? (
                      <View style={styles.progressDotPulse} />
                    ) : null}
                  </View>
                  {idx < 3 && (
                    <View
                      style={[
                        styles.progressLine,
                        isCompleted && styles.progressLineCompleted,
                      ]}
                    />
                  )}
                </React.Fragment>
              );
            },
          )}
        </View>

        {/* ---- Privacy Note Card ---- */}
        <View style={styles.privacyNote}>
          <Ionicons name="information-circle-outline" size={14} color={colors.gray400} style={styles.privacyIcon} />
          <View style={styles.privacyContent}>
            <Text style={styles.privacyText}>
              {t('faceVerificationPrivacy1')}
            </Text>
            <Text style={styles.privacyText}>
              {t('faceVerificationPrivacy2')}
            </Text>
          </View>
        </View>

        {/* ---- Action Buttons ---- */}
        {step === 'verified' ? (
          <PrimaryButton onPress={handleContinue} icon="checkmark-circle">
            {t('faceVerificationContinue')}
          </PrimaryButton>
        ) : (
          <>
            <PrimaryButton
              onPress={startVerification}
              icon="camera"
              disabled={isActive}
              style={isActive && styles.buttonDisabled}
            >
              {t('faceVerificationVerifyNow')}
            </PrimaryButton>
            <SecondaryButton onPress={handleUsePin} icon="lock-closed">
              {t('faceVerificationUsePin')}
            </SecondaryButton>
          </>
        )}

        {/* ---- Footer spacer ---- */}
        <View style={styles.footerSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.white,
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    alignItems: 'center',
  },

  /* ---- Header ---- */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: spacing.xl,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.gray800,
  },
  headerSpacer: {
    width: 36,
  },

  /* ---- Camera Frame ---- */
  cameraFrame: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xxl,
  },
  outerCircle: {
    width: 200,
    height: 200,
    borderRadius: 9999,
    borderWidth: 4,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerCircle: {
    width: 152,
    height: 152,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ---- Scanning corners ---- */
  corner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: colors.navy,
  },
  cornerTopLeft: {
    top: -2,
    left: -2,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 12,
  },
  cornerTopRight: {
    top: -2,
    right: -2,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 12,
  },
  cornerBottomLeft: {
    bottom: -2,
    left: -2,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 12,
  },
  cornerBottomRight: {
    bottom: -2,
    right: -2,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 12,
  },

  /* ---- Title ---- */
  mainTitle: {
    fontSize: fontSize['3xl'],
    fontWeight: 'bold',
    color: colors.gray800,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.gray500,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },

  /* ---- Status chip ---- */
  chipContainer: {
    marginBottom: spacing.xl,
  },

  /* ---- Progress dots ---- */
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  progressDot: {
    width: 28,
    height: 28,
    borderRadius: 9999,
    backgroundColor: colors.gray200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressDotCompleted: {
    backgroundColor: colors.green,
  },
  progressDotActive: {
    backgroundColor: colors.navy,
  },
  progressDotPulse: {
    width: 8,
    height: 8,
    borderRadius: 9999,
    backgroundColor: colors.white,
  },
  progressLine: {
    width: 20,
    height: 2,
    backgroundColor: colors.gray200,
    marginHorizontal: 4,
  },
  progressLineCompleted: {
    backgroundColor: colors.green,
  },

  /* ---- Privacy Note ---- */
  privacyNote: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.gray50,
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: borderRadius.sm,
    padding: spacing.md,
    width: '100%',
    marginBottom: spacing.xl,
  },
  privacyIcon: {
    marginTop: 2,
  },
  privacyContent: {
    flex: 1,
    gap: 4,
  },
  privacyText: {
    fontSize: fontSize.sm,
    color: colors.gray500,
    lineHeight: fontSize.sm + 6,
  },

  /* ---- Buttons ---- */
  buttonDisabled: {
    opacity: 0.5,
  },

  /* ---- Footer ---- */
  footerSpacer: {
    height: spacing.lg,
  },
});
