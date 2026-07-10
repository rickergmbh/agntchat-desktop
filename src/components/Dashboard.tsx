import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentStore, type ManagedAgent } from "../stores/agentStore";
import { useDirectoryStore } from "../stores/directoryStore";
import { AgentRow } from "./AgentRow";
import { AGENT_GRID_COLS, AGENT_CELL_ENGINE, AGENT_CELL_MODE } from "./agentTableLayout";
import { AgentConfig } from "./AgentConfig";
import { CreateAgentModal } from "./CreateAgentModal";
import { cn } from "../lib/utils";
import {
  Bot,
  Plus,
  Search,
  Play,
  Power,
  Square,
  Star,
  CheckCircle,
  Clock,
  Link as LinkIcon,
  Unlink,
  Loader2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePresenceStore } from "../stores/presenceStore";
import { useAuthStore } from "../stores/authStore";
import { isAgentOnline } from "../lib/agentOnline";
import { useModelCatalog } from "../stores/modelCatalogStore";
import { restartHostedAgents } from "../lib/api";
import { runningElsewhereOn, useLocalDeviceName } from "../hooks/useRunningElsewhere";
import { OnboardingCards } from "./OnboardingCards";
import { useOnboardingState } from "../hooks/useOnboardingState";
import { useChatStore } from "../stores/chatStore";
import { useNavStore } from "../stores/navStore";
import type {
  AgentConnection,
  ConnectionMode,
  DirectoryListing,
} from "../lib/api";

type Tab = "agents" | "directory";

