import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import { useChatStore } from "../../stores/chatStore";
import { useAuthStore } from "../../stores/authStore";
import type { Message } from "../../lib/api";

/** The quick-react set (#88). Order matches the backend's valence doc —
 *  positive first, negative last. Any emoji is accepted server-side; this
 *  bar is just the one-click affordance. Mirrors web/mobile. */
export const QUICK_REACTIONS = ["👍", "❤️", "🎯", "😕", "👎"];

/** Aggregated reaction chips rendered under a bubble. Clicking a chip
 *  toggles the caller's own reaction with that emoji. */
export function ReactionChips({ message, isOwn }: { message: Message; isOwn: boolean }) {
  const { t } = useTranslation("chat");
  const myId = useAuthStore((s) => s.participant?.id);
  const toggleReaction = useChatStore((s) => s.toggleReaction);

  const reactions = message.reactions ?? [];
  if (message.pending || reactions.length === 0) return null;

  return (
    <div
      data-slot="reaction-chips"
      className={cn("mt-1 flex flex-wrap gap-1 px-1", isOwn && "justify-end")}
    >
      {reactions.map((r) => {
        const mine = !!myId && r.participantIds.includes(myId);
        return (
          <button
            key={r.emoji}
            type="button"
            aria-label={t("reactions.reactWith", { emoji: r.emoji })}
            aria-pressed={mine}
            onClick={() => toggleReaction(message.conversationId, message.id, r.emoji)}
            className={cn(
              "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors",
              mine
                ? "border-primary/40 bg-primary/10 hover:bg-primary/15"
                : "border-border bg-muted hover:bg-muted/70"
            )}
          >
            <span className="text-sm leading-none">{r.emoji}</span>
            <span className="font-medium tabular-nums text-muted-foreground">
              {r.participantIds.length}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Hover quick-react bar pinned above the bubble corner. Rendered inside
 *  `<Bubble>` (position: relative) and revealed by the row's `group` hover. */
export function QuickReactBar({ message, isOwn }: { message: Message; isOwn: boolean }) {
  const { t } = useTranslation("chat");
  const toggleReaction = useChatStore((s) => s.toggleReaction);

  if (message.pending) return null;

  return (
    <div
      role="toolbar"
      aria-label={t("reactions.add")}
      className={cn(
        "absolute -top-3.5 z-10 hidden items-center gap-0.5 rounded-full border border-border bg-card px-1 py-0.5 shadow-sm group-hover/message:flex",
        isOwn ? "right-0" : "left-0"
      )}
    >
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-label={t("reactions.reactWith", { emoji })}
          onClick={() => toggleReaction(message.conversationId, message.id, emoji)}
          className="rounded-full px-1 py-0.5 text-sm leading-none transition-transform hover:scale-125"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
