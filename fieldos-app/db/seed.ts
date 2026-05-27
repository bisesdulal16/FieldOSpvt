/**
 * FieldOS Nepal — Database Seed Functions
 *
 * Inserts demo data only when tables are empty.
 * Each seed function checks for existing rows before inserting.
 */

import { query, mutate, insertAndGetId } from './database';

// ─── Seed Field Officer User ──────────────────────────────────────
async function seedUser(): Promise<void> {
  const rows = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM users'
  );
  if (rows[0].count > 0) return;

  await mutate(
    `INSERT INTO users (staff_id, name, name_ne, role, branch, employee_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      'FO-208',
      'Ram Bahadur Shah',
      'राम बहादुर शाह',
      'Field Officer',
      'Kathmandu West Branch',
      'FO-208',
    ]
  );
}

// ─── Seed Demo Device ─────────────────────────────────────────────
async function seedDevice(): Promise<void> {
  const rows = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM devices'
  );
  if (rows[0].count > 0) return;

  await mutate(
    `INSERT INTO devices (device_id, device_name, device_model, os_version, app_version)
     VALUES (?, ?, ?, ?, ?)`,
    ['DEVICE-DEMO-001', 'Demo Device', 'Pixel 7', 'Android 14', '3.0.0']
  );
}

// ─── Seed Clients ─────────────────────────────────────────────────
async function seedClients(): Promise<void> {
  const rows = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM clients'
  );
  if (rows[0].count > 0) return;

  const clients = [
    {
      member_id: 'M-1042',
      name: 'Sunita Kumari Chaudhary',
      name_ne: 'सुनिता कुमारी चौधरी',
      center_id: 'CTR-JAN-001',
      center_name: 'Janakpur Center',
      ward: 'Ward 7, Butwal',
      loan_cycle: 3,
      outstanding_balance: 45000,
      due_amount: 5500,
      overdue_days: 8,
      status: 'overdue',
    },
    {
      member_id: 'M-1056',
      name: 'Rita Maya Tamang',
      name_ne: 'रिता माया तामाङ',
      center_id: 'CTR-BHK-002',
      center_name: 'Bhaktapur Women Ctr',
      ward: 'Ward 3, Bhaktapur',
      loan_cycle: 2,
      outstanding_balance: 28000,
      due_amount: 3200,
      overdue_days: 0,
      status: 'due-today',
    },
    {
      member_id: 'M-1089',
      name: 'Sita Devi Sah',
      name_ne: 'सीता देवी साह',
      center_id: 'CTR-KLK-003',
      center_name: 'Kalika Women Center',
      ward: 'Ward 5, Kalanki',
      loan_cycle: 4,
      outstanding_balance: 120000,
      due_amount: 15000,
      overdue_days: 15,
      status: 'high-value',
    },
    {
      member_id: 'M-1101',
      name: 'Ramesh Thapa',
      name_ne: 'रमेश थापा',
      center_id: 'CTR-PKR-004',
      center_name: 'Pokhara Trade Ctr',
      ward: 'Ward 12, Pokhara',
      loan_cycle: 2,
      outstanding_balance: 18000,
      due_amount: 2800,
      overdue_days: 15,
      status: 'overdue',
    },
    {
      member_id: 'M-1115',
      name: 'Maya Devi Shrestha',
      name_ne: 'माया देवी श्रेष्ठ',
      center_id: 'CTR-LPT-005',
      center_name: 'Lalitpur Savi Ctr',
      ward: 'Ward 2, Patan',
      loan_cycle: 5,
      outstanding_balance: 35000,
      due_amount: 4100,
      overdue_days: 0,
      status: 'promise',
    },
    {
      member_id: 'M-1123',
      name: 'Gita Kumari Gupta',
      name_ne: 'गिता कुमारी गुप्ता',
      center_id: 'CTR-CHW-006',
      center_name: 'Chitwan Mahila Ctr',
      ward: 'Ward 8, Bharatpur',
      loan_cycle: 3,
      outstanding_balance: 52000,
      due_amount: 6750,
      overdue_days: 0,
      status: 'sync',
    },
  ];

  for (const client of clients) {
    await mutate(
      `INSERT INTO clients (
        member_id, name, name_ne, center_id, center_name, ward,
        loan_cycle, outstanding_balance, due_amount, overdue_days, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        client.member_id,
        client.name,
        client.name_ne,
        client.center_id,
        client.center_name,
        client.ward,
        client.loan_cycle,
        client.outstanding_balance,
        client.due_amount,
        client.overdue_days,
        client.status,
      ]
    );
  }
}

// ─── Seed Default App Settings ────────────────────────────────────
async function seedSettings(): Promise<void> {
  const rows = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM app_settings'
  );
  if (rows[0].count > 0) return;

  const settings = [
    {
      setting_key: 'language',
      setting_value: 'en',
      setting_type: 'string',
      description: 'App display language (en/ne)',
    },
    {
      setting_key: 'theme',
      setting_value: 'light',
      setting_type: 'string',
      description: 'App theme (light/dark)',
    },
    {
      setting_key: 'gps_accuracy_threshold',
      setting_value: '50',
      setting_type: 'number',
      description: 'GPS accuracy threshold in meters',
    },
    {
      setting_key: 'high_value_threshold',
      setting_value: '10000',
      setting_type: 'number',
      description: 'High-value collection threshold in NPR',
    },
    {
      setting_key: 'face_verification_required',
      setting_value: 'true',
      setting_type: 'boolean',
      description: 'Require face verification for high-value collections',
    },
    {
      setting_key: 'sync_interval_minutes',
      setting_value: '30',
      setting_type: 'number',
      description: 'Background sync interval in minutes',
    },
    {
      setting_key: 'offline_mode',
      setting_value: 'true',
      setting_type: 'boolean',
      description: 'Enable offline data collection',
    },
    {
      setting_key: 'receipt_print_enabled',
      setting_value: 'false',
      setting_type: 'boolean',
      description: 'Enable receipt printing via Bluetooth',
    },
    {
      setting_key: 'max_sync_retries',
      setting_value: '3',
      setting_type: 'number',
      description: 'Maximum sync retry attempts',
    },
    {
      setting_key: 'app_version',
      setting_value: '3.0.0',
      setting_type: 'string',
      description: 'Current application version',
    },
  ];

  for (const setting of settings) {
    await mutate(
      `INSERT INTO app_settings (setting_key, setting_value, setting_type, description)
       VALUES (?, ?, ?, ?)`,
      [
        setting.setting_key,
        setting.setting_value,
        setting.setting_type,
        setting.description,
      ]
    );
  }
}

// ─── Seed All ─────────────────────────────────────────────────────
/**
 * Seeds all demo data into the database.
 * Each function checks if data already exists before inserting.
 * Call this after getDatabase() to populate fresh databases.
 */
export async function seedDatabase(): Promise<void> {
  await seedUser();
  await seedDevice();
  await seedClients();
  await seedSettings();
}
