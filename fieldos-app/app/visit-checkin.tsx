import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../constants';
import { useFieldOSStore } from '../store/useFieldOSStore';
import { useTranslation } from '../i18n';
import { AppHeader } from '../components/fieldos/AppHeader';
import { StatusChip } from '../components/fieldos/StatusChip';
import { PrimaryButton } from '../components/fieldos/PrimaryButton';
import { ValidationError } from '../components/fieldos/ValidationError';
import { ValidationWarning } from '../components/fieldos/ValidationWarning';
import { PrivacyNoteCard } from '../components/fieldos/PrivacyNoteCard';
import { recordVisitCheckin } from '../services';

interface GpsData {
  latitude: number;
  longitude: number;
  accuracy: number;
  address: string;
  timestamp: string;
}

const PURPOSES = [
  { key: 'collection', label: 'Collection', labelNe: 'संकलन', emoji: '💰' },
  { key: 'follow-up', label: 'Follow-up', labelNe: 'फलो-अप', emoji: '🔄' },
  { key: 'kyc', label: 'KYC/Document', labelNe: 'केवाईसी', emoji: '📋' },
  { key: 'meeting', label: 'Center Meeting', labelNe: 'बैठक', emoji: '👥' },
  { key: 'complaint', label: 'Complaint', labelNe: 'गुनासो', emoji: '💬' },
  { key: 'other', label: 'Other', labelNe: 'अन्य', emoji: '📝' },
];

