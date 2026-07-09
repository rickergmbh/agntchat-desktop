import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Artifact } from "../../lib/api";
import { formatRelativeShort } from "../../lib/utils";
import { useArtifactStore } from "../../stores/artifactStore";
import { ArtifactKindIcon } from "./ArtifactCard";

interface Props {
  conversationId: string;
  artifacts: Artifact[];
  open: boolean;
  onClose: () => void;
}

const KIND_LABEL_KEY: Record<string, string> = {
  document: "kindDocument",
  markdown: "kindMarkdown",
  code: "kindCode",
  html: "kindHtml",
  text: "kindText",
};

/**
 * Dropdown behind the header ArtifactsBar chip: every artifact in the
 * conversation, newest first, with kind + version + last-edited time.
 * Picking one opens the right-docked ArtifactViewer. Same anchor + dismiss
 * behavior as ThreadsPanel / FilesPanel.
 */
export function ArtifactsPanel({ conversationId, artifacts, open, onClose }: Props) {
  const { t } = useTranslation("artifacts");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const openViewer = useArtifactStore((s) => s.openViewer);

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

  if (!open) return null;

  return (
    <div
      ref={containerRef}
      className="absolute right-0 top-full z-30 mt-2 w-[360px] max-h-[480px] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-border">
        <div>
          <p className="text-sm font-semibold">{t("inThisChat")}</p>
          <p className="text-xs text-muted-foreground">
            {t("count", { count: artifacts.length })}
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
        {artifacts.map((artifact) => (
          <button
            key={artifact.id}
            type="button"
            onClick={() => {
              openViewer(artifact.id, conversationId);
              onClose();
            }}
            className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/15">
              <ArtifactKindIcon kind={artifact.kind} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">
                {artifact.title?.trim() || t("untitled")}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {t(KIND_LABEL_KEY[artifact.kind] ?? "kindText")} ·{" "}
                {t("versionShort", { version: artifact.currentVersion })} ·{" "}
                {t("edited", {
                  time: formatRelativeShort(
                    artifact.updatedAt || artifact.insertedAt
                  ),
                })}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
