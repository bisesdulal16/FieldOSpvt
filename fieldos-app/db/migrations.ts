/**
 * FieldOS Nepal — Database Migration Framework
 *
 * Uses SQLite PRAGMA user_version for version tracking.
 * Migrations run sequentially; each bumps the schema version.
 *
 * To add a migration:
 *   1. Add an entry to the MIGRATIONS array with a new version number.
 *   2. Set the sql to the DDL statement(s) needed.
 *   3. The migration will run automatically on next app startup.
 */

import { getDatabase } from './database';

interface Migration {
  version: number;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  // Phase 3: Audit log system — rebuild audit_events with full accountability schema
  {
    version: 2,
    sql: `
      DROP TABLE IF EXISTS audit_events;
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
    `,
  },
  // Phase 8: KYC Document Capture — add kyc_documents table
  {
    version: 3,
    sql: `
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
    `,
  },
  // Phase 14: Voice Notes — add voice_notes table
  {
    version: 4,
    sql: `
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
    `,
  },
  // O1c: stamp each offline sync-queue item with the officer who created it, so one
  // officer's queued actions never drain (and get mis-attributed) under a different
  // officer who logs in on the same device. Existing rows stay NULL (legacy/system).
  {
    version: 5,
    sql: `
      ALTER TABLE sync_queue ADD COLUMN staff_id TEXT;
    `,
  },
];

/**
 * Get the current schema version from PRAGMA user_version.
 * Returns 0 if the database has no version set (fresh database).
 */
export async function getCurrentVersion(): Promise<number> {
  try {
    const db = await getDatabase();
    const result = await db.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version'
    );
    return result?.user_version ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Run all pending migrations in order.
 * Each migration updates PRAGMA user_version after successful execution.
 * If a migration fails, subsequent migrations are skipped.
 */
export async function runMigrations(): Promise<void> {
  const currentVersion = await getCurrentVersion();
  const db = await getDatabase();

  for (const migration of MIGRATIONS) {
    if (currentVersion < migration.version) {
      await db.execAsync(migration.sql);
      await db.execAsync(`PRAGMA user_version = ${migration.version}`);
    }
  }
}
