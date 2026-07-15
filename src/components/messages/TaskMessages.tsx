import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  FileText,
  Loader2,
  X,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { getMessagePayload } from "../../lib/api";
import type { Message } from "../../lib/api";
import { MarkdownContent } from "./MarkdownContent";
import { useTaskStore } from "../../stores/taskStore";
import { StopTaskButton } from "./StopTaskButton";

/**
 * Task message renderers.
 *
 * Design language ("quiet card") — the reference for all conversation cards:
 *  1. One neutral surface: every lifecycle state shares `border-border
 *     bg-card`; status never tints the card background or border.
 *  2. Color is a signal, not a theme: status color appears in exactly one
 *     place — the small glyph in the status line. Text stays
 *     foreground/muted-foreground.
 *  3. Fixed anatomy: status line (glyph · label · agent · right-aligned
 *     meta), then title, then detail under a hairline. Elements keep their
 *     position across states so the card reads as one object advancing
 *     through a lifecycle.
 *  4. Sentence case, 12px minimum, tabular-nums for durations.
 *  5. One motion source: the running spinner is the only animation.
 *
 * Live task state comes from `useTaskStore`:
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

/** Visual tone of a task state; drives only the status glyph (rule 2). */
export type TaskTone =
  | "pending"
  | "working"
  | "success"
  | "failure"
  | "warning"
  | "neutral";

export function StatusGlyph({ tone }: { tone: TaskTone }) {
  switch (tone) {
    case "working":
      return (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
      );
    case "success":
      return (
        <Check className="h-3.5 w-3.5 shrink-0 text-success" strokeWidth={2.5} />
      );
    case "failure":
      return (
        <X
          className="h-3.5 w-3.5 shrink-0 text-destructive"
          strokeWidth={2.5}
        />
      );
    case "warning":
      return (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
      );
    case "neutral":
      return <Ban className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
    case "pending":
      return (
        <CircleDashed className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      );
  }
}

/** Shared first row of every task surface: glyph · label · context · meta.
 *  Pass `glyph` to override the tone glyph (e.g. lifecycle icons). */
export function StatusLine({
  tone,
  glyph,
  label,
  context,
  end,
}: {
  tone?: TaskTone;
  glyph?: React.ReactNode;
  label: string;
  context?: string;
  end?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      {glyph ?? (tone ? <StatusGlyph tone={tone} /> : null)}
      <span className="shrink-0 text-xs font-medium text-foreground">
        {label}
      </span>
      {context && (
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {context}
        </span>
      )}
      {end && (
        <span className="ml-auto flex shrink-0 items-center gap-2">{end}</span>
      )}
    </div>
  );
}

