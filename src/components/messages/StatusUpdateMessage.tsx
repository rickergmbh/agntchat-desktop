import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  Copy,
  Check as CheckIcon,
  Eye,
  Forward,
  Zap,
  MessageSquarePlus,
} from "lucide-react";
import { cn, formatClockTime } from "../../lib/utils";
import i18n from "../../i18n";
import type { Message } from "../../lib/api";
import { useTaskStore } from "../../stores/taskStore";
import { useNavStore } from "../../stores/navStore";
import { useChatStore } from "../../stores/chatStore";
import { useAgentStore } from "../../stores/agentStore";
import { MarkdownContent } from "./MarkdownContent";
import { StopTaskButton } from "./StopTaskButton";
import { StatusGlyph, StatusLine, type TaskTone } from "./TaskMessages";

/**
 * Renders task-lifecycle status messages that the backend emits as
 * `StatusUpdate` / `status_update` with the real data in JSON inside
 * `message.content`. Without this renderer those land as raw JSON text.
 *
 * Visual language follows the "quiet card" rules documented in
 * TaskMessages.tsx: one neutral surface for every state, status color
 * confined to the small glyph, fixed anatomy, sentence case, one motion
 * source.
 *
 * Payloads in the wild use different field names for the assignee depending
 * on the lifecycle event — `agent_name` / `agent_avatar_url` for working /
 * complete states; `assignee_name` / `assignee_avatar_url` for delegated
 * states. This component normalizes both.
 */

interface StatusPayload {
  task_id?: string;
  status?: string;
  /** Some payloads use `type` as the lifecycle tag instead of `lifecycle_type` */
  type?: string;
  lifecycle_type?: string;
  summary?: string;
  error?: string;
  title?: string;
  duration_seconds?: number;
  agent_name?: string;
  agent_avatar_url?: string;
  assignee_name?: string;
  assignee_avatar_url?: string;
  /** Present on lifecycle payloads when the task spawned a work
   *  sub-conversation (DM tasks). The "Open work room" affordance links to it. */
  work_conversation_id?: string;
  /** Present on `task_request_failed` payloads — the agent's create_task
   *  call was rejected by the backend. No `task_id` exists. */
  error_kind?: string;
  attempted_title?: string;
  attempted_assignees?: string[];
  attempted_conversation_id?: string;
  /** Present on `task_capability_warning` payloads — task was created
   *  but capability handshake flagged something. */
  kind?: string;
  required_tools?: string[];
  unresolved_mismatches?: Array<{ agent_id: string; missing: string[] }>;
  reroutes?: Array<{
    original_agent_id: string;
    replacement_agent_id: string;
    replacement_display_name?: string;
    missing_tools: string[];
  }>;
  /** Present on `thread_completed` payloads — the side conversation that
   *  was just resolved (or auto-abandoned). Distinct from task lifecycle
   *  cards; carries thread_id + topic + goal + outcome instead of task_id. */
  thread_id?: string;
  topic?: string;
  goal?: string;
  outcome?: string;
  resolved_at?: string;
}

const LIFECYCLE_TYPES = new Set<string>([
  "task_delegated",
  "task_self_assigned",
  "task_accepted",
  "task_in_progress",
  "task_complete",
  "task_complete_summary",
  "task_failed",
  "task_cancelled",
]);

// Map bare status words the server sometimes uses as lifecycle_type.
const BARE_STATUS_TO_LIFECYCLE: Record<string, string> = {
  pending: "task_delegated",
  in_progress: "task_in_progress",
  accepted: "task_accepted",
  complete: "task_complete",
  failed: "task_failed",
  declined: "task_failed",
  blocked: "task_in_progress",
  cancelled: "task_cancelled",
};

