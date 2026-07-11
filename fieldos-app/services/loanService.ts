/**
 * FieldOS Nepal — Loan Origination Service
 *
 * Field-officer side of loan origination: register a borrower and submit a loan
 * application. Both call the authenticated backend directly (these are branch-office
 * actions that happen with connectivity, not offline field captures).
 */

import { getAccessToken } from './apiClient';
import type { ApiResponse } from '../types/api';

function apiUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
}

async function authedPost<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
  const token = getAccessToken();
  const res = await fetch(`${apiUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : 'Bearer undefined',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { success: false, data: undefined as any, error: text || `HTTP ${res.status}`, timestamp: new Date().toISOString() };
  }
}

export interface RegisterBorrowerRequest {
  name: string;
  nameNe?: string;
  centerId?: string;
  centerName?: string;
  ward?: string;
}

export interface RegisteredBorrower {
  id: number;
  member_id: string;
  name: string;
}

/** Register a new borrower. Backend auto-assigns the next member id. */
export async function registerBorrower(req: RegisterBorrowerRequest): Promise<ApiResponse<RegisteredBorrower>> {
  return authedPost<RegisteredBorrower>('/clients/', {
    name: req.name,
    name_ne: req.nameNe || null,
    center_id: req.centerId || null,
    center_name: req.centerName || null,
    ward: req.ward || null,
  });
}

export interface LoanApplicationRequest {
  clientId: number;
  principalAmount: number;
  termWeeks?: number;
  productType?: string;
  interestRatePct?: number;
}

export interface LoanApplicationResult {
  loan_id: string;
  status: string;
  installment_amount: number;
  principal_amount: number;
}

/** Submit a loan application for an existing borrower → creates a pending loan. */
export async function submitLoanApplication(req: LoanApplicationRequest): Promise<ApiResponse<LoanApplicationResult>> {
  return authedPost<LoanApplicationResult>('/loans/applications', {
    client_id: req.clientId,
    principal_amount: req.principalAmount,
    term_weeks: req.termWeeks ?? 25,
    product_type: req.productType ?? 'micro_loan',
    interest_rate_pct: req.interestRatePct ?? 18,
  });
}
