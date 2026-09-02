import type { ManagedAgent } from "../stores/agentStore";

/**
 * Canonical "this agent can't run on this computer until a new key is
 * generated" test — the SINGLE source of truth shared by every surface that
 * warns about it (the Agents rail button, the agent row's "Needs attention"
 * control, the config pane's crash banner and its Model rail dot) so they
 * can never disagree about which agents are broken, the same way
 * `isAgentOnline` keeps the online surfaces in lockstep.
 *
 * "auth" = the stored key was rejected (regenerated on another computer);
 * "no_key" = no key on this computer at all (the agent was set up elsewhere).
 * Both are fixed identically: generate a new key here, from the agent's
 * Model section — which is why both crash kinds route to the same warning.
 */
export function hasKeyProblem(managed: ManagedAgent): boolean {
  return (
    managed.processStatus === "crashed" &&
    (managed.crashKind === "auth" || managed.crashKind === "no_key")
  );
}
