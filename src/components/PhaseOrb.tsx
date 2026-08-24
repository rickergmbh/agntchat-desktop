import { ThinkingOrb } from "thinking-orbs";
import {
  PHASE_ORBS,
  type PhaseOrActivity,
  type PhaseOrbState,
} from "../lib/status-contract.generated";

interface Props {
  /** Stream phase / agent activity — resolved to an orb via PHASE_ORBS. */
  phase?: PhaseOrActivity;
  /** Direct orb state; takes precedence over phase. */
  state?: PhaseOrbState;
  /** When false the orb freezes on its current frame (mirrors the old
   *  PHASE_IS_ACTIVE pulse gating). */
  active?: boolean;
  className?: string;
}

// The one way message bubbles and task cards render a thinking orb. Always
// the 20px inline preset, themed by the library's own `auto` detection (it
// watches the `dark` class our themeStore toggles on <html>). Every usage
// sits beside visible localized text, so the orb is aria-hidden rather than
// carrying the library's English labels. Kept in parity with
// web/src/components/PhaseOrb.tsx.
export function PhaseOrb({ phase, state, active = true, className }: Props) {
  const resolved = state ?? (phase ? PHASE_ORBS[phase] : undefined) ?? "working";
  return (
    <ThinkingOrb
      state={resolved}
      size={20}
      paused={!active}
      aria-hidden="true"
      className={className}
    />
  );
}
