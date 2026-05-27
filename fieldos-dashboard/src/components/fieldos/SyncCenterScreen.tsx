'use client';

import React, { useState } from 'react';
import {
  Cloud, CloudOff, RefreshCw, CheckCircle, XCircle, Clock,
  FileText, MapPin, Handshake, Users, Shield, ChevronRight,
  AlertTriangle, Wifi, WifiOff
} from 'lucide-react';
import { useFieldOSStore } from '@/store/fieldos-store';
import {
  AppHeader, BottomNav, SyncChip, PrimaryButton, SecondaryButton,
  SectionHeader, StatusChip, colors
} from './shared';

const SYNC_ITEMS = [
  { label: 'Collection records', labelNe: 'संकलन रेकर्डहरू', count: 5, icon: FileText },
  { label: 'Visit check-ins', labelNe: 'भेट चेक-इन', count: 3, icon: MapPin },
  { label: 'Promise-to-pay records', labelNe: 'प्रतिबद्धता रेकर्डहरू', count: 2, icon: Handshake },
  { label: 'Center meetings', labelNe: 'केन्द्र बैठकहरू', count: 1, icon: Users },
  { label: 'EOD reports', labelNe: 'EOD प्रतिवेदनहरू', count: 1, icon: FileText },
];

const FAILED_ITEMS = [
  { label: 'Collection #RC-A3F2K', labelNe: 'संकलन #RC-A3F2K', reason: 'CBS timeout', reasonNe: 'CBS समय सकियो' },
];

