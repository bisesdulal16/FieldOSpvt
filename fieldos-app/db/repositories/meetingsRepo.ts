import { query, mutate, insertAndGetId } from '../database';

/**
 * Meetings Repository — center meetings and attendance tracking.
 */

export async function createMeeting(data: {
  center_id: number;
  center_name: string;
  meeting_date: string;
  location?: string;
  officer_id?: number;
  total_members: number;
}): Promise<number> {
  return insertAndGetId(
    `INSERT INTO meetings
       (center_id, center_name, meeting_date, location, officer_id, total_members,
        present_count, paid_count, absent_count, followup_count, collection_received, status)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 'in_progress')`,
    [
      data.center_id,
      data.center_name,
      data.meeting_date,
      data.location ?? null,
      data.officer_id ?? null,
      data.total_members,
    ]
  );
}

export async function updateMeetingProgress(
  id: number,
  data: {
    present_count: number;
    paid_count: number;
    absent_count: number;
    followup_count: number;
    collection_received: number;
  }
): Promise<void> {
  await mutate(
    `UPDATE meetings
     SET present_count = ?,
         paid_count = ?,
         absent_count = ?,
         followup_count = ?,
         collection_received = ?
     WHERE id = ?`,
    [
      data.present_count,
      data.paid_count,
      data.absent_count,
      data.followup_count,
      data.collection_received,
      id,
    ]
  );
}

export async function completeMeeting(id: number, collectionReceived: number): Promise<void> {
  await mutate(
    `UPDATE meetings
     SET status = 'completed',
         collection_received = ?,
         completed_at = datetime('now')
     WHERE id = ?`,
    [collectionReceived, id]
  );
}

export async function saveDraftMeeting(id: number): Promise<void> {
  await mutate(
    "UPDATE meetings SET status = 'draft' WHERE id = ?",
    [id]
  );
}

export async function getMeetingById(id: number): Promise<any | null> {
  const rows = await query('SELECT * FROM meetings WHERE id = ?', [id]);
  return rows.length === 0 ? null : rows[0];
}

export async function getMeetingsByDate(date: string): Promise<any[]> {
  return query('SELECT * FROM meetings WHERE meeting_date = ?', [date]);
}

export async function addAttendance(
  meetingId: number,
  clientId: number,
  memberId: string,
  status: string
): Promise<number> {
  return insertAndGetId(
    `INSERT INTO meeting_attendance (meeting_id, client_id, member_id, status)
     VALUES (?, ?, ?, ?)`,
    [meetingId, clientId, memberId, status]
  );
}

export async function getAttendanceByMeeting(meetingId: number): Promise<any[]> {
  return query(
    'SELECT * FROM meeting_attendance WHERE meeting_id = ?',
    [meetingId]
  );
}