/** Pure step ticker: dim past steps, bright current one (exported for previews). */
export function TaskSteps({
  past,
  current,
}: {
  past: string[];
  current: string;
}) {
  return (
    <div className="space-y-1 border-t border-border px-3 py-2">
      {past.map((step, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="h-1 w-1 shrink-0 rounded-full bg-border-strong" />
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {step}
          </span>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <span className="h-1 w-1 shrink-0 rounded-full bg-primary" />
        <span className="min-w-0 truncate text-xs font-medium text-foreground">
          {current}
        </span>
      </div>
    </div>
  );
}

function LiveSteps({ taskId }: { taskId: string }) {
  const progress = useTaskStore((s) => s.taskProgress[taskId]);
  if (!progress || progress.recentSteps.length === 0) return null;

  return (
    <TaskSteps
      past={progress.recentSteps.slice(0, -1).slice(-3)}
      current={progress.recentSteps[progress.recentSteps.length - 1]}
    />
  );
}

// --- TaskRequest ---

interface TaskRequestPayload {
  title?: string;
  spec?: { description?: string; acceptance_criteria?: string[] };
  priority?: string;
  timeout_seconds?: number;
}

/** Map a task status onto the card's tone + `tasks:status.*` label key. */
function requestState(status: string): { tone: TaskTone; labelKey: string } {
  switch (status) {
    case "pending":
      return { tone: "pending", labelKey: "status.pending" };
    case "accepted":
    case "in_progress":
      return { tone: "working", labelKey: "status.in_progress" };
    case "complete":
      return { tone: "success", labelKey: "status.complete" };
    case "failed":
      return { tone: "failure", labelKey: "status.failed" };
    case "rejected":
      return { tone: "failure", labelKey: "status.rejected" };
    case "declined":
      return { tone: "failure", labelKey: "status.declined" };
    case "cancelled":
      return { tone: "neutral", labelKey: "status.cancelled" };
    case "exhausted":
      return { tone: "neutral", labelKey: "status.exhausted" };
    default:
      return { tone: "pending", labelKey: "task" };
  }
}

/**
 * Presentational task card (exported for previews). Live cards go through
 * `TaskRequestMessage`, which resolves the payload + live status and omits
 * `steps` so the ticker reads `taskProgress` from the store.
 */
export function TaskRequestCard({
  status,
  title,
  agentName,
  taskId,
  steps,
}: {
  status: string;
  title: string;
  agentName: string;
  taskId?: string;
  /** Preview-only step override; omit to read live progress from the store. */
  steps?: { past: string[]; current: string };
}) {
  const { t } = useTranslation("tasks");
  const { tone, labelKey } = requestState(status);
  const active =
    status === "pending" || status === "accepted" || status === "in_progress";

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="px-3 py-2.5">
        <StatusLine
          tone={tone}
          label={t(labelKey)}
          context={agentName}
          end={
            active && taskId ? (
              <StopTaskButton taskId={taskId} title={title} className="h-6 w-6" />
            ) : undefined
          }
        />
        <p
          className={cn(
            "mt-1.5 text-sm font-medium leading-snug text-foreground",
            !active && "truncate"
          )}
        >
          {title}
        </p>
      </div>
      {active &&
        (steps ? (
          <TaskSteps past={steps.past} current={steps.current} />
        ) : (
          taskId && <LiveSteps taskId={taskId} />
        ))}
    </div>
  );
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

  return (
    <TaskRequestCard
      status={status}
      title={title}
      agentName={agentName}
      taskId={taskId}
    />
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
  const { t } = useTranslation("tasks");
  const p = getMessagePayload<TaskDecisionPayload>(message);
  const type = message.messageType || message.contentType;
  const isAccept = type === "TaskAccept";

  return (
    <div className="flex items-start gap-2">
      <span className="mt-[3px]">
        <StatusGlyph tone={isAccept ? "success" : "failure"} />
      </span>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-foreground">
            {isAccept ? t("accepted") : t("declined")}
          </span>
          {p.estimated_seconds != null && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {t("estMinutes", { count: Math.ceil(p.estimated_seconds / 60) })}
            </span>
          )}
        </div>
        {(p.message || p.reason) && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {p.message ?? p.reason}
          </p>
        )}
        {p.suggestion && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("suggestion", { text: p.suggestion })}
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
  const { t } = useTranslation("tasks");
  const p = getMessagePayload<TaskProgressPayload>(message);
  const stepText = p.current_step || p.progress || null;
  const percent =
    typeof p.percent_complete === "number"
      ? Math.max(0, Math.min(100, p.percent_complete))
      : null;
  const elapsedSeconds =
    typeof p.elapsed_ms === "number" ? p.elapsed_ms / 1000 : null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-xs font-medium text-foreground">
          {p.status ?? t("status.in_progress")}
        </span>
        {elapsedSeconds != null && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
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
        <div className="flex items-center gap-2">
          <span className="h-1 w-1 shrink-0 rounded-full bg-primary" />
          <span className="min-w-0 truncate text-xs text-foreground">
            {stepText}
          </span>
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

/** Collapsed header row shared by the complete/fail result cards. */
function ResultHeader({
  tone,
  label,
  preview,
  durationSeconds,
  hasDetails,
  expanded,
  onToggle,
}: {
  tone: TaskTone;
  label: string;
  preview: string;
  durationSeconds?: number | null;
  hasDetails: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-left",
        hasDetails && "cursor-pointer transition-colors hover:bg-surface-hover"
      )}
      onClick={() => hasDetails && onToggle()}
    >
      <StatusGlyph tone={tone} />
      <span className="shrink-0 text-xs font-medium text-foreground">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {preview}
      </span>
      {durationSeconds != null && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatDuration(durationSeconds)}
        </span>
      )}
      {hasDetails &&
        (expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ))}
    </button>
  );
}

/** Muted sentence-case heading for a section inside an expanded result. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium text-muted-foreground">{children}</p>;
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
  const { t } = useTranslation("tasks");
  const p = getMessagePayload<TaskCompletePayload>(message);
  const summary =
    p.result?.summary || message.content || t("result.completedFallback");
  const artifacts = p.result?.artifacts;
  const criteriaMet = p.result?.criteria_met;
  const hasDetails =
    (summary && summary.includes("\n")) ||
    (artifacts && artifacts.length > 0) ||
    Boolean(criteriaMet && Object.keys(criteriaMet).length > 0);

  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-card">
      <ResultHeader
        tone="success"
        label={t("completed")}
        preview={firstLine(summary)}
        durationSeconds={p.duration_seconds}
        hasDetails={Boolean(hasDetails)}
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
      />

      {expanded && (
        <div className="space-y-3 border-t border-border px-3 py-2.5">
          <MarkdownContent content={summary} />

          {criteriaMet && Object.keys(criteriaMet).length > 0 && (
            <div className="space-y-1">
              <SectionLabel>{t("criteria")}</SectionLabel>
              {Object.entries(criteriaMet).map(([key, met]) => (
                <div key={key} className="flex items-center gap-2 text-xs">
                  <StatusGlyph tone={met ? "success" : "failure"} />
                  <span className="text-foreground">{key}</span>
                </div>
              ))}
            </div>
          )}

          {artifacts && artifacts.length > 0 && (
            <div className="space-y-1">
              <SectionLabel>{t("artifacts")}</SectionLabel>
              {artifacts.map((a, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 truncate font-mono text-xs">
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
  const { t } = useTranslation("tasks");
  const p = getMessagePayload<TaskFailPayload>(message);
  const errorMessage =
    p.error?.message || message.content || t("result.failedFallback");
  const partial = p.partial_result?.summary;
  const hasDetails = Boolean(partial) || Boolean(p.error?.code);

  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-card">
      <ResultHeader
        tone="failure"
        label={t("failed")}
        preview={firstLine(errorMessage)}
        durationSeconds={p.duration_seconds}
        hasDetails={hasDetails}
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
      />

      {expanded && (
        <div className="space-y-3 border-t border-border px-3 py-2.5">
          {p.error?.code && (
            <p className="font-mono text-xs text-muted-foreground">
              {p.error.code}
            </p>
          )}
          <MarkdownContent content={errorMessage} />
          {partial && (
            <div className="space-y-1">
              <SectionLabel>{t("result.partialResult")}</SectionLabel>
              <MarkdownContent content={partial} />
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
