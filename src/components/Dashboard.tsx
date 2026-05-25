import { useEffect, useRef, useState } from "react";
import { useAgentStore, type ManagedAgent } from "../stores/agentStore";
import { AgentRow } from "./AgentRow";
import { AgentConfig } from "./AgentConfig";
import { CreateAgentModal } from "./CreateAgentModal";
import { cn } from "../lib/utils";
import {
  Bot,
  Plus,
  Search,
  Play,
  Square,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function Dashboard() {
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
  // Which agents have their sub-agent subtree expanded. Empty = all
  // collapsed, so sub-agents are hidden until a parent is opened.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const [startingAll, setStartingAll] = useState(false);
  const [stoppingAll, setStoppingAll] = useState(false);
  const healthIntervalRef = useRef<ReturnType<typeof setInterval>>(null);
  const activityIntervalRef = useRef<ReturnType<typeof setInterval>>(null);

  useEffect(() => {
    fetchAgents();
    fetchHealth();
    fetchActivities();

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
  }, [fetchAgents, fetchHealth, fetchActivities, refreshProcessStatuses]);

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

  // Close drawer on Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drawerOpen) selectAgent(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, selectAgent]);

  // For local-runtime agents "running" tracks the local subprocess.
  // For org-host runtime there is no local subprocess — the bridge
  // lives on a registered VM and reports presence via the WS push.
  // Without the runtime branch every org-hosted agent silently shows
  // as "stopped" and gets bulk-started, which would no-op locally but
  // be confusing UX.
  const isRunningForUI = (m: typeof agents[string]) =>
    m.agent.runtime === "org_host"
      ? m.agent.presence != null && m.agent.presence !== "offline"
      : m.processStatus === "running";

  const runningCount = Object.values(agents).filter(isRunningForUI).length;
  const totalCount = Object.keys(agents).length;
  // "Start All" only targets locally-runnable agents — flipping an
  // org-host agent into "starting" here would do nothing useful since
  // the Tauri command short-circuits to AgentStatus::Remote.
  const stoppedWithKeys = Object.values(agents).filter(
    (m) =>
      m.processStatus === "stopped" &&
      m.apiKey &&
      m.agent.runtime !== "org_host"
  );
  // "Stop All" mirrors Start All — only acts on local subprocesses.
  // stopAgent on an org-host agent is a no-op (the Tauri stop command
  // returns "not found" and we already skip markAgentOffline), but
  // including them here lies about the bulk action's scope.
  const runningAgents = Object.values(agents).filter(
    (m) => isRunningForUI(m) && m.agent.runtime !== "org_host"
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

  return (
    <div className="flex-1 flex h-full overflow-hidden bg-background">
      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header
          className="h-14 shrink-0 px-4 flex items-center justify-between border-b border-border bg-card"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
          <div
            className="flex items-center gap-2"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
              <Bot className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-foreground leading-tight">Agents</h1>
              <p className="text-[11px] text-muted-foreground">
                {totalCount} agent{totalCount !== 1 && "s"}
                {runningCount > 0 && (
                  <span className="text-success ml-1.5">
                    · {runningCount} running
                  </span>
                )}
              </p>
            </div>
          </div>

          <div
            className="flex items-center gap-2"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
              <Input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search agents..."
                className="h-8 pl-8 w-[180px] text-xs"
              />
            </div>
            {runningCount < totalCount && stoppedWithKeys.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleStartAll}
                disabled={startingAll}
                title={`Start ${stoppedWithKeys.length} stopped agent(s)`}
              >
                <Play className="w-3.5 h-3.5" />
                {startingAll ? "Starting..." : "Start All"}
              </Button>
            )}
            {runningCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleStopAll}
                disabled={stoppingAll}
                title={`Stop ${runningCount} running agent(s)`}
              >
                <Square className="w-3.5 h-3.5" />
                {stoppingAll ? "Stopping..." : "Stop All"}
              </Button>
            )}
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="w-3.5 h-3.5" />
              New Agent
            </Button>
          </div>
        </header>

        {/* Content area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {error && (
            <div className="mx-4 mt-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 px-4 py-3 rounded-md">
              {error}
            </div>
          )}

          {loading && totalCount === 0 ? (
            <div className="text-center text-muted-foreground py-20">
              Loading agents...
            </div>
          ) : totalCount === 0 && !error ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
                <Bot className="w-7 h-7 text-primary" />
              </div>
              <p className="text-sm font-medium text-foreground">No agents yet</p>
              <p className="text-xs text-muted-foreground mt-1 mb-4 max-w-xs">
                Create your first agent to start delegating work.
              </p>
              <Button size="sm" onClick={() => setShowCreate(true)}>
                <Plus className="w-3.5 h-3.5" />
                Create Agent
              </Button>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              <div className="sticky top-0 z-10 grid grid-cols-[1fr_180px_140px_140px_56px] gap-3 px-4 py-2 border-b border-border bg-card/95 backdrop-blur text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                <span>Agent</span>
                <span>Engine</span>
                <span>Mode</span>
                <span>Status</span>
                <span className="text-right">Actions</span>
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
          )}
        </div>
      </main>

      {/* Agent detail drawer — overlay from the right */}
      <div
        className={cn(
          "fixed inset-0 bg-black/20 z-40 transition-opacity duration-200",
          drawerOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={() => selectAgent(null)}
      />
      <div
        className={cn(
          "fixed top-0 right-0 h-full w-[800px] max-w-[85vw] bg-card border-l border-border shadow-2xl z-50 overflow-hidden",
          "transition-transform duration-300 ease-out",
          drawerOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {displayAgent && <AgentConfig managed={displayAgent} />}
      </div>

      {showCreate && (
        <CreateAgentModal onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}
