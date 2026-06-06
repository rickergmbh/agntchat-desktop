import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search, Zap } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn, formatRelativeShort } from "../../lib/utils";
import { useTaskStore } from "../../stores/taskStore";
import type { Task, TaskStatus } from "../../lib/api";

type Filter = "active" | "pending" | "in_progress" | "complete" | "cancelled";

/**
 * Buckets cover the full set of backend task states so no task is ever
 * orphaned outside a filter. Canonical states (backend/lib/agentchat/tasks/
 * task.ex:9): pending accepted rejected in_progress blocked complete
 * cancelled exhausted. Matchers are grouped semantically:
 *  - Pending = waiting to start or just picked up (pending + accepted)
 *  - Progress = actively running, including stalled (in_progress + blocked)
 *  - Done = completed successfully
 *  - Cancelled = terminated without success (cancelled + rejected + exhausted)
 */
const FILTERS: { value: Filter; label: string; matches: (s: TaskStatus) => boolean }[] = [
  {
    value: "active",
    label: "Active",
    matches: (s) =>
      s === "pending" || s === "accepted" || s === "in_progress" || s === "blocked",
  },
  {
    value: "pending",
    label: "Pending",
    matches: (s) => s === "pending" || s === "accepted",
  },
  {
    value: "in_progress",
    label: "Progress",
    matches: (s) => s === "in_progress" || s === "blocked",
  },
  { value: "complete", label: "Done", matches: (s) => s === "complete" },
  {
    value: "cancelled",
    label: "Cancelled",
    matches: (s) => s === "cancelled" || s === "rejected" || s === "exhausted",
  },
];

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-warning/10 text-warning border-warning/30",
  accepted: "bg-primary/10 text-primary border-primary/30",
  in_progress: "bg-warning/10 text-warning border-warning/30",
  blocked: "bg-destructive/10 text-destructive border-destructive/30",
  complete: "bg-success/10 text-success border-success/30",
  cancelled: "bg-muted text-muted-foreground border-border",
  rejected: "bg-destructive/10 text-destructive border-destructive/30",
  exhausted: "bg-muted text-muted-foreground border-border",
};

export function TaskList() {
  const tasks = useTaskStore((s) => s.tasks);
  const loading = useTaskStore((s) => s.loading);
  const selectedId = useTaskStore((s) => s.selectedTaskId);
  const selectTask = useTaskStore((s) => s.selectTask);

  const [filter, setFilter] = useState<Filter>("active");
  const [search, setSearch] = useState("");

  // If a task is selected externally (e.g. via "View Full Details" from a
  // chat card) and its status doesn't match the current filter, switch the
  // filter so the row is visible in the list. Only fires once per selection
  // change — otherwise the user couldn't change the filter while a task is
  // selected (the effect would snap it right back).
  const syncedSelectionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedId) {
      syncedSelectionRef.current = null;
      return;
    }
    if (syncedSelectionRef.current === selectedId) return;
    const task = tasks.find((t) => t.id === selectedId);
    if (!task) return;
    syncedSelectionRef.current = selectedId;
    const current = FILTERS.find((x) => x.value === filter) ?? FILTERS[0];
    if (current.matches(task.status)) return;
    const next = FILTERS.find((f) => f.value !== filter && f.matches(task.status));
    if (next) setFilter(next.value);
  }, [selectedId, tasks, filter]);

  const filtered = useMemo(() => {
    const f = FILTERS.find((x) => x.value === filter) ?? FILTERS[0];
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (!f.matches(t.status)) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q) ||
        (t.assignees ?? []).some((a) =>
          a.displayName.toLowerCase().includes(q)
        )
      );
    });
  }, [tasks, filter, search]);

  return (
    <aside
      className="w-80 shrink-0 flex flex-col border-r border-border bg-surface-elevated"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div
        className="h-14 shrink-0 px-4 border-b border-border flex items-center"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <Zap className="w-3.5 h-3.5 text-primary-foreground" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">Tasks</h2>
        </div>
      </div>

      <div
        className="px-3 py-2 border-b border-border space-y-2"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search tasks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Select
          value={filter}
          onValueChange={(v) => v && setFilter(v as Filter)}
        >
          <SelectTrigger className="h-8 w-full text-xs">
            <SelectValue>
              {(v: Filter) => FILTERS.find((f) => f.value === v)?.label ?? v}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value} className="text-xs">
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div
        className="flex-1 overflow-y-auto"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {loading && tasks.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState hasFilter={filter !== "active" || search.length > 0} />
        ) : (
          <ul className="flex flex-col gap-0.5 px-2 py-1.5">
            {filtered.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                active={task.id === selectedId}
                onClick={() => selectTask(task.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function TaskRow({
  task,
  active,
  onClick,
}: {
  task: Task;
  active: boolean;
  onClick: () => void;
}) {
  const assignee = task.assignees?.[0];
  const name = assignee?.displayName ?? "Unassigned";
  const statusClass = STATUS_COLORS[task.status] ?? STATUS_COLORS.cancelled;

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "w-full flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all",
          active ? "bg-surface-active shadow-sm" : "hover:bg-surface-hover"
        )}
      >
        <Avatar className="h-8 w-8 shrink-0 mt-0.5">
          {assignee?.avatarUrl ? (
            <AvatarImage src={assignee.avatarUrl} alt={name} />
          ) : null}
          <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-semibold">
            {name.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium">{task.title}</p>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {formatRelativeShort(task.updatedAt)}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span
              className={cn(
                "px-1.5 py-0.5 rounded-md border text-[10px] font-medium uppercase tracking-wide",
                statusClass
              )}
            >
              {task.status.replace(/_/g, " ")}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {name}
            </span>
          </div>
        </div>
      </button>
    </li>
  );
}

function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <Zap className="w-10 h-10 text-muted-foreground/40 mb-3" />
      <p className="text-sm text-muted-foreground">
        {hasFilter ? "No matching tasks" : "No tasks yet"}
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        {hasFilter
          ? "Try adjusting search or filters."
          : "Tasks your agents are working on will appear here."}
      </p>
    </div>
  );
}
