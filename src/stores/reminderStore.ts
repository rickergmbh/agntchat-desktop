import { create } from "zustand";
import * as api from "../lib/api";
import type { AgentReminder } from "../lib/api";

/** i18n key (tasks:reminder.*) for the most recent failed operation; the
 *  reminder UI renders it as a transient inline error. */
export type ReminderErrorKey = "loadFailed" | "addFailed" | "updateFailed" | "deleteFailed" | null;

interface ReminderState {
  reminders: AgentReminder[];
  loading: boolean;
  errorKey: ReminderErrorKey;

  fetchReminders: (agentId?: string) => Promise<void>;
  addReminder: (eventLabel: string, eventDate: string) => Promise<boolean>;
  /** Only "exact" reminders are editable server-side — a date-derived
   *  (7_day/1_day/day_of) reminder returns false; the caller should show
   *  a "cancel and re-create" hint instead of retrying. */
  updateReminder: (id: string, eventLabel: string, eventDate: string) => Promise<boolean>;
  deleteReminder: (id: string) => Promise<void>;
  /** Cancels every reminder sharing a memoryId in one call — "delete the
   *  whole event" for a memory-derived 7_day/1_day/day_of trio. */
  deleteReminderGroup: (memoryId: string) => Promise<boolean>;
  /** Same, for the standalone (non-memory) date-fan-out trio, keyed by the
   *  `event_group_id` stamped in metadata instead of a memoryId. */
  deleteReminderGroupByEventGroupId: (eventGroupId: string) => Promise<boolean>;
  /** Fallback for reminders grouped only by a client-side heuristic
   *  (created before event_group_id existed, so there's no shared id to
   *  send the server) — deletes each member individually. */
  deleteReminders: (ids: string[]) => Promise<boolean>;
}

function sortReminders(reminders: AgentReminder[]): AgentReminder[] {
  return [...reminders].sort(
    (a, b) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime()
  );
}

export const useReminderStore = create<ReminderState>((set, get) => ({
  reminders: [],
  loading: false,
  errorKey: null,

  fetchReminders: async (agentId) => {
    set({ loading: true });
    try {
      const data = await api.fetchRemindersRest(agentId);
      const fetched = data.reminders ?? [];
      set((s) => ({
        // An agent-scoped fetch must not wipe out reminders belonging to
        // every other agent (or the human's own self-reminders) that an
        // unscoped fetch previously loaded into this same store — merge
        // in just this agent's slice instead of replacing wholesale.
        reminders: agentId
          ? sortReminders([
              ...fetched,
              ...s.reminders.filter((r) => r.agentId !== agentId),
            ])
          : sortReminders(fetched),
        errorKey: null,
      }));
    } catch {
      set({ errorKey: "loadFailed" });
    } finally {
      set({ loading: false });
    }
  },

  addReminder: async (eventLabel, eventDate) => {
    try {
      const data = await api.createReminderRest(eventLabel, eventDate);
      const created = data.reminders ?? [];
      set((s) => ({
        reminders: sortReminders([
          ...created,
          ...s.reminders.filter((r) => !created.some((c) => c.id === r.id)),
        ]),
        errorKey: null,
      }));
      return true;
    } catch {
      set({ errorKey: "addFailed" });
      return false;
    }
  },

  updateReminder: async (id, eventLabel, eventDate) => {
    const snapshot = get().reminders;
    try {
      const data = await api.updateReminderRest(id, eventLabel, eventDate);
      set((s) => ({
        reminders: sortReminders(s.reminders.map((r) => (r.id === id ? data.reminder : r))),
        errorKey: null,
      }));
      return true;
    } catch {
      set({ reminders: snapshot, errorKey: "updateFailed" });
      return false;
    }
  },

  deleteReminder: async (id) => {
    const snapshot = get().reminders;
    set((s) => ({ reminders: s.reminders.filter((r) => r.id !== id) }));
    try {
      await api.deleteReminderRest(id);
      set({ errorKey: null });
    } catch {
      set({ reminders: snapshot, errorKey: "deleteFailed" });
    }
  },

  deleteReminderGroup: async (memoryId) => {
    const snapshot = get().reminders;
    set((s) => ({ reminders: s.reminders.filter((r) => r.memoryId !== memoryId) }));
    try {
      await api.deleteReminderGroupByMemoryRest(memoryId);
      set({ errorKey: null });
      return true;
    } catch {
      set({ reminders: snapshot, errorKey: "deleteFailed" });
      return false;
    }
  },

  deleteReminderGroupByEventGroupId: async (eventGroupId) => {
    const snapshot = get().reminders;
    set((s) => ({
      reminders: s.reminders.filter((r) => r.metadata?.event_group_id !== eventGroupId),
    }));
    try {
      await api.deleteReminderGroupByEventGroupRest(eventGroupId);
      set({ errorKey: null });
      return true;
    } catch {
      set({ reminders: snapshot, errorKey: "deleteFailed" });
      return false;
    }
  },

  deleteReminders: async (ids) => {
    const snapshot = get().reminders;
    set((s) => ({ reminders: s.reminders.filter((r) => !ids.includes(r.id)) }));
    try {
      await Promise.all(ids.map((id) => api.deleteReminderRest(id)));
      set({ errorKey: null });
      return true;
    } catch {
      set({ reminders: snapshot, errorKey: "deleteFailed" });
      return false;
    }
  },
}));
