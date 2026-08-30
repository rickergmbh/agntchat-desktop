import { create } from "zustand";
import { listRoutines } from "../lib/api";
import type { Routine } from "../lib/api";
import { isFresh } from "../lib/cache";

/**
 * Every routine visible to the signed-in account, across all of its agents —
 * the unscoped `/api/routines` feed that backs the unified Actions list.
 *
 * A store rather than component state because the Tasks view is unmounted on
 * every sidebar switch: held locally, the list was discarded and re-fetched
 * (behind a spinner) each time you came back. Per-agent routine lists in
 * AgentConfig fetch their own agent-scoped slice and don't go through here.
 */
interface RoutineState {
  routines: Routine[];
  loadedAt: number;
  loading: boolean;

  /** @internal in-flight fetch, so concurrent callers share one request */
  _inflight: Promise<void> | null;

  fetchRoutines: () => Promise<void>;
  fetchRoutinesIfStale: () => Promise<void>;
}

export const useRoutineStore = create<RoutineState>((set, get) => ({
  routines: [],
  loadedAt: 0,
  loading: false,
  _inflight: null,

  fetchRoutines: async () => {
    set({ loading: get().routines.length === 0 });
    try {
      const { routines } = await listRoutines();
      set({ routines: routines ?? [], loadedAt: Date.now() });
    } catch (e) {
      console.warn("[routines] fetch failed", e);
    } finally {
      set({ loading: false });
    }
  },

  fetchRoutinesIfStale: async () => {
    const inflight = get()._inflight;
    if (inflight) return inflight;
    if (isFresh(get().loadedAt)) return;
    const p = get()
      .fetchRoutines()
      .finally(() => set({ _inflight: null }));
    set({ _inflight: p });
    return p;
  },
}));
