import { Fragment, useEffect, useState } from "react";
import { useAgentStore, type ManagedAgent } from "../stores/agentStore";
import { usePresenceStore } from "../stores/presenceStore";
import { AgentActivityIndicator } from "./AgentActivityIndicator";
import { formatModelLabel, formatBackendLabel } from "../lib/models";
import { AGENT_GRID_COLS, AGENT_CELL_ENGINE, AGENT_CELL_MODE } from "./agentTableLayout";
import { formatUptime, cn } from "../lib/utils";
import { Play, Square, RotateCcw, Crown, Cloud, AlertTriangle, Link2, ChevronRight, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  online,
}: {
  processStatus: ManagedAgent["processStatus"];
  presence: "online_local" | "offline" | undefined;
  online: boolean | undefined;
}) {
  const locallyRunning = processStatus === "running";
  const effective: "online_local" | "offline" =
    locallyRunning
      ? "online_local"
      : presence ?? (online ? "online_local" : "offline");

  return (
    <span
      className={cn(
        "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
        effective === "online_local" ? "bg-success" : "bg-muted-foreground"
      )}
      aria-label={effective === "online_local" ? "Online" : "Offline"}
    />
  );
}

function StatusBadge({
  status,
  uptimeSecs,
  presence,
  runtime,
}: {
  status: string;
  uptimeSecs: number | null;
  presence?: "online_local" | "offline";
  runtime?: "local" | "org_host";
}) {
  // Org-host runtime: the bridge runs on a remote VM, so processStatus
  // is always "stopped" on this device. The agent's real online state
  // comes from the backend's WS presence (presence !== "offline"
  // means a bridge is connected somewhere). Render an honest "Remote"
  // badge — "Stopped" would lie about the actual lifecycle.
  if (runtime === "org_host" && status === "stopped") {
    const remoteOnline = presence && presence !== "offline";
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
        {remoteOnline ? "Remote · online" : "Remote · offline"}
      </Badge>
    );
  }

  if (status === "running") {
    return (
      <Badge variant="outline" className="border-success/30 text-success bg-success/10 gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-success" />
        {uptimeSecs != null ? formatUptime(uptimeSecs) : "Running"}
      </Badge>
    );
  }
  if (status === "starting") {
    return (
      <Badge variant="outline" className="border-warning/30 text-warning bg-warning/10 gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
        Starting
      </Badge>
    );
  }
  if (status === "stalled") {
    return (
      <Badge variant="outline" className="border-warning/30 text-warning bg-warning/10 gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
        Stalled
      </Badge>
    );
  }
  if (status === "crashed") {
    return (
      <Badge variant="outline" className="border-destructive/30 text-destructive bg-destructive/10 gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-destructive" />
        Crashed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
      Stopped
    </Badge>
  );
}

// Surfaces non-healthy states inline beneath the status badge. "Healthy"
// is the expected state for a running agent and adds noise when shown.
// "Offline" while the local process is running is stale (the backend
// hasn't yet received the executor's 60s heartbeat) — suppressing it
// avoids the contradictory "Running 3s / offline" combo.
function HealthHint({
  health,
  processStatus,
}: {
  health: ManagedAgent["health"];
  processStatus: ManagedAgent["processStatus"];
}) {
  if (!health || health.healthStatus === "healthy") return null;
  if (health.healthStatus === "offline" && processStatus === "running") {
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
  const [error, setError] = useState<string | null>(null);

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
        await startAgent(managed.agent.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
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
      : "No API key — open agent to generate one";
  const canStart =
    startBlockedReason === null && managed.processStatus !== "starting";
  const modelLabel =
    formatModelLabel(managed.config.model) ||
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
              presence={managed.agent.presence}
              online={managed.agent.online}
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
        <div>
          {error ? (
            <span className="text-xs text-destructive truncate block" title={error}>
              {error.slice(0, 25)}...
            </span>
          ) : (
            <div className="flex flex-col gap-0.5">
              <StatusBadge
                status={managed.processStatus}
                uptimeSecs={liveUptimeSecs}
                presence={managed.agent.presence}
                runtime={managed.agent.runtime}
              />
              <HealthHint health={managed.health} processStatus={managed.processStatus} />
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

    </div>
  );
}
