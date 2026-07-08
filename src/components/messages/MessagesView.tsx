import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageSquare, MessageCircle, MessagesSquare, ChevronRight, SquarePen, RefreshCw, Power, Loader2, X, CheckCircle2, Radio } from "lucide-react";
import { wakeAgent } from "../../lib/api";
import { useResizableWidth, useRightPaneWidth } from "../../hooks/useResizableWidth";
import { ResizeHandle } from "../ResizeHandle";
import { useChatStore } from "../../stores/chatStore";
import { useAuthStore } from "../../stores/authStore";
import { usePresenceStore } from "../../stores/presenceStore";
import { useStreamingStore } from "../../stores/streamingStore";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "../../lib/utils";
import {
  isResolvedThread,
  threadStatus,
  threadTopic,
} from "../../lib/thread-selectors";
import { ConversationList } from "./ConversationList";
import { ChatThread } from "./ChatThread";
import { MessageComposer } from "./MessageComposer";
import { ConversationDetailsPanel } from "./ConversationDetailsPanel";
import { NewConversationDialog } from "./NewConversationDialog";
import { ChatHeaderMenu } from "./ChatHeaderMenu";
import { GroupAvatar } from "./GroupAvatar";
import { AgentActivityIndicator } from "../AgentActivityIndicator";
import { ThreadsBar } from "./ThreadsBar";
import { FilesBar } from "./FilesBar";
import { ArtifactViewer } from "./ArtifactViewer";
import { useArtifactStore } from "../../stores/artifactStore";

const DETAILS_KEY = "agentchat:showDetails";

function readDetailsPref(): boolean {
  try {
    return localStorage.getItem(DETAILS_KEY) === "1";
  } catch {
    return false;
  }
}

