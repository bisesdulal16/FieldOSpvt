import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../constants';
import { useFieldOSStore } from '../store/useFieldOSStore';
import { AppHeader } from '../components/fieldos/AppHeader';
import { SyncChip } from '../components/fieldos/SyncChip';
import { StatusChip } from '../components/fieldos/StatusChip';
import { PrimaryButton } from '../components/fieldos/PrimaryButton';
import { SecondaryButton } from '../components/fieldos/SecondaryButton';
import {
  getPendingGroupedByType,
  getFailedEvents,
  getPendingCount,
  getTotalCount,
  type SyncQueueEvent,
} from '../db/repositories/syncQueueRepo';
import { formatLastSyncTime, cleanupForDemo } from '../services/syncService';
import { useTranslation } from '../i18n';

// Display config for each event type
const TYPE_CONFIG: Record<string, { label: string; labelNe: string; icon: keyof typeof Ionicons.glyphMap; color: string; tKey?: string }> = {
  visit_checkin: { label: 'Visit Check-ins', labelNe: 'भेट चेक-इन', icon: 'location-outline', color: colors.navy, tKey: 'typeVisitCheckins' },
  collection: { label: 'Collections', labelNe: 'संकलन', icon: 'document-text-outline', color: colors.green, tKey: 'typeCollections' },
  promise_to_pay: { label: 'Promise-to-Pay', labelNe: 'प्रतिबद्धता', icon: 'calendar-outline', color: colors.orange, tKey: 'typePromiseToPay' },
  center_meeting: { label: 'Center Meetings', labelNe: 'बैठक', icon: 'people-outline', color: '#7C3AED', tKey: 'typeCenterMeetings' },
  end_of_day_report: { label: 'EOD Reports', labelNe: 'EOD प्रतिवेदन', icon: 'clipboard-outline', color: colors.navyLight, tKey: 'typeEodReports' },
  audit_event: { label: 'Audit Events', labelNe: 'अडिट', icon: 'shield-outline', color: colors.gray500, tKey: 'typeAuditEvents' },
  kyc_document: { label: 'KYC Documents', labelNe: 'केवाईसी कागजात', icon: 'camera-outline', color: '#059669', tKey: 'kycSyncType' },
  voice_note: { label: 'Voice Notes', labelNe: 'आवाज नोट', icon: 'mic-outline', color: '#0B1B3A', tKey: 'voiceNotes' },
};

