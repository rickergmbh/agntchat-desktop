import { useAgentStore } from "./agentStore";
import { useDirectoryStore } from "./directoryStore";
import { useFileStore } from "./fileStore";
import { useFriendStore } from "./friendStore";
import { useReminderStore } from "./reminderStore";
import { useRoutineStore } from "./routineStore";
import { useTaskStore } from "./taskStore";
import { useTodoStore } from "./todoStore";

/**
 * Drop every stale-gated view cache (see `lib/cache.ts`).
 *
 * These stores outlive the views that read them, which is the whole point —
 * but they also outlive the session, and signing out doesn't reload the
 * window. Without this, signing in as someone else would show the previous
 * account's files and lists until their TTLs expired. Called from
 * `authStore.logout`; the workspace switch does its own scoped wipe.
 */
export function resetViewCaches() {
  useFileStore.getState().reset();
  useRoutineStore.setState({ routines: [], loadedAt: 0 });
  useTodoStore.setState({ todos: [], loadedAt: 0 });
  useReminderStore.setState({ reminders: [], loadedAt: 0 });
  useTaskStore.setState({ tasks: [], loadedAt: 0 });
  useAgentStore.setState({ agents: {}, loaded: false, loadedAt: 0, healthLoadedAt: 0 });
  useFriendStore.setState({ connections: [], pendingCount: 0, loadedAt: 0 });
  useDirectoryStore.setState({ connections: [], connectionsLoadedAt: 0 });
}
