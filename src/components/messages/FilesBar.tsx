import { Paperclip } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  listConversationFiles,
  type ConversationFile,
} from "../../lib/api";
import { useChatStore } from "../../stores/chatStore";
import { isFileMessage } from "./FileMessage";
import { FilesPanel } from "./FilesPanel";

/**
 * Header chip: paperclip + file count. Lives in the conversation header next
 * to the threads chip — never floating over message content. Hidden when the
 * conversation has no file attachments. Clicking opens the dropdown panel
 * (anchored below the chip) listing every file with uploader + timestamp +
 * download.
 *
 * Mirrors mobile/components/FilesBar.tsx (which renders in the native
 * header's headerRight).
 */
export function FilesBar({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation("files");
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<ConversationFile[]>([]);
  const [loading, setLoading] = useState(false);

  // Count of file messages currently in the store for this conversation.
  // When an agent uploads a file a new file message lands here, so we use the
  // count as a trigger to re-fetch the file list — keeping the chip count live
  // instead of stale until the panel is opened.
  const fileMessageCount = useChatStore((s) =>
    (s.messages[conversationId] ?? []).reduce(
      (n, m) => (isFileMessage(m) ? n + 1 : n),
      0
    )
  );

  const refresh = async () => {
    const fresh = await listConversationFiles(conversationId, { limit: 100 });
    setFiles(fresh);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listConversationFiles(conversationId, { limit: 100 })
      .then((result) => {
        if (!cancelled) setFiles(result);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, fileMessageCount]);

  if (loading && files.length === 0) return null;
  if (files.length === 0) return null;

  const chipLabel = t("count", { count: files.length });

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 items-center gap-1.5 rounded-md border border-border-strong px-2 text-[11px] font-semibold text-primary transition-colors hover:bg-accent"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        aria-expanded={open}
        aria-label={chipLabel}
        title={chipLabel}
      >
        <Paperclip className="h-3.5 w-3.5" />
        <span>{files.length}</span>
      </button>

      <FilesPanel
        files={files}
        open={open}
        onClose={() => setOpen(false)}
        onRefresh={refresh}
      />
    </div>
  );
}
