import * as api from "../lib/api";

/**
 * Ported from web/src/services/fileUpload.ts. Three-step upload:
 *   1. POST /conversations/:id/upload-url  → { uploadUrl, storageKey }
 *   2. PUT {uploadUrl} with the file body  → stores the blob
 *   3. POST /conversations/:id/files/confirm {storageKey, …} → server
 *      creates the file message.
 */

export interface PendingAttachment {
  file: File;
  previewUrl?: string;
  isImage: boolean;
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

const MAX_SIZE = 25 * 1024 * 1024;

export async function uploadFile(
  conversationId: string,
  file: File,
  caption?: string,
  // Audio only: the recorder measured this exactly, so players never have to
  // load the media just to show the clip length.
  durationMs?: number
): Promise<void> {
  if (file.size > MAX_SIZE) {
    throw new Error(`File too large (max ${formatFileSize(MAX_SIZE)})`);
  }

  const { uploadUrl, storageKey } = await api.requestUploadUrl(conversationId, {
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    sizeBytes: file.size,
  });

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!uploadResponse.ok) throw new Error("Upload to storage failed");

  await api.confirmUpload(conversationId, {
    storageKey,
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    caption,
    durationMs: durationMs && durationMs > 0 ? Math.round(durationMs) : undefined,
  });
}

/** A pre-uploaded object ready to ride along with a text message's
 *  `new_message` push (see ws.sendMessage `attachments`). */
export interface RideAlongAttachment {
  storageKey: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * Paste-to-attachment: a single paste longer than this many characters is
 * lifted out of the composer into a `.txt` attachment instead of bloating
 * the message body (and the agent's prompt). Mirrors how Claude turns a
 * large paste into a separate readable artifact. The agent reads it on
 * demand via the `read_attachment` tool rather than receiving it inline.
 */
export const PASTE_AS_FILE_THRESHOLD = 1500;

/**
 * Backing filename for a pasted-text attachment. Stable (no counter) — the
 * storage key carries a UUID so there's never a collision, and a friendly
 * label is shown in the UI instead of this raw name.
 */
export const PASTED_TEXT_FILENAME = "pasted-text.txt";

/** Friendly UI label for a pasted-text attachment (à la Claude's "Pasted text"). */
export const PASTED_TEXT_LABEL = "Pasted text";

/** Maps a stored filename to its display label — "Pasted text" for pasted
 *  blobs, the raw filename for everything else. */
export function attachmentDisplayName(filename?: string): string {
  return filename === PASTED_TEXT_FILENAME ? PASTED_TEXT_LABEL : filename || "File";
}

/**
 * Derives a filename for a pasted-text attachment from the pasted content's
 * first line, so the attachment chip previews what was pasted instead of a
 * generic label. Falls back to PASTED_TEXT_FILENAME (which renders as the
 * generic "Pasted text" label via attachmentDisplayName) when the paste has
 * no usable first line.
 */
export function pastedTextFilename(text: string): string {
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? "";
  const cleaned = firstLine.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return PASTED_TEXT_FILENAME;

  const MAX_TITLE_LENGTH = 60;
  const chars = Array.from(cleaned);
  const title =
    chars.length > MAX_TITLE_LENGTH ? `${chars.slice(0, MAX_TITLE_LENGTH).join("").trimEnd()}…` : cleaned;
  const base = title.replace(/\.+$/, "");
  return base ? `${base}.txt` : PASTED_TEXT_FILENAME;
}

/**
 * Uploads a pasted text blob through the presigned-upload flow and returns
 * its ride-along descriptor — WITHOUT confirming it as a standalone file
 * message. The caller includes the descriptor in the `attachments` array of
 * the normal `new_message` push so text + attachment land in one bubble.
 */
export async function uploadPastedText(
  conversationId: string,
  text: string,
  filename: string
): Promise<RideAlongAttachment> {
  const contentType = "text/plain";
  const blob = new Blob([text], { type: contentType });
  const sizeBytes = blob.size;

  const { uploadUrl, storageKey } = await api.requestUploadUrl(conversationId, {
    filename,
    contentType,
    sizeBytes,
  });

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
  });
  if (!uploadResponse.ok) throw new Error("Upload to storage failed");

  return { storageKey, filename, contentType, sizeBytes };
}
