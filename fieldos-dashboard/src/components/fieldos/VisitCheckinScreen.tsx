'use client';

import React, { useState } from 'react';
import {
  MapPin, Clock, CheckCircle, Users, FileText, Calendar,
  AlertCircle, Shield, Camera
} from 'lucide-react';
import { useFieldOSStore } from '@/store/fieldos-store';
import {
  AppHeader, BottomNav, StatusChip, PrimaryButton,
  PrivacyNoteCard, colors
} from './shared';

const VISIT_PURPOSES = [
  { key: 'collection', label: 'Collection', labelNe: 'संकलन', icon: '💰' },
  { key: 'follow-up', label: 'Follow-up', labelNe: 'फलो-अप', icon: '🔄' },
  { key: 'kyc', label: 'KYC/Document', labelNe: 'केवाईसी/कागजात', icon: '📋' },
  { key: 'meeting', label: 'Center Meeting', labelNe: 'केन्द्र बैठक', icon: '👥' },
  { key: 'complaint', label: 'Complaint/Support', labelNe: 'गुनासो/समर्थन', icon: '💬' },
  { key: 'other', label: 'Other', labelNe: 'अन्य', icon: '📝' },
];

export function VisitCheckinScreen() {
  const { selectedClient, navigate, goBack, language } = useFieldOSStore();
  const isNe = language === 'ne';
  const [selectedPurpose, setSelectedPurpose] = useState('collection');
  const [checkedIn, setCheckedIn] = useState(false);

  const client = selectedClient || { id: 'M-1042', name: 'Sunita Kumari Chaudhary', memberId: 'M-1042' };

  const handleCheckIn = () => {
    setCheckedIn(true);
    setTimeout(() => navigate('record-collection'), 2000);
  };

  return (
    <div className="flex flex-col min-h-full bg-[#F8FAFC]">
      <AppHeader title={isNe ? 'भेट चेक-इन' : 'Visit Check-in'} showBack />

      <div className="flex-1 px-4 py-3 space-y-3 overflow-y-auto pb-20">
        {checkedIn ? (
          /* ─── Success State ─── */
          <div className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: colors.greenLight }}>
              <CheckCircle size={40} style={{ color: colors.green }} />
            </div>
            <h3 className="text-base font-bold text-gray-800 mb-1">{isNe ? 'चेक-इन सफल!' : 'Check-in Successful!'}</h3>
            <p className="text-xs text-gray-500 text-center mb-4">
              {isNe ? 'आधिकारिक भेट रेकर्ड गरियो' : 'Official visit has been recorded'}
            </p>
            <StatusChip label={isNe ? 'स्थानीय रूपमा बचाइयो' : 'Saved Offline'} variant="saved" />
            <div className="mt-6 flex items-center gap-2 text-[10px] text-gray-400">
              <MapPin size={12} />
              {isNe ? 'GPS लग गरियो · वार्ड ७, बुटवल' : 'GPS logged · Ward 7, Butwal'}
            </div>
            <div className="flex items-center gap-2 text-[10px] text-gray-400 mt-1">
              <Clock size={12} />
              {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} · {new Date().toLocaleDateString()}
            </div>
          </div>
        ) : (
          <>
            {/* Client summary */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: colors.navy }}>
                  {client.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-800">{client.name}</p>
                  <p className="text-[10px] text-gray-500">{client.memberId} · {isNe ? 'जनकपुर केन्द्र' : 'Janakpur Center'}</p>
                </div>
              </div>
            </div>

            {/* Visit purpose */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
              <h3 className="text-xs font-bold text-gray-700 mb-3">{isNe ? 'भेटको उद्देश्य' : 'Visit Purpose'}</h3>
              <div className="grid grid-cols-2 gap-2">
                {VISIT_PURPOSES.map(p => (
                  <button
                    key={p.key}
                    onClick={() => setSelectedPurpose(p.key)}
                    className="flex items-center gap-2 p-2.5 rounded-xl border transition-all"
                    style={{
                      borderColor: selectedPurpose === p.key ? colors.navy : colors.gray200,
                      background: selectedPurpose === p.key ? colors.navyBg : 'white',
                    }}
                  >
                    <span className="text-sm">{p.icon}</span>
                    <span className="text-[10px] font-semibold" style={{ color: selectedPurpose === p.key ? colors.navy : colors.gray600 }}>
                      {isNe ? p.labelNe : p.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* GPS Map preview */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
              <h3 className="text-xs font-bold text-gray-700 mb-2">{isNe ? 'स्थान' : 'Location'}</h3>
              <div className="rounded-xl h-28 flex items-center justify-center border border-gray-200 overflow-hidden" style={{ background: colors.navyBg }}>
                <div className="text-center">
                  <MapPin size={24} className="mx-auto mb-1" style={{ color: colors.navy }} />
                  <p className="text-[10px] font-medium" style={{ color: colors.navy }}>{isNe ? 'वार्ड ७, बुटवल' : 'Ward 7, Butwal'}</p>
                  <p className="text-[9px] text-gray-400">27.7103° N, 83.4567° E</p>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <StatusChip label={isNe ? 'GPS लक गरियो' : 'GPS Locked'} variant="verified" />
                <StatusChip label={isNe ? 'सटीक' : 'Accurate'} variant="success" />
              </div>
            </div>

            {/* Timestamp */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
              <div className="flex items-center gap-2">
                <Clock size={14} style={{ color: colors.navy }} />
                <span className="text-[11px] text-gray-600">
                  {new Date().toLocaleString('en-US', {
                    weekday: 'short', month: 'short', day: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              </div>
            </div>

            {/* Privacy note */}
            <PrivacyNoteCard />

            {/* Buttons */}
            <div className="space-y-2 pt-1">
              <PrimaryButton onClick={handleCheckIn} icon={CheckCircle}>
                {isNe ? 'चेक-इन पुष्टि गर्नुहोस्' : 'Confirm Check-in'}
              </PrimaryButton>
              <button
                onClick={goBack}
                className="w-full py-3 rounded-xl text-sm font-semibold text-gray-500 hover:bg-gray-100 transition-colors"
              >
                {isNe ? 'रद्द गर्नुहोस्' : 'Cancel'}
              </button>
            </div>
          </>
        )}
      </div>

      <BottomNav activeTab="due-collections" />
    </div>
  );
}