// Re-route based on a live effective status (from taskStore) so a Working
// card flips to Completion without waiting for a new StatusUpdate message.
function resolveEffectiveType(
  effectiveStatus: string | undefined,
  fallback: string
): string {
  if (!effectiveStatus) return fallback;
  switch (effectiveStatus) {
    case "in_progress":
    case "accepted":
    case "blocked":
      return "task_in_progress";
    case "complete":
      return "task_complete";
    case "failed":
    case "declined":
      return "task_failed";
    // "failed" is a first-class task status (handled by the case above when
    // hydrated). When effectiveStatus is a raw "cancelled", still honor an
    // explicit task_failed card so the failure renders as FailureCard, not
    // the user-cancellation CancelledCard.
    case "cancelled":
      return fallback === "task_failed" ? "task_failed" : "task_cancelled";
    default:
      return fallback;
  }
}

function safeParseJson<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function resolveAgentName(payload: StatusPayload, message: Message): string {
  return (
    payload.agent_name ??
    payload.assignee_name ??
    message.sender?.displayName ??
    i18n.t("agents:fallbackName")
  );
}

/** Shared neutral container for every status card (quiet-card rule 1). */
function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="my-2 w-full">
      <div
        className={cn(
          "overflow-hidden rounded-lg border border-border bg-card",
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** Hairline footer strip inside a card body (task id, work-room link). */
function CardFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
      {children}
    </div>
  );
}

function CopyableTaskId({ taskId }: { taskId: string }) {
  const { t } = useTranslation("tasks");
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard?.writeText(taskId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={handleCopy}
      type="button"
      className="flex items-center gap-1.5 text-left"
      title={t("card.copyTaskId")}
    >
      <span className="font-mono text-xs text-muted-foreground">
        {taskId.slice(0, 8)}…
      </span>
      {copied ? (
        <CheckIcon className="h-3 w-3 text-success" />
      ) : (
        <Copy className="h-3 w-3 text-muted-foreground" />
      )}
    </button>
  );
}

function LiveProgressTimeline({ steps }: { steps: string[] }) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    startRef.current = Date.now();
    setElapsed(0);
  }, [steps.length]);

  useEffect(() => {
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)),
      1000
    );
    return () => clearInterval(id);
  }, [steps.length]);

  if (steps.length === 0) return null;

  const pastSteps = steps.slice(0, -1).slice(-4);
  const currentStep = steps[steps.length - 1];

  return (
    <div className="mt-2 space-y-1 border-t border-border pt-2">
      {pastSteps.map((step, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="h-1 w-1 shrink-0 rounded-full bg-border-strong" />
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {step}
          </span>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <span className="h-1 w-1 shrink-0 rounded-full bg-primary" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {currentStep}
        </span>
        {elapsed > 0 && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatDuration(elapsed)}
          </span>
        )}
      </div>
    </div>
  );
}

function WorkingCard({
  payload,
  message,
  recentSteps,
}: {
  payload: StatusPayload;
  message: Message;
  recentSteps: string[];
}) {
  const { t } = useTranslation("tasks");
  const agentName = resolveAgentName(payload, message);
  const title = payload.title || t("untitled");

  return (
    <Card>
      <div className="px-3 py-2.5">
        <StatusLine
          tone="working"
          label={t("status.in_progress")}
          context={agentName}
          end={
            payload.task_id ? (
              <StopTaskButton
                taskId={payload.task_id}
                title={title}
                className="h-6 w-6"
              />
            ) : undefined
          }
        />
        <p className="mt-1.5 text-sm font-medium leading-snug text-foreground">
          {title}
        </p>
        <LiveProgressTimeline steps={recentSteps} />
        {payload.task_id && (
          <CardFooter>
            <CopyableTaskId taskId={payload.task_id} />
          </CardFooter>
        )}
      </div>
    </Card>
  );
}

