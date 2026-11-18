import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { en, zh } from "./dictionary";
import type { TranslationKey } from "./dictionary";
import { setFormatLocale } from "../lib/format";

export type Language = "en" | "zh";

const STORAGE_KEY = "vercio:language";

const translations: Record<Language, Record<string, string>> = { en, zh };

function detectLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "zh") return stored;
  } catch {}
  const browser = typeof navigator !== "undefined" ? navigator.language : "en";
  return browser.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.split("{" + key + "}").join(String(value));
  }
  return result;
}

interface I18nContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const initial = detectLanguage();
    setFormatLocale(initial);
    return initial;
  });

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    setFormatLocale(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage(language === "en" ? "zh" : "en");
  }, [language, setLanguage]);

  useEffect(() => {
    setFormatLocale(language);
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    document.title =
      language === "zh"
        ? "Vercio — 本地分支预览与前端协作"
        : "Vercio — Local previews for every branch";
  }, [language]);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => {
      const dictionary = translations[language];
      const template = dictionary[key] ?? en[key] ?? key;
      return interpolate(template, vars);
    },
    [language]
  );

  const value = useMemo(
    () => ({ language, setLanguage, toggleLanguage, t }),
    [language, setLanguage, toggleLanguage, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}

export function useT() {
  return useI18n().t;
}
