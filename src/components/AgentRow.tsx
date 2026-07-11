import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentStore, type ManagedAgent } from "../stores/agentStore";
import { usePresenceStore } from "../stores/presenceStore";
import { AgentActivityIndicator } from "./AgentActivityIndicator";
import { formatBackendLabel } from "../lib/models";
import { useModelCatalog } from "../stores/modelCatalogStore";
import { AGENT_GRID_COLS, AGENT_CELL_ENGINE, AGENT_CELL_MODE, AGENT_CELL_STATUS } from "./agentTableLayout";
import { formatUptime, cn } from "../lib/utils";
import { Play, Power, Square, RotateCcw, Crown, Cloud, AlertTriangle, KeyRound, Laptop, Link2, ChevronRight, ChevronDown, Loader2 } from "lucide-react";
import { restartHostedAgents, forceResetAgent } from "../lib/api";
import { runningElsewhereOn, useLocalDeviceName } from "../hooks/useRunningElsewhere";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const ACTIVITY_COLORS = {
  idle: "",
  thinking: "text-warning",
  streaming: "text-success",
  tool: "text-violet-500",
  sending: "text-cyan-500",
  error: "text-destructive",
};

const ACTIVITY_DOT_COLORS = {
  idle: "",
  thinking: "bg-warning",
  streaming: "bg-success",
  tool: "bg-violet-500",
  sending: "bg-cyan-500",
  error: "bg-destructive",
};

// Small overlay dot on the avatar that mirrors the conversation list
// pattern. `processStatus === "running"` is locally known the moment
// the desktop kicks off the agent, so we trust it ahead of the WS
// presence flag (which can lag ~60s on the executor heartbeat).
function PresenceDot({
  processStatus,
  presence,
}: {
  processStatus: ManagedAgent["processStatus"];
  presence: "online_local" | "offline";
}) {
  const { t } = useTranslation("agents");
  const locallyRunning = processStatus === "running";
  const effective: "online_local" | "offline" = locallyRunning
    ? "online_local"
    : presence;

  return (
    <span
      className={cn(
        "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
        effective === "online_local" ? "bg-success" : "bg-muted-foreground"
      )}
      aria-label={effective === "online_local" ? t("common:online") : t("common:offline")}
    />
  );
}