/** Collapsed/expanded result card shared by completion + failure states. */
function ResultStatusCard({
  tone,
  label,
  payload,
  message,
  body,
}: {
  tone: TaskTone;
  label: string;
  payload: StatusPayload;
  message: Message;
  /** Rendered under the title when expanded. */
  body?: React.ReactNode;
}) {
  const { t } = useTranslation("tasks");
  const [expanded, setExpanded] = useState(false);
  const setView = useNavStore((s) => s.setView);
  const selectTask = useTaskStore((s) => s.selectTask);
  const fetchTask = useTaskStore((s) => s.fetchTask);
  const agentName = resolveAgentName(payload, message);
  const title = payload.title || t("untitled");

  const header = (
    <button
      type="button"
      onClick={() => setExpanded(!expanded)}
      className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-hover"
    >
      <StatusGlyph tone={tone} />
      <span className="shrink-0 text-xs font-medium text-foreground">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {expanded ? agentName : `${title} · ${agentName}`}
      </span>
      {payload.duration_seconds != null && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatDuration(payload.duration_seconds)}
        </span>
      )}
      {expanded ? (
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
    </button>
  );

  if (!expanded) return <Card>{header}</Card>;

  return (
    <Card>
      {header}
      <div className="border-t border-border px-3 py-2.5">
        <p className="text-sm font-medium leading-snug text-foreground">
          {title}
        </p>
        {body}
        {payload.task_id && (
          <CardFooter>
            <CopyableTaskId taskId={payload.task_id} />
            <button
              type="button"
              onClick={() => {
                const id = payload.task_id!;
                selectTask(id);
                setView("tasks");
                void fetchTask(id);
              }}
              className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {t("card.viewFullDetails")}
              <ChevronRight className="h-3 w-3" />
            </button>
          </CardFooter>
        )}
      </div>
    </Card>
  );
}

function CompletionCard({
  payload,
  message,
}: {
  payload: StatusPayload;
  message: Message;
}) {
  const { t } = useTranslation("tasks");
  return (
    <ResultStatusCard
      tone="success"
      label={t("lifecycle.task_complete")}
      payload={payload}
      message={message}
      body={
        payload.summary ? (
          <div className="mt-2">
            <MarkdownContent content={payload.summary} />
          </div>
        ) : undefined
      }
    />
  );
}

function FailureCard({
  payload,
  message,
}: {
  payload: StatusPayload;
  message: Message;
}) {
  const { t } = useTranslation("tasks");
  const error = payload.error || payload.summary;
  return (
    <ResultStatusCard
      tone="failure"
      label={t("lifecycle.task_failed")}
      payload={payload}
      message={message}
      body={
        error ? (
          <p className="mt-2 text-xs leading-relaxed text-foreground">
            {error}
          </p>
        ) : undefined
      }
    />
  );
}

/** Shown when a task was created successfully but the capability
 *  handshake flagged something. */
function CapabilityWarningCard({
  payload,
  message,
}: {
  payload: StatusPayload;
  message: Message;
}) {
  const { t } = useTranslation("tasks");
  const agentName = resolveAgentName(payload, message);
  const headline =
    payload.kind === "snapshot_error"
      ? t("capability.snapshotError")
      : payload.kind === "missing_required_tools"
      ? t("capability.missingTools")
      : payload.kind === "rerouted"
      ? t("capability.rerouted")
      : t("capability.warning");

  const detail =
    payload.kind === "snapshot_error"
      ? payload.error
      : payload.kind === "missing_required_tools"
      ? payload.unresolved_mismatches
          ?.map((m) =>
            t("capability.missingDetail", {
              agent: `${m.agent_id.slice(0, 8)}…`,
              tools: m.missing.join(", "),
            })
          )
          .join("; ")
      : payload.kind === "rerouted"
      ? payload.reroutes
          ?.map((r) => `→ ${r.replacement_display_name ?? r.replacement_agent_id.slice(0, 8) + "…"}`)
          .join("; ")
      : undefined;

  return (
    <Card>
      <div className="px-3 py-2.5">
        <StatusLine
          tone="warning"
          label={headline}
          context={
            payload.title ? `${agentName} · ${payload.title}` : agentName
          }
        />
        {detail && (
          <p className="mt-1.5 text-xs leading-relaxed text-foreground">
            {detail}
          </p>
        )}
        {payload.required_tools && payload.required_tools.length > 0 && (
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {t("capability.required", {
              tools: payload.required_tools.join(", "),
            })}
          </p>
        )}
      </div>
    </Card>
  );
}

