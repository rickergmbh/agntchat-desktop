import {
  CheckCircle2,
  ChevronRight,
  MessageSquare,
  Radio,
} from "lucide-react";
import type { Conversation } from "../../lib/api";
import { cn, formatConversationTime } from "../../lib/utils";
import { isResolvedThread, threadStatus, threadTopic } from "../../lib/thread-selectors";
import { useAuthStore } from "../../stores/authStore";
import { useChatStore } from "../../stores/chatStore";
import { useNavStore } from "../../stores/navStore";
import { useStreamingStore } from "../../stores/streamingStore";

/**
 * Slim inline pill rendered in the parent conversation timeline beneath
 * the spawning message. Mirrors mobile's `InlineThreadPill` layout: a
 * single row with a round icon, two-line text column (title + meta),
 * unread badge, chevron. No feed preview — the header ThreadsBar +
 * the thread itself surface that detail. Resolved threads stay visible
 * but dim down so attention goes to open work.
 */
export function AgentConversationCard({
  conversation,
}: {
  conversation: Conversation;
}) {
  const myId = useAuthStore((s) => s.participant?.id);
  const openThread = useChatStore((s) => s.openThread);
  const setView = useNavStore((s) => s.setView);

  const loadedMessageCount = useChatStore(
    (s) => (s.messages[conversation.id] ?? []).length
  );
  const unread = useChatStore((s) => s.unreadCounts[conversation.id] ?? 0);
  const stream = useStreamingStore((s) => s.streams[conversation.id]);
  const isLive = Boolean(stream);
  const resolved = isResolvedThread(conversation);

  const topic = threadTopic(conversation);
  const others = (conversation.members ?? [])
    .filter((m) => m.participantId !== myId)
    .map((m) => m.participant?.displayName)
    .filter(Boolean) as string[];
  const peerLine = others.length > 0 ? others.join(" ↔ ") : "Agent thread";
  const title = topic || conversation.title || peerLine;
  const subtitle = topic ? peerLine : null;

  // Loaded count is authoritative when the child thread's channel has
  // been joined. When it hasn't (a thread we know exists from the
  // sidebar but never opened), fall back to `lastMessage` as a
  // "has messages" signal so we don't say "No messages yet" about a
  // thread that's been chattering for hours.
  const hasMessages = loadedMessageCount > 0 || Boolean(conversation.lastMessage?.id);
  const messageCountLabel =
    loadedMessageCount > 0
      ? `${loadedMessageCount} msg${loadedMessageCount === 1 ? "" : "s"}`
      : hasMessages
      ? "Open to view"
      : "No messages yet";

  // The pill is the only resolution signal in the timeline (there is no
  // separate "Thread resolved" card), so spell the terminal state out.
  const statusLabel = resolved
    ? threadStatus(conversation) === "abandoned"
      ? "Abandoned"
      : "Resolved"
    : null;

  const open = () => {
    setView("chat");
    openThread(conversation.id);
  };

  return (
    // Asymmetric vertical breathing room: more on top to separate from the
    // preceding message bubble, less on the bottom since the next item in
    // the timeline either anchors to this same message (more thread cards)
    // or starts a new message with its own spacing.
    <div className="flex w-full justify-start px-4 pt-3 pb-1">
      <button
        type="button"
        onClick={open}
        className={cn(
          "group inline-flex w-full max-w-2xl items-center gap-2.5 rounded-full border px-3 py-1.5 text-left transition-colors sm:w-[82%]",
          resolved
            ? "border-border bg-muted/30 opacity-65 hover:bg-muted/50"
            : isLive
            ? "border-primary/40 bg-primary/10 hover:bg-primary/15"
            : "border-border bg-primary/5 hover:bg-primary/10"
        )}
      >
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
            resolved ? "bg-muted-foreground/15" : "bg-primary/15"
          )}
        >
          {resolved ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
          ) : isLive ? (
            <Radio className="h-3.5 w-3.5 text-primary" />
          ) : (
            <MessageSquare className="h-3.5 w-3.5 text-primary" />
          )}
        </span>

        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-sm font-semibold text-foreground">
              {title}
            </span>
            {unread > 0 ? (
              <span className="inline-flex h-4 min-w-[18px] shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
                {unread > 99 ? "99+" : unread}
              </span>
            ) : null}
          </span>
          <span className="truncate text-[11px] text-muted-foreground">
            {statusLabel ? `${statusLabel} · ` : ""}
            {subtitle ? `${subtitle} · ` : ""}
            {messageCountLabel}
            {" · "}
            {formatConversationTime(conversation.updatedAt ?? conversation.insertedAt)}
          </span>
        </span>

        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
      </button>
    </div>
  );
}
