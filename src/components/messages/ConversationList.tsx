import { memo } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "../../stores/chatStore";
import { useAgentStore } from "../../stores/agentStore";
import { useAuthStore } from "../../stores/authStore";
import { usePresenceStore } from "../../stores/presenceStore";
import { ExternalAgentBadge, externalToolOf, isExternalAgent } from "../ExternalAgentBadge";
import { SessionStateLine } from "./SessionStateLine";
import { sessionMeta } from "../../lib/api";
import {
  cn,
  getConversationTitle,
  getInitials,
  formatConversationTime,
  unreadTier,
} from "../../lib/utils";
import {
  Hash,
  Pin,
  Users,
  Bot,
  Loader2,
  MessageSquare,
} from "lucide-react";
import { GroupAvatar } from "./GroupAvatar";
import { AgentActivityIndicator } from "../AgentActivityIndicator";
import { PhaseOrb } from "../PhaseOrb";
import { useStreamingStore } from "../../stores/streamingStore";
import {
  PHASE_IS_ACTIVE,
  STREAM_PHASE_FALLBACK_LABEL_KEY,
  STREAM_PHASE_LABEL_KEYS,
  type StreamPhase,
} from "../../lib/status-contract.generated";
import type { AgentActivity } from "../../lib/agent-activity";
import type { Conversation } from "../../lib/api";

