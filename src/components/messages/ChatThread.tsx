import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, Loader2 } from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import { useAuthStore } from "../../stores/authStore";
import { usePresenceStore } from "../../stores/presenceStore";
import { useStreamingStore } from "../../stores/streamingStore";
import { useTaskStore } from "../../stores/taskStore";
import { MessageBubble } from "./MessageBubble";
import { isStatusUpdateMessage } from "./StatusUpdateMessage";
import { isTaskMessage } from "./TaskMessages";
import { MessageContextMenu } from "./MessageContextMenu";
import { StreamingBubble } from "./StreamingBubble";
import { AgentConversationCard } from "./AgentConversationCard";
import { ArtifactCard } from "./ArtifactCard";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { cn, dayKey, formatDayLabel } from "../../lib/utils";
import { buildTypingText } from "../../lib/typing-indicator";
import { agentConversationSourceId } from "../../lib/thread-selectors";
import type { Artifact, Conversation, Message } from "../../lib/api";
import { useArtifactStore } from "../../stores/artifactStore";
import { ws } from "../../services/websocket";

const SENDER_RUN_BREAK_MS = 2 * 60 * 1000;
const SCROLL_BOTTOM_THRESHOLD = 120;

const EMPTY_MESSAGES: Message[] = [];
const EMPTY_ARTIFACTS: Artifact[] = [];

// --- Task-message consolidation (ported from web/src/components/ChatView.tsx)
//
// The server emits a sequence of messages per task_id (TaskRequest →
// TaskProgress → TaskComplete/TaskFail), plus StatusUpdate messages for
// the same lifecycle. Rendering each as its own card stacks the thread
// with duplicates. Instead:
//   1. Compute latest status per task_id across the thread.
//   2. Hide TaskProgress / TaskComplete / TaskFail / TaskAccept / TaskReject
//      — their info lives on the TaskRequest card.
//   3. Keep only the first StatusUpdate per task_id.
//   4. Mutate TaskRequest.taskSnapshot.status to the latest so the
//      request card flips to "complete" / "failed" in place.
// Web + mobile + desktop all share this rule so a task renders as a
// single live card per task_id.

const HIDDEN_MSG_TYPES = new Set([
  "TaskReassign",
  "TaskDeclined",
  "EndTurn",
  "TurnDirective",
  "CapabilityUpdate",
  "capability_negotiation",
]);
const TYPED_LIFECYCLE_TYPES = new Set([
  "TaskProgress",
  "TaskComplete",
  "TaskFail",
  "TaskAccept",
  "TaskReject",
]);
const STATUS_LIFECYCLE_TYPES = new Set([
  "task_delegated",
  "task_self_assigned",
  "task_accepted",
  "task_in_progress",
  "task_complete",
  "task_complete_summary",
  "task_failed",
  "task_cancelled",
]);
const LIFECYCLE_TO_STATUS: Record<string, string> = {
  task_delegated: "in_progress",
  task_self_assigned: "in_progress",
  task_accepted: "in_progress",
  task_in_progress: "in_progress",
  task_complete: "complete",
  task_complete_summary: "complete",
  task_failed: "failed",
  task_cancelled: "cancelled",
};
const BARE_STATUS_TO_LIFECYCLE: Record<string, string> = {
  pending: "task_delegated",
  in_progress: "task_in_progress",
  accepted: "task_accepted",
  complete: "task_complete",
  failed: "task_failed",
  declined: "task_failed",
  blocked: "task_in_progress",
  cancelled: "task_cancelled",
};

// Monotonic status rank — prevents an older/earlier lifecycle update from
// overwriting a newer one during hydration. Matches web's STATUS_RANK.
const STATUS_RANK: Record<string, number> = {
  pending: 0,
  in_progress: 1,
  accepted: 1,
  blocked: 1,
  complete: 2,
  failed: 2,
  declined: 2,
  cancelled: 2,
};

// Screen-reader phase announcements — mirrors StreamingBubble's visual
// phase labels without exposing the token stream to aria-live. Holds i18n
// KEYS (resolved with t() at render) so live language switching works.
const STREAM_PHASE_ANNOUNCEMENT_KEYS: Record<string, string> = {
  thinking: "streamAnnounce.thinking",
  tool_call: "streamAnnounce.toolCall",
  writing: "streamAnnounce.writing",
  analyzing: "streamAnnounce.analyzing",
  queued: "streamAnnounce.queued",
  waiting: "streamAnnounce.waiting",
};

function isThreadCreationAckMessage(message: Message): boolean {
  return (
    message.sender?.type === "agent" &&
    /^\[Continuing in DM with [^\]\n]+\]$/.test((message.content || "").trim())
  );
}

function extractTaskId(msg: Message): string | undefined {
  return (
    msg.taskSnapshot?.id ??
    ((msg.metadata as Record<string, unknown> | undefined)?.task_id as
      | string
      | undefined)
  );
}

