'use client';

import React from 'react';
import { ShieldCheck, Fingerprint, Eye, EyeOff, Lock, Mountain } from 'lucide-react';
import { useFieldOSStore } from '@/store/fieldos-store';
import { SecurityTrustCard, PrimaryButton, SecondaryButton, colors } from './shared';

export function LoginScreen() {
  const { navigate, showPassword, togglePassword, language } = useFieldOSStore();
  const isNe = language === 'ne';

  const handleLogin = () => navigate('dashboard');
  const handleBiometric = () => navigate('dashboard');

  return (
    <div className="flex flex-col min-h-full bg-white">
      {/* Top gradient area */}
      <div className="pt-8 pb-6 px-6 text-center" style={{ background: `linear-gradient(180deg, ${colors.navyBg} 0%, white 100%)` }}>
        {/* Logo */}
        <div className="flex flex-col items-center mb-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-2 shadow-lg" style={{ background: colors.navy }}>
            <Mountain size={28} className="text-white" />
          </div>
          <h1 className="text-xl font-bold" style={{ color: colors.navy }}>FieldOS</h1>
          <span className="text-xs font-bold" style={{ color: colors.orange }}>NEPAL</span>
        </div>
        <p className="text-xs text-gray-500 mb-1">{isNe ? 'अाशा लघुवित्त वित्तीय संस्था' : 'Asha Laghubitta'}</p>

        {/* Language toggle */}
        <div className="inline-flex items-center rounded-full border p-0.5 mt-2" style={{ borderColor: colors.gray200 }}>
          <button
            className="px-3 py-1 rounded-full text-[11px] font-semibold transition-all"
            style={{
              background: language === 'en' ? colors.navy : 'transparent',
              color: language === 'en' ? 'white' : colors.gray500,
            }}
          >English</button>
          <button
            className="px-3 py-1 rounded-full text-[11px] font-semibold transition-all"
            style={{
              background: language === 'ne' ? colors.navy : 'transparent',
              color: language === 'ne' ? 'white' : colors.gray500,
            }}
          >नेपाली</button>
        </div>
      </div>

      {/* Login card */}
      <div className="flex-1 px-5">
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h2 className="text-base font-bold text-gray-800 mb-4 text-center">
            {isNe ? 'कर्मचारी लगइन' : 'Staff Login'}
          </h2>

          {/* Username */}
          <div className="mb-3">
            <label className="text-[10px] font-semibold text-gray-500 mb-1 block">
              {isNe ? 'प्रयोगकर्ता नाम / कर्मचारी ID' : 'Username / Staff ID'}
            </label>
            <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 border border-gray-200 bg-gray-50">
              <Lock size={16} className="text-gray-400" />
              <span className="text-xs text-gray-400">{isNe ? 'कर्मचारी ID प्रविष्ट गर्नुहोस्' : 'Enter Staff ID'}</span>
            </div>
          </div>

          {/* Password */}
          <div className="mb-3">
            <label className="text-[10px] font-semibold text-gray-500 mb-1 block">
              {isNe ? 'पासवर्ड / PIN' : 'Password / PIN'}
            </label>
            <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 border border-gray-200 bg-gray-50">
              <Lock size={16} className="text-gray-400" />
              <span className="text-xs text-gray-400 flex-1">{isNe ? '••••••' : '••••••'}</span>
              <button onClick={togglePassword} className="p-1">
                {showPassword ? <EyeOff size={16} className="text-gray-400" /> : <Eye size={16} className="text-gray-400" />}
              </button>
            </div>
          </div>

          <button className="text-[10px] font-semibold mb-4 block ml-auto" style={{ color: colors.navy }}>
            {isNe ? 'PIN भुल्नुभयो?' : 'Forgot PIN?'}
          </button>

          <PrimaryButton onClick={handleLogin} className="mb-3">
            {isNe ? 'लगइन गर्नुहोस्' : 'Login'}
          </PrimaryButton>

          <SecondaryButton onClick={handleBiometric} icon={Fingerprint}>
            {isNe ? 'बायोमेट्रिक लगइन' : 'Biometric Login'}
          </SecondaryButton>
        </div>

        {/* Security trust card */}
        <div className="mt-4">
          <SecurityTrustCard />
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-3 px-4">
        <p className="text-[9px] text-gray-400">FieldOS Nepal v2.1.0</p>
        <p className="text-[9px] text-gray-400">{isNe ? 'अधिकृत कर्मचारी मात्र' : 'Authorized personnel only'}</p>
      </div>
    </div>
  );
}

