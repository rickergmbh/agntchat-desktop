import { create } from "zustand";
import * as api from "../lib/api";

/**
 * The signed-in user's device nicknames — friendly labels for the machines
 * their agents run on ("macbook" instead of "DE-34002938"), set in Profile.
 * Loaded lazily by the first component that needs one and kept in sync by
 * the Profile save, so a rename shows up in every session line at once.
 */
interface DeviceNicknameState {
  /** raw machine name → nickname */
  nicknames: Record<string, string>;
  loaded: boolean;
  loading: boolean;
  load: () => Promise<void>;
  setNickname: (deviceName: string, nickname: string | null) => void;
  /** Display label for a raw machine name: the nickname when set, else the name. */
  label: (deviceName: string | null | undefined) => string | null;
}

export const useDeviceNicknameStore = create<DeviceNicknameState>((set, get) => ({
  nicknames: {},
  loaded: false,
  loading: false,
  load: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true });
    try {
      const devices = await api.listDeviceNicknames();
      const nicknames: Record<string, string> = {};
      for (const d of devices) if (d.nickname) nicknames[d.deviceName] = d.nickname;
      set({ nicknames, loaded: true });
    } catch {
      // Best effort — lines fall back to the raw machine name.
      set({ loaded: true });
    } finally {
      set({ loading: false });
    }
  },
  setNickname: (deviceName, nickname) =>
    set((s) => {
      const next = { ...s.nicknames };
      if (nickname) next[deviceName] = nickname;
      else delete next[deviceName];
      return { nicknames: next };
    }),
  label: (deviceName) => {
    if (!deviceName) return null;
    return get().nicknames[deviceName] ?? deviceName;
  },
}));
