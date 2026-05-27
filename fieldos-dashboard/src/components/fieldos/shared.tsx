'use client';

import React from 'react';
import {
  Home, ClipboardList, Wallet, Users, UserCircle,
  ArrowLeft, Shield, ShieldCheck, Lock, Eye, EyeOff,
  Fingerprint, ChevronRight, Bell, Wifi, WifiOff, Cloud,
  CloudOff, CheckCircle, AlertTriangle, Clock, MapPin,
  Star, Sparkles, Camera, RefreshCw, X, ChevronDown,
  Phone, FileText, Calendar, Flag, Info, CircleDot
} from 'lucide-react';
import { useFieldOSStore, type ScreenName } from '@/store/fieldos-store';

// ─── Design Tokens ───────────────────────────────────────────────
export const colors = {
  navy: '#1E3A8A',
  navyLight: '#2563EB',
  navyDark: '#1A365D',
  navyBg: '#EFF6FF',
  orange: '#F97316',
  orangeLight: '#FFF7ED',
  orangeBorder: '#FDBA74',
  green: '#10B981',
  greenLight: '#ECFDF5',
  greenBorder: '#6EE7B7',
  red: '#EF4444',
  redLight: '#FEF2F2',
  redBorder: '#FCA5A5',
  bg: '#F8FAFC',
  white: '#FFFFFF',
  gray50: '#F9FAFB',
  gray100: '#F3F4F6',
  gray200: '#E5E7EB',
  gray300: '#D1D5DB',
  gray400: '#9CA3AF',
  gray500: '#6B7280',
  gray600: '#4B5563',
  gray700: '#374151',
  gray800: '#1F2937',
  gray900: '#111827',
};

// ─── AppHeader ───────────────────────────────────────────────────
export function AppHeader({ title, showBack, rightAction, hideNav }: {
  title: string;
  showBack?: boolean;
  rightAction?: React.ReactNode;
  hideNav?: boolean;
}) {
  const { goBack, toggleLanguage, language } = useFieldOSStore();
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100">
      <div className="flex items-center gap-2 flex-1">
        {showBack && (
          <button onClick={goBack} className="p-1 -ml-1 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition-colors">
            <ArrowLeft size={20} className="text-gray-700" />
          </button>
        )}
        {!showBack && (
          <div className="flex items-center gap-1.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: colors.navy }}>
              <span className="text-white text-xs font-bold">F</span>
            </div>
            <span className="text-sm font-bold" style={{ color: colors.navy }}>FieldOS</span>
            <span className="text-xs font-semibold" style={{ color: colors.orange }}>NEPAL</span>
          </div>
        )}
        {showBack && <span className="font-semibold text-gray-800 text-sm">{title}</span>}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={toggleLanguage}
          className="text-[10px] px-2 py-1 rounded-full border transition-colors"
          style={{
            borderColor: language === 'en' ? colors.navy : colors.gray300,
            color: language === 'en' ? colors.navy : colors.gray400,
            background: language === 'en' ? colors.navyBg : 'transparent',
          }}
        >
          {language === 'en' ? 'EN' : 'ने'} | {language === 'en' ? 'ने' : 'EN'}
        </button>
        {rightAction}
      </div>
    </div>
  );
}

