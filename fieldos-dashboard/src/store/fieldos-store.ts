import { create } from 'zustand';

export type ScreenName =
  | 'login'
  | 'dashboard'
  | 'due-collections'
  | 'client-detail'
  | 'visit-checkin'
  | 'record-collection'
  | 'digital-receipt'
  | 'promise-to-pay'
  | 'center-meeting'
  | 'end-of-day'
  | 'sync-center'
  | 'notifications'
  | 'profile';

export type FaceVerificationContext = 'start-day' | 'submit-report' | 'high-value-collection';

interface FieldOSState {
  currentScreen: ScreenName;
  screenHistory: ScreenName[];
  navigate: (screen: ScreenName) => void;
  goBack: () => void;

  dayStarted: boolean;
  dayVerifiedAt: string | null;
  startDay: () => void;

  showFaceVerification: boolean;
  faceVerificationContext: FaceVerificationContext | null;
  faceVerificationStatus: 'idle' | 'looking' | 'detected' | 'verifying' | 'verified' | 'failed';
  openFaceVerification: (context: FaceVerificationContext) => void;
  closeFaceVerification: () => void;
  setFaceVerificationStatus: (status: FieldOSState['faceVerificationStatus']) => void;
  completeFaceVerification: () => void;

  language: 'en' | 'ne';
  toggleLanguage: () => void;

  showPassword: boolean;
  togglePassword: () => void;

  selectedClient: { id: string; name: string; memberId: string } | null;
  setSelectedClient: (client: { id: string; name: string; memberId: string } | null) => void;

  activeFilter: string;
  setActiveFilter: (filter: string) => void;

  notificationFilter: string;
  setNotificationFilter: (filter: string) => void;

  syncStatus: 'offline' | 'online' | 'syncing' | 'synced' | 'failed';
  syncItemsReady: number;
  triggerSync: () => void;

  collectionAmount: string;
  setCollectionAmount: (amount: string) => void;

  receiptStatus: 'saved-offline' | 'pending-sync' | 'pending-verification' | 'confirmed';
  receiptId: string;
  setReceiptId: (id: string) => void;
  lastReceiptAmount: number;
  setLastReceiptAmount: (amount: number) => void;
}

export const useFieldOSStore = create<FieldOSState>((set, get) => ({
  currentScreen: 'login',
  screenHistory: [],
  navigate: (screen) => {
    const { currentScreen, screenHistory } = get();
    set({
      currentScreen: screen,
      screenHistory: [...screenHistory, currentScreen],
    });
  },
  goBack: () => {
    const { screenHistory } = get();
    if (screenHistory.length > 0) {
      const prev = screenHistory[screenHistory.length - 1];
      set({
        currentScreen: prev,
        screenHistory: screenHistory.slice(0, -1),
      });
    }
  },

  dayStarted: false,
  dayVerifiedAt: null,
  startDay: () => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    set({ dayStarted: true, dayVerifiedAt: timeStr, showFaceVerification: false });
  },

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
      set({ currentScreen: 'dashboard', showFaceVerification: false });
    } else if (faceVerificationContext === 'submit-report') {
      set({ showFaceVerification: false, currentScreen: 'dashboard' });
    } else if (faceVerificationContext === 'high-value-collection') {
      set({ showFaceVerification: false, currentScreen: 'digital-receipt', receiptStatus: 'saved-offline', receiptId: `RC-${Date.now().toString(36).toUpperCase()}` });
    }
  },

  language: 'en',
  toggleLanguage: () => set((s) => ({ language: s.language === 'en' ? 'ne' : 'en' })),
  showPassword: false,
  togglePassword: () => set((s) => ({ showPassword: !s.showPassword })),

  selectedClient: null,
  setSelectedClient: (client) => set({ selectedClient: client }),
  activeFilter: 'all',
  setActiveFilter: (filter) => set({ activeFilter: filter }),
  notificationFilter: 'all',
  setNotificationFilter: (filter) => set({ notificationFilter: filter }),

  syncStatus: 'offline',
  syncItemsReady: 12,
  triggerSync: () => {
    set({ syncStatus: 'syncing' });
    setTimeout(() => set({ syncStatus: 'synced', syncItemsReady: 0 }), 3000);
  },

  collectionAmount: '',
  setCollectionAmount: (amount) => set({ collectionAmount: amount }),
  receiptStatus: 'saved-offline',
  receiptId: `RC-${Date.now().toString(36).toUpperCase()}`,
  setReceiptId: (id) => set({ receiptId: id }),
  lastReceiptAmount: 0,
  setLastReceiptAmount: (amount) => set({ lastReceiptAmount: amount }),
}));
