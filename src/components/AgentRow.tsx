import { useEffect, useState } from "react";
import { useAgentStore, type ManagedAgent } from "../stores/agentStore";
import { formatModelLabel, formatBackendLabel } from "../lib/models";
import { formatUptime, cn } from "../lib/utils";
import { Play, Square, RotateCcw, Crown, Cloud, AlertTriangle, Link2 } from "lucide-react";
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

// Mirrors the AgentConfig hosted-mode picker labels but truncated for
// the row's narrow column. "—" when hosted execution isn't applicable
// (no target backend resolved server-side).
function hostedModeLabel(
  mode: "local_only" | "auto" | "hosted_only" | undefined,
  target: string | null | undefined
): string {
  if (!target) return "—";
  switch (mode ?? "local_only") {
    case "auto":
      return "Local + Cloud";
    case "hosted_only":
      return "Cloud only";
    case "local_only":
    default:
      return "Local";
  }
}

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
  presence: "online_local" | "online_hosted" | "offline" | undefined;
  online: boolean | undefined;
}) {
  const locallyRunning = processStatus === "running";
  const effective: "online_local" | "online_hosted" | "offline" =
    locallyRunning
      ? "online_local"
      : presence ?? (online ? "online_local" : "offline");

  if (effective === "online_hosted") {
    return (
      <span
        className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full border-2 border-card bg-sky-500"
        aria-label="Cloud"
      >
        <Cloud className="h-1.5 w-1.5 text-white" />
      </span>
    );
  }

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
}: {
  status: string;
  uptimeSecs: number | null;
  presence?: "online_local" | "online_hosted" | "offline";
}) {
  // A `hosted_only` agent will sit at processStatus=stopped on this
  // machine forever — that's by design. Showing "Stopped" implies
  // something's broken, when really the agent is happily running
  // server-side. Override the badge so the desktop owner sees the
  // honest state.
  if (status === "stopped" && presence === "online_hosted") {
    return (
      <Badge variant="outline" className="border-info/30 text-info bg-info/10 gap-1.5">
        <Cloud className="w-3 h-3" />
        Cloud
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

export function AgentRow({
  managed,
  selected,
  onSelect,
}: {
  managed: ManagedAgent;
  selected: boolean;
  onSelect: () => void;
}) {
  const { startAgent, stopAgent } = useAgentStore();
  const activity = useAgentStore(
    (s) => s.activities[managed.agent.id] ?? null
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
  const startBlockedReason: string | null = !managed.apiKey
    ? "No API key — open agent to generate one"
    : null;
  const canStart =
    startBlockedReason === null && managed.processStatus !== "starting";
  const modelLabel =
    formatModelLabel(managed.config.model) ||
    managed.config.model;
  const backendLabel = formatBackendLabel(managed.config.backend);

  return (
    <div
      className={cn(
        "cursor-pointer border-b border-border last:border-b-0 transition-colors",
        selected ? "bg-primary/5" : "hover:bg-muted/50"
      )}
      onClick={onSelect}
    >
      {/* Main row */}
      <div className="grid grid-cols-[1fr_180px_140px_140px_56px] gap-3 px-4 py-2.5 items-center">
        {/* Agent */}
        <div className="flex items-center gap-2.5 min-w-0">
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
              {isRunning && activity && (
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
              )}
            </div>
            {managed.agent.description && (
              <p className="text-xs text-muted-foreground truncate">
                {managed.agent.description}
              </p>
            )}
          </div>
        </div>

        {/* Engine — backend + model on two lines so the row stays compact */}
        <div className="min-w-0 leading-tight">
          <div className="text-xs text-foreground/90 truncate">{modelLabel || "—"}</div>
          {backendLabel && (
            <div className="text-[10px] text-muted-foreground truncate">{backendLabel}</div>
          )}
        </div>

        {/* Hosted */}
        <div className="truncate">
          {managed.agent.hostedTargetBackend && managed.agent.hostedMode === "hosted_only" ? (
            <Badge
              variant="outline"
              className="border-info/30 text-info bg-info/10 gap-1.5"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-info" />
              Cloud only
            </Badge>
          ) : managed.agent.hostedTargetBackend && managed.agent.hostedMode === "auto" ? (
            <Badge
              variant="outline"
              className="border-info/30 text-info bg-info/10 gap-1.5"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-info" />
              Local + Cloud
            </Badge>
          ) : managed.agent.hostedTargetBackend &&
            (managed.agent.hostedMode ?? "local_only") === "local_only" ? (
            <Badge
              variant="outline"
              className="border-success/30 text-success bg-success/10 gap-1.5"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              Local
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">
              {hostedModeLabel(managed.agent.hostedMode, managed.agent.hostedTargetBackend)}
            </span>
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
