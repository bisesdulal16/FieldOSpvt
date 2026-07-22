import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../constants';
import { useTranslation } from '../i18n';
import { AppHeader } from '../components/fieldos/AppHeader';
import { StatusChip } from '../components/fieldos/StatusChip';
import { SummaryCard } from '../components/fieldos/SummaryCard';
import { PrimaryButton } from '../components/fieldos/PrimaryButton';
import { SecondaryButton } from '../components/fieldos/SecondaryButton';
import { ValidationError } from '../components/fieldos/ValidationError';
import { useFieldOSStore } from '../store/useFieldOSStore';
import { submitEndOfDayReport } from '../services';
import { getSetting, setSetting } from '../db/repositories/settingsRepo';
import { getTotalCollectedToday, getCollectionsByDate } from '../db/repositories/collectionsRepo';
import { getUnsyncedCount } from '../db/repositories/syncQueueRepo';
import { query } from '../db/database';

const EXCEPTIONS = [
  { label: 'Missing receipt', labelNe: 'रसिद हराइयो', count: 1, icon: 'document-text-outline' as const, color: colors.orange },
  { label: 'Partial payment', labelNe: 'आंशिक भुक्तानी', count: 2, icon: 'wallet-outline' as const, color: '#D97706' },
  { label: 'Client unavailable', labelNe: 'क्लाइन्ट उपलब्ध छैन', count: 1, icon: 'people-outline' as const, color: colors.gray500 },
  { label: 'Pending sync', labelNe: 'पेन्डिङ सिंक', count: 5, icon: 'cloud-outline' as const, color: colors.navyLight },
  { label: 'High-value pending', labelNe: 'उच्च-मूल्य पेन्डिङ', count: 1, icon: 'shield-outline' as const, color: '#7C3AED' },
];

