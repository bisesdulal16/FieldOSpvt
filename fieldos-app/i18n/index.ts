/**
 * FieldOS Nepal — i18n System
 *
 * Lightweight, zero-dependency internationalization.
 * Uses Zustand store's `language` state to determine locale.
 *
 * Usage in any screen/component:
 *   import { useTranslation } from '../i18n';
 *
 *   function MyScreen() {
 *     const { t } = useTranslation();
 *     return <Text>{t('loginBtn')}</Text>;
 *   }
 */

import { useMemo } from 'react';
import en, { type TranslationKey } from './en';
import ne from './ne';
import { useFieldOSStore } from '../store/useFieldOSStore';
import type { Language } from '../types';

const translations: Record<Language, Record<TranslationKey, string>> = {
  en,
  ne,
};

/**
 * Simple template interpolation for ${n} patterns.
 * e.g. t('syncRecordsPending', { n: 5 }) → "5 records pending sync"
 */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\$\{(\w+)\}/g, (_, key) => {
    const val = params[key];
    return val !== undefined ? String(val) : `\${${key}}`;
  });
}

/**
 * Hook to get the `t()` translation function.
 * Automatically reactive to language changes in the Zustand store.
 */
export function useTranslation() {
  const language = useFieldOSStore(s => s.language);

  const t = useMemo(
    () =>
      (key: TranslationKey, params?: Record<string, string | number>): string => {
        const str = translations[language]?.[key] ?? translations.en[key] ?? key;
        return interpolate(str, params);
      },
    [language]
  );

  /** Get the current language code ('en' | 'ne') */
  const locale = language;

  /** Check if the current language is Nepali */
  const isNe = language === 'ne';

  return { t, locale, isNe };
}

/**
 * Non-hook version: get a translation for a specific language.
 * Useful in services, stores, or non-React contexts.
 */
export function getTranslation(lang: Language) {
  return (key: TranslationKey, params?: Record<string, string | number>): string => {
    const str = translations[lang]?.[key] ?? translations.en[key] ?? key;
    return interpolate(str, params);
  };
}

// Re-export types
export type { TranslationKey };
export { en, ne };
