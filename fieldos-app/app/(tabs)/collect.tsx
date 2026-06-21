import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, TextInput, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../../constants';
import { useFieldOSStore } from '../../store/useFieldOSStore';
import { AppHeader } from '../../components/fieldos/AppHeader';
import { StatusChip } from '../../components/fieldos/StatusChip';
import { PrimaryButton } from '../../components/fieldos/PrimaryButton';
import { ValidationError } from '../../components/fieldos/ValidationError';
import { recordCollection } from '../../services/collectionService';
import { fetchClients } from '../../services/clientService';
import { useTranslation } from '../../i18n';

const PAYMENT_METHODS = [
  { key: 'cash', label: 'Cash', emoji: '💵' },
  { key: 'qr', label: 'QR', emoji: '📱' },
  { key: 'mobile-banking', label: 'Mobile Banking', emoji: '🏦' },
  { key: 'esewa', label: 'eSewa', emoji: '🟢' },
  { key: 'khalti', label: 'Khalti', emoji: '🟣' },
  { key: 'ime-pay', label: 'IME Pay', emoji: '🔵' },
  { key: 'bank-transfer', label: 'Bank Transfer', emoji: '🏛️' },
  { key: 'connectips', label: 'connectIPS', emoji: '🔗' },
  { key: 'other', label: 'Other', emoji: '📝' },
];

