import {
  File as FileIcon,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Paperclip,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getFileDownloadUrl,
  type ConversationFile,
} from "../../lib/api";
import { formatConversationTime } from "../../lib/utils";
import { formatFileSize } from "../../services/fileUpload";

interface Props {
  files: ConversationFile[];
  open: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

function iconFor(contentType: string) {
  if (contentType.startsWith("image/"))
    return <FileImage className="h-4 w-4" />;
  if (contentType.startsWith("audio/"))
    return <FileAudio className="h-4 w-4" />;
  if (contentType.startsWith("video/"))
    return <FileVideo className="h-4 w-4" />;
  if (
    contentType.startsWith("text/") ||
    contentType === "application/pdf" ||
    contentType === "application/json"
  )
    return <FileText className="h-4 w-4" />;
  return <FileIcon className="h-4 w-4" />;
}

export function FilesPanel({ files, open, onClose, onRefresh }: Props) {
  const { t } = useTranslation("files");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  // Click-outside + Escape to close — same pattern as ThreadsPanel.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
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

  // Refresh on open so a just-uploaded file appears without re-entering.
  useEffect(() => {
    if (open) onRefresh().catch(() => {});
  }, [open, onRefresh]);

  if (!open) return null;

  const openFile = async (file: ConversationFile) => {
    setOpening(file.id);
    try {
      const { url } = await getFileDownloadUrl(file.id);
      // Programmatic anchor click instead of window.open — Tauri's
      // webview doesn't reliably forward window.open to the OS
      // browser, and browsers sometimes treat it as a popup. A
      // synthesized <a target="_blank"> mirrors what FileMessage
      // already does for inline downloads and opens consistently.
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      // Surfacing a toast here would require pulling in the toast
      // system; the chip silently no-ops on auth/network errors and
      // the user can retry.
    } finally {
      setOpening(null);
    }
  };

  return (
    <div
      ref={containerRef}
      className="absolute top-12 right-3 z-30 w-[360px] max-h-[480px] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-border">
        <div>
          <p className="text-sm font-semibold">{t("inThisChat")}</p>
          <p className="text-xs text-muted-foreground">
            {t("count", { count: files.length })}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={t("closePanel")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="max-h-[420px] overflow-y-auto py-1">
        {files.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            <Paperclip className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
            {t("emptyLabel")}
          </div>
        ) : (
          files.map((file) => (
            <button
              key={file.id}
              type="button"
              onClick={() => openFile(file)}
              disabled={opening !== null}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent disabled:opacity-50"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-primary">
                {iconFor(file.contentType)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {file.filename}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {formatFileSize(file.sizeBytes)} ·{" "}
                  {file.uploader?.displayName ?? t("common:unknown")} ·{" "}
                  {formatConversationTime(file.insertedAt)}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
