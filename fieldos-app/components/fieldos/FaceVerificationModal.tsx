import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fontSize, spacing, borderRadius } from '../../constants';
import { useFieldOSStore } from '../../store/useFieldOSStore';
import { useTranslation } from '../../i18n';
import { StatusChip } from './StatusChip';
import { PrimaryButton } from './PrimaryButton';
import { SecondaryButton } from './SecondaryButton';

export function FaceVerificationModal() {
  const {
    showFaceVerification,
    faceVerificationStatus,
    faceVerificationContext,
    completeFaceVerification,
    closeFaceVerification,
    setFaceVerificationStatus,
  } = useFieldOSStore();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  if (!showFaceVerification) return null;

  const contextText: Record<string, string> = {
    'start-day': 'Required for Start Day',
    'submit-report': 'Required for Report Submission',
    'high-value-collection': 'Required for High-Value Collection',
  };

  const statusText: Record<string, string> = {
    idle: 'Initializing camera...',
    looking: t('faceVerificationLooking'),
    detected: t('faceVerificationDetected'),
    verifying: t('faceVerificationVerifying'),
    verified: t('faceVerificationVerified'),
    failed: t('faceVerificationFailed'),
  };

  const handleTryAgain = () => {
    setFaceVerificationStatus('looking');
    setTimeout(() => setFaceVerificationStatus('detected'), 1500);
    setTimeout(() => setFaceVerificationStatus('verifying'), 2500);
    setTimeout(() => setFaceVerificationStatus('verified'), 4000);
  };

  const borderColor =
    faceVerificationStatus === 'verified'
      ? colors.green
      : faceVerificationStatus === 'failed'
        ? colors.red
        : faceVerificationStatus === 'verifying'
          ? colors.navyLight
          : colors.gray300;

  const innerBg =
    faceVerificationStatus === 'verified'
      ? `${colors.green}20`
      : faceVerificationStatus === 'failed'
        ? `${colors.red}20`
        : faceVerificationStatus === 'verifying'
          ? `${colors.navy}10`
          : colors.gray100;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={closeFaceVerification} style={styles.closeButton}>
          <Ionicons name="close" size={20} color={colors.gray600} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Verify Identity</Text>
        <View style={{ width: 28 }} />
      </View>

      <View style={styles.body}>
        <View style={styles.cameraFrame}>
          <View style={[styles.outerCircle, { borderColor }]}>
            <View style={[styles.innerCircle, { backgroundColor: innerBg }]}>
              {faceVerificationStatus === 'verified' ? (
                <Ionicons name="checkmark-circle" size={48} color={colors.green} />
              ) : faceVerificationStatus === 'failed' ? (
                <Ionicons name="warning" size={48} color={colors.red} />
              ) : (
                <Ionicons
                  name="camera-outline"
                  size={36}
                  color={faceVerificationStatus === 'verifying' ? colors.navyLight : colors.gray300}
                />
              )}
            </View>
          </View>
          {faceVerificationStatus === 'verifying' && (
            <Ionicons name="sync" size={16} color={colors.navy} style={styles.spinnerIcon} />
          )}
        </View>

        <Text style={styles.mainTitle}>{t('faceVerificationTitle')}</Text>
        <Text style={styles.subtitle}>Please look at the camera to continue</Text>
        <Text style={styles.contextText}>{contextText[faceVerificationContext || 'start-day']}</Text>

        <View style={styles.chipContainer}>
          <StatusChip
            label={statusText[faceVerificationStatus]}
            variant={
              faceVerificationStatus === 'verified'
                ? 'success'
                : faceVerificationStatus === 'failed'
                  ? 'warning'
                  : 'info'
            }
          />
        </View>

        <View style={styles.privacyNote}>
          <Ionicons name="information-circle-outline" size={12} color={colors.gray400} />
          <View style={styles.privacyContent}>
            <Text style={styles.privacyText}>
              Face verification is used only for identity confirmation.
            </Text>
            <Text style={styles.privacyText}>
              Full-day camera monitoring is not used.
            </Text>
          </View>
        </View>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.xl }]}>
        {faceVerificationStatus === 'verified' ? (
          <PrimaryButton onPress={completeFaceVerification} icon="checkmark-circle">
            Continue
          </PrimaryButton>
        ) : faceVerificationStatus === 'failed' ? (
          <>
            <PrimaryButton onPress={handleTryAgain} icon="refresh">
              Try Again
            </PrimaryButton>
            <SecondaryButton onPress={closeFaceVerification} icon="lock-closed">
              Use Security PIN Instead
            </SecondaryButton>
          </>
        ) : (
          <>
            <PrimaryButton onPress={() => setFaceVerificationStatus('verifying')} icon="camera">
              Verify Now
            </PrimaryButton>
            <SecondaryButton onPress={closeFaceVerification} icon="lock-closed">
              Use Security PIN Instead
            </SecondaryButton>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
    backgroundColor: colors.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray100,
  },
  closeButton: {
    padding: spacing.xs,
    borderRadius: 8,
  },
  headerTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.gray800,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  cameraFrame: {
    position: 'relative',
    marginBottom: spacing.xl,
  },
  outerCircle: {
    width: 208,
    height: 208,
    borderRadius: 9999,
    borderWidth: 4,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerCircle: {
    width: 160,
    height: 160,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinnerIcon: {
    position: 'absolute',
    bottom: -8,
    left: '50%',
    marginLeft: -8,
  },
  mainTitle: {
    fontSize: fontSize['4xl'],
    fontWeight: 'bold',
    color: colors.gray800,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.gray500,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  contextText: {
    fontSize: fontSize.base,
    fontWeight: '500',
    color: colors.navy,
    marginBottom: spacing.lg,
  },
  chipContainer: {
    marginBottom: spacing.xl,
  },
  privacyNote: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.gray50,
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    maxWidth: 280,
  },
  privacyContent: {
    flex: 1,
    gap: 2,
  },
  privacyText: {
    fontSize: fontSize.xs,
    color: colors.gray500,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
});
