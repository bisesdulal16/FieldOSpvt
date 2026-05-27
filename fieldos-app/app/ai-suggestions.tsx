import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../constants';
import { AppHeader } from '../components/fieldos/AppHeader';
import { useFieldOSStore } from '../store/useFieldOSStore';
import { useTranslation } from '../i18n';
import { getSuggestions } from '../services/aiService';
import { getCurrentUser } from '../services/authService';
import type { AISuggestion } from '../services/aiService';

export default function AISuggestionsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { setSelectedClient } = useFieldOSStore();
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const user = await getCurrentUser();
      const result = await getSuggestions(user?.id);
      if (result.success && result.data) {
        setSuggestions(result.data.suggestions);
      } else {
        setError(result.error || 'Failed to load suggestions');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = filter === 'all' ? suggestions : suggestions.filter(s => s.category === filter);
  const urgencyOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...filtered].sort((a, b) => (urgencyOrder[a.urgency] ?? 4) - (urgencyOrder[b.urgency] ?? 4));

  const urgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'critical': return colors.red;
      case 'high': return colors.orange;
      case 'medium': return '#D97706';
      default: return colors.green;
    }
  };

  const urgencyBg = (urgency: string) => {
    switch (urgency) {
      case 'critical': return `${colors.red}15`;
      case 'high': return `${colors.orange}15`;
      case 'medium': return '#FEF3C7';
      default: return `${colors.green}15`;
    }
  };

  const categoryIcon = (cat: string) => {
    switch (cat) {
      case 'overdue': return 'alert-circle-outline';
      case 'ptp': return 'time-outline';
      case 'par': return 'trending-down-outline';
      case 'missing_data': return 'document-text-outline';
      default: return 'information-circle-outline';
    }
  };

  return (
    <View style={styles.container}>
      <AppHeader
        title={t('aiSuggestionsTitle')}
        leftAction={
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={20} color={colors.navy} />
          </TouchableOpacity>
        }
      />

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        {/* Disclaimer */}
        <View style={styles.disclaimerCard}>
          <Ionicons name="shield-checkmark-outline" size={14} color={colors.navy} />
          <Text style={styles.disclaimerText}>
            {t('aiDisclaimer')}
          </Text>
        </View>

        {/* Category Filters */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
          {[
            { key: 'all', label: 'All' },
            { key: 'overdue', label: 'Overdue' },
            { key: 'ptp', label: 'PTP' },
            { key: 'par', label: 'PAR' },
            { key: 'missing_data', label: 'Data' },
          ].map(f => (
            <TouchableOpacity
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, filter === f.key && styles.filterChipTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {loading ? (
          <View style={styles.centerContent}>
            <ActivityIndicator size="large" color={colors.navy} />
            <Text style={styles.loadingText}>{t('aiLoading')}</Text>
          </View>
        ) : error ? (
          <View style={styles.centerContent}>
            <Ionicons name="cloud-offline-outline" size={40} color={colors.gray400} />
            <Text style={styles.errorText}>{t('aiFailedLoad')}</Text>
            <TouchableOpacity onPress={fetchData} style={styles.retryButton}>
              <Text style={styles.retryText}>{t('retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : sorted.length === 0 ? (
          <View style={styles.centerContent}>
            <Ionicons name="checkmark-circle-outline" size={40} color={colors.green} />
            <Text style={styles.emptyText}>{t('aiNoSuggestions')}</Text>
          </View>
        ) : (
          sorted.map((item, idx) => (
            <TouchableOpacity
              key={item.id || idx}
              style={styles.card}
              activeOpacity={0.9}
              onPress={() => {
                if (item.client_id) {
                  setSelectedClient({
                    id: String(item.client_id),
                    name: item.client_name || 'Unknown',
                    memberId: item.member_id || String(item.client_id),
                    clientId: item.client_id,
                    dueAmount: item.due_amount_npr,
                    outstandingBalance: item.outstanding_npr,
                  });
                  router.push('/client-detail');
                }
              }}
            >
              <View style={styles.cardHeader}>
                <View style={[styles.urgencyBadge, { backgroundColor: urgencyBg(item.urgency) }]}>
                  <View style={[styles.urgencyDot, { backgroundColor: urgencyColor(item.urgency) }]} />
                  <Text style={[styles.urgencyText, { color: urgencyColor(item.urgency) }]}>
                    {item.urgency.toUpperCase()}
                  </Text>
                </View>
                <View style={styles.categoryBadge}>
                  <Ionicons name={categoryIcon(item.category) as any} size={12} color={colors.gray500} />
                  <Text style={styles.categoryText}>{item.category.replace('_', ' ')}</Text>
                </View>
              </View>

              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardDesc}>{item.description}</Text>

              {item.client_name && (
                <View style={styles.clientRow}>
                  <Ionicons name="person-outline" size={12} color={colors.gray400} />
                  <Text style={styles.clientText}>{item.client_name}</Text>
                  {item.member_id && <Text style={styles.memberText}>{item.member_id}</Text>}
                </View>
              )}

              <View style={styles.cardFooter}>
                <Text style={styles.ruleText}>{t('aiRuleLabel')}: {item.ai_rule}</Text>
                <Ionicons name="chevron-forward" size={14} color={colors.gray400} />
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  backButton: { padding: spacing.sm, borderRadius: borderRadius.sm },
  disclaimerCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: `${colors.navy}08`, borderWidth: 1, borderColor: `${colors.navy}15`, marginBottom: spacing.md },
  disclaimerText: { flex: 1, fontSize: fontSize.xs, color: colors.navy, lineHeight: 16 },
  filterScroll: { marginBottom: spacing.md },
  filterChip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: 9999, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.gray200, marginRight: spacing.sm },
  filterChipActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  filterChipText: { fontSize: fontSize.sm, fontWeight: '500', color: colors.gray600 },
  filterChipTextActive: { color: colors.white },
  centerContent: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60 },
  loadingText: { fontSize: fontSize.sm, color: colors.gray400, marginTop: spacing.md },
  errorText: { fontSize: fontSize.sm, color: colors.gray500, marginTop: spacing.sm, textAlign: 'center' },
  emptyText: { fontSize: fontSize.sm, color: colors.green, marginTop: spacing.sm, textAlign: 'center', fontWeight: '500' },
  retryButton: { marginTop: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: borderRadius.lg, backgroundColor: colors.navy },
  retryText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.white },
  card: { backgroundColor: colors.white, borderRadius: borderRadius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.gray100, marginBottom: spacing.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  urgencyBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 9999 },
  urgencyDot: { width: 6, height: 6, borderRadius: 9999 },
  urgencyText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  categoryBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: borderRadius.sm, backgroundColor: colors.gray50 },
  categoryText: { fontSize: 10, fontWeight: '500', color: colors.gray500, textTransform: 'capitalize' },
  cardTitle: { fontSize: fontSize.base, fontWeight: '600', color: colors.gray800, marginBottom: 4 },
  cardDesc: { fontSize: fontSize.sm, color: colors.gray500, lineHeight: 18, marginBottom: spacing.sm },
  clientRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.sm },
  clientText: { fontSize: fontSize.sm, fontWeight: '500', color: colors.gray700 },
  memberText: { fontSize: fontSize.sm, color: colors.gray400 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.gray100 },
  ruleText: { fontSize: 10, color: colors.gray400, fontFamily: 'monospace' },
});
