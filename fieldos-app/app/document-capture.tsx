import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Image,
  Alert,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { colors, fontSize, spacing, borderRadius } from '../constants';
import { useFieldOSStore } from '../store/useFieldOSStore';
import { useTranslation } from '../i18n';
import { AppHeader } from '../components/fieldos/AppHeader';
import { PrimaryButton } from '../components/fieldos/PrimaryButton';
import { StatusChip } from '../components/fieldos/StatusChip';
import {
  getDocumentsByClientId,
  type KycDocument,
  type KycDocumentType,
  type KycDocumentStatus,
} from '../db/repositories/kycRepo';
import { captureKycDocument, viewKycDocument, deleteKycDocumentRecord } from '../services';

// ─── Document type config ──────────────────────────────────────
const DOCUMENT_TYPES: { type: KycDocumentType; icon: string; labelKey: 'kycCitizenshipFront' | 'kycCitizenshipBack' | 'kycClientPhoto' | 'kycSignature' | 'kycOther' }[] = [
  { type: 'citizenship_front', icon: 'card-outline', labelKey: 'kycCitizenshipFront' },
  { type: 'citizenship_back', icon: 'card-outline', labelKey: 'kycCitizenshipBack' },
  { type: 'client_photo', icon: 'person-outline', labelKey: 'kycClientPhoto' },
  { type: 'signature', icon: 'create-outline', labelKey: 'kycSignature' },
  { type: 'other', icon: 'document-outline', labelKey: 'kycOther' },
];

// ─── Helpers ───────────────────────────────────────────────────
function getStatusVariant(status: KycDocumentStatus): 'verified' | 'sync' | 'warning' | 'overdue' {
  switch (status) {
    case 'approved': return 'verified';
    case 'pending_sync': return 'sync';
    case 'needs_review': return 'warning';
    case 'captured': return 'verified';
    default: return 'verified';
  }
}

function getStatusLabel(status: KycDocumentStatus, labels: Record<string, string>): string {
  switch (status) {
    case 'missing': return labels.kycStatusMissing;
    case 'captured': return labels.kycStatusCaptured;
    case 'pending_sync': return labels.kycStatusPendingSync;
    case 'needs_review': return labels.kycStatusNeedsReview;
    case 'approved': return labels.kycStatusApproved;
    default: return status;
  }
}

function getQualityInfo(qualityStatus: string, labels: Record<string, string>): { label: string; color: string } {
  switch (qualityStatus) {
    case 'clear': return { label: labels.kycQualityClear, color: colors.green };
    case 'blurry': return { label: labels.kycQualityBlurry, color: colors.red };
    default: return { label: labels.kycQualityPending, color: colors.orange };
  }
}

