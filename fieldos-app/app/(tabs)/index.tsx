import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../../constants';
import { useFieldOSStore } from '../../store/useFieldOSStore';
import { AppHeader } from '../../components/fieldos/AppHeader';
import { SyncChip } from '../../components/fieldos/SyncChip';
import { SummaryCard } from '../../components/fieldos/SummaryCard';
import { AIRecommendationCard } from '../../components/fieldos/AIRecommendationCard';
import { StatusChip } from '../../components/fieldos/StatusChip';
import { useTranslation } from '../../i18n';
import { getPriorityQueue, getSuggestions } from '../../services/aiService';
import { getCurrentUser } from '../../services/authService';
import { fetchAnnouncements } from '../../services/announcementService';
import type { PriorityClient, AISuggestion } from '../../services/aiService';
import { fetchAssignedTasks } from '../../services/taskService';
import { startDayWithVerification, captureSelfie } from '../../services/dayStartService';
import type { FaceResult } from '../../services/dayStartService';
import { FaceScanner } from '../../components/fieldos/FaceScanner';
import { isEnrolled, verifyEmbedding, FACE_MATCH_THRESHOLD } from '../../services/faceVerifyService';

// Tuning aid: when EXPO_PUBLIC_FACE_DEBUG=true, every clock-in shows the raw
// similarity score so the threshold can be calibrated on real devices/faces (F4).
const FACE_DEBUG = process.env.EXPO_PUBLIC_FACE_DEBUG === 'true';
// Face clock-in is OFF by default for the pilot (unproven accuracy — the day-start
// selfie is the real control). Set EXPO_PUBLIC_FACE_CLOCKIN=true for tuning builds.
const FACE_CLOCKIN_ENABLED = process.env.EXPO_PUBLIC_FACE_CLOCKIN === 'true';
import { getActivePromises } from '../../db/repositories/promiseToPayRepo';
import { getTotalCollectedToday } from '../../db/repositories/collectionsRepo';
import { query } from '../../db/database';
import { getSetting, setSetting } from '../../db/repositories/settingsRepo';

