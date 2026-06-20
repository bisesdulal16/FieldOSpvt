import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert,
  Switch, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as Device from 'expo-device';
import * as Application from 'expo-application';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../constants';
import { useFieldOSStore } from '../store/useFieldOSStore';
import { AppHeader } from '../components/fieldos/AppHeader';
import { StatusChip } from '../components/fieldos/StatusChip';
import { PrimaryButton } from '../components/fieldos/PrimaryButton';
import { SecondaryButton } from '../components/fieldos/SecondaryButton';
import { useTranslation } from '../i18n';
import { auditSecuritySettingChanged, auditConsentChanged } from '../services/auditService';
import { getSetting, setSetting } from '../db/repositories/settingsRepo';
import { getPendingCount } from '../db/repositories/syncQueueRepo';
import { getTodayAuditEvents } from '../db/repositories/auditRepo';
import type { AuditEvent } from '../types';
import { formatLastSyncTime } from '../services';

// ─── Score Breakdown ────────────────────────────────────────────

interface ScoreItem {
  tKey: string;
  score: number;
  max: number;
}

const SECURITY_SCORE_ITEMS: ScoreItem[] = [
  { tKey: 'scoreAuth', score: 25, max: 25 },
  { tKey: 'scoreDataProtection', score: 20, max: 25 },
  { tKey: 'scoreAudit', score: 15, max: 15 },
  { tKey: 'scorePrivacy', score: 15, max: 15 },
  { tKey: 'scoreDevice', score: 10, max: 20 },
];

const TOTAL_SCORE = SECURITY_SCORE_ITEMS.reduce((s, i) => s + i.score, 0);
const TOTAL_MAX = SECURITY_SCORE_ITEMS.reduce((s, i) => s + i.max, 0);

function getScoreColor(score: number, max: number): string {
  if (score >= max) return colors.green;
  if (score >= max * 0.5) return colors.orange;
  return colors.red;
}

// ─── Circular Progress ─────────────────────────────────────────

function CircularProgress({ score, max }: { score: number; max: number }) {
  const pct = Math.round((score / max) * 100);
  const color = pct >= 80 ? colors.green : pct >= 50 ? colors.orange : colors.red;
  const radius = 48;
  const strokeWidth = 8;
  const cx = radius + strokeWidth;
  const cy = radius + strokeWidth;
  const circumference = 2 * Math.PI * radius;
  const progress = (pct / 100) * circumference;

  return (
    <View style={cpStyles.container}>
      <View style={cpStyles.ring}>
        {/* Background circle */}
        <View style={[cpStyles.circleBg, { width: cx * 2, height: cy * 2, borderRadius: cx }]} />
        {/* SVG progress ring */}
        <View style={cpStyles.svgWrap}>
          {Platform.OS === 'web' ? (
            <svg width={cx * 2} height={cy * 2} viewBox={`0 0 ${cx * 2} ${cy * 2}`}>
              <circle cx={cx} cy={cy} r={radius} fill="none" stroke={colors.gray100} strokeWidth={strokeWidth} />
              <circle
                cx={cx} cy={cy} r={radius} fill="none" stroke={color}
                strokeWidth={strokeWidth} strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference - progress}
                transform={`rotate(-90 ${cx} ${cy})`}
              />
            </svg>
          ) : (
            <View style={{ position: 'relative', width: cx * 2, height: cy * 2 }}>
              {/* For React Native, use a simple visual ring */}
              <View style={[cpStyles.ringBg, { width: cx * 2, height: cy * 2, borderRadius: cx, borderColor: colors.gray100 }]} />
              <View style={[cpStyles.ringProgress, { width: cx * 2, height: cy * 2, borderRadius: cx, borderColor: color, borderWidth: strokeWidth, borderTopColor: pct < 25 ? 'transparent' : color, borderRightColor: pct < 50 ? 'transparent' : color, borderBottomColor: pct < 75 ? 'transparent' : color }]} />
            </View>
          )}
        </View>
        {/* Score text */}
        <View style={cpStyles.scoreTextWrap}>
          <Text style={[cpStyles.scoreText, { color }]}>{score}</Text>
          <Text style={cpStyles.scoreMax}>/{max}</Text>
        </View>
      </View>
    </View>
  );
}

