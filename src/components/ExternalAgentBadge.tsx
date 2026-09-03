import { Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";

/**
 * "External" chip (#148) for an agent that is a Claude Code / Codex session
 * the owner drives, not an agntchat-run agent. Shown wherever an agent's
 * name/status appears — conversation rows, chat headers, member lists — so
 * it never passes for a hosted agent. Web twin: web/src/components/ExternalAgentBadge.tsx.
 */
export function ExternalAgentBadge({ className }: { className?: string }) {
  const { t } = useTranslation("agents");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-sm border border-warning/40 bg-warning/10 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-warning",
        className
      )}
      title={t("row.externalHint")}
    >
      <Terminal className="h-2.5 w-2.5" />
      {t("hosting.external")}
    </span>
  );
}

/** True when a serialized participant/agent is an external agent. */
export function isExternalAgent(p: { type?: string; runtime?: string | null } | null | undefined): boolean {
  return !!p && p.type === "agent" && p.runtime === "external";
}
