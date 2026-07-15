import { ChevronRight, Code2, FileCode2, FileText, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatRelativeShort } from "../../lib/utils";
import { useArtifactStore } from "../../stores/artifactStore";
import type { Artifact, ArtifactKind, ConversationMember } from "../../lib/api";

export function ArtifactKindIcon({
  kind,
  className = "h-4 w-4 text-primary",
}: {
  kind: ArtifactKind;
  className?: string;
}) {
  switch (kind) {
    case "code":
      return <Code2 className={className} />;
    case "html":
      return <Globe className={className} />;
    case "markdown":
      return <FileCode2 className={className} />;
    default:
      return <FileText className={className} />;
  }
}

/**
 * Inline artifact card rendered in the message stream at the artifact's
 * creation position. Shows title, kind, current version, and last-edited
 * time; clicking opens the full viewer. Driven by the artifact store, which
 * merges artifact_created / artifact_updated WS events — so the version and
 * timestamp update live in place. Mirrors web's ArtifactCard.
 */
export function ArtifactCard({
  artifact,
  members,
}: {
  artifact: Artifact;
  members?: ConversationMember[];
}) {
  const { t } = useTranslation("artifacts");
  const openViewer = useArtifactStore((s) => s.openViewer);

  const authorName = members?.find((m) => m.participantId === artifact.authorId)
    ?.participant?.displayName;
  const title = artifact.title?.trim() || t("untitled");
  const editedAt = artifact.updatedAt || artifact.insertedAt;

  return (
    <div className="flex w-full justify-start px-4 py-1">
      <button
        type="button"
        onClick={() => openViewer(artifact.id, artifact.conversationId)}
        className="group flex w-full max-w-2xl items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-surface-hover sm:w-[82%]"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
          <ArtifactKindIcon
            kind={artifact.kind}
            className="h-4 w-4 text-muted-foreground"
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5 text-xs">
            <span className="font-medium text-foreground">{t("badge")}</span>
            <span className="text-muted-foreground">
              {t("versionShort", { version: artifact.currentVersion })}
            </span>
          </span>
          <span className="line-clamp-2 text-sm font-medium text-foreground">
            {title}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {authorName ? `${t("by", { name: authorName })} · ` : ""}
            {t("edited", { time: formatRelativeShort(editedAt) })}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    </div>
  );
}