// ─── BottomNav ───────────────────────────────────────────────────
export function BottomNav({ activeTab }: { activeTab?: ScreenName }) {
  const { navigate, currentScreen, dayStarted } = useFieldOSStore();

  const tabs = [
    { id: 'dashboard' as ScreenName, label: 'Home', icon: Home },
    { id: 'due-collections' as ScreenName, label: 'Tasks', icon: ClipboardList },
    { id: 'record-collection' as ScreenName, label: 'Collect', icon: Wallet },
    { id: 'center-meeting' as ScreenName, label: 'Meet', icon: Users },
    { id: 'profile' as ScreenName, label: 'Profile', icon: UserCircle },
  ];

  const isActive = (id: ScreenName) => {
    if (id === 'dashboard') return currentScreen === 'dashboard';
    if (id === 'due-collections') return currentScreen === 'due-collections' || currentScreen === 'client-detail' || currentScreen === 'visit-checkin';
    if (id === 'record-collection') return currentScreen === 'record-collection' || currentScreen === 'digital-receipt' || currentScreen === 'promise-to-pay';
    if (id === 'center-meeting') return currentScreen === 'center-meeting';
    if (id === 'profile') return currentScreen === 'profile';
    return false;
  };

  return (
    <div className="flex items-center justify-around bg-white border-t border-gray-100 px-1 pt-1 pb-1">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = isActive(tab.id);
        return (
          <button
            key={tab.id}
            onClick={() => navigate(tab.id)}
            className="flex flex-col items-center gap-0.5 py-1.5 px-3 rounded-lg transition-colors min-w-[56px]"
            style={{
              color: active ? colors.navy : colors.gray400,
              background: active ? colors.navyBg : 'transparent',
            }}
          >
            <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
            <span className="text-[10px] font-medium">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── StatusChip ──────────────────────────────────────────────────
export function StatusChip({ label, variant }: { label: string; variant: 'overdue' | 'due-today' | 'promise' | 'high-value' | 'sync' | 'verified' | 'absent' | 'present' | 'paid' | 'follow-up' | 'success' | 'warning' | 'info' | 'saved' }) {
  const styles: Record<string, { bg: string; color: string; border: string }> = {
    overdue: { bg: colors.redLight, color: colors.red, border: colors.redBorder },
    'due-today': { bg: colors.orangeLight, color: colors.orange, border: colors.orangeBorder },
    promise: { bg: '#FEF3C7', color: '#D97706', border: '#FCD34D' },
    'high-value': { bg: '#EDE9FE', color: '#7C3AED', border: '#C4B5FD' },
    sync: { bg: colors.greenLight, color: colors.green, border: colors.greenBorder },
    verified: { bg: colors.greenLight, color: colors.green, border: colors.greenBorder },
    absent: { bg: colors.redLight, color: colors.red, border: colors.redBorder },
    present: { bg: colors.greenLight, color: colors.green, border: colors.greenBorder },
    paid: { bg: colors.greenLight, color: colors.green, border: colors.greenBorder },
    'follow-up': { bg: colors.orangeLight, color: colors.orange, border: colors.orangeBorder },
    success: { bg: colors.greenLight, color: colors.green, border: colors.greenBorder },
    warning: { bg: colors.orangeLight, color: colors.orange, border: colors.orangeBorder },
    info: { bg: colors.navyBg, color: colors.navy, border: '#93C5FD' },
    saved: { bg: '#E0F2FE', color: '#0284C7', border: '#7DD3FC' },
  };
  const s = styles[variant] || styles.info;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold leading-tight border"
      style={{ background: s.bg, color: s.color, borderColor: s.border }}
    >
      {label}
    </span>
  );
}

// ─── SecurityTrustCard ───────────────────────────────────────────
export function SecurityTrustCard() {
  return (
    <div className="rounded-xl p-3 border border-green-200" style={{ background: colors.greenLight }}>
      <div className="flex items-start gap-2.5">
        <ShieldCheck size={18} className="mt-0.5 flex-shrink-0" style={{ color: colors.green }} />
        <div className="space-y-1">
          <p className="text-[11px] font-semibold" style={{ color: '#065F46' }}>Secure Connection</p>
          <p className="text-[10px]" style={{ color: '#047857' }}>Offline data is encrypted on this device</p>
          <p className="text-[10px]" style={{ color: '#047857' }}>This device is authorized for staff access</p>
        </div>
      </div>
    </div>
  );
}

// ─── PrivacyNoteCard ─────────────────────────────────────────────
export function PrivacyNoteCard() {
  return (
    <div className="rounded-xl p-3 border border-gray-200 bg-gray-50">
      <div className="flex items-start gap-2">
        <Info size={14} className="mt-0.5 flex-shrink-0 text-gray-400" />
        <div className="space-y-0.5">
          <p className="text-[10px] text-gray-500">Only official visit check-ins are recorded.</p>
          <p className="text-[10px] text-gray-500">Full-day live tracking is not used.</p>
        </div>
      </div>
    </div>
  );
}

// ─── AIRecommendationCard ────────────────────────────────────────
export function AIRecommendationCard({ title, reason, clientName, action, onAction }: {
  title: string;
  reason: string;
  clientName?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="rounded-xl p-3 border border-blue-200" style={{ background: colors.navyBg }}>
      <div className="flex items-start gap-2.5">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: colors.navy }}>
          <Sparkles size={14} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold" style={{ color: colors.navy }}>{title}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">{reason}</p>
          {clientName && <p className="text-[11px] font-medium mt-1" style={{ color: colors.navyDark }}>{clientName}</p>}
          {action && (
            <button
              onClick={onAction}
              className="mt-2 text-[10px] font-semibold px-3 py-1.5 rounded-lg text-white transition-colors"
              style={{ background: colors.navy }}
            >
              {action}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── SyncChip ────────────────────────────────────────────────────
export function SyncChip({ status }: { status: 'offline' | 'online' | 'syncing' | 'synced' | 'failed' }) {
  const config = {
    offline: { icon: WifiOff, label: 'Offline Ready', color: colors.orange, bg: colors.orangeLight },
    online: { icon: Wifi, label: 'Online', color: colors.green, bg: colors.greenLight },
    syncing: { icon: RefreshCw, label: 'Syncing...', color: colors.navy, bg: colors.navyBg },
    synced: { icon: CheckCircle, label: 'All Synced', color: colors.green, bg: colors.greenLight },
    failed: { icon: CloudOff, label: 'Sync Failed', color: colors.red, bg: colors.redLight },
  };
  const c = config[status];
  const Icon = c.icon;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ background: c.bg, color: c.color }}
    >
      <Icon size={10} className={status === 'syncing' ? 'animate-spin' : ''} />
      {c.label}
    </span>
  );
}

// ─── PrimaryButton ───────────────────────────────────────────────
export function PrimaryButton({ children, onClick, className = '', icon: Icon }: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  icon?: React.ElementType;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white transition-all active:scale-[0.98] ${className}`}
      style={{ background: colors.navy }}
    >
      {Icon && <Icon size={18} />}
      {children}
    </button>
  );
}

// ─── SecondaryButton ─────────────────────────────────────────────
export function SecondaryButton({ children, onClick, className = '', icon: Icon }: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  icon?: React.ElementType;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold border transition-all active:scale-[0.98] ${className}`}
      style={{ borderColor: colors.navy, color: colors.navy, background: 'white' }}
    >
      {Icon && <Icon size={18} />}
      {children}
    </button>
  );
}

