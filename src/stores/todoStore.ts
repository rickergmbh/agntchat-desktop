import { create } from "zustand";
import * as api from "../lib/api";
import type { TodoItem, AddTodoInput, UpdateTodoInput } from "../lib/api";
import { ws } from "../services/websocket";
import { useAuthStore } from "./authStore";

/** i18n key (tasks:todo.*) for the most recent failed operation; the
 *  TodoList renders it as a transient inline error. */
export type TodoErrorKey =
  | "loadFailed"
  | "addFailed"
  | "toggleFailed"
  | "updateFailed"
  | "deleteFailed"
  | null;

interface TodoState {
  todos: TodoItem[];
  loading: boolean;
  errorKey: TodoErrorKey;

  fetchTodos: () => Promise<void>;
  addTodo: (input: AddTodoInput) => Promise<boolean>;
  updateTodo: (id: string, patch: UpdateTodoInput) => Promise<boolean>;
  toggleTodo: (id: string) => Promise<void>;
  deleteTodo: (id: string) => Promise<void>;
  initWsListeners: () => () => void;
}

/** Open items first — due-dated ones soonest-first ahead of undated ones
 *  (which keep the oldest-first running-list feel) — then completed by
 *  most recently done. Reapplied locally after optimistic writes and WS
 *  upserts. */
function sortTodos(todos: TodoItem[]): TodoItem[] {
  return [...todos].sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    if (a.status === "open") {
      const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
      const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
      if (aDue !== bDue) return aDue - bDue;
      return new Date(a.insertedAt).getTime() - new Date(b.insertedAt).getTime();
    }
    return (
      new Date(b.completedAt ?? b.updatedAt).getTime() -
      new Date(a.completedAt ?? a.updatedAt).getTime()
    );
  });
}

export const useTodoStore = create<TodoState>((set, get) => ({
  todos: [],
  loading: false,
  errorKey: null,

  fetchTodos: async () => {
    set({ loading: true });
    try {
      const data = await api.fetchTodosRest();
      // Hard replace: the list is small and workspace-scoped, so there's
      // no pagination-merge subtlety like the tasks index.
      set({ todos: sortTodos(data.todos), errorKey: null });
    } catch {
      set({ errorKey: "loadFailed" });
    } finally {
      set({ loading: false });
    }
  },

  addTodo: async (input) => {
    try {
      const data = await api.createTodoRest(input);
      set((s) => ({
        todos: sortTodos([data.todo, ...s.todos.filter((t) => t.id !== data.todo.id)]),
        errorKey: null,
      }));
      return true;
    } catch {
      set({ errorKey: "addFailed" });
      return false;
    }
  },

  // Server-confirmed rather than optimistic: a patch can change the
  // assignee (whose TodoAuthor shape only the server can resolve) and the
  // reminder link, so the authoritative row comes back and replaces.
  updateTodo: async (id, patch) => {
    try {
      const data = await api.updateTodoRest(id, patch);
      set((s) => ({
        todos: sortTodos(s.todos.map((t) => (t.id === id ? data.todo : t))),
        errorKey: null,
      }));
      return true;
    } catch {
      set({ errorKey: "updateFailed" });
      return false;
    }
  },

  // Optimistic: flip locally, roll back to the snapshot if the server
  // rejects. (First optimistic write path in the stores — a checkbox
  // that round-trips before rendering feels broken.)
  toggleTodo: async (id) => {
    const snapshot = get().todos;
    const item = snapshot.find((t) => t.id === id);
    if (!item) return;

    const me = useAuthStore.getState().participant;
    const optimistic: TodoItem =
      item.status === "open"
        ? {
            ...item,
            status: "done",
            completedAt: new Date().toISOString(),
            completedBy: me
              ? { id: me.id, displayName: me.displayName, type: "human", avatarUrl: me.avatarUrl }
              : null,
          }
        : { ...item, status: "open", completedAt: null, completedBy: null };

    set((s) => ({ todos: sortTodos(s.todos.map((t) => (t.id === id ? optimistic : t))) }));

    try {
      const data =
        item.status === "open"
          ? await api.completeTodoRest(id)
          : await api.reopenTodoRest(id);
      set((s) => ({
        todos: sortTodos(s.todos.map((t) => (t.id === id ? data.todo : t))),
        errorKey: null,
      }));
    } catch {
      set({ todos: snapshot, errorKey: "toggleFailed" });
    }
  },

  deleteTodo: async (id) => {
    const snapshot = get().todos;
    set((s) => ({ todos: s.todos.filter((t) => t.id !== id) }));
    try {
      await api.deleteTodoRest(id);
      set({ errorKey: null });
    } catch {
      set({ todos: snapshot, errorKey: "deleteFailed" });
    }
  },

  initWsListeners: () => {
    const unsubs: (() => void)[] = [];

    const upsertTodo = (payload: Record<string, unknown>) => {
      const todo = payload as unknown as TodoItem;
      if (!todo.id) return;
      // Slack-style workspace guard (mirrors taskStore): drop events for
      // items scoped to a workspace the user isn't active in. Items with
      // organizationId null are family-global and always pass.
      const activeOrg = useAuthStore.getState().participant?.activeOrganizationId;
      if (todo.organizationId && activeOrg && todo.organizationId !== activeOrg) {
        return;
      }
      set((s) => ({
        todos: sortTodos([todo, ...s.todos.filter((t) => t.id !== todo.id)]),
      }));
    };

    unsubs.push(ws.on("todo_created", upsertTodo));
    unsubs.push(ws.on("todo_updated", upsertTodo));
    unsubs.push(
      ws.on("todo_deleted", (payload) => {
        const id = (payload as { id?: string }).id;
        if (!id) return;
        set((s) => ({ todos: s.todos.filter((t) => t.id !== id) }));
      })
    );

    return () => unsubs.forEach((u) => u());
  },
}));
