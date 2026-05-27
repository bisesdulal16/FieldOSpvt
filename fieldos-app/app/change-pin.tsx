import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../constants';
import { AppHeader } from '../components/fieldos/AppHeader';
import { PrimaryButton } from '../components/fieldos/PrimaryButton';
import { StatusChip } from '../components/fieldos/StatusChip';
import { useTranslation } from '../i18n';
import { auditPinChanged } from '../services/auditService';
import { setSetting } from '../db/repositories/settingsRepo';

// ─── PIN Strength Calculator ───────────────────────────────────

type PinStrength = 'weak' | 'medium' | 'strong';

function calculatePinStrength(pin: string): PinStrength {
  if (pin.length < 4) return 'weak';
  const uniqueDigits = new Set(pin.split('')).size;
  if (pin.length >= 6 && uniqueDigits >= 4) return 'strong';
  if (pin.length >= 5 && uniqueDigits >= 3) return 'medium';
  if (uniqueDigits >= 2) return 'medium';
  return 'weak';
}

function getStrengthColor(strength: PinStrength): string {
  switch (strength) {
    case 'strong': return colors.green;
    case 'medium': return colors.orange;
    case 'weak': return colors.red;
  }
}

function getStrengthVariant(strength: PinStrength): 'verified' | 'warning' | 'overdue' {
  switch (strength) {
    case 'strong': return 'verified';
    case 'medium': return 'warning';
    case 'weak': return 'overdue';
  }
}

// ─── PIN Input Field ───────────────────────────────────────────

