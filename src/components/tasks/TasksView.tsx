import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListTodo } from "lucide-react";
import { useTaskStore } from "../../stores/taskStore";
import { useResizableWidth } from "../../hooks/useResizableWidth";
import { ResizeHandle } from "../ResizeHandle";
import { TaskList } from "./TaskList";
import { TaskDetail, useOpenConversationFromTask } from "./TaskDetail";
import { TasksModeToggle, TodoList } from "./TodoList";

export function TasksView({
  onOpenConversation,
}: {
  onOpenConversation: (conversationId: string) => void;
}) {
  const { t } = useTranslation("tasks");
  const tasks = useTaskStore((s) => s.tasks);
  const selectedId = useTaskStore((s) => s.selectedTaskId);
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const [mode, setMode] = useState<"tasks" | "todos">("tasks");

  // Fetch tasks on mount. WS upserts keep the list live between fetches;
  // no auto-refetch on status change needed.
  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // A task selected externally (deep-link from a chat card) needs the
  // tasks pane visible, whatever mode the toggle was left in.
  useEffect(() => {
    if (selectedId) setMode("tasks");
  }, [selectedId]);

  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  const { width, ref, resizing, onResizeStart, onResizeReset } =
    useResizableWidth({
      storageKey: "agentchat:taskListWidth",
      defaultWidth: 320,
      min: 240,
      max: 480,
    });

  if (mode === "todos") {
    return (
      <div className="relative flex-1 flex h-full overflow-hidden bg-canvas">
        <section className="relative z-10 flex-1 flex flex-col bg-card overflow-hidden surface-panel rounded-l-2xl">
          <div
            className="h-14 shrink-0 px-4 flex items-center"
            style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
          >
            <TasksModeToggle mode={mode} onChange={setMode} />
          </div>
          <TodoList />
        </section>
      </div>
    );
  }

  return (
    // Recessed canvas; the detail column floats over the list as a rounded
    // panel lapping left — same layered overlap as the chat view.
    <div className="relative flex-1 flex h-full overflow-hidden bg-canvas">
      <TaskList
        width={width}
        innerRef={ref}
        headerControl={<TasksModeToggle mode={mode} onChange={setMode} />}
      />
      <ResizeHandle
        left={width}
        resizing={resizing}
        onResizeStart={onResizeStart}
        onResizeReset={onResizeReset}
        label={t("resizeList")}
      />
      <section className="relative z-10 -ml-2 flex-1 flex flex-col bg-card overflow-hidden surface-panel rounded-l-2xl">
        {selected ? (
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
