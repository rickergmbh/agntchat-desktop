import { create } from "zustand";
import * as api from "../lib/api";
import type { Task, TaskStatus } from "../lib/api";
import { ws } from "../services/websocket";
import { useAuthStore } from "./authStore";

/**
 * Tasks store — the tasks tab's state + the live progress / status that
 * drives inline task cards in the chat thread.
 *
 * `tasks` is the authoritative list backing the Tasks tab. `taskProgress`
 * accumulates step history per task so the LiveSteps ticker can render it,
 * and `taskLifecycleMeta.effectiveStatus` lets message renderers show a
 * live status without needing a fresh message to arrive.
 */

export interface TaskProgressInfo {
  currentStep: string;
  recentSteps: string[];
}

export interface TaskLifecycleMeta {
  /** Live status derived from the latest `task_*` event; supersedes the
   * static `taskSnapshot.status` on the message when present. */
  effectiveStatus?: string;
  /** Completion summary (markdown) — pulled from the terminal StatusUpdate
   * message's payload during thread hydration. Consumed by CompletionCard
   * when the user expands a completed-task card. */
  summary?: string;
  error?: string;
  /** Assignee's display name + avatar — seeded from StatusUpdate payloads
   * (`agent_name` or `assignee_name`) so cards can show the right agent
   * even when the message sender is the delegator. */
  agentName?: string;
  agentAvatarUrl?: string;
}

const ACTIVE_STATUSES = new Set<TaskStatus>([
  "pending",
  "accepted",
  "in_progress",
  "blocked",
]);

interface TaskState {
  tasks: Task[];
  loading: boolean;
  selectedTaskId: string | null;
  taskProgress: Record<string, TaskProgressInfo>;
  taskLifecycleMeta: Record<string, TaskLifecycleMeta>;

  fetchTasks: (status?: TaskStatus) => Promise<void>;
  fetchTask: (taskId: string) => Promise<Task | null>;
  selectTask: (id: string | null) => void;
  updateTaskStatus: (taskId: string, status: TaskStatus) => Promise<void>;
  requestRevision: (taskId: string, feedback: string) => Promise<void>;
  /** Merge extra fields (summary, error, agentName, etc.) into a task's
   *  lifecycle meta. Used by the thread hydration pass when walking
   *  StatusUpdate payloads; preserves any existing fields not supplied. */
  updateTaskLifecycleMeta: (
    taskId: string,
    meta: Partial<TaskLifecycleMeta>
  ) => void;

  initWsListeners: () => () => void;
}

function extractTaskId(payload: Record<string, unknown>): string | null {
  return (payload.taskId ?? payload.task_id ?? payload.id ?? payload._taskId) as
    | string
    | null;
}

function mergeProgress(
  existing: TaskProgressInfo | undefined,
  currentStep: string
): TaskProgressInfo {
  if (!currentStep) return existing ?? { currentStep: "", recentSteps: [] };
  if (existing?.currentStep === currentStep) return existing;
  const prev = existing?.recentSteps ?? [];
  const recentSteps =
    currentStep && currentStep !== prev[prev.length - 1]
      ? [...prev, currentStep].slice(-8)
      : prev;
  return { currentStep, recentSteps };
}

