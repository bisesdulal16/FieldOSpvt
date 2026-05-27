import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'expo-router';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  TextInput,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../constants';
import { AppHeader } from '../components/fieldos/AppHeader';
import { StatusChip } from '../components/fieldos/StatusChip';
import { PrimaryButton } from '../components/fieldos/PrimaryButton';
import { SecondaryButton } from '../components/fieldos/SecondaryButton';
import { useTranslation } from '../i18n';
import { auditPilotInfoViewed, auditFeedbackSubmitted } from '../services/auditService';
import { enqueueSyncEvent } from '../db/repositories/syncQueueRepo';
import { setSetting } from '../db/repositories/settingsRepo';
import type { TranslationKey } from '../i18n';

// ─── Training Module Data ──────────────────────────────────────

type TrainingStatus = 'completed' | 'incomplete' | 'not_started';

interface TrainingModule {
  icon: string;
  tKey: TranslationKey;
  typeKey: TranslationKey;
  status: TrainingStatus;
}

const TRAINING_MODULES: TrainingModule[] = [
  { icon: 'phone-portrait-outline', tKey: 'trainingModule1', typeKey: 'trainingTypeRequired', status: 'completed' },
  { icon: 'location-outline', tKey: 'trainingModule2', typeKey: 'trainingTypeRequired', status: 'completed' },
  { icon: 'wallet-outline', tKey: 'trainingModule3', typeKey: 'trainingTypeRequired', status: 'completed' },
  { icon: 'calendar-outline', tKey: 'trainingModule4', typeKey: 'trainingTypeRequired', status: 'completed' },
  { icon: 'people-outline', tKey: 'trainingModule5', typeKey: 'trainingTypeRequired', status: 'completed' },
  { icon: 'clipboard-outline', tKey: 'trainingModule6', typeKey: 'trainingTypeRequired', status: 'completed' },
  { icon: 'shield-outline', tKey: 'trainingModule7', typeKey: 'trainingTypeRequired', status: 'incomplete' },
  { icon: 'cloud-outline', tKey: 'trainingModule8', typeKey: 'trainingTypeOptional', status: 'incomplete' },
];

// ─── Quick Reference Data ──────────────────────────────────────

interface QuickRefItem {
  icon: string;
  tKey: TranslationKey;
  alertKey: TranslationKey;
  color: string;
  bg: string;
}

const QUICK_REFERENCE: QuickRefItem[] = [
  { icon: 'document-text-outline', tKey: 'sopGuide', alertKey: 'sopGuideAlert', color: colors.navy, bg: colors.navyBg },
  { icon: 'call-outline', tKey: 'emergencySupport', alertKey: 'emergencySupportAlert', color: colors.red, bg: '#FEE2E2' },
  { icon: 'calendar-outline', tKey: 'trainingSchedule', alertKey: 'trainingScheduleAlert', color: colors.orange, bg: colors.orangeLight },
  { icon: 'chatbox-outline', tKey: 'submitFeedback', alertKey: 'submitFeedback' as TranslationKey, color: colors.green, bg: colors.greenLight },
  { icon: 'lock-closed-outline', tKey: 'privacyPolicy', alertKey: 'privacyPolicyAlert', color: colors.navy, bg: colors.navyBg },
];

// ─── FAQ Data ──────────────────────────────────────────────────

interface FaqItem {
  qKey: TranslationKey;
  aKey: TranslationKey;
}

const FAQ_ITEMS: FaqItem[] = [
  { qKey: 'faqData', aKey: 'faqDataAnswer' },
  { qKey: 'faqSecurity', aKey: 'faqSecurityAnswer' },
  { qKey: 'faqTechnical', aKey: 'faqTechnicalAnswer' },
  { qKey: 'faqImpact', aKey: 'faqImpactAnswer' },
  { qKey: 'faqTraining', aKey: 'faqTrainingAnswer' },
  { qKey: 'faqRecommend', aKey: 'faqRecommendAnswer' },
];

