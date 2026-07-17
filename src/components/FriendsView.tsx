import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Search,
  User,
  UserPlus,
  Loader2,
  MessageCircle,
  UserMinus,
  ShieldOff,
  X,
  Bot,
  Sparkles,
  Clock,
  MapPin,
  Globe,
  Users,
  Ban,
  CalendarDays,
  Flag,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "../lib/utils";
import i18n from "../i18n";
import * as api from "../lib/api";
import { useAuthStore } from "../stores/authStore";
import { useChatStore } from "../stores/chatStore";
import { useFriendStore } from "../stores/friendStore";
import { useNavStore } from "../stores/navStore";
import { usePresenceStore } from "../stores/presenceStore";
import { useActiveWorkspace, useWorkspacesEnabled } from "../stores/workspaceStore";
import { WorkspaceSettingsModal } from "./WorkspaceSettingsModal";
import type { OrganizationMembership } from "../lib/api";

type Segment = "friends" | "requests" | "sent";
const SEGMENTS: Segment[] = ["friends", "requests", "sent"];

const BANNER_PALETTE: Array<[string, string]> = [
  ["#FF7E5F", "#FEB47B"],
  ["#6A11CB", "#2575FC"],
  ["#1E3C72", "#2A5298"],
  ["#11998E", "#38EF7D"],
  ["#FC4A1A", "#F7B733"],
  ["#FF0099", "#493240"],
  ["#283C86", "#45A247"],
  ["#CC2B5E", "#753A88"],
];

const TAGLINE_MAX = 120;

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function bannerFor(person: api.Participant): [string, string] {
  return BANNER_PALETTE[hashSeed(person.id || person.displayName) % BANNER_PALETTE.length];
}

function extractTagline(person?: api.Participant): string | null {
  const meta = person?.metadata as { tagline?: unknown; status?: unknown } | undefined;
  const raw =
    (typeof meta?.tagline === "string" && meta.tagline.trim()) ||
    (typeof meta?.status === "string" && meta.status.trim()) ||
    "";
  if (!raw) return null;
  return raw.length > TAGLINE_MAX ? raw.slice(0, TAGLINE_MAX - 1) + "…" : raw;
}

function otherParticipant(connection: api.UserConnection, currentUserId?: string) {
  return connection.requesterId === currentUserId ? connection.addressee : connection.requester;
}

function initials(name?: string) {
  return (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

function makeHandle(person?: api.Participant) {
  const metadataHandle = person?.metadata?.handle;
  const metadataUsername = person?.metadata?.username;
  const explicitHandle =
    typeof metadataHandle === "string" && metadataHandle.trim()
      ? metadataHandle
      : typeof metadataUsername === "string" && metadataUsername.trim()
        ? metadataUsername
        : undefined;

  const fallback = (explicitHandle ?? person?.displayName)
    ?.toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);
  return fallback ? `@${fallback}` : "@friend";
}

function shortMonth(iso?: string) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" }).format(d);
}

function mutualsSummary(preview: api.Participant[], total: number): string {
  if (total === 0) return "";
  const names = preview.slice(0, 2).map((m) => m.displayName.split(" ")[0]);
  const remainder = total - names.length;
  if (remainder <= 0) {
    if (names.length === 1) return i18n.t("friends:followedByOne", { name: names[0] });
    return i18n.t("friends:followedByTwo", { name1: names[0], name2: names[1] });
  }
  const named = names.length === 1 ? names[0] : `${names[0]}, ${names[1]}`;
  return i18n.t("friends:followedByMore", { names: named, count: remainder });
}

