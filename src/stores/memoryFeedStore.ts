import { useMemo } from "react";
import { create } from "zustand";

import type { MemorySavedEvent } from "./memoryToastStore";

/**
 * A memory save the user hasn't looked at yet.
 *
 * Only the routing fields are kept — the memory's real record is the row the
 * memory list fetches from the server. This is a "you haven't seen this"
 * marker, not a second copy of the content.
 */
export interface UnseenMemory {
  memoryId: string;
  agentId: string;
  agentName?: string;
  scope: "agent" | "family";
  key: string;
  content: string;
  savedAt: number;
}

const STORAGE_KEY = "memory:unseen";
/** Beyond this the rail dot says the same thing anyway. Oldest fall off. */
const CAP = 100;

function load(): UnseenMemory[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as UnseenMemory[]) : [];
  } catch {
    return [];
  }
}

function persist(unseen: UnseenMemory[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(unseen));
  } catch {
    // Quota or a locked-down store — the feed is a convenience, not a
    // record; losing it across restarts is acceptable.
  }
}

/**
 * The persistent half of the memory-save surface.
 *
 * The live, in-conversation notification is `MemorySavedToast` (the "memory
 * island") — that's the actual "hey, this got remembered" moment, and it's
 * enough on its own for live saves. Background extraction saves deliberately
 * skip the island (a burst of them turned into a strobe of toasts), so they'd
 * otherwise be invisible. This store is just where they wait: every save
 * (island-worthy or not) is recorded here and surfaces only as a "recently
 * remembered" group pinned above the category groups when that agent's memory
 * list is opened — no rail/row-level notification. Cleared per-agent once the
 * list has been read.
 */
interface MemoryFeedState {
  /** Newest first. */
  unseen: UnseenMemory[];
  record: (event: MemorySavedEvent) => void;
  /** Called when the agent's memory list has been shown — drops its marks. */
  markAgentSeen: (agentId: string) => void;
  clearAll: () => void;
}

export const useMemoryFeedStore = create<MemoryFeedState>((set) => ({
  unseen: load(),
  record: (event) =>
    set((s) => {
      // An upsert of a memory that's already unseen moves to the front with
      // its new content rather than stacking a second mark for one row.
      const unseen = [
        {
          memoryId: event.memoryId,
          agentId: event.agentId,
          agentName: event.agentName,
          scope: event.scope,
          key: event.key,
          content: event.content,
          savedAt: Date.now(),
        },
        ...s.unseen.filter((u) => u.memoryId !== event.memoryId),
      ].slice(0, CAP);
      persist(unseen);
      return { unseen };
    }),
  markAgentSeen: (agentId) =>
    set((s) => {
      const unseen = s.unseen.filter((u) => u.agentId !== agentId);
      if (unseen.length === s.unseen.length) return s;
      persist(unseen);
      return { unseen };
    }),
  clearAll: () =>
    set(() => {
      persist([]);
      return { unseen: [] };
    }),
}));

/**
 * This agent's unseen memory ids, on the given scope tab. Memoized off the
 * whole array so the filter doesn't mint a new ref on unrelated updates.
 */
export function useUnseenMemoryIds(
  agentId: string,
  scope: "agent" | "family"
): Set<string> {
  const unseen = useMemoryFeedStore((s) => s.unseen);
  return useMemo(
    () =>
      new Set(
        unseen
          .filter((u) => u.agentId === agentId && u.scope === scope)
          .map((u) => u.memoryId)
      ),
    [unseen, agentId, scope]
  );
}
