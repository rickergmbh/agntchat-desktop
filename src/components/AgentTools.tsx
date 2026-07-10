import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, ChevronRight, Wrench } from "lucide-react";
import {
  getAgentTools,
  listToolCatalog,
  assignToolToAgent,
  unassignToolFromAgent,
  authorizeProvider,
  getProviderStatus,
  type PlatformToolSummary,
} from "../lib/api";
import { groupIntegrationTools, type ToolGroup } from "../lib/toolGroups";
import { openExternal } from "../lib/openExternal";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "../lib/utils";

interface AgentToolsProps {
  agentId: string;
}

/**
 * Per-agent platform tools. Integration tools (Gmail, Calendar, GitHub, …)
 * are opt-in: they only enter the agent's tool list via an assignment, and
 * the matching integration SKILL stays dormant until they do. Global
 * platform tools are always available and listed read-only.
 */
export function AgentTools({ agentId }: AgentToolsProps) {
  const { t } = useTranslation("agents");
  const [catalog, setCatalog] = useState<PlatformToolSummary[]>([]);
  const [assignedNames, setAssignedNames] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busyTool, setBusyTool] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPlatform, setShowPlatform] = useState(false);
  const [connections, setConnections] = useState<Record<string, boolean>>({});

  const fetchAll = useCallback(async () => {
    try {
      const [resolved, allTools] = await Promise.all([
        getAgentTools(agentId),
        listToolCatalog(),
      ]);
      setCatalog(allTools);
      setAssignedNames(
        new Set(
          resolved.filter((tl) => tl.scope === "agent").map((tl) => tl.name)
        )
      );
    } catch (e) {
      console.error("Failed to fetch tools:", e);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Connection pills for credentialed providers — best-effort, refreshed on
  // mount only (a re-open re-checks; no polling here).
  useEffect(() => {
    for (const provider of ["google", "github"] as const) {
      getProviderStatus(provider)
        .then((s) =>
          setConnections((prev) => ({ ...prev, [provider]: s.connected }))
        )
        .catch(() => {
          // leave unknown — pill simply not shown
        });
    }
  }, []);

  const groups = groupIntegrationTools(catalog);
  const platformTools = catalog.filter((tl) => tl.scope === "global");

  const handleToggle = async (tool: PlatformToolSummary, next: boolean) => {
    setBusyTool(tool.id);
    setError(null);
    // Optimistic — reverted by refetch on failure.
    setAssignedNames((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(tool.name);
      else copy.delete(tool.name);
      return copy;
    });
    try {
      if (next) await assignToolToAgent(tool.id, agentId);
      else await unassignToolFromAgent(tool.id, agentId);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("toolsTab.errors.toggleFailed"));
      await fetchAll();
    } finally {
      setBusyTool(null);
    }
  };

  const handleConnect = async (provider: string) => {
    setError(null);
    try {
      const { authorizeUrl } = await authorizeProvider(provider);
      openExternal(authorizeUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("toolsTab.errors.toggleFailed"));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        {t("toolsTab.loading")}
      </div>
    );
  }

  return (
    <div className="p-5 space-y-6">
      <div>
        <h3 className="text-sm font-semibold">{t("toolsTab.integrations")}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t("toolsTab.skillsHint")}
        </p>
      </div>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      {groups.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("toolsTab.empty")}</p>
      )}

      {groups.map((group: ToolGroup) => {
        const connected = group.credentialProvider
          ? connections[group.credentialProvider]
          : undefined;
        return (
          <div
            key={group.key}
            className="rounded-xl border border-border bg-card"
          >
            <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t(group.labelKey)}
              </span>
              {group.credentialProvider &&
                (connected === true ? (
                  <Badge variant="secondary" className="gap-1 text-[10px]">
                    <Check className="w-3 h-3 text-success" />
                    {t("toolsTab.connected")}
                  </Badge>
                ) : connected === false ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-warning">
                      {t("toolsTab.needsProvider", {
                        provider: group.credentialProvider,
                      })}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => void handleConnect(group.credentialProvider!)}
                    >
                      {t("toolsTab.connect")}
                    </Button>
                  </div>
                ) : null)}
            </div>
            <div className="divide-y divide-border">
              {group.tools.map((tool) => (
                <div
                  key={tool.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm">{tool.displayName || tool.name}</p>
                    {tool.description && (
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {tool.description}
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={assignedNames.has(tool.name)}
                    disabled={busyTool === tool.id}
                    onCheckedChange={(next) => void handleToggle(tool, next)}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Global platform tools — always available, shown for completeness. */}
      <div>
        <button
          type="button"
          onClick={() => setShowPlatform((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {showPlatform ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
          <Wrench className="w-3.5 h-3.5" />
          {t("toolsTab.platform", { count: platformTools.length })}
        </button>
        {showPlatform && (
          <div className="mt-2 rounded-xl border border-border bg-card divide-y divide-border">
            <p className="px-4 py-2 text-xs text-muted-foreground">
              {t("toolsTab.platformHint")}
            </p>
            {platformTools.map((tool) => (
              <div key={tool.id} className="px-4 py-2">
                <p className={cn("text-sm")}>{tool.displayName || tool.name}</p>
                {tool.description && (
                  <p className="text-xs text-muted-foreground line-clamp-1">
                    {tool.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
