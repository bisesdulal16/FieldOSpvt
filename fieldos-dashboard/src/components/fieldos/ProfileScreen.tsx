'use client';

import React from 'react';
import {
  Shield, ShieldCheck, Lock, Smartphone, Clock, FileText,
  LogOut, AlertCircle, ChevronRight, MapPin, Info, Settings,
  MessageCircle, CheckCircle, Eye, History, User
} from 'lucide-react';
import { useFieldOSStore } from '@/store/fieldos-store';
import {
  AppHeader, BottomNav, StatusChip, PrivacyNoteCard, PrimaryButton, colors
} from './shared';

export function ProfileScreen() {
  const { navigate, syncStatus, language } = useFieldOSStore();
  const isNe = language === 'ne';

  const handleLogout = () => navigate('login');

  return (
    <div className="flex flex-col min-h-full bg-[#F8FAFC]">
      <AppHeader title={isNe ? 'प्रोफाइल' : 'Profile'} />

      <div className="flex-1 px-4 py-3 space-y-3 overflow-y-auto pb-20">
        {/* Profile card */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold text-white" style={{ background: colors.navy }}>
              RB
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-gray-800">{isNe ? 'राम बहादुर शाह' : 'Ram Bahadur Shah'}</p>
              <p className="text-[10px] text-gray-500">{isNe ? 'क्षेत्र अधिकारी' : 'Field Officer'}</p>
              <p className="text-[10px] text-gray-500">{isNe ? 'काठमाडौं पश्चिम शाखा' : 'Kathmandu West Branch'}</p>
            </div>
          </div>

          <div className="h-px bg-gray-100 mb-3" />

          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="flex items-center gap-1.5 text-gray-500">
              <User size={11} /> {isNe ? 'कर्मचारी ID: FO-208' : 'Employee ID: FO-208'}
            </div>
            <div className="flex items-center gap-1.5 text-gray-500">
              <Smartphone size={11} /> {isNe ? 'उपकरण: अधिकृत' : 'Device: Authorized'}
            </div>
            <div className="flex items-center gap-1.5 text-gray-500">
              <Clock size={11} /> {isNe ? 'अन्तिम सिंक: ३० मिनेट अघि' : 'Last sync: 30 min ago'}
            </div>
            <div className="flex items-center gap-1.5">
              <StatusChip label={isNe ? 'अधिकृत' : 'Authorized'} variant="verified" />
            </div>
          </div>
        </div>

        {/* Security settings */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-xs font-bold text-gray-700">{isNe ? 'सुरक्षा' : 'Security'}</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {[
              {
                icon: Lock, label: isNe ? 'एप लक' : 'App Lock', desc: isNe ? 'PIN / बायोमेट्रिक' : 'PIN / Biometric',
                status: isNe ? 'सक्रिय' : 'Active', variant: 'verified' as const,
              },
              {
                icon: ShieldCheck, label: isNe ? 'परिचय प्रमाणीकरण' : 'Identity Verification',
                desc: isNe ? 'अनुहार प्रमाणीकरण' : 'Face verification',
                status: isNe ? 'सक्रिय' : 'Active', variant: 'verified' as const,
              },
              {
                icon: Shield, label: isNe ? 'स्थानीय डाटा एन्क्रिप्शन' : 'Local Data Encryption',
                desc: isNe ? 'AES-256 एन्क्रिप्शन' : 'AES-256 encryption',
                status: isNe ? 'सक्रिय' : 'Active', variant: 'verified' as const,
              },
              {
                icon: History, label: isNe ? 'अडिट लगहरू' : 'Audit Logs',
                desc: isNe ? 'अन्तिम ३० दिन' : 'Last 30 days',
                status: '12 entries', variant: 'info' as const,
              },
            ].map(item => (
              <button key={item.label} className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: colors.navyBg }}>
                  <item.icon size={16} style={{ color: colors.navy }} />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-[11px] font-semibold text-gray-800">{item.label}</p>
                  <p className="text-[9px] text-gray-400">{item.desc}</p>
                </div>
                <StatusChip label={item.status} variant={item.variant} />
                <ChevronRight size={14} className="text-gray-300" />
              </button>
            ))}
          </div>
        </div>

        {/* Privacy note */}
        <PrivacyNoteCard />

        {/* Support */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-xs font-bold text-gray-700">{isNe ? 'समर्थन' : 'Support'}</h3>
          </div>
          <div className="divide-y divide-gray-50">
            <button className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-orange-50">
                <AlertCircle size={16} style={{ color: colors.orange }} />
              </div>
              <div className="flex-1 text-left">
                <p className="text-[11px] font-semibold text-gray-800">{isNe ? 'एप समस्या रिपोर्ट गर्नुहोस्' : 'Report App Issue'}</p>
              </div>
              <ChevronRight size={14} className="text-gray-300" />
            </button>
            <button className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-50">
                <MessageCircle size={16} style={{ color: colors.navy }} />
              </div>
              <div className="flex-1 text-left">
                <p className="text-[11px] font-semibold text-gray-800">{isNe ? 'शाखा / प्रशासकलाई सम्पर्क गर्नुहोस्' : 'Contact Branch/Admin'}</p>
              </div>
              <ChevronRight size={14} className="text-gray-300" />
            </button>
          </div>
        </div>

        {/* Logout */}
        <div className="pt-2 space-y-2">
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white transition-all active:scale-[0.98]"
            style={{ background: colors.red }}
          >
            <LogOut size={18} /> {isNe ? 'सुरक्षित लगआउट' : 'Secure Logout'}
          </button>
          <p className="text-[9px] text-gray-400 text-center">FieldOS Nepal v2.1.0</p>
        </div>
      </div>

      <BottomNav activeTab="profile" />
    </div>
  );
}