export default function DashboardScreen() {
  const router = useRouter();
  const {
    dayStarted,
    dayVerifiedAt,
    setSelectedClient,
    syncStatus,
    syncItemsReady,
    syncFailedCount,
    loadSyncStatus,
    startDay,
  } = useFieldOSStore();
  const { t } = useTranslation();
  const totalUnsynced = syncItemsReady + syncFailedCount;
  const [startingDay, setStartingDay] = useState(false);
  const [showFaceScan, setShowFaceScan] = useState(false);

  // Live "time on shift" clock — ticks while the day is active so the officer can
  // see how long they've been working and there's a clear day boundary to end.
  const [elapsed, setElapsed] = useState('');
  useEffect(() => {
    if (!dayStarted) { setElapsed(''); return; }
    let active = true;
    const tick = async () => {
      const iso = await getSetting('day_started_at');
      if (!active || !iso) return;
      const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      setElapsed(h > 0 ? `${h}h ${m}m` : `${m}m`);
    };
    tick();
    const id = setInterval(tick, 60_000); // once a minute is enough for h/m display
    return () => { active = false; clearInterval(id); };
  }, [dayStarted]);

  // Finish start-of-day: capture a selfie for the manager (only when face-match
  // didn't run), then the server checks the officer is on the branch office
  // network (403 if not). Only then does the local day begin.
  const finishDayStart = useCallback(async (face: FaceResult | null) => {
    try {
      const selfie = face ? null : await captureSelfie(); // face scan is the proof when present
      const result = await startDayWithVerification(selfie, face);
      if (result.blocked) {
        Alert.alert(t('dayStartBlockedTitle'), result.message || t('dayStartBlockedMsg'));
        return;
      }
      await startDay();                                 // local day-started state + audit + sync
      if (result.ipVerified) {
        Alert.alert(t('dayStartedTitle'), t('dayStartedVerified'));
      } else if (result.message === 'offline') {
        Alert.alert(t('dayStartedTitle'), t('dayStartedOffline'));
      }
    } finally {
      setStartingDay(false);
    }
  }, [startDay, t]);

  // Real start-of-day: face clock-in first (if enrolled + device can run it),
  // otherwise fall back to plain photo-proof.
  const handleStartDay = useCallback(async () => {
    if (startingDay) return;
    setStartingDay(true);
    if (!FACE_CLOCKIN_ENABLED) {
      // Pilot: skip face-match, use plain selfie photo-proof as the control.
      finishDayStart(null);
      return;
    }
    const enrolled = await isEnrolled();
    if (enrolled) {
      setShowFaceScan(true); // the FaceScanner overlay drives the rest
    } else {
      // Not enrolled yet — offer to set it up; either way don't block the day.
      Alert.alert(t('faceNotEnrolledTitle'), t('faceNotEnrolledMsg'), [
        { text: t('faceEnrollLater'), style: 'cancel', onPress: () => finishDayStart(null) },
        { text: t('faceEnrollNow'), onPress: () => { setStartingDay(false); router.push('/face-enroll'); } },
      ]);
    }
  }, [startingDay, finishDayStart, t, router]);

  // FaceScanner callbacks.
  const handleFaceEmbedding = useCallback(async (embedding: number[]) => {
    setShowFaceScan(false);
    const face = await verifyEmbedding(embedding);
    const scoreLine = `${t('faceScoreLabel')}: ${face.similarity.toFixed(3)}  (${t('faceThresholdLabel')} ${FACE_MATCH_THRESHOLD})`;
    // Tuning mode: show the score on every attempt so the threshold can be calibrated.
    if (FACE_DEBUG) {
      await new Promise<void>((resolve) =>
        Alert.alert(
          face.verified ? t('faceMatchTitle') : t('faceNoMatchTitle'),
          scoreLine,
          [{ text: 'OK', onPress: () => resolve() }],
        ),
      );
    }
    // Face-match is INFORMATIONAL for the pilot (the day-start selfie is the control):
    // record the result + score for the manager, but never block the officer's day on it.
    await finishDayStart(face);
  }, [finishDayStart, t]);

  const handleFaceUnavailable = useCallback(() => {
    setShowFaceScan(false);
    // Device can't run the model → fall back to photo-proof silently.
    finishDayStart(null);
  }, [finishDayStart]);

  const handleFaceCancel = useCallback(() => {
    setShowFaceScan(false);
    setStartingDay(false);
  }, []);

  // AI state
  const [priorityQueue, setPriorityQueue] = useState<PriorityClient[]>([]);
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [officer, setOfficer] = useState<any>(null); // the real logged-in officer
  const [topClient, setTopClient] = useState<PriorityClient | null>(null);
  const [topSuggestion, setTopSuggestion] = useState<AISuggestion | null>(null);
  const [urgentCount, setUrgentCount] = useState(0);

  // Real daily figures computed from the local DB
  const [home, setHome] = useState({ dueClients: 0, overdue: 0, visitsPlanned: 0, visitsCompleted: 0, target: 0, collected: 0, promiseDue: 0 });
  const formatK = (n: number) => (n >= 1000 ? `NPR ${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K` : `NPR ${n}`);

  const loadHomeStats = useCallback(async () => {
    try {
      // Tasks come from the backend (assigned by the manager); collections,
      // visits and promises are created on-device so they read from local DB.
      const res = await fetchAssignedTasks().catch(() => null);
      const tasks: any[] = res && res.success && Array.isArray(res.data) ? res.data : [];
      const ttype = (x: any) => x.task_type ?? x.taskType;
      const prio = (x: any) => String(x.priority ?? '');
      const visitTasks = tasks.filter((x) => ttype(x) === 'visit');
      const target = tasks
        .filter((x) => ttype(x) === 'collection')
        .reduce((a: number, x: any) => a + Number(x.amount ?? x.amount_npr ?? 0), 0);
      const collected = await getTotalCollectedToday();
      const promises = await getActivePromises();
      const visitRows = await query<{ n: number }>("SELECT COUNT(*) as n FROM visit_checkins WHERE date(checked_in_at) = date('now')");
      const overdue = tasks.filter((x) => prio(x) === 'high' || prio(x) === 'urgent').length;
      setHome({
        dueClients: tasks.length,
        overdue,
        visitsPlanned: visitTasks.length,
        visitsCompleted: visitRows[0]?.n ?? 0,
        target,
        collected,
        promiseDue: promises.length,
      });
    } catch { /* offline-first: keep zeros */ }
  }, []);

  const fetchAIData = useCallback(async () => {
    try {
      setAiLoading(true);
      const user = await getCurrentUser();
      if (user) setOfficer(user);
      const officerId = user?.id;

      const [pqResult, sugResult] = await Promise.all([
        getPriorityQueue(officerId),
        getSuggestions(officerId),
      ]);

      if (pqResult.success && pqResult.data) {
        setPriorityQueue(pqResult.data.queue);
        setTopClient(pqResult.data.queue.length > 0 ? pqResult.data.queue[0] : null);
      }
      if (sugResult.success && sugResult.data) {
        setSuggestions(sugResult.data.suggestions);
        setTopSuggestion(sugResult.data.suggestions.length > 0 ? sugResult.data.suggestions[0] : null);
      }
    } catch {
      // Silently fail — AI data is supplementary
    } finally {
      setAiLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnnouncements().then(ann => setUrgentCount(ann.filter((a: any) => a.priority === 'urgent').length)).catch(() => {});
  }, []);

  useEffect(() => {
    loadSyncStatus();
    loadHomeStats();
  }, [loadSyncStatus, loadHomeStats]);

  useEffect(() => {
    if (dayStarted) {
      fetchAIData();
    }
  }, [dayStarted, fetchAIData]);

  // First-run face enrollment: if this officer has never enrolled a reference face,
  // offer it once (with Skip — never hard-blocks the golden path). Without an enrolled
  // template, clock-in has nothing to match against and any face passes, so this is
  // what makes the face feature real. Covers every login path since Home always mounts.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (await getSetting('face_enroll_prompted') === 'true') return;
        if (cancelled || await isEnrolled()) return; // already enrolled
        await setSetting('face_enroll_prompted', 'true', 'boolean');
        Alert.alert(t('faceEnrollPromptTitle'), t('faceEnrollPromptMsg'), [
          { text: t('faceEnrollLater'), style: 'cancel' },
          { text: t('faceEnrollNow'), onPress: () => router.push('/face-enroll') },
        ]);
      } catch { /* enrollment is best-effort — never block Home */ }
    })();
    return () => { cancelled = true; };
  }, [t, router]);

  const quickActions = [
    { label: t('dueList'), icon: 'list-outline' as const, screen: '/tasks' as const },
    { label: t('recordCollection'), icon: 'wallet-outline' as const, screen: '/(tabs)/collect' as const },
    { label: 'Voice Note', icon: 'mic-outline' as const, screen: '/voice-notes' as const },
    { label: 'AI Assistant', icon: 'sparkles-outline' as const, screen: '/ai-assistant' as const },
  ];

  const tierColor = (tier: string) => {
    switch (tier) {
      case 'critical': return colors.red;
      case 'high': return colors.orange;
      case 'medium': return '#D97706';
      case 'low': return colors.green;
      default: return colors.gray400;
    }
  };

  const initials = (name: string) => {
    return (name || '??').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  };

  // Full-screen face clock-in takeover while scanning.
  if (showFaceScan) {
    return (
      <FaceScanner
        mode="verify"
        onEmbedding={handleFaceEmbedding}
        onUnavailable={handleFaceUnavailable}
        onCancel={handleFaceCancel}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerBg}>
        <AppHeader
          title={t('home')}
          rightAction={
            <View style={styles.headerActions}>
              <SyncChip status={syncStatus} />
              <TouchableOpacity
                onPress={() => router.push('/notifications')}
                style={styles.bellButton}
              >
                <Ionicons name="notifications-outline" size={18} color={colors.gray600} />
                {(urgentCount > 0 || totalUnsynced > 0) && (
                  <View style={[styles.badge, urgentCount > 0 && { backgroundColor: colors.red }]}>
                    <Text style={[styles.badgeText, urgentCount > 0 && { color: colors.white }]}>
                      {urgentCount + totalUnsynced}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          }
        />
        <View style={styles.greetingSection}>
          <View>
            <Text style={styles.greeting}>
              {t('greeting')}{officer?.name ? `, ${String(officer.name).split(' ')[0]}` : ''}
            </Text>
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={10} color={colors.gray500} />
              <Text style={styles.locationText}>
                {officer?.branchName || officer?.branch_name || t('branchName')}
              </Text>
            </View>
          </View>
          {dayStarted && (
            <View style={styles.dayStartedRow}>
              <Ionicons name="checkmark-circle" size={10} color={colors.green} />
              <Text style={styles.dayStartedText}>
                {t('dayStarted')} · {dayVerifiedAt}{elapsed ? ` · ${elapsed} ${t('onShift')}` : ''}
              </Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {!dayStarted ? (
          <>
            <View style={styles.startDayCard}>
              <View style={styles.startDayHeader}>
                <Ionicons name="sparkles-outline" size={18} color={colors.white} />
                <Text style={styles.startDayHeaderText}>{t('startFieldWork')}</Text>
              </View>
              <Text style={styles.startDayDesc}>{t('todayPlan')}</Text>
              <View style={styles.verificationNote}>
                <Ionicons name="shield-outline" size={12} color={colors.white} />
                <Text style={styles.verificationNoteText}>{t('identityVerificationRequired')}</Text>
              </View>
              <TouchableOpacity
                onPress={handleStartDay}
                disabled={startingDay}
                activeOpacity={0.8}
                style={styles.startDayButton}
              >
                {startingDay ? (
                  <ActivityIndicator size="small" color={colors.navy} />
                ) : (
                  <Ionicons name="shield-outline" size={18} color={colors.navy} />
                )}
                <Text style={styles.startDayButtonText}>{t('startDayBtn')}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.grid2}>
              <SummaryCard label={t('dueClients')} value={String(home.dueClients)} icon="people-outline" color={colors.orange} />
              <SummaryCard label={t('visitsPlanned')} value={String(home.visitsPlanned)} icon="location-outline" color={colors.navyLight} />
              <SummaryCard label={t('collectionTarget')} value={formatK(home.target)} icon="wallet-outline" color={colors.green} />
              <SummaryCard label={t('promiseDue')} value={String(home.promiseDue)} icon="time-outline" color="#D97706" />
            </View>
          </>
        ) : (
          <>
            {syncStatus === 'offline' && (
              <View style={styles.offlineBanner}>
                <Ionicons name="cloud-outline" size={14} color={colors.orange} />
                <Text style={styles.offlineText}>{t('offlineMsg')}</Text>
              </View>
            )}

            {/* AI Insights Banner */}
            {aiLoading ? (
              <View style={styles.aiLoadingCard}>
                <ActivityIndicator size="small" color={colors.navy} />
                <Text style={styles.aiLoadingText}>Loading AI insights...</Text>
              </View>
            ) : suggestions.length > 0 ? (
              <View style={styles.aiBanner}>
                <View style={styles.aiBannerHeader}>
                  <View style={styles.aiBannerIcon}>
                    <Ionicons name="sparkles" size={14} color={colors.navy} />
                  </View>
                  <Text style={styles.aiBannerTitle}>AI Insights</Text>
                  <View style={styles.aiBannerCount}>
                    <Text style={styles.aiBannerCountText}>{suggestions.length}</Text>
                  </View>
                </View>
                <Text style={styles.aiBannerDesc}>
                  {suggestions.filter(s => s.urgency === 'critical').length} critical, {suggestions.filter(s => s.urgency === 'high').length} high priority
                </Text>
              </View>
            ) : null}

            <View style={styles.grid2}>
              <SummaryCard label={t('dueClients')} value={String(home.dueClients)} icon="people-outline" color={colors.orange} subtext={`${home.overdue} overdue`} />
              <SummaryCard label={t('visitsPlanned')} value={String(home.visitsPlanned)} icon="location-outline" color={colors.navyLight} subtext={`${home.visitsCompleted} completed`} />
              <SummaryCard label={t('collectionTarget')} value={formatK(home.target)} icon="flag-outline" color={colors.green} subtext={`${formatK(home.collected)} done`} />
              <SummaryCard label={t('promiseDue')} value={String(home.promiseDue)} icon="time-outline" color="#D97706" subtext="active" />
            </View>

            <View style={styles.pendingSyncCard}>
              <View style={styles.pendingSyncRow}>
                <View style={styles.pendingSyncLeft}>
                  <Ionicons name="cloud-outline" size={14} color={totalUnsynced > 0 ? colors.orange : colors.green} />
                  <Text style={styles.pendingSyncLabel}>{totalUnsynced > 0 ? t('pendingSync') : t('allSynced')}</Text>
                </View>
                <Text style={[styles.pendingSyncCount, totalUnsynced === 0 && { color: colors.green }]}>{totalUnsynced}</Text>
              </View>
            </View>

            {/* AI Suggested First Visit — real data */}
            {topSuggestion ? (
              <AIRecommendationCard
                title={topSuggestion.title}
                reason={topSuggestion.description}
                clientName={topSuggestion.client_name || undefined}
                action={topSuggestion.urgency === 'critical' ? 'Urgent — Start Visit' : 'Start Visit'}
                onAction={() => {
                  if (topSuggestion.client_id) {
                    setSelectedClient({
                      id: String(topSuggestion.client_id),
                      name: topSuggestion.client_name || 'Unknown',
                      memberId: topSuggestion.member_id || String(topSuggestion.client_id),
                      clientId: topSuggestion.client_id,
                      dueAmount: topSuggestion.due_amount_npr,
                      outstandingBalance: topSuggestion.outstanding_npr,
                    });
                    router.push('/client-detail');
                  }
                }}
              />
            ) : null}

            <Text style={styles.sectionTitle}>{t('quickActions')}</Text>
            <View style={styles.grid2}>
              {quickActions.map((item) => (
                <TouchableOpacity
                  key={item.screen}
                  onPress={() => router.push(item.screen)}
                  style={styles.quickActionCard}
                  activeOpacity={0.9}
                >
                  <View style={styles.quickActionIcon}>
                    <Ionicons name={item.icon} size={16} color={colors.navy} />
                  </View>
                  <Text style={styles.quickActionLabel}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* AI Priority Client — real data */}
            {topClient ? (
              <View style={styles.priorityCard}>
                <View style={styles.priorityHeader}>
                  <Text style={styles.priorityTitle}>AI {t('priorityClient')}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <StatusChip
                      label={topClient.priority_tier}
                      variant={topClient.priority_tier === 'critical' || topClient.npa_risk ? 'overdue' : 'pending'}
                    />
                    <Text style={styles.scoreText}>Score: {topClient.priority_score}</Text>
                  </View>
                </View>
                <View style={styles.priorityBody}>
                  <View style={[styles.priorityAvatar, { backgroundColor: tierColor(topClient.priority_tier) }]}>
                    <Text style={styles.avatarText}>{initials(topClient.client_name)}</Text>
                  </View>
                  <View style={styles.priorityInfo}>
                    <Text style={styles.priorityName}>{topClient.client_name}</Text>
                    <Text style={styles.priorityMeta}>
                      {topClient.member_id} · {topClient.overdue_days}d overdue
                    </Text>
                    <Text style={[styles.priorityAmount, { color: tierColor(topClient.priority_tier) }]}>
                      NPR {Math.round(topClient.due_amount_npr).toLocaleString()}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      setSelectedClient({
                        id: String(topClient.client_id),
                        name: topClient.client_name,
                        memberId: topClient.member_id,
                        clientId: topClient.client_id,
                        dueAmount: topClient.due_amount_npr,
                        outstandingBalance: topClient.outstanding_npr,
                      });
                      router.push('/client-detail');
                    }}
                    style={styles.chevronButton}
                  >
                    <Ionicons name="chevron-forward" size={16} color={colors.gray400} />
                  </TouchableOpacity>
                </View>
                {/* Show top priority factors */}
                {topClient.priority_factors.length > 0 && (
                  <View style={styles.factorsRow}>
                    {topClient.priority_factors.slice(0, 3).map((f, i) => (
                      <View key={i} style={[styles.factorChip, { borderColor: tierColor(f.severity) }]}>
                        <Text style={[styles.factorText, { color: tierColor(f.severity) }]}>
                          +{f.points} {f.label}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.priorityCard}>
                <View style={styles.priorityHeader}>
                  <Text style={styles.priorityTitle}>{t('priorityClient')}</Text>
                </View>
                <View style={styles.priorityBody}>
                  <Ionicons name="checkmark-circle-outline" size={20} color={colors.green} />
                  <Text style={[styles.priorityMeta, { marginLeft: spacing.sm }]}>{t('noPriorityClients')}</Text>
                </View>
              </View>
            )}

            {/* View All Suggestions link */}
            {suggestions.length > 1 && (
              <TouchableOpacity
                onPress={() => router.push('/ai-suggestions')}
                style={styles.viewAllCard}
                activeOpacity={0.9}
              >
                <View style={styles.viewAllLeft}>
                  <View style={styles.viewAllIcon}>
                    <Ionicons name="sparkles-outline" size={16} color={colors.navy} />
                  </View>
                  <View>
                    <Text style={styles.viewAllTitle}>View All AI Suggestions</Text>
                    <Text style={styles.viewAllDesc}>{suggestions.length} actionable recommendations</Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.gray400} />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={() => router.push('/end-of-day')}
              style={styles.endDayCard}
              activeOpacity={0.9}
            >
              <View style={styles.eodLeft}>
                <View style={styles.endDayIcon}>
                  <Ionicons name="power" size={16} color={colors.white} />
                </View>
                <View>
                  <Text style={styles.endDayTitle}>{t('endDayBtn')}</Text>
                  <Text style={styles.endDayDesc}>
                    {t('reviewProgress')}{elapsed ? ` · ${elapsed} ${t('onShift')}` : ''}
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.white} />
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  headerBg: { backgroundColor: colors.white },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  bellButton: { padding: 6, borderRadius: 8, position: 'relative' },
  badge: { position: 'absolute', top: -2, right: -2, width: 16, height: 16, borderRadius: 9999, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 8, fontWeight: 'bold', color: colors.white },
  greetingSection: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  greeting: { fontSize: fontSize.lg, fontWeight: '600', color: colors.gray800 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  locationText: { fontSize: fontSize.sm, color: colors.gray500 },
  dayStartedRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dayStartedText: { fontSize: fontSize.xs, color: colors.gray400 },
  body: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md, paddingBottom: 16 },
  startDayCard: { borderRadius: borderRadius.xl, padding: spacing.xl, backgroundColor: colors.navy },
  startDayHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  startDayHeaderText: { fontSize: fontSize.md, fontWeight: '600', color: colors.white },
  startDayDesc: { fontSize: fontSize.sm, color: `${colors.white}CC`, marginBottom: spacing.sm },
  verificationNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.md },
  verificationNoteText: { fontSize: fontSize.xs, color: `${colors.white}B3` },
  startDayButton: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderRadius: borderRadius.lg, backgroundColor: colors.white, marginTop: spacing.sm },
  startDayButtonText: { fontSize: fontSize.lg, fontWeight: '700', color: colors.navy },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  offlineBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: borderRadius.lg, padding: spacing.sm, backgroundColor: colors.orangeLight },
  offlineText: { fontSize: fontSize.sm, color: colors.gray600, flex: 1 },
  pendingSyncCard: { backgroundColor: colors.white, borderRadius: borderRadius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.gray100 },
  pendingSyncRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pendingSyncLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pendingSyncLabel: { fontSize: fontSize.base, fontWeight: '600', color: colors.gray700 },
  pendingSyncCount: { fontSize: fontSize.lg, fontWeight: 'bold', color: colors.orange },
  sectionTitle: { fontSize: fontSize.base, fontWeight: 'bold', color: colors.gray700 },
  quickActionCard: { backgroundColor: colors.white, borderRadius: borderRadius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.gray100, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1, minWidth: '45%', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  quickActionIcon: { width: 32, height: 32, borderRadius: borderRadius.sm, backgroundColor: colors.navyBg, alignItems: 'center', justifyContent: 'center' },
  quickActionLabel: { fontSize: fontSize.base, fontWeight: '600', color: colors.gray700 },
  priorityCard: { backgroundColor: colors.white, borderRadius: borderRadius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.gray100 },
  priorityHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  priorityTitle: { fontSize: fontSize.base, fontWeight: 'bold', color: colors.gray700 },
  scoreText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.gray500 },
  priorityBody: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  priorityAvatar: { width: 40, height: 40, borderRadius: 9999, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: fontSize.md, fontWeight: 'bold', color: colors.white },
  priorityInfo: { flex: 1 },
  priorityName: { fontSize: fontSize.md, fontWeight: '600', color: colors.gray800 },
  priorityMeta: { fontSize: fontSize.sm, color: colors.gray500 },
  priorityAmount: { fontSize: fontSize.lg, fontWeight: 'bold', marginTop: 2 },
  chevronButton: { padding: spacing.sm, borderRadius: borderRadius.sm },
  factorsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.gray100 },
  factorChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 9999, borderWidth: 1, backgroundColor: colors.gray50 },
  factorText: { fontSize: 9, fontWeight: '500' },
  viewAllCard: { backgroundColor: colors.white, borderRadius: borderRadius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.gray100, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  viewAllLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  viewAllIcon: { width: 32, height: 32, borderRadius: borderRadius.sm, backgroundColor: colors.navyBg, alignItems: 'center', justifyContent: 'center' },
  viewAllTitle: { fontSize: fontSize.base, fontWeight: '600', color: colors.gray700 },
  viewAllDesc: { fontSize: fontSize.xs, color: colors.gray400 },
  eodCard: { backgroundColor: colors.white, borderRadius: borderRadius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.gray100, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eodLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  eodIcon: { width: 32, height: 32, borderRadius: borderRadius.sm, backgroundColor: `${colors.navy}15`, alignItems: 'center', justifyContent: 'center' },
  eodTitle: { fontSize: fontSize.base, fontWeight: '600', color: colors.gray700 },
  eodDesc: { fontSize: fontSize.xs, color: colors.gray400 },
  // Clear "End Day" action — navy card so it reads as the deliberate end-of-shift boundary.
  endDayCard: { backgroundColor: colors.navy, borderRadius: borderRadius.lg, padding: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  endDayIcon: { width: 32, height: 32, borderRadius: borderRadius.sm, backgroundColor: `${colors.white}22`, alignItems: 'center', justifyContent: 'center' },
  endDayTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.white },
  endDayDesc: { fontSize: fontSize.xs, color: `${colors.white}CC` },
  aiLoadingCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: colors.navyBg },
  aiLoadingText: { fontSize: fontSize.sm, color: colors.navy },
  aiBanner: { borderRadius: borderRadius.lg, padding: spacing.md, backgroundColor: colors.navyBg, borderWidth: 1, borderColor: `${colors.navy}20` },
  aiBannerHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  aiBannerIcon: { width: 28, height: 28, borderRadius: borderRadius.sm, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  aiBannerTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.navy, flex: 1 },
  aiBannerCount: { width: 20, height: 20, borderRadius: 9999, backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center' },
  aiBannerCountText: { fontSize: 10, fontWeight: 'bold', color: colors.white },
  aiBannerDesc: { fontSize: fontSize.xs, color: colors.gray500, marginTop: 2 },
});