function sortByUpdatedDesc(tasks: Task[]): Task[] {
  return [...tasks].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  loading: false,
  selectedTaskId: null,
  taskProgress: {},
  taskLifecycleMeta: {},

  fetchTasks: async (status) => {
    set({ loading: true });
    try {
      const { tasks } = await api.fetchTasksRest(status);
      const incomingIds = new Set(tasks.map((t) => t.id));
      // Merge: keep any task already in the store that isn't in the response
      // (the index endpoint is capped at 50, but the user may have pulled a
      // specific older task in via fetchTask or WS). Refresh the ones the
      // server returned.
      set((s) => {
        const preserved = s.tasks.filter((t) => !incomingIds.has(t.id));
        return { tasks: sortByUpdatedDesc([...tasks, ...preserved]) };
      });
      // Seed lifecycle metadata so cards show the server's truth even when
      // the completion message is outside the recent_messages window.
      set((s) => {
        const meta = { ...s.taskLifecycleMeta };
        for (const t of tasks) {
          meta[t.id] = { ...(meta[t.id] ?? {}), effectiveStatus: t.status };
        }
        return { taskLifecycleMeta: meta };
      });
    } catch (e) {
      console.warn("[tasks] fetchTasks failed", e);
    } finally {
      set({ loading: false });
    }
  },

  fetchTask: async (taskId) => {
    try {
      const task = await api.fetchTaskRest(taskId);
      set((s) => {
        const filtered = s.tasks.filter((t) => t.id !== task.id);
        return {
          tasks: sortByUpdatedDesc([task, ...filtered]),
          taskLifecycleMeta: {
            ...s.taskLifecycleMeta,
            [task.id]: {
              ...(s.taskLifecycleMeta[task.id] ?? {}),
              effectiveStatus: task.status,
            },
          },
        };
      });
      return task;
    } catch (e) {
      console.warn("[tasks] fetchTask failed", taskId, e);
      return null;
    }
  },

  selectTask: (id) => set({ selectedTaskId: id }),

  updateTaskStatus: async (taskId, status) => {
    const updated = await api.updateTaskStatusRest(taskId, status);
    set((s) => ({
      tasks: sortByUpdatedDesc(
        s.tasks.map((t) => (t.id === taskId ? updated : t))
      ),
      taskLifecycleMeta: {
        ...s.taskLifecycleMeta,
        [taskId]: {
          ...(s.taskLifecycleMeta[taskId] ?? {}),
          effectiveStatus: updated.status,
        },
      },
    }));
  },

  updateTaskLifecycleMeta: (taskId, meta) => {
    set((s) => ({
      taskLifecycleMeta: {
        ...s.taskLifecycleMeta,
        [taskId]: { ...(s.taskLifecycleMeta[taskId] ?? {}), ...meta },
      },
    }));
  },

  requestRevision: async (taskId, feedback) => {
    const updated = await api.requestTaskRevisionRest(taskId, feedback);
    set((s) => ({
      tasks: sortByUpdatedDesc(
        s.tasks.map((t) => (t.id === taskId ? updated : t))
      ),
      taskLifecycleMeta: {
        ...s.taskLifecycleMeta,
        [taskId]: {
          ...(s.taskLifecycleMeta[taskId] ?? {}),
          effectiveStatus: updated.status,
        },
      },
    }));
  },

  initWsListeners: () => {
    const unsubs: (() => void)[] = [];

    // Upsert Task objects from the user channel so the Tasks tab stays live.
    const upsertTask = (payload: Record<string, unknown>) => {
      // Some events wrap the task under a key, some don't — handle both.
      const task =
        ((payload as { task?: Task }).task as Task | undefined) ??
        (payload as unknown as Task);
      if (!task?.id) return;

      // Slack-style: drop tasks in a workspace the user isn't
      // currently active in.
      const activeOrg =
        useAuthStore.getState().participant?.activeOrganizationId;
      if (
        task.organizationId &&
        activeOrg &&
        task.organizationId !== activeOrg
      ) {
        return;
      }

      set((s) => {
        const filtered = s.tasks.filter((t) => t.id !== task.id);
        return { tasks: sortByUpdatedDesc([task, ...filtered]) };
      });
    };

    const handleTaskLifecycle = (payload: Record<string, unknown>) => {
      const taskId = extractTaskId(payload);
      if (!taskId) return;
      upsertTask(payload);
      const status = payload.status as string | undefined;
      if (!status) return;
      set((s) => ({
        taskLifecycleMeta: {
          ...s.taskLifecycleMeta,
          [taskId]: {
            ...(s.taskLifecycleMeta[taskId] ?? {}),
            effectiveStatus: status,
          },
        },
      }));
    };

    for (const event of [
      "task_created",
      "task_updated",
      "task_assigned",
      "task_completed",
    ]) {
      unsubs.push(ws.on(event, handleTaskLifecycle));
    }

    const handleProgress = (payload: Record<string, unknown>) => {
      const taskId = extractTaskId(payload);
      if (!taskId) return;
      const currentStep = (payload.current_step ??
        payload.currentStep ??
        "") as string;
      set((s) => {
        const merged = mergeProgress(s.taskProgress[taskId], currentStep);
        if (merged === s.taskProgress[taskId]) return s;
        return {
          taskProgress: { ...s.taskProgress, [taskId]: merged },
        };
      });
    };

    unsubs.push(ws.on("task_progress", handleProgress));
    unsubs.push(ws.on("conv:task_progress", handleProgress));

    return () => unsubs.forEach((u) => u());
  },
}));

/** Helper: how many tasks are in an active state (pending/accepted/in_progress/blocked).
 * Use for the Tasks-tab badge in the left rail. */
export function countActiveTasks(tasks: Task[]): number {
  return tasks.filter((t) => ACTIVE_STATUSES.has(t.status)).length;
}
