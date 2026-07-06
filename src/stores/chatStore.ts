import { create } from "zustand";
import * as api from "../lib/api";
import type { Conversation, Message } from "../lib/api";
import { track, ANALYTICS_EVENTS } from "../lib/analytics";
import { ws } from "../services/websocket";
import { useAuthStore } from "./authStore";
import { useStreamingStore } from "./streamingStore";
import { usePresenceStore } from "./presenceStore";

// Seed the shared online-set from `conversation.members[].participant.online`
// — but only for *humans*. Human presence is tracked through a live Phoenix
// socket, so the flag is trustworthy. Agent "online" on the REST payload
// comes from the ExecutorRegistry and can be stale for ~60-90s after a
// bridge crash / desktop quit; trusting it paints a green dot for an agent
// that isn't actually running. Agents get their online state exclusively
// from the `agent_status_changed` WS event stream in the presence store.
function seedOnlineFromConversations(convos: Conversation[]) {
  const ids: string[] = [];
  for (const c of convos) {
    for (const m of c.members ?? []) {
      if (m.participant?.type === "agent") continue;
      if (m.participant?.online) ids.push(m.participantId);
    }
  }
  if (ids.length === 0) return;
  usePresenceStore.setState((s) => {
    const next = new Set(s.online);
    ids.forEach((id) => next.add(id));
    return { online: next };
  });
}

const PENDING_PREFIX = "pending-";

