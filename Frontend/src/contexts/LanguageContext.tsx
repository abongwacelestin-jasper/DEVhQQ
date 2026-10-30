import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { translations, type Lang } from '../data/translations';

interface LanguageValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** Looks up a key in the active language, then the fallback, then English. `{name}` placeholders are filled from vars. */
  t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string;
}

const KEY = 'devhq.lang';
const LanguageContext = createContext<LanguageValue | null>(null);
const isLang = (v: string | null): v is Lang => v === 'en' || v === 'fr' || v === 'es';

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    const saved = localStorage.getItem(KEY);
    return isLang(saved) ? saved : 'en';
  });

  useEffect(() => {
    document.documentElement.lang = lang;
    localStorage.setItem(KEY, lang);
  }, [lang]);

  const t = useCallback(
    (key: string, fallback?: string, vars?: Record<string, string | number>) => {
      let s = translations[lang][key] ?? fallback ?? translations.en[key] ?? key;
      if (vars) Object.entries(vars).forEach(([k, val]) => (s = s.replace(`{${k}}`, String(val))));
      return s;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside LanguageProvider');
  return ctx;
}
