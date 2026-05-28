import { create } from "zustand";
import * as api from "../lib/api";
import { resetAvatarPolicyCache } from "../lib/imageProcessor";
import { resetFieldLimitsCache } from "../lib/fieldLimits";
import { resetAgentTypesCache } from "../lib/agentTypes";

// Push the device's IANA tz to the backend if it differs from what's stored.
// Best-effort. Updates the in-memory participant on success so the profile
// view reflects the new tz without a reload.
function syncDeviceTimezone(participant: api.Participant): void {
  if (participant.type !== "human") return;
  let tz: string | undefined;
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch (err) {
    console.warn("[Tz] Intl.DateTimeFormat unavailable:", err);
    return;
  }
  if (!tz || tz === participant.timezone) return;
  api
    .request<{ timezone: string }>("/api/me/timezone", {
      method: "PUT",
      body: JSON.stringify({ timezone: tz }),
    })
    .then((res) => {
      const cur = useAuthStore.getState().participant;
      if (cur && cur.id === participant.id) {
        const next = { ...cur, timezone: res.timezone };
        localStorage.setItem("participant", JSON.stringify(next));
        useAuthStore.setState({ participant: next });
      }
    })
    .catch((err) => {
      console.warn("[Tz] sync failed:", err?.message || err);
    });
}

interface AuthState {
  token: string | null;
  participant: api.Participant | null;
  loading: boolean;
  error: string | null;

  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => void;
  restoreSession: () => void;
  fetchProfile: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  participant: null,
  loading: false,
  error: null,

  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const result = await api.login(email, password);
      localStorage.setItem("authToken", result.token);
      localStorage.setItem("participant", JSON.stringify(result.participant));
      set({
        token: result.token,
        participant: result.participant,
        loading: false,
      });
      syncDeviceTimezone(result.participant);
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : "Login failed",
      });
    }
  },

  signup: async (email, password, displayName) => {
    set({ loading: true, error: null });
    try {
      const result = await api.signup(email, password, displayName);
      localStorage.setItem("authToken", result.token);
      localStorage.setItem("participant", JSON.stringify(result.participant));
      set({
        token: result.token,
        participant: result.participant,
        loading: false,
      });
      syncDeviceTimezone(result.participant);
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : "Signup failed",
      });
    }
  },

  logout: () => {
    // Clear caches keyed on auth (policies that may differ per user/tier).
    // Static imports — these modules are already in the bundle (used on
    // first-render paths), and synchronous reset removes a fire-and-forget
    // failure surface.
    resetAvatarPolicyCache();
    resetFieldLimitsCache();
    resetAgentTypesCache();
    localStorage.removeItem("authToken");
    localStorage.removeItem("participant");
    set({ token: null, participant: null });
  },

  restoreSession: () => {
    const token = localStorage.getItem("authToken");
    const raw = localStorage.getItem("participant");
    if (token && raw) {
      try {
        const participant = JSON.parse(raw);
        set({ token, participant });
        // Fetch fresh profile in background (gets avatarUrl etc.)
        useAuthStore.getState().fetchProfile();
      } catch {
        localStorage.removeItem("authToken");
        localStorage.removeItem("participant");
      }
    }
  },

  fetchProfile: async () => {
    try {
      const participant = await api.getProfile();
      localStorage.setItem("participant", JSON.stringify(participant));
      set({ participant });
      syncDeviceTimezone(participant);
    } catch {
      // Silently fail — stale data is fine as fallback
    }
  },
}));
