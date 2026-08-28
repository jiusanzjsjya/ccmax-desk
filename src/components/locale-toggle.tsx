"use client";

import { type Locale, useI18n } from "@/lib/i18n/context";

const OPTIONS: { locale: Locale; label: string }[] = [
  { locale: "zh", label: "中文" },
  { locale: "en", label: "EN" },
];

/** Language switch, styled like the theme toggle; persists via the i18n context. */
export default function LocaleToggle() {
  const { locale, setLocale } = useI18n();

  return (
    <div className="theme-toggle" role="group" aria-label="Language / 语言">
      {OPTIONS.map((option) => (
        <button
          key={option.locale}
          type="button"
          className={locale === option.locale ? "is-active" : ""}
          aria-pressed={locale === option.locale}
          onClick={() => setLocale(option.locale)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
