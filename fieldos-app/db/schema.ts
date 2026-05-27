/**
 * FieldOS Nepal — SQLite Schema Definitions
 *
 * All 14 CREATE TABLE statements for the local database.
 * Uses expo-sqlite compatible syntax (SQLite).
 */

// ─── Users (Field Officer Profile) ────────────────────────────────
export const CREATE_TABLE_USERS = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_ne TEXT,
  role TEXT NOT NULL DEFAULT 'Field Officer',
  branch TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  device_authorized INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`;

// ─── Devices ──────────────────────────────────────────────────────
export const CREATE_TABLE_DEVICES = `
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL UNIQUE,
  device_name TEXT,
  device_model TEXT,
  os_version TEXT,
  app_version TEXT NOT NULL DEFAULT '3.0.0',
  last_sync_at TEXT,
  is_registered INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`;

// ─── Clients ──────────────────────────────────────────────────────
export const CREATE_TABLE_CLIENTS = `
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_ne TEXT,
  center_id TEXT,
  center_name TEXT,
  ward TEXT,
  loan_cycle INTEGER NOT NULL DEFAULT 1,
  outstanding_balance REAL NOT NULL DEFAULT 0,
  due_amount REAL NOT NULL DEFAULT 0,
  next_installment_date TEXT,
  last_payment_date TEXT,
  last_payment_amount REAL NOT NULL DEFAULT 0,
  overdue_days INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  photo_url TEXT,
  kyc_citizenship INTEGER NOT NULL DEFAULT 0,
  kyc_photo INTEGER NOT NULL DEFAULT 0,
  kyc_address INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`;

// ─── Loan Accounts ────────────────────────────────────────────────
export const CREATE_TABLE_LOAN_ACCOUNTS = `
CREATE TABLE IF NOT EXISTS loan_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  loan_id TEXT NOT NULL UNIQUE,
  product_type TEXT NOT NULL DEFAULT 'Micro Loan',
  disbursement_date TEXT,
  maturity_date TEXT,
  principal_amount REAL NOT NULL DEFAULT 0,
  outstanding_balance REAL NOT NULL DEFAULT 0,
  installment_amount REAL NOT NULL DEFAULT 0,
  installment_frequency TEXT NOT NULL DEFAULT 'weekly',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`;

// ─── Tasks (Daily Task List for Field Officer) ───────────────────
export const CREATE_TABLE_TASKS = `
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER REFERENCES clients(id),
  task_type TEXT NOT NULL,
  task_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'normal',
  reason TEXT,
  amount REAL NOT NULL DEFAULT 0,
  is_completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`;
// task_type: 'collection', 'follow-up', 'kyc', 'meeting', 'complaint', 'other'
// status: 'pending', 'in_progress', 'completed', 'skipped'
// priority: 'low', 'normal', 'high'
// sync_status: 'pending', 'synced', 'failed'

// ─── Visit Check-ins ──────────────────────────────────────────────
export const CREATE_TABLE_VISIT_CHECKINS = `
CREATE TABLE IF NOT EXISTS visit_checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  task_id INTEGER REFERENCES tasks(id),
  visit_purpose TEXT NOT NULL,
  gps_latitude REAL,
  gps_longitude REAL,
  gps_address TEXT,
  gps_accuracy_meters REAL,
  checked_in_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`;

// ─── Collections ──────────────────────────────────────────────────
export const CREATE_TABLE_COLLECTIONS = `
CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id TEXT NOT NULL UNIQUE,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  task_id INTEGER REFERENCES tasks(id),
  visit_id INTEGER REFERENCES visit_checkins(id),
  amount REAL NOT NULL,
  due_amount REAL NOT NULL,
  outstanding_after REAL NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  is_high_value INTEGER NOT NULL DEFAULT 0,
  face_verified INTEGER NOT NULL DEFAULT 0,
  gps_latitude REAL,
  gps_longitude REAL,
  gps_address TEXT,
  collected_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  cbs_verified INTEGER NOT NULL DEFAULT 0,
  cbs_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`;

// ─── Promise to Pay ───────────────────────────────────────────────
export const CREATE_TABLE_PROMISE_TO_PAY = `
CREATE TABLE IF NOT EXISTS promise_to_pay (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  task_id INTEGER REFERENCES tasks(id),
  promised_amount REAL NOT NULL,
  expected_payment_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  outstanding_amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  fulfilled_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`;
// status: 'active', 'fulfilled', 'broken'

// ─── Center Meetings ──────────────────────────────────────────────
export const CREATE_TABLE_CENTER_MEETINGS = `
CREATE TABLE IF NOT EXISTS center_meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id TEXT NOT NULL,
  center_name TEXT NOT NULL,
  meeting_date TEXT NOT NULL,
  location TEXT,
  officer_id TEXT,
  total_members INTEGER NOT NULL DEFAULT 0,
  present_count INTEGER NOT NULL DEFAULT 0,
  paid_count INTEGER NOT NULL DEFAULT 0,
  absent_count INTEGER NOT NULL DEFAULT 0,
  followup_count INTEGER NOT NULL DEFAULT 0,
  collection_expected REAL NOT NULL DEFAULT 0,
  collection_received REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress',
  sync_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`;
// status: 'in_progress', 'completed', 'draft'

// ─── Meeting Attendance ───────────────────────────────────────────
export const CREATE_TABLE_MEETING_ATTENDANCE = `
CREATE TABLE IF NOT EXISTS meeting_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES center_meetings(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  member_id TEXT NOT NULL,
  attendance_status TEXT NOT NULL DEFAULT 'present',
  sync_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`;
// attendance_status: 'present', 'paid', 'absent', 'follow-up'

// ─── End-of-Day Reports ───────────────────────────────────────────
export const CREATE_TABLE_END_OF_DAY_REPORTS = `
CREATE TABLE IF NOT EXISTS end_of_day_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_date TEXT NOT NULL,
  officer_id TEXT NOT NULL,
  total_collections REAL NOT NULL DEFAULT 0,
  total_visits INTEGER NOT NULL DEFAULT 0,
  pending_count INTEGER NOT NULL DEFAULT 0,
  exceptions_json TEXT,
  is_confirmed INTEGER NOT NULL DEFAULT 0,
  is_submitted INTEGER NOT NULL DEFAULT 0,
  face_verified INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`;

// ─── Sync Queue ───────────────────────────────────────────────────
export const CREATE_TABLE_SYNC_QUEUE = `
CREATE TABLE IF NOT EXISTS sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  operation TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  scheduled_at TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`;
// operation: 'create', 'update', 'delete'
// status: 'pending', 'in_progress', 'synced', 'failed'

// ─── Audit Events (Phase 3 — Cybersecurity-first accountability) ──
export const CREATE_TABLE_AUDIT_EVENTS = `
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'field_officer',
  branch_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  sync_status TEXT NOT NULL DEFAULT 'local',
  verification_status TEXT NOT NULL DEFAULT 'not_required',
  metadata TEXT
);
`;
// action_type: 'login', 'biometric_login', 'start_day', 'face_verification_success',
//              'face_verification_failure', 'visit_checkin', 'collection_recorded',
//              'collection_edited', 'receipt_created', 'promise_to_pay_created',
//              'center_meeting_completed', 'end_of_day_submitted',
//              'sync_attempted', 'sync_failed', 'secure_logout'
// sync_status: 'local', 'synced'
// verification_status: 'not_required', 'verified', 'failed'

// ─── App Settings ─────────────────────────────────────────────────
export const CREATE_TABLE_APP_SETTINGS = `
CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_key TEXT NOT NULL UNIQUE,
  setting_value TEXT NOT NULL,
  setting_type TEXT NOT NULL DEFAULT 'string',
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`;
// setting_type: 'string', 'number', 'boolean', 'json'

// ─── KYC Documents (Phase 8 — Document Capture) ──────────────────
export const CREATE_TABLE_KYC_DOCUMENTS = `
CREATE TABLE IF NOT EXISTS kyc_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  document_type TEXT NOT NULL,
  file_uri TEXT NOT NULL,
  file_name TEXT,
  file_size INTEGER,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  blur_score REAL,
  quality_status TEXT NOT NULL DEFAULT 'pending_review',
  status TEXT NOT NULL DEFAULT 'captured',
  captured_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  synced_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`;
// document_type: 'citizenship_front', 'citizenship_back', 'client_photo', 'signature', 'other'
// quality_status: 'pending_review', 'clear', 'blurry'
// status: 'missing', 'captured', 'pending_sync', 'needs_review', 'approved'
// sync_status: 'pending', 'synced', 'failed'

// ─── Voice Notes (Phase 14 — Nepali Voice Notes & Assistant) ────
export const CREATE_TABLE_VOICE_NOTES = `
CREATE TABLE IF NOT EXISTS voice_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER REFERENCES clients(id),
  visit_id INTEGER REFERENCES visit_checkins(id),
  title TEXT NOT NULL DEFAULT '',
  raw_text TEXT NOT NULL DEFAULT '',
  cleaned_text TEXT,
  ai_summary TEXT,
  language TEXT NOT NULL DEFAULT 'ne',
  audio_duration_seconds REAL,
  audio_file_uri TEXT,
  audio_file_size INTEGER,
  is_ai_cleaned INTEGER NOT NULL DEFAULT 0,
  is_ai_summarized INTEGER NOT NULL DEFAULT 0,
  is_human_reviewed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  sync_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`;
// status: 'draft', 'edited', 'saved', 'synced'
// sync_status: 'pending', 'synced', 'failed'

// ─── All Tables Array ─────────────────────────────────────────────
export const ALL_TABLES = [
  CREATE_TABLE_USERS,
  CREATE_TABLE_DEVICES,
  CREATE_TABLE_CLIENTS,
  CREATE_TABLE_LOAN_ACCOUNTS,
  CREATE_TABLE_TASKS,
  CREATE_TABLE_VISIT_CHECKINS,
  CREATE_TABLE_COLLECTIONS,
  CREATE_TABLE_PROMISE_TO_PAY,
  CREATE_TABLE_CENTER_MEETINGS,
  CREATE_TABLE_MEETING_ATTENDANCE,
  CREATE_TABLE_END_OF_DAY_REPORTS,
  CREATE_TABLE_SYNC_QUEUE,
  CREATE_TABLE_AUDIT_EVENTS,
  CREATE_TABLE_APP_SETTINGS,
  CREATE_TABLE_KYC_DOCUMENTS,
  CREATE_TABLE_VOICE_NOTES,
];