// ─── SummaryCard ─────────────────────────────────────────────────
export function SummaryCard({ label, value, icon: Icon, color, subtext }: {
  label: string;
  value: string;
  icon: React.ElementType;
  color: string;
  subtext?: string;
}) {
  return (
    <div className="bg-white rounded-xl p-3 border border-gray-100 flex flex-col items-center text-center gap-1 shadow-sm">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${color}15` }}>
        <Icon size={18} style={{ color }} />
      </div>
      <span className="text-base font-bold text-gray-800">{value}</span>
      <span className="text-[10px] text-gray-500 leading-tight">{label}</span>
      {subtext && <span className="text-[9px] text-gray-400">{subtext}</span>}
    </div>
  );
}

// ─── FaceVerificationModal ───────────────────────────────────────
export function FaceVerificationModal() {
  const { showFaceVerification, faceVerificationStatus, faceVerificationContext, completeFaceVerification, closeFaceVerification, setFaceVerificationStatus } = useFieldOSStore();

  if (!showFaceVerification) return null;

  const contextText: Record<string, string> = {
    'start-day': 'Required for Start Day',
    'submit-report': 'Required for Report Submission',
    'high-value-collection': 'Required for High-Value Collection',
  };

  const statusText: Record<string, string> = {
    idle: 'Initializing camera...',
    looking: 'Looking for face...',
    detected: 'Face detected',
    verifying: 'Verifying identity...',
    verified: 'Identity verified',
    failed: 'Verification failed',
  };

  const handleTryAgain = () => {
    setFaceVerificationStatus('looking');
    setTimeout(() => setFaceVerificationStatus('detected'), 1500);
    setTimeout(() => setFaceVerificationStatus('verifying'), 2500);
    setTimeout(() => setFaceVerificationStatus('verified'), 4000);
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-white">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <button onClick={closeFaceVerification} className="p-1 rounded-lg hover:bg-gray-100">
          <X size={20} className="text-gray-600" />
        </button>
        <span className="text-sm font-semibold text-gray-800">Verify Identity</span>
        <div className="w-7" />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-4">
        {/* Camera frame */}
        <div className="relative w-52 h-52 mb-6">
          <div className="w-full h-full rounded-[50%] border-4 border-dashed flex items-center justify-center transition-colors duration-500"
            style={{
              borderColor: faceVerificationStatus === 'verified' ? colors.green :
                faceVerificationStatus === 'failed' ? colors.red :
                faceVerificationStatus === 'verifying' ? colors.navyLight :
                colors.gray300,
            }}
          >
            <div className="w-40 h-40 rounded-[50%] flex items-center justify-center transition-colors duration-500"
              style={{
                background: faceVerificationStatus === 'verified' ? `${colors.green}20` :
                  faceVerificationStatus === 'failed' ? `${colors.red}20` :
                  faceVerificationStatus === 'verifying' ? `${colors.navy}10` :
                  colors.gray100,
              }}
            >
              {faceVerificationStatus === 'verified' ? (
                <CheckCircle size={48} className="text-green-500" />
              ) : faceVerificationStatus === 'failed' ? (
                <AlertTriangle size={48} className="text-red-500" />
              ) : (
                <Camera size={36} className={faceVerificationStatus === 'verifying' ? 'text-blue-600 animate-pulse' : 'text-gray-300'} />
              )}
            </div>
          </div>
          {faceVerificationStatus === 'verifying' && (
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2">
              <RefreshCw size={16} className="animate-spin" style={{ color: colors.navy }} />
            </div>
          )}
        </div>

        <h3 className="text-lg font-bold text-gray-800 mb-1">Face Verification</h3>
        <p className="text-xs text-gray-500 text-center mb-1">Please look at the camera to continue</p>
        <p className="text-[10px] font-medium mb-4" style={{ color: colors.navy }}>{contextText[faceVerificationContext || 'start-day']}</p>

        <StatusChip
          label={statusText[faceVerificationStatus]}
          variant={faceVerificationStatus === 'verified' ? 'success' : faceVerificationStatus === 'failed' ? 'warning' : 'info'}
        />

        {/* Privacy note */}
        <div className="mt-6 rounded-lg p-2.5 border border-gray-200 bg-gray-50 max-w-[280px]">
          <div className="flex items-start gap-2">
            <Info size={12} className="mt-0.5 text-gray-400 flex-shrink-0" />
            <div className="space-y-0.5">
              <p className="text-[9px] text-gray-500">Face verification is used only for identity confirmation.</p>
              <p className="text-[9px] text-gray-500">Full-day camera monitoring is not used.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Buttons */}
      <div className="px-4 pb-6 space-y-2">
        {faceVerificationStatus === 'verified' ? (
          <>
            <PrimaryButton onClick={completeFaceVerification} icon={CheckCircle}>
              Continue
            </PrimaryButton>
          </>
        ) : faceVerificationStatus === 'failed' ? (
          <>
            <PrimaryButton onClick={handleTryAgain} icon={RefreshCw}>
              Try Again
            </PrimaryButton>
            <SecondaryButton onClick={closeFaceVerification} icon={Lock}>
              Use Security PIN Instead
            </SecondaryButton>
          </>
        ) : (
          <>
            <PrimaryButton onClick={() => setFaceVerificationStatus('verifying')} icon={Camera}>
              Verify Now
            </PrimaryButton>
            <SecondaryButton onClick={closeFaceVerification} icon={Lock}>
              Use Security PIN Instead
            </SecondaryButton>
          </>
        )}
      </div>
    </div>
  );
}

// ─── ClientTaskCard ──────────────────────────────────────────────
export function ClientTaskCard({ name, memberId, center, ward, dueAmount, status, statusLabel, reason, onStartVisit, onCollect }: {
  name: string;
  memberId: string;
  center: string;
  ward: string;
  dueAmount: string;
  status: 'overdue' | 'due-today' | 'promise' | 'high-value' | 'sync';
  statusLabel: string;
  reason: string;
  onStartVisit?: () => void;
  onCollect?: () => void;
}) {
  const { navigate, setSelectedClient } = useFieldOSStore();

  const handleCardClick = () => {
    setSelectedClient({ id: memberId, name, memberId });
    navigate('client-detail');
  };

  return (
    <div
      onClick={handleCardClick}
      className="bg-white rounded-xl p-3 border border-gray-100 shadow-sm cursor-pointer active:scale-[0.99] transition-transform"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white" style={{ background: colors.navy }}>
            {name.split(' ').map(n => n[0]).slice(0, 2).join('')}
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-800">{name}</p>
            <p className="text-[10px] text-gray-400">{memberId}</p>
          </div>
        </div>
        <StatusChip label={statusLabel} variant={status} />
      </div>
      <div className="flex items-center gap-3 mb-2 text-[10px] text-gray-500">
        <span className="flex items-center gap-1"><Users size={10} />{center}</span>
        <span className="flex items-center gap-1"><MapPin size={10} />{ward}</span>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-bold" style={{ color: status === 'overdue' ? colors.red : colors.gray800 }}>{dueAmount}</span>
          <p className="text-[9px] text-gray-400 mt-0.5">{reason}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={(e) => { e.stopPropagation(); onStartVisit?.(); }}
            className="px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border transition-colors"
            style={{ borderColor: colors.navy, color: colors.navy }}
          >
            <span className="flex items-center gap-1"><MapPin size={10} /> Visit</span>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onCollect?.(); }}
            className="px-2.5 py-1.5 rounded-lg text-[10px] font-semibold text-white transition-colors"
            style={{ background: colors.navy }}
          >
            <span className="flex items-center gap-1"><Wallet size={10} /> Collect</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── NotificationCard ────────────────────────────────────────────
export function NotificationCard({ icon: Icon, iconColor, title, description, time, action, actionLabel, onAction }: {
  icon: React.ElementType;
  iconColor: string;
  title: string;
  description: string;
  time: string;
  action?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="bg-white rounded-xl p-3 border border-gray-100 shadow-sm">
      <div className="flex items-start gap-2.5">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${iconColor}15` }}>
          <Icon size={16} style={{ color: iconColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] font-semibold text-gray-800">{title}</p>
            <span className="text-[9px] text-gray-400 flex-shrink-0">{time}</span>
          </div>
          <p className="text-[10px] text-gray-500 mt-0.5">{description}</p>
          {actionLabel && onAction && (
            <button
              onClick={onAction}
              className="mt-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-md transition-colors"
              style={{ background: `${iconColor}15`, color: iconColor }}
            >
              {actionLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── SectionHeader ───────────────────────────────────────────────
export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex items-center justify-between mb-2.5">
      <h3 className="text-xs font-bold text-gray-700">{title}</h3>
      {action && (
        <button onClick={onAction} className="text-[10px] font-semibold flex items-center gap-0.5" style={{ color: colors.navy }}>
          {action} <ChevronRight size={12} />
        </button>
      )}
    </div>
  );
}
