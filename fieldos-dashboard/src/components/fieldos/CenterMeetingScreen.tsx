'use client';

import React, { useState } from 'react';
import {
  Users, MapPin, Calendar, User, Wallet, CheckCircle, XCircle,
  AlertTriangle, FileText, Save, Cloud, Flag, UserPlus, Mic
} from 'lucide-react';
import { useFieldOSStore } from '@/store/fieldos-store';
import {
  AppHeader, BottomNav, StatusChip, PrimaryButton, SecondaryButton, colors
} from './shared';

const MEMBERS = [
  { name: 'Sunita Kumari Chaudhary', id: 'M-1042', status: 'present' },
  { name: 'Rita Maya Tamang', id: 'M-1056', status: 'present' },
  { name: 'Gita Kumari Gupta', id: 'M-1123', status: 'paid' },
  { name: 'Sita Devi Sah', id: 'M-1089', status: 'absent' },
  { name: 'Maya Devi Shrestha', id: 'M-1115', status: 'present' },
  { name: 'Kamala Rai', id: 'M-1035', status: 'paid' },
  { name: 'Bishnu Maya Kami', id: 'M-1048', status: 'follow-up' },
  { name: 'Anita Maharjan', id: 'M-1067', status: 'present' },
  { name: 'Sarita Tharu', id: 'M-1079', status: 'follow-up' },
  { name: 'Nirmala Devi Pun', id: 'M-1091', status: 'paid' },
  { name: 'Laxmi Poudel', id: 'M-1098', status: 'absent' },
  { name: 'Padma Kumari BK', id: 'M-1105', status: 'present' },
  { name: 'Hari Maya Damai', id: 'M-1112', status: 'follow-up' },
  { name: 'Sushila Tamang', id: 'M-1119', status: 'present' },
];

