import { create } from "zustand";
import * as api from "../lib/api";
import { ws } from "../services/websocket";
import { useAuthStore } from "./authStore";
import { useChatStore } from "./chatStore";
import { useAgentStore } from "./agentStore";
import { useTaskStore } from "./taskStore";
import { usePresenceStore } from "./presenceStore";
import { useStreamingStore } from "./streamingStore";
import type { Participant, WorkspaceMembership } from "../lib/api";

/**
 * Slack-style multi-workspace store. Mirrors the web app's
 * `workspaceStore` so behavior is identical across clients.
 */
interface WorkspaceState {
  switching: boolean;
  pendingId: string | null;
  lastError: string | null;

  switch: (orgId: string) => Promise<void>;
  applyRemoteSwitch: (orgId: string) => Promise<void>;
  initWsListeners: () => () => void;

  // Stage 3 management actions — same shape as web.
  createWorkspace: (name: string, slug?: string) => Promise<api.Organization>;
  renameWorkspace: (orgId: string, name: string) => Promise<void>;
  /** Set or clear the workspace avatar URL. Pass null to remove. */
  setWorkspaceAvatar: (orgId: string, avatarUrl: string | null) => Promise<void>;
  deleteWorkspace: (orgId: string) => Promise<void>;
  leaveWorkspace: (orgId: string) => Promise<void>;
  sendInvite: (
    orgId: string,
    email: string,
    role?: "admin" | "member"
  ) => Promise<api.OrganizationInvite>;
  revokeInvite: (orgId: string, inviteId: string) => Promise<void>;
  removeMember: (orgId: string, participantId: string) => Promise<void>;
  updateMemberRole: (
    orgId: string,
    participantId: string,
    role: "owner" | "admin" | "member"
  ) => Promise<void>;
  refresh: () => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  switching: false,
  pendingId: null,
  lastError: null,

  switch: async (orgId) => {
    const current = useAuthStore.getState().participant;
    if (current?.activeOrganizationId === orgId) return;

    set({ pendingId: orgId, lastError: null });

    if (get().switching) return;

    set({ switching: true });
    try {
      let target = get().pendingId;
      while (target) {
        const updated = await api.setActiveOrganization(target);
        const auth = useAuthStore.getState();
        if (auth.participant) {
          const next = { ...auth.participant, ...updated };
          localStorage.setItem("participant", JSON.stringify(next));
          useAuthStore.setState({ participant: next });
        }
        await refetchOrgScoped();

        const nextTarget = get().pendingId;
        target = nextTarget && nextTarget !== target ? nextTarget : null;
      }
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : "Switch failed" });
      throw e;
    } finally {
      set({ switching: false, pendingId: null });
    }
  },

  applyRemoteSwitch: async (orgId) => {
    const current = useAuthStore.getState().participant;
    if (!current || current.activeOrganizationId === orgId) return;

    // Coalesce against an in-flight switch — see web/store rationale.
    set({ pendingId: orgId, lastError: null });
    if (get().switching) return;

    set({ switching: true });
    try {
      const updated = await api.getProfile();
      localStorage.setItem("participant", JSON.stringify(updated));
      useAuthStore.setState({ participant: updated });
      await refetchOrgScoped();
    } catch (e) {
      set({
        lastError: e instanceof Error ? e.message : "Remote switch failed",
      });
    } finally {
      set({ switching: false, pendingId: null });
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

  // --- Workspace management ----------------------------------------

  createWorkspace: async (name, slug) => {
    const finalSlug = slug ?? deriveSlug(name);
    const org = await api.createOrganization(name, finalSlug);
    await get().refresh();
    await get().switch(org.id);
    return org;
  },

  setWorkspaceAvatar: async (orgId, avatarUrl) => {
    await api.setOrganizationAvatar(orgId, avatarUrl);
    await get().refresh();
  },

  renameWorkspace: async (orgId, name) => {
    await api.renameOrganization(orgId, name);
    await get().refresh();
  },

  deleteWorkspace: async (orgId) => {
    const wasActive =
      useAuthStore.getState().participant?.activeOrganizationId === orgId;

    await api.deleteOrganization(orgId);
    await get().refresh();

    // Defensive wipe — backend broadcasts active_organization_changed
    // but if the WS push is dropped, org-scoped stores would still be
    // showing the deleted workspace's data.
    if (wasActive) await refetchOrgScoped();
  },

  leaveWorkspace: async (orgId) => {
    const participantId = useAuthStore.getState().participant?.id;
    if (!participantId) throw new Error("Not authenticated");

    const wasActive =
      useAuthStore.getState().participant?.activeOrganizationId === orgId;

    await api.removeOrganizationMember(orgId, participantId);
    await get().refresh();

    if (wasActive) await refetchOrgScoped();
  },

  sendInvite: async (orgId, email, role = "member") => {
    const invite = await api.createOrganizationInvite(orgId, email, role);
    await get().refresh();
    return invite;
  },

  revokeInvite: async (orgId, inviteId) => {
    await api.deleteOrganizationInvite(orgId, inviteId);
    await get().refresh();
  },

  removeMember: async (orgId, participantId) => {
    await api.removeOrganizationMember(orgId, participantId);
    await get().refresh();
  },

  updateMemberRole: async (orgId, participantId, role) => {
    await api.updateOrganizationMemberRole(orgId, participantId, role);
    await get().refresh();
  },

  refresh: async () => {
    // Skip while a switch is in flight — see web/store rationale.
    if (get().switching) return;

    try {
      const updated = await api.getProfile();
      localStorage.setItem("participant", JSON.stringify(updated));
      useAuthStore.setState({ participant: updated });
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : "Refresh failed" });
    }
  },
}));

