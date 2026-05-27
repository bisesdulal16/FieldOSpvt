import { query, mutate, insertAndGetId } from '../database';

/**
 * Collections Repository — payment collection records.
 */

export async function createCollection(data: {
  receipt_id: string;
  client_id: number;
  task_id?: number;
  visit_id?: number;
  amount: number;
  due_amount: number;
  outstanding_after: number;
  payment_method: string;
  is_high_value?: boolean;
  face_verified?: boolean;
  gps_latitude?: number;
  gps_longitude?: number;
  gps_address?: string;
}): Promise<number> {
  return insertAndGetId(
    `INSERT INTO collections
       (receipt_id, client_id, task_id, visit_id, amount, due_amount, outstanding_after,
        payment_method, is_high_value, face_verified, gps_latitude, gps_longitude, gps_address,
        collected_at, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), 'pending')`,
    [
      data.receipt_id,
      data.client_id,
      data.task_id ?? null,
      data.visit_id ?? null,
      data.amount,
      data.due_amount,
      data.outstanding_after,
      data.payment_method,
      data.is_high_value ? 1 : 0,
      data.face_verified ? 1 : 0,
      data.gps_latitude ?? null,
      data.gps_longitude ?? null,
      data.gps_address ?? null,
    ]
  );
}

export async function getCollectionsByDate(date: string): Promise<any[]> {
  return query("SELECT * FROM collections WHERE date(collected_at) = date(?)", [date]);
}

export async function getCollectionByReceiptId(receiptId: string): Promise<any | null> {
  const rows = await query('SELECT * FROM collections WHERE receipt_id = ?', [receiptId]);
  return rows.length === 0 ? null : rows[0];
}

export async function getPendingSyncCollections(): Promise<any[]> {
  return query("SELECT * FROM collections WHERE sync_status = 'pending'");
}

export async function markCollectionSynced(id: number): Promise<void> {
  await mutate(
    "UPDATE collections SET sync_status = 'synced' WHERE id = ?",
    [id]
  );
}

export async function markCbsVerified(id: number): Promise<void> {
  await mutate(
    `UPDATE collections
     SET cbs_verified = 1,
         cbs_verified_at = datetime('now')
     WHERE id = ?`,
    [id]
  );
}

export async function getTotalCollectedToday(): Promise<number> {
  const rows = await query(
    "SELECT COALESCE(SUM(amount), 0) as total FROM collections WHERE date(collected_at) = date('now')"
  );
  return (rows[0]?.total as number) ?? 0;
}
