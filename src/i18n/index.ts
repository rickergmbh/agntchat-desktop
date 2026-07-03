import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import {
  DEFAULT_LOCALE,
  NAMESPACES,
  SUPPORTED_LOCALES,
  resources,
  type SupportedLocale,
} from "./generated";

// Persisted locally like themeStore's "agentchat:theme" key — read
// synchronously at module init so the first render is already in the
// right language.
export const LOCALE_STORAGE_KEY = "agentchat:locale";

export type LocalePreference = "system" | SupportedLocale;

function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function resolveLocale(pref: LocalePreference): SupportedLocale {
  if (pref !== "system") return pref;
  const base = (navigator.language || "").split("-")[0].toLowerCase();
  return isSupportedLocale(base) ? base : DEFAULT_LOCALE;
}

/** Read the locally persisted preference; anything unrecognized → "system". */
export function readStoredLocalePreference(): LocalePreference {
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
  if (stored && (stored === "system" || isSupportedLocale(stored))) {
    return stored;
  }
  return "system";
}

i18n.use(initReactI18next).init({
  resources,
  lng: resolveLocale(readStoredLocalePreference()),
  fallbackLng: DEFAULT_LOCALE,
  defaultNS: "common",
  ns: [...NAMESPACES],
  interpolation: { escapeValue: false },
});

export function applyLocalePreference(pref: LocalePreference) {
  i18n.changeLanguage(resolveLocale(pref));
}

export default i18n;
