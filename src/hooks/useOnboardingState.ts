import { useEffect, useMemo, useRef, useState } from "react";
import { useAgentStore, type ManagedAgent } from "../stores/agentStore";
import { useChatStore } from "../stores/chatStore";
import { usePresenceStore } from "../stores/presenceStore";
import {
  useActiveWorkspace,
  useWorkspacesEnabled,
} from "../stores/workspaceStore";
import { isAgentOnline } from "../lib/agentOnline";

export type OnboardingStep = "create" | "online" | "greeting";

export interface OnboardingState {
  /** True while the user still has setup left before their first working
   *  agent conversation. False for established users and until stores load. */
  active: boolean;
  /** True when the flow just completed within this session (the greeting DM
   *  arrived while the cards were up) — hosts keep rendering the cards so the
   *  one-shot "sent you a message" card can show. Never true on a later boot. */
  arrived: boolean;
  /** Hosts render the cards while this is true (active or arrived). */
  visible: boolean;
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

  // First-run setup is an account-level flow that lives in the Personal
  // workspace. Conversations are workspace-scoped, so inside a freshly
  // created shared workspace the "DM with an own agent exists" terminal
  // predicate goes false and the ladder would re-render for an established
  // user — stuck on "greeting", since FirstAgentGreetingWorker only ever
  // fires once per account.
  const workspacesEnabled = useWorkspacesEnabled();
  const activeWorkspace = useActiveWorkspace();
  const inSharedWorkspace =
    workspacesEnabled && activeWorkspace !== null && !activeWorkspace.isPersonal;

  const derived = useMemo<Omit<OnboardingState, "arrived" | "visible">>(() => {
    const inactive: Omit<OnboardingState, "arrived" | "visible"> = {
      active: false,
      step: null,
      variant: null,
      firstAgent: null,
      agentDmId: null,
    };

    if (!agentsLoaded || !conversationsLoaded || inSharedWorkspace) {
      return inactive;
    }

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
  }, [agents, agentsLoaded, conversations, conversationsLoaded, online, inSharedWorkspace]);

  // "Arrived": the flow completed within this session — the greeting DM
  // landed while the cards were up. Hosts keep the cards mounted (`visible`)
  // so the one-shot "sent you a message" card can show; on any later boot
  // the flow is simply inactive from the first fetch and nothing renders.
  const wasActiveRef = useRef(false);
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    if (derived.active) {
      wasActiveRef.current = true;
      if (arrived) setArrived(false);
    } else if (wasActiveRef.current && derived.agentDmId && !arrived) {
      setArrived(true);
    }
  }, [derived.active, derived.agentDmId, arrived]);

  return {
    ...derived,
    arrived,
    visible: derived.active || arrived,
  };
}
