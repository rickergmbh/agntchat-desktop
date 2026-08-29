import { create } from "zustand";
import * as api from "../lib/api";
import { track, ANALYTICS_EVENTS } from "../lib/analytics";
import { ws } from "../services/websocket";
import { useAuthStore } from "./authStore";
import { useChatStore } from "./chatStore";
import { useAgentStore } from "./agentStore";
import { useTaskStore } from "./taskStore";
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

  /** Per-workspace count of items needing the user (unread messages +
   *  pending permission approvals) from GET /api/me/workspace-attention.
   *  The switcher tile badges the sum for workspaces other than the
   *  active one so a workspace doesn't silently accumulate things
   *  needing them. Refetched (debounced) on the relevant WS events. */
  attentionByOrg: Record<string, number>;
  /** Per-workspace count of in-flight tasks (pending/accepted/
   *  in_progress/blocked, background pulse/routine work excluded) from
   *  the same endpoint. Informational — rendered as its own badge in
   *  the switcher rows, never summed into the attention badge. */
  tasksByOrg: Record<string, number>;
  fetchWorkspaceAttention: () => Promise<void>;

  /** Roster of a workspace, keyed by org id. Shared by the Members
   *  view and by the rail chip that counts it, so the count and the
   *  list it describes can never drift — the chip needs the roster on
   *  every screen, long before the Members view mounts. */
  membersByOrg: Record<string, api.OrganizationMembership[]>;
  fetchMembers: (orgId: string) => Promise<api.OrganizationMembership[]>;

  // Stage 3 management actions — same shape as web.
  createWorkspace: (name: string) => Promise<api.Organization>;
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
  attentionByOrg: {},
  tasksByOrg: {},
  membersByOrg: {},
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
    const unsubs = [
      ws.on("active_organization_changed", (payload) => {
        const orgId = (payload as { organizationId?: string })?.organizationId;
        if (typeof orgId === "string") {
          void get().applyRemoteSwitch(orgId);
        }
      }),
      // Workspace list changed (created/renamed/deleted/membership) without
      // the active workspace moving — refetch /api/me so the switcher stays
      // current. No re-key/wipe: org-scoped stores are unaffected.
      ws.on("workspaces_updated", () => {
        void get().refresh();
      }),
      // Anything that can change another workspace's attention count —
      // a message landing, a read on another device, a permission
      // request appearing or being resolved — schedules one debounced
      // refetch instead of tracking deltas client-side.
      ws.on("new_message", () => scheduleAttentionRefetch()),
      ws.on("conversation_read", () => scheduleAttentionRefetch()),
      ws.on("permission_request", () => scheduleAttentionRefetch()),
      ws.on("permission_resolved", () => scheduleAttentionRefetch()),
      // Task lifecycle changes move the per-workspace tasks badge.
      ws.on("task_created", () => scheduleAttentionRefetch()),
      ws.on("task_updated", () => scheduleAttentionRefetch()),
      ws.on("task_completed", () => scheduleAttentionRefetch()),
    ];
    return () => unsubs.forEach((u) => u());
  },

  fetchWorkspaceAttention: async () => {
    // The endpoint sits behind the `workspaces` flag (404 when off) —
    // don't poll it for users the feature is dark for.
    if (useAuthStore.getState().participant?.features?.workspaces !== true) return;

    try {
      const rows = await api.getWorkspaceAttention();
      const next: Record<string, number> = {};
      const nextTasks: Record<string, number> = {};
      for (const row of rows) {
        next[row.organizationId] = row.total;
        nextTasks[row.organizationId] = row.activeTasks ?? 0;
      }
      set({ attentionByOrg: next, tasksByOrg: nextTasks });
    } catch {
      // Transient — the badge just stays stale until the next trigger.
    }
  },

  // --- Workspace management ----------------------------------------

  createWorkspace: async (name) => {
    const org = await api.createOrganization(name);
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
    track(ANALYTICS_EVENTS.MEMBER_INVITED, { role });
    await get().refresh();
    return invite;
  },

  revokeInvite: async (orgId, inviteId) => {
    await api.deleteOrganizationInvite(orgId, inviteId);
    await get().refresh();
  },

  fetchMembers: async (orgId) => {
    const memberships = await api.listOrganizationMembers(orgId);
    set((s) => ({ membersByOrg: { ...s.membersByOrg, [orgId]: memberships } }));
    return memberships;
  },

  removeMember: async (orgId, participantId) => {
    await api.removeOrganizationMember(orgId, participantId);
    await get().fetchMembers(orgId).catch(() => []);
    await get().refresh();
  },

  updateMemberRole: async (orgId, participantId, role) => {
    await api.updateOrganizationMemberRole(orgId, participantId, role);
    await get().fetchMembers(orgId).catch(() => []);
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

// Raises `switching` for the wipe+refetch window when no switch flow
// already owns it (the delete/leave defensive wipes call this
// directly). Consumers deriving from the wiped stores — the
// onboarding cards especially — read `switching` to avoid flashing
// "brand-new account" between the wipe and the refetch resolving.
async function refetchOrgScoped() {
  const ownsFlag = !useWorkspaceStore.getState().switching;
  if (ownsFlag) useWorkspaceStore.setState({ switching: true });
  try {
    await doRefetchOrgScoped();
  } finally {
    if (ownsFlag) useWorkspaceStore.setState({ switching: false });
  }
  // Reads that happened in the workspace we just left change its
  // attention count; refresh the switcher badge alongside the re-key.
  void useWorkspaceStore.getState().fetchWorkspaceAttention();
}

// One trailing-edge timer coalesces bursts of WS events (message storms,
// bulk permission resolutions) into a single attention refetch.
let attentionTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAttentionRefetch() {
  if (attentionTimer) return;
  attentionTimer = setTimeout(() => {
    attentionTimer = null;
    void useWorkspaceStore.getState().fetchWorkspaceAttention();
  }, 1500);
}

async function doRefetchOrgScoped() {
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

  // Streaming is conversation-keyed and those conversations are gone —
  // clear it. Presence is deliberately NOT wiped: it's participant-keyed,
  // not workspace-keyed, and the authoritative presence_snapshot only
  // arrives on user-channel JOIN (never on switch) — wiping here made
  // hosted agents render offline after every switch. See web store.
  useStreamingStore.setState({ streams: {} });

  // 3. Refetch the current workspace's lists. Agent threads are
  //    explicitly fetched here (was missed in stage 2's desktop wipe
  //    — agent threads from the previous workspace lingered in the
  //    sidebar until manual refresh). Tasks are refetched for the same
  //    reason: the nav rail's active-task badge reads the store, so
  //    deferring to the Tasks view left it stuck at 0 after a switch.
  await Promise.all([
    useChatStore.getState().fetchConversations().catch(() => {}),
    useChatStore
      .getState()
      .fetchAgentConversations()
      .catch(() => {}),
    useChatStore.getState().fetchUnreadCounts().catch(() => {}),
    useAgentStore.getState().fetchAgents().catch(() => {}),
    useTaskStore.getState().fetchTasks().catch(() => {}),
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

/**
 * Workspaces are behind a per-user runtime flag (resolved on /me). With
 * the flag off every user is in their Personal workspace.
 */
export function useWorkspacesEnabled(): boolean {
  return useAuthStore((s) => s.participant?.features?.workspaces === true);
}

/** Cached roster for a workspace — `undefined` until it's been fetched. */
export function useWorkspaceMembers(
  orgId: string | null | undefined
): api.OrganizationMembership[] | undefined {
  return useWorkspaceStore((s) => (orgId ? s.membersByOrg[orgId] : undefined));
}

export function useActiveWorkspace(): WorkspaceMembership | null {
  const orgs = useWorkspaces();
  const activeId = useAuthStore((s) => s.participant?.activeOrganizationId);
  if (!activeId) return null;
  return orgs.find((w) => w.id === activeId) ?? null;
}

export type { Participant };
