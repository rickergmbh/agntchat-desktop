import { useEffect } from "react";
import { Zap } from "lucide-react";
import { useTaskStore } from "../../stores/taskStore";
import { useResizableWidth } from "../../hooks/useResizableWidth";
import { ResizeHandle } from "../ResizeHandle";
import { TaskList } from "./TaskList";
import { TaskDetail, useOpenConversationFromTask } from "./TaskDetail";

export function TasksView({
  onOpenConversation,
}: {
  onOpenConversation: (conversationId: string) => void;
}) {
  const tasks = useTaskStore((s) => s.tasks);
  const selectedId = useTaskStore((s) => s.selectedTaskId);
  const fetchTasks = useTaskStore((s) => s.fetchTasks);

  // Fetch tasks on mount. WS upserts keep the list live between fetches;
  // no auto-refetch on status change needed.
  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  const { width, ref, resizing, onResizeStart, onResizeReset } =
    useResizableWidth({
      storageKey: "agentchat:taskListWidth",
      defaultWidth: 320,
      min: 240,
      max: 480,
    });

  return (
    // Recessed canvas; the detail column floats over the list as a rounded
    // panel lapping left — same layered overlap as the chat view.
    <div className="relative flex-1 flex h-full overflow-hidden bg-canvas">
      <TaskList width={width} innerRef={ref} />
      <ResizeHandle
        left={width}
        resizing={resizing}
        onResizeStart={onResizeStart}
        onResizeReset={onResizeReset}
        label="Resize task list"
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
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
      <Zap className="w-12 h-12 text-muted-foreground/40 mb-3" />
      <p className="text-sm font-medium text-foreground">Select a task</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-xs">
        Pick a task from the left to see its progress, live activity, and
        actions.
      </p>
    </div>
  );
}

// Re-export for convenience — AppShell uses this hook to wire "Open chat"
// from the detail pane back into the chat view.
export { useOpenConversationFromTask };
