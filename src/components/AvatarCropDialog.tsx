import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import Cropper, { type Area } from "react-easy-crop";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut } from "lucide-react";
import { getAvatarPolicy } from "../lib/imageProcessor";

interface AvatarCropDialogProps {
  open: boolean;
  imageSrc: string;
  onClose: () => void;
  onConfirm: (blob: Blob) => void;
}

const SUPPORTED_FORMATS = ["image/jpeg", "image/png", "image/webp"];

type Translate = (key: string, opts?: Record<string, unknown>) => string;

async function cropImage(
  imageSrc: string,
  pixelCrop: Area,
  t: Translate
): Promise<Blob> {
  const policy = await getAvatarPolicy();
  // Tauri webviews (WebKit on macOS, WebView2 on Windows) don't all support
  // every encoding format. Whitelist what we know works; fall back to JPEG.
  const format = SUPPORTED_FORMATS.includes(policy.format)
    ? policy.format
    : "image/jpeg";

  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(t("avatar.crop.errors.readFailed")));
    image.src = imageSrc;
  });

  const canvas = document.createElement("canvas");
  canvas.width = policy.targetSize;
  canvas.height = policy.targetSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(t("avatar.crop.errors.canvasUnavailable"));

  // Only JPEG needs a white matte (it can't carry alpha); WebP/PNG keep
  // their transparency. Keys off the resolved `format`, which may have
  // fallen back to JPEG if the webview can't encode policy.format.
  if (format === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, policy.targetSize, policy.targetSize);
  }

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    policy.targetSize,
    policy.targetSize
  );

  const encode = (q: number) =>
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) =>
          b
            ? resolve(b)
            : reject(new Error(t("avatar.crop.errors.encodeFailed", { format }))),
        format,
        q
      );
    });

  let blob = await encode(policy.quality);
  if (blob.size > policy.maxBytes) blob = await encode(0.7);
  if (blob.size > policy.maxBytes) {
    const limitKb = Math.round(policy.maxBytes / 1000);
    throw new Error(t("avatar.crop.errors.tooLarge", { limitKb }));
  }

  return blob;
}

export function AvatarCropDialog({
  open,
  imageSrc,
  onClose,
  onConfirm,
}: AvatarCropDialogProps) {
  const { t } = useTranslation("agents");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
    // Clear stale error so the user gets a clean state when they adjust
    // crop/zoom after a previous failed save.
    setError(null);
  }, []);

  const handleSave = async () => {
    if (!croppedAreaPixels) return;
    setError(null);
    setSaving(true);
    try {
      const blob = await cropImage(imageSrc, croppedAreaPixels, t);
      onConfirm(blob);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("avatar.crop.errors.failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("avatar.crop.title")}</DialogTitle>
        </DialogHeader>

        <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-black/90">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        <div className="flex items-center gap-3 px-1">
          <ZoomOut className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label={t("avatar.crop.zoomLabel")}
            className="flex-1 h-1.5 accent-primary cursor-pointer"
          />
          <ZoomIn className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        </div>

        {error && (
          <p className="text-xs text-destructive px-1">{error}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("common:cancel")}
          </Button>
          <Button onClick={handleSave} disabled={saving || !croppedAreaPixels}>
            {saving ? t("common:saving") : t("common:save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
