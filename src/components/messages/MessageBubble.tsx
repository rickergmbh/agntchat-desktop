import { memo } from "react";
import { useAuthStore } from "../../stores/authStore";
import { useChatStore } from "../../stores/chatStore";
import { cn, formatClockTime } from "../../lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Bot, Reply as ReplyIcon } from "lucide-react";
import { useModelCatalog } from "../../stores/modelCatalogStore";
import { MarkdownContent } from "./MarkdownContent";
import { isTaskMessage, TaskMessage } from "./TaskMessages";
import { isToolMessage, ToolMessage } from "./ToolMessages";
import { isFileMessage, FileMessage, RideAlongAttachments } from "./FileMessage";
import {
  isStatusUpdateMessage,
  StatusUpdateMessage,
} from "./StatusUpdateMessage";
import { ResultPresentationMessage } from "./ResultPresentationMessage";
import {
  isCompactionSummaryMessage,
  CompactionSummaryMessage,
} from "./CompactionSummaryMessage";
import type { Message } from "../../lib/api";

function isResultPresentationMessage(message: Message): boolean {
  // Primary path: backend sets messageType="ResultPresentation" when
  // forwarding extracted <result_presentation> envelopes (see
  // Gateway.maybe_forward_result_presentations).
  if (message.messageType === "ResultPresentation") return true;

  // Fallback: structured payload whose data looks like a ResultPresentation
  // (items[] + result_type). Mirrors web's resolveType auto-detection so
  // legacy / older-backend messages render as cards instead of raw JSON.
  if (
    message.messageType === "structured" ||
    message.contentType === "structured"
  ) {
    const data = message.contentStructured?.data as
      | Record<string, unknown>
      | undefined;
    if (
      data &&
      Array.isArray(data.items) &&
      data.items.length > 0 &&
      typeof data.result_type === "string"
    ) {
      return true;
    }
  }
  return false;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  showAvatar,
  showSenderName,
  onContextMenu,
}: {
  message: Message;
  /** Show the sender avatar (true for the first in a run). */
  showAvatar: boolean;
  /** Show the sender name above the bubble (true for first in a run, others only). */
  showSenderName: boolean;
  /** Right-click handler — bubbles the message + cursor up to the thread. */
  onContextMenu?: (message: Message, e: React.MouseEvent) => void;
}) {
  const myId = useAuthStore((s) => s.participant?.id);
  const isOwn = message.senderId === myId;
  const isAgent = message.sender?.type === "agent";
  const senderName = message.sender?.displayName ?? "";
  const avatarUrl = message.sender?.avatarUrl;
  const isTask = isTaskMessage(message);
  const isStatusUpdate = isStatusUpdateMessage(message);

  // Model + backend label for agent messages — same resolution order as web:
  // message.metadata.{model,backend} is the primary source (populated on
  // server broadcast); falls back to the sender-context struct if present.
  const rawModel =
    (message.metadata?.model as string | undefined) ||
    ((message.contentStructured?.data as Record<string, unknown> | undefined)
      ?.sender_context as Record<string, unknown> | undefined)?.model as
      | string
      | undefined;
  const rawBackend =
    (message.metadata?.backend as string | undefined) || undefined;
  // Resolve from the backend catalog (single source of truth) rather than a
  // static client table, so labels never drift from the model dropdown.
  const catalogModelLabel = useModelCatalog((s) => s.modelLabel);
  const modelLabel = isAgent ? catalogModelLabel(rawModel, rawBackend) : null;

  // Find the message we're replying to so we can render the preview
  const conversationId = message.conversationId;
  const parent = useChatStore((s) => {
    if (!message.parentMessageId) return undefined;
    return s.messages[conversationId]?.find(
      (m) => m.id === message.parentMessageId
    );
  });

  // Compaction summaries render full-width (no avatar, no bubble) — they're a
  // conversation-level event, not a message attributed to a participant.
  if (isCompactionSummaryMessage(message)) {
    return (
      <div className="px-4">
        <CompactionSummaryMessage message={message} />
      </div>
    );
  }

  // Card messages (tasks + status lifecycle updates) reuse the same
  // avatar + sender header scaffold as regular bubbles but drop the
  // bubble background — the card supplies its own coloured border and
  // background. Width-capped at 70% so these don't bleed edge-to-edge
  // like they used to (matches web/src/components/MessageBubble.tsx:77).
  if (isTask || isStatusUpdate) {
    return (
      <div
        className={cn(
          "flex gap-2 px-4",
          isOwn ? "justify-end" : "justify-start",
          showAvatar ? "mt-3" : "mt-0.5"
        )}
        onContextMenu={(e) => {
          if (!onContextMenu) return;
          e.preventDefault();
          onContextMenu(message, e);
        }}
      >
        {!isOwn && (
          <div className="w-8 shrink-0 flex flex-col justify-end">
            {showAvatar ? (
              <Avatar className="h-8 w-8">
                {avatarUrl ? <AvatarImage src={avatarUrl} alt={senderName} /> : null}
                <AvatarFallback className="bg-primary/10 text-primary text-[11px] font-semibold">
                  {senderName.charAt(0).toUpperCase() || "?"}
                </AvatarFallback>
              </Avatar>
            ) : null}
          </div>
        )}
        <div className={cn("min-w-0 w-[35%]", isOwn ? "items-end" : "items-start")}>
          {!isOwn && showSenderName && (
            <div className="mb-0.5 px-1">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                {senderName}
                {isAgent && (
                  <span className="inline-flex items-center gap-1 rounded bg-bubble-agent-accent/10 px-1.5 py-0.5 text-[10px] font-bold text-bubble-agent-accent">
                    <Bot className="h-3 w-3" />
                    Agent
                  </span>
                )}
              </span>
              {modelLabel && (
                <span className="block font-mono text-[10px] text-muted-foreground/70">
                  {modelLabel}
                </span>
              )}
            </div>
          )}
          {isTask ? (
            <TaskMessage message={message} />
          ) : (
            <StatusUpdateMessage message={message} />
          )}
          <span className="mt-0.5 block px-1 text-[10px] text-muted-foreground">
            {formatClockTime(message.insertedAt)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex gap-2 px-4",
        isOwn ? "justify-end" : "justify-start",
        showAvatar ? "mt-3" : "mt-0.5"
      )}
      onContextMenu={(e) => {
        if (!onContextMenu) return;
        e.preventDefault();
        onContextMenu(message, e);
      }}
    >
      {!isOwn && (
        // Avatar column: `justify-end` pins the avatar to the bottom of the
        // bubble wrapper (matches web + mobile) so it sits next to the most
        // recent bubble of a run rather than floating at the top. Empty
        // spacer when showAvatar is false keeps the message indented.
        <div className="w-8 shrink-0 flex flex-col justify-end">
          {showAvatar ? (
            <Avatar className="h-8 w-8">
              {avatarUrl ? <AvatarImage src={avatarUrl} alt={senderName} /> : null}
              <AvatarFallback className="bg-primary/10 text-primary text-[11px] font-semibold">
                {senderName.charAt(0).toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
          ) : null}
        </div>
      )}

      <div className={cn("flex flex-col max-w-[72%]", isOwn ? "items-end" : "items-start")}>
        {!isOwn && showSenderName && (
          <div className="mb-0.5 px-1">
            {/* Sender name inherits text-muted-foreground from the outer
             * span — matches web's token (web/src/components/MessageBubble.tsx
             * line 132). The "Agent" pill overrides to text-bubble-agent-
             * accent for its own contrast. */}
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              {senderName}
              {isAgent && (
                <span className="inline-flex items-center gap-1 rounded bg-bubble-agent-accent/10 px-1.5 py-0.5 text-[10px] font-bold text-bubble-agent-accent">
                  <Bot className="h-3 w-3" />
                  Agent
                </span>
              )}
            </span>
            {modelLabel && (
              <span className="block font-mono text-[10px] text-muted-foreground/70">
                {modelLabel}
              </span>
            )}
          </div>
        )}

        {parent && (
          <div
            className={cn(
              "mb-0.5 max-w-full rounded-md border-l-2 px-2 py-1 text-[11px]",
              isOwn
                ? "border-primary-foreground/40 bg-primary/10 text-muted-foreground"
                : "border-muted-foreground/40 bg-muted/40 text-muted-foreground"
            )}
          >
            <div className="flex items-center gap-1">
              <ReplyIcon className="h-2.5 w-2.5" />
              <span className="font-medium text-foreground">
                {parent.sender?.displayName ?? "Unknown"}
              </span>
            </div>
            <p className="truncate">{parent.content}</p>
          </div>
        )}

        <div
          className={cn(
            "rounded-2xl px-3.5 py-2 text-sm break-words",
            isOwn
              ? "bg-bubble-own text-bubble-own-foreground rounded-br-sm"
              : isAgent
                ? "bg-bubble-agent text-bubble-agent-foreground ring-1 ring-bubble-agent-accent/20 rounded-bl-sm"
                : "bg-bubble-other text-bubble-other-foreground rounded-bl-sm",
            message.pending && "opacity-60"
          )}
        >
          {isToolMessage(message) ? (
            <ToolMessage message={message} />
          ) : isFileMessage(message) ? (
            <FileMessage message={message} />
          ) : isResultPresentationMessage(message) ? (
            <ResultPresentationMessage message={message} />
          ) : (
            <>
              {message.content?.trim() ? <MarkdownContent content={message.content} /> : null}
              <RideAlongAttachments message={message} />
            </>
          )}
        </div>

        <span className="text-[10px] text-muted-foreground mt-0.5 px-1">
          {formatClockTime(message.insertedAt)}
          {message.pending && " · sending"}
        </span>
      </div>
    </div>
  );
});
