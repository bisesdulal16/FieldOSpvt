import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../../constants';
import { useFieldOSStore } from '../../store/useFieldOSStore';
import { AppHeader } from '../../components/fieldos/AppHeader';
import { StatusChip } from '../../components/fieldos/StatusChip';
import { ClientTaskCard } from '../../components/fieldos/ClientTaskCard';
import { SectionHeader } from '../../components/fieldos/SectionHeader';
import { AIRecommendationCard } from '../../components/fieldos/AIRecommendationCard';
import { useTranslation } from '../../i18n';
import { fetchAssignedTasks } from '../../services/taskService';
import type { TaskAssignment } from '../../types/api';
import type { StatusVariant } from '../../types';

const FILTERS = [
  { key: 'all', tKey: 'filterAllDue' as const },
  { key: 'overdue', tKey: 'overdue' as const },
  { key: 'today', tKey: 'filterDueToday' as const },
  { key: 'promise', tKey: 'promiseDue' as const },
  { key: 'high-value', tKey: 'filterHighValue' as const },
  { key: 'sync', tKey: 'pendingSync' as const },
];

function mapTaskToClientCard(task: TaskAssignment) {
  if (!task) return null;

  console.log('[Tasks] raw task item:', JSON.stringify(task));

  const raw = task as any;
  const clientName = task.clientName || raw.client_name || null;
  const memberId = task.clientMemberId || raw.member_id || null;
  const rawAmount = (task.amount ?? raw.amount) || 0;
  const dueAmt = typeof rawAmount === 'number' ? rawAmount : Number(rawAmount);
  const safeDue = isNaN(dueAmt) ? 0 : dueAmt;

  let status: StatusVariant = 'due-today';
  let statusLabel = 'Due Today';
  let reason = task.reason || 'Regular weekly installment';

  if (task.overdueDays && task.overdueDays > 0) {
    status = 'overdue';
    statusLabel = 'Overdue';
    reason = `${task.overdueDays} days overdue`;
  } else if (task.priority === 'high' && safeDue >= 10000) {
    status = 'high-value';
    statusLabel = 'High Value';
    reason = 'Due amount above NPR 10,000';
  } else if (task.taskType === 'follow-up') {
    status = 'promise';
    statusLabel = 'Follow-up';
    reason = 'Requires follow-up visit';
  }

  const safeName = clientName || (memberId ? `Client #${memberId}` : 'Unknown Client');

  return {
    name: safeName,
    memberId: memberId || String(task.clientId || ''),
    center: raw.center_name || raw.center || raw.centerName || '',
    ward: raw.ward || '',
    dueAmount: `NPR ${safeDue.toLocaleString()}`,
    status,
    statusLabel,
    reason,
    _task: task,
    _dueAmt: safeDue,
  };
}