function consolidate(messages: Message[]): Message[] {
  // Pass 1: latest status per task_id.
  const latestByTaskId = new Map<string, string>();
  for (const msg of messages) {
    const type = msg.messageType || msg.contentType || "";

    if (type === "StatusUpdate" || type === "status_update") {
      try {
        const data = JSON.parse(msg.content) as Record<string, unknown>;
        const taskId = data.task_id as string | undefined;
        const raw = (data.lifecycle_type ?? data.type ?? data.status) as
          | string
          | undefined;
        if (!taskId || !raw) continue;
        const lifecycle = BARE_STATUS_TO_LIFECYCLE[raw] ?? raw;
        const status = LIFECYCLE_TO_STATUS[lifecycle];
        if (status) latestByTaskId.set(taskId, status);
      } catch {
        // not JSON payload — skip
      }
    }

    const taskId = extractTaskId(msg);
    if (taskId && TYPED_LIFECYCLE_TYPES.has(type)) {
      const next: Record<string, string> = {
        TaskAccept: "in_progress",
        TaskProgress: "in_progress",
        TaskComplete: "complete",
        TaskFail: "failed",
        TaskReject: "declined",
      };
      if (next[type]) latestByTaskId.set(taskId, next[type]!);
    }
  }

  // Pass 2: filter + enrich.
  const seenStatusUpdateForTask = new Set<string>();
  return messages
    .filter((msg) => {
      const type = msg.messageType || msg.contentType || "";
      if (isThreadCreationAckMessage(msg)) return false;
      if (HIDDEN_MSG_TYPES.has(type)) return false;

      const taskId = extractTaskId(msg);

      // Strip lifecycle bubbles — they roll into the TaskRequest card.
      if (taskId && TYPED_LIFECYCLE_TYPES.has(type)) return false;

      // Dedupe StatusUpdate cards: one per task_id.
      if (type === "StatusUpdate" || type === "status_update") {
        try {
          const data = JSON.parse(msg.content) as Record<string, unknown>;
          // thread_completed has no card of its own — the inline thread
          // pill (AgentConversationCard) flips to resolved instead
          // (chatStore patches thread_status on arrival). Filter here so
          // MessageBubble doesn't render an empty avatar/name scaffold.
          if (data.type === "thread_completed") return false;
          const suTaskId = data.task_id as string | undefined;
          const raw = (data.lifecycle_type ?? data.type ?? data.status) as
            | string
            | undefined;
          if (!suTaskId || !raw) return true;
          const lifecycle = BARE_STATUS_TO_LIFECYCLE[raw] ?? raw;
          if (!STATUS_LIFECYCLE_TYPES.has(lifecycle)) return true;
          if (seenStatusUpdateForTask.has(suTaskId)) return false;
          seenStatusUpdateForTask.add(suTaskId);
          return true;
        } catch {
          return true;
        }
      }
      return true;
    })
    .map((msg) => {
      const type = msg.messageType || msg.contentType || "";
      if (type !== "TaskRequest") return msg;
      const taskId = extractTaskId(msg);
      if (!taskId || !latestByTaskId.has(taskId)) return msg;
      return {
        ...msg,
        taskSnapshot: {
          ...(msg.taskSnapshot ?? {}),
          id: taskId,
          status: latestByTaskId.get(taskId),
        },
      };
    });
}

type ThreadItem =
  | { kind: "message"; id: string; insertedAt: string; message: Message }
  | {
      kind: "agent_conversation";
      id: string;
      insertedAt: string;
      conversation: Conversation;
    }
  | { kind: "artifact"; id: string; insertedAt: string; artifact: Artifact };

function buildThreadItems(
  messages: Message[],
  agentConversations: Conversation[],
  artifacts: Artifact[]
): ThreadItem[] {
  const messageIds = new Set(messages.map((message) => message.id));
  const conversationsByMessage = new Map<string, Conversation[]>();
  const unanchoredConversations: Conversation[] = [];

  for (const conversation of agentConversations) {
    const sourceMessageId = linkedSourceMessageId(conversation);
    if (sourceMessageId && messageIds.has(sourceMessageId)) {
      const existing = conversationsByMessage.get(sourceMessageId) ?? [];
      existing.push(conversation);
      conversationsByMessage.set(sourceMessageId, existing);
    } else {
      // No source_message_id, or the anchoring message hasn't been loaded
      // yet (scrolled off, paginated out). Show as unanchored rather than
      // silently dropping the card.
      unanchoredConversations.push(conversation);
    }
  }

  const itemForConversation = (conversation: Conversation): ThreadItem => ({
    kind: "agent_conversation",
    id: `agent-conversation:${conversation.id}`,
    insertedAt: conversation.insertedAt ?? conversation.updatedAt,
    conversation,
  });

  // Artifacts anchor at their CREATION position (insertedAt, not updatedAt) —
  // an edit updates the card in place, it never jumps down the stream.
  // Mirrors mobile's mergeArtifactsIntoTimeline.
  const artifactItems: ThreadItem[] = artifacts.map((artifact) => ({
    kind: "artifact",
    id: `artifact:${artifact.id}`,
    insertedAt: artifact.insertedAt,
    artifact,
  }));

  const unanchoredItems = unanchoredConversations
    .map(itemForConversation)
    .concat(artifactItems)
    .sort((a, b) => {
      const diff =
        new Date(a.insertedAt).getTime() - new Date(b.insertedAt).getTime();
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });

  const items: ThreadItem[] = [];
  let unanchoredIndex = 0;

  for (const message of messages) {
    const messageTime = new Date(message.insertedAt).getTime();
    while (
      unanchoredIndex < unanchoredItems.length &&
      new Date(unanchoredItems[unanchoredIndex]!.insertedAt).getTime() <= messageTime
    ) {
      items.push(unanchoredItems[unanchoredIndex]!);
      unanchoredIndex += 1;
    }

    const children = conversationsByMessage.get(message.id) ?? [];
    children.sort(
      (a, b) =>
        new Date(a.insertedAt ?? a.updatedAt).getTime() -
        new Date(b.insertedAt ?? b.updatedAt).getTime()
    );

    items.push(
      {
        kind: "message",
        id: message.id,
        insertedAt: message.insertedAt,
        message,
      },
      ...children.map(itemForConversation)
    );
  }

  while (unanchoredIndex < unanchoredItems.length) {
    items.push(unanchoredItems[unanchoredIndex]!);
    unanchoredIndex += 1;
  }

  return items;
}