/** Server-side error_kind → user-facing label + next-step hint (as tasks:
 *  namespace keys, resolved with t() at render time). Source of truth for
 *  the kinds is `Agentchat.Tasks.FailureArtifact.classify/1`.
 *  Keep in parity with mobile/web's `humanizeRequestFailure` (same
 *  content, duplicated because the three clients don't share a package). */
function humanizeRequestFailure(kind?: string): { labelKey: string; hintKey?: string } {
  switch (kind) {
    case "misrouted_task":
      return { labelKey: "requestFailed.misrouted.label", hintKey: "requestFailed.misrouted.hint" };
    case "invalid_assignees_not_uuid":
      return { labelKey: "requestFailed.badAssignee.label", hintKey: "requestFailed.badAssignee.hint" };
    case "invalid_assignees_not_found":
      return { labelKey: "requestFailed.unknownAssignee.label", hintKey: "requestFailed.unknownAssignee.hint" };
    case "invalid_assignees_not_a_list":
      return { labelKey: "requestFailed.malformed.label", hintKey: "requestFailed.malformed.hint" };
    case "unauthorized":
      return { labelKey: "requestFailed.unauthorized.label", hintKey: "requestFailed.unauthorized.hint" };
    default:
      return { labelKey: "requestFailed.generic.label" };
  }
}

/** Shown when an agent's `create_task` MCP call was rejected (misroute /
 *  bad assignee / unauthorized). No `task_id` exists since the task was
 *  never persisted — without this card the only signal is the LLM's
 *  narration, which often glosses over the failure. */
function RequestFailedCard({
  payload,
  message,
}: {
  payload: StatusPayload;
  message: Message;
}) {
  const { t } = useTranslation("tasks");
  const agentName = resolveAgentName(payload, message);
  const error = payload.error;
  const { labelKey, hintKey } = humanizeRequestFailure(payload.error_kind);
  const hint = hintKey ? t(hintKey) : undefined;
  const agents = useAgentStore((s) => s.agents);
  const resolvedAssignees =
    payload.attempted_assignees && payload.attempted_assignees.length > 0
      ? payload.attempted_assignees.map(
          (id) => agents[id]?.agent.displayName || `${id.slice(0, 8)}…`
        )
      : null;

  return (
    <Card>
      <div className="px-3 py-2.5">
        <StatusLine
          glyph={
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
          }
          label={t(labelKey)}
          context={t("requestFailed.couldntCreate", { name: agentName })}
        />
        {payload.attempted_title && (
          <p className="mt-1.5 line-clamp-2 text-sm font-medium leading-snug text-foreground">
            "{payload.attempted_title}"
          </p>
        )}
        {hint && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {hint}
          </p>
        )}
        {error && !hint && (
          <p className="mt-1 text-xs leading-relaxed text-foreground">
            {error}
          </p>
        )}
        {resolvedAssignees && (
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {t("requestFailed.triedToAssign", {
              names: resolvedAssignees.join(", "),
            })}
          </p>
        )}
      </div>
    </Card>
  );
}

function CancelledCard({
  payload,
  message,
}: {
  payload: StatusPayload;
  message: Message;
}) {
  const { t } = useTranslation("tasks");
  const agentName = resolveAgentName(payload, message);
  const title = payload.title || t("untitled");
  return (
    <Card>
      <div className="flex items-center gap-2 px-3 py-2">
        <StatusGlyph tone="neutral" />
        <span className="shrink-0 text-xs font-medium text-foreground">
          {t("lifecycle.task_cancelled")}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {title} · {agentName}
        </span>
      </div>
    </Card>
  );
}

