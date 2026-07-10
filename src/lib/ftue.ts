// First-time-user-experience (FTUE) state that lives client-side in
// localStorage: the one-time "seen" flags for the guided coach-mark tours.
// Centralized here so "Start Fresh" can wipe the FTUE in one call and every
// tour replays for a genuinely fresh first run.
//
// Each tour reads/writes its own key (auto-start once, ever); `resetFtue()`
// clears them all. Add new one-time-guidance keys to FTUE_KEYS so they're
// covered by the reset automatically.

export const FTUE_KEYS = {
  /** Agent details pane orientation tour (AgentConfig). */
  agentConfigTour: "agentchat:agentConfigTourSeen",
  /** In-conversation orientation tour (ConversationTour). */
  conversationTour: "agentchat:conversationTourSeen",
} as const;

/** Clear every FTUE flag so all first-run tours replay. Called by Start Fresh. */
export function resetFtue(): void {
  for (const key of Object.values(FTUE_KEYS)) {
    localStorage.removeItem(key);
  }
}
