'use client';

import React from 'react';
import {
  Bell, Clock, AlertTriangle, Cloud, ClipboardList, MapPin,
  Wallet, RefreshCw, User, Settings, FileText, Shield
} from 'lucide-react';
import { useFieldOSStore } from '@/store/fieldos-store';
import {
  AppHeader, BottomNav, StatusChip, NotificationCard, SyncChip, colors
} from './shared';

const NOTIFICATIONS = [
  {
    icon: Clock, iconColor: colors.red,
    title: 'Promise-to-pay due today',
    titleNe: 'आज प्रतिबद्धता थप',
    description: 'Sunita Kumari Chaudhary — NPR 5,500',
    descriptionNe: 'सुनिता कुमारी चौधरी — NPR 5,500',
    time: '2h ago', actionLabel: 'Start Visit', actionLabelNe: 'भेट थाल्नुहोस्',
    screen: 'client-detail' as const, filter: 'tasks',
  },
  {
    icon: Cloud, iconColor: colors.orange,
    title: '5 records pending sync',
    titleNe: '५ रेकर्डहरू पेन्डिङ सिंक',
    description: 'Sync when you have a stable connection',
    descriptionNe: 'स्थिर जडान भएपछि सिंक गर्नुहोस्',
    time: '30m ago', actionLabel: 'Sync Now', actionLabelNe: 'अहिले सिंक',
    screen: 'sync-center' as const, filter: 'alerts',
  },
  {
    icon: User, iconColor: colors.navy,
    title: 'Manager assigned task',
    titleNe: 'प्रबन्धकले कार्य दिए',
    description: 'Visit Ramesh Thapa for KYC update',
    descriptionNe: 'केवाईसी अपडेटको लागि रमेश थापालाई भेट गर्नुहोस्',
    time: '1h ago', actionLabel: 'View Task', actionLabelNe: 'कार्य हेर्नुहोस्',
    screen: 'due-collections' as const, filter: 'tasks',
  },
  {
    icon: Settings, iconColor: colors.gray500,
    title: 'App update available',
    titleNe: 'एप अपडेट उपलब्ध',
    description: 'FieldOS Nepal v2.2.0 — Security improvements',
    descriptionNe: 'FieldOS Nepal v2.2.0 — सुरक्षा सुधार',
    time: '3h ago', filter: 'system',
  },
  {
    icon: AlertTriangle, iconColor: colors.red,
    title: 'Overdue alert',
    titleNe: 'अतिरिक्त चेतावनी',
    description: 'Sita Devi Sah is 15 days overdue — NPR 15,000',
    descriptionNe: 'सीता देवी साह १५ दिन अतिरिक्त — NPR 15,000',
    time: '5h ago', actionLabel: 'View Client', actionLabelNe: 'क्लाइन्ट हेर्नुहोस्',
    screen: 'client-detail' as const, filter: 'alerts',
  },
  {
    icon: FileText, iconColor: colors.navy,
    title: 'Center meeting reminder',
    titleNe: 'केन्द्र बैठक स्मरण',
    description: 'Kalika Women Center — Tomorrow at 10:00 AM',
    descriptionNe: 'कालिका महिला केन्द्र — भोलि १०:०० AM',
    time: '6h ago', actionLabel: 'View Meeting', actionLabelNe: 'बैठक हेर्नुहोस्',
    screen: 'center-meeting' as const, filter: 'tasks',
  },
  {
    icon: Shield, iconColor: colors.green,
    title: 'Security audit completed',
    titleNe: 'सुरक्षा अडिट पूरा भयो',
    description: 'No security issues found on this device',
    descriptionNe: 'यो उपकरणमा कुनै सुरक्षा मुद्दा भेटिएन',
    time: '1d ago', filter: 'system',
  },
];

export function NotificationsScreen() {
  const { navigate, notificationFilter, setNotificationFilter, setSelectedClient, language, syncStatus } = useFieldOSStore();
  const isNe = language === 'ne';

  const FILTERS = [
    { key: 'all', label: 'All', labelNe: 'सबै' },
    { key: 'tasks', label: 'Tasks', labelNe: 'कार्य' },
    { key: 'alerts', label: 'Alerts', labelNe: 'चेतावनी' },
    { key: 'system', label: 'System', labelNe: 'प्रणाली' },
  ];

  const filtered = notificationFilter === 'all'
    ? NOTIFICATIONS
    : NOTIFICATIONS.filter(n => n.filter === notificationFilter);

  return (
    <div className="flex flex-col min-h-full bg-[#F8FAFC]">
      <div className="bg-white">
        <AppHeader
          title={isNe ? 'सूचनाहरू' : 'Notifications'}
          showBack
        />
        <div className="px-4 pb-3">
          <div className="flex items-center gap-3 mb-3">
            <SyncChip status={syncStatus} />
            <span className="text-[10px] text-gray-500">{filtered.length} {isNe ? 'सूचनाहरू' : 'notifications'}</span>
          </div>
          <div className="flex gap-1.5">
            {FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setNotificationFilter(f.key)}
                className="px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-all"
                style={{
                  background: notificationFilter === f.key ? colors.navy : 'white',
                  color: notificationFilter === f.key ? 'white' : colors.gray500,
                  borderColor: notificationFilter === f.key ? colors.navy : colors.gray200,
                }}
              >
                {isNe ? f.labelNe : f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 py-3 space-y-2 overflow-y-auto pb-20">
        {filtered.map((notif, i) => (
          <NotificationCard
            key={i}
            icon={notif.icon}
            iconColor={notif.iconColor}
            title={isNe ? notif.titleNe : notif.title}
            description={isNe ? notif.descriptionNe : notif.description}
            time={notif.time}
            actionLabel={notif.actionLabel ? (isNe ? notif.actionLabelNe : notif.actionLabel) : undefined}
            onAction={notif.screen ? () => {
              if (notif.screen === 'client-detail') {
                setSelectedClient({ id: 'M-1042', name: 'Sunita Kumari Chaudhary', memberId: 'M-1042' });
              }
              navigate(notif.screen!);
            } : undefined}
          />
        ))}
      </div>

      <BottomNav activeTab="dashboard" />
    </div>
  );
}