// ─── Component ─────────────────────────────────────────────────
export default function DocumentCaptureScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { selectedClient } = useFieldOSStore();
  const clientId = Number(selectedClient?.id) || 1;

  const [documents, setDocuments] = useState<KycDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [capturingType, setCapturingType] = useState<KycDocumentType | null>(null);
  const [saving, setSaving] = useState(false);
  const [viewerDoc, setViewerDoc] = useState<KycDocument | null>(null);
  const [successFlash, setSuccessFlash] = useState(false);

  // Load documents
  const loadDocuments = useCallback(async () => {
    try {
      setLoading(true);
      const docs = await getDocumentsByClientId(clientId);
      setDocuments(docs);
    } catch (err) {
      console.warn('[KYC] Failed to load documents:', err);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  // Mock blur/quality check
  const mockQualityCheck = (): { score: number; status: 'clear' | 'blurry' } => {
    // In production, this would use a real blur detection library
    // For now, randomly assign — 85% clear, 15% blurry
    const isBlurry = Math.random() < 0.15;
    return {
      score: isBlurry ? 65 : 20,
      status: isBlurry ? 'blurry' as const : 'clear' as const,
    };
  };

  // Handle image capture
  const handleCapture = async (useCamera: boolean) => {
    if (!capturingType) return;

    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert(t('kycPermissionDenied'));
        setCapturingType(null);
        return;
      }

      const result = useCamera
        ? await ImagePicker.launchCameraAsync({
            quality: 0.8,
            allowsEditing: false,
            mediaTypes: ['images'],
          })
        : await ImagePicker.launchImageLibraryAsync({
            quality: 0.8,
            allowsEditing: false,
            mediaTypes: ['images'],
          });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        setCapturingType(null);
        return;
      }

      const asset = result.assets[0];
      setSaving(true);

      // Get file info securely
      let fileSize: number | undefined;
      try {
        const fileInfo = await FileSystem.getInfoAsync(asset.uri);
        if (fileInfo.exists && !fileInfo.isDirectory) {
          fileSize = (fileInfo as any).size;
        }
      } catch {
        // File info not critical
      }

      // Mock quality check
      const qualityResult = mockQualityCheck();

      // Capture via service layer (local persist + sync queue + audit)
      await captureKycDocument(clientId, {
        documentType: capturingType,
        fileUri: asset.uri,
        fileName: asset.fileName || `doc_${Date.now()}.jpg`,
        fileSize,
        mimeType: asset.mimeType || 'image/jpeg',
        width: asset.width,
        height: asset.height,
        blurScore: qualityResult.score,
        qualityStatus: qualityResult.status,
      });

      // Refresh
      await loadDocuments();
      setCapturingType(null);
      setSaving(false);

      // Flash success
      setSuccessFlash(true);
      setTimeout(() => setSuccessFlash(false), 2000);

    } catch (err) {
      console.warn('[KYC] Capture failed:', err);
      setSaving(false);
      setCapturingType(null);
      Alert.alert('Error', 'Failed to capture document. Please try again.');
    }
  };

  // Delete document
  const handleDelete = (doc: KycDocument) => {
    Alert.alert(t('kycDeleteDocument'), t('kycDeleteConfirm'), [
      { text: t('kycDeleteNo'), style: 'cancel' },
      {
        text: t('kycDeleteYes'),
        style: 'destructive',
        onPress: async () => {
          await deleteKycDocumentRecord(doc);
          await loadDocuments();
        },
      },
    ]);
  };

  // View document (audit + show modal)
  const handleView = async (doc: KycDocument) => {
    await viewKycDocument(doc);
    setViewerDoc(doc);
  };

  // Get latest doc for each type
  const getDocByType = (type: KycDocumentType): KycDocument | undefined => {
    return documents.find(d => d.documentType === type);
  };

  // Count completed types
  const completedCount = DOCUMENT_TYPES.filter(dt => getDocByType(dt.type)).length;
  const totalCount = DOCUMENT_TYPES.length;

  // ─── Render ─────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.container}>
        <AppHeader title={t('kycTitle')} showBack />
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.navy} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AppHeader title={t('kycTitle')} showBack />

      {/* Success Flash */}
      {successFlash && (
        <View style={styles.successBanner}>
          <Ionicons name="checkmark-circle" size={18} color={colors.white} />
          <Text style={styles.successText}>{t('kycDocumentSaved')}</Text>
        </View>
      )}

      <ScrollView style={styles.body} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Progress summary */}
        <View style={styles.progressCard}>
          <View style={styles.progressRow}>
            <Ionicons name="document-text-outline" size={20} color={colors.navy} />
            <View style={{ flex: 1 }}>
              <Text style={styles.progressTitle}>{t('kycDocumentsLabel')}</Text>
              <Text style={styles.progressSubtitle}>
                {completedCount} {t('kycOf')} {totalCount}
                {completedCount === totalCount && ` · ${t('kycAllComplete')}`}
              </Text>
            </View>
            {completedCount === totalCount ? (
              <Ionicons name="checkmark-circle" size={24} color={colors.green} />
            ) : (
              <Text style={styles.progressBadge}>{completedCount}/{totalCount}</Text>
            )}
          </View>
          {/* Progress bar */}
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${(completedCount / totalCount) * 100}%` }]} />
          </View>
        </View>

        {/* Document type cards */}
        {DOCUMENT_TYPES.map(dt => {
          const doc = getDocByType(dt.type);
          const hasDoc = !!doc;

          return (
            <TouchableOpacity
              key={dt.type}
              style={styles.docCard}
              onPress={() => hasDoc ? handleView(doc) : setCapturingType(dt.type)}
              activeOpacity={0.7}
            >
              <View style={styles.docIconBox}>
                {doc ? (
                  <Image
                    source={{ uri: doc.fileUri }}
                    style={styles.docThumbnail}
                    resizeMode="cover"
                  />
                ) : (
                  <Ionicons name={dt.icon as any} size={24} color={colors.gray400} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.docLabel}>{t(dt.labelKey)}</Text>
                {doc ? (
                  <View style={styles.docMeta}>
                    <StatusChip
                      label={getStatusLabel(doc.status, t as unknown as Record<string, string>)}
                      variant={getStatusVariant(doc.status)}
                    />
                    {doc.qualityStatus !== 'pending_review' && (
                      <View style={styles.qualityDot}>
                        <View style={[styles.qualityIndicator, {
                          backgroundColor: getQualityInfo(doc.qualityStatus, t as unknown as Record<string, string>).color,
                        }]} />
                        <Text style={[styles.qualityText, {
                          color: getQualityInfo(doc.qualityStatus, t as unknown as Record<string, string>).color,
                        }]}>
                          {doc.qualityStatus === 'clear' ? t('kycClear') : t('kycBlurry')}
                        </Text>
                      </View>
                    )}
                  </View>
                ) : (
                  <Text style={styles.docMissing}>{t('kycStatusMissing')}</Text>
                )}
              </View>
              <Ionicons
                name={hasDoc ? 'chevron-forward' : 'camera-outline'}
                size={18}
                color={hasDoc ? colors.gray400 : colors.navy}
              />
            </TouchableOpacity>
          );
        })}

        {/* Capture button */}
        <PrimaryButton
          onPress={() => setCapturingType('citizenship_front')}
          icon="camera"
          style={{ marginTop: spacing.sm }}
        >
          {t('kycCaptureDocument')}
        </PrimaryButton>
      </ScrollView>

      {/* Document Type Selection Modal */}
      <Modal visible={capturingType !== null} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('kycSelectType')}</Text>
            <ScrollView style={{ maxHeight: 300 }}>
              {DOCUMENT_TYPES.map(dt => (
                <TouchableOpacity
                  key={dt.type}
                  style={[
                    styles.modalOption,
                    capturingType === dt.type && styles.modalOptionActive,
                  ]}
                  onPress={() => setCapturingType(dt.type)}
                >
                  <Ionicons name={dt.icon as any} size={20} color={capturingType === dt.type ? colors.navy : colors.gray600} />
                  <Text style={[styles.modalOptionText, capturingType === dt.type && styles.modalOptionTextActive]}>
                    {t(dt.labelKey)}
                  </Text>
                  {capturingType === dt.type && (
                    <Ionicons name="checkmark" size={18} color={colors.navy} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => setCapturingType(null)}
              >
                <Text style={styles.modalBtnTextCancel}>{t('cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCamera]}
                onPress={() => handleCapture(true)}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <><Ionicons name="camera" size={16} color={colors.white} /><Text style={styles.modalBtnText}>{t('kycTakePhoto')}</Text></>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnGallery]}
                onPress={() => handleCapture(false)}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={colors.navy} />
                ) : (
                  <><Ionicons name="images" size={16} color={colors.navy} /><Text style={styles.modalBtnTextDark}>{t('kycChooseFromGallery')}</Text></>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Document Viewer Modal */}
      <Modal visible={viewerDoc !== null} transparent animationType="fade">
        <View style={styles.viewerOverlay}>
          <View style={styles.viewerCard}>
            {viewerDoc && (
              <>
                <View style={styles.viewerHeader}>
                  <Text style={styles.viewerTitle}>
                    {t(DOCUMENT_TYPES.find(d => d.type === viewerDoc.documentType)?.labelKey || 'kycOther')}
                  </Text>
                  <TouchableOpacity onPress={() => setViewerDoc(null)}>
                    <Ionicons name="close" size={22} color={colors.gray600} />
                  </TouchableOpacity>
                </View>
                <Image
                  source={{ uri: viewerDoc.fileUri }}
                  style={styles.viewerImage}
                  resizeMode="contain"
                />
                <View style={styles.viewerDetails}>
                  <View style={styles.viewerDetailRow}>
                    <Text style={styles.viewerDetailLabel}>{t('kycDocumentStatus')}</Text>
                    <StatusChip label={getStatusLabel(viewerDoc.status, t as unknown as Record<string, string>)} variant={getStatusVariant(viewerDoc.status)} />
                  </View>
                  <View style={styles.viewerDetailRow}>
                    <Text style={styles.viewerDetailLabel}>{t('kycCapturedAt')}</Text>
                    <Text style={styles.viewerDetailValue}>{viewerDoc.capturedAt}</Text>
                  </View>
                  <View style={styles.viewerDetailRow}>
                    <Text style={styles.viewerDetailLabel}>Quality</Text>
                    <Text style={[styles.viewerDetailValue, { color: getQualityInfo(viewerDoc.qualityStatus, t as unknown as Record<string, string>).color }]}>
                      {getQualityInfo(viewerDoc.qualityStatus, t as unknown as Record<string, string>).label}
                    </Text>
                  </View>
                  {viewerDoc.fileSize && (
                    <View style={styles.viewerDetailRow}>
                      <Text style={styles.viewerDetailLabel}>Size</Text>
                      <Text style={styles.viewerDetailValue}>{(viewerDoc.fileSize / 1024).toFixed(1)} KB</Text>
                    </View>
                  )}
                </View>
                <View style={styles.viewerActions}>
                  <TouchableOpacity
                    style={[styles.viewerBtn, styles.viewerBtnReplace]}
                    onPress={() => {
                      setViewerDoc(null);
                      setCapturingType(viewerDoc.documentType);
                    }}
                  >
                    <Ionicons name="camera-outline" size={16} color={colors.navy} />
                    <Text style={styles.viewerBtnTextDark}>{t('kycReplacePhoto')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.viewerBtn, styles.viewerBtnDelete]}
                    onPress={() => {
                      handleDelete(viewerDoc);
                      setViewerDoc(null);
                    }}
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.red} />
                    <Text style={styles.viewerBtnTextRed}>{t('kycDeleteDocument')}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centerContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md, paddingBottom: 80 },

  // Success banner
  successBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    backgroundColor: colors.green,
  },
  successText: { fontSize: fontSize.md, fontWeight: '600', color: colors.white },

  // Progress card
  progressCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.gray100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  progressTitle: { fontSize: fontSize.lg, fontWeight: 'bold', color: colors.gray800 },
  progressSubtitle: { fontSize: fontSize.sm, color: colors.gray500, marginTop: 2 },
  progressBadge: {
    fontSize: fontSize.md,
    fontWeight: 'bold',
    color: colors.navy,
    backgroundColor: colors.navyBg,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  progressBarBg: {
    height: 4,
    backgroundColor: colors.gray100,
    borderRadius: 9999,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.green,
    borderRadius: 9999,
  },

  // Document cards
  docCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.gray100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  docIconBox: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.gray50,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  docThumbnail: { width: 48, height: 48 },
  docLabel: { fontSize: fontSize.base, fontWeight: '600', color: colors.gray800 },
  docMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  docMissing: { fontSize: fontSize.sm, color: colors.gray400, marginTop: 2 },
  qualityDot: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  qualityIndicator: { width: 6, height: 6, borderRadius: 9999 },
  qualityText: { fontSize: fontSize.xs, fontWeight: '500' },

  // Type selection modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  modalCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    width: '100%',
    maxHeight: '80%',
  },
  modalTitle: { fontSize: fontSize.lg, fontWeight: 'bold', color: colors.gray800, marginBottom: spacing.md },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
    marginBottom: spacing.xs,
  },
  modalOptionActive: { backgroundColor: colors.navyBg },
  modalOptionText: { fontSize: fontSize.md, color: colors.gray700, flex: 1 },
  modalOptionTextActive: { color: colors.navy, fontWeight: '600' },
  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  modalBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 4,
    borderRadius: borderRadius.lg,
  },
  modalBtnCancel: { backgroundColor: colors.gray100 },
  modalBtnCamera: { backgroundColor: colors.navy },
  modalBtnGallery: { backgroundColor: colors.navyBg, borderWidth: 1, borderColor: colors.navy },
  modalBtnText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.white },
  modalBtnTextDark: { fontSize: fontSize.sm, fontWeight: '600', color: colors.navy },
  modalBtnTextCancel: { fontSize: fontSize.sm, fontWeight: '600', color: colors.gray600 },

  // Document viewer modal
  viewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  viewerCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    width: '100%',
    maxHeight: '90%',
    overflow: 'hidden',
  },
  viewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  viewerTitle: { fontSize: fontSize.lg, fontWeight: 'bold', color: colors.gray800 },
  viewerImage: {
    width: '100%',
    height: 280,
    backgroundColor: colors.gray50,
  },
  viewerDetails: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderColor: colors.gray100,
  },
  viewerDetailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  viewerDetailLabel: { fontSize: fontSize.base, color: colors.gray500 },
  viewerDetailValue: { fontSize: fontSize.base, fontWeight: '500', color: colors.gray700 },
  viewerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderColor: colors.gray100,
  },
  viewerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 4,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  viewerBtnReplace: { borderColor: colors.navy, backgroundColor: colors.navyBg },
  viewerBtnDelete: { borderColor: colors.redBorder, backgroundColor: colors.redLight },
  viewerBtnTextDark: { fontSize: fontSize.sm, fontWeight: '600', color: colors.navy },
  viewerBtnTextRed: { fontSize: fontSize.sm, fontWeight: '600', color: colors.red },
});
