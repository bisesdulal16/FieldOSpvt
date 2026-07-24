/**
 * FieldOS Nepal — Services Barrel Export
 *
 * Central export point for all service modules.
 * Screens should import from here, not individual files.
 */

// API Client (base HTTP client)
export { apiClient, getConfig, updateConfig, setTokens, getAccessToken, clearTokens, isAuthenticated } from './apiClient';

// Auth
export { loginWithPin, loginWithBiometric, refreshAuthToken, registerDevice, logout, getCurrentUser, getCurrentUserSync, initAuth } from './authService';
export type { LoginRequest, LoginResponse, BiometricLoginRequest } from './authService';

// Sync
export { runSync, retryFailedAndSync, loadSyncState, loadSyncStatus, formatLastSyncTime, saveSyncStatus, setForceNextFailure, setFailureRate } from './syncService';

// Tasks
export { fetchAssignedTasks, fetchTasksByDate, getLocalTasks } from './taskService';

// Collections
export { recordCollection, getTodayCollectionTotal } from './collectionService';

// Clients
export { fetchClients, fetchClientDetail, searchLocalClients } from './clientService';

// Day-start (office-network gate + selfie)
export { startDayWithVerification, captureSelfie } from './dayStartService';
export type { DayStartResult } from './dayStartService';

// Loan origination (field-officer side)
export { registerBorrower, submitLoanApplication } from './loanService';
export type { RegisterBorrowerRequest, RegisteredBorrower, LoanApplicationRequest, LoanApplicationResult } from './loanService';

// Devices
export { registerDevice as registerDeviceService, sendDeviceHeartbeat } from './deviceService';

// Audit (existing, keep re-export)
export {
  audit,
  setAuditContext,
  auditLogin,
  auditStartDay,
  auditFaceVerification,
  auditVisitCheckin,
  auditCollectionRecorded,
  auditCollectionEdited,
  auditReceiptCreated,
  auditPromiseToPayCreated,
  auditMeetingCompleted,
  auditEODSubmitted,
  auditSyncAttempted,
  auditSyncFailed,
  auditLogout,
  auditKycDocumentCaptured,
  auditKycDocumentViewed,
  auditKycDocumentDeleted,
} from './auditService';

// Secure Storage (existing)
export {
  setAuthToken,
  getAuthToken,
  initSecureStorage,
  isSessionActive,
  isAppLocked,
  clearAllSecureData,
} from './secureStorage';

// Biometric Auth (existing)
export {
  isBiometricAvailable,
  biometricLogin,
  appUnlock,
} from './biometricAuth';

// Device Identity (existing)
export {
  initDeviceIdentity,
  getDeviceInfo,
  isDeviceAuthorized,
} from './deviceIdentity';

// Visit Check-in
export { recordVisitCheckin } from './visitService';

// Promise-to-Pay
export { recordPromiseToPay } from './promiseService';

// Center Meetings
export { initCenterMeeting, saveMeetingDraft, completeCenterMeeting } from './meetingService';

// End-of-Day
export { submitEndOfDayReport } from './eodService';

// KYC Documents
export { captureKycDocument, viewKycDocument, deleteKycDocumentRecord, getClientDocuments, getClientKycStatus } from './kycService';

// AI Intelligence (Phase 13)
export { getPriorityQueue, getSuggestions, getEODSummary } from './aiService';

// CBS Integration (Phase 12)
export { checkCBSStatus, getReconciliation } from './cbsService';

// Voice Notes (Phase 14)
export {
  createNote,
  getAllNotes,
  getClientNotes,
  updateNoteText,
  requestAICleanup,
  requestAISummary,
  approveNote,
  removeNote,
} from './voiceNoteService';
export type { VoiceNote } from './voiceNoteService';

// AI Assistant (Phase 14)
export {
  askFieldOS,
  getConversationHistory,
  clearConversation,
  QUICK_ACTIONS,
} from './aiAssistantService';
export type { ChatMessage, FieldOSContext, QuickAction } from './aiAssistantService';

// Feedback (hierarchical feedback loop — officer submit + campaign answer)
export { submitFeedback, fetchOpenCampaigns } from './feedbackService';
export type { SubmitFeedbackRequest, OpenCampaign, FeedbackCategory } from './feedbackService';
