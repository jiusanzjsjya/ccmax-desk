"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { en } from "./en";

export type Locale = "zh" | "en";

const STORAGE_KEY = "ccmax-locale";

/** Values for `{token}` interpolation, e.g. t("已选 {n} 个", { n: 3 }). */
export type TVars = Record<string, string | number>;

export type I18nValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  /**
   * Translate a Chinese source string. Chinese is the source of truth: in `zh`
   * the key is returned verbatim, in `en` we look it up (falling back to the
   * Chinese so a missing entry degrades safely). `{token}` placeholders are
   * replaced from `vars` in both locales.
   */
  t: (key: string, vars?: TVars) => string;
};

const LocaleContext = createContext<I18nValue | null>(null);

function interpolate(text: string, vars?: TVars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name) => {
    const value = vars[name];
    return value === undefined ? whole : String(value);
  });
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  // Always start at `zh` so the client's first render matches the server (which
  // renders Chinese). The saved choice is applied after hydration, mirroring
  // the theme toggle — this avoids a hydration mismatch.
  const [locale, setLocaleState] = useState<Locale>("zh");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === "en" || saved === "zh") setLocaleState(saved);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "en" ? "en" : "zh-CN";
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode / storage disabled — the choice still applies for this view.
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: TVars) => {
      const text = locale === "en" ? en[key] ?? key : key;
      return interpolate(text, vars);
    },
    [locale],
  );

  const value = useMemo<I18nValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useI18n must be used within a LocaleProvider");
  return value;
}