// ─── Star Rating Component ─────────────────────────────────────

function StarRating({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <View style={starStyles.row}>
      {[1, 2, 3, 4, 5].map(star => {
        const icon = star <= value ? 'star' : 'star-outline';
        return (
          <TouchableOpacity
            key={star}
            onPress={() => onChange?.(star)}
            disabled={!onChange}
            style={starStyles.star}
          >
            <Ionicons
              name={icon as any}
              size={22}
              color={star <= value ? colors.orange : colors.gray300}
            />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const starStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4 },
  star: { padding: 2 },
});

// ─── Main Screen ───────────────────────────────────────────────

export default function PilotInfoScreen() {
  const router = useRouter();
  const { t } = useTranslation();

  // Audit on view
  useEffect(() => {
    auditPilotInfoViewed();
  }, []);

  // Feedback modal state
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  // Training stats
  const completedCount = useMemo(
    () => TRAINING_MODULES.filter(m => m.status === 'completed').length,
    []
  );
  const incompleteCount = TRAINING_MODULES.filter(m => m.status !== 'completed').length;
  const progressPercent = Math.round((completedCount / TRAINING_MODULES.length) * 100);

  // FAQ expandable state
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  // Quick ref handler
  const handleQuickRef = (item: QuickRefItem) => {
    if (item.tKey === 'submitFeedback') {
      setShowFeedback(true);
    } else {
      alert(t(item.alertKey));
    }
  };

  return (
    <View style={styles.container}>
      <AppHeader title={t('pilotProgram')} showBack />

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Section 1: Pilot Status Card */}
        <View style={styles.card}>
          <View style={styles.sectionLabelRow}>
            <View style={[styles.sectionIconBox, { backgroundColor: colors.orangeLight }]}>
              <Ionicons name="rocket-outline" size={16} color={colors.orange} />
            </View>
            <Text style={styles.sectionLabel}>{t('pilotStatus')}</Text>
          </View>

          <View style={styles.statusGrid}>
            <Text style={styles.statusKey}>{t('pilotInstitution')}</Text>
            <Text style={styles.statusValue}>Demo Microfinance Ltd.</Text>

            <Text style={styles.statusKey}>{t('pilotPhase')}</Text>
            <StatusChip label={t('pilotPhasePreparation')} variant="warning" />

            <Text style={styles.statusKey}>{t('pilotDuration')}</Text>
            <Text style={styles.statusValue}>Jun 1 – Aug 31, 2025 (12 weeks)</Text>

            <Text style={styles.statusKey}>{t('pilotBranch')}</Text>
            <Text style={styles.statusValue}>Kathmandu Main</Text>
          </View>
        </View>

        {/* Section 2: Training Status */}
        <View style={styles.card}>
          <View style={styles.sectionLabelRow}>
            <View style={[styles.sectionIconBox, { backgroundColor: colors.greenLight }]}>
              <Ionicons name="school-outline" size={16} color={colors.green} />
            </View>
            <Text style={styles.sectionLabel}>{t('myTrainingStatus')}</Text>
          </View>

          {/* Progress bar */}
          <View style={styles.progressSection}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressLabel}>{t('overallProgress')}</Text>
              <Text style={styles.progressValue}>{completedCount}/{TRAINING_MODULES.length} ({progressPercent}%)</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
            </View>
          </View>

          {/* Module list */}
          {TRAINING_MODULES.map((mod, idx) => (
            <View key={idx} style={styles.moduleRow}>
              <View style={styles.moduleLeft}>
                <View style={styles.moduleIconBox}>
                  {mod.status === 'completed' ? (
                    <Ionicons name="checkmark-circle" size={18} color={colors.green} />
                  ) : mod.status === 'incomplete' ? (
                    <Ionicons name="time" size={18} color={colors.orange} />
                  ) : (
                    <Ionicons name="ellipse-outline" size={18} color={colors.gray300} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.moduleName}>{t(mod.tKey)}</Text>
                  <StatusChip
                    label={t(mod.typeKey)}
                    variant={mod.typeKey === 'trainingTypeRequired' ? 'info' : 'sync'}
                  />
                </View>
              </View>
              <StatusChip
                label={
                  mod.status === 'completed'
                    ? t('trainingComplete')
                    : mod.status === 'incomplete'
                    ? t('trainingIncomplete')
                    : t('trainingNotStarted')
                }
                variant={
                  mod.status === 'completed'
                    ? 'verified'
                    : mod.status === 'incomplete'
                    ? 'warning'
                    : 'info'
                }
              />
            </View>
          ))}
        </View>

        {/* Section 3: Quick Reference */}
        <View style={styles.card}>
          <View style={styles.sectionLabelRow}>
            <View style={[styles.sectionIconBox, { backgroundColor: '#EDE9FE' }]}>
              <Ionicons name="grid-outline" size={16} color="#7C3AED" />
            </View>
            <Text style={styles.sectionLabel}>{t('quickReference')}</Text>
          </View>

          {QUICK_REFERENCE.map((item, idx) => (
            <TouchableOpacity
              key={idx}
              style={styles.quickRefRow}
              onPress={() => handleQuickRef(item)}
            >
              <View style={[styles.quickRefIcon, { backgroundColor: item.bg }]}>
                <Ionicons name={item.icon as any} size={18} color={item.color} />
              </View>
              <Text style={styles.quickRefLabel}>{t(item.tKey)}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.gray300} />
            </TouchableOpacity>
          ))}
        </View>

        {/* Section 4: FAQ */}
        <View style={styles.card}>
          <View style={styles.sectionLabelRow}>
            <View style={[styles.sectionIconBox, { backgroundColor: colors.navyBg }]}>
              <Ionicons name="help-circle-outline" size={16} color={colors.navy} />
            </View>
            <Text style={styles.sectionLabel}>{t('faq')}</Text>
          </View>

          {FAQ_ITEMS.map((faq, idx) => (
            <View key={idx} style={styles.faqContainer}>
              <TouchableOpacity
                style={styles.faqQuestion}
                onPress={() => setExpandedFaq(expandedFaq === idx ? null : idx)}
              >
                <Ionicons
                  name={expandedFaq === idx ? 'chevron-down' : 'chevron-forward'}
                  size={14}
                  color={colors.navy}
                />
                <Text style={styles.faqQuestionText}>{t(faq.qKey)}</Text>
              </TouchableOpacity>
              {expandedFaq === idx && (
                <View style={styles.faqAnswer}>
                  <Text style={styles.faqAnswerText}>{t(faq.aKey)}</Text>
                </View>
              )}
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Feedback Modal */}
      <FeedbackModal
        visible={showFeedback}
        onClose={() => {
          if (feedbackSubmitted) {
            setFeedbackSubmitted(false);
          }
          setShowFeedback(false);
        }}
        onSuccess={() => {
          setFeedbackSubmitted(true);
        }}
      />
    </View>
  );
}

// ─── Feedback Modal ────────────────────────────────────────────

function FeedbackModal({
  visible,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();

  const [isSubmitted, setIsSubmitted] = useState(false);

  // Star ratings
  const [satisfaction, setSatisfaction] = useState(0);
  const [easeOfUse, setEaseOfUse] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [offlineReliability, setOfflineReliability] = useState(0);
  const [trainingQuality, setTrainingQuality] = useState(0);

  // Text inputs
  const [whatWorks, setWhatWorks] = useState('');
  const [whatImproves, setWhatImproves] = useState('');
  const [bugs, setBugs] = useState('');

  // Select
  const [recommendIdx, setRecommendIdx] = useState(-1);
  const recommendOptions = [
    t('recommendYes'),
    t('recommendProbably'),
    t('recommendNotSure'),
    t('recommendProbablyNot'),
    t('recommendNo'),
  ] as const;

  const [submitting, setSubmitting] = useState(false);

  const allRated = satisfaction > 0 && easeOfUse > 0 && speed > 0 && offlineReliability > 0 && trainingQuality > 0;

  const handleSubmit = async () => {
    if (!allRated) {
      alert(t('requiredField'));
      return;
    }
    try {
      setSubmitting(true);
      const avgRating = (satisfaction + easeOfUse + speed + offlineReliability + trainingQuality) / 5;
      const recommendValue = recommendIdx >= 0 ? recommendOptions[recommendIdx] : '';

      // Save to local DB as setting
      const feedbackData = JSON.stringify({
        ratings: { satisfaction, easeOfUse, speed, offlineReliability, trainingQuality },
        text: { whatWorks, whatImproves, bugs },
        recommend: recommendValue,
        submittedAt: new Date().toISOString(),
      });
      await setSetting('pilot_feedback', feedbackData, 'string');

      // Add to sync queue
      await enqueueSyncEvent('audit_event', {
        feedbackData,
        averageRating: avgRating,
      });

      // Audit event
      await auditFeedbackSubmitted(avgRating, recommendValue);

      setIsSubmitted(true);
      onSuccess();
    } catch {
      alert(t('feedbackError'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (isSubmitted) {
      setIsSubmitted(false);
    }
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={feedbackStyles.container}>
        <View style={feedbackStyles.header}>
          <TouchableOpacity onPress={handleClose} style={feedbackStyles.closeBtn}>
            <Ionicons name="close" size={22} color={colors.gray600} />
          </TouchableOpacity>
          <Text style={feedbackStyles.headerTitle}>{t('feedbackTitle')}</Text>
          <View style={{ width: 22 }} />
        </View>

        {isSubmitted ? (
          <View style={feedbackStyles.successContainer}>
            <View style={feedbackStyles.successIconBox}>
              <Ionicons name="checkmark-circle" size={56} color={colors.green} />
            </View>
            <Text style={feedbackStyles.successTitle}>{t('feedbackSuccess')}</Text>
            <SecondaryButton onPress={handleClose}>
              {t('goBack')}
            </SecondaryButton>
          </View>
        ) : (
          <ScrollView
          style={feedbackStyles.body}
          contentContainerStyle={feedbackStyles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Star rating questions */}
          <View style={feedbackStyles.ratingSection}>
            <RatingRow label={t('overallSatisfaction')} value={satisfaction} onChange={setSatisfaction} />
            <RatingRow label={t('easeOfUse')} value={easeOfUse} onChange={setEaseOfUse} />
            <RatingRow label={t('speedPerformance')} value={speed} onChange={setSpeed} />
            <RatingRow label={t('offlineSync')} value={offlineReliability} onChange={setOfflineReliability} />
            <RatingRow label={t('trainingQuality')} value={trainingQuality} onChange={setTrainingQuality} />
          </View>

          {/* Text questions */}
          <View style={feedbackStyles.textSection}>
            <TextRow label={t('whatWorksWell')} value={whatWorks} onChange={setWhatWorks} />
            <TextRow label={t('whatNeedsImprovement')} value={whatImproves} onChange={setWhatImproves} />
            <TextRow label={t('anyBugs')} value={bugs} onChange={setBugs} />
          </View>

          {/* Recommend dropdown */}
          <View style={feedbackStyles.selectSection}>
            <Text style={feedbackStyles.selectLabel}>{t('wouldRecommend')}</Text>
            <View style={feedbackStyles.selectGrid}>
              {recommendOptions.map((option, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={[
                    feedbackStyles.selectChip,
                    recommendIdx === idx && feedbackStyles.selectChipActive,
                  ]}
                  onPress={() => setRecommendIdx(idx)}
                >
                  <Text
                    style={[
                      feedbackStyles.selectChipText,
                      recommendIdx === idx && feedbackStyles.selectChipTextActive,
                    ]}
                  >
                    {option}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Submit button */}
            <View style={feedbackStyles.submitSection}>
              <PrimaryButton onPress={handleSubmit} disabled={submitting}>
                {submitting ? t('loading') : t('submitFeedbackBtn')}
              </PrimaryButton>
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

// ─── Sub-components ────────────────────────────────────────────

function RatingRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <View style={feedbackStyles.ratingRow}>
      <Text style={feedbackStyles.ratingLabel}>{label}</Text>
      <StarRating value={value} onChange={onChange} />
    </View>
  );
}

function TextRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={feedbackStyles.textRow}>
      <Text style={feedbackStyles.textLabel}>{label}</Text>
      <TextInput
        style={feedbackStyles.textInput}
        value={value}
        onChangeText={onChange}
        placeholder="..."
        placeholderTextColor={colors.gray300}
        multiline
        numberOfLines={3}
        textAlignVertical="top"
      />
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
    paddingBottom: 80,
  },

  // Card
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.gray100,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray100,
  },
  sectionIconBox: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionLabel: {
    fontSize: fontSize.base,
    fontWeight: 'bold',
    color: colors.gray800,
  },

  // Status grid
  statusGrid: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  statusKey: {
    fontSize: fontSize.sm,
    color: colors.gray500,
  },
  statusValue: {
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.gray800,
  },

  // Progress bar
  progressSection: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  progressLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.gray700,
  },
  progressValue: {
    fontSize: fontSize.sm,
    fontWeight: 'bold',
    color: colors.navy,
  },
  progressTrack: {
    height: 8,
    backgroundColor: colors.gray100,
    borderRadius: 9999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.green,
    borderRadius: 9999,
  },

  // Module rows
  moduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray50,
  },
  moduleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  moduleIconBox: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.gray50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moduleName: {
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.gray800,
    marginBottom: 2,
  },

  // Quick reference
  quickRefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray50,
  },
  quickRefIcon: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickRefLabel: {
    flex: 1,
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.gray800,
  },

  // FAQ
  faqContainer: {
    borderBottomWidth: 1,
    borderBottomColor: colors.gray50,
  },
  faqQuestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  faqQuestionText: {
    flex: 1,
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.gray800,
  },
  faqAnswer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    paddingLeft: spacing.lg + 14 + spacing.sm,
  },
  faqAnswerText: {
    fontSize: fontSize.sm,
    color: colors.gray600,
    lineHeight: fontSize.sm + 6,
  },
});

// ─── Feedback Modal Styles ─────────────────────────────────────

const feedbackStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingTop: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray100,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: fontSize.lg,
    fontWeight: 'bold',
    color: colors.gray800,
  },
  body: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.lg,
    paddingBottom: 80,
  },

  // Rating section
  ratingSection: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.gray100,
    padding: spacing.lg,
    gap: spacing.md,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ratingLabel: {
    flex: 1,
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.gray700,
    marginRight: spacing.sm,
  },

  // Text section
  textSection: {
    gap: spacing.md,
  },
  textRow: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.gray100,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  textLabel: {
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.gray700,
  },
  textInput: {
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontSize: fontSize.base,
    color: colors.gray800,
    minHeight: 72,
    textAlignVertical: 'top',
  },

  // Select section
  selectSection: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.gray100,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  selectLabel: {
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.gray700,
    marginBottom: spacing.xs,
  },
  selectGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  selectChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.gray200,
    backgroundColor: colors.white,
  },
  selectChipActive: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  selectChipText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.gray600,
  },
  selectChipTextActive: {
    color: colors.white,
  },

  // Submit
  submitSection: {
    paddingTop: spacing.sm,
  },

  // Success view
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
  },
  successIconBox: {
    width: 96,
    height: 96,
    borderRadius: 9999,
    backgroundColor: colors.greenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.gray700,
    textAlign: 'center',
    lineHeight: fontSize.lg + 6,
  },
});