function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || `ws-${Math.random().toString(36).slice(2, 8)}`;
}

async function refetchOrgScoped() {
  // 1. Stop receiving events for the previous workspace's conv channels.
  ws.leaveAllConversations();

  // 2. Wipe org-scoped collections. Desktop's chatStore covers
  //    conversations + agentConversations + per-conversation message
  //    caches + drafts + unread + active-id; agentStore is a Record
  //    keyed by id; taskStore is a flat list. Presence + streaming
  //    repopulate from new channel events.
  useChatStore.setState({
    conversations: [],
    agentConversations: [],
    agentConversationsLoaded: false,
    pendingConversation: null,
    activeConversationId: null,
    activeThreadId: null,
    messages: {},
    messagesLoading: {},
    hasMore: {},
    drafts: {},
    replyingTo: {},
    unreadCounts: {},
  });

  useAgentStore.setState({ agents: {} });

  useTaskStore.setState({ tasks: [] });

  usePresenceStore.setState({ online: new Set<string>() });
  useStreamingStore.setState({ streams: {} });

  // 3. Refetch the current workspace's lists. Agent threads are
  //    explicitly fetched here (was missed in stage 2's desktop wipe
  //    — agent threads from the previous workspace lingered in the
  //    sidebar until manual refresh).
  await Promise.all([
    useChatStore.getState().fetchConversations().catch(() => {}),
    useChatStore
      .getState()
      .fetchAgentConversations()
      .catch(() => {}),
    useAgentStore.getState().fetchAgents().catch(() => {}),
  ]);
}

// --- Selectors ---------------------------------------------------------

// Stable reference for participants without an `organizations` array —
// returning a fresh `[]` from the selector each render makes Zustand
// see a new value every time and triggers an infinite update loop.
const EMPTY_WORKSPACES: WorkspaceMembership[] = [];

export function useWorkspaces(): WorkspaceMembership[] {
  return useAuthStore((s) => s.participant?.organizations ?? EMPTY_WORKSPACES);
}

export function useActiveWorkspace(): WorkspaceMembership | null {
  const orgs = useWorkspaces();
  const activeId = useAuthStore((s) => s.participant?.activeOrganizationId);
  if (!activeId) return null;
  return orgs.find((w) => w.id === activeId) ?? null;
}

export type { Participant };
