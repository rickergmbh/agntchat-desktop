import { useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Copy,
  Check,
  Loader2,
  XCircle,
  Ban,
  MessageSquare,
  MessageSquarePlus,
  Send,
  Zap,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn, formatRelativeShort } from "../../lib/utils";
import { useTaskStore } from "../../stores/taskStore";
import { useChatStore } from "../../stores/chatStore";
import { MarkdownContent } from "../messages/MarkdownContent";
import type { Task, TaskStatus } from "../../lib/api";

const ACTIVE_STATUSES = new Set<TaskStatus>([
  "pending",
  "accepted",
  "in_progress",
  "blocked",
]);

const STATUS_CHIP_CLASS: Record<string, string> = {
  pending: "bg-warning/10 text-warning border-warning/30",
  accepted: "bg-primary/10 text-primary border-primary/30",
  in_progress: "bg-warning/10 text-warning border-warning/30",
  blocked: "bg-destructive/10 text-destructive border-destructive/30",
  complete: "bg-success/10 text-success border-success/30",
  cancelled: "bg-muted text-muted-foreground border-border",
  rejected: "bg-destructive/10 text-destructive border-destructive/30",
  exhausted: "bg-muted text-muted-foreground border-border",
};

export function TaskDetail({
  task,
  onOpenConversation,
}: {
  task: Task;
  onOpenConversation: (conversationId: string) => void;
}) {
  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus);
  const requestRevision = useTaskStore((s) => s.requestRevision);
  const liveMeta = useTaskStore((s) => s.taskLifecycleMeta[task.id]);
  const progress = useTaskStore((s) => s.taskProgress[task.id]);

  const effectiveStatus = (liveMeta?.effectiveStatus as TaskStatus) ?? task.status;
  const isActive = ACTIVE_STATUSES.has(effectiveStatus);
  const isComplete = effectiveStatus === "complete";

  const [showRevision, setShowRevision] = useState(false);
  const [revisionText, setRevisionText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const completion = task.completionDetails as
    | { summary?: string; model?: string; elapsed_seconds?: number }
    | undefined;
  const summary = liveMeta?.summary ?? completion?.summary;

  const statusChip =
    STATUS_CHIP_CLASS[effectiveStatus] ?? STATUS_CHIP_CLASS.cancelled;

  const assignees = task.assignees ?? [];

  const workConversationId =
    (task.metadata as Record<string, unknown> | undefined)?.work_conversation_id;
  const workConvId =
    typeof workConversationId === "string" && workConversationId
      ? workConversationId
      : null;

  const recentSteps = useMemo(
    () => progress?.recentSteps ?? [],
    [progress?.recentSteps]
  );

  const handleCopyId = () => {
    navigator.clipboard?.writeText(task.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleCancel = async () => {
    if (!confirm(`Cancel "${task.title}"?`)) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await updateTaskStatus(task.id, "cancelled");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevisionSubmit = async () => {
    const feedback = revisionText.trim();
    if (!feedback) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await requestRevision(task.id, feedback);
      setShowRevision(false);
      setRevisionText("");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Revision failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-6 py-4 border-b border-border bg-card">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className={cn(
                  "px-1.5 py-0.5 rounded-md border text-[10px] font-medium uppercase tracking-wide",
                  statusChip
                )}
              >
                {effectiveStatus.replace(/_/g, " ")}
              </span>
              <button
                type="button"
                onClick={handleCopyId}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                title="Copy task ID"
              >
                <span className="font-mono">{task.id.slice(0, 8)}…</span>
                {copied ? (
                  <Check className="h-3 w-3 text-success" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>
            </div>
            <h1 className="text-lg font-semibold leading-tight">{task.title}</h1>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {workConvId && (
              <Button
                size="sm"
                onClick={() => onOpenConversation(workConvId)}
                title="Open the task's work sub-conversation"
              >
                <MessageSquarePlus className="w-3.5 h-3.5" />
                Open work room
              </Button>
            )}
            {task.conversationId && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onOpenConversation(task.conversationId)}
                title="Open the conversation this task lives in"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Open chat
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* Live progress (active tasks only) */}
        {isActive && recentSteps.length > 0 && (
          <section className="rounded-xl border border-primary/20 border-l-4 border-l-primary bg-card p-4">
            <div className="flex items-center gap-2 mb-3 text-xs font-medium text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
              <span>Live activity</span>
            </div>
            <div className="space-y-1.5">
              {recentSteps.slice(0, -1).slice(-4).map((step, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/30" />
                  <span className="text-xs text-muted-foreground/60">{step}</span>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary" />
                <span className="text-xs font-medium">
                  {recentSteps[recentSteps.length - 1]}
                </span>
              </div>
            </div>
          </section>
        )}

        {/* Description */}
        {task.description && (
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              Description
            </h3>
            <div className="text-sm">
              <MarkdownContent content={task.description} />
            </div>
          </section>
        )}

        {/* Completion summary */}
        {isComplete && summary && (
          <section className="rounded-xl border border-success/20 border-l-4 border-l-success bg-success/5 p-4">
            <div className="flex items-center gap-2 mb-2 text-xs font-medium text-success dark:text-success">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Summary</span>
            </div>
            <div className="text-sm">
              <MarkdownContent content={summary} />
            </div>
            {(completion?.model || completion?.elapsed_seconds != null) && (
              <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
                {completion?.model && (
                  <span className="flex items-center gap-1">
                    <Zap className="h-3 w-3" />
                    {completion.model}
                  </span>
                )}
                {completion?.elapsed_seconds != null && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDuration(completion.elapsed_seconds)}
                  </span>
                )}
              </div>
            )}
          </section>
        )}

        {/* Failure error */}
        {effectiveStatus === "rejected" && liveMeta?.error && (
          <section className="rounded-xl border border-destructive/20 border-l-4 border-l-destructive bg-destructive/5 p-4">
            <div className="flex items-center gap-2 mb-2 text-xs font-medium text-destructive dark:text-destructive">
              <XCircle className="w-3.5 h-3.5" />
              <span>Failure</span>
            </div>
            <p className="text-sm text-destructive dark:text-destructive whitespace-pre-wrap">
              {liveMeta.error}
            </p>
          </section>
        )}

        {/* Assignees */}
        {assignees.length > 0 && (
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Assigned to
            </h3>
            <div className="flex flex-wrap gap-2">
              {assignees.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 rounded-full border border-border bg-card px-2 py-1"
                >
                  <Avatar className="h-5 w-5">
                    {a.avatarUrl && <AvatarImage src={a.avatarUrl} />}
                    <AvatarFallback className="bg-primary/10 text-primary text-[9px]">
                      {a.displayName.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs">{a.displayName}</span>
                  {a.type === "agent" && (
                    <span className="text-[9px] rounded bg-primary/10 text-primary px-1 uppercase tracking-wide">
                      agent
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Creator + times */}
        <section className="grid grid-cols-2 gap-3 text-xs">
          {task.creator && (
            <Row label="Created by" value={task.creator.displayName} />
          )}
          {task.deadline && (
            <Row label="Deadline" value={new Date(task.deadline).toLocaleString()} />
          )}
          <Row
            label="Created"
            value={`${formatRelativeShort(task.insertedAt)} ago`}
          />
          <Row
            label="Updated"
            value={`${formatRelativeShort(task.updatedAt)} ago`}
          />
        </section>

        {/* Revision form */}
        {showRevision && (
          <section className="rounded-xl border border-border bg-card p-4 space-y-2">
            <h3 className="text-xs font-semibold">Request revision</h3>
            <textarea
              autoFocus
              value={revisionText}
              onChange={(e) => setRevisionText(e.target.value)}
              rows={4}
              placeholder="What should the agent change or address?"
              className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
            />
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowRevision(false);
                  setRevisionText("");
                }}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleRevisionSubmit}
                disabled={!revisionText.trim() || submitting}
              >
                {submitting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                Send
              </Button>
            </div>
          </section>
        )}

        {actionError && (
          <p className="text-[11px] text-destructive">{actionError}</p>
        )}
      </div>

      {/* Actions footer */}
      <footer className="border-t border-border bg-card px-4 py-2.5 flex items-center justify-end gap-2">
        {isActive && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleCancel}
            disabled={submitting}
            className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive/90"
          >
            <Ban className="w-3.5 h-3.5" />
            Cancel task
          </Button>
        )}
        {isComplete && !showRevision && (
          <Button size="sm" onClick={() => setShowRevision(true)}>
            <Send className="w-3.5 h-3.5" />
            Request revision
          </Button>
        )}
      </footer>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/80">
        {label}
      </p>
      <p className="mt-0.5 text-foreground">{value}</p>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// re-export so we can use the chat-store setter in the shell
export function useOpenConversationFromTask() {
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  return setActiveConversation;
}