function PinInputField({
  label, icon, value, onChangeText, showPassword, toggleShow,
}: {
  label: string; icon: string; value: string; onChangeText: (text: string) => void;
  showPassword: boolean; toggleShow: () => void;
}) {
  return (
    <View style={pinInputStyles.wrap}>
      <Text style={pinInputStyles.label}>{label}</Text>
      <View style={pinInputStyles.inputRow}>
        <Ionicons name={icon as any} size={18} color={colors.gray400} />
        <TextInput
          style={pinInputStyles.input}
          value={value}
          onChangeText={onChangeText}
          keyboardType="numeric"
          maxLength={6}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="••••"
          placeholderTextColor={colors.gray300}
        />
        <TouchableOpacity onPress={toggleShow} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons
            name={showPassword ? 'eye-off-outline' : 'eye-outline'}
            size={18}
            color={colors.gray400}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const pinInputStyles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { fontSize: fontSize.md, fontWeight: '600', color: colors.gray600 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.white, borderRadius: borderRadius.lg,
    borderWidth: 1, borderColor: colors.gray200, paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  input: { flex: 1, fontSize: fontSize.xl, fontWeight: '600', color: colors.gray800, padding: 0, height: 44 },
});

// ─── Main Screen ───────────────────────────────────────────────

// Mock current PIN for validation (in production, this would come from SecureStorage)
const MOCK_CURRENT_PIN = '1234';

export default function ChangePinScreen() {
  const router = useRouter();
  const { t } = useTranslation();

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Derive validation states
  const isCurrentValid = currentPin.length >= 4 && currentPin.length <= 6;
  const isNewValid = newPin.length >= 4 && newPin.length <= 6;
  const isConfirmValid = confirmPin.length >= 4 && confirmPin.length <= 6;
  const pinsMatch = newPin === confirmPin && newPin.length > 0;
  const isDifferentFromCurrent = newPin !== currentPin && newPin.length > 0;

  const canSubmit = isCurrentValid && isNewValid && isConfirmValid && pinsMatch && isDifferentFromCurrent && !loading;

  const strength: PinStrength = newPin.length >= 4 ? calculatePinStrength(newPin) : 'weak';
  const strengthColor = getStrengthColor(strength);
  const strengthVariant = getStrengthVariant(strength);

  const strengthLabel = (() => {
    if (newPin.length < 4) return '';
    if (strength === 'strong') return t('pinStrengthStrong');
    if (strength === 'medium') return t('pinStrengthMedium');
    return t('pinStrengthWeak');
  })();

  const handleError = (msg: string) => {
    setError(msg);
    setSuccess(false);
  };

  const handleSubmit = async () => {
    setError('');
    setSuccess(false);

    // Validate current PIN
    if (currentPin !== MOCK_CURRENT_PIN) {
      handleError(t('currentPinIncorrect'));
      return;
    }

    // Validate new PIN is different
    if (newPin === currentPin) {
      handleError(t('pinMustBeDifferent'));
      return;
    }

    // Validate PIN length
    if (newPin.length < 4 || newPin.length > 6) {
      handleError(t('pinLengthError'));
      return;
    }

    // Validate PIN match
    if (newPin !== confirmPin) {
      handleError(t('pinsDoNotMatch'));
      return;
    }

    setLoading(true);
    try {
      // Persist new PIN to settings (in production: SecureStorage)
      await setSetting('user_pin_hash', btoa(newPin), 'string');
      // Audit the change
      await auditPinChanged();

      setSuccess(true);
      setError('');
      setTimeout(() => {
        router.back();
      }, 1500);
    } catch {
      handleError(t('pinUpdatedError'));
    } finally {
      setLoading(false);
    }
  };

  // Reset error when user types
  useEffect(() => {
    if (error) setError('');
  }, [currentPin, newPin, confirmPin, error]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <AppHeader title={t('changePinTitle')} showBack />

      <View style={styles.body}>
        <View style={styles.card}>
          {/* Instructions */}
          <View style={styles.instructions}>
            <Ionicons name="shield-checkmark-outline" size={24} color={colors.navy} />
            <Text style={styles.instructionsText}>
              {t('enterPin')} — {t('pinLengthError')}
            </Text>
          </View>

          {/* Current PIN */}
          <PinInputField
            label={t('currentPin')}
            icon="lock-closed-outline"
            value={currentPin}
            onChangeText={setCurrentPin}
            showPassword={showCurrent}
            toggleShow={() => setShowCurrent(!showCurrent)}
          />

          {/* New PIN */}
          <View style={{ marginTop: spacing.lg }}>
            <PinInputField
              label={t('newPin')}
              icon="key-outline"
              value={newPin}
              onChangeText={setNewPin}
              showPassword={showNew}
              toggleShow={() => setShowNew(!showNew)}
            />
            {/* Strength indicator */}
            {newPin.length >= 4 && (
              <View style={styles.strengthRow}>
                <Text style={styles.strengthLabel}>{t('pinStrength')}:</Text>
                <StatusChip label={strengthLabel} variant={strengthVariant} />
                {/* Strength bar */}
                <View style={styles.strengthBar}>
                  <View style={[styles.strengthBarFill, { flex: strength === 'strong' ? 3 : strength === 'medium' ? 2 : 1, backgroundColor: strengthColor }]} />
                  <View style={[styles.strengthBarFill, { flex: 1, backgroundColor: strength === 'strong' ? strengthColor : colors.gray200 }]} />
                  <View style={[styles.strengthBarFill, { flex: 1, backgroundColor: strength === 'strong' ? strengthColor : colors.gray200 }]} />
                </View>
              </View>
            )}
          </View>

          {/* Confirm PIN */}
          <View style={{ marginTop: spacing.lg }}>
            <PinInputField
              label={t('confirmNewPin')}
              icon="checkmark-circle-outline"
              value={confirmPin}
              onChangeText={setConfirmPin}
              showPassword={showConfirm}
              toggleShow={() => setShowConfirm(!showConfirm)}
            />
            {/* Match indicator */}
            {isConfirmValid && (
              <View style={styles.matchRow}>
                <Ionicons
                  name={pinsMatch ? 'checkmark-circle' : 'close-circle'}
                  size={16}
                  color={pinsMatch ? colors.green : colors.red}
                />
                <Text style={[styles.matchText, { color: pinsMatch ? colors.green : colors.red }]}>
                  {pinsMatch ? '✓' : t('pinsDoNotMatch')}
                </Text>
              </View>
            )}
          </View>

          {/* Error */}
          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="warning" size={16} color={colors.red} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Success */}
          {success ? (
            <View style={styles.successBox}>
              <Ionicons name="checkmark-circle" size={20} color={colors.green} />
              <Text style={styles.successText}>{t('pinUpdatedSuccess')}</Text>
            </View>
          ) : null}

          {/* Submit Button */}
          <View style={styles.buttonWrap}>
            <PrimaryButton
              icon="checkmark-outline"
              onPress={handleSubmit}
              disabled={!canSubmit}
            >
              {t('updatePin')}
            </PrimaryButton>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  card: {
    backgroundColor: colors.white, borderRadius: borderRadius.xl,
    borderWidth: 1, borderColor: colors.gray100,
    padding: spacing.xl,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  instructions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xl, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: colors.navyBg, borderRadius: borderRadius.lg },
  instructionsText: { flex: 1, fontSize: fontSize.md, color: colors.navy },

  // Strength
  strengthRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  strengthLabel: { fontSize: fontSize.sm, color: colors.gray500 },
  strengthBar: { flex: 1, flexDirection: 'row', gap: 2, height: 4 },
  strengthBarFill: { height: '100%', borderRadius: 2 },

  // Match
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },

  // Error / Success
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: colors.redLight, borderRadius: borderRadius.lg },
  errorText: { flex: 1, fontSize: fontSize.base, color: colors.red, fontWeight: '500' },
  successBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.md, backgroundColor: colors.greenLight, borderRadius: borderRadius.lg },
  successText: { fontSize: fontSize.lg, color: colors.green, fontWeight: '600' },
  matchText: { fontSize: fontSize.sm, fontWeight: '600' },

  buttonWrap: { marginTop: spacing.xxl },
});
