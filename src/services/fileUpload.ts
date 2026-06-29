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
  caption?: string
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
