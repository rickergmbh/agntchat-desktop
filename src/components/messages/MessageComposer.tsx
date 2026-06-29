import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Paperclip, Send, X, Image as ImageIcon, FileIcon, Loader2 } from "lucide-react";
import {
  COMPOSER_PLACEHOLDER,
  COMPOSER_PLACEHOLDER_IMAGE,
  COMPOSER_PLACEHOLDER_FILE,
} from "../../lib/uiStrings";
import { useChatStore } from "../../stores/chatStore";
import { useAgentStore } from "../../stores/agentStore";
import { useAuthStore } from "../../stores/authStore";
import { ws } from "../../services/websocket";
import { Button } from "@/components/ui/button";
import { ReplyBanner } from "./ReplyBanner";
import {
  MentionPicker,
  extractMentionQuery,
  getMentionItems,
  insertMention,
  type MentionItem,
} from "./MentionPicker";
import {
  formatFileSize,
  isImageFile,
  uploadFile,
  uploadPastedText,
  PASTE_AS_FILE_THRESHOLD,
  PASTED_TEXT_FILENAME,
  PASTED_TEXT_LABEL,
  type PendingAttachment,
  type RideAlongAttachment,
} from "../../services/fileUpload";
import type { ConversationMember } from "../../lib/api";

const MAX_HEIGHT = 180;

interface PastedText {
  id: string;
  text: string;
  charCount: number;
}
// Stable singleton for the `members` selector fallback. Inlining `?? []`
// returns a fresh array each call, which trips Zustand v4's
// `useSyncExternalStore` snapshot equality check and loops React forever.
const EMPTY_MEMBERS: ConversationMember[] = [];

