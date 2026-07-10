import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SmilePlus } from "lucide-react";
import { cn } from "../../lib/utils";
import { useChatStore } from "../../stores/chatStore";
import { useAuthStore } from "../../stores/authStore";
import type { Message } from "../../lib/api";

/** The quick-react set (#88). Order matches the backend's valence doc —
 *  positive first, negative last. Any emoji is accepted server-side; this
 *  picker is just the one-click affordance. Mirrors web/mobile. */
export const QUICK_REACTIONS = ["👍", "❤️", "🎯", "😕", "👎"];

/** Shared open/close behavior for the emoji picker popovers: closes on
 *  outside click and Escape. Returns the wrapper ref to attach. */
function usePickerDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

/** The 5-emoji quick-react row, opened by the muted smiley button. The
 *  parent wrapper controls anchoring; this renders below it. */
function ReactionPicker({
  message,
  isOwn,
  onPicked,
}: {
  message: Message;
  isOwn: boolean;
  onPicked: () => void;
}) {
  const { t } = useTranslation("chat");
  const toggleReaction = useChatStore((s) => s.toggleReaction);

  return (
    <div
      role="toolbar"
      aria-label={t("reactions.add")}
      className={cn(
        "absolute top-full z-20 mt-1 flex items-center gap-0.5 rounded-full border border-border bg-card px-1 py-0.5 shadow-md",
        isOwn ? "right-0" : "left-0"
      )}
    >
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-label={t("reactions.reactWith", { emoji })}
          onClick={() => {
            toggleReaction(message.conversationId, message.id, emoji);
            onPicked();
          }}
          className="rounded-full px-1 py-0.5 text-sm leading-none transition-transform hover:scale-125"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

/** Muted smiley affordance for messages with no reactions yet: revealed on
 *  row hover at the bubble's lower corner (opposite the timestamp), opens
 *  the quick-react picker BELOW the message. Rendered inside `<Bubble>`
 *  (position: relative). Once a message has reactions, the add affordance
 *  moves into the chips row (see ReactionChips) and this renders nothing. */
export function AddReactionButton({ message, isOwn }: { message: Message; isOwn: boolean }) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  const ref = usePickerDismiss(open, () => setOpen(false));

  if (message.pending || (message.reactions?.length ?? 0) > 0) return null;

  return (
    <div
      ref={ref}
      className={cn("absolute -bottom-3 z-10", isOwn ? "left-0" : "right-0")}
    >
      <button
        type="button"
        aria-label={t("reactions.add")}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "items-center justify-center rounded-full border border-border bg-card p-1 text-muted-foreground shadow-sm transition-colors hover:text-foreground",
          open ? "flex" : "hidden group-hover/message:flex"
        )}
      >
        <SmilePlus className="h-3.5 w-3.5" />
      </button>
      {open && <ReactionPicker message={message} isOwn={isOwn} onPicked={() => setOpen(false)} />}
    </div>
  );
}

/** Aggregated reaction chips rendered under a bubble, plus a trailing muted
 *  add-chip that opens the quick-react picker. Clicking a chip toggles the
 *  caller's own reaction with that emoji. */
export function ReactionChips({ message, isOwn }: { message: Message; isOwn: boolean }) {
  const { t } = useTranslation("chat");
  const myId = useAuthStore((s) => s.participant?.id);
  const toggleReaction = useChatStore((s) => s.toggleReaction);
  const [open, setOpen] = useState(false);
  const ref = usePickerDismiss(open, () => setOpen(false));

  const reactions = message.reactions ?? [];
  if (message.pending || reactions.length === 0) return null;

  return (
    <div
      data-slot="reaction-chips"
      className={cn("mt-1 flex flex-wrap items-center gap-1 px-1", isOwn && "justify-end")}
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
      <div ref={ref} className="relative">
        <button
          type="button"
          aria-label={t("reactions.add")}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex items-center rounded-full border border-border bg-muted px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
        >
          <SmilePlus className="h-3.5 w-3.5" />
        </button>
        {open && <ReactionPicker message={message} isOwn={isOwn} onPicked={() => setOpen(false)} />}
      </div>
    </div>
  );
}
