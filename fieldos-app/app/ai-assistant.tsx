import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius } from '../constants';
import { AppHeader } from '../components/fieldos/AppHeader';
import { useTranslation } from '../i18n';
import {
  askFieldOS,
  getConversationHistory,
  clearConversation,
  QUICK_ACTIONS,
} from '../services/aiAssistantService';
import type { ChatMessage, QuickAction } from '../services/aiAssistantService';

export default function AIAssistantScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView>(null);

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    // Initialize from stored history (avoid setState in effect)
    const history = getConversationHistory();
    return history.length > 0 ? history : [];
  });
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const contextLoaded = true;

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  // ─── Send Message ──────────────────────────────────────────────

  const handleSend = useCallback(async (text?: string) => {
    const question = text || inputText.trim();
    if (!question || loading) return;

    setInputText('');
    setLoading(true);

    // Add user message to UI immediately
    const userMsg: ChatMessage = {
      id: `ui-${Date.now()}`,
      role: 'user',
      content: question,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);

    const result = await askFieldOS(question, {
      pendingSyncCount: 3,
      todayVisitsCompleted: 5,
      todayVisitsPlanned: 8,
      todayCollectionsNPR: 18500,
      promiseToPayDue: 1,
      overdueClients: 4,
      branchName: 'Kathmandu Main Branch',
      officerName: 'Ram Bahadur Shah',
      todayDate: new Date().toISOString().split('T')[0],
    });

    if (result.success && result.answer) {
      const assistantMsg: ChatMessage = {
        id: `ui-${Date.now() + 1}`,
        role: 'assistant',
        content: result.answer,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } else {
      const errorMsg: ChatMessage = {
        id: `ui-${Date.now() + 1}`,
        role: 'assistant',
        content: `Sorry, I couldn't process your request. ${result.error || 'Please try again.'}`,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errorMsg]);
    }

    setLoading(false);
  }, [inputText, loading]);

  // ─── Quick Action ──────────────────────────────────────────────

  const handleQuickAction = (action: QuickAction) => {
    handleSend(action.question);
  };

  // ─── Clear Chat ────────────────────────────────────────────────

  const handleClear = () => {
    clearConversation();
    setMessages([]);
  };

  // ─── Render ────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
    >
      <AppHeader
        title={t('aiAssistant')}
        leftAction={
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={20} color={colors.navy} />
          </TouchableOpacity>
          }
        rightAction={
          messages.length > 0 ? (
            <TouchableOpacity onPress={handleClear} style={styles.clearButton}>
              <Ionicons name="trash-outline" size={18} color={colors.gray500} />
            </TouchableOpacity>
          ) : undefined
        }
      />

      {/* Disclaimer */}
      <View style={styles.disclaimerBanner}>
        <Ionicons name="shield-checkmark-outline" size={14} color={colors.navy} />
        <Text style={styles.disclaimerText}>
          {t('aiChatDisclaimer')}
        </Text>
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.chatArea}
        contentContainerStyle={styles.chatContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Welcome Message */}
        {messages.length === 0 && contextLoaded && (
          <View style={styles.welcomeSection}>
            <View style={styles.welcomeIcon}>
              <Ionicons name="sparkles" size={32} color={colors.navy} />
            </View>
            <Text style={styles.welcomeTitle}>{t('aiAssistantWelcome')}</Text>
            <Text style={styles.welcomeDesc}>
              {t('aiAssistantDesc')}
            </Text>

            {/* Quick Actions */}
            <Text style={styles.quickActionsTitle}>{t('aiAssistantQuickTitle')}</Text>
            <View style={styles.quickActionsGrid}>
              {QUICK_ACTIONS.map((action) => (
                <TouchableOpacity
                  key={action.id}
                  style={styles.quickActionCard}
                  onPress={() => handleQuickAction(action)}
                  activeOpacity={0.9}
                >
                  <View style={[styles.quickActionIcon, { backgroundColor: `${action.color}15` }]}>
                    <Ionicons name={action.icon as any} size={16} color={action.color} />
                  </View>
                  <Text style={styles.quickActionLabel}>{action.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Chat Messages */}
        {messages.map((msg) => (
          <View
            key={msg.id}
            style={[styles.messageRow, msg.role === 'user' ? styles.userRow : styles.assistantRow]}
          >
            {msg.role === 'assistant' && (
              <View style={styles.avatarSmall}>
                <Ionicons name="sparkles" size={12} color={colors.white} />
              </View>
            )}
            <View
              style={[
                styles.messageBubble,
                msg.role === 'user' ? styles.userBubble : styles.assistantBubble,
              ]}
            >
              <Text style={[
                styles.messageText,
                msg.role === 'user' ? styles.userText : styles.assistantText,
              ]}>
                {msg.content}
              </Text>
            </View>
            {msg.role === 'user' && (
              <View style={[styles.avatarSmall, { backgroundColor: colors.gray300 }]}>
                <Ionicons name="person" size={12} color={colors.white} />
              </View>
            )}
          </View>
        ))}

        {/* Typing Indicator */}
        {loading && (
          <View style={[styles.messageRow, styles.assistantRow]}>
            <View style={styles.avatarSmall}>
              <Ionicons name="sparkles" size={12} color={colors.white} />
            </View>
            <View style={[styles.messageBubble, styles.assistantBubble, styles.typingBubble]}>
              <View style={styles.typingRow}>
                <View style={styles.typingDot} />
                <View style={[styles.typingDot, { opacity: 0.6 }]} />
                <View style={[styles.typingDot, { opacity: 0.3 }]} />
              </View>
            </View>
          </View>
        )}

        {/* Quick Actions (shown after first message too) */}
        {messages.length > 0 && messages.length <= 2 && !loading && (
          <View style={styles.inlineQuickActions}>
            <Text style={styles.inlineQuickTitle}>{t('aiAssistantTryAsking')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {QUICK_ACTIONS.slice(0, 4).map((action) => (
                <TouchableOpacity
                  key={action.id}
                  style={styles.inlineChip}
                  onPress={() => handleQuickAction(action)}
                >
                  <Ionicons name={action.icon as any} size={12} color={colors.navy} />
                  <Text style={styles.inlineChipText}>{action.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
      </ScrollView>

      {/* Input Bar */}
      <View style={[styles.inputBar, { paddingBottom: insets.bottom + spacing.sm }]}>
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder={t('aiAssistantPlaceholder')}
            placeholderTextColor={colors.gray400}
            editable={!loading}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              (!inputText.trim() || loading) && styles.sendButtonDisabled,
            ]}
            onPress={() => handleSend()}
            disabled={!inputText.trim() || loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Ionicons name="arrow-up" size={18} color={colors.white} />
            )}
          </TouchableOpacity>
        </View>
        <Text style={styles.inputDisclaimer}>
          {t('aiAssistantVerify')}
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  backButton: { padding: spacing.sm, borderRadius: borderRadius.sm },
  clearButton: { padding: spacing.sm, borderRadius: borderRadius.sm },
  disclaimerBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    padding: spacing.sm, marginHorizontal: spacing.lg, marginTop: spacing.sm,
    borderRadius: borderRadius.lg, backgroundColor: `${colors.orange}10`,
    borderWidth: 1, borderColor: `${colors.orange}30`,
  },
  disclaimerText: { flex: 1, fontSize: fontSize.xs, color: colors.orange, lineHeight: 16, fontWeight: '500' },
  chatArea: { flex: 1 },
  chatContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 8, gap: spacing.sm },

  // Welcome
  welcomeSection: { alignItems: 'center', paddingTop: spacing.xl, paddingBottom: spacing.md },
  welcomeIcon: {
    width: 64, height: 64, borderRadius: 9999,
    backgroundColor: colors.navyBg, alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.md,
  },
  welcomeTitle: { fontSize: fontSize.xl, fontWeight: '700', color: colors.gray800, marginBottom: spacing.sm },
  welcomeDesc: {
    fontSize: fontSize.sm, color: colors.gray500, textAlign: 'center',
    maxWidth: 300, lineHeight: 18, marginBottom: spacing.xl,
  },
  quickActionsTitle: { fontSize: fontSize.base, fontWeight: '600', color: colors.gray700, marginBottom: spacing.sm, alignSelf: 'flex-start' },
  quickActionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
  quickActionCard: {
    width: '46%', backgroundColor: colors.white, borderRadius: borderRadius.lg,
    padding: spacing.md, borderWidth: 1, borderColor: colors.gray100,
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
  },
  quickActionIcon: {
    width: 32, height: 32, borderRadius: borderRadius.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  quickActionLabel: { fontSize: fontSize.sm, fontWeight: '500', color: colors.gray700, flex: 1 },

  // Messages
  messageRow: { flexDirection: 'row', gap: 8, maxWidth: '90%' },
  userRow: { alignSelf: 'flex-end' },
  assistantRow: { alignSelf: 'flex-start' },
  avatarSmall: {
    width: 24, height: 24, borderRadius: 9999,
    backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center',
    marginTop: 4,
  },
  messageBubble: { borderRadius: borderRadius.lg, padding: spacing.md, maxWidth: '85%' },
  userBubble: { backgroundColor: colors.navy, borderBottomRightRadius: 4 },
  assistantBubble: { backgroundColor: colors.white, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.gray100 },
  messageText: { fontSize: fontSize.sm, lineHeight: 20 },
  userText: { color: colors.white },
  assistantText: { color: colors.gray700 },

  // Typing
  typingBubble: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  typingRow: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  typingDot: {
    width: 6, height: 6, borderRadius: 9999, backgroundColor: colors.gray400,
  },

  // Inline quick actions
  inlineQuickActions: { marginTop: spacing.md, marginBottom: spacing.sm },
  inlineQuickTitle: { fontSize: fontSize.xs, color: colors.gray400, fontWeight: '500', marginBottom: spacing.sm },
  inlineChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: 9999, backgroundColor: colors.white,
    borderWidth: 1, borderColor: colors.gray200, marginRight: spacing.sm,
  },
  inlineChipText: { fontSize: fontSize.xs, fontWeight: '500', color: colors.navy },

  // Input Bar
  inputBar: {
    backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.gray100,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm,
  },
  inputContainer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm,
    backgroundColor: colors.gray50, borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderWidth: 1, borderColor: colors.gray200, maxHeight: 120,
  },
  input: {
    flex: 1, fontSize: fontSize.sm, color: colors.gray800,
    maxHeight: 90, lineHeight: 20,
  },
  sendButton: {
    width: 32, height: 32, borderRadius: 9999,
    backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center',
  },
  sendButtonDisabled: { backgroundColor: colors.gray300, opacity: 0.6 },
  inputDisclaimer: {
    fontSize: 9, color: colors.gray400, textAlign: 'center',
    marginTop: spacing.xs, marginBottom: spacing.xs,
  },
});
