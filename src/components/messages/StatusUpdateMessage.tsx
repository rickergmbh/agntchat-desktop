import { useEffect, useRef, useState } from "react";
import {
  ArrowRightLeft,
  Ban,
  Bot,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Check as CheckIcon,
  Eye,
  Forward,
  Loader2,
  PlayCircle,
  XCircle,
  Zap,
  AlertTriangle,
  MessageSquarePlus,
} from "lucide-react";
import { cn, formatClockTime } from "../../lib/utils";
import type { Message } from "../../lib/api";
import { useTaskStore } from "../../stores/taskStore";
import { useNavStore } from "../../stores/navStore";
import { useChatStore } from "../../stores/chatStore";
import { useAgentStore } from "../../stores/agentStore";
import { MarkdownContent } from "./MarkdownContent";
import { StopTaskButton } from "./StopTaskButton";

/**
 * Renders task-lifecycle status messages that the backend emits as
 * `StatusUpdate` / `status_update` with the real data in JSON inside
 * `message.content`. Without this renderer those land as raw JSON text.
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
    // The Task schema has no separate "failed" state — fail_task_atomic
    // maps a failure (timeout, crash) onto "cancelled". When effectiveStatus
    // is the raw API task status ("cancelled"), honor an explicit task_failed
    // card so the failure renders as FailureCard, not the user-cancellation
    // CancelledCard. (When the task_failed card is in the loaded window,
    // effectiveStatus is hydrated to "failed" and the case above handles it.)
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
    "Agent"
  );
}

function resolveAvatarUrl(
  payload: StatusPayload,
  message: Message
): string | undefined {
  return (
    payload.agent_avatar_url ?? payload.assignee_avatar_url ?? message.sender?.avatarUrl
  );
}

function AgentAvatar({
  name,
  avatarUrl,
  size = 32,
}: {
  name: string;
  avatarUrl?: string;
  size?: number;
}) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex items-center justify-center rounded-full bg-primary/20 text-[10px] font-semibold text-primary"
      style={{ width: size, height: size }}
    >
      {initials}
    </div>
  );
}

function CopyableTaskId({ taskId }: { taskId: string }) {
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
      className="mt-2 flex items-center gap-1.5 border-t border-border pt-2 text-left"
      title="Copy task ID"
    >
      <span className="text-[10px] text-muted-foreground/60">ID</span>
      <span className="font-mono text-[10px] text-muted-foreground/60">
        {taskId.slice(0, 8)}...
      </span>
      {copied ? (
        <CheckIcon className="h-2.5 w-2.5 text-success" />
      ) : (
        <Copy className="h-2.5 w-2.5 text-muted-foreground/40" />
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
    <div className="mt-3 space-y-1.5 border-t border-border pt-3">
      {pastSteps.map((step, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/30" />
          <span className="text-[11px] text-muted-foreground/50">{step}</span>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary" />
        <span className="text-[11px] font-medium text-foreground">{currentStep}</span>
        {elapsed > 0 && (
          <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/50">
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
  const agentName = resolveAgentName(payload, message);
  const avatarUrl = resolveAvatarUrl(payload, message);
  const title = payload.title || "Untitled task";

  return (
    <div className="my-2 w-full">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="p-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <AgentAvatar name={agentName} avatarUrl={avatarUrl} size={36} />
              <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 animate-pulse rounded-full border-2 border-card bg-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{agentName}</p>
              <p className="text-xs text-muted-foreground">is working on this</p>
            </div>
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            {payload.task_id && (
              <StopTaskButton taskId={payload.task_id} title={title} />
            )}
          </div>

          <p className="mt-3 text-sm font-semibold leading-snug text-foreground">
            {title}
          </p>

          <LiveProgressTimeline steps={recentSteps} />

          {payload.task_id && <CopyableTaskId taskId={payload.task_id} />}
        </div>
      </div>
    </div>
  );
}

function CompletionCard({
  payload,
  message,
}: {
  payload: StatusPayload;
  message: Message;
}) {
  const [expanded, setExpanded] = useState(false);
  const setView = useNavStore((s) => s.setView);
  const selectTask = useTaskStore((s) => s.selectTask);
  const fetchTask = useTaskStore((s) => s.fetchTask);
  const agentName = resolveAgentName(payload, message);
  const avatarUrl = resolveAvatarUrl(payload, message);
  const title = payload.title || "Untitled task";
  const summary = payload.summary;

  if (!expanded) {
    return (
      <div className="my-2 w-full">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center gap-3 rounded-xl bg-success px-4 py-2.5 text-left transition-colors hover:bg-success/90"
        >
          <CheckCircle className="h-[18px] w-[18px] shrink-0 text-white" />
          <div className="min-w-0 flex-1">
            <span className="text-xs font-semibold text-white">Task Complete</span>
            <p className="mt-0.5 truncate text-xs text-white/75">
              {title} · {agentName}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-white/50" />
        </button>
      </div>
    );
  }

  return (
    <div className="my-2 w-full">
      <div className="overflow-hidden rounded-xl border border-border bg-success/5">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="flex w-full items-center gap-3 p-4 pb-0 text-left"
        >
          <AgentAvatar name={agentName} avatarUrl={avatarUrl} size={36} />
          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-success dark:text-success">
              Task Complete
            </span>
            <p className="text-xs text-muted-foreground">{agentName}</p>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground/50" />
        </button>
        <div className="px-4 pb-4">
          <p className="mt-3 text-sm font-semibold leading-snug text-foreground">
            {title}
          </p>
          {summary && (
            <div className="mt-3 border-t border-success/10 pt-3">
              <MarkdownContent content={summary} />
            </div>
          )}
          {payload.duration_seconds != null && (
            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
              <Clock className="h-3 w-3" />
              <span>Completed in {formatDuration(payload.duration_seconds)}</span>
            </div>
          )}
          {payload.task_id && <CopyableTaskId taskId={payload.task_id} />}

          {payload.task_id && (
            <button
              type="button"
              onClick={() => {
                const id = payload.task_id!;
                selectTask(id);
                setView("tasks");
                void fetchTask(id);
              }}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-background/50 py-2 text-xs font-medium text-primary transition-colors hover:bg-accent"
            >
              View Full Details
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function FailureCard({
  payload,
  message,
}: {
  payload: StatusPayload;
  message: Message;
}) {
  const [expanded, setExpanded] = useState(false);
  const agentName = resolveAgentName(payload, message);
  const avatarUrl = resolveAvatarUrl(payload, message);
  const title = payload.title || "Untitled task";
  const error = payload.error || payload.summary;

  if (!expanded) {
    return (
      <div className="my-2 w-full">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center gap-3 rounded-xl border border-destructive/20 border-l-4 border-l-destructive bg-destructive/5 px-4 py-2.5 text-left transition-colors hover:bg-destructive/10"
        >
          <XCircle className="h-[18px] w-[18px] shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <span className="text-xs font-semibold text-destructive dark:text-destructive">
              Task Failed
            </span>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {title} · {agentName}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
        </button>
      </div>
    );
  }

  return (
    <div className="my-2 w-full">
      <div className="overflow-hidden rounded-xl border border-destructive/20 border-l-4 border-l-destructive bg-destructive/5">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="flex w-full items-center gap-3 p-4 pb-0 text-left"
        >
          <AgentAvatar name={agentName} avatarUrl={avatarUrl} size={36} />
          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-destructive dark:text-destructive">
              Task Failed
            </span>
            <p className="text-xs text-muted-foreground">{agentName}</p>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground/50" />
        </button>
        <div className="px-4 pb-4">
          <p className="mt-3 text-sm font-semibold leading-snug text-foreground">
            {title}
          </p>
          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/10 bg-destructive/5 p-3">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              <p className="text-xs leading-relaxed text-destructive dark:text-destructive">
                {error}
              </p>
            </div>
          )}
          {payload.task_id && <CopyableTaskId taskId={payload.task_id} />}
        </div>
      </div>
    </div>
  );
}

/** Slim amber banner shown when a task was created successfully but the
 *  capability handshake flagged something. */
