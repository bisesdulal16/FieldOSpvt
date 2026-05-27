'use client';

import React, { useState } from 'react';
import {
  Clock, Calendar, ChevronDown, ThumbsUp, ThumbsDown, Minus,
  CheckCircle, FileText, Bell, Shield, MapPin, Users, AlertTriangle
} from 'lucide-react';
import { useFieldOSStore } from '@/store/fieldos-store';
import {
  AppHeader, BottomNav, StatusChip, PrimaryButton,
  SecondaryButton, PrivacyNoteCard, colors
} from './shared';

const DATE_BUTTONS = [
  { key: 'today', label: 'Today', labelNe: 'आज' },
  { key: 'tomorrow', label: 'Tomorrow', labelNe: 'भोलि' },
  { key: '3days', label: '3 Days', labelNe: '३ दिन' },
  { key: 'next-meeting', label: 'Next Meeting', labelNe: 'अर्को बैठक' },
];

const REASONS = [
  { key: 'no-cash', label: 'No cash today', labelNe: 'आज कुनै नगद छैन' },
  { key: 'unavailable', label: 'Client unavailable', labelNe: 'क्लाइन्ट उपलब्ध छैन' },
  { key: 'business', label: 'Business issue', labelNe: 'व्यापार समस्या' },
  { key: 'health', label: 'Family/health issue', labelNe: 'परिवार/स्वास्थ्य समस्या' },
  { key: 'dispute', label: 'Dispute', labelNe: 'विवाद' },
  { key: 'migration', label: 'Migration/out of area', labelNe: 'प्रवास/क्षेत्र बाहिर' },
  { key: 'other', label: 'Other', labelNe: 'अन्य' },
];

