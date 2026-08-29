import { create } from "zustand";

/** Payload pushed on the user channel when an agent saves a memory (camelCase). */
export interface MemorySavedEvent {
  scope: "agent" | "family";
  /** How the save came about — set by the backend's SavedNotifier.
   *  "live" is an agent remembering something mid-turn and is worth an
   *  island; "extraction" is the background worker deriving several at once
   *  and only ever files into the unseen feed (see memoryFeedStore). */
  source: "live" | "extraction";
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
 *
 * Only live saves reach this queue — background extraction (the burst-y
 * writer) is filed straight into memoryFeedStore and never queued, because
 * one island per extracted memory held the top of the app for the better
 * part of a minute and none of it was readable.
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
