import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../constants';
import { useFieldOSStore } from '../store/useFieldOSStore';
import { useTranslation } from '../i18n';
import { AppHeader } from '../components/fieldos/AppHeader';
import { StatusChip } from '../components/fieldos/StatusChip';
import { PrimaryButton } from '../components/fieldos/PrimaryButton';
import { ValidationError } from '../components/fieldos/ValidationError';
import { recordPromiseToPay } from '../services';

const getDateOffset = (key: string): string => {
  const d = new Date();
  if (key === 'tomorrow') d.setDate(d.getDate() + 1);
  else if (key === '3days') d.setDate(d.getDate() + 3);
  else if (key === 'next-meeting') d.setDate(d.getDate() + 7);
  return d.toISOString().split('T')[0];
};

const DATE_BUTTONS = [
  { key: 'today', label: 'Today', labelNe: 'आज' },
  { key: 'tomorrow', label: 'Tomorrow', labelNe: 'भोलि' },
  { key: '3days', label: '3 Days', labelNe: '३ दिन' },
  { key: 'next-meeting', label: 'Next Meeting', labelNe: 'अर्को बैठक' },
];

const REASONS = [
  { key: 'no-cash', label: 'No cash today', labelNe: 'आज कुनै नगद छैन' },
  { key: 'unavailable', label: 'Client unavailable', labelNe: 'क्लाइन्ट उपलब्ध छैन' },
  { key: 'business', label: 'Business issue', labelNe: 'व्यापार समस्या' },
  { key: 'health', label: 'Family/health issue', labelNe: 'परिवार/स्वास्थ्य समस्या' },
  { key: 'dispute', label: 'Dispute', labelNe: 'विवाद' },
  { key: 'migration', label: 'Migration', labelNe: 'प्रवास' },
  { key: 'other', label: 'Other', labelNe: 'अन्य' },
];

