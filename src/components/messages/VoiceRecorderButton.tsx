import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { uploadFile } from "../../services/fileUpload";
import { Loader2, Mic, SendHorizontal, X } from "lucide-react";

/**
 * Container preference for MediaRecorder, most-compatible first. The
 * extension must be on the backend's upload allowlist (.m4a/.ogg/.opus are;
 * .webm is not) — for the opus-in-webm fallback the file is named .opus,
 * which the backend accepts and ffmpeg/Whisper decode by sniffing the
 * container, not the name. In the Tauri webview: WKWebView (macOS) takes
 * audio/mp4, WebView2 (Windows) takes webm/opus.
 */
const RECORDING_FORMATS = [
  { mime: "audio/mp4", ext: "m4a" },
  { mime: "audio/ogg;codecs=opus", ext: "ogg" },
  { mime: "audio/webm;codecs=opus", ext: "opus" },
];

// Recordings shorter than this are treated as an accidental click and
// discarded rather than sent as a contentless blip.
const MIN_DURATION_MS = 500;

function pickRecordingFormat() {
  if (typeof MediaRecorder === "undefined") return null;
  return RECORDING_FORMATS.find((f) => MediaRecorder.isTypeSupported(f.mime)) ?? null;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, "0")}`;
}

interface VoiceRecorderButtonProps {
  conversationId: string;
  /** Mirrors the recording state up so the composer can hide the textarea
   *  while the recording bar occupies the row. */
  onActiveChange: (active: boolean) => void;
  onError: (message: string) => void;
}

/**
 * Voice note recorder for the desktop composer. Click the mic to start; a
 * recording bar with a live timer replaces the composer. Send stops the
 * recorder and ships the blob through the normal presigned upload flow
 * (the backend transcribes it); X discards. MediaRecorder-based — mirrors
 * web/src/components/VoiceRecorderButton.tsx.
 */
export function VoiceRecorderButton({
  conversationId,
  onActiveChange,
  onError,
}: VoiceRecorderButtonProps) {
  const { t } = useTranslation("chat");
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Decided at stop time, read inside onstop: send or discard.
  const sendOnStopRef = useRef(false);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    setRecording(false);
    setElapsedMs(0);
    onActiveChange(false);
  }, [onActiveChange]);

  // Unmount mid-recording — release the mic.
  useEffect(() => cleanup, [cleanup]);

  const startRecording = useCallback(async () => {
    if (recording || uploading) return;
    const format = pickRecordingFormat();
    if (!format) {
      onError(t("voice.notSupported"));
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError(t("voice.micDenied"));
      return;
    }

    const recorder = new MediaRecorder(stream, {
      mimeType: format.mime,
      audioBitsPerSecond: 64000,
    });
    streamRef.current = stream;
    recorderRef.current = recorder;
    chunksRef.current = [];
    sendOnStopRef.current = false;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = async () => {
      const durationMs = Date.now() - startedAtRef.current;
      const send = sendOnStopRef.current && durationMs >= MIN_DURATION_MS;
      // The presign/confirm flow validates the extensionful filename; the
      // contentType is the codec-less base mime (the backend keys
      // transcription off the audio/* prefix).
      const contentType = format.mime.split(";")[0]!;
      const blob = new Blob(chunksRef.current, { type: contentType });
      cleanup();
      if (!send || blob.size === 0) return;

      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
      const file = new File([blob], `voice-note-${stamp}.${format.ext}`, {
        type: contentType,
      });
      setUploading(true);
      try {
        await uploadFile(conversationId, file);
      } catch (err) {
        onError(err instanceof Error ? err.message : t("files:uploadFailed"));
      } finally {
        setUploading(false);
      }
    };

    startedAtRef.current = Date.now();
    setElapsedMs(0);
    recorder.start();
    setRecording(true);
    onActiveChange(true);
    timerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 250);
  }, [recording, uploading, conversationId, onActiveChange, onError, cleanup, t]);

  const stopRecording = useCallback((send: boolean) => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    sendOnStopRef.current = send;
    recorder.stop();
  }, []);

  if (recording) {
    return (
      <>
        <div className="flex h-9 flex-1 items-center gap-2 rounded-lg border border-input bg-background px-3">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500" />
          <span className="text-sm font-medium tabular-nums">{formatElapsed(elapsedMs)}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {t("voice.recording")}
          </span>
          <button
            onClick={() => stopRecording(false)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={t("voice.cancelRecording")}
            title={t("voice.cancelRecording")}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <Button
          size="icon"
          onClick={() => stopRecording(true)}
          aria-label={t("voice.send")}
          title={t("voice.send")}
          type="button"
        >
          <SendHorizontal className="h-4 w-4" />
        </Button>
      </>
    );
  }

  return (
    <Button
      size="icon"
      onClick={startRecording}
      disabled={uploading}
      aria-label={t("voice.record")}
      title={t("voice.record")}
      type="button"
    >
      {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
    </Button>
  );
}
