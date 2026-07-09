import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useArtifactStore } from "../../stores/artifactStore";
import { ArtifactKindIcon } from "./ArtifactCard";
import { ArtifactsPanel } from "./ArtifactsPanel";

/**
 * Header chip: layers icon + artifact count. Lives in the conversation
 * header next to the threads/files chips — never floating over message
 * content. Hidden when the conversation has no artifacts. Clicking opens
 * the dropdown panel (anchored below the chip); picking an artifact opens
 * the right-docked viewer.
 *
 * Counts stay live via the artifact store, which merges artifact_created /
 * artifact_updated WS events.
 */
export function ArtifactsBar({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation("artifacts");
  const [open, setOpen] = useState(false);

  const artifacts = useArtifactStore((s) => s.artifacts[conversationId]);
  const fetchArtifactsIfNeeded = useArtifactStore(
    (s) => s.fetchArtifactsIfNeeded
  );

  // Make sure the list is loaded so the chip can decide whether to render —
  // message-stream ArtifactCards also trigger this, but the chip must work
  // even when the creation message is scrolled out of the loaded window.
  useEffect(() => {
    fetchArtifactsIfNeeded(conversationId).catch(() => {});
  }, [conversationId, fetchArtifactsIfNeeded]);

  const count = artifacts?.length ?? 0;
  if (count === 0) return null;

  const chipLabel = t("count", { count });

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 items-center gap-1.5 rounded-md border border-border-strong px-2 text-[11px] font-semibold text-primary transition-colors hover:bg-accent"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        aria-expanded={open}
        aria-label={chipLabel}
        title={chipLabel}
      >
        {/* Same icon family as the in-stream ArtifactCards ("document" is
            the ArtifactKindIcon default) so the chip and the cards read as
            the same thing. */}
        <ArtifactKindIcon kind="document" className="h-3.5 w-3.5" />
        <span>{count}</span>
      </button>

      <ArtifactsPanel
        conversationId={conversationId}
        artifacts={artifacts ?? []}
        open={open}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