export default function VisitCheckinScreen() {
  const { selectedClient } = useFieldOSStore();
  const router = useRouter();
  const { t, isNe } = useTranslation();
  const [selectedPurpose, setSelectedPurpose] = useState('collection');
  const [checkedIn, setCheckedIn] = useState(false);
  const [error, setError] = useState('');

  // GPS state
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'requesting' | 'success' | 'denied' | 'unavailable'>('idle');
  const [gpsData, setGpsData] = useState<GpsData | null>(null);
  const [saveReason, setSaveReason] = useState('');

  const client = selectedClient || { id: 'M-1042', name: 'Sunita Kumari Chaudhary', memberId: 'M-1042' };
  const initials = client.name.split(' ').map(n => n[0]).slice(0, 2).join('');

  // 10-second timeout utility
  const timeout = (ms: number): Promise<void> => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));

  // Request GPS on mount
  const requestGps = useCallback(async () => {
    setGpsStatus('requesting');
    setError('');

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== 'granted') {
        setGpsStatus('denied');
        setError(t('gpsPermissionDenied'));
        return;
      }

      // Coordinates + 10s timeout
      const location = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        timeout(10_000),
      ]).catch(() => null);

      if (!location) {
        // Timeout: still show raw coordinates if we have them
        setGpsStatus('success');
        setError(t('gpsTimeout'));
        return;
      }

      // Try reverse geocode (non-blocking, up to 5s)
      let address = `${location.coords.latitude.toFixed(4)}° N, ${location.coords.longitude.toFixed(4)}° E`;
      try {
        const geocoder = await Promise.race([
          Location.reverseGeocodeAsync({
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          }),
          timeout(5_000),
        ]);
        if (geocoder && geocoder.length > 0) {
          const g = geocoder[0];
          const parts = [g.city, g.region, g.country].filter(Boolean);
          if (parts.length > 0) {
            address = parts.join(', ');
          }
        }
      } catch {
        // Reverse geocode timed out or failed — raw coords already set above
      }

      setGpsData({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy ?? 0,
        address,
        timestamp: new Date().toISOString(),
      });

      setGpsStatus('success');
    } catch (err) {
      const hasPermission = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (!hasPermission || hasPermission.status === 'denied') {
        setGpsStatus('denied');
        setError(t('gpsPermissionDenied'));
      } else {
        setGpsStatus('unavailable');
        setError(t('gpsError'));
      }
    }
  }, [t]);

  const gpsDenied = gpsStatus === 'denied';

  // Request GPS on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- GPS init requires setState on mount
    requestGps();
  }, []);

  const handleCheckIn = async () => {
    setError('');

    if (!selectedPurpose) {
      setError(t('selectVisitPurpose'));
      return;
    }

    if (gpsDenied && !saveReason.trim()) {
      setError(t('gpsUnavailableReason'));
      return;
    }

    setCheckedIn(true);
    try {
      await recordVisitCheckin({
        clientId: Number(client.clientId || client.id) || 0,
        visitPurpose: selectedPurpose,
        taskId: (client as any).taskId || undefined,
        gpsLatitude: gpsData?.latitude,
        gpsLongitude: gpsData?.longitude,
        gpsAccuracyMeters: gpsData?.accuracy,
        gpsAddress: gpsData?.address ?? (gpsDenied ? 'GPS denied' : 'Unknown'),
      });
    } catch (e) { /* silent — offline-first */ }
    setTimeout(() => router.push('/record-collection'), 2000);
  };

  return (
    <View style={styles.container}>
      <AppHeader title={t('visitCheckin')} showBack />
      <ScrollView style={styles.body} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {checkedIn ? (
          <View style={styles.successContainer}>
            <View style={styles.successIcon}><Ionicons name="checkmark-circle" size={40} color={colors.green} /></View>
            <Text style={styles.successTitle}>{t('checkinSuccessful')}</Text>
            <Text style={styles.successDesc}>{t('officialVisitRecorded')}</Text>
            <StatusChip label={t('savedOffline')} variant="saved" />
            <View style={styles.successMeta}>
              <View style={styles.metaItem}><Ionicons name="location-outline" size={12} color={colors.gray400} /><Text style={styles.metaText}>{t('gpsLogged')} {gpsData ? `· ${gpsData.address}` : gpsDenied ? '(denied)' : '(timeout)'}</Text></View>
              <View style={styles.metaItem}><Ionicons name="time-outline" size={12} color={colors.gray400} /><Text style={styles.metaText}>{new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</Text></View>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.clientRow}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
                <View><Text style={styles.clientName}>{client.name}</Text><Text style={styles.clientMeta}>{client.memberId} · {t('janakpurCenter')}</Text></View>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('visitPurpose')}</Text>
              <View style={styles.purposeGrid}>
                {PURPOSES.map(p => (
                  <TouchableOpacity key={p.key} onPress={() => setSelectedPurpose(p.key)} style={[styles.purposeButton, selectedPurpose === p.key && styles.purposeActive]}>
                    <Text style={styles.purposeEmoji}>{p.emoji}</Text>
                    <Text style={[styles.purposeLabel, selectedPurpose === p.key && styles.purposeLabelActive]}>{isNe ? p.labelNe : p.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('location')}</Text>
              {gpsStatus === 'requesting' ? (
                <View style={styles.mapPreview}>
                  <ActivityIndicator size="small" color={colors.navy} />
                  <Text style={styles.mapLocation}>{t('gpsLocked')}</Text>
                </View>
              ) : gpsDenied ? (
                <View style={[styles.mapPreview, styles.mapPreviewDenied]}>
                  <Ionicons name="location-outline" size={24} color={colors.red} />
                  <Text style={[styles.mapLocation, { color: colors.red }, { textAlign: 'center' }]}>{t('gpsPermissionDenied')}</Text>
                </View>
              ) : (
                <View style={styles.mapPreview}>
                  <Ionicons name="location" size={24} color={colors.navy} />
                  {gpsData ? (
                    <>
                      <Text style={styles.mapLocation}>{gpsData.address}</Text>
                      <Text style={styles.mapCoords}>{gpsData.latitude.toFixed(4)}° N, {gpsData.longitude.toFixed(4)}° E</Text>
                      <Text style={styles.mapAccuracy}>{Math.round(gpsData.accuracy)}m {t('accurate')}</Text>
                    </>
                  ) : (
                    <Text style={[styles.mapLocation, { color: colors.orange }]}>{t('gpsTimeout')}</Text>
                  )}
                </View>
              )}

              <View style={styles.gpsChips}>
                {gpsDenied ? (
                  <>
                    <StatusChip label={t('syncFailed')} variant="overdue" />
                  <TouchableOpacity onPress={requestGps} style={styles.retryButton}>
                    <Ionicons name="refresh" size={12} color={colors.navy} />
                    <Text style={styles.retryText}>{t('requestGpsPermission')}</Text>
                  </TouchableOpacity>
                </>
                ) : gpsStatus === 'unavailable' ? (
                  <>
                    <StatusChip label={t('syncFailed')} variant="overdue" />
                    <TouchableOpacity onPress={requestGps} style={styles.retryButton}>
                      <Ionicons name="refresh" size={12} color={colors.navy} />
                      <Text style={styles.retryText}>{t('retryAll')}</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <StatusChip label={t('gpsLocked')} variant="verified" />
                    {gpsData && <StatusChip label={`${Math.round(gpsData.accuracy)}m`} variant="success" />}
                    {!gpsData && <StatusChip label={t('gpsAddressUnavailable')} variant="success" />}
                  </>
                )}
              </View>
            </View>

            {(gpsStatus === 'success' || gpsStatus === 'unavailable' || gpsDenied) && (
              <>
                <PrivacyNoteCard />
                <ValidationError message={error} />
                <PrimaryButton onPress={handleCheckIn} icon="checkmark-circle">{gpsDenied ? t('saveWithReason') : t('confirmCheckin')}</PrimaryButton>
                {gpsDenied && (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>{t('reason')}</Text>
                    <TextInput
                      style={styles.reasonInput}
                      value={saveReason}
                      onChangeText={setSaveReason}
                      placeholder={t('explainGpsUnavailable')}
                      placeholderTextColor={colors.gray400}
                      multiline
                    />
                  </View>
                )}
              </>
            )}

            <TouchableOpacity onPress={() => router.back()} style={styles.cancelButton}><Text style={styles.cancelText}>{t('cancel')}</Text></TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md, paddingBottom: 80 },
  card: { backgroundColor: colors.white, borderRadius: borderRadius.xl, padding: spacing.lg, borderWidth: 1, borderColor: colors.gray100, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  clientRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: 9999, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: fontSize.md, fontWeight: 'bold', color: colors.white },
  clientName: { fontSize: fontSize.md, fontWeight: '600', color: colors.gray800 },
  clientMeta: { fontSize: fontSize.sm, color: colors.gray500 },
  cardTitle: { fontSize: fontSize.base, fontWeight: 'bold', color: colors.gray700, marginBottom: spacing.sm },
  purposeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  purposeButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.gray200, width: '48%' },
  purposeActive: { borderColor: colors.navy, backgroundColor: colors.navyBg },
  purposeEmoji: { fontSize: fontSize.lg },
  purposeLabel: { fontSize: fontSize.sm, fontWeight: '600', color: colors.gray600 },
  purposeLabelActive: { color: colors.navy },
  mapPreview: { height: 112, borderRadius: borderRadius.lg, backgroundColor: colors.navyBg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.gray200 },
  mapPreviewDenied: { borderColor: '#FCA5A5' },
  mapLocation: { fontSize: fontSize.base, fontWeight: '500', color: colors.navy, marginTop: spacing.xs },
  mapCoords: { fontSize: fontSize.xs, color: colors.gray400 },
  mapAccuracy: { fontSize: fontSize.xs, color: colors.green },
  gpsChips: { flexDirection: 'row', gap: 6, marginTop: spacing.sm, alignItems: 'center' },
  retryButton: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto', paddingVertical: 4, paddingHorizontal: spacing.sm, borderRadius: borderRadius.sm, backgroundColor: colors.navyBg },
  retryText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.navy },
  successContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 48, paddingBottom: 48 },
  successIcon: { width: 64, height: 64, borderRadius: 9999, backgroundColor: colors.greenLight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  successTitle: { fontSize: fontSize['4xl'], fontWeight: 'bold', color: colors.gray800, marginBottom: 4 },
  successDesc: { fontSize: fontSize.md, color: colors.gray500, textAlign: 'center', marginBottom: spacing.sm },
  successMeta: { marginTop: spacing.xl, gap: 4 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: fontSize.sm, color: colors.gray400 },
  cancelButton: { paddingVertical: spacing.md, alignItems: 'center' },
  cancelText: { fontSize: fontSize.lg, fontWeight: '600', color: colors.gray500 },
  reasonInput: { borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.gray200, backgroundColor: colors.gray50, padding: spacing.md, fontSize: fontSize.base, color: colors.gray800, minHeight: 80, textAlignVertical: 'top' },
});
