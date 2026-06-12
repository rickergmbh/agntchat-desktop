import { useState } from "react";
import {
  Ban,
  CheckCircle,
  XCircle,
  Clock,
  ListChecks,
  ChevronDown,
  ChevronRight,
  FileText,
  Check,
  X,
  Loader2,
  Square,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { getMessagePayload } from "../../lib/api";
import type { Message } from "../../lib/api";
import { MarkdownContent } from "./MarkdownContent";
import { useTaskStore } from "../../stores/taskStore";

/**
 * Task message renderers ported from web/src/components/messages/TaskMessages.tsx.
 *
 * Pulls live task state from `useTaskStore`:
 *  - `taskLifecycleMeta[id].effectiveStatus` overrides the static
 *    `taskSnapshot.status` so a running TaskRequest card flips to
 *    complete/failed without a fresh message arriving.
 *  - `taskProgress[id]` drives the LiveSteps ticker inside the working
 *    state of a TaskRequest card.
 */

// --- Helpers ---

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function firstLine(text: string): string {
  const line = text.split("\n")[0] ?? text;
  return line.length > 80 ? line.slice(0, 77) + "..." : line;
}

function LiveSteps({ taskId }: { taskId: string }) {
  const progress = useTaskStore((s) => s.taskProgress[taskId]);
  if (!progress || progress.recentSteps.length === 0) return null;

  const pastSteps = progress.recentSteps.slice(0, -1).slice(-3);
  const currentStep = progress.recentSteps[progress.recentSteps.length - 1];

  return (
    <div className="mt-2 space-y-1 border-t border-border pt-2">
      {pastSteps.map((step, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/30" />
          <span className="text-[11px] text-muted-foreground/60">{step}</span>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary" />
        <span className="text-[11px] font-medium">{currentStep}</span>
      </div>
    </div>
  );
}

function AgentAvatar({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl?: string;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className="h-9 w-9 rounded-full object-cover"
      />
    );
  }
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 text-[10px] font-semibold text-primary">
      {initials}
    </div>
  );
}

// --- TaskRequest ---

interface TaskRequestPayload {
  title?: string;
  spec?: { description?: string; acceptance_criteria?: string[] };
  priority?: string;
  timeout_seconds?: number;
}

export function TaskRequestMessage({ message }: { message: Message }) {
  const p = getMessagePayload<TaskRequestPayload>(message);
  const title = p.title ?? message.content;
  const taskId =
    message.taskSnapshot?.id ??
    ((message.metadata as Record<string, unknown> | undefined)?.task_id as
      | string
      | undefined) ??
    ((p as Record<string, unknown>).task_id as string | undefined);

  // Live status: taskStore.taskLifecycleMeta overrides the static snapshot
  // so this card updates in-place as the task progresses.
  const liveStatus = useTaskStore((s) =>
    taskId ? s.taskLifecycleMeta[taskId]?.effectiveStatus : undefined
  );
  const status = liveStatus ?? message.taskSnapshot?.status ?? "pending";
  const agentName = message.sender?.displayName ?? "Agent";
  const avatarUrl = message.sender?.avatarUrl;
  const isWorking =
    status === "in_progress" || status === "accepted" || status === "pending";
  const isComplete = status === "complete";
  const isFailed =
    status === "failed" || status === "declined" || status === "rejected";
  const isCancelled = status === "cancelled" || status === "exhausted";

  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus);
  const [stopping, setStopping] = useState(false);

  const handleStop = async () => {
    if (!taskId) return;
    if (!confirm(`Stop "${title}"?`)) return;
    setStopping(true);
    try {
      await updateTaskStatus(taskId, "cancelled");
    } catch (e) {
      console.warn("[tasks] stop from card failed", e);
    } finally {
      setStopping(false);
    }
  };

  if (isWorking) {
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="p-3">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <AgentAvatar name={agentName} avatarUrl={avatarUrl} />
              {status !== "pending" && (
                <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 animate-pulse rounded-full border-2 border-card bg-primary" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{agentName}</p>
              <p className="text-xs text-muted-foreground">
                {status === "pending"
                  ? "assigned to this"
                  : "is working on this"}
              </p>
            </div>
            {status !== "pending" && (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            )}
            {taskId && (
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
                    : "hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                )}
              >
                {stopping ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Square className="h-3 w-3 fill-current" />
                )}
              </button>
            )}
          </div>
          <p className="mt-2 text-sm font-semibold leading-snug">{title}</p>

          {taskId && <LiveSteps taskId={taskId} />}
        </div>
      </div>
    );
  }

  if (isCancelled) {
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-muted/30">
        <div className="flex items-center gap-2.5 p-3">
          <AgentAvatar name={agentName} avatarUrl={avatarUrl} />
          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {status === "exhausted" ? "Task Exhausted" : "Task Stopped"}
            </span>
            <p className="mt-0.5 truncate text-sm font-semibold">{title}</p>
          </div>
          <Ban className="h-5 w-5 shrink-0 text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (isComplete) {
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-success/5">
        <div className="flex items-center gap-2.5 p-3">
          <AgentAvatar name={agentName} avatarUrl={avatarUrl} />
          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-success dark:text-success">
              Task Complete
            </span>
            <p className="mt-0.5 truncate text-sm font-semibold">{title}</p>
          </div>
          <CheckCircle className="h-5 w-5 shrink-0 text-success" />
        </div>
      </div>
    );
  }

  if (isFailed) {
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-destructive/5">
        <div className="flex items-center gap-2.5 p-3">
          <AgentAvatar name={agentName} avatarUrl={avatarUrl} />
          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-destructive dark:text-destructive">
              {status === "declined" ? "Task Declined" : "Task Failed"}
            </span>
            <p className="mt-0.5 truncate text-sm font-semibold">{title}</p>
          </div>
          <XCircle className="h-5 w-5 shrink-0 text-destructive" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <ListChecks className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-semibold flex-1 min-w-0">{title}</span>
      </div>
    </div>
  );
}

