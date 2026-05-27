'use client';

import React from 'react';
import {
  MapPin, Users, Calendar, Clock, Wallet, Phone,
  Sparkles, FileText, CheckCircle, AlertTriangle, ChevronRight, Shield, ShieldCheck
} from 'lucide-react';
import { useFieldOSStore } from '@/store/fieldos-store';
import {
  AppHeader, BottomNav, StatusChip, AIRecommendationCard,
  PrimaryButton, SecondaryButton, PrivacyNoteCard, colors
} from './shared';

export function ClientDetailScreen() {
  const { selectedClient, navigate, goBack, language } = useFieldOSStore();
  const isNe = language === 'ne';

  const client = selectedClient || { id: 'M-1042', name: 'Sunita Kumari Chaudhary', memberId: 'M-1042' };

  return (
    <div className="flex flex-col min-h-full bg-[#F8FAFC]">
      <AppHeader title={isNe ? 'क्लाइन्ट विवरण' : 'Client Detail'} showBack />

      <div className="flex-1 px-4 py-3 space-y-3 overflow-y-auto pb-20">
        {/* Client Profile Card */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold text-white" style={{ background: colors.navy }}>
              {client.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-gray-800">{client.name}</p>
              <p className="text-[10px] text-gray-500">{client.memberId} · {isNe ? 'कर्मचारी ID: FO-208' : 'Loan Cycle: 3'}</p>
              <div className="flex items-center gap-1 mt-1">
                <StatusChip label={isNe ? 'प्रमाणित' : 'Verified'} variant="verified" />
              </div>
            </div>
            <button className="p-2 rounded-lg bg-green-50 border border-green-200">
              <Phone size={16} style={{ color: colors.green }} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="flex items-center gap-1.5 text-gray-500">
              <Users size={12} className="flex-shrink-0" /> {isNe ? 'जनकपुर केन्द्र' : 'Janakpur Center'}
            </div>
            <div className="flex items-center gap-1.5 text-gray-500">
              <MapPin size={12} className="flex-shrink-0" /> {isNe ? 'वार्ड ७, बुटवल' : 'Ward 7, Butwal'}
            </div>
          </div>
        </div>

        {/* Loan Summary */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <h3 className="text-xs font-bold text-gray-700 mb-3">{isNe ? 'ऋण विवरण' : 'Loan Summary'}</h3>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-500">{isNe ? 'थप रकम' : 'Due Amount'}</span>
              <span className="text-sm font-bold" style={{ color: colors.red }}>NPR 5,500</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-500">{isNe ? 'बाँकी रकम' : 'Outstanding Balance'}</span>
              <span className="text-sm font-bold text-gray-800">NPR 45,000</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-500">{isNe ? 'अन्तिम भुक्तानी' : 'Last Payment'}</span>
              <span className="text-xs font-medium text-gray-700">NPR 2,500 · {isNe ? '२८ दिन अघि' : '28 days ago'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-500">{isNe ? 'अर्को किस्ता' : 'Next Installment'}</span>
              <span className="text-xs font-medium text-gray-700">{isNe ? 'आज' : 'Today'}</span>
            </div>
            <div className="h-px bg-gray-100" />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-500">{isNe ? 'अतिरिक्त / PAR' : 'Overdue / PAR'}</span>
              <StatusChip label={isNe ? '८ दिन अतिरिक्त' : '8 Days Overdue'} variant="overdue" />
            </div>
          </div>
        </div>

        {/* AI Recommendation */}
        <AIRecommendationCard
          title={isNe ? 'एआई सुझाव' : 'AI Recommended Action'}
          reason={isNe ? 'यो क्लाइन्ट पहिलो सिफारिस - प्रतिबद्धता थप + अतिरिक्त' : 'Priority visit recommended — promise-to-pay due + overdue'}
          action={isNe ? 'भेट थाल्नुहोस्' : 'Start Visit Check-in'}
          onAction={() => navigate('visit-checkin')}
        />

        {/* Action Buttons */}
        <div className="space-y-2">
          <PrimaryButton onClick={() => navigate('visit-checkin')} icon={MapPin}>
            {isNe ? 'भेट चेक-इन थाल्नुहोस्' : 'Start Visit Check-in'}
          </PrimaryButton>
          <div className="grid grid-cols-2 gap-2">
            <SecondaryButton onClick={() => navigate('record-collection')} icon={Wallet}>
              {isNe ? 'संकलन रेकर्ड' : 'Record Collection'}
            </SecondaryButton>
            <SecondaryButton onClick={() => navigate('promise-to-pay')} icon={Clock}>
              {isNe ? 'प्रतिबद्धता' : 'Promise-to-Pay'}
            </SecondaryButton>
          </div>
          <button className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
            <FileText size={16} /> {isNe ? 'नोट थप्नुहोस्' : 'Add Note'}
          </button>
        </div>

        {/* KYC Status */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <h3 className="text-xs font-bold text-gray-700 mb-2">{isNe ? 'केवाईसी / कागजात' : 'KYC / Documents'}</h3>
          <div className="space-y-2">
            {[
              { label: isNe ? 'नागरिकता' : 'Citizenship', status: 'verified' as const, statusLabel: isNe ? 'प्रमाणित' : 'Verified' },
              { label: isNe ? 'फोटो' : 'Photo', status: 'verified' as const, statusLabel: isNe ? 'प्रमाणित' : 'Verified' },
              { label: isNe ? 'ठेगाना प्रमाण' : 'Address Proof', status: 'verified' as const, statusLabel: isNe ? 'प्रमाणित' : 'Verified' },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between">
                <span className="text-[11px] text-gray-600">{item.label}</span>
                <StatusChip label={item.statusLabel} variant={item.status} />
              </div>
            ))}
          </div>
        </div>

        {/* Recent History */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <h3 className="text-xs font-bold text-gray-700 mb-2">{isNe ? 'भ्रमण / भुक्तानी इतिहास' : 'Visit / Payment History'}</h3>
          <div className="space-y-2.5">
            {[
              { date: isNe ? 'पुस १५' : 'Jan 29', action: isNe ? 'संकलन' : 'Collection', amount: 'NPR 2,500', status: 'confirmed' },
              { date: isNe ? 'पुस ८' : 'Jan 22', action: isNe ? 'भेट' : 'Visit', amount: isNe ? 'फलो-अप' : 'Follow-up', status: 'confirmed' },
              { date: isNe ? 'पुस १' : 'Jan 15', action: isNe ? 'संकलन' : 'Collection', amount: 'NPR 2,500', status: 'confirmed' },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${colors.navy}10` }}>
                  {item.action === (isNe ? 'संकलन' : 'Collection') ? <Wallet size={14} style={{ color: colors.navy }} /> : <MapPin size={14} style={{ color: colors.navy }} />}
                </div>
                <div className="flex-1">
                  <p className="text-[11px] font-medium text-gray-700">{item.action}</p>
                  <p className="text-[9px] text-gray-400">{item.date}</p>
                </div>
                <span className="text-[11px] font-semibold text-gray-700">{item.amount}</span>
                <CheckCircle size={12} className={colors.green} />
              </div>
            ))}
          </div>
        </div>

        {/* Privacy note */}
        <PrivacyNoteCard />

        <p className="text-[9px] text-gray-400 text-center pb-2">
          {isNe ? 'तपाईंको भूमिकाको आधारमा देखिन्छ' : 'Visible based on your role'}
        </p>
      </div>

      <BottomNav activeTab="due-collections" />
    </div>
  );
}