export function MessageComposer({ conversationId }: { conversationId: string }) {
  const draft = useChatStore((s) => s.drafts[conversationId] ?? "");
  const setDraft = useChatStore((s) => s.setDraft);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const replyingTo = useChatStore((s) => s.replyingTo[conversationId]);
  // Search both lists — inline agent threads live in `agentConversations`,
  // not `conversations`. Without the second branch the find returns
  // undefined for them and the `?? []` fallback loops.
  const members = useChatStore(
    (s) =>
      (s.conversations.find((c) => c.id === conversationId) ??
        s.agentConversations.find((c) => c.id === conversationId))
        ?.members ?? EMPTY_MEMBERS
  );
  const agentsMap = useAgentStore((s) => s.agents);
  // Stable flattened list to avoid the Zustand `?? []` selector trap.
  const agents = useMemo(
    () => Object.values(agentsMap).map((m) => m.agent),
    [agentsMap]
  );
  const currentUserId = useAuthStore((s) => s.participant?.id);

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  // Paste-to-attachment: large pasted text blobs lifted out of the composer
  // into pending .txt attachments (a removable pill each). Uploaded on send,
  // then ride along with the text message.
  const [pastedTexts, setPastedTexts] = useState<PastedText[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingAtRef = useRef(0);

  // Revoke the preview object URL on attachment change to avoid leaking blobs.
  useEffect(() => {
    return () => {
      if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    };
  }, [attachment?.previewUrl]);

  // Reset attachment when switching conversations
  useEffect(() => {
    setAttachment(null);
    setPastedTexts([]);
  }, [conversationId]);

  const attachFile = (file: File | null | undefined) => {
    if (!file) return;
    // Replace any existing attachment (revoke its preview URL first to avoid
    // leaking the Blob)
    setAttachment((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      const isImage = isImageFile(file);
      return {
        file,
        isImage,
        previewUrl: isImage ? URL.createObjectURL(file) : undefined,
      };
    });
    setError(null);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    attachFile(e.target.files?.[0]);
    // Reset so selecting the same file again re-triggers onChange
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const clearAttachment = () => {
    if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    setAttachment(null);
  };

  // Drag-and-drop: accept a single file drop anywhere on the composer.
  const [isDragOver, setIsDragOver] = useState(false);
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    setIsDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    // `dragleave` fires when moving between child elements; compare the
    // target against the container to avoid flicker.
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
  };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) attachFile(file);
  };

  // Paste-to-attach: if the clipboard contains an image (or any file),
  // intercept and attach it instead of letting the textarea paste junk.
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (items) {
      for (const item of Array.from(items)) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            attachFile(file);
            return;
          }
        }
      }
    }

    // Large text paste → lift into a .txt attachment instead of dumping it
    // into the composer (and the message body / agent prompt).
    const pasted = e.clipboardData?.getData("text") ?? "";
    if (pasted.length >= PASTE_AS_FILE_THRESHOLD) {
      e.preventDefault();
      setPastedTexts((prev) => [
        ...prev,
        { id: `paste:${Date.now()}:${prev.length}`, text: pasted, charCount: pasted.length },
      ]);
    }
  };

  // Derived list of current picker items (for keyboard selection)
  const mentionItems = useMemo(
    () =>
      mentionQuery == null
        ? []
        : getMentionItems(mentionQuery, members, agents, currentUserId),
    [mentionQuery, members, agents, currentUserId]
  );

  // Auto-resize textarea to fit content, capped at MAX_HEIGHT.
  // Keep `overflow-y: hidden` while content still fits — prevents WebKit from
  // reserving a scrollbar gutter on a single-line composer. Only flip to
  // `auto` once the textarea hits its cap and actual scrolling is needed.
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, MAX_HEIGHT);
    el.style.height = `${next}px`;
    el.style.overflowY = next >= MAX_HEIGHT ? "auto" : "hidden";
  }, []);

  useEffect(resizeTextarea, [draft, resizeTextarea]);

  // scrollHeight depends on the textarea's width (wrapping), so a height
  // measured in a narrow window goes stale when the window grows. Re-measure
  // on width changes only — reacting to height would feed back into the
  // observer, since the resize itself changes the height.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      const width = el.clientWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      resizeTextarea();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [resizeTextarea]);

  // Refocus when switching conversations or starting a reply
  useEffect(() => {
    textareaRef.current?.focus();
  }, [conversationId, replyingTo?.id]);

  const updateMention = (value: string, cursorPos: number) => {
    const q = extractMentionQuery(value, cursorPos);
    if (q !== mentionQuery) {
      setMentionQuery(q);
      setMentionIndex(0);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setDraft(conversationId, value);
    setError(null);
    updateMention(value, e.target.selectionStart ?? value.length);

    // Throttle typing events to ≥1s
    const now = Date.now();
    if (now - lastTypingAtRef.current > 1000) {
      ws.sendTyping(conversationId);
      lastTypingAtRef.current = now;
    }
  };

  const handleSelectionChange = () => {
    const el = textareaRef.current;
    if (!el) return;
    updateMention(el.value, el.selectionStart ?? el.value.length);
  };

  const commitMention = (item: MentionItem) => {
    const el = textareaRef.current;
    if (!el) return;
    const cursorPos = el.selectionStart ?? draft.length;
    const { text, cursor } = insertMention(draft, cursorPos, item.displayName);
    setDraft(conversationId, text);
    setMentionQuery(null);
    setMentionIndex(0);
    // Restore cursor position after React renders
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (node) {
        node.focus();
        node.setSelectionRange(cursor, cursor);
      }
    });
  };

  const handleSend = async () => {
    const text = draft.trim();
    const hasAttachment = attachment != null;
    const hasPastedTexts = pastedTexts.length > 0;
    if ((!text && !hasAttachment && !hasPastedTexts) || sending || uploading) return;
    setError(null);

    // If there's an attachment, upload it first. The server creates the file
    // message; any typed text is used as the caption. Send a separate text
    // message afterward if both content types are present and we want to
    // preserve threading — for now we just use caption.
    if (hasAttachment) {
      setUploading(true);
      try {
        await uploadFile(conversationId, attachment!.file, text || undefined);
        clearAttachment();
        useChatStore.getState().setDraft(conversationId, "");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
        setUploading(false);
        return;
      }
      setUploading(false);
      return;
    }

    // Paste-to-attachment ride-along: upload each pasted blob, then send the
    // text message with the attachment descriptors so they land in one bubble.
    if (hasPastedTexts) {
      setUploading(true);
      try {
        const uploaded: RideAlongAttachment[] = await Promise.all(
          pastedTexts.map((p) => uploadPastedText(conversationId, p.text, PASTED_TEXT_FILENAME))
        );
        await sendMessage(conversationId, text, {
          parentMessageId: replyingTo?.id,
          attachments: uploaded as unknown as Array<Record<string, unknown>>,
        });
        setPastedTexts([]);
        useChatStore.getState().setDraft(conversationId, "");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Attachment upload failed");
      } finally {
        setUploading(false);
      }
      return;
    }

    setSending(true);
    try {
      await sendMessage(conversationId, text, {
        parentMessageId: replyingTo?.id,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Mention picker owns keys while it's open
    if (mentionQuery != null && mentionItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionItems.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex(
          (i) => (i - 1 + mentionItems.length) % mentionItems.length
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        commitMention(mentionItems[mentionIndex]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === "Escape" && replyingTo) {
      e.preventDefault();
      useChatStore.getState().setReplyingTo(conversationId, null);
    }
  };

  const canSend =
    (draft.trim().length > 0 || attachment != null || pastedTexts.length > 0) &&
    !sending &&
    !uploading;

  return (
    <div
      className="surface-dock relative z-10 bg-card"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-t-md border-2 border-dashed border-primary/60 bg-primary/5">
          <p className="text-sm font-medium text-primary">
            Drop to attach
          </p>
        </div>
      )}
      {replyingTo && (
        <ReplyBanner conversationId={conversationId} message={replyingTo} />
      )}
      {attachment && (
        <AttachmentPreview
          attachment={attachment}
          uploading={uploading}
          onClear={clearAttachment}
        />
      )}
      {pastedTexts.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-border bg-muted/40 px-3 py-2">
          {pastedTexts.map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5">
              <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{PASTED_TEXT_LABEL}</p>
                <p className="text-[11px] text-muted-foreground">
                  {p.charCount.toLocaleString()} chars
                </p>
              </div>
              {!uploading && (
                <button
                  type="button"
                  onClick={() => setPastedTexts((prev) => prev.filter((x) => x.id !== p.id))}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="Remove pasted text"
                  aria-label="Remove pasted text"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="px-3 py-2.5">
        {error && <p className="text-[11px] text-destructive mb-1.5 px-1">{error}</p>}
        <div className="relative flex items-end gap-2">
          {mentionQuery != null && (
            <MentionPicker
              query={mentionQuery}
              members={members}
              allAgents={agents}
              currentUserId={currentUserId}
              selectedIndex={mentionIndex}
              onSelect={commitMention}
            />
          )}

          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*,.pdf,.doc,.docx,.txt,.md,.json,.csv,.xlsx,.zip"
            onChange={handleFileSelect}
          />
          <Button
            size="icon"
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || attachment != null}
            title="Attach file"
            type="button"
            className="text-muted-foreground"
          >
            <Paperclip className="w-4 h-4" />
          </Button>

          <textarea
            ref={textareaRef}
            value={draft}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onKeyUp={handleSelectionChange}
            onClick={handleSelectionChange}
            onPaste={handlePaste}
            placeholder={
              attachment
                ? attachment.isImage
                  ? COMPOSER_PLACEHOLDER_IMAGE
                  : COMPOSER_PLACEHOLDER_FILE
                : COMPOSER_PLACEHOLDER
            }
            rows={1}
            className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground scrollbar-autohide"
            style={{ maxHeight: MAX_HEIGHT }}
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!canSend}
            title="Send (Enter)"
          >
            {uploading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AttachmentPreview({
  attachment,
  uploading,
  onClear,
}: {
  attachment: PendingAttachment;
  uploading: boolean;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-border bg-muted/40 px-3 py-2">
      {attachment.isImage && attachment.previewUrl ? (
        <img
          src={attachment.previewUrl}
          alt={attachment.file.name}
          className="h-12 w-12 rounded-md object-cover shrink-0"
        />
      ) : (
        <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted shrink-0">
          {attachment.isImage ? (
            <ImageIcon className="h-5 w-5 text-muted-foreground" />
          ) : (
            <FileIcon className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{attachment.file.name}</p>
        <p className="text-[11px] text-muted-foreground">
          {formatFileSize(attachment.file.size)}
          {uploading && " · Uploading…"}
        </p>
      </div>
      <button
        type="button"
        onClick={onClear}
        disabled={uploading}
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        title="Remove attachment"
        aria-label="Remove attachment"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