function dedup(messages: Message[]): Message[] {
  const seen = new Set<string>();
  return messages.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

function sortMessages(messages: Message[]): Message[] {
  return [...messages].sort(
    (a, b) => new Date(a.insertedAt).getTime() - new Date(b.insertedAt).getTime()
  );
}

function sortConversations(convos: Conversation[]): Conversation[] {
  return [...convos].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

function isPulseConversation(conv: Conversation): boolean {
  return Boolean(conv.metadata?.pulse_conversation);
}

function isAgentScopedConversation(conv: Conversation): boolean {
  if (conv.type === "task") return false;
  if (conv.parentConversationId) return true;
  const members = conv.members ?? [];
  return (
    members.length > 0 &&
    members.every((m) => m.participant?.type === "agent")
  );
}

function upsertConversation(list: Conversation[], conv: Conversation): Conversation[] {
  const existing = list.find((c) => c.id === conv.id);
  if (!existing) return sortConversations([conv, ...list]);
  return sortConversations(
    list.map((c) => (c.id === conv.id ? { ...c, ...conv } : c))
  );
}

interface ChatState {
  // Conversations
  conversations: Conversation[];
  conversationsLoading: boolean;
  /** Agent threads — fetched with `?scope=agents` and rendered inline inside
   *  their parent conversations. Kept separate so unread badges and sorting do
   *  not intermix with personal conversations. */
  agentConversations: Conversation[];
  agentConversationsLoading: boolean;
  /** True after `fetchAgentConversations` has resolved at least once. */
  agentConversationsLoaded: boolean;
  /** Newly-created conversation, not yet promoted to the list. It only
   *  enters `conversations` after the first message is sent or an event
   *  (new_message / conversation_updated) arrives for it. Prevents the
   *  list cluttering when a user opens "New Chat" then backs out. */
  pendingConversation: Conversation | null;
  /** Server-suggested name for a DM that just became a group, awaiting the
   *  user's confirm/edit/skip via the "Rename to group" modal. Set by the
   *  `conversation_rename_suggested` WS event, cleared on
   *  `conversation_rename_resolved` or once answered. */
  pendingRename: { conversationId: string; suggestedTitle: string } | null;

  // Messages (per conversation)
  messages: Record<string, Message[]>;
  messagesLoading: Record<string, boolean>;
  hasMore: Record<string, boolean>;
  drafts: Record<string, string>;

  // Session
  activeConversationId: string | null;
  unreadCounts: Record<string, number>;
  /** When set (via setActiveConversation with a target), ChatThread scrolls to
   *  and highlights this message once it's loaded, then clears it. Drives
   *  deep-links from the Files view ("jump to where this file was added"). */
  scrollTargetMessageId: string | null;

  // Actions — conversations
  fetchConversations: () => Promise<void>;
  fetchAgentConversations: (sourceConversationId?: string) => Promise<void>;
  refreshConversation: (id: string) => Promise<void>;
  addConversation: (conv: Conversation) => void;
  updateConversationFromEvent: (convId: string, lastMessage: Message) => void;
  getConversation: (id: string) => Conversation | undefined;
  createConversation: (attrs: {
    type: "direct" | "group" | "channel";
    title?: string;
    memberIds: string[];
  }) => Promise<Conversation>;
  updateConversationTitle: (id: string, title: string) => Promise<void>;
  updateConversationAvatar: (id: string, avatarUrl: string | null) => Promise<void>;
  /** Answer the "Rename to group" prompt. `accept` commits `title` (possibly
   *  edited); `skip` leaves the group untitled. `autoAccept`, when set, also
   *  persists the per-user preference. Clears `pendingRename`. */
  respondToRename: (
    conversationId: string,
    action: "accept" | "skip",
    title?: string,
    autoAccept?: boolean
  ) => Promise<void>;
  clearPendingRename: (conversationId: string) => void;
  addMember: (conversationId: string, participantId: string) => Promise<void>;
  removeMember: (conversationId: string, participantId: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  leaveConversation: (conversationId: string, participantId: string) => Promise<void>;
  /** Halt any in-flight agent turns in a conversation — POST to the
   *  backend's stop-agents endpoint. No optimistic local state change;
   *  the server emits the usual WS events as work actually stops. */
  stopAgents: (conversationId: string) => Promise<void>;

  // Actions — messages
  fetchMessages: (conversationId: string, before?: string) => Promise<void>;
  sendMessage: (
    conversationId: string,
    content: string,
    options?: { parentMessageId?: string; attachments?: Array<Record<string, unknown>> }
  ) => Promise<void>;
  deleteMessage: (conversationId: string, messageId: string) => void;
  addMessage: (conversationId: string, message: Message) => void;
  setRecentMessages: (conversationId: string, messages: Message[]) => void;
  setDraft: (conversationId: string, text: string) => void;

  // Reply-to
  replyingTo: Record<string, Message>;
  setReplyingTo: (conversationId: string, message: Message | null) => void;

  // Local-only chat clear (clears messages from the client; server history stays)
  clearChatLocal: (conversationId: string) => void;

  /** First unread message id captured at the moment the conversation was
   * opened. Used only to render a one-shot "New messages" divider; cleared
   * when the user navigates away or manually reopens the conversation. */
  firstUnreadIds: Record<string, string | undefined>;

  // Actions — session
  setActiveConversation: (
    id: string | null,
    opts?: { scrollToMessageId?: string }
  ) => void;
  /** Clear the pending scroll target once ChatThread has handled (or given up
   *  on) it, so re-opening the same conversation doesn't re-trigger a jump. */
  clearScrollTarget: () => void;
  fetchUnreadCounts: () => Promise<void>;
  incrementUnread: (conversationId: string) => void;

  // WS wiring — returns cleanup
  initWsListeners: () => () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  conversationsLoading: false,
  agentConversations: [],
  agentConversationsLoading: false,
  agentConversationsLoaded: false,
  pendingConversation: null,
  pendingRename: null,
  messages: {},
  messagesLoading: {},
  hasMore: {},
  drafts: {},
  replyingTo: {},
  firstUnreadIds: {},
  activeConversationId: null,
  unreadCounts: {},
  scrollTargetMessageId: null,

  fetchConversations: async () => {
    set({ conversationsLoading: true });
    try {
      const convos = await api.listConversations("personal");
      set({ conversations: sortConversations(convos) });
      seedOnlineFromConversations(convos);
    } finally {
      set({ conversationsLoading: false });
    }
  },

  fetchAgentConversations: async (sourceConversationId) => {
    set({ agentConversationsLoading: true });
    try {
      const convos = await api.listConversations("agents", {
        sourceConversationId,
        limit: 200,
      });
      const merged = sourceConversationId
        ? [
            ...get().agentConversations.filter(
              (existing) => !convos.some((incoming) => incoming.id === existing.id)
            ),
            ...convos,
          ]
        : convos;

      // Zero unread for any thread we now see as resolved/abandoned —
      // the thread_completed StatusUpdate lands in the parent, not the
      // thread, so a stale badge on the resolved row is just visual
      // noise. Mirrors mobile chatStore.
      const existingUnread = get().unreadCounts;
      let clearedUnread: Record<string, number> | null = null;
      for (const conv of merged) {
        const meta = (conv.metadata ?? {}) as Record<string, unknown>;
        const status =
          (meta.thread_status as string | undefined) ??
          (meta.threadStatus as string | undefined);
        if (
          (status === "resolved" || status === "abandoned") &&
          existingUnread[conv.id] &&
          existingUnread[conv.id]! > 0
        ) {
          if (!clearedUnread) clearedUnread = { ...existingUnread };
          delete clearedUnread[conv.id];
        }
      }

      set({
        agentConversations: sortConversations(merged),
        agentConversationsLoaded: true,
        ...(clearedUnread ? { unreadCounts: clearedUnread } : {}),
      });
      seedOnlineFromConversations(convos);
    } finally {
      set({ agentConversationsLoading: false });
    }
  },

  refreshConversation: async (id) => {
    try {
      const conv = await api.getConversation(id);
      const replace = (convos: Conversation[]) =>
        convos.map((c) => (c.id === id ? { ...c, ...conv } : c));
      set((s) => ({
        conversations: replace(s.conversations),
        agentConversations: replace(s.agentConversations),
        pendingConversation:
          s.pendingConversation?.id === id ? { ...s.pendingConversation, ...conv } : s.pendingConversation,
      }));
      seedOnlineFromConversations([conv]);
    } catch (e) {
      console.warn(`[chat] refreshConversation(${id}) failed`, e);
    }
  },

  addConversation: (conv) => {
    // Pulse conversations are an internal workspace for the agent's pulse runs;
    // the backend filters them out of /conversations?scope=agents, so suppress
    // the live `new_conversation` add too — otherwise the very first pulse for
    // a new agent would briefly leak its workspace into the agent list.
    if (isPulseConversation(conv)) return;
    set((s) => {
      if (isAgentScopedConversation(conv)) {
        return {
          agentConversations: upsertConversation(s.agentConversations, conv),
        };
      }
      if (conv.parentConversationId || conv.type === "task") return s;
      return { conversations: upsertConversation(s.conversations, conv) };
    });
  },

  updateConversationFromEvent: (convId, lastMessage) => {
    set((s) => {
      const idx = s.conversations.findIndex((c) => c.id === convId);
      if (idx >= 0) {
        const updated = [...s.conversations];
        updated[idx] = {
          ...updated[idx],
          lastMessage,
          updatedAt: lastMessage.insertedAt,
        };
        return { conversations: sortConversations(updated) };
      }
      if (s.pendingConversation?.id === convId) {
        const conv = {
          ...s.pendingConversation,
          lastMessage,
          updatedAt: lastMessage.insertedAt,
        };
        return {
          conversations: sortConversations([conv, ...s.conversations]),
          pendingConversation: null,
        };
      }
      // Check the agent-conversation list too
      const agentIdx = s.agentConversations.findIndex((c) => c.id === convId);
      if (agentIdx >= 0) {
        const updated = [...s.agentConversations];
        updated[agentIdx] = {
          ...updated[agentIdx],
          lastMessage,
          updatedAt: lastMessage.insertedAt,
        };
        return { agentConversations: sortConversations(updated) };
      }
      return s;
    });
  },

  getConversation: (id) => {
    const s = get();
    return (
      s.conversations.find((c) => c.id === id) ??
      s.agentConversations.find((c) => c.id === id) ??
      (s.pendingConversation?.id === id ? s.pendingConversation : undefined)
    );
  },

  createConversation: async (attrs) => {
    const created = await api.createConversationRest(attrs);
    track(ANALYTICS_EVENTS.CONVERSATION_CREATED, { kind: created.type });
    // Refetch with full nested member/participant data
    const full = await api.getConversation(created.id);
    set({ pendingConversation: full });
    return full;
  },

  updateConversationTitle: async (id, title) => {
    await api.updateConversationTitleRest(id, title);
    const update = (convos: Conversation[]) =>
      convos.map((c) => (c.id === id ? { ...c, title } : c));
    set((s) => ({
      conversations: update(s.conversations),
      agentConversations: update(s.agentConversations),
    }));
  },

  respondToRename: async (conversationId, action, title, autoAccept) => {
    // Clear locally first so the modal closes immediately; the server
    // broadcasts conversation_rename_resolved to our other devices.
    set((s) =>
      s.pendingRename?.conversationId === conversationId
        ? { pendingRename: null }
        : {}
    );
    await api.respondToRenameSuggestion(
      conversationId,
      action,
      action === "accept" ? title?.trim() : undefined,
      autoAccept
    );
  },

  clearPendingRename: (conversationId) => {
    set((s) =>
      s.pendingRename?.conversationId === conversationId
        ? { pendingRename: null }
        : {}
    );
  },

  updateConversationAvatar: async (id, avatarUrl) => {
    await api.updateConversationAvatarRest(id, avatarUrl);
    const update = (convos: Conversation[]) =>
      convos.map((c) =>
        c.id === id ? { ...c, avatarUrl: avatarUrl ?? undefined } : c
      );
    set((s) => ({
      conversations: update(s.conversations),
      agentConversations: update(s.agentConversations),
    }));
  },

  addMember: async (conversationId, participantId) => {
    await api.addConversationMember(conversationId, participantId);
    // Refresh so the member list + avatars come back populated
    await get().refreshConversation(conversationId);
  },

  removeMember: async (conversationId, participantId) => {
    await api.removeConversationMember(conversationId, participantId);
    await get().refreshConversation(conversationId);
  },

  deleteConversation: async (conversationId) => {
    await api.deleteConversationRest(conversationId);
    set((s) => {
      const { [conversationId]: _m, ...remainingMessages } = s.messages;
      const { [conversationId]: _d, ...remainingDrafts } = s.drafts;
      return {
        conversations: s.conversations.filter((c) => c.id !== conversationId),
        agentConversations: s.agentConversations.filter((c) => c.id !== conversationId),
        messages: remainingMessages,
        drafts: remainingDrafts,
        activeConversationId:
          s.activeConversationId === conversationId ? null : s.activeConversationId,
      };
    });
    ws.leaveConversation(conversationId);
  },

  stopAgents: async (conversationId) => {
    await api.stopConversationAgents(conversationId);
    // The backend broadcasts `cancelled` for every active stream, but clear
    // locally too so the bubble drops the instant the request resolves.
    useStreamingStore.getState().clearStream(conversationId);
  },

  leaveConversation: async (conversationId, participantId) => {
    await api.removeConversationMember(conversationId, participantId);
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== conversationId),
      agentConversations: s.agentConversations.filter((c) => c.id !== conversationId),
      activeConversationId:
        s.activeConversationId === conversationId ? null : s.activeConversationId,
    }));
    ws.leaveConversation(conversationId);
  },

  fetchMessages: async (conversationId, before) => {
    set((s) => ({
      messagesLoading: { ...s.messagesLoading, [conversationId]: true },
    }));
    try {
      const data = await api.fetchMessages(conversationId, before);
      set((s) => {
        const existing = s.messages[conversationId] ?? [];
        const merged = dedup([...data.messages, ...existing]);
        return {
          messages: { ...s.messages, [conversationId]: sortMessages(merged) },
          hasMore: { ...s.hasMore, [conversationId]: data.messages.length >= 30 },
          messagesLoading: { ...s.messagesLoading, [conversationId]: false },
        };
      });
    } catch (e) {
      console.warn(`[chat] fetchMessages(${conversationId}) failed`, e);
      set((s) => ({
        messagesLoading: { ...s.messagesLoading, [conversationId]: false },
      }));
    }
  },

  sendMessage: async (conversationId, content, options) => {
    const nonce = crypto.randomUUID();
    const participant = useAuthStore.getState().participant;
    const now = new Date().toISOString();
    const parentMessageId = options?.parentMessageId;
    const attachments = options?.attachments;
    const placeholder: Message = {
      id: `${PENDING_PREFIX}${nonce}`,
      conversationId,
      senderId: participant?.id ?? "",
      sender: participant
        ? {
            id: participant.id,
            type: "human",
            displayName: participant.displayName,
            avatarUrl: participant.avatarUrl,
          }
        : undefined,
      content,
      messageType: "text",
      parentMessageId,
      insertedAt: now,
      updatedAt: now,
      pending: true,
      nonce,
      metadata: { client_nonce: nonce },
    };

    set((s) => {
      // Promote a pending (just-created) conversation to the list on first send
      let conversations = s.conversations;
      let pendingConversation = s.pendingConversation;
      if (pendingConversation?.id === conversationId) {
        conversations = sortConversations([pendingConversation, ...conversations]);
        pendingConversation = null;
      }
      const nextReplyingTo = { ...s.replyingTo };
      delete nextReplyingTo[conversationId];
      return {
        conversations,
        pendingConversation,
        messages: {
          ...s.messages,
          [conversationId]: [...(s.messages[conversationId] ?? []), placeholder],
        },
        drafts: { ...s.drafts, [conversationId]: "" },
        replyingTo: nextReplyingTo,
      };
    });

    // No client-side "Sending..." stream bubble. The real bubble paints when
    // the server's InstantAgentSignal fires (~50ms, for targeted agents) or
    // when the bridge emits a real LLM event — which is when the agent is
    // actually working. The pending message gives instant feedback that the
    // tap registered.
    try {
      await ws.sendMessage(conversationId, content, {
        metadata: { client_nonce: nonce },
        parentMessageId,
        attachments,
      });
      // Properties only — never message content.
      const conv =
        get().conversations.find((c) => c.id === conversationId) ??
        get().agentConversations.find((c) => c.id === conversationId) ??
        (get().pendingConversation?.id === conversationId
          ? get().pendingConversation
          : undefined);
      track(ANALYTICS_EVENTS.MESSAGE_SENT, {
        has_attachments: (attachments?.length ?? 0) > 0,
        is_reply: !!parentMessageId,
        conversation_kind: conv?.type ?? null,
      });
    } catch (e) {
      console.warn(`[chat] sendMessage failed, removing placeholder`, e);
      set((s) => ({
        messages: {
          ...s.messages,
          [conversationId]: (s.messages[conversationId] ?? []).filter(
            (m) => m.id !== placeholder.id
          ),
        },
      }));
      throw e;
    }
  },

  deleteMessage: (conversationId, messageId) => {
    const removed = (get().messages[conversationId] ?? []).find(
      (m) => m.id === messageId
    );
    // Optimistic removal
    set((s) => ({
      messages: {
        ...s.messages,
        [conversationId]: (s.messages[conversationId] ?? []).filter(
          (m) => m.id !== messageId
        ),
      },
    }));
    ws.deleteMessage(conversationId, messageId).catch((e) => {
      console.warn(`[chat] deleteMessage failed, restoring`, e);
      if (removed) get().addMessage(conversationId, removed);
    });
  },

  setReplyingTo: (conversationId, message) => {
    set((s) => {
      const next = { ...s.replyingTo };
      if (message) {
        next[conversationId] = message;
      } else {
        delete next[conversationId];
      }
      return { replyingTo: next };
    });
  },

  addMessage: (conversationId, message) => {
    set((s) => {
      const existing = s.messages[conversationId] ?? [];
      if (existing.some((m) => m.id === message.id)) return s;

      // Nonce replacement: the server echo of our own message replaces the
      // optimistic placeholder we inserted in sendMessage.
      const nonce = (message.metadata as Record<string, unknown> | undefined)
        ?.client_nonce as string | undefined;
      if (nonce) {
        const placeholderId = `${PENDING_PREFIX}${nonce}`;
        if (existing.some((m) => m.id === placeholderId)) {
          return {
            messages: {
              ...s.messages,
              [conversationId]: existing.map((m) =>
                m.id === placeholderId ? message : m
              ),
            },
          };
        }
      }

      // Fast path: append if chronological; else sort
      const last = existing[existing.length - 1];
      const inOrder = !last || message.insertedAt >= last.insertedAt;
      const updated = [...existing, message];
      return {
        messages: {
          ...s.messages,
          [conversationId]: inOrder ? updated : sortMessages(updated),
        },
      };
    });
  },

  setRecentMessages: (conversationId, messages) => {
    set((s) => {
      const existing = s.messages[conversationId] ?? [];
      let sorted: Message[];
      if (existing.length === 0) {
        sorted = sortMessages(messages);
      } else {
        // Keep local messages newer than the server snapshot (new_message
        // events that arrived before recent_messages). Drop locally cached
        // messages the server omitted (deleted since last fetch).
        const incomingIds = new Set(messages.map((m) => m.id));
        const newestIncoming =
          messages.length > 0
            ? Math.max(...messages.map((m) => new Date(m.insertedAt).getTime()))
            : 0;
        const extras = existing.filter(
          (m) =>
            !incomingIds.has(m.id) &&
            new Date(m.insertedAt).getTime() > newestIncoming
        );
        sorted = sortMessages(dedup([...messages, ...extras]));
      }
      return { messages: { ...s.messages, [conversationId]: sorted } };
    });
  },

  setDraft: (conversationId, text) => {
    set((s) => ({ drafts: { ...s.drafts, [conversationId]: text } }));
  },

  setActiveConversation: (id, opts) => {
    const prev = get().activeConversationId;
    if (prev && prev !== id) {
      ws.leaveConversation(prev);
    }
    set((s) => {
      // Capture first unread message id for this conversation at open time,
      // so we can render a "New messages" divider. If there were no unread
      // messages we leave the slot undefined.
      let firstUnreadIds = s.firstUnreadIds;
      if (id) {
        const existing = s.messages[id] ?? [];
        const unread = s.unreadCounts[id] ?? 0;
        if (unread > 0 && existing.length >= unread) {
          const firstUnread = existing[existing.length - unread];
          firstUnreadIds = {
            ...s.firstUnreadIds,
            [id]: firstUnread?.id,
          };
        } else {
          // Clear any stale divider from a prior open
          if (s.firstUnreadIds[id] !== undefined) {
            const copy = { ...s.firstUnreadIds };
            delete copy[id];
            firstUnreadIds = copy;
          }
        }
      }
      return {
        activeConversationId: id,
        unreadCounts: id ? { ...s.unreadCounts, [id]: 0 } : s.unreadCounts,
        firstUnreadIds,
        scrollTargetMessageId: opts?.scrollToMessageId ?? null,
      };
    });
    if (id) {
      ws.joinConversation(id);
      if (!ws.markConversationRead(id)) {
        api.markConversationReadRest(id).catch((err) =>
          console.warn("[chat] mark-read REST fallback failed", id, err)
        );
      }
    }
  },

  clearScrollTarget: () => {
    if (get().scrollTargetMessageId !== null) set({ scrollTargetMessageId: null });
  },

  clearChatLocal: (conversationId) => {
    // Clears messages from the local store only — server history is
    // untouched. Matches web's clearChat action; the DB is still the
    // source of truth if you re-open the conversation on another device.
    set((s) => {
      const nextMessages = { ...s.messages };
      delete nextMessages[conversationId];
      const nextHasMore = { ...s.hasMore };
      delete nextHasMore[conversationId];
      const nextFirstUnread = { ...s.firstUnreadIds };
      delete nextFirstUnread[conversationId];
      return {
        messages: nextMessages,
        hasMore: nextHasMore,
        firstUnreadIds: nextFirstUnread,
      };
    });
  },

  fetchUnreadCounts: async () => {
    try {
      const data = await api.fetchUnreadCounts();
      set({ unreadCounts: data.unreadCounts });
    } catch (e) {
      console.warn("[chat] fetchUnreadCounts failed", e);
    }
  },

  incrementUnread: (conversationId) => {
    set((s) => ({
      unreadCounts: {
        ...s.unreadCounts,
        [conversationId]: (s.unreadCounts[conversationId] ?? 0) + 1,
      },
    }));
  },

  initWsListeners: () => {
    const unsubs: (() => void)[] = [];

    // thread_completed StatusUpdates don't render a card — the thread's
    // inline pill (AgentConversationCard) flips to its resolved state
    // instead. Patch the local agentConversations entry when the message
    // arrives so the flip is live rather than waiting for a refetch. Also
    // zero the thread's unread badge (mirrors the fetch-path clearing).
    const applyThreadCompletion = (msg: Message | undefined | null) => {
      if (!msg) return;
      const msgType = msg.messageType || msg.contentType || "";
      if (msgType !== "StatusUpdate" && msgType !== "status_update") return;
      try {
        const data = JSON.parse(msg.content) as Record<string, unknown>;
        if (data.type !== "thread_completed" || typeof data.thread_id !== "string")
          return;
        const threadId = data.thread_id;
        const status = data.outcome === "abandoned" ? "abandoned" : "resolved";
        set((s) => ({
          agentConversations: s.agentConversations.map((c) =>
            c.id === threadId
              ? { ...c, metadata: { ...(c.metadata ?? {}), thread_status: status } }
              : c
          ),
          unreadCounts: { ...s.unreadCounts, [threadId]: 0 },
        }));
      } catch {
        // not a JSON payload — nothing to do
      }
    };

    unsubs.push(
      ws.on("conv:new_message", (payload) => {
        const msg = payload as unknown as Message & { _conversationId: string };
        const convId = msg._conversationId ?? msg.conversationId;
        console.log("[chat] conv:new_message", {
          convId: convId?.slice(0, 8),
          msgId: msg.id?.slice(0, 8),
          senderId: msg.senderId?.slice(0, 8),
          active: get().activeConversationId?.slice(0, 8),
        });
        get().addMessage(convId, msg);
        applyThreadCompletion(msg);

        // Clear any active streaming bubble for this sender/stream — the
        // real message has landed, so the "is writing" placeholder should
        // disappear immediately rather than waiting for the 3s timeout.
        // Always run the sender-match fallback too — if no intermediate
        // streaming event ever fired (short/cached reply), the active stream
        // is still the `optimistic:${nonce}` placeholder and the by-streamId
        // clear would miss, leaving the bubble up until the stale reaper.
        const streamId = (msg.metadata as Record<string, unknown> | undefined)
          ?.stream_id as string | undefined;
        if (streamId) {
          useStreamingStore.getState().clearStreamByStreamId(streamId);
        }
        if (msg.senderId) {
          useStreamingStore.getState().clearStreamBySender(convId, msg.senderId);
          // Their message has landed — drop their typing indicator now
          // instead of letting the 3s/30s presence TTL run out.
          usePresenceStore.getState().clearTyping(convId, msg.senderId);
        }
      })
    );

    unsubs.push(
      ws.on("conv:recent_messages", (payload) => {
        const convId = payload._conversationId as string;
        const messages = payload.messages as Message[];
        get().setRecentMessages(convId, messages);
      })
    );

    unsubs.push(
      ws.on("conv:message_deleted", (payload) => {
        const convId = payload._conversationId as string;
        const messageId = payload.messageId as string;
        if (!convId || !messageId) return;
        set((s) => ({
          messages: {
            ...s.messages,
            [convId]: (s.messages[convId] ?? []).filter((m) => m.id !== messageId),
          },
        }));
      })
    );

    unsubs.push(
      ws.on("conv:conversation_title_changed", (payload) => {
        const convId =
          (payload._conversationId as string) ?? (payload.conversationId as string);
        const title = payload.title as string;
        if (!convId || !title) return;
        const update = (list: Conversation[]) =>
          list.map((c) => (c.id === convId ? { ...c, title } : c));
        set((s) => ({
          conversations: update(s.conversations),
          agentConversations: update(s.agentConversations),
        }));
      })
    );

    // User-channel mirror for title changes — catches conversations we
    // haven't joined the conv channel for (e.g. inactive list rows).
    unsubs.push(
      ws.on("conversation_title_changed", (payload) => {
        const convId = payload.conversationId as string;
        const title = payload.title as string;
        if (!convId || !title) return;
        const update = (list: Conversation[]) =>
          list.map((c) => (c.id === convId ? { ...c, title } : c));
        set((s) => ({
          conversations: update(s.conversations),
          agentConversations: update(s.agentConversations),
        }));
      })
    );

    // DM→group produced an auto-name the user should confirm. Stash the
    // suggestion; RenameToGroupModal renders off `pendingRename`.
    unsubs.push(
      ws.on("conversation_rename_suggested", (payload) => {
        const convId = payload.conversationId as string;
        const suggestedTitle = payload.suggestedTitle as string;
        if (!convId || !suggestedTitle) return;
        set({ pendingRename: { conversationId: convId, suggestedTitle } });
      })
    );

    // Answered on this or another device — dismiss the modal.
    unsubs.push(
      ws.on("conversation_rename_resolved", (payload) => {
        const convId = payload.conversationId as string;
        set((s) =>
          s.pendingRename?.conversationId === convId ? { pendingRename: null } : {}
        );
      })
    );

    // Avatar changes — conv + user channel, same shape.
    const applyAvatar = (convId: string, avatarUrl: string | null) => {
      const update = (list: Conversation[]) =>
        list.map((c) =>
          c.id === convId ? { ...c, avatarUrl: avatarUrl ?? undefined } : c
        );
      set((s) => ({
        conversations: update(s.conversations),
        agentConversations: update(s.agentConversations),
      }));
    };
    unsubs.push(
      ws.on("conv:conversation_avatar_changed", (payload) => {
        const convId =
          (payload._conversationId as string) ?? (payload.conversationId as string);
        if (!convId) return;
        applyAvatar(convId, (payload.avatarUrl as string | null) ?? null);
      })
    );
    unsubs.push(
      ws.on("conversation_avatar_changed", (payload) => {
        const convId = payload.conversationId as string;
        if (!convId) return;
        applyAvatar(convId, (payload.avatarUrl as string | null) ?? null);
      })
    );

    unsubs.push(
      ws.on("conversation_updated", (payload) => {
        const convId = payload.conversationId as string;
        const lastMessage = payload.lastMessage as Message;
        console.log("[chat] conversation_updated", {
          convId: convId?.slice(0, 8),
          hasLast: Boolean(lastMessage),
        });
        if (lastMessage) {
          get().updateConversationFromEvent(convId, lastMessage);
          // User-channel mirror — catches thread completions for parents
          // whose conv channel isn't joined (inactive list rows).
          applyThreadCompletion(lastMessage);
        }
        // Only bump unread for personal conversations — hidden agent threads
        // are observational and shouldn't accumulate badges.
        const isPersonal = get().conversations.some((c) => c.id === convId);
        if (isPersonal && convId !== get().activeConversationId) {
          get().incrementUnread(convId);
        }
      })
    );

    // Cross-device read sync: the user read this conversation on another
    // device. Zero the local badge so we don't show a false unread signal
    // for messages they've already consumed elsewhere.
    unsubs.push(
      ws.on("conversation_read", (payload) => {
        const convId = payload.conversationId as string;
        if (!convId) return;
        set((s) => {
          if ((s.unreadCounts[convId] ?? 0) === 0) return s;
          return { unreadCounts: { ...s.unreadCounts, [convId]: 0 } };
        });
      })
    );

    unsubs.push(
      ws.on("new_conversation", (payload) => {
        const conv = payload.conversation as Conversation;
        if (conv) get().addConversation(conv);
      })
    );

    // A child agent thread was created — re-fetch so the inline card appears.
    unsubs.push(
      ws.on("conv:sub_conversation_created", (payload) => {
        const convId = payload._conversationId as string;
        if (convId) {
          void get().fetchAgentConversations(convId);
        }
      })
    );

    return () => unsubs.forEach((u) => u());
  },
}));
