import { MessagesSquare } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import {
  isResolvedThread,
  selectChildAgentThreads,
} from "../../lib/thread-selectors";
import { useChatStore } from "../../stores/chatStore";
import { ThreadsPanel } from "./ThreadsPanel";

/**
 * Floating "💬 N threads" chip rendered absolutely over the top-right of
 * the chat content area. Stays visible whenever the parent has any
 * thread (open OR resolved) so users can drop back into past threads.
 * Click opens a dropdown panel with the full thread list.
 *
 * Styling switches based on what's left:
 *   - Open threads exist → primary-tinted chip with open count + unread
 *   - Only resolved threads → muted chip with "N resolved"
 *   - Nothing at all → hidden
 *
 * Mirrors mobile/components/ThreadsBar.tsx.
 */
export function ThreadsBar({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  const agentConversations = useChatStore((s) => s.agentConversations);
  const unreadCounts = useChatStore((s) => s.unreadCounts);

  const { openThreads, resolvedThreads } = useMemo(() => {
    const all = selectChildAgentThreads(agentConversations, conversationId);
    return {
      openThreads: all.filter((t) => !isResolvedThread(t)),
      resolvedThreads: all.filter((t) => isResolvedThread(t)),
    };
  }, [agentConversations, conversationId]);

  const unreadTotal = useMemo(
    () => openThreads.reduce((sum, t) => sum + (unreadCounts[t.id] ?? 0), 0),
    [openThreads, unreadCounts]
  );

  const totalCount = openThreads.length + resolvedThreads.length;
  if (totalCount === 0) return null;

  const allResolved = openThreads.length === 0;
  const chipLabel = allResolved
    ? t("threads.resolvedCount", { count: resolvedThreads.length })
    : t("threads.count", { count: openThreads.length });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "absolute top-2 right-3 z-20 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold shadow-sm transition-colors backdrop-blur-sm",
          allResolved
            ? "border-border bg-background/90 text-muted-foreground hover:bg-accent"
            : "border-border bg-background/90 text-primary hover:bg-accent"
        )}
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        aria-expanded={open}
        aria-label={chipLabel}
      >
        <MessagesSquare className="h-3.5 w-3.5" />
        <span>{chipLabel}</span>
        {unreadTotal > 0 ? (
          <span className="ml-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
            {unreadTotal > 99 ? "99+" : unreadTotal}
          </span>
        ) : null}
      </button>

      <ThreadsPanel
        parentConversationId={conversationId}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
