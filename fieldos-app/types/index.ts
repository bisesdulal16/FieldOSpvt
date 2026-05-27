export type ScreenName =
  | 'login'
  | 'dashboard'
  | 'due-collections'
  | 'client-detail'
  | 'visit-checkin'
  | 'record-collection'
  | 'receipt'
  | 'promise-to-pay'
  | 'center-meeting'
  | 'end-of-day'
  | 'sync-center'
  | 'notifications'
  | 'profile'
  | 'verify-identity';

export type FaceVerificationContext = 'start-day' | 'submit-report' | 'high-value-collection';

export type SyncStatus = 'offline' | 'online' | 'syncing' | 'synced' | 'failed' | 'pending_sync';

export type ReceiptStatus = 'saved-offline' | 'pending-sync' | 'pending-verification' | 'confirmed';

export type Language = 'en' | 'ne';

export type StatusVariant =
  | 'overdue'
  | 'due-today'
  | 'promise'
  | 'high-value'
  | 'sync'
  | 'verified'
  | 'absent'
  | 'present'
  | 'paid'
  | 'follow-up'
  | 'success'
  | 'warning'
  | 'info'
  | 'saved'
  | 'pending';

export interface SelectedClient {
  id: string;
  name: string;
  memberId: string;
  clientId?: number;
  taskId?: number;
  dueAmount?: number;
  outstandingBalance?: number;
  remainingDue?: number;
}

export interface MemberAttendance {
  name: string;
  id: string;
  status: 'present' | 'paid' | 'absent' | 'follow-up';
}

export interface SyncItem {
  label: string;
  labelNe: string;
  count: number;
  icon: string;
}

export interface NotificationItem {
  icon: string;
  iconColor: string;
  title: string;
  titleNe: string;
  description: string;
  descriptionNe: string;
  time: string;
  actionLabel?: string;
  actionLabelNe?: string;
  screen?: ScreenName;
  filter: string;
}

// ─── Phase 3: Audit Log System ─────────────────────────────────

export type AuditRole = 'field_officer' | 'branch_manager' | 'admin';

export type AuditActionType =
  | 'login'
  | 'biometric_login'
  | 'start_day'
  | 'face_verification_success'
  | 'face_verification_failure'
  | 'visit_checkin'
  | 'collection_recorded'
  | 'collection_edited'
  | 'receipt_created'
  | 'promise_to_pay_created'
  | 'center_meeting_completed'
  | 'end_of_day_submitted'
  | 'sync_attempted'
  | 'sync_failed'
  | 'secure_logout'
  | 'kyc_document_captured'
  | 'kyc_document_viewed'
  | 'kyc_document_deleted'
  | 'pin_changed'
  | 'security_setting_changed'
  | 'consent_changed'
  | 'feedback_submitted'
  | 'pilot_info_viewed'
  | 'voice_note_created'
  | 'voice_note_approved'
  | 'voice_note_deleted'
  | 'ai_assistant_query';

export type AuditSyncStatus = 'local' | 'synced';

export type AuditVerificationStatus = 'not_required' | 'verified' | 'failed';

export interface AuditEvent {
  id: string;
  userId: string;
  role: AuditRole;
  branchId: string;
  deviceId: string;
  actionType: AuditActionType;
  entityType?: string;
  entityId?: string;
  timestamp: string;
  syncStatus: AuditSyncStatus;
  verificationStatus?: AuditVerificationStatus;
  metadata?: string; // JSON string
}

/** Display-friendly config for each action type */
export const AUDIT_ACTION_CONFIG: Record<
  AuditActionType,
  { label: string; labelNe: string; icon: string; color: string; verification: AuditVerificationStatus }
