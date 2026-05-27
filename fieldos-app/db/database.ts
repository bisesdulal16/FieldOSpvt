/**
 * FieldOS Nepal — SQLite Database Singleton
 *
 * Provides a single database connection with helper functions
 * for queries, mutations, and inserts using expo-sqlite v16+ API.
 */

import * as SQLite from 'expo-sqlite';
import { ALL_TABLES } from './schema';

let db: SQLite.SQLiteDatabase | null = null;

/**
 * Get or create the singleton database connection.
 * Creates all tables on first access.
 */
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;

  db = await SQLite.openDatabaseAsync('fieldos_nepal.db');

  // Create all tables
  for (const tableSql of ALL_TABLES) {
    await db.execAsync(tableSql);
  }

  return db;
}

/**
 * Close the database connection and release the singleton.
 */
export async function closeDatabase(): Promise<void> {
  if (db) {
    await db.closeAsync();
    db = null;
  }
}

/**
 * Delete the database file and re-create with fresh schema.
 * Useful for debugging or resetting demo data.
 */
export async function resetDatabase(): Promise<void> {
  if (db) {
    await db.closeAsync();
    db = null;
  }
  await SQLite.deleteDatabaseAsync('fieldos_nepal.db');
  db = await SQLite.openDatabaseAsync('fieldos_nepal.db');
  for (const tableSql of ALL_TABLES) {
    await db.execAsync(tableSql);
  }
}

/**
 * Run a SELECT query and return all matching rows.
 *
 * @param sql    SQL statement with `?` placeholders
 * @param params Bind parameters
 * @returns Array of typed row objects
 */
export async function query<T = any>(
  sql: string,
  params?: any[]
): Promise<T[]> {
  const database = await getDatabase();
  return database.getAllAsync<T>(sql, params as any[]);
}

/**
 * Run a single mutation (INSERT, UPDATE, DELETE).
 *
 * @param sql    SQL statement with `?` placeholders
 * @param params Bind parameters
 * @returns SQLiteRunResult with lastInsertRowId and changes
 */
export async function mutate(
  sql: string,
  params?: any[]
): Promise<SQLite.SQLiteRunResult> {
  const database = await getDatabase();
  return database.runAsync(sql, params as any[]);
}

/**
 * Run a mutation and return the auto-generated row ID.
 *
 * @param sql    SQL statement with `?` placeholders
 * @param params Bind parameters
 * @returns The lastInsertRowId from the mutation result
 */
export async function insertAndGetId(
  sql: string,
  params?: any[]
): Promise<number> {
  const result = await mutate(sql, params);
  return result.lastInsertRowId;
}

/**
 * Get a single row from a SELECT query.
 *
 * @param sql    SQL statement with `?` placeholders
 * @param params Bind parameters
 * @returns Single row object or null
 */
export async function queryOne<T = any>(
  sql: string,
  params?: any[]
): Promise<T | null> {
  const database = await getDatabase();
  return database.getFirstAsync<T>(sql, params as any[]);
}
