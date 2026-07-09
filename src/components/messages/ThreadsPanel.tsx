import { CheckCircle2, MessageSquare, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import type { Conversation, ConversationMember } from "../../lib/api";
import {
  isResolvedThread,
  selectChildAgentThreads,
  threadTopic,
} from "../../lib/thread-selectors";
import { cn, formatConversationTime } from "../../lib/utils";
import { useAuthStore } from "../../stores/authStore";
import { useChatStore } from "../../stores/chatStore";
import { useNavStore } from "../../stores/navStore";
import { GroupAvatar } from "./GroupAvatar";

interface Props {
  parentConversationId: string;
  open: boolean;
  onClose: () => void;
}

function threadParticipants(
  conv: Conversation,
  myId?: string
): ConversationMember[] {
  const members = conv.members ?? [];
  const others = members.filter((m) => m.participantId !== myId);
  return others.length > 0 ? others : members;
}

function threadDisplayTitle(conv: Conversation, myId?: string): string {
  const topic = threadTopic(conv);
  if (topic) return topic;
  if (conv.title) return conv.title;
  const names = threadParticipants(conv, myId)
    .map((m) => m.participant?.displayName)
    .filter(Boolean)
    .join(" ↔ ");
  return names || i18n.t("chat:threads.agentThread");
}

function threadSubtitle(conv: Conversation, myId?: string): string {
  // Inverse of the title: when the title shows the topic, the subtitle
  // shows participants; when no topic, subtitle shows the last preview.
  if (threadTopic(conv)) {
    return threadParticipants(conv, myId)
      .map((m) => m.participant?.displayName)
      .filter(Boolean)
      .join(" ↔ ");
  }
  const preview = conv.lastMessage?.content || "";
  return preview.replace(/\s+/g, " ").trim().slice(0, 80);
}

export function ThreadsPanel({ parentConversationId, open, onClose }: Props) {
  const { t } = useTranslation("chat");
  const myId = useAuthStore((s) => s.participant?.id);
  const openThreadInPane = useChatStore((s) => s.openThread);
  const setView = useNavStore((s) => s.setView);
  const agentConversations = useChatStore((s) => s.agentConversations);
  const unreadCounts = useChatStore((s) => s.unreadCounts);

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Click-outside + Escape to close, matching the desktop's other dropdowns
  // (e.g., ChatHeaderMenu). Mouse capture so a click inside the panel
  // doesn't immediately close it before the row's onClick fires.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Defer click attach by a microtask so the chip's own click doesn't
    // immediately re-close us.
    const id = window.setTimeout(() => {
      window.addEventListener("mousedown", onClick);
      window.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const { openThreads, resolvedThreads } = useMemo(() => {
    const threads = selectChildAgentThreads(agentConversations, parentConversationId);
    const byActivity = (a: Conversation, b: Conversation) =>
      new Date(b.updatedAt || b.insertedAt).getTime() -
      new Date(a.updatedAt || a.insertedAt).getTime();

    const opn: Conversation[] = [];
    const res: Conversation[] = [];
    for (const t of threads) {
      if (isResolvedThread(t)) res.push(t);
      else opn.push(t);
    }
    opn.sort(byActivity);
    // Resolved sort: prefer `metadata.resolved_at` for stable order
    // (system messages can bump updatedAt after closure).
    res.sort((a, b) => {
      const ra =
        ((a.metadata as Record<string, unknown> | undefined)?.resolved_at as string | undefined) ||
        a.updatedAt ||
        a.insertedAt;
      const rb =
        ((b.metadata as Record<string, unknown> | undefined)?.resolved_at as string | undefined) ||
        b.updatedAt ||
        b.insertedAt;
      return new Date(rb).getTime() - new Date(ra).getTime();
    });
    return { openThreads: opn, resolvedThreads: res };
  }, [agentConversations, parentConversationId]);

  if (!open) return null;

  const openThread = (id: string) => {
    setView("chat");
    openThreadInPane(id);
    onClose();
  };

  return (
    <div
      ref={containerRef}
      className="absolute right-0 top-full z-30 mt-2 w-[360px] max-h-[480px] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-border">
        <div>
          <p className="text-sm font-semibold">{t("threads.inThisChat")}</p>
          <p className="text-xs text-muted-foreground">
            {t("threads.openCount", { count: openThreads.length })}
            {resolvedThreads.length > 0
              ? ` · ${t("threads.resolvedCount", { count: resolvedThreads.length })}`
              : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={t("threads.closePanel")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="max-h-[420px] overflow-y-auto py-1">
        {openThreads.length === 0 && resolvedThreads.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            <MessageSquare className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
            {t("threads.empty")}
          </div>
        ) : null}

        {openThreads.map((thread) => (
          <ThreadRow
            key={thread.id}
            thread={thread}
            myId={myId}
            unread={unreadCounts[thread.id] ?? 0}
            resolved={false}
            onOpen={openThread}
          />
        ))}

        {resolvedThreads.length > 0 ? (
          <div className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {t("threads.resolved")}
          </div>
        ) : null}

        {resolvedThreads.map((thread) => (
          <ThreadRow
            key={thread.id}
            thread={thread}
            myId={myId}
            unread={unreadCounts[thread.id] ?? 0}
            resolved
            onOpen={openThread}
          />
        ))}
      </div>
    </div>
  );
}

function ThreadRow({
  thread,
  myId,
  unread,
  resolved,
  onOpen,
}: {
  thread: Conversation;
  myId: string | undefined;
  unread: number;
  resolved: boolean;
  onOpen: (id: string) => void;
}) {
  const participants = threadParticipants(thread, myId);
  const title = threadDisplayTitle(thread, myId);
  const subtitle = threadSubtitle(thread, myId);

  return (
    <button
      type="button"
      onClick={() => onOpen(thread.id)}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-accent",
        resolved && "opacity-60"
      )}
    >
      <div className="relative shrink-0">
        <GroupAvatar members={participants} size={32} />
        {resolved ? (
          <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-background p-px">
            <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{title}</p>
        {subtitle ? (
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>

      <div className="flex flex-col items-end gap-1">
        <span className="text-[10px] text-muted-foreground">
          {formatConversationTime(thread.updatedAt)}
        </span>
        {unread > 0 ? (
          <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold leading-none text-primary-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </div>
    </button>
  );
}
