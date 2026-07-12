// First-run guided-tour "seen" flags. These roam ACROSS clients: once a user
// completes a tour on any device (desktop/web/mobile), it never reappears on
// another. The source of truth is the server — the flags live on the
// participant (`metadata.tours_seen`) and are marked via POST /api/me/tours/:tour.
// There is no per-device localStorage flag (that would re-show the tour on each
// new device, which is exactly what we're avoiding).
//
// "Start Fresh" (account reset) clears metadata.tours_seen server-side, so
// every first-run tour replays after a reset with no client bookkeeping.

import { request, type Participant } from "./api";
import { useAuthStore } from "../stores/authStore";

export const FTUE_KEYS = {
  /** Agent details pane orientation tour (AgentConfig). */
  agentConfigTour: "agentConfigTour",
  /** In-conversation orientation tour (ConversationTour). */
  conversationTour: "conversationTour",
  /** Profile / settings orientation tour (ProfileTour). */
  profileTour: "profileTour",
} as const;

export type TourKey = (typeof FTUE_KEYS)[keyof typeof FTUE_KEYS];

/** True once the given tour has been seen — read from the roamed participant
 *  metadata, so a tour done on another client is already suppressed here. */
export function hasSeenTour(key: TourKey): boolean {
  const participant = useAuthStore.getState().participant;
  const seen = (participant?.metadata as
    | { tours_seen?: Record<string, boolean> }
    | undefined)?.tours_seen;
  return seen?.[key] === true;
}

/** Mark a tour seen server-side (roams to every other client) and update the
 *  cached participant so the current session reflects it immediately. */
export async function markTourSeen(key: TourKey): Promise<void> {
  // Optimistic local flip so a re-mount this session doesn't re-trigger it.
  const cur = useAuthStore.getState().participant;
  if (cur) {
    const meta = (cur.metadata as Record<string, unknown>) ?? {};
    const seen = { ...((meta.tours_seen as Record<string, boolean>) ?? {}), [key]: true };
    const next = { ...cur, metadata: { ...meta, tours_seen: seen } };
    localStorage.setItem("participant", JSON.stringify(next));
    useAuthStore.setState({ participant: next });
  }
  try {
    const fresh = await request<Participant>(`/api/me/tours/${key}`, { method: "POST" });
    localStorage.setItem("participant", JSON.stringify(fresh));
    useAuthStore.setState({ participant: fresh });
  } catch {
    // Non-fatal: the optimistic local flag already suppresses the tour this
    // session; a later /me refresh carries the server truth.
  }
}