> = {
  login:                   { label: 'Login',                   labelNe: 'लगइन',                      icon: 'log-in-outline',          color: '#059669', verification: 'not_required' },
  biometric_login:         { label: 'Biometric Login',         labelNe: 'बायोमेट्रिक लगइन',          icon: 'finger-print-outline',     color: '#059669', verification: 'verified' },
  start_day:               { label: 'Start Day',               labelNe: 'दिन सुरु',                   icon: 'sunny-outline',            color: '#16A34A', verification: 'not_required' },
  face_verification_success:{ label: 'Face Verified',          labelNe: 'अनुहार प्रमाणीकरण',         icon: 'checkmark-circle-outline', color: '#059669', verification: 'verified' },
  face_verification_failure:{ label: 'Face Verification Failed',labelNe: 'प्रमाणीकरण असफल',           icon: 'close-circle-outline',     color: '#DC2626', verification: 'failed' },
  visit_checkin:           { label: 'Visit Check-in',          labelNe: 'भेट चेक-इन',                icon: 'location-outline',         color: '#0B1B3A', verification: 'not_required' },
  collection_recorded:     { label: 'Collection Recorded',     labelNe: 'संकलन रेकर्ड',               icon: 'wallet-outline',           color: '#16A34A', verification: 'not_required' },
  collection_edited:       { label: 'Collection Edited',       labelNe: 'संकलन सम्पादन',              icon: 'create-outline',           color: '#D97706', verification: 'not_required' },
  receipt_created:         { label: 'Receipt Created',         labelNe: 'रसिद बनाइयो',                icon: 'document-text-outline',    color: '#059669', verification: 'not_required' },
  promise_to_pay_created:  { label: 'Promise-to-Pay Created',  labelNe: 'प्रतिबद्धता बनाइयो',         icon: 'handshake-outline',        color: '#F59E0B', verification: 'not_required' },
  center_meeting_completed:{ label: 'Center Meeting Completed',labelNe: 'बैठक पूरा',                  icon: 'people-outline',           color: '#7C3AED', verification: 'not_required' },
  end_of_day_submitted:    { label: 'EOD Report Submitted',    labelNe: 'EOD प्रतिवेदन पेश',          icon: 'clipboard-outline',        color: '#0B1B3A', verification: 'not_required' },
  sync_attempted:          { label: 'Sync Attempted',          labelNe: 'सिंक प्रयास',                icon: 'sync-outline',             color: '#6366F1', verification: 'not_required' },
  sync_failed:             { label: 'Sync Failed',             labelNe: 'सिंक असफल',                  icon: 'alert-circle-outline',     color: '#DC2626', verification: 'not_required' },
  secure_logout:           { label: 'Secure Logout',           labelNe: 'सुरक्षित लगआउट',             icon: 'log-out-outline',          color: '#DC2626', verification: 'not_required' },
  kyc_document_captured:   { label: 'KYC Document Captured',   labelNe: 'केवाईसी कागजात कैप्चर',       icon: 'camera-outline',           color: '#16A34A', verification: 'not_required' },
  kyc_document_viewed:     { label: 'KYC Document Viewed',     labelNe: 'केवाईसी कागजात हेरियो',        icon: 'eye-outline',              color: '#6366F1', verification: 'not_required' },
  kyc_document_deleted:    { label: 'KYC Document Deleted',    labelNe: 'केवाईसी कागजात मेटाइयो',       icon: 'trash-outline',            color: '#DC2626', verification: 'not_required' },
  pin_changed:             { label: 'PIN Changed',              labelNe: 'PIN परिवर्तन',             icon: 'key-outline',              color: '#F59E0B', verification: 'not_required' },
  security_setting_changed:{ label: 'Security Setting Changed', labelNe: 'सुरक्षा सेटिङ परिवर्तन',      icon: 'settings-outline',         color: '#0B1B3A', verification: 'not_required' },
  consent_changed:         { label: 'Consent Changed',          labelNe: 'सहमति परिवर्तन',            icon: 'checkmark-done-outline',   color: '#16A34A', verification: 'not_required' },
  feedback_submitted:      { label: 'Pilot Feedback Submitted',  labelNe: 'पाइलट प्रतिक्रिया पेश',       icon: 'chatbox-outline',         color: '#0B1B3A', verification: 'not_required' },
  pilot_info_viewed:       { label: 'Pilot Info Viewed',         labelNe: 'पाइलट जानकारी हेरियो',        icon: 'rocket-outline',           color: '#F59E0B', verification: 'not_required' },
  voice_note_created:      { label: 'Voice Note Created',        labelNe: 'आवाज नोट बनाइयो',            icon: 'mic-outline',              color: '#16A34A', verification: 'not_required' },
  voice_note_approved:      { label: 'Voice Note Approved',       labelNe: 'आवाज नोट स्वीकृत',            icon: 'checkmark-done-outline',    color: '#16A34A', verification: 'not_required' },
  voice_note_deleted:      { label: 'Voice Note Deleted',        labelNe: 'आवाज नोट मेटाइयो',            icon: 'trash-outline',            color: '#DC2626', verification: 'not_required' },
  ai_assistant_query:      { label: 'AI Assistant Query',        labelNe: 'AI सहायक क्वेरी',             icon: 'sparkles-outline',         color: '#0B1B3A', verification: 'not_required' },
};
