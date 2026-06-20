'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard,
  Users,
  MapPin,
  Banknote,
  AlertTriangle,
  Clock,
  ShieldAlert,
  ClipboardCheck,
  RefreshCw,
  FileText,
  Menu,
  X,
  ArrowUpRight,
  XCircle,
  Building2,
  Wifi,
  WifiOff,
  AlertCircle,
  LogOut,
  Loader2,
  ChevronRight,
  Search,
  Bell,
  Database,
  GitCompareArrows,
  Send,
  CheckCircle2,
  XCircle as XCircleIcon,
  Download,
  TrendingDown,
  ArrowDownUp,
  Sparkles,
  Lightbulb,
  BarChart3,
  FileBarChart,
  Info,
  XCircle as XCircleDismiss,
  ChevronDown,
  ChevronUp,
  Zap,
  Brain,
  AlertOctagon,
  Shield,
  GitBranch,
  Smartphone,
  FileDown,
  BookOpen,
  ListChecks,
  Package,
  Plus,
  Lock,
  BadgeCheck,
  Rocket,
  GraduationCap,
  Target,
  MessageSquare,
  ExternalLink,
  Star,
  TrendingUp,
  ClipboardList,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { useManagerAPI, apiLogin, useAutoRefresh, useCBSAPI, useSecurityAPI, usePilotAPI, apiMutation } from '@/lib/useManagerAPI';

// ── Types ────────────────────────────────────────────────────────────────

type ViewId =
  | 'overview'
  | 'staff'
  | 'visits'
  | 'collections'
  | 'par'
  | 'ptp'
  | 'exceptions'
  | 'eod'
  | 'sync'
  | 'audit'
  | 'cbs-clients'
  | 'cbs-par'
  | 'reconciliation'
  | 'cbs-postings'
  | 'ai-priority'
  | 'ai-suggestions'
  | 'ai-eod'
  | 'ai-branch'
  | 'security-overview'
  | 'threat-model'
  | 'data-flow'
  | 'rbac-matrix'
  | 'security-audit'
  | 'device-mgmt'
  | 'incident-response'
  | 'policies'
  | 'pen-test'
  | 'dependency-scan'
  | 'api-security'
  | 'compliance-status'
  | 'pilot-overview'
  | 'pilot-branches'
  | 'pilot-documents'
  | 'pilot-training'
  | 'pilot-metrics'
  | 'pilot-feedback'
  | 'pilot-escalations'
  | 'pilot-agreements'
  | 'assign-task'
  | 'announcements';

interface StoredUser {
  name: string;
  staff_id: string;
  role: string;
  branch_name: string | null;
}

// ── Navigation Config ────────────────────────────────────────────────────

const NAV_ITEMS: { id: ViewId; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Branch Overview', icon: <LayoutDashboard className="h-5 w-5" /> },
  { id: 'staff', label: 'Staff Activity', icon: <Users className="h-5 w-5" /> },
  { id: 'visits', label: 'Visit Completion', icon: <MapPin className="h-5 w-5" /> },
  { id: 'collections', label: 'Collection Progress', icon: <Banknote className="h-5 w-5" /> },
  { id: 'par', label: 'PAR / Overdue Follow-up', icon: <AlertTriangle className="h-5 w-5" /> },
  { id: 'ptp', label: 'Promise-to-Pay Due', icon: <Clock className="h-5 w-5" /> },
  { id: 'exceptions', label: 'Exceptions Queue', icon: <ShieldAlert className="h-5 w-5" /> },
  { id: 'eod', label: 'End-of-Day Review', icon: <ClipboardCheck className="h-5 w-5" /> },
  { id: 'sync', label: 'Sync Monitoring', icon: <RefreshCw className="h-5 w-5" /> },
  { id: 'audit', label: 'Audit Logs', icon: <FileText className="h-5 w-5" /> },
  { id: 'assign-task', label: 'Assign Task', icon: <Plus className="h-5 w-5" /> },
  { id: 'announcements', label: 'Announcements', icon: <Bell className="h-5 w-5" /> },
];

const CBS_NAV_ITEMS: { id: ViewId; label: string; icon: React.ReactNode }[] = [
  { id: 'cbs-clients', label: 'CBS Client Data', icon: <Database className="h-5 w-5" /> },
  { id: 'cbs-par', label: 'CBS PAR Status', icon: <TrendingDown className="h-5 w-5" /> },
  { id: 'reconciliation', label: 'Reconciliation Queue', icon: <GitCompareArrows className="h-5 w-5" /> },
  { id: 'cbs-postings', label: 'CBS Postings & Audit', icon: <Send className="h-5 w-5" /> },
];

const AI_NAV_ITEMS: { id: ViewId; label: string; icon: React.ReactNode }[] = [
  { id: 'ai-priority', label: 'AI Insights', icon: <Sparkles className="h-5 w-5" /> },
  { id: 'ai-suggestions', label: 'AI Suggestions', icon: <Lightbulb className="h-5 w-5" /> },
  { id: 'ai-eod', label: 'AI EOD Summary', icon: <BarChart3 className="h-5 w-5" /> },
  { id: 'ai-branch', label: 'AI Branch Summary', icon: <FileBarChart className="h-5 w-5" /> },
];

const SECURITY_NAV_ITEMS: { id: ViewId; label: string; icon: React.ReactNode }[] = [
  // Security Overview hidden — no /security/overview endpoint (uses mock fallback)
  { id: 'threat-model', label: 'Threat Model', icon: <ShieldAlert className="h-5 w-5" /> },
  { id: 'data-flow', label: 'Data Flow Diagram', icon: <GitBranch className="h-5 w-5" /> },
  { id: 'rbac-matrix', label: 'RBAC Matrix', icon: <Users className="h-5 w-5" /> },
  { id: 'security-audit', label: 'Audit Log Export', icon: <FileDown className="h-5 w-5" /> },
  // Demo Data — hidden (no real device data)
  // { id: 'device-mgmt', label: 'Device Management', icon: <Smartphone className="h-5 w-5" /> },
  { id: 'incident-response', label: 'Incident Response', icon: <AlertTriangle className="h-5 w-5" /> },
  { id: 'policies', label: 'Policies', icon: <BookOpen className="h-5 w-5" /> },
  { id: 'pen-test', label: 'Pen Test Checklist', icon: <ListChecks className="h-5 w-5" /> },
  { id: 'dependency-scan', label: 'Dependency Scan', icon: <Package className="h-5 w-5" /> },
  { id: 'api-security', label: 'API Security Tests', icon: <Lock className="h-5 w-5" /> },
  { id: 'compliance-status', label: 'Compliance Status', icon: <BadgeCheck className="h-5 w-5" /> },
];

const PILOT_NAV_ITEMS: { id: ViewId; label: string; icon: React.ReactNode }[] = [
  { id: 'pilot-overview', label: 'Pilot Overview', icon: <Rocket className="h-5 w-5" /> },
  { id: 'pilot-branches', label: 'Branch Readiness', icon: <Building2 className="h-5 w-5" /> },
  // Demo Data — hidden (no real backend endpoints)
  // { id: 'pilot-documents', label: 'Pilot Documents', icon: <FileText className="h-5 w-5" /> },
  // { id: 'pilot-training', label: 'Training Tracker', icon: <GraduationCap className="h-5 w-5" /> },
  // { id: 'pilot-metrics', label: 'Success Metrics', icon: <Target className="h-5 w-5" /> },
  // { id: 'pilot-feedback', label: 'User Feedback', icon: <MessageSquare className="h-5 w-5" /> },
  // { id: 'pilot-escalations', label: 'Escalations', icon: <ArrowUpRight className="h-5 w-5" /> },
  // { id: 'pilot-agreements', label: 'Agreements', icon: <ClipboardList className="h-5 w-5" /> },
];

const ALL_NAV_ITEMS = [...NAV_ITEMS, ...AI_NAV_ITEMS, ...CBS_NAV_ITEMS, ...SECURITY_NAV_ITEMS, ...PILOT_NAV_ITEMS];

// ── Helpers ──────────────────────────────────────────────────────────────

function formatNpr(amount: number | null | undefined): string {
  if (amount == null) return 'NPR 0';
  return `NPR ${Math.round(amount).toLocaleString('en-NP')}`;
}

function getTodayStr(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return iso;
  }
}

function formatDateShort(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function formatTimeSeconds(date: Date | null): string {
  if (!date) return '';
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function pctColor(pct: number): string {
  if (pct >= 80) return '#16A34A';
  if (pct >= 50) return '#F59E0B';
  return '#DC2626';
}

function getRiskLevel(overdue_days: number, npa_risk: boolean): string {
  if (npa_risk || overdue_days >= 30) return 'critical';
  if (overdue_days >= 14) return 'medium';
  return 'low';
}

function getInitials(name: string): string {
  return (name || '??')
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .slice(0, 2);
}

// ── Sub-Components ───────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    inactive: 'bg-gray-100 text-gray-500',
    not_started: 'bg-gray-100 text-gray-400',
    online: 'bg-green-100 text-green-700',
    offline: 'bg-gray-100 text-gray-500',
    syncing: 'bg-amber-100 text-amber-700',
    synced: 'bg-green-100 text-green-700',
    completed: 'bg-green-100 text-green-700',
    pending: 'bg-amber-100 text-amber-700',
    failed: 'bg-red-100 text-red-700',
    submitted: 'bg-green-100 text-green-700',
    overdue: 'bg-red-100 text-red-700',
    open: 'bg-red-100 text-red-700',
    investigating: 'bg-amber-100 text-amber-700',
    resolved: 'bg-green-100 text-green-700',
    fulfilled: 'bg-green-100 text-green-700',
    partially_paid: 'bg-amber-100 text-amber-700',
    missed: 'bg-red-100 text-red-700',
    broken: 'bg-red-100 text-red-700',
    critical: 'bg-red-100 text-red-700',
    high: 'bg-red-100 text-red-700',
    medium: 'bg-amber-100 text-amber-700',
    low: 'bg-green-100 text-green-700',
    info: 'bg-blue-100 text-blue-700',
    warning: 'bg-amber-100 text-amber-700',
    error: 'bg-red-100 text-red-700',
    success: 'bg-green-100 text-green-700',
    confirmed: 'bg-green-100 text-green-700',
    npa_risk: 'bg-red-100 text-red-700',
    cash_mismatch: 'bg-red-100 text-red-700',
    high_value_unverified: 'bg-red-100 text-red-700',
    sync_failure: 'bg-amber-100 text-amber-700',
    eod_exception: 'bg-amber-100 text-amber-700',
    gps_anomaly: 'bg-amber-100 text-amber-700',
    collection_followup: 'bg-blue-100 text-blue-700',
    loan_disbursement: 'bg-green-100 text-green-700',
    pending_review: 'bg-amber-100 text-amber-700',
    approved: 'bg-blue-100 text-blue-700',
    rejected: 'bg-red-100 text-red-700',
    posted: 'bg-green-100 text-green-700',
    posting_failed: 'bg-red-100 text-red-700',
    matched: 'bg-green-100 text-green-700',
    mismatch: 'bg-red-100 text-red-700',
    cbs_only: 'bg-amber-100 text-amber-700',
    local_only: 'bg-gray-100 text-gray-500',
    current: 'bg-green-100 text-green-700',
    special_mention: 'bg-amber-100 text-amber-700',
    substandard: 'bg-orange-100 text-orange-700',
    doubtful: 'bg-red-100 text-red-700',
    loss: 'bg-red-100 text-red-700',
    reconciled: 'bg-green-100 text-green-700',
    paid: 'bg-green-100 text-green-700',
  };
  return (
    <Badge
      variant="secondary"
      className={`${map[status] || 'bg-gray-100 text-gray-600'} border-0 text-xs font-medium whitespace-nowrap`}
    >
      {(status ?? '').replace(/_/g, ' ')}
    </Badge>
  );
}

