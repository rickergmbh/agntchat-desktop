import type { LucideIcon } from "lucide-react";
import {
  ACTIVITY_FALLBACK_LABEL_KEY,
  ACTIVITY_LABEL_KEYS,
  PHASE_ICONS,
  PHASE_IS_ACTIVE,
  type AgentActivity,
} from "./status-contract.generated";

// Global per-agent activity, broadcast platform-wide via the
// `agent_activity_changed` user-channel event. Vocabulary, icons, and label
// keys come from the shared status contract (/status-contract/contract.json)
// so all clients render identical affordances. Absence = idle.
export type { AgentActivity };

/** Returns the i18n key for an activity's compact label — NOT the resolved
 *  string. React callers: `t(activityLabelKey(activity))`. */
export function activityLabelKey(activity: AgentActivity): string {
  return ACTIVITY_LABEL_KEYS[activity] ?? ACTIVITY_FALLBACK_LABEL_KEY;
}

export function activityIcon(activity: AgentActivity): LucideIcon {
  return PHASE_ICONS[activity] ?? PHASE_ICONS.working;
}

// True when the activity represents the agent actively producing output
// (vs. passively waiting). Drives whether the indicator pulses/animates.
export function activityIsActive(activity: AgentActivity): boolean {
  return PHASE_IS_ACTIVE[activity] ?? true;
}
