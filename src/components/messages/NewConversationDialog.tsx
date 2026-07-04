import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentStore } from "../../stores/agentStore";
import { usePresenceStore } from "../../stores/presenceStore";
import { useChatStore } from "../../stores/chatStore";
import { useFriendStore } from "../../stores/friendStore";
import { useAuthStore } from "../../stores/authStore";
import * as api from "../../lib/api";
import type { Agent, Participant } from "../../lib/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  X,
  Search,
  Bot,
  Check,
  Loader2,
  MessageCircle,
  Users,
  User,
  UserPlus,
} from "lucide-react";
import { cn } from "../../lib/utils";

interface Props {
  onClose: () => void;
}

type Mode = "select" | "channel";

export function NewConversationDialog({ onClose }: Props) {
  const { t } = useTranslation("chat");
  const agentsMap = useAgentStore((s) => s.agents);
  // Stable flattened list — avoids the Zustand `?? []` re-render trap.
  const agents = useMemo(
    () => Object.values(agentsMap).map((m) => m.agent),
    [agentsMap]
  );

  const conversations = useChatStore((s) => s.conversations);
  const createConversation = useChatStore((s) => s.createConversation);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const currentUserId = useAuthStore((s) => s.participant?.id);
  const friendConnections = useFriendStore((s) => s.connections);
  const fetchFriendConnections = useFriendStore((s) => s.fetchConnections);
  const requestFriend = useFriendStore((s) => s.requestFriend);
  // Friends (and human people-search) are behind a per-user runtime flag.
  const friendsEnabled = useAuthStore((s) => s.participant?.features?.friends === true);

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupTitle, setGroupTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [peopleResults, setPeopleResults] = useState<Participant[]>([]);
  const [searchingPeople, setSearchingPeople] = useState(false);
  const [mode, setMode] = useState<Mode>("select");
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (friendsEnabled) fetchFriendConnections();
  }, [fetchFriendConnections, friendsEnabled]);

  // Debounced people search (only when the friends feature is on for this user)
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (!friendsEnabled || search.length < 2) {
      setPeopleResults([]);
      setSearchingPeople(false);
      return;
    }

    setSearchingPeople(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const data = await api.searchPeople(search);
        setPeopleResults(data.people);
      } catch (e) {
        console.warn("[NewConversation] people search failed", e);
        setPeopleResults([]);
      } finally {
        setSearchingPeople(false);
      }
    }, 300);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [search, friendsEnabled]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const participantMap = useMemo(() => {
    const map = new Map<string, { displayName: string }>();
    for (const a of agents) map.set(a.id, { displayName: a.displayName });
    for (const p of peopleResults) map.set(p.id, { displayName: p.displayName });
    return map;
  }, [agents, peopleResults]);

  const activeAgents = useMemo(
    () => agents.filter((a) => a.status !== "deactivated"),
    [agents]
  );

  const filteredAgents = useMemo(() => {
    if (!search) return activeAgents;
    const q = search.toLowerCase();
    return activeAgents.filter(
      (a) =>
        a.displayName.toLowerCase().includes(q) ||
        a.description?.toLowerCase().includes(q)
    );
  }, [activeAgents, search]);

  const isGroup = selected.size > 1;

  const getPersonConnection = useCallback(
    (person: Participant) =>
      friendConnections.find((c) => c.id === person.connectionId) ??
      friendConnections.find(
        (c) => c.requesterId === person.id || c.addresseeId === person.id
      ),
    [friendConnections]
  );

  const handleConnectPerson = useCallback(
    async (person: Participant) => {
      try {
        const connection = await requestFriend(person.id);
        setPeopleResults((rows) =>
          rows.map((p) =>
            p.id === person.id
              ? {
                  ...p,
                  connectionId: connection?.id,
                  connectionStatus: connection?.status ?? "pending",
                  canRequest: false,
                }
              : p
          )
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : t("friends:requestFailed"));
      }
    },
    [requestFriend]
  );

  const toggleParticipant = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setError(null);
  }, []);

  const findExistingDm = useCallback(
    (peerId: string): string | null => {
      const existing = conversations.find(
        (c) =>
          c.type === "direct" &&
          c.members?.some((m) => m.participantId === peerId)
      );
      return existing?.id ?? null;
    },
    [conversations]
  );

  const handleCreate = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      if (mode === "channel") {
        if (!groupTitle.trim()) {
          setError(t("newDialog.channelNeedsName"));
          setCreating(false);
          return;
        }
        const conv = await createConversation({
          type: "channel",
          title: groupTitle.trim(),
          memberIds: [...selected],
        });
        setActiveConversation(conv.id);
        onClose();
        return;
      }

      if (selected.size === 0) {
        setCreating(false);
        return;
      }

      if (selected.size === 1) {
        const peerId = [...selected][0]!;
        const existingId = findExistingDm(peerId);
        if (existingId) {
          setActiveConversation(existingId);
          onClose();
          return;
        }
        const conv = await createConversation({
          type: "direct",
          memberIds: [peerId],
        });
        setActiveConversation(conv.id);
        onClose();
        return;
      }

      if (!groupTitle.trim()) {
        setError(t("newDialog.groupNeedsName"));
        setCreating(false);
        return;
      }

      const conv = await createConversation({
        type: "group",
        title: groupTitle.trim(),
        memberIds: [...selected],
      });
      setActiveConversation(conv.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("newDialog.createFailed"));
    } finally {
      setCreating(false);
    }
  }, [
    mode,
    selected,
    groupTitle,
    findExistingDm,
    createConversation,
    setActiveConversation,
    onClose,
  ]);

  const hasPeople = peopleResults.length > 0;
  const canCreate =
    mode === "channel"
      ? Boolean(groupTitle.trim()) && !creating
      : selected.size > 0 && !creating;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
          <h2 className="text-sm font-semibold">{t("newConversation")}</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("common:close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-1 border-b border-border px-4 py-2 shrink-0">
          <button
            onClick={() => setMode("select")}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              mode === "select"
                ? "bg-primary/10 text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <MessageCircle className="mr-1 inline h-3 w-3" />
            {t("newDialog.message")}
          </button>
          <button
            onClick={() => setMode("channel")}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              mode === "channel"
                ? "bg-primary/10 text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Users className="mr-1 inline h-3 w-3" />
            {t("newDialog.channel")}
          </button>
        </div>

        {mode === "select" && (
          <div className="border-b border-border px-4 py-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder={t("newDialog.searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-8 text-xs"
                autoFocus
              />
            </div>
          </div>
        )}

        {error && (
          <div className="px-4 py-2 text-xs text-destructive shrink-0">{error}</div>
        )}

        {mode === "channel" ? (
          <>
            <div className="flex flex-col gap-3 border-b border-border px-4 py-3 shrink-0">
              <div>
                <Label className="text-xs text-muted-foreground">{t("newDialog.channelName")}</Label>
                <Input
                  placeholder={t("newDialog.channelNamePlaceholder")}
                  value={groupTitle}
                  onChange={(e) => setGroupTitle(e.target.value)}
                  className="mt-1 h-8 text-xs"
                  autoFocus
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {t("newDialog.membersOptionalHint")}
              </p>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {filteredAgents.map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  isSelected={selected.has(agent.id)}
                  onClick={() => toggleParticipant(agent.id)}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            {selected.size > 0 && (
              <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2 shrink-0">
                {[...selected].map((id) => {
                  const p = participantMap.get(id);
                  return (
                    <button
                      key={id}
                      onClick={() => toggleParticipant(id)}
                      className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary hover:bg-primary/20"
                    >
                      {p?.displayName ?? t("participant")}
                      <X className="h-3 w-3" />
                    </button>
                  );
                })}
              </div>
            )}

            {isGroup && (
              <div className="border-b border-border px-4 py-2 shrink-0">
                <Label className="text-xs text-muted-foreground">{t("newDialog.groupName")}</Label>
                <Input
                  placeholder={t("newDialog.groupNamePlaceholder")}
                  value={groupTitle}
                  onChange={(e) => setGroupTitle(e.target.value)}
                  className="mt-1 h-8 text-xs"
                />
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto">
              {hasPeople && (
                <>
                  <div className="px-4 py-1.5">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      {t("newDialog.people")}
                    </span>
                  </div>
                  {peopleResults.map((person) => (
                    <PersonRow
                      key={person.id}
                      person={person}
                      isSelected={selected.has(person.id)}
                      connection={getPersonConnection(person)}
                      currentUserId={currentUserId}
                      onSelect={() => toggleParticipant(person.id)}
                      onConnect={() => handleConnectPerson(person)}
                    />
                  ))}
                </>
              )}

              {searchingPeople && search.length >= 2 && (
                <div className="flex items-center gap-2 px-4 py-2">
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {t("newDialog.searchingPeople")}
                  </span>
                </div>
              )}

              {(hasPeople || search.length >= 2) && (
                <div className="px-4 py-1.5">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {t("nav:agents")}
                  </span>
                </div>
              )}
              {filteredAgents.length === 0 && !hasPeople && !searchingPeople && (
                <p className="p-4 text-center text-xs text-muted-foreground">
                  {search ? t("newDialog.noResults") : t("noAgentsAvailable")}
                </p>
              )}
              {filteredAgents.map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  isSelected={selected.has(agent.id)}
                  onClick={() => toggleParticipant(agent.id)}
                />
              ))}
            </div>
          </>
        )}

        <div className="flex items-center justify-between border-t border-border px-4 py-3 shrink-0">
          <span className="text-xs text-muted-foreground">
            {mode === "channel"
              ? selected.size > 0
                ? t("newDialog.membersSelected", { count: selected.size })
                : t("newDialog.membersOptional")
              : selected.size === 0
              ? t("newDialog.selectPrompt")
              : selected.size === 1
              ? t("newDialog.startDm")
              : t("newDialog.groupWith", { count: selected.size })}
          </span>
          <Button size="sm" onClick={handleCreate} disabled={!canCreate}>
            {creating ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : mode === "channel" ? (
              <Users className="mr-1 h-3 w-3" />
            ) : selected.size <= 1 ? (
              <MessageCircle className="mr-1 h-3 w-3" />
            ) : (
              <Users className="mr-1 h-3 w-3" />
            )}
            {mode === "channel"
              ? t("newDialog.createChannel")
              : selected.size <= 1
              ? t("newDialog.startChat")
              : t("newDialog.createGroup")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PersonRow({
  person,
  isSelected,
  connection,
  currentUserId,
  onSelect,
  onConnect,
}: {
  person: Participant;
  isSelected: boolean;
  connection?: api.UserConnection;
  currentUserId?: string;
  onSelect: () => void;
  onConnect: () => void;
}) {
  const { t } = useTranslation("chat");
  const status = connection?.status ?? person.connectionStatus ?? "none";
  const incoming = connection?.status === "pending" && connection.addresseeId === currentUserId;
  const canChat = status === "accepted";
  const canRequest = person.canRequest || status === "none" || status === "rejected" || status === "revoked";

  return (
    <button
      onClick={() => {
        if (canChat) onSelect();
      }}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
        canChat ? "hover:bg-muted/50" : "cursor-default opacity-80"
      )}
    >
      <Avatar className="h-8 w-8">
        {person.avatarUrl && <AvatarImage src={person.avatarUrl} />}
        <AvatarFallback className="text-[10px]">
          <User className="h-3.5 w-3.5" />
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{person.displayName}</p>
        {(person.email || person.maskedEmail) && (
          <p className="truncate text-[11px] text-muted-foreground">{person.email ?? person.maskedEmail}</p>
        )}
      </div>
      {canChat ? (
        isSelected && (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
            <Check className="h-3 w-3 text-primary-foreground" />
          </div>
        )
      ) : canRequest ? (
        <Button
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            onConnect();
          }}
        >
          <UserPlus className="mr-1 h-3 w-3" />
          {t("common:connect")}
        </Button>
      ) : (
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] capitalize text-muted-foreground">
          {incoming
            ? t("friends:respondInFriends")
            : status === "pending"
            ? t("friends:status.pending")
            : status === "blocked"
            ? t("friends:status.blocked")
            : status}
        </span>
      )}
    </button>
  );
}

function AgentRow({
  agent,
  isSelected,
  onClick,
}: {
  agent: Agent;
  isSelected: boolean;
  onClick: () => void;
}) {
  // Live presence only (presenceStore) — never the stale REST flags.
  const isAgentOnline = usePresenceStore((s) => s.online.has(agent.id));
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
    >
      <Avatar className="h-8 w-8">
        {agent.avatarUrl && <AvatarImage src={agent.avatarUrl} />}
        <AvatarFallback className="bg-primary/10 text-primary text-[10px]">
          <Bot className="h-3.5 w-3.5" />
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{agent.displayName}</p>
        {agent.description && (
          <p className="truncate text-[11px] text-muted-foreground">
            {agent.description}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {isAgentOnline && <span className="h-2 w-2 rounded-full bg-success" />}
        {isSelected && (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
            <Check className="h-3 w-3 text-primary-foreground" />
          </div>
        )}
      </div>
    </button>
  );
}
