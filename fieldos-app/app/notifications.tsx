import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../constants';
import { useFieldOSStore } from '../store/useFieldOSStore';
import { AppHeader } from '../components/fieldos/AppHeader';
import { NotificationCard } from '../components/fieldos/NotificationCard';
import { SyncChip } from '../components/fieldos/SyncChip';
import { getPendingCount } from '../db/repositories/syncQueueRepo';
import { useTranslation } from '../i18n';
import { fetchAnnouncements } from '../services/announcementService';
import type { Announcement } from '../services/announcementService';

// ── Helpers ────────────────────────────────

function formatDateRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return iso;
  }
}

// ── Static Data ──────────────────────────────

type NotifIcon = 'time-outline' | 'person-outline' | 'settings-outline' | 'document-text-outline' | 'shield-checkmark' | 'warning-outline' | 'cloud-outline' | 'alert-circle';

interface NotificationItem {
  icon: NotifIcon;
  iconColor: string;
  title: string;
  titleNe: string;
  desc: string;
  descNe: string;
  time: string;
  actionLabel?: string;
  actionLabelNe?: string;
  screen?: string;
  filter: string;
  isAnnouncement?: boolean;
}

const STATIC_NOTIFICATIONS: NotificationItem[] = [
  { icon: 'time-outline' as const, iconColor: colors.red, title: 'Promise-to-pay due today', titleNe: 'आज प्रतिबद्धता थप', desc: 'Sunita Kumari Chaudhary — NPR 5,500', descNe: 'सुनिता कुमारी चौधरी — NPR 5,500', time: '2h ago', actionLabel: 'Start Visit', actionLabelNe: 'भेट थाल्नुहोस्', screen: 'client-detail' as const, filter: 'tasks' },
  { icon: 'person-outline' as const, iconColor: colors.navy, title: 'Manager assigned task', titleNe: 'प्रबन्धकले कार्य दिए', desc: 'Visit Ramesh Thapa for KYC', descNe: 'रमेश थापालाई भेट गर्नुहोस्', time: '1h ago', actionLabel: 'View Task', actionLabelNe: 'कार्य हेर्नुहोस्', screen: 'due-collections' as const, filter: 'tasks' },
  { icon: 'settings-outline' as const, iconColor: colors.gray500, title: 'App update available', titleNe: 'एप अपडेट', desc: 'FieldOS Nepal v2.2.0', descNe: 'v2.2.0 — सुरक्षा सुधार', time: '3h ago', filter: 'system' },
  { icon: 'warning-outline' as const, iconColor: colors.red, title: 'Overdue alert', titleNe: 'अतिरिक्त चेतावनी', desc: 'Sita Devi Sah is 15 days overdue', descNe: 'सीता देवी साह १५ दिन अतिरिक्त', time: '5h ago', actionLabel: 'View Client', actionLabelNe: 'क्लाइन्ट हेर्नुहोस्', screen: 'client-detail' as const, filter: 'alerts' },
  { icon: 'document-text-outline' as const, iconColor: colors.navy, title: 'Center meeting reminder', titleNe: 'बैठक स्मरण', desc: 'Kalika Women Center — Tomorrow 10AM', descNe: 'कालिका महिला — भोलि १०:००', time: '6h ago', actionLabel: 'View', actionLabelNe: 'हेर्नुहोस्', screen: 'center-meeting' as const, filter: 'tasks' },
  { icon: 'shield-checkmark' as const, iconColor: colors.green, title: 'Security audit completed', titleNe: 'सुरक्षा अडिट पूरा', desc: 'No issues found', descNe: 'कुनै मुद्दा भेटिएन', time: '1d ago', filter: 'system' },
];

const FILTERS = [
  { key: 'all', label: 'All', labelNe: 'सबै', tKey: 'filterAll' as const },
  { key: 'tasks', label: 'Tasks', labelNe: 'कार्य', tKey: 'filterTasks' as const },
  { key: 'alerts', label: 'Alerts', labelNe: 'चेतावनी', tKey: 'filterAlerts' as const },
  { key: 'system', label: 'System', labelNe: 'प्रणाली', tKey: 'filterSystem' as const },
];

