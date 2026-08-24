import { useTranslation } from "react-i18next";
import { PhaseOrb } from "./PhaseOrb";
import { cn } from "../lib/utils";
import {
  activityLabelKey,
  activityIsActive,
  type AgentActivity,
} from "../lib/agent-activity";

// Compact activity readout: a thinking orb + short label
// ("Thinking", "Writing", "Working"…). Rendered wherever an agent's live
// status should show across the platform — conversation rows, chat header,
// agent rows. Pure presentational; the caller supplies the activity from
// presenceStore.agentActivity.
export function AgentActivityIndicator({
  activity,
  className,
  iconClassName,
  showLabel = true,
}: {
  activity: AgentActivity;
  className?: string;
  iconClassName?: string;
  showLabel?: boolean;
}) {
  const { t } = useTranslation("chat");
  const active = activityIsActive(activity);
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1 text-[11px] font-medium text-primary",
        className
      )}
    >
      <PhaseOrb
        phase={activity}
        active={active}
        className={cn("shrink-0", iconClassName)}
      />
      {showLabel && <span className="truncate">{t(activityLabelKey(activity))}</span>}
    </span>
  );
}
