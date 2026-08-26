import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListTodo, Loader2, Search, Square } from "lucide-react";
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
 * cancelled failed exhausted. Matchers are grouped semantically:
 *  - Pending = waiting to start or just picked up (pending + accepted)
 *  - Progress = actively running, including stalled (in_progress + blocked)
 *  - Done = completed successfully
 *  - Ended = terminated without success (cancelled + failed + rejected + exhausted)
 */
// `labelKey` resolves in the tasks: namespace at render time (never t() at
// module scope — it would freeze the language at load).
const FILTERS: { value: Filter; labelKey: string; matches: (s: TaskStatus) => boolean }[] = [
  {
    value: "active",
    labelKey: "filters.active",
    matches: (s) =>
      s === "pending" || s === "accepted" || s === "in_progress" || s === "blocked",
  },
  {
    value: "pending",
    labelKey: "filters.pending",
    matches: (s) => s === "pending" || s === "accepted",
  },
  {
    value: "in_progress",
    labelKey: "filters.inProgress",
    matches: (s) => s === "in_progress" || s === "blocked",
  },
  { value: "complete", labelKey: "filters.done", matches: (s) => s === "complete" },
  {
    value: "cancelled",
    labelKey: "filters.ended",
    matches: (s) => s === "cancelled" || s === "failed" || s === "rejected" || s === "exhausted",
  },
];

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-warning/10 text-warning border-warning/30",
  accepted: "bg-primary/10 text-primary border-primary/30",
  in_progress: "bg-warning/10 text-warning border-warning/30",
  blocked: "bg-destructive/10 text-destructive border-destructive/30",
  complete: "bg-success/10 text-success border-success/30",
  cancelled: "bg-muted text-muted-foreground border-border",
  failed: "bg-destructive/10 text-destructive border-destructive/30",
  rejected: "bg-destructive/10 text-destructive border-destructive/30",
  exhausted: "bg-muted text-muted-foreground border-border",
};

const STATUS_LABEL_KEY: Record<string, string> = {
  pending: "status.pending",
  accepted: "status.accepted",
  in_progress: "status.inProgress",
  blocked: "status.blocked",
  complete: "status.complete",
  cancelled: "status.cancelled",
  failed: "status.failed",
  rejected: "status.rejected",
  exhausted: "status.exhausted",
};

export function TaskList({
  width,
  innerRef,
  headerControl,
}: {
  /** Resizable width in px (from useResizableWidth). */
  width?: number;
  /** Ref to the aside — its left edge is the resize drag origin. */
  innerRef?: React.RefObject<HTMLElement | null>;
  /** Replaces the header title (TasksView passes the Tasks/To-dos toggle). */
  headerControl?: React.ReactNode;
} = {}) {
  const { t } = useTranslation("tasks");
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
      ref={innerRef}
      className="relative z-0 shrink-0 flex flex-col bg-canvas"
      style={
        {
          width: width ?? 320,
          WebkitAppRegion: "drag",
        } as React.CSSProperties
      }
    >
      <div
        className="h-14 shrink-0 px-4 border-b border-border flex items-center"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        {headerControl ?? (
          <h2 className="text-sm font-semibold text-foreground">{t("nav:tasks")}</h2>
        )}
      </div>

      <div
        className="px-3 py-2 border-b border-border space-y-2"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
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
              {(v: Filter) => {
                const match = FILTERS.find((f) => f.value === v);
                return match ? t(match.labelKey) : v;
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value} className="text-xs">
                {t(f.labelKey)}
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

const ACTIVE_ROW_STATUSES = new Set<TaskStatus>([
  "pending",
  "accepted",
  "in_progress",
  "blocked",
]);

function TaskRow({
  task,
  active,
  onClick,
}: {
  task: Task;
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation("tasks");
  const assignee = task.assignees?.[0];
  const name = assignee?.displayName ?? t("unassigned");
  const statusClass = STATUS_COLORS[task.status] ?? STATUS_COLORS.cancelled;
  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus);
  const [stopping, setStopping] = useState(false);
  const stoppable = ACTIVE_ROW_STATUSES.has(task.status);

  const handleStop = async () => {
    if (!confirm(t("stopConfirm", { title: task.title }))) return;
    setStopping(true);
    try {
      await updateTaskStatus(task.id, "cancelled");
    } catch (e) {
      console.warn("[tasks] stop from list failed", e);
    } finally {
      setStopping(false);
    }
  };

  return (
    // The stop control is a SIBLING of the row button (absolutely positioned)
    // — a button nested inside a button is invalid HTML and breaks clicks.
    <li className="relative group">
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
            <p className={cn("truncate text-sm font-medium", stoppable && "group-hover:pr-6")}>
              {task.title}
            </p>
            <span
              className={cn(
                "shrink-0 text-[10px] text-muted-foreground",
                stoppable && "group-hover:opacity-0"
              )}
            >
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
              {STATUS_LABEL_KEY[task.status]
                ? t(STATUS_LABEL_KEY[task.status])
                : task.status.replace(/_/g, " ")}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {name}
            </span>
          </div>
        </div>
      </button>

      {stoppable && (
        <button
          type="button"
          onClick={stopping ? undefined : handleStop}
          disabled={stopping}
          title={t("stopTask")}
          aria-label={t("stopTask")}
          className={cn(
            "absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full",
            "border border-border bg-card text-muted-foreground shadow-sm transition-all",
            stopping
              ? "opacity-60 cursor-not-allowed"
              : "opacity-0 group-hover:opacity-100 hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
          )}
        >
          {stopping ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Square className="h-2.5 w-2.5 fill-current" />
          )}
        </button>
      )}
    </li>
  );
}

function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  const { t } = useTranslation("tasks");
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <ListTodo className="w-10 h-10 text-muted-foreground/40 mb-3" />
      <p className="text-sm text-muted-foreground">
        {hasFilter ? t("emptyFiltered") : t("emptyLabel")}
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        {hasFilter ? t("emptyFilteredHint") : t("emptyHint")}
      </p>
    </div>
  );
}