export default function PromiseToPayScreen() {
  const { selectedClient } = useFieldOSStore();
  const router = useRouter();
  const { t, isNe } = useTranslation();
  const [selectedDate, setSelectedDate] = useState('today');
  const [selectedReason, setSelectedReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const client = selectedClient || { id: 'M-1042', name: 'Sunita Kumari Chaudhary', memberId: 'M-1042' };
  const initials = client.name.split(' ').map(n => n[0]).slice(0, 2).join('');

  if (confirmed) {
    return (
      <View style={styles.container}>
        <AppHeader title={t('promiseToPay')} showBack />
        <View style={styles.body}>
          <View style={styles.successContainer}>
            <View style={styles.successIcon}><Ionicons name="checkmark-circle" size={40} color={colors.green} /></View>
            <Text style={styles.successTitle}>{t('promiseRecorded')}</Text>
            <Text style={styles.successDesc}>{t('reminderHasBeenSet')}</Text>
            <StatusChip label={t('pendingSync')} variant="sync" />
            <Text style={styles.promiseDetail}>NPR 5,500 — {t('promised')}</Text>
            <View style={styles.successActions}>
              <PrimaryButton onPress={() => {
                try { if (router.canDismiss()) router.dismissAll(); } catch { /* no modal */ }
                router.navigate('/(tabs)/tasks');
              }}>{t('returnToTasks')}</PrimaryButton>
              <TouchableOpacity onPress={() => router.back()}><Text style={styles.viewClientText}>{t('viewClient')}</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AppHeader title={t('promiseToPay')} showBack />
      <ScrollView style={styles.body} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <View style={styles.clientRow}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
            <View style={{ flex: 1 }}><Text style={styles.clientName}>{client.name}</Text><Text style={styles.clientMeta}>{client.memberId}</Text></View>
            <StatusChip label={t('overdue')} variant="overdue" />
          </View>
          <View style={styles.outstandingRow}><Text style={styles.outLabel}>{t('outstanding')}</Text><Text style={styles.outValue}>NPR 45,000</Text></View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('promisedAmount')}</Text>
          <View style={styles.amountBox}><Text style={styles.nprLabel}>NPR</Text><Text style={styles.amountText}>5,500</Text></View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('expectedPaymentDate')}</Text>
          <View style={styles.dateGrid}>
            {DATE_BUTTONS.map(d => (
              <TouchableOpacity key={d.key} onPress={() => setSelectedDate(d.key)} style={[styles.dateButton, selectedDate === d.key && styles.dateButtonActive]}>
                <Text style={[styles.dateText, selectedDate === d.key && styles.dateTextActive]}>{isNe ? d.labelNe : d.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('reasonForDelay')}</Text>
          {REASONS.map(r => (
            <TouchableOpacity key={r.key} onPress={() => setSelectedReason(r.key)} style={[styles.reasonRow, selectedReason === r.key && styles.reasonRowActive]}>
              <View style={[styles.radio, selectedReason === r.key && styles.radioActive]}>{selectedReason === r.key && <Ionicons name="checkmark-circle" size={10} color={colors.white} />}</View>
              <Text style={[styles.reasonText, selectedReason === r.key && styles.reasonTextActive]}>{isNe ? r.labelNe : r.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <ValidationError message={error} />

        <PrimaryButton onPress={async () => {
          setError('');

          if (!selectedReason) {
            setError(t('selectReasonForDelay'));
            return;
          }

          if (!selectedDate) {
            setError(t('selectPaymentDate'));
            return;
          }

          try {
            await recordPromiseToPay({
              clientId: Number(client.id) || 0,
              promisedAmount: 5500,
              expectedPaymentDate: getDateOffset(selectedDate),
              reason: selectedReason || 'other',
              outstandingAmount: 45000,
            });
          } catch (e) { /* silent */ }
          setConfirmed(true);
        }} icon="checkmark-circle">{t('confirmPromise')}</PrimaryButton>
        <TouchableOpacity onPress={() => router.back()} style={styles.cancelButton}><Text style={styles.cancelText}>{t('cancel')}</Text></TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md, paddingBottom: 80 },
  card: { backgroundColor: colors.white, borderRadius: borderRadius.xl, padding: spacing.lg, borderWidth: 1, borderColor: colors.gray100, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  clientRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: 9999, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: fontSize.md, fontWeight: 'bold', color: colors.white },
  clientName: { fontSize: fontSize.md, fontWeight: '600', color: colors.gray800 },
  clientMeta: { fontSize: fontSize.sm, color: colors.gray500 },
  outstandingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  outLabel: { fontSize: fontSize.base, color: colors.gray500 },
  outValue: { fontSize: fontSize.lg, fontWeight: 'bold', color: colors.red },
  cardTitle: { fontSize: fontSize.base, fontWeight: 'bold', color: colors.gray700, marginBottom: spacing.sm },
  amountBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: borderRadius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderWidth: 1, borderColor: colors.gray200, backgroundColor: colors.gray50 },
  nprLabel: { fontSize: fontSize.lg, fontWeight: '500', color: colors.gray400 },
  amountText: { fontSize: fontSize.xl, fontWeight: 'bold', color: colors.navy, flex: 1 },
  dateGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  dateButton: { width: '48%', paddingVertical: spacing.sm, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.gray200, alignItems: 'center' },
  dateButtonActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  dateText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.gray600 },
  dateTextActive: { color: colors.white },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.gray100, marginBottom: 4 },
  reasonRowActive: { borderColor: colors.navy, backgroundColor: colors.navyBg },
  radio: { width: 16, height: 16, borderRadius: 9999, borderWidth: 2, borderColor: colors.gray300, alignItems: 'center', justifyContent: 'center' },
  radioActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  reasonText: { fontSize: fontSize.base, fontWeight: '500', color: colors.gray600 },
  reasonTextActive: { color: colors.navy },
  successContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 48, paddingBottom: 48 },
  successIcon: { width: 64, height: 64, borderRadius: 9999, backgroundColor: colors.greenLight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  successTitle: { fontSize: fontSize['4xl'], fontWeight: 'bold', color: colors.gray800, marginBottom: 4 },
  successDesc: { fontSize: fontSize.md, color: colors.gray500, textAlign: 'center', marginBottom: spacing.sm },
  promiseDetail: { fontSize: fontSize.base, color: colors.gray500, marginTop: spacing.sm },
  successActions: { width: '100%', gap: spacing.sm, marginTop: spacing.xl },
  viewClientText: { fontSize: fontSize.md, fontWeight: '600', color: colors.gray500, textAlign: 'center', paddingVertical: spacing.sm },
  cancelButton: { paddingVertical: spacing.md, alignItems: 'center' },
  cancelText: { fontSize: fontSize.lg, fontWeight: '600', color: colors.gray500 },
});
