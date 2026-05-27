import { query, mutate } from '../database';

/**
 * Settings Repository — key-value store backed by app_settings table.
 */

export async function getSetting(key: string): Promise<string | null> {
  const rows = await query(
    'SELECT setting_value FROM app_settings WHERE setting_key = ?',
    [key]
  );
  if (rows.length === 0) return null;
  return rows[0].setting_value as string;
}

export async function setSetting(
  key: string,
  value: string,
  type: string = 'string'
): Promise<void> {
  await mutate(
    'INSERT OR REPLACE INTO app_settings (setting_key, setting_value, setting_type) VALUES (?, ?, ?)',
    [key, value, type]
  );
}

export async function getSettingJSON<T>(key: string): Promise<T | null> {
  const raw = await getSetting(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setSettingJSON(key: string, value: any): Promise<void> {
  await setSetting(key, JSON.stringify(value), 'json');
}