function DashboardTable({
  headers,
  rows,
  emptyMessage,
}: {
  headers: string[];
  rows: React.ReactNode[][];
  emptyMessage?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {headers.map((h, i) => (
                <th
                  key={i}
                  className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap text-xs uppercase tracking-wider"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={headers.length} className="text-center py-12 text-gray-400">
                  {emptyMessage || 'No data yet'}
                </td>
              </tr>
            ) : (
              rows.map((row, ri) => (
                <tr
                  key={ri}
                  className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                    ri % 2 === 1 ? 'bg-gray-50/50' : 'bg-white'
                  }`}
                >
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
        <p className="text-sm text-gray-400">Loading data...</p>
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="flex flex-col items-center gap-3 text-center max-w-md">
        <AlertCircle className="h-10 w-10 text-red-400" />
        <p className="text-sm text-red-600 font-medium">Failed to load data</p>
        <p className="text-xs text-gray-500">{message}</p>
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Retry
        </Button>
      </div>
    </div>
  );
}

// ── Login Screen ────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: (user: StoredUser, token: string) => void }) {
  const [staffId, setStaffId] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const result = await apiLogin(staffId.trim(), pin);

    if (result.success && result.user && result.token) {
      onLogin(result.user, result.token);
    } else {
      setError(result.error || 'Login failed');
    }

    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0B1B3A] px-4">
      <div className="w-full max-w-md">
        {/* Logo / Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-amber-500 mb-4">
            <Building2 className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">FieldOS Nepal</h1>
          <p className="text-sm text-gray-400 mt-1">Branch Manager Dashboard</p>
        </div>

        {/* Login Card */}
        <Card className="rounded-2xl shadow-xl border-gray-700 bg-white">
          <CardContent className="p-6">
            <h2 className="text-lg font-semibold text-gray-800 text-center mb-1">Sign In</h2>
            <p className="text-sm text-gray-500 text-center mb-6">
              Enter your credentials to access the dashboard
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="staffId" className="text-sm font-medium text-gray-700">
                  Staff ID
                </label>
                <Input
                  id="staffId"
                  placeholder="e.g. BM-001"
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value)}
                  autoComplete="username"
                  className="h-11"
                  required
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="pin" className="text-sm font-medium text-gray-700">
                  PIN
                </label>
                <Input
                  id="pin"
                  type="password"
                  placeholder="Enter your 4-digit PIN"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  autoComplete="current-password"
                  className="h-11"
                  maxLength={10}
                  required
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full h-11 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg"
                disabled={loading || !staffId.trim() || !pin}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>

            <p className="text-xs text-gray-400 text-center mt-4">
              Demo credentials: BM-001 / 1234
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── View Components (API-driven) ───────────────────────────────────────

// ---------- OVERVIEW ----------
function OverviewView({
  dashData,
  staffData,
  loading,
  error,
  onRetry,
}: {
  dashData: Record<string, unknown> | null;
  staffData: unknown[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (!dashData) return <ErrorState message="No dashboard data" onRetry={onRetry} />;

  const d = dashData;
  const officers = (Array.isArray(staffData) ? staffData : []).filter(
    (s: any) => s.role !== 'branch_manager'
  ) as any[];

  const kpis = [
    {
      label: 'Staff Started',
      value: `${d.staff_started ?? 0}/${d.staff_total ?? 0}`,
      trend: d.staff_started_pct != null ? `${d.staff_started_pct}%` : '—',
      good: true,
      icon: <Users className="h-5 w-5" />,
      iconBg: 'bg-blue-100',
      iconColor: 'text-blue-600',
    },
    {
      label: 'Visits Completed',
      value: `${d.visits_total ?? 0}`,
      trend:
        d.visits_vs_yesterday != null && typeof d.visits_vs_yesterday === 'number'
          ? `${d.visits_vs_yesterday > 0 ? '+' : ''}${d.visits_vs_yesterday}%`
          : '—',
      good: (d.visits_vs_yesterday as number) >= 0,
      icon: <MapPin className="h-5 w-5" />,
      iconBg: 'bg-green-100',
      iconColor: 'text-green-600',
    },
    {
      label: 'Collections Received',
      value: formatNpr(d.collections_total_npr as number | null | undefined),
      trend:
        d.collections_vs_yesterday != null && typeof d.collections_vs_yesterday === 'number'
          ? `${d.collections_vs_yesterday > 0 ? '+' : ''}${d.collections_vs_yesterday}%`
          : '—',
      good: (d.collections_vs_yesterday as number) >= 0,
      icon: <Banknote className="h-5 w-5" />,
      iconBg: 'bg-amber-100',
      iconColor: 'text-amber-600',
    },
    {
      label: 'Pending Verification',
      value: `${d.pending_verification ?? 0}`,
      trend: '',
      good: (d.pending_verification as number) === 0,
      icon: <AlertCircle className="h-5 w-5" />,
      iconBg: 'bg-orange-100',
      iconColor: 'text-orange-600',
    },
    {
      label: 'PAR Follow-up Due',
      value: `${d.par_followup_due ?? 0}`,
      trend: '',
      good: (d.par_followup_due as number) === 0,
      icon: <AlertTriangle className="h-5 w-5" />,
      iconBg: 'bg-red-100',
      iconColor: 'text-red-600',
    },
    {
      label: 'Missed PTP',
      value: `${d.missed_ptp ?? 0}`,
      trend: '',
      good: (d.missed_ptp as number) === 0,
      icon: <XCircle className="h-5 w-5" />,
      iconBg: 'bg-red-100',
      iconColor: 'text-red-600',
    },
    {
      label: 'Pending Sync',
      value: `${d.pending_sync ?? 0}`,
      trend: '',
      good: (d.pending_sync as number) === 0,
      icon: <RefreshCw className="h-5 w-5" />,
      iconBg: 'bg-purple-100',
      iconColor: 'text-purple-600',
    },
    {
      label: 'Exceptions',
      value: `${d.exceptions_count ?? 0}`,
      trend: '',
      good: (d.exceptions_count as number) === 0,
      icon: <ShieldAlert className="h-5 w-5" />,
      iconBg: 'bg-rose-100',
      iconColor: 'text-rose-600',
    },
    {
      label: 'Cash Mismatch',
      value: formatNpr(d.cash_mismatch_npr as number | null | undefined),
      trend: '',
      good: (d.cash_mismatch_npr as number) === 0,
      icon: <Banknote className="h-5 w-5" />,
      iconBg: 'bg-red-100',
      iconColor: 'text-red-600',
    },
  ];

  const topVisits = [...officers]
    .sort((a: any, b: any) => (b.visits_completed || 0) - (a.visits_completed || 0))
    .slice(0, 3);
  const topCollections = [...officers]
    .sort((a: any, b: any) => (b.collections_total_npr || 0) - (a.collections_total_npr || 0))
    .slice(0, 3);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800">Branch Overview</h2>
        <p className="text-sm text-gray-500 mt-1">Real-time KPIs for {getTodayStr()}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {kpis.map((kpi, i) => (
          <Card key={i} className="rounded-xl shadow-sm border-gray-200 hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">
                    {kpi.label}
                  </p>
                  <p className="text-2xl font-bold text-gray-800 mt-1">{kpi.value}</p>
                  {kpi.trend && (
                    <div className="mt-2">
                      <span
                        className={`inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded-full ${
                          kpi.good ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'
                        }`}
                      >
                        <ArrowUpRight className="h-3 w-3" />
                        {kpi.trend}
                      </span>
                    </div>
                  )}
                </div>
                <div
                  className={`flex items-center justify-center h-11 w-11 rounded-xl ${kpi.iconBg} ${kpi.iconColor} shrink-0`}
                >
                  {kpi.icon}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-green-600" /> Top Performers — Visits
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-3">
            {topVisits.length === 0 && <p className="text-sm text-gray-400">No data yet</p>}
            {topVisits.map((s: any) => (
              <div key={s.staff_id} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600">
                    {getInitials(s.name)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{s.name}</p>
                    <p className="text-xs text-gray-500">{s.staff_id}</p>
                  </div>
                </div>
                <span className="text-sm font-bold text-gray-800">
                  {s.visits_completed || 0}/{s.visits_total || 0}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Banknote className="h-4 w-4 text-amber-600" /> Top Performers — Collections
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-3">
            {topCollections.length === 0 && <p className="text-sm text-gray-400">No data yet</p>}
            {topCollections.map((s: any) => (
              <div key={s.staff_id} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600">
                    {getInitials(s.name)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{s.name}</p>
                    <p className="text-xs text-gray-500">{s.staff_id}</p>
                  </div>
                </div>
                <span className="text-sm font-bold text-gray-800">
                  {formatNpr(s.collections_total_npr)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------- STAFF ----------
function StaffView({ enabled }: { enabled: boolean }) {
  const { data, loading, error, refetch } = useManagerAPI<any[]>('staff', enabled);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createdStaff, setCreatedStaff] = useState<any>(null);
  const [formData, setFormData] = useState({ staff_id: '', name: '', phone_number: '', pin: '' });

  const staff = (Array.isArray(data) ? data : []).filter(
    (s: any) => s.role !== 'branch_manager'
  ) as any[];

  async function handleCreate() {
    if (!formData.staff_id || !formData.name || !formData.pin) return;
    setSubmitting(true);
    try {
      const resp = await fetch('/api/fieldos/manager/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!resp.ok) throw new Error('Failed to create staff');
      const result = await resp.json();
      setCreatedStaff({ staff_id: result.data.staff_id, pin: result.data.pin });
      setShowForm(false);
      setFormData({ staff_id: '', name: '', phone_number: '', pin: '' });
      refetch();
    } catch (e: any) {
      console.error('Create staff error:', e);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Staff Activity</h2>
          <p className="text-sm text-gray-500 mt-1">Live status of all field officers</p>
        </div>
        <Button
          onClick={() => { setShowForm(!showForm); setCreatedStaff(null); }}
          className="gap-1.5 bg-cyan-600 hover:bg-cyan-700"
        >
          <Plus className="h-4 w-4" /> {showForm ? 'Hide Form' : 'Add Field Officer'}
        </Button>
      </div>

      {createdStaff && (
        <Card className="rounded-xl shadow-sm border-green-200 bg-green-50">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-green-800 mb-2">Staff created successfully</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-gray-600">Staff ID:</span>{' '}
                <span className="font-mono font-bold text-gray-800">{createdStaff.staff_id}</span>
              </div>
              <div>
                <span className="text-gray-600">PIN:</span>{' '}
                <span className="font-mono font-bold text-gray-800">{createdStaff.pin}</span>
              </div>
            </div>
            <p className="text-xs text-green-600 mt-2">Share these credentials with the field officer</p>
          </CardContent>
        </Card>
      )}

      {showForm && (
        <Card className="rounded-xl shadow-sm border-2 border-cyan-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700">New Field Officer</CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-600 mb-1 block">Staff ID</label>
                <input
                  className="w-full h-9 rounded-md border border-gray-300 px-3 text-sm"
                  placeholder="FO-300"
                  value={formData.staff_id}
                  onChange={(e) => setFormData({ ...formData, staff_id: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">Name</label>
                <input
                  className="w-full h-9 rounded-md border border-gray-300 px-3 text-sm"
                  placeholder="Full name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-600 mb-1 block">Phone (optional)</label>
                <input
                  className="w-full h-9 rounded-md border border-gray-300 px-3 text-sm"
                  placeholder="+977-98XXXXXXX"
                  value={formData.phone_number}
                  onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">PIN</label>
                <input
                  className="w-full h-9 rounded-md border border-gray-300 px-3 text-sm"
                  placeholder="Min 4 digits"
                  type="password"
                  value={formData.pin}
                  onChange={(e) => setFormData({ ...formData, pin: e.target.value })}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={handleCreate}
                disabled={submitting || !formData.staff_id || !formData.name || !formData.pin}
                className="gap-1.5 bg-cyan-600 hover:bg-cyan-700"
              >
                <Loader2 className={`h-4 w-4 ${submitting ? 'animate-spin' : ''}`} />
                {submitting ? 'Creating...' : 'Create & Share Credentials'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <ScrollArea className="max-h-[600px]">
        <DashboardTable
          headers={['Officer', 'ID', 'Status', 'Visits', 'Collections', 'Sync', 'Last Sync']}
          rows={staff.map((s: any) => [
            <div key="name" className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600 shrink-0">
                {getInitials(s.name)}
              </div>
              <span className="font-medium text-gray-800">{s.name}</span>
            </div>,
            <span key="id" className="text-gray-500 font-mono text-xs">{s.staff_id}</span>,
            <StatusBadge key="status" status={s.day_started ? 'active' : 'not_started'} />,
            <span key="visits" className="font-semibold text-gray-800">
              {s.visits_completed || 0}
              <span className="text-gray-400 font-normal">/{s.visits_total || 0}</span>
            </span>,
            <span key="collections" className="font-medium text-gray-800">
              {formatNpr(s.collections_total_npr)}
            </span>,
            <div key="sync" className="flex items-center gap-1.5">
              {s.last_sync ? (
                <Wifi className="h-3.5 w-3.5 text-green-600" />
              ) : (
                <WifiOff className="h-3.5 w-3.5 text-gray-400" />
              )}
              <StatusBadge status={s.last_sync ? 'synced' : 'offline'} />
            </div>,
            <span key="lastSync" className="text-gray-500 text-xs">{formatTime(s.last_sync)}</span>,
          ])}
          emptyMessage="No staff data available"
        />
      </ScrollArea>
    </div>
  );
}

// ---------- VISITS ----------
function VisitView({
  enabled,
  staffData,
}: {
  enabled: boolean;
  staffData: unknown[];
}) {
  const { data, loading, error, refetch } = useManagerAPI<any[]>('visits', enabled);
  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const visits = Array.isArray(data) ? data : [];
  const officers = (Array.isArray(staffData) ? staffData : []).filter(
    (s: any) => s.role !== 'branch_manager'
  ) as any[];

  const totalCompleted = visits.length;
  const totalPlanned = officers.reduce((a: number, s: any) => a + (s.visits_total || 0), 0);
  const completionRate = totalPlanned > 0 ? Math.round((totalCompleted / totalPlanned) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800">Visit Completion</h2>
        <p className="text-sm text-gray-500 mt-1">Field officer visit progress for today</p>
      </div>

      <Card className="rounded-xl shadow-sm border-gray-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-700">Visits by Officer</CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          {officers.length === 0 && <p className="text-sm text-gray-400">No staff data available</p>}
          {officers.map((s: any) => {
            const pct =
              s.visits_total > 0
                ? Math.round(((s.visits_completed || 0) / s.visits_total) * 100)
                : 0;
            return (
              <div key={s.staff_id} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-800">{s.name}</span>
                    <span className="text-xs text-gray-400">({s.staff_id})</span>
                  </div>
                  <span className="text-gray-600 font-medium">
                    {s.visits_completed || 0}/{s.visits_total || 0}{' '}
                    <span className="text-gray-400">({pct}%)</span>
                  </span>
                </div>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, backgroundColor: pctColor(pct) }}
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="rounded-xl shadow-sm border-gray-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-700">
            Today&apos;s Visits
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <DashboardTable
            headers={['Time', 'Client', 'Member ID', 'Officer', 'Purpose']}
            rows={visits.map((v: any) => [
              <span key="time" className="text-gray-500 text-xs">
                {formatTime(v.checked_in_at)}
              </span>,
              <span key="client" className="font-medium text-gray-800">
                {v.client_name || '—'}
              </span>,
              <span key="mid" className="font-mono text-xs text-gray-500">
                {v.member_id || '—'}
              </span>,
              <span key="officer" className="text-gray-600">{v.officer_name || '—'}</span>,
              <StatusBadge key="purpose" status={v.purpose || 'collection'} />,
            ])}
            emptyMessage="No visits recorded today"
          />
        </CardContent>
      </Card>

      <Card className="rounded-xl shadow-sm border-gray-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-700">Summary</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-800">{totalCompleted}</p>
              <p className="text-xs text-gray-500 mt-1">Total Completed</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-800">{totalPlanned}</p>
              <p className="text-xs text-gray-500 mt-1">Total Planned</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">{completionRate}%</p>
              <p className="text-xs text-gray-500 mt-1">Completion Rate</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-amber-600">
                {Math.max(0, totalPlanned - totalCompleted)}
              </p>
              <p className="text-xs text-gray-500 mt-1">Remaining</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- COLLECTIONS ----------
function CollectionView({ enabled }: { enabled: boolean }) {
  const { data, loading, error, refetch } = useManagerAPI<any>('collections', enabled);
  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data) return <ErrorState message="No collection data" onRetry={refetch} />;

  const breakdown: any[] = Array.isArray(data.daily_breakdown) ? data.daily_breakdown : [];
  const recent: any[] = Array.isArray(data.recent) ? data.recent : [];
  const maxVal = Math.max(...breakdown.map((d: any) => d.target_npr || 1), 1);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800">Collection Progress</h2>
        <p className="text-sm text-gray-500 mt-1">Weekly collection target vs actual</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">
              Weekly Target
            </p>
            <p className="text-xl font-bold text-gray-800 mt-1">
              {formatNpr(data.weekly_target_npr)}
            </p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">
              Week Collected
            </p>
            <p className="text-xl font-bold text-green-600 mt-1">
              {formatNpr(data.week_collected_npr)}
            </p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">
              Achievement
            </p>
            <p className="text-xl font-bold text-amber-600 mt-1">
              {data.week_achievement_pct ?? 0}%
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-xl shadow-sm border-gray-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-700">Daily Collections</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {breakdown.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No daily breakdown available</p>
          ) : (
            <>
              <div className="flex items-end justify-between gap-2 h-52 px-2">
                {breakdown.map((d: any, i: number) => {
                  const targetH = Math.round(((d.target_npr || 0) / maxVal) * 180);
                  const collectedH = Math.round(((d.collected_npr || 0) / maxVal) * 180);
                  const dayPct =
                    d.target_npr > 0
                      ? Math.round(((d.collected_npr || 0) / d.target_npr) * 100)
                      : 0;
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-[10px] text-gray-500 font-medium">{dayPct}%</span>
                      <div className="flex items-end gap-1 h-[180px]">
                        <div
                          className="w-5 rounded-t-sm"
                          style={{ height: `${targetH}px`, backgroundColor: '#D1D5DB' }}
                          title={`Target: ${formatNpr(d.target_npr)}`}
                        />
                        <div
                          className="w-5 rounded-t-sm"
                          style={{
                            height: `${collectedH}px`,
                            backgroundColor: pctColor(dayPct),
                          }}
                          title={`Collected: ${formatNpr(d.collected_npr)}`}
                        />
                      </div>
                      <span className="text-[10px] font-semibold text-gray-600">
                        {new Date(d.date).toLocaleDateString('en-US', { weekday: 'short' })}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-center gap-6 mt-4 pt-3 border-t border-gray-100">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <div className="h-3 w-3 rounded-sm bg-gray-300" /> Target
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <div className="h-3 w-3 rounded-sm bg-green-500" /> Collected
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-xl shadow-sm border-gray-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-700">Recent Collections</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <ScrollArea className="max-h-[300px]">
            <DashboardTable
              headers={['Receipt', 'Client', 'Amount', 'Method', 'Officer', 'CBS']}
              rows={recent.map((r: any) => [
                <span key="receipt" className="font-mono text-xs text-gray-500">
                  {r.receipt_id}
                </span>,
                <span key="client" className="font-medium text-gray-800">
                  {r.client_name || '—'}
                </span>,
                <span key="amount" className="font-medium text-gray-800">
                  {formatNpr(r.amount_npr)}
                </span>,
                <span key="method" className="text-gray-500 capitalize">
                  {r.method || 'cash'}
                </span>,
                <span key="officer" className="text-gray-600">{r.officer_name || '—'}</span>,
                <StatusBadge key="cbs" status={r.cbs_verified ? 'confirmed' : 'pending'} />,
              ])}
              emptyMessage="No collections recorded today"
            />
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- PAR ----------
function ParView({ enabled }: { enabled: boolean }) {
  const { data, loading, error, refetch } = useManagerAPI<any[]>('par-followup', enabled);
  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const items: any[] = Array.isArray(data) ? data : [];
  const totalOverdueAmount = items.reduce(
    (a: number, p: any) => a + (p.due_amount_npr || 0),
    0
  );
  const avgOverdueDays =
    items.length > 0
      ? Math.round(
          items.reduce((a: number, p: any) => a + (p.overdue_days || 0), 0) / items.length
        )
      : 0;
  const criticalCount = items.filter(
    (p: any) => p.npa_risk || (p.overdue_days || 0) >= 30
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800">PAR / Overdue Follow-up</h2>
        <p className="text-sm text-gray-500 mt-1">
          {items.length} overdue clients requiring attention
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-red-600">{items.length}</p>
            <p className="text-xs text-gray-500 mt-1">Total Overdue</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-red-700">{criticalCount}</p>
            <p className="text-xs text-gray-500 mt-1">Critical Risk</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-600">{formatNpr(totalOverdueAmount)}</p>
            <p className="text-xs text-gray-500 mt-1">Total Overdue Amount</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-gray-800">{avgOverdueDays}</p>
            <p className="text-xs text-gray-500 mt-1">Avg Overdue Days</p>
          </CardContent>
        </Card>
      </div>
      <ScrollArea className="max-h-[500px]">
        <DashboardTable
          headers={['Client', 'Member ID', 'Center', 'Officer', 'Due Amount', 'Days', 'NPA Risk']}
          rows={items.map((p: any) => [
            <span key="client" className="font-medium text-gray-800">{p.client_name}</span>,
            <span key="mid" className="font-mono text-xs text-gray-500">{p.member_id}</span>,
            <span key="center" className="text-gray-600">{p.center}</span>,
            <span key="officer" className="text-gray-600">{p.assigned_officer || '—'}</span>,
            <span key="amount" className="font-medium text-red-600">
              {formatNpr(p.due_amount_npr)}
            </span>,
            <span
              key="days"
              className={p.overdue_days > 60 ? 'text-red-600 font-semibold' : 'text-amber-600'}
            >
              {p.overdue_days}d
            </span>,
            <StatusBadge
              key="risk"
              status={getRiskLevel(p.overdue_days || 0, p.npa_risk || false)}
            />,
          ])}
          emptyMessage="No overdue clients — all payments on track!"
        />
      </ScrollArea>
    </div>
  );
}

// ---------- PTP ----------
function PtpView({ enabled }: { enabled: boolean }) {
  const { data, loading, error, refetch } = useManagerAPI<any[]>('ptp-today', enabled);
  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const items: any[] = Array.isArray(data) ? data : [];
  const pending = items.filter((p: any) => p.status === 'pending').length;
  const fulfilled = items.filter((p: any) => p.status === 'fulfilled').length;
  const missed = items.filter(
    (p: any) => p.status === 'broken' || p.status === 'missed'
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800">Promise-to-Pay Due Today</h2>
        <p className="text-sm text-gray-500 mt-1">
          {items.length} clients with payment promises
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-gray-800">{items.length}</p>
            <p className="text-xs text-gray-500 mt-1">Total PTP</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-600">{pending}</p>
            <p className="text-xs text-gray-500 mt-1">Pending</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{fulfilled}</p>
            <p className="text-xs text-gray-500 mt-1">Fulfilled</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-red-600">{missed}</p>
            <p className="text-xs text-gray-500 mt-1">Missed / Broken</p>
          </CardContent>
        </Card>
      </div>
      <ScrollArea className="max-h-[500px]">
        <DashboardTable
          headers={['Client', 'Member ID', 'Center', 'Promised Amount', 'Officer', 'Status']}
          rows={items.map((p: any) => [
            <span key="client" className="font-medium text-gray-800">{p.client_name}</span>,
            <span key="mid" className="font-mono text-xs text-gray-500">{p.member_id}</span>,
            <span key="center" className="text-gray-600">{p.center}</span>,
            <span key="promised" className="font-medium text-gray-800">
              {formatNpr(p.promised_amount_npr)}
            </span>,
            <span key="officer" className="text-gray-600">{p.officer_name || '—'}</span>,
            <StatusBadge key="status" status={p.status} />,
          ])}
          emptyMessage="No PTP records for today"
        />
      </ScrollArea>
    </div>
  );
}

// ---------- EXCEPTIONS ----------
function ExceptionsView({ enabled }: { enabled: boolean }) {
  const { data, loading, error, refetch } = useManagerAPI<any[]>('exceptions', enabled);
  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const items: any[] = Array.isArray(data) ? data : [];
  const highCount = items.filter(
    (e: any) => e.severity === 'high' || e.severity === 'critical'
  ).length;
  const medCount = items.filter((e: any) => e.severity === 'medium').length;
  const lowCount = items.filter((e: any) => e.severity === 'low').length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800">Exceptions Queue</h2>
        <p className="text-sm text-gray-500 mt-1">
          {items.length} exceptions requiring review
        </p>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-red-600">{highCount}</p>
            <p className="text-xs text-gray-500 mt-1">High / Critical</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-600">{medCount}</p>
            <p className="text-xs text-gray-500 mt-1">Medium</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{lowCount}</p>
            <p className="text-xs text-gray-500 mt-1">Low</p>
          </CardContent>
        </Card>
      </div>
      <ScrollArea className="max-h-[500px]">
        <DashboardTable
          headers={['Type', 'Details', 'Severity', 'Raised By', 'Created']}
          rows={items.map((e: any) => [
            <StatusBadge key="type" status={e.type} />,
            <span key="details" className="text-gray-700 max-w-[300px] truncate">
              {e.details}
            </span>,
            <StatusBadge key="sev" status={e.severity} />,
            <span key="by" className="text-gray-600">{e.raised_by || 'System'}</span>,
            <span key="time" className="text-gray-500 text-xs">{formatTime(e.created_at)}</span>,
          ])}
          emptyMessage="No exceptions — everything looks good!"
        />
      </ScrollArea>
    </div>
  );
}

// ---------- EOD ----------
function EodView({ enabled }: { enabled: boolean }) {
  const { data, loading, error, refetch } = useManagerAPI<any>('eod-reviews', enabled);
  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data) return <ErrorState message="No EOD data" onRetry={refetch} />;

  const reviews: any[] = Array.isArray(data.reviews) ? data.reviews : [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800">End-of-Day Review</h2>
        <p className="text-sm text-gray-500 mt-1">EOD submission status for all officers</p>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{data.submitted ?? 0}</p>
            <p className="text-xs text-gray-500 mt-1">Submitted</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-600">{data.pending ?? 0}</p>
            <p className="text-xs text-gray-500 mt-1">Pending</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-red-600">{data.overdue ?? 0}</p>
            <p className="text-xs text-gray-500 mt-1">Overdue</p>
          </CardContent>
        </Card>
      </div>
      <ScrollArea className="max-h-[500px]">
        <DashboardTable
          headers={['Officer', 'ID', 'Date', 'Collections', 'Visits', 'Amount', 'Status']}
          rows={reviews.map((r: any) => [
            <span key="name" className="font-medium text-gray-800">{r.officer_name}</span>,
            <span key="sid" className="font-mono text-xs text-gray-500">{r.staff_id}</span>,
            <span key="date" className="text-gray-600">{formatDateShort(r.report_date)}</span>,
            <span key="count" className="font-semibold text-gray-800">
              {r.collections_count ?? 0}
            </span>,
            <span key="visits" className="font-medium text-gray-800">{r.visits_count ?? 0}</span>,
            <span key="npr" className="font-medium text-gray-800">
              {formatNpr(r.collections_npr)}
            </span>,
            <StatusBadge key="status" status={r.status} />,
          ])}
          emptyMessage="No EOD reports submitted yet"
        />
      </ScrollArea>
    </div>
  );
}

// ---------- SYNC ----------
function SyncView({ enabled }: { enabled: boolean }) {
  const { data, loading, error, refetch } = useManagerAPI<any>('sync-status', enabled);
  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data) return <ErrorState message="No sync data" onRetry={refetch} />;

  const devices: any[] = Array.isArray(data.devices) ? data.devices : [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800">Sync Monitoring</h2>
        <p className="text-sm text-gray-500 mt-1">Device sync status and pending events</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-gray-800">{data.total_events ?? 0}</p>
            <p className="text-xs text-gray-500 mt-1">Total Events</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{data.synced ?? 0}</p>
            <p className="text-xs text-gray-500 mt-1">Synced</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-600">{data.pending ?? 0}</p>
            <p className="text-xs text-gray-500 mt-1">Pending</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-red-600">{data.failed ?? 0}</p>
            <p className="text-xs text-gray-500 mt-1">Failed</p>
          </CardContent>
        </Card>
      </div>
      <ScrollArea className="max-h-[500px]">
        <DashboardTable
          headers={['Device', 'User', 'Status', 'Last Sync', 'Pending', 'Failed']}
          rows={devices.map((d: any) => [
            <span key="dev" className="font-mono text-xs text-gray-500 max-w-[120px] truncate">
              {d.device_id?.split('-').slice(0, 2).join('-') || '—'}
            </span>,
            <span key="user" className="font-medium text-gray-800">{d.user_name || '—'}</span>,
            <StatusBadge key="status" status={d.status} />,
            <span key="sync" className="text-gray-500 text-xs">{formatTime(d.last_sync)}</span>,
            <span
              key="pend"
              className={d.pending > 0 ? 'text-amber-600 font-semibold' : 'text-gray-400'}
            >
              {d.pending}
            </span>,
            <span
              key="fail"
              className={d.failed > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}
            >
              {d.failed}
            </span>,
          ])}
          emptyMessage="No devices registered"
        />
      </ScrollArea>
    </div>
  );
}

// ---------- AUDIT ----------
function AuditView({ enabled }: { enabled: boolean }) {
  const { data, loading, error, refetch } = useManagerAPI<any[]>('audit-logs', enabled);
  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const logs: any[] = Array.isArray(data) ? data : [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800">Audit Logs</h2>
        <p className="text-sm text-gray-500 mt-1">{logs.length} recent audit events</p>
      </div>
      <ScrollArea className="max-h-[600px]">
        <DashboardTable
          headers={['Time', 'Action', 'Description', 'User', 'Entity']}
          rows={logs.map((l: any) => [
            <span key="time" className="text-gray-500 text-xs">{formatTime(l.created_at)}</span>,
            <StatusBadge key="action" status={l.action_type || 'info'} />,
            <span key="desc" className="text-gray-700 max-w-[300px] truncate">
              {l.description || '—'}
            </span>,
            <span key="user" className="text-gray-600">{l.user_name || 'System'}</span>,
            <span key="entity" className="text-gray-500 text-xs">{l.entity_type || '—'}</span>,
          ])}
          emptyMessage="No audit logs yet"
        />
      </ScrollArea>
    </div>
  );
}

// ---------- CBS CLIENTS (Phase 12A) ----------
function CbsClientsView({ enabled }: { enabled: boolean }) {
  const { data, loading, error, refetch } = useCBSAPI<any[]>('clients', enabled);
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [showDetail, setShowDetail] = useState<number | null>(null);
  const { data: detailData, loading: detailLoading } = useCBSAPI<any>(
    `clients/${showDetail}/detail`,
    !!showDetail
  );

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const clients: any[] = Array.isArray(data) ? data : [];
  const filtered = search
    ? clients.filter((c: any) =>
        String(c.name || '').toLowerCase().includes(search.toLowerCase()) ||
        String(c.cbs_member_id || '').toLowerCase().includes(search.toLowerCase())
      )
    : clients;

  const matched = filtered.filter((c: any) => c.sync_status === 'matched').length;
  const mismatched = filtered.filter((c: any) => c.sync_status === 'mismatch').length;

  async function handleImport() {
    setImporting(true);
    setImportResult(null);
    const res = await apiMutation('cbs/import', 'POST');
    setImportResult(res.data || res.error);
    setImporting(false);
    if (res.success) refetch();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-800">CBS Client Data</h2>
          <p className="text-sm text-gray-500 mt-1">Core Banking System client comparison</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleImport} disabled={importing}>
            <Download className="h-3.5 w-3.5 mr-1.5" />
            {importing ? 'Importing...' : 'Sync from CBS'}
          </Button>
        </div>
      </div>

      {importResult && (
        <div className={`flex items-center gap-2 text-sm rounded-lg px-4 py-2.5 ${typeof importResult === 'string' && importResult.includes('error') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
          {typeof importResult === 'object' ? (
            <>Imported: {importResult.clients_imported} clients, {importResult.loans_imported} loans, {importResult.schedule_items_imported} schedule items</>
          ) : (
            <>{importResult}</>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{matched}</p>
            <p className="text-xs text-gray-500 mt-1">Matched</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-red-600">{mismatched}</p>
            <p className="text-xs text-gray-500 mt-1">Mismatched</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-gray-800">{filtered.length}</p>
            <p className="text-xs text-gray-500 mt-1">Total CBS Clients</p>
          </CardContent>
        </Card>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="Search by name or member ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-10"
        />
      </div>

      <ScrollArea className="max-h-[500px]">
        <DashboardTable
          headers={['Client', 'CBS ID', 'Center', 'CBS Balance', 'Local Balance', 'Diff', 'Sync']}
          rows={filtered.map((c: any) => [
            <button key="name" className="font-medium text-gray-800 hover:text-amber-600 hover:underline text-left" onClick={() => setShowDetail(c.id)}>
              {c.name}
            </button>,
            <span key="cbsid" className="font-mono text-xs text-gray-500">{c.cbs_member_id}</span>,
            <span key="center" className="text-gray-600">{c.center_name || '—'}</span>,
            <span key="cbs" className="font-medium text-gray-800">{formatNpr(c.cbs_balance)}</span>,
            <span key="local" className="text-gray-600">{formatNpr(c.local_balance)}</span>,
            <span key="diff" className={`font-medium ${Math.abs(c.balance_diff) < 0.01 ? 'text-green-600' : 'text-red-600'}`}>
              {c.balance_diff >= 0 ? '+' : ''}{c.balance_diff?.toLocaleString('en-NP', { maximumFractionDigits: 0 })}
            </span>,
            <StatusBadge key="sync" status={c.sync_status} />,
          ])}
          emptyMessage="No CBS clients found. Click 'Sync from CBS' to import." />
        </ScrollArea>

      {/* Client Detail Modal */}
      {showDetail && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowDetail(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-800">CBS Client Detail</h3>
              <button onClick={() => setShowDetail(null)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <ScrollArea className="max-h-[calc(80vh-64px)] p-6">
              {detailLoading ? <LoadingSkeleton /> : detailData ? (
                <div className="space-y-4">
                  {detailData.client && (
                    <Card className="rounded-xl border-gray-200">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-semibold text-gray-700">Client Information</CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0">
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div><span className="text-gray-500">Name:</span> <span className="font-medium">{detailData.client.name}</span></div>
                          <div><span className="text-gray-500">CBS ID:</span> <span className="font-mono">{detailData.client.cbs_member_id}</span></div>
                          <div><span className="text-gray-500">Center:</span> {detailData.client.center_name}</div>
                          <div><span className="text-gray-500">Outstanding:</span> <span className="font-medium">{formatNpr(detailData.client.outstanding_balance)}</span></div>
                          <div><span className="text-gray-500">Due Amount:</span> {formatNpr(detailData.client.due_amount)}</div>
                          <div><span className="text-gray-500">Overdue Days:</span> {detailData.client.overdue_days}</div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  {(detailData.loans || []).map((loan: any) => (
                    <Card key={loan.id} className="rounded-xl border-gray-200">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-semibold text-gray-700 flex items-center justify-between">
                          <span>{loan.cbs_loan_id}</span>
                          <StatusBadge status={loan.par_status} />
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0 space-y-3">
                        <div className="grid grid-cols-3 gap-3 text-sm">
                          <div><span className="text-gray-500">Principal:</span> <span className="font-medium">{formatNpr(loan.principal_amount)}</span></div>
                          <div><span className="text-gray-500">Outstanding:</span> {formatNpr(loan.outstanding_balance)}</div>
                          <div><span className="text-gray-500">Installment:</span> {formatNpr(loan.installment_amount)}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-green-500" style={{ width: `${loan.installment_progress?.pct || 0}%` }} />
                          </div>
                          <span className="text-xs text-gray-500 whitespace-nowrap">{loan.installment_progress?.paid}/{loan.installment_progress?.total} ({loan.installment_progress?.pct}%)</span>
                        </div>
                        {loan.schedule_items && loan.schedule_items.length > 0 && (
                          <DashboardTable
                            headers={['#', 'Due Date', 'Due', 'Paid', 'Status', 'Days Overdue']}
                            rows={loan.schedule_items.map((s: any) => [
                              <span key="n" className="text-gray-500 text-xs">{s.installment_no}</span>,
                              <span key="d" className="text-gray-600 text-xs">{s.due_date}</span>,
                              <span key="due" className="font-medium">{formatNpr(s.due_amount)}</span>,
                              <span key="paid" className={s.paid_amount > 0 ? 'text-green-600' : 'text-gray-400'}>{formatNpr(s.paid_amount)}</span>,
                              <StatusBadge key="s" status={s.status} />,
                              <span key="ov" className={s.days_overdue > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}>{s.days_overdue}d</span>,
                            ])}
                            emptyMessage="No schedule items"
                          />
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : <p className="text-gray-400 text-center py-8">No detail available</p>}
            </ScrollArea>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- CBS PAR STATUS (Phase 12A) ----------
function CbsParView({ enabled }: { enabled: boolean }) {
  const { data, loading, error, refetch } = useCBSAPI<any>('par-status', enabled);
  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data) return <ErrorState message="No PAR data" onRetry={refetch} />;

  const breakdown: Record<string, any> = data.breakdown || {};
  const nonCurrent: any[] = Array.isArray(data.non_current_loans) ? data.non_current_loans : [];

  const parColors: Record<string, string> = {
    current: 'text-green-600',
    'special mention': 'text-amber-600',
    substandard: 'text-orange-600',
    doubtful: 'text-red-600',
    loss: 'text-red-700',
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800">CBS PAR Status</h2>
        <p className="text-sm text-gray-500 mt-1">Portfolio at Risk classification from CBS</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-gray-800">{data.total_loans ?? 0}</p>
            <p className="text-xs text-gray-500 mt-1">Total Loans</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-gray-800">{formatNpr(data.total_outstanding)}</p>
            <p className="text-xs text-gray-500 mt-1">Total Outstanding</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className={`text-2xl font-bold ${(data.par_ratio ?? 0) > 5 ? 'text-red-600' : 'text-green-600'}`}>{data.par_ratio ?? 0}%</p>
            <p className="text-xs text-gray-500 mt-1">PAR Ratio</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-red-600">{formatNpr(data.par_outstanding)}</p>
            <p className="text-xs text-gray-500 mt-1">PAR Outstanding</p>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-xl shadow-sm border-gray-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-700">PAR Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {Object.entries(breakdown).map(([status, info]: [string, any]) => (
            <div key={status} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
              <div className="flex items-center gap-2">
                <StatusBadge status={status} />
                <span className="text-sm font-medium text-gray-700 capitalize">{(status ?? '').replace('_', ' ')}</span>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-gray-600">{info.count} loans</span>
                <span className={`font-medium ${parColors[status] || 'text-gray-800'}`}>{formatNpr(info.outstanding)}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {nonCurrent.length > 0 && (
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700">Non-Current Loans</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <ScrollArea className="max-h-[300px]">
              <DashboardTable
                headers={['Loan ID', 'PAR Status', 'Outstanding', 'Product']}
                rows={nonCurrent.map((l: any) => [
                  <span key="id" className="font-mono text-xs text-gray-500">{l.cbs_loan_id}</span>,
                  <StatusBadge key="par" status={l.par_status} />,
                  <span key="bal" className="font-medium text-red-600">{formatNpr(l.outstanding_balance)}</span>,
                  <span key="prod" className="text-gray-600 capitalize">{(l.product_type ?? '').replace('_', ' ')}</span>,
                ])}
                emptyMessage="All loans are current"
              />
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------- RECONCILIATION QUEUE (Phase 12B) ----------
function ReconciliationView({ enabled }: { enabled: boolean }) {
  const { data, loading, error, refetch } = useCBSAPI<any[]>('reconciliation/queue', enabled);
  const [statusFilter, setStatusFilter] = useState('pending_review');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const allEvents: any[] = Array.isArray(data) ? data : [];
  const events = allEvents.filter((e: any) => !statusFilter || e.event_status === statusFilter);

  const pendingCount = allEvents.filter((e: any) => e.event_status === 'pending_review').length;
  const approvedCount = allEvents.filter((e: any) => e.event_status === 'approved').length;
  const rejectedCount = allEvents.filter((e: any) => e.event_status === 'rejected').length;
  const postedCount = allEvents.filter((e: any) => e.event_status === 'posted').length;

  async function handleAction(eventId: number, action: 'approve' | 'reject') {
    setActionLoading(`${eventId}-${action}`);
    await apiMutation(`cbs/reconciliation/${eventId}/${action}`, 'POST', action === 'reject' ? { note: '' } : {});
    setActionLoading(null);
    refetch();
  }

  async function handleBulkApprove() {
    const pendingIds = events.filter((e: any) => e.event_status === 'pending_review').map((e: any) => e.id);
    if (pendingIds.length === 0) return;
    setActionLoading('bulk');
    await apiMutation('cbs/reconciliation/bulk-approve', 'POST', { event_ids: pendingIds });
    setActionLoading(null);
    refetch();
  }

  const totalAmount = events.reduce((a: number, e: any) => a + (e.amount || 0), 0);

  const filterOptions = [
    { value: 'pending_review', label: 'Pending Review', count: pendingCount },
    { value: 'approved', label: 'Approved', count: approvedCount },
    { value: 'rejected', label: 'Rejected', count: rejectedCount },
    { value: 'posted', label: 'Posted', count: postedCount },
    { value: '', label: 'All', count: allEvents.length },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Reconciliation Queue</h2>
          <p className="text-sm text-gray-500 mt-1">Review and approve collection events before CBS posting</p>
        </div>
        {pendingCount > 0 && (
          <Button size="sm" className="bg-amber-500 hover:bg-amber-600" onClick={handleBulkApprove} disabled={actionLoading === 'bulk'}>
            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
            {actionLoading === 'bulk' ? 'Approving...' : `Approve All (${pendingCount})`}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-4 gap-4">
        {filterOptions.map((f) => (
          <Card key={f.value || 'all'} className={`rounded-xl shadow-sm cursor-pointer transition-colors ${statusFilter === f.value ? 'border-amber-400 ring-1 ring-amber-400' : 'border-gray-200 hover:border-gray-300'}`} onClick={() => setStatusFilter(f.value)}>
            <CardContent className="p-4 text-center">
              <p className={`text-2xl font-bold ${f.value === 'pending_review' ? 'text-amber-600' : f.value === 'approved' ? 'text-blue-600' : f.value === 'rejected' ? 'text-red-600' : f.value === 'posted' ? 'text-green-600' : 'text-gray-800'}`}>{f.count}</p>
              <p className="text-xs text-gray-500 mt-1">{f.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-center gap-4 text-sm text-gray-500">
        <span>Total: {events.length} events</span>
        <span>Total Amount: <span className="font-medium text-gray-800">{formatNpr(totalAmount)}</span></span>
      </div>

      <ScrollArea className="max-h-[500px]">
        <DashboardTable
          headers={['Receipt', 'Client', 'Amount', 'Officer', 'Status', 'Idempotency Key', 'Actions']}
          rows={events.map((e: any) => [
            <span key="rcpt" className="font-mono text-xs text-gray-500">{e.receipt_id}</span>,
            <div key="client">
              <p className="font-medium text-gray-800 text-sm">{e.client_name || '—'}</p>
              <p className="text-xs text-gray-400">{e.member_id}</p>
            </div>,
            <span key="amt" className="font-medium text-gray-800">{formatNpr(e.amount)}</span>,
            <span key="off" className="text-gray-600 text-sm">{e.officer_name || '—'}</span>,
            <StatusBadge key="st" status={e.event_status} />,
            <span key="idem" className="font-mono text-[10px] text-gray-400 max-w-[100px] truncate">{e.idempotency_key}</span>,
            <div key="act" className="flex items-center gap-1">
              {e.event_status === 'pending_review' && (
                <>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-green-600 hover:bg-green-50" disabled={actionLoading === `${e.id}-approve`} onClick={() => handleAction(e.id, 'approve')}>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-red-600 hover:bg-red-50" disabled={actionLoading === `${e.id}-reject`} onClick={() => handleAction(e.id, 'reject')}>
                    <XCircle className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
              {e.event_status === 'posted' && e.cbs_posting_ref && (
                <span className="text-[10px] text-gray-400 font-mono">{e.cbs_posting_ref}</span>
              )}
            </div>,
          ])}
          emptyMessage="No events in this category"
        />
      </ScrollArea>
    </div>
  );
}

// ---------- CBS POSTINGS & AUDIT (Phase 12C) ----------
function CbsPostingsView({ enabled }: { enabled: boolean }) {
  const { data: postingsData, loading: postingsLoading, error: postingsError, refetch: refetchPostings } = useCBSAPI<any>('posting/log', enabled);
  const { data: reportData, loading: reportLoading, error: reportError } = useCBSAPI<any>('reconciliation/report', enabled);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState('');

  async function handleSubmitPosting() {
    setSubmitting(true);
    setSubmitResult(null);
    // Get approved events from queue
    const queueRes = await fetch('/api/fieldos/cbs/reconciliation/queue?event_status=approved');
    const queueJson = await queueRes.json();
    const approvedEvents: any[] = queueJson.data || [];
    if (approvedEvents.length === 0) {
      setSubmitResult({ error: 'No approved events to post' });
      setSubmitting(false);
      return;
    }
    const res = await apiMutation('cbs/posting/submit', 'POST', { event_ids: approvedEvents.map((e: any) => e.id) });
    setSubmitResult(res.success ? res.data : { error: res.error });
    setSubmitting(false);
    refetchPostings();
  }

  async function handleReconcile(postingId: number) {
    await apiMutation(`cbs/posting/${postingId}/reconcile`, 'POST');
    refetchPostings();
  }

  const postings: any[] = Array.isArray(postingsData) ? postingsData : [];
  const filtered = statusFilter ? postings.filter((p: any) => p.status === statusFilter) : postings;

  if (postingsLoading || reportLoading) return <LoadingSkeleton />;
  if (postingsError) return <ErrorState message={postingsError} onRetry={refetchPostings} />;

  const report = reportData || {};

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-800">CBS Postings & Audit</h2>
          <p className="text-sm text-gray-500 mt-1">Controlled write-back to CBS with full audit trail</p>
        </div>
        <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={handleSubmitPosting} disabled={submitting}>
          <Send className="h-3.5 w-3.5 mr-1.5" />
          {submitting ? 'Posting...' : 'Post Approved to CBS'}
        </Button>
      </div>

      {submitResult && (
        <div className={`flex items-center gap-2 text-sm rounded-lg px-4 py-2.5 ${submitResult.error ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
          {submitResult.error ? (
            <>{submitResult.error}</>
          ) : (
            <>Posted: {submitResult.posted_count} success, {submitResult.failed_count} failed</>
          )}
        </div>
      )}

      {/* Reconciliation Report */}
      <Card className="rounded-xl shadow-sm border-gray-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-700">Reconciliation Summary</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-800">{report.total_events ?? 0}</p>
              <p className="text-xs text-gray-500 mt-1">Total Events</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">{report.posting_success_rate ?? 0}%</p>
              <p className="text-xs text-gray-500 mt-1">Posting Success Rate</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-amber-600">{report.pending_review_count ?? 0}</p>
              <p className="text-xs text-gray-500 mt-1">Pending Review</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-red-600">{report.mismatched_count ?? 0}</p>
              <p className="text-xs text-gray-500 mt-1">CBS Mismatches</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Posting Filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {['', 'success', 'failed', 'reconciled'].map((s) => (
          <Button key={s || 'all'} size="sm" variant={statusFilter === s ? 'default' : 'outline'} className="h-8 text-xs" onClick={() => setStatusFilter(s)}>
            {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}
          </Button>
        ))}
        <span className="text-xs text-gray-400 ml-2">{filtered.length} postings</span>
      </div>

      <ScrollArea className="max-h-[500px]">
        <DashboardTable
          headers={['Receipt', 'Amount', 'Client', 'Status', 'Idempotency Key', 'Created', 'Actions']}
          rows={filtered.map((p: any) => [
            <span key="rcpt" className="font-mono text-xs text-gray-500">{p.receipt_id}</span>,
            <span key="amt" className="font-medium text-gray-800">{formatNpr(p.amount)}</span>,
            <span key="client" className="text-gray-600 text-sm">{p.client_id || '—'}</span>,
            <StatusBadge key="st" status={p.status} />,
            <span key="idem" className="font-mono text-[10px] text-gray-400 max-w-[100px] truncate">{p.idempotency_key}</span>,
            <span key="created" className="text-gray-500 text-xs">{formatTime(p.created_at)}</span>,
            <div key="act">
              {p.status === 'success' && (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-green-600 hover:bg-green-50" onClick={() => handleReconcile(p.id)}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                  Reconcile
                </Button>
              )}
              {p.error_message && (
                <span className="text-xs text-red-500 max-w-[150px] truncate" title={p.error_message}>{p.error_message}</span>
              )}
            </div>,
          ])}
          emptyMessage="No CBS postings yet"
        />
      </ScrollArea>
    </div>
  );
}

// ---------- AI PRIORITY QUEUE ----------
function PriorityQueueView({ enabled }: { enabled: boolean }) {
  const { data, loading, error, refetch } = useManagerAPI<any>('manager/ai/priority-queue', enabled);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data) return <ErrorState message="No priority data" onRetry={refetch} />;

  const clients: any[] = Array.isArray(data.queue) ? data.queue : [];
  const tiers = data.tier_counts || {};

  const tierColors: Record<string, string> = {
    critical: 'bg-red-100 text-red-700',
    high: 'bg-orange-100 text-orange-700',
    medium: 'bg-amber-100 text-amber-700',
    low: 'bg-green-100 text-green-700',
    normal: 'bg-gray-100 text-gray-600',
  };

  const scoreBgColor = (tier: string) => {
    switch (tier) {
      case 'critical': return 'bg-red-500 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'medium': return 'bg-amber-500 text-white';
      case 'low': return 'bg-green-500 text-white';
      default: return 'bg-gray-200 text-gray-700';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-500" /> AI Client Priority Queue
            <Badge variant="secondary" className="ml-2 text-xs bg-amber-100 text-amber-800">Demo Reference</Badge>
          </h2>
          <p className="text-sm text-gray-500 mt-1">Clients ranked by AI risk priority score</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-gray-800">{clients.length}</p>
            <p className="text-xs text-gray-500 mt-1">Total Clients</p>
          </CardContent>
        </Card>
        {(['critical', 'high', 'medium', 'low', 'normal'] as const).map((tier) => (
          <Card key={tier} className="rounded-xl shadow-sm border-gray-200">
            <CardContent className="p-4 text-center">
              <p className={`text-2xl font-bold ${tierColors[tier]?.split(' ')[1] || 'text-gray-800'}`}>
                {tiers[tier] ?? 0}
              </p>
              <p className="text-xs text-gray-500 mt-1 capitalize">{tier}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <ScrollArea className="max-h-[600px]">
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wider w-12">Rank</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wider">Client</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wider">Member ID</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wider">Officer</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wider">Score</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wider">Tier</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wider">Key Factors</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wider w-10"></th>
                </tr>
              </thead>
              <tbody>
                {clients.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-gray-400">
                      No priority data available
                    </td>
                  </tr>
                ) : (
                  clients.map((c: any, i: number) => (
                    <React.Fragment key={i}>
                      <tr
                        className={`border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer ${i % 2 === 1 ? 'bg-gray-50/50' : 'bg-white'}`}
                        onClick={() => setExpandedRow(expandedRow === i ? null : i)}
                      >
                        <td className="px-4 py-3 text-gray-500 font-medium">{i + 1}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-7 w-7 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-bold text-gray-600 shrink-0">
                              {getInitials(c.client_name)}
                            </div>
                            <span className="font-medium text-gray-800">{c.client_name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500">{c.member_id || '—'}</td>
                        <td className="px-4 py-3 text-gray-600">{c.officer_name || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center justify-center h-8 w-12 rounded-lg text-sm font-bold ${scoreBgColor(c.tier)}`}>
                            {c.score ?? 0}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="secondary" className={`${tierColors[c.tier] || 'bg-gray-100 text-gray-600'} border-0 text-xs font-medium`}>
                            {c.tier || 'normal'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {(Array.isArray(c.factors) ? c.factors : []).slice(0, 3).map((f: any, fi: number) => (
                              <span key={fi} className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                                +{f.points ?? 0}
                                <span className="text-gray-400">{f.label || ''}</span>
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-400">
                          {expandedRow === i ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </td>
                      </tr>
                      {expandedRow === i && c.suggestion && (
                        <tr className="bg-amber-50/50">
                          <td colSpan={8} className="px-4 py-3">
                            <div className="flex items-start gap-2">
                              <Lightbulb className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                              <p className="text-sm text-gray-700">{c.suggestion}</p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

// ---------- AI SUGGESTIONS ----------
function AISuggestionsView({ enabled }: { enabled: boolean }) {
  const [category, setCategory] = useState('');
  const { data, loading, error, refetch } = useManagerAPI<any>(
    `manager/ai/suggestions${category ? `?category=${category}` : ''}`,
    enabled
  );
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data) return <ErrorState message="No suggestions data" onRetry={refetch} />;

  const suggestions: any[] = Array.isArray(data.suggestions) ? data.suggestions : [];
  const urgencyCounts = data.urgency_counts || {};

  const filtered = suggestions.filter((s: any) => !dismissed.has(s.id ?? s._idx));

  const urgencyOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...filtered].sort((a: any, b: any) => (urgencyOrder[a.urgency] ?? 4) - (urgencyOrder[b.urgency] ?? 4));

  const categoryOptions = [
    { value: '', label: 'All' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'ptp', label: 'PTP' },
    { value: 'par', label: 'PAR' },
    { value: 'missing_data', label: 'Missing Data' },
  ];

  const urgencyColors: Record<string, string> = {
    critical: 'bg-red-100 text-red-700 border-red-200',
    high: 'bg-orange-100 text-orange-700 border-orange-200',
    medium: 'bg-amber-100 text-amber-700 border-amber-200',
    low: 'bg-green-100 text-green-700 border-green-200',
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-amber-500" /> AI Suggestions
          <Badge variant="secondary" className="ml-2 text-xs bg-amber-100 text-amber-800">Demo Reference</Badge>
        </h2>
        <p className="text-sm text-gray-500 mt-1">AI-generated actionable recommendations</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {categoryOptions.map((opt) => (
          <Button
            key={opt.value || 'all'}
            size="sm"
            variant={category === opt.value ? 'default' : 'outline'}
            className={`h-8 text-xs ${category === opt.value ? 'bg-amber-500 hover:bg-amber-600' : ''}`}
            onClick={() => setCategory(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {(['critical', 'high', 'medium', 'low'] as const).map((urg) => (
          <Card key={urg} className="rounded-xl shadow-sm border-gray-200">
            <CardContent className="p-4 text-center">
              <p className={`text-2xl font-bold ${urgencyColors[urg]?.split(' ')[1] || 'text-gray-800'}`}>
                {urgencyCounts[urg] ?? 0}
              </p>
              <p className="text-xs text-gray-500 mt-1 capitalize">{urg}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-3">
        {sorted.length === 0 && (
          <Card className="rounded-xl shadow-sm border-gray-200">
            <CardContent className="p-8 text-center">
              <Brain className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-400">No suggestions available for this category</p>
            </CardContent>
          </Card>
        )}
        {sorted.map((s: any, i: number) => (
          <Card key={s.id ?? i} className="rounded-xl shadow-sm border-gray-200 hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className={`${urgencyColors[s.urgency] || ''} text-[10px] font-semibold uppercase`}>
                      {s.urgency || 'low'}
                    </Badge>
                    <span className="text-sm font-semibold text-gray-800">{s.title || 'Suggestion'}</span>
                  </div>
                  <p className="text-sm text-gray-600 mb-2">{s.description || ''}</p>
                  <div className="space-y-1.5 text-xs">
                    {s.client_name && (
                      <div className="flex items-center gap-1.5 text-gray-500">
                        <span className="font-medium">Client:</span> {s.client_name}
                        {s.member_id && <span className="text-gray-400 font-mono">({s.member_id})</span>}
                      </div>
                    )}
                    {s.suggested_action && (
                      <div className="flex items-start gap-1.5 text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5">
                        <Zap className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>{s.suggested_action}</span>
                      </div>
                    )}
                    {s.rule && (
                      <div className="flex items-start gap-1.5 text-gray-400">
                        <Info className="h-3 w-3 mt-0.5 shrink-0" />
                        <span>Rule: {s.rule}</span>
                      </div>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 h-8 px-2 shrink-0"
                  onClick={() => {
                    const id = s.id ?? i;
                    setDismissed((prev) => new Set(prev).add(id));
                  }}
                  title="Dismiss"
                >
                  <XCircleDismiss className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-start gap-2 text-xs text-gray-400 bg-gray-50 rounded-lg px-4 py-3">
        <AlertOctagon className="h-4 w-4 shrink-0 mt-0.5" />
        <p>Rule-based recommendations only. AI cannot approve loans, adjust collections, confirm payments, or discipline staff.</p>
      </div>
    </div>
  );
}

// ---------- AI EOD SUMMARY ----------
function AIEODSummaryView({ enabled }: { enabled: boolean }) {
  const { data, loading, error, refetch } = useManagerAPI<any>('manager/ai/eod-summary', enabled);

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data) return <ErrorState message="No EOD summary data" onRetry={refetch} />;

  const officers: any[] = Array.isArray(data.summaries) ? data.summaries : [];

  const sorted = [...officers].sort((a: any, b: any) => (a.completion_rate ?? 100) - (b.completion_rate ?? 100));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-amber-500" /> AI EOD Summary
          <Badge variant="secondary" className="ml-2 text-xs bg-amber-100 text-amber-800">Demo Reference</Badge>
        </h2>
        <p className="text-sm text-gray-500 mt-1">Auto-generated end-of-day analysis per officer</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-gray-800">{data.total_officers ?? officers.length}</p>
            <p className="text-xs text-gray-500 mt-1">Total Officers</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{data.officers_started ?? 0}</p>
            <p className="text-xs text-gray-500 mt-1">Started Day</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{data.eod_submitted ?? 0}</p>
            <p className="text-xs text-gray-500 mt-1">EOD Submitted</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-red-600">{data.officers_with_alerts ?? 0}</p>
            <p className="text-xs text-gray-500 mt-1">With Alerts</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        {sorted.length === 0 && (
          <Card className="rounded-xl shadow-sm border-gray-200">
            <CardContent className="p-8 text-center">
              <p className="text-sm text-gray-400">No officer data available</p>
            </CardContent>
          </Card>
        )}
        {sorted.map((o: any, i: number) => {
          const pct = o.completion_rate ?? 0;
          const hasAlerts = Array.isArray(o.alerts) && o.alerts.length > 0;
          return (
            <Card key={i} className={`rounded-xl shadow-sm border ${hasAlerts ? 'border-red-200 bg-red-50/30' : 'border-gray-200'}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600">
                      {getInitials(o.officer_name)}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{o.officer_name}</p>
                      <p className="text-xs text-gray-400">{o.staff_id}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={o.eod_submitted ? 'submitted' : 'pending'} />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500">Completion</span>
                    <span className="font-medium" style={{ color: pctColor(pct) }}>{pct}%</span>
                  </div>
                  <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: pctColor(pct) }} />
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-3 text-center">
                  <div>
                    <p className="text-lg font-bold text-gray-800">{o.visits_completed ?? 0}</p>
                    <p className="text-[10px] text-gray-500">Visits</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-gray-800">{o.collections_count ?? 0}</p>
                    <p className="text-[10px] text-gray-500">Collections</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-gray-800">{formatNpr(o.collections_npr)}</p>
                    <p className="text-[10px] text-gray-500">Amount</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-green-600">{o.ptp_fulfilled ?? 0}</p>
                    <p className="text-[10px] text-gray-500">PTP Done</p>
                  </div>
                </div>

                {o.narrative && (
                  <div className="bg-gray-50 rounded-lg px-3 py-2.5 border border-gray-100">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Sparkles className="h-3 w-3 text-amber-400" />
                      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">AI Summary</span>
                    </div>
                    <p className="text-sm text-gray-600 leading-relaxed">{o.narrative}</p>
                  </div>
                )}

                {hasAlerts && (
                  <div className="flex flex-wrap gap-1.5">
                    {o.alerts.map((alert: any, ai: number) => (
                      <span key={ai} className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-full bg-red-100 text-red-700 border border-red-200">
                        <AlertTriangle className="h-3 w-3" />
                        {typeof alert === 'string' ? alert : alert.message || alert.text || JSON.stringify(alert)}
                      </span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ---------- AI BRANCH SUMMARY ----------
function AIBranchSummaryView({ enabled }: { enabled: boolean }) {
  const { data, loading, error, refetch } = useManagerAPI<any>('manager/ai/branch-summary', enabled);

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data) return <ErrorState message="No branch summary data" onRetry={refetch} />;

  const metrics = data.metrics || {};
  const narrative = data.narrative || '';
  const keyActions: any[] = Array.isArray(data.key_actions) ? data.key_actions : [];
  const branchName = data.branch_name || 'Branch';
  const reportDate = data.date || getTodayStr();

  const metricCards = [
    { label: 'Staff', value: metrics.total_staff ?? '—', color: 'text-gray-800' },
    { label: 'Tasks', value: `${metrics.completed_tasks ?? 0}/${metrics.total_tasks ?? 0}`, color: 'text-gray-800' },
    { label: 'Completion', value: metrics.completion_rate != null ? `${metrics.completion_rate}%` : '—', color: pctColor(metrics.completion_rate ?? 0) },
    { label: 'Visits', value: metrics.total_visits ?? '—', color: 'text-gray-800' },
    { label: 'Collections', value: metrics.total_collections != null ? formatNpr(metrics.total_collections_npr) : '—', color: 'text-green-600' },
    { label: 'Overdue', value: metrics.overdue_clients ?? '—', color: 'text-red-600' },
    { label: 'NPA', value: metrics.npa_clients ?? '—', color: 'text-red-600' },
    { label: 'PTP', value: `${metrics.ptp_fulfilled_today ?? 0}/${metrics.ptp_due_today ?? 0}`, color: 'text-amber-600' },
    { label: 'EOD', value: `${metrics.eod_submitted ?? 0}/${metrics.total_staff ?? 0}`, color: 'text-gray-800' },
  ];

  const actionPriorityColors: Record<string, string> = {
    critical: 'bg-red-100 text-red-700',
    high: 'bg-orange-100 text-orange-700',
    medium: 'bg-amber-100 text-amber-700',
    low: 'bg-green-100 text-green-700',
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <FileBarChart className="h-5 w-5 text-amber-500" /> AI Branch Summary
            <Badge variant="secondary" className="ml-2 text-xs bg-amber-100 text-amber-800">Demo Reference</Badge>
          </h2>
          <p className="text-sm text-gray-500 mt-1">{branchName} — {reportDate}</p>
        </div>
        <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
          <Brain className="h-4 w-4 text-amber-500" />
          <span className="text-xs font-medium text-amber-700">AI Generated</span>
        </div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-3">
        {metricCards.map((m, i) => (
          <Card key={i} className="rounded-xl shadow-sm border-gray-200">
            <CardContent className="p-3 text-center">
              <p className={`text-lg font-bold ${m.color}`}>{m.value}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{m.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {narrative && (
        <Card className="rounded-xl shadow-sm border-amber-200 bg-gradient-to-br from-amber-50/50 to-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              Branch Narrative
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{narrative}</p>
          </CardContent>
        </Card>
      )}

      {keyActions.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Key Actions</h3>
          {keyActions.map((action: any, i: number) => (
            <Card key={i} className="rounded-xl shadow-sm border-gray-200 hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Badge
                    variant="secondary"
                    className={`${actionPriorityColors[action.priority] || 'bg-gray-100 text-gray-600'} border-0 text-[10px] font-semibold uppercase shrink-0 mt-0.5`}
                  >
                    {action.priority || 'medium'}
                  </Badge>
                  <p className="text-sm text-gray-700">{action.text || action.action || ''}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="flex items-start gap-2 text-xs text-gray-400 bg-gray-50 rounded-lg px-4 py-3">
        <AlertOctagon className="h-4 w-4 shrink-0 mt-0.5" />
        <p>Rule-based recommendations only. AI cannot approve loans, adjust collections, confirm payments, or discipline staff.</p>
      </div>
    </div>
  );
}

// ── Security Views ─────────────────────────────────────────────────────

// ---------- SECURITY OVERVIEW ----------
function SecurityOverviewView({ enabled }: { enabled: boolean }) {
  const { data, loading, error } = useSecurityAPI<any>('overview', enabled);

  const mockData = data || {
    compliance_score: 78,
    threats_identified: 3,
    active_devices: 12,
    open_findings: 5,
    last_pen_test: '2025-12-15',
    status: 'warning',
  };

  const score = mockData.compliance_score ?? 78;
  const scoreColor = score >= 80 ? '#16A34A' : score >= 50 ? '#F59E0B' : '#DC2626';
  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (score / 100) * circumference;

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={() => {}} />;

  const quickLinks = [
    { id: 'threat-model' as ViewId, label: 'Threat Model', icon: <ShieldAlert className="h-4 w-4" /> },
    { id: 'data-flow' as ViewId, label: 'Data Flow', icon: <GitBranch className="h-4 w-4" /> },
    { id: 'rbac-matrix' as ViewId, label: 'RBAC Matrix', icon: <Users className="h-4 w-4" /> },
    { id: 'pen-test' as ViewId, label: 'Pen Tests', icon: <ListChecks className="h-4 w-4" /> },
    { id: 'dependency-scan' as ViewId, label: 'Dependencies', icon: <Package className="h-4 w-4" /> },
    { id: 'compliance-status' as ViewId, label: 'Compliance', icon: <BadgeCheck className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-6">
                    !data && (
                    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-medium text-amber-800">Fallback demo data shown &mdash; backend unavailable.</span>
                    </div>
                    </div>
                    )
      <div>
        <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          <Shield className="h-5 w-5 text-green-600" /> Security Overview
          <Badge variant="secondary" className="ml-2 text-xs bg-amber-100 text-amber-800">Demo Reference</Badge>
        </h2>
        <p className="text-sm text-gray-500 mt-1">FieldOS security posture and compliance</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Compliance Score */}
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-6 flex flex-col items-center">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-4">Compliance Score</p>
            <div className="relative h-32 w-32">
              <svg className="h-32 w-32 -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="54" fill="none" stroke="#E5E7EB" strokeWidth="10" />
                <circle cx="60" cy="60" r="54" fill="none" stroke={scoreColor} strokeWidth="10" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-3xl font-bold text-gray-800">{score}%</span>
              </div>
            </div>
            <StatusBadge status={score >= 80 ? 'active' : score >= 50 ? 'warning' : 'critical'} />
          </CardContent>
        </Card>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-4">
          <Card className="rounded-xl shadow-sm border-gray-200">
            <CardContent className="p-4 text-center">
              <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-red-100 mx-auto mb-2">
                <ShieldAlert className="h-5 w-5 text-red-600" />
              </div>
              <p className="text-2xl font-bold text-red-600">{mockData.threats_identified}</p>
              <p className="text-xs text-gray-500 mt-1">Threats Identified</p>
            </CardContent>
          </Card>
          <Card className="rounded-xl shadow-sm border-gray-200">
            <CardContent className="p-4 text-center">
              <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-green-100 mx-auto mb-2">
                <Smartphone className="h-5 w-5 text-green-600" />
              </div>
              <p className="text-2xl font-bold text-green-600">{mockData.active_devices}</p>
              <p className="text-xs text-gray-500 mt-1">Active Devices</p>
            </CardContent>
          </Card>
          <Card className="rounded-xl shadow-sm border-gray-200">
            <CardContent className="p-4 text-center">
              <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-amber-100 mx-auto mb-2">
                <AlertCircle className="h-5 w-5 text-amber-600" />
              </div>
              <p className="text-2xl font-bold text-amber-600">{mockData.open_findings}</p>
              <p className="text-xs text-gray-500 mt-1">Open Findings</p>
            </CardContent>
          </Card>
          <Card className="rounded-xl shadow-sm border-gray-200">
            <CardContent className="p-4 text-center">
              <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-gray-100 mx-auto mb-2">
                <CheckCircle2 className="h-5 w-5 text-gray-600" />
              </div>
              <p className="text-lg font-bold text-gray-800">{mockData.last_pen_test || 'Dec 15, 2025'}</p>
              <p className="text-xs text-gray-500 mt-1">Last Pen Test</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Quick Links */}
      <Card className="rounded-xl shadow-sm border-gray-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-700">Quick Links</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {quickLinks.map((link) => (
              <Card key={link.id} className="rounded-lg shadow-sm border-gray-200 hover:shadow-md hover:border-green-200 transition-all cursor-pointer">
                <CardContent className="p-3 flex flex-col items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-green-50 flex items-center justify-center text-green-600">{link.icon}</div>
                  <span className="text-xs font-medium text-gray-700 text-center">{link.label}</span>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- THREAT MODEL ----------
function ThreatModelView({ enabled }: { enabled: boolean }) {
  const { data, loading, error } = useSecurityAPI<any>('threat-model', enabled);
  const [severityFilter, setSeverityFilter] = useState('');

  const threats: any[] = Array.isArray(data?.threats) ? data.threats : [
    { name: 'Spoofing', description: 'Unauthorized access via stolen credentials or device impersonation', severity: 'high', mitigated: true, mitigation: 'PIN + biometric auth, device fingerprinting, JWT token validation' },
    { name: 'Tampering', description: 'Modification of collection data or client records in transit or at rest', severity: 'critical', mitigated: true, mitigation: 'TLS 1.3 encryption, HMAC request signing, audit trail on every mutation' },
    { name: 'Repudiation', description: 'User denying actions they performed (collection, visit check-in)', severity: 'medium', mitigated: true, mitigation: 'Immutable audit log with timestamps, device ID, GPS coordinates' },
    { name: 'Information Disclosure', description: 'Exposure of client PII, financial data, or business intelligence', severity: 'critical', mitigated: false, mitigation: 'AES-256 at rest, TLS in transit, RBAC, data minimization in API responses' },
    { name: 'Denial of Service', description: 'API flooding or device battery drain preventing field operations', severity: 'medium', mitigated: true, mitigation: 'Rate limiting (100 req/min), offline-first architecture, battery optimization' },
    { name: 'Elevation of Privilege', description: 'Field officer accessing branch manager or admin functions', severity: 'high', mitigated: true, mitigation: 'Role-based access control, server-side permission checks, minimal API scopes' },
  ];

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={() => {}} />;

  const filtered = severityFilter ? threats.filter((t) => t.severity === severityFilter) : threats;

  return (
    <div className="space-y-6">
                    !data?.threats && (
                    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-medium text-amber-800">Fallback demo data shown &mdash; backend unavailable.</span>
                    </div>
                    </div>
                    )
      <div>
        <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-red-500" /> STRIDE Threat Model
          <Badge variant="secondary" className="ml-2 text-xs bg-amber-100 text-amber-800">Demo Reference</Badge>
        </h2>
        <p className="text-sm text-gray-500 mt-1">FieldOS threat analysis and mitigation status</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {['', 'critical', 'high', 'medium', 'low'].map((s) => (
          <Button key={s || 'all'} size="sm" variant={severityFilter === s ? 'default' : 'outline'} className="h-8 text-xs" onClick={() => setSeverityFilter(s)}>
            {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}
          </Button>
        ))}
        <span className="text-xs text-gray-400 ml-2">{filtered.length} threats</span>
      </div>

      <ScrollArea className="max-h-[600px]">
        <div className="space-y-3">
          {filtered.map((t: any, i: number) => (
            <Card key={i} className="rounded-xl shadow-sm border-gray-200 hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <StatusBadge status={t.severity} />
                      <span className="text-sm font-semibold text-gray-800">{t.name}</span>
                      {t.mitigated ? (
                        <Badge variant="secondary" className="bg-green-100 text-green-700 border-0 text-[10px]">Mitigated</Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-red-100 text-red-700 border-0 text-[10px]">Open</Badge>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 mt-1">{t.description}</p>
                    <div className="mt-2 p-2.5 rounded-lg bg-gray-50 text-xs text-gray-600">
                      <span className="font-medium text-gray-700">Mitigation: </span>{t.mitigation}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// ---------- DATA FLOW ----------
function DataFlowView({ enabled }: { enabled: boolean }) {
  const { loading, error } = useSecurityAPI<any>('data-flow', enabled);
  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={() => {}} />;

  const nodes = [
    { id: 'mobile', label: 'Mobile App', sub: 'Field Officers', color: 'bg-amber-100 border-amber-300 text-amber-800', icon: <Smartphone className="h-6 w-6" /> },
    { id: 'api', label: 'Backend API', sub: 'FastAPI + JWT', color: 'bg-green-100 border-green-300 text-green-800', icon: <Zap className="h-6 w-6" /> },
    { id: 'db', label: 'Database', sub: 'SQLite + Encrypted', color: 'bg-blue-100 border-blue-300 text-blue-800', icon: <Database className="h-6 w-6" /> },
    { id: 'cbs', label: 'CBS Gateway', sub: 'Core Banking', color: 'bg-purple-100 border-purple-300 text-purple-800', icon: <Banknote className="h-6 w-6" /> },
    { id: 'ai', label: 'AI Service', sub: 'Risk Scoring', color: 'bg-rose-100 border-rose-300 text-rose-800', icon: <Brain className="h-6 w-6" /> },
  ];

  const connections = [
    { from: 'mobile', to: 'api', label: 'HTTPS/TLS 1.3', encrypted: true, dataType: 'PII, Financial', direction: '↔' },
    { from: 'api', to: 'db', label: 'Encrypted SQLite', encrypted: true, dataType: 'All Data', direction: '↔' },
    { from: 'api', to: 'cbs', label: 'mTLS + HMAC', encrypted: true, dataType: 'Financial', direction: '↔' },
    { from: 'api', to: 'ai', label: 'Internal gRPC', encrypted: true, dataType: 'Operational', direction: '→' },
    { from: 'mobile', to: 'db', label: 'Local SQLite', encrypted: true, dataType: 'PII, Financial', direction: '→' },
  ];

  const nodeMap: Record<string, typeof nodes[0]> = {};
  nodes.forEach((n) => { nodeMap[n.id] = n; });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-green-600" /> Data Flow Diagram
          <Badge variant="secondary" className="ml-2 text-xs bg-amber-100 text-amber-800">Demo Reference</Badge>
        </h2>
        <p className="text-sm text-gray-500 mt-1">FieldOS data architecture and encryption</p>
      </div>

      {/* Visual Flow */}
      <Card className="rounded-xl shadow-sm border-gray-200">
        <CardContent className="p-6">
          <div className="flex flex-col lg:flex-row items-center justify-center gap-8 lg:gap-6">
            {/* Mobile */}
            <div className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 ${nodeMap.mobile.color} min-w-[140px]`}>
              {nodeMap.mobile.icon}
              <div className="text-center">
                <p className="text-sm font-bold">{nodeMap.mobile.label}</p>
                <p className="text-[10px] opacity-75">{nodeMap.mobile.sub}</p>
              </div>
              <Badge variant="secondary" className="bg-red-50 text-red-600 border-0 text-[9px]">PII</Badge>
            </div>

            {/* Connection Mobile → API */}
            <div className="flex flex-col items-center gap-1">
              <div className="flex items-center gap-1 text-green-600"><Lock className="h-3.5 w-3.5" /><span className="text-[10px] font-medium">TLS 1.3</span></div>
              <div className="h-[2px] w-16 lg:w-12 bg-green-400" />
              <span className="text-[9px] text-gray-400">↔ HTTPS</span>
            </div>

            {/* API */}
            <div className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 ${nodeMap.api.color} min-w-[140px]`}>
              {nodeMap.api.icon}
              <div className="text-center">
                <p className="text-sm font-bold">{nodeMap.api.label}</p>
                <p className="text-[10px] opacity-75">{nodeMap.api.sub}</p>
              </div>
              <Badge variant="secondary" className="bg-amber-50 text-amber-600 border-0 text-[9px]">Financial</Badge>
            </div>

            <div className="hidden lg:flex flex-col gap-4">
              {/* API → DB */}
              <div className="flex items-center gap-1">
                <div className="h-[2px] w-12 bg-blue-400" />
                <div className="flex items-center gap-1 text-blue-600"><Lock className="h-3 w-3" /></div>
                <div className={`p-2 rounded-lg border ${nodeMap.db.color} text-center min-w-[120px]`}>
                  {nodeMap.db.icon}
                  <p className="text-xs font-bold mt-1">{nodeMap.db.label}</p>
                </div>
              </div>
              {/* API → CBS */}
              <div className="flex items-center gap-1">
                <div className="h-[2px] w-12 bg-purple-400" />
                <div className="flex items-center gap-1 text-purple-600"><Lock className="h-3 w-3" /></div>
                <div className={`p-2 rounded-lg border ${nodeMap.cbs.color} text-center min-w-[120px]`}>
                  {nodeMap.cbs.icon}
                  <p className="text-xs font-bold mt-1">{nodeMap.cbs.label}</p>
                </div>
              </div>
              {/* API → AI */}
              <div className="flex items-center gap-1">
                <div className="h-[2px] w-12 bg-rose-400" />
                <div className="flex items-center gap-1 text-rose-600"><Lock className="h-3 w-3" /></div>
                <div className={`p-2 rounded-lg border ${nodeMap.ai.color} text-center min-w-[120px]`}>
                  {nodeMap.ai.icon}
                  <p className="text-xs font-bold mt-1">{nodeMap.ai.label}</p>
                </div>
              </div>
            </div>

            {/* Mobile stack on smaller screens */}
            <div className="flex lg:hidden flex-col gap-3">
              <div className={`p-3 rounded-lg border ${nodeMap.db.color} text-center flex items-center gap-2`}>
                <Lock className="h-3 w-3" /> {nodeMap.db.label} — {nodeMap.db.sub}
              </div>
              <div className={`p-3 rounded-lg border ${nodeMap.cbs.color} text-center flex items-center gap-2`}>
                <Lock className="h-3 w-3" /> {nodeMap.cbs.label} — {nodeMap.cbs.sub}
              </div>
              <div className={`p-3 rounded-lg border ${nodeMap.ai.color} text-center flex items-center gap-2`}>
                <Lock className="h-3 w-3" /> {nodeMap.ai.label} — {nodeMap.ai.sub}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Connection Table */}
      <Card className="rounded-xl shadow-sm border-gray-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-700">Connection Details</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <DashboardTable
            headers={['From', 'To', 'Protocol', 'Encrypted', 'Data Classification']}
            rows={connections.map((c) => [
              <span key="from" className="font-medium text-gray-800">{nodeMap[c.from]?.label}</span>,
              <span key="to" className="font-medium text-gray-800">{nodeMap[c.to]?.label}</span>,
              <span key="proto" className="text-gray-600 text-xs font-mono">{c.label}</span>,
              c.encrypted ? (
                <span key="enc" className="flex items-center gap-1 text-green-600"><Lock className="h-3.5 w-3.5" /> <span className="text-xs">Yes</span></span>
              ) : (
                <span key="enc" className="text-red-600 text-xs">No</span>
              ),
              <Badge key="data" variant="secondary" className={`border-0 text-[10px] ${c.dataType.includes('PII') ? 'bg-red-100 text-red-700' : c.dataType.includes('Financial') ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{c.dataType}</Badge>,
            ])}
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- RBAC MATRIX ----------
function RBACMatrixView({ enabled }: { enabled: boolean }) {
  const { loading, error } = useSecurityAPI<any>('rbac', enabled);
  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={() => {}} />;

  const roles = ['Field Officer', 'Branch Manager', 'Area Manager', 'Admin'];
  const resources = [
    { name: 'Clients', access: ['read_write', 'read_write', 'read_write', 'read_write'] },
    { name: 'Collections', access: ['read_write', 'read_write', 'read', 'read_write'] },
    { name: 'CBS Integration', access: ['none', 'read_write', 'read', 'read_write'] },
    { name: 'AI Service', access: ['read', 'read_write', 'read', 'read_write'] },
    { name: 'Audit Logs', access: ['none', 'read', 'read', 'read_write'] },
    { name: 'Devices', access: ['self', 'read', 'read_write', 'read_write'] },
    { name: 'Security Config', access: ['none', 'none', 'read', 'read_write'] },
    { name: 'Settings', access: ['self', 'branch', 'area', 'all'] },
  ];

  const accessColors: Record<string, string> = {
    read_write: 'bg-green-100 text-green-700',
    read: 'bg-blue-100 text-blue-700',
    none: 'bg-gray-100 text-gray-400',
    self: 'bg-amber-100 text-amber-700',
    branch: 'bg-amber-100 text-amber-700',
    area: 'bg-purple-100 text-purple-700',
    all: 'bg-green-100 text-green-700',
  };

  const accessLabels: Record<string, string> = {
    read_write: 'Full Access',
    read: 'Read Only',
    none: 'No Access',
    self: 'Self Only',
    branch: 'Branch Only',
    area: 'Area Only',
    all: 'All',
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          <Users className="h-5 w-5 text-green-600" /> RBAC Matrix
          <Badge variant="secondary" className="ml-2 text-xs bg-amber-100 text-amber-800">Demo Reference</Badge>
        </h2>
        <p className="text-sm text-gray-500 mt-1">Role-based access control permissions</p>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(accessLabels).filter(([k]) => ['read_write', 'read', 'none', 'self'].includes(k)).map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5">
            <div className={`h-3 w-3 rounded-sm ${accessColors[k]}`} />
            <span className="text-xs text-gray-600">{v}</span>
          </div>
        ))}
      </div>

      <ScrollArea className="max-h-[600px]">
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wider">Resource</th>
                {roles.map((r) => (
                  <th key={r} className="text-center px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wider whitespace-nowrap">{r}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resources.map((res, i) => (
                <tr key={i} className={`border-b border-gray-100 ${i % 2 === 1 ? 'bg-gray-50/50' : 'bg-white'}`}>
                  <td className="px-4 py-3 font-medium text-gray-800">{res.name}</td>
                  {res.access.map((a, j) => (
                    <td key={j} className="px-4 py-3 text-center">
                      <Badge variant="secondary" className={`${accessColors[a] || 'bg-gray-100 text-gray-600'} border-0 text-xs font-medium`}>
                        {accessLabels[a] || a}
                      </Badge>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ScrollArea>
    </div>
  );
}

// ---------- SECURITY AUDIT EXPORT ----------
function SecurityAuditExportView({ enabled }: { enabled: boolean }) {
  const { data, loading, error } = useSecurityAPI<any>('audit-export', enabled);
  const [startDate, setStartDate] = useState('2025-01-01');
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [actionFilter, setActionFilter] = useState('');

  const events: any[] = Array.isArray(data?.events) ? data.events : [
    { id: 'AUD-001', action_type: 'login', user: 'FO-208 Ram Shah', timestamp: '2025-12-28T09:15:00', device: 'SM-A145F', status: 'success' },
    { id: 'AUD-002', action_type: 'collection_recorded', user: 'FO-209 Sita Devi', timestamp: '2025-12-28T10:30:00', device: 'SM-M315F', status: 'success' },
    { id: 'AUD-003', action_type: 'visit_checkin', user: 'FO-208 Ram Shah', timestamp: '2025-12-28T11:00:00', device: 'SM-A145F', status: 'success' },
    { id: 'AUD-004', action_type: 'face_verification', user: 'FO-210 Hari BK', timestamp: '2025-12-28T11:45:00', device: 'Redmi Note 12', status: 'success' },
    { id: 'AUD-005', action_type: 'collection_edited', user: 'FO-209 Sita Devi', timestamp: '2025-12-28T12:15:00', device: 'SM-M315F', status: 'warning' },
    { id: 'AUD-006', action_type: 'sync_failed', user: 'FO-211 Gita KC', timestamp: '2025-12-28T13:00:00', device: 'Pixel 6a', status: 'failed' },
    { id: 'AUD-007', action_type: 'eod_submitted', user: 'FO-208 Ram Shah', timestamp: '2025-12-28T17:00:00', device: 'SM-A145F', status: 'success' },
    { id: 'AUD-008', action_type: 'logout', user: 'FO-209 Sita Devi', timestamp: '2025-12-28T17:30:00', device: 'SM-M315F', status: 'success' },
  ];

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={() => {}} />;

  const filtered = actionFilter ? events.filter((e) => e.action_type === actionFilter) : events;
  const actionTypes = [...new Set(events.map((e) => e.action_type))];

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fieldos-audit-${startDate}-to-${endDate}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
                    !data?.events && (
                    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-medium text-amber-800">Fallback demo data shown &mdash; backend unavailable.</span>
                    </div>
                    </div>
                    )
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <FileDown className="h-5 w-5 text-green-600" /> Audit Log Export
          </h2>
          <p className="text-sm text-gray-500 mt-1">Filter and export security audit events</p>
        </div>
        <Button onClick={handleExport} className="bg-green-600 hover:bg-green-700 text-white">
          <Download className="h-4 w-4 mr-1.5" /> Export JSON
        </Button>
      </div>

      {/* Filters */}
      <Card className="rounded-xl shadow-sm border-gray-200">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Start Date</label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">End Date</label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Action Type</label>
              <select
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
                className="w-full h-9 rounded-md border border-gray-300 bg-white px-3 text-sm"
              >
                <option value="">All Types</option>
                {actionTypes.map((a) => <option key={a} value={a}>{(a ?? '').replace(/_/g, ' ')}</option>)}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-gray-800">{filtered.length}</p>
            <p className="text-xs text-gray-500 mt-1">Total Events</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{filtered.filter((e) => e.status === 'success').length}</p>
            <p className="text-xs text-gray-500 mt-1">Successful</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-red-600">{filtered.filter((e) => e.status === 'failed').length}</p>
            <p className="text-xs text-gray-500 mt-1">Failed</p>
          </CardContent>
        </Card>
      </div>

      {/* Events Table */}
      <ScrollArea className="max-h-[400px]">
        <DashboardTable
          headers={['ID', 'Action', 'User', 'Timestamp', 'Device', 'Status']}
          rows={filtered.map((e) => [
            <span key="id" className="font-mono text-xs text-gray-500">{e.id}</span>,
            <span key="action" className="font-medium text-gray-800 capitalize text-xs">{(e.action_type ?? '').replace(/_/g, ' ')}</span>,
            <span key="user" className="text-gray-600 text-xs">{e.user}</span>,
            <span key="ts" className="text-gray-500 text-xs">{formatTime(e.timestamp)}</span>,
            <span key="dev" className="text-gray-500 text-xs">{e.device}</span>,
            <StatusBadge key="st" status={e.status} />,
          ])}
          emptyMessage="No events match filters"
        />
      </ScrollArea>
    </div>
  );
}

// ---------- DEVICE MANAGEMENT ----------
function DeviceManagementView({ enabled }: { enabled: boolean }) {
  const { data, loading, error } = useSecurityAPI<any>('devices', enabled);
  const [search, setSearch] = useState('');
  const [devices, setDevices] = useState<any[]>([]);

  const allDevices: any[] = Array.isArray(data?.devices) ? data.devices : [
    { id: 'DEV-001', user: 'FO-208 Ram Shah', model: 'Samsung Galaxy A14', os: 'Android 14', lastSync: '2025-12-28T17:00:00', status: 'active' },
    { id: 'DEV-002', user: 'FO-209 Sita Devi', model: 'Samsung Galaxy M31', os: 'Android 13', lastSync: '2025-12-28T16:45:00', status: 'active' },
    { id: 'DEV-003', user: 'FO-210 Hari BK', model: 'Xiaomi Redmi Note 12', os: 'Android 14', lastSync: '2025-12-28T15:30:00', status: 'active' },
    { id: 'DEV-004', user: 'FO-211 Gita KC', model: 'Google Pixel 6a', os: 'Android 15', lastSync: '2025-12-27T17:00:00', status: 'active' },
    { id: 'DEV-005', user: 'FO-212 Maya Thapa', model: 'Samsung Galaxy A54', os: 'Android 14', lastSync: '2025-12-20T12:00:00', status: 'revoked' },
    { id: 'DEV-006', user: '—', model: 'Samsung Galaxy S23', os: 'Android 15', lastSync: null, status: 'unregistered' },
  ];

  React.useEffect(() => {
    setDevices(allDevices);
  }, [data, loading]);

  if (loading && !data) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={() => {}} />;

  const filtered = search
    ? devices.filter((d) =>
        String(d.user || '').toLowerCase().includes(search.toLowerCase()) ||
        String(d.model || '').toLowerCase().includes(search.toLowerCase()) ||
        String(d.id || '').toLowerCase().includes(search.toLowerCase())
      )
    : devices;

  const handleRevoke = (id: string) => {
    setDevices((prev) => prev.map((d) => d.id === id ? { ...d, status: 'revoked' } : d));
  };
  const handleRestore = (id: string) => {
    setDevices((prev) => prev.map((d) => d.id === id ? { ...d, status: 'active' } : d));
  };

  return (
    <div className="space-y-6">
                    !data?.devices && (
                    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-medium text-amber-800">Fallback demo data shown &mdash; backend unavailable.</span>
                    </div>
                    </div>
                    )
      <div>
        <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          <Smartphone className="h-5 w-5 text-green-600" /> Device Management
        </h2>
        <p className="text-sm text-gray-500 mt-1">Manage registered field devices</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{devices.filter((d) => d.status === 'active').length}</p>
            <p className="text-xs text-gray-500 mt-1">Active</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-red-600">{devices.filter((d) => d.status === 'revoked').length}</p>
            <p className="text-xs text-gray-500 mt-1">Revoked</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-gray-500">{devices.filter((d) => d.status === 'unregistered').length}</p>
            <p className="text-xs text-gray-500 mt-1">Unregistered</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input placeholder="Search devices..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9 text-sm" />
        </div>
      </div>

      <ScrollArea className="max-h-[500px]">
        <DashboardTable
          headers={['Device', 'User', 'Model', 'OS', 'Last Sync', 'Status', 'Actions']}
          rows={filtered.map((d) => [
            <span key="id" className="font-mono text-xs text-gray-500">{d.id}</span>,
            <span key="user" className="font-medium text-gray-800">{d.user}</span>,
            <span key="model" className="text-gray-600 text-xs">{d.model}</span>,
            <span key="os" className="text-gray-500 text-xs">{d.os}</span>,
            <span key="sync" className="text-gray-500 text-xs">{d.lastSync ? formatTime(d.lastSync) : '—'}</span>,
            <StatusBadge key="st" status={d.status} />,
            <div key="act">
              {d.status === 'active' && (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-red-600 hover:bg-red-50 text-xs" onClick={() => handleRevoke(d.id)}>
                  Revoke
                </Button>
              )}
              {d.status === 'revoked' && (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-green-600 hover:bg-green-50 text-xs" onClick={() => handleRestore(d.id)}>
                  Restore
                </Button>
              )}
              {d.status === 'unregistered' && <span className="text-xs text-gray-400">—</span>}
            </div>,
          ])}
          emptyMessage="No devices found"
        />
      </ScrollArea>
    </div>
  );
}

// ---------- INCIDENT RESPONSE ----------
function IncidentResponseView({ enabled }: { enabled: boolean }) {
  const { loading, error } = useSecurityAPI<any>('incident-response', enabled);
  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={() => {}} />;

  const severityLevels = [
    { level: 'P1 Critical', color: 'bg-red-600 text-white', response: '15 min', escalation: 'Branch Manager → Area Manager → IT Director', example: 'Data breach, complete system outage' },
    { level: 'P2 High', color: 'bg-orange-500 text-white', response: '1 hour', escalation: 'Branch Manager → Area Manager', example: 'Device compromise, sync failure across branch' },
    { level: 'P3 Medium', color: 'bg-amber-500 text-white', response: '4 hours', escalation: 'Branch Manager → IT Support', example: 'Single device sync failure, GPS anomaly' },
    { level: 'P4 Low', color: 'bg-green-500 text-white', response: '24 hours', escalation: 'IT Support ticket', example: 'App crash, UI bug, minor data mismatch' },
  ];

  const contacts = [
    { name: 'IT Security Lead', phone: '+977-1-555-0100', email: 'security@fieldos.com.np' },
    { name: 'Nepal Rastra Bank (NRB)', phone: '+977-1-441-0158', email: 'supervision@nrb.org.np' },
    { name: 'FieldOS CTO', phone: '+977-1-555-0200', email: 'cto@fieldos.com.np' },
    { name: 'Data Protection Officer', phone: '+977-1-555-0300', email: 'dpo@fieldos.com.np' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-red-500" /> Incident Response
          <Badge variant="secondary" className="ml-2 text-xs bg-amber-100 text-amber-800">Demo Reference</Badge>
        </h2>
        <p className="text-sm text-gray-500 mt-1">Severity levels, escalation, and emergency contacts</p>
      </div>

      {/* Severity Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {severityLevels.map((s) => (
          <Card key={s.level} className="rounded-xl shadow-sm border-gray-200">
            <CardContent className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <Badge className={`${s.color} border-0 text-xs font-bold px-3 py-1`}>{s.level}</Badge>
                <span className="text-sm text-gray-600">Response: <strong>{s.response}</strong></span>
              </div>
              <div className="text-xs text-gray-600 mb-2">
                <span className="font-medium text-gray-700">Escalation: </span>{s.escalation}
              </div>
              <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-2">
                <span className="font-medium">Example: </span>{s.example}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Escalation Flowchart */}
      <Card className="rounded-xl shadow-sm border-gray-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-700">Escalation Flow</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="flex flex-col items-center gap-3">
            {['Field Officer detects issue', '→ Branch Manager (5 min)', '→ Area Manager (if P1/P2)', '→ IT Security Lead', '→ NRB Notification (if data breach)'].map((step, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold ${i === 0 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>{i + 1}</div>
                <span className="text-sm text-gray-700">{step}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Emergency Contacts */}
      <Card className="rounded-xl shadow-sm border-gray-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-700">Emergency Contacts</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <DashboardTable
            headers={['Role', 'Phone', 'Email']}
            rows={contacts.map((c) => [
              <span key="name" className="font-medium text-gray-800">{c.name}</span>,
              <span key="phone" className="font-mono text-xs text-gray-600">{c.phone}</span>,
              <span key="email" className="text-xs text-gray-500">{c.email}</span>,
            ])}
          />
        </CardContent>
      </Card>

      {/* Communication Templates */}
      <Card className="rounded-xl shadow-sm border-gray-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-700">Communication Templates</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          <div className="p-3 rounded-lg bg-red-50 border border-red-100">
            <p className="text-xs font-semibold text-red-700 mb-1">P1 — Data Breach Notification</p>
            <p className="text-xs text-red-600">URGENT: Potential data security incident detected in FieldOS. Branch: [branch]. Impact: [scope]. Response team activated. ETA: 15 min.</p>
          </div>
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-100">
            <p className="text-xs font-semibold text-amber-700 mb-1">P2 — Device Compromise</p>
            <p className="text-xs text-amber-600">Security Alert: Device [device_id] associated with [officer] shows signs of compromise. Device revoked. Investigation initiated.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- POLICIES ----------
function PoliciesView({ enabled }: { enabled: boolean }) {
  const { loading, error } = useSecurityAPI<any>('policies', enabled);
  const [activeTab, setActiveTab] = useState('backup');

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={() => {}} />;

  const policies: Record<string, { title: string; version: string; updated: string; sections: { title: string; content: string }[] }> = {
    backup: {
      title: 'Backup & Restore Policy',
      version: 'v2.1',
      updated: '2025-12-01',
      sections: [
        { title: '1. Data Backup Frequency', content: 'All client and transaction data is backed up every 6 hours from the central server. Branch-level SQLite databases are synced to the cloud backup on every sync cycle. CBS-integrated data has a real-time mirror.' },
        { title: '2. Retention Period', content: 'Daily backups retained for 30 days. Weekly snapshots retained for 12 months. Annual archives retained for 7 years per NRB regulatory requirements.' },
        { title: '3. Restore Procedure', content: 'In case of data loss, restore from the most recent clean backup. Verify data integrity via hash comparison. Re-sync all mobile devices after restore to reconcile any offline transactions.' },
        { title: '4. Disaster Recovery', content: 'DR site located in a different geographic zone (Pokhara for Kathmandu primary). RTO: 4 hours. RPO: 6 hours. Annual DR drill conducted in Q1.' },
      ],
    },
    privacy: {
      title: 'Privacy & Consent Policy',
      version: 'v3.0',
      updated: '2025-11-15',
      sections: [
        { title: '1. Data Collection', content: 'FieldOS collects only data necessary for microfinance operations: client identity (name, photo, citizenship), loan details, collection records, and GPS check-in coordinates. All collection requires explicit client consent.' },
        { title: '2. Consent Management', content: 'Clients must provide verbal and digital consent before data collection. Consent can be revoked at any time by contacting the branch. Biometric data (face verification) requires separate explicit consent.' },
        { title: '3. Data Minimization', content: 'API responses return only fields necessary for the requesting role. Field officers see their assigned clients only. PII is masked in audit logs (partial name, no full citizenship number).' },
        { title: '4. Data Subject Rights', content: 'Clients can request data access, correction, or deletion per NRB Directive on Digital Payment. Requests processed within 72 hours by the Data Protection Officer.' },
      ],
    },
    retention: {
      title: 'Data Retention Policy',
      version: 'v1.5',
      updated: '2025-10-20',
      sections: [
        { title: '1. Retention Schedule', content: 'Active client data: Duration of relationship + 7 years. Closed loan records: 7 years from closure. Audit logs: 3 years. GPS coordinates: 90 days. Device telemetry: 1 year.' },
        { title: '2. Automatic Deletion', content: 'Expired data is automatically flagged for deletion. Batch deletion runs monthly. Legal hold can be placed on any dataset by Compliance team.' },
        { title: '3. Regulatory Compliance', content: 'Retention periods align with NRB Directives, Companies Act 2063, and Bank and Financial Institution Act 2073. Longer retention may apply for records under investigation.' },
      ],
    },
  };

  const tabs = [
    { id: 'backup', label: 'Backup / Restore' },
    { id: 'privacy', label: 'Privacy & Consent' },
    { id: 'retention', label: 'Data Retention' },
  ];

  const policy = policies[activeTab];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-green-600" /> Security Policies
          <Badge variant="secondary" className="ml-2 text-xs bg-amber-100 text-amber-800">Demo Reference</Badge>
        </h2>
        <p className="text-sm text-gray-500 mt-1">FieldOS security and compliance policies</p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-gray-200 pb-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.id ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Policy Content */}
      <Card className="rounded-xl shadow-sm border-gray-200">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold text-gray-700">{policy.title}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-gray-100 text-gray-600 border-0 text-xs">{policy.version}</Badge>
              <span className="text-xs text-gray-400">Updated: {policy.updated}</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-4">
          {policy.sections.map((s, i) => (
            <div key={i}>
              <h3 className="text-sm font-semibold text-gray-700 mb-1">{s.title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{s.content}</p>
            </div>
          ))}
          <Button variant="outline" size="sm" className="mt-4">
            <Download className="h-3.5 w-3.5 mr-1.5" /> Download PDF
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- PEN TEST CHECKLIST ----------
function PenTestChecklistView({ enabled }: { enabled: boolean }) {
  const { data, loading, error } = useSecurityAPI<any>('pen-test', enabled);
  const [statusFilter, setStatusFilter] = useState('');

  const items: any[] = Array.isArray(data?.items) ? data.items : [
    { id: 'A01', category: 'Broken Access Control', description: 'Verify field officers cannot access other branch data via API manipulation', status: 'pass', notes: 'Tested with modified branch_id in JWT claims — server rejects' },
    { id: 'A02', category: 'Broken Access Control', description: 'Check that collection amounts cannot be modified after CBS posting', status: 'pass', notes: 'Server returns 403 for edit attempts on posted collections' },
    { id: 'A03', category: 'Cryptographic Failures', description: 'Verify TLS 1.3 is enforced on all API endpoints', status: 'pass', notes: 'TLS 1.2 minimum, 1.3 preferred. HSTS headers present.' },
    { id: 'A04', category: 'Cryptographic Failures', description: 'Check that sensitive fields are encrypted at rest in SQLite', status: 'pending', notes: 'Need to verify AES-256 implementation in production DB' },
    { id: 'A05', category: 'Injection', description: 'SQL injection test on login, search, and collection endpoints', status: 'pass', notes: 'Parameterized queries used throughout. No injection vectors found.' },
    { id: 'A06', category: 'Injection', description: 'XSS test on client name, notes, and receipt fields', status: 'pass', notes: 'React auto-escapes. Server-side sanitization on all text inputs.' },
    { id: 'A07', category: 'Security Misconfiguration', description: 'Verify no default credentials in production', status: 'pass', notes: 'Seed data only in dev. Production requires env-based config.' },
    { id: 'A08', category: 'Security Misconfiguration', description: 'Check that debug mode is disabled and error responses are generic', status: 'fail', notes: 'Stack traces visible in 500 responses — needs fix' },
    { id: 'A09', category: 'Identification & Auth', description: 'Test brute force protection on PIN login', status: 'pass', notes: 'Rate limiting: 5 attempts per minute per IP' },
    { id: 'A10', category: 'Identification & Auth', description: 'Verify JWT token expiry and refresh mechanism', status: 'pass', notes: 'Access token: 30 min. Refresh: 7 days. Revocation supported.' },
  ];

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={() => {}} />;

  const filtered = statusFilter ? items.filter((i) => i.status === statusFilter) : items;
  const passCount = items.filter((i) => i.status === 'pass').length;
  const failCount = items.filter((i) => i.status === 'fail').length;
  const pendingCount = items.filter((i) => i.status === 'pending').length;
  const notTestedCount = items.filter((i) => i.status === 'not_tested').length;
  const progressPct = items.length > 0 ? Math.round(((passCount + failCount) / items.length) * 100) : 0;

  return (
    <div className="space-y-6">
                    !data?.items && (
                    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-medium text-amber-800">Fallback demo data shown &mdash; backend unavailable.</span>
                    </div>
                    </div>
                    )
      <div>
        <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          <ListChecks className="h-5 w-5 text-green-600" /> Pen Test Checklist
          <Badge variant="secondary" className="ml-2 text-xs bg-amber-100 text-amber-800">Demo Reference</Badge>
        </h2>
        <p className="text-sm text-gray-500 mt-1">OWASP Top 10 mapped to FieldOS</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="rounded-xl shadow-sm border-gray-200"><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-gray-800">{items.length}</p><p className="text-xs text-gray-500 mt-1">Total</p></CardContent></Card>
        <Card className="rounded-xl shadow-sm border-gray-200"><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-green-600">{passCount}</p><p className="text-xs text-gray-500 mt-1">Passed</p></CardContent></Card>
        <Card className="rounded-xl shadow-sm border-gray-200"><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-red-600">{failCount}</p><p className="text-xs text-gray-500 mt-1">Failed</p></CardContent></Card>
        <Card className="rounded-xl shadow-sm border-gray-200"><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-amber-600">{pendingCount}</p><p className="text-xs text-gray-500 mt-1">Pending</p></CardContent></Card>
        <Card className="rounded-xl shadow-sm border-gray-200"><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-gray-500">{notTestedCount}</p><p className="text-xs text-gray-500 mt-1">Not Tested</p></CardContent></Card>
      </div>

      {/* Progress Bar */}
      <Card className="rounded-xl shadow-sm border-gray-200">
        <CardContent className="p-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-medium text-gray-700">Test Completion</span>
            <span className="text-gray-500">{progressPct}%</span>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </CardContent>
      </Card>

      {/* Filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {['', 'pass', 'fail', 'pending', 'not_tested'].map((s) => (
          <Button key={s || 'all'} size="sm" variant={statusFilter === s ? 'default' : 'outline'} className="h-8 text-xs" onClick={() => setStatusFilter(s)}>
            {s ? (s === 'not_tested' ? 'Not Tested' : s.charAt(0).toUpperCase() + s.slice(1)) : 'All'}
          </Button>
        ))}
      </div>

      {/* Items */}
      <ScrollArea className="max-h-[500px]">
        <div className="space-y-3">
          {filtered.map((item, i) => (
            <Card key={i} className="rounded-xl shadow-sm border-gray-200">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="secondary" className="bg-gray-100 text-gray-600 border-0 text-[10px] font-mono">{item.id}</Badge>
                      <span className="text-[10px] text-gray-500">{item.category}</span>
                    </div>
                    <p className="text-sm text-gray-800 font-medium">{item.description}</p>
                    {item.notes && <p className="text-xs text-gray-500 mt-1 bg-gray-50 rounded p-2">{item.notes}</p>}
                  </div>
                  <StatusBadge status={item.status === 'not_tested' ? 'not_started' : item.status} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// ---------- DEPENDENCY SCAN ----------
function DependencyScanView({ enabled }: { enabled: boolean }) {
  const { data, loading, error } = useSecurityAPI<any>('dependency-scan', enabled);
  const [scanning, setScanning] = useState(false);

  const packages: any[] = Array.isArray(data?.packages) ? data.packages : [
    { name: 'next', version: '14.1.0', latest: '14.1.0', status: 'up_to_date', severity: null },
    { name: 'react', version: '18.2.0', latest: '18.3.1', status: 'outdated', severity: null },
    { name: 'expo-sqlite', version: '14.0.0', latest: '14.0.0', status: 'up_to_date', severity: null },
    { name: 'jsonwebtoken', version: '9.0.1', latest: '9.0.2', status: 'outdated', severity: 'low' },
    { name: 'bcrypt', version: '5.1.0', latest: '5.1.1', status: 'outdated', severity: null },
    { name: 'pydantic', version: '2.5.0', latest: '2.5.0', status: 'up_to_date', severity: null },
    { name: 'fastapi', version: '0.109.0', latest: '0.109.2', status: 'outdated', severity: null },
    { name: 'sqlalchemy', version: '2.0.25', latest: '2.0.27', status: 'outdated', severity: null },
    { name: 'httpx', version: '0.26.0', latest: '0.27.0', status: 'vulnerable', severity: 'medium' },
    { name: 'cryptography', version: '41.0.7', latest: '42.0.0', status: 'vulnerable', severity: 'high' },
    { name: 'uvicorn', version: '0.27.0', latest: '0.27.1', status: 'outdated', severity: null },
    { name: 'alembic', version: '1.13.1', latest: '1.13.2', status: 'outdated', severity: null },
    { name: 'expo-image-picker', version: '55.0.19', latest: '55.0.19', status: 'up_to_date', severity: null },
    { name: 'expo-location', version: '~19.0.8', latest: '~19.0.8', status: 'up_to_date', severity: null },
  ];

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={() => {}} />;

  const totalPkg = packages.length;
  const upToDate = packages.filter((p) => p.status === 'up_to_date').length;
  const outdated = packages.filter((p) => p.status === 'outdated').length;
  const vulnerable = packages.filter((p) => p.status === 'vulnerable').length;

  const handleScan = () => {
    setScanning(true);
    setTimeout(() => setScanning(false), 2000);
  };

  const statusColors: Record<string, string> = {
    up_to_date: 'bg-green-100 text-green-700',
    outdated: 'bg-amber-100 text-amber-700',
    vulnerable: 'bg-red-100 text-red-700',
  };

  return (
    <div className="space-y-6">
                    !data?.packages && (
                    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-medium text-amber-800">Fallback demo data shown &mdash; backend unavailable.</span>
                    </div>
                    </div>
                    )
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Package className="h-5 w-5 text-green-600" /> Dependency Scan
            <Badge variant="secondary" className="ml-2 text-xs bg-amber-100 text-amber-800">Demo Reference</Badge>
          </h2>
          <p className="text-sm text-gray-500 mt-1">Package vulnerability and version audit</p>
        </div>
        <Button onClick={handleScan} disabled={scanning} variant="outline" className="border-green-300 text-green-700 hover:bg-green-50">
          {scanning ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
          {scanning ? 'Scanning...' : 'Run Scan'}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="rounded-xl shadow-sm border-gray-200"><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-gray-800">{totalPkg}</p><p className="text-xs text-gray-500 mt-1">Total Packages</p></CardContent></Card>
        <Card className="rounded-xl shadow-sm border-gray-200"><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-green-600">{upToDate}</p><p className="text-xs text-gray-500 mt-1">Up-to-date</p></CardContent></Card>
        <Card className="rounded-xl shadow-sm border-gray-200"><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-amber-600">{outdated}</p><p className="text-xs text-gray-500 mt-1">Outdated</p></CardContent></Card>
        <Card className="rounded-xl shadow-sm border-gray-200"><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-red-600">{vulnerable}</p><p className="text-xs text-gray-500 mt-1">Vulnerable</p></CardContent></Card>
      </div>

      <ScrollArea className="max-h-[500px]">
        <DashboardTable
          headers={['Package', 'Installed', 'Latest', 'Status', 'Severity']}
          rows={packages.map((p) => [
            <span key="name" className="font-mono text-xs font-medium text-gray-800">{p.name}</span>,
            <span key="ver" className="font-mono text-xs text-gray-600">{p.version}</span>,
            <span key="latest" className="font-mono text-xs text-gray-400">{p.latest}</span>,
            <Badge key="st" variant="secondary" className={`${statusColors[p.status] || 'bg-gray-100 text-gray-600'} border-0 text-xs`}>
              {p.status === 'up_to_date' ? 'Up-to-date' : p.status === 'outdated' ? 'Outdated' : 'Vulnerable'}
            </Badge>,
            p.severity ? <StatusBadge key="sev" status={p.severity} /> : <span key="sev" className="text-gray-300">—</span>,
          ])}
          emptyMessage="No packages found"
        />
      </ScrollArea>
    </div>
  );
}

// ---------- API SECURITY TESTS ----------
function APISecurityTestsView({ enabled }: { enabled: boolean }) {
  const { data, loading, error } = useSecurityAPI<any>('api-tests', enabled);
  const [running, setRunning] = useState(false);

  const tests: any[] = Array.isArray(data?.tests) ? data.tests : [
    { endpoint: '/api/v1/auth/login', testType: 'Auth Bypass', status: 'passed', duration: '245ms', details: 'Invalid PIN returns 401. Missing fields return 422.' },
    { endpoint: '/api/v1/clients/', testType: 'SQL Injection', status: 'passed', duration: '180ms', details: 'Parameterized queries prevent injection on search, member_id filters.' },
    { endpoint: '/api/v1/collections/', testType: 'XSS Prevention', status: 'passed', duration: '155ms', details: 'HTML in client_name field is escaped in responses.' },
    { endpoint: '/api/v1/auth/login', testType: 'Rate Limiting', status: 'passed', duration: '3200ms', details: 'Returns 429 after 5 failed attempts within 60 seconds.' },
    { endpoint: '/api/v1/collections/', testType: 'Input Validation', status: 'passed', duration: '190ms', details: 'Negative amounts, zero amounts, and non-numeric values rejected.' },
    { endpoint: '/api/v1/sync/events', testType: 'CSRF Protection', status: 'passed', duration: '210ms', details: 'POST without auth header returns 401. Same-origin policy enforced.' },
    { endpoint: '/api/v1/manager/dashboard', testType: 'Auth Bypass', status: 'passed', duration: '200ms', details: 'Field officer role token receives 403 on manager endpoints.' },
    { endpoint: '/api/v1/devices/register', testType: 'Input Validation', status: 'warning', duration: '175ms', details: 'Missing device_fingerprint field accepted — should be required.' },
    { endpoint: '/api/v1/clients/', testType: 'Rate Limiting', status: 'passed', duration: '2800ms', details: 'Pagination prevents data exfiltration. 100 req/min per IP.' },
    { endpoint: '/api/v1/audit-events/', testType: 'Auth Bypass', status: 'passed', duration: '195ms', details: 'Audit log access restricted to manager+ roles. FO receives 403.' },
  ];

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={() => {}} />;

  const passed = tests.filter((t) => t.status === 'passed').length;
  const failed = tests.filter((t) => t.status === 'failed').length;
  const warnings = tests.filter((t) => t.status === 'warning').length;

  const handleRun = () => {
    setRunning(true);
    setTimeout(() => setRunning(false), 3000);
  };

  const statusColors: Record<string, string> = {
    passed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    warning: 'bg-amber-100 text-amber-700',
  };

  return (
    <div className="space-y-6">
                    !data?.tests && (
                    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-medium text-amber-800">Fallback demo data shown &mdash; backend unavailable.</span>
                    </div>
                    </div>
                    )
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Lock className="h-5 w-5 text-green-600" /> API Security Tests
            <Badge variant="secondary" className="ml-2 text-xs bg-amber-100 text-amber-800">Demo Reference</Badge>
          </h2>
          <p className="text-sm text-gray-500 mt-1">Automated security test results</p>
        </div>
        <Button onClick={handleRun} disabled={running} className="bg-green-600 hover:bg-green-700 text-white">
          {running ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Zap className="h-4 w-4 mr-1.5" />}
          {running ? 'Running...' : 'Re-run Tests'}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="rounded-xl shadow-sm border-gray-200"><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-gray-800">{tests.length}</p><p className="text-xs text-gray-500 mt-1">Total Tests</p></CardContent></Card>
        <Card className="rounded-xl shadow-sm border-gray-200"><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-green-600">{passed}</p><p className="text-xs text-gray-500 mt-1">Passed</p></CardContent></Card>
        <Card className="rounded-xl shadow-sm border-gray-200"><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-red-600">{failed}</p><p className="text-xs text-gray-500 mt-1">Failed</p></CardContent></Card>
        <Card className="rounded-xl shadow-sm border-gray-200"><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-amber-600">{warnings}</p><p className="text-xs text-gray-500 mt-1">Warnings</p></CardContent></Card>
      </div>

      <ScrollArea className="max-h-[500px]">
        <DashboardTable
          headers={['Endpoint', 'Test Type', 'Status', 'Duration', 'Details']}
          rows={tests.map((t, i) => [
            <span key="ep" className="font-mono text-xs text-gray-600">{t.endpoint}</span>,
            <span key="tt" className="text-xs font-medium text-gray-800">{t.testType}</span>,
            <Badge key="st" variant="secondary" className={`${statusColors[t.status] || 'bg-gray-100 text-gray-600'} border-0 text-xs`}>
              {t.status.charAt(0).toUpperCase() + t.status.slice(1)}
            </Badge>,
            <span key="dur" className="font-mono text-xs text-gray-500">{t.duration}</span>,
            <span key="det" className="text-xs text-gray-600 max-w-[250px] truncate" title={t.details}>{t.details}</span>,
          ])}
          emptyMessage="No test results"
        />
      </ScrollArea>
    </div>
  );
}

// ---------- COMPLIANCE STATUS ----------
function ComplianceStatusView({ enabled }: { enabled: boolean }) {
  const { data, loading, error } = useSecurityAPI<any>('compliance', enabled);

  const mockData = data || {
    overall_score: 78,
    last_assessment: '2025-12-20',
    categories: [
      { name: 'Authentication', score: 92, requirements: [{ label: 'PIN authentication with rate limiting', passed: true }, { label: 'Biometric login support', passed: true }, { label: 'JWT token expiry & refresh', passed: true }] },
      { name: 'Authorization', score: 85, requirements: [{ label: 'Role-based access control (RBAC)', passed: true }, { label: 'Server-side permission checks', passed: true }, { label: 'Minimal API scope per role', passed: true }] },
      { name: 'Data Protection', score: 70, requirements: [{ label: 'TLS encryption in transit', passed: true }, { label: 'Encryption at rest', passed: true }, { label: 'Data minimization in API responses', passed: false }, { label: 'PII masking in audit logs', passed: true }] },
      { name: 'Audit & Logging', score: 88, requirements: [{ label: 'Immutable audit trail', passed: true }, { label: 'GPS + timestamp on sensitive actions', passed: true }, { label: 'Sync queue audit logging', passed: true }] },
      { name: 'Incident Response', score: 60, requirements: [{ label: 'Incident response playbook', passed: true }, { label: 'Emergency contacts documented', passed: true }, { label: 'Annual security drill conducted', passed: false }] },
      { name: 'Privacy & Consent', score: 75, requirements: [{ label: 'Client consent capture', passed: true }, { label: 'Consent revocation process', passed: true }, { label: 'Data subject rights (access/delete)', passed: false }] },
    ],
    pilot_readiness: 'conditional',
  };

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={() => {}} />;

  const score = mockData.overall_score ?? 78;
  const scoreColor = score >= 80 ? '#16A34A' : score >= 50 ? '#F59E0B' : '#DC2626';
  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (score / 100) * circumference;
  const categories: any[] = Array.isArray(mockData.categories) ? mockData.categories : [];

  return (
    <div className="space-y-6">
                    !data && (
                    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-medium text-amber-800">Fallback demo data shown &mdash; backend unavailable.</span>
                    </div>
                    </div>
                    )
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <BadgeCheck className="h-5 w-5 text-green-600" /> Compliance Status
            <Badge variant="secondary" className="ml-2 text-xs bg-amber-100 text-amber-800">Demo Reference</Badge>
          </h2>
          <p className="text-sm text-gray-500 mt-1">Regulatory compliance for pilot institution readiness</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Last assessment: {mockData.last_assessment}</span>
          <StatusBadge status={mockData.pilot_readiness === 'ready' ? 'active' : mockData.pilot_readiness === 'conditional' ? 'warning' : 'critical'} />
        </div>
      </div>

      {/* Overall Score */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-6 flex flex-col items-center">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-4">Overall Compliance</p>
            <div className="relative h-32 w-32">
              <svg className="h-32 w-32 -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="54" fill="none" stroke="#E5E7EB" strokeWidth="10" />
                <circle cx="60" cy="60" r="54" fill="none" stroke={scoreColor} strokeWidth="10" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-3xl font-bold text-gray-800">{score}%</span>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5 text-gray-400" />
              <span className="text-xs text-gray-500">
                {mockData.pilot_readiness === 'ready' ? 'Ready for pilot deployment' : mockData.pilot_readiness === 'conditional' ? 'Conditionally ready — address findings' : 'Not ready — critical gaps identified'}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Category Scores */}
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700">Category Scores</CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            {categories.map((cat: any, i: number) => {
              const catScore = cat.score ?? 0;
              return (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-700">{cat.name}</span>
                    <span className="text-gray-600 font-medium">{catScore}%</span>
                  </div>
                  <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${catScore}%`, backgroundColor: pctColor(catScore) }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* Requirements Checklist */}
      <Card className="rounded-xl shadow-sm border-gray-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-700">Requirements Checklist</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-4">
              {categories.map((cat: any, ci: number) => (
                <div key={ci}>
                  <p className="text-sm font-semibold text-gray-700 mb-2">{cat.name}</p>
                  <div className="space-y-1 pl-2">
                    {(Array.isArray(cat.requirements) ? cat.requirements : []).map((req: any, ri: number) => (
                      <div key={ri} className="flex items-center gap-2 py-1">
                        {req.passed ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                        )}
                        <span className={`text-sm ${req.passed ? 'text-gray-600' : 'text-red-600 font-medium'}`}>{req.label}</span>
                      </div>
                    ))}
                  </div>
                  {ci < categories.length - 1 && <div className="border-t border-gray-100 mt-3" />}
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Pilot Preparation Views ────────────────────────────────────────────

// ---------- PILOT OVERVIEW ----------
function PilotOverviewView({ enabled }: { enabled: boolean }) {
  const { data, loading, error, refetch } = usePilotAPI<any>('overview', enabled);
  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const mock = data || {
    pilot_name: 'FieldOS Nepal Pilot v1.0',
    institution: 'Nepal Microfinance Institution',
    phase: 'preparation',
    start_date: '2025-06-15',
    end_date: '2025-09-15',
    duration_days: 92,
    branches_ready: 3,
    branches_total: 5,
    officers_trained: 18,
    officers_total: 25,
    agreements_signed: 3,
    agreements_total: 5,
    it_approved: true,
  };
  const d = mock;

  const phaseConfig: Record<string, { label: string; color: string; bg: string }> = {
    preparation: { label: 'Preparation', color: 'text-amber-700', bg: 'bg-amber-100' },
    active: { label: 'Active', color: 'text-green-700', bg: 'bg-green-100' },
    completed: { label: 'Completed', color: 'text-blue-700', bg: 'bg-blue-100' },
  };
  const phase = phaseConfig[d.phase] || phaseConfig.preparation;

  const milestones = [
    { label: 'Project Kickoff', date: 'Jun 1, 2025', status: 'completed' },
    { label: 'IT Infrastructure Ready', date: 'Jun 10, 2025', status: 'completed' },
    { label: 'Documents Approved', date: 'Jun 18, 2025', status: 'completed' },
    { label: 'Staff Training Complete', date: 'Jul 5, 2025', status: 'in_progress' },
    { label: 'Branch Go-Live (Wave 1)', date: 'Jul 15, 2025', status: 'pending' },
    { label: 'All Branches Go-Live', date: 'Aug 1, 2025', status: 'pending' },
    { label: 'Pilot Evaluation', date: 'Sep 1, 2025', status: 'pending' },
    { label: 'Final Report & Sign-off', date: 'Sep 15, 2025', status: 'pending' },
  ];

  const statusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />;
      case 'in_progress': return <Clock className="h-5 w-5 text-amber-500 shrink-0" />;
      default: return <div className="h-5 w-5 rounded-full border-2 border-gray-300 shrink-0" />;
    }
  };

  return (
    <div className="space-y-6">
                    !data && (
                    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-medium text-amber-800">Fallback demo data shown &mdash; backend unavailable.</span>
                    </div>
                    </div>
                    )
      <div>
        <h2 className="text-xl font-bold text-gray-800">Pilot Overview
          <Badge variant="secondary" className="ml-2 text-xs bg-blue-100 text-blue-800">Pilot Reference</Badge>
        </h2>
        <p className="text-sm text-gray-500 mt-1">Track pilot program progress and readiness</p>
      </div>

      {/* Pilot Status Card */}
      <Card className="rounded-xl shadow-sm border-gray-200">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="h-12 w-12 rounded-xl bg-cyan-100 flex items-center justify-center">
                  <Rocket className="h-6 w-6 text-cyan-600" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-800">{d.pilot_name}</h3>
                  <p className="text-sm text-gray-500">{d.institution}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2">
                <Badge className={`${phase.bg} ${phase.color} border-0 font-medium`}>{phase.label}</Badge>
                <span className="text-xs text-gray-500">{d.start_date} → {d.end_date}</span>
                <span className="text-xs text-gray-400">({d.duration_days} days)</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Branches Ready', value: `${d.branches_ready}/${d.branches_total}`, color: 'text-cyan-600', icon: <Building2 className="h-4 w-4" /> },
          { label: 'Officers Trained', value: `${d.officers_trained}/${d.officers_total}`, color: 'text-green-600', icon: <Users className="h-4 w-4" /> },
          { label: 'Agreements Signed', value: `${d.agreements_signed}/${d.agreements_total}`, color: 'text-amber-600', icon: <ClipboardList className="h-4 w-4" /> },
          { label: 'IT Approved', value: d.it_approved ? 'Yes' : 'No', color: d.it_approved ? 'text-green-600' : 'text-red-600', icon: <CheckCircle2 className="h-4 w-4" /> },
        ].map((s, i) => (
          <Card key={i} className="rounded-xl shadow-sm border-gray-200">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className={`${s.color}`}>{s.icon}</span>
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">{s.label}</p>
              </div>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Timeline */}
      <Card className="rounded-xl shadow-sm border-gray-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-700">Milestone Timeline</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="space-y-4">
            {milestones.map((m, i) => (
              <div key={i} className="flex items-start gap-3">
                {statusIcon(m.status)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className={`text-sm font-medium ${m.status === 'completed' ? 'text-gray-500 line-through' : m.status === 'in_progress' ? 'text-gray-800' : 'text-gray-500'}`}>
                      {m.label}
                    </p>
                    <span className="text-xs text-gray-400 ml-2">{m.date}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card className="rounded-xl shadow-sm border-gray-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-700">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'View Documents', icon: <FileText className="h-4 w-4" />, view: 'pilot-documents' as ViewId },
              { label: 'Check Readiness', icon: <Building2 className="h-4 w-4" />, view: 'pilot-branches' as ViewId },
              { label: 'Track Training', icon: <GraduationCap className="h-4 w-4" />, view: 'pilot-training' as ViewId },
              { label: 'Submit Feedback', icon: <MessageSquare className="h-4 w-4" />, view: 'pilot-feedback' as ViewId },
            ].map((action) => (
              <QuickActionButton key={action.label} label={action.label} icon={action.icon} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function QuickActionButton({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <button className="flex flex-col items-center gap-2 p-3 rounded-xl bg-gray-50 hover:bg-cyan-50 hover:border-cyan-200 border border-gray-200 transition-colors">
      <div className="h-8 w-8 rounded-lg bg-cyan-100 text-cyan-600 flex items-center justify-center">{icon}</div>
      <span className="text-xs font-medium text-gray-700">{label}</span>
    </button>
  );
}

// ---------- PILOT BRANCHES ----------
function PilotBranchesView({ enabled }: { enabled: boolean }) {
  const { data, loading, error, refetch } = usePilotAPI<any>('branches', enabled);
  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const branches: any[] = Array.isArray(data?.branches) ? data.branches : [
    { name: 'Kathmandu Main', manager: 'Rajesh Sharma', officers: 6, clients: 120, readiness: ['IT', 'Network', 'Staff', 'Manager Trained', 'Officers Trained', 'Devices', 'Agreement', 'Go-Live'] },
    { name: 'Pokhara Branch', manager: 'Sita Adhikari', officers: 5, clients: 85, readiness: ['IT', 'Network', 'Staff', 'Manager Trained', 'Officers Trained', 'Devices'] },
    { name: 'Biratnagar Branch', manager: 'Hari Thapa', officers: 5, clients: 90, readiness: ['IT', 'Network', 'Staff', 'Manager Trained'] },
    { name: 'Chitwan Branch', manager: 'Anita Gurung', officers: 4, clients: 70, readiness: ['IT', 'Network', 'Staff'] },
    { name: 'Lalitpur Branch', manager: 'Bikash Poudel', officers: 5, clients: 95, readiness: ['IT', 'Network'] },
  ];

  const checklistItems = ['IT', 'Network', 'Staff', 'Manager Trained', 'Officers Trained', 'Devices', 'Agreement', 'Go-Live'];
  const readyCount = branches.filter((b: any) => {
    const r = Array.isArray(b.readiness) ? b.readiness : [];
    return r.length === 8;
  }).length;

  const scoreColor = (score: number) => {
    if (score >= 7) return 'bg-green-100 text-green-700 border-green-200';
    if (score >= 5) return 'bg-amber-100 text-amber-700 border-amber-200';
    if (score >= 3) return 'bg-orange-100 text-orange-700 border-orange-200';
    return 'bg-red-100 text-red-700 border-red-200';
  };

  return (
    <div className="space-y-6">
                    !data?.branches && (
                    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-medium text-amber-800">Fallback demo data shown &mdash; backend unavailable.</span>
                    </div>
                    </div>
                    )
      <div>
        <h2 className="text-xl font-bold text-gray-800">Branch Readiness</h2>
        <p className="text-sm text-gray-500 mt-1">Track preparation status for all pilot branches</p>
      </div>

      {/* Overall Readiness */}
      <Card className="rounded-xl shadow-sm border-gray-200">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">Overall Readiness</p>
              <p className="text-xs text-gray-500 mt-1">{readyCount} of {branches.length} branches fully ready</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-48 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-cyan-500 transition-all duration-500"
                  style={{ width: `${branches.length > 0 ? (readyCount / branches.length) * 100 : 0}%` }}
                />
              </div>
              <span className="text-sm font-bold text-gray-800">{branches.length > 0 ? Math.round((readyCount / branches.length) * 100) : 0}%</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Branch Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {branches.map((branch: any, idx: number) => {
          const readiness = Array.isArray(branch.readiness) ? branch.readiness : [];
          const score = readiness.length;
          return (
            <Card key={idx} className="rounded-xl shadow-sm border-gray-200">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-cyan-100 flex items-center justify-center">
                      <Building2 className="h-5 w-5 text-cyan-600" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-semibold text-gray-800">{branch.name}</CardTitle>
                      <p className="text-xs text-gray-500">{branch.manager}</p>
                    </div>
                  </div>
                  <Badge className={`${scoreColor(score)} border text-xs font-medium`}>{score}/8</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="flex items-center gap-4 mb-3 text-xs text-gray-500">
                  <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {branch.officers} officers</span>
                  <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {branch.clients} clients</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {checklistItems.map((item) => {
                    const done = readiness.includes(item);
                    return (
                      <div key={item} className="flex items-center gap-2 text-xs">
                        {done ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                        ) : (
                          <div className="h-3.5 w-3.5 rounded-full border-2 border-gray-300 shrink-0" />
                        )}
                        <span className={done ? 'text-gray-700 font-medium' : 'text-gray-400'}>{item}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ---------- PILOT DOCUMENTS ----------
function PilotDocumentsView({ enabled }: { enabled: boolean }) {
  const { data, loading, error, refetch } = usePilotAPI<any>('documents', enabled);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const documents = Array.isArray(data) ? data : [
    { id: 'product-overview', title: 'Product Overview', version: 'v2.1', updated: '2025-05-28', sections: ['Executive Summary', 'Product Features', 'User Roles', 'Technology Stack', 'Integration Points', 'Roadmap'] },
    { id: 'security-overview', title: 'Security Overview', version: 'v1.3', updated: '2025-05-25', sections: ['Authentication', 'Data Encryption', 'Access Control', 'Audit Logging', 'Incident Response', 'Compliance'] },
    { id: 'data-flow', title: 'Data Flow Diagram', version: 'v1.2', updated: '2025-05-22', sections: ['System Architecture', 'Data Sources', 'Sync Pipeline', 'CBS Integration', 'Offline Flow', 'Data Retention'] },
    { id: 'sop', title: 'Standard Operating Procedure', version: 'v3.0', updated: '2025-05-30', sections: ['Daily Operations', 'Visit Procedures', 'Collection Workflow', 'Exception Handling', 'Escalation Matrix', 'End-of-Day Process'] },
    { id: 'training-guide', title: 'Training Guide', version: 'v2.0', updated: '2025-05-26', sections: ['Onboarding Overview', 'App Navigation', 'Key Workflows', 'Common Scenarios', 'Troubleshooting', 'FAQ'] },
    { id: 'role-access', title: 'Role Access Matrix', version: 'v1.1', updated: '2025-05-20', sections: ['Role Definitions', 'Permission Matrix', 'Data Visibility', 'Approval Workflow', 'Override Policy'] },
    { id: 'escalation-plan', title: 'Escalation Plan', version: 'v1.2', updated: '2025-05-24', sections: ['Escalation Tiers', 'Response Times', 'Contact Matrix', 'Severity Levels', 'Resolution Workflow'] },
    { id: 'success-metrics', title: 'Success Metrics', version: 'v2.0', updated: '2025-05-29', sections: ['KPI Definitions', 'Target Values', 'Measurement Methods', 'Reporting Frequency', 'Go/No-Go Criteria'] },
    { id: 'feedback-form', title: 'Feedback Form', version: 'v1.0', updated: '2025-05-15', sections: ['User Satisfaction', 'Ease of Use', 'Feature Requests', 'Bug Reports', 'Overall Assessment'] },
  ];

  const docIcons: Record<string, React.ReactNode> = {
    'product-overview': <BookOpen className="h-6 w-6 text-cyan-600" />,
    'security-overview': <Shield className="h-6 w-6 text-green-600" />,
    'data-flow': <GitBranch className="h-6 w-6 text-purple-600" />,
    'sop': <ClipboardList className="h-6 w-6 text-amber-600" />,
    'training-guide': <GraduationCap className="h-6 w-6 text-blue-600" />,
    'role-access': <Users className="h-6 w-6 text-orange-600" />,
    'escalation-plan': <ArrowUpRight className="h-6 w-6 text-red-600" />,
    'success-metrics': <Target className="h-6 w-6 text-indigo-600" />,
    'feedback-form': <MessageSquare className="h-6 w-6 text-pink-600" />,
  };

  const docBgColors: Record<string, string> = {
    'product-overview': 'bg-cyan-50',
    'security-overview': 'bg-green-50',
    'data-flow': 'bg-purple-50',
    'sop': 'bg-amber-50',
    'training-guide': 'bg-blue-50',
    'role-access': 'bg-orange-50',
    'escalation-plan': 'bg-red-50',
    'success-metrics': 'bg-indigo-50',
    'feedback-form': 'bg-pink-50',
  };

  const expanded = selectedDoc ? documents.find((d: any) => d.id === selectedDoc) : null;

  return (
    <div className="space-y-6">
                    !data || !Array.isArray(data) && (
                    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-medium text-amber-800">Fallback demo data shown &mdash; backend unavailable.</span>
                    </div>
                    </div>
                    )
      <div>
        <h2 className="text-xl font-bold text-gray-800">Pre-Pilot Documents
          <Badge variant="secondary" className="ml-2 text-xs bg-blue-100 text-blue-800">Pilot Reference</Badge>
        </h2>
        <p className="text-sm text-gray-500 mt-1">View and download all pilot preparation documents</p>
      </div>

      {expanded ? (
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedDoc(null)}
                  className="p-1 rounded hover:bg-gray-100 text-gray-500"
                >
                  <ChevronRight className="h-5 w-5 rotate-180" />
                </button>
                <div className={`h-10 w-10 rounded-lg ${docBgColors[expanded.id] || 'bg-gray-50'} flex items-center justify-center`}>
                  {docIcons[expanded.id] || <FileText className="h-6 w-6 text-gray-600" />}
                </div>
                <div>
                  <CardTitle className="text-sm font-semibold text-gray-800">{expanded.title}</CardTitle>
                  <p className="text-xs text-gray-500">{expanded.version} · Updated {formatDateShort(expanded.updated)}</p>
                </div>
              </div>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Download className="h-3.5 w-3.5" /> Download
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            <div className="space-y-4">
              {expanded.sections.map((section: string, i: number) => (
                <div key={i} className="border-l-4 border-cyan-200 pl-4 py-2">
                  <h4 className="text-sm font-semibold text-gray-800">{i + 1}. {section}</h4>
                  <p className="text-xs text-gray-500 mt-1">
                    This section covers the details of {section.toLowerCase()} for the FieldOS Nepal pilot program.
                    Content will be loaded from the backend pilot endpoint for document ID: {expanded.id}.
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {documents.map((doc: any) => (
            <Card
              key={doc.id}
              className="rounded-xl shadow-sm border-gray-200 hover:shadow-md cursor-pointer transition-shadow"
              onClick={() => setSelectedDoc(doc.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className={`h-10 w-10 rounded-lg ${docBgColors[doc.id] || 'bg-gray-50'} flex items-center justify-center shrink-0`}>
                    {docIcons[doc.id] || <FileText className="h-6 w-6 text-gray-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-gray-800 truncate">{doc.title}</h3>
                    <p className="text-xs text-gray-500 mt-0.5">{doc.version} · {formatDateShort(doc.updated)}</p>
                    <p className="text-xs text-gray-400 mt-1">{doc.sections.length} sections</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- PILOT TRAINING ----------
function PilotTrainingView({ enabled }: { enabled: boolean }) {
  const { data, loading, error, refetch } = usePilotAPI<any>('training', enabled);
  const [filterType, setFilterType] = useState<string>('all');
  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const modules: any[] = Array.isArray(data?.modules) ? data.modules : [
    { name: 'App Navigation', type: 'self-paced', duration: '30 min', progress: 100, completion_rate: 92 },
    { name: 'Client Management', type: 'self-paced', duration: '45 min', progress: 100, completion_rate: 88 },
    { name: 'Collection Recording', type: 'in-person', duration: '2 hrs', progress: 100, completion_rate: 76 },
    { name: 'Visit Check-in & GPS', type: 'in-person', duration: '1 hr', progress: 85, completion_rate: 65 },
    { name: 'Promise-to-Pay', type: 'self-paced', duration: '30 min', progress: 70, completion_rate: 58 },
    { name: 'Center Meeting', type: 'in-person', duration: '2 hrs', progress: 55, completion_rate: 42 },
    { name: 'End-of-Day Process', type: 'self-paced', duration: '45 min', progress: 40, completion_rate: 35 },
    { name: 'Exception Handling', type: 'in-person', duration: '1 hr', progress: 20, completion_rate: 18 },
  ];

  const sessions: any[] = Array.isArray(data?.sessions) ? data.sessions : [
    { date: '2025-06-10', branch: 'Kathmandu Main', type: 'in-person', attendees: 6, completion: 'completed' },
    { date: '2025-06-08', branch: 'Pokhara Branch', type: 'self-paced', attendees: 5, completion: 'completed' },
    { date: '2025-06-05', branch: 'Biratnagar Branch', type: 'in-person', attendees: 5, completion: 'completed' },
    { date: '2025-06-03', branch: 'Chitwan Branch', type: 'self-paced', attendees: 4, completion: 'in_progress' },
  ];

  const overallProgress = Math.round(modules.reduce((a: number, m: any) => a + m.progress, 0) / modules.length);
  const overallCompletion = Math.round(modules.reduce((a: number, m: any) => a + m.completion_rate, 0) / modules.length);

  const filteredModules = filterType === 'all' ? modules : modules.filter((m: any) => m.type === filterType);

  return (
    <div className="space-y-6">
                    !data?.modules && (
                    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-medium text-amber-800">Fallback demo data shown &mdash; backend unavailable.</span>
                    </div>
                    </div>
                    )
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Training Tracker
            <Badge variant="secondary" className="ml-2 text-xs bg-blue-100 text-blue-800">Pilot Reference</Badge>
          </h2>
          <p className="text-sm text-gray-500 mt-1">Monitor training progress for all pilot staff</p>
        </div>
        <div className="flex items-center gap-2">
          {['all', 'self-paced', 'in-person'].map((type) => (
            <Button
              key={type}
              variant={filterType === type ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterType(type)}
              className="text-xs capitalize"
            >
              {type === 'all' ? 'All' : type.replace('-', ' ')}
            </Button>
          ))}
        </div>
      </div>

      {/* Overall Progress */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-gray-700">Module Progress</p>
              <span className="text-lg font-bold text-cyan-600">{overallProgress}%</span>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-cyan-500 transition-all duration-500" style={{ width: `${overallProgress}%` }} />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-gray-700">Staff Completion</p>
              <span className="text-lg font-bold text-green-600">{overallCompletion}%</span>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-green-500 transition-all duration-500" style={{ width: `${overallCompletion}%` }} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Module Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {filteredModules.map((mod: any, i: number) => (
          <Card key={i} className="rounded-xl shadow-sm border-gray-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <Badge className={`border-0 text-xs font-medium ${mod.type === 'self-paced' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                  {(mod.type ?? '').replace('-', ' ')}
                </Badge>
                <span className="text-xs text-gray-400">{mod.duration}</span>
              </div>
              <h4 className="text-sm font-semibold text-gray-800 mb-3">{mod.name}</h4>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-2">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${mod.progress}%`, backgroundColor: pctColor(mod.progress) }} />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">Progress</span>
                <span className="font-medium text-gray-700">{mod.progress}%</span>
              </div>
              <div className="flex items-center justify-between text-xs mt-1">
                <span className="text-gray-500">Completion</span>
                <span className="font-medium text-gray-700">{mod.completion_rate}%</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Session History */}
      <Card className="rounded-xl shadow-sm border-gray-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-700">Training Session History</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <DashboardTable
            headers={['Date', 'Branch', 'Type', 'Attendees', 'Status']}
            rows={sessions.map((s: any) => [
              <span key="date" className="text-xs text-gray-500">{formatDateShort(s.date)}</span>,
              <span key="branch" className="font-medium text-gray-800">{s.branch}</span>,
              <Badge key="type" className={`border-0 text-xs ${s.type === 'self-paced' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                {(s.type ?? '').replace('-', ' ')}
              </Badge>,
              <span key="attendees" className="text-gray-700">{s.attendees}</span>,
              <StatusBadge key="status" status={s.completion} />,
            ])}
            emptyMessage="No training sessions recorded"
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- PILOT METRICS ----------
function PilotMetricsView({ enabled }: { enabled: boolean }) {
  const { data, loading, error, refetch } = usePilotAPI<any>('metrics', enabled);
  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const kpis: any[] = Array.isArray(data?.kpis) ? data.kpis : [
    { metric: 'Collection Accuracy', target: '99.5%', current: '98.2%', status: 'on_track' },
    { metric: 'Visit Completion Rate', target: '95%', current: '88%', status: 'at_risk' },
    { metric: 'Sync Success Rate', target: '99%', current: '97.5%', status: 'on_track' },
    { metric: 'User Adoption Rate', target: '90%', current: '72%', status: 'behind' },
    { metric: 'Exception Rate', target: '<2%', current: '3.1%', status: 'at_risk' },
    { metric: 'Avg Collection Time', target: '<3 min', current: '2.5 min', status: 'on_track' },
    { metric: 'Client Satisfaction', target: '4.0/5', current: '—', status: 'not_started' },
    { metric: 'EOD Submission Time', target: '<30 min', current: '—', status: 'not_started' },
  ];

  const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
    not_started: { label: 'Not Started', color: 'text-gray-600', bg: 'bg-gray-100' },
    on_track: { label: 'On Track', color: 'text-green-700', bg: 'bg-green-100' },
    at_risk: { label: 'At Risk', color: 'text-amber-700', bg: 'bg-amber-100' },
    behind: { label: 'Behind', color: 'text-red-700', bg: 'bg-red-100' },
  };

  return (
    <div className="space-y-6">
                    !data?.kpis && (
                    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-medium text-amber-800">Fallback demo data shown &mdash; backend unavailable.</span>
                    </div>
                    </div>
                    )
      <div>
        <h2 className="text-xl font-bold text-gray-800">Success Metrics
          <Badge variant="secondary" className="ml-2 text-xs bg-blue-100 text-blue-800">Pilot Reference</Badge>
        </h2>
        <p className="text-sm text-gray-500 mt-1">Track KPIs against pilot success criteria</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi: any, i: number) => {
          const st = statusConfig[kpi.status] || statusConfig.not_started;
          return (
            <Card key={i} className="rounded-xl shadow-sm border-gray-200">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">{kpi.metric}</p>
                  <Badge className={`${st.bg} ${st.color} border-0 text-[10px] font-medium`}>{st.label}</Badge>
                </div>
                <div className="flex items-end gap-2 mb-1">
                  <span className="text-xl font-bold text-gray-800">{kpi.current}</span>
                  <span className="text-xs text-gray-400 mb-1">/ {kpi.target}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: kpi.status === 'not_started' ? '0%' :
                        kpi.status === 'on_track' ? '80%' :
                        kpi.status === 'at_risk' ? '55%' : '30%',
                      backgroundColor: kpi.status === 'not_started' ? '#9CA3AF' :
                        kpi.status === 'on_track' ? '#16A34A' :
                        kpi.status === 'at_risk' ? '#F59E0B' : '#DC2626',
                    }}
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Review Notes */}
      <Card className="rounded-xl shadow-sm border-gray-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-700">Review Notes</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-sm text-gray-600">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <p>User Adoption Rate is behind target. Consider additional training sessions for Biratnagar and Chitwan branches.</p>
            </div>
            <div className="flex items-start gap-2 text-sm text-gray-600">
              <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
              <p>Collection Accuracy is on track. The CBS reconciliation module is performing well.</p>
            </div>
            <div className="flex items-start gap-2 text-sm text-gray-500">
              <Info className="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
              <p>Client Satisfaction and EOD Submission metrics will be available after pilot go-live.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Weekly Trend Placeholder */}
      <Card className="rounded-xl shadow-sm border-gray-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-700">Weekly Trend</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="flex items-center justify-center py-12 text-gray-400">
            <div className="text-center">
              <BarChart3 className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Weekly trend data will be available during active pilot phase</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- PILOT FEEDBACK ----------
function PilotFeedbackView({ enabled }: { enabled: boolean }) {
  const { data, loading, error, refetch } = usePilotAPI<any>('feedback', enabled);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<Record<string, string>>({});
  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const summary = data?.summary || {
    total_responses: 12,
    avg_satisfaction: 3.8,
    recommend_rate: 75,
  };

  const responses: any[] = Array.isArray(data?.responses) ? data.responses : [
    { id: 1, branch: 'Kathmandu Main', role: 'field_officer', rating: 4, submitted: '2025-06-10T14:30:00' },
    { id: 2, branch: 'Pokhara Branch', role: 'branch_manager', rating: 5, submitted: '2025-06-09T11:20:00' },
    { id: 3, branch: 'Biratnagar Branch', role: 'field_officer', rating: 3, submitted: '2025-06-08T16:45:00' },
    { id: 4, branch: 'Kathmandu Main', role: 'field_officer', rating: 4, submitted: '2025-06-07T09:15:00' },
  ];

  const ratingQuestions = [
    { id: 'q1', label: 'How easy is the app to navigate?', field: 'ease_of_use' },
    { id: 'q2', label: 'How satisfied are you with the collection workflow?', field: 'collection_satisfaction' },
    { id: 'q3', label: 'How reliable is the offline sync feature?', field: 'sync_reliability' },
    { id: 'q4', label: 'How helpful is the GPS check-in feature?', field: 'gps_helpfulness' },
    { id: 'q5', label: 'Overall satisfaction with FieldOS?', field: 'overall_satisfaction' },
  ];

  const textQuestions = [
    { id: 'q6', label: 'What features do you find most useful?', field: 'useful_features' },
    { id: 'q7', label: 'What challenges have you encountered?', field: 'challenges' },
    { id: 'q8', label: 'Any suggestions for improvement?', field: 'suggestions' },
  ];

  const selectQuestion = {
    id: 'q9', label: 'How likely are you to recommend FieldOS?', field: 'recommend',
    options: ['Very Likely', 'Likely', 'Neutral', 'Unlikely', 'Very Unlikely'],
  };

  async function handleSubmit() {
    setSubmitting(true);
    await apiMutation('pilot/feedback', 'POST', formData);
    setSubmitting(false);
    setShowForm(false);
    setFormData({});
    refetch();
  }

  return (
    <div className="space-y-6">
      {!data?.responses && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span className="text-sm font-medium text-amber-800">Fallback demo data shown &mdash; backend unavailable.</span>
          </div>
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-800">User Feedback
            <Badge variant="secondary" className="ml-2 text-xs bg-blue-100 text-blue-800">Pilot Reference</Badge>
          </h2>
          <p className="text-sm text-gray-500 mt-1">Collect and review pilot user feedback</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="gap-1.5 bg-cyan-600 hover:bg-cyan-700">
          <MessageSquare className="h-4 w-4" /> {showForm ? 'Hide Form' : 'New Feedback'}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Total Responses</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{summary.total_responses}</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Avg Satisfaction</p>
            <div className="flex items-center justify-center gap-1 mt-1">
              <p className="text-2xl font-bold text-amber-600">{summary.avg_satisfaction}</p>
              <span className="text-sm text-gray-400">/5</span>
              <div className="flex ml-2">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star key={s} className={`h-3.5 w-3.5 ${s <= Math.round(summary.avg_satisfaction) ? 'text-amber-400 fill-amber-400' : 'text-gray-300'}`} />
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Recommend Rate</p>
            <p className="text-2xl font-bold text-green-600 mt-1">{summary.recommend_rate}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Feedback Form */}
      {showForm && (
        <Card className="rounded-xl shadow-sm border-2 border-cyan-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700">Submit Feedback</CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            {ratingQuestions.map((q) => (
              <div key={q.id}>
                <label className="text-sm font-medium text-gray-700 block mb-2">{q.label}</label>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setFormData((prev) => ({ ...prev, [q.field]: String(s) }))}
                      className="p-0.5"
                    >
                      <Star className={`h-6 w-6 transition-colors ${Number(formData[q.field]) >= s ? 'text-amber-400 fill-amber-400' : 'text-gray-300 hover:text-amber-300'}`} />
                    </button>
                  ))}
                  <span className="text-xs text-gray-400 ml-2">{formData[q.field] || '—'}/5</span>
                </div>
              </div>
            ))}
            {textQuestions.map((q) => (
              <div key={q.id}>
                <label className="text-sm font-medium text-gray-700 block mb-1.5">{q.label}</label>
                <textarea
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent resize-none"
                  rows={2}
                  value={formData[q.field] || ''}
                  onChange={(e) => setFormData((prev) => ({ ...prev, [q.field]: e.target.value }))}
                  placeholder="Enter your response..."
                />
              </div>
            ))}
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">{selectQuestion.label}</label>
              <select
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent bg-white"
                value={formData[selectQuestion.field] || ''}
                onChange={(e) => setFormData((prev) => ({ ...prev, [selectQuestion.field]: e.target.value }))}
              >
                <option value="">Select...</option>
                {selectQuestion.options.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                className="bg-cyan-600 hover:bg-cyan-700 gap-1.5"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {submitting ? 'Submitting...' : 'Submit Feedback'}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Responses */}
      <Card className="rounded-xl shadow-sm border-gray-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-700">Recent Responses</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <DashboardTable
            headers={['Submitted', 'Branch', 'Role', 'Rating']}
            rows={responses.map((r: any) => [
              <span key="date" className="text-xs text-gray-500">{formatTime(r.submitted)}</span>,
              <span key="branch" className="font-medium text-gray-800">{r.branch}</span>,
              <span key="role" className="text-gray-600 capitalize">{(r.role ?? '').replace('_', ' ')}</span>,
              <div key="rating" className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star key={s} className={`h-3 w-3 ${s <= r.rating ? 'text-amber-400 fill-amber-400' : 'text-gray-300'}`} />
                ))}
              </div>,
            ])}
            emptyMessage="No feedback responses yet"
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- PILOT ESCALATIONS ----------
function PilotEscalationsView({ enabled }: { enabled: boolean }) {
  const { data, loading, error, refetch } = usePilotAPI<any>('escalations', enabled);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newEscalation, setNewEscalation] = useState({ title: '', severity: 'P3', description: '', branch: '' });
  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const escalations: any[] = Array.isArray(data?.escalations) ? data.escalations : [
    { id: 1, title: 'GPS check-in fails on certain Android devices', severity: 'P2', branch: 'Kathmandu Main', reporter: 'Ram Bahadur', assigned_to: 'IT Support', status: 'in_progress', created_at: '2025-06-10T09:30:00', resolution: '' },
    { id: 2, title: 'Collection receipt not printing correctly', severity: 'P3', branch: 'Pokhara Branch', reporter: 'Sita Adhikari', assigned_to: 'Dev Team', status: 'open', created_at: '2025-06-09T14:15:00', resolution: '' },
    { id: 3, title: 'Sync conflict with CBS data', severity: 'P1', branch: 'Biratnagar Branch', reporter: 'Hari Thapa', assigned_to: 'CBS Team', status: 'resolved', created_at: '2025-06-08T11:00:00', resolution: 'Fixed timezone mismatch in sync payload' },
    { id: 4, title: 'App crash when taking client photo', severity: 'P2', branch: 'Chitwan Branch', reporter: 'Anita Gurung', assigned_to: 'Dev Team', status: 'resolved', created_at: '2025-06-07T16:45:00', resolution: 'Updated camera plugin to v2.3' },
  ];

  const summary = {
    open: escalations.filter((e: any) => e.status === 'open').length,
    in_progress: escalations.filter((e: any) => e.status === 'in_progress').length,
    resolved: escalations.filter((e: any) => e.status === 'resolved').length,
    avg_resolution: '2.3 days',
  };

  const severityColors: Record<string, string> = {
    P1: 'bg-red-100 text-red-700 border-red-200',
    P2: 'bg-orange-100 text-orange-700 border-orange-200',
    P3: 'bg-amber-100 text-amber-700 border-amber-200',
    P4: 'bg-blue-100 text-blue-700 border-blue-200',
  };

  async function handleCreate() {
    if (!newEscalation.title.trim()) return;
    setSubmitting(true);
    await apiMutation('pilot/escalations', 'POST', newEscalation);
    setSubmitting(false);
    setShowForm(false);
    setNewEscalation({ title: '', severity: 'P3', description: '', branch: '' });
    refetch();
  }

  return (
    <div className="space-y-6">
      {!data?.escalations && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span className="text-sm font-medium text-amber-800">Fallback demo data shown &mdash; backend unavailable.</span>
          </div>
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Escalations
            <Badge variant="secondary" className="ml-2 text-xs bg-blue-100 text-blue-800">Pilot Reference</Badge>
          </h2>
          <p className="text-sm text-gray-500 mt-1">Track and manage pilot issues and escalations</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="gap-1.5 bg-red-600 hover:bg-red-700">
          <ArrowUpRight className="h-4 w-4" /> {showForm ? 'Cancel' : 'New Escalation'}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Open', value: summary.open, color: 'text-red-600', icon: <AlertCircle className="h-4 w-4" /> },
          { label: 'In Progress', value: summary.in_progress, color: 'text-amber-600', icon: <Clock className="h-4 w-4" /> },
          { label: 'Resolved', value: summary.resolved, color: 'text-green-600', icon: <CheckCircle2 className="h-4 w-4" /> },
          { label: 'Avg Resolution', value: summary.avg_resolution, color: 'text-blue-600', icon: <TrendingUp className="h-4 w-4" /> },
        ].map((s, i) => (
          <Card key={i} className="rounded-xl shadow-sm border-gray-200">
            <CardContent className="p-4 text-center">
              <span className={`${s.color}`}>{s.icon}</span>
              <p className="text-2xl font-bold text-gray-800 mt-1">{s.value}</p>
              <p className="text-xs text-gray-500 mt-1">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* New Escalation Form */}
      {showForm && (
        <Card className="rounded-xl shadow-sm border-2 border-red-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700">Report New Escalation</CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Title</label>
              <Input
                placeholder="Brief description of the issue"
                value={newEscalation.title}
                onChange={(e) => setNewEscalation((p) => ({ ...p, title: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Severity</label>
                <select
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
                  value={newEscalation.severity}
                  onChange={(e) => setNewEscalation((p) => ({ ...p, severity: e.target.value }))}
                >
                  <option value="P1">P1 - Critical</option>
                  <option value="P2">P2 - High</option>
                  <option value="P3">P3 - Medium</option>
                  <option value="P4">P4 - Low</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Branch</label>
                <select
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
                  value={newEscalation.branch}
                  onChange={(e) => setNewEscalation((p) => ({ ...p, branch: e.target.value }))}
                >
                  <option value="">Select branch...</option>
                  <option value="Kathmandu Main">Kathmandu Main</option>
                  <option value="Pokhara Branch">Pokhara Branch</option>
                  <option value="Biratnagar Branch">Biratnagar Branch</option>
                  <option value="Chitwan Branch">Chitwan Branch</option>
                  <option value="Lalitpur Branch">Lalitpur Branch</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Description</label>
              <textarea
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                rows={3}
                value={newEscalation.description}
                onChange={(e) => setNewEscalation((p) => ({ ...p, description: e.target.value }))}
                placeholder="Describe the issue in detail..."
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button onClick={handleCreate} disabled={submitting || !newEscalation.title.trim()} className="bg-red-600 hover:bg-red-700 gap-1.5">
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {submitting ? 'Submitting...' : 'Submit Escalation'}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Escalation List */}
      <Card className="rounded-xl shadow-sm border-gray-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-700">All Escalations</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <ScrollArea className="max-h-[500px]">
            <DashboardTable
              headers={['Severity', 'Title', 'Branch', 'Assigned To', 'Status', 'Created']}
              rows={escalations.map((e: any) => [
                <Badge key="sev" className={`${severityColors[e.severity] || 'bg-gray-100 text-gray-600'} border text-xs font-medium`}>{e.severity}</Badge>,
                <div key="title" className="max-w-[200px]">
                  <p className="text-sm font-medium text-gray-800 truncate">{e.title}</p>
                </div>,
                <span key="branch" className="text-gray-600 text-xs">{e.branch}</span>,
                <span key="assigned" className="text-gray-600 text-xs">{e.assigned_to}</span>,
                <StatusBadge key="status" status={e.status} />,
                <span key="date" className="text-xs text-gray-500">{formatDateShort(e.created_at)}</span>,
              ])}
              emptyMessage="No escalations reported"
            />
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- PILOT AGREEMENTS ----------
function PilotAgreementsView({ enabled }: { enabled: boolean }) {
  const { data, loading, error, refetch } = usePilotAPI<any>('agreements', enabled);
  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const agreements: any[] = Array.isArray(data?.agreements) ? data.agreements : [
    { id: 1, branch: 'Kathmandu Main', manager: 'Rajesh Sharma', status: 'signed', sign_date: '2025-06-01', signatory: 'Rajesh Sharma', preview_url: null },
    { id: 2, branch: 'Pokhara Branch', manager: 'Sita Adhikari', status: 'signed', sign_date: '2025-06-03', signatory: 'Sita Adhikari', preview_url: null },
    { id: 3, branch: 'Biratnagar Branch', manager: 'Hari Thapa', status: 'signed', sign_date: '2025-06-05', signatory: 'Hari Thapa', preview_url: null },
    { id: 4, branch: 'Chitwan Branch', manager: 'Anita Gurung', status: 'pending', sign_date: null, signatory: null, preview_url: null },
    { id: 5, branch: 'Lalitpur Branch', manager: 'Bikash Poudel', status: 'pending', sign_date: null, signatory: null, preview_url: null },
  ];

  const signedCount = agreements.filter((a: any) => a.status === 'signed').length;
  const pendingCount = agreements.filter((a: any) => a.status === 'pending').length;

  async function handleSign(agreementId: number) {
    await apiMutation(`pilot/agreements/${agreementId}/sign`, 'POST');
    refetch();
  }

  return (
    <div className="space-y-6">
                    !data?.agreements && (
                    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-medium text-amber-800">Fallback demo data shown &mdash; backend unavailable.</span>
                    </div>
                    </div>
                    )
      <div>
        <h2 className="text-xl font-bold text-gray-800">Agreements
          <Badge variant="secondary" className="ml-2 text-xs bg-blue-100 text-blue-800">Pilot Reference</Badge>
        </h2>
        <p className="text-sm text-gray-500 mt-1">Track pilot participation agreements by branch</p>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Total</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{agreements.length}</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Signed</p>
            <p className="text-2xl font-bold text-green-600 mt-1">{signedCount}</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm border-gray-200">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Pending</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">{pendingCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Agreement Cards */}
      <div className="space-y-3">
        {agreements.map((agreement: any) => (
          <Card key={agreement.id} className="rounded-xl shadow-sm border-gray-200">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${agreement.status === 'signed' ? 'bg-green-100' : 'bg-amber-100'}`}>
                    {agreement.status === 'signed' ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    ) : (
                      <Clock className="h-5 w-5 text-amber-600" />
                    )}
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-gray-800">{agreement.branch}</h4>
                    <p className="text-xs text-gray-500">Manager: {agreement.manager}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {agreement.status === 'signed' ? (
                    <div className="text-right">
                      <StatusBadge status="signed" />
                      <p className="text-xs text-gray-500 mt-1">Signed by {agreement.signatory}</p>
                      <p className="text-xs text-gray-400">{formatDateShort(agreement.sign_date)}</p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <StatusBadge status="pending" />
                      <Button
                        size="sm"
                        onClick={() => handleSign(agreement.id)}
                        className="bg-cyan-600 hover:bg-cyan-700 gap-1.5"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Sign
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Assign Task View ──────────────────────────────────────────────

function AssignTaskView({ enabled }: { enabled: boolean }) {
  const { data: staffData, loading: staffLoading, error: staffError } = useManagerAPI<any[]>('manager/staff', enabled);
  const { data: clientsData, loading: clientsLoading, error: clientsError } = useManagerAPI<any[]>('manager/clients', enabled);
  const [mutating, setMutating] = useState(false);
  const [form, setForm] = useState({
    officer_id: '',
    client_id: '',
    task_type: 'collection',
    task_date: new Date().toISOString().split('T')[0],
    priority: 'normal',
    amount: '',
    reason: '',
  });
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMutating(true);
    setErrorMsg('');
    setResult(null);
    try {
      const res = await apiMutation('manager/tasks', 'POST', {
        officer_id: form.officer_id || undefined,
        client_id: Number(form.client_id),
        task_type: form.task_type,
        task_date: form.task_date,
        priority: form.priority,
        amount: form.amount ? Number(form.amount) : undefined,
        reason: form.reason || undefined,
      });
      setResult((res?.data as Record<string, unknown>) ?? null);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to assign task');
    } finally {
      setMutating(false);
    }
  };

  const fieldOfficers = (staffData || []).filter((s: any) => s.role === 'field_officer');

  return (
    <div className="space-y-6" style={{ opacity: enabled ? 1 : 0, pointerEvents: enabled ? 'auto' : 'none' }}>
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Assign Task</h1>
        <p className="text-sm text-gray-500 mt-1">Create a new task assignment for a field officer</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Officer (optional)</label>
                <select
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  value={form.officer_id}
                  onChange={e => setForm(f => ({ ...f, officer_id: e.target.value }))}
                >
                  <option value="">-- Unassigned --</option>
                  {fieldOfficers.map((s: any) => (
                    <option key={s.staff_id} value={s.staff_id === 'BM-001' ? '' : s.staff_id}>
                      {s.staff_id} — {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Client *</label>
                <select
                  required
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  value={form.client_id}
                  onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}
                >
                  <option value="">Select client</option>
                  {(clientsData || []).map((c: any) => (
                    <option key={c.id} value={c.id}>{c.member_id} — {c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Task Type *</label>
                <select
                  required
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  value={form.task_type}
                  onChange={e => setForm(f => ({ ...f, task_type: e.target.value }))}
                >
                  <option value="collection">Collection</option>
                  <option value="follow_up">Follow-up</option>
                  <option value="kyc">KYC / Document</option>
                  <option value="meeting">Center Meeting</option>
                  <option value="complaint">Complaint</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Priority</label>
                <select
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  value={form.priority}
                  onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Date *</label>
                <input
                  type="date"
                  required
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  value={form.task_date}
                  onChange={e => setForm(f => ({ ...f, task_date: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Amount (NPR, optional)</label>
                <input
                  type="number"
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  placeholder="e.g. 5000"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700">Reason (optional)</label>
              <textarea
                rows={3}
                className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                placeholder="Brief note about why this task was created"
                value={form.reason}
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              />
            </div>

            <Button type="submit" disabled={mutating} className="min-w-[160px]">
              {mutating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              {mutating ? 'Assigning...' : 'Assign Task'}
            </Button>
          </form>

          {errorMsg && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
              {errorMsg}
            </div>
          )}

          {result && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md text-sm text-green-800">
              <div className="font-semibold mb-1">✓ Task Assigned Successfully</div>
              <pre className="mt-2 overflow-auto text-xs bg-white p-2 rounded border border-green-100">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Announcements View ─────────────────────────────────────────────

function AnnouncementsView({ enabled }: { enabled: boolean }) {
  const { data: staffData } = useManagerAPI<any[]>('manager/staff');
  const staffList: any[] = Array.isArray(staffData) ? staffData : [];
  const [mutating, setMutating] = useState(false);
  const [form, setForm] = useState({
    title: '',
    message: '',
    priority: 'normal' as 'normal' | 'urgent',
    target_type: 'all' as 'all' | 'officer',
    target_officer_id: '',
  });
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMutating(true);
    setErrorMsg('');
    setResult(null);
    try {
      const res = await apiMutation('manager/announcements', 'POST', {
        title: form.title,
        message: form.message,
        priority: form.priority,
        target_type: form.target_type,
        target_officer_id: form.target_type === 'officer' && form.target_officer_id ? Number(form.target_officer_id) : undefined,
      });
      if (res.success) setResult((res.data as Record<string, unknown>) ?? null);
      else setErrorMsg((res.error as string) || 'Failed to send announcement');
      if (res.success) {
        setForm(f => ({ ...f, title: '', message: '' }));
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to send announcement');
    } finally {
      setMutating(false);
    }
  };

  const fieldOfficers = (staffList || []).filter((s: any) => s.role === 'field_officer');

  return (
    <div className="space-y-6" style={{ opacity: enabled ? 1 : 0, pointerEvents: enabled ? 'auto' : 'none' }}>
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Send Announcement</h1>
        <p className="text-sm text-gray-500 mt-1">Send urgent information to field officers</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
            <div>
              <label className="text-sm font-medium text-gray-700">Title *</label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Office closed tomorrow" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Message *</label>
              <textarea rows={3} className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm" placeholder="Announcement details..." value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Priority</label>
                <select className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value as 'normal' | 'urgent' }))}>
                  <option value="normal">Normal</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Target</label>
                <select className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm" value={form.target_type} onChange={e => setForm(f => ({ ...f, target_type: e.target.value as 'all' | 'officer' }))}>
                  <option value="all">All Officers</option>
                  <option value="officer">Specific Officer</option>
                </select>
              </div>
            </div>
            {form.target_type === 'officer' && (
              <div>
                <label className="text-sm font-medium text-gray-700">Officer</label>
                <select className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm" value={form.target_officer_id} onChange={e => setForm(f => ({ ...f, target_officer_id: e.target.value }))}>
                  <option value="">Select officer</option>
                  {fieldOfficers.map((s: any) => (
                    <option key={s.staff_id} value={s.staff_id}>{s.staff_id} — {s.name}</option>
                  ))}
                </select>
              </div>
            )}
            <Button type="submit" disabled={mutating || !form.title || !form.message} className="min-w-[160px]">
              {mutating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              {mutating ? 'Sending...' : 'Send Announcement'}
            </Button>
          </form>
          {errorMsg && <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">{errorMsg}</div>}
          {result && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md text-sm text-green-800">
              <div className="font-semibold mb-1">✓ Announcement Sent</div>
              <pre className="mt-2 overflow-auto text-xs bg-white p-2 rounded border border-green-100">{JSON.stringify(result, null, 2)}</pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [user, setUser] = useState<StoredUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [activeView, setActiveView] = useState<ViewId>('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Check for existing session on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const token = localStorage.getItem('fieldos_token');
        const userJson = localStorage.getItem('fieldos_user');
        if (token && userJson) {
          const storedUser = JSON.parse(userJson) as StoredUser;
          if (storedUser?.name) {
            setUser(storedUser);
          }
        }
      } catch {
        // Invalid stored data — clear it
        localStorage.removeItem('fieldos_token');
        localStorage.removeItem('fieldos_user');
      }
      setAuthChecked(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // Listen for storage events (session expiry from another tab or hook 401)
  useEffect(() => {
    function onStorage() {
      const token = localStorage.getItem('fieldos_token');
      if (!token && user) {
        setUser(null);
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [user]);

  const handleLogin = useCallback((u: StoredUser, token: string) => {
    localStorage.setItem('fieldos_token', token);
    localStorage.setItem('fieldos_user', JSON.stringify(u));
    setUser(u);
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('fieldos_token');
    localStorage.removeItem('fieldos_user');
    setUser(null);
  }, []);

  // Fetch staff data for overview + visits (always when authenticated)
  const {
    data: staffData,
    lastUpdated: staffLastUpdated,
    refetch: refetchStaff,
  } = useManagerAPI<any[]>('staff', !!user);

  // Fetch dashboard data for last-updated timestamp
  const {
    data: dashData,
    loading: dashLoading,
    error: dashError,
    lastUpdated: dashLastUpdated,
    refetch: refetchDashboard,
  } = useManagerAPI<Record<string, unknown>>('dashboard', !!user);

  // Auto-refresh dashboard + staff every 30s
  useAutoRefresh(30000, refetchDashboard);
  useAutoRefresh(30000, refetchStaff);

  // Show loading spinner while checking auth
  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  // Show login if not authenticated
  if (!user) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  // Use the most recent lastUpdated from either endpoint
  const lastUpdated = dashLastUpdated || staffLastUpdated;

  function renderView() {
    switch (activeView) {
      case 'overview':
        return (
          <OverviewView
            dashData={dashData}
            staffData={staffData || []}
            loading={dashLoading}
            error={dashError}
            onRetry={refetchDashboard}
          />
        );
      case 'staff':
        return <StaffView enabled={activeView === 'staff'} />;
      case 'visits':
        return (
          <VisitView
            enabled={activeView === 'visits'}
            staffData={staffData || []}
          />
        );
      case 'collections':
        return <CollectionView enabled={activeView === 'collections'} />;
      case 'par':
        return <ParView enabled={activeView === 'par'} />;
      case 'ptp':
        return <PtpView enabled={activeView === 'ptp'} />;
      case 'exceptions':
        return <ExceptionsView enabled={activeView === 'exceptions'} />;
      case 'eod':
        return <EodView enabled={activeView === 'eod'} />;
      case 'sync':
        return <SyncView enabled={activeView === 'sync'} />;
      case 'audit':
        return <AuditView enabled={activeView === 'audit'} />;
      case 'assign-task':
        return <AssignTaskView enabled={activeView === 'assign-task'} />;
      case 'announcements':
        return <AnnouncementsView enabled={activeView === 'announcements'} />;
      case 'cbs-clients':
        return <CbsClientsView enabled={activeView === 'cbs-clients'} />;
      case 'cbs-par':
        return <CbsParView enabled={activeView === 'cbs-par'} />;
      case 'reconciliation':
        return <ReconciliationView enabled={activeView === 'reconciliation'} />;
      case 'cbs-postings':
        return <CbsPostingsView enabled={activeView === 'cbs-postings'} />;
      case 'ai-priority':
        return <PriorityQueueView enabled={activeView === 'ai-priority'} />;
      case 'ai-suggestions':
        return <AISuggestionsView enabled={activeView === 'ai-suggestions'} />;
      case 'ai-eod':
        return <AIEODSummaryView enabled={activeView === 'ai-eod'} />;
      case 'ai-branch':
        return <AIBranchSummaryView enabled={activeView === 'ai-branch'} />;
      case 'security-overview':
        return <SecurityOverviewView enabled={activeView === 'security-overview'} />;
      case 'threat-model':
        return <ThreatModelView enabled={activeView === 'threat-model'} />;
      case 'data-flow':
        return <DataFlowView enabled={activeView === 'data-flow'} />;
      case 'rbac-matrix':
        return <RBACMatrixView enabled={activeView === 'rbac-matrix'} />;
      case 'security-audit':
        return <SecurityAuditExportView enabled={activeView === 'security-audit'} />;
      case 'device-mgmt':
        return <DeviceManagementView enabled={activeView === 'device-mgmt'} />;
      case 'incident-response':
        return <IncidentResponseView enabled={activeView === 'incident-response'} />;
      case 'policies':
        return <PoliciesView enabled={activeView === 'policies'} />;
      case 'pen-test':
        return <PenTestChecklistView enabled={activeView === 'pen-test'} />;
      case 'dependency-scan':
        return <DependencyScanView enabled={activeView === 'dependency-scan'} />;
      case 'api-security':
        return <APISecurityTestsView enabled={activeView === 'api-security'} />;
      case 'compliance-status':
        return <ComplianceStatusView enabled={activeView === 'compliance-status'} />;
      case 'pilot-overview':
        return <PilotOverviewView enabled={activeView === 'pilot-overview'} />;
      case 'pilot-branches':
        return <PilotBranchesView enabled={activeView === 'pilot-branches'} />;
      case 'pilot-documents':
        return <PilotDocumentsView enabled={activeView === 'pilot-documents'} />;
      case 'pilot-training':
        return <PilotTrainingView enabled={activeView === 'pilot-training'} />;
      case 'pilot-metrics':
        return <PilotMetricsView enabled={activeView === 'pilot-metrics'} />;
      case 'pilot-feedback':
        return <PilotFeedbackView enabled={activeView === 'pilot-feedback'} />;
      case 'pilot-escalations':
        return <PilotEscalationsView enabled={activeView === 'pilot-escalations'} />;
      case 'pilot-agreements':
        return <PilotAgreementsView enabled={activeView === 'pilot-agreements'} />;
      default:
        return (
          <OverviewView
            dashData={dashData}
            staffData={staffData || []}
            loading={dashLoading}
            error={dashError}
            onRetry={refetchDashboard}
          />
        );
    }
  }

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-[#0B1B3A] flex flex-col transition-transform duration-300 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Brand */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-white/10">
          <div className="h-10 w-10 rounded-xl bg-amber-500 flex items-center justify-center shrink-0">
            <Building2 className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-white truncate">FieldOS Nepal</h1>
            <p className="text-[11px] text-gray-400 truncate">
              {user.branch_name || 'Branch Manager'}
            </p>
          </div>
          <button
            className="lg:hidden ml-auto text-gray-400 hover:text-white"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav Items */}
        <ScrollArea className="flex-1 px-3 py-4">
          <nav className="space-y-1">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest px-3 mb-2">Operations</p>
            {NAV_ITEMS.map((item) => {
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveView(item.id);
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-white/10 text-amber-400 font-medium'
                      : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                  }`}
                >
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                  {isActive && <ChevronRight className="h-4 w-4 ml-auto text-amber-400/50" />}
                </button>
              );
            })}
            <div className="my-3 border-t border-white/10" />
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest px-3 mb-2 flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-amber-400" /> AI Intelligence v1
            </p>
            {AI_NAV_ITEMS.map((item) => {
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveView(item.id);
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-white/10 text-amber-400 font-medium'
                      : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                  }`}
                >
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                  {isActive && <ChevronRight className="h-4 w-4 ml-auto text-amber-400/50" />}
                </button>
              );
            })}
            <div className="my-3 border-t border-white/10" />
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest px-3 mb-2 flex items-center gap-1.5">
              <Shield className="h-3 w-3 text-green-400" /> Security & Compliance
            </p>
            {SECURITY_NAV_ITEMS.map((item) => {
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveView(item.id);
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-white/10 text-green-400 font-medium'
                      : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                  }`}
                >
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                  {isActive && <ChevronRight className="h-4 w-4 ml-auto text-green-400/50" />}
                </button>
              );
            })}
            <div className="my-3 border-t border-white/10" />
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest px-3 mb-2">CBS Integration</p>
            {CBS_NAV_ITEMS.map((item) => {
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveView(item.id);
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-white/10 text-amber-400 font-medium'
                      : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                  }`}
                >
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                  {isActive && <ChevronRight className="h-4 w-4 ml-1 text-amber-400/50" />}
                </button>
              );
            })}
            <div className="my-3 border-t border-white/10" />
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest px-3 mb-2 flex items-center gap-1.5">
              <Rocket className="h-3 w-3 text-cyan-400" /> Pilot (Demo Data)
            </p>
            {PILOT_NAV_ITEMS.map((item) => {
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveView(item.id);
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-white/10 text-cyan-400 font-medium'
                      : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                  }`}
                >
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                  {isActive && <ChevronRight className="h-4 w-4 ml-auto text-cyan-400/50" />}
                </button>
              );
            })}
          </nav>
        </ScrollArea>

        {/* User / Logout */}
        <div className="px-4 py-4 border-t border-white/10">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-amber-500/20 flex items-center justify-center text-xs font-bold text-amber-400 shrink-0">
              {getInitials(user.name)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user.name}</p>
              <p className="text-[11px] text-gray-400">{user.staff_id}</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-white/5 transition-colors"
              title="Logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 bg-white border-b border-gray-200 px-4 lg:px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                className="lg:hidden p-2 rounded-lg hover:bg-gray-100 text-gray-600"
                onClick={() => setSidebarOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </button>
              <div>
                <h1 className="text-lg font-bold text-gray-800">
                  {ALL_NAV_ITEMS.find((n) => n.id === activeView)?.label || 'Dashboard'}
                </h1>
                <p className="text-xs text-gray-400 hidden sm:block">{getTodayStr()}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Search (non-functional) */}
              <div className="hidden md:flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-1.5">
                <Search className="h-4 w-4 text-gray-400" />
                <span className="text-xs text-gray-400">Search...</span>
              </div>

              {/* Notification bell (non-functional) */}
              <Button variant="ghost" size="sm" className="relative text-gray-500">
                <Bell className="h-4 w-4" />
              </Button>

              {/* Last Updated */}
              {lastUpdated && (
                <span className="text-xs text-gray-400 hidden sm:inline">
                  Updated {formatTimeSeconds(lastUpdated)}
                </span>
              )}
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="p-4 lg:p-6">{renderView()}</div>
      </main>
    </div>
  );
}
