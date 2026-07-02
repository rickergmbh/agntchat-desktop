import { useEffect, useState } from "react";
import { FileIcon, ImageIcon, Download, Loader2, ExternalLink } from "lucide-react";
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import * as api from "../../lib/api";
import { formatFileSize, attachmentDisplayName } from "../../services/fileUpload";
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
  const displayName = attachmentDisplayName(filename);

  return (
    // "processing" while the signed download URL resolves — shimmers the title.
    <Attachment size="sm" state={loading ? "processing" : "done"} className="w-full">
      <AttachmentMedia>
        <FileIcon />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{displayName}</AttachmentTitle>
        {sizeBytes ? (
          <AttachmentDescription>{formatFileSize(sizeBytes)}</AttachmentDescription>
        ) : null}
      </AttachmentContent>
      <div className="relative z-20 flex shrink-0 items-center pr-1 text-muted-foreground">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : url ? (
          <ExternalLink className="h-4 w-4" />
        ) : (
          <Download className="h-4 w-4" />
        )}
      </div>
      <AttachmentTrigger
        aria-label={`Open ${displayName}`}
        render={
          <a
            href={url ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              if (!url) e.preventDefault();
            }}
          />
        }
      />
    </Attachment>
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
    // Every state (loading / loaded / error) renders inside the same
    // fixed-height frame so the async URL fetch + image decode never change
    // the bubble's height — a mid-thread image loading used to shift the
    // whole conversation under the reader.
    return (
      <div className="space-y-1">
        <div className="h-60 max-w-full">
          {loading ? (
            <div className="flex h-full w-full items-center justify-center rounded-lg bg-muted/30">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : url ? (
            <a href={url} target="_blank" rel="noopener noreferrer" className="block h-full">
              <img
                src={url}
                alt={filename}
                className="h-full max-w-full rounded-lg object-contain object-left"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </a>
          ) : (
            <div className="flex h-full items-center justify-center rounded-lg bg-muted/30 text-xs text-muted-foreground">
              <ImageIcon className="mr-1.5 h-4 w-4" />
              {filename}
            </div>
          )}
        </div>
        {file.caption && <p className="text-sm">{file.caption}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Attachment state={loading ? "processing" : "done"} className="w-full">
        <AttachmentMedia>
          <FileIcon />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>{filename}</AttachmentTitle>
          {size ? (
            <AttachmentDescription>{formatFileSize(size)}</AttachmentDescription>
          ) : null}
        </AttachmentContent>
        <div className="relative z-20 flex shrink-0 items-center pr-1 text-muted-foreground">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : url ? (
            <ExternalLink className="h-4 w-4" />
          ) : (
            <Download className="h-4 w-4" />
          )}
        </div>
        <AttachmentTrigger
          aria-label={`Open ${filename}`}
          render={
            <a
              href={url ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                if (!url) e.preventDefault();
              }}
            />
          }
        />
      </Attachment>
      {file.caption && <p className="text-sm">{file.caption}</p>}
    </div>
  );
}

const FILE_TYPES = new Set(["FileMessage", "file"]);

export function isFileMessage(message: Message): boolean {
  const type = message.messageType || message.contentType || "";
  return FILE_TYPES.has(type);
}
