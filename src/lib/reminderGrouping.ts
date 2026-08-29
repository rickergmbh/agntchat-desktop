import type { AgentReminder } from "./api";

// Grouping key, most-to-least reliable:
//   1. memoryId — the memory-derived path (a date detected in a saved
//      memory) has always had this.
//   2. metadata.event_group_id — stamped server-side for a standalone
//      date-only create_reminder call not tied to a memory.
//   3. Heuristic fallback (same agent + same label, non-exact type) for
//      reminders created before event_group_id existed, so they still
//      group instead of showing as 3 stray rows forever.
export function reminderGroupKey(r: AgentReminder): string {
  if (r.memoryId) return `memory:${r.memoryId}`;
  const eventGroupId = r.metadata?.event_group_id;
  if (typeof eventGroupId === "string" && eventGroupId) return `group:${eventGroupId}`;
  if (r.remindType !== "exact") {
    return `heuristic:${r.agentId}:${r.eventLabel.trim().toLowerCase()}`;
  }
  return `single:${r.id}`;
}

/**
 * Groups reminders sharing a source event (the 7_day/1_day/day_of trio a
 * date-only input fans out into) into one row each. Members within a group
 * are sorted soonest-first; groups are sorted by their soonest member.
 */
export function groupReminderRows(reminders: AgentReminder[]): AgentReminder[][] {
  const byKey = new Map<string, AgentReminder[]>();
  for (const r of reminders) {
    const key = reminderGroupKey(r);
    const list = byKey.get(key) ?? [];
    list.push(r);
    byKey.set(key, list);
  }

  return [...byKey.values()]
    .map((group) =>
      [...group].sort((a, b) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime())
    )
    .sort((a, b) => new Date(a[0].remindAt).getTime() - new Date(b[0].remindAt).getTime());
}
