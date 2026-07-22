/**
 * FieldOS Nepal — Client Service
 *
 * Fetches client data, details, and loan information.
 * When mock mode is enabled, returns mock data.
 */

import { getConfig } from './apiClient';
import { searchClients } from '../db/repositories/clientsRepo';
import type { ClientSummary, ClientDetail, ApiResponse } from '../types/api';

// ─── Mock Data ───────────────────────────────────────────────────

const MOCK_CLIENTS: ClientSummary[] = [
  { id: 1, clientId: 1, memberId: 'M-1042', name: 'Sunita Kumari Chaudhary', nameNe: 'सुनिता कुमारी चौधरी', centerId: 'CC-204', centerName: 'Janakpur Center', ward: 'Ward 7, Butwal', loanCycle: 3, outstandingBalance: 45000, dueAmount: 5500, nextInstallmentDate: new Date().toISOString().split('T')[0], overdueDays: 8, status: 'active', hasKycCitizenship: true, hasKycPhoto: false },
  { id: 2, clientId: 2, memberId: 'M-1038', name: 'Rita Devi Sharma', nameNe: 'रिता देवी शर्मा', centerId: 'CC-204', centerName: 'Janakpur Center', ward: 'Ward 3, Butwal', loanCycle: 2, outstandingBalance: 30000, dueAmount: 3000, nextInstallmentDate: new Date().toISOString().split('T')[0], overdueDays: 0, status: 'active', hasKycCitizenship: true, hasKycPhoto: true },
  { id: 3, clientId: 3, memberId: 'M-1055', name: 'Sita Devi Sah', nameNe: 'सीता देवी साह', centerId: 'CC-204', centerName: 'Janakpur Center', ward: 'Ward 5, Butwal', loanCycle: 1, outstandingBalance: 15000, dueAmount: 2500, nextInstallmentDate: new Date().toISOString().split('T')[0], overdueDays: 15, status: 'active', hasKycCitizenship: false, hasKycPhoto: false },
  { id: 4, clientId: 4, memberId: 'M-1012', name: 'Ramesh Thapa Magar', nameNe: 'रमेश थापा मगर', centerId: 'CC-205', centerName: 'Kalika Women Center', ward: 'Ward 5, Kalanki', loanCycle: 5, outstandingBalance: 60000, dueAmount: 4500, nextInstallmentDate: new Date().toISOString().split('T')[0], overdueDays: 0, status: 'active', hasKycCitizenship: true, hasKycPhoto: true },
  { id: 5, clientId: 5, memberId: 'M-1067', name: 'Maya Kumari Gurung', nameNe: 'माया कुमारी गुरुङ', centerId: 'CC-205', centerName: 'Kalika Women Center', ward: 'Ward 8, Kalanki', loanCycle: 1, outstandingBalance: 10000, dueAmount: 1500, nextInstallmentDate: new Date().toISOString().split('T')[0], overdueDays: 0, status: 'active', hasKycCitizenship: true, hasKycPhoto: false },
  { id: 6, clientId: 6, memberId: 'M-1023', name: 'Gita Devi Pokharel', nameNe: 'गीता देवी पोखरेल', centerId: 'CC-205', centerName: 'Kalika Women Center', ward: 'Ward 2, Kalanki', loanCycle: 4, outstandingBalance: 35000, dueAmount: 2200, nextInstallmentDate: new Date().toISOString().split('T')[0], overdueDays: 3, status: 'active', hasKycCitizenship: true, hasKycPhoto: true },
];

// ─── Public API ──────────────────────────────────────────────────

/**
 * Fetch all clients (summary list).
 */
export async function fetchClients(): Promise<ApiResponse<ClientSummary[]>> {
  const { enableMock } = getConfig();

  if (enableMock) {
    await mockDelay(400);
    return { success: true, data: MOCK_CLIENTS, timestamp: new Date().toISOString() };
  }

  // Real API call
  const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
  const response = await fetch(`${apiUrl}/clients`, {
    headers: { 'Authorization': `Bearer ${require('./apiClient').getAccessToken()}` },
  });
  return await response.json();
}

/**
 * Fetch client detail by ID.
 */
export async function fetchClientDetail(clientId: number): Promise<ApiResponse<ClientDetail>> {
  const { enableMock } = getConfig();

  if (enableMock) {
    await mockDelay(300);
    const client = MOCK_CLIENTS.find(c => c.clientId === clientId) || MOCK_CLIENTS[0];
    const detail: ClientDetail = {
      id: client.clientId,
      memberId: client.memberId,
      name: client.name,
      nameNe: client.nameNe,
      centerId: client.centerId,
      centerName: client.centerName,
      ward: client.ward,
      loanCycle: client.loanCycle,
      status: client.status,
      loanAccount: {
        loanId: `LN-${client.memberId}`,
        productType: 'Micro Loan',
        disbursementDate: '2024-06-15',
        maturityDate: '2025-06-15',
        principalAmount: client.outstandingBalance + client.dueAmount,
        outstandingBalance: client.outstandingBalance,
        installmentAmount: client.dueAmount,
        installmentFrequency: 'weekly',
        status: 'active',
      },
      kyc: {
        citizenshipFront: client.hasKycCitizenship,
        citizenshipBack: false,
        clientPhoto: client.hasKycPhoto,
        signature: false,
      },
      lastPayment: {
        date: '2025-01-29',
        amount: 2500,
      },
      visitHistory: [
        { date: '2025-01-29', type: 'collection', amount: 2500 },
        { date: '2025-01-22', type: 'visit' },
        { date: '2025-01-15', type: 'collection', amount: 2500 },
      ],
    };
    return { success: true, data: detail, timestamp: new Date().toISOString() };
  }

  // Real API call
  const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
  const response = await fetch(`${apiUrl}/clients/${clientId}`, {
    headers: { 'Authorization': `Bearer ${require('./apiClient').getAccessToken()}` },
  });
  return await response.json();
}

/**
 * Search clients locally (offline fallback).
 */
export async function searchLocalClients(query: string): Promise<ClientSummary[]> {
  const { enableMock } = getConfig();

  if (enableMock) {
    if (!query.trim()) return MOCK_CLIENTS;
    const q = query.toLowerCase();
    return MOCK_CLIENTS.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.memberId.toLowerCase().includes(q)
    );
  }

  // Search local DB — never fall back to mock clients (would show fake borrowers).
  try {
    const dbClients = await searchClients(query);
    return dbClients.map(mapDbClient);
  } catch {
    return [];
  }
}

function mockDelay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function mapDbClient(dbClient: any): ClientSummary {
  return {
    id: dbClient.id,
    clientId: dbClient.id,
    memberId: dbClient.member_id,
    name: dbClient.name,
    nameNe: dbClient.name_ne,
    centerId: dbClient.center_id || '',
    centerName: dbClient.center_name || '',
    ward: dbClient.ward,
    loanCycle: dbClient.loan_cycle || 1,
    outstandingBalance: dbClient.outstanding_balance || 0,
    dueAmount: dbClient.due_amount || 0,
    nextInstallmentDate: dbClient.next_installment_date,
    overdueDays: dbClient.overdue_days || 0,
    status: dbClient.status || 'active',
    hasKycCitizenship: !!dbClient.kyc_citizenship,
    hasKycPhoto: !!dbClient.kyc_photo,
  };
}
