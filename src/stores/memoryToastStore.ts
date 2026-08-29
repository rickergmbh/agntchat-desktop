import { create } from "zustand";

/** Payload pushed on the user channel when an agent saves a memory (camelCase). */
export interface MemorySavedEvent {
  scope: "agent" | "family";
  memoryId: string;
  category: string;
  key: string;
  content: string;
  organizationId?: string | null;
  conversationId?: string | null;
  agentId: string;
  agentName?: string;
  agentAvatarUrl?: string | null;
}

/**
 * Queue of agent memory saves awaiting their moment as the memory island.
 * Saves can arrive in bursts (background extraction writes several at once),
 * so events queue and MemorySavedToast shows them one at a time.
 */
interface MemoryToastState {
  queue: MemorySavedEvent[];
  push: (event: MemorySavedEvent) => void;
  /** Drop the currently shown (head) event; the next one, if any, shows. */
  dismiss: () => void;
  /** Drop everything — used by "Review", which lands on the full list anyway. */
  clear: () => void;
}

export const useMemoryToastStore = create<MemoryToastState>((set) => ({
  queue: [],
  push: (event) =>
    set((s) => ({
      // Re-saves of the same memory (upserts) replace the queued entry
      // instead of stacking duplicates.
      queue: [...s.queue.filter((e) => e.memoryId !== event.memoryId), event],
    })),
  dismiss: () => set((s) => ({ queue: s.queue.slice(1) })),
  clear: () => set({ queue: [] }),
}));