export function PromiseToPayScreen() {
  const { selectedClient, navigate, goBack, language } = useFieldOSStore();
  const isNe = language === 'ne';
  const [selectedDate, setSelectedDate] = useState('today');
  const [selectedReason, setSelectedReason] = useState('');
  const [confidence, setConfidence] = useState<'high' | 'medium' | 'low'>('medium');
  const [confirmed, setConfirmed] = useState(false);

  const client = selectedClient || { id: 'M-1042', name: 'Sunita Kumari Chaudhary', memberId: 'M-1042' };

  const handleConfirm = () => setConfirmed(true);

  return (
    <div className="flex flex-col min-h-full bg-[#F8FAFC]">
      <AppHeader title={isNe ? 'प्रतिबद्धता' : 'Promise-to-Pay'} showBack />

      <div className="flex-1 px-4 py-3 space-y-3 overflow-y-auto pb-20">
        {confirmed ? (
          /* ─── Success State ─── */
          <div className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: colors.greenLight }}>
              <CheckCircle size={40} style={{ color: colors.green }} />
            </div>
            <h3 className="text-base font-bold text-gray-800 mb-1">{isNe ? 'प्रतिबद्धता रेकर्ड भयो!' : 'Promise Recorded!'}</h3>
            <p className="text-xs text-gray-500 text-center mb-3">
              {isNe ? 'स्मरण रेकर्ड गरियो' : 'Reminder has been set'}
            </p>
            <StatusChip label={isNe ? 'पेन्डिङ सिंक' : 'Pending Sync'} variant="sync" />
            <div className="mt-4 space-y-1 text-[10px] text-gray-500 text-center">
              <p>NPR 5,500 — {isNe ? 'प्रतिबद्ध' : 'Promised'}</p>
              <p className="flex items-center justify-center gap-1">
                <Calendar size={10} />
                {isNe ? 'आज' : 'Today'}
              </p>
            </div>
            <div className="mt-6 space-y-2 w-full px-4">
              <PrimaryButton onClick={() => navigate('due-collections')}>
                {isNe ? 'कार्यहरूमा फर्कनुहोस्' : 'Return to Tasks'}
              </PrimaryButton>
              <button
                onClick={goBack}
                className="w-full py-2.5 rounded-xl text-xs font-semibold text-gray-500 hover:bg-gray-100 transition-colors"
              >
                {isNe ? 'क्लाइन्ट विवरण' : 'View Client'}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Client summary */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: colors.navy }}>
                  {client.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
                </div>
                <div className="flex-1">
                  <p className="text-xs font-semibold text-gray-800">{client.name}</p>
                  <p className="text-[10px] text-gray-500">{client.memberId} · {isNe ? 'जनकपुर केन्द्र' : 'Janakpur Center'}</p>
                </div>
                <StatusChip label={isNe ? 'अतिरिक्त' : '8 Days Overdue'} variant="overdue" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-gray-500">{isNe ? 'बाँकी रकम' : 'Outstanding'}</span>
                <span className="text-sm font-bold" style={{ color: colors.red }}>NPR 45,000</span>
              </div>
            </div>

            {/* Promised amount */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
              <h3 className="text-xs font-bold text-gray-700 mb-2">{isNe ? 'प्रतिबद्ध रकम *' : 'Promised Amount *'}</h3>
              <div className="flex items-center gap-2 rounded-xl px-3 py-3 border border-gray-200 bg-gray-50">
                <span className="text-sm font-medium text-gray-400">NPR</span>
                <span className="text-lg font-bold flex-1" style={{ color: colors.navy }}>5,500</span>
              </div>
            </div>

            {/* Expected payment date */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
              <h3 className="text-xs font-bold text-gray-700 mb-2">{isNe ? 'अपेक्षित भुक्तानी मिति' : 'Expected Payment Date'}</h3>
              <div className="grid grid-cols-2 gap-2">
                {DATE_BUTTONS.map(d => (
                  <button
                    key={d.key}
                    onClick={() => setSelectedDate(d.key)}
                    className="py-2 rounded-xl text-[10px] font-semibold border transition-all"
                    style={{
                      background: selectedDate === d.key ? colors.navy : 'white',
                      color: selectedDate === d.key ? 'white' : colors.gray600,
                      borderColor: selectedDate === d.key ? colors.navy : colors.gray200,
                    }}
                  >
                    {isNe ? d.labelNe : d.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Reason for delay */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
              <h3 className="text-xs font-bold text-gray-700 mb-2">{isNe ? 'विलम्बको कारण' : 'Reason for Delay'}</h3>
              <div className="space-y-1.5">
                {REASONS.map(r => (
                  <button
                    key={r.key}
                    onClick={() => setSelectedReason(r.key)}
                    className="w-full flex items-center gap-2 p-2 rounded-xl border transition-all text-left"
                    style={{
                      borderColor: selectedReason === r.key ? colors.navy : colors.gray100,
                      background: selectedReason === r.key ? colors.navyBg : 'white',
                    }}
                  >
                    <div className="w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0"
                      style={{
                        borderColor: selectedReason === r.key ? colors.navy : colors.gray300,
                        background: selectedReason === r.key ? colors.navy : 'transparent',
                      }}
                    >
                      {selectedReason === r.key && <CheckCircle size={10} className="text-white" />}
                    </div>
                    <span className="text-[11px] font-medium" style={{ color: selectedReason === r.key ? colors.navy : colors.gray600 }}>
                      {isNe ? r.labelNe : r.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Confidence */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
              <h3 className="text-xs font-bold text-gray-700 mb-2">{isNe ? 'विश्वास' : 'Confidence'}</h3>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { key: 'high' as const, label: isNe ? 'उच्च' : 'High', icon: ThumbsUp, color: colors.green },
                  { key: 'medium' as const, label: isNe ? 'मध्यम' : 'Medium', icon: Minus, color: colors.orange },
                  { key: 'low' as const, label: isNe ? 'न्यून' : 'Low', icon: ThumbsDown, color: colors.red },
                ].map(c => (
                  <button
                    key={c.key}
                    onClick={() => setConfidence(c.key)}
                    className="flex flex-col items-center gap-1 py-2 rounded-xl border transition-all"
                    style={{
                      borderColor: confidence === c.key ? c.color : colors.gray200,
                      background: confidence === c.key ? `${c.color}15` : 'white',
                    }}
                  >
                    <c.icon size={16} style={{ color: confidence === c.key ? c.color : colors.gray400 }} />
                    <span className="text-[10px] font-semibold" style={{ color: confidence === c.key ? c.color : colors.gray500 }}>
                      {c.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Reminder preview */}
            <div className="rounded-xl p-3 border border-blue-200" style={{ background: colors.navyBg }}>
              <div className="flex items-center gap-2">
                <Bell size={14} style={{ color: colors.navy }} />
                <span className="text-[10px] font-medium" style={{ color: colors.navy }}>
                  {isNe ? 'स्मरण पूर्वावलोकन: आज NPR 5,500 संकलन गर्नुहोस्' : 'Reminder Preview: Collect NPR 5,500 today'}
                </span>
              </div>
            </div>

            {/* Buttons */}
            <div className="space-y-2 pt-1">
              <PrimaryButton onClick={handleConfirm} icon={CheckCircle}>
                {isNe ? 'प्रतिबद्धता पुष्टि गर्नुहोस्' : 'Confirm Promise'}
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

      <BottomNav activeTab="record-collection" />
    </div>
  );
}