function LifecycleCard({
  payload,
  message,
  lifecycle,
}: {
  payload: StatusPayload;
  message: Message;
  lifecycle: string;
}) {
  const { t } = useTranslation("tasks");
  const agentName = resolveAgentName(payload, message);
  const title = payload.title || t("untitled");

  const config: Record<
    string,
    {
      label: string;
      meta: string;
      Icon: typeof Forward;
    }
  > = {
    task_delegated: {
      label: t("card.taskAssigned"),
      meta: t("card.assignedTo", { name: agentName }),
      Icon: Forward,
    },
    task_self_assigned: {
      label: t("card.workingOnIt"),
      meta: t("card.isOnIt", { name: agentName }),
      Icon: Zap,
    },
    task_accepted: {
      label: t("card.taskAccepted"),
      meta: t("card.pickedUpBy", { name: agentName }),
      Icon: Eye,
    },
  };

  const c = config[lifecycle] ?? {
    // Known lifecycle types resolve via tasks:lifecycle.*; anything else is a
    // raw server value we can only de-snake.
    label: LIFECYCLE_TYPES.has(lifecycle)
      ? t(`lifecycle.${lifecycle}`)
      : lifecycle.replace(/_/g, " "),
    meta: agentName,
    Icon: ArrowRightLeft,
  };

  const Icon = c.Icon;

  // Assigned / accepted / self-assigned cards represent a task that is in
  // flight (or about to be) — offer the stop control on all of them.
  const stoppable =
    lifecycle === "task_delegated" ||
    lifecycle === "task_self_assigned" ||
    lifecycle === "task_accepted" ||
    lifecycle === "task_in_progress";

  return (
    <Card>
      <div className="px-3 py-2.5">
        <StatusLine
          glyph={<Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          label={c.label}
          context={c.meta}
          end={
            stoppable && payload.task_id ? (
              <StopTaskButton
                taskId={payload.task_id}
                title={title}
                className="h-6 w-6"
              />
            ) : undefined
          }
        />
        <p className="mt-1.5 text-sm font-medium leading-snug text-foreground">
          {title}
        </p>
        {(payload.task_id || payload.work_conversation_id) && (
          <CardFooter>
            {payload.task_id ? (
              <CopyableTaskId taskId={payload.task_id} />
            ) : (
              <span />
            )}
            {payload.work_conversation_id && (
              <WorkRoomLink workConversationId={payload.work_conversation_id} />
            )}
          </CardFooter>
        )}
      </div>
    </Card>
  );
}

/** Inline footer link that switches the active conversation to the
 *  task's work sub-conversation. Conversation channel auto-adds the
 *  human as a read-only observer on join — without this affordance the
 *  work conv is only discoverable via the SubConversationList accordion
 *  or the busy-redirect alert. */
function WorkRoomLink({ workConversationId }: { workConversationId: string }) {
  const { t } = useTranslation("tasks");
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const setView = useNavStore((s) => s.setView);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setActiveConversation(workConversationId);
        setView("chat");
      }}
      className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
    >
      <MessageSquarePlus className="h-3 w-3" />
      {t("card.openWorkRoom")}
      <ChevronRight className="h-3 w-3" />
    </button>
  );
}

