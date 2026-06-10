import { Brain, Wrench, Pen, Search, Users, Loader2, type LucideIcon } from "lucide-react";

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
const ACTIVITY_LABELS: Record<AgentActivity, string> = {
  thinking: "Thinking",
  tool_call: "Using tools",
  writing: "Writing",
  analyzing: "Analyzing",
  waiting: "Waiting",
  working: "Working",
};

const ACTIVITY_ICONS: Record<AgentActivity, LucideIcon> = {
  thinking: Brain,
  tool_call: Wrench,
  writing: Pen,
  analyzing: Search,
  waiting: Users,
  working: Loader2,
};

export function activityLabel(activity: AgentActivity): string {
  return ACTIVITY_LABELS[activity] ?? "Working";
}

export function activityIcon(activity: AgentActivity): LucideIcon {
  return ACTIVITY_ICONS[activity] ?? Loader2;
}

// True when the activity represents the agent actively producing output
// (vs. passively waiting). Drives whether the indicator pulses/animates.
export function activityIsActive(activity: AgentActivity): boolean {
  return activity !== "waiting";
}
