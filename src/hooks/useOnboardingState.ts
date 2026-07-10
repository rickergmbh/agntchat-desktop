import { useMemo } from "react";
import { useAgentStore, type ManagedAgent } from "../stores/agentStore";
import { useChatStore } from "../stores/chatStore";
import { usePresenceStore } from "../stores/presenceStore";
import { isAgentOnline } from "../lib/agentOnline";

export type OnboardingStep = "create" | "online" | "greeting";

export interface OnboardingState {
  /** True while the user still has setup left before their first working
   *  agent conversation. False for established users and until stores load. */
  active: boolean;
  /** The step the user is on, or null when inactive / not yet loaded. */
  step: OnboardingStep | null;
  /** How the "get it online" step should read: a local agent is started from
   *  this app; a hosted one is spawned by its org host. */
  variant: "local" | "hosted" | null;
  /** The user's first (oldest) root agent, once one exists. */
  firstAgent: ManagedAgent | null;
  /** The DM conversation with one of the user's own agents, once it exists —
   *  the greeting conversation the "open the message" CTA jumps to. */
  agentDmId: string | null;
}

/**
 * Derives first-run onboarding progress purely from server truth already in
 * the stores — no local checklist, no persisted flags. The whole flow is:
 *
 *   create  — user owns zero agents
 *   online  — agent(s) exist but none is online
 *   greeting — first agent online; the backend-seeded greeting DM hasn't
 *              arrived yet (FirstAgentGreetingWorker creates it when the
 *              agent's bridge first registers)
 *   done    — a personal DM with one of the user's own agents exists
 *
 * "A DM with an own agent exists" is the terminal predicate: it's true for
 * every established user (so cards never render for them, even with all
 * agents offline) and it resets naturally after Start Fresh wipes the
 * user's agents and conversations.
 */
export function useOnboardingState(): OnboardingState {
  const agents = useAgentStore((s) => s.agents);
  const agentsLoaded = useAgentStore((s) => s.loaded);
  const conversations = useChatStore((s) => s.conversations);
  const conversationsLoaded = useChatStore((s) => s.conversationsLoaded);
  const online = usePresenceStore((s) => s.online);

  return useMemo(() => {
    const inactive: OnboardingState = {
      active: false,
      step: null,
      variant: null,
      firstAgent: null,
      agentDmId: null,
    };

    if (!agentsLoaded || !conversationsLoaded) return inactive;

    // Root agents the user owns — sub-agents (owned by another agent in the
    // list) and ephemeral spawns don't count toward "has an agent".
    const all = Object.values(agents);
    const ids = new Set(all.map((m) => m.agent.id));
    const ownAgents = all.filter(
      (m) =>
        !m.agent.spawn && !(m.agent.ownerId && ids.has(m.agent.ownerId))
    );

    const ownAgentIds = new Set(ownAgents.map((m) => m.agent.id));
    const agentDm = conversations.find(
      (c) =>
        c.type === "direct" &&
        (c.members ?? []).some(
          (m) =>
            m.participant?.type === "agent" && ownAgentIds.has(m.participantId)
        )
    );

    // Terminal state: the user already talks to one of their agents.
    if (agentDm && ownAgents.length > 0) {
      return { ...inactive, agentDmId: agentDm.id };
    }

    if (ownAgents.length === 0) {
      return { ...inactive, active: true, step: "create" };
    }

    const firstAgent = [...ownAgents].sort((a, b) =>
      (a.agent.insertedAt ?? "").localeCompare(b.agent.insertedAt ?? "")
    )[0];
    const variant = firstAgent.agent.runtime === "org_host" ? "hosted" : "local";

    const anyOnline = ownAgents.some((m) => isAgentOnline(m, online));
    if (!anyOnline) {
      return { ...inactive, active: true, step: "online", variant, firstAgent };
    }

    return { ...inactive, active: true, step: "greeting", variant, firstAgent };
  }, [agents, agentsLoaded, conversations, conversationsLoaded, online]);
}
