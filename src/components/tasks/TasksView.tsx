import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListTodo } from "lucide-react";
import { useTaskStore } from "../../stores/taskStore";
import { useTodoStore } from "../../stores/todoStore";
import { useReminderStore } from "../../stores/reminderStore";
import { useResizableWidth } from "../../hooks/useResizableWidth";
import { reminderGroupKey, groupReminderRows } from "../../lib/reminderGrouping";
import { ResizeHandle } from "../ResizeHandle";
import { TaskDetail, useOpenConversationFromTask } from "./TaskDetail";
import { ActionsList } from "./ActionsList";
import TodoDetail from "./TodoDetail";
import ReminderDetail from "./ReminderDetail";
import type { ActionSelection } from "./selection";

export function TasksView({
  onOpenConversation,
}: {
  onOpenConversation: (conversationId: string) => void;
}) {
  const { t } = useTranslation("tasks");
  const tasks = useTaskStore((s) => s.tasks);
  const selectedId = useTaskStore((s) => s.selectedTaskId);
  const selectTask = useTaskStore((s) => s.selectTask);
  const fetchTasksIfStale = useTaskStore((s) => s.fetchTasksIfStale);
  const todos = useTodoStore((s) => s.todos);
  const reminders = useReminderStore((s) => s.reminders);

  // Serve the cached list on mount, refetching only once it's stale. WS
  // upserts keep it live between fetches; no auto-refetch on status change
  // needed. ActionsList asks for the same thing — the store's in-flight
  // guard collapses both into one request.
  useEffect(() => {
    void fetchTasksIfStale();
  }, [fetchTasksIfStale]);

  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  // To-dos and reminders share the detail column with tasks, so exactly one
  // of the two selections is live at a time.
  const [selection, setSelection] = useState<ActionSelection>(null);

  const select = useCallback(
    (next: ActionSelection) => {
      if (next) selectTask(null);
      setSelection(next);
    },
    [selectTask]
  );

  // A task selected from outside this view (a chat card's "View full
  // details") takes the column over.
  useEffect(() => {
    if (selectedId) setSelection(null);
  }, [selectedId]);

  const selectedTodo = useMemo(
    () => (selection?.kind === "todo" && selection.id ? todos.find((x) => x.id === selection.id) : undefined),
    [selection, todos]
  );

  // Reminder rows are groups (the 7_day/1_day/day_of fan-out of one source
  // event), keyed the same way the list keys them.
  const selectedReminderGroup = useMemo(() => {
    if (selection?.kind !== "reminder" || !selection.id) return undefined;
    const active = reminders.filter((r) => r.status === "active");
    return groupReminderRows(active).find((g) => reminderGroupKey(g[0]) === selection.id);
  }, [selection, reminders]);

  // An item deleted underneath us (or by another client) drops the column
  // back to the empty state rather than stranding a form on a dead row.
  useEffect(() => {
    if (selection?.kind === "todo" && selection.id && !selectedTodo) setSelection(null);
    if (selection?.kind === "reminder" && selection.id && !selectedReminderGroup) setSelection(null);
  }, [selection, selectedTodo, selectedReminderGroup]);

  const { width, ref, resizing, onResizeStart, onResizeReset } =
    useResizableWidth({
      storageKey: "agentchat:taskListWidth",
      defaultWidth: 320,
      min: 240,
      max: 480,
    });

  return (
    // Recessed canvas; the detail column floats over the list as a rounded
    // panel lapping left — same layered overlap as the chat view. The
    // unified Actions list (to-dos, tasks, reminders, routines all in one
    // kind-segmented feed) replaces the old Tasks/To-dos tab split — no
    // toggle needed since everything already lives in the one list.
    <div className="relative flex-1 flex h-full overflow-hidden bg-canvas">
      <ActionsList width={width} innerRef={ref} selection={selection} onSelect={select} />
      <ResizeHandle
        left={width}
        resizing={resizing}
        onResizeStart={onResizeStart}
        onResizeReset={onResizeReset}
        label={t("resizeList")}
      />
      <section className="relative z-10 -ml-2 flex-1 flex flex-col bg-card overflow-hidden surface-panel rounded-l-2xl">
        {selection?.kind === "todo" ? (
          <TodoDetail
            key={selection.id ?? "new"}
            todo={selectedTodo}
            initialTitle={selection.draftTitle}
            onCreated={(todo) => setSelection({ kind: "todo", id: todo.id })}
            onClose={() => setSelection(null)}
          />
        ) : selection?.kind === "reminder" ? (
          <ReminderDetail
            key={selection.id ?? "new"}
            group={selectedReminderGroup}
            onClose={() => setSelection(null)}
          />
        ) : selected ? (
          <TaskDetail task={selected} onOpenConversation={onOpenConversation} />
        ) : (
          <EmptyDetail />
        )}
      </section>
    </div>
  );
}

function EmptyDetail() {
  const { t } = useTranslation("tasks");
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
      <ListTodo className="w-12 h-12 text-muted-foreground/40 mb-3" />
      <p className="text-sm font-medium text-foreground">{t("selectTask")}</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-xs">
        {t("selectHint")}
      </p>
    </div>
  );
}

// Re-export for convenience — AppShell uses this hook to wire "Open chat"
// from the detail pane back into the chat view.
export { useOpenConversationFromTask };