export function CenterMeetingScreen() {
  const { navigate, language } = useFieldOSStore();
  const isNe = language === 'ne';
  const [memberStatuses, setMemberStatuses] = useState(
    Object.fromEntries(MEMBERS.map(m => [m.id, m.status]))
  );
  const [completed, setCompleted] = useState(false);

  const updateStatus = (id: string, status: string) => {
    setMemberStatuses(prev => ({ ...prev, [id]: status }));
  };

  const markAllPresent = () => {
    setMemberStatuses(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => { if (next[k] === 'absent') next[k] = 'present'; });
      return next;
    });
  };

  const markUnpaidFollowup = () => {
    setMemberStatuses(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => { if (next[k] === 'present') next[k] = 'follow-up'; });
      return next;
    });
  };

  const stats = Object.values(memberStatuses);
  const presentCount = stats.filter(s => s === 'present').length;
  const paidCount = stats.filter(s => s === 'paid').length;
  const followupCount = stats.filter(s => s === 'follow-up').length;
  const totalCount = stats.length;

  const statusVariant = (s: string) => {
    if (s === 'present') return 'present' as const;
    if (s === 'paid') return 'paid' as const;
    if (s === 'absent') return 'absent' as const;
    return 'follow-up' as const;
  };

  const statusLabel = (s: string) => {
    if (s === 'present') return isNe ? 'उपस्थित' : 'Present';
    if (s === 'paid') return isNe ? 'भुक्तानी' : 'Paid';
    if (s === 'absent') return isNe ? 'अनुपस्थित' : 'Absent';
    return isNe ? 'फलो-अप' : 'Follow-up';
  };

  return (
    <div className="flex flex-col min-h-full bg-[#F8FAFC]">
      <AppHeader title={isNe ? 'केन्द्र बैठक' : 'Center Meeting'} />
      <div className="bg-white px-4 pb-3">
        <StatusChip label={isNe ? 'स्थानीय रूपमा बचाइयो' : 'Saved Offline'} variant="saved" />
      </div>

      <div className="flex-1 px-4 py-3 space-y-3 overflow-y-auto pb-20">
        {completed ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: colors.greenLight }}>
              <CheckCircle size={40} style={{ color: colors.green }} />
            </div>
            <h3 className="text-base font-bold text-gray-800 mb-1">{isNe ? 'बैठक पूरा भयो!' : 'Meeting Completed!'}</h3>
            <p className="text-xs text-gray-500 text-center mb-3">{isNe ? 'बैठक विवरण रेकर्ड गरियो' : 'Meeting details have been recorded'}</p>
            <StatusChip label={isNe ? 'पेन्डिङ सिंक' : 'Pending Sync'} variant="sync" />
            <div className="mt-6 w-full space-y-2 px-4">
              <PrimaryButton onClick={() => navigate('dashboard')}>
                {isNe ? 'ड्यासबोर्डमा फर्कनुहोस्' : 'Back to Dashboard'}
              </PrimaryButton>
              <SecondaryButton onClick={() => navigate('end-of-day')}>
                {isNe ? 'दिनको सारांश' : 'End-of-Day Summary'}
              </SecondaryButton>
            </div>
          </div>
        ) : (
          <>
            {/* Center info */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-gray-800">{isNe ? 'कालिका महिला केन्द्र' : 'Kalika Women Center'}</h3>
                <StatusChip label={isNe ? 'जारी' : 'In Progress'} variant="info" />
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10px] text-gray-500">
                <div className="flex items-center gap-1"><Calendar size={10} /> {isNe ? 'मंसिर २५' : 'Dec 10, 2024'}</div>
                <div className="flex items-center gap-1"><MapPin size={10} /> {isNe ? 'वार्ड ५, कलन्की' : 'Ward 5, Kalanki'}</div>
                <div className="flex items-center gap-1"><Users size={10} /> {isNe ? 'केन्द्र ID: CC-204' : 'Center ID: CC-204'}</div>
                <div className="flex items-center gap-1"><User size={10} /> {isNe ? 'राम बहादुर (FO-208)' : 'Ram Bahadur (FO-208)'}</div>
              </div>
            </div>

            {/* Group progress */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-gray-700">{isNe ? 'समूह प्रगति' : 'Group Progress'}</h3>
                <span className="text-[10px] text-gray-500">{totalCount} {isNe ? 'सदस्य' : 'Members'}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="text-center p-2 rounded-xl bg-green-50">
                  <p className="text-lg font-bold" style={{ color: colors.green }}>{presentCount + paidCount}/{totalCount}</p>
                  <p className="text-[9px] text-gray-500">{isNe ? 'उपस्थित' : 'Attendance'}</p>
                </div>
                <div className="text-center p-2 rounded-xl bg-blue-50">
                  <p className="text-lg font-bold" style={{ color: colors.navy }}>NPR 68K</p>
                  <p className="text-[9px] text-gray-500">{isNe ? 'संकलन अपेक्षित' : 'Expected'}</p>
                </div>
                <div className="text-center p-2 rounded-xl bg-green-50">
                  <p className="text-lg font-bold" style={{ color: colors.green }}>NPR 42K</p>
                  <p className="text-[9px] text-gray-500">{isNe ? 'संकलन प्राप्त' : 'Received'}</p>
                </div>
                <div className="text-center p-2 rounded-xl bg-orange-50">
                  <p className="text-lg font-bold" style={{ color: colors.orange }}>{followupCount}</p>
                  <p className="text-[9px] text-gray-500">{isNe ? 'फलो-अप आवश्यक' : 'Follow-up'}</p>
                </div>
              </div>
            </div>

            {/* Bulk actions */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={markAllPresent}
                className="flex items-center justify-center gap-1.5 py-2 rounded-xl text-[10px] font-semibold border transition-colors"
                style={{ borderColor: colors.green, color: colors.green, background: colors.greenLight }}
              >
                <UserPlus size={12} /> {isNe ? 'सबै उपस्थित' : 'Mark All Present'}
              </button>
              <button
                onClick={markUnpaidFollowup}
                className="flex items-center justify-center gap-1.5 py-2 rounded-xl text-[10px] font-semibold border transition-colors"
                style={{ borderColor: colors.orange, color: colors.orange, background: colors.orangeLight }}
              >
                <Flag size={12} /> {isNe ? 'फलो-अप' : 'Mark Unpaid Follow-up'}
              </button>
            </div>

            {/* Member list */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-100">
                <h3 className="text-xs font-bold text-gray-700">{isNe ? 'सदस्य उपस्थिति' : 'Member Attendance'}</h3>
              </div>
              <div className="divide-y divide-gray-50">
                {MEMBERS.map(member => (
                  <div key={member.id} className="px-4 py-2.5 flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold text-white" style={{ background: colors.navy }}>
                      {member.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium text-gray-800 truncate">{member.name}</p>
                      <p className="text-[9px] text-gray-400">{member.id}</p>
                    </div>
                    <div className="flex gap-1">
                      {['present', 'paid', 'absent', 'follow-up'].map(st => (
                        <button
                          key={st}
                          onClick={() => updateStatus(member.id, st)}
                          className="px-1.5 py-0.5 rounded text-[8px] font-semibold border transition-all"
                          style={{
                            background: memberStatuses[member.id] === st ? (st === 'present' || st === 'paid' ? colors.green : st === 'absent' ? colors.red : colors.orange) : 'transparent',
                            color: memberStatuses[member.id] === st ? 'white' : colors.gray400,
                            borderColor: memberStatuses[member.id] === st ? 'transparent' : colors.gray200,
                          }}
                        >
                          {st === 'present' ? 'P' : st === 'paid' ? '✓' : st === 'absent' ? 'A' : 'F'}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Meeting notes */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold text-gray-700">{isNe ? 'बैठक नोट' : 'Meeting Notes'}</h3>
                <button className="p-1 rounded-lg bg-gray-100">
                  <Mic size={14} className="text-gray-500" />
                </button>
              </div>
              <div className="rounded-xl px-3 py-2.5 border border-gray-200 bg-gray-50">
                <span className="text-xs text-gray-400">{isNe ? 'बैठक नोट थप्नुहोस्...' : 'Add meeting notes...'}</span>
              </div>
            </div>

            {/* Buttons */}
            <div className="space-y-2 pt-1">
              <PrimaryButton onClick={() => setCompleted(true)} icon={CheckCircle}>
                {isNe ? 'बैठक पूरा गर्नुहोस्' : 'Complete Meeting'}
              </PrimaryButton>
              <SecondaryButton icon={Save} onClick={() => navigate('dashboard')}>
                {isNe ? 'ड्राफ्ट बचाउनुहोस्' : 'Save Draft'}
              </SecondaryButton>
            </div>
          </>
        )}
      </div>

      <BottomNav activeTab="center-meeting" />
    </div>
  );
}

