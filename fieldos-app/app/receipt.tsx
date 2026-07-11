import React, { useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Share } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../constants';
import { useFieldOSStore } from '../store/useFieldOSStore';
import { useTranslation } from '../i18n';
import { AppHeader } from '../components/fieldos/AppHeader';
import { StatusChip } from '../components/fieldos/StatusChip';
import { PrimaryButton } from '../components/fieldos/PrimaryButton';
import { SecondaryButton } from '../components/fieldos/SecondaryButton';
import { getPendingCount } from '../db/repositories/syncQueueRepo';
import { auditReceiptCreated } from '../services';
import { getCurrentUser } from '../services/authService';

export default function DigitalReceiptScreen() {
  const { selectedClient, receiptStatus, syncStatus, collectionAmount, lastReceiptAmount, receiptId: storeReceiptId } = useFieldOSStore();
  const router = useRouter();
  const { t } = useTranslation();
  const [hasPendingSync, setHasPendingSync] = useState(true);
  const [cbsVerified, setCbsVerified] = useState(false);
  const [officerName, setOfficerName] = useState('');
  const client = selectedClient || { id: 'M-1042', name: 'Sunita Kumari Chaudhary', memberId: 'M-1042' };
  const receiptId = storeReceiptId || `RC-${Date.now().toString(36).toUpperCase().slice(-8)}`;
  const now = new Date();
  const displayAmount = lastReceiptAmount || parseInt(collectionAmount) || 0;
  const remainingDue = (selectedClient as any)?.remainingDue ?? Math.max(((selectedClient as any)?.dueAmount ?? 0) - displayAmount, 0);

  // Close this (and any other) modal, then switch to the requested tab so we
  // return into the single tabbed home instead of stacking a tab navigator
  // on top of the receipt modal.
  const goToTab = (tab: '/(tabs)/tasks' | '/(tabs)/collect') => {
    try {
      if (router.canDismiss()) router.dismissAll();
    } catch { /* no modal to dismiss */ }
    router.navigate(tab);
  };

  const handleShareReceipt = async () => {
    const lines = [
      'FieldOS — Collection Receipt',
      `Receipt: ${receiptId}`,
      `Client: ${client.name} (${client.memberId})`,
      `Amount: NPR ${displayAmount.toLocaleString()}`,
      `Remaining due: NPR ${Number(remainingDue).toLocaleString()}`,
      officerName ? `Collected by: ${officerName}` : '',
      `Date: ${now.toLocaleString()}`,
      hasPendingSync ? 'Status: Saved offline — pending sync' : 'Status: Synced',
    ].filter(Boolean);
    try {
      await Share.share({ message: lines.join('\n'), title: `Receipt ${receiptId}` });
    } catch { /* user dismissed the share sheet */ }
  };

  useEffect(() => {
    getPendingCount().then(count => setHasPendingSync(count > 0)).catch(() => {});
    auditReceiptCreated(receiptId, displayAmount).catch(() => {});
    getCurrentUser().then(u => {
      if (u) setOfficerName(u.staffId ? `${u.name} (${u.staffId})` : u.name);
    }).catch(() => {});
  }, [displayAmount]);

  const receiptItems = [
    { label: t('receiptClient'), value: client.name, icon: 'person-outline' as const },
    { label: t('receiptMemberId'), value: client.memberId, icon: 'person-outline' as const },
    { label: t('receiptPaymentMethod'), value: (selectedClient as any)?.paymentMethod || 'Cash', icon: 'wallet-outline' as const },
    { label: t('receiptDateTime'), value: now.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), icon: 'time-outline' as const },
    { label: t('receiptFieldOfficer'), value: officerName || '—', icon: 'person-outline' as const },
    { label: 'Remaining Due', value: `NPR ${remainingDue.toLocaleString()}`, icon: 'wallet-outline' as const },
  ];

  return (
    <View style={styles.container}>
      <AppHeader title={t('collectionRecordedTitle')} showBack />
      <ScrollView style={styles.body} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.successHeader}>
          <View style={styles.successIcon}><Ionicons name="checkmark-circle" size={40} color={colors.green} /></View>
          <Text style={styles.successTitle}>{t('collectionRecordedSuccess')}</Text>
          <StatusChip label={receiptStatus === 'saved-offline'
            ? (hasPendingSync ? t('savedOfflinePendingSync') : t('savedOffline'))
            : t('confirmed')
          } variant={receiptStatus === 'saved-offline' ? 'sync' : 'success'} />
        </View>

        <View style={styles.receiptCard}>
          <View style={styles.receiptAccent} />
          <View style={styles.receiptBody}>
            <View style={styles.receiptIdRow}><Text style={styles.receiptIdLabel}>{t('receiptId')}</Text><Text style={styles.receiptId}>{receiptId}</Text></View>
            <View style={styles.divider} />
            <View style={styles.amountSection}><Text style={styles.amountLabel}>{t('amountCollected')}</Text><Text style={styles.amountValue}>NPR {displayAmount.toLocaleString()}</Text></View>
            <View style={styles.divider} />
            {receiptItems.map(item => (
              <View key={item.label} style={styles.receiptRow}>
                <View style={styles.receiptLeft}><Ionicons name={item.icon} size={12} color={colors.gray400} /><Text style={styles.receiptRowLabel}>{item.label}</Text></View>
                <Text style={styles.receiptRowValue}>{item.value}</Text>
              </View>
            ))}
            <View style={styles.gpsRow}><Ionicons name="location" size={12} color={colors.green} /><Text style={styles.gpsText}>{t('receiptGpsLogged')}</Text></View>
            <View style={styles.cbsNote}>
              <Ionicons name="shield-checkmark" size={12} color={cbsVerified ? colors.green : colors.navy} />
              <Text style={[styles.cbsText, cbsVerified && { color: colors.green }]}>
                {cbsVerified ? 'CBS Verified' : t('pendingCbsVerification')}
              </Text>
            </View>
          </View>
          <View style={styles.receiptAccent} />
        </View>

        <View style={styles.actions}>
          <SecondaryButton onPress={handleShareReceipt} icon="share-outline">{t('shareReceipt')}</SecondaryButton>
          <PrimaryButton onPress={() => goToTab('/(tabs)/tasks')}>{t('returnToTasks')}</PrimaryButton>
          <TouchableOpacity onPress={() => goToTab('/(tabs)/collect')} style={styles.newButton}><Ionicons name="refresh" size={14} color={colors.gray500} /><Text style={styles.newText}>{t('newCollection')}</Text></TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md, paddingBottom: 80 },
  successHeader: { alignItems: 'center', paddingVertical: spacing.lg },
  successIcon: { width: 64, height: 64, borderRadius: 9999, backgroundColor: colors.greenLight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  successTitle: { fontSize: fontSize['4xl'], fontWeight: 'bold', color: colors.gray800, marginBottom: spacing.sm },
  receiptCard: { backgroundColor: colors.white, borderRadius: borderRadius.xl, overflow: 'hidden', borderWidth: 1, borderColor: colors.gray100, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  receiptAccent: { height: 6, backgroundColor: colors.navy },
  receiptBody: { padding: spacing.lg, gap: spacing.sm },
  receiptIdRow: { flexDirection: 'row', justifyContent: 'space-between' },
  receiptIdLabel: { fontSize: fontSize.sm, color: colors.gray400 },
  receiptId: { fontSize: fontSize.md, fontFamily: 'monospace', fontWeight: 'bold', color: colors.navy },
  divider: { height: 1, backgroundColor: colors.gray100 },
  amountSection: { alignItems: 'center', paddingVertical: spacing.sm },
  amountLabel: { fontSize: fontSize.sm, color: colors.gray400, marginBottom: 4 },
  amountValue: { fontSize: 32, fontWeight: 'bold', color: colors.navy },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  receiptLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  receiptRowLabel: { fontSize: fontSize.sm, color: colors.gray500 },
  receiptRowValue: { fontSize: fontSize.base, fontWeight: '500', color: colors.gray800 },
  gpsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  gpsText: { fontSize: fontSize.sm, color: '#059669' },
  cbsNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.xs, paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.gray100 },
  cbsText: { fontSize: fontSize.sm, color: colors.navy },
  actions: { gap: spacing.sm },
  newButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 4 },
  newText: { fontSize: fontSize.md, fontWeight: '600', color: colors.gray500 },
});
