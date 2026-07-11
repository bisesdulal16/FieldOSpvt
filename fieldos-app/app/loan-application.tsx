import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, TextInput } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../constants';
import { useFieldOSStore } from '../store/useFieldOSStore';
import { useTranslation } from '../i18n';
import { AppHeader } from '../components/fieldos/AppHeader';
import { StatusChip } from '../components/fieldos/StatusChip';
import { PrimaryButton } from '../components/fieldos/PrimaryButton';
import { ValidationError } from '../components/fieldos/ValidationError';
import { submitLoanApplication } from '../services';

const TERM_OPTIONS = [12, 25, 40, 52];

export default function LoanApplicationScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ clientId?: string; clientName?: string; memberId?: string }>();
  const { selectedClient } = useFieldOSStore();

  // Prefer explicit params (from register flow), fall back to the selected client.
  const clientId = params.clientId ? Number(params.clientId) : ((selectedClient as any)?.clientId ?? 0);
  const clientName = params.clientName || (selectedClient as any)?.name || 'Borrower';
  const memberId = params.memberId || (selectedClient as any)?.memberId || '';

  const [principal, setPrincipal] = useState('');
  const [termWeeks, setTermWeeks] = useState(25);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ loan_id: string; installment_amount: number } | null>(null);

  const principalNum = parseInt(principal, 10) || 0;

  const onSubmit = async () => {
    setError('');
    if (!clientId) { setError(t('missingClientInfo')); return; }
    if (principalNum <= 0) { setError(t('principalRequired')); return; }
    setSaving(true);
    try {
      const res = await submitLoanApplication({ clientId, principalAmount: principalNum, termWeeks });
      if (res.success && res.data) {
        setResult(res.data);
      } else {
        setError(res.error || 'Application failed');
      }
    } catch (e: any) {
      setError(e?.message || 'Application failed');
    } finally {
      setSaving(false);
    }
  };

  if (result) {
    return (
      <View style={styles.container}>
        <AppHeader title={t('loanApplication')} showBack />
        <View style={styles.successContainer}>
          <View style={styles.successIcon}><Ionicons name="checkmark-circle" size={40} color={colors.green} /></View>
          <Text style={styles.successTitle}>{t('applicationSubmitted')}</Text>
          <Text style={styles.successDesc}>{result.loan_id}</Text>
          <StatusChip label={t('pendingManagerApproval')} variant="pending" />
          <Text style={styles.detail}>{t('weeklyInstallment')}: NPR {Number(result.installment_amount).toLocaleString()}</Text>
          <View style={styles.successActions}>
            <PrimaryButton onPress={() => { try { if (router.canDismiss()) router.dismissAll(); } catch { /* no modal */ } router.navigate('/(tabs)'); }}>
              {t('loanDone')}
            </PrimaryButton>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AppHeader title={t('newLoanApplication')} showBack />
      <ScrollView style={styles.body} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <View style={styles.clientRow}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{clientName.split(' ').map((n: string) => n[0]).slice(0, 2).join('')}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.clientName}>{clientName}</Text>
              <Text style={styles.clientMeta}>{memberId}</Text>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('principalAmountLabel')}</Text>
          <View style={styles.amountBox}>
            <Text style={styles.nprLabel}>NPR</Text>
            <TextInput style={styles.amountText} value={principal} onChangeText={setPrincipal} keyboardType="number-pad" placeholder="0" placeholderTextColor={colors.gray300} />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('termWeeks')}</Text>
          <View style={styles.termGrid}>
            {TERM_OPTIONS.map(w => (
              <TouchableOpacity key={w} onPress={() => setTermWeeks(w)} style={[styles.termButton, termWeeks === w && styles.termButtonActive]}>
                <Text style={[styles.termText, termWeeks === w && styles.termTextActive]}>{w}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <ValidationError message={error} />

        <PrimaryButton onPress={onSubmit} icon="document-text" disabled={saving}>
          {saving ? '…' : t('submitApplication')}
        </PrimaryButton>
        <TouchableOpacity onPress={() => router.back()} style={styles.cancelButton}><Text style={styles.cancelText}>{t('cancel')}</Text></TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md, paddingBottom: 80 },
  card: { backgroundColor: colors.white, borderRadius: borderRadius.xl, padding: spacing.lg, borderWidth: 1, borderColor: colors.gray100 },
  clientRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: 9999, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: fontSize.md, fontWeight: 'bold', color: colors.white },
  clientName: { fontSize: fontSize.md, fontWeight: '600', color: colors.gray800 },
  clientMeta: { fontSize: fontSize.sm, color: colors.gray500 },
  cardTitle: { fontSize: fontSize.base, fontWeight: 'bold', color: colors.gray700, marginBottom: spacing.sm },
  amountBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: borderRadius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderWidth: 1, borderColor: colors.gray200, backgroundColor: colors.gray50 },
  nprLabel: { fontSize: fontSize.lg, fontWeight: '500', color: colors.gray400 },
  amountText: { fontSize: fontSize.xl, fontWeight: 'bold', color: colors.navy, flex: 1 },
  termGrid: { flexDirection: 'row', gap: spacing.sm },
  termButton: { flex: 1, paddingVertical: spacing.sm, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.gray200, alignItems: 'center' },
  termButtonActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  termText: { fontSize: fontSize.md, fontWeight: '600', color: colors.gray600 },
  termTextActive: { color: colors.white },
  successContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  successIcon: { width: 64, height: 64, borderRadius: 9999, backgroundColor: colors.greenLight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  successTitle: { fontSize: fontSize['4xl'], fontWeight: 'bold', color: colors.gray800, marginBottom: 4 },
  successDesc: { fontSize: fontSize.md, color: colors.gray500, textAlign: 'center', marginBottom: spacing.sm },
  detail: { fontSize: fontSize.base, color: colors.gray500, marginTop: spacing.sm },
  successActions: { width: '100%', gap: spacing.sm, marginTop: spacing.xl },
  cancelButton: { paddingVertical: spacing.md, alignItems: 'center' },
  cancelText: { fontSize: fontSize.lg, fontWeight: '600', color: colors.gray500 },
});
