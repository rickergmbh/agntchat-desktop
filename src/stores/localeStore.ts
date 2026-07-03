import { create } from "zustand";
import * as api from "../lib/api";
import {
  LOCALE_STORAGE_KEY,
  applyLocalePreference,
  readStoredLocalePreference,
  type LocalePreference,
} from "../i18n";
import { SUPPORTED_LOCALES, type SupportedLocale } from "../i18n/generated";

interface LocaleState {
  preference: LocalePreference;
  setPreference: (pref: LocalePreference) => void;
  /** Adopt the server's stored locale (from /api/me). Null means "follow
   *  device language" — leave the local preference alone in that case, and
   *  never push back to the server from here. */
  hydrateFromServer: (locale: string | null) => void;
}

function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export const useLocaleStore = create<LocaleState>((set, get) => ({
  preference: readStoredLocalePreference(),

  setPreference: (pref) => {
    localStorage.setItem(LOCALE_STORAGE_KEY, pref);
    applyLocalePreference(pref);
    set({ preference: pref });
    // Sync to the backend so other devices pick it up. Best-effort.
    api
      .request("/api/me/locale", {
        method: "PUT",
        body: JSON.stringify({ locale: pref === "system" ? null : pref }),
      })
      .catch((err) => {
        console.warn("[Locale] update failed:", err?.message || err);
      });
  },

  hydrateFromServer: (locale) => {
    if (!locale || !isSupportedLocale(locale)) return;
    if (get().preference === locale) return;
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    applyLocalePreference(locale);
    set({ preference: locale });
  },
}));
