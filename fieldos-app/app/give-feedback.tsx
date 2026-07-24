/**
 * Give Feedback — the officer's entry point into the hierarchical feedback loop.
 *
 * Officers file feedback tied to a category/severity/subject; if Head Office has
 * an open campaign for their role, a banner lets them answer it directly (the
 * submission is tagged with campaign_id). Author identity is derived server-side
 * from the JWT and is HIDDEN from the branch manager (§7) — we surface that
 * promise in the UI so officers trust it.
 */
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../constants';
import { useTranslation } from '../i18n';
import { AppHeader } from '../components/fieldos/AppHeader';
import { StatusChip } from '../components/fieldos/StatusChip';
import { PrimaryButton } from '../components/fieldos/PrimaryButton';
import { ValidationError } from '../components/fieldos/ValidationError';
import { submitFeedback, fetchOpenCampaigns, type FeedbackCategory, type OpenCampaign } from '../services';

const CATEGORIES: { key: FeedbackCategory; icon: keyof typeof Ionicons.glyphMap; label: string; labelNe: string }[] = [
  { key: 'time_sink', icon: 'time-outline', label: 'Wastes my time', labelNe: 'समय खेर जान्छ' },
  { key: 'bug', icon: 'bug-outline', label: 'Something broken', labelNe: 'केही बिग्रियो' },
  { key: 'request', icon: 'bulb-outline', label: 'A request / idea', labelNe: 'अनुरोध / विचार' },
  { key: 'blocker', icon: 'hand-left-outline', label: 'Blocking my work', labelNe: 'काम रोकियो' },
  { key: 'praise', icon: 'heart-outline', label: 'Something good', labelNe: 'राम्रो कुरा' },
];