export function StatusUpdateMessage({ message }: { message: Message }) {
  const { t } = useTranslation("tasks");
  const payload = safeParseJson<StatusPayload>(message.content, {
    summary: message.content,
  });
  // Watchdog redrive nudges (parked-thread / commitment re-checks) are
  // agent-directed prompts, not user-facing content — skip them entirely,
  // same as thread_completed below.
  if (message.metadata?.parked_recheck || message.metadata?.commitment_recheck) {
    return null;
  }
  // No lifecycle info at all (e.g. plain-text content) must NOT default to
  // task_in_progress — that renders a fake spinning "Task in progress" card
  // with no task behind it. Fall through to the compact status row instead.
  const rawLifecycle =
    payload.lifecycle_type ?? payload.type ?? payload.status ?? "status_update";
  const lifecycle = BARE_STATUS_TO_LIFECYCLE[rawLifecycle] ?? rawLifecycle;

  const liveMeta = useTaskStore((s) =>
    payload.task_id ? s.taskLifecycleMeta[payload.task_id] : undefined
  );
  const taskProgress = useTaskStore((s) =>
    payload.task_id ? s.taskProgress[payload.task_id] : undefined
  );
  const effectiveStatus = liveMeta?.effectiveStatus;
  const effectiveType = resolveEffectiveType(effectiveStatus, lifecycle);

  const enriched: StatusPayload = { ...payload };
  if (liveMeta?.summary) enriched.summary = liveMeta.summary;
  if (liveMeta?.error) enriched.error = liveMeta.error;
  if (liveMeta?.agentName) enriched.agent_name = liveMeta.agentName;
  if (liveMeta?.agentAvatarUrl) enriched.agent_avatar_url = liveMeta.agentAvatarUrl;

  // thread_completed: a side agent thread was resolved (or auto-abandoned
  // by the idle sweeper). Not rendered as its own card — the inline thread
  // pill (AgentConversationCard) flips to its resolved state instead
  // (chatStore patches thread_status when this message arrives). The
  // message itself stays in the timeline data because agents consume it
  // as the resolution artifact in recent_messages.
  if (payload.type === "thread_completed") {
    return null;
  }

  // task_request_failed: backend rejected the agent's create_task call.
  // No task_id exists — render a failure card so the user doesn't have
  // to trust the LLM's narration of what happened.
  if (payload.type === "task_request_failed") {
    return <RequestFailedCard payload={payload} message={message} />;
  }

  // task_capability_warning: task created, but handshake flagged
  // missing required tools / snapshot crash / auto-reroute.
  if (payload.type === "task_capability_warning") {
    return <CapabilityWarningCard payload={payload} message={message} />;
  }

  const isLifecycle =
    LIFECYCLE_TYPES.has(lifecycle) || LIFECYCLE_TYPES.has(effectiveType);
  if (isLifecycle && payload.task_id) {
    const stillWorking =
      !effectiveStatus ||
      effectiveStatus === "in_progress" ||
      effectiveStatus === "accepted";
    if (effectiveType === "task_in_progress" && stillWorking) {
      return (
        <WorkingCard
          payload={enriched}
          message={message}
          recentSteps={taskProgress?.recentSteps ?? []}
        />
      );
    }
    if (
      effectiveType === "task_complete" ||
      effectiveType === "task_complete_summary"
    ) {
      return <CompletionCard payload={enriched} message={message} />;
    }
    if (effectiveType === "task_failed") {
      return <FailureCard payload={enriched} message={message} />;
    }
    if (effectiveType === "task_cancelled") {
      return <CancelledCard payload={enriched} message={message} />;
    }
    return (
      <LifecycleCard payload={enriched} message={message} lifecycle={effectiveType} />
    );
  }

  // Fallback: unknown lifecycle with no task_id — render a compact status row.
  const tone: TaskTone =
    lifecycle === "task_complete"
      ? "success"
      : lifecycle === "task_failed"
      ? "failure"
      : lifecycle === "task_cancelled"
      ? "neutral"
      : lifecycle === "task_in_progress"
      ? "working"
      : "pending";

  return (
    <div className="my-2 rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-2">
        <StatusGlyph tone={tone} />
        <span className="shrink-0 text-xs font-medium text-foreground">
          {LIFECYCLE_TYPES.has(lifecycle)
            ? t(`lifecycle.${lifecycle}`)
            : lifecycle.replace(/_/g, " ")}
        </span>
        {message.sender?.displayName && (
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {message.sender.displayName}
          </span>
        )}
        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatClockTime(message.insertedAt)}
        </span>
      </div>
      {payload.summary && (
        <p className="mt-1 text-xs text-muted-foreground">{payload.summary}</p>
      )}
    </div>
  );
}

const STATUS_TYPES = new Set(["StatusUpdate", "status_update"]);

export function isStatusUpdateMessage(message: Message): boolean {
  const type = message.messageType || message.contentType || "";
  return STATUS_TYPES.has(type);
}