// ---------------------------------------------------------------------------
// Directory listing item — single row in the directory list.
// ---------------------------------------------------------------------------
function DirectoryItem({
  listing,
  connectionStatus,
  isActive,
  onClick,
}: {
  listing: DirectoryListing;
  connectionStatus?: "accepted" | "pending";
  isActive: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation("agents");
  const agent = listing.agent;
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover border-b border-border last:border-b-0",
        isActive && "bg-surface-active"
      )}
    >
      <Avatar className="h-10 w-10 shrink-0">
        {agent?.avatarUrl && <AvatarImage src={agent.avatarUrl} displaySize={40} />}
        <AvatarFallback className="text-xs">
          <Bot className="h-4 w-4" />
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{listing.listingName}</span>
          {listing.verified && (
            <span className="rounded-full bg-info/10 px-1.5 py-0.5 text-[9px] font-semibold text-info">
              {t("verified")}
            </span>
          )}
          {listing.visibility === "friends_only" && (
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
              {t("friendsOnly")}
            </span>
          )}
          {connectionStatus === "accepted" && (
            <span className="flex items-center gap-0.5 rounded-full bg-success/15 px-1.5 py-0.5 text-[9px] font-semibold text-success">
              <CheckCircle className="h-2.5 w-2.5" /> {t("common:connected")}
            </span>
          )}
          {connectionStatus === "pending" && (
            <span className="flex items-center gap-0.5 rounded-full bg-warning/15 px-1.5 py-0.5 text-[9px] font-semibold text-warning">
              <Clock className="h-2.5 w-2.5" /> {t("common:pending")}
            </span>
          )}
        </div>
        {listing.listingDescription && (
          <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
            {listing.listingDescription}
          </p>
        )}
        <div className="mt-1.5 flex items-center gap-3 text-[10px] text-muted-foreground">
          {listing.ratingCount > 0 && (
            <span className="flex items-center gap-0.5">
              <Star className="h-2.5 w-2.5 fill-yellow-400 text-yellow-400" />
              {listing.ratingAvg.toFixed(1)} ({listing.ratingCount})
            </span>
          )}
          {listing.monthlyTasksCompleted > 0 && (
            <span>{t("tasksPerMonth", { count: listing.monthlyTasksCompleted })}</span>
          )}
          {listing.categories.length > 0 && (
            <span className="truncate">{listing.categories.join(", ")}</span>
          )}
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Directory agent detail pane — drawer body that pairs with DirectoryItem.
// ---------------------------------------------------------------------------
function DirectoryAgentDetail({
  listing,
  connection,
  onConnect,
  onDisconnect,
  onClose,
}: {
  listing: DirectoryListing;
  connection?: AgentConnection;
  onConnect: (mode?: ConnectionMode) => void | Promise<void>;
  onDisconnect: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("agents");
  const agent = listing.agent;
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [chosenMode, setChosenMode] = useState<ConnectionMode>("direct");
  const allowsEither = listing.connectionMode === "either";
  const lockedMode =
    listing.connectionMode === "proxy" || listing.connectionMode === "direct"
      ? listing.connectionMode
      : null;

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    try {
      await onConnect(allowsEither ? chosenMode : undefined);
    } finally {
      setConnecting(false);
    }
  }, [onConnect, allowsEither, chosenMode]);

  const handleDisconnect = useCallback(async () => {
    if (!confirm(t("disconnectConfirm"))) return;
    setDisconnecting(true);
    try {
      await onDisconnect();
    } finally {
      setDisconnecting(false);
    }
  }, [onDisconnect, t]);

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <Avatar className="h-12 w-12">
          {agent?.avatarUrl && <AvatarImage src={agent.avatarUrl} displaySize={48} />}
          <AvatarFallback>
            <Bot className="h-5 w-5" />
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-base font-semibold">{listing.listingName}</h2>
            {listing.verified && (
              <span className="rounded-full bg-info/10 px-2 py-0.5 text-[10px] font-semibold text-info">
                {t("verified")}
              </span>
            )}
          </div>
          {listing.listingDescription && (
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {listing.listingDescription}
            </p>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t("common:close")}
        </Button>
      </div>

      <ScrollArea className="flex-1 px-6 py-4">
        <div className="max-w-lg space-y-6">
          {agent && (
            <div className="space-y-4">
              {agent.capabilities && agent.capabilities.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("capabilities")}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {agent.capabilities.map((cap) => (
                      <span
                        key={cap}
                        className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {agent.description && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("about")}
                  </p>
                  <p className="text-sm text-muted-foreground">{agent.description}</p>
                </div>
              )}
            </div>
          )}

          {listing.categories.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("categories")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {listing.categories.map((cat) => (
                  <span
                    key={cat}
                    className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                  >
                    {cat}
                  </span>
                ))}
              </div>
            </div>
          )}

          {listing.tags.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("tags")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {listing.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {!connection || connection.status === "rejected" || connection.status === "revoked" ? (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("connection.title")}
              </p>
              {allowsEither ? (
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => setChosenMode("direct")}
                    className={cn(
                      "w-full rounded-md border p-2.5 text-left transition-colors",
                      chosenMode === "direct"
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-accent"
                    )}
                  >
                    <div
                      className={cn(
                        "text-xs font-semibold",
                        chosenMode === "direct" ? "text-primary" : "text-foreground"
                      )}
                    >
                      {t("connection.direct")}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {t("connection.directDescription")}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setChosenMode("proxy")}
                    className={cn(
                      "w-full rounded-md border p-2.5 text-left transition-colors",
                      chosenMode === "proxy"
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-accent"
                    )}
                  >
                    <div
                      className={cn(
                        "text-xs font-semibold",
                        chosenMode === "proxy" ? "text-primary" : "text-foreground"
                      )}
                    >
                      {t("connection.proxy")}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {t("connection.proxyDescription")}
                    </div>
                  </button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {lockedMode === "proxy"
                    ? t("connection.proxyLocked")
                    : t("connection.directLocked")}
                </p>
              )}
            </div>
          ) : null}

          <div className="flex gap-2">
            {connection?.status === "accepted" ? (
              <>
                <div className="flex items-center gap-1.5 rounded-lg bg-muted px-3 py-2 text-xs font-semibold text-success">
                  <CheckCircle className="h-3.5 w-3.5" />
                  {t("common:connected")}
                </div>
                <button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="flex items-center gap-1.5 rounded-lg bg-muted px-3 py-2 text-xs font-semibold text-destructive transition-opacity hover:opacity-80 disabled:opacity-50"
                >
                  {disconnecting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Unlink className="h-3.5 w-3.5" />
                  )}
                  {t("disconnect.action")}
                </button>
              </>
            ) : connection?.status === "pending" ? (
              <div className="flex items-center gap-1.5 rounded-lg bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                {t("connect.pendingApproval")}
              </div>
            ) : (
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {connecting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <LinkIcon className="h-3.5 w-3.5" />
                )}
                {t("connect.action")}
              </button>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

