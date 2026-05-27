'use client';

import React, { useState } from 'react';
import {
  Wallet, Users, ClipboardList, FileText, Calendar, Cloud,
  CheckCircle, Shield, AlertTriangle, Clock, RefreshCw, Save, XCircle
} from 'lucide-react';
import { useFieldOSStore } from '@/store/fieldos-store';
import {
  AppHeader, BottomNav, StatusChip, SummaryCard,
  PrimaryButton, SecondaryButton, colors
} from './shared';

const EXCEPTIONS = [
  { label: 'Missing receipt', labelNe: 'रसिद हराइयो', count: 1, icon: FileText, color: colors.orange },
  { label: 'Partial payment', labelNe: 'आंशिक भुक्तानी', count: 2, icon: Wallet, color: '#D97706' },
  { label: 'Client unavailable', labelNe: 'क्लाइन्ट उपलब्ध छैन', count: 1, icon: Users, color: colors.gray500 },
  { label: 'Pending sync', labelNe: 'पेन्डिङ सिंक', count: 5, icon: Cloud, color: colors.navyLight },
  { label: 'Failed sync', labelNe: 'सिंक असफल', count: 0, icon: XCircle, color: colors.red },
  { label: 'High-value pending', labelNe: 'उच्च-मूल्य पेन्डिङ', count: 1, icon: Shield, color: '#7C3AED' },
];

export function EndOfDayScreen() {
  const { navigate, openFaceVerification, language } = useFieldOSStore();
  const isNe = language === 'ne';
  const [confirmed, setConfirmed] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    openFaceVerification('submit-report');
  };

  return (
    <div className="flex flex-col min-h-full bg-[#F8FAFC]">
      <AppHeader title={isNe ? 'दिनको सारांश' : 'End-of-Day Summary'} showBack />

      <div className="flex-1 px-4 py-3 space-y-3 overflow-y-auto pb-20">
        {submitted ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: colors.greenLight }}>
              <CheckCircle size={40} style={{ color: colors.green }} />
            </div>
            <h3 className="text-base font-bold text-gray-800 mb-1">{isNe ? 'प्रतिवेदन पेश भयो!' : 'Report Submitted!'}</h3>
            <p className="text-xs text-gray-500 text-center mb-3">
              {isNe ? 'तपाईंको दैनिक प्रतिवेदन सफलतापूर्वक पेश गरियो' : 'Your daily report has been submitted successfully'}
            </p>
            <StatusChip label={isNe ? 'पुष्टि भयो' : 'Confirmed'} variant="success" />
            <div className="mt-6 w-full space-y-2 px-4">
              <PrimaryButton onClick={() => navigate('dashboard')}>
                {isNe ? 'ड्यासबोर्डमा फर्कनुहोस्' : 'Back to Dashboard'}
              </PrimaryButton>
              <SecondaryButton onClick={() => navigate('sync-center')} icon={RefreshCw}>
                {isNe ? 'अहिले सिंक' : 'Sync Now'}
              </SecondaryButton>
            </div>
          </div>
        ) : (
          <>
            {/* Date */}
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <Calendar size={14} style={{ color: colors.navy }} />
              <span className="font-medium">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-2">
              <SummaryCard label={isNe ? 'कुल संकलन' : 'Collected'} value="NPR 45K" icon={Wallet} color={colors.green} />
              <SummaryCard label={isNe ? 'भेट पूरा' : 'Visits' } value="6" icon={Users} color={colors.navyLight} />
              <SummaryCard label={isNe ? 'पेन्डिङ' : 'Pending'} value="3" icon={ClipboardList} color={colors.orange} />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <SummaryCard label={isNe ? 'प्रतिबद्धता' : 'Promises'} value="3" icon={FileText} color="#D97706" />
              <SummaryCard label={isNe ? 'बैठक' : 'Meetings'} value="1" icon={Calendar} color={colors.green} />
              <SummaryCard label={isNe ? 'पेन्डिङ सिंक' : 'Sync'} value="5" icon={Cloud} color={colors.navyLight} />
            </div>

            {/* Exceptions */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
              <h3 className="text-xs font-bold text-gray-700 mb-3">{isNe ? 'अपवादहरू' : 'Exceptions'}</h3>
              <div className="space-y-2">
                {EXCEPTIONS.filter(e => e.count > 0).map(exc => (
                  <div key={exc.label} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <exc.icon size={14} style={{ color: exc.color }} />
                      <span className="text-[11px] text-gray-600">{isNe ? exc.labelNe : exc.label}</span>
                    </div>
                    {exc.count > 0 && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: `${exc.color}15`, color: exc.color }}>
                        {exc.count}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Confirmation checkbox */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
              <button
                onClick={() => setConfirmed(!confirmed)}
                className="w-full flex items-start gap-2.5"
              >
                <div className="w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors"
                  style={{
                    borderColor: confirmed ? colors.navy : colors.gray300,
                    background: confirmed ? colors.navy : 'transparent',
                  }}
                >
                  {confirmed && <CheckCircle size={12} className="text-white" />}
                </div>
                <span className="text-[11px] text-gray-700 text-left">
                  {isNe ? 'म पुष्टि गर्दछु कि आजको क्षेत्र डाटा सही छ' : "I confirm today's field data is accurate"}
                </span>
              </button>
            </div>

            {/* Identity verification required */}
            <div className="rounded-xl p-3 border border-blue-200" style={{ background: colors.navyBg }}>
              <div className="flex items-center gap-2">
                <Shield size={14} style={{ color: colors.navy }} />
                <span className="text-[10px] font-medium" style={{ color: colors.navy }}>
                  {isNe ? 'अन्तिम पेश गर्नु अघि परिचय प्रमाणीकरण आवश्यक' : 'Identity verification required before final submission'}
                </span>
              </div>
            </div>

            {/* Buttons */}
            <div className="space-y-2 pt-1">
              <PrimaryButton onClick={handleSubmit} icon={Shield}>
                {isNe ? 'मेरो प्रतिवेदन पेश गर्नुहोस्' : 'Submit My Report'}
              </PrimaryButton>
              <div className="grid grid-cols-2 gap-2">
                <SecondaryButton onClick={() => navigate('dashboard')} icon={Save}>
                  {isNe ? 'ड्राफ्ट बचाउनुहोस्' : 'Save Draft'}
                </SecondaryButton>
                <SecondaryButton onClick={() => navigate('sync-center')} icon={RefreshCw}>
                  {isNe ? 'अहिले सिंक' : 'Sync Now'}
                </SecondaryButton>
              </div>
            </div>
          </>
        )}
      </div>

      <BottomNav activeTab="dashboard" />
    </div>
  );
}

