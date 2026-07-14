import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentStore, type ManagedAgent } from "../stores/agentStore";
import { usePresenceStore } from "../stores/presenceStore";
import { AgentActivityIndicator } from "./AgentActivityIndicator";
import { useModelCatalog } from "../stores/modelCatalogStore";
import { formatBackendLabel } from "../lib/models";
import { cn } from "../lib/utils";
import { Crown, Cloud, Laptop, Link2, ChevronRight, ChevronDown, Loader2 } from "lucide-react";
import { restartHostedAgents, forceResetAgent } from "../lib/api";
import { runningElsewhereOn, useLocalDeviceName } from "../hooks/useRunningElsewhere";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgentPowerButton } from "@/components/ui/agent-power-button";
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
  const { t } = useTranslation("agents");
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
  // Raw hostname — what runningElsewhereOn compares against THIS machine's
  // name. presenceDevice above is the display label (nickname when set).
  const presenceHostname = usePresenceStore(
    (s) => s.agentDeviceHostnames[managed.agent.id]
  );
  const myDevice = useLocalDeviceName();
  const markWaking = usePresenceStore((s) => s.markWaking);
  // Take-over confirmation: the agent's bridge is alive on ANOTHER of the
  // user's machines, so starting here stops it there. null = no dialog;
  // "" = running elsewhere but the device name is unknown.
  const [confirmMoveFrom, setConfirmMoveFrom] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  const isRunning = managed.processStatus === "running";

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (isRunning) {
        await stopAgent(managed.agent.id);
      } else {
        // The bridge is alive on another of the user's machines — starting
        // here takes the agent over and stops it there. Confirm first.
        const elsewhere = runningElsewhereOn(managed, liveOnline, presenceHostname, myDevice, presenceDevice);
        if (elsewhere !== null) {
          setConfirmMoveFrom(elsewhere);
          return;
        }
        await startAgent(managed.agent.id);
      }
    } catch {
      // Start/stop failures surface in the detail pane (crash reason / status);
      // the compact list row stays quiet.
    }
  };

  // Confirmed take-over: shut the other machine's bridge down first (the
  // backend pushes a shutdown command to it over WS and re-queues its
  // in-flight work), then start locally — so the agent never runs on two
  // computers at once.
  const handleConfirmMove = async () => {
    setMoving(true);
    try {
      await forceResetAgent(managed.agent.id);
      await startAgent(managed.agent.id);
      setConfirmMoveFrom(null);
    } catch {
      setConfirmMoveFrom(null);
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
    markWaking([managed.agent.id]);
    try {
      await restartHostedAgents([managed.agent.id]);
    } catch {
      // Surfaced in the detail pane; the list row stays quiet.
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
  // A missing local `ak_` key is NOT a start blocker: startAgent mints an
  // owner delegation token for agents created elsewhere (phone/web/another
  // desktop), so an owned local agent runs fine here without a "generate a
  // key" detour. We therefore let "Bring online" attempt the start; a genuine
  // auth failure lands in the actionable `no_key` crashed state below. The
  // only pre-start gate left is the transient "starting" status.
  const canStart = managed.processStatus !== "starting";
  // Model label comes from the backend catalog (single source of truth) so it
  // never drifts from what the model dropdown offers; fall back to the raw id.
  const catalogModelLabel = useModelCatalog((s) => s.modelLabel);
  const modelLabel =
    catalogModelLabel(managed.config.model, managed.config.backend) ||
    managed.config.model;
  // Provider/engine label (Claude Code, Anthropic API, OpenAI Codex, …) shown
  // in the row meta line beside the runtime + model.
  const backendLabel = formatBackendLabel(managed.config.backend);

  // Explicit status beyond the avatar dot — a labeled pill by the name.
  // Locally-running is known instantly; otherwise WS presence is the truth
  // (covers org-host + agents running on another device).
  const isOnline = isRunning || liveOnline;
  const status: "crashed" | "starting" | "online" | "offline" =
    managed.processStatus === "crashed"
      ? "crashed"
      : managed.processStatus === "starting" || waking
        ? "starting"
        : isOnline
          ? "online"
          : "offline";
  const STATUS_META = {
    online: { label: t("common:online"), cls: "border-success/30 bg-success/10 text-success" },
    offline: { label: t("common:offline"), cls: "border-border bg-muted/40 text-muted-foreground" },
    starting: { label: t("row.starting"), cls: "border-warning/30 bg-warning/10 text-warning" },
    crashed: { label: t("row.crashed"), cls: "border-destructive/30 bg-destructive/10 text-destructive" },
  }[status];

  return (
    <div
      className={cn(
        "@container relative cursor-pointer border-b border-border last:border-b-0 transition-colors",
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
      {/* Compact list card: avatar + presence, name/badges/activity, and a
          runtime + model meta line — with the power action as a trailing
          icon button. Full status/health lives in the detail pane; the list
          stays scannable. */}
      <div
        className="flex items-center gap-2.5 py-2.5 pl-3 pr-3"
        style={depth > 0 ? { paddingLeft: 12 + depth * TREE_INDENT } : undefined}
      >
        {/* Chevron column — only reserved for rows that can expand or are
            nested (sub-agents need it for tree alignment). A flat list of
            top-level agents skips it so the avatar isn't pushed right. */}
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
        ) : depth > 0 ? (
          <span className="h-5 w-5 shrink-0" />
        ) : null}

        <div className="relative shrink-0">
          <Avatar className="h-9 w-9 rounded-lg">
            {managed.agent.avatarUrl && <AvatarImage src={managed.agent.avatarUrl} className="rounded-lg" displaySize={36} />}
            <AvatarFallback className="rounded-lg bg-primary/10 text-primary text-xs font-semibold">
              {managed.agent.displayName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <PresenceDot
            processStatus={managed.processStatus}
            presence={livePresence}
          />
        </div>

        <div className="min-w-0 flex-1">
          {/* Name + status + badges */}
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-medium truncate">
              {managed.agent.displayName}
            </span>
            <span
              className={cn(
                "shrink-0 inline-flex items-center gap-1 rounded-full border px-1.5 py-0 text-[9px] font-medium uppercase tracking-wide",
                STATUS_META.cls
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  status === "online" && "bg-success",
                  status === "offline" && "bg-muted-foreground/50",
                  status === "starting" && "bg-warning animate-pulse",
                  status === "crashed" && "bg-destructive"
                )}
              />
              {STATUS_META.label}
            </span>
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
                {childCount}
              </Badge>
            )}
          </div>

          {/* Second line: live activity (local bridge first, else global). */}
          {isRunning && activity ? (
            <div className={cn("mt-0.5 flex items-center gap-1.5 text-[11px] font-medium min-w-0", ACTIVITY_COLORS[activity.type])}>
              <span className={cn(
                "w-1.5 h-1.5 rounded-full shrink-0",
                activity.type !== "idle" && "animate-pulse",
                ACTIVITY_DOT_COLORS[activity.type]
              )} />
              <span className="truncate">{activity.label}</span>
            </div>
          ) : globalActivity ? (
            <div className="mt-0.5"><AgentActivityIndicator activity={globalActivity} /></div>
          ) : null}

          {/* Meta line: runtime chip · provider · model. */}
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground min-w-0">
            <span className="inline-flex shrink-0 items-center gap-1">
              {managed.agent.runtime === "org_host" ? (
                <>
                  <Cloud className="h-3 w-3 text-info" />
                  Hosted
                </>
              ) : (
                <>
                  <Laptop className="h-3 w-3 text-success" />
                  Local
                </>
              )}
            </span>
            {backendLabel && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="shrink-0">{backendLabel}</span>
              </>
            )}
            {modelLabel && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="truncate font-mono text-[9px]">{modelLabel}</span>
              </>
            )}
          </div>
        </div>

        {/* Power action — icon-only in the compact list; full detail lives in
            the pane. Clicks don't bubble to row selection. */}
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
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
              <AgentPowerButton
                state="bring-online"
                label={t("row.bringingOnline")}
                busy
              outlined
              labelClassName="hidden @min-[340px]:inline"
              />
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
              // Offline hosted agent — restart its bridge on the host. Same
              // "Bring online" control as a local agent so the action reads
              // identically regardless of where the agent runs.
              <AgentPowerButton
                state="bring-online"
                label={t("row.bringOnline")}
                onClick={handleBringOnline}
              outlined
              labelClassName="hidden @min-[340px]:inline"
              />
            )
          ) : managed.processStatus === "crashed" &&
            (managed.crashKind === "auth" || managed.crashKind === "no_key") ? (
            // Restarting would just crash again on the same bad key — the
            // warning state routes to the fix (the key panel in the agent's
            // settings) rather than retrying.
            <AgentPowerButton
              state="warning"
              label={t("row.fixIssue")}
              tooltip={t("row.crashKeyHint")}
              outlined
              labelClassName="hidden @min-[340px]:inline"
              onClick={(e) => {
                e.stopPropagation();
                onSelect();
              }}
            />
          ) : managed.processStatus === "crashed" ? (
            <AgentPowerButton
              state="warning"
              label={t("row.restart")}
              onClick={handleToggle}
              outlined
              labelClassName="hidden @min-[340px]:inline"
            />
          ) : isRunning ? (
            <AgentPowerButton
              state="take-offline"
              label={t("row.takeOffline")}
              onClick={handleToggle}
              outlined
              labelClassName="hidden @min-[340px]:inline"
            />
          ) : (
            <AgentPowerButton
              state="bring-online"
              label={t("row.bringOnline")}
              onClick={handleToggle}
              disabled={!canStart}
              outlined
              labelClassName="hidden @min-[340px]:inline"
            />
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
