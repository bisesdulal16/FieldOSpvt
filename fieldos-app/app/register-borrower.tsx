import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../constants';
import { useTranslation } from '../i18n';
import { AppHeader } from '../components/fieldos/AppHeader';
import { StatusChip } from '../components/fieldos/StatusChip';
import { PrimaryButton } from '../components/fieldos/PrimaryButton';
import { ValidationError } from '../components/fieldos/ValidationError';
import { registerBorrower } from '../services';

export default function RegisterBorrowerScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [nameNe, setNameNe] = useState('');
  const [center, setCenter] = useState('');
  const [ward, setWard] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [registered, setRegistered] = useState<{ id: number; member_id: string; name: string } | null>(null);

  const onSubmit = async () => {
    setError('');
    if (!name.trim()) { setError(t('nameRequired')); return; }
    setSaving(true);
    try {
      const res = await registerBorrower({
        name: name.trim(), nameNe: nameNe.trim() || undefined,
        centerName: center.trim() || undefined, ward: ward.trim() || undefined,
      });
      if (res.success && res.data) {
        setRegistered(res.data);
      } else {
        setError(res.error || 'Registration failed');
      }
    } catch (e: any) {
      setError(e?.message || 'Registration failed');
    } finally {
      setSaving(false);
    }
  };

  if (registered) {
    return (
      <View style={styles.container}>
        <AppHeader title={t('registerBorrower')} showBack />
        <View style={styles.successContainer}>
          <View style={styles.successIcon}><Ionicons name="checkmark-circle" size={40} color={colors.green} /></View>
          <Text style={styles.successTitle}>{t('borrowerRegistered')}</Text>
          <Text style={styles.successDesc}>{registered.name} · {registered.member_id}</Text>
          <StatusChip label={t('pendingSync')} variant="sync" />
          <View style={styles.successActions}>
            <PrimaryButton
              icon="document-text"
              onPress={() => router.replace({
                pathname: '/loan-application',
                params: { clientId: String(registered.id), clientName: registered.name, memberId: registered.member_id },
              })}
            >{t('submitLoanApplication')}</PrimaryButton>
            <TouchableOpacity onPress={() => router.back()}>
              <Text style={styles.viewClientText}>{t('loanDone')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AppHeader title={t('registerBorrower')} showBack />
      <ScrollView style={styles.body} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('newBorrower')}</Text>

          <Text style={styles.label}>{t('borrowerName')} *</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Nirmala Basnet" placeholderTextColor={colors.gray300} />

          <Text style={styles.label}>{t('borrowerNameNe')}</Text>
          <TextInput style={styles.input} value={nameNe} onChangeText={setNameNe} placeholder="निर्मला बस्नेत" placeholderTextColor={colors.gray300} />

          <Text style={styles.label}>{t('centerNameLabel')}</Text>
          <TextInput style={styles.input} value={center} onChangeText={setCenter} placeholder="Kalanki Center" placeholderTextColor={colors.gray300} />

          <Text style={styles.label}>{t('wardLabel')}</Text>
          <TextInput style={styles.input} value={ward} onChangeText={setWard} placeholder="12" placeholderTextColor={colors.gray300} keyboardType="number-pad" />
        </View>

        <ValidationError message={error} />

        <PrimaryButton onPress={onSubmit} icon="person-add" disabled={saving}>
          {saving ? '…' : t('registerBorrower')}
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
  cardTitle: { fontSize: fontSize.base, fontWeight: 'bold', color: colors.gray700, marginBottom: spacing.md },
  label: { fontSize: fontSize.sm, fontWeight: '600', color: colors.gray600, marginBottom: 4, marginTop: spacing.sm },
  input: { borderWidth: 1, borderColor: colors.gray200, borderRadius: borderRadius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: fontSize.md, color: colors.gray800, backgroundColor: colors.gray50 },
  successContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  successIcon: { width: 64, height: 64, borderRadius: 9999, backgroundColor: colors.greenLight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  successTitle: { fontSize: fontSize['4xl'], fontWeight: 'bold', color: colors.gray800, marginBottom: 4 },
  successDesc: { fontSize: fontSize.md, color: colors.gray500, textAlign: 'center', marginBottom: spacing.sm },
  successActions: { width: '100%', gap: spacing.sm, marginTop: spacing.xl },
  viewClientText: { fontSize: fontSize.md, fontWeight: '600', color: colors.gray500, textAlign: 'center', paddingVertical: spacing.sm },
  cancelButton: { paddingVertical: spacing.md, alignItems: 'center' },
  cancelText: { fontSize: fontSize.lg, fontWeight: '600', color: colors.gray500 },
});
