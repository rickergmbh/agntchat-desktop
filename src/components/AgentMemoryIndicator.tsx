import { useTranslation } from "react-i18next";
import { PhaseOrb } from "./PhaseOrb";
import { cn } from "../lib/utils";

// Same orb + label grammar as AgentActivityIndicator, for a different signal:
// this agent saved something to memory since the list was last opened. The
// "connecting" orb state reads as "linking something up", which fits a
// memory save better than an undifferentiated dot did.
export function AgentMemoryIndicator({ className }: { className?: string }) {
  const { t } = useTranslation("memory");
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1 text-[11px] font-medium text-muted-foreground",
        className
      )}
    >
      <PhaseOrb state="connecting" className="shrink-0" />
      <span className="truncate">{t("recentlyRemembered")}</span>
    </span>
  );
}
