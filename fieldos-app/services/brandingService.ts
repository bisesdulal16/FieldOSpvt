/**
 * FieldOS Nepal — Branding Service
 *
 * Fetches white-label branding (org name/tagline/colors) from the public backend
 * endpoint so the login screen can show the institution's identity. Falls back to
 * FieldOS defaults when offline or unreachable.
 */

export interface Branding {
  orgName: string;
  orgNameNe: string;
  tagline: string;
  primaryColor: string;
  accentColor: string;
  logoUrl: string;
}

export const DEFAULT_BRANDING: Branding = {
  orgName: 'FieldOS',
  orgNameNe: 'फिल्डओएस',
  tagline: 'Nepal',
  primaryColor: '#0B1B3A',
  accentColor: '#F59E0B',
  logoUrl: '',
};

export async function fetchBranding(): Promise<Branding> {
  try {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
    const res = await fetch(`${apiUrl}/branding/`);
    const json = await res.json();
    const d = json?.data;
    if (!d) return DEFAULT_BRANDING;
    return {
      orgName: d.org_name || DEFAULT_BRANDING.orgName,
      orgNameNe: d.org_name_ne || DEFAULT_BRANDING.orgNameNe,
      tagline: d.tagline ?? DEFAULT_BRANDING.tagline,
      primaryColor: d.primary_color || DEFAULT_BRANDING.primaryColor,
      accentColor: d.accent_color || DEFAULT_BRANDING.accentColor,
      logoUrl: d.logo_url || '',
    };
  } catch {
    return DEFAULT_BRANDING;
  }
}