// `onNavigate` fires when the view switches to a chat (e.g. "Message" on a
// friend) — the Profile drawer passes its close handler so the drawer doesn't
// stay open over the conversation it just navigated to.
export function FriendsView({ onNavigate }: { onNavigate?: () => void } = {}) {
  const { t } = useTranslation("friends");
  const currentUserId = useAuthStore((s) => s.participant?.id);
  const setView = useNavStore((s) => s.setView);
  const conversations = useChatStore((s) => s.conversations);
  const createConversation = useChatStore((s) => s.createConversation);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const onlineSet = usePresenceStore((s) => s.online);

  const {
    connections,
    loading,
    pendingCount,
    fetchConnections,
    fetchPendingCount,
    requestFriend,
    respondFriend,
    revokeFriend,
    blockFriend,
    unblockFriend,
  } = useFriendStore();

  const [segment, setSegment] = useState<Segment>("friends");
  const [search, setSearch] = useState("");
  const [people, setPeople] = useState<api.Participant[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<api.Participant | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    fetchConnections();
    fetchPendingCount();
  }, [fetchConnections, fetchPendingCount]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const q = search.trim();
    if (q.length < 2) {
      setPeople([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    timerRef.current = setTimeout(async () => {
      try {
        const data = await api.searchPeople(q);
        setPeople(data.people ?? []);
      } catch (e) {
        setPeople([]);
        console.warn("[Friends] people search failed", e);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [search]);

  const received = useMemo(
    () => connections.filter((c) => c.status === "pending" && c.addresseeId === currentUserId),
    [connections, currentUserId]
  );
  const sent = useMemo(
    () => connections.filter((c) => c.status === "pending" && c.requesterId === currentUserId),
    [connections, currentUserId]
  );
  const friends = useMemo(
    () => connections.filter((c) => c.status === "accepted"),
    [connections]
  );
  // The backend only returns blocked connections to the blocker.
  const blocked = useMemo(
    () => connections.filter((c) => c.status === "blocked"),
    [connections]
  );

  const currentList = segment === "requests" ? received : segment === "sent" ? sent : friends;
  const selectedConnection = selectedConnectionId
    ? connections.find((c) => c.id === selectedConnectionId && c.status === "accepted") ?? null
    : null;
  const lastSelectedConnectionRef = useRef<api.UserConnection | null>(null);
  if (selectedConnection) lastSelectedConnectionRef.current = selectedConnection;
  const displayConnection = selectedConnection ?? lastSelectedConnectionRef.current;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedConnectionId) setSelectedConnectionId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedConnectionId]);

  const updateSearchResult = (participantId: string, patch: Partial<api.Participant>) => {
    setPeople((rows) => rows.map((p) => (p.id === participantId ? { ...p, ...patch } : p)));
  };

  const handleConnect = async (person: api.Participant) => {
    setBusyId(person.id);
    setError(null);
    try {
      const connection = await requestFriend(person.id);
      updateSearchResult(person.id, {
        connectionId: connection?.id,
        connectionStatus: connection?.status ?? "pending",
        canRequest: false,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.sendRequest"));
    } finally {
      setBusyId(null);
    }
  };

  const handleRespond = async (id: string, decision: "accepted" | "rejected") => {
    setBusyId(id);
    setError(null);
    try {
      await respondFriend(id, decision);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.updateRequest"));
    } finally {
      setBusyId(null);
    }
  };

  const handleRevoke = async (connection: api.UserConnection) => {
    const question =
      connection.status === "accepted" ? t("confirmUnfriend") : t("confirmCancelRequest");
    if (!confirm(question)) return;
    setBusyId(connection.id);
    setError(null);
    try {
      await revokeFriend(connection.id);
      if (selectedConnectionId === connection.id) setSelectedConnectionId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.updateConnection"));
    } finally {
      setBusyId(null);
    }
  };

  const handleBlock = async (connection: api.UserConnection) => {
    if (!confirm(t("confirmBlock"))) return;
    setBusyId(connection.id);
    setError(null);
    try {
      await blockFriend(connection.id);
      if (selectedConnectionId === connection.id) setSelectedConnectionId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.blockUser"));
    } finally {
      setBusyId(null);
    }
  };

  const handleUnblock = async (connection: api.UserConnection) => {
    if (!confirm(t("unblockConfirm"))) return;
    setBusyId(connection.id);
    setError(null);
    try {
      await unblockFriend(connection.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.unblockUser"));
    } finally {
      setBusyId(null);
    }
  };

  const handleReport = (connection: api.UserConnection) => {
    const person = otherParticipant(connection, currentUserId);
    if (person) setReportTarget(person);
  };

  const handleMessage = async (connection: api.UserConnection) => {
    const peer = otherParticipant(connection, currentUserId);
    if (!peer) return;
    const existing = conversations.find(
      (c) => c.type === "direct" && c.members?.some((m) => m.participantId === peer.id)
    );
    setBusyId(connection.id);
    try {
      if (existing) {
        setActiveConversation(existing.id);
      } else {
        const conv = await createConversation({ type: "direct", memberIds: [peer.id] });
        setActiveConversation(conv.id);
      }
      setView("chat");
      onNavigate?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.startChat"));
    } finally {
      setBusyId(null);
    }
  };

  // When the user's active workspace is non-personal, swap to the
  // Members view (workspace memberships, no friend graph). Mirrors
  // web's FriendsPage behavior — see ARCHITECTURE.md § 17b.
  const activeWorkspace = useActiveWorkspace();
  const workspacesEnabled = useWorkspacesEnabled();
  if (workspacesEnabled && activeWorkspace && !activeWorkspace.isPersonal) {
    return (
      <MembersView
        workspaceId={activeWorkspace.id}
        workspaceName={activeWorkspace.name}
        callerRole={activeWorkspace.role}
      />
    );
  }

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center shrink-0">
              <Users className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-tight">{t("nav:friends")}</h1>
              <p className="text-[11px] text-muted-foreground">
                {t("friendCount", { count: friends.length })}
                {pendingCount > 0 && (
                  <span className="ml-1.5 text-warning">
                    · {t("pendingCount", { count: pendingCount })}
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="ml-2 flex items-center gap-1">
            {SEGMENTS.map((value) => {
              const count =
                value === "requests"
                  ? pendingCount || received.length
                  : value === "friends"
                    ? friends.length
                    : sent.length;
              const active = segment === value;
              return (
                <button
                  key={value}
                  onClick={() => setSegment(value)}
                  className={cn(
                    "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
                    active
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {t(`segments.${value}`)}
                  {count > 0 && (
                    <span
                      className={cn(
                        "inline-flex h-4 min-w-[16px] items-center justify-center rounded px-1 text-[10px] font-bold",
                        active ? "bg-background/20" : "bg-muted-foreground/15 text-foreground/70"
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchPeoplePlaceholder")}
              className="h-8 w-[220px] pl-8 text-xs"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { fetchConnections(); fetchPendingCount(); }}
          >
            {t("common:refresh")}
          </Button>
        </div>
      </header>

      {error && (
        <div className="mx-4 mt-3 rounded-md border border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {notice && (
        <div className="mx-4 mt-3 rounded-md border border-success/20 bg-success/10 px-4 py-2 text-sm text-success">
          {notice}
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        {search.trim().length >= 2 && (
          <section className="border-b border-border bg-card/30">
            <div className="border-b border-border px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {t("peopleSearchHeader")}
            </div>
            {searching ? (
              <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("searchingPeople")}
              </div>
            ) : people.length === 0 ? (
              <div className="px-4 py-3 text-sm text-muted-foreground">{t("noPeopleFound")}</div>
            ) : (
              people.map((person) => (
                <PersonSearchRow
                  key={person.id}
                  person={person}
                  connections={connections}
                  currentUserId={currentUserId}
                  busy={busyId === person.id || busyId === person.connectionId}
                  online={onlineSet.has(person.id)}
                  onConnect={() => handleConnect(person)}
                  onOpenRequests={() => setSegment("requests")}
                />
              ))
            )}
          </section>
        )}

        {loading && connections.length === 0 ? (
          <div className="py-20 text-center text-sm text-muted-foreground">
            {t("loadingFriends")}
          </div>
        ) : currentList.length === 0 && !(segment === "friends" && blocked.length > 0) ? (
          <FriendsEmptyState
            segment={segment}
            onFindPeople={() => searchInputRef.current?.focus()}
          />
        ) : segment === "friends" ? (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {currentList.length > 0 && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
                {currentList.map((connection) => {
                  const person = otherParticipant(connection, currentUserId);
                  return (
                    <FriendCard
                      key={connection.id}
                      connection={connection}
                      currentUserId={currentUserId}
                      busy={busyId === connection.id}
                      online={person?.id ? onlineSet.has(person.id) : false}
                      onRevoke={() => handleRevoke(connection)}
                      onMessage={() => handleMessage(connection)}
                      onOpenProfile={() => setSelectedConnectionId(connection.id)}
                    />
                  );
                })}
              </div>
            )}
            {blocked.length > 0 && (
              <section className={cn(currentList.length > 0 && "mt-6")}>
                <h2 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {t("blockedUsers")}
                </h2>
                <div className="space-y-1.5">
                  {blocked.map((connection) => (
                    <BlockedUserRow
                      key={connection.id}
                      connection={connection}
                      currentUserId={currentUserId}
                      busy={busyId === connection.id}
                      onUnblock={() => handleUnblock(connection)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3">
              {currentList.map((connection) => (
                <ConnectionCard
                  key={connection.id}
                  connection={connection}
                  currentUserId={currentUserId}
                  segment={segment}
                  busy={busyId === connection.id}
                  online={(() => {
                    const p = otherParticipant(connection, currentUserId);
                    return p?.id ? onlineSet.has(p.id) : false;
                  })()}
                  onAccept={() => handleRespond(connection.id, "accepted")}
                  onReject={() => handleRespond(connection.id, "rejected")}
                  onRevoke={() => handleRevoke(connection)}
                  onBlock={() => handleBlock(connection)}
                  onReport={() => handleReport(connection)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <FriendProfileDrawer
        open={!!selectedConnection}
        connection={displayConnection}
        currentUserId={currentUserId}
        busy={!!selectedConnection && busyId === selectedConnection.id}
        onClose={() => setSelectedConnectionId(null)}
        onMessage={() => selectedConnection && handleMessage(selectedConnection)}
        onUnfriend={() => selectedConnection && handleRevoke(selectedConnection)}
        onBlock={() => selectedConnection && handleBlock(selectedConnection)}
        onReport={() => selectedConnection && handleReport(selectedConnection)}
      />

      {reportTarget && (
        <ReportUserDialog
          person={reportTarget}
          onClose={() => setReportTarget(null)}
          onSubmitted={() => setNotice(t("report.submitted"))}
        />
      )}
    </div>
  );
}

function PresenceDot({ online, className }: { online: boolean; className?: string }) {
  const { t } = useTranslation("common");
  return (
    <span
      className={cn(
        "absolute bottom-0 right-0 block h-3 w-3 rounded-full border-2 border-card",
        online ? "bg-success" : "bg-muted-foreground/60",
        className
      )}
      aria-label={online ? t("online") : t("offline")}
    />
  );
}

function PersonSearchRow({
  person,
  connections,
  currentUserId,
  busy,
  online,
  onConnect,
  onOpenRequests,
}: {
  person: api.Participant;
  connections: api.UserConnection[];
  currentUserId?: string;
  busy: boolean;
  online: boolean;
  onConnect: () => void;
  onOpenRequests: () => void;
}) {
  const { t } = useTranslation("friends");
  const connection =
    connections.find((c) => c.id === person.connectionId) ??
    connections.find((c) => c.requesterId === person.id || c.addresseeId === person.id);
  const status = connection?.status ?? person.connectionStatus ?? "none";
  const incoming = connection?.status === "pending" && connection.addresseeId === currentUserId;
  const canRequest = person.canRequest || status === "none" || status === "rejected" || status === "revoked";

  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <div className="relative">
        <Avatar className="h-9 w-9">
          {person.avatarUrl && <AvatarImage src={person.avatarUrl} displaySize={36} />}
          <AvatarFallback><User className="h-4 w-4" /></AvatarFallback>
        </Avatar>
        {online && <PresenceDot online className="h-2.5 w-2.5" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{person.displayName}</div>
        {person.email || person.maskedEmail ? (
          <div className="truncate text-xs text-muted-foreground">{person.email ?? person.maskedEmail}</div>
        ) : null}
      </div>
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : status === "accepted" ? (
        <Badge variant="secondary" className="bg-success/10 text-success">{t("nav:friends")}</Badge>
      ) : incoming ? (
        <Button size="sm" variant="outline" onClick={onOpenRequests}>{t("respond")}</Button>
      ) : canRequest ? (
        <Button size="sm" onClick={onConnect}><UserPlus className="mr-1 h-3 w-3" />{t("connect")}</Button>
      ) : (
        <Badge variant="outline">{t(`status.${status}`, { defaultValue: status })}</Badge>
      )}
    </div>
  );
}

function FriendsEmptyState({
  segment,
  onFindPeople,
}: {
  segment: Segment;
  onFindPeople: () => void;
}) {
  const { t } = useTranslation("friends");
  const Icon = segment === "requests" ? UserPlus : segment === "sent" ? Clock : Users;
  const title =
    segment === "friends"
      ? t("empty.friendsTitle")
      : segment === "requests"
        ? t("empty.requestsTitle")
        : t("empty.sentTitle");
  const body =
    segment === "friends"
      ? t("empty.friendsBody")
      : segment === "requests"
        ? t("empty.requestsBody")
        : t("empty.sentBody");

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Icon className="h-7 w-7" />
      </div>
      <p className="mt-4 text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">{body}</p>
      {segment === "friends" && (
        <Button size="sm" className="mt-4" onClick={onFindPeople}>
          <UserPlus className="mr-1.5 h-3.5 w-3.5" />
          {t("findPeople")}
        </Button>
      )}
    </div>
  );
}

function FriendCard({
  connection,
  currentUserId,
  busy,
  online,
  onRevoke,
  onMessage,
  onOpenProfile,
}: {
  connection: api.UserConnection;
  currentUserId?: string;
  busy: boolean;
  online: boolean;
  onRevoke: () => void;
  onMessage: () => void;
  onOpenProfile: () => void;
}) {
  const { t } = useTranslation("friends");
  const person = otherParticipant(connection, currentUserId);
  const handle = makeHandle(person);
  const tagline = extractTagline(person);
  const bio = tagline || person?.description || connection.message;
  const connectedAt = formatDateTime(
    connection.connectedAt ?? connection.respondedAt ?? connection.insertedAt
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenProfile}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenProfile();
        }
      }}
      className="group flex cursor-pointer flex-col rounded-xl border border-border bg-card p-4 transition-all hover:border-border-strong hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <Avatar className="h-11 w-11">
            {person?.avatarUrl && <AvatarImage src={person.avatarUrl} displaySize={44} />}
            <AvatarFallback className="text-sm font-semibold">
              {initials(person?.displayName)}
            </AvatarFallback>
          </Avatar>
          {online && (
            <span
              className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-success"
              aria-label={t("common:online")}
            />
          )}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold">
            {person?.displayName ?? t("common:unknown")}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">{handle}</p>
          <div className="mt-1 flex items-center gap-1.5 text-[11px]">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                online ? "bg-success" : "bg-muted-foreground/40"
              )}
            />
            <span className={online ? "font-medium text-success" : "text-muted-foreground"}>
              {online ? t("common:online") : t("common:offline")}
            </span>
          </div>
        </div>
      </div>

      {/* Bio — fixed two-line slot so cards stay the same height */}
      <p className="mt-3 line-clamp-2 min-h-[2rem] text-xs leading-snug text-muted-foreground">
        {bio || <span className="text-muted-foreground/40">{t("noBio")}</span>}
      </p>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
        <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
          <CalendarDays className="h-3 w-3 shrink-0" />
          <span className="truncate">{connectedAt}</span>
        </span>
        <div className="flex shrink-0 gap-1.5" onClick={(e) => e.stopPropagation()}>
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <>
              <button
                onClick={onMessage}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-85"
                title={t("messageUser", { name: person?.displayName ?? t("fallbackFriend") })}
              >
                <MessageCircle className="h-4 w-4" />
              </button>
              <button
                onClick={onRevoke}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card transition-colors hover:border-destructive/40 hover:bg-muted"
                title={t("unfriendUser", { name: person?.displayName ?? t("fallbackFriend") })}
              >
                <UserMinus className="h-4 w-4 text-destructive" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FriendProfileDrawer({
  open,
  connection,
  currentUserId,
  busy,
  onClose,
  onMessage,
  onUnfriend,
  onBlock,
  onReport,
}: {
  open: boolean;
  connection: api.UserConnection | null;
  currentUserId?: string;
  busy: boolean;
  onClose: () => void;
  onMessage: () => void;
  onUnfriend: () => void;
  onBlock: () => void;
  onReport: () => void;
}) {
  const { t } = useTranslation("friends");
  if (!connection) return null;
  const person = otherParticipant(connection, currentUserId);
  if (!person) return null;

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-200",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onClose}
      />
      <div
        className={cn(
          "fixed right-0 top-0 z-50 h-full w-[560px] max-w-[92vw] overflow-hidden bg-background shadow-2xl",
          "border-l border-border transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-colors hover:bg-black/60"
          title={t("common:close")}
        >
          <X className="h-4 w-4" />
        </button>
        <FriendProfileBody
          connection={connection}
          person={person}
          busy={busy}
          onMessage={onMessage}
          onUnfriend={onUnfriend}
          onBlock={onBlock}
          onReport={onReport}
        />
      </div>
    </>
  );
}

function FriendProfileBody({
  connection,
  person,
  busy,
  onMessage,
  onUnfriend,
  onBlock,
  onReport,
}: {
  connection: api.UserConnection;
  person: api.Participant;
  busy: boolean;
  onMessage: () => void;
  onUnfriend: () => void;
  onBlock: () => void;
  onReport: () => void;
}) {
  const { t } = useTranslation("friends");
  const [listings, setListings] = useState<api.DirectoryListing[] | null>(null);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [mutuals, setMutuals] = useState<{ count: number; mutuals: api.Participant[] } | null>(null);
  const isOnline = usePresenceStore((s) => s.online.has(person.id));

  useEffect(() => {
    let cancelled = false;
    setLoadingAgents(true);
    setAgentsError(null);
    api.listFriendAgents(person.id)
      .then((res) => {
        if (!cancelled) setListings(res.listings ?? []);
      })
      .catch((e) => {
        if (!cancelled) setAgentsError(e instanceof Error ? e.message : t("errors.loadAgents"));
      })
      .finally(() => {
        if (!cancelled) setLoadingAgents(false);
      });

    api.getFriendMutuals(person.id)
      .then((res) => {
        if (!cancelled) setMutuals({ count: res.count ?? 0, mutuals: res.mutuals ?? [] });
      })
      .catch(() => {
        if (!cancelled) setMutuals(null);
      });

    return () => {
      cancelled = true;
    };
  }, [person.id]);

  const handle = makeHandle(person);
  const tagline = extractTagline(person);
  const palette = bannerFor(person);
  const accent = palette[0];
  const agentsCount = listings?.length ?? 0;
  const joinedShort = shortMonth(person.insertedAt);
  const firstName = person.displayName.split(" ")[0];
  const sharingLocation = !!person.location;

  return (
    <div className="h-full overflow-y-auto">
      <div
        className="relative h-32"
        style={{ background: `linear-gradient(135deg, ${palette[0]} 0%, ${palette[1]} 100%)` }}
      >
        <div className="absolute -bottom-12 left-6">
          <div className="rounded-full bg-background p-1 shadow-lg">
            <Avatar className="h-24 w-24">
              {person.avatarUrl && (
                <AvatarImage src={person.avatarUrl} displaySize={96} className="rounded-full" />
              )}
              <AvatarFallback className="text-2xl font-semibold">
                {initials(person.displayName)}
              </AvatarFallback>
            </Avatar>
          </div>
        </div>
        {tagline && (
          <div className="absolute bottom-2 right-3 max-w-[60%]">
            <div
              className="flex items-center gap-1.5 rounded-full bg-background/95 px-3 py-1.5 shadow-md backdrop-blur-md"
              style={{ border: `1px solid ${accent}66` }}
            >
              <Sparkles className="h-3 w-3 shrink-0" style={{ color: accent }} />
              <span className="line-clamp-1 text-[12px] font-semibold italic text-foreground">
                {tagline}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="px-6 pt-14">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-2xl font-extrabold tracking-tight">{person.displayName}</h2>
          {connection.status === "accepted" && (
            <Badge variant="secondary" className="bg-success/10 text-success">
              {t("friendBadge")}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{handle}</p>

        {person.description && (
          <p className="mt-3 text-sm leading-relaxed text-foreground/85">{person.description}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-block h-2 w-2 rounded-full",
                isOnline ? "bg-success" : "bg-muted-foreground/40"
              )}
            />
            <span className={cn(isOnline && "font-semibold text-success")}>
              {isOnline ? t("onlineNow") : t("common:offline")}
            </span>
          </span>
          {person.timezone && (
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              {person.timezone}
            </span>
          )}
          {sharingLocation && (
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              {t("sharingLocation")}
            </span>
          )}
        </div>

        <div className="mt-5 grid grid-cols-3 divide-x divide-border border-y border-border py-3">
          <StatCell label={t("nav:agents")} value={agentsCount} />
          <StatCell label={t("mutuals")} value={mutuals?.count ?? "—"} />
          <StatCell label={t("joined")} value={joinedShort ?? "—"} />
        </div>

        {mutuals && mutuals.count > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <div className="flex">
              {mutuals.mutuals.slice(0, 3).map((m, idx) => (
                <div
                  key={m.id}
                  className="rounded-full ring-2 ring-background"
                  style={{ marginLeft: idx === 0 ? 0 : -10, zIndex: 3 - idx }}
                >
                  <Avatar className="h-6 w-6">
                    {m.avatarUrl && <AvatarImage src={m.avatarUrl} displaySize={24} />}
                    <AvatarFallback className="text-[9px]">{initials(m.displayName)}</AvatarFallback>
                  </Avatar>
                </div>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              {mutualsSummary(mutuals.mutuals, mutuals.count)}
            </span>
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <Button className="flex-1" onClick={onMessage} disabled={busy}>
            <MessageCircle className="mr-1.5 h-4 w-4" />
            {t("message")}
          </Button>
          <Button
            variant="outline"
            onClick={onUnfriend}
            disabled={busy}
            className="flex-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <UserMinus className="mr-1.5 h-4 w-4" />
            {connection.status === "accepted" ? t("unfriend") : t("common:cancel")}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={onBlock}
            disabled={busy}
            title={t("blockAction")}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Ban className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={onReport}
            disabled={busy}
            title={t("report.action")}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Flag className="h-4 w-4" />
          </Button>
        </div>

        <section className="mt-7">
          <div className="flex items-end justify-between">
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {t("availableAgents")}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("availableAgentsSubtitle", { name: firstName })}
              </p>
            </div>
            {agentsCount > 0 && (
              <span className="text-xs font-bold text-muted-foreground">{agentsCount}</span>
            )}
          </div>

          <div className="mt-3 space-y-2 pb-6">
            {loadingAgents ? (
              <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("loadingSharedAgents")}
              </div>
            ) : agentsError ? (
              <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
                {agentsError}
              </div>
            ) : !listings || listings.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                {t("noSharedAgents")}
              </div>
            ) : (
              listings.map((listing) => {
                const friendsOnly = listing.visibility === "friends_only";
                return (
                  <div
                    key={listing.id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:bg-surface-hover"
                  >
                    <Avatar className="h-11 w-11 rounded-lg">
                      {listing.agent?.avatarUrl && (
                        <AvatarImage src={listing.agent.avatarUrl} className="rounded-lg" displaySize={44} />
                      )}
                      <AvatarFallback className="rounded-lg bg-primary/10 text-primary">
                        <Bot className="h-4 w-4" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold">{listing.listingName}</span>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                            friendsOnly
                              ? "bg-primary/10 text-primary"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          {friendsOnly ? <Users className="h-2.5 w-2.5" /> : <Globe className="h-2.5 w-2.5" />}
                          {friendsOnly ? t("visibility.friends") : t("visibility.public")}
                        </span>
                        {listing.verified && (
                          <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                            {t("verified")}
                          </Badge>
                        )}
                      </div>
                      {(listing.listingDescription || listing.agent?.description) && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {listing.listingDescription || listing.agent?.description}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="border-t border-border pb-8 pt-5">
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Connection
          </h3>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" />
            Connected {formatDateTime(connection.connectedAt ?? connection.respondedAt ?? connection.insertedAt)}
          </div>
          {connection.message && (
            <p className="mt-3 rounded-lg border border-border bg-muted/30 p-3 text-sm text-foreground/80">
              “{connection.message}”
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-base font-bold text-foreground">{value}</span>
      <span className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function formatDateTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function ConnectionCard({
  connection,
  currentUserId,
  segment,
  busy,
  online,
  onAccept,
  onReject,
  onRevoke,
  onBlock,
  onReport,
}: {
  connection: api.UserConnection;
  currentUserId?: string;
  segment: Segment;
  busy: boolean;
  online: boolean;
  onAccept: () => void;
  onReject: () => void;
  onRevoke: () => void;
  onBlock: () => void;
  onReport: () => void;
}) {
  const { t } = useTranslation("friends");
  const person = otherParticipant(connection, currentUserId);
  return (
    <div className="rounded-xl border border-border bg-card p-4 transition-colors hover:bg-surface-hover">
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <Avatar className="h-11 w-11">
            {person?.avatarUrl && <AvatarImage src={person.avatarUrl} displaySize={44} />}
            <AvatarFallback>{initials(person?.displayName)}</AvatarFallback>
          </Avatar>
          {online && <PresenceDot online />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{person?.displayName ?? "Unknown"}</div>
          <div className="truncate text-xs text-muted-foreground">{makeHandle(person)}</div>
          {connection.message && (
            <p className="mt-1 line-clamp-2 text-xs text-foreground/80">“{connection.message}”</p>
          )}
        </div>
        <Badge
          variant={connection.status === "accepted" ? "secondary" : "outline"}
          className="capitalize"
        >
          {connection.status}
        </Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : segment === "requests" ? (
          <>
            <Button size="sm" onClick={onAccept}>Accept</Button>
            <Button size="sm" variant="outline" onClick={onReject}>Reject</Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={onBlock}>
              <ShieldOff className="mr-1 h-3 w-3" />Block
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={onReport}>
              <Flag className="mr-1 h-3 w-3" />{t("report.action")}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={onRevoke}>Cancel request</Button>
        )}
      </div>
    </div>
  );
}

function BlockedUserRow({
  connection,
  currentUserId,
  busy,
  onUnblock,
}: {
  connection: api.UserConnection;
  currentUserId?: string;
  busy: boolean;
  onUnblock: () => void;
}) {
  const { t } = useTranslation("friends");
  const person = otherParticipant(connection, currentUserId);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <Avatar className="h-9 w-9">
        {person?.avatarUrl && <AvatarImage src={person.avatarUrl} displaySize={36} />}
        <AvatarFallback>{initials(person?.displayName)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">
          {person?.displayName ?? t("common:unknown")}
        </div>
        <div className="truncate text-xs text-muted-foreground">{makeHandle(person)}</div>
      </div>
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <Button size="sm" variant="outline" onClick={onUnblock}>
          <ShieldOff className="mr-1 h-3 w-3" />
          {t("unblock")}
        </Button>
      )}
    </div>
  );
}

const REPORT_REASONS: api.ReportReason[] = [
  "harassment",
  "spam",
  "impersonation",
  "inappropriate_content",
  "other",
];

function ReportUserDialog({
  person,
  onClose,
  onSubmitted,
}: {
  person: api.Participant;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const { t } = useTranslation("friends");
  const [reason, setReason] = useState<api.ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!reason || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.reportUser({
        reportedParticipantId: person.id,
        reason,
        ...(details.trim() ? { details: details.trim() } : {}),
      });
      onSubmitted();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.reportUser"));
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("report.title")}</DialogTitle>
          <DialogDescription>{t("report.message")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5">
          {REPORT_REASONS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setReason(value)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                reason === value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {t(`report.reasons.${value}`)}
            </button>
          ))}
        </div>

        <Textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder={t("report.detailsPlaceholder")}
          rows={3}
          className="resize-none"
        />

        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t("common:cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!reason || submitting}>
            {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {t("report.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Workspace-mode replacement for the friends list. Shows org
 * memberships; tap a row to start/open a 1:1 DM with that member in
 * the current workspace. Workspace membership doesn't auto-add anyone
 * to the personal friend graph (orthogonal — see ARCHITECTURE.md
 * § 17b). Admins/owners get an Invite button that opens the
 * workspace settings modal so invite writes stay in one place.
 */
function MembersView({
  workspaceId,
  workspaceName,
  callerRole,
}: {
  workspaceId: string;
  workspaceName: string;
  callerRole: "owner" | "admin" | "member";
}) {
  const { t } = useTranslation("friends");
  const currentUserId = useAuthStore((s) => s.participant?.id);
  const setView = useNavStore((s) => s.setView);
  const conversations = useChatStore((s) => s.conversations);
  const createConversation = useChatStore((s) => s.createConversation);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const onlineSet = usePresenceStore((s) => s.online);

  const isAdminOrOwner = callerRole === "owner" || callerRole === "admin";

  const [members, setMembers] = useState<OrganizationMembership[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Re-fetch on workspace change. Cancellation guard so a stale
  // result from one workspace can't overwrite another's during a
  // switch.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .listOrganizationMembers(workspaceId)
      .then((rows) => {
        if (!cancelled) setMembers(rows);
      })
      .catch((e) => {
        if (!cancelled) {
          setMembers([]);
          setError(e instanceof Error ? e.message : t("errors.loadMembersFailed"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const handleMessage = async (member: OrganizationMembership) => {
    if (member.participantId === currentUserId) return;
    setBusyId(member.participantId);
    try {
      const existing = conversations.find(
        (c) =>
          c.type === "direct" &&
          c.members?.some((m) => m.participantId === member.participantId)
      );
      let convId: string;
      if (existing) {
        convId = existing.id;
      } else {
        const conv = await createConversation({
          type: "direct",
          memberIds: [member.participantId],
        });
        convId = conv.id;
      }
      setActiveConversation(convId);
      setView("chat");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.startChat"));
    } finally {
      setBusyId(null);
    }
  };

  const visibleMembers = members ?? [];
  const memberCount = visibleMembers.length;

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center shrink-0">
              <Users className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold leading-tight">{t("nav:members")}</h1>
              <p className="text-[11px] text-muted-foreground">
                {t("membersCount", { count: memberCount, workspace: workspaceName })}
              </p>
            </div>
          </div>
        </div>
        {isAdminOrOwner && (
          <Button size="sm" onClick={() => setSettingsOpen(true)}>
            <UserPlus className="mr-1 h-3 w-3" />
            {t("invite")}
          </Button>
        )}
      </header>

      {error && (
        <div className="border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading && !members ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("loadingMembers")}
          </div>
        ) : memberCount === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-8 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Users className="h-7 w-7" />
            </div>
            <p className="mt-4 text-sm font-semibold text-foreground">{t("empty.noMembers")}</p>
            <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
              {isAdminOrOwner ? t("empty.noMembersAdminHint") : t("empty.noMembersHint")}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
            {visibleMembers.map((m) => (
              <MemberRow
                key={m.participantId}
                member={m}
                isSelf={m.participantId === currentUserId}
                online={onlineSet.has(m.participantId)}
                busy={busyId === m.participantId}
                onMessage={() => handleMessage(m)}
              />
            ))}
          </div>
        )}
      </div>

      {settingsOpen && (
        <WorkspaceSettingsModal
          workspaceId={workspaceId}
          initialTab="invites"
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

function MemberRow({
  member,
  isSelf,
  online,
  busy,
  onMessage,
}: {
  member: OrganizationMembership;
  isSelf: boolean;
  online: boolean;
  busy: boolean;
  onMessage: () => void;
}) {
  const { t } = useTranslation("friends");
  const p = member.participant;
  const displayName = p?.displayName ?? t("memberFallback");
  const roleBadge =
    member.role === "owner" || member.role === "admin"
      ? "bg-primary/10 text-primary"
      : "bg-muted text-muted-foreground";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-all hover:border-border-strong hover:shadow-sm">
      <div className="relative shrink-0">
        <Avatar className="h-11 w-11">
          {p?.avatarUrl && <AvatarImage src={p.avatarUrl} alt="" displaySize={44} />}
          <AvatarFallback className="text-sm font-semibold">
            {(displayName.charAt(0) || "?").toUpperCase()}
          </AvatarFallback>
        </Avatar>
        {online && <PresenceDot online />}
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold">{displayName}</span>
          {isSelf && (
            <span className="text-[10px] text-muted-foreground">{t("youMarker")}</span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span
            className={cn(
              "inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide capitalize",
              roleBadge
            )}
          >
            {t(`role.${member.role}`, { defaultValue: member.role })}
          </span>
          <span className="flex items-center gap-1 text-[11px]">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                online ? "bg-success" : "bg-muted-foreground/40"
              )}
            />
            <span className={online ? "font-medium text-success" : "text-muted-foreground"}>
              {online ? t("common:online") : t("common:offline")}
            </span>
          </span>
        </div>
      </div>
      {!isSelf && (
        <Button
          size="icon"
          variant="outline"
          disabled={busy}
          onClick={onMessage}
          title={t("messageUser", { name: displayName })}
          className="shrink-0"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MessageCircle className="h-4 w-4" />
          )}
        </Button>
      )}
    </div>
  );
}
