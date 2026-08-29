import { useCallback, useEffect, useMemo, useState } from "react";
import { useTaskStore } from "../stores/taskStore";
import { useTodoStore } from "../stores/todoStore";
import { useReminderStore } from "../stores/reminderStore";
import { useAgentStore } from "../stores/agentStore";
import { useAuthStore } from "../stores/authStore";
import { listRoutines } from "../lib/api";
import { reminderGroupKey, groupReminderRows } from "../lib/reminderGrouping";
import type { Agent, AgentReminder, Routine, Task, TodoItem } from "../lib/api";

// ---------------------------------------------------------------------------
// Unified Actions list — merges tasks, to-dos, reminders, and routines into
// one kind-segmented feed. Direct port of mobile's
// app/(main)/(tabs)/(tasks)/index.tsx merge/grouping logic.
// ---------------------------------------------------------------------------

export type MergedItem =
  | { kind: "task"; id: string; task: Task; isDone: boolean; sortTime: number }
  | { kind: "todo"; id: string; todo: TodoItem; isDone: boolean; sortTime: number }
  | { kind: "routine"; id: string; routine: Routine; isDone: boolean; sortTime: number }
  | {
      kind: "reminder";
      id: string;
      /** The soonest-firing member — what the card displays. */
      reminder: AgentReminder;
      /** All active reminders sharing the same group key (the
       *  7_day/1_day/day_of trio a date-only input fans out into), sorted
       *  soonest-first. A plain "exact" reminder is a group of one. */
      group: AgentReminder[];
      isDone: boolean;
      sortTime: number;
    };

export interface Person {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  isAgent: boolean;
}

export interface ActionSection {
  key: "todos" | "tasks" | "reminders" | "routines" | "done";
  data: MergedItem[];
}

const ACTIVE_TASK_STATUSES = new Set(["pending", "accepted", "in_progress", "blocked"]);
function isTaskActive(status: string): boolean {
  return ACTIVE_TASK_STATUSES.has(status);
}

function toMergedTask(task: Task): MergedItem {
  const isDone = !isTaskActive(task.status);
  return { kind: "task", id: task.id, task, isDone, sortTime: new Date(task.updatedAt).getTime() };
}

function toMergedTodo(todo: TodoItem): MergedItem {
  const isDone = todo.status === "done";
  const time = isDone ? (todo.completedAt ?? todo.updatedAt) : todo.insertedAt;
  return { kind: "todo", id: todo.id, todo, isDone, sortTime: new Date(time).getTime() };
}

// Only active routines are surfaced here — paused/disabled/expired ones stay
// on the per-agent Routines section, out of scope for an at-a-glance list.
function toMergedRoutine(routine: Routine): MergedItem {
  const time = routine.nextRunAt ? new Date(routine.nextRunAt).getTime() : Infinity;
  return { kind: "routine", id: routine.id, routine, isDone: false, sortTime: time };
}

function groupReminders(reminders: AgentReminder[]): MergedItem[] {
  return groupReminderRows(reminders).map((group) => {
    const soonest = group[0];
    return {
      kind: "reminder",
      id: reminderGroupKey(soonest),
      reminder: soonest,
      group,
      isDone: false,
      sortTime: new Date(soonest.remindAt).getTime(),
    };
  });
}

/** The person a merged item is filtered/grouped by — the assignee for a
 *  task, the author for a to-do, the running agent for a routine, or
 *  whoever the reminder is for. */
function personForItem(item: MergedItem, agentsById: Map<string, Agent>, myId?: string): Person | null {
  if (item.kind === "task") {
    const a = item.task.assignees?.[0];
    if (!a) return null;
    return { id: a.id, displayName: a.displayName, avatarUrl: a.avatarUrl, isAgent: a.type === "agent" };
  }
  if (item.kind === "todo") {
    const c = item.todo.createdBy;
    return { id: c.id, displayName: c.displayName, avatarUrl: c.avatarUrl, isAgent: c.type === "agent" };
  }
  if (item.kind === "reminder") {
    const agent = agentsById.get(item.reminder.agentId);
    if (agent) return { id: agent.id, displayName: agent.displayName, avatarUrl: agent.avatarUrl, isAgent: true };
    if (item.reminder.agentId === myId) return { id: myId, displayName: "", isAgent: false };
    return null;
  }
  const agent = agentsById.get(item.routine.participantId);
  if (!agent) return null;
  return { id: agent.id, displayName: agent.displayName, avatarUrl: agent.avatarUrl, isAgent: true };
}

