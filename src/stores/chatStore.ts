import { create } from "zustand";
import * as api from "../lib/api";
import type { Conversation, Message } from "../lib/api";
import { track, ANALYTICS_EVENTS } from "../lib/analytics";
import { ws } from "../services/websocket";
import { useAuthStore } from "./authStore";
import { useStreamingStore } from "./streamingStore";
import { usePresenceStore } from "./presenceStore";
import { agentConversationSourceId } from "../lib/thread-selectors";

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

/**
 * Capture the first-unread message id for a conversation at open time so
 * ChatThread can render a one-shot "New messages" divider. Returns the next
 * `firstUnreadIds` map (unchanged reference when there's nothing to update).
 * Shared by setActiveConversation (main pane) and openThread (side pane).
 */
function captureFirstUnread(
  firstUnreadIds: Record<string, string | undefined>,
  messages: Record<string, Message[]>,
  unreadCounts: Record<string, number>,
  id: string | null
): Record<string, string | undefined> {
  if (!id) return firstUnreadIds;
  const existing = messages[id] ?? [];
  const unread = unreadCounts[id] ?? 0;
  if (unread > 0 && existing.length >= unread) {
    return { ...firstUnreadIds, [id]: existing[existing.length - unread]?.id };
  }
  // Clear any stale divider from a prior open.
  if (firstUnreadIds[id] !== undefined) {
    const copy = { ...firstUnreadIds };
    delete copy[id];
    return copy;
  }
  return firstUnreadIds;
}

/** Mark a conversation read over WS, falling back to REST if not joined. */
function markRead(id: string) {
  if (!ws.markConversationRead(id)) {
    api.markConversationReadRest(id).catch((err) =>
      console.warn("[chat] mark-read REST fallback failed", id, err)
    );
  }
}

/** Only auto-mark-read while this window is actually in front of the user, so
 * an open-but-backgrounded conversation doesn't silently clear the unread
 * signal on every device. */
function windowFocused(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible" && document.hasFocus();
}

