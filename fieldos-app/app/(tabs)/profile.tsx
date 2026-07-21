import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../../constants';
import { useFieldOSStore } from '../../store/useFieldOSStore';
import { AppHeader } from '../../components/fieldos/AppHeader';
import { StatusChip } from '../../components/fieldos/StatusChip';
import { PrivacyNoteCard } from '../../components/fieldos/PrivacyNoteCard';
import { auditLogout } from '../../services/auditService';
import { getSetting } from '../../db/repositories/settingsRepo';
import { logout, clearAllSecureData, formatLastSyncTime } from '../../services';
import { useTranslation } from '../../i18n';

const securityItems = [
  { icon: 'shield-checkmark' as const, tKey: 'securityCenterRow', tDesc: 'securityCenterDesc', variant: 'info' as const, screen: 'security-center' as const },
  { icon: 'key-outline' as const, tKey: 'changePinRow', tDesc: 'changePinRowDesc', variant: 'warning' as const, screen: 'change-pin' as const },
  { icon: 'lock-closed' as const, tKey: 'secAppLock', tDesc: 'secPinBiometric', status: 'secActive', variant: 'verified' as const },
  { icon: 'scan' as const, tKey: 'secIdentityVerification', tDesc: 'secFaceVerification', status: 'secActive', variant: 'verified' as const },
  { icon: 'shield' as const, tKey: 'secLocalDataEncryption', tDesc: 'secAes256', status: 'secActive', variant: 'verified' as const },
  { icon: 'time' as const, tKey: 'secAuditLogs', tDesc: 'secLast30Days', status: 'secViewAll', variant: 'info' as const, screen: 'audit-logs' as const },
];

const incompleteModulesCount = 2;

