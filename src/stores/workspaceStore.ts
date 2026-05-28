import { create } from "zustand";
import * as api from "../lib/api";
import { ws } from "../services/websocket";
import { useAuthStore } from "./authStore";
import { useChatStore } from "./chatStore";
import { useAgentStore } from "./agentStore";
import { useTaskStore } from "./taskStore";
import type { Participant, WorkspaceMembership } from "../lib/api";

/**
 * Slack-style multi-workspace store. Mirrors the web app's
 * `workspaceStore` so behavior is identical across clients.
 *
 * Source of truth is `authStore.participant.organizations` /
 * `activeOrganizationId`. This store exposes computed selectors plus a
 * `switch(orgId)` action that PATCHes the backend, updates the
 * participant in authStore, and re-fetches org-scoped stores.
 */
interface WorkspaceState {
  switching: boolean;
  pendingId: string | null;

  switch: (orgId: string) => Promise<void>;
  applyRemoteSwitch: (orgId: string) => Promise<void>;
  initWsListeners: () => () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  switching: false,
  pendingId: null,

  switch: async (orgId) => {
    if (get().switching) return;

    const current = useAuthStore.getState().participant;
    if (current?.activeOrganizationId === orgId) return;

    set({ switching: true, pendingId: orgId });
    try {
      const updated = await api.setActiveOrganization(orgId);
      const auth = useAuthStore.getState();
      if (auth.participant) {
        const next = { ...auth.participant, ...updated };
        localStorage.setItem("participant", JSON.stringify(next));
        useAuthStore.setState({ participant: next });
      }
      await refetchOrgScoped();
    } finally {
      set({ switching: false, pendingId: null });
    }
  },

  applyRemoteSwitch: async (orgId) => {
    const current = useAuthStore.getState().participant;
    if (!current || current.activeOrganizationId === orgId) return;

    try {
      const updated = await api.getProfile();
      localStorage.setItem("participant", JSON.stringify(updated));
      useAuthStore.setState({ participant: updated });
      await refetchOrgScoped();
    } catch {
      /* leave state alone; next manual fetch catches up */
    }
  },

  initWsListeners: () => {
    return ws.on("active_organization_changed", (payload) => {
      const orgId = (payload as { organizationId?: string })?.organizationId;
      if (typeof orgId === "string") {
        void get().applyRemoteSwitch(orgId);
      }
    });
  },
}));

async function refetchOrgScoped() {
  // Wipe org-scoped collections so the UI re-keys cleanly. Each store
  // handles the empty state on its own. Desktop's agentStore uses a
  // Record (keyed by id) rather than an array — match that shape.
  useChatStore.setState({ conversations: [] });
  useAgentStore.setState({ agents: {} });
  useTaskStore.setState({ tasks: [] });

  await Promise.all([
    useChatStore.getState().fetchConversations(),
    useAgentStore.getState().fetchAgents(),
  ]);
}

// --- Selectors ---------------------------------------------------------

export function useWorkspaces(): WorkspaceMembership[] {
  return useAuthStore((s) => s.participant?.organizations ?? []);
}

export function useActiveWorkspace(): WorkspaceMembership | null {
  const orgs = useWorkspaces();
  const activeId = useAuthStore((s) => s.participant?.activeOrganizationId);
  if (!activeId) return null;
  return orgs.find((w) => w.id === activeId) ?? null;
}

export type { Participant };