// Trailing debounce per conversation so a burst of streamed messages collapses
// into one mark-read round-trip instead of one per message.
const readDebounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};
function markReadDebounced(id: string) {
  clearTimeout(readDebounceTimers[id]);
  readDebounceTimers[id] = setTimeout(() => {
    delete readDebounceTimers[id];
    markRead(id);
  }, 500);
}

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
  /** True after `fetchConversations` has resolved at least once. Lets the
   *  onboarding cards distinguish "no conversations" from "not loaded yet". */
  conversationsLoaded: boolean;
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
  /** The agent thread currently open in the right side pane (Slack-style),
   *  or null when the details pane / nothing is shown there. Its parent is
   *  always the `activeConversationId` (openThread promotes the parent into
   *  the main pane), so both are live and joined at once. */
  activeThreadId: string | null;
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
  /** Toggle the caller's reaction: sends add/remove over WS; local state
   *  updates when the server's reaction_added/reaction_removed echoes back. */
  toggleReaction: (conversationId: string, messageId: string, emoji: string) => void;
  /** Apply a reaction_added/reaction_removed WS event to local message state. */
  applyReactionEvent: (
    conversationId: string,
    messageId: string,
    emoji: string,
    participantId: string,
    kind: "added" | "removed"
  ) => void;
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
  /** Open an agent thread in the side pane. Promotes the thread's parent into
   *  the main pane (if not already there) and keeps BOTH conversations joined
   *  so the parent stays live beside the thread (Slack "two conversations"). */
  openThread: (threadId: string) => void;
  /** Close the side-pane thread. Leaves its WS channel unless it's also the
   *  current main conversation. */
  closeThread: () => void;
  /** Clear the pending scroll target once ChatThread has handled (or given up
   *  on) it, so re-opening the same conversation doesn't re-trigger a jump. */
  clearScrollTarget: () => void;
  fetchUnreadCounts: () => Promise<void>;
  incrementUnread: (conversationId: string) => void;
  /** Mark a conversation read *only* if it's the one currently open (main pane
   * or side thread) AND this window is focused/visible. Called as messages
   * stream in so the server re-broadcasts `conversation_read` and our other
   * devices' badges clear while we read here. Debounced; no-ops when
   * backgrounded. */
  markReadIfActiveAndFocused: (conversationId: string) => void;

  // WS wiring — returns cleanup
  initWsListeners: () => () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  conversationsLoading: false,
  conversationsLoaded: false,
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
  activeThreadId: null,
  unreadCounts: {},
  scrollTargetMessageId: null,

  fetchConversations: async () => {
    set({ conversationsLoading: true });
    try {
      const convos = await api.listConversations("personal");
      set({ conversations: sortConversations(convos), conversationsLoaded: true });
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
      // Clear a matching pending so a later first-send promotion can't re-add
      // this id (the two-DM-rows race). upsertConversation already dedups by
      // id, so the list side is safe; this keeps the pending slot consistent.
      const pendingConversation =
        s.pendingConversation?.id === conv.id ? null : s.pendingConversation;
      if (isAgentScopedConversation(conv)) {
        return {
          pendingConversation,
          agentConversations: upsertConversation(s.agentConversations, conv),
        };
      }
      if (conv.parentConversationId || conv.type === "task") return { pendingConversation };
      return {
        pendingConversation,
        conversations: upsertConversation(s.conversations, conv),
      };
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
        activeThreadId:
          s.activeThreadId === conversationId ? null : s.activeThreadId,
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
      activeThreadId:
        s.activeThreadId === conversationId ? null : s.activeThreadId,
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
      // Promote a pending (just-created) conversation to the list on first send.
      // Guard against a double-insert: a WS `new_conversation` for the same id
      // may have already materialized it via addConversation (the race that
      // showed two DM rows until a refetch). Only prepend if it's absent.
      let conversations = s.conversations;
      let pendingConversation = s.pendingConversation;
      if (pendingConversation?.id === conversationId) {
        if (!conversations.some((c) => c.id === conversationId)) {
          conversations = sortConversations([pendingConversation, ...conversations]);
        }
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

  toggleReaction: (conversationId, messageId, emoji) => {
    const myId = useAuthStore.getState().participant?.id;
    if (!myId) return;

    const msg = (get().messages[conversationId] ?? []).find((m) => m.id === messageId);
    const mine = msg?.reactions
      ?.find((r) => r.emoji === emoji)
      ?.participantIds.includes(myId);

    const op = mine
      ? ws.removeReaction(conversationId, messageId, emoji)
      : ws.addReaction(conversationId, messageId, emoji);
    // No optimistic update — the server broadcast echoes back to us and
    // applyReactionEvent is the single writer, so add/remove can't drift.
    op.catch((e) => console.warn("[chat] toggleReaction failed", e));
  },

  applyReactionEvent: (conversationId, messageId, emoji, participantId, kind) => {
    set((s) => {
      const current = s.messages[conversationId] ?? [];
      const idx = current.findIndex((m) => m.id === messageId);
      if (idx < 0) return s;

      const msg = current[idx]!;
      const reactions = msg.reactions ?? [];
      let next: typeof reactions;

      if (kind === "added") {
        const entry = reactions.find((r) => r.emoji === emoji);
        if (entry?.participantIds.includes(participantId)) return s;
        next = entry
          ? reactions.map((r) =>
              r.emoji === emoji
                ? { ...r, participantIds: [...r.participantIds, participantId] }
                : r
            )
          : [...reactions, { emoji, participantIds: [participantId] }];
      } else {
        next = reactions
          .map((r) =>
            r.emoji === emoji
              ? { ...r, participantIds: r.participantIds.filter((p) => p !== participantId) }
              : r
          )
          .filter((r) => r.participantIds.length > 0);
      }

      const updated = [...current];
      updated[idx] = { ...msg, reactions: next };
      return { messages: { ...s.messages, [conversationId]: updated } };
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
    // Opening an agent thread never replaces the main pane — it belongs in
    // the side pane. Redirect legacy callers (sidebar rows, deep-links) so a
    // thread id always lands as a side-pane thread with its parent in the
    // main pane, rather than swallowing the main conversation.
    if (id) {
      const conv = get().getConversation(id);
      if (conv && agentConversationSourceId(conv)) {
        get().openThread(id);
        if (opts?.scrollToMessageId) set({ scrollTargetMessageId: opts.scrollToMessageId });
        return;
      }
    }

    const prev = get().activeConversationId;
    if (prev && prev !== id) {
      ws.leaveConversation(prev);
    }
    // Switching the main conversation tears down any open side-pane thread —
    // otherwise its channel leaks and the pane clings to an unrelated parent.
    const openThreadId = get().activeThreadId;
    if (openThreadId && openThreadId !== id && openThreadId !== prev) {
      ws.leaveConversation(openThreadId);
    }

    set((s) => ({
      activeConversationId: id,
      activeThreadId: null,
      unreadCounts: id ? { ...s.unreadCounts, [id]: 0 } : s.unreadCounts,
      firstUnreadIds: captureFirstUnread(s.firstUnreadIds, s.messages, s.unreadCounts, id),
      scrollTargetMessageId: opts?.scrollToMessageId ?? null,
    }));
    if (id) {
      ws.joinConversation(id);
      markRead(id);
    }
  },

  openThread: (threadId) => {
    const thread = get().getConversation(threadId);
    const parentId = thread ? agentConversationSourceId(thread) : undefined;

    // Bring the parent into the main pane if a different conversation is
    // active (e.g. opened from a sidebar deep-link). Keep it joined.
    if (parentId && parentId !== get().activeConversationId) {
      get().setActiveConversation(parentId);
    }

    // Tear down a previously-open thread that isn't the parent or the target.
    const prevThread = get().activeThreadId;
    if (prevThread && prevThread !== threadId && prevThread !== get().activeConversationId) {
      ws.leaveConversation(prevThread);
    }

    set((s) => ({
      activeThreadId: threadId,
      unreadCounts: { ...s.unreadCounts, [threadId]: 0 },
      firstUnreadIds: captureFirstUnread(s.firstUnreadIds, s.messages, s.unreadCounts, threadId),
    }));

    ws.joinConversation(threadId);
    markRead(threadId);
  },

  closeThread: () => {
    const threadId = get().activeThreadId;
    if (!threadId) return;
    // Leave the channel unless it doubles as the main conversation.
    if (threadId !== get().activeConversationId) {
      ws.leaveConversation(threadId);
    }
    set({ activeThreadId: null });
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

  markReadIfActiveAndFocused: (conversationId) => {
    const { activeConversationId, activeThreadId } = get();
    if (conversationId !== activeConversationId && conversationId !== activeThreadId) {
      return;
    }
    if (!windowFocused()) return;
    markReadDebounced(conversationId);
  },

  initWsListeners: () => {
    const unsubs: (() => void)[] = [];

    // Returning focus to a conversation left open (messages may have arrived
    // while the window was backgrounded, when the new_message path deliberately
    // skips the mark) should mark it read now, so our other devices' badges
    // clear once we're actually looking at it again.
    const markActiveReadOnFocus = () => {
      const { activeThreadId, activeConversationId } = get();
      const id = activeThreadId ?? activeConversationId;
      if (id) get().markReadIfActiveAndFocused(id);
    };
    if (typeof window !== "undefined") {
      window.addEventListener("focus", markActiveReadOnFocus);
      document.addEventListener("visibilitychange", markActiveReadOnFocus);
      unsubs.push(() => {
        window.removeEventListener("focus", markActiveReadOnFocus);
        document.removeEventListener("visibilitychange", markActiveReadOnFocus);
      });
    }

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

        // Keep an open+focused conversation marked read as messages stream in,
        // not only at open time. Otherwise the server never re-broadcasts
        // `conversation_read`, and our OTHER devices' unread badges climb while
        // we're actively reading the thread here.
        get().markReadIfActiveAndFocused(convId);

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

    for (const [event, kind] of [
      ["conv:reaction_added", "added"],
      ["conv:reaction_removed", "removed"],
    ] as const) {
      unsubs.push(
        ws.on(event, (payload) => {
          const convId = payload._conversationId as string;
          const messageId = payload.messageId as string;
          const emoji = payload.emoji as string;
          const participantId = payload.participantId as string;
          if (!convId || !messageId || !emoji || !participantId) return;
          get().applyReactionEvent(convId, messageId, emoji, participantId, kind);
        })
      );
    }

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
        if (!conv) return;
        // Slack-style: drop conversations pinned to a workspace the
        // user isn't currently active in.
        const activeOrg =
          useAuthStore.getState().participant?.activeOrganizationId;
        if (conv.organizationId && activeOrg && conv.organizationId !== activeOrg) {
          return;
        }
        get().addConversation(conv);
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
