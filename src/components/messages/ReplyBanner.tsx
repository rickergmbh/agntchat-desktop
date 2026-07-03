import { Reply, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "../../stores/chatStore";
import type { Message } from "../../lib/api";

export function ReplyBanner({
  conversationId,
  message,
}: {
  conversationId: string;
  message: Message;
}) {
  const { t } = useTranslation("chat");
  const setReplyingTo = useChatStore((s) => s.setReplyingTo);
  const authorName = message.sender?.displayName ?? t("common:unknown");
  const preview = (message.content ?? "").slice(0, 120);

  return (
    <div className="flex items-center gap-2 border-t border-border bg-muted/40 px-3 py-1.5 text-xs">
      <Reply className="h-3 w-3 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="text-muted-foreground">{t("replyingTo")} </span>
        <span className="font-semibold text-foreground">{authorName}</span>
        {preview && (
          <span className="ml-1 truncate text-muted-foreground">— {preview}</span>
        )}
      </div>
      <button
        type="button"
        onClick={() => setReplyingTo(conversationId, null)}
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        title={t("cancelReply")}
        aria-label={t("cancelReply")}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
