/**
 * What the Actions detail column is showing besides a task. To-dos,
 * reminders and routines open in that column (same slot a selected task
 * uses) instead of in a modal or on the agent's own page, so the right
 * half of the view is never dead space.
 *
 * `id: null` means "create a new one". Tasks aren't represented here —
 * their selection lives in `taskStore.selectedTaskId`, since chat cards
 * deep-link into it from outside this view.
 */
export type ActionSelection =
  | { kind: "todo"; id: string | null; draftTitle?: string }
  | { kind: "reminder"; id: string | null }
  /** Routines are created on their agent's page, so this is always an
   *  existing one — no `null` create case. */
  | { kind: "routine"; id: string }
  | null;
