import { useTranslation } from "react-i18next";
import { Zap } from "lucide-react";
import type { SessionConversationMeta } from "../../lib/api";
import { cn } from "../../lib/utils";

/** "claude-opus-5" → "opus-5": the canonical name minus the vendor prefix. */
function shortModel(model: string): string {
  return model.replace(/^claude-/, "");
}

/** Notification types a `waiting` session is blocked on that need the
 *  user's answer, not just their next message. */
const APPROVAL_BLOCKS = new Set(["permission_prompt", "elicitation_dialog"]);

type Tone = "working" | "ready" | "approval" | "off";

/** One label per session state (#148), chosen so it never reads like the
 *  delivery mode: Working (a turn is running), Ready (idle, your message
 *  starts the next turn), Needs approval (a permission dialog is open),
 *  Ended / Lost / Not linked. */
function describe(session: SessionConversationMeta): { key: string; tone: Tone } {
  const state = session.state ?? "unlinked";
  if (state === "running") return { key: "session.state.running", tone: "working" };
  if (state === "waiting" || state === "idle") {
    if (session.blocked_on && APPROVAL_BLOCKS.has(session.blocked_on)) {
      return { key: "session.state.approval", tone: "approval" };
    }
    return { key: "session.state.waiting", tone: "ready" };
  }
  if (state === "ended") return { key: "session.state.ended", tone: "off" };
  if (state === "lost") return { key: "session.state.lost", tone: "off" };
  return { key: "session.state.unlinked", tone: "off" };
}

const DOT: Record<Tone, string> = {
  working: "bg-success animate-pulse",
  ready: "bg-success",
  approval: "bg-warning",
  off: "bg-muted-foreground/40",
};

/** "● Ready · agntchat (main) ⚡" for a session conversation (#148): the list
 *  row's second line (`compact`) and the chat header's status line. The
 *  delivery mode is an icon with a tooltip when live and a short phrase
 *  when messages only arrive on the session's next turn — never a second
 *  word competing with the state. */
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
  const { key, tone } = describe(session);
  const alive = tone !== "off";
  const where = session.repo
    ? `${session.repo}${session.branch ? ` (${session.branch})` : ""}`
    : session.cwd?.split(/[\\/]/).filter(Boolean).slice(-1)[0];
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground", className)}>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[tone])} />
      <span className={cn("shrink-0", tone === "approval" && "font-medium text-warning")}>{t(key)}</span>
      {where && (
        <>
          <span className="text-muted-foreground/40">·</span>
          <span className={cn("truncate font-mono", compact ? "text-[10px]" : "text-[11px]")}>{where}</span>
        </>
      )}
      {alive && session.delivery === "live" && (
        <span className="inline-flex shrink-0" title={t("session.delivery.liveHint")}>
          <Zap className="h-3 w-3 fill-success/30 text-success" aria-label={t("session.delivery.liveHint")} />
        </span>
      )}
      {!compact && alive && session.delivery === "next_turn" && (
        <>
          <span className="text-muted-foreground/40">·</span>
          <span className="shrink-0">{t("session.delivery.nextTurn")}</span>
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
    </span>
  );
}
