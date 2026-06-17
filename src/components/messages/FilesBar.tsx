import { Paperclip } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../lib/utils";
import {
  listConversationFiles,
  type ConversationFile,
} from "../../lib/api";
import { useChatStore } from "../../stores/chatStore";
import { selectChildAgentThreads } from "../../lib/thread-selectors";
import { isFileMessage } from "./FileMessage";
import { FilesPanel } from "./FilesPanel";

/**
 * Floating "📎 N files" chip at the top-right of the chat area. Hidden when
 * the conversation has no file attachments. Clicking opens a dropdown panel
 * listing every file with uploader + timestamp + download.
 *
 * Position note: the chip clears the threads chip (`right-[7rem]`) only when
 * that chip is actually present. With no threads chip it sits flush at the
 * right edge (`right-3`) rather than leaving a gap where threads would be.
 */
export function FilesBar({
  conversationId,
  isThread = false,
}: {
  conversationId: string;
  isThread?: boolean;
}) {
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

  // The threads chip occupies the far right. The files chip only needs to
  // clear it when it's actually rendered (parent conversation with threads).
  const threadsBarVisible = useChatStore((s) =>
    isThread
      ? false
      : selectChildAgentThreads(s.agentConversations, conversationId).length > 0
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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "absolute top-2 z-20 inline-flex items-center gap-1.5 rounded-full border border-border bg-background/90 px-2.5 py-1 text-xs font-semibold text-primary shadow-sm transition-colors backdrop-blur-sm hover:bg-accent",
          threadsBarVisible ? "right-[7rem]" : "right-3"
        )}
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        aria-expanded={open}
        aria-label={`${files.length} file${files.length === 1 ? "" : "s"}`}
      >
        <Paperclip className="h-3.5 w-3.5" />
        <span>
          {files.length} file{files.length === 1 ? "" : "s"}
        </span>
      </button>

      <FilesPanel
        files={files}
        open={open}
        onClose={() => setOpen(false)}
        onRefresh={refresh}
      />
    </>
  );
}
