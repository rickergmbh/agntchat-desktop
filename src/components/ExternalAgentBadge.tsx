import { Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";

/**
 * "Claude Code" / "Codex" chip (#148) for an agent that is a CLI session
 * the owner drives, not an agntchat-run agent. Shown wherever an agent's
 * name/status appears — conversation rows, chat headers, member lists — so
 * it never passes for a hosted agent. Web twin: web/src/components/ExternalAgentBadge.tsx.
 */
export function ExternalAgentBadge({ tool, className }: { tool?: string | null; className?: string }) {
  const { t } = useTranslation("agents");
  return (
    <span
      className={cn(
        // Same quiet chip as the member-count badge on group rows: it names
        // the CLI without shouting, and sits right after the name.
        "inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground",
        className
      )}
      title={t("row.externalHint")}
    >
      <Terminal className="h-2.5 w-2.5" />
      {externalToolLabel(tool, t)}
    </span>
  );
}

/** Names the CLI behind an external agent — "Claude Code", "Codex" — or
 *  falls back to "External" when the tool is unknown. */
export function externalToolLabel(tool: string | null | undefined, t: (key: string) => string): string {
  if (tool === "claude_code") return t("hosting.externalTool.claude_code");
  if (tool === "codex") return t("hosting.externalTool.codex");
  return t("hosting.external");
}

/** The CLI a conversation with an external agent runs on: the session
 *  conversation's own tool when it has one, else the identity's latest. */
export function externalToolOf(
  conversation: { metadata?: Record<string, unknown> | null } | null | undefined,
  participant: { externalTool?: string | null } | null | undefined
): string | null | undefined {
  const session = conversation?.metadata?.session as { tool?: string } | undefined;
  return session?.tool ?? participant?.externalTool;
}

/** True when a serialized participant/agent is an external agent. */
export function isExternalAgent(p: { type?: string; runtime?: string | null } | null | undefined): boolean {
  return !!p && p.type === "agent" && p.runtime === "external";
}