export function Dashboard() {
  const { t } = useTranslation("agents");
  const {
    agents,
    selectedAgentId,
    loading,
    error,
    fetchAgents,
    fetchHealth,
    fetchActivities,
    refreshProcessStatuses,
    selectAgent,
    startAgent,
    stopAgent,
  } = useAgentStore();
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("agents");
  // First-run setup cards replace the zero-agents empty state.
  const onboarding = useOnboardingState();
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const setView = useNavStore((s) => s.setView);
  // Which agents have their sub-agent subtree expanded. Empty = all
  // collapsed, so sub-agents are hidden until a parent is opened.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Directory state — mirrors web/src/pages/AgentsPage.tsx exactly so the
  // two surfaces stay in sync. Listings load lazily on first switch into
  // the directory tab; connections load up-front so the connected/pending
  // pills render on agents/directory rows alike.
  const dirListings = useDirectoryStore((s) => s.listings);
  const dirLoading = useDirectoryStore((s) => s.loading);
  const dirLoadingMore = useDirectoryStore((s) => s.loadingMore);
  const dirHasMore = useDirectoryStore((s) => s.hasMore);
  const fetchDirectory = useDirectoryStore((s) => s.fetchDirectory);
  const fetchDirMore = useDirectoryStore((s) => s.fetchMore);
  const setDirSearch = useDirectoryStore((s) => s.setSearchQuery);
  const requestConnection = useDirectoryStore((s) => s.requestConnection);
  const connections = useDirectoryStore((s) => s.connections);
  const fetchConnections = useDirectoryStore((s) => s.fetchConnections);
  const revokeConnection = useDirectoryStore((s) => s.revokeConnection);

  // Load the backend model catalog so AgentRow can resolve model labels from
  // it (single source of truth) — agent list rows render before any detail
  // pane (which also loads it) is opened.
  const ensureCatalog = useModelCatalog((s) => s.ensureLoaded);

  const [dirSearch, setDirSearchLocal] = useState("");
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
  const dirSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleExpand = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const [startingAll, setStartingAll] = useState(false);
  const [stoppingAll, setStoppingAll] = useState(false);
  const [wakingHosted, setWakingHosted] = useState(false);
  const markWaking = usePresenceStore((s) => s.markWaking);
  const healthIntervalRef = useRef<ReturnType<typeof setInterval>>(null);
  const activityIntervalRef = useRef<ReturnType<typeof setInterval>>(null);

  useEffect(() => {
    fetchAgents();
    fetchHealth();
    fetchActivities();
    void ensureCatalog();
    // Connections drive the connected/pending pills in directory rows
    // and the proxy/direct badge on owned agents. Both tabs render
    // them, so fetch up-front rather than gating on activeTab.
    fetchConnections();

    // Health + process status: slow (backend REST, ~2-3s on shared-1x).
    // 60s cadence keeps dashboard responsive without burning Fly compute —
    // fleet_health is read-only and event-driven UI updates still come
    // over WebSocket.
    healthIntervalRef.current = setInterval(() => {
      refreshProcessStatuses();
      fetchHealth();
    }, 60000);

    // Bridge log activity: faster (local Tauri invoke, no backend cost).
    // Single shared poll for all components that show activity.
    activityIntervalRef.current = setInterval(() => {
      fetchActivities();
    }, 5000);

    return () => {
      if (healthIntervalRef.current) clearInterval(healthIntervalRef.current);
      if (activityIntervalRef.current) clearInterval(activityIntervalRef.current);
    };
  }, [fetchAgents, fetchHealth, fetchActivities, refreshProcessStatuses, fetchConnections, ensureCatalog]);

  // Lazy-load directory listings on first switch into the directory tab.
  useEffect(() => {
    if (activeTab === "directory" && dirListings.length === 0) {
      fetchDirectory();
    }
  }, [activeTab, dirListings.length, fetchDirectory]);

  const handleDirSearch = useCallback(
    (text: string) => {
      setDirSearchLocal(text);
      if (dirSearchTimer.current) clearTimeout(dirSearchTimer.current);
      dirSearchTimer.current = setTimeout(() => {
        setDirSearch(text);
      }, 400);
    },
    [setDirSearch]
  );

  const handleConnect = useCallback(
    async (listing: DirectoryListing, mode?: ConnectionMode) => {
      try {
        await requestConnection(listing.agentId, mode ? { mode } : undefined);
      } catch (e) {
        alert(e instanceof Error ? e.message : t("errors.connectFailed"));
      }
    },
    [requestConnection, t]
  );

  const handleDisconnect = useCallback(
    async (connectionId: string) => {
      try {
        await revokeConnection(connectionId);
      } catch (e) {
        alert(e instanceof Error ? e.message : t("errors.disconnectFailed"));
      }
    },
    [revokeConnection, t]
  );

  // Map agent IDs to connection status — pills shown on directory rows.
  const dirConnectionStatusMap = useMemo(() => {
    const map = new Map<string, "accepted" | "pending">();
    for (const conn of connections) {
      if (conn.status === "accepted" || conn.status === "pending") {
        map.set(conn.agentId, conn.status);
      }
    }
    return map;
  }, [connections]);

  const selectedListing = useMemo(
    () =>
      selectedListingId
        ? dirListings.find((l) => l.id === selectedListingId)
        : undefined,
    [dirListings, selectedListingId]
  );

  const selectedListingConnection = useMemo(
    () =>
      selectedListing
        ? connections.find(
            (c) =>
              c.agentId === selectedListing.agentId &&
              c.status !== "revoked" &&
              c.status !== "rejected"
          )
        : undefined,
    [connections, selectedListing]
  );

  const sortAgents = (a: ManagedAgent, b: ManagedAgent) => {
    // Orchestrators before other types
    const aOrch = a.agent.agentType === "orchestrator" ? 0 : 1;
    const bOrch = b.agent.agentType === "orchestrator" ? 0 : 1;
    if (aOrch !== bOrch) return aOrch - bOrch;
    // Alphabetical
    return a.agent.displayName.localeCompare(b.agent.displayName);
  };

  type AgentTreeRow = {
    managed: ManagedAgent;
    depth: number;
    isLast: boolean;
    parentLines: boolean[];
    hasChildren: boolean;
    childCount: number;
    expanded: boolean;
  };

  // Agents rendered as their ownership tree: each sub-agent sits directly
  // under its parent, indented, with file-tree connector lines. A parent's
  // sub-agents stay hidden until its row is expanded. While searching we fall
  // back to a flat list of matches — a tree reads wrong when a parent is
  // filtered out from under its child.
  const agentList: AgentTreeRow[] = (() => {
    const all = Object.values(agents);

    if (search) {
      return all
        .filter((m) =>
          m.agent.displayName.toLowerCase().includes(search.toLowerCase())
        )
        .sort(sortAgents)
        .map((managed) => ({
          managed,
          depth: 0,
          isLast: true,
          parentLines: [],
          hasChildren: false,
          childCount: 0,
          expanded: false,
        }));
    }

    // A sub-agent's ownerId points to another agent in the list; a top-level
    // agent's owner is the human (not present here).
    const ids = new Set(all.map((m) => m.agent.id));
    const childrenOf = new Map<string, ManagedAgent[]>();
    const roots: ManagedAgent[] = [];
    for (const m of all) {
      const ownerId = m.agent.ownerId;
      if (ownerId && ids.has(ownerId)) {
        const arr = childrenOf.get(ownerId);
        if (arr) arr.push(m);
        else childrenOf.set(ownerId, [m]);
      } else {
        roots.push(m);
      }
    }

    const flat: AgentTreeRow[] = [];
    const seen = new Set<string>();
    const visit = (
      m: ManagedAgent,
      depth: number,
      isLast: boolean,
      parentLines: boolean[]
    ) => {
      if (seen.has(m.agent.id)) return;
      seen.add(m.agent.id);

      const kids = (childrenOf.get(m.agent.id) ?? []).slice().sort(sortAgents);
      const expanded = expandedIds.has(m.agent.id);

      flat.push({
        managed: m,
        depth,
        isLast,
        parentLines,
        hasChildren: kids.length > 0,
        childCount: kids.length,
        expanded,
      });

      if (expanded && kids.length > 0) {
        const childLines = depth === 0 ? [] : [...parentLines, !isLast];
        kids.forEach((kid, j) =>
          visit(kid, depth + 1, j === kids.length - 1, childLines)
        );
      }
    };

    const sortedRoots = roots.slice().sort(sortAgents);
    sortedRoots.forEach((r, j) => visit(r, 0, j === sortedRoots.length - 1, []));
    return flat;
  })();

  const selectedAgent = selectedAgentId ? agents[selectedAgentId] : null;

  // Keep last selected agent in ref so content stays visible during close animation
  const lastAgentRef = useRef<ManagedAgent | null>(null);
  if (selectedAgent) lastAgentRef.current = selectedAgent;
  const displayAgent = selectedAgent || lastAgentRef.current;
  const drawerOpen = !!selectedAgent;

  // Close whichever detail panel is open on Escape. (The panels no longer have
  // a click-scrim, so Escape is the keyboard exit alongside their close button.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (drawerOpen) selectAgent(null);
      else if (selectedListingId) setSelectedListingId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, selectAgent, selectedListingId]);

  // Online count via the canonical `isAgentOnline` helper — the SAME rule the
  // rail counter and per-row dots use, so the header count can't drift from
  // the rest of the UI (issue #64). Presence (WS) OR, for local agents only, a
  // local subprocess in its pre-heartbeat window; org-host agents are
  // presence-only (their bridge runs on a remote VM, no local subprocess).
  const presenceOnline = usePresenceStore((s) => s.online);

  const onlineCount = Object.values(agents).filter((m) =>
    isAgentOnline(m, presenceOnline)
  ).length;
  const totalCount = Object.keys(agents).length;
  const agentDevices = usePresenceStore((s) => s.agentDevices);
  const myDevice = useLocalDeviceName();
  // "Start All" only targets locally-runnable agents — flipping an
  // org-host agent into "starting" here would do nothing useful since
  // the Tauri command short-circuits to AgentStatus::Remote. Agents whose
  // bridge is alive on ANOTHER of the user's machines are also skipped:
  // bulk-starting must never silently take an agent over from the machine
  // it's running on (the per-row Play button confirms that explicitly).
  const stoppedWithKeys = Object.values(agents).filter(
    (m) =>
      m.processStatus === "stopped" &&
      m.apiKey &&
      m.agent.runtime !== "org_host" &&
      runningElsewhereOn(m, presenceOnline.has(m.agent.id), agentDevices[m.agent.id], myDevice) === null
  );
  // "Stop All" mirrors Start All — only acts on LOCAL subprocesses this
  // desktop can actually stop. This is deliberately NOT `isAgentOnline`: an
  // agent merely online via WS presence (running on another device / org
  // host) has no local subprocess here, so stopAgent would be a no-op. Gate
  // the button on the true local-subprocess set, not the display-online count.
  const runningAgents = Object.values(agents).filter(
    (m) => m.processStatus === "running" && m.agent.runtime !== "org_host"
  );

  const handleStartAll = async () => {
    setStartingAll(true);
    for (let i = 0; i < stoppedWithKeys.length; i++) {
      try {
        await startAgent(stoppedWithKeys[i].agent.id);
        // Stagger startup to avoid thundering-herd on the backend.
        // Each agent registration triggers warmup + broadcast + backfill;
        // 3s gap lets the previous agent's async work settle before the
        // next one starts.
        if (i < stoppedWithKeys.length - 1) {
          await new Promise((r) => setTimeout(r, 3000));
        }
      } catch {
        // continue starting others
      }
    }
    setStartingAll(false);
  };

  const handleStopAll = async () => {
    setStoppingAll(true);
    for (const m of runningAgents) {
      try {
        await stopAgent(m.agent.id);
      } catch {
        // continue stopping others
      }
    }
    setStoppingAll(false);
  };

  // Hosted (org-host) agents that are currently offline. Unlike local agents,
  // these run on a remote VM and can't be "started" locally — they're brought
  // back via the server, which restarts each bridge on its host. Common after a
  // host restart leaves a whole fleet offline.
  // Hosted runtime is behind the `org_hosts` flag; when off there's no hosted
  // fleet to bring online, so suppress the bulk action entirely.
  const orgHostsEnabled = useAuthStore((s) => s.participant?.features?.org_hosts === true);
  const offlineHosted = orgHostsEnabled
    ? Object.values(agents).filter(
        (m) => m.agent.runtime === "org_host" && !isAgentOnline(m, presenceOnline)
      )
    : [];

  const handleBringHostedOnline = async () => {
    const ids = offlineHosted.map((m) => m.agent.id);
    setWakingHosted(true);
    // Spin each offline hosted row immediately; the presence store clears a
    // row when its agent reports online (or after a safety timeout).
    markWaking(ids);
    try {
      await restartHostedAgents(ids);
      // Bridges reconnect asynchronously; refetch so presence catches up (the
      // WS presence push also updates the rows as each comes online).
      await fetchAgents();
    } catch {
      // best-effort — leave the button for a retry
    } finally {
      setWakingHosted(false);
    }
  };

  // Directory drawer mirrors the agent drawer pattern — keeps the
  // selected listing visible during the slide-out animation so the
  // panel doesn't go blank when the user clicks "Close".
  const lastListingRef = useRef<DirectoryListing | null>(null);
  if (selectedListing) lastListingRef.current = selectedListing;
  const displayListing = selectedListing || lastListingRef.current;
  const dirDrawerOpen = !!selectedListing;

  // Activate-count for the Agents pill — excludes deactivated agents.
  const activeCount = useMemo(
    () => Object.values(agents).filter((m) => m.agent.status !== "deactivated").length,
    [agents]
  );

  return (
    <div className="flex-1 flex h-full overflow-hidden bg-canvas">
      {/* Main content — the agent grid / directory. Reflows (shrinks) when a
          detail panel opens beside it, rather than being occluded by an
          overlay drawer. */}
      <main className="relative z-0 flex-1 flex flex-col overflow-hidden min-w-0 bg-background">
        {/* Header — pill toggle (Agents | Directory) matches the web app
            so users see the same surface in both clients. Bulk-action +
            search controls only show in the Agents tab. */}
        <header
          className="@container h-14 shrink-0 pl-4 pr-8 flex items-center justify-between border-b border-border bg-card"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
          <div
            className="flex items-center gap-2 min-w-0"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center flex-shrink-0">
              <Bot className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <button
              onClick={() => {
                setActiveTab("agents");
                setSelectedListingId(null);
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                activeTab === "agents"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t("nav:agents")}
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                {activeCount}
              </span>
            </button>
            <button
              onClick={() => {
                setActiveTab("directory");
                selectAgent(null);
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                activeTab === "directory"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t("directory")}
            </button>
            {activeTab === "agents" && onlineCount > 0 && (
              <span className="ml-2 hidden @min-[560px]:inline text-[11px] text-success whitespace-nowrap">
                {t("runningCount", { count: onlineCount })}
              </span>
            )}
          </div>

          <div
            className="flex items-center gap-2 shrink-0"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            {activeTab === "agents" ? (
              <>
                {/* Search narrows, then collapses to an icon-only trigger as the
                    header tightens (e.g. detail pane open on a laptop) so it
                    never crowds the action buttons. */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <Input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("searchPlaceholder")}
                    aria-label={t("searchPlaceholder")}
                    className="h-8 pl-8 text-xs w-9 @min-[680px]:w-[120px] @min-[920px]:w-[180px] placeholder:opacity-0 @min-[680px]:placeholder:opacity-100"
                  />
                </div>
                {/* Action labels collapse to icon-only when the header is tight;
                    the `title` tooltips carry the meaning. */}
                {onlineCount < totalCount && stoppedWithKeys.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleStartAll}
                    disabled={startingAll}
                    title={t("bulk.startStoppedTitle", { count: stoppedWithKeys.length })}
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span className="hidden @min-[820px]:inline">
                      {startingAll ? t("bulk.starting") : t("bulk.startAll")}
                    </span>
                  </Button>
                )}
                {offlineHosted.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleBringHostedOnline}
                    disabled={wakingHosted}
                    title={t("bulk.bringOnlineTitle", { count: offlineHosted.length })}
                  >
                    {wakingHosted ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Power className="w-3.5 h-3.5" />
                    )}
                    <span className="hidden @min-[820px]:inline">
                      {wakingHosted
                        ? t("bulk.bringingOnline")
                        : t("bulk.bringOnlineCount", { count: offlineHosted.length })}
                    </span>
                  </Button>
                )}
                {runningAgents.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleStopAll}
                    disabled={stoppingAll}
                    title={t("bulk.stopRunningTitle", { count: runningAgents.length })}
                  >
                    <Square className="w-3.5 h-3.5" />
                    <span className="hidden @min-[820px]:inline">
                      {stoppingAll ? t("bulk.stopping") : t("bulk.stopAll")}
                    </span>
                  </Button>
                )}
                <Button size="sm" onClick={() => setShowCreate(true)} title={t("createAgent")}>
                  <Plus className="w-3.5 h-3.5" />
                  <span className="hidden @min-[820px]:inline">{t("createAgent")}</span>
                </Button>
              </>
            ) : (
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <Input
                  type="text"
                  value={dirSearch}
                  onChange={(e) => handleDirSearch(e.target.value)}
                  placeholder={t("directorySearchPlaceholder")}
                  aria-label={t("directorySearchPlaceholder")}
                  className="h-8 pl-8 text-xs w-9 @min-[560px]:w-[160px] @min-[820px]:w-[220px] placeholder:opacity-0 @min-[560px]:placeholder:opacity-100"
                />
              </div>
            )}
          </div>
        </header>

        {/* Content area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {error && (
            <div className="mx-4 mt-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 px-4 py-3 rounded-md">
              {error}
            </div>
          )}

          {activeTab === "agents" ? (
            loading && totalCount === 0 ? (
              <div className="text-center text-muted-foreground py-20">
                {t("common:loading")}
              </div>
            ) : totalCount === 0 && !error ? (
              onboarding.active ? (
                <OnboardingCards
                  onCreateAgent={() => setShowCreate(true)}
                  onOpenConversation={(id) => {
                    setActiveConversation(id);
                    setView("chat");
                  }}
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
                    <Bot className="w-7 h-7 text-primary" />
                  </div>
                  <p className="text-sm font-medium text-foreground">{t("empty.title")}</p>
                  <p className="text-xs text-muted-foreground mt-1 mb-4 max-w-xs">
                    {t("empty.createFirstHint")}
                  </p>
                  <Button size="sm" onClick={() => setShowCreate(true)}>
                    <Plus className="w-3.5 h-3.5" />
                    {t("createAgent")}
                  </Button>
                </div>
              )
            ) : (
              <div className="@container flex-1 overflow-y-auto">
                <div
                  className={cn(
                    "sticky top-0 z-10 gap-3 pl-4 pr-8 py-2 border-b border-border bg-card/95 backdrop-blur text-[10px] font-medium text-muted-foreground uppercase tracking-wider",
                    AGENT_GRID_COLS
                  )}
                >
                  <span>{t("common:agent")}</span>
                  <span className={AGENT_CELL_ENGINE}>{t("table.engine")}</span>
                  <span className={AGENT_CELL_MODE}>{t("table.mode")}</span>
                  <span>{t("common:status")}</span>
                  <span className="text-right">{t("table.actions")}</span>
                </div>
                {agentList.map((row) => (
                  <AgentRow
                    key={row.managed.agent.id}
                    managed={row.managed}
                    depth={row.depth}
                    isLast={row.isLast}
                    parentLines={row.parentLines}
                    hasChildren={row.hasChildren}
                    childCount={row.childCount}
                    expanded={row.expanded}
                    onToggleExpand={() => toggleExpand(row.managed.agent.id)}
                    selected={row.managed.agent.id === selectedAgentId}
                    onSelect={() =>
                      selectAgent(
                        row.managed.agent.id === selectedAgentId
                          ? null
                          : row.managed.agent.id
                      )
                    }
                  />
                ))}
              </div>
            )
          ) : (
            <div className="flex-1 overflow-y-auto">
              {dirLoading && dirListings.length === 0 ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : dirListings.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  {dirSearch ? t("noAgentsFound") : t("emptyDirectory")}
                </div>
              ) : (
                <>
                  {dirListings.map((listing) => (
                    <DirectoryItem
                      key={listing.id}
                      listing={listing}
                      connectionStatus={dirConnectionStatusMap.get(listing.agentId)}
                      isActive={listing.id === selectedListingId}
                      onClick={() => setSelectedListingId(listing.id)}
                    />
                  ))}
                  {dirHasMore && dirListings.length > 0 && (
                    <div className="flex justify-center py-3">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => fetchDirMore()}
                        disabled={dirLoadingMore}
                        className="text-xs"
                      >
                        {dirLoadingMore ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : null}
                        {t("common:loadMore")}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Agent detail panel — laps over the agent area as a rounded panel
          (like the conversation details pane), animating its width so the grid
          reflows beside it instead of being occluded by an overlay. Stays
          mounted (width 0 when closed) so it animates both ways; `displayAgent`
          keeps content visible through the close transition. */}
      <aside
        aria-hidden={!drawerOpen}
        className={cn(
          "surface-panel-strong relative z-20 -ml-3 h-full shrink-0 overflow-hidden rounded-l-lg bg-card",
          "transition-[width] duration-300 ease-out",
          drawerOpen ? "w-[760px] max-w-[70vw]" : "w-0"
        )}
      >
        <div className="h-full w-[760px] max-w-[70vw]">
          {displayAgent && <AgentConfig managed={displayAgent} />}
        </div>
      </aside>

      {/* Directory listing detail panel — same lapping treatment. */}
      <aside
        aria-hidden={!dirDrawerOpen}
        className={cn(
          "surface-panel-strong relative z-20 -ml-3 h-full shrink-0 overflow-hidden rounded-l-lg bg-card",
          "transition-[width] duration-300 ease-out",
          dirDrawerOpen ? "w-[600px] max-w-[60vw]" : "w-0"
        )}
      >
        <div className="h-full w-[600px] max-w-[60vw]">
          {displayListing && (
            <DirectoryAgentDetail
              key={displayListing.id}
              listing={displayListing}
              connection={selectedListingConnection}
              onConnect={(mode) => handleConnect(displayListing, mode)}
              onDisconnect={() =>
                selectedListingConnection &&
                handleDisconnect(selectedListingConnection.id)
              }
              onClose={() => setSelectedListingId(null)}
            />
          )}
        </div>
      </aside>

      {showCreate && (
        <CreateAgentModal onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}
