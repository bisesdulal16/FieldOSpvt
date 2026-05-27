import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../constants';
import { useFieldOSStore } from '../store/useFieldOSStore';
import { AppHeader } from '../components/fieldos/AppHeader';
import { StatusChip } from '../components/fieldos/StatusChip';
import {
  getAllAuditEvents,
  getTodayAuditEvents,
  getAuditCount,
  getAuditCountByAction,
} from '../db/repositories/auditRepo';
import type { AuditEvent } from '../types';
import { AUDIT_ACTION_CONFIG, type AuditActionType } from '../types';
import { useTranslation } from '../i18n';

type DateFilter = 'today' | 'all' | 'week';

const DATE_FILTERS: { key: DateFilter; label: string; labelNe: string; tKey: string }[] = [
  { key: 'today', label: 'Today', labelNe: 'आज', tKey: 'filterToday' },
  { key: 'all', label: 'All', labelNe: 'सबै', tKey: 'filterAll' },
  { key: 'week', label: '7 Days', labelNe: '७ दिन', tKey: 'filter7Days' },
];

export default function AuditLogsScreen() {
  const router = useRouter();
  const { language } = useFieldOSStore();
  const isNe = language === 'ne';
  const { t } = useTranslation();

  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [localCount, setLocalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState<DateFilter>('today');

  const loadEvents = useCallback(async () => {
    try {
      setLoading(true);
      let data: AuditEvent[];
      if (dateFilter === 'today') {
        data = await getTodayAuditEvents();
      } else if (dateFilter === 'week') {
        const all = await getAllAuditEvents(200);
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        data = all.filter(e => new Date(e.timestamp) >= weekAgo);
      } else {
        data = await getAllAuditEvents(200);
      }
      setEvents(data);

      const count = await getAuditCount();
      setTotalCount(count);
      setLocalCount(data.filter(e => e.syncStatus === 'local').length);
    } catch {
      // DB not ready
    } finally {
      setLoading(false);
    }
  }, [dateFilter]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const formatTime = (iso: string) => {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getActionConfig = (actionType: string) => {
    const config = AUDIT_ACTION_CONFIG[actionType as AuditActionType];
    if (config) return config;
    return { label: actionType, labelNe: actionType, icon: 'document-outline' as const, color: colors.gray500, verification: 'not_required' as const };
  };

  const getVerificationChip = (status?: string) => {
    if (!status || status === 'not_required') return null;
    if (status === 'verified') return <StatusChip label={t('verificationChip')} variant="verified" />;
    return <StatusChip label={t('failedChip')} variant="warning" />;
  };

  const getSyncChip = (syncStatus: string) => {
    if (syncStatus === 'synced') {
      return <StatusChip label={t('syncedChip')} variant="success" />;
    }
    return <StatusChip label={t('localChip')} variant="sync" />;
  };

  return (
    <View style={styles.container}>
      <AppHeader title={t('auditLogs')} showBack />

      {/* Summary header */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{totalCount}</Text>
            <Text style={styles.summaryLabel}>{t('totalEvents')}</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: colors.orange }]}>{localCount}</Text>
            <Text style={styles.summaryLabel}>{t('localOnly')}</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: colors.green }]}>{Math.max(0, totalCount - localCount)}</Text>
            <Text style={styles.summaryLabel}>{t('synced')}</Text>
          </View>
        </View>
      </View>

      {/* Date filter */}
      <View style={styles.filterRow}>
        {DATE_FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            onPress={() => setDateFilter(f.key)}
            style={[styles.filterChip, dateFilter === f.key && styles.filterChipActive]}
          >
            <Text style={[styles.filterText, dateFilter === f.key && styles.filterTextActive]}>
              {t(f.tKey as any)}
            </Text>
          </TouchableOpacity>
        ))}
        <View style={{ flex: 1 }} />
        <StatusChip
          label={`${events.length} ${t('entries')}`}
          variant="info"
        />
      </View>

      {/* Event list */}
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={undefined}
      >
        {loading ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="time-outline" size={32} color={colors.gray300} />
            <Text style={styles.emptyText}>{t('loading')}</Text>
          </View>
        ) : events.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIcon}>
              <Ionicons name="shield-outline" size={28} color={colors.gray300} />
            </View>
            <Text style={styles.emptyTitle}>{t('noAuditEvents')}</Text>
            <Text style={styles.emptyDesc}>
              {t('auditAutoCreated')}
            </Text>
          </View>
        ) : (
          events.map((event) => {
            const config = getActionConfig(event.actionType);
            return (
              <View key={event.id} style={styles.eventCard}>
                <View style={styles.eventHeader}>
                  <View style={styles.eventIconBox}>
                    <Ionicons name={config.icon as any} size={14} color={config.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.eventAction}>
                      {isNe ? config.labelNe : config.label}
                    </Text>
                    <Text style={styles.eventMeta}>
                      {event.userId} · {event.deviceId}
                    </Text>
                  </View>
                  <View style={styles.eventChips}>
                    {getVerificationChip(event.verificationStatus)}
                    {getSyncChip(event.syncStatus)}
                  </View>
                </View>

                <View style={styles.eventBody}>
                  {/* Time */}
                  <View style={styles.eventTimeRow}>
                    <Ionicons name="time-outline" size={10} color={colors.gray400} />
                    <Text style={styles.eventTime}>{formatTime(event.timestamp)}</Text>
                  </View>

                  {/* Entity info */}
                  {event.entityType && (
                    <View style={styles.eventEntityRow}>
                      <Ionicons name="pricetags-outline" size={10} color={colors.gray400} />
                      <Text style={styles.eventEntityText}>
                        {event.entityType}{event.entityId ? ` #${event.entityId}` : ''}
                      </Text>
                    </View>
                  )}

                  {/* Metadata preview */}
                  {event.metadata && (
                    <View style={styles.eventMetadata}>
                      <Ionicons name="code-outline" size={10} color={colors.gray400} />
                      <Text style={styles.eventMetadataText} numberOfLines={1}>
                        {event.metadata.length > 80 ? event.metadata.substring(0, 80) + '...' : event.metadata}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Audit ID footer */}
                <View style={styles.eventFooter}>
                  <Text style={styles.eventId}>{event.id}</Text>
                  <Text style={styles.eventBranch}>{event.branchId}</Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm, paddingBottom: 80 },

  // Summary
  summaryCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.gray100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  summaryItem: { alignItems: 'center' },
  summaryValue: { fontSize: fontSize['4xl'], fontWeight: 'bold', color: colors.navy },
  summaryLabel: { fontSize: fontSize.xs, color: colors.gray500, marginTop: 2 },
  summaryDivider: { width: 1, height: 32, backgroundColor: colors.gray100 },

  // Filters
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  filterChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: colors.gray200,
  },
  filterChipActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  filterText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.gray500 },
  filterTextActive: { color: colors.white },

  // Event card
  eventCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.gray100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
    overflow: 'hidden',
  },
  eventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  eventIconBox: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.gray50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventAction: { fontSize: fontSize.base, fontWeight: '600', color: colors.gray800 },
  eventMeta: { fontSize: fontSize.xs, color: colors.gray400 },
  eventChips: { flexDirection: 'row', gap: 4 },

  eventBody: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: 4,
  },
  eventTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  eventTime: { fontSize: fontSize.xs, color: colors.gray500 },
  eventEntityRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  eventEntityText: { fontSize: fontSize.xs, color: colors.gray500 },
  eventMetadata: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.gray50,
    borderRadius: borderRadius.sm,
  },
  eventMetadataText: { fontSize: fontSize.xs, color: colors.gray400, flex: 1, fontFamily: 'monospace' },

  eventFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.gray50,
  },
  eventId: { fontSize: 9, color: colors.gray300, fontFamily: 'monospace' },
  eventBranch: { fontSize: 9, color: colors.gray300 },

  // Empty state
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingTop: 48 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 9999,
    backgroundColor: colors.gray50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '600', color: colors.gray500 },
  emptyDesc: { fontSize: fontSize.sm, color: colors.gray400, textAlign: 'center', maxWidth: 260, marginTop: spacing.sm },
  emptyText: { fontSize: fontSize.sm, color: colors.gray400, marginTop: spacing.sm },
});