function StatusBadge({
  status,
  uptimeSecs,
  presence,
  runtime,
  waking,
  deviceName,
}: {
  status: string;
  uptimeSecs: number | null;
  presence?: "online_local" | "offline";
  runtime?: "local" | "org_host";
  waking?: boolean;
  /** Machine the agent's bridge reported it is running on (when online). */
  deviceName?: string | null;
}) {
  const { t } = useTranslation("agents");
  // Org-host runtime: the bridge runs on a remote VM, so processStatus
  // is always "stopped" on this device. The agent's real online state
  // comes from the backend's WS presence (presence !== "offline"
  // means a bridge is connected somewhere). Render an honest "Remote"
  // badge — "Stopped" would lie about the actual lifecycle.
  if (runtime === "org_host" && status === "stopped") {
    const remoteOnline = presence && presence !== "offline";
    // A restart we asked for is in flight — show progress so the action
    // doesn't look like it did nothing while the bridge respawns.
    if (waking && !remoteOnline) {
      return (
        <Badge variant="outline" className="border-warning/30 text-warning bg-warning/10 gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" />
          {t("row.bringingOnline")}
        </Badge>
      );
    }
    return (
      <Badge
        variant="outline"
        className={cn(
          "gap-1.5",
          remoteOnline
            ? "border-info/30 text-info bg-info/10"
            : "border-muted text-muted-foreground bg-muted/30"
        )}
      >
        <Cloud className="w-3 h-3" />
        {remoteOnline ? t("row.remoteOnline") : t("row.remoteOffline")}
      </Badge>
    );
  }

  // Local-runtime agent with no process on THIS machine but a live bridge
  // somewhere — it's running on another of the user's devices. Say where,
  // instead of showing "Stopped" next to a green presence dot (which read
  // as "running locally *here*" and confused everyone).
  if (runtime !== "org_host" && status === "stopped" && presence === "online_local") {
    return (
      <Badge
        variant="outline"
        className="border-info/30 text-info bg-info/10 gap-1.5"
        title={
          deviceName
            ? t("row.runningOnDeviceHint", { device: deviceName })
            : t("row.runningOnOtherDevice")
        }
      >
        <Laptop className="w-3 h-3" />
        {deviceName ? t("row.onDevice", { device: deviceName }) : t("row.onAnotherDevice")}
      </Badge>
    );
  }

  if (status === "running") {
    return (
      <Badge variant="outline" className="border-success/30 text-success bg-success/10 gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-success" />
        {uptimeSecs != null ? formatUptime(uptimeSecs) : t("status.running")}
      </Badge>
    );
  }
  if (status === "starting") {
    return (
      <Badge variant="outline" className="border-warning/30 text-warning bg-warning/10 gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
        {t("row.starting")}
      </Badge>
    );
  }
  if (status === "stalled") {
    return (
      <Badge variant="outline" className="border-warning/30 text-warning bg-warning/10 gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
        {t("row.stalled")}
      </Badge>
    );
  }
  if (status === "crashed") {
    return (
      <Badge variant="outline" className="border-destructive/30 text-destructive bg-destructive/10 gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-destructive" />
        {t("row.crashed")}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
      {t("row.stopped")}
    </Badge>
  );
}

// Surfaces non-healthy states inline beneath the status badge. "Healthy"
// is the expected state for a running agent and adds noise when shown.
// "Offline" is suppressed whenever we KNOW the agent is up — local process
// running, or live WS presence says online (e.g. running on another
// machine). The health snapshot refreshes on a slow poll, so after a
// presence flip it can lag and would otherwise sit contradicting the
// "Running 3s" / "On Jamess-MacBook" badge right above it.
function HealthHint({
  health,
  processStatus,
  online,
}: {
  health: ManagedAgent["health"];
  processStatus: ManagedAgent["processStatus"];
  /** Live WS presence — fresher than the polled health snapshot. */
  online: boolean;
}) {
  if (!health || health.healthStatus === "healthy") return null;
  if (
    health.healthStatus === "offline" &&
    (processStatus === "running" || online)
  ) {
    return null;
  }
  const colors: Record<string, string> = {
    degraded: "text-warning",
    stuck: "text-warning",
    offline: "text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "text-[10px] capitalize leading-tight",
        colors[health.healthStatus] || "text-muted-foreground"
      )}
    >
      {health.healthStatus}
    </span>
  );
}

/** Indent width per ownership-tree level, in px. */
const TREE_INDENT = 22;

/** File-tree connector lines for one row, drawn as a full-row-height overlay.
 *  `parentLines[i]` draws a vertical continuation in column i; the final
 *  column is an elbow (├ when the row has siblings below, └ when last).
 *  `drawStem` adds a line down into this row's own expanded children. */
function TreeLines({
  depth,
  isLast,
  parentLines,
  drawStem,
}: {
  depth: number;
  isLast: boolean;
  parentLines: boolean[];
  drawStem: boolean;
}) {
  if (depth === 0 && !drawStem) return null;

  return (
    <div className="pointer-events-none absolute inset-y-0 left-4">
      {Array.from({ length: depth }).map((_, i) => {
        const x = i * TREE_INDENT + 11;
        if (i === depth - 1) {
          return (
            <Fragment key={i}>
              <div className="absolute top-0 w-px bg-border" style={{ left: x, height: "50%" }} />
              {!isLast && (
                <div className="absolute bottom-0 w-px bg-border" style={{ left: x, top: "50%" }} />
              )}
              <div className="absolute h-px bg-border" style={{ left: x, top: "50%", width: 11 }} />
            </Fragment>
          );
        }
        return parentLines[i] ? (
          <div key={i} className="absolute inset-y-0 w-px bg-border" style={{ left: x }} />
        ) : null;
      })}
      {drawStem && (
        <div
          className="absolute bottom-0 w-px bg-border"
          style={{ left: depth * TREE_INDENT + 11, top: "50%" }}
        />
      )}
    </div>
  );
}

