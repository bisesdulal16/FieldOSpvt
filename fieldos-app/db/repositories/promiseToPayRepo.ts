import { query, mutate, insertAndGetId } from '../database';

/**
 * Promise-to-Pay Repository — track payment promises from clients.
 */

export async function createPromise(data: {
  client_id: number;
  task_id?: number;
  promised_amount: number;
  expected_payment_date: string;
  reason: string;
  outstanding_amount: number;
}): Promise<number> {
  return insertAndGetId(
    `INSERT INTO promises_to_pay
       (client_id, task_id, promised_amount, expected_payment_date, reason, outstanding_amount,
        status, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, 'active', 'pending')`,
    [
      data.client_id,
      data.task_id ?? null,
      data.promised_amount,
      data.expected_payment_date,
      data.reason,
      data.outstanding_amount,
    ]
  );
}

export async function getActivePromises(): Promise<any[]> {
  return query("SELECT * FROM promises_to_pay WHERE status = 'active'");
}

export async function getPromisesByClient(clientId: number): Promise<any[]> {
  return query('SELECT * FROM promises_to_pay WHERE client_id = ?', [clientId]);
}

export async function markPromiseFulfilled(id: number): Promise<void> {
  await mutate(
    "UPDATE promises_to_pay SET status = 'fulfilled' WHERE id = ?",
    [id]
  );
}

export async function getPendingSyncPromises(): Promise<any[]> {
  return query("SELECT * FROM promises_to_pay WHERE sync_status = 'pending'");
}

export async function markPromiseSynced(id: number): Promise<void> {
  await mutate(
    "UPDATE promises_to_pay SET sync_status = 'synced' WHERE id = ?",
    [id]
  );
}
