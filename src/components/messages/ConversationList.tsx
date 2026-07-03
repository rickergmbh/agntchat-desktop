import { memo } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "../../stores/chatStore";
import { useAuthStore } from "../../stores/authStore";
import { usePresenceStore } from "../../stores/presenceStore";
import {
  cn,
  getConversationTitle,
  getInitials,
  formatConversationTime,
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
  const currentUserId = useAuthStore((s) => s.participant?.id);

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
          {t("startOneHint")}
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
  activity,
  currentUserId,
  onClick,
}: {
  conversation: Conversation;
  isActive: boolean;
  unreadCount: number;
  presence: "online_local" | "offline";
  hasAgent: boolean;
  activity?: AgentActivity;
  currentUserId?: string;
  onClick: () => void;
}) {
  const title = getConversationTitle(conversation, currentUserId);
  const isGroup = conversation.type === "group";
  const isChannel = conversation.type === "channel";
  const otherMembers = (conversation.members ?? []).filter(
    (m) => m.participantId !== currentUserId
  );
  const otherMember = otherMembers[0]?.participant;
  const showGroupAvatar = isGroup || otherMembers.length >= 2;
  const hasUnread = unreadCount > 0;
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
                  "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
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
              "min-w-0 flex-1 truncate text-[13px]",
              hasUnread ? "font-semibold" : "font-medium"
            )}
          >
            {title}
          </span>
          {hasUnread && (
            <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
          <span className="shrink-0 text-[10px] text-muted-foreground">{timeStr}</span>
        </div>

        <div className="flex items-center gap-1.5 mt-0.5">
          {activity ? (
            <AgentActivityIndicator activity={activity} />
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
