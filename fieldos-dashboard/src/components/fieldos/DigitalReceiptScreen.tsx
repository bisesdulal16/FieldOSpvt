'use client';

import React from 'react';
import {
  CheckCircle, Share2, ArrowLeft, Wallet, Clock, MapPin, Shield, User, Info, RotateCcw
} from 'lucide-react';
import { useFieldOSStore } from '@/store/fieldos-store';
import {
  AppHeader, BottomNav, StatusChip, PrimaryButton, SecondaryButton, colors
} from './shared';

export function DigitalReceiptScreen() {
  const { selectedClient, navigate, goBack, receiptStatus, language } = useFieldOSStore();
  const isNe = language === 'ne';

  const client = selectedClient || { id: 'M-1042', name: 'Sunita Kumari Chaudhary', memberId: 'M-1042' };
  const receiptId = `RC-${Date.now().toString(36).toUpperCase().slice(-8)}`;
  const now = new Date();

  return (
    <div className="flex flex-col min-h-full bg-[#F8FAFC]">
      <AppHeader title={isNe ? 'संकलन रेकर्ड' : 'Collection Recorded'} showBack />

      <div className="flex-1 px-4 py-3 space-y-3 overflow-y-auto pb-20">
        {/* Success header */}
        <div className="text-center py-4">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: colors.greenLight }}>
            <CheckCircle size={40} style={{ color: colors.green }} />
          </div>
          <h2 className="text-base font-bold text-gray-800">{isNe ? 'संकलन रेकर्ड भयो!' : 'Collection Recorded!'}</h2>
          <div className="mt-2">
            <StatusChip
              label={receiptStatus === 'saved-offline' ? (isNe ? 'स्थानीय रूपमा बचाइयो · पेन्डिङ सिंक' : 'Saved Offline · Pending Sync') :
                receiptStatus === 'pending-verification' ? (isNe ? 'पेन्डिङ प्रमाणीकरण' : 'Pending Verification') :
                  (isNe ? 'पुष्टि भयो' : 'Confirmed')}
              variant={receiptStatus === 'saved-offline' ? 'saved' : receiptStatus === 'pending-verification' ? 'warning' : 'success'}
            />
          </div>
        </div>

        {/* Receipt card */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {/* Top accent */}
          <div className="h-1.5" style={{ background: colors.navy }} />

          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-400">{isNe ? 'रसिद ID' : 'Receipt ID'}</span>
              <span className="text-xs font-mono font-bold" style={{ color: colors.navy }}>{receiptId}</span>
            </div>

            <div className="h-px bg-gray-100" />

            {/* Amount */}
            <div className="text-center py-2">
              <p className="text-[10px] text-gray-400 mb-1">{isNe ? 'संकलन रकम' : 'Amount Collected'}</p>
              <p className="text-3xl font-bold" style={{ color: colors.navy }}>NPR 5,500</p>
            </div>

            <div className="h-px bg-gray-100" />

            <div className="space-y-2">
              {[
                { label: isNe ? 'क्लाइन्ट' : 'Client', value: client.name, icon: User },
                { label: isNe ? 'सदस्य ID' : 'Member ID', value: client.memberId, icon: User },
                { label: isNe ? 'भुक्तानी विधि' : 'Payment Method', value: 'Cash', icon: Wallet },
                { label: isNe ? 'मिति / समय' : 'Date / Time', value: now.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), icon: Clock },
                { label: isNe ? 'क्षेत्र अधिकारी' : 'Field Officer', value: 'Ram Bahadur (FO-208)', icon: User },
              ].map(item => (
                <div key={item.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <item.icon size={12} className="text-gray-400" />
                    <span className="text-[10px] text-gray-500">{item.label}</span>
                  </div>
                  <span className="text-[11px] font-medium text-gray-800">{item.value}</span>
                </div>
              ))}
            </div>

            {/* GPS indicator */}
            <div className="flex items-center gap-1.5">
              <MapPin size={12} className="text-green-500" />
              <span className="text-[10px] text-green-600">{isNe ? 'GPS लग गरियो — वार्ड ७, बुटवल' : 'GPS logged — Ward 7, Butwal'}</span>
            </div>
          </div>

          <div className="h-1.5" style={{ background: colors.navy }} />
        </div>

        {/* Verification note */}
        <div className="rounded-xl p-3 border border-gray-200 bg-gray-50">
          <div className="flex items-start gap-2">
            <Info size={12} className="mt-0.5 text-gray-400 flex-shrink-0" />
            <p className="text-[10px] text-gray-500">
              {isNe ? 'अन्तिम पोस्टिङ शाखा / CBS प्रमाणीकरण आवश्यक' : 'Final posting requires branch/CBS verification'}
            </p>
          </div>
        </div>

        {/* Buttons */}
        <div className="space-y-2 pt-1">
          <SecondaryButton icon={Share2}>
            {isNe ? 'रसिद साझा गर्नुहोस्' : 'Share Receipt'}
          </SecondaryButton>
          <PrimaryButton onClick={() => navigate('due-collections')}>
            {isNe ? 'कार्यहरूमा फर्कनुहोस्' : 'Return to Tasks'}
          </PrimaryButton>
          <button
            onClick={() => navigate('record-collection')}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold text-gray-500 hover:bg-gray-100 transition-colors"
          >
            <RotateCcw size={14} /> {isNe ? 'नयाँ संकलन' : 'New Collection'}
          </button>
        </div>
      </div>

      <BottomNav activeTab="record-collection" />
    </div>
  );
}

