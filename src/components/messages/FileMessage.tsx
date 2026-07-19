import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileIcon, ImageIcon, Download, Loader2, ExternalLink, Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils";
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
  /** Whisper transcript, folded into the content JSON by the backend once
   *  transcription of an audio upload completes. */
  transcript?: string;
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

function isAudio(contentType?: string): boolean {
  return contentType?.startsWith("audio/") ?? false;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

/** Inline player for an audio file message (voice note), with the Whisper
 *  transcript from the message's content JSON rendered underneath. Mirrors
 *  AudioMessage in web/src/components/messages/FileMessage.tsx. */
function AudioMessage({
  url,
  loading,
  transcript,
  caption,
}: {
  url: string | null;
  loading: boolean;
  transcript?: string;
  caption?: string;
}) {
  const { t } = useTranslation("files");
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);

  const handleToggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  }, []);

  // MediaRecorder blobs (webm/opus) often carry no duration metadata and
  // report Infinity; forcing a seek to a huge offset makes the browser scan
  // the container and emit a real durationchange.
  const handleLoadedMetadata = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (Number.isFinite(audio.duration)) {
      setDuration(audio.duration);
    } else {
      const onSeeked = () => {
        audio.removeEventListener("seeked", onSeeked);
        audio.currentTime = 0;
      };
      audio.addEventListener("seeked", onSeeked);
      audio.currentTime = 1e10;
    }
  }, []);

  const handleSeek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const audio = audioRef.current;
      if (!audio || duration <= 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      audio.currentTime = fraction * duration;
    },
    [duration]
  );

  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  return (
    <div className="min-w-[220px] space-y-1.5">
      <div className="flex items-center gap-2.5">
        <button
          onClick={handleToggle}
          disabled={!url}
          aria-label={playing ? t("pauseVoiceNote") : t("playVoiceNote")}
          type="button"
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[1.5px] border-current",
            !url && "opacity-50"
          )}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : playing ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="ml-0.5 h-4 w-4" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t("voiceNote")}</p>
          <div
            className="mt-1.5 h-[3px] cursor-pointer rounded-full bg-current/20"
            onClick={handleSeek}
            role="slider"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(position)}
          >
            <div
              className="h-full rounded-full bg-current"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] tabular-nums opacity-70">
            {duration > 0
              ? `${formatTime(position)} / ${formatTime(duration)}`
              : formatTime(position)}
          </p>
        </div>
      </div>
      {url && (
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onLoadedMetadata={handleLoadedMetadata}
          onDurationChange={() => {
            const d = audioRef.current?.duration;
            if (d && Number.isFinite(d)) setDuration(d);
          }}
          onTimeUpdate={() => setPosition(audioRef.current?.currentTime ?? 0)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPosition(0);
            if (audioRef.current) audioRef.current.currentTime = 0;
          }}
        />
      )}
      {caption && <p className="text-sm">{caption}</p>}
      {transcript && (
        <button
          onClick={() => setTranscriptExpanded((v) => !v)}
          className="block w-full text-left"
          type="button"
        >
          <p className="text-[10px] font-bold uppercase tracking-wide opacity-60">
            {t("transcript")}
          </p>
          <p
            className={cn(
              "mt-0.5 whitespace-pre-wrap text-sm opacity-90",
              !transcriptExpanded && "line-clamp-3"
            )}
          >
            {transcript}
          </p>
        </button>
      )}
    </div>
  );
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

  if (isAudio(contentType)) {
    return (
      <AudioMessage
        url={url}
        loading={loading}
        transcript={file.transcript}
        caption={file.caption}
      />
    );
  }

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
