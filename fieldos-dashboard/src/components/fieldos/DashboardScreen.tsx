'use client';

import React from 'react';
import {
  Bell, Cloud, Users, Wallet, ClipboardList, Sparkles,
  Clock, ChevronRight, CheckCircle, Shield, MapPin, Calendar, Target
} from 'lucide-react';
import { useFieldOSStore } from '@/store/fieldos-store';
import {
  AppHeader, BottomNav, SyncChip, SummaryCard,
  AIRecommendationCard, PrimaryButton, StatusChip, colors
} from './shared';

export function DashboardScreen() {
  const {
    dayStarted, dayVerifiedAt, navigate, openFaceVerification,
    syncStatus, language,
  } = useFieldOSStore();
  const isNe = language === 'ne';

  const handleStartDay = () => openFaceVerification('start-day');

  return (
    <div className="flex flex-col min-h-full bg-[#F8FAFC]">
      <div className="bg-white">
        <AppHeader
          title={isNe ? 'गृह पृष्ठ' : 'Home'}
          rightAction={
            <div className="flex items-center gap-2">
              <SyncChip status={syncStatus} />
              <button onClick={() => navigate('notifications')} className="relative p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                <Bell size={18} className="text-gray-600" />
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-[8px] font-bold flex items-center justify-center text-white" style={{ background: colors.red }}>3</span>
              </button>
            </div>
          }
        />

        {/* Greeting */}
        <div className="px-4 pb-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-800">
                {isNe ? 'नमस्ते, राम' : 'Namaste, Ram'}
              </p>
              <p className="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5">
                <MapPin size={10} />
                {isNe ? 'काठमाडौं पश्चिम शाखा' : 'Kathmandu West Branch'}
              </p>
            </div>
            {dayStarted && (
              <span className="text-[9px] text-gray-400 flex items-center gap-1">
                <CheckCircle size={10} className="text-green-500" />
                {isNe ? 'दिन सुरु' : 'Day Started'} · {dayVerifiedAt}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 py-3 space-y-3 overflow-y-auto pb-20">
        {!dayStarted ? (
          /* ─── Before Start Day ─── */
          <>
            {/* Start Day Card */}
            <div className="rounded-2xl p-4 text-white shadow-lg" style={{ background: `linear-gradient(135deg, ${colors.navy} 0%, ${colors.navyLight} 100%)` }}>
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={18} />
                <span className="text-xs font-semibold">{isNe ? 'आजको काम सुरु गर्नुहोस्' : "Start Today's Field Work"}</span>
              </div>
              <p className="text-[10px] opacity-80 mb-3">
                {isNe ? 'आज 12 क्लाइन्टहरू थप र 8 भेटघाट योजना छ' : '12 due clients and 8 visits planned for today'}
              </p>
              <div className="flex items-center gap-1.5 mb-3">
                <Shield size={12} className="opacity-70" />
                <span className="text-[9px] opacity-70">{isNe ? 'परिचय प्रमाणीकरण आवश्यक' : 'Identity verification required'}</span>
              </div>
              <PrimaryButton
                onClick={handleStartDay}
                icon={Shield}
                className="!bg-white !text-gray-900 shadow-md"
              >
                {isNe ? 'दिन सुरु गर्नुहोस्' : 'Start Day'}
              </PrimaryButton>
            </div>

            {/* Preview summary */}
            <div className="grid grid-cols-2 gap-2.5">
              <SummaryCard label={isNe ? 'थप क्लाइन्ट' : 'Due Clients'} value="12" icon={Users} color={colors.orange} />
              <SummaryCard label={isNe ? 'भेटघाट योजना' : 'Visits Planned'} value="8" icon={MapPin} color={colors.navyLight} />
              <SummaryCard label={isNe ? 'संकलन लक्ष्य' : 'Collection Target'} value="NPR 185K" icon={Wallet} color={colors.green} />
              <SummaryCard label={isNe ? 'प्रतिबद्धता थप' : 'Promise Due'} value="3" icon={Clock} color="#D97706" />
            </div>
          </>
        ) : (
          /* ─── After Start Day ─── */
          <>
            {/* Offline banner */}
            {syncStatus === 'offline' && (
              <div className="rounded-xl p-2.5 flex items-center gap-2" style={{ background: colors.orangeLight }}>
                <Cloud size={14} className="flex-shrink-0" style={{ color: colors.orange }} />
                <span className="text-[10px] text-gray-600">{isNe ? 'तपाईं अफलाइन हुनुहुन्छ · डाटा स्थानीय रूपमा सुरक्षित छ' : 'You are offline · Data is saved locally'}</span>
              </div>
            )}

            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-2.5">
              <SummaryCard label={isNe ? 'थप क्लाइन्ट' : 'Due Clients'} value="12" icon={Users} color={colors.orange} subtext="4 overdue" />
              <SummaryCard label={isNe ? 'भेटघाट योजना' : 'Visits Planned'} value="8" icon={MapPin} color={colors.navyLight} subtext="3 completed" />
              <SummaryCard label={isNe ? 'संकलन लक्ष्य' : 'Collections Target'} value="NPR 185K" icon={Target} color={colors.green} subtext="NPR 45K done" />
              <SummaryCard label={isNe ? 'प्रतिबद्धता थप' : 'Promise Due'} value="3" icon={Clock} color="#D97706" subtext="1 overdue" />
            </div>

            {/* Pending sync */}
            <div className="bg-white rounded-xl p-3 border border-gray-100 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cloud size={14} style={{ color: colors.navy }} />
                  <span className="text-[11px] font-semibold text-gray-700">{isNe ? 'पेन्डिङ सिंक' : 'Pending Sync'}</span>
                </div>
                <span className="text-sm font-bold" style={{ color: colors.orange }}>5</span>
              </div>
            </div>

            {/* AI Recommendation */}
            <AIRecommendationCard
              title={isNe ? 'पहिलो सुझाव' : 'Suggested First'}
              reason={isNe ? 'कारण: प्रतिबद्धता आज थप + 8 दिन अतिरिक्त' : 'Reason: Promise-to-pay due today + 8 days overdue'}
              clientName="Sunita Kumari Chaudhary"
              action={isNe ? 'भेट थाल्नुहोस्' : 'Start Visit'}
              onAction={() => {
                useFieldOSStore.getState().setSelectedClient({ id: 'M-1042', name: 'Sunita Kumari Chaudhary', memberId: 'M-1042' });
                navigate('client-detail');
              }}
            />

            {/* Quick actions */}
            <div>
              <h3 className="text-xs font-bold text-gray-700 mb-2">{isNe ? 'द्रुत कार्यहरू' : 'Quick Actions'}</h3>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: isNe ? 'थप सूची' : 'Due List', icon: ClipboardList, screen: 'due-collections' as const },
                  { label: isNe ? 'केन्द्र बैठक' : 'Center Meeting', icon: Calendar, screen: 'center-meeting' as const },
                  { label: isNe ? 'संकलन रेकर्ड' : 'Record Collection', icon: Wallet, screen: 'record-collection' as const },
                  { label: isNe ? 'अहिले सिंक' : 'Sync Now', icon: Cloud, screen: 'sync-center' as const },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.screen}
                      onClick={() => navigate(item.screen)}
                      className="bg-white rounded-xl p-3 border border-gray-100 shadow-sm flex items-center gap-2.5 active:scale-[0.98] transition-transform"
                    >
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: colors.navyBg }}>
                        <Icon size={16} style={{ color: colors.navy }} />
                      </div>
                      <span className="text-[11px] font-semibold text-gray-700">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Priority client */}
            <div className="bg-white rounded-xl p-3 border border-gray-100 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold text-gray-700">{isNe ? 'प्राथमिकता क्लाइन्ट' : 'Priority Client'}</h3>
                <StatusChip label={isNe ? 'अतिरिक्त' : 'Overdue'} variant="overdue" />
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: colors.red }}>
                  ST
                </div>
                <div className="flex-1">
                  <p className="text-xs font-semibold text-gray-800">Sita Devi Sah</p>
                  <p className="text-[10px] text-gray-500">M-1089 · Ward 5, Kalanki</p>
                  <p className="text-sm font-bold mt-0.5" style={{ color: colors.red }}>NPR 15,000</p>
                </div>
                <button
                  onClick={() => {
                    useFieldOSStore.getState().setSelectedClient({ id: 'M-1089', name: 'Sita Devi Sah', memberId: 'M-1089' });
                    navigate('client-detail');
                  }}
                  className="p-2 rounded-lg hover:bg-gray-100"
                >
                  <ChevronRight size={16} className="text-gray-400" />
                </button>
              </div>
            </div>

            {/* End of Day button */}
            <button
              onClick={() => navigate('end-of-day')}
              className="w-full bg-white rounded-xl p-3 border border-gray-100 shadow-sm flex items-center justify-between active:scale-[0.98] transition-transform"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${colors.navy}15` }}>
                  <ClipboardList size={16} style={{ color: colors.navy }} />
                </div>
                <div className="text-left">
                  <span className="text-[11px] font-semibold text-gray-700">{isNe ? 'दिनको सारांश' : 'End-of-Day Summary'}</span>
                  <p className="text-[9px] text-gray-400">{isNe ? 'प्रगति समीक्षा गर्नुहोस् र प्रतिवेदन पेश गर्नुहोस्' : 'Review progress and submit report'}</p>
                </div>
              </div>
              <ChevronRight size={16} className="text-gray-400" />
            </button>
          </>
        )}
      </div>

      {dayStarted && <BottomNav activeTab="dashboard" />}
    </div>
  );
}


