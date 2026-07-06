import type { ManagedAgent } from "../stores/agentStore";

/**
 * Canonical "is this agent online right now" — the SINGLE source of truth
 * shared by every surface (the rail counter in AppShell, the Agents-tab
 * header count in Dashboard, and the per-row presence dots) so they can
 * never drift apart (issue #64).
 *
 * Online = live WS presence (`presenceStore.online` — the authoritative
 * signal every client counts), OR — for local-runtime agents only — a local
 * subprocess still in its pre-heartbeat window. `processStatus === "running"`
 * is known the instant we start an agent here, ~60s before the executor's
 * first presence heartbeat lands, so we OR it in to avoid a start looking
 * like a no-op. Org-host agents have no local subprocess (their bridge lives
 * on a remote VM), so they are presence-only.
 *
 * `presenceOnline` is `presenceStore.online` — passed in so this stays a
 * pure function (no store import, no React hook rules), callable from
 * `useMemo`, plain filters, and non-component code alike.
 */
export function isAgentOnline(
  managed: ManagedAgent,
  presenceOnline: Set<string>
): boolean {
  if (presenceOnline.has(managed.agent.id)) return true;
  return (
    managed.agent.runtime !== "org_host" && managed.processStatus === "running"
  );
}
