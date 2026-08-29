import { create } from "zustand";
import { listCredentials } from "../lib/api";

/**
 * Which integration providers the user currently has a working credential
 * for. Deliberately thin: it answers one question — "is provider X usable
 * right now?" — for feature gating. The Profile screens still own the full
 * connect/disconnect flow and fetch their own richer payload.
 *
 * First consumer is the composer's mic. Voice notes are transcribed
 * server-side with the uploader's own `openai` credential, so without one
 * the note uploads, plays back for humans, and is completely invisible to
 * every agent in the thread — a silent failure worth blocking up front.
 */

interface IntegrationState {
  /** Providers with an `active` credential. */
  connectedProviders: string[];
  loaded: boolean;
  loading: boolean;
  /** Fetches once per session; pass `force` after a connect/disconnect. */
  refresh: (opts?: { force?: boolean }) => Promise<void>;
}

export const useIntegrationStore = create<IntegrationState>((set, get) => ({
  connectedProviders: [],
  loaded: false,
  loading: false,

  refresh: async ({ force = false } = {}) => {
    const { loaded, loading } = get();
    if (loading || (loaded && !force)) return;
    set({ loading: true });
    try {
      const { credentials } = await listCredentials();
      const connected = (credentials ?? [])
        .filter((c) => c.status === "active")
        .map((c) => c.provider);
      set({ connectedProviders: Array.from(new Set(connected)), loaded: true });
    } catch {
      // Non-blocking. Leaving `loaded` false means the next consumer retries
      // rather than gating a feature off a failed request — see
      // `useProviderConnected`, which stays optimistic until we know better.
    } finally {
      set({ loading: false });
    }
  },
}));

/**
 * `true` when the provider is connected — or when we haven't managed to load
 * the credential list yet. Gating a feature OFF because a status request
 * failed would be worse than letting the attempt through and surfacing the
 * real server-side error, so the unknown state stays permissive.
 */
export function useProviderConnected(provider: string): boolean {
  return useIntegrationStore(
    (s) => !s.loaded || s.connectedProviders.includes(provider)
  );
}
