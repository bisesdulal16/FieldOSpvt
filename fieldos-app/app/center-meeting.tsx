// Standalone Center Meeting screen — pushed on Stack from dashboard quick actions.
// The tab version lives at app/(tabs)/meetings.tsx.
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../constants';
import { useTranslation } from '../i18n';
import { AppHeader } from '../components/fieldos/AppHeader';
import { StatusChip } from '../components/fieldos/StatusChip';
import { PrimaryButton } from '../components/fieldos/PrimaryButton';
import { SecondaryButton } from '../components/fieldos/SecondaryButton';
import { enqueueSyncEvent } from '../db/repositories/syncQueueRepo';
import { auditMeetingCompleted } from '../services/auditService';
import { fetchClients } from '../services/clientService';

interface MeetingMember { name: string; id: string; status: 'present' | 'paid' | 'absent' | 'follow-up' }

export default function CenterMeetingScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [members, setMembers] = useState<MeetingMember[]>([]);
  const [memberStatuses, setMemberStatuses] = useState<Record<string, MeetingMember['status']>>({});
  const [completed, setCompleted] = useState(false);

  type Status = MeetingMember['status'];

  // Load the officer's real clients as the meeting roster (no fake attendees).
  useEffect(() => {
    fetchClients().then((res) => {
      if (res.success && Array.isArray(res.data)) {
        const roster: MeetingMember[] = res.data.map((c: any) => ({
          name: c.name,
          id: String(c.member_id ?? c.memberId ?? c.id),
          status: 'present',
        }));
        setMembers(roster);
        setMemberStatuses(Object.fromEntries(roster.map((m) => [m.id, m.status])));
      }
    }).catch(() => {});
  }, []);

  const updateStatus = (id: string, status: string) => {
    setMemberStatuses(prev => ({ ...prev, [id]: status as Status }));
  };

  const markAllPresent = () => {
    setMemberStatuses(prev => {
      const next: Record<string, Status> = { ...prev };
      Object.keys(next).forEach(k => { if (next[k] === 'absent') next[k] = 'present'; });
      return next;
    });
  };

  const stats = Object.values(memberStatuses);
  const presentCount = stats.filter(s => s === 'present').length;
  const paidCount = stats.filter(s => s === 'paid').length;
  const followupCount = stats.filter(s => s === 'follow-up').length;
  const totalCount = stats.length;

  const getStatusLabel = (s: string) => {
    if (s === 'present') return 'P';
    if (s === 'paid') return '✓';
    if (s === 'absent') return 'A';
    return 'F';
  };

  const getStatusColor = (s: string) => {
    if (s === 'present' || s === 'paid') return colors.green;
    if (s === 'absent') return colors.red;
    return colors.orange;
  };

  const goBack = () => router.back();

  return (
    <View style={styles.container}>
      <View style={{ backgroundColor: colors.white }}>
        <AppHeader title={t('centerMeeting')} showBack />
        <View style={styles.savedChipRow}>
          <StatusChip label={t('savedOffline')} variant="saved" />
        </View>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {completed ? (
          <View style={styles.completedContainer}>
            <View style={styles.completedIcon}><Ionicons name="checkmark-circle" size={40} color={colors.green} /></View>
            <Text style={styles.completedTitle}>{t('meetingCompleted')}</Text>
            <Text style={styles.completedDesc}>{t('meetingDetailsRecorded')}</Text>
            <StatusChip label={t('pendingSync')} variant="sync" />
            <View style={styles.completedActions}>
              <PrimaryButton onPress={goBack}>{t('goBack')}</PrimaryButton>
              <SecondaryButton onPress={() => router.push('/end-of-day')} icon="clipboard">{t('endOfDaySummary')}</SecondaryButton>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.centerHeader}>
                <Text style={styles.centerName}>{t('kalikaWomenCenter')}</Text>
                <StatusChip label={t('inProgress')} variant="info" />
              </View>
              <View style={styles.centerMeta}>
                <View style={styles.metaItem}><Ionicons name="calendar-outline" size={10} color={colors.gray500} /><Text style={styles.metaText}>{t('dec102024')}</Text></View>
                <View style={styles.metaItem}><Ionicons name="location-outline" size={10} color={colors.gray500} /><Text style={styles.metaText}>{t('ward5Kalanki')}</Text></View>
                <View style={styles.metaItem}><Ionicons name="people-outline" size={10} color={colors.gray500} /><Text style={styles.metaText}>CC-204</Text></View>
                <View style={styles.metaItem}><Ionicons name="person-outline" size={10} color={colors.gray500} /><Text style={styles.metaText}>FO-208</Text></View>
              </View>
            </View>

            <View style={styles.card}>
              <View style={styles.progressHeader}>
                <Text style={styles.progressTitle}>{t('groupProgress')}</Text>
                <Text style={styles.memberCount}>{totalCount} {t('members')}</Text>
              </View>
              <View style={styles.progressGrid}>
                <View style={[styles.progressBox, { backgroundColor: colors.greenLight }]}><Text style={[styles.progressValue, { color: colors.green }]}>{presentCount + paidCount}/{totalCount}</Text><Text style={styles.progressLabel}>{t('attendance')}</Text></View>
                <View style={[styles.progressBox, { backgroundColor: colors.navyBg }]}><Text style={[styles.progressValue, { color: colors.navy }]}>NPR 68K</Text><Text style={styles.progressLabel}>{t('expected')}</Text></View>
                <View style={[styles.progressBox, { backgroundColor: colors.greenLight }]}><Text style={[styles.progressValue, { color: colors.green }]}>NPR 42K</Text><Text style={styles.progressLabel}>{t('received')}</Text></View>
                <View style={[styles.progressBox, { backgroundColor: colors.orangeLight }]}><Text style={[styles.progressValue, { color: colors.orange }]}>{followupCount}</Text><Text style={styles.progressLabel}>{t('followUp')}</Text></View>
              </View>
            </View>

            <View style={styles.bulkActions}>
              <TouchableOpacity onPress={markAllPresent} style={styles.bulkPresent}>
                <Ionicons name="person-add-outline" size={12} color={colors.green} /><Text style={styles.bulkText}>{t('allPresent')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setMemberStatuses(prev => { const n: Record<string, Status> = { ...prev }; Object.keys(n).forEach(k => { if (n[k] === 'present') n[k] = 'follow-up'; }); return n; }); }} style={styles.bulkFollowup}>
                <Ionicons name="flag-outline" size={12} color={colors.orange} /><Text style={styles.bulkText}>{t('followUp')}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.memberList}>
              <View style={styles.memberListHeader}><Text style={styles.memberListTitle}>{t('memberAttendance')}</Text></View>
              {members.map(member => (
                <View key={member.id} style={styles.memberRow}>
                  <View style={styles.memberAvatar}><Text style={styles.memberAvatarText}>{member.name.split(' ').map(n=>n[0]).slice(0,2).join('')}</Text></View>
                  <View style={{ flex: 1 }}><Text style={styles.memberName} numberOfLines={1}>{member.name}</Text><Text style={styles.memberId}>{member.id}</Text></View>
                  <View style={styles.statusButtons}>
                    {['present','paid','absent','follow-up'].map(st => (
                      <TouchableOpacity key={st} onPress={() => updateStatus(member.id, st)} style={[styles.statusBtn, memberStatuses[member.id] === st && { backgroundColor: getStatusColor(st) }]}>
                        <Text style={[styles.statusBtnText, memberStatuses[member.id] === st && { color: colors.white }]}>{getStatusLabel(st)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ))}
            </View>

            <View style={styles.buttonGroup}>
              <PrimaryButton onPress={async () => {
                // Enqueue sync + audit
                enqueueSyncEvent('center_meeting', {
                  centerId: 'CC-204',
                  presentCount, paidCount, followupCount, totalCount,
                }).catch(() => {});
                auditMeetingCompleted('CC-204', presentCount + paidCount, paidCount, totalCount).catch(() => {});
                setCompleted(true);
              }} icon="checkmark-circle">{t('completeMeeting')}</PrimaryButton>
              <SecondaryButton icon="save" onPress={goBack}>{t('saveDraft')}</SecondaryButton>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  savedChipRow: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  body: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md, paddingBottom: 80 },
  card: { backgroundColor: colors.white, borderRadius: borderRadius.xl, padding: spacing.lg, borderWidth: 1, borderColor: colors.gray100, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  centerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  centerName: { fontSize: fontSize.lg, fontWeight: 'bold', color: colors.gray800 },
  centerMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6, width: '45%' },
  metaText: { fontSize: fontSize.sm, color: colors.gray500 },
  progressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  progressTitle: { fontSize: fontSize.base, fontWeight: 'bold', color: colors.gray700 },
  memberCount: { fontSize: fontSize.sm, color: colors.gray500 },
  progressGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  progressBox: { width: '48%', alignItems: 'center', padding: spacing.sm, borderRadius: borderRadius.lg },
  progressValue: { fontSize: fontSize['4xl'], fontWeight: 'bold' },
  progressLabel: { fontSize: fontSize.xs, color: colors.gray500 },
  bulkActions: { flexDirection: 'row', gap: spacing.sm },
  bulkPresent: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: spacing.sm, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.green, backgroundColor: colors.greenLight },
  bulkFollowup: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: spacing.sm, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.orange, backgroundColor: colors.orangeLight },
  bulkText: { fontSize: fontSize.sm, fontWeight: '600' },
  memberList: { backgroundColor: colors.white, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.gray100, overflow: 'hidden' },
  memberListHeader: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.gray100 },
  memberListTitle: { fontSize: fontSize.base, fontWeight: 'bold', color: colors.gray700 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.gray50 },
  memberAvatar: { width: 28, height: 28, borderRadius: 9999, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  memberAvatarText: { fontSize: 9, fontWeight: 'bold', color: colors.white },
  memberName: { fontSize: fontSize.base, fontWeight: '500', color: colors.gray800 },
  memberId: { fontSize: fontSize.xs, color: colors.gray400 },
  statusButtons: { flexDirection: 'row', gap: 2 },
  statusBtn: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: colors.gray200, backgroundColor: 'transparent', minWidth: 22, alignItems: 'center', justifyContent: 'center' },
  statusBtnText: { fontSize: 8, fontWeight: '600', color: colors.gray400 },
  buttonGroup: { gap: spacing.sm },
  completedContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 48, paddingBottom: 48 },
  completedIcon: { width: 64, height: 64, borderRadius: 9999, backgroundColor: colors.greenLight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  completedTitle: { fontSize: fontSize['4xl'], fontWeight: 'bold', color: colors.gray800, marginBottom: 4 },
  completedDesc: { fontSize: fontSize.md, color: colors.gray500, textAlign: 'center', marginBottom: spacing.sm },
  completedActions: { width: '100%', gap: spacing.sm, marginTop: spacing.xl },
});
