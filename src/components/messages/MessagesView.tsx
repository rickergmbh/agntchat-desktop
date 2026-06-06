import { useEffect, useMemo, useState } from "react";
import { MessageSquare, ChevronRight, ChevronLeft, SquarePen, RefreshCw } from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import { useAuthStore } from "../../stores/authStore";
import { usePresenceStore } from "../../stores/presenceStore";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "../../lib/utils";
import { agentConversationSourceId, isAgentThread } from "../../lib/thread-selectors";
import { ConversationList } from "./ConversationList";
import { ChatThread } from "./ChatThread";
import { MessageComposer } from "./MessageComposer";
import { ConversationDetailsPanel } from "./ConversationDetailsPanel";
import { NewConversationDialog } from "./NewConversationDialog";
import { ChatHeaderMenu } from "./ChatHeaderMenu";
import { GroupAvatar } from "./GroupAvatar";
import { ThreadsBar } from "./ThreadsBar";
import { FilesBar } from "./FilesBar";

const DETAILS_KEY = "agentchat:showDetails";

function readDetailsPref(): boolean {
  try {
    return localStorage.getItem(DETAILS_KEY) === "1";
  } catch {
    return false;
  }
}

export function MessagesView() {
  const activeId = useChatStore((s) => s.activeConversationId);
  const fetchConversations = useChatStore((s) => s.fetchConversations);
  const fetchAgentConversations = useChatStore((s) => s.fetchAgentConversations);
  const fetchUnreadCounts = useChatStore((s) => s.fetchUnreadCounts);

  const [showDetails, setShowDetails] = useState(readDetailsPref);
  const [showNew, setShowNew] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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
    <div className="flex-1 flex h-full overflow-hidden">
      <aside
        className="w-80 shrink-0 flex flex-col border-r border-border bg-surface-elevated"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        {/* WorkspaceSwitcher lifted to AppShell's global header so it's
            reachable from every view (Tasks/Agents/Members/etc. used
            to lose the active-workspace context). The conversation
            panel keeps a "Chats" label + refresh + new-chat buttons
            so it still reads as a section header rather than a
            floating button row. */}
        <div
          className="h-14 shrink-0 px-4 border-b border-border flex items-center justify-between gap-2"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <MessageSquare className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">Chats</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              title="Refresh conversations"
              aria-label="Refresh conversations"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </button>
            <button
              type="button"
              onClick={() => setShowNew(true)}
              title="New conversation"
              aria-label="New conversation"
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

      <section className="flex-1 flex flex-col bg-background overflow-hidden">
        {activeId ? (
          <ActiveConversation
            conversationId={activeId}
            showDetails={showDetails}
            onToggleDetails={() => setShowDetails((v) => !v)}
          />
        ) : (
          <EmptyState />
        )}
      </section>

      {activeId && showDetails && (
        <DetailsPanelWrapper
          conversationId={activeId}
          onClose={() => setShowDetails(false)}
        />
      )}

      {showNew && <NewConversationDialog onClose={() => setShowNew(false)} />}
    </div>
  );
}

function ActiveConversation({
  conversationId,
  showDetails,
  onToggleDetails,
}: {
  conversationId: string;
  showDetails: boolean;
  onToggleDetails: () => void;
}) {
  const conversation = useChatStore(
    (s) =>
      s.conversations.find((c) => c.id === conversationId) ??
      s.agentConversations.find((c) => c.id === conversationId)
  );
  const myId = useAuthStore((s) => s.participant?.id);

  const online = usePresenceStore((s) => s.online);

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
    (conversation?.type === "group" ? "Group" : "Conversation");

  const presenceLine = useMemo(() => {
    if (!conversation) return null;
    const members = conversation.members ?? [];
    const others = members.filter((m) => m.participantId !== myId);
    const onlineCount = others.filter((m) => online.has(m.participantId)).length;
    const isDM = conversation.type === "direct" || others.length === 1;
    if (isDM) {
      return onlineCount > 0 ? "Online" : "Offline";
    }
    if (conversation.type === "channel" || conversation.type === "group") {
      return onlineCount > 0
        ? `${onlineCount} online · ${others.length + 1} members`
        : `${others.length + 1} members`;
    }
    return null;
  }, [conversation, online, myId]);

  // When the active conversation is an agent thread, surface a back-to-parent
  // button so the user can pop out of the thread without scrolling the
  // sidebar. Mirrors mobile's behavior of always offering a clear exit.
  const isThread = isAgentThread(conversation);
  const parentId = conversation ? agentConversationSourceId(conversation) : undefined;

  const setActiveConversation = useChatStore((s) => s.setActiveConversation);

  const handleBackToParent = () => {
    if (parentId) setActiveConversation(parentId);
  };

  return (
    <>
      <header
        className="h-14 shrink-0 px-4 border-b border-border bg-card flex items-center gap-3"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        {isThread && parentId ? (
          <button
            type="button"
            onClick={handleBackToParent}
            title="Back to parent conversation"
            aria-label="Back to parent conversation"
            className="shrink-0 -ml-1 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        ) : null}

        <button
          type="button"
          onClick={onToggleDetails}
          aria-pressed={showDetails}
          title={showDetails ? "Hide details" : "Show conversation details"}
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
            {presenceLine && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                {presenceLine === "Online" || presenceLine.includes("online ·") ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-success" />
                ) : presenceLine === "Offline" ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                ) : null}
                {presenceLine}
              </p>
            )}
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover/header:text-muted-foreground group-hover/header:translate-x-0.5" />
        </button>

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
          message list without consuming a row. Only renders the bar for
          parent conversations — threads themselves get the back-to-parent
          button in the header instead. */}
      <div className="relative flex flex-1 min-h-0 flex-col">
        {!isThread ? <ThreadsBar conversationId={conversationId} /> : null}
        <FilesBar conversationId={conversationId} />
        <ChatThread conversationId={conversationId} />
      </div>
      <MessageComposer conversationId={conversationId} />
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
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
      <MessageSquare className="w-12 h-12 text-muted-foreground/40 mb-3" />
      <p className="text-sm font-medium text-foreground">Select a conversation</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-xs">
        Your recent conversations with agents appear on the left. Pick one to jump in.
      </p>
    </div>
  );
}