export default function DueCollectionsScreen() {
  const router = useRouter();
  const { activeFilter, setActiveFilter, setSelectedClient } = useFieldOSStore();
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<TaskAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const loadTasks = useCallback(async () => {
    try {
      setLoading(true);
      const result = await fetchAssignedTasks();
      if (result.success) {
        setTasks(result.data);
      }
    } catch (err) {
      console.warn('[Tasks] Failed to load tasks:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const clientCards = tasks.map(mapTaskToClientCard).filter((c): c is NonNullable<typeof c> => c !== null);
  const totalPending = tasks.reduce((sum, t) => sum + (t.amount || 0), 0);
  console.log('[Tasks] loaded', clientCards.length, 'valid tasks from', tasks.length, 'raw');

  const byFilter = activeFilter === 'all'
    ? clientCards
    : clientCards.filter(c => {
        if (activeFilter === 'overdue') return c.status === 'overdue';
        if (activeFilter === 'today') return c.status === 'due-today';
        if (activeFilter === 'promise') return c.status === 'promise';
        if (activeFilter === 'high-value') return c.status === 'high-value';
        if (activeFilter === 'sync') return false;
        return true;
      });

  // Text search on top of the active filter — match client name or member ID.
  const q = searchQuery.trim().toLowerCase();
  const filteredClients = q
    ? byFilter.filter(c =>
        c.name.toLowerCase().includes(q) || String(c.memberId).toLowerCase().includes(q)
      )
    : byFilter;

  return (
    <View style={styles.container}>
      <View style={styles.headerBg}>
        <AppHeader title={t('dueCollections')} />
        <View style={styles.summarySection}>
          <View style={styles.summaryRow}>
            <View>
              <Text style={styles.totalAmount}>NPR {totalPending.toLocaleString()}</Text>
              <Text style={styles.totalLabel}>{t('totalPendingAmount')}</Text>
            </View>
            <View style={styles.divider} />
            <View>
              <Text style={styles.totalCount}>{filteredClients.length}</Text>
              <Text style={styles.totalLabel}>{t('totalClients')}</Text>
            </View>
          </View>

          <View style={styles.searchBar}>
            <Ionicons name="search" size={14} color={colors.gray400} />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t('searchClients')}
              placeholderTextColor={colors.gray400}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle" size={16} color={colors.gray400} />
              </TouchableOpacity>
            )}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
            {FILTERS.map(f => (
              <TouchableOpacity
                key={f.key}
                onPress={() => setActiveFilter(f.key)}
                style={[styles.filterChip, activeFilter === f.key && styles.filterChipActive]}
              >
                <Text style={[styles.filterText, activeFilter === f.key && styles.filterTextActive]}>{t(f.tKey)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <TouchableOpacity style={styles.registerBtn} onPress={() => router.push('/register-borrower')}>
            <Ionicons name="person-add" size={16} color={colors.white} />
            <Text style={styles.registerBtnText}>{t('registerBorrower')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.navy} />
            <Text style={styles.loadingText}>{t('loading')}</Text>
          </View>
        ) : (
          <>
            {tasks.length > 0 && tasks[0] && (
              <AIRecommendationCard
                title={t('recommendedFirst')}
                reason={t('reasonPromiseOverdue')}
                clientName={tasks[0]?.clientName || (tasks[0] as any)?.client_name || `Client #${(tasks[0] as any)?.client_id || '?'}`}
                action={t('startVisit')}
                onAction={() => {
                  const t0 = tasks[0];
                  if (!t0) return;
                  const raw = t0 as any;
                  const due = typeof (t0.amount ?? raw.amount) === 'number' ? (t0.amount ?? raw.amount) : Number(raw.amount ?? 0);
                  console.log('[Tasks] AI card action, first task clientName:', t0?.clientName || raw?.client_name || 'N/A');
                  setSelectedClient({ id: String(t0.clientId), name: t0.clientName || raw.client_name, memberId: t0.clientMemberId || raw.member_id, clientId: t0.clientId, taskId: t0.id, dueAmount: due });
                  router.push('/client-detail');
                }}
              />
            )}

            {filteredClients.map(client => (
              <ClientTaskCard
                key={`${client._task?.id || 'unknown'}-${client.memberId || 'unknown'}`}
                {...client}
                clientId={client._task?.clientId}
                taskId={client._task?.id}
                dueValue={client._dueAmt}
                onStartVisit={() => {
                  const raw = client._task as any;
                  const due = typeof (client._task?.amount ?? raw.amount) === 'number' ? (client._task?.amount ?? raw.amount) : Number(raw.amount ?? 0);
                  setSelectedClient({ id: client.memberId, name: client.name, memberId: client.memberId, clientId: client._task?.clientId, taskId: client._task?.id, dueAmount: due });
                  router.push('/visit-checkin');
                }}
                onCollect={() => {
                  const raw = client._task as any;
                  const due = typeof (client._task?.amount ?? raw.amount) === 'number' ? (client._task?.amount ?? raw.amount) : Number(raw.amount ?? 0);
                  setSelectedClient({ id: client.memberId, name: client.name, memberId: client.memberId, clientId: client._task?.clientId, taskId: client._task?.id, dueAmount: due });
                  router.push('/record-collection');
                }}
              />
            ))}

            {filteredClients.length === 0 && (
              <View style={styles.emptyContainer}>
                <Ionicons name="checkmark-circle" size={48} color={colors.gray300} />
                <Text style={styles.emptyText}>No tasks matching filter</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  headerBg: { backgroundColor: colors.white },
  summarySection: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginBottom: spacing.md },
  totalAmount: { fontSize: fontSize['4xl'], fontWeight: 'bold', color: colors.navy },
  totalLabel: { fontSize: fontSize.sm, color: colors.gray500 },
  divider: { width: 1, height: 32, backgroundColor: colors.gray200 },
  totalCount: { fontSize: fontSize['4xl'], fontWeight: 'bold', color: colors.gray800 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: borderRadius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.gray200, backgroundColor: colors.gray50, marginBottom: spacing.md },
  searchInput: { fontSize: fontSize.md, color: colors.gray800, flex: 1, padding: 0, height: 22 },
  filterRow: { marginBottom: spacing.xs },
  registerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.sm, paddingVertical: spacing.sm, borderRadius: borderRadius.lg, backgroundColor: colors.navy },
  registerBtnText: { fontSize: fontSize.base, fontWeight: '600', color: colors.white },
  filterChip: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 9999, borderWidth: 1, borderColor: colors.gray200, marginRight: 6 },
  filterChipActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  filterText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.gray500 },
  filterTextActive: { color: colors.white },
  body: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md, paddingBottom: 80 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  loadingText: { fontSize: fontSize.md, color: colors.gray500, marginTop: spacing.sm },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyText: { fontSize: fontSize.md, color: colors.gray400, marginTop: spacing.sm },
});
