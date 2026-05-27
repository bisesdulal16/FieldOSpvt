'use client';

import React, { useState } from 'react';
import {
  Wallet, Camera, ChevronRight, Info, Shield, CheckCircle, AlertTriangle
} from 'lucide-react';
import { useFieldOSStore } from '@/store/fieldos-store';
import {
  AppHeader, BottomNav, StatusChip, PrimaryButton, SecondaryButton, colors
} from './shared';

const PAYMENT_METHODS = [
  { key: 'cash', label: 'Cash', icon: '💵' },
  { key: 'qr', label: 'QR', icon: '📱' },
  { key: 'mobile-banking', label: 'Mobile Banking', icon: '🏦' },
  { key: 'esewa', label: 'eSewa', icon: '🟢' },
  { key: 'khalti', label: 'Khalti', icon: '🟣' },
  { key: 'ime-pay', label: 'IME Pay', icon: '🔵' },
  { key: 'bank-transfer', label: 'Bank Transfer', icon: '🏛️' },
  { key: 'connectips', label: 'connectIPS', icon: '🔗' },
  { key: 'other', label: 'Other', icon: '📝' },
];

export function RecordCollectionScreen() {
  const { selectedClient, navigate, goBack, collectionAmount, setCollectionAmount, openFaceVerification, language } = useFieldOSStore();
  const isNe = language === 'ne';
  const [selectedMethod, setSelectedMethod] = useState('cash');
  const [showKeypad, setShowKeypad] = useState(false);

  const client = selectedClient || { id: 'M-1042', name: 'Sunita Kumari Chaudhary', memberId: 'M-1042' };
  const dueAmount = 5500;
  const amount = parseInt(collectionAmount) || 0;
  const isHighValue = amount >= 10000;

  const handleSave = () => {
    if (isHighValue) {
      openFaceVerification('high-value-collection');
    } else {
      navigate('digital-receipt');
    }
  };

  const handleKeyPress = (key: string) => {
    if (key === 'backspace') {
      setCollectionAmount(collectionAmount.slice(0, -1));
    } else if (key === '.') {
      if (!collectionAmount.includes('.')) setCollectionAmount(collectionAmount + '.');
    } else {
      setCollectionAmount(collectionAmount + key);
    }
  };

  return (
    <div className="flex flex-col min-h-full bg-[#F8FAFC]">
      <AppHeader title={isNe ? 'संकलन रेकर्ड' : 'Record Collection'} showBack />

      <div className="flex-1 px-4 py-3 space-y-3 overflow-y-auto pb-4">
        {/* Client summary */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: colors.navy }}>
              {client.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
            </div>
            <div className="flex-1">
              <p className="text-xs font-semibold text-gray-800">{client.name}</p>
              <p className="text-[10px] text-gray-500">{client.memberId}</p>
            </div>
            <StatusChip label={isNe ? 'सत्यापित' : 'Verified'} variant="verified" />
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[11px] text-gray-500">{isNe ? 'थप रकम' : 'Due Amount'}</span>
            <span className="text-sm font-bold" style={{ color: colors.red }}>NPR {dueAmount.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[11px] text-gray-500">{isNe ? 'बाँकी रकम' : 'Outstanding'}</span>
            <span className="text-xs font-medium text-gray-700">NPR 45,000</span>
          </div>
        </div>

        {/* Amount collected */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <h3 className="text-xs font-bold text-gray-700 mb-2">{isNe ? 'संकलन रकम' : 'Amount Collected'}</h3>
          <div
            onClick={() => setShowKeypad(!showKeypad)}
            className="flex items-center gap-2 rounded-xl px-3 py-3 border-2 transition-colors cursor-pointer"
            style={{
              borderColor: showKeypad ? colors.navy : colors.gray200,
              background: showKeypad ? colors.navyBg : 'white',
            }}
          >
            <span className="text-sm font-medium text-gray-400">NPR</span>
            <span className="text-2xl font-bold flex-1" style={{ color: amount > 0 ? colors.navy : colors.gray300 }}>
              {amount > 0 ? amount.toLocaleString() : (isNe ? '०' : '0')}
            </span>
            <Wallet size={18} className="text-gray-400" />
          </div>

          {/* Keypad */}
          {showKeypad && (
            <div className="grid grid-cols-4 gap-1.5 mt-3">
              {['1', '2', '3', 'backspace', '4', '5', '6', '.', '7', '8', '9', '0', '00', '000'].map(key => (
                <button
                  key={key}
                  onClick={() => handleKeyPress(key)}
                  className="py-2.5 rounded-lg text-sm font-semibold border border-gray-200 bg-gray-50 active:bg-gray-200 transition-colors flex items-center justify-center"
                  style={{
                    color: key === 'backspace' ? colors.red : colors.gray800,
                    fontSize: key === 'backspace' ? '10px' : '14px',
                  }}
                >
                  {key === 'backspace' ? '⌫' : key}
                </button>
              ))}
              <button
                onClick={() => setCollectionAmount(String(dueAmount))}
                className="col-span-4 py-2 rounded-lg text-[10px] font-semibold text-center"
                style={{ color: colors.navy }}
              >
                {isNe ? 'पूरा थप रकम सेट गर्नुहोस्' : 'Set Full Due Amount'}
              </button>
            </div>
          )}

          {/* Partial payment toggle */}
          {amount > 0 && amount < dueAmount && (
            <div className="mt-2 flex items-center gap-2 p-2 rounded-lg" style={{ background: colors.orangeLight }}>
              <AlertTriangle size={12} style={{ color: colors.orange }} />
              <span className="text-[10px] font-medium" style={{ color: colors.orange }}>
                {isNe ? 'आंशिक भुक्तानी — बाँकी NPR' + (dueAmount - amount).toLocaleString() : `Partial payment — Remaining NPR ${(dueAmount - amount).toLocaleString()}`}
              </span>
            </div>
          )}
        </div>

        {/* Payment method */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <h3 className="text-xs font-bold text-gray-700 mb-2">{isNe ? 'भुक्तानी विधि' : 'Payment Method'}</h3>
          <div className="grid grid-cols-3 gap-1.5">
            {PAYMENT_METHODS.map(m => (
              <button
                key={m.key}
                onClick={() => setSelectedMethod(m.key)}
                className="flex flex-col items-center gap-1 p-2 rounded-xl border transition-all"
                style={{
                  borderColor: selectedMethod === m.key ? colors.navy : colors.gray200,
                  background: selectedMethod === m.key ? colors.navyBg : 'white',
                }}
              >
                <span className="text-base">{m.icon}</span>
                <span className="text-[9px] font-semibold" style={{ color: selectedMethod === m.key ? colors.navy : colors.gray600 }}>
                  {m.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Receipt / Reference */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <h3 className="text-xs font-bold text-gray-700 mb-2">{isNe ? 'रसिद / सन्दर्भ' : 'Receipt / Reference'}</h3>
          <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 border border-gray-200 bg-gray-50">
            <span className="text-xs text-gray-400 flex-1">{isNe ? 'सन्दर्भ नम्बर प्रविष्ट गर्नुहोस्' : 'Enter reference number'}</span>
          </div>
          <button className="mt-2 flex items-center gap-2 text-[10px] font-semibold" style={{ color: colors.navy }}>
            <Camera size={12} /> {isNe ? 'रसिद फोटो' : 'Receipt Photo'}
          </button>
        </div>

        {/* High value warning */}
        {isHighValue && (
          <div className="rounded-xl p-3 border" style={{ background: '#FEF3C7', borderColor: '#FCD34D' }}>
            <div className="flex items-start gap-2">
              <Shield size={14} className="flex-shrink-0 mt-0.5" style={{ color: '#D97706' }} />
              <div>
                <p className="text-[10px] font-semibold" style={{ color: '#92400E' }}>{isNe ? 'उच्च-मूल्य संकलन' : 'High-Value Collection'}</p>
                <p className="text-[9px]" style={{ color: '#A16207' }}>{isNe ? 'पहिचान प्रमाणीकरण आवश्यक हुनेछ' : 'Identity verification will be required before saving.'}</p>
              </div>
            </div>
          </div>
        )}

        {/* Info note */}
        <div className="rounded-xl p-3 border border-gray-200 bg-gray-50">
          <div className="flex items-start gap-2">
            <Info size={12} className="mt-0.5 text-gray-400 flex-shrink-0" />
            <p className="text-[10px] text-gray-500">
              {isNe ? 'अन्तिम पोस्टिङ शाखा / CBS प्रमाणीकरण आवश्यक' : 'Final posting requires branch/CBS verification'}
            </p>
          </div>
        </div>

        {/* Status chips */}
        <div className="flex gap-1.5 flex-wrap">
          <StatusChip label={isNe ? 'स्थानीय रूपमा बचाइयो' : 'Saved Offline'} variant="saved" />
          <StatusChip label={isNe ? 'पेन्डिङ सिंक' : 'Pending Sync'} variant="sync" />
        </div>

        {/* Buttons */}
        <div className="space-y-2 pt-1">
          <PrimaryButton onClick={handleSave} icon={CheckCircle}>
            {isNe ? 'संकलन बचाउनुहोस्' : 'Save Collection'}
          </PrimaryButton>
          <button
            onClick={goBack}
            className="w-full py-3 rounded-xl text-sm font-semibold text-gray-500 hover:bg-gray-100 transition-colors"
          >
            {isNe ? 'रद्द गर्नुहोस्' : 'Cancel'}
          </button>
        </div>
      </div>

      <BottomNav activeTab="record-collection" />
    </div>
  );
}