// --- TaskDecision (Accept / Reject) ---

interface TaskDecisionPayload {
  message?: string;
  reason?: string;
  suggestion?: string;
  estimated_seconds?: number;
}

export function TaskDecisionMessage({ message }: { message: Message }) {
  const p = getMessagePayload<TaskDecisionPayload>(message);
  const type = message.messageType || message.contentType;
  const isAccept = type === "TaskAccept";

  return (
    <div className="flex items-start gap-2">
      {isAccept ? (
        <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-success" />
      ) : (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      )}
      <div className="text-sm">
        <span className="font-medium">{isAccept ? "Accepted" : "Declined"}</span>
        {(p.message || p.reason) && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {p.message ?? p.reason}
          </p>
        )}
        {p.suggestion && (
          <p className="mt-0.5 text-xs italic text-muted-foreground">
            Suggestion: {p.suggestion}
          </p>
        )}
        {p.estimated_seconds != null && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />~{Math.ceil(p.estimated_seconds / 60)}min
          </p>
        )}
      </div>
    </div>
  );
}

// --- TaskProgress ---
// Canonical flat shape posted by Tasks.execute_report_progress and broadcast
// by Gateway.broadcast_task_progress. Keep in sync with mobile + web.
interface TaskProgressPayload {
  task_id?: string;
  type?: "task_progress";
  status?: string;
  title?: string;
  current_step?: string;
  progress?: string;
  percent_complete?: number;
  steps_total?: number;
  elapsed_ms?: number;
  phase?: string;
}

export function TaskProgressMessage({ message }: { message: Message }) {
  const p = getMessagePayload<TaskProgressPayload>(message);
  const stepText = p.current_step || p.progress || null;
  const percent =
    typeof p.percent_complete === "number"
      ? Math.max(0, Math.min(100, p.percent_complete))
      : null;
  const elapsedSeconds =
    typeof p.elapsed_ms === "number" ? p.elapsed_ms / 1000 : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{p.status ?? "In progress"}</span>
        {elapsedSeconds != null && (
          <span className="text-muted-foreground tabular-nums">
            {formatDuration(elapsedSeconds)}
          </span>
        )}
      </div>
      {percent != null && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      {stepText && (
        <div className="flex items-start gap-2.5">
          <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full bg-primary animate-pulse" />
          <span className="text-xs font-medium">{stepText}</span>
        </div>
      )}
    </div>
  );
}

// --- TaskResult (TaskComplete / TaskFail) ---

interface TaskCompletePayload {
  task_id?: string;
  result?: {
    summary?: string;
    artifacts?: Array<{ type: string; path?: string; message?: string }>;
    criteria_met?: Record<string, boolean>;
  };
  duration_seconds?: number;
}

interface TaskFailPayload {
  task_id?: string;
  error?: {
    code?: string;
    message?: string;
  };
  duration_seconds?: number;
  partial_result?: { summary?: string };
}

export function TaskResultMessage({ message }: { message: Message }) {
  const isComplete = message.messageType === "TaskComplete";
  const [expanded, setExpanded] = useState(false);
  if (isComplete) {
    return (
      <TaskCompleteCard
        message={message}
        expanded={expanded}
        setExpanded={setExpanded}
      />
    );
  }
  return (
    <TaskFailCard
      message={message}
      expanded={expanded}
      setExpanded={setExpanded}
    />
  );
}

