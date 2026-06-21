/**
 * FieldOS Nepal Design System
 *
 * Core color tokens, typography, spacing, and radii.
 * These are the single source of truth for the entire app.
 *
 * Color meaning:
 *  Navy  = primary trust color
 *  White / light neutral = app background
 *  Orange = pending, warning, FieldOS accent
 *  Green  = success, secure, verified, synced, confirmed
 *  Red    = overdue, failed, high-risk only
 *  Gray   = muted text, borders, disabled states
 */

export const colors = {
  // Primary
  navy: '#0B1B3A',
  navy2: '#102A56',
  navyLight: '#1A3A6A',

  // Semantic
  orange: '#F59E0B',
  green: '#16A34A',
  red: '#DC2626',

  // Backgrounds
  bg: '#F7F8FA',
  card: '#FFFFFF',
  blueSoft: '#EAF1FF',
  greenSoft: '#EAF8F0',
  orangeSoft: '#FFF4E0',
  redSoft: '#FEECEC',

  // Text
  text: '#111827',
  muted: '#6B7280',

  // Borders
  border: '#E1E5EA',

  // Neutral scale
  white: '#FFFFFF',
  gray50: '#F9FAFB',
  gray100: '#F3F4F6',
  gray200: '#E5E7EB',
  gray300: '#D1D5DB',
  gray400: '#9CA3AF',
  gray500: '#6B7280',
  gray600: '#4B5563',
  gray700: '#374151',
  gray800: '#1F2937',
  gray900: '#111827',

  // Extended semantic backgrounds
  navyBg: '#EAF1FF',
  greenLight: '#EAF8F0',
  greenBorder: '#86EFAC',
  orangeLight: '#FFF4E0',
  orangeBorder: '#FCD34D',
  redLight: '#FEECEC',
  redBorder: '#FCA5A5',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const fontSize = {
  xs: 11,
  sm: 12,
  base: 13,
  md: 14,
  lg: 16,
  xl: 18,
  '2xl': 20,
  '3xl': 22,
  '4xl': 26,
} as const;

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 9999,
} as const;

export type AppColors = typeof colors;
export type AppSpacing = typeof spacing;
export type AppFontSize = typeof fontSize;
export type AppBorderRadius = typeof borderRadius;
