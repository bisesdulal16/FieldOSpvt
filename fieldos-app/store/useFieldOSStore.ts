import { create } from 'zustand';
import { router } from 'expo-router';
import type {
  FaceVerificationContext,
  SyncStatus,
  ReceiptStatus,
  Language,
  SelectedClient,
} from '../types';
import type { SyncEventsResponse } from '../types/api';
import { getSetting, setSetting } from '../db/repositories/settingsRepo';
import {
  getPendingCount,
  getFailedCount,
  enqueueSyncEvent,
} from '../db/repositories/syncQueueRepo';
import {
  auditStartDay,
  auditFaceVerification,
  auditSyncAttempted,
  auditSyncFailed,
} from '../services/auditService';
import { logEvent } from '../db/repositories/auditRepo';
import { setCurrentStaffId } from '../services/apiClient';
import {
  runSync,
  retryFailedAndSync,
  loadSyncState,
  setForceNextFailure,
  formatLastSyncTime,
} from '../services/syncService';

interface FieldOSState {
  // Database readiness
  dbReady: boolean;
  setDbReady: (ready: boolean) => void;

  // Hydrated (loaded from SQLite)
  hydrated: boolean;
  setHydrated: (h: boolean) => void;

  // Day management
  dayStarted: boolean;
  dayVerifiedAt: string | null;
  currentStaffId: string | null;
  startDay: () => Promise<void>;
  resetDay: () => Promise<void>;
  // Restore this officer's day-start for today (survives re-login until EOD).
  restoreDayForOfficer: (staffId: string) => Promise<void>;

  // Face verification
  showFaceVerification: boolean;
  faceVerificationContext: FaceVerificationContext | null;
  faceVerificationStatus: 'idle' | 'looking' | 'detected' | 'verifying' | 'verified' | 'failed';
  openFaceVerification: (context: FaceVerificationContext) => void;
  closeFaceVerification: () => void;
  setFaceVerificationStatus: (status: FieldOSState['faceVerificationStatus']) => void;
  completeFaceVerification: () => void;

  // Language
  language: Language;
  toggleLanguage: () => Promise<void>;

  // Auth UI
  showPassword: boolean;
  togglePassword: () => void;

  // Client selection
  selectedClient: SelectedClient | null;
  setSelectedClient: (client: SelectedClient | null) => void;
  setClientDueAmount: (amount: number) => void;
  setClientOutstanding: (amount: number) => void;
  selectedTaskId: number | null;
  setSelectedTaskId: (id: number | null) => void;

  // Filters
  activeFilter: string;
  setActiveFilter: (filter: string) => void;

  // Notification filter
  notificationFilter: string;
  setNotificationFilter: (filter: string) => void;

  // Sync — Phase 2: Real Offline Queue
  syncStatus: SyncStatus;
  syncItemsReady: number;
  syncFailedCount: number;
  syncLastResult: SyncEventsResponse | null;
  lastSyncTime: string | null;
  isSyncing: boolean;
  triggerSync: () => Promise<void>;
  triggerRetrySync: () => Promise<void>;
  triggerForceFailSync: () => Promise<void>;
  loadSyncStatus: () => Promise<void>;

  // Collection
  collectionAmount: string;
  setCollectionAmount: (amount: string) => void;

  // Receipt
  receiptStatus: ReceiptStatus;
  setReceiptStatus: (status: ReceiptStatus) => void;
  receiptId: string;
  setReceiptId: (id: string) => void;
  lastCollectionId: number | null;
  setLastCollectionId: (id: number | null) => void;
  lastReceiptAmount: number;
  setLastReceiptAmount: (amount: number) => void;

  // Hydration
  hydrateFromDb: () => Promise<void>;
}