// `agentConversationSourceId` lives in lib/thread-selectors.ts — the
// shared helper used by ThreadsBar / ThreadsPanel too. Kept the
// `linkedSourceMessageId` helper local since it's only used here to
// anchor child-thread cards under their spawning message.

function linkedSourceMessageId(conversation: Conversation): string | undefined {
  const metadata = (conversation.metadata ?? {}) as Record<string, unknown>;
  return (
    (typeof metadata.source_message_id === "string"
      ? (metadata.source_message_id as string)
      : undefined) ??
    (typeof metadata.sourceMessageId === "string"
      ? (metadata.sourceMessageId as string)
      : undefined)
  );
}

export function ChatThread({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation("chat");
  const messagesRaw = useChatStore((s) => s.messages[conversationId]);
  const rawMessages = messagesRaw ?? EMPTY_MESSAGES;

  // Hydrate taskLifecycleMeta from StatusUpdate messages before we filter
  // them. Pulls summary / error / agentName / agentAvatarUrl out of each
  // lifecycle payload into the task store so the expanded Completion /
  // Failure cards have rich data to render. Mirrors web's hydration pass
  // in ChatView.tsx:187-220. Without this desktop's expanded cards only
  // ever saw the in-message payload, missing the summary and agent info
  // that StatusUpdate carries.
  //
  // Must be a useEffect — writing to the task store during render (e.g. via
  // useMemo) synchronously notifies Zustand subscribers and can drive an
  // infinite re-render loop on threads that carry StatusUpdate messages.
  useEffect(() => {
    const update = useTaskStore.getState().updateTaskLifecycleMeta;
    for (const msg of rawMessages) {
      const type = msg.messageType || msg.contentType || "";
      const isStatusUpdate = type === "StatusUpdate" || type === "status_update";
      if (!isStatusUpdate) continue;
      try {
        const data = JSON.parse(msg.content) as Record<string, unknown>;
        const taskId = data.task_id as string | undefined;
        const rawType = (data.lifecycle_type ?? data.type ?? data.status) as
          | string
          | undefined;
        if (!taskId || !rawType) continue;
        const lifecycle = BARE_STATUS_TO_LIFECYCLE[rawType] ?? rawType;
        const newStatus = LIFECYCLE_TO_STATUS[lifecycle];
        if (!newStatus) continue;

        // Only overwrite if the new status rank is >= current — otherwise
        // an early "pending" StatusUpdate could clobber a later "complete".
        const current = useTaskStore.getState().taskLifecycleMeta[taskId]
          ?.effectiveStatus;
        const currentRank = current ? STATUS_RANK[current] ?? -1 : -1;
        const newRank = STATUS_RANK[newStatus] ?? 0;
        if (newRank < currentRank) continue;

        const meta: Partial<{
          effectiveStatus: string;
          summary: string;
          error: string;
          agentName: string;
          agentAvatarUrl: string;
        }> = { effectiveStatus: newStatus };
        if (typeof data.summary === "string") meta.summary = data.summary;
        if (typeof data.error === "string") meta.error = data.error;
        const name = (data.agent_name ??
          data.assignee_name ??
          msg.sender?.displayName) as string | undefined;
        const avatar = (data.agent_avatar_url ??
          data.assignee_avatar_url ??
          msg.sender?.avatarUrl) as string | undefined;
        if (name) meta.agentName = name;
        if (avatar) meta.agentAvatarUrl = avatar;

        update(taskId, meta);
      } catch {
        // payload wasn't JSON — skip
      }
    }
  }, [rawMessages]);

  // Roll task lifecycle / status-update messages into the TaskRequest card
  // so a single task_id renders as one live card, not a stack of three.
  const messages = useMemo(() => consolidate(rawMessages), [rawMessages]);
  const loading = useChatStore((s) => s.messagesLoading[conversationId] ?? false);
  const hasMore = useChatStore((s) => s.hasMore[conversationId] ?? false);
  const fetchMessages = useChatStore((s) => s.fetchMessages);
  const fetchAgentConversations = useChatStore((s) => s.fetchAgentConversations);
  const agentConversationsLoading = useChatStore((s) => s.agentConversationsLoading);
  const agentConversations = useChatStore((s) => s.agentConversations);
  const setReplyingTo = useChatStore((s) => s.setReplyingTo);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const stopAgents = useChatStore((s) => s.stopAgents);
  const firstUnreadId = useChatStore((s) => s.firstUnreadIds[conversationId]);
  // Deep-link target: when the Files view (or any caller) opens this
  // conversation at a specific message, scroll to and flash it once loaded.
  const scrollTargetMessageId = useChatStore((s) => s.scrollTargetMessageId);
  const clearScrollTarget = useChatStore((s) => s.clearScrollTarget);
  const myId = useAuthStore((s) => s.participant?.id);
  const turnAnchorEnabled = useAuthStore(
    (s) => s.participant?.features?.turn_anchor === true
  );
  const conversationType = useChatStore(
    (s) => s.conversations.find((c) => c.id === conversationId)?.type
  );
  const conversationMembers = useChatStore(
    (s) =>
      (
        s.conversations.find((c) => c.id === conversationId) ??
        s.agentConversations.find((c) => c.id === conversationId)
      )?.members
  );
  const artifacts = useArtifactStore(
    (s) => s.artifacts[conversationId] ?? EMPTY_ARTIFACTS
  );

  // Artifacts interleave into the timeline at their creation position.
  // Initial load per conversation; live changes arrive via the artifact
  // store's WS listeners (artifact_created / artifact_updated).
  useEffect(() => {
    useArtifactStore
      .getState()
      .fetchArtifactsIfNeeded(conversationId)
      .catch(() => {});
  }, [conversationId]);

  const typingIds = usePresenceStore((s) => s.typing[conversationId]);
  const typingNames = usePresenceStore((s) => s.typingNames);
  const typingTypes = usePresenceStore((s) => s.typingTypes);
  const stream = useStreamingStore((s) => s.streams[conversationId]);
  const [stoppingAgents, setStoppingAgents] = useState(false);

  const handleStopAgents = useCallback(async () => {
    setStoppingAgents(true);
    try {
      await stopAgents(conversationId);
    } catch (e) {
      console.warn("[chat] stopAgents failed", e);
    } finally {
      setStoppingAgents(false);
    }
  }, [stopAgents, conversationId]);

  const childAgentConversations = useMemo(
    () =>
      agentConversations
        .filter(
          (c) =>
            c.id !== conversationId &&
            c.type !== "task" &&
            agentConversationSourceId(c) === conversationId
        )
        .sort(
          (a, b) =>
            new Date(a.insertedAt).getTime() -
            new Date(b.insertedAt).getTime()
        ),
    [agentConversations, conversationId]
  );

  const childAgentConversationIds = useMemo(
    () => childAgentConversations.map((c) => c.id).join("|"),
    [childAgentConversations]
  );

  const threadItems = useMemo(
    () => buildThreadItems(messages, childAgentConversations, artifacts),
    [messages, childAgentConversations, artifacts]
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const prevConvIdRef = useRef<string | null>(null);
  // `pinnedRef` is the single source of truth for "stick to the latest
  // message." It starts true (open at the bottom, like mobile's inverted
  // list) and releases only when the user scrolls up. Every scroll-to-bottom
  // path gates on it so we never yank someone reading history.
  const pinnedRef = useRef(true);
  // "New messages" on the jump pill: raised when the newest item changes
  // while the user is scrolled up; cleared whenever they reach the bottom.
  const [showNewPill, setShowNewPill] = useState(false);
  const lastItemIdRef = useRef<string | null>(null);
  // Last observed scrollTop — lets handleScroll tell a genuine upward user
  // scroll (releases the pin) apart from a programmatic re-snap or load-time
  // content growth (must NOT release it). See handleScroll for why.
  const lastScrollTopRef = useRef(0);
  // Scroller metrics captured when an older-history fetch fires, consumed by
  // the prepend-compensation layout effect so pagination doesn't shove the
  // viewport. convId/firstId guard against stale anchors.
  const prependAnchorRef = useRef<{
    convId: string;
    firstId: string;
    scrollHeight: number;
    scrollTop: number;
  } | null>(null);
  // Armed on conversation open when there's a first-unread anchor to scroll
  // to; consumed once the divider has been positioned.
  const unreadAnchorPendingRef = useRef(false);
  // --- Turn positioning (feature flag `turn_anchor`, direct conversations
  // only): sending scrolls YOUR message near the top of the viewport and the
  // reply streams into the space below (Claude.ai-style), instead of pinning
  // to the bottom edge. The spacer div gives short threads room to position
  // the message at the top; it shrinks as the reply grows.
  const turnAnchorArmedRef = useRef(false);
  const turnAnchorIdRef = useRef<string | null>(null);
  const turnSpacerRef = useRef<HTMLDivElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const agentConversationsFetchAttemptedRef = useRef<string | null>(null);
  // `nearBottom` is UI-only — it drives the "Jump to latest" pill. It mirrors
  // pinnedRef but lives in state so the button re-renders.
  const [nearBottom, setNearBottom] = useState(true);
  // Pair with `.scrollbar-autohide` CSS: toggled on during active scroll so
  // the thumb is visible while the user's actually moving content, then
  // fades out again. CSS :hover covers the "about to scroll" case.
  const scrollIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [menu, setMenu] = useState<{
    message: Message;
    x: number;
    y: number;
  } | null>(null);

  // Deep-link scroll: which message is currently flashed, plus a bounded
  // counter so paging-back to find an old target can't loop forever.
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const deepLinkTargetRef = useRef<string | null>(null);
  const deepLinkAttemptsRef = useRef(0);

  useEffect(() => {
    if (messages.length === 0 && !loading) {
      fetchMessages(conversationId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Parent conversations need the hidden agent-thread list so inline
  // AgentConversationCard rows can render without a separate sidebar.
  useEffect(() => {
    if (
      conversationId &&
      !agentConversationsLoading &&
      agentConversationsFetchAttemptedRef.current !== conversationId
    ) {
      agentConversationsFetchAttemptedRef.current = conversationId;
      void fetchAgentConversations(conversationId).catch((e) => {
        console.warn("[chat] fetchAgentConversations failed", e);
        window.setTimeout(() => {
          if (agentConversationsFetchAttemptedRef.current === conversationId) {
            agentConversationsFetchAttemptedRef.current = null;
          }
        }, 5000);
      });
    }
  }, [
    conversationId,
    agentConversationsLoading,
    fetchAgentConversations,
  ]);

  // Join child agent conversations while the parent thread is open so the
  // inline card can show real recent messages + streaming state, not only
  // stale `lastMessage` snapshots. Leaving skips the child that just became
  // active via click-through to avoid racing `setActiveConversation()`.
  useEffect(() => {
    if (!childAgentConversationIds) return;
    const ids = childAgentConversationIds.split("|").filter(Boolean);
    ids.forEach((id) => ws.joinConversation(id));
    return () => {
      const activeId = useChatStore.getState().activeConversationId;
      ids.forEach((id) => {
        if (activeId !== id) ws.leaveConversation(id);
      });
    };
  }, [childAgentConversationIds]);

  // Snap the scroller hard to the bottom. `scrollTop = scrollHeight` is the
  // only call that reliably reaches the true bottom — a smooth `scrollTo`
  // can be interrupted by the height still settling, leaving the latest
  // message stranded above the fold on long threads.
  const snapToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Interaction-as-intent: an active text selection inside the scroller means
  // the user is reading/copying — content-growth re-snaps must not yank the
  // viewport mid-selection, even while pinned. Explicit actions (send, the
  // pill) still snap unconditionally.
  const isSelectingInThread = useCallback(() => {
    const sel = window.getSelection();
    return (
      !!sel &&
      !sel.isCollapsed &&
      !!scrollRef.current &&
      scrollRef.current.contains(sel.anchorNode)
    );
  }, []);

  // Turn positioning, step 3: as the reply streams in below the anchor, keep
  // total below-anchor height ~one viewport by shrinking the spacer. Runs
  // from the content ResizeObserver. (Steps 1–2 live beside the send effect
  // further down.)
  const maintainTurnSpacer = useCallback(() => {
    const anchorId = turnAnchorIdRef.current;
    const scroller = scrollRef.current;
    const spacer = turnSpacerRef.current;
    if (!anchorId || !scroller || !spacer) return;
    const anchorNode = scroller.querySelector(`[data-msg-id="${CSS.escape(anchorId)}"]`);
    if (!anchorNode) return;
    const belowAnchorExclSpacer =
      spacer.getBoundingClientRect().top - anchorNode.getBoundingClientRect().top;
    const next = Math.max(0, scroller.clientHeight - belowAnchorExclSpacer - 24);
    const current = spacer.offsetHeight;
    if (Math.abs(next - current) > 1) spacer.style.height = `${next}px`;
  }, []);

  // On conversation switch, re-arm the pin so opening a thread always lands
  // at the latest message even if the user had scrolled up in the prior one.
  // Declared before the snap effect so a switch re-arms the pin *before* the
  // snap runs — otherwise a thread the user had scrolled up in would skip the
  // post-paint re-snaps below.
  useLayoutEffect(() => {
    if (prevConvIdRef.current === conversationId) return;
    prevConvIdRef.current = conversationId;
    // If we're opening straight to a deep-linked message, don't pin to the
    // bottom — the deep-link effect below will scroll to the target instead,
    // and pinning would make the autoscroll snap fight that jump. Likewise a
    // conversation with unreads opens anchored at the "New messages" divider
    // (pin released), not the absolute bottom.
    const state = useChatStore.getState();
    const hasTarget = state.scrollTargetMessageId !== null;
    const hasUnreadAnchor = !!state.firstUnreadIds[conversationId];
    unreadAnchorPendingRef.current = !hasTarget && hasUnreadAnchor;
    const pinned = !hasTarget && !hasUnreadAnchor;
    pinnedRef.current = pinned;
    setNearBottom(pinned);
    lastItemIdRef.current = null;
    lastScrollTopRef.current = 0;
    prependAnchorRef.current = null;
    turnAnchorArmedRef.current = false;
    turnAnchorIdRef.current = null;
    if (turnSpacerRef.current) turnSpacerRef.current.style.height = "0px";
    setShowNewPill(false);
  }, [conversationId]);

  // Position the unread divider near the top of the viewport once it renders.
  // Retries on threadItems changes until it exists, then consumes the flag.
  useLayoutEffect(() => {
    if (!unreadAnchorPendingRef.current) return;
    if (!firstUnreadId) {
      unreadAnchorPendingRef.current = false;
      return;
    }
    const node = scrollRef.current?.querySelector("[data-unread-divider]");
    if (!node) return;
    unreadAnchorPendingRef.current = false;
    node.scrollIntoView({ block: "start" });
  }, [firstUnreadId, threadItems.length, conversationId]);

  // Autoscroll — mimics mobile's inverted list: every thread opens at the
  // latest message and stays pinned there as content arrives, until the user
  // scrolls up. We snap synchronously (pre-paint) and again across two
  // animation frames, because cards and image attachments render with no
  // reserved height — the list keeps growing for a beat after the first snap.
  // The ResizeObserver below covers async growth that lands after these
  // frames (e.g. a slow image). Gated on `pinnedRef` so a user reading
  // history is never yanked back down.
  useLayoutEffect(() => {
    if (!pinnedRef.current || isSelectingInThread()) return;
    snapToBottom();
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      snapToBottom();
      r2 = requestAnimationFrame(snapToBottom);
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, [conversationId, threadItems.length, stream, snapToBottom, isSelectingInThread]);

  // Keep the view pinned to the bottom while the message list's height
  // settles. Image attachments fetch their download URL async and render
  // with no reserved height, so a long thread keeps growing for a beat
  // after the one-shot scroll fires — stranding the latest message below
  // the fold. This callback ref wires a ResizeObserver to the message
  // container that re-snaps on every height change, but only while the user
  // is still pinned there (pinnedRef).
  const contentRef = useCallback((node: HTMLDivElement | null) => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      const el = scrollRef.current;
      if (el && pinnedRef.current && !isSelectingInThread()) {
        el.scrollTop = el.scrollHeight;
      }
      maintainTurnSpacer();
    });
    observer.observe(node);
    resizeObserverRef.current = observer;
  }, [isSelectingInThread, maintainTurnSpacer]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const top = el.scrollTop;
    // Only a genuine upward user scroll releases the pin. Programmatic
    // re-snaps (snapToBottom / the ResizeObserver) and load-time content
    // growth move scrollTop DOWN or leave it unchanged — never up — so they
    // can no longer flip the pin off on a half-settled mid-load measurement.
    // That flip-off was the regression that stranded long conversations blank
    // below the fold once the pending-message row started perturbing the
    // height mid-load (#50). Re-arming at the bottom stays unconditional.
    const movedUp = top < lastScrollTopRef.current - 1;
    lastScrollTopRef.current = top;
    const distanceFromBottom = el.scrollHeight - el.clientHeight - top;
    if (distanceFromBottom < 24) {
      pinnedRef.current = true;
    } else if (movedUp) {
      pinnedRef.current = false;
    }
    if (pinnedRef.current) {
      setShowNewPill(false);
      // Reaching the bottom ends the turn-anchored reading position — the
      // user asked to follow the latest again, so collapse the spacer.
      if (turnAnchorIdRef.current) {
        turnAnchorIdRef.current = null;
        if (turnSpacerRef.current) turnSpacerRef.current.style.height = "0px";
      }
    }
    // The "Jump to latest" pill uses a roomier threshold so it doesn't flash
    // for a few px of overscroll.
    setNearBottom(distanceFromBottom < SCROLL_BOTTOM_THRESHOLD);

    // Pulse the auto-hide scrollbar on for ~800ms of idle after a scroll event.
    el.classList.add("is-scrolling");
    if (scrollIdleTimerRef.current) clearTimeout(scrollIdleTimerRef.current);
    scrollIdleTimerRef.current = setTimeout(() => {
      el.classList.remove("is-scrolling");
    }, 800);

    if (hasMore && !loading && el.scrollTop < 80) {
      // Use the raw oldest (not the consolidated one) as the pagination
      // anchor — a filtered TaskProgress could have been the earliest record.
      const oldest = rawMessages[0];
      if (oldest) {
        prependAnchorRef.current = {
          convId: conversationId,
          firstId: oldest.id,
          scrollHeight: el.scrollHeight,
          scrollTop: el.scrollTop,
        };
        // `before` is a DATETIME cursor server-side (parse_datetime) — an id
        // parses to nil and silently refetches the newest page forever.
        fetchMessages(conversationId, oldest.insertedAt);
      }
    }
  };

  // Prepend compensation: after older history renders above the viewport,
  // shift scrollTop by the inserted height so the message the user was
  // reading stays put. The scroller runs with overflow-anchor:none, so this
  // is the only anchoring in play (no double-compensation from the browser).
  const firstRawId = rawMessages[0]?.id;
  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    if (!anchor) return;
    if (anchor.convId !== conversationId) {
      prependAnchorRef.current = null;
      return;
    }
    // Not consumed until the prepend actually landed (first id changed).
    if (!firstRawId || firstRawId === anchor.firstId) return;
    prependAnchorRef.current = null;
    // A deep-link jump is about to reposition anyway — don't fight it.
    if (deepLinkTargetRef.current && useChatStore.getState().scrollTargetMessageId) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = anchor.scrollTop + (el.scrollHeight - anchor.scrollHeight);
  }, [firstRawId, conversationId]);

  // Surface "New messages" on the pill when the NEWEST item changes while
  // unpinned. Keyed on the last item's id (not list length) so history
  // prepends don't raise a false signal.
  const lastItemId = threadItems[threadItems.length - 1]?.id;
  useEffect(() => {
    if (!lastItemId) return;
    if (
      lastItemIdRef.current &&
      lastItemIdRef.current !== lastItemId &&
      !pinnedRef.current &&
      // While turn-anchored, the reply lands right below the anchored
      // message — it's already in view, so the pill would be noise.
      !turnAnchorIdRef.current
    ) {
      setShowNewPill(true);
    }
    lastItemIdRef.current = lastItemId;
  }, [lastItemId]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    // Re-arm the pin so we stay at the bottom as the thread continues.
    pinnedRef.current = true;
    setNearBottom(true);
    setShowNewPill(false);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  // Sending is intent to see the latest — re-pin even if the user had
  // scrolled up (matches mobile/web). Keyed on the optimistic pending
  // message the composer appends. With the `turn_anchor` flag on in a
  // direct conversation, sending instead anchors YOUR message near the top
  // of the viewport (the layout effect below does the positioning).
  const lastRaw = rawMessages[rawMessages.length - 1];
  const lastRawIsOwnPending = !!lastRaw?.pending && lastRaw?.senderId === myId;
  const turnAnchorActive = turnAnchorEnabled && conversationType === "direct";
  useEffect(() => {
    if (!lastRawIsOwnPending) return;
    if (turnAnchorActive) {
      turnAnchorArmedRef.current = true;
      pinnedRef.current = false;
      return;
    }
    pinnedRef.current = true;
    setNearBottom(true);
    setShowNewPill(false);
    snapToBottom();
  }, [lastRaw?.id, lastRawIsOwnPending, turnAnchorActive, snapToBottom]);

  // Turn positioning, step 2: once the just-sent optimistic message renders,
  // size the spacer so the thread has room, then scroll the message near the
  // top of the viewport. Imperative spacer (no state) so this all happens in
  // one pre-paint pass.
  useLayoutEffect(() => {
    if (!turnAnchorArmedRef.current) return;
    const scroller = scrollRef.current;
    const spacer = turnSpacerRef.current;
    if (!scroller || !spacer) return;
    const pendingNodes = scroller.querySelectorAll("[data-own-pending]");
    const node = pendingNodes[pendingNodes.length - 1] as HTMLElement | undefined;
    if (!node) return;
    turnAnchorArmedRef.current = false;
    turnAnchorIdRef.current = node.getAttribute("data-msg-id");
    pinnedRef.current = false;
    spacer.style.height = `${Math.max(0, scroller.clientHeight - node.offsetHeight - 24)}px`;
    const nodeTop =
      node.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTop = nodeTop - 8;
  }, [threadItems.length]);


  // Build typing entries (name + type), filtering out ourselves and any agent
  // already streaming (the StreamingBubble replaces its indicator). Mirrors
  // web/mobile exactly so the wording reads the same on every platform.
  const typingEntries = useMemo(() => {
    if (!typingIds || typingIds.size === 0) return [];
    return Array.from(typingIds)
      .filter((id) => id !== myId && (!stream || stream.senderId !== id))
      .map((id) => ({
        name: typingNames[id] || t("someone"),
        type: typingTypes[id] || "human",
      }));
  }, [typingIds, typingNames, typingTypes, stream, myId, t]);

  const typingHasAgent = typingEntries.some((e) => e.type === "agent");
  const typingLabel = buildTypingText(typingEntries);

  // useCallback so the memoized MessageBubble rows don't all re-render on
  // every thread render just because the handler identity changed.
  const handleContextMenu = useCallback((message: Message, e: React.MouseEvent) => {
    setMenu({ message, x: e.clientX, y: e.clientY });
  }, []);

  // Reset the page-back budget whenever a new deep-link target arrives.
  if (scrollTargetMessageId && deepLinkTargetRef.current !== scrollTargetMessageId) {
    deepLinkTargetRef.current = scrollTargetMessageId;
    deepLinkAttemptsRef.current = 0;
  }

  // Deep-link to a specific message: scroll it into view and flash it. If the
  // target isn't loaded yet (an old file), page backwards until it appears or
  // we run out of history / attempts. Runs on every threadItems change so it
  // retries as older pages stream in.
  useEffect(() => {
    if (!scrollTargetMessageId) return;

    const container = scrollRef.current;
    const node = container?.querySelector(
      `[data-msg-id="${scrollTargetMessageId}"]`
    ) as HTMLElement | null;

    if (node) {
      // Found it — release the bottom-pin so autoscroll won't fight us, center
      // the message, flash a highlight, and clear the pending target.
      pinnedRef.current = false;
      node.scrollIntoView({ block: "center" });
      setHighlightedMessageId(scrollTargetMessageId);
      clearScrollTarget();
      const t = window.setTimeout(() => setHighlightedMessageId(null), 2200);
      return () => window.clearTimeout(t);
    }

    // Not loaded yet — page older messages a bounded number of times.
    if (hasMore && !loading && deepLinkAttemptsRef.current < 25) {
      deepLinkAttemptsRef.current += 1;
      const oldest = rawMessages[0];
      if (oldest) fetchMessages(conversationId, oldest.insertedAt);
    } else if (!hasMore) {
      // Reached the start of history without finding it — give up so we don't
      // leave a stale target armed.
      clearScrollTarget();
    }
  }, [
    scrollTargetMessageId,
    threadItems,
    hasMore,
    loading,
    rawMessages,
    conversationId,
    fetchMessages,
    clearScrollTarget,
  ]);

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        // Native scroll anchoring off — the prepend layout effect owns
        // position preservation; letting both run would double-compensate.
        style={{ overflowAnchor: "none" }}
        className="flex-1 min-h-0 overflow-y-auto py-2 scrollbar-autohide"
      >
        {loading && messages.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : threadItems.length === 0 && !stream && !typingLabel ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            {t("noMessages")}
          </div>
        ) : (
          <div ref={contentRef}>
            {hasMore && (
              <div className="flex justify-center py-2">
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                ) : (
                  <span className="text-[11px] text-muted-foreground">
                    {t("scrollUpForMore")}
                  </span>
                )}
              </div>
            )}
            {/* role=log announces message ADDITIONS politely. Deliberately
                excludes the StreamingBubble below — its token-by-token text
                updates would flood a screen reader; phase changes are
                announced by the sr-only status node outside the scroller. */}
            <div role="log" aria-live="polite" aria-relevant="additions" aria-label={t("messagesLabel")}>
            {threadItems.map((item, i) => {
              const prevItem = threadItems[i - 1];
              const dayChanged =
                !prevItem ||
                dayKey(prevItem.insertedAt) !== dayKey(item.insertedAt);

              if (item.kind === "artifact") {
                return (
                  <Fragment key={item.id}>
                    {dayChanged && <DaySeparator iso={item.insertedAt} />}
                    <ArtifactCard
                      artifact={item.artifact}
                      members={conversationMembers}
                    />
                  </Fragment>
                );
              }

              if (item.kind === "agent_conversation") {
                return (
                  <Fragment key={item.id}>
                    {dayChanged && <DaySeparator iso={item.insertedAt} />}
                    <AgentConversationCard conversation={item.conversation} />
                  </Fragment>
                );
              }

              const msg = item.message;
              const prev = prevItem?.kind === "message" ? prevItem.message : undefined;
              const isSameSender = prev?.senderId === msg.senderId;
              const closeInTime = isNear(prev, msg);

              // Force a new avatar/name header when the bubble shape
              // changes — going from a card (task/StatusUpdate) to a
              // text bubble (or vice versa) is visually distinct enough
              // that grouping them as "the same speaker continuing"
              // ends up with the avatar floating at the top of the run
              // far from the bubble it logically belongs to.
              const prevIsCard = !!prev && (isTaskMessage(prev) || isStatusUpdateMessage(prev));
              const currentIsCard = isTaskMessage(msg) || isStatusUpdateMessage(msg);
              const cardShapeChanged = prevIsCard !== currentIsCard;

              const showAvatar = !isSameSender || !closeInTime || cardShapeChanged;
              const showSenderName = showAvatar;
              const showUnreadDivider = firstUnreadId === msg.id;
              return (
                <Fragment key={msg.id}>
                  {dayChanged && <DaySeparator iso={msg.insertedAt} />}
                  {showUnreadDivider && <UnreadDivider />}
                  <div
                    data-msg-id={msg.id}
                    data-own-pending={msg.senderId === myId && msg.pending ? "" : undefined}
                    className={cn(
                      "transition-colors duration-700",
                      highlightedMessageId === msg.id &&
                        "rounded-lg bg-primary/10 ring-1 ring-primary/30"
                    )}
                  >
                    <MessageBubble
                      message={msg}
                      showAvatar={showAvatar}
                      showSenderName={showSenderName}
                      onContextMenu={handleContextMenu}
                    />
                  </div>
                </Fragment>
              );
            })}
            </div>
            {stream && (
              <StreamingBubble
                stream={stream}
                onStop={handleStopAgents}
                stopping={stoppingAgents}
              />
            )}

            {/* Turn-positioning spacer — sized imperatively (turn_anchor
                flag) so a just-sent message can sit at the top of the
                viewport while the reply streams into the space below. */}
            <div ref={turnSpacerRef} aria-hidden />
          </div>
        )}
      </div>

      {/* Screen-reader-only agent activity: announces phase TRANSITIONS
          (thinking → writing …) without exposing the token stream. */}
      {stream && (
        <span role="status" className="sr-only">
          {t(STREAM_PHASE_ANNOUNCEMENT_KEYS[stream.phase] ?? "streamAnnounce.responding")}
        </span>
      )}

      {/* Pinned just below the scroll area — always visible regardless
          of scroll position. Was inside the scrollable div, so typing
          fired while the user was scrolled up was hidden below the fold. */}
      {typingLabel && (
        <div
          className={cn(
            "border-t border-border bg-card/80 backdrop-blur px-4 py-1 text-[11px] italic",
            typingHasAgent ? "text-primary" : "text-muted-foreground"
          )}
        >
          {typingLabel}
        </div>
      )}

      {!nearBottom && (
        <button
          type="button"
          onClick={scrollToBottom}
          className={cn(
            "absolute bottom-3 left-1/2 -translate-x-1/2 z-10",
            "flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-md",
            "hover:bg-muted transition-colors"
          )}
          title={t("jumpToLatest")}
          aria-label={showNewPill ? t("newMessagesJump") : t("jumpToLatest")}
        >
          <ArrowDown className="h-3.5 w-3.5" />
          {showNewPill ? t("newMessages") : t("latest")}
        </button>
      )}

      {menu && (
        <MessageContextMenu
          message={menu.message}
          x={menu.x}
          y={menu.y}
          canDelete={menu.message.senderId === myId && !menu.message.pending}
          onReply={(m) => setReplyingTo(conversationId, m)}
          onCopy={(m) => navigator.clipboard?.writeText(m.content ?? "")}
          onCopyId={(m) => navigator.clipboard?.writeText(m.id)}
          onDelete={(m) => {
            if (confirm(t("deleteMessageConfirm"))) {
              deleteMessage(conversationId, m.id);
            }
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function DaySeparator({ iso }: { iso: string }) {
  return (
    <Marker variant="separator" className="px-4 py-3">
      <MarkerContent className="px-1 text-[10px] font-semibold uppercase tracking-wider">
        {formatDayLabel(iso)}
      </MarkerContent>
    </Marker>
  );
}

function UnreadDivider() {
  const { t } = useTranslation("chat");
  return (
    // data-unread-divider is the open-at-unread scroll anchor — keep it.
    <Marker
      data-unread-divider
      variant="separator"
      className="px-4 py-2 text-primary before:bg-primary/40 after:bg-primary/40"
    >
      <MarkerContent className="px-1 text-[10px] font-semibold uppercase tracking-wider">
        {t("newMessages")}
      </MarkerContent>
    </Marker>
  );
}

function isNear(a: Message | undefined, b: Message): boolean {
  if (!a) return false;
  return (
    new Date(b.insertedAt).getTime() - new Date(a.insertedAt).getTime() <
    SENDER_RUN_BREAK_MS
  );
}
