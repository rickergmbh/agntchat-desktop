import { Bot, Brain, Wrench, Pen, Search, Clock, Users, Loader2, Square } from "lucide-react";
import type { ActiveStream, StreamPhase } from "../../lib/api";
import { cn } from "../../lib/utils";

const phaseIcons: Record<StreamPhase, typeof Brain> = {
  thinking: Brain,
  tool_call: Wrench,
  writing: Pen,
  analyzing: Search,
  queued: Clock,
  waiting: Users,
};

const phaseLabels: Record<StreamPhase, string> = {
  thinking: "Thinking...",
  tool_call: "Using tools...",
  writing: "Writing...",
  analyzing: "Analyzing...",
  queued: "Message queued — agent is offline",
  waiting: "Waiting for turn...",
};

export function StreamingBubble({
  stream,
  onStop,
  stopping,
}: {
  stream: ActiveStream;
  /** When set, renders a stop button beside the bubble. Stops ALL agents in
   *  the conversation (server semantics of /stop-agents), not just this one. */
  onStop?: () => void;
  stopping?: boolean;
}) {
  const Icon = phaseIcons[stream.phase] ?? Brain;
  const label = stream.phaseDetail ?? phaseLabels[stream.phase] ?? "Working...";
  const animated = stream.phase !== "queued" && stream.phase !== "waiting";

  return (
    <div className="flex gap-2 px-4 mt-2">
      <div className="w-8 shrink-0">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
          <Bot className="h-4 w-4 text-primary" />
        </div>
      </div>

      <div className="flex max-w-[72%] flex-col">
        <div className="mb-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">{stream.senderName}</span>
          <span className="px-1.5 py-[1px] rounded bg-bubble-agent-accent/10 text-bubble-agent-accent text-[9px] font-semibold uppercase tracking-wide">
            agent
          </span>
        </div>

        <div className="rounded-2xl rounded-bl-sm bg-bubble-agent text-bubble-agent-foreground ring-1 ring-bubble-agent-accent/20 px-3.5 py-2 text-sm">
          {/* Preserved thoughts from prior writing bursts in this stream.
              Same styling as live writing so prose doesn't visually shift
              when a burst transitions into a preserved thought. */}
          {stream.thoughts && stream.thoughts.length > 0 && (
            <div className="mb-1.5 space-y-1.5">
              {stream.thoughts.map((t, i) => (
                <p key={i} className="whitespace-pre-wrap break-words">
                  {t}
                </p>
              ))}
            </div>
          )}

          <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon className={cn("h-3 w-3", animated && "animate-pulse")} />
            <span>{label}</span>
          </div>

          {stream.phase === "writing" && stream.content && (
            <p className="whitespace-pre-wrap break-words">{stream.content}</p>
          )}

          {stream.recentSteps.length > 0 && stream.phase !== "writing" && (
            <div className="mt-1 space-y-0.5">
              {stream.recentSteps.map((step, i) => (
                <div key={i} className="text-xs text-muted-foreground/70">
                  {step}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {onStop && (
        <button
          type="button"
          onClick={stopping ? undefined : onStop}
          disabled={stopping}
          title="Stop agents"
          aria-label="Stop agents"
          className={cn(
            "self-end mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
            "border border-border bg-card text-muted-foreground shadow-sm transition-colors",
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
  );
}
