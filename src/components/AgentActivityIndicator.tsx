import { cn } from "../lib/utils";
import {
  activityIcon,
  activityLabel,
  activityIsActive,
  type AgentActivity,
} from "../lib/agent-activity";

// Compact activity readout: an animated icon + short label
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
  const Icon = activityIcon(activity);
  const active = activityIsActive(activity);
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1 text-[11px] font-medium text-primary",
        className
      )}
    >
      <Icon className={cn("h-3 w-3 shrink-0", active && "animate-pulse", iconClassName)} />
      {showLabel && <span className="truncate">{activityLabel(activity)}</span>}
    </span>
  );
}
