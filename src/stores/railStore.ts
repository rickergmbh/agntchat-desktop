import { create } from "zustand";

const STORAGE_KEY = "agentchat:rail-expanded";

/**
 * Left-rail expand/collapse. Collapsed is the icon-only rail (`w-14`);
 * expanded (`w-56`) reveals the workspace name and a text label on every
 * nav button.
 *
 * Persisted to localStorage so the choice survives a relaunch — a rail
 * that snapped back to icons on every launch is the whole reason people
 * stop using the toggle. Mirrors `web/src/stores/railStore.ts`.
 */
interface RailState {
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  toggle: () => void;
}

export const RAIL_WIDTH_COLLAPSED = "w-14";
export const RAIL_WIDTH_EXPANDED = "w-56";

function persist(expanded: boolean) {
  localStorage.setItem(STORAGE_KEY, expanded ? "1" : "0");
}

export const useRailStore = create<RailState>((set, get) => ({
  expanded: localStorage.getItem(STORAGE_KEY) === "1",
  setExpanded: (expanded) => {
    persist(expanded);
    set({ expanded });
  },
  toggle: () => get().setExpanded(!get().expanded),
}));

export const useRailExpanded = () => useRailStore((s) => s.expanded);
