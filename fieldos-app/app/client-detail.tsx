import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../constants';
import { useFieldOSStore } from '../store/useFieldOSStore';
import { AppHeader } from '../components/fieldos/AppHeader';
import { StatusChip } from '../components/fieldos/StatusChip';
import { AIRecommendationCard } from '../components/fieldos/AIRecommendationCard';
import { PrimaryButton } from '../components/fieldos/PrimaryButton';
import { SecondaryButton } from '../components/fieldos/SecondaryButton';
import { PrivacyNoteCard } from '../components/fieldos/PrivacyNoteCard';
import { useTranslation } from '../i18n';
import { getClientKycStatus } from '../services';
import { fetchClientDetail } from '../services/clientService';
import type { KycDocumentType, KycDocument } from '../db/repositories/kycRepo';

// ─── KYC type config for client detail ────────────────────────
const KYC_TYPES: { type: KycDocumentType; icon: string; labelKey: 'kycCitizenshipFront' | 'kycCitizenshipBack' | 'kycClientPhoto' | 'kycSignature' | 'kycOther' }[] = [
  { type: 'citizenship_front', icon: 'card-outline', labelKey: 'kycCitizenshipFront' },
  { type: 'citizenship_back', icon: 'card-outline', labelKey: 'kycCitizenshipBack' },
  { type: 'client_photo', icon: 'person-outline', labelKey: 'kycClientPhoto' },
  { type: 'signature', icon: 'create-outline', labelKey: 'kycSignature' },
  { type: 'other', icon: 'document-outline', labelKey: 'kycOther' },
];

function getKycStatusVariant(status: string): 'verified' | 'sync' | 'warning' | 'overdue' {
  switch (status) {
    case 'approved': return 'verified';
    case 'pending_sync': return 'sync';
    case 'needs_review': return 'warning';
    case 'captured': return 'verified';
    default: return 'verified';
  }
}

