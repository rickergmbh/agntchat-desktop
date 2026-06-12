import { useState } from "react";
import { Loader2, Square } from "lucide-react";
import { cn } from "../../lib/utils";
import { useTaskStore } from "../../stores/taskStore";

/**
 * Round stop button for in-flight task cards (TaskRequest card, StatusUpdate
 * WorkingCard / LifecycleCard, Tasks-list rows). Confirms, then cancels the
 * task via `taskStore.updateTaskStatus(id, "cancelled")` — the backend's
 * TaskCancellationNotifyWorker hard-stops the assignee's bridge run.
 *
 * Render only for active statuses (pending/accepted/in_progress/blocked);
 * this component doesn't gate on status itself.
 */
export function StopTaskButton({
  taskId,
  title,
  className,
}: {
  taskId: string;
  /** Used in the confirm prompt. */
  title?: string;
  className?: string;
}) {
  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus);
  const [stopping, setStopping] = useState(false);

  const handleStop = async (e: React.MouseEvent) => {
    // Cards may sit inside clickable containers (expand toggles, row buttons).
    e.stopPropagation();
    if (!confirm(`Stop "${title ?? "this task"}"?`)) return;
    setStopping(true);
    try {
      await updateTaskStatus(taskId, "cancelled");
    } catch (err) {
      console.warn("[tasks] stop failed", taskId, err);
    } finally {
      setStopping(false);
    }
  };

  return (
    <button
      type="button"
      onClick={stopping ? undefined : handleStop}
      disabled={stopping}
      title="Stop task"
      aria-label="Stop task"
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
        "border border-border text-muted-foreground transition-colors",
        stopping
          ? "cursor-not-allowed opacity-60"
          : "hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive",
        className
      )}
    >
      {stopping ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Square className="h-3 w-3 fill-current" />
      )}
    </button>
  );
}