function TaskCompleteCard({
  message,
  expanded,
  setExpanded,
}: {
  message: Message;
  expanded: boolean;
  setExpanded: (v: boolean) => void;
}) {
  const p = getMessagePayload<TaskCompletePayload>(message);
  const summary = p.result?.summary || message.content || "Task completed";
  const artifacts = p.result?.artifacts;
  const criteriaMet = p.result?.criteria_met;
  const hasDetails =
    (summary && summary.includes("\n")) ||
    (artifacts && artifacts.length > 0) ||
    Boolean(criteriaMet && Object.keys(criteriaMet).length > 0) ||
    p.duration_seconds != null;

  return (
    <div className="w-full rounded-lg border border-success/20 overflow-hidden">
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
          hasDetails && "cursor-pointer hover:bg-muted/40"
        )}
        onClick={() => hasDetails && setExpanded(!expanded)}
      >
        <CheckCircle className="h-4 w-4 shrink-0 text-success" />
        <span className="text-sm font-medium text-success dark:text-success">
          Completed
        </span>
        <span className="flex-1 truncate text-xs text-muted-foreground">
          {firstLine(summary)}
        </span>
        {hasDetails &&
          (expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ))}
      </button>

      {expanded && (
        <div className="border-t border-success/10 px-3 py-2.5 space-y-3">
          <MarkdownContent content={summary} />

          {p.duration_seconds != null && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>Duration: {formatDuration(p.duration_seconds)}</span>
            </div>
          )}

          {criteriaMet && Object.keys(criteriaMet).length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wide">
                Criteria
              </span>
              {Object.entries(criteriaMet).map(([key, met]) => (
                <div key={key} className="flex items-center gap-2 text-xs">
                  {met ? (
                    <Check className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <X className="h-3.5 w-3.5 text-destructive" />
                  )}
                  <span className="text-muted-foreground">{key}</span>
                </div>
              ))}
            </div>
          )}

          {artifacts && artifacts.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wide">
                Artifacts
              </span>
              {artifacts.map((a, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="font-mono text-[11px]">
                    {a.type}
                    {a.path ? `: ${a.path}` : ""}
                    {a.message ? ` -- ${a.message}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TaskFailCard({
  message,
  expanded,
  setExpanded,
}: {
  message: Message;
  expanded: boolean;
  setExpanded: (v: boolean) => void;
}) {
  const p = getMessagePayload<TaskFailPayload>(message);
  const errorMessage = p.error?.message || message.content || "Task failed";
  const partial = p.partial_result?.summary;
  const hasDetails = Boolean(partial) || p.duration_seconds != null || Boolean(p.error?.code);

  return (
    <div className="w-full rounded-lg border border-destructive/20 overflow-hidden">
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
          hasDetails && "cursor-pointer hover:bg-muted/40"
        )}
        onClick={() => hasDetails && setExpanded(!expanded)}
      >
        <XCircle className="h-4 w-4 shrink-0 text-destructive" />
        <span className="text-sm font-medium text-destructive dark:text-destructive">
          Failed
        </span>
        <span className="flex-1 truncate text-xs text-muted-foreground">
          {firstLine(errorMessage)}
        </span>
        {hasDetails &&
          (expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ))}
      </button>

      {expanded && (
        <div className="border-t border-destructive/10 px-3 py-2.5 space-y-2">
          {p.error?.code && (
            <p className="text-[11px] font-mono text-muted-foreground">
              {p.error.code}
            </p>
          )}
          <MarkdownContent content={errorMessage} />
          {partial && (
            <div className="rounded border border-border/60 bg-muted/30 p-2">
              <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wide">
                Partial Result
              </span>
              <MarkdownContent content={partial} />
            </div>
          )}
          {p.duration_seconds != null && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>Duration: {formatDuration(p.duration_seconds)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const TASK_MESSAGE_TYPES = new Set([
  "TaskRequest",
  "TaskAccept",
  "TaskReject",
  "TaskDeclined",
  "TaskProgress",
  "TaskComplete",
  "TaskFail",
]);

export function isTaskMessage(message: Message): boolean {
  const type = message.messageType || message.contentType || "";
  return TASK_MESSAGE_TYPES.has(type);
}

export function TaskMessage({ message }: { message: Message }) {
  const type = message.messageType || message.contentType;
  switch (type) {
    case "TaskRequest":
      return <TaskRequestMessage message={message} />;
    case "TaskAccept":
    case "TaskReject":
    case "TaskDeclined":
      return <TaskDecisionMessage message={message} />;
    case "TaskProgress":
      return <TaskProgressMessage message={message} />;
    case "TaskComplete":
    case "TaskFail":
      return <TaskResultMessage message={message} />;
    default:
      return null;
  }
}