export default function ClientDetailScreen() {
  const { selectedClient, setSelectedClient } = useFieldOSStore();
  const router = useRouter();
  const { t } = useTranslation();
  const client = selectedClient || { id: '', name: '', memberId: '' };
  const clientId = Number(client.id) || 1;
  const initials = (client.name || '').split(' ').map(n => n[0]).slice(0, 2).join('');

  const numericClientId = (selectedClient as any)?.clientId ?? clientId;

  const [kycSummary, setKycSummary] = useState<Record<KycDocumentType, KycDocument | null>>({} as any);
  const [kycLoading, setKycLoading] = useState(true);
  const [lastPayment, setLastPayment] = useState<{ amount: number; at: string } | null>(null);

  // Authoritative loan figures from the backend (single source of truth). The store's
  // selectedClient can hold a stale/partial object (e.g. arriving from a task), so we
  // fetch the real due/outstanding on focus and mirror them back into the store so the
  // Collect screen inherits the same numbers. No hardcoded fallbacks.
  const [liveDue, setLiveDue] = useState<number | null>(null);
  const [liveOutstanding, setLiveOutstanding] = useState<number | null>(null);
  const [apiHistory, setApiHistory] = useState<{ date: string; action: string; amount: string }[] | null>(null);

  const loadClientDetail = useCallback(async () => {
    if (!numericClientId) return;
    try {
      const res: any = await fetchClientDetail(numericClientId);
      const d = res?.data ?? res;
      if (!d) return;
      const due = Number(d.due_amount ?? d.dueAmount ?? d.loanAccount?.installmentAmount ?? 0);
      const out = Number(d.outstanding_balance ?? d.outstandingBalance ?? d.loanAccount?.outstandingBalance ?? 0);
      setLiveDue(due);
      setLiveOutstanding(out);
      // Keep the store in sync so downstream screens (Collect) use the fresh numbers.
      setSelectedClient({ ...(selectedClient as any), dueAmount: due, outstandingBalance: out, clientId: numericClientId });
      const rows = d.recent_collections ?? d.visitHistory ?? [];
      if (Array.isArray(rows) && rows.length) {
        setApiHistory(rows.map((r: any) => ({
          date: String(r.collected_at ?? r.date ?? '').slice(0, 10) || '—',
          action: r.amount != null ? t('collection') : t('visit'),
          amount: r.amount != null ? `NPR ${Number(r.amount).toLocaleString()}` : t('followUp'),
        })));
      } else {
        setApiHistory([]);
      }
    } catch { /* offline-first: keep whatever the store had */ }
  }, [numericClientId]);

  const loadLastPayment = useCallback(async () => {
    try {
      const { getLatestCollectionByClient } = require('../db/repositories/collectionsRepo');
      const row = await getLatestCollectionByClient(numericClientId);
      if (row) setLastPayment({ amount: row.amount, at: row.collected_at });
    } catch { /* offline-first: leave as null */ }
  }, [numericClientId]);

  const loadKyc = useCallback(async () => {
    try {
      const summary = await getClientKycStatus(clientId);
      setKycSummary(summary);
    } catch (err) {
      console.warn('[ClientDetail] KYC load failed:', err);
    } finally {
      setKycLoading(false);
    }
  }, [clientId]);

  useEffect(() => { loadKyc(); }, [loadKyc]);

  // Refresh KYC + last payment + live loan figures when screen comes back into focus
  // (so returning from a collection shows the reduced balance immediately).
  useFocusEffect(
    useCallback(() => { loadKyc(); loadLastPayment(); loadClientDetail(); }, [loadKyc, loadLastPayment, loadClientDetail])
  );

  const lastPaymentLabel = (() => {
    if (!lastPayment) return '—';
    const days = Math.floor((Date.now() - new Date(lastPayment.at).getTime()) / 86400000);
    const rel = days <= 0 ? t('today') : `${days}d ago`;
    return `NPR ${Number(lastPayment.amount).toLocaleString()} · ${rel}`;
  })();

  const completedKyc = KYC_TYPES.filter(dt => kycSummary[dt.type]).length;
  const totalKyc = KYC_TYPES.length;

  // Real payment history from the backend; empty array = "no history yet" (no fake rows).
  const history = apiHistory ?? [];

  // Live figures win; fall back to the store only while the first fetch is in flight.
  const displayDue = liveDue ?? Number(selectedClient?.dueAmount) ?? 0;
  const displayOutstanding = liveOutstanding ?? Number(selectedClient?.outstandingBalance) ?? 0;

  return (
    <View style={styles.container}>
      <AppHeader title={t('clientDetail')} showBack />
      <ScrollView style={styles.body} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Client card */}
        <View style={styles.card}>
          <View style={styles.clientHeader}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.clientName}>{client.name}</Text>
              <Text style={styles.clientMeta}>{client.memberId} · {t('loanCycle3')}</Text>
              <StatusChip label={t('verified')} variant="verified" />
            </View>
            <TouchableOpacity style={styles.callButton} onPress={() => alert('Calling feature coming soon.')}><Ionicons name="call" size={16} color={colors.green} /></TouchableOpacity>
          </View>
          <View style={styles.locationRow}>
            <View style={styles.locItem}><Ionicons name="people-outline" size={12} color={colors.gray500} /><Text style={styles.locText}>{t('janakpurCenter')}</Text></View>
            <View style={styles.locItem}><Ionicons name="location-outline" size={12} color={colors.gray500} /><Text style={styles.locText}>{t('ward7Butwal')}</Text></View>
          </View>
        </View>

        {/* Loan summary */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('loanSummary')}</Text>
          <View style={styles.loanRow}><Text style={styles.loanLabel}>{t('dueAmount')}</Text><Text style={styles.loanDue}>NPR {displayDue.toLocaleString()}</Text></View>
          <View style={styles.loanRow}><Text style={styles.loanLabel}>{t('outstandingBalance')}</Text><Text style={styles.loanValue}>NPR {displayOutstanding.toLocaleString()}</Text></View>
          <View style={styles.loanRow}><Text style={styles.loanLabel}>{t('lastPayment')}</Text><Text style={styles.loanValue}>{lastPaymentLabel}</Text></View>
          <View style={styles.loanRow}><Text style={styles.loanLabel}>{t('nextInstallment')}</Text><Text style={styles.loanValue}>{t('today')}</Text></View>
          <View style={styles.divider} />
          <View style={styles.loanRow}><Text style={styles.loanLabel}>{t('overduePar')}</Text><StatusChip label={t('overdue')} variant="overdue" /></View>
        </View>

        {/* AI recommendation */}
        <AIRecommendationCard title={t('aiRecommendedAction')} reason={t('priorityVisitRecommended')} action={t('startVisitCheckin')} onAction={() => router.push('/visit-checkin')} />

        {/* Actions */}
        <View style={styles.actions}>
          <PrimaryButton onPress={() => router.push('/visit-checkin')} icon="location">{t('startVisitCheckin')}</PrimaryButton>
          <View style={styles.actionRow}>
            <View style={{ flex: 1 }}><SecondaryButton onPress={() => router.push('/record-collection')} icon="wallet">{t('collect')}</SecondaryButton></View>
            <View style={{ flex: 1 }}><SecondaryButton onPress={() => router.push('/promise-to-pay')} icon="time">{t('promise')}</SecondaryButton></View>
          </View>
          <TouchableOpacity style={styles.noteButton} onPress={() => alert('Add Note feature coming soon.')}><Ionicons name="document-text-outline" size={16} color={colors.gray600} /><Text style={styles.noteText}>{t('addNote')}</Text></TouchableOpacity>
        </View>

        {/* KYC Documents Section */}
        <View style={styles.card}>
          <View style={styles.kycHeader}>
            <Text style={styles.cardTitle}>{t('kycDocuments')}</Text>
            <View style={[styles.kycBadge, { backgroundColor: completedKyc === totalKyc ? colors.greenLight : colors.orangeLight }]}>
              <Text style={[styles.kycBadgeText, { color: completedKyc === totalKyc ? colors.green : colors.orange }]}>{completedKyc}/{totalKyc}</Text>
            </View>
          </View>

          {KYC_TYPES.map(dt => {
            const doc = kycSummary[dt.type];
            const hasDoc = !!doc;

            return (
              <View key={dt.type} style={styles.kycRow}>
                <View style={styles.kycIconBox}>
                  {hasDoc ? (
                    <Image source={{ uri: doc.fileUri }} style={styles.kycThumbnail} resizeMode="cover" />
                  ) : (
                    <Ionicons name={dt.icon as any} size={18} color={colors.gray400} />
                  )}
                </View>
                <Text style={styles.kycLabel}>{t(dt.labelKey)}</Text>
                {hasDoc ? (
                  <StatusChip
                    label={doc.status === 'approved' ? t('kycStatusApproved') : doc.status === 'pending_sync' ? t('kycStatusPendingSync') : doc.status === 'needs_review' ? t('kycStatusNeedsReview') : t('kycStatusCaptured')}
                    variant={getKycStatusVariant(doc.status)}
                  />
                ) : (
                  <StatusChip label={t('kycStatusMissing')} variant="warning" />
                )}
              </View>
            );
          })}

          <TouchableOpacity
            style={styles.kycCaptureBtn}
            onPress={() => router.push('/document-capture')}
          >
            <Ionicons name="camera-outline" size={16} color={colors.navy} />
            <Text style={styles.kycCaptureBtnText}>{t('kycCaptureDocument')}</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.navy} />
          </TouchableOpacity>
        </View>

        {/* History */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('history')}</Text>
          {history.length === 0 && (
            <Text style={styles.historyDate}>{t('noHistoryYet')}</Text>
          )}
          {history.map((item, i) => (
            <View key={i} style={styles.historyRow}>
              <View style={styles.historyIcon}><Ionicons name={item.action === t('collection') ? 'wallet-outline' : 'location-outline'} size={14} color={colors.navy} /></View>
              <View style={{ flex: 1 }}><Text style={styles.historyAction}>{item.action}</Text><Text style={styles.historyDate}>{item.date}</Text></View>
              <Text style={styles.historyAmount}>{item.amount}</Text>
              <Ionicons name="checkmark-circle" size={12} color={colors.green} />
            </View>
          ))}
        </View>

        <PrivacyNoteCard />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md, paddingBottom: 80 },
  card: { backgroundColor: colors.white, borderRadius: borderRadius.xl, padding: spacing.lg, borderWidth: 1, borderColor: colors.gray100, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  clientHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  avatar: { width: 48, height: 48, borderRadius: 9999, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: fontSize.md + 1, fontWeight: 'bold', color: colors.white },
  clientName: { fontSize: fontSize.lg, fontWeight: 'bold', color: colors.gray800 },
  clientMeta: { fontSize: fontSize.sm, color: colors.gray500 },
  callButton: { padding: spacing.sm, borderRadius: borderRadius.sm, backgroundColor: colors.greenLight, borderWidth: 1, borderColor: colors.greenBorder },
  locationRow: { flexDirection: 'row', gap: spacing.md },
  locItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  locText: { fontSize: fontSize.sm, color: colors.gray500 },
  cardTitle: { fontSize: fontSize.base, fontWeight: 'bold', color: colors.gray700, marginBottom: spacing.sm },
  loanRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  loanLabel: { fontSize: fontSize.base, color: colors.gray500 },
  loanDue: { fontSize: fontSize.lg, fontWeight: 'bold', color: colors.red },
  loanValue: { fontSize: fontSize.md, fontWeight: '500', color: colors.gray700 },
  divider: { height: 1, backgroundColor: colors.gray100, marginVertical: spacing.xs },
  actions: { gap: spacing.sm },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  noteButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 4, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.gray200 },
  noteText: { fontSize: fontSize.md, fontWeight: '600', color: colors.gray600 },

  // KYC section
  kycHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  kycBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  kycBadgeText: { fontSize: fontSize.sm, fontWeight: '700' },
  kycRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  kycIconBox: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.gray50,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  kycThumbnail: { width: 36, height: 36 },
  kycLabel: { flex: 1, fontSize: fontSize.base, color: colors.gray600 },
  kycCaptureBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 4,
    marginTop: spacing.sm,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.navy,
    backgroundColor: colors.navyBg,
  },
  kycCaptureBtnText: { fontSize: fontSize.md, fontWeight: '600', color: colors.navy },

  historyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  historyIcon: { width: 28, height: 28, borderRadius: borderRadius.sm, backgroundColor: `${colors.navy}10`, alignItems: 'center', justifyContent: 'center' },
  historyAction: { fontSize: fontSize.base, fontWeight: '500', color: colors.gray700 },
  historyDate: { fontSize: fontSize.xs, color: colors.gray400 },
  historyAmount: { fontSize: fontSize.base, fontWeight: '600', color: colors.gray700 },
});
