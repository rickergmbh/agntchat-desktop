import { useTranslation } from "react-i18next";
import { Terminal } from "lucide-react";
import type { SessionConversationMeta } from "../../lib/api";
import { cn } from "../../lib/utils";

const STATE_KEYS: Record<string, string> = {
  running: "session.state.running",
  waiting: "session.state.waiting",
  idle: "session.state.idle",
  ended: "session.state.ended",
  lost: "session.state.lost",
  unlinked: "session.state.unlinked",
};

/** "claude-opus-5" → "opus-5": the canonical name minus the vendor prefix. */
function shortModel(model: string): string {
  return model.replace(/^claude-/, "");
}

/** "● Running · agntchat (main)" for a session conversation (#148): the
 *  list row's second line and the chat header's status line. */
export function SessionStateLine({
  session,
  compact = false,
  className,
}: {
  session: SessionConversationMeta;
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation("chat");
  const state = session.state ?? "unlinked";
  const live = state === "running";
  const idle = state === "waiting" || state === "idle";
  const where = session.repo
    ? `${session.repo}${session.branch ? ` (${session.branch})` : ""}`
    : session.cwd?.split(/[\\/]/).filter(Boolean).slice(-1)[0];
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground", className)}>
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          live ? "bg-success" : idle ? "bg-warning" : "bg-muted-foreground/40"
        )}
      />
      <span className="shrink-0">{t(STATE_KEYS[state] ?? "session.state.unlinked")}</span>
      {where && (
        <>
          <span className="text-muted-foreground/40">·</span>
          <span className={cn("truncate font-mono", compact ? "text-[10px]" : "text-[11px]")}>{where}</span>
        </>
      )}
      {!compact && session.delivery && state !== "ended" && state !== "unlinked" && (
        <>
          <span className="text-muted-foreground/40">·</span>
          <span className={cn("shrink-0", session.delivery === "live" ? "text-success" : "")}>
            {session.delivery === "live" ? t("session.delivery.live") : t("session.delivery.nextTurn")}
          </span>
        </>
      )}
      {!compact && session.model && (
        <>
          <span className="text-muted-foreground/40">·</span>
          <span className="shrink-0 font-mono text-[10px]">
            {shortModel(session.model)}
            {session.effort ? ` · ${session.effort}` : ""}
          </span>
        </>
      )}
      {!compact && <Terminal className="h-3 w-3 shrink-0 text-muted-foreground/60" />}
    </span>
  );
}
