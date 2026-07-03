import { Brain, Wrench, Pen, Search, Users, Activity, type LucideIcon } from "lucide-react";

// Global per-agent activity, broadcast platform-wide via the
// `agent_activity_changed` user-channel event. Mirrors the backend's
// effective-activity set: the streaming phases we surface plus "working"
// (assigned an active task but not actively streaming). Absence = idle.
//
// Same vocabulary as StreamPhase, plus "working". Does NOT include "queued"
// (that means offline, an online/offline signal, not an activity).
export type AgentActivity =
  | "thinking"
  | "tool_call"
  | "writing"
  | "analyzing"
  | "waiting"
  | "working";

// Short labels for compact surfaces (conversation rows, agent rail). The
// streaming bubble keeps its own "…"-suffixed labels; these are terser so
// they fit a one-line status under a name.
//
// These are i18n KEYS (fully namespace-qualified), not resolved strings —
// this module has no React context to call t() from. Uses the terse
// chat:activity.* set (distinct from the verbose chat:streamAnnounce.*
// screen-reader announcements). React callers: `t(activityLabelKey(a))`.
const ACTIVITY_LABEL_KEYS: Record<AgentActivity, string> = {
  thinking: "chat:activity.thinking",
  tool_call: "chat:activity.toolCall",
  writing: "chat:activity.writing",
  analyzing: "chat:activity.analyzing",
  waiting: "chat:activity.waiting",
  working: "chat:activity.working",
};

const ACTIVITY_ICONS: Record<AgentActivity, LucideIcon> = {
  thinking: Brain,
  tool_call: Wrench,
  writing: Pen,
  analyzing: Search,
  waiting: Users,
  working: Activity,
};

/** Returns the i18n key for an activity's compact label — NOT the resolved
 *  string. React callers: `t(activityLabelKey(activity))`. */
export function activityLabelKey(activity: AgentActivity): string {
  return ACTIVITY_LABEL_KEYS[activity] ?? "chat:activity.working";
}

export function activityIcon(activity: AgentActivity): LucideIcon {
  return ACTIVITY_ICONS[activity] ?? Activity;
}

// True when the activity represents the agent actively producing output
// (vs. passively waiting). Drives whether the indicator pulses/animates.
export function activityIsActive(activity: AgentActivity): boolean {
  return activity !== "waiting";
}
