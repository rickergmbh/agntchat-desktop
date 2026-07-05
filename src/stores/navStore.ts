import { create } from "zustand";
import { trackScreen } from "../lib/analytics";

export type View =
  | "chat"
  | "tasks"
  | "agents"
  | "friends"
  | "files"
  | "templates"
  | "canvas"
  | "fleet"
  | "platform";

interface NavState {
  view: View;
  setView: (view: View) => void;
}

export const useNavStore = create<NavState>((set) => ({
  view: "chat",
  setView: (view) => {
    trackScreen(view);
    set({ view });
  },
}));
