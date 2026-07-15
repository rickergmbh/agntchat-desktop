import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, ChevronDown, ChevronRight } from "lucide-react";
import { MarkdownContent } from "./MarkdownContent";
import type { Message } from "../../lib/api";

interface CompactionPayload {
  narrative?: string;
  messages_compacted?: number;
  compaction_number?: number;
}

export function isCompactionSummaryMessage(message: Message): boolean {
  return message.messageType === "CompactionSummary";
}

// Renders a CompactionSummary: the narrative that replaces a block of older
// messages folded away by the backend CompactionWorker. The older messages
// are filtered out of the list, so this summary is the canonical record of
// what they contained. Full-width, expandable.
export function CompactionSummaryMessage({ message }: { message: Message }) {
  // Collapsed by default — it's archived history; the header stays visible
  // and the user expands the narrative on demand.
  const { t } = useTranslation("chat");
  const [expanded, setExpanded] = useState(false);
  const data = (message.contentStructured?.data ?? {}) as CompactionPayload;
  const count = data.messages_compacted ?? 0;
  const narrative = data.narrative ?? "";

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-hover"
      >
        <Archive className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 text-left">
          {count > 0
            ? t("compaction.summarized", { count })
            : t("compaction.summarizedNoCount")}
        </span>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        )}
      </button>
      {expanded && narrative && (
        <div className="border-t border-border px-3 py-2 text-sm text-foreground/90">
          <MarkdownContent content={narrative} />
        </div>
      )}
    </div>
  );
}