const cpStyles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'relative' as const, alignItems: 'center', justifyContent: 'center' },
  circleBg: { position: 'absolute' as const, backgroundColor: colors.white },
  svgWrap: { position: 'absolute' as const, zIndex: 1 },
  ringBg: { position: 'absolute' as const, borderWidth: 8 },
  ringProgress: { position: 'absolute' as const, opacity: 0.3 },
  scoreTextWrap: { zIndex: 2, flexDirection: 'row', alignItems: 'baseline' },
  scoreText: { fontSize: 32, fontWeight: 'bold' },
  scoreMax: { fontSize: fontSize.lg, color: colors.gray400, fontWeight: '600' },
});

// ─── Section Card ──────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={secStyles.card}>
      <View style={secStyles.header}>
        <Text style={secStyles.title}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

const secStyles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.gray100, overflow: 'hidden' },
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.gray100 },
  title: { fontSize: fontSize.lg, fontWeight: 'bold', color: colors.gray700 },
});

// ─── Settings Row ──────────────────────────────────────────────

function SettingsRow({
  icon, iconBg, label, description, right, onPress,
}: {
  icon: string; iconBg?: string; label: string; description?: string;
  right?: React.ReactNode; onPress?: () => void;
}) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper style={rowStyles.container} onPress={onPress} disabled={!onPress}>
      <View style={[rowStyles.iconBox, iconBg ? { backgroundColor: iconBg } : {}]}>
        <Ionicons name={icon as any} size={16} color={colors.navy} />
      </View>
      <View style={rowStyles.textWrap}>
        <Text style={rowStyles.label}>{label}</Text>
        {description ? <Text style={rowStyles.desc}>{description}</Text> : null}
      </View>
      <View style={rowStyles.right}>
        {right}
        {onPress ? <Ionicons name="chevron-forward" size={14} color={colors.gray300} /> : null}
      </View>
    </Wrapper>
  );
}

const rowStyles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.gray50 },
  iconBox: { width: 32, height: 32, borderRadius: borderRadius.sm, backgroundColor: colors.navyBg, alignItems: 'center', justifyContent: 'center' },
  textWrap: { flex: 1 },
  label: { fontSize: fontSize.base, fontWeight: '600', color: colors.gray800 },
  desc: { fontSize: fontSize.xs, color: colors.gray400, marginTop: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});

// ─── Main Screen ───────────────────────────────────────────────