export const useFieldOSStore = create<FieldOSState>((set, get) => ({
  // Database readiness
  dbReady: false,
  setDbReady: (ready) => set({ dbReady: ready }),

  // Hydrated
  hydrated: false,
  setHydrated: (h) => set({ hydrated: h }),

  // Day management
  dayStarted: false,
  dayVerifiedAt: null,
  currentStaffId: null,
  startDay: async () => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const staffId = get().currentStaffId;
    set({ dayStarted: true, dayVerifiedAt: timeStr, showFaceVerification: false });
    // Persist day status, scoped to this officer + date so it survives re-login
    // (and offline reopen) until EOD — one start-day per officer per day.
    await setSetting('day_started', 'true', 'boolean');
    await setSetting('day_started_at', now.toISOString(), 'string');
    if (staffId) await setSetting('day_started_staff', staffId, 'string');
    // Clear any prior EOD-ended marker so starting a fresh day isn't blocked by the guard.
    try { await setSetting('eod_ended_at', '', 'string'); await setSetting('eod_ended_staff', '', 'string'); } catch { /* silent */ }
    // Audit log — start day
    await auditStartDay(timeStr);
    // Legacy audit (for backward compat) — attribute to the real officer, not a hardcoded id
    try {
      await logEvent('day_started', staffId || 'unknown', 'settings', undefined, { time: timeStr });
    } catch { /* silent */ }
    // Enqueue sync event for start day
    try {
      await enqueueSyncEvent('audit_event', { event: 'day_started', time: timeStr });
    } catch { /* silent */ }
  },

  resetDay: async () => {
    set({ dayStarted: false, dayVerifiedAt: null });
    // Durably end the day so it can't restore on re-login/offline reopen.
    // (restoreDayForOfficer + hydrateFromDb both gate on day_started === 'true'.)
    try {
      await setSetting('day_started', 'false', 'boolean');
      const staffId = get().currentStaffId;
      if (staffId) await setSetting('eod_ended_staff', staffId, 'string');
      await setSetting('eod_ended_at', new Date().toISOString(), 'string');
    } catch { /* silent — in-memory state already cleared */ }
  },

  restoreDayForOfficer: async (staffId: string) => {
    set({ currentStaffId: staffId });
    setCurrentStaffId(staffId); // stamp session for offline-queue scoping (O1c)
    try {
      const started = await getSetting('day_started');
      const startedStaff = await getSetting('day_started_staff');
      const startedAt = await getSetting('day_started_at');
      const sameDayAs = (iso: string | null) => {
        if (!iso) return false;
        const d = new Date(iso);
        const now = new Date();
        return d.getFullYear() === now.getFullYear() &&
          d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
      };
      // If this officer already ended their day today, never restore it — even if a
      // stale day_started flag lingers (guards the EOD "day won't end" bug).
      const eodStaff = await getSetting('eod_ended_staff');
      const eodAt = await getSetting('eod_ended_at');
      const endedToday = eodStaff === staffId && sameDayAs(eodAt);
      if (!endedToday && started === 'true' && startedStaff === staffId && startedAt && sameDayAs(startedAt)) {
        const timeStr = new Date(startedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        set({ dayStarted: true, dayVerifiedAt: timeStr });
        return;
      }
      // No active day for THIS officer today → they must start their day.
      set({ dayStarted: false, dayVerifiedAt: null });
    } catch {
      set({ dayStarted: false, dayVerifiedAt: null });
    }
  },

  // Face verification (kept in-memory only — transient UI state)
  showFaceVerification: false,
  faceVerificationContext: null,
  faceVerificationStatus: 'idle',
  openFaceVerification: (context) => {
    set({ showFaceVerification: true, faceVerificationContext: context, faceVerificationStatus: 'looking' });
    setTimeout(() => set({ faceVerificationStatus: 'detected' }), 1500);
    setTimeout(() => set({ faceVerificationStatus: 'verifying' }), 2500);
    setTimeout(() => set({ faceVerificationStatus: 'verified' }), 4000);
  },
  closeFaceVerification: () => {
    set({ showFaceVerification: false, faceVerificationContext: null, faceVerificationStatus: 'idle' });
  },
  setFaceVerificationStatus: (status) => set({ faceVerificationStatus: status }),
  completeFaceVerification: () => {
    const { faceVerificationContext } = get();
    if (faceVerificationContext === 'start-day') {
      get().startDay();
      set({ showFaceVerification: false });
      router.replace('/(tabs)');
    } else if (faceVerificationContext === 'submit-report') {
      set({ showFaceVerification: false });
      router.replace('/(tabs)');
    } else if (faceVerificationContext === 'high-value-collection') {
      const receiptId = `RC-${Date.now().toString(36).toUpperCase()}`;
      set({
        showFaceVerification: false,
        receiptStatus: 'saved-offline',
        receiptId,
      });
      // Add to sync queue
      if (get().lastCollectionId) {
        enqueueSyncEvent('collection', {
          collectionId: get().lastCollectionId,
          receiptId,
          faceVerified: true,
        }).catch(() => {});
      }
      router.push('/receipt');
    }
    // Audit log — face verification result
    auditFaceVerification(faceVerificationContext || 'unknown', true).catch(() => {});
    logEvent('face_verification', 'FO-208', 'session', undefined, { context: faceVerificationContext }).catch(() => {});
  },

  // Language — persisted
  language: 'en',
  toggleLanguage: async () => {
    const newLang = get().language === 'en' ? 'ne' : 'en';
    set({ language: newLang });
    await setSetting('language', newLang, 'string');
  },

  // Auth UI — in-memory only
  showPassword: false,
  togglePassword: () => set((s) => ({ showPassword: !s.showPassword })),

  // Client selection — in-memory only (session-scoped)
  selectedClient: null,
  setSelectedClient: (client) => set({ selectedClient: client }),
  setClientDueAmount: (amount: number) => set(state => ({
    selectedClient: state.selectedClient ? { ...state.selectedClient, dueAmount: amount } : null,
  })),
  setClientOutstanding: (amount: number) => set(state => ({
    selectedClient: state.selectedClient ? { ...state.selectedClient, outstandingBalance: amount } : null,
  })),
  selectedTaskId: null,
  setSelectedTaskId: (id) => set({ selectedTaskId: id }),

  // Filters — in-memory only (UI state)
  activeFilter: 'all',
  setActiveFilter: (filter) => set({ activeFilter: filter }),
  notificationFilter: 'all',
  setNotificationFilter: (filter) => set({ notificationFilter: filter }),

  // Sync — Phase 2: Real Offline Queue
  syncStatus: 'offline',
  syncItemsReady: 0,
  syncFailedCount: 0,
  syncLastResult: null,
  lastSyncTime: null,
  isSyncing: false,

  triggerSync: async () => {
    if (get().isSyncing) return;
    set({ isSyncing: true, syncStatus: 'syncing' });

    try {
      const result = await runSync();
      const state = await loadSyncState();
      const syncErrors = result.results.filter(r => !r.success).map(r => r.error || 'Unknown');

      set({
        syncStatus: result.failed > 0 ? 'failed' : 'synced',
        syncItemsReady: state.pendingCount,
        syncFailedCount: result.failed,
        syncLastResult: result,
        lastSyncTime: await getSetting('last_sync_at'),
        isSyncing: false,
      });
      // Audit — sync result
      if (result.failed > 0) {
        auditSyncFailed(result.succeeded, result.failed, syncErrors).catch(() => {});
      } else if (result.succeeded > 0) {
        auditSyncAttempted(result.succeeded, 0).catch(() => {});
      }
    } catch (err) {
      set({ syncStatus: 'failed', isSyncing: false });
      auditSyncFailed(0, 1, ['Unknown error']).catch(() => {});
    }
  },

  triggerRetrySync: async () => {
    if (get().isSyncing) return;
    set({ isSyncing: true, syncStatus: 'syncing' });

    try {
      const result = await retryFailedAndSync();
      const state = await loadSyncState();
      const syncErrors = result.results.filter(r => !r.success).map(r => r.error || 'Unknown');

      set({
        syncStatus: result.failed > 0 ? 'failed' : 'synced',
        syncItemsReady: state.pendingCount,
        syncFailedCount: result.failed,
        syncLastResult: result,
        lastSyncTime: await getSetting('last_sync_at'),
        isSyncing: false,
      });
      // Audit — retry sync result
      if (result.failed > 0) {
        auditSyncFailed(result.succeeded, result.failed, syncErrors).catch(() => {});
      } else {
        auditSyncAttempted(result.succeeded, 0).catch(() => {});
      }
    } catch (err) {
      set({ syncStatus: 'failed', isSyncing: false });
      auditSyncFailed(0, 1, ['Retry unknown error']).catch(() => {});
    }
  },

  triggerForceFailSync: async () => {
    if (get().isSyncing) return;
    setForceNextFailure(true);
    return get().triggerSync();
  },

  loadSyncStatus: async () => {
    try {
      const state = await loadSyncState();
      const lastSync = await getSetting('last_sync_at');
      const failedCount = await getFailedCount();
      // Derive sync status from pending + failed count
      const totalUnsynced = state.pendingCount + failedCount;
      const status: SyncStatus = totalUnsynced > 0 ? 'pending_sync' : 'offline';
      set({
        syncStatus: status,
        syncItemsReady: state.pendingCount,
        syncFailedCount: failedCount,
        lastSyncTime: lastSync,
      });
    } catch {
      // DB not ready yet
    }
  },

  // Collection — in-memory (session-scoped input state)
  collectionAmount: '',
  setCollectionAmount: (amount) => set({ collectionAmount: amount }),

  // Receipt
  receiptStatus: 'saved-offline',
  setReceiptStatus: (status) => set({ receiptStatus: status }),
  receiptId: '',
  setReceiptId: (id) => set({ receiptId: id }),
  lastCollectionId: null,
  setLastCollectionId: (id) => set({ lastCollectionId: id }),
  lastReceiptAmount: 0,
  setLastReceiptAmount: (amount) => set({ lastReceiptAmount: amount }),

  // Hydration — restore persisted settings from SQLite on app start
  hydrateFromDb: async () => {
    try {
      // Restore language
      const savedLang = await getSetting('language');
      if (savedLang === 'ne' || savedLang === 'en') {
        set({ language: savedLang as Language });
      }

      // Restore day started status
      const dayStarted = await getSetting('day_started');
      if (dayStarted === 'true') {
        const dayStartedAt = await getSetting('day_started_at');
        if (dayStartedAt) {
          // Check if it's the same day
          const startedDate = new Date(dayStartedAt);
          const today = new Date();
          const sameDay =
            startedDate.getFullYear() === today.getFullYear() &&
            startedDate.getMonth() === today.getMonth() &&
            startedDate.getDate() === today.getDate();
          // Don't restore a day the officer already ended via EOD today.
          const eodAt = await getSetting('eod_ended_at');
          const endedToday = eodAt
            ? (() => { const e = new Date(eodAt); return e.getFullYear() === today.getFullYear() && e.getMonth() === today.getMonth() && e.getDate() === today.getDate(); })()
            : false;
          if (sameDay && !endedToday) {
            const timeStr = startedDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            set({ dayStarted: true, dayVerifiedAt: timeStr });
          } else {
            // New day, or day already ended → reset
            await setSetting('day_started', 'false', 'boolean');
          }
        }
      }

      // Load sync status from real queue
      await get().loadSyncStatus();

      set({ hydrated: true });
    } catch (error) {
      console.warn('Failed to hydrate from DB:', error);
      set({ hydrated: true });
    }
  },
}));