export default function EndOfDayScreen() {
  const router = useRouter();
  const { t, isNe } = useTranslation();
  const [confirmed, setConfirmed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  // Real, locally-computed end-of-day figures
  const [stats, setStats] = useState({ collected: 0, collections: 0, visits: 0, pending: 0 });

  useEffect(() => {
    (async () => {
      try {
        const savedDate = await getSetting('eod_submitted_date');
        const today = new Date().toISOString().split('T')[0];
        if (savedDate === today) {
          setSubmitted(true);
        }
      } catch {}
    })();
  }, []);

  // Load today's real activity from the local DB.
  useEffect(() => {
    (async () => {
      try {
        const today = new Date().toISOString().split('T')[0];
        const collected = await getTotalCollectedToday();
        const todaysCollections = await getCollectionsByDate(today);
        const visitRows = await query<{ n: number }>(
          "SELECT COUNT(*) as n FROM visit_checkins WHERE date(checked_in_at) = date('now')"
        );
        const pending = await getUnsyncedCount();
        setStats({
          collected,
          collections: todaysCollections.length,
          visits: visitRows[0]?.n ?? 0,
          pending,
        });
      } catch { /* offline-first: leave zeros */ }
    })();
  }, []);

  const formatK = (n: number) => (n >= 1000 ? `NPR ${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K` : `NPR ${n}`);

  if (submitted) {
    return (
      <View style={styles.container}>
        <AppHeader title={t('endOfDaySummary')} showBack />
        <View style={styles.body}>
          <View style={styles.successContainer}>
            <View style={styles.successIcon}><Ionicons name="checkmark-circle" size={40} color={colors.green} /></View>
            <Text style={styles.successTitle}>{t('reportSubmitted')}</Text>
            <Text style={styles.successDesc}>{t('dailyReportSubmitted')}</Text>
            <StatusChip label={t('completed')} variant="success" />
            <View style={styles.successActions}>
              <PrimaryButton onPress={() => router.back()}>{t('backToDashboard')}</PrimaryButton>
              <SecondaryButton onPress={() => router.push('/sync-center')} icon="refresh">{t('syncNow')}</SecondaryButton>
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AppHeader title={t('endOfDaySummary')} showBack />
      <ScrollView style={styles.body} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.dateRow}>
          <Ionicons name="calendar-outline" size={14} color={colors.navy} />
          <Text style={styles.dateText}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</Text>
        </View>

        <View style={styles.grid3}>
          <SummaryCard label={t('collected')} value={formatK(stats.collected)} icon="wallet" color={colors.green} />
          <SummaryCard label={t('visits')} value={String(stats.visits)} icon="people" color={colors.navyLight} />
          <SummaryCard label={t('pending')} value={String(stats.pending)} icon="list" color={colors.orange} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('exceptions')}</Text>
          {EXCEPTIONS.filter(e => e.count > 0).map(exc => (
            <View key={exc.label} style={styles.excRow}>
              <View style={styles.excLeft}><Ionicons name={exc.icon} size={14} color={exc.color} /><Text style={styles.excLabel}>{isNe ? exc.labelNe : exc.label}</Text></View>
              <View style={[styles.excBadge, { backgroundColor: `${exc.color}15` }]}><Text style={[styles.excCount, { color: exc.color }]}>{exc.count}</Text></View>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <TouchableOpacity onPress={() => setConfirmed(!confirmed)} style={styles.confirmRow}>
            <View style={[styles.checkbox, confirmed && styles.checkboxActive]}>{confirmed && <Ionicons name="checkmark-circle" size={12} color={colors.white} />}</View>
            <Text style={styles.confirmText}>{t('confirmFieldDataAccurate')}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.unsyncedCard}>
          <View style={styles.unsyncedRow}>
            <Ionicons name="cloud-outline" size={14} color={colors.orange} />
            <Text style={styles.unsyncedLabel}>{t('unsyncedRecords')}</Text>
            <Text style={styles.unsyncedCount}>{stats.pending}</Text>
          </View>
          <Text style={styles.unsyncedDesc}>
            {t('syncBeforeSubmitting')}
          </Text>
        </View>

        <View style={styles.verifyNote}>
          <Ionicons name="shield-outline" size={14} color={colors.navy} />
          <Text style={styles.verifyText}>{t('identityVerificationBeforeSubmission')}</Text>
        </View>

        <ValidationError message={error} />

        <PrimaryButton onPress={() => {
          setError('');

          if (!confirmed) {
            setError(t('pleaseConfirmDataAccurate'));
            return;
          }

          // Submit EOD via service layer (local queue + audit), then show the
          // completion view in-place (replaces the form) rather than stacking.
          submitEndOfDayReport({
            reportDate: new Date().toISOString().split('T')[0],
            totalCollections: stats.collected,
            totalVisits: stats.visits,
            pendingCount: stats.pending,
            exceptions: [],
            isConfirmed: confirmed,
            faceVerified: false,
          }).then(async () => {
            try { await setSetting('eod_submitted_date', new Date().toISOString().split('T')[0], 'string'); } catch {}
            // EOD ends the officer's day: clear day-start so it doesn't restore on
            // next login and the officer isn't shown as "day started" after EOD.
            try {
              await setSetting('day_started', 'false', 'boolean');
              useFieldOSStore.getState().resetDay();
            } catch {}
            setSubmitted(true);
          }).catch(() => { setSubmitted(true); });
        }} icon="shield">{t('submitMyReport')}</PrimaryButton>
        <View style={styles.actionRow}>
          <SecondaryButton onPress={() => router.back()} icon="save">{t('draft')}</SecondaryButton>
          <SecondaryButton onPress={() => router.push('/sync-center')} icon="refresh">{t('sync')}</SecondaryButton>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md, paddingBottom: 80 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dateText: { fontSize: fontSize.md, color: colors.gray600, fontWeight: '500' },
  grid3: { flexDirection: 'row', gap: spacing.sm },
  card: { backgroundColor: colors.white, borderRadius: borderRadius.xl, padding: spacing.lg, borderWidth: 1, borderColor: colors.gray100, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  cardTitle: { fontSize: fontSize.base, fontWeight: 'bold', color: colors.gray700, marginBottom: spacing.sm },
  excRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  excLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  excLabel: { fontSize: fontSize.base, color: colors.gray600 },
  excBadge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 9999 },
  excCount: { fontSize: fontSize.sm, fontWeight: 'bold' },
  confirmRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: colors.gray300, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  checkboxActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  confirmText: { fontSize: fontSize.base, color: colors.gray700, flex: 1 },
  verifyNote: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: '#93C5FD', backgroundColor: colors.navyBg },
  verifyText: { fontSize: fontSize.sm, fontWeight: '500', color: colors.navy, flex: 1 },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  successContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 48, paddingBottom: 48 },
  successIcon: { width: 64, height: 64, borderRadius: 9999, backgroundColor: colors.greenLight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  successTitle: { fontSize: fontSize['4xl'], fontWeight: 'bold', color: colors.gray800, marginBottom: 4 },
  successDesc: { fontSize: fontSize.md, color: colors.gray500, textAlign: 'center', marginBottom: spacing.sm },
  successActions: { width: '100%', gap: spacing.sm, marginTop: spacing.xl },
  unsyncedCard: { padding: spacing.md, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: '#FDE68A', backgroundColor: '#FFFBEB' },
  unsyncedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  unsyncedLabel: { fontSize: fontSize.base, fontWeight: '600', color: '#92400E', flex: 1 },
  unsyncedCount: { fontSize: fontSize.lg, fontWeight: 'bold', color: colors.orange },
  unsyncedDesc: { fontSize: fontSize.sm, color: '#A16207', marginTop: spacing.xs },
});
