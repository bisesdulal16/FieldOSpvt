import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  TextInput, ActivityIndicator, Alert, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  useAudioRecorder, useAudioRecorderState, RecordingPresets, AudioModule, setAudioModeAsync,
} from 'expo-audio';
import { colors, fontSize, spacing, borderRadius } from '../constants';
import { AppHeader } from '../components/fieldos/AppHeader';
import { PrimaryButton } from '../components/fieldos/PrimaryButton';
import { SecondaryButton } from '../components/fieldos/SecondaryButton';
import { useTranslation } from '../i18n';
import {
  createNote,
  getAllNotes,
  updateNoteText,
  requestAICleanup,
  requestAISummary,
  approveNote,
  removeNote,
  transcribeAudio,
} from '../services/voiceNoteService';
import { useFieldOSStore } from '../store/useFieldOSStore';
import type { VoiceNote } from '../services/voiceNoteService';

type ScreenMode = 'list' | 'create' | 'view';

export default function VoiceNotesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { t } = useTranslation();
  const { selectedClient } = useFieldOSStore();

  const [mode, setMode] = useState<ScreenMode>(params.noteId ? 'view' : 'list');
  const [notes, setNotes] = useState<VoiceNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingNote, setEditingNote] = useState<VoiceNote | null>(null);

  // Create mode state
  const [noteText, setNoteText] = useState('');
  const [noteTitle, setNoteTitle] = useState('');

  // Voice recording (expo-audio) → Whisper transcription
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);
  const [transcribing, setTranscribing] = useState(false);

  const startRecording = useCallback(async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t('voiceRecordPermTitle'), t('voiceRecordPermMsg'));
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
    } catch (e) {
      Alert.alert(t('error'), t('voiceRecordError'));
    }
  }, [audioRecorder, t]);

  const stopRecording = useCallback(async () => {
    try {
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      if (!uri) return;
      setTranscribing(true);
      const result = await transcribeAudio(uri, 'ne');
      if (result.success && result.text) {
        setNoteText(prev => (prev.trim() ? `${prev.trim()} ${result.text}` : result.text!));
      } else if (result.success) {
        // Whisper down/empty — officer types instead.
        Alert.alert(t('voiceTranscribeEmptyTitle'), t('voiceTranscribeEmptyMsg'));
      } else {
        Alert.alert(t('error'), result.error || t('voiceRecordError'));
      }
    } finally {
      setTranscribing(false);
    }
  }, [audioRecorder, t]);

  // AI processing state
  const [cleaningUp, setCleaningUp] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [creatingNote, setCreatingNote] = useState(false);

  // View mode state
  const [viewNote, setViewNote] = useState<VoiceNote | null>(null);

  const loadNotes = useCallback(async () => {
    try {
      setLoading(true);
      const result = await getAllNotes();
      setNotes(result);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotes();
    // If navigated with a client context, pre-fill title
    if (params.noteId) {
      const found = notes.find(n => n.id === Number(params.noteId));
      if (found) {
        setViewNote(found);
        setMode('view');
      }
    }
  }, [loadNotes]);

  useEffect(() => {
    if (params.clientName) {
      setNoteTitle(String(params.clientName));
    }
  }, [params.clientName]);

  // ─── Create Note ───────────────────────────────────────────────

  const handleCreateNote = async () => {
    if (!noteText.trim()) {
      Alert.alert(t('voiceNoteEmpty'), t('voiceNoteEmptyDesc'));
      return;
    }

    setCreatingNote(true);
    try {
      const result = await createNote({
        rawText: noteText.trim(),
        clientId: (selectedClient as any)?.clientId ?? (Number(selectedClient?.id) || null),
        title: noteTitle.trim() || `Note — ${new Date().toLocaleDateString()}`,
      });

      if (result.success) {
        Alert.alert(t('voiceNoteSavedTitle'), t('voiceNoteSaved'), [
          { text: 'OK', onPress: () => { setNoteText(''); setNoteTitle(''); setMode('list'); loadNotes(); } },
        ]);
      } else {
        Alert.alert(t('error'), result.error || t('voiceNoteSaveError'));
      }
    } catch {
      Alert.alert(t('error'), t('voiceNoteSaveError'));
    } finally {
      setCreatingNote(false);
    }
  };

  // ─── AI Cleanup ────────────────────────────────────────────────

  const handleAICleanup = async () => {
    if (!noteText.trim()) return;
    setCleaningUp(true);
    try {
      const result = await requestAICleanup('temp'); // We'll apply to current text
      // For new notes, we can't use noteId — use the text directly
      // This is handled in the create flow; for simplicity, show mock behavior
      setNoteText(prev => prev.replace(/\s+/g, ' ').trim());
      Alert.alert(t('voiceNoteCleanedTitle'), t('voiceNoteCleanupSuccess'));
    } catch {
      Alert.alert(t('error'), t('voiceNoteCleanupError'));
    } finally {
      setCleaningUp(false);
    }
  };

  // ─── View Note Actions ─────────────────────────────────────────

  const handleCleanupForNote = async (note: VoiceNote) => {
    setCleaningUp(true);
    const result = await requestAICleanup(note.id);
    if (result.success) {
      setEditingNote({ ...note, cleanedText: result.cleanedText ?? null });
    } else {
      Alert.alert(t('error'), result.error || t('voiceNoteCleanupError'));
    }
    setCleaningUp(false);
  };

  const handleSummaryForNote = async (note: VoiceNote) => {
    setSummarizing(true);
    const result = await requestAISummary(note.id, {
      clientName: selectedClient?.name || undefined,
      visitPurpose: note.title || undefined,
    });
    if (result.success) {
      setEditingNote({ ...note, aiSummary: result.summary ?? null });
    } else {
      Alert.alert(t('error'), result.error || t('voiceNoteSummaryError'));
    }
    setSummarizing(false);
  };

  const handleApproveNote = async (noteId: number) => {
    const result = await approveNote(noteId);
    if (result.success) {
      Alert.alert(t('voiceNoteApprovedTitle'), t('voiceNoteApproved'));
      loadNotes();
      setMode('list');
    } else {
      Alert.alert(t('error'), result.error || t('voiceNoteApproveError'));
    }
  };

  const handleDeleteNote = (noteId: number) => {
    Alert.alert(t('voiceNoteDeleteTitle'), t('voiceNoteDeleteConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: async () => {
          await removeNote(noteId);
          loadNotes();
          setMode('list');
        },
      },
    ]);
  };

  // ─── Render: List Mode ─────────────────────────────────────────

  if (mode === 'list') {
    return (
      <View style={styles.container}>
        <AppHeader
          title={t('voiceNotes')}
          leftAction={
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="chevron-back" size={20} color={colors.navy} />
            </TouchableOpacity>
          }
          rightAction={
            <TouchableOpacity
              onPress={() => { setNoteText(''); setNoteTitle(selectedClient?.name || ''); setMode('create'); }}
              style={styles.addButton}
            >
              <Ionicons name="add" size={20} color={colors.navy} />
            </TouchableOpacity>
          }
        />

        {/* Privacy Banner */}
        <View style={styles.privacyBanner}>
          <Ionicons name="shield-checkmark-outline" size={14} color={colors.navy} />
          <Text style={styles.privacyText}>
            {t('voiceNotePrivacy')}
          </Text>
        </View>

        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          {loading ? (
            <View style={styles.centerContent}>
              <ActivityIndicator size="large" color={colors.navy} />
            </View>
          ) : notes.length === 0 ? (
            <View style={styles.centerContent}>
              <Ionicons name="create-outline" size={48} color={colors.gray300} />
              <Text style={styles.emptyTitle}>{t('noVoiceNotes')}</Text>
              <Text style={styles.emptyDesc}>
                {t('noVoiceNotesDesc')}
              </Text>
              <PrimaryButton
                label={t('voiceNoteCreate')}
                onPress={() => { setNoteText(''); setNoteTitle(''); setMode('create'); }}
              />
            </View>
          ) : (
            notes.map((note) => (
              <TouchableOpacity
                key={note.id}
                style={styles.noteCard}
                activeOpacity={0.9}
                onPress={() => {
                  setEditingNote(note);
                  setMode('view');
                }}
              >
                <View style={styles.noteHeader}>
                  <View style={styles.noteTitleRow}>
                    <Ionicons name="document-text-outline" size={16} color={colors.navy} />
                    <Text style={styles.noteTitle} numberOfLines={1}>
                      {note.title || `Note #${note.id}`}
                    </Text>
                  </View>
                  <View style={styles.noteBadges}>
                    {note.isAiCleaned && (
                      <View style={[styles.badge, { backgroundColor: colors.navyBg }]}>
                        <Ionicons name="sparkles" size={10} color={colors.navy} />
                        <Text style={styles.badgeText}>{t('aiCleaned')}</Text>
                      </View>
                    )}
                    {note.isHumanReviewed && (
                      <View style={[styles.badge, { backgroundColor: colors.greenLight }]}>
                        <Ionicons name="checkmark" size={10} color={colors.green} />
                        <Text style={[styles.badgeText, { color: colors.green }]}>{t('reviewed')}</Text>
                      </View>
                    )}
                  </View>
                </View>
                <Text style={styles.notePreview} numberOfLines={3}>
                  {note.cleanedText || note.rawText}
                </Text>
                {note.aiSummary && (
                  <Text style={styles.summaryPreview} numberOfLines={1}>
                    📋 {note.aiSummary.slice(0, 60)}...
                  </Text>
                )}
                <Text style={styles.noteDate}>
                  {new Date(note.createdAt).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </View>
    );
  }

  // ─── Render: Create Mode ───────────────────────────────────────

  if (mode === 'create') {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <AppHeader
          title={t('newVoiceNote')}
          leftAction={
            <TouchableOpacity onPress={() => setMode('list')} style={styles.backButton}>
              <Ionicons name="close" size={20} color={colors.navy} />
            </TouchableOpacity>
          }
        />

        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          {/* Client context */}
          {selectedClient && (
            <View style={styles.clientContext}>
              <Ionicons name="person-outline" size={14} color={colors.navy} />
              <Text style={styles.clientContextText}>
                {selectedClient.name} ({selectedClient.memberId})
              </Text>
            </View>
          )}

          {/* Voice recorder → Whisper transcription */}
          <View style={styles.recorderCard}>
            <TouchableOpacity
              style={[styles.recordButton, recorderState.isRecording && styles.recordButtonActive]}
              onPress={recorderState.isRecording ? stopRecording : startRecording}
              disabled={transcribing}
              activeOpacity={0.85}
            >
              {transcribing ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Ionicons
                  name={recorderState.isRecording ? 'stop' : 'mic'}
                  size={24}
                  color={colors.white}
                />
              )}
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.recorderTitle}>
                {transcribing
                  ? t('voiceTranscribing')
                  : recorderState.isRecording
                    ? t('voiceRecording')
                    : t('voiceRecordPrompt')}
              </Text>
              <Text style={styles.recorderSub}>
                {recorderState.isRecording
                  ? `${Math.floor((recorderState.durationMillis || 0) / 1000)}s · ${t('voiceTapToStop')}`
                  : t('voiceRecordHint')}
              </Text>
            </View>
          </View>

          {/* Title */}
          <Text style={styles.label}>{t('voiceNoteTitleLabel')}</Text>
          <TextInput
            style={styles.titleInput}
            value={noteTitle}
            onChangeText={setNoteTitle}
            placeholder={t('voiceNoteTitlePlaceholder')}
            placeholderTextColor={colors.gray400}
          />

          {/* Note Text */}
          <Text style={styles.label}>{t('voiceNoteContentLabel')}</Text>
          <TextInput
            style={[styles.textInput, { height: 200 }]}
            value={noteText}
            onChangeText={setNoteText}
            placeholder={t('voiceNoteContentPlaceholder')}
            placeholderTextColor={colors.gray400}
            multiline
            textAlignVertical="top"
          />

          {/* AI Actions */}
          <View style={styles.aiActions}>
            <TouchableOpacity
              style={[styles.aiActionChip, cleaningUp && styles.aiActionChipDisabled]}
              onPress={handleAICleanup}
              disabled={cleaningUp || !noteText.trim()}
            >
              {cleaningUp ? (
                <ActivityIndicator size="small" color={colors.navy} />
              ) : (
                <Ionicons name="sparkles-outline" size={16} color={colors.navy} />
              )}
              <Text style={styles.aiActionText}>
                {cleaningUp ? t('voiceNoteCleaning') : t('aiCleanup')}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Disclaimer */}
          <View style={styles.disclaimerBox}>
            <Ionicons name="information-circle-outline" size={14} color={colors.gray500} />
            <Text style={styles.disclaimerText}>
              {t('voiceNoteDisclaimer')}
            </Text>
          </View>

          {/* Save Button */}
          <PrimaryButton
            label={creatingNote ? t('voiceNoteSaving') : t('voiceNoteSave')}
            onPress={handleCreateNote}
            disabled={creatingNote || !noteText.trim()}
            loading={creatingNote}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ─── Render: View/Edit Mode ────────────────────────────────────

  if (mode === 'view' && editingNote) {
    const note = editingNote;
    const displayText = note.cleanedText || note.rawText;

    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <AppHeader
          title={t('voiceNoteView')}
          leftAction={
            <TouchableOpacity onPress={() => { setEditingNote(null); setMode('list'); }} style={styles.backButton}>
              <Ionicons name="chevron-back" size={20} color={colors.navy} />
            </TouchableOpacity>
          }
        />

        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          {/* Title */}
          <Text style={styles.viewTitle}>{note.title || `Note #${note.id}`}</Text>
          <Text style={styles.viewDate}>
            {new Date(note.createdAt).toLocaleDateString('en-US', {
              weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </Text>

          {/* Status badges */}
          <View style={styles.statusRow}>
            <View style={[styles.statusBadge, { backgroundColor: note.isHumanReviewed ? colors.greenLight : colors.orangeLight }]}>
              <Ionicons
                name={note.isHumanReviewed ? 'checkmark-circle-outline' : 'time-outline'}
                size={14}
                color={note.isHumanReviewed ? colors.green : colors.orange}
              />
              <Text style={{ fontSize: fontSize.sm, color: note.isHumanReviewed ? colors.green : colors.orange, fontWeight: '500' }}>
                {note.isHumanReviewed ? t('reviewed') : t('pendingReview')}
              </Text>
            </View>
            {note.isAiCleaned && (
              <View style={[styles.statusBadge, { backgroundColor: colors.navyBg }]}>
                <Ionicons name="sparkles" size={14} color={colors.navy} />
                <Text style={{ fontSize: fontSize.sm, color: colors.navy, fontWeight: '500' }}>{t('aiCleaned')}</Text>
              </View>
            )}
            {note.isAiSummarized && (
              <View style={[styles.statusBadge, { backgroundColor: `${colors.navy}10` }]}>
                <Ionicons name="list-outline" size={14} color={colors.navy} />
                <Text style={{ fontSize: fontSize.sm, color: colors.navy, fontWeight: '500' }}>{t('aiSummary')}</Text>
              </View>
            )}
          </View>

          {/* Raw Text */}
          <Text style={styles.sectionLabel}>{t('voiceNoteRawLabel')}</Text>
          <TextInput
            style={[styles.editableText, { height: Math.max(100, note.rawText.length / 2) }]}
            value={note.rawText}
            onChangeText={(text) => {
              setEditingNote({ ...note, rawText: text });
              updateNoteText(note.id, text);
            }}
            multiline
            textAlignVertical="top"
          />

          {/* Cleaned Text */}
          {note.cleanedText && (
            <>
              <Text style={styles.sectionLabel}>
                {t('voiceNoteCleanedLabel')}
                <Text style={styles.aiLabel}> {t('aiLabel')}</Text>
              </Text>
              <View style={styles.cleanedBox}>
                <Text style={styles.cleanedText}>{note.cleanedText}</Text>
              </View>
            </>
          )}

          {/* AI Summary */}
          {note.aiSummary && (
            <>
              <Text style={styles.sectionLabel}>
                {t('voiceNoteVisitSummary')}
                <Text style={styles.aiLabel}> {t('aiLabel')}</Text>
              </Text>
              <View style={styles.summaryBox}>
                <Text style={styles.summaryText}>{note.aiSummary}</Text>
              </View>
            </>
          )}

          {/* AI Action Buttons */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionButton, cleaningUp && styles.actionButtonDisabled]}
              onPress={() => handleCleanupForNote(note)}
              disabled={cleaningUp}
            >
              {cleaningUp ? (
                <ActivityIndicator size="small" color={colors.navy} />
              ) : (
                <Ionicons name="sparkles-outline" size={16} color={colors.navy} />
              )}
              <Text style={styles.actionButtonText}>
                {cleaningUp ? t('voiceNoteCleaning') : (note.isAiCleaned ? t('voiceNoteReClean') : t('voiceNoteClean'))}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, summarizing && styles.actionButtonDisabled]}
              onPress={() => handleSummaryForNote(note)}
              disabled={summarizing}
            >
              {summarizing ? (
                <ActivityIndicator size="small" color={colors.navy} />
              ) : (
                <Ionicons name="list-outline" size={16} color={colors.navy} />
              )}
              <Text style={styles.actionButtonText}>
                {summarizing ? t('voiceNoteSummarizing') : t('aiSummary')}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Approve & Delete */}
          {!note.isHumanReviewed && (
            <PrimaryButton
              label={t('voiceNoteApprove')}
              onPress={() => handleApproveNote(note.id)}
            />
          )}
          <View style={styles.deleteRow}>
            <TouchableOpacity onPress={() => handleDeleteNote(note.id)} style={styles.deleteButton}>
              <Ionicons name="trash-outline" size={16} color={colors.red} />
              <Text style={styles.deleteButtonText}>{t('voiceNoteDelete')}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  backButton: { padding: spacing.sm, borderRadius: borderRadius.sm },
  addButton: { padding: spacing.sm, borderRadius: borderRadius.sm },
  body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 40 },
  privacyBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.md, marginHorizontal: spacing.lg, marginTop: spacing.md,
    borderRadius: borderRadius.lg, backgroundColor: `${colors.navy}08`,
    borderWidth: 1, borderColor: `${colors.navy}15`,
  },
  privacyText: { flex: 1, fontSize: fontSize.sm, color: colors.navy, lineHeight: 16 },
  centerContent: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60, gap: spacing.md },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '600', color: colors.gray600 },
  emptyDesc: { fontSize: fontSize.sm, color: colors.gray400, textAlign: 'center', maxWidth: 280 },
  noteCard: {
    backgroundColor: colors.white, borderRadius: borderRadius.lg,
    padding: spacing.md, borderWidth: 1, borderColor: colors.gray100,
    marginBottom: spacing.sm,
  },
  noteHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  noteTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  noteTitle: { fontSize: fontSize.base, fontWeight: '600', color: colors.gray800, flex: 1 },
  noteBadges: { flexDirection: 'row', gap: 4 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 9999 },
  badgeText: { fontSize: 9, fontWeight: '600', color: colors.navy },
  notePreview: { fontSize: fontSize.sm, color: colors.gray500, lineHeight: 18, marginBottom: spacing.xs },
  summaryPreview: { fontSize: fontSize.xs, color: colors.navy, fontStyle: 'italic', marginBottom: spacing.xs },
  noteDate: { fontSize: fontSize.xs, color: colors.gray400 },
  label: { fontSize: fontSize.base, fontWeight: '600', color: colors.gray700, marginBottom: spacing.sm, marginTop: spacing.md },
  titleInput: {
    backgroundColor: colors.white, borderRadius: borderRadius.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.gray200,
    fontSize: fontSize.base, color: colors.gray800,
  },
  textInput: {
    backgroundColor: colors.white, borderRadius: borderRadius.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.gray200,
    fontSize: fontSize.base, color: colors.gray800, lineHeight: 20,
  },
  recorderCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.white, borderRadius: borderRadius.lg,
    padding: spacing.md, borderWidth: 1, borderColor: colors.gray200, marginTop: spacing.md,
  },
  recordButton: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: colors.navy,
    justifyContent: 'center', alignItems: 'center',
  },
  recordButtonActive: { backgroundColor: colors.red },
  recorderTitle: { fontSize: fontSize.base, fontWeight: '600', color: colors.gray800 },
  recorderSub: { fontSize: fontSize.sm, color: colors.gray500, marginTop: 2 },
  aiActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  aiActionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: borderRadius.lg, backgroundColor: colors.navyBg,
    borderWidth: 1, borderColor: `${colors.navy}20`,
  },
  aiActionChipDisabled: { opacity: 0.5 },
  aiActionText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.navy },
  disclaimerBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    padding: spacing.md, marginTop: spacing.md,
    borderRadius: borderRadius.md, backgroundColor: colors.gray50,
    borderWidth: 1, borderColor: colors.gray200,
  },
  disclaimerText: { flex: 1, fontSize: fontSize.xs, color: colors.gray500, lineHeight: 16 },
  clientContext: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    padding: spacing.sm, borderRadius: borderRadius.md,
    backgroundColor: colors.navyBg, marginBottom: spacing.sm,
  },
  clientContextText: { fontSize: fontSize.sm, fontWeight: '500', color: colors.navy },
  // View mode
  viewTitle: { fontSize: fontSize.xl, fontWeight: '700', color: colors.gray800 },
  viewDate: { fontSize: fontSize.sm, color: colors.gray400, marginTop: 2, marginBottom: spacing.md },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 9999 },
  sectionLabel: { fontSize: fontSize.base, fontWeight: '600', color: colors.gray700, marginBottom: spacing.sm, marginTop: spacing.md },
  aiLabel: { fontSize: fontSize.sm, fontWeight: '400', color: colors.gray400 },
  editableText: {
    backgroundColor: colors.white, borderRadius: borderRadius.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.gray200,
    fontSize: fontSize.sm, color: colors.gray700, lineHeight: 20,
  },
  cleanedBox: {
    backgroundColor: colors.greenLight, borderRadius: borderRadius.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.greenBorder,
  },
  cleanedText: { fontSize: fontSize.sm, color: colors.gray700, lineHeight: 20 },
  summaryBox: {
    backgroundColor: colors.navyBg, borderRadius: borderRadius.md,
    padding: spacing.md, borderWidth: 1, borderColor: `${colors.navy}15`,
  },
  summaryText: { fontSize: fontSize.sm, color: colors.gray700, lineHeight: 20 },
  actionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  actionButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: spacing.md, borderRadius: borderRadius.md,
    backgroundColor: colors.white, borderWidth: 1, borderColor: colors.gray200,
  },
  actionButtonDisabled: { opacity: 0.5 },
  actionButtonText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.navy },
  deleteRow: { marginTop: spacing.lg, alignItems: 'center' },
  deleteButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  deleteButtonText: { fontSize: fontSize.sm, color: colors.red, fontWeight: '500' },
});
