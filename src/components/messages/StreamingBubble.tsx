import { Bot, Brain, Wrench, Pen, Search, Clock, Users, Loader2, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ActiveStream, StreamPhase } from "../../lib/api";
import { cn } from "../../lib/utils";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  Message as MessageRow,
  MessageAvatar,
  MessageContent,
  MessageHeader,
} from "@/components/ui/message";

const phaseIcons: Record<StreamPhase, typeof Brain> = {
  thinking: Brain,
  tool_call: Wrench,
  writing: Pen,
  analyzing: Search,
  queued: Clock,
  waiting: Users,
};

const phaseLabelKeys: Record<StreamPhase, string> = {
  thinking: "streamPhase.thinking",
  tool_call: "streamPhase.toolCall",
  writing: "streamPhase.writing",
  analyzing: "streamPhase.analyzing",
  queued: "streamPhase.queued",
  waiting: "streamPhase.waiting",
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
  const { t } = useTranslation("chat");
  const Icon = phaseIcons[stream.phase] ?? Brain;
  const label =
    stream.phaseDetail ??
    t(phaseLabelKeys[stream.phase] ?? "streamPhase.working");
  const animated = stream.phase !== "queued" && stream.phase !== "waiting";

  return (
    <MessageRow className="mt-2 px-4">
      {/* self-start: the streaming bubble grows downward, so the avatar
          anchors to the top where the stream began. */}
      <MessageAvatar className="h-8 w-8 self-start bg-primary/10">
        <Bot className="h-4 w-4 text-primary" />
      </MessageAvatar>

      <MessageContent className="w-fit max-w-[72%] gap-0">
        <MessageHeader className="mb-0.5 gap-1.5 px-0 text-[11px] font-normal">
          <span className="font-medium text-foreground">{stream.senderName}</span>
          <span className="px-1.5 py-[1px] rounded bg-bubble-agent-accent/10 text-bubble-agent-accent text-[9px] font-semibold uppercase tracking-wide">
            {t("common:agent")}
          </span>
        </MessageHeader>

        <Bubble variant="agent" className="max-w-full">
          <BubbleContent>
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
          </BubbleContent>
        </Bubble>
      </MessageContent>

      {onStop && (
        <button
          type="button"
          onClick={stopping ? undefined : onStop}
          disabled={stopping}
          title={t("stopAgents")}
          aria-label={t("stopAgents")}
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
    </MessageRow>
  );
}
