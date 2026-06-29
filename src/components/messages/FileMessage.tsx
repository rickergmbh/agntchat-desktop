import { useEffect, useState } from "react";
import { FileIcon, ImageIcon, Download, Loader2, ExternalLink } from "lucide-react";
import * as api from "../../lib/api";
import { formatFileSize } from "../../services/fileUpload";
import type { Message } from "../../lib/api";

interface FileContent {
  attachmentId?: string;
  filename?: string;
  contentType?: string;
  sizeBytes?: number;
  caption?: string;
}

function safeParseJson<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

function isImage(contentType?: string): boolean {
  return contentType?.startsWith("image/") ?? false;
}

function useDownloadUrl(attachmentId?: string, existingUrl?: string) {
  const [url, setUrl] = useState<string | null>(existingUrl ?? null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (existingUrl) {
      setUrl(existingUrl);
      return;
    }
    if (!attachmentId) return;

    setLoading(true);
    let cancelled = false;
    api
      .getFileDownloadUrl(attachmentId)
      .then((data) => {
        if (!cancelled) setUrl(data.url);
      })
      .catch((e) => {
        if (!cancelled) {
          console.warn("[FileMessage] download URL fetch failed", e);
          setUrl(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attachmentId, existingUrl]);

  return { url, loading };
}

/**
 * Compact, tappable chip for a file that rides along with a (non-"file")
 * text message — e.g. a paste-to-attachment .txt. Rendered below the
 * message body. Distinct from FileMessage, which renders a standalone
 * "file" message from its content JSON.
 */
export function AttachmentChip({
  attachmentId,
  filename,
  sizeBytes,
  downloadUrl,
}: {
  attachmentId: string;
  filename?: string;
  sizeBytes?: number;
  downloadUrl?: string;
}) {
  const { url, loading } = useDownloadUrl(attachmentId, downloadUrl);

  return (
    <a
      href={url ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2.5 rounded-lg border border-border p-2 transition-colors hover:bg-muted/50"
      onClick={(e) => {
        if (!url) e.preventDefault();
      }}
    >
      <FileIcon className="h-6 w-6 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{filename ?? "File"}</p>
        {sizeBytes ? <p className="text-xs opacity-75">{formatFileSize(sizeBytes)}</p> : null}
      </div>
      {loading ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      ) : url ? (
        <ExternalLink className="h-4 w-4 shrink-0" />
      ) : (
        <Download className="h-4 w-4 shrink-0" />
      )}
    </a>
  );
}

/**
 * Renders chips for files riding along with a (non-"file") text message.
 * Returns null when there are none, so it's safe to drop in any bubble.
 */
export function RideAlongAttachments({ message }: { message: Message }) {
  const attachments = message.fileAttachments;
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {attachments.map((att) => (
        <AttachmentChip
          key={att.id}
          attachmentId={att.id}
          filename={att.filename}
          sizeBytes={att.sizeBytes}
          downloadUrl={att.downloadUrl}
        />
      ))}
    </div>
  );
}

export function FileMessage({ message }: { message: Message }) {
  const file = safeParseJson<FileContent>(message.content, {
    filename: message.content,
  });
  const attachment = message.fileAttachments?.[0];
  const attachmentId = file.attachmentId ?? attachment?.id;
  const filename = file.filename ?? attachment?.filename ?? "File";
  const contentType = file.contentType ?? attachment?.contentType;
  const size = file.sizeBytes ?? attachment?.sizeBytes;
  const { url, loading } = useDownloadUrl(attachmentId, attachment?.downloadUrl);

  if (isImage(contentType)) {
    return (
      <div className="space-y-1">
        {loading ? (
          <div className="flex h-40 w-full items-center justify-center rounded-lg bg-muted/30">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : url ? (
          <a href={url} target="_blank" rel="noopener noreferrer">
            <img
              src={url}
              alt={filename}
              className="max-h-60 max-w-full rounded-lg object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </a>
        ) : (
          <div className="flex h-24 items-center justify-center rounded-lg bg-muted/30 text-xs text-muted-foreground">
            <ImageIcon className="mr-1.5 h-4 w-4" />
            {filename}
          </div>
        )}
        {file.caption && <p className="text-sm">{file.caption}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <a
        href={url ?? "#"}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 rounded-lg border border-border p-2.5 transition-colors hover:bg-muted/50"
        onClick={(e) => {
          if (!url) e.preventDefault();
        }}
      >
        <FileIcon className="h-8 w-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{filename}</p>
          {size && (
            <div className="text-xs opacity-75">
              {formatFileSize(size)}
            </div>
          )}
        </div>
        {loading ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        ) : url ? (
          <ExternalLink className="h-4 w-4 shrink-0" />
        ) : (
          <Download className="h-4 w-4 shrink-0" />
        )}
      </a>
      {file.caption && <p className="text-sm">{file.caption}</p>}
    </div>
  );
}

const FILE_TYPES = new Set(["FileMessage", "file"]);

export function isFileMessage(message: Message): boolean {
  const type = message.messageType || message.contentType || "";
  return FILE_TYPES.has(type);
}
