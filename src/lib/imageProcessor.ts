import { fetchAvatarPolicy, presignAvatarUpload, type AvatarPolicy } from "./api";

const FALLBACK: AvatarPolicy = {
  maxBytes: 750_000,
  targetSize: 512,
  format: "image/webp",
  quality: 0.85,
};

const SUPPORTED_ENCODE_FORMATS = ["image/jpeg", "image/png", "image/webp"];

let cache: AvatarPolicy | null = null;
let pending: Promise<AvatarPolicy> | null = null;

export async function getAvatarPolicy(): Promise<AvatarPolicy> {
  if (cache) return cache;
  if (pending) return pending;

  pending = fetchAvatarPolicy()
    .then((policy) => {
      cache = policy;
      return policy;
    })
    .catch(() => {
      // Cache the fallback so a backend outage doesn't refire on every pick.
      cache = FALLBACK;
      return FALLBACK;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

export function resetAvatarPolicyCache(): void {
  cache = null;
  pending = null;
}

function extensionFor(format: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  return map[format] ?? "jpg";
}

async function decode(file: File | Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Older webviews fall back to Image() — note this does NOT respect
      // EXIF orientation on every browser. Acceptable trade-off for now.
      console.warn("[avatar] createImageBitmap failed; falling back to Image() (EXIF may be ignored)");
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not read image"));
      image.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function dimensionsOf(source: ImageBitmap | HTMLImageElement): { w: number; h: number } {
  if (source instanceof HTMLImageElement) {
    return { w: source.naturalWidth, h: source.naturalHeight };
  }
  return { w: source.width, h: source.height };
}

function encode(canvas: HTMLCanvasElement, format: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error(`Canvas couldn't encode as ${format}`))),
      format,
      quality
    );
  });
}

export interface ProcessedAvatar {
  blob: Blob;
  contentType: string;
  size: number;
}

/**
 * Center-crop to square, resize to policy.targetSize, encode to policy.format.
 * Only when the resolved encode format is JPEG do we pre-fill the canvas white
 * (JPEG can't carry transparency); WebP/PNG keep their alpha channel.
 * Retries once at quality 0.7 if the policy quality overshoots maxBytes.
 */
export async function processAvatarFile(file: File | Blob): Promise<ProcessedAvatar> {
  const policy = await getAvatarPolicy();
  const format = SUPPORTED_ENCODE_FORMATS.includes(policy.format)
    ? policy.format
    : "image/jpeg";
  if (format !== policy.format) {
    console.warn(`[avatar] webview can't encode ${policy.format}; falling back to JPEG. maxBytes budget may be off.`);
  }

  const source = await decode(file);
  const { w, h } = dimensionsOf(source);
  const side = Math.min(w, h);
  const sx = Math.round((w - side) / 2);
  const sy = Math.round((h - side) / 2);

  const canvas = document.createElement("canvas");
  canvas.width = policy.targetSize;
  canvas.height = policy.targetSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2d context unavailable");

  // Only JPEG needs the white matte; the resolved `format` may differ from
  // policy.format if the webview can't encode it (see fallback above).
  if (format === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, policy.targetSize, policy.targetSize);
  }
  ctx.drawImage(source, sx, sy, side, side, 0, 0, policy.targetSize, policy.targetSize);

  let blob = await encode(canvas, format, policy.quality);
  if (blob.size > policy.maxBytes) {
    blob = await encode(canvas, format, 0.7);
  }
  if (blob.size > policy.maxBytes) {
    const limitKb = Math.round(policy.maxBytes / 1024);
    throw new Error(`Image exceeds ${limitKb} KB after compression — try a smaller or simpler image.`);
  }

  return { blob, contentType: format, size: blob.size };
}

/**
 * One-shot for paths that DON'T have their own crop UI: process the file
 * (resize + alpha-flatten + encode), presign, PUT, return cache-busted URL.
 */
export async function uploadAvatar(file: File | Blob, basePath: string): Promise<string> {
  const processed = await processAvatarFile(file);
  return uploadProcessedBlob(processed.blob, processed.contentType, basePath);
}

/**
 * Upload an already-processed blob (e.g. produced by the AvatarCropDialog
 * canvas). Skips the redundant Canvas pass that `uploadAvatar` does.
 */
export async function uploadProcessedBlob(
  blob: Blob,
  contentType: string,
  basePath: string
): Promise<string> {
  const policy = await getAvatarPolicy();
  const filename = `${basePath}.${extensionFor(policy.format)}`;

  const { url: uploadUrl, publicUrl } = await presignAvatarUpload(
    filename,
    contentType,
    blob.size
  );

  const res = await fetch(uploadUrl, {
    method: "PUT",
    body: blob,
    headers: { "Content-Type": contentType },
  });
  if (!res.ok) throw new Error("Upload failed");

  // Cache-buster appended at upload time — caller can persist this URL or
  // strip the `?t=` before persisting if they prefer applying it at display.
  return `${publicUrl}?t=${Date.now()}`;
}