export function useUnifiedActions() {
  const tasks = useTaskStore((s) => s.tasks);
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const todos = useTodoStore((s) => s.todos);
  const fetchTodos = useTodoStore((s) => s.fetchTodos);
  const reminders = useReminderStore((s) => s.reminders);
  const fetchReminders = useReminderStore((s) => s.fetchReminders);
  const agents = useAgentStore((s) => s.agents);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const myId = useAuthStore((s) => s.participant?.id);
  const activeOrgId = useAuthStore((s) => s.participant?.activeOrganizationId);

  const [routines, setRoutines] = useState<Routine[]>([]);
  const [tasksReady, setTasksReady] = useState(false);
  const [todosReady, setTodosReady] = useState(false);
  const [remindersReady, setRemindersReady] = useState(false);
  const [routinesReady, setRoutinesReady] = useState(false);

  const [personFilter, setPersonFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCompleted, setShowCompleted] = useState(true);

  const loadRoutines = useCallback(async () => {
    const { routines: data } = await listRoutines();
    setRoutines(data ?? []);
  }, []);

  useEffect(() => {
    fetchTasks().finally(() => setTasksReady(true));
  }, [fetchTasks]);

  useEffect(() => {
    fetchTodos().finally(() => setTodosReady(true));
  }, [fetchTodos, activeOrgId]);

  useEffect(() => {
    fetchReminders().finally(() => setRemindersReady(true));
  }, [fetchReminders]);

  useEffect(() => {
    Promise.all([loadRoutines(), Object.keys(agents).length === 0 ? fetchAgents() : Promise.resolve()]).finally(
      () => setRoutinesReady(true)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRoutines]);

  const firstLoadDone = tasksReady && todosReady && remindersReady && routinesReady;

  const refresh = useCallback(async () => {
    await Promise.all([fetchTasks(), fetchTodos(), fetchReminders(), loadRoutines()]);
  }, [fetchTasks, fetchTodos, fetchReminders, loadRoutines]);

  const activeRoutines = useMemo(() => routines.filter((r) => r.status === "active"), [routines]);
  // A reminder armed from a to-do's "remind me" toggle is already
  // represented there (due badge + bell) — excluded here to avoid a
  // redundant card that would desync from the to-do's own reminder
  // lifecycle if edited/deleted through this generic dialog.
  const activeReminders = useMemo(
    () => reminders.filter((r) => r.status === "active" && typeof r.metadata?.target_todo_id !== "string"),
    [reminders]
  );
  const agentsById = useMemo(
    () => new Map(Object.values(agents).map((m) => [m.agent.id, m.agent])),
    [agents]
  );

  const merged = useMemo(
    () => [
      ...tasks.map(toMergedTask),
      ...todos.map(toMergedTodo),
      ...activeRoutines.map(toMergedRoutine),
      ...groupReminders(activeReminders),
    ],
    [tasks, todos, activeRoutines, activeReminders]
  );

  const people = useMemo(() => {
    const map = new Map<string, Person>();
    for (const item of merged) {
      const p = personForItem(item, agentsById, myId);
      if (p) map.set(p.id, p);
    }
    return [...map.values()];
  }, [merged, agentsById, myId]);

  const filtered = useMemo(() => {
    let result = merged;

    if (personFilter !== "all") {
      result = result.filter((item) => personForItem(item, agentsById, myId)?.id === personFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((item) => {
        if (item.kind === "task") {
          const task = item.task;
          return (
            task.title?.toLowerCase().includes(q) ||
            task.description?.toLowerCase().includes(q) ||
            task.assignees?.some((a) => a.displayName?.toLowerCase().includes(q))
          );
        }
        if (item.kind === "todo") {
          return (
            item.todo.title.toLowerCase().includes(q) ||
            item.todo.createdBy.displayName?.toLowerCase().includes(q)
          );
        }
        if (item.kind === "reminder") {
          return (
            item.reminder.eventLabel.toLowerCase().includes(q) ||
            agentsById.get(item.reminder.agentId)?.displayName?.toLowerCase().includes(q)
          );
        }
        return (
          item.routine.name.toLowerCase().includes(q) ||
          agentsById.get(item.routine.participantId)?.displayName?.toLowerCase().includes(q)
        );
      });
    }

    return result;
  }, [merged, personFilter, searchQuery, agentsById, myId]);

  const openTodos = useMemo(() => filtered.filter((i) => i.kind === "todo" && !i.isDone), [filtered]);
  const activeTasks = useMemo(
    () => filtered.filter((i) => i.kind === "task" && !i.isDone).sort((a, b) => b.sortTime - a.sortTime),
    [filtered]
  );
  const reminderItems = useMemo(
    () => filtered.filter((i) => i.kind === "reminder").sort((a, b) => a.sortTime - b.sortTime),
    [filtered]
  );
  const routineItems = useMemo(
    () => filtered.filter((i) => i.kind === "routine").sort((a, b) => a.sortTime - b.sortTime),
    [filtered]
  );
  const done = useMemo(
    () =>
      filtered
        .filter((i) => (i.kind === "todo" || i.kind === "task") && i.isDone)
        .sort((a, b) => b.sortTime - a.sortTime),
    [filtered]
  );

  const sections = useMemo(() => {
    if (!firstLoadDone) return [];
    const result: ActionSection[] = [];
    if (openTodos.length > 0) result.push({ key: "todos", data: openTodos });
    if (activeTasks.length > 0) result.push({ key: "tasks", data: activeTasks });
    if (reminderItems.length > 0) result.push({ key: "reminders", data: reminderItems });
    if (routineItems.length > 0) result.push({ key: "routines", data: routineItems });
    if (done.length > 0) result.push({ key: "done", data: showCompleted ? done : [] });
    return result;
  }, [firstLoadDone, openTodos, activeTasks, reminderItems, routineItems, done, showCompleted]);

  return {
    sections,
    people,
    personFilter,
    setPersonFilter,
    searchQuery,
    setSearchQuery,
    showCompleted,
    setShowCompleted,
    doneCount: done.length,
    loading: !firstLoadDone,
    refresh,
    agentsById,
    myId,
  };
}
