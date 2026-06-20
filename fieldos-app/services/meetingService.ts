/**
 * FieldOS Nepal — Center Meeting Service
 *
 * Handles center meeting creation: local persist → sync queue → audit → server.
 */

import { getConfig } from './apiClient';
import {
  createMeeting,
  addAttendance,
  updateMeetingProgress,
  completeMeeting,
  saveDraftMeeting,
} from '../db/repositories/meetingsRepo';
import { enqueueSyncEvent } from '../db/repositories/syncQueueRepo';
import { auditMeetingCompleted } from './auditService';
import type {
  CreateMeetingRequest,
  CreateMeetingResponse,
  MeetingAttendanceItem,
  ApiResponse,
} from '../types/api';

// ─── Public API ──────────────────────────────────────────────────

/**
 * Create a new center meeting record locally.
 * Returns meetingId for subsequent attendance tracking.
 */
export async function initCenterMeeting(params: {
  centerId: number;
  centerName: string;
  meetingDate: string;
  location: string;
  officerId: number;
  totalMembers: number;
}): Promise<number> {
  return createMeeting({
    center_id: params.centerId,
    center_name: params.centerName,
    meeting_date: params.meetingDate,
    location: params.location,
    officer_id: params.officerId,
    total_members: params.totalMembers,
  });
}

/**
 * Save a meeting draft (in-progress state).
 */
export async function saveMeetingDraft(meetingId: number): Promise<void> {
  await saveDraftMeeting(meetingId);
}

/**
 * Complete a center meeting: persist attendance, progress, enqueue sync, audit.
 */
export async function completeCenterMeeting(
  meetingId: number,
  req: CreateMeetingRequest,
): Promise<ApiResponse<CreateMeetingResponse>> {
  const { enableMock } = getConfig();

  // 1. Persist attendance records
  for (const att of req.attendance) {
    await addAttendance(meetingId, att.clientId, att.memberId, att.status);
  }

  // 2. Update meeting progress and mark complete
  await updateMeetingProgress(meetingId, {
    present_count: req.presentCount,
    paid_count: req.paidCount,
    absent_count: req.absentCount,
    followup_count: req.followupCount,
    collection_received: req.collectionReceived,
  });
  await completeMeeting(meetingId, req.collectionReceived);

  // 3. Enqueue for sync
  await enqueueSyncEvent('center_meeting', {
    meetingId,
    centerId: req.centerId,
    centerName: req.centerName,
    presentCount: req.presentCount,
    paidCount: req.paidCount,
    absentCount: req.absentCount,
    followupCount: req.followupCount,
    totalMembers: req.totalMembers,
    collectionReceived: req.collectionReceived,
    meetingDate: req.meetingDate,
  }, meetingId);

  // 4. Audit
  await auditMeetingCompleted(String(meetingId), req.totalMembers, req.presentCount + req.paidCount, req.collectionReceived);

  // 5. Return
  if (enableMock) {
    await mockDelay(400);
  }

  return {
    success: true,
    data: {
      meetingId,
      serverId: 0,
      timestamp: new Date().toISOString(),
    },
    timestamp: new Date().toISOString(),
  };
}

// ─── Internal ────────────────────────────────────────────────────

function mockDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