export default function ProfileScreen() {
  const router = useRouter();
  const { syncStatus, syncItemsReady, syncFailedCount, lastSyncTime, loadSyncStatus } = useFieldOSStore();
  const { t } = useTranslation();
  const [consentGranted, setConsentGranted] = useState(true);

  useEffect(() => {
    const loadConsent = async () => {
      try {
        const consent = await getSetting('data_consent');
        if (consent !== null) setConsentGranted(consent === 'true');
      } catch { /* silent */ }
    };
    loadConsent();
  }, []);

  return (
    <View style={styles.container}>
      <AppHeader title={t('profile')} />

      <ScrollView style={styles.body} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.profileCard}>
          <View style={styles.profileHeader}>
            <View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>RB</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.profileName}>{t('officerName')}</Text>
              <Text style={styles.profileRole}>{t('fieldOfficer')}</Text>
              <Text style={styles.profileBranch}>{t('branchName')}</Text>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.profileMeta}>
            <View style={styles.metaItem}><Ionicons name="person-outline" size={11} color={colors.gray500} /><Text style={styles.metaText}>{t('employeeId')}</Text></View>
            <View style={styles.metaItem}><Ionicons name="phone-portrait-outline" size={11} color={colors.gray500} /><Text style={styles.metaText}>{t('deviceAuthorized')}</Text></View>
            <View style={styles.metaItem}><Ionicons name="cloud-outline" size={11} color={colors.gray500} /><Text style={styles.metaText}>{t('lastSync')}: {formatLastSyncTime(lastSyncTime)}</Text></View>
          </View>
          <View style={styles.authRow}>
            <StatusChip label={t('authorized')} variant="verified" />
            <StatusChip label={consentGranted ? t('consentStatus') : t('consentStatusDenied')} variant={consentGranted ? 'info' : 'warning'} />
          </View>
        </View>

        {/* Pilot Program */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{t('pilotProgram')}</Text></View>
          <TouchableOpacity
            style={styles.securityRow}
            onPress={() => router.push('/pilot-info')}
          >
            <View style={styles.securityIcon}>
              <Ionicons name="rocket-outline" size={16} color={colors.orange} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.securityLabel}>{t('pilotProgramRow')}</Text>
              <Text style={styles.securityDesc}>{t('pilotProgramRowDesc')}</Text>
            </View>
            {incompleteModulesCount > 0 && (
              <StatusChip
                label={`${incompleteModulesCount} ${t('modulesRemaining')}`}
                variant="warning"
              />
            )}
            <Ionicons name="chevron-forward" size={14} color={colors.gray300} />
          </TouchableOpacity>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{t('security')}</Text></View>
          {securityItems.map(item => (
            <TouchableOpacity key={item.tKey} style={styles.securityRow} onPress={() => {
              if (item.screen) {
                router.push(`/${item.screen}`);
              }
            }}>
              <View style={styles.securityIcon}><Ionicons name={item.icon} size={16} color={colors.navy} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.securityLabel}>{t(item.tKey as any)}</Text>
                <Text style={styles.securityDesc}>{t(item.tDesc as any)}</Text>
              </View>
              {item.status && <StatusChip label={t(item.status as any)} variant={item.variant} />}
              {item.screen && <Ionicons name="chevron-forward" size={14} color={colors.gray300} />}
            </TouchableOpacity>
          ))}
        </View>

        <PrivacyNoteCard />

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{t('support')}</Text></View>
          <TouchableOpacity style={styles.supportRow} onPress={() => alert('Issue reporting feature coming soon.')}>
            <View style={[styles.supportIcon, { backgroundColor: colors.orangeLight }]}><Ionicons name="alert-circle-outline" size={16} color={colors.orange} /></View>
            <Text style={styles.supportLabel}>{t('reportAppIssue')}</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.gray300} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.supportRow} onPress={() => alert('Contact feature coming soon.')}>
            <View style={[styles.supportIcon, { backgroundColor: colors.navyBg }]}><Ionicons name="chatbubble-outline" size={16} color={colors.navy} /></View>
            <Text style={styles.supportLabel}>{t('contactBranchAdmin')}</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.gray300} />
          </TouchableOpacity>
        </View>

        <View style={styles.logoutSection}>
          <TouchableOpacity onPress={async () => {
            try {
              await auditLogout();
              await clearAllSecureData();
              await logout();
              // NOTE: do NOT reset day_started here — a logout must not end the
              // officer's day. It persists per-officer until EOD, so the same
              // officer logging back in the same day stays "day started".
            } catch (e) { /* silent */ }
            router.replace('/login');
          }} style={styles.logoutButton}>
            <Ionicons name="log-out-outline" size={18} color={colors.white} />
            <Text style={styles.logoutText}>{t('secureLogout')}</Text>
          </TouchableOpacity>
          <Text style={styles.versionText}>FieldOS Nepal v3.0.0</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md, paddingBottom: 80 },
  profileCard: { backgroundColor: colors.white, borderRadius: borderRadius.xl, padding: spacing.lg, borderWidth: 1, borderColor: colors.gray100, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  profileHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  profileAvatar: { width: 56, height: 56, borderRadius: 9999, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  profileAvatarText: { fontSize: fontSize.xl, fontWeight: 'bold', color: colors.white },
  profileName: { fontSize: fontSize.lg, fontWeight: 'bold', color: colors.gray800 },
  profileRole: { fontSize: fontSize.sm, color: colors.gray500 },
  profileBranch: { fontSize: fontSize.sm, color: colors.gray500 },
  divider: { height: 1, backgroundColor: colors.gray100, marginBottom: spacing.md },
  profileMeta: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: fontSize.sm, color: colors.gray500 },
  authRow: { marginTop: spacing.xs, flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  sectionCard: { backgroundColor: colors.white, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.gray100, overflow: 'hidden' },
  sectionHeader: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.gray100 },
  sectionTitle: { fontSize: fontSize.base, fontWeight: 'bold', color: colors.gray700 },
  securityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.gray50 },
  securityIcon: { width: 32, height: 32, borderRadius: borderRadius.sm, backgroundColor: colors.navyBg, alignItems: 'center', justifyContent: 'center' },
  securityLabel: { fontSize: fontSize.base, fontWeight: '600', color: colors.gray800 },
  securityDesc: { fontSize: fontSize.xs, color: colors.gray400 },
  supportRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.gray50 },
  supportIcon: { width: 32, height: 32, borderRadius: borderRadius.sm, alignItems: 'center', justifyContent: 'center' },
  supportLabel: { flex: 1, fontSize: fontSize.base, fontWeight: '600', color: colors.gray800 },
  logoutSection: { paddingTop: spacing.sm, gap: spacing.sm, alignItems: 'center' },
  logoutButton: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md, borderRadius: borderRadius.lg, backgroundColor: colors.red },
  logoutText: { fontSize: fontSize.lg, fontWeight: '600', color: colors.white },
  versionText: { fontSize: fontSize.xs, color: colors.gray400 },
});
