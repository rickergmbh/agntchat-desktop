import { create } from "zustand";
import { trackScreen } from "../lib/analytics";

export type View =
  | "chat"
  | "tasks"
  | "agents"
  | "friends"
  | "files"
  | "hosts"
  | "templates"
  | "previews"
  | "canvas"
  | "fleet"
  | "platform";

interface NavState {
  view: View;
  setView: (view: View) => void;
  /** Set when a routine list card is clicked from the unified Actions
   *  list — consumed by Dashboard to select the owning agent and open
   *  AgentConfig straight into that routine's edit dialog. */
  routineDeepLink: { agentId: string; routineId: string } | null;
  openRoutineDeepLink: (agentId: string, routineId: string) => void;
  clearRoutineDeepLink: () => void;
  /** Set when the memory island's "Review" is clicked — consumed by
   *  Dashboard to select the owning agent and open AgentConfig straight
   *  into its Memory section on the saved memory's scope tab. */
  memoryDeepLink: { agentId: string; tab: "agent" | "family" } | null;
  openMemoryDeepLink: (agentId: string, tab: "agent" | "family") => void;
  clearMemoryDeepLink: () => void;
}

export const useNavStore = create<NavState>((set) => ({
  view: "chat",
  setView: (view) => {
    trackScreen(view);
    set({ view });
  },
  routineDeepLink: null,
  openRoutineDeepLink: (agentId, routineId) => set({ routineDeepLink: { agentId, routineId } }),
  clearRoutineDeepLink: () => set({ routineDeepLink: null }),
  memoryDeepLink: null,
  openMemoryDeepLink: (agentId, tab) => set({ memoryDeepLink: { agentId, tab } }),
  clearMemoryDeepLink: () => set({ memoryDeepLink: null }),
}));