export default function SyncCenterScreen() {
  const router = useRouter();
  const {
    syncStatus,
    syncItemsReady,
    syncFailedCount,
    syncLastResult,
    lastSyncTime,
    isSyncing,
    triggerSync,
    triggerRetrySync,
    triggerForceFailSync,
    loadSyncStatus,
    language,
  } = useFieldOSStore();
  const isNe = language === 'ne';
  const { t } = useTranslation();

  const [pendingByType, setPendingByType] = useState<Record<string, SyncQueueEvent[]>>({});
  const [failedEvents, setFailedEvents] = useState<SyncQueueEvent[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const refreshData = useCallback(async () => {
    try {
      setRefreshing(true);
      const [grouped, failed, total] = await Promise.all([
        getPendingGroupedByType(),
        getFailedEvents(),
        getTotalCount(),
      ]);

      console.log('[SyncCenter] Refresh data:', {
        pendingGroups: Object.keys(grouped),
        pendingByType: Object.fromEntries(
          Object.entries(grouped).map(([k, v]) => [k, v.length])
        ),
        failedCount: failed.length,
        totalCount: total,
      });

      // Filter out EOD reports from pending — backend doesn't support EOD sync
      const filteredGrouped: Record<string, SyncQueueEvent[]> = {};
      for (const [type, events] of Object.entries(grouped)) {
        if (type === 'end_of_day_report') continue;
        filteredGrouped[type] = events;
      }
      // Filter out EOD reports from failed — show separately if present
      const filteredFailed = failed.filter(e => e.type !== 'end_of_day_report');

      setPendingByType(filteredGrouped);
      setFailedEvents(filteredFailed);
      setTotalCount(total);
      await loadSyncStatus();
    } catch (e) {
      console.error('[SyncCenter] Error refreshing data:', e);
    } finally {
      setRefreshing(false);
    }
  }, [loadSyncStatus]);

  const handleCleanup = useCallback(async () => {
    try {
      await cleanupForDemo();
      refreshData();
    } catch (e) {
      console.error('[SyncCenter] Cleanup error:', e);
    }
  }, [refreshData]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Refresh after sync completes
  useEffect(() => {
    if (!isSyncing && syncLastResult) {
      refreshData();
    }
  }, [isSyncing, syncLastResult, refreshData]);

  const statusConfig = {
    offline: { icon: 'cloud-offline-outline' as const, color: colors.orange, label: t('syncOffline'), bg: colors.orangeLight },
    online: { icon: 'wifi-outline' as const, color: colors.green, label: t('syncOnline'), bg: colors.greenLight },
    syncing: { icon: 'sync-outline' as const, color: colors.navy, label: t('syncSyncing'), bg: colors.navyBg },
    synced: { icon: 'checkmark-circle-outline' as const, color: colors.green, label: t('allSynced'), bg: colors.greenLight },
    failed: { icon: 'close-circle-outline' as const, color: colors.red, label: t('syncFailed'), bg: colors.redLight },
    pending_sync: { icon: 'time-outline' as const, color: colors.orange, label: t('pendingSync'), bg: colors.orangeLight },
  };
  const sc = statusConfig[syncStatus] || statusConfig.offline;

  // Type entries for display
  const typeEntries = Object.entries(pendingByType);

  // Exclude EOD events (unsupported by backend) from displayed counts
  const filteredPendingTotal = typeEntries.reduce((sum, [, events]) => sum + events.length, 0);
  const failedCount = failedEvents.length;
  const totalUnsynced = filteredPendingTotal + failedCount;

  return (
    <View style={styles.container}>
      <AppHeader title={t('syncCenter')} showBack />
      <ScrollView style={styles.body} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.connRow}>
          <Text style={styles.connLabel}>{t('connectionStatus')}</Text>
          <SyncChip status={syncStatus} />
        </View>

        <View style={[styles.statusCard, { backgroundColor: sc.bg, borderColor: `${sc.color}30` }]}>
          {isSyncing ? (
            <ActivityIndicator size="large" color={colors.navy} />
          ) : (
            <View style={[styles.statusIcon, { backgroundColor: `${sc.color}20` }]}>
              <Ionicons name={sc.icon} size={28} color={sc.color} />
            </View>
          )}
          <Text style={styles.statusLabel}>{sc.label}</Text>
          {totalUnsynced > 0 && syncStatus !== 'synced' ? (
            <Text style={styles.statusCount}>
              <Text style={{ fontWeight: 'bold', color: sc.color }}>{totalUnsynced}</Text> {t('itemsReadyToSync')}
            </Text>
          ) : syncStatus === 'synced' ? (
            <Text style={styles.statusDesc}>{t('allRecordsUpToDate')}</Text>
          ) : (
            <Text style={styles.statusDesc}>
              {t('lastSynced')}
              {formatLastSyncTime(lastSyncTime)}
            </Text>
          )}

          {/* Sync buttons */}
          {!isSyncing && (
            <View style={styles.syncButtons}>
              {(syncStatus === 'offline' || syncStatus === 'pending_sync' || syncStatus === 'failed') && (
                <PrimaryButton onPress={triggerSync} icon="refresh" style={styles.syncButton}>
                  {t('syncNow')}
                </PrimaryButton>
              )}
              {syncFailedCount > 0 && syncStatus === 'failed' && (
                <SecondaryButton onPress={triggerRetrySync} icon="refresh" style={styles.syncButton}>
                  {t('retryAll')}
                </SecondaryButton>
              )}
            </View>
          )}

          {/* Test: Force failure */}
          {totalUnsynced > 0 && !isSyncing && (
            <TouchableOpacity
              onPress={async () => {
                await triggerForceFailSync();
                refreshData();
              }}
              style={styles.testFailButton}
            >
              <Ionicons name="bug-outline" size={12} color={colors.red} />
              <Text style={styles.testFailText}>{t('testForceFailedSync')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Sync Result Summary */}
        {syncLastResult && !isSyncing && (
          <View style={[styles.resultCard, syncLastResult.failed > 0 ? styles.resultCardFailed : styles.resultCardSuccess]}>
            <Ionicons name={syncLastResult.failed > 0 ? 'alert-circle' : 'checkmark-circle'} size={16} color={syncLastResult.failed > 0 ? colors.red : colors.green} />
            <View style={{ flex: 1 }}>
              <Text style={styles.resultTitle}>
                {syncLastResult.failed > 0
                  ? t('syncResultWithFailures', { s: syncLastResult.succeeded, f: syncLastResult.failed })
                  : t('syncResultSuccess', { s: syncLastResult.succeeded })
                }
              </Text>
              {syncLastResult.results.some(r => !r.success) && syncLastResult.results.filter(r => !r.success).map((r, i: number) => (
                <Text key={i} style={styles.resultError}>{r.error || 'Unknown error'}</Text>
              ))}
            </View>
          </View>
        )}

        {/* Pending items grouped by type */}
        {typeEntries.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="time-outline" size={14} color={colors.orange} />
              <Text style={styles.cardTitle}>{t('waitingToSync')}</Text>
              <Text style={styles.cardCount}>{filteredPendingTotal}</Text>
            </View>
            {typeEntries.map(([type, events]) => {
              const config = TYPE_CONFIG[type] || { label: type, labelNe: type, icon: 'document-outline' as const, color: colors.gray500 };
              return (
                <View key={type} style={styles.syncRow}>
                  <View style={styles.syncLeft}>
                    <Ionicons name={config.icon} size={14} color={config.color} />
                    <Text style={styles.syncLabel}>{config.tKey ? t(config.tKey as any) : config.label}</Text>
                  </View>
                  <View style={styles.syncRight}>
                    <Text style={styles.syncCount}>{events.length}</Text>
                    <Ionicons name="chevron-forward" size={14} color={colors.gray300} />
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Failed items */}
        {failedEvents.length > 0 && (
          <View style={[styles.card, { borderColor: colors.redLight }]}>
            <View style={[styles.cardHeader, { borderBottomColor: colors.redLight }]}>
              <Ionicons name="warning-outline" size={14} color={colors.red} />
              <Text style={styles.cardTitle}>{t('failedItems')}</Text>
              <Text style={[styles.cardCount, { color: colors.red }]}>{failedEvents.length}</Text>
            </View>
            {failedEvents.map(event => {
              const config = TYPE_CONFIG[event.type] || { label: event.type, labelNe: event.type, icon: 'document-outline' as const };
              return (
                <View key={event.id} style={styles.failedRow}>
                  <View style={styles.failedLeft}>
                    <Ionicons name={config.icon as any} size={14} color={colors.red} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.failedLabel}>{TYPE_CONFIG[event.type]?.tKey ? t(TYPE_CONFIG[event.type].tKey as any) : (TYPE_CONFIG[event.type]?.label || event.type)}</Text>
                      {event.lastError && <Text style={styles.failedError}>{event.lastError}</Text>}
                    </View>
                  </View>
                  <View style={styles.failedBadge}>
                    <Text style={styles.failedRetryText}>Retry #{event.retryCount}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Cleanup for pilot demo */}
        {(failedCount > 0 || filteredPendingTotal > 0) && !isSyncing && (
          <TouchableOpacity
            onPress={handleCleanup}
            style={styles.cleanupButton}
          >
            <Ionicons name="sparkles-outline" size={14} color={colors.green} />
            <Text style={styles.cleanupText}>{t('cleanupForDemo')}</Text>
          </TouchableOpacity>
        )}

        {/* Saved Locally */}
        <View style={styles.card}>
          <View style={[styles.cardHeaderGreen, { borderBottomColor: colors.greenBorder }]}>
            <Ionicons name="shield-checkmark" size={14} color={colors.green} />
            <Text style={styles.cardTitle}>{t('savedLocally')}</Text>
          </View>
          <View style={styles.savedRow}>
            <Text style={styles.savedLabel}>{t('totalRecords')}</Text>
            <Text style={styles.savedCount}>{totalCount}</Text>
          </View>
          <View style={styles.savedRow}>
            <Text style={styles.savedLabel}>{t('syncedLabel')}</Text>
            <Text style={[styles.savedCount, { color: colors.green }]}>{Math.max(0, totalCount - totalUnsynced)}</Text>
          </View>
          <View style={styles.savedRow}>
            <Text style={styles.savedLabel}>{t('pending')}</Text>
            <Text style={[styles.savedCount, { color: colors.orange }]}>{filteredPendingTotal}</Text>
          </View>
          <View style={styles.savedRow}>
            <Text style={styles.savedLabel}>{t('failedLabel')}</Text>
            <Text style={[styles.savedCount, { color: colors.red }]}>{failedCount}</Text>
          </View>
          <Text style={styles.savedNote}>{t('allDataEncrypted')}</Text>
        </View>

        <View style={styles.securityNote}>
          <Ionicons name="shield-checkmark" size={14} color={colors.green} />
          <Text style={styles.securityText}>{t('offlineRecordsEncrypted')}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md, paddingBottom: 80 },
  connRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  connLabel: { fontSize: fontSize.base, color: colors.gray600 },
  statusCard: { borderRadius: borderRadius.xl, padding: spacing.xl, alignItems: 'center', borderWidth: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  statusIcon: { width: 56, height: 56, borderRadius: 9999, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  statusLabel: { fontSize: fontSize['4xl'], fontWeight: 'bold', color: colors.gray800, marginBottom: 4 },
  statusCount: { fontSize: fontSize.lg, color: colors.gray600 },
  statusDesc: { fontSize: fontSize.md, color: colors.gray500 },
  syncButtons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, alignItems: 'center' },
  syncButton: { width: 'auto', paddingHorizontal: spacing.xl },
  testFailButton: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: borderRadius.sm, borderWidth: 1, borderColor: colors.redLight, backgroundColor: colors.redLight },
  testFailText: { fontSize: fontSize.xs, color: colors.red },
  resultCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, borderRadius: borderRadius.xl, padding: spacing.md, borderWidth: 1 },
  resultCardSuccess: { borderColor: colors.greenBorder, backgroundColor: colors.greenLight },
  resultCardFailed: { borderColor: colors.redLight, backgroundColor: colors.redLight },
  resultTitle: { fontSize: fontSize.base, fontWeight: '600', color: colors.gray800, flex: 1 },
  resultError: { fontSize: fontSize.xs, color: colors.red, marginTop: 2 },
  card: { backgroundColor: colors.white, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.gray100, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.gray100 },
  cardHeaderGreen: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1 },
  cardTitle: { fontSize: fontSize.base, fontWeight: 'bold', color: colors.gray700, flex: 1 },
  cardCount: { fontSize: fontSize.md, fontWeight: 'bold', color: colors.orange },
  syncRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.gray50 },
  syncLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  syncLabel: { fontSize: fontSize.base, color: colors.gray700 },
  syncRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  syncCount: { fontSize: fontSize.sm, fontWeight: 'bold', color: colors.orange },
  failedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.gray50 },
  failedLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  failedLabel: { fontSize: fontSize.base, fontWeight: '600', color: colors.gray700 },
  failedError: { fontSize: fontSize.xs, color: colors.red, marginTop: 2 },
  failedBadge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 9999, backgroundColor: colors.redLight },
  failedRetryText: { fontSize: fontSize.xs, fontWeight: 'bold', color: colors.red },
  savedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  savedLabel: { fontSize: fontSize.base, color: colors.gray700 },
  savedCount: { fontSize: fontSize.md, fontWeight: 'bold', color: colors.navy },
  savedNote: { fontSize: fontSize.xs, color: colors.gray400, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  securityNote: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.greenBorder, backgroundColor: colors.greenLight },
  securityText: { fontSize: fontSize.sm, color: '#047857', flex: 1 },
  cleanupButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginVertical: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.greenBorder, backgroundColor: colors.greenLight },
  cleanupText: { fontSize: fontSize.base, fontWeight: '600', color: colors.green },
});