function CapabilityWarningCard({
  payload,
  message,
}: {
  payload: StatusPayload;
  message: Message;
}) {
  const agentName = resolveAgentName(payload, message);
  const avatarUrl = resolveAvatarUrl(payload, message);
  const headline =
    payload.kind === "snapshot_error"
      ? "Capability check failed"
      : payload.kind === "missing_required_tools"
      ? "Assignee missing required tools"
      : payload.kind === "rerouted"
      ? "Auto-rerouted to capable agent"
      : "Task capability warning";

  const detail =
    payload.kind === "snapshot_error"
      ? payload.error
      : payload.kind === "missing_required_tools"
      ? payload.unresolved_mismatches
          ?.map((m) => `${m.agent_id.slice(0, 8)}… missing ${m.missing.join(", ")}`)
          .join("; ")
      : payload.kind === "rerouted"
      ? payload.reroutes
          ?.map((r) => `→ ${r.replacement_display_name ?? r.replacement_agent_id.slice(0, 8) + "…"}`)
          .join("; ")
      : undefined;

  return (
    <div className="my-2 w-full">
      <div className="flex w-full items-start gap-3 rounded-xl border border-warning/40 border-l-4 border-l-warning bg-warning/5 px-4 py-2.5">
        <AgentAvatar name={agentName} avatarUrl={avatarUrl} size={20} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
            <span className="text-xs font-semibold text-warning">{headline}</span>
          </div>
          {payload.title && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {agentName} &middot; {payload.title}
            </p>
          )}
          {detail && (
            <p className="mt-1 text-xs leading-relaxed text-foreground">{detail}</p>
          )}
          {payload.required_tools && payload.required_tools.length > 0 && (
            <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground/80">
              required: {payload.required_tools.join(", ")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Slim banner shown when an agent's `create_task` MCP call was rejected
 *  (misroute / bad assignee / unauthorized). No `task_id` exists since the
 *  task was never persisted — without this card the only signal is the
 *  LLM's narration, which often glosses over the failure. */
/** Server-side error_kind → user-facing label + next-step hint. Source
 *  of truth for the kinds is `Agentchat.Tasks.FailureArtifact.classify/1`.
 *  Keep in parity with mobile/web's `humanizeRequestFailure` (same
 *  content, duplicated because the three clients don't share a package). */
function humanizeRequestFailure(kind?: string): { label: string; hint?: string } {
  switch (kind) {
    case "misrouted_task":
      return {
        label: "Wrong conversation",
        hint: "The agent tried to put this task somewhere it can't reach. It usually self-corrects on retry — or ask again.",
      };
    case "invalid_assignees_not_uuid":
      return {
        label: "Bad assignee",
        hint: "The agent referenced an ID that isn't a real agent. Mention the assignee by name and ask again.",
      };
    case "invalid_assignees_not_found":
      return {
        label: "Unknown assignee",
        hint: "The target agent has been removed or renamed.",
      };
    case "invalid_assignees_not_a_list":
      return {
        label: "Malformed request",
        hint: "The agent sent an invalid payload. Safe to retry.",
      };
    case "unauthorized":
      return {
        label: "Permission denied",
        hint: "The agent doesn't have access to that conversation.",
      };
    default:
      return { label: "Task creation failed" };
  }
}

function RequestFailedCard({
  payload,
  message,
}: {
  payload: StatusPayload;
  message: Message;
}) {
  const agentName = resolveAgentName(payload, message);
  const avatarUrl = resolveAvatarUrl(payload, message);
  const error = payload.error;
  const { label, hint } = humanizeRequestFailure(payload.error_kind);
  const agents = useAgentStore((s) => s.agents);
  const resolvedAssignees =
    payload.attempted_assignees && payload.attempted_assignees.length > 0
      ? payload.attempted_assignees.map(
          (id) => agents[id]?.agent.displayName || `${id.slice(0, 8)}…`
        )
      : null;

  return (
    <div className="my-2 w-full">
      <div className="flex w-full items-start gap-3 rounded-xl border border-destructive/20 border-l-4 border-l-destructive bg-destructive/5 px-4 py-2.5">
        <AgentAvatar name={agentName} avatarUrl={avatarUrl} size={20} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
            <span className="text-xs font-semibold text-destructive">
              {label}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {agentName} couldn't create this task
          </p>
          {payload.attempted_title && (
            <p className="line-clamp-2 text-xs font-medium text-foreground">
              "{payload.attempted_title}"
            </p>
          )}
          {hint && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p>
          )}
          {error && !hint && (
            <p className="mt-1 text-xs leading-relaxed text-foreground">{error}</p>
          )}
          {resolvedAssignees && (
            <p className="mt-1 truncate text-xs text-muted-foreground/80">
              Tried to assign: {resolvedAssignees.join(", ")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function CancelledCard({
  payload,
  message,
}: {
  payload: StatusPayload;
  message: Message;
}) {
  const agentName = resolveAgentName(payload, message);
  const title = payload.title || "Untitled task";
  return (
    <div className="my-2 w-full">
      <div className="flex w-full items-center gap-3 rounded-xl border border-muted-foreground/20 border-l-4 border-l-muted-foreground bg-muted/50 px-4 py-2.5">
        <Ban className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <span className="text-xs font-semibold text-muted-foreground">
            Task Cancelled
          </span>
          <p className="mt-0.5 truncate text-xs text-muted-foreground/70">
            {title} · {agentName}
          </p>
        </div>
      </div>
    </div>
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
  const agentName = resolveAgentName(payload, message);
  const avatarUrl = resolveAvatarUrl(payload, message);
  const title = payload.title || "Untitled task";

  const config: Record<
    string,
    {
      label: string;
      meta: string;
      Icon: typeof CheckCircle;
      borderColor: string;
      iconColor: string;
    }
  > = {
    task_delegated: {
      label: "Task Assigned",
      meta: `Assigned to ${agentName}`,
      Icon: Forward,
      borderColor: "border-l-primary",
      iconColor: "text-primary",
    },
    task_self_assigned: {
      label: "Working on It",
      meta: `${agentName} is on it`,
      Icon: Zap,
      borderColor: "border-l-warning",
      iconColor: "text-warning",
    },
    task_accepted: {
      label: "Task Accepted",
      meta: `Picked up by ${agentName}`,
      Icon: Eye,
      borderColor: "border-l-primary",
      iconColor: "text-primary",
    },
  };

  const c = config[lifecycle] ?? {
    label: lifecycle.replace(/_/g, " "),
    meta: agentName,
    Icon: ArrowRightLeft,
    borderColor: "border-l-muted-foreground",
    iconColor: "text-muted-foreground",
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
    <div className="my-2 w-full">
      <div
        className={cn(
          "overflow-hidden rounded-xl border border-border border-l-4 bg-card p-4",
          c.borderColor
        )}
      >
        <div className="flex items-center gap-3">
          <AgentAvatar name={agentName} avatarUrl={avatarUrl} size={32} />
          <div className="min-w-0 flex-1">
            <span
              className={cn(
                "text-[10px] font-bold uppercase tracking-wider",
                c.iconColor
              )}
            >
              {c.label}
            </span>
            <p className="mt-0.5 text-sm font-semibold leading-snug text-foreground">
              {title}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{c.meta}</p>
          </div>
          <Icon className={cn("h-5 w-5 shrink-0", c.iconColor)} />
          {stoppable && payload.task_id && (
            <StopTaskButton taskId={payload.task_id} title={title} />
          )}
        </div>
        {payload.task_id && <CopyableTaskId taskId={payload.task_id} />}
        {payload.work_conversation_id && (
          <WorkRoomLink workConversationId={payload.work_conversation_id} />
        )}
      </div>
    </div>
  );
}

/** Inline footer link that switches the active conversation to the
 *  task's work sub-conversation. Conversation channel auto-adds the
 *  human as a read-only observer on join — without this affordance the
 *  work conv is only discoverable via the SubConversationList accordion
 *  or the busy-redirect alert. */
function WorkRoomLink({ workConversationId }: { workConversationId: string }) {
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
      className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/15"
    >
      <MessageSquarePlus className="h-3 w-3" />
      Open work room
      <ChevronRight className="h-3 w-3" />
    </button>
  );
}

export function StatusUpdateMessage({ message }: { message: Message }) {
  const payload = safeParseJson<StatusPayload>(message.content, {
    summary: message.content,
  });
  const rawLifecycle =
    payload.lifecycle_type ?? payload.type ?? payload.status ?? "task_in_progress";
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
  // No task_id exists — render a slim destructive banner so the user
  // doesn't have to trust the LLM's narration of what happened.
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
  const Icon =
    lifecycle === "task_complete"
      ? CheckCircle
      : lifecycle === "task_failed"
      ? XCircle
      : lifecycle === "task_cancelled"
      ? Ban
      : lifecycle === "task_in_progress"
      ? PlayCircle
      : ArrowRightLeft;

  const iconColor =
    lifecycle === "task_complete"
      ? "text-success"
      : lifecycle === "task_failed"
      ? "text-destructive"
      : lifecycle === "task_cancelled"
      ? "text-muted-foreground"
      : lifecycle === "task_in_progress"
      ? "text-warning"
      : "text-muted-foreground";

  return (
    <div className="my-2 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <Icon className={cn("h-4 w-4 shrink-0", iconColor)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">
            {lifecycle.replace(/_/g, " ")}
          </span>
          {message.sender?.displayName && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Bot className="h-2.5 w-2.5" />
              {message.sender.displayName}
            </span>
          )}
        </div>
        {payload.summary && (
          <p className="mt-0.5 text-xs text-muted-foreground">{payload.summary}</p>
        )}
      </div>
      <span className="shrink-0 text-[10px] text-muted-foreground">
        {formatClockTime(message.insertedAt)}
      </span>
    </div>
  );
}

const STATUS_TYPES = new Set(["StatusUpdate", "status_update"]);

export function isStatusUpdateMessage(message: Message): boolean {
  const type = message.messageType || message.contentType || "";
  return STATUS_TYPES.has(type);
}