export default function GiveFeedbackScreen() {
  const router = useRouter();
  const { t, isNe } = useTranslation();
  const [category, setCategory] = useState<FeedbackCategory | ''>('');
  const [severity, setSeverity] = useState(3);
  const [bodyText, setBodyText] = useState('');
  const [campaign, setCampaign] = useState<OpenCampaign | null>(null);
  const [answeringCampaign, setAnsweringCampaign] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Pull the first open campaign for this officer (nice-to-have; silent on fail).
  useEffect(() => {
    fetchOpenCampaigns().then((cs) => { if (cs.length > 0) setCampaign(cs[0]); }).catch(() => {});
  }, []);

  async function handleSubmit() {
    setError('');
    if (!category) { setError(t('fbPickCategory')); return; }
    if (!bodyText.trim()) { setError(t('fbEnterText')); return; }

    setSubmitting(true);
    const res = await submitFeedback({
      category,
      severity,
      bodyText: bodyText.trim(),
      campaignId: answeringCampaign && campaign ? campaign.id : undefined,
    });
    setSubmitting(false);

    if (!res.ok) { setError(res.error || t('fbSubmitFailed')); return; }
    setDone(true);
  }

  if (done) {
    return (
      <View style={styles.container}>
        <AppHeader title={t('giveFeedback')} showBack />
        <View style={styles.body}>
          <View style={styles.successContainer}>
            <View style={styles.successIcon}><Ionicons name="checkmark-circle" size={40} color={colors.green} /></View>
            <Text style={styles.successTitle}>{t('fbThanks')}</Text>
            <Text style={styles.successDesc}>{t('fbThanksDesc')}</Text>
            <StatusChip label={t('fbAnonymousChip')} variant="verified" />
            <View style={styles.successActions}>
              <PrimaryButton onPress={() => {
                try { if (router.canDismiss()) router.dismissAll(); } catch { /* no modal */ }
                router.navigate('/(tabs)/profile');
              }}>{t('fbDone')}</PrimaryButton>
              <TouchableOpacity onPress={() => { setDone(false); setCategory(''); setBodyText(''); setSeverity(3); setAnsweringCampaign(false); }}>
                <Text style={styles.viewClientText}>{t('fbGiveAnother')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AppHeader title={t('giveFeedback')} showBack />
      <ScrollView style={styles.body} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Trust line — the anonymity promise, stated plainly. */}
        <View style={styles.trustRow}>
          <Ionicons name="shield-checkmark-outline" size={16} color={colors.green} />
          <Text style={styles.trustText}>{t('fbAnonymousNote')}</Text>
        </View>

        {/* Optional campaign banner */}
        {campaign && (
          <TouchableOpacity
            style={[styles.campaignCard, answeringCampaign && styles.campaignCardActive]}
            onPress={() => setAnsweringCampaign(!answeringCampaign)}
            activeOpacity={0.8}
          >
            <View style={styles.campaignHeader}>
              <Ionicons name="megaphone-outline" size={18} color={colors.orange} />
              <Text style={styles.campaignLabel}>{t('fbCampaignFromOffice')}</Text>
              {answeringCampaign && <Ionicons name="checkmark-circle" size={18} color={colors.orange} style={{ marginLeft: 'auto' }} />}
            </View>
            <Text style={styles.campaignPrompt}>
              {isNe && campaign.prompt_ne ? campaign.prompt_ne : campaign.prompt_text}
            </Text>
            <Text style={styles.campaignHint}>
              {answeringCampaign ? t('fbAnsweringThis') : t('fbTapToAnswer')}
            </Text>
          </TouchableOpacity>
        )}

        {/* Category */}
        <Text style={styles.sectionLabel}>{t('fbWhatsUp')}</Text>
        <View style={styles.chipWrap}>
          {CATEGORIES.map((c) => {
            const active = category === c.key;
            return (
              <TouchableOpacity
                key={c.key}
                style={[styles.catChip, active && styles.catChipActive]}
                onPress={() => setCategory(c.key)}
                activeOpacity={0.8}
              >
                <Ionicons name={c.icon} size={18} color={active ? colors.white : colors.navy} />
                <Text style={[styles.catChipText, active && styles.catChipTextActive]}>
                  {isNe ? c.labelNe : c.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Severity (hidden for praise — you don't rate a compliment 1-5) */}
        {category !== 'praise' && (
          <>
            <Text style={styles.sectionLabel}>{t('fbHowMuch')}</Text>
            <View style={styles.sevRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <TouchableOpacity
                  key={n}
                  style={[styles.sevDot, severity >= n && styles.sevDotActive]}
                  onPress={() => setSeverity(n)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.sevDotText, severity >= n && styles.sevDotTextActive]}>{n}</Text>
                </TouchableOpacity>
              ))}
              <Text style={styles.sevHint}>{severity <= 2 ? t('fbMinor') : severity >= 4 ? t('fbSerious') : t('fbModerate')}</Text>
            </View>
          </>
        )}

        {/* Body */}
        <Text style={styles.sectionLabel}>{t('fbTellUsMore')}</Text>
        <TextInput
          style={styles.textArea}
          value={bodyText}
          onChangeText={setBodyText}
          placeholder={t('fbPlaceholder')}
          placeholderTextColor={colors.gray500}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />

        <ValidationError message={error} />

        <PrimaryButton
          onPress={handleSubmit}
          loading={submitting}
          disabled={submitting}
          style={{ marginTop: spacing.lg }}
        >
          {t('fbSubmit')}
        </PrimaryButton>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },

  trustRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.md },
  trustText: { flex: 1, fontSize: fontSize.xs, color: colors.green },

  campaignCard: { borderWidth: 1, borderColor: colors.border, borderRadius: borderRadius.lg, padding: spacing.md, marginBottom: spacing.lg, backgroundColor: colors.white },
  campaignCardActive: { borderColor: colors.orange, backgroundColor: '#FFF7ED' },
  campaignHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  campaignLabel: { fontSize: fontSize.xs, fontWeight: '700', color: colors.orange, textTransform: 'uppercase', letterSpacing: 0.5 },
  campaignPrompt: { fontSize: fontSize.md, color: colors.navy, fontWeight: '600', marginBottom: spacing.xs },
  campaignHint: { fontSize: fontSize.xs, color: colors.gray500 },

  sectionLabel: { fontSize: fontSize.sm, fontWeight: '700', color: colors.navy, marginBottom: spacing.sm, marginTop: spacing.md },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  catChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: borderRadius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  catChipActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  catChipText: { fontSize: fontSize.sm, color: colors.navy, fontWeight: '600' },
  catChipTextActive: { color: colors.white },

  sevRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sevDot: { width: 40, height: 40, borderRadius: borderRadius.full, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  sevDotActive: { backgroundColor: colors.orange, borderColor: colors.orange },
  sevDotText: { fontSize: fontSize.md, fontWeight: '700', color: colors.gray500 },
  sevDotTextActive: { color: colors.white },
  sevHint: { marginLeft: spacing.sm, fontSize: fontSize.sm, color: colors.gray500 },

  textArea: { borderWidth: 1, borderColor: colors.border, borderRadius: borderRadius.lg, padding: spacing.md, fontSize: fontSize.md, color: colors.navy, minHeight: 110, backgroundColor: colors.white },

  successContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  successIcon: { marginBottom: spacing.md },
  successTitle: { fontSize: fontSize.xl, fontWeight: '700', color: colors.navy, marginBottom: spacing.xs },
  successDesc: { fontSize: fontSize.sm, color: colors.gray500, textAlign: 'center', marginBottom: spacing.md },
  successActions: { marginTop: spacing.xl, width: '100%', gap: spacing.md, alignItems: 'center' },
  viewClientText: { fontSize: fontSize.sm, color: colors.navy, fontWeight: '600' },
});