export default function SecurityCenterScreen() {
  const router = useRouter();
  const { lastSyncTime } = useFieldOSStore();
  const { t } = useTranslation();

  // Device info (loaded from native APIs)
  const [deviceId, setDeviceId] = useState('');
  const [appVersion] = useState(Application.nativeApplicationVersion || '2.1.0');

  // Security settings state
  const [appLockEnabled, setAppLockEnabled] = useState(true);
  const [faceVerifyEnabled, setFaceVerifyEnabled] = useState(true);
  const [biometricEnabled, setBiometricEnabled] = useState(true);
  const [sessionTimeout, setSessionTimeout] = useState(5);
  const [consentGranted, setConsentGranted] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [recentEvents, setRecentEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Load device info on mount
  useEffect(() => {
    (async () => {
      let id = await SecureStore.getItemAsync('device_id');
      if (!id) {
        id = `DEV-${Device.deviceName || 'DEVICE'}-${Date.now().toString(36).toUpperCase()}`;
        await SecureStore.setItemAsync('device_id', id);
      }
      setDeviceId(id);
    })();
  }, []);

  // Load settings from DB
  const loadSettings = useCallback(async () => {
    try {
      const appLock = await getSetting('app_lock_enabled');
      if (appLock !== null) setAppLockEnabled(appLock === 'true');

      const faceVerify = await getSetting('face_verify_enabled');
      if (faceVerify !== null) setFaceVerifyEnabled(faceVerify === 'true');

      const biometric = await getSetting('biometric_enabled');
      if (biometric !== null) setBiometricEnabled(biometric === 'true');

      const timeout = await getSetting('session_timeout');
      if (timeout !== null) setSessionTimeout(parseInt(timeout, 10) || 5);

      const consent = await getSetting('data_consent');
      if (consent !== null) setConsentGranted(consent === 'true');

      const pc = await getPendingCount();
      setPendingCount(pc);

      const events = await getTodayAuditEvents();
      setRecentEvents(events.slice(0, 5));
    } catch {
      // DB not ready
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const persistSetting = async (key: string, value: string) => {
    try {
      await setSetting(key, value, 'boolean');
    } catch {
      // silent
    }
  };

  const handleToggleAppLock = async (val: boolean) => {
    setAppLockEnabled(val);
    await persistSetting('app_lock_enabled', String(val));
    await auditSecuritySettingChanged('app_lock', !val, val);
  };

  const handleToggleFaceVerify = async (val: boolean) => {
    setFaceVerifyEnabled(val);
    await persistSetting('face_verify_enabled', String(val));
    await auditSecuritySettingChanged('face_verification', !val, val);
  };

  const handleToggleBiometric = async (val: boolean) => {
    setBiometricEnabled(val);
    await persistSetting('biometric_enabled', String(val));
    await auditSecuritySettingChanged('biometric_login', !val, val);
  };

  const handleToggleConsent = async (val: boolean) => {
    setConsentGranted(val);
    await persistSetting('data_consent', String(val));
    await auditConsentChanged('data_collection', val ? 'granted' : 'denied');
  };

  const handleSessionTimeout = () => {
    const timeouts = [1, 3, 5, 10, 15];
    Alert.alert(
      t('sessionTimeout'),
      timeouts.map(m => `${m} ${t('minutes')}`).join('\n'),
      undefined,
      { cancelable: true },
    );
  };

  const handleDeleteData = () => {
    Alert.alert(
      t('deleteMyData'),
      t('deleteDataConfirm'),
      [
        { text: t('deleteDataNo'), style: 'cancel' },
        {
          text: t('deleteDataYes'),
          style: 'destructive',
          onPress: async () => {
            await auditConsentChanged('data_deletion', 'requested');
            Alert.alert(t('deletionRequested'));
          },
        },
      ],
    );
  };

  // Security events to display
  const securityActionTypes = ['login', 'biometric_login', 'secure_logout', 'pin_changed', 'security_setting_changed', 'face_verification_success', 'face_verification_failure'];
  const securityEvents = recentEvents.filter(e => securityActionTypes.includes(e.actionType));

  const formatTime = (iso: string) => {
    const date = new Date(iso);
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const maskDeviceId = (id: string) => {
    if (id.length < 8) return id;
    return `${id.slice(0, 4)}-***-***-${id.slice(-4)}`;
  };

  return (
    <View style={styles.container}>
      <AppHeader title={t('securityCenter')} showBack />

      <ScrollView style={styles.body} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Section 1: Security Score */}
        <SectionCard title={t('securityScore')}>
          <View style={styles.scoreSection}>
            <CircularProgress score={TOTAL_SCORE} max={TOTAL_MAX} />
            <View style={styles.scoreBreakdown}>
              {SECURITY_SCORE_ITEMS.map(item => {
                const color = getScoreColor(item.score, item.max);
                return (
                  <View key={item.tKey} style={styles.scoreRow}>
                    <View style={styles.scoreDotWrap}>
                      <View style={[styles.scoreDot, { backgroundColor: color }]} />
                    </View>
                    <Text style={styles.scoreItemLabel}>{t(item.tKey as any)}</Text>
                    <Text style={[styles.scoreItemValue, { color }]}>{item.score}/{item.max}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        </SectionCard>

        {/* Section 2: Authentication & Access */}
        <SectionCard title={t('authentication')}>
          <SettingsRow
            icon="lock-closed"
            label={t('appLock')}
            description={t('appLockDesc')}
            right={
              <Switch
                value={appLockEnabled}
                onValueChange={handleToggleAppLock}
                trackColor={{ false: colors.gray200, true: colors.green }}
                thumbColor={colors.white}
                ios_backgroundColor={colors.gray200}
              />
            }
          />
          <SettingsRow
            icon="scan"
            label={t('faceVerification')}
            description={t('faceVerificationDesc')}
            right={
              <Switch
                value={faceVerifyEnabled}
                onValueChange={handleToggleFaceVerify}
                trackColor={{ false: colors.gray200, true: colors.green }}
                thumbColor={colors.white}
                ios_backgroundColor={colors.gray200}
              />
            }
          />
          <SettingsRow
            icon="time-outline"
            label={t('sessionTimeout')}
            description={`${sessionTimeout} ${t('minutes')}`}
            right={<StatusChip label={`${sessionTimeout} ${t('minutes')}`} variant="info" />}
            onPress={handleSessionTimeout}
          />
          <SettingsRow
            icon="key-outline"
            label={t('changePin')}
            onPress={() => router.push('/change-pin')}
          />
          <SettingsRow
            icon="finger-print-outline"
            label={t('biometricLoginSetting')}
            description={t('biometricLoginDesc')}
            right={
              <Switch
                value={biometricEnabled}
                onValueChange={handleToggleBiometric}
                trackColor={{ false: colors.gray200, true: colors.green }}
                thumbColor={colors.white}
                ios_backgroundColor={colors.gray200}
              />
            }
          />
        </SectionCard>

        {/* Section 3: Data Protection */}
        <SectionCard title={t('dataProtection')}>
          <SettingsRow
            icon="lock-closed"
            iconBg={colors.greenSoft}
            label={t('localEncryption')}
            description={t('localEncryptionDesc')}
            right={<StatusChip label={t('active')} variant="verified" />}
          />
          <SettingsRow
            icon="server-outline"
            iconBg={colors.greenSoft}
            label={t('dataAtRest')}
            description={t('dataAtRestDesc')}
            right={<StatusChip label={t('dataAtRestDesc')} variant="verified" />}
          />
          <SettingsRow
            icon="cloud-outline"
            iconBg={colors.greenSoft}
            label={t('dataInTransit')}
            description={t('dataInTransitDesc')}
            right={<StatusChip label="HTTPS" variant="verified" />}
          />
          <SettingsRow
            icon="download-outline"
            label={t('offlineData')}
            description={`${pendingCount} ${t('offlineDataRecords')}`}
            right={<Text style={styles.offlineCount}>{pendingCount}</Text>}
          />
        </SectionCard>

        {/* Section 4: Device Information */}
        <SectionCard title={t('deviceInfo')}>
          <SettingsRow
            icon="hardware-chip-outline"
            label={t('deviceIdLabel')}
            description={deviceId ? maskDeviceId(deviceId) : 'Loading...'}
          />
          <SettingsRow
            icon="phone-portrait-outline"
            label={t('deviceModelLabel')}
            description={Device.isDevice ? `${Device.manufacturer || Platform.OS} ${Device.modelName || ''}`.trim() : 'Web Browser'}
          />
          <SettingsRow
            icon="information-circle-outline"
            label={t('appVersionLabel')}
            description={appVersion}
          />
          <SettingsRow
            icon="cloud-done-outline"
            label={t('lastSyncLabel')}
            description={formatLastSyncTime(lastSyncTime)}
          />
          <SettingsRow
            icon="shield-checkmark-outline"
            label={t('deviceStatusLabel')}
            right={<StatusChip label={t('authorizedStatus')} variant="verified" />}
          />
        </SectionCard>

        {/* Section 5: Privacy & Consent */}
        <SectionCard title={t('privacyConsent')}>
          <SettingsRow
            icon="checkmark-done-circle-outline"
            label={t('dataCollectionConsent')}
            description={t('dataCollectionDesc')}
            right={
              <Switch
                value={consentGranted}
                onValueChange={handleToggleConsent}
                trackColor={{ false: colors.gray200, true: colors.green }}
                thumbColor={colors.white}
                ios_backgroundColor={colors.gray200}
              />
            }
          />
          <SettingsRow
            icon="navigate-outline"
            label={t('gpsTracking')}
            description={t('gpsTrackingDesc')}
            right={<StatusChip label={t('gpsTrackingDesc').split(' ')[0]} variant="info" />}
          />
          <SettingsRow
            icon="camera-outline"
            label={t('cameraAccess')}
            description={t('cameraAccessDesc')}
            right={<StatusChip label={t('cameraAccessDesc')} variant="info" />}
          />
          <SettingsRow
            icon="mic-outline"
            label={t('microphoneAccess')}
            description={t('microphoneAccessDesc')}
            right={<StatusChip label={t('microphoneAccessDesc')} variant="info" />}
          />

          {/* Action buttons */}
          <View style={styles.privacyActions}>
            <View style={styles.privacyRow}>
              <SecondaryButton
                icon="document-text-outline"
                onPress={() => alert(t('privacyPolicyLink') + ' — Coming soon')}
              >
                {t('viewPolicy')}
              </SecondaryButton>
              <SecondaryButton
                icon="download-outline"
                onPress={() => {
                  auditConsentChanged('data_export', 'requested');
                  Alert.alert(t('exportMyData'), 'Export request submitted');
                }}
              >
                {t('requestExport')}
              </SecondaryButton>
            </View>
            <TouchableOpacity style={styles.deleteButton} onPress={handleDeleteData}>
              <Ionicons name="trash-outline" size={16} color={colors.white} />
              <Text style={styles.deleteButtonText}>{t('requestDeletion')}</Text>
            </TouchableOpacity>
          </View>
        </SectionCard>

        {/* Section 6: Audit & Compliance */}
        <SectionCard title={t('auditCompliance')}>
          <SettingsRow
            icon="document-text-outline"
            label={t('viewAuditLogs')}
            onPress={() => router.push('/audit-logs')}
          />

          {/* Recent security events */}
          <View style={styles.eventsSection}>
            <Text style={styles.eventsTitle}>{t('recentEvents')}</Text>
            {securityEvents.length === 0 ? (
              <View style={styles.noEvents}>
                <Ionicons name="shield-outline" size={20} color={colors.gray300} />
                <Text style={styles.noEventsText}>{t('noAuditEvents')}</Text>
              </View>
            ) : (
              securityEvents.map((event) => (
                <View key={event.id} style={styles.eventItem}>
                  <View style={styles.eventIconSmall}>
                    <Ionicons name="shield-checkmark-outline" size={12} color={colors.navy} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.eventActionText}>{event.actionType.replace(/_/g, ' ')}</Text>
                    <Text style={styles.eventTimeText}>{formatTime(event.timestamp)}</Text>
                  </View>
                  <StatusChip
                    label={event.syncStatus === 'synced' ? t('syncedChip') : t('localChip')}
                    variant={event.syncStatus === 'synced' ? 'success' : 'sync'}
                  />
                </View>
              ))
            )}
          </View>

          {/* Sync queue status */}
          <View style={styles.syncStatusRow}>
            <Ionicons name="sync-outline" size={14} color={colors.navy} />
            <Text style={styles.syncStatusLabel}>{t('syncQueueStatus')}:</Text>
            <Text style={styles.syncStatusValue}>{pendingCount} {t('itemsPending')}</Text>
          </View>
        </SectionCard>

        {/* Section 7: About */}
        <SectionCard title={t('about')}>
          <SettingsRow
            icon="information-circle-outline"
            label={t('appVersionLabel')}
            description={appVersion}
          />
          <SettingsRow
            icon="shield-outline"
            label={t('securityVersionLabel')}
            description="v2.1.0"
          />
          <SettingsRow
            icon="calendar-outline"
            label={t('lastSecurityAudit')}
            description={new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
          />
          <SettingsRow
            icon="document-outline"
            label={t('privacyPolicyLink')}
            onPress={() => alert(t('privacyPolicyLink') + ' — Coming soon')}
          />
          <SettingsRow
            icon="list-outline"
            label={t('termsOfUseLink')}
            onPress={() => alert(t('termsOfUseLink') + ' — Coming soon')}
          />
        </SectionCard>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md, paddingBottom: 80 },

  // Score section
  scoreSection: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xl, alignItems: 'center', gap: spacing.xl },
  scoreBreakdown: { width: '100%', gap: spacing.sm },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm },
  scoreDotWrap: { width: 8, height: 8, borderRadius: 9999, alignItems: 'center', justifyContent: 'center' },
  scoreDot: { width: 8, height: 8, borderRadius: 9999 },
  scoreItemLabel: { flex: 1, fontSize: fontSize.md, color: colors.gray600 },
  scoreItemValue: { fontSize: fontSize.md, fontWeight: '600' },

  // Privacy actions
  privacyActions: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
  privacyRow: { flexDirection: 'row', gap: spacing.sm },
  deleteButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    paddingVertical: spacing.md, borderRadius: borderRadius.lg,
    backgroundColor: colors.red, marginTop: spacing.xs,
  },
  deleteButtonText: { fontSize: fontSize.lg, fontWeight: '600', color: colors.white },

  // Offline count
  offlineCount: { fontSize: fontSize.xl, fontWeight: 'bold', color: colors.navy },

  // Security events
  eventsSection: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  eventsTitle: { fontSize: fontSize.base, fontWeight: '600', color: colors.gray500, marginBottom: spacing.sm },
  noEvents: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  noEventsText: { fontSize: fontSize.sm, color: colors.gray400 },
  eventItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  eventIconSmall: { width: 24, height: 24, borderRadius: 6, backgroundColor: colors.navyBg, alignItems: 'center', justifyContent: 'center' },
  eventActionText: { flex: 1, fontSize: fontSize.sm, fontWeight: '500', color: colors.gray700, textTransform: 'capitalize' },
  eventTimeText: { fontSize: fontSize.xs, color: colors.gray400 },

  // Sync status
  syncStatusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  syncStatusLabel: { fontSize: fontSize.base, fontWeight: '600', color: colors.gray700 },
  syncStatusValue: { fontSize: fontSize.base, fontWeight: '600', color: colors.navy },
});
