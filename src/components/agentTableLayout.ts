// Shared column layout for the agents table.
//
// The list renders inside a container-query context (the scrolling list is
// marked `@container` in Dashboard), so the grid responds to *its own* width
// rather than the viewport. As the list narrows — most notably when the agent
// detail pane laps over it on a laptop — columns drop progressively instead of
// overflowing and colliding under the pane:
//
//   narrow            Agent | Status | Actions
//   ≥ 600px  (+Mode)  Agent | Mode | Status | Actions
//   ≥ 840px  (+Engine)Agent | Engine | Mode | Status | Actions
//
// The header (Dashboard) and every row (AgentRow) MUST use these same strings
// so the column tracks and the cells that fill them stay in lockstep — the
// grid template and the cell visibility toggles share the same breakpoints.
export const AGENT_GRID_COLS =
  "grid grid-cols-[1fr_140px_56px] " +
  "@min-[600px]:grid-cols-[1fr_140px_140px_56px] " +
  "@min-[840px]:grid-cols-[1fr_180px_140px_140px_56px]";

// Engine cell — only shown at the widest tier.
export const AGENT_CELL_ENGINE = "hidden @min-[840px]:block";

// Mode cell — shown from the medium tier up.
export const AGENT_CELL_MODE = "hidden @min-[600px]:block";
