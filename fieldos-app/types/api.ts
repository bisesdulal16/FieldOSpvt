/**
 * FieldOS Nepal — API Payload Types
 *
 * All request/response types for the backend API.
 * These types define the contract between the mobile app and the server.
 * When EXPO_PUBLIC_ENABLE_MOCK_SYNC=true, mock implementations return
 * these same types with fake data.
 */

// ─── Common ──────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  timestamp: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, string[]>;
  };
  timestamp: string;
}

// ─── Auth ────────────────────────────────────────────────────────

export interface LoginRequest {
  staff_id: string;
  pin: string;
}

export interface BiometricLoginRequest {
  deviceId: string;
  deviceModel?: string;
  osVersion?: string;
  appVersion?: string;
}

export interface LoginResponse {
  user: UserProfile;
  device: DeviceInfo;
  tokens: TokenPair;
  branch: BranchInfo;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
  refreshExpiresIn: number; // seconds
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface RefreshTokenResponse {
  tokens: TokenPair;
}

export interface UserProfile {
  id: number;
  staffId: string;
  name: string;
  nameNe?: string;
  role: 'field_officer' | 'branch_manager' | 'admin';
  branchId: string;
  branchName: string;
  isActive: boolean;
}

export interface DeviceInfo {
  id: number;
  deviceId: string;
  deviceName: string;
  deviceModel: string;
  osVersion: string;
  appVersion: string;
  isRegistered: boolean;
  lastSyncAt: string | null;
}

export interface BranchInfo {
  id: number;
  branchId: string;
  name: string;
  nameNe?: string;
  address?: string;
}

export interface DeviceRegisterRequest {
  deviceId: string;
  deviceName: string;
  deviceModel: string;
  osVersion: string;
  appVersion: string;
}

// ─── Bootstrap ───────────────────────────────────────────────────

export interface BootstrapRequest {
  deviceId: string;
  lastSyncAt?: string;
}

export interface BootstrapResponse {
  user: UserProfile;
  branch: BranchInfo;
  clients: ClientSummary[];
  tasks: TaskAssignment[];
  appSettings: AppSettingItem[];
  serverTimestamp: string;
}

export interface ClientSummary {
  id: number;
  clientId: number;
  memberId: string;
  name: string;
  nameNe?: string;
  centerId: string;
  centerName: string;
  ward?: string;
  loanCycle: number;
  outstandingBalance: number;
  dueAmount: number;
  nextInstallmentDate: string | null;
  overdueDays: number;
  status: 'active' | 'inactive' | 'written_off' | 'closed';
  hasKycCitizenship: boolean;
  hasKycPhoto: boolean;
}

export interface TaskAssignment {
  id: number;
  taskId: number;
  clientId: number;
  clientName: string;
  clientMemberId: string;
  taskType: 'collection' | 'follow-up' | 'kyc' | 'meeting' | 'complaint' | 'other';
  taskDate: string;
  priority: 'low' | 'normal' | 'high';
  amount?: number;
  reason?: string;
  notes?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  loanCycle?: number;
  overdueDays?: number;
}

export interface AppSettingItem {
  key: string;
  value: string;
  type: 'string' | 'number' | 'boolean' | 'json';
}

// ─── Sync ────────────────────────────────────────────────────────

export interface SyncEventsRequest {
  deviceId: string;
  events: SyncEventPayload[];
}

export interface SyncEventPayload {
  entityType: string;
  operation: 'create' | 'update' | 'delete';
  localId: number;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface SyncEventResult {
  localId: number;
  serverId?: number;
  success: boolean;
  error?: string;
}

export interface SyncEventsResponse {
  processed: number;
  succeeded: number;
  failed: number;
  results: SyncEventResult[];
  serverTimestamp: string;
}

export interface SyncStatusResponse {
  pendingCount: number;
  lastSyncAt: string | null;
  serverTime: string;
}

// ─── Tasks ───────────────────────────────────────────────────────

export interface FetchTasksRequest {
  date?: string;
  status?: string;
  type?: string;
}

// ─── Clients ─────────────────────────────────────────────────────

export interface FetchClientRequest {
  clientId: number;
}

export interface ClientDetail {
  id: number;
  memberId: string;
  name: string;
  nameNe?: string;
  centerId: string;
  centerName: string;
  ward?: string;
  loanCycle: number;
  status: 'active' | 'inactive' | 'written_off' | 'closed';
  photoUrl?: string;
  loanAccount: {
    loanId: string;
    productType: string;
    disbursementDate: string;
    maturityDate: string;
    principalAmount: number;
    outstandingBalance: number;
    installmentAmount: number;
    installmentFrequency: string;
    status: string;
  };
  kyc: {
    citizenshipFront: boolean;
    citizenshipBack: boolean;
    clientPhoto: boolean;
    signature: boolean;
  };
  lastPayment?: {
    date: string;
    amount: number;
  };
  activePromise?: {
    id: number;
    promisedAmount: number;
    expectedDate: string;
    reason: string;
  };
  visitHistory: VisitHistoryItem[];
}

export interface VisitHistoryItem {
  date: string;
  type: 'collection' | 'visit' | 'follow-up' | 'kyc';
  amount?: number;
  notes?: string;
}

// ─── Visit Check-in ─────────────────────────────────────────────

export interface CreateVisitCheckinRequest {
  clientId: number;
  visitPurpose: string;
  taskId?: number;
  gpsLatitude?: number;
  gpsLongitude?: number;
  gpsAccuracyMeters?: number;
  gpsAddress?: string;
}

export interface VisitCheckinResponse {
  checkinId: number;
  serverId: number;
  timestamp: string;
}

// ─── Collections ─────────────────────────────────────────────────

export interface CreateCollectionRequest {
  clientId: number;
  amount: number;
  dueAmount: number;
  outstandingAfter: number;
  paymentMethod: string;
  isHighValue: boolean;
  taskId?: number;
  gpsLatitude?: number;
  gpsLongitude?: number;
  gpsAccuracyMeters?: number;
  faceVerified: boolean;
  visitId?: number;
}

export interface CreateCollectionResponse {
  collectionId: number;
  receiptId: string;
  serverId: number;
  timestamp: string;
}

// ─── Promise-to-Pay ─────────────────────────────────────────────

export interface CreatePromiseToPayRequest {
  clientId: number;
  promisedAmount: number;
  expectedPaymentDate: string;
  reason: string;
  outstandingAmount: number;
}

export interface CreatePromiseToPayResponse {
  promiseId: number;
  serverId: number;
  timestamp: string;
}

// ─── Center Meetings ─────────────────────────────────────────────

export interface CreateMeetingRequest {
  centerId: string;
  centerName: string;
  meetingDate: string;
  location?: string;
  totalMembers: number;
  presentCount: number;
  paidCount: number;
  absentCount: number;
  followupCount: number;
  collectionExpected: number;
  collectionReceived: number;
  attendance: MeetingAttendanceItem[];
}

export interface MeetingAttendanceItem {
  clientId: number;
  memberId: string;
  status: 'present' | 'paid' | 'absent' | 'follow-up';
}

export interface CreateMeetingResponse {
  meetingId: number;
  serverId: number;
  timestamp: string;
}

// ─── End-of-Day ─────────────────────────────────────────────────

export interface CreateEndOfDayReportRequest {
  reportDate: string;
  totalCollections: number;
  totalVisits: number;
  pendingCount: number;
  exceptions: EndOfDayException[];
  isConfirmed: boolean;
  faceVerified: boolean;
}

export interface EndOfDayException {
  type: string;
  description: string;
  entityId?: number;
}

export interface CreateEndOfDayResponse {
  reportId: number;
  serverId: number;
  timestamp: string;
}

// ─── Audit Events ────────────────────────────────────────────────

export interface SubmitAuditEventsRequest {
  events: AuditEventPayload[];
}

export interface AuditEventPayload {
  actionType: string;
  entityType?: string;
  entityId?: string;
  verificationStatus?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export interface SubmitAuditEventsResponse {
  processed: number;
  timestamp: string;
}

// ─── KYC Documents ───────────────────────────────────────────────

export interface UploadKycDocumentRequest {
  clientId: number;
  documentType: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  width?: number;
  height?: number;
  blurScore?: number;
  qualityStatus: string;
}

export interface UploadKycDocumentResponse {
  documentId: number;
  serverId: number;
  uploadUrl?: string;
  timestamp: string;
}
