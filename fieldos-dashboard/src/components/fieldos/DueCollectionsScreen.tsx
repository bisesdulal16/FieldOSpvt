'use client';

import React from 'react';
import { Search, Sparkles, Plus, Filter } from 'lucide-react';
import { useFieldOSStore } from '@/store/fieldos-store';
import {
  AppHeader, BottomNav, StatusChip, ClientTaskCard,
  SectionHeader, AIRecommendationCard, colors
} from './shared';

const FILTERS = [
  { key: 'all', label: 'All Due' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Due Today' },
  { key: 'promise', label: 'Promise Due' },
  { key: 'high-value', label: 'High Value' },
  { key: 'sync', label: 'Pending Sync' },
];

const CLIENTS = [
  {
    name: 'Sunita Kumari Chaudhary', memberId: 'M-1042', center: 'Janakpur Center', ward: 'Ward 7, Butwal',
    dueAmount: 'NPR 5,500', status: 'overdue' as const, statusLabel: '8 Days Overdue',
    reason: 'Promise-to-pay due today + overdue',
  },
  {
    name: 'Rita Maya Tamang', memberId: 'M-1056', center: 'Bhaktapur Women Ctr', ward: 'Ward 3, Bhaktapur',
    dueAmount: 'NPR 3,200', status: 'due-today' as const, statusLabel: 'Due Today',
    reason: 'Regular weekly installment',
  },
  {
    name: 'Sita Devi Sah', memberId: 'M-1089', center: 'Kalika Women Center', ward: 'Ward 5, Kalanki',
    dueAmount: 'NPR 15,000', status: 'high-value' as const, statusLabel: 'High Value',
    reason: 'Due amount above NPR 10,000',
  },
  {
    name: 'Ramesh Thapa', memberId: 'M-1101', center: 'Pokhara Trade Ctr', ward: 'Ward 12, Pokhara',
    dueAmount: 'NPR 2,800', status: 'overdue' as const, statusLabel: '15 Days Overdue',
    reason: 'Multiple missed payments',
  },
  {
    name: 'Maya Devi Shrestha', memberId: 'M-1115', center: 'Lalitpur Savi Ctr', ward: 'Ward 2, Patan',
    dueAmount: 'NPR 4,100', status: 'promise' as const, statusLabel: 'Promise Due',
    reason: 'Previous promise expires today',
  },
  {
    name: 'Gita Kumari Gupta', memberId: 'M-1123', center: 'Chitwan Mahila Ctr', ward: 'Ward 8, Bharatpur',
    dueAmount: 'NPR 6,750', status: 'sync' as const, statusLabel: 'Pending Sync',
    reason: 'Collection recorded, pending CBS sync',
  },
];

export function DueCollectionsScreen() {
  const { activeFilter, setActiveFilter, navigate, setSelectedClient, language } = useFieldOSStore();
  const isNe = language === 'ne';

  const filteredClients = activeFilter === 'all'
    ? CLIENTS
    : CLIENTS.filter(c => {
        if (activeFilter === 'overdue') return c.status === 'overdue';
        if (activeFilter === 'today') return c.status === 'due-today';
        if (activeFilter === 'promise') return c.status === 'promise';
        if (activeFilter === 'high-value') return c.status === 'high-value';
        if (activeFilter === 'sync') return c.status === 'sync';
        return true;
      });

  return (
    <div className="flex flex-col min-h-full bg-[#F8FAFC]">
      <div className="bg-white">
        <AppHeader title={isNe ? 'कार्यहरू' : 'Due Collections'} />
        <div className="px-4 pb-3">
          {/* Summary */}
          <div className="flex items-center gap-4 mb-3">
            <div>
              <p className="text-lg font-bold" style={{ color: colors.navy }}>NPR 37,350</p>
              <p className="text-[10px] text-gray-500">{isNe ? 'कुल थप रकम' : 'Total Pending Amount'}</p>
            </div>
            <div className="w-px h-8 bg-gray-200" />
            <div>
              <p className="text-lg font-bold text-gray-800">6</p>
              <p className="text-[10px] text-gray-500">{isNe ? 'कुल क्लाइन्ट' : 'Total Clients'}</p>
            </div>
          </div>

          {/* Search */}
          <div className="flex items-center gap-2 rounded-xl px-3 py-2 border border-gray-200 bg-gray-50 mb-3">
            <Search size={14} className="text-gray-400" />
            <span className="text-xs text-gray-400 flex-1">{isNe ? 'क्लाइन्ट खोज्नुहोस्...' : 'Search clients...'}</span>
          </div>

          {/* Filter chips */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4">
            {FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setActiveFilter(f.key)}
                className="px-2.5 py-1 rounded-full text-[10px] font-semibold whitespace-nowrap border transition-all"
                style={{
                  background: activeFilter === f.key ? colors.navy : 'white',
                  color: activeFilter === f.key ? 'white' : colors.gray500,
                  borderColor: activeFilter === f.key ? colors.navy : colors.gray200,
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 py-3 space-y-3 overflow-y-auto pb-20">
        {/* AI Recommended */}
        <AIRecommendationCard
          title={isNe ? 'पहिलो सुझाव' : 'Recommended First'}
          reason={isNe ? 'कारण: प्रतिबद्धता आज थप + अतिरिक्त' : 'Reason: Promise-to-pay due today + overdue'}
          clientName="Sunita Kumari Chaudhary"
          action={isNe ? 'भेट थाल्नुहोस्' : 'Start Visit'}
          onAction={() => {
            setSelectedClient({ id: 'M-1042', name: 'Sunita Kumari Chaudhary', memberId: 'M-1042' });
            navigate('client-detail');
          }}
        />

        {/* Client list */}
        {filteredClients.map(client => (
          <ClientTaskCard
            key={client.memberId}
            {...client}
            onStartVisit={() => {
              setSelectedClient({ id: client.memberId, name: client.name, memberId: client.memberId });
              navigate('visit-checkin');
            }}
            onCollect={() => {
              setSelectedClient({ id: client.memberId, name: client.name, memberId: client.memberId });
              navigate('record-collection');
            }}
          />
        ))}
      </div>

      <BottomNav activeTab="due-collections" />
    </div>
  );
}