export function AgentRow({
  managed,
  selected,
  onSelect,
  depth = 0,
  isLast = true,
  parentLines = [],
  hasChildren = false,
  expanded = false,
  childCount = 0,
  onToggleExpand,
}: {
  managed: ManagedAgent;
  selected: boolean;
  onSelect: () => void;
  /** Nesting depth in the ownership tree — 0 for top-level agents, 1+ for
   *  sub-agents. Drives the connector indent. */
  depth?: number;
  /** Whether this row is the last child of its parent (└ vs ├). */
  isLast?: boolean;
  /** Per ancestor level, whether a vertical continuation line is drawn. */
  parentLines?: boolean[];
  /** Whether this agent has sub-agents (shows the expand chevron). */
  hasChildren?: boolean;
  /** Whether this agent's sub-agents are currently expanded. */
  expanded?: boolean;
  /** Number of direct sub-agents (for the chevron tooltip). */
  childCount?: number;
  onToggleExpand?: () => void;
}) {
  const { startAgent, stopAgent } = useAgentStore();
  const activity = useAgentStore(
    (s) => s.activities[managed.agent.id] ?? null
  );
  // Global activity broadcast by the backend (thinking/working/writing).
  // Covers agents that aren't running locally — remote / org-host agents,
  // and the "busy on a task between streaming bursts" case the local
  // bridge-log activity misses.
  const globalActivity = usePresenceStore(
    (s) => s.agentActivity[managed.agent.id]
  );
  // Whether a "bring online" restart we requested for this agent is in flight
  // (shared across the row + the bulk button via the presence store).
  const waking = usePresenceStore((s) => s.wakingAgents.has(managed.agent.id));
  // Live presence + device from presenceStore — the single runtime presence
  // truth (WS events + authoritative presence_snapshot). REST agent.online/
  // presence/deviceName are point-in-time and never read for liveness.
  const liveOnline = usePresenceStore((s) => s.online.has(managed.agent.id));
  const livePresence: "online_local" | "offline" = liveOnline
    ? "online_local"
    : "offline";
  const presenceDevice = usePresenceStore(
    (s) => s.agentDevices[managed.agent.id]
  );
  const deviceName = presenceDevice ?? null;
  const myDevice = useLocalDeviceName();
  const markWaking = usePresenceStore((s) => s.markWaking);
  const [error, setError] = useState<string | null>(null);
  // Take-over confirmation: the agent's bridge is alive on ANOTHER of the
  // user's machines, so starting here stops it there. null = no dialog;
  // "" = running elsewhere but the device name is unknown.
  const [confirmMoveFrom, setConfirmMoveFrom] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  const isRunning = managed.processStatus === "running";

  // Live-tick uptime locally instead of waiting for the 60s
  // refreshProcessStatuses poll, so the status badge actually advances
  // from "0s" the moment the agent starts. `startedAt` is set by the
  // store when the desktop kicks off the agent; for agents started on
  // another device we fall back to the server-reported `uptimeSecs`.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!isRunning || managed.startedAt == null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRunning, managed.startedAt]);
  const liveUptimeSecs =
    isRunning && managed.startedAt != null
      ? Math.max(0, Math.floor((now - managed.startedAt) / 1000))
      : managed.uptimeSecs;

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setError(null);
    try {
      if (isRunning) {
        await stopAgent(managed.agent.id);
      } else {
        // The bridge is alive on another of the user's machines — starting
        // here takes the agent over and stops it there. Confirm first.
        const elsewhere = runningElsewhereOn(managed, liveOnline, presenceDevice, myDevice);
        if (elsewhere !== null) {
          setConfirmMoveFrom(elsewhere);
          return;
        }
        await startAgent(managed.agent.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  };

  // Confirmed take-over: shut the other machine's bridge down first (the
  // backend pushes a shutdown command to it over WS and re-queues its
  // in-flight work), then start locally — so the agent never runs on two
  // computers at once.
  const handleConfirmMove = async () => {
    setMoving(true);
    setError(null);
    try {
      await forceResetAgent(managed.agent.id);
      await startAgent(managed.agent.id);
      setConfirmMoveFrom(null);
    } catch (err) {
      setConfirmMoveFrom(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMoving(false);
    }
  };

  // Hosted agents have no local process — "bring online" asks the server to
  // restart the bridge on its host. We optimistically mark it waking so the
  // row spins immediately; the presence store clears it when the agent reports
  // online (or after a safety timeout).
  const remoteOnline = liveOnline;
  const handleBringOnline = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setError(null);
    markWaking([managed.agent.id]);
    try {
      await restartHostedAgents([managed.agent.id]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Reasons the start action can't fire. Surfaced as a warning icon in
  // place of the play button so the user sees something is wrong without
  // clicking through. `starting` is transient and already reflected in the
  // Status column — not a true blocker.
  // A spawned sub-agent is started and retired by its parent agent's bridge,
  // never run from the desktop app — so it intentionally has no local API key
  // and no run/stop control here.
  const isSpawned = !!managed.agent.spawn;
  // An org-host agent's bridge runs on the shared org VM, not this desktop —
  // so there's no local subprocess to start/stop and no local API key to
  // generate. The Actions cell shows a passive "managed on org host" hint
  // instead of a play button or the (always-missing) API-key warning.
  const isOrgHost = managed.agent.runtime === "org_host";
  const startBlockedReason: string | null =
    isOrgHost || managed.apiKey
      ? null
      : "No API key on this computer — the agent was set up on another device. Open it to generate a new key.";
  const canStart =
    startBlockedReason === null && managed.processStatus !== "starting";
  // Model label comes from the backend catalog (single source of truth) so it
  // never drifts from what the model dropdown offers; fall back to the raw id.
  const catalogModelLabel = useModelCatalog((s) => s.modelLabel);
  const modelLabel =
    catalogModelLabel(managed.config.model, managed.config.backend) ||
    managed.config.model;
  const backendLabel = formatBackendLabel(managed.config.backend);

  return (
    <div
      className={cn(
        "relative cursor-pointer border-b border-border last:border-b-0 transition-colors",
        selected ? "bg-surface-active" : "hover:bg-surface-hover"
      )}
      onClick={onSelect}
    >
      <TreeLines
        depth={depth}
        isLast={isLast}
        parentLines={parentLines}
        drawStem={hasChildren && expanded}
      />
      {/* Main row */}
      <div className={cn(AGENT_GRID_COLS, "gap-3 pl-4 pr-8 py-2.5 items-center")}>
        {/* Agent */}
        <div
          className="flex items-center gap-2.5 min-w-0"
          style={{ paddingLeft: depth * TREE_INDENT }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand?.();
              }}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              title={
                expanded
                  ? "Collapse sub-agents"
                  : `Expand ${childCount} sub-agent${childCount === 1 ? "" : "s"}`
              }
            >
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
          ) : (
            <span className="h-5 w-5 shrink-0" />
          )}
          <div className="relative shrink-0">
            <Avatar className="h-8 w-8 rounded-lg">
              {managed.agent.avatarUrl && <AvatarImage src={managed.agent.avatarUrl} className="rounded-lg" displaySize={32} />}
              <AvatarFallback className="rounded-lg bg-primary/10 text-primary text-xs font-semibold">
                {managed.agent.displayName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <PresenceDot
              processStatus={managed.processStatus}
              presence={livePresence}
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <p className="text-sm font-medium truncate flex-shrink-0">
                {managed.agent.displayName}
              </p>
              {managed.agent.agentType === "orchestrator" && (
                <Crown className="h-3 w-3 text-primary flex-shrink-0" />
              )}
              {managed.agent.agentType && !["worker", "orchestrator"].includes(managed.agent.agentType) && (
                <Badge
                  variant="secondary"
                  className={cn(
                    "text-[10px] px-1.5 py-0 flex-shrink-0",
                    managed.agent.agentType === "reviewer" && "bg-warning/10 text-warning border-warning/20",
                    managed.agent.agentType === "observer" && "bg-cyan-500/10 text-cyan-500 border-cyan-500/20"
                  )}
                >
                  {managed.agent.agentType}
                </Badge>
              )}
              {isSpawned && (
                <Badge
                  variant="secondary"
                  className="text-[10px] px-1.5 py-0 flex-shrink-0 bg-primary/10 text-primary border-primary/20"
                  title={managed.agent.spawn?.purpose || "Spawned sub-agent"}
                >
                  Sub-agent
                </Badge>
              )}
              {hasChildren && !expanded && (
                <Badge
                  variant="secondary"
                  className="text-[10px] px-1.5 py-0 flex-shrink-0 bg-muted text-muted-foreground border-transparent"
                  title={`${childCount} sub-agent${childCount === 1 ? "" : "s"} — expand to view`}
                >
                  {childCount} sub-agent{childCount === 1 ? "" : "s"}
                </Badge>
              )}
              {isRunning && activity ? (
                <span className={cn(
                  "flex items-center gap-1.5 text-[11px] font-medium truncate",
                  ACTIVITY_COLORS[activity.type]
                )}>
                  <span className={cn(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    activity.type !== "idle" && "animate-pulse",
                    ACTIVITY_DOT_COLORS[activity.type]
                  )} />
                  <span className="truncate">{activity.label}</span>
                </span>
              ) : globalActivity ? (
                // Fallback to the server's global activity when there's no
                // richer local bridge-log activity (remote/org-host agents).
                <AgentActivityIndicator activity={globalActivity} />
              ) : null}
            </div>
            {managed.agent.description && (
              <p className="text-xs text-muted-foreground truncate">
                {managed.agent.description}
              </p>
            )}
          </div>
        </div>

        {/* Engine — backend + model on two lines so the row stays compact.
            Hidden when the list is narrow (e.g. detail pane open); the engine
            is still shown inside the detail pane. */}
        <div className={cn(AGENT_CELL_ENGINE, "min-w-0 leading-tight")}>
          <div className="text-xs text-foreground/90 truncate">{modelLabel || "—"}</div>
          {backendLabel && (
            <div className="text-[10px] text-muted-foreground truncate">{backendLabel}</div>
          )}
        </div>

        {/* Runtime — Local subprocess vs. org-host VM. Lets the user
            see at a glance whether the agent runs on this device or on
            a shared org host (set in AgentConfig → Runtime). Drops out
            first when the list narrows. */}
        <div className={cn(AGENT_CELL_MODE, "truncate")}>
          {managed.agent.runtime === "org_host" ? (
            <Badge
              variant="outline"
              className="border-info/30 text-info bg-info/10 gap-1.5"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-info" />
              Hosted
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="border-success/30 text-success bg-success/10 gap-1.5"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              Local
            </Badge>
          )}
        </div>

        {/* Status (+ health hint when non-healthy) */}
        <div className={AGENT_CELL_STATUS}>
          {error ? (
            <span className="text-xs text-destructive truncate block" title={error}>
              {error.slice(0, 25)}...
            </span>
          ) : (
            <div className="flex flex-col gap-0.5">
              <StatusBadge
                status={managed.processStatus}
                uptimeSecs={liveUptimeSecs}
                presence={livePresence}
                runtime={managed.agent.runtime}
                waking={waking}
                deviceName={deviceName}
              />
              <HealthHint
                health={managed.health}
                processStatus={managed.processStatus}
                online={remoteOnline}
              />
              {managed.processStatus === "crashed" && managed.crashReason && (
                <span
                  className="text-[10px] text-destructive/80 line-clamp-2 block leading-tight"
                  title={managed.crashReason}
                >
                  {managed.crashReason.length > 80
                    ? managed.crashReason.slice(0, 80) + "…"
                    : managed.crashReason}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          {isSpawned ? (
            <TooltipProvider delay={150}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="flex h-7 w-7 items-center justify-center text-muted-foreground/50">
                      <Link2 className="w-4 h-4" />
                    </span>
                  }
                />
                <TooltipContent side="left" className="text-xs">
                  Sub-agent — started and retired by its parent agent
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : isOrgHost ? (
            waking ? (
              <span
                className="flex h-7 w-7 items-center justify-center text-warning"
                title="Bringing online…"
              >
                <Loader2 className="w-4 h-4 animate-spin" />
              </span>
            ) : remoteOnline ? (
              <TooltipProvider delay={150}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className="flex h-7 w-7 items-center justify-center text-muted-foreground/50">
                        <Cloud className="w-4 h-4" />
                      </span>
                    }
                  />
                  <TooltipContent side="left" className="text-xs">
                    Runs on the org host — started and stopped there, not from this device
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              // Offline hosted agent — let the owner restart its bridge on the
              // host (the hosted equivalent of the local Play button).
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-info hover:text-info/90"
                onClick={handleBringOnline}
                title="Bring online (restart bridge on its host)"
              >
                <Power className="w-4 h-4" />
              </Button>
            )
          ) : managed.processStatus === "crashed" &&
            (managed.crashKind === "auth" || managed.crashKind === "no_key") ? (
            // Restarting would just crash again on the same bad key — send
            // the user to the fix (the key panel in the agent's settings).
            <TooltipProvider delay={150}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-warning hover:text-warning/90"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect();
                      }}
                    >
                      <KeyRound className="w-4 h-4" />
                    </Button>
                  }
                />
                <TooltipContent side="left" className="text-xs">
                  API key problem — open the agent to generate a new key for
                  this computer
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : managed.processStatus === "crashed" ? (
            <Button variant="ghost" size="icon-sm" className="text-warning hover:text-warning/90" onClick={handleToggle} title="Restart">
              <RotateCcw className="w-4 h-4" />
            </Button>
          ) : isRunning ? (
            <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive/90" onClick={handleToggle} title="Stop">
              <Square className="w-3.5 h-3.5" />
            </Button>
          ) : startBlockedReason ? (
            <TooltipProvider delay={150}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-warning hover:text-warning/90"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect();
                      }}
                    >
                      <AlertTriangle className="w-4 h-4" />
                    </Button>
                  }
                />
                <TooltipContent side="left" className="text-xs">
                  {startBlockedReason}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <Button variant="ghost" size="icon-sm" className="text-success hover:text-success/90" onClick={handleToggle} disabled={!canStart} title="Start">
              <Play className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Take-over confirmation — the agent is live on another machine and
          an agent can only run on one computer at a time. Confirming shuts
          the other bridge down (backend-pushed command) before starting
          here, so the move is clean instead of two bridges fighting. */}
      <Dialog
        open={confirmMoveFrom !== null}
        onOpenChange={(open) => {
          if (!open && !moving) setConfirmMoveFrom(null);
        }}
      >
        <DialogContent
          className="max-w-md"
          onClick={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>
              Move {managed.agent.displayName} to this computer?
            </DialogTitle>
            <DialogDescription className="space-y-2 pt-1">
              <span className="block">
                {managed.agent.displayName} is currently running on{" "}
                {confirmMoveFrom ? (
                  <span className="font-medium text-foreground">
                    “{confirmMoveFrom}”
                  </span>
                ) : (
                  "another computer"
                )}
                . An agent can only run on one computer at a time — starting
                it here will stop it there first.
              </span>
              <span className="block">
                Anything it's working on is put back in its queue and picked
                up once it's running here. You can move it back anytime by
                starting it from the other computer.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmMoveFrom(null)}
              disabled={moving}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirmMove} disabled={moving}>
              {moving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Moving…
                </>
              ) : confirmMoveFrom ? (
                `Stop on ${confirmMoveFrom} & start here`
              ) : (
                "Stop it there & start here"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