export function MessagesView() {
  const { t } = useTranslation("chat");
  const activeId = useChatStore((s) => s.activeConversationId);
  const activeThreadId = useChatStore((s) => s.activeThreadId);
  const artifactViewerOpen = useArtifactStore((s) => s.viewer != null);
  const fetchConversations = useChatStore((s) => s.fetchConversations);
  const fetchAgentConversations = useChatStore((s) => s.fetchAgentConversations);
  const fetchUnreadCounts = useChatStore((s) => s.fetchUnreadCounts);

  // The artifact pane belongs to the conversation it was opened from —
  // switching conversations closes it rather than showing a stale artifact.
  useEffect(() => {
    useArtifactStore.getState().closeViewer();
  }, [activeId]);

  const [showDetails, setShowDetails] = useState(readDetailsPref);
  const [showNew, setShowNew] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Resizable conversation-list width.
  const {
    width: listWidth,
    ref: asideRef,
    resizing,
    onResizeStart,
    onResizeReset,
  } = useResizableWidth({
    storageKey: "agentchat:listWidth",
    defaultWidth: 320, // matches the previous fixed w-80
    min: 240,
    max: 480,
  });

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      // Full re-sync against the server: replace both conversation lists
      // and the unread counts map. fetchConversations / fetchAgentConversations
      // both `set` the array (not merge), so anything deleted server-side
      // drops from the sidebar on this call.
      await Promise.all([
        fetchConversations(),
        fetchAgentConversations(),
        fetchUnreadCounts(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    try {
      localStorage.setItem(DETAILS_KEY, showDetails ? "1" : "0");
    } catch {}
  }, [showDetails]);

  return (
    // Recessed `rail` canvas: the conversation column floats on top of it as an
    // elevated card. The card's rounded top corners reveal this canvas behind
    // them, so the seam between the list / details and the thread reads as an
    // overlap rather than a flat 1px divider.
    <div className="relative flex-1 flex h-full overflow-hidden bg-canvas">
      <aside
        ref={asideRef}
        className="relative z-0 shrink-0 flex flex-col bg-canvas"
        style={
          {
            width: listWidth,
            WebkitAppRegion: "drag",
          } as React.CSSProperties
        }
      >
        {/* WorkspaceSwitcher lifted to AppShell's global header so it's
            reachable from every view (Tasks/Agents/Members/etc. used
            to lose the active-workspace context). The conversation
            panel keeps a "Chats" label + refresh + new-chat buttons
            so it still reads as a section header rather than a
            floating button row. */}
        <div
          className="relative h-14 shrink-0 px-4 flex items-center justify-between gap-2 after:absolute after:bottom-0 after:left-4 after:right-4 after:h-px after:bg-border"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center shrink-0">
              <MessageCircle className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">{t("nav:chats")}</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              title={t("refreshConversations")}
              aria-label={t("refreshConversations")}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </button>
            <button
              type="button"
              onClick={() => setShowNew(true)}
              title={t("newConversation")}
              aria-label={t("newConversation")}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <SquarePen className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div
          className="flex-1 overflow-y-auto"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <ConversationList />
        </div>
      </aside>

      <ResizeHandle
        left={listWidth}
        resizing={resizing}
        onResizeStart={onResizeStart}
        onResizeReset={onResizeReset}
        label={t("resizeList")}
      />

      {/* Elevated conversation panel — physically laps 8px over the recessed
          list to its left (negative margin) and rounds its left corners, so
          the rounded edge + soft shadow sit *on top of* the list and read as a
          real overlap. Right edge stays flush — the details pane (when open)
          stacks on top of it next.

          When the details pane is open it laps 12px over this panel's right
          edge, so reserve that strip (plus breathing room) with `pr-5` to keep
          the composer's send button and the Threads / Files chips clear of the
          overlap. */}
      <section
        className={cn(
          "relative z-10 -ml-2 flex-1 flex flex-col bg-card overflow-hidden surface-panel rounded-l-2xl",
          activeId && (showDetails || activeThreadId || artifactViewerOpen) && "pr-5"
        )}
      >
        {activeId ? (
          <ConversationPane
            conversationId={activeId}
            showDetails={showDetails}
            onToggleDetails={() => setShowDetails((v) => !v)}
          />
        ) : (
          <EmptyState />
        )}
      </section>

      {/* Right pane: the artifact viewer takes precedence over a thread
          (Slack-style side pane), which takes precedence over the
          conversation-details pane. Only one is ever shown; closing the
          viewer restores whichever pane was underneath (their state is
          untouched). */}
      {activeId && artifactViewerOpen ? (
        <ArtifactViewer />
      ) : activeId && activeThreadId ? (
        <ThreadSidePane threadId={activeThreadId} />
      ) : activeId && showDetails ? (
        <DetailsPanelWrapper
          conversationId={activeId}
          onClose={() => setShowDetails(false)}
        />
      ) : null}

      {showNew && <NewConversationDialog onClose={() => setShowNew(false)} />}
    </div>
  );
}

function ConversationPane({
  conversationId,
  showDetails,
  onToggleDetails,
}: {
  conversationId: string;
  showDetails: boolean;
  onToggleDetails: () => void;
}) {
  const { t } = useTranslation("chat");
  const conversation = useChatStore(
    (s) =>
      s.conversations.find((c) => c.id === conversationId) ??
      s.agentConversations.find((c) => c.id === conversationId)
  );
  const myId = useAuthStore((s) => s.participant?.id);

  const online = usePresenceStore((s) => s.online);
  const agentActivity = usePresenceStore((s) => s.agentActivity);
  const agentActivityConvs = usePresenceStore((s) => s.agentActivityConvs);

  // Match web's ChatView header — show a stacked GroupAvatar for group
  // conversations or whenever there's more than one other participant.
  const otherMembers = useMemo(
    () =>
      (conversation?.members ?? []).filter((m) => m.participantId !== myId),
    [conversation, myId]
  );
  const showGroupAvatar =
    conversation?.type === "group" || otherMembers.length >= 2;
  const otherParticipant = otherMembers[0]?.participant;

  const headerTitle =
    conversation?.title ||
    otherParticipant?.displayName ||
    (conversation?.type === "group" ? t("type.group") : t("conversationFallback"));

  // Presence as structured data (kind + counts) so the label AND the status
  // dot both derive from it — the label itself is localized at render.
  const presenceInfo = useMemo(():
    | { kind: "online" | "offline" | "group"; onlineCount: number; total: number }
    | null => {
    if (!conversation) return null;
    const members = conversation.members ?? [];
    const others = members.filter((m) => m.participantId !== myId);
    const onlineCount = others.filter((m) => online.has(m.participantId)).length;
    const isDM = conversation.type === "direct" || others.length === 1;
    if (isDM) {
      return {
        kind: onlineCount > 0 ? "online" : "offline",
        onlineCount,
        total: others.length + 1,
      };
    }
    if (conversation.type === "channel" || conversation.type === "group") {
      return { kind: "group", onlineCount, total: others.length + 1 };
    }
    return null;
  }, [conversation, online, myId]);

  const presenceLine =
    presenceInfo == null
      ? null
      : presenceInfo.kind === "online"
      ? t("common:online")
      : presenceInfo.kind === "offline"
      ? t("common:offline")
      : presenceInfo.onlineCount > 0
      ? `${t("onlineCount", { count: presenceInfo.onlineCount })} · ${t("members", {
          count: presenceInfo.total,
        })}`
      : t("members", { count: presenceInfo.total });

  // Busiest agent member's live activity — shown in the header where the
  // status normally reads "Online", so the user sees "Thinking…/Working…".
  // Scoped to THIS conversation via agentActivityConvs (like the
  // conversation list): work in another conversation must not make this
  // header claim the agent is thinking here.
  const headerActivity = useMemo(
    () =>
      otherMembers
        .map((m) =>
          m.participant?.type === "agent" &&
          conversation &&
          agentActivityConvs[m.participantId]?.includes(conversation.id)
            ? agentActivity[m.participantId]
            : undefined
        )
        .find(Boolean),
    [otherMembers, agentActivity, agentActivityConvs, conversation]
  );

  // In a 1:1 conversation with an offline agent, offer a "bring online"
  // affordance (mirrors mobile's "tap to wake"). For an org-host agent the
  // backend turns this into a forced bridge restart, so it recovers an
  // agent that's stuck offline even though its host is up. Null whenever the
  // agent is already online (the dot/label covers that) or it's a group.
  const wakeableAgentId = useMemo(() => {
    if (!conversation) return null;
    const others = (conversation.members ?? []).filter(
      (m) => m.participantId !== myId
    );
    const isDM = conversation.type === "direct" || others.length === 1;
    if (!isDM) return null;
    const other = others[0];
    if (other?.participant?.type !== "agent") return null;
    if (online.has(other.participantId)) return null;
    return other.participantId;
  }, [conversation, myId, online]);

  const [waking, setWaking] = useState(false);

  const handleWake = async () => {
    if (!wakeableAgentId || waking) return;
    setWaking(true);
    try {
      await wakeAgent(wakeableAgentId);
    } catch (e) {
      console.warn("[MessagesView] wake failed", e);
    }
    // Presence flips via the WS presence store when the bridge reconnects,
    // which hides the button. Clear the spinner after a grace window in case
    // it never comes back, so the control doesn't spin forever.
    setTimeout(() => setWaking(false), 8000);
  };

  return (
    <>
      <header
        className="relative h-14 shrink-0 px-4 bg-card flex items-center gap-3 after:absolute after:bottom-0 after:left-4 after:right-4 after:h-px after:bg-border"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <button
          type="button"
          onClick={onToggleDetails}
          aria-pressed={showDetails}
          title={showDetails ? t("hideDetails") : t("showDetails")}
          className="group/header flex items-center gap-3 min-w-0 flex-1 rounded-md px-1 py-1 -ml-1 hover:bg-accent/50 text-left transition-colors"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {conversation?.avatarUrl ? (
            <Avatar className="h-9 w-9 shrink-0">
              <AvatarImage src={conversation.avatarUrl} alt={headerTitle} displaySize={36} />
              <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                {headerTitle.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          ) : showGroupAvatar && otherMembers.length > 0 ? (
            <GroupAvatar members={otherMembers} size={36} />
          ) : (
            <Avatar className="h-9 w-9 shrink-0">
              {otherParticipant?.avatarUrl ? (
                <AvatarImage src={otherParticipant.avatarUrl} alt={headerTitle} displaySize={36} />
              ) : null}
              <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                {headerTitle.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">{headerTitle}</p>
            {headerActivity ? (
              <AgentActivityIndicator activity={headerActivity} />
            ) : presenceLine ? (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                {presenceInfo!.kind === "online" ||
                (presenceInfo!.kind === "group" && presenceInfo!.onlineCount > 0) ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-success" />
                ) : presenceInfo!.kind === "offline" ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                ) : null}
                {presenceLine}
              </p>
            ) : null}
          </div>
          {/* Details toggle affordance — a bordered pill so it reads as a
              control even at rest (the bare chevron was near-invisible in dark
              mode). Chevron rotates 180° to point back into the thread when the
              panel is open. */}
          <span
            className={cn(
              "shrink-0 flex h-7 w-7 items-center justify-center rounded-md border transition-colors",
              showDetails
                ? "border-transparent bg-accent text-foreground"
                : "border-border-strong text-foreground group-hover/header:bg-accent"
            )}
          >
            <ChevronRight
              className={cn(
                "h-4 w-4 transition-transform",
                showDetails && "rotate-180"
              )}
            />
          </span>
        </button>

        {wakeableAgentId && (
          <button
            type="button"
            onClick={handleWake}
            disabled={waking}
            title={t("bringAgentOnline")}
            aria-label={t("bringAgentOnline")}
            className="shrink-0 flex h-7 items-center gap-1.5 rounded-md border border-border-strong px-2 text-[11px] font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-60"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            {waking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Power className="h-3.5 w-3.5" />
            )}
            {waking ? t("waking") : t("bringOnline")}
          </button>
        )}

        {conversation && (
          <ChatHeaderMenu
            conversation={conversation}
            onAfterDangerAction={() => {
              // Details panel clings to the deleted conversation id —
              // close it so the thread column shows the EmptyState.
            }}
          />
        )}
      </header>

      {/* Relative wrapper lets ThreadsBar float absolutely over the
          message list without consuming a row. The main pane always shows
          parent conversations, so the bar is always eligible here. */}
      <div className="relative flex flex-1 min-h-0 flex-col">
        <ThreadsBar conversationId={conversationId} />
        <FilesBar conversationId={conversationId} isThread={false} />
        <ChatThread conversationId={conversationId} />
      </div>
      <MessageComposer conversationId={conversationId} />
    </>
  );
}

/**
 * Slack-style thread pane. Replaces the conversation-details pane on the
 * right while a thread is open. Renders the thread as a full, live
 * conversation (its own ChatThread + MessageComposer) beside the parent in
 * the main pane — both channels stay joined, so you can converse in both.
 */
function ThreadSidePane({ threadId }: { threadId: string }) {
  const { t } = useTranslation("chat");
  const closeThread = useChatStore((s) => s.closeThread);
  const refreshConversation = useChatStore((s) => s.refreshConversation);
  const conversation = useChatStore(
    (s) =>
      s.conversations.find((c) => c.id === threadId) ??
      s.agentConversations.find((c) => c.id === threadId)
  );
  const stream = useStreamingStore((s) => s.streams[threadId]);

  // Drag-to-resize from the pane's left (inner) edge. Shares its width with
  // the details pane (same storage key) so switching between them is seamless.
  const {
    width,
    ref: paneRef,
    resizing,
    onResizeStart,
    onResizeReset,
  } = useRightPaneWidth();

  // Pull full member/participant data on open (list payloads can be thin).
  useEffect(() => {
    refreshConversation(threadId);
  }, [threadId, refreshConversation]);

  const resolved = conversation ? isResolvedThread(conversation) : false;
  const isLive = Boolean(stream);
  const topic = conversation ? threadTopic(conversation) : null;
  const title =
    topic || conversation?.title || t("threads.agentThread");
  const statusLabel = resolved
    ? conversation && threadStatus(conversation) === "abandoned"
      ? t("threads.abandoned")
      : t("threads.resolvedLabel")
    : isLive
    ? t("threads.live")
    : null;

  return (
    <>
      <ResizeHandle
        right={width}
        resizing={resizing}
        onResizeStart={onResizeStart}
        onResizeReset={onResizeReset}
        label={t("threads.resizePane")}
      />
      <aside
        ref={paneRef}
        // Wider than the details pane (w-80) — a thread is a full conversation
        // with its own composer, so it needs room to breathe beside the parent.
        // Width is drag-resizable (useResizableWidth, right-docked).
        className="surface-panel-strong relative z-20 -ml-3 flex h-full shrink-0 flex-col overflow-hidden rounded-l-lg bg-card"
        style={{ width } as React.CSSProperties}
      >
        <header
          className="relative h-14 shrink-0 px-4 bg-card flex items-center gap-3 after:absolute after:bottom-0 after:left-4 after:right-4 after:h-px after:bg-border"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
              resolved ? "bg-muted-foreground/15" : "bg-primary/15"
            )}
          >
            {resolved ? (
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            ) : isLive ? (
              <Radio className="h-4 w-4 text-primary" />
            ) : (
              <MessagesSquare className="h-4 w-4 text-primary" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("threads.threadLabel")}
              {statusLabel ? ` · ${statusLabel}` : ""}
            </p>
            <p className="truncate text-sm font-semibold text-foreground">
              {title}
            </p>
          </div>
          <button
            type="button"
            onClick={closeThread}
            title={t("threads.closePane")}
            aria-label={t("threads.closePane")}
            className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="relative flex flex-1 min-h-0 flex-col">
          <ChatThread conversationId={threadId} />
        </div>
        <MessageComposer conversationId={threadId} />
      </aside>
    </>
  );
}

function DetailsPanelWrapper({
  conversationId,
  onClose,
}: {
  conversationId: string;
  onClose: () => void;
}) {
  const conversation = useChatStore(
    (s) =>
      s.conversations.find((c) => c.id === conversationId) ??
      s.agentConversations.find((c) => c.id === conversationId)
  );
  const myId = useAuthStore((s) => s.participant?.id);
  const refreshConversation = useChatStore((s) => s.refreshConversation);

  // The conversation list endpoint may not include full member / participant
  // payloads. Pull a fresh copy on open so the panel has complete data.
  useEffect(() => {
    refreshConversation(conversationId);
  }, [conversationId, refreshConversation]);

  if (!conversation) return null;

  return (
    <ConversationDetailsPanel
      conversation={conversation}
      currentUserId={myId}
      onClose={onClose}
      onAfterLeave={onClose}
    />
  );
}

function EmptyState() {
  const { t } = useTranslation("chat");
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
      <MessageSquare className="w-12 h-12 text-muted-foreground/40 mb-3" />
      <p className="text-sm font-medium text-foreground">{t("selectConversation")}</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-xs">
        {t("selectConversationHint")}
      </p>
    </div>
  );
}