export function ConversationList() {
  const { t } = useTranslation("chat");
  const conversations = useChatStore((s) => s.conversations);
  const loading = useChatStore((s) => s.conversationsLoading);
  const activeId = useChatStore((s) => s.activeConversationId);
  const unreadCounts = useChatStore((s) => s.unreadCounts);
  const setActive = useChatStore((s) => s.setActiveConversation);
  const online = usePresenceStore((s) => s.online);
  const agentActivity = usePresenceStore((s) => s.agentActivity);
  const agentActivityConvs = usePresenceStore((s) => s.agentActivityConvs);
  const typing = usePresenceStore((s) => s.typing);
  const streams = useStreamingStore((s) => s.streams);
  const currentUserId = useAuthStore((s) => s.participant?.id);
  // The "start one" hint points at the pencil (new-conversation) button, which
  // is hidden until the user has an agent. Without an agent, guide them to
  // create one instead of pointing at a button that isn't there.
  const hasAgents = useAgentStore((s) =>
    Object.values(s.agents).some((m) => m.agent.status !== "deactivated")
  );

  if (loading && conversations.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
        <MessageSquare className="w-10 h-10 text-muted-foreground/40 mb-3" />
        <p className="text-sm text-muted-foreground">
          {t("noConversations")}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {hasAgents ? t("startOneHint") : t("welcomeBody")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 px-2 py-1">
      {conversations.map((conv) => {
        // Any non-self member online → "online_local"; otherwise "offline".
        let presence: "online_local" | "offline" = "offline";
        for (const m of conv.members ?? []) {
          if (m.participantId === currentUserId) continue;
          if (online.has(m.participantId)) {
            presence = "online_local";
            break;
          }
        }
        const hasAgent =
          conv.members?.some(
            (m) =>
              m.participantId !== currentUserId &&
              m.participant?.type === "agent"
          ) ?? false;
        // First agent member whose activity originates in THIS conversation
        // drives the row's "Thinking…/Working…" line. The backend scopes
        // each activity to the conversations the work lives in, so an agent
        // working in one DM doesn't light up every row it's a member of.
        let activity: AgentActivity | undefined;
        if (hasAgent) {
          for (const m of conv.members ?? []) {
            if (m.participantId === currentUserId) continue;
            if (m.participant?.type !== "agent") continue;
            const a = agentActivity[m.participantId];
            const convs = agentActivityConvs[m.participantId] ?? [];
            if (a && convs.includes(conv.id)) {
              activity = a;
              break;
            }
          }
        }
        return (
          <ConversationItem
            key={conv.id}
            conversation={conv}
            isActive={conv.id === activeId}
            unreadCount={unreadCounts[conv.id] ?? 0}
            presence={presence}
            hasAgent={hasAgent}
            isTyping={(typing[conv.id]?.size ?? 0) > 0}
            streamPhase={streams[conv.id]?.phase}
            activity={activity}
            currentUserId={currentUserId}
            onClick={() => setActive(conv.id)}
          />
        );
      })}
    </div>
  );
}

const ConversationItem = memo(function ConversationItem({
  conversation,
  isActive,
  unreadCount,
  presence,
  hasAgent,
  isTyping,
  streamPhase,
  activity,
  currentUserId,
  onClick,
}: {
  conversation: Conversation;
  isActive: boolean;
  unreadCount: number;
  presence: "online_local" | "offline";
  hasAgent: boolean;
  // Someone (human or agent) is typing in this conversation.
  isTyping?: boolean;
  // Live stream phase in THIS conversation — highest-fidelity busy signal,
  // wins over the coarser global activity (matches mobile's row rule:
  // typing > stream > activity).
  streamPhase?: StreamPhase;
  activity?: AgentActivity;
  currentUserId?: string;
  onClick: () => void;
}) {
  const { t } = useTranslation("chat");
  const title = getConversationTitle(conversation, currentUserId);
  const isGroup = conversation.type === "group";
  const isChannel = conversation.type === "channel";
  const session = conversation.type === "session" ? sessionMeta(conversation) : null;
  const otherMembers = (conversation.members ?? []).filter(
    (m) => m.participantId !== currentUserId
  );
  const otherMember = otherMembers[0]?.participant;
  const showGroupAvatar = isGroup || otherMembers.length >= 2;
  const tier = unreadTier(unreadCount);
  const hasUnread = tier !== null;
  const timeStr = formatConversationTime(conversation.updatedAt);

  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all",
        isActive
          ? "bg-surface-active text-foreground shadow-sm"
          : "text-foreground/80 hover:bg-surface-hover",
        hasUnread && !isActive && "text-foreground"
      )}
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center">
        {conversation.avatarUrl ? (
          <img
            src={conversation.avatarUrl}
            alt=""
            className="h-7 w-7 rounded-full object-cover"
          />
        ) : isChannel ? (
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted">
            <Hash className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
        ) : showGroupAvatar && otherMembers.length > 0 ? (
          <GroupAvatar members={otherMembers} size={28} />
        ) : (
          <div className="relative">
            {otherMember?.avatarUrl ? (
              <img
                src={otherMember.avatarUrl}
                alt=""
                className="h-7 w-7 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                {getInitials(title)}
              </div>
            )}
            {hasAgent && (
              <span
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-clip-padding",
                  activity
                    ? "bg-primary animate-pulse"
                    : presence === "online_local"
                    ? "bg-success"
                    : "bg-muted-foreground"
                )}
              />
            )}
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1">
          {conversation.pinned && (
            <Pin className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
          )}
          <span
            className={cn(
              "min-w-0 truncate text-[13px]",
              hasUnread ? "font-semibold" : "font-medium"
            )}
          >
            {title}
          </span>
          {!isGroup && isExternalAgent(otherMember) && (
            <ExternalAgentBadge tool={externalToolOf(conversation, otherMember)} />
          )}
          <span className="min-w-0 flex-1" />
          {tier && (
            <span
              aria-label={t("newMessages")}
              className={cn(
                "shrink-0 rounded-full bg-primary",
                tier === "few" && "h-2 w-2",
                tier === "some" && "h-2.5 w-2.5",
                tier === "many" && "h-3 w-3"
              )}
            />
          )}
          <span className="shrink-0 text-[10px] text-muted-foreground">{timeStr}</span>
        </div>

        {/* Row 2: typing > live stream > agent activity > type badge —
            same priority rule as mobile's conversation rows. */}
        <div className="flex items-center gap-1.5 mt-0.5">
          {isTyping ? (
            <span className="flex gap-1 py-0.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
            </span>
          ) : streamPhase ? (
            <span className="flex min-w-0 items-center gap-1 text-[11px] font-medium text-foreground">
              <PhaseOrb
                phase={streamPhase}
                active={PHASE_IS_ACTIVE[streamPhase] ?? true}
                className="shrink-0"
              />
              <span className="truncate">
                {t(STREAM_PHASE_LABEL_KEYS[streamPhase] ?? STREAM_PHASE_FALLBACK_LABEL_KEY)}
              </span>
            </span>
          ) : activity ? (
            <AgentActivityIndicator activity={activity} />
          ) : session ? (
            <SessionStateLine session={session} compact />
          ) : (isChannel || isGroup) && (
            <>
              <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-px text-[10px] font-semibold text-muted-foreground">
                <Users className="h-2.5 w-2.5" />
                {otherMembers.length + 1}
              </span>
              {isGroup && (
                <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                  {otherMembers.slice(0, 2).map((m, i) => (
                    <span key={m.participantId} className="inline-flex items-center">
                      {i > 0 && ", "}
                      {m.participant?.type === "agent" && (
                        <Bot className="mr-0.5 inline h-2.5 w-2.5 align-text-bottom" />
                      )}
                      {m.participant?.displayName || "?"}
                    </span>
                  ))}
                  {otherMembers.length > 2 && (
                    <span className="font-semibold">
                      {" "}
                      +{otherMembers.length - 2}
                    </span>
                  )}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </button>
  );
});
