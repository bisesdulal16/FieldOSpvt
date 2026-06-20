import { query } from '../database';

/**
 * Clients Repository — read-only lookups against the clients table.
 */

export async function getAllClients(): Promise<any[]> {
  return query('SELECT * FROM clients WHERE is_active = 1');
}

export async function getClientById(id: number): Promise<any | null> {
  const rows = await query('SELECT * FROM clients WHERE id = ?', [id]);
  return rows.length === 0 ? null : rows[0];
}

export async function getClientByMemberId(memberId: string): Promise<any | null> {
  const rows = await query('SELECT * FROM clients WHERE member_id = ?', [memberId]);
  return rows.length === 0 ? null : rows[0];
}

export async function searchClients(queryStr: string): Promise<any[]> {
  const pattern = `%${queryStr}%`;
  return query(
    'SELECT * FROM clients WHERE (name LIKE ? OR member_id LIKE ?) AND is_active = 1',
    [pattern, pattern]
  );
}

export async function getClientsByStatus(status: string): Promise<any[]> {
  return query(
    'SELECT * FROM clients WHERE status = ? AND is_active = 1',
    [status]
  );
}
