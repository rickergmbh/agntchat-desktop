import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  MoreVertical,
  Copy,
  Check,
  Eraser,
  StopCircle,
  Trash2,
  LogOut,
  Loader2,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useAuthStore } from "../../stores/authStore";
import { useChatStore } from "../../stores/chatStore";
import type { Conversation } from "../../lib/api";

/**
 * Per-conversation overflow menu — ported from web's ChatHeaderMenu
 * (web/src/components/ChatHeaderMenu.tsx). Lives in the chat header next
 * to the Info toggle.
 *
 * Items:
 *  - Copy ID         (always)
 *  - Clear chat      (always — local-only, same action as details panel)
 *  - Stop agents     (only when the conversation has an agent member)
 *  - Delete / Leave  (Delete if admin, Leave otherwise; confirms)
 */
export function ChatHeaderMenu({
  conversation,
  onAfterDangerAction,
}: {
  conversation: Conversation;
  /** Fired after delete / leave resolves so the caller can clear any local
   *  state tied to the now-gone conversation (e.g. close the details panel). */
  onAfterDangerAction?: () => void;
}) {
  const { t } = useTranslation("chat");
  const currentUserId = useAuthStore((s) => s.participant?.id);
  const clearChatLocal = useChatStore((s) => s.clearChatLocal);
  const stopAgents = useChatStore((s) => s.stopAgents);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const leaveConversation = useChatStore((s) => s.leaveConversation);

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Close on outside click + Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isAdmin = conversation.createdBy === currentUserId;
  const hasAgents = (conversation.members ?? []).some(
    (m) => m.participant?.type === "agent"
  );

  const handleCopyId = () => {
    navigator.clipboard?.writeText(conversation.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleClearChat = () => {
    if (!confirm(t("menu.clearChatConfirm"))) {
      return;
    }
    clearChatLocal(conversation.id);
    setOpen(false);
  };

  const handleStopAgents = async () => {
    setStopping(true);
    setActionError(null);
    try {
      await stopAgents(conversation.id);
      setOpen(false);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("menu.stopAgentsFailed"));
    } finally {
      setStopping(false);
    }
  };

  const handleDanger = async () => {
    if (isAdmin) {
      if (!confirm(t("menu.deleteConfirm", { title: conversation.title || t("thisConversation") }))) {
        return;
      }
      try {
        await deleteConversation(conversation.id);
        setOpen(false);
        onAfterDangerAction?.();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : t("menu.deleteFailed"));
      }
    } else {
      if (!confirm(t("details.leaveConfirmTitle"))) return;
      if (!currentUserId) return;
      try {
        await leaveConversation(conversation.id, currentUserId);
        setOpen(false);
        onAfterDangerAction?.();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : t("menu.leaveFailed"));
      }
    }
  };

  return (
    <div className="relative" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t("menu.moreActions")}
        aria-label={t("menu.moreActions")}
        aria-expanded={open}
        className={cn(
          "rounded-md p-1.5 transition-colors",
          open
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {open && (
        <div
          ref={ref}
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          <MenuItem
            icon={copied ? Check : Copy}
            label={copied ? t("menu.idCopied") : t("menu.copyConversationId")}
            onClick={handleCopyId}
          />
          <MenuItem
            icon={Eraser}
            label={t("menu.clearChatLocal")}
            onClick={handleClearChat}
          />
          {hasAgents && (
            <MenuItem
              icon={stopping ? Loader2 : StopCircle}
              iconClassName={cn(
                stopping ? "animate-spin" : undefined,
                "text-warning"
              )}
              label={stopping ? t("menu.stopping") : t("menu.stopAgents")}
              onClick={stopping ? undefined : handleStopAgents}
              disabled={stopping}
            />
          )}
          <MenuDivider />
          <MenuItem
            icon={isAdmin ? Trash2 : LogOut}
            label={isAdmin ? t("menu.deleteConversation") : t("menu.leaveConversation")}
            onClick={handleDanger}
            destructive
          />

          {actionError && (
            <p className="px-3 pt-2 text-[11px] text-destructive">
              {actionError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  iconClassName,
  label,
  onClick,
  destructive,
  disabled,
}: {
  icon: React.ElementType;
  iconClassName?: string;
  label: string;
  onClick?: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors",
        destructive
          ? "text-destructive hover:bg-destructive/10"
          : "text-popover-foreground hover:bg-muted",
        disabled && "cursor-not-allowed opacity-60"
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", iconClassName)} />
      {label}
    </button>
  );
}

function MenuDivider() {
  return <div className="my-1 h-px bg-border" />;
}
