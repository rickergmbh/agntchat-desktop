// Shared column layout for the agents table.
//
// The list renders inside a container-query context (the scrolling list is
// marked `@container` in Dashboard), so the grid responds to *its own* width
// rather than the viewport. As the list narrows — most notably when the agent
// detail pane laps over it on a laptop — columns drop progressively instead of
// overflowing and colliding under the pane:
//
//   narrow            Agent | (slack) | Actions
//   ≥ 420px  (+Status)Agent | (slack) | Status | Actions
//   ≥ 600px  (+Mode)  Agent | (slack) | Mode | Status | Actions
//   ≥ 840px  (+Engine)Agent | (slack) | Engine | Mode | Status | Actions
//
// The narrowest tier keeps only Agent + Actions: the fixed Status/Mode/Engine
// tracks are what collide with the (shrinking) Agent column when the pane
// squeezes the list, so each drops out before it can overlap rather than the
// grid overflowing. Actions (112px) always stays — it's the row's controls,
// wide enough for the labeled "Bring online" button.
//
// Agent takes 3fr and a trailing 1fr "slack" track soaks up the rest, so the
// name column is ~3/4 of the free width instead of stretching edge to edge and
// the metadata columns group to the right. The slack is an always-present grid
// item (an empty spacer cell) — both the header and every row emit it right
// after the Agent cell so tracks and items stay in lockstep.
//
// The header (Dashboard) and every row (AgentRow) MUST use these same strings
// so the column tracks and the cells that fill them stay in lockstep — the
// grid template and the cell visibility toggles share the same breakpoints.
export const AGENT_GRID_COLS =
  "grid grid-cols-[3fr_1fr_112px] " +
  "@min-[420px]:grid-cols-[3fr_1fr_140px_112px] " +
  "@min-[600px]:grid-cols-[3fr_1fr_140px_140px_112px] " +
  "@min-[840px]:grid-cols-[3fr_1fr_180px_140px_140px_112px]";

// Left indent applied to the "Agent" column header so the label lines up with
// the row's avatar (which sits behind the chevron spacer + gap), not flush at
// the cell's left edge.
export const AGENT_HEADER_INDENT = "pl-[1.875rem]";

// Engine cell — only shown at the widest tier.
export const AGENT_CELL_ENGINE = "hidden @min-[840px]:block";

// Mode cell — shown from the medium tier up.
export const AGENT_CELL_MODE = "hidden @min-[600px]:block";

// Status cell — dropped only at the very narrowest tier, where keeping it
// would collide with the Agent column.
export const AGENT_CELL_STATUS = "hidden @min-[420px]:block";

// Agent name/description block (beside the avatar). At the very narrowest
// widths even the truncated name crowds the avatar against the Actions
// column, so the label drops and only the profile photo remains.
export const AGENT_CELL_NAME = "hidden @min-[300px]:block";