export default function NotificationsScreen() {
  const { notificationFilter, setNotificationFilter, setSelectedClient, language, syncStatus } = useFieldOSStore();
  const router = useRouter();
  const isNe = language === 'ne';
  const { t } = useTranslation();
  const [realPendingCount, setRealPendingCount] = useState(0);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  useEffect(() => {
    getPendingCount().then(setRealPendingCount).catch(() => {});
    fetchAnnouncements().then(setAnnouncements).catch(() => {});
  }, []);

  // Build dynamic notification for sync reminder
  const syncNotification = realPendingCount > 0 ? {
    icon: 'cloud-outline' as const,
    iconColor: colors.orange,
    title: `${realPendingCount} records pending sync`,
    titleNe: `${realPendingCount} रेकर्ड पेन्डिङ`,
    desc: 'Tap to sync now',
    descNe: 'सिंक गर्न ट्याप गर्नुहोस्',
    time: 'now',
    actionLabel: 'Sync Now',
    actionLabelNe: 'अहिले सिंक',
    screen: 'sync-center' as const,
    filter: 'alerts',
  } : null;

  const allNotifications: NotificationItem[] = syncNotification
    ? [
        ...announcements.map((a): NotificationItem => ({
          icon: a.priority === 'urgent' ? 'alert-circle' : 'person-outline',
          iconColor: a.priority === 'urgent' ? colors.red : colors.navy,
          title: a.title,
          titleNe: a.title,
          desc: a.message.slice(0, 80) + (a.message.length > 80 ? '...' : ''),
          descNe: a.message.slice(0, 80) + (a.message.length > 80 ? '...' : ''),
          time: formatDateRelative(a.created_at),
          actionLabel: 'View',
          actionLabelNe: 'हर्न',
          filter: a.priority === 'urgent' ? 'alerts' : 'tasks',
          isAnnouncement: true,
        })),
        syncNotification,
      ].filter((n): n is NotificationItem => n != null) as NotificationItem[]
    : [...announcements.map((a): NotificationItem => ({
        icon: a.priority === 'urgent' ? 'alert-circle' : 'person-outline',
        iconColor: a.priority === 'urgent' ? colors.red : colors.navy,
        title: a.title,
        titleNe: a.title,
        desc: a.message.slice(0, 80) + (a.message.length > 80 ? '...' : ''),
        descNe: a.message.slice(0, 80) + (a.message.length > 80 ? '...' : ''),
        time: formatDateRelative(a.created_at),
        actionLabel: 'View',
        actionLabelNe: 'हर्न',
        filter: a.priority === 'urgent' ? 'alerts' : 'tasks',
        isAnnouncement: true,
      })),
        ...(syncNotification ? [syncNotification] : []),
      ];

  const filtered = notificationFilter === 'all' ? allNotifications : allNotifications.filter(n => n.filter === notificationFilter);

  return (
    <View style={styles.container}>
      <View style={{ backgroundColor: colors.white }}>
        <AppHeader title={t('notifications')} showBack />
        <View style={styles.filterSection}>
          <View style={styles.filterRow}>
            <SyncChip status={syncStatus} />
            <Text style={styles.countText}>{filtered.length} {t('notificationsLower')}</Text>
          </View>
          <View style={styles.chipRow}>
            {FILTERS.map(f => (
              <TouchableOpacity key={f.key} onPress={() => setNotificationFilter(f.key)} style={[styles.filterChip, notificationFilter === f.key && styles.filterChipActive]}>
                <Text style={[styles.filterText, notificationFilter === f.key && styles.filterTextActive]}>{t(f.tKey)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {filtered.map((notif, i) =>
          notif.isAnnouncement && notif.icon === 'alert-circle'
            ? (
                // Urgent announcement — red border + bold
                <View key={i} style={{ borderRadius: borderRadius.md, borderWidth: 1.5, borderColor: colors.red, backgroundColor: `${colors.red}08` }}>
                  <NotificationCard
                    icon={notif.icon}
                    iconColor={notif.iconColor}
                    title={notif.title}
                    description={notif.desc}
                    time={notif.time}
                    actionLabel={notif.actionLabel || undefined}
                  />
                </View>
              )
            : (
                <NotificationCard
                  key={i}
                  icon={notif.icon}
                  iconColor={notif.iconColor}
                  title={isNe ? notif.titleNe : notif.title}
                  description={isNe ? notif.descNe : notif.desc}
                  time={notif.time}
                  actionLabel={notif.actionLabel ? (isNe ? notif.actionLabelNe : notif.actionLabel) : undefined}
                  onAction={notif.screen ? () => {
                    // Don't open client-detail from a notification without a real client;
                    // send the officer to their task list to pick the right borrower.
                    const screenPaths: Record<string, string> = { 'client-detail': '/tasks', 'sync-center': '/sync-center', 'due-collections': '/tasks', 'center-meeting': '/center-meeting' };
                    router.push(screenPaths[notif.screen!] || '/');
                  } : undefined}
                />
              ),
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  filterSection: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  countText: { fontSize: fontSize.sm, color: colors.gray500 },
  chipRow: { flexDirection: 'row', gap: 6 },
  filterChip: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 9999, borderWidth: 1, borderColor: colors.gray200 },
  filterChipActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  filterText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.gray500 },
  filterTextActive: { color: colors.white },
  body: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm, paddingBottom: 80 },
});