export function SyncCenterScreen() {
  const { syncStatus, syncItemsReady, triggerSync, navigate, language } = useFieldOSStore();
  const isNe = language === 'ne';
  const connectionStatus = syncStatus === 'syncing' || syncStatus === 'synced' ? 'online' : syncStatus === 'failed' ? 'offline' : 'offline';

  const statusConfig = {
    offline: { icon: CloudOff, color: colors.orange, label: isNe ? 'अफलाइन' : 'Offline', bg: colors.orangeLight },
    online: { icon: Wifi, color: colors.green, label: isNe ? 'अनलाइन' : 'Online', bg: colors.greenLight },
    syncing: { icon: RefreshCw, color: colors.navy, label: isNe ? 'सिंक हुँदै...' : 'Syncing...', bg: colors.navyBg },
    synced: { icon: CheckCircle, color: colors.green, label: isNe ? 'सबै सिंक भयो' : 'All Synced', bg: colors.greenLight },
    failed: { icon: XCircle, color: colors.red, label: isNe ? 'सिंक असफल' : 'Sync Failed', bg: colors.redLight },
  };

  const sc = statusConfig[syncStatus];
  const StatusIcon = sc.icon;

  return (
    <div className="flex flex-col min-h-full bg-[#F8FAFC]">
      <AppHeader title={isNe ? 'सिंक केन्द्र' : 'Sync Center'} />

      <div className="flex-1 px-4 py-3 space-y-3 overflow-y-auto pb-20">
        {/* Connection status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-600">{isNe ? 'जडान स्थिति' : 'Connection Status'}</span>
          </div>
          <SyncChip status={syncStatus} />
        </div>

        {/* Big status card */}
        <div className="rounded-2xl p-5 text-center border shadow-sm" style={{ background: sc.bg, borderColor: `${sc.color}30` }}>
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: `${sc.color}20` }}>
            <StatusIcon size={28} style={{ color: sc.color }} className={syncStatus === 'syncing' ? 'animate-spin' : ''} />
          </div>
          <h3 className="text-base font-bold text-gray-800 mb-1">{sc.label}</h3>
          {syncItemsReady > 0 && syncStatus !== 'synced' ? (
            <p className="text-sm text-gray-600">
              <span className="font-bold" style={{ color: sc.color }}>{syncItemsReady}</span>{' '}
              {isNe ? 'वस्तुहरू सिंक गर्न तयार' : 'items ready to sync'}
            </p>
          ) : syncStatus === 'synced' ? (
            <p className="text-xs text-gray-500">{isNe ? 'सबै रेकर्डहरू अपडेट भए' : 'All records are up to date'}</p>
          ) : (
            <p className="text-xs text-gray-500">{isNe ? 'अन्तिम सिंक: ३० मिनेट अघि' : 'Last synced: 30 min ago'}</p>
          )}

          {(syncStatus === 'offline' || syncStatus === 'failed') && (
            <PrimaryButton onClick={triggerSync} icon={RefreshCw} className="mt-4 mx-auto !w-auto !px-8">
              {isNe ? 'अहिले सिंक' : 'Sync Now'}
            </PrimaryButton>
          )}
          {syncStatus === 'synced' && (
            <p className="text-xs text-gray-400 mt-2">{isNe ? 'स्वचालित सिंक सक्रिय' : 'Auto-sync is active'}</p>
          )}
        </div>

        {/* Waiting to sync */}
        {syncItemsReady > 0 && syncStatus !== 'synced' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock size={14} style={{ color: colors.orange }} />
                <h3 className="text-xs font-bold text-gray-700">{isNe ? 'सिंक गर्न प्रतीक्षा' : 'Waiting to Sync'}</h3>
              </div>
              <span className="text-xs font-bold" style={{ color: colors.orange }}>{syncItemsReady}</span>
            </div>
            <div className="divide-y divide-gray-50">
              {SYNC_ITEMS.filter(i => i.count > 0).map(item => (
                <div key={item.label} className="px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <item.icon size={14} className="text-gray-400" />
                    <span className="text-[11px] text-gray-700">{isNe ? item.labelNe : item.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold" style={{ color: colors.orange }}>{item.count}</span>
                    <ChevronRight size={14} className="text-gray-300" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Saved locally */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <Shield size={14} style={{ color: colors.green }} />
            <h3 className="text-xs font-bold text-gray-700">{isNe ? 'स्थानीय रूपमा बचाइयो' : 'Saved Locally'}</h3>
          </div>
          <div className="px-4 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-700">{isNe ? 'कुल रेकर्डहरू' : 'Total records'}</span>
              <span className="text-xs font-bold" style={{ color: colors.navy }}>12</span>
            </div>
            <p className="text-[9px] text-gray-400 mt-1">{isNe ? 'सबै डाटा सुरक्षित रूपमा सुरक्षित छ' : 'All data is securely encrypted on this device'}</p>
          </div>
        </div>

        {/* Failed sync */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <XCircle size={14} style={{ color: colors.red }} />
            <h3 className="text-xs font-bold text-gray-700">{isNe ? 'सिंक असफल' : 'Failed Sync'}</h3>
          </div>
          {FAILED_ITEMS.length > 0 ? (
            <div className="divide-y divide-gray-50">
              {FAILED_ITEMS.map(item => (
                <div key={item.label} className="px-4 py-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-gray-700">{isNe ? item.labelNe : item.label}</span>
                    <StatusChip label={isNe ? 'असफल' : 'Failed'} variant="warning" />
                  </div>
                  <p className="text-[9px] text-gray-400">{isNe ? item.reasonNe : item.reason}</p>
                  <button className="mt-1.5 text-[9px] font-semibold flex items-center gap-1" style={{ color: colors.navy }}>
                    <RefreshCw size={10} /> {isNe ? 'पुन: प्रयास गर्नुहोस्' : 'Retry'}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-3 text-center">
              <CheckCircle size={16} className="mx-auto mb-1" style={{ color: colors.green }} />
              <p className="text-[10px] text-gray-500">{isNe ? 'कुनै असफल आइटमहरू छैनन्' : 'No failed items'}</p>
            </div>
          )}
        </div>

        {/* Security note */}
        <div className="rounded-xl p-3 border border-green-200" style={{ background: colors.greenLight }}>
          <div className="flex items-start gap-2">
            <Shield size={14} className="mt-0.5 flex-shrink-0" style={{ color: colors.green }} />
            <p className="text-[10px]" style={{ color: '#047857' }}>
              {isNe ? 'अफलाइन रेकर्डहरू यो उपकरणमा एन्क्रिप्ट गरिएका छन्' : 'Offline records are encrypted on this device'}
            </p>
          </div>
        </div>
      </div>

      <BottomNav activeTab="dashboard" />
    </div>
  );
}