export default function RecordCollectionScreen() {
  const router = useRouter();
  const { selectedClient, setSelectedClient, collectionAmount, setCollectionAmount, openFaceVerification, setClientDueAmount, setClientOutstanding, setLastReceiptAmount, setReceiptStatus, setReceiptId } = useFieldOSStore();
  const { t } = useTranslation();
  const [selectedMethod, setSelectedMethod] = useState('cash');
  const [showKeypad, setShowKeypad] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Client picker (when opened from the Collect tab without a client chosen)
  const [clients, setClients] = useState<any[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number; address: string } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'capturing' | 'done' | 'denied'>('idle');

  const loadClients = useCallback(async () => {
    setClientsLoading(true);
    try {
      const res = await fetchClients();
      if (res.success && Array.isArray(res.data)) setClients(res.data);
    } catch { /* offline */ } finally { setClientsLoading(false); }
  }, []);

  // When no client is selected, load the list so the officer can pick one.
  useEffect(() => { if (!selectedClient) loadClients(); }, [selectedClient, loadClients]);

  // Capture GPS for the collection (called when a client is picked).
  const captureGps = useCallback(async () => {
    setGpsStatus('capturing');
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') { setGpsStatus('denied'); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      let address = '';
      try {
        const geo = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        const g = geo[0];
        address = g ? [g.name, g.street, g.city, g.region].filter(Boolean).join(', ') : '';
      } catch { /* address optional */ }
      setGps({ lat: loc.coords.latitude, lng: loc.coords.longitude, accuracy: loc.coords.accuracy ?? 0, address });
      setGpsStatus('done');
    } catch { setGpsStatus('denied'); }
  }, []);

  const pickClient = (c: any) => {
    const due = Number(c.due_amount ?? c.dueAmount ?? 0);
    setSelectedClient({
      id: String(c.id ?? c.member_id ?? c.memberId),
      name: c.name,
      memberId: c.member_id ?? c.memberId,
      clientId: c.id ?? c.clientId,
      dueAmount: due,
      outstandingBalance: Number(c.outstanding_balance ?? c.outstandingBalance ?? due),
    } as any);
    captureGps();
  };

  const client = selectedClient || { id: 'M-1042', name: 'Sunita Kumari Chaudhary', memberId: 'M-1042' };
  const dueAmount = selectedClient?.dueAmount || 0;
  const outstanding = selectedClient?.outstandingBalance || 0;
  const amount = parseInt(collectionAmount) || 0;
  const isHighValue = amount >= 10000;

  const handleSave = async () => {
    setError('');

    // Validation
    if (!collectionAmount || collectionAmount.trim() === '') {
      setError(t('collectionAmountRequired'));
      return;
    }

    const amt = parseInt(collectionAmount);
    if (isNaN(amt)) {
      setError(t('amountMustBeNumber'));
      return;
    }

    if (amt <= 0) {
      setError(t('amountMustBeGreaterThanZero'));
      return;
    }

    if (isHighValue) {
      // Show warning but still allow save
      // The existing high-value warning card already shows
    }

    setSaving(true);

    // Use numeric clientId from store, with memberId string as fallback
    const numericClientId = selectedClient?.clientId ?? Number(client.id);

    console.log('[Collect] submit start');
    console.log('[Collect] selectedClient:', JSON.stringify(selectedClient));

    if (!numericClientId) {
      setError(t('missingClientInfo'));
      setSaving(false);
      return;
    }

    const due = selectedClient?.dueAmount || 5500;
    const remainingDue = Math.max(due - amt, 0);
    const remainingOutstanding = Math.max((selectedClient?.outstandingBalance || 0) - amt, 0);

    console.log('[Collect] payload to recordCollection:', {
      clientId: numericClientId,
      amount: amt,
      originalDue: due,
      remainingDue,
      originalOutstanding: selectedClient?.outstandingBalance,
      remainingOutstanding,
      paymentMethod: selectedMethod,
    });

    try {
      const result = await recordCollection({
        clientId: numericClientId,
        amount: amt,
        dueAmount: due,
        outstandingAfter: remainingOutstanding,
        paymentMethod: selectedMethod,
        isHighValue: amt >= 10000,
        taskId: (selectedClient as any)?.taskId,
        faceVerified: false,
        gpsLatitude: gps?.lat,
        gpsLongitude: gps?.lng,
        gpsAccuracyMeters: gps?.accuracy,
      });
      console.log('[Collection] Saved:', result.data?.receiptId);

      const receiptId = result.data?.receiptId || `RCP-${Date.now()}`;
      setClientDueAmount(remainingDue);
      setClientOutstanding(remainingOutstanding);
      setLastReceiptAmount(amt);
      setReceiptId(receiptId);
      setReceiptStatus('saved-offline');
      setCollectionAmount('');

      // Update selectedClient with remaining due so returning screens show correct amounts
      if (selectedClient) {
        setSelectedClient({ ...selectedClient, dueAmount: remainingDue, outstandingBalance: remainingOutstanding, remainingDue });
      }

      console.log('[Collect] recordCollection result:', result);
    } catch (e) {
      console.warn('[Collect] save failed:', e);
      setSaving(false);
      return;
    }
    setSaving(false);

    console.log('[Collect] navigating to receipt');
    try {
      if (isHighValue) {
        openFaceVerification('high-value-collection');
      }
    } catch (e) {
      console.warn('[Collect] face verification error:', e);
    }
    router.push('/receipt');
  };

  const handleKeyPress = (key: string) => {
    if (key === 'backspace') {
      setCollectionAmount(collectionAmount.slice(0, -1));
    } else if (key === '.') {
      if (!collectionAmount.includes('.')) setCollectionAmount(collectionAmount + '.');
    } else {
      setCollectionAmount(collectionAmount + key);
    }
  };

  const initials = client.name.split(' ').map(n => n[0]).slice(0, 2).join('');

  if (!selectedClient) {
    const filtered = clients.filter((c: any) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (c.name || '').toLowerCase().includes(q) || String(c.member_id ?? c.memberId ?? '').toLowerCase().includes(q);
    });
    return (
      <View style={styles.container}>
        <AppHeader title={t('selectClientTitle')} showBack />
        <View style={styles.pickerSearchWrap}>
          <Ionicons name="search" size={16} color={colors.gray400} />
          <TextInput
            style={styles.pickerSearch}
            value={search}
            onChangeText={setSearch}
            placeholder={t('searchClientPlaceholder')}
            placeholderTextColor={colors.gray400}
          />
        </View>
        {clientsLoading ? (
          <View style={styles.pickerCenter}><ActivityIndicator size="large" color={colors.navy} /></View>
        ) : (
          <ScrollView style={styles.body} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            {filtered.length === 0 ? (
              <Text style={styles.pickerEmpty}>{t('noClientsFound')}</Text>
            ) : filtered.map((c: any) => (
              <TouchableOpacity key={String(c.id ?? c.member_id)} style={styles.pickerRow} onPress={() => pickClient(c)}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{(c.name || '?').split(' ').map((n: string) => n[0]).slice(0, 2).join('')}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.clientName}>{c.name}</Text>
                  <Text style={styles.clientId}>{c.member_id ?? c.memberId} · {t('dueAmount')} NPR {Number(c.due_amount ?? 0).toLocaleString()}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.gray400} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AppHeader title={t('recordCollectionTitle')} showBack />

      <ScrollView style={styles.body} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* GPS status for this collection */}
        <View style={[styles.gpsBanner, gpsStatus === 'denied' && styles.gpsBannerWarn]}>
          <Ionicons name={gpsStatus === 'done' ? 'location' : gpsStatus === 'denied' ? 'location-outline' : 'navigate'} size={14} color={gpsStatus === 'denied' ? colors.red : colors.green} />
          <Text style={styles.gpsBannerText}>
            {gpsStatus === 'capturing' ? t('gpsCapturing') : gpsStatus === 'done' ? (gps?.address || t('gpsCaptured')) : gpsStatus === 'denied' ? t('gpsDeniedShort') : t('gpsCaptured')}
          </Text>
          {gpsStatus === 'denied' && (
            <TouchableOpacity onPress={captureGps}><Text style={styles.gpsRetry}>{t('retry')}</Text></TouchableOpacity>
          )}
        </View>
        <View style={styles.card}>
          <View style={styles.clientRow}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.clientName}>{client.name}</Text>
              <Text style={styles.clientId}>{client.memberId}</Text>
            </View>
            <StatusChip label={t('verified')} variant="verified" />
          </View>
          <View style={styles.amountRow}>
            <Text style={styles.amountLabel}>{t('dueAmount')}</Text>
            <Text style={styles.dueAmount}>NPR {dueAmount.toLocaleString()}</Text>
          </View>
          <View style={styles.amountRow}>
            <Text style={styles.amountLabel}>{t('outstanding')}</Text>
            <Text style={styles.outstandingAmount}>NPR {outstanding.toLocaleString()}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('amountCollected')}</Text>
          <TouchableOpacity onPress={() => setShowKeypad(!showKeypad)} style={[styles.amountInput, showKeypad && styles.amountInputActive]}>
            <Text style={styles.nprLabel}>NPR</Text>
            <Text style={[styles.amountValue, { color: amount > 0 ? colors.navy : colors.gray300 }]}>
              {amount > 0 ? amount.toLocaleString() : '0'}
            </Text>
            <Ionicons name="wallet-outline" size={18} color={colors.gray400} />
          </TouchableOpacity>

          {showKeypad && (
            <View style={styles.keypadGrid}>
              {['1','2','3','backspace','4','5','6','.','7','8','9','0','00','000'].map(key => (
                <TouchableOpacity key={key} onPress={() => handleKeyPress(key)} style={styles.keyButton}>
                  <Text style={[styles.keyText, key === 'backspace' && styles.backspaceText]}>
                    {key === 'backspace' ? '⌫' : key}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity onPress={() => setCollectionAmount(String(dueAmount))} style={styles.fullDueButton}>
                <Text style={styles.fullDueText}>{t('setFullDueAmount')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {amount > 0 && amount < dueAmount && (
            <View style={styles.partialWarning}>
              <Ionicons name="warning" size={12} color={colors.orange} />
              <Text style={styles.partialText}>
                {t('partialPaymentRemaining', { n: (dueAmount - amount).toLocaleString() })}
              </Text>
            </View>
          )}
        </View>

        <ValidationError message={error} />

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('paymentMethod')}</Text>
          <View style={styles.methodGrid}>
            {PAYMENT_METHODS.map(m => (
              <TouchableOpacity
                key={m.key}
                onPress={() => setSelectedMethod(m.key)}
                style={[styles.methodButton, selectedMethod === m.key && styles.methodButtonActive]}
              >
                <Text style={styles.methodEmoji}>{m.emoji}</Text>
                <Text style={[styles.methodLabel, selectedMethod === m.key && styles.methodLabelActive]}>{m.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {isHighValue && (
          <View style={styles.highValueWarning}>
            <Ionicons name="shield-outline" size={14} color="#D97706" style={{ marginTop: 2 }} />
            <View>
              <Text style={styles.hvTitle}>{t('highValueCollection')}</Text>
              <Text style={styles.hvDesc}>{t('identityVerificationWillBeRequired')}</Text>
            </View>
          </View>
        )}

        <View style={styles.statusChips}>
          <StatusChip label={t('savedOffline')} variant="saved" />
          <StatusChip label={t('pendingSync')} variant="sync" />
          <StatusChip label={t('pendingVerification')} variant="overdue" />
        </View>

        <PrimaryButton onPress={handleSave} icon="checkmark-circle" disabled={saving}>{t('recordCollectionBtn')}</PrimaryButton>

        <TouchableOpacity onPress={router.back} style={styles.cancelButton}>
          <Text style={styles.cancelText}>{t('cancel')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  pickerSearchWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, marginTop: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.white, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.gray200 },
  pickerSearch: { flex: 1, fontSize: fontSize.base, color: colors.gray800 },
  pickerCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  pickerEmpty: { textAlign: 'center', color: colors.gray400, fontSize: fontSize.base, paddingVertical: 40 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.white, borderRadius: borderRadius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.gray100 },
  gpsBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: borderRadius.lg, backgroundColor: colors.greenLight, borderWidth: 1, borderColor: colors.green },
  gpsBannerWarn: { backgroundColor: colors.orangeLight, borderColor: colors.orange },
  gpsBannerText: { flex: 1, fontSize: fontSize.sm, color: colors.gray700 },
  gpsRetry: { fontSize: fontSize.sm, fontWeight: '700', color: colors.navy },
  body: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md, paddingBottom: 80 },
  card: { backgroundColor: colors.white, borderRadius: borderRadius.xl, padding: spacing.lg, borderWidth: 1, borderColor: colors.gray100, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  clientRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: 9999, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: fontSize.md, fontWeight: 'bold', color: colors.white },
  clientName: { fontSize: fontSize.md, fontWeight: '600', color: colors.gray800 },
  clientId: { fontSize: fontSize.sm, color: colors.gray500 },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  amountLabel: { fontSize: fontSize.base, color: colors.gray500 },
  dueAmount: { fontSize: fontSize.lg, fontWeight: 'bold', color: colors.red },
  outstandingAmount: { fontSize: fontSize.md, fontWeight: '500', color: colors.gray700 },
  cardTitle: { fontSize: fontSize.base, fontWeight: 'bold', color: colors.gray700, marginBottom: spacing.sm },
  amountInput: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: borderRadius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderWidth: 2, borderColor: colors.gray200, backgroundColor: colors.white },
  amountInputActive: { borderColor: colors.navy, backgroundColor: colors.navyBg },
  nprLabel: { fontSize: fontSize.lg, fontWeight: '500', color: colors.gray400 },
  amountValue: { fontSize: fontSize['3xl'], fontWeight: 'bold', flex: 1 },
  keypadGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  keyButton: { width: '22%', paddingVertical: spacing.sm, borderRadius: borderRadius.sm, borderWidth: 1, borderColor: colors.gray200, backgroundColor: colors.gray50, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontSize: fontSize.lg, fontWeight: '600', color: colors.gray800 },
  backspaceText: { fontSize: fontSize.sm, color: colors.red },
  fullDueButton: { width: '100%', paddingVertical: spacing.sm, alignItems: 'center', marginTop: 4 },
  fullDueText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.navy },
  partialWarning: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: borderRadius.sm, backgroundColor: colors.orangeLight, marginTop: spacing.sm },
  partialText: { fontSize: fontSize.sm, fontWeight: '500', color: colors.orange, flex: 1 },
  methodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  methodButton: { width: '30%', alignItems: 'center', gap: 4, padding: spacing.sm, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.gray200, backgroundColor: colors.white },
  methodButtonActive: { borderColor: colors.navy, backgroundColor: colors.navyBg },
  methodEmoji: { fontSize: fontSize.xl },
  methodLabel: { fontSize: fontSize.xs, fontWeight: '600', color: colors.gray600 },
  methodLabelActive: { color: colors.navy },
  highValueWarning: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: '#FCD34D', backgroundColor: '#FEF3C7' },
  hvTitle: { fontSize: fontSize.sm, fontWeight: '600', color: '#92400E' },
  hvDesc: { fontSize: fontSize.xs, color: '#A16207' },
  statusChips: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  cancelButton: { paddingVertical: spacing.md, alignItems: 'center', borderRadius: borderRadius.lg },
  cancelText: { fontSize: fontSize.lg, fontWeight: '600', color: colors.gray500 },
});
