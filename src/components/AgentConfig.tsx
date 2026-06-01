import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useAgentStore, type ManagedAgent } from "../stores/agentStore";
import { useActiveWorkspace } from "../stores/workspaceStore";
import { listOrganizationHosts, type OrganizationHost } from "../lib/api";
import {
  deleteAgent,
  deleteAgentPermanently,
  listConnections,
  revokeConnection,
  updateAgent,
  getAgentHealthDetail,
  forceResetAgent,
  clearAgentMessages,
  clearAgentTasks,
  killExecutor,
  unstickAgent,
  getAgentPulse,
  updateAgentPulse,
  enableAgentPulse,
  disableAgentPulse,
  triggerAgentPulse,
  updateAgentRuntime,
  getListingByAgent,
  createDirectoryListing,
  deleteDirectoryListing,
  type Connection,
  type AgentHealthDetail,
  type PulseData,
  type Agent,
  type DirectoryListing,
} from "../lib/api";
import { uploadProcessedBlob } from "../lib/imageProcessor";
import { useFieldLimits } from "../lib/fieldLimits";
import { LogViewer } from "./LogViewer";
import { SoulEditor } from "./SoulEditor";
import { TemplateGallery } from "./TemplateGallery";
import {
  EXECUTION_MODES,
  EFFORT_LEVELS,
  normalizeModelName,
} from "../lib/models";
import { useModelCatalog } from "../stores/modelCatalogStore";
import { useLlmKeyStore } from "../stores/llmKeyStore";
import { cn } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  X,
  Settings2,
  ScrollText,
  Activity,
  Sparkles,
  FileText,
  Copy,
  Eye,
  EyeOff,
  RefreshCw,
  HelpCircle,
  LayoutTemplate,
  Palette,
  Timer,
  Trash2,
  AlertTriangle,
  Unlink,
  Camera,
  Check,
  FolderOpen,
  ShieldOff,
  Zap,
  Inbox,
  ListTodo,
  Cpu,
  Clock,
  HeartPulse,
  Play,
  Loader2,
  User,
  Share2,
  Globe2,
  Server,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AgentSkills } from "./AgentSkills";
import { AgentTemplates } from "./AgentTemplates";
import { AgentCanvas } from "./AgentCanvas";
import { AgentRoutines } from "./AgentRoutines";
import { AvatarCropDialog } from "./AvatarCropDialog";

// Display labels + one-line hints for the CLI connection (auth/runtime)
// picker. Keys match the catalog's cliConnections values. Kept here (not in
// the catalog payload) so copy can change without a backend deploy.
const CLI_CONNECTION_LABELS: Record<string, string> = {
  subscription: "Subscription / Login",
  anthropic: "Anthropic API",
  bedrock: "AWS Bedrock",
  vertex: "GCP Vertex",
  openai: "OpenAI API",
};

const CLI_CONNECTION_HINTS: Record<string, string> = {
  subscription: "Uses this machine's `claude login` (Pro/Max/Console seat).",
  anthropic: "Anthropic-direct API. Set the key under API Key below.",
  bedrock: "Routes through AWS Bedrock using this machine's AWS credentials.",
  vertex: "Routes through Google Vertex using this machine's gcloud credentials.",
  openai: "OpenAI-direct API for the Codex CLI.",
};

export function AgentConfig({ managed }: { managed: ManagedAgent }) {
  const {
    updateConfig,
    regenerateKey,
    selectAgent,
    fetchAgents,
    refreshComputerUseDepsStatus,
    installComputerUseDeps,
  } = useAgentStore();
  const [showApiKey, setShowApiKey] = useState(false);
  const [showLlmKey, setShowLlmKey] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const { agent, config, apiKey } = managed;
  const backend = config.backend || "anthropic";
  const model = config.model || "";
  const executionMode = config.executionMode || "single_shot";
  // Backend-served catalog. Same source as web/mobile so the three
  // surfaces stay aligned by construction.
  const catalog = useModelCatalog();
  useEffect(() => {
    void catalog.ensureLoaded();
  }, [catalog]);
  const PROVIDERS = catalog.providers;
  const availableModels = catalog.modelsFor(backend);
  const currentModelInList = availableModels.some((m) => m.id === model);
  const supportedModes = catalog.supportedModesFor(backend);
  const providerExists = PROVIDERS.some((p) => p.id === backend);
  // CLI connection (auth/runtime) picker — only for CLI backends, which the
  // catalog flags by listing cliConnections. "subscription" is the default
  // when nothing is set. API providers return [] so the picker is hidden.
  const cliConnections = catalog.cliConnectionsFor(backend);
  const cliConnection = config.cliConnection || "subscription";

  const [keyError, setKeyError] = useState<string | null>(null);
  const [confirmingRegen, setConfirmingRegen] = useState(false);

  const handleRegenerate = async () => {
    // If there's an existing key, require confirmation first
    if (apiKey && !confirmingRegen) {
      setConfirmingRegen(true);
      return;
    }
    setConfirmingRegen(false);
    setRegenerating(true);
    setKeyError(null);
    try {
      await regenerateKey(agent.id);
    } catch (e) {
      setKeyError(e instanceof Error ? e.message : "Failed to generate key");
    } finally {
      setRegenerating(false);
    }
  };

  // Multi-key list is now backend-backed. Trigger a refresh on mount so
  // the dropdown reflects the latest server state — adding a key from
  // Profile → LLM Keys propagates here without a page reload.
  const llmKeys = useLlmKeyStore((s) => s.keys);
  const refreshLlmKeys = useLlmKeyStore((s) => s.refresh);
  const llmKeysLoaded = useLlmKeyStore((s) => s.loaded);
  useEffect(() => {
    if (!llmKeysLoaded) refreshLlmKeys();
  }, [llmKeysLoaded, refreshLlmKeys]);
  const providerKeys = useMemo(
    () => llmKeys.filter((k) => k.provider === backend),
    [llmKeys, backend]
  );
  const hasAppDefault = useMemo(
    () => providerKeys.some((k) => k.isDefault),
    [providerKeys]
  );
  // Per-backend memory of the user's last API-key choice. Survives backend
  // switches so flipping anthropic → claude_cli → anthropic restores the
  // previously chosen key instead of silently dropping back to default.
  const apiKeyByProvider = useMemo(() => {
    const raw = (agent.metadata as Record<string, unknown> | undefined)?.api_key_by_provider;
    if (!raw || typeof raw !== "object") return {} as Record<string, string | null>;
    const out: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v === null || typeof v === "string") out[k] = v;
    }
    return out;
  }, [agent.metadata]);
  const requiresLlmKey = catalog.requiresLlmKey(backend);
  // Sentinel must match the SelectItem value below (`__custom__`), otherwise
  // base-ui can't find a matching item and the trigger falls back to raw text.
  const keyMode = config.llmApiKey
    ? "__custom__"
    : config.llmApiKeyId || "__default__";

  const [activeSection, setActiveSection] = useState("config");
  const [showGallery, setShowGallery] = useState(false);

  // Sidebar tabs grouped to mirror the mobile agent-detail screen's
  // section vocabulary (Profile / Model / Capabilities / Operations).
  // Each group renders as an icon cluster separated from the next by
  // a hairline divider — tooltips on each icon carry the full label.
  const sectionGroups: Array<{
    name: string;
    sections: Array<{ value: string; label: string; icon: typeof Settings2 }>;
  }> = [
    {
      name: "Profile",
      sections: [
        { value: "profile", label: "Profile", icon: User },
        { value: "soul", label: "Soul", icon: FileText },
      ],
    },
    {
      name: "Model",
      sections: [{ value: "config", label: "Model", icon: Settings2 }],
    },
    {
      name: "Capabilities",
      sections: [
        { value: "skills", label: "Skills", icon: Sparkles },
        { value: "templates", label: "Templates", icon: LayoutTemplate },
        { value: "routines", label: "Routines", icon: Timer },
        { value: "canvas", label: "Canvas", icon: Palette },
      ],
    },
    {
      name: "Sharing",
      sections: [
        { value: "share", label: "Share Agent", icon: Share2 },
        { value: "publish", label: "Publish to Directory", icon: Globe2 },
      ],
    },
    {
      name: "Operations",
      sections: [
        { value: "pulse", label: "Pulse", icon: HeartPulse },
        { value: "runtime", label: "Runtime", icon: Server },
        { value: "logs", label: "Logs", icon: ScrollText },
        { value: "health", label: "Health", icon: Activity },
      ],
    },
  ];

  return (
    <div className="flex h-full">
      {/* Vertical icon sidebar */}
      <TooltipProvider delay={300}>
        <div className="w-12 border-r border-border bg-muted/30 flex flex-col items-center py-3 gap-1 flex-shrink-0">
          {/* Agent avatar at top */}
          <div className="mb-2">
            <Avatar className="h-8 w-8 rounded-lg">
              {agent.avatarUrl && <AvatarImage src={agent.avatarUrl} className="rounded-lg" />}
              <AvatarFallback className="rounded-lg bg-primary/10 text-primary text-xs font-semibold">
                {agent.displayName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </div>

          <Separator className="w-6 mb-1" />

          {sectionGroups.map((group, groupIdx) => (
            <div key={group.name} className="flex flex-col items-center gap-1">
              {group.sections.map((section) => (
                <Tooltip key={section.value}>
                  <TooltipTrigger
                    render={
                      <button
                        onClick={() => setActiveSection(section.value)}
                        className={cn(
                          "w-8 h-8 rounded-md flex items-center justify-center transition-colors",
                          activeSection === section.value
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:text-foreground hover:bg-accent"
                        )}
                      >
                        <section.icon className="w-4 h-4" />
                      </button>
                    }
                  />
                  <TooltipContent side="right" className="text-xs">
                    <div className="font-semibold">{section.label}</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
                      {group.name}
                    </div>
                  </TooltipContent>
                </Tooltip>
              ))}
              {/* Hairline between groups so the categorization is
                  visible without widening the sidebar. */}
              {groupIdx < sectionGroups.length - 1 && (
                <Separator className="w-6 my-1" />
              )}
            </div>
          ))}

          {/* Close button at bottom */}
          <div className="mt-auto">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    onClick={() => selectAgent(null)}
                    className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                }
              />
              <TooltipContent side="right" className="text-xs">
                Close
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </TooltipProvider>

      {/* Content panel */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
        {/* Header — editable name + avatar */}
        <AgentHeader agent={agent} />

        {/* Crash reason banner — shown across all sections */}
        {managed.processStatus === "crashed" && managed.crashReason && (
          <div className="mx-4 mt-3 px-3 py-2.5 bg-destructive/10 border border-destructive/20 rounded-lg flex-shrink-0">
            <div className="text-xs font-medium text-destructive mb-0.5">Agent crashed</div>
            <div className="text-xs text-destructive/80 whitespace-pre-wrap break-words">
              {managed.crashReason}
            </div>
          </div>
        )}

        {activeSection === "config" && (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {/* LLM Provider — Primary section */}
            <Section title="LLM Provider">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Provider</Label>
                  <Select
                    value={backend}
                    onValueChange={(val: string | null) => {
                      if (!val) return;
                      const models = catalog.modelsFor(val);
                      const modes = catalog.supportedModesFor(val);
                      const connections = catalog.cliConnectionsFor(val);
                      const updates: Record<string, unknown> = {
                        backend: val,
                        model: models[0]?.id || "",
                        // Custom inline keys are provider-specific raw secrets —
                        // never carry them across providers.
                        llmApiKey: null,
                        // Restore the user's last named-key choice for this
                        // provider (or null = use provider default).
                        llmApiKeyId: apiKeyByProvider[val] ?? null,
                        // Reset the CLI connection to the new provider's default
                        // (its first option), or null for API providers. Don't
                        // carry a stale "bedrock" choice across a provider switch.
                        // Clear cloud region/project too.
                        cliConnection: connections[0] ?? null,
                        awsRegion: null,
                        vertexRegion: null,
                        vertexProject: null,
                      };
                      if (!modes.includes(config.executionMode)) {
                        updates.executionMode = modes[0] || "single_shot";
                      }
                      // Snapshot the current provider's selection before
                      // switching so we can restore it on the way back.
                      const nextMap = {
                        ...apiKeyByProvider,
                        [backend]: config.llmApiKeyId ?? null,
                      };
                      void updateAgent(agent.id, {
                        metadata: {
                          ...(agent.metadata || {}),
                          api_key_by_provider: nextMap,
                        },
                      })
                        .then(() => fetchAgents())
                        .catch(() => {
                          // Non-fatal — local config still updates below.
                        });
                      updateConfig(agent.id, updates);
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {!providerExists && backend && (
                        <SelectItem value={backend}>
                          {backend} (custom)
                        </SelectItem>
                      )}
                      {PROVIDERS.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {cliConnections.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Connection</Label>
                    <Select
                      value={cliConnection}
                      onValueChange={(val: string | null) => {
                        if (val) updateConfig(agent.id, { cliConnection: val });
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {(val: unknown) => CLI_CONNECTION_LABELS[String(val)] ?? String(val)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {cliConnections.map((c) => (
                          <SelectItem key={c} value={c}>
                            {CLI_CONNECTION_LABELS[c] ?? c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">
                      {CLI_CONNECTION_HINTS[cliConnection] ?? ""}
                    </p>
                    {cliConnection === "bedrock" && (
                      <Input
                        value={config.awsRegion || ""}
                        onChange={(e) =>
                          updateConfig(agent.id, { awsRegion: e.target.value || null })
                        }
                        placeholder="AWS region (e.g. us-east-1)"
                        className="text-xs"
                      />
                    )}
                    {cliConnection === "vertex" && (
                      <div className="space-y-1.5">
                        <Input
                          value={config.vertexRegion || ""}
                          onChange={(e) =>
                            updateConfig(agent.id, { vertexRegion: e.target.value || null })
                          }
                          placeholder="Vertex region (e.g. us-east5)"
                          className="text-xs"
                        />
                        <Input
                          value={config.vertexProject || ""}
                          onChange={(e) =>
                            updateConfig(agent.id, { vertexProject: e.target.value || null })
                          }
                          placeholder="GCP project ID"
                          className="text-xs"
                        />
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs">Model</Label>
                  <Select
                    value={model}
                    onValueChange={(val: string | null) => {
                      if (val) updateConfig(agent.id, { model: val });
                    }
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {(val: unknown) => {
                          const v = String(val);
                          const match = availableModels.find((m) => m.id === v);
                          if (match) return match.label;
                          return normalizeModelName(v) || v;
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {!currentModelInList && config.model && (
                        <SelectItem value={config.model}>
                          {normalizeModelName(config.model) || config.model} (custom)
                        </SelectItem>
                      )}
                      {availableModels.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {requiresLlmKey && (
                <div className="space-y-1.5">
                  <Label className="text-xs">API Key</Label>
                  <Select
                    value={keyMode}
                    onValueChange={(val: string | null) => {
                      if (!val) return;
                      // Mirror the named-key choice into per-provider memory
                      // so it survives a backend round-trip. We persist `null`
                      // for "use default" and the keyId for a named pick;
                      // raw custom keys stay local-only.
                      const nextKeyIdForProvider =
                        val === "__default__" || val === "__custom__" ? null : val;
                      const nextMap = {
                        ...apiKeyByProvider,
                        [backend]: nextKeyIdForProvider,
                      };
                      void updateAgent(agent.id, {
                        metadata: {
                          ...(agent.metadata || {}),
                          api_key_by_provider: nextMap,
                        },
                      })
                        .then(() => fetchAgents())
                        .catch(() => {
                          // Non-fatal — local config still updates below.
                        });
                      if (val === "__default__") {
                        updateConfig(agent.id, { llmApiKeyId: null, llmApiKey: null });
                      } else if (val === "__custom__") {
                        updateConfig(agent.id, { llmApiKeyId: null, llmApiKey: "" });
                      } else {
                        updateConfig(agent.id, { llmApiKeyId: val, llmApiKey: null });
                      }
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {(val: unknown) => {
                          const v = String(val);
                          if (v === "__default__") {
                            return hasAppDefault
                              ? "Provider Default"
                              : "None (set in Settings)";
                          }
                          if (v === "__custom__") return "Custom Key...";
                          return providerKeys.find((k) => k.id === v)?.label ?? v;
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">
                        {hasAppDefault ? "Provider Default" : "None (set in Settings)"}
                      </SelectItem>
                      {providerKeys.map((k) => (
                        <SelectItem key={k.id} value={k.id}>
                          {k.label}
                        </SelectItem>
                      ))}
                      <SelectItem value="__custom__">Custom Key...</SelectItem>
                    </SelectContent>
                  </Select>
                  {keyMode === "__custom__" && (
                    <div className="flex gap-2">
                      <Input
                        type={showLlmKey ? "text" : "password"}
                        value={config.llmApiKey || ""}
                        onChange={(e) =>
                          updateConfig(agent.id, {
                            llmApiKey: e.target.value || null,
                          })
                        }
                        placeholder="sk-..."
                        className="flex-1 font-mono text-xs"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        onClick={() => setShowLlmKey(!showLlmKey)}
                      >
                        {showLlmKey ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  )}
                </div>
                )}

                {/* Hosted execution (the legacy server-side fallback) is
                    retired. Run-mode placement is now Local-vs-Org-host,
                    set in the Runtime tab. */}
              </div>
            </Section>

            {/* Execution Mode */}
            <Section title="Execution Mode">
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs">Mode</Label>
                  <Tooltip>
                    <TooltipTrigger className="cursor-help">
                      <HelpCircle className="w-3.5 h-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-[280px]">
                      <p className="font-medium mb-1">How the agent calls the LLM</p>
                      <p className="text-xs text-muted-foreground">
                        Controls whether the agent gets a single response, can
                        use tools iteratively, or runs code.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Select
                  value={executionMode}
                  onValueChange={(val: string | null) => {
                    if (val) updateConfig(agent.id, { executionMode: val });
                  }
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXECUTION_MODES.map((m) => {
                      const supported = supportedModes.includes(m.id);
                      return (
                        <SelectItem
                          key={m.id}
                          value={m.id}
                          disabled={!supported}
                        >
                          {m.label}
                          {!supported && " (not available)"}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {
                    EXECUTION_MODES.find(
                      (m) => m.id === executionMode
                    )?.description
                  }
                </p>
                {!supportedModes.includes(executionMode) && (
                  <p className="text-xs text-destructive">
                    Not supported by{" "}
                    {PROVIDERS.find((p) => p.id === backend)?.label ||
                      backend}
                    . Falls back to Single Shot at runtime.
                  </p>
                )}
              </div>
            </Section>

            {/* Effort Level (Claude CLI only) */}
            {config.backend === "claude_cli" && (
              <Section title="Effort Level">
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-xs">Effort</Label>
                    <Tooltip>
                      <TooltipTrigger className="cursor-help">
                        <HelpCircle className="w-3.5 h-3.5 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-[280px]">
                        <p className="font-medium mb-1">Reasoning depth</p>
                        <p className="text-xs text-muted-foreground">
                          Controls how much thinking the model does. Lower effort
                          = faster responses, higher effort = more thorough.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Select
                    value={config.effort || "default"}
                    onValueChange={(val: string | null) => {
                      if (val === "default") {
                        updateConfig(agent.id, { effort: null });
                      } else if (val) {
                        updateConfig(agent.id, { effort: val });
                      }
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default (high)</SelectItem>
                      {EFFORT_LEVELS.map((level) => (
                        <SelectItem key={level.id} value={level.id}>
                          {level.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {config.effort
                      ? EFFORT_LEVELS.find((l) => l.id === config.effort)?.description
                      : "Default reasoning depth — thorough and careful."}
                  </p>
                </div>
              </Section>
            )}

            {/* Behavior */}
            <Section title="Behavior">
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <Label className="text-sm">Skip permissions</Label>
                    <p className="text-xs text-muted-foreground">
                      Claude Code &amp; OpenAI Codex. Combine with{" "}
                      <em>Allow computer use</em> only when you fully trust
                      the agent — together they give it unprompted access
                      to your files and your desktop.
                    </p>
                  </div>
                  <Switch
                    checked={config.dangerouslySkipPermissions}
                    onCheckedChange={(v) =>
                      updateConfig(agent.id, {
                        dangerouslySkipPermissions: v,
                      })
                    }
                  />
                </div>

                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <Label className="text-sm">Allow computer use</Label>
                    <p className="text-xs text-muted-foreground">
                      Lets this agent take screenshots, click, type, and scroll
                      on your Mac (Claude Code backend, macOS only). Requires
                      Screen Recording &amp; Accessibility permissions for the
                      app launching the bridge. Setting follows the agent
                      across desktops. Touch{" "}
                      <code>~/.agentgram/computer_use.paused</code> to stop
                      anytime. If the agent is currently running, restart it
                      after changing this for the new policy to take effect.
                    </p>
                    {agent.metadata?.computer_use_enabled === true && (
                      <ComputerUseDepsRow />
                    )}
                  </div>
                  <Switch
                    checked={agent.metadata?.computer_use_enabled === true}
                    onCheckedChange={async (v) => {
                      // Backend `Agentchat.Accounts.merge_metadata_patch`
                      // shallow-merges this patch with the existing
                      // metadata, so we send ONLY the keys we're changing.
                      // Spreading `agent.metadata` here would clobber any
                      // concurrent writes from another tab.
                      // When turning OFF, also clear the allow-list so the
                      // UI doesn't quietly retain a stale policy that
                      // re-applies when the toggle is flipped back on.
                      const patch: Record<string, unknown> = {
                        computer_use_enabled: v,
                      };
                      if (!v) patch.computer_use_allowed_apps = [];
                      await updateAgent(agent.id, { metadata: patch });
                      await fetchAgents();
                      // When turning ON, recheck deps so the inline status
                      // row reflects reality, and offer the install if
                      // they're missing. Background install — never blocks
                      // the toggle.
                      if (v) {
                        await refreshComputerUseDepsStatus();
                        const s = useAgentStore.getState().computerUseDeps;
                        if (s.state === "not_installed") {
                          void installComputerUseDeps();
                        }
                      }
                    }}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <Label className="text-sm">Auto-restart on crash or stall</Label>
                  <Switch
                    checked={config.autoRestart}
                    onCheckedChange={(v) =>
                      updateConfig(agent.id, { autoRestart: v })
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <Label className="text-sm">Start on app launch</Label>
                  <Switch
                    checked={config.autoStart}
                    onCheckedChange={(v) =>
                      updateConfig(agent.id, { autoStart: v })
                    }
                  />
                </div>

                <div className="flex items-start justify-between gap-3 pt-1">
                  <div className="flex-1">
                    <Label className="text-sm">Auto-inject API documentation</Label>
                    <p className="text-xs text-muted-foreground">
                      Attach relevant API doc snippets from Context Hub to every task this agent receives. Off by default — enable if your agent calls external APIs.
                    </p>
                  </div>
                  <Switch
                    checked={(agent.metadata as Record<string, unknown> | undefined)?.auto_doc_injection === true}
                    onCheckedChange={async (v) => {
                      await updateAgent(agent.id, {
                        metadata: { ...(agent.metadata || {}), auto_doc_injection: v },
                      });
                      await fetchAgents();
                    }}
                  />
                </div>

              </div>
            </Section>

            {/* Agent API Key */}
            <Section title="Agent API Key">
              {apiKey ? (
                <>
                  <div className="flex gap-2">
                    <Input
                      type={showApiKey ? "text" : "password"}
                      value={apiKey}
                      readOnly
                      className="flex-1 font-mono text-xs"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      onClick={() => setShowApiKey(!showApiKey)}
                    >
                      {showApiKey ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      onClick={() => navigator.clipboard.writeText(apiKey)}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  {confirmingRegen ? (
                    <div className="mt-2 flex items-center gap-2">
                      <p className="text-xs text-destructive">This will invalidate the current key.</p>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleRegenerate}
                        disabled={regenerating}
                      >
                        {regenerating ? "Regenerating..." : "Confirm"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmingRegen(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 text-warning border-warning/30 hover:bg-warning/10 hover:text-warning/90"
                      onClick={handleRegenerate}
                      disabled={regenerating}
                    >
                      <RefreshCw className="w-3 h-3 mr-1.5" />
                      Regenerate
                    </Button>
                  )}
                  {keyError && (
                    <p className="text-xs text-destructive mt-1">{keyError}</p>
                  )}
                </>
              ) : (
                <div className="rounded-md border border-dashed border-border p-3 text-center">
                  <p className="text-sm text-muted-foreground mb-2">
                    No key stored on this machine
                  </p>
                  <p className="text-xs text-muted-foreground mb-3">
                    Generate a new key to run this agent from here. This will invalidate any existing key.
                  </p>
                  {keyError && (
                    <p className="text-xs text-destructive mb-2">{keyError}</p>
                  )}
                  <Button
                    size="sm"
                    onClick={handleRegenerate}
                    disabled={regenerating}
                  >
                    <RefreshCw
                      className={cn(
                        "w-3 h-3 mr-1.5",
                        regenerating && "animate-spin"
                      )}
                    />
                    {regenerating ? "Generating..." : "Generate API Key"}
                  </Button>
                </div>
              )}
            </Section>


            {/* Computer-Use Allowed Apps (visible only when computer use is on) */}
            {config.backend === "claude_cli" &&
              agent.metadata?.computer_use_enabled === true && (
                <Section title="Computer-use allowed apps">
                  <p className="text-xs text-muted-foreground mb-2">
                    Optional. When empty, the agent can interact with any app
                    except the hardcoded deny list (1Password, Keychain, etc).
                    When non-empty, the agent is restricted to these apps —
                    anything else is refused. Match is case-insensitive
                    substring against the focused application name. Restart
                    the agent after editing for changes to take effect.
                  </p>
                  <div className="space-y-1.5">
                    {((agent.metadata?.computer_use_allowed_apps as string[] | undefined) || []).map(
                      (app, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <ShieldOff className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          <span className="text-xs font-mono truncate flex-1">{app}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 flex-shrink-0 text-muted-foreground hover:text-destructive/90"
                            onClick={async () => {
                              const current = (agent.metadata?.computer_use_allowed_apps as string[] | undefined) || [];
                              const updated = current.filter((_, j) => j !== i);
                              // Backend merges shallow — send only the key
                              // we're changing.
                              await updateAgent(agent.id, {
                                metadata: { computer_use_allowed_apps: updated },
                              });
                              await fetchAgents();
                            }}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      ),
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={async () => {
                        const name = window.prompt(
                          "App name to allow (e.g. 'Safari', 'Calculator'). " +
                          "Match is case-insensitive substring.",
                        );
                        if (!name?.trim()) return;
                        const current = (agent.metadata?.computer_use_allowed_apps as string[] | undefined) || [];
                        await updateAgent(agent.id, {
                          metadata: { computer_use_allowed_apps: [...current, name.trim()] },
                        });
                        await fetchAgents();
                      }}
                    >
                      <ShieldOff className="w-3.5 h-3.5 mr-1.5" />
                      Add allowed app
                    </Button>
                  </div>
                </Section>
              )}

            {/* Working Directories (Claude CLI only) */}
            {config.backend === "claude_cli" && (
              <Section title="Working Directories">
                <p className="text-xs text-muted-foreground mb-2">
                  Directories this agent can access. Adding directories also enables CLI tools
                  (Bash, Read, Edit, Web) alongside AgentGram tools.
                </p>
                <div className="space-y-1.5">
                  {config.addDirs.map((dir, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <FolderOpen className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-xs font-mono truncate flex-1">{dir}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 flex-shrink-0 text-muted-foreground hover:text-destructive/90"
                        onClick={() => {
                          const updated = config.addDirs.filter((_, j) => j !== i);
                          updateConfig(agent.id, { addDirs: updated });
                        }}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={async () => {
                      try {
                        const { open } = await import("@tauri-apps/plugin-dialog");
                        const selected = await open({ directory: true, multiple: false });
                        if (selected && typeof selected === "string") {
                          updateConfig(agent.id, { addDirs: [...config.addDirs, selected] });
                        }
                      } catch {
                        const path = window.prompt("Enter directory path:");
                        if (path?.trim()) {
                          updateConfig(agent.id, { addDirs: [...config.addDirs, path.trim()] });
                        }
                      }
                    }}
                  >
                    <FolderOpen className="w-3.5 h-3.5 mr-1.5" />
                    Add Directory
                  </Button>
                </div>
              </Section>
            )}

            {/* Danger Zone */}
            <DangerZone agent={agent} onDeleted={() => selectAgent(null)} />
          </div>
        )}

        {activeSection === "profile" && (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            <ProfileSection agent={agent} />
          </div>
        )}

        {activeSection === "logs" && (
          <div className="flex-1 overflow-hidden">
            <LogViewer agentId={agent.id} />
          </div>
        )}

        {activeSection === "soul" && (
          <div className="flex-1 overflow-hidden">
            <SoulEditor agentId={agent.id} />
          </div>
        )}

        {activeSection === "skills" && (
          <div className="flex-1 overflow-y-auto">
            <AgentSkills agentId={agent.id} />
          </div>
        )}

        {activeSection === "templates" && !showGallery && (
          <div className="flex-1 overflow-y-auto">
            <AgentTemplates managed={managed} />
            <div className="px-5 pb-5">
              <button
                onClick={() => setShowGallery(true)}
                className="w-full py-3 rounded-lg bg-primary/10 text-sm font-semibold text-primary hover:bg-primary/20 transition-colors flex items-center justify-center gap-2"
              >
                <LayoutTemplate className="w-4 h-4" />
                Preview All Templates
              </button>
            </div>
          </div>
        )}

        {activeSection === "templates" && showGallery && (
          <div className="flex-1 overflow-hidden">
            <TemplateGallery onClose={() => setShowGallery(false)} />
          </div>
        )}

        {activeSection === "routines" && (
          <div className="flex-1 overflow-y-auto">
            <AgentRoutines agentId={agent.id} />
          </div>
        )}

        {activeSection === "canvas" && (
          <div className="flex-1 overflow-y-auto">
            <AgentCanvas managed={managed} />
          </div>
        )}

        {activeSection === "share" && (
          <div className="flex-1 overflow-y-auto p-5">
            <ShareSection agent={agent} />
          </div>
        )}

        {activeSection === "publish" && (
          <div className="flex-1 overflow-y-auto p-5">
            <PublishSection agent={agent} />
          </div>
        )}

        {activeSection === "pulse" && (
          <PulsePanel managed={managed} />
        )}

        {activeSection === "runtime" && (
          <div className="flex-1 overflow-y-auto p-5">
            <RuntimePanel agent={agent} />
          </div>
        )}

        {activeSection === "health" && (
          <HealthPanel managed={managed} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Share Section — copy invite-style identifier / link
// ---------------------------------------------------------------------------

function ShareSection({ agent }: { agent: Agent }) {
  const [copied, setCopied] = useState<"id" | "message" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canSystemShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  const shareMessage = `Connect with ${agent.displayName} on Agentgram!\n\nAgent ID: ${agent.id}`;

  const copy = async (kind: "id" | "message", text: string) => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable (use HTTPS or copy manually).");
      }
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setError(null);
      setTimeout(() => setCopied(null), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't copy to clipboard.");
    }
  };

  const handleSystemShare = async () => {
    if (canSystemShare) {
      try {
        await navigator.share({
          title: `Connect with ${agent.displayName}`,
          text: shareMessage,
        });
      } catch (e) {
        if (e instanceof Error && e.name !== "AbortError") {
          setError(e.message);
        }
      }
    } else {
      await copy("message", shareMessage);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 rounded-lg p-3">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />{error}
        </div>
      )}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Share2 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Share Agent</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Send this agent's identifier to someone so they can connect with it through the directory.
        </p>

        <div className="space-y-1.5">
          <Label className="text-xs">Agent ID</Label>
          <div className="flex gap-2">
            <Input value={agent.id} readOnly className="font-mono text-xs" />
            <Button size="sm" variant="outline" onClick={() => copy("id", agent.id)}>
              {copied === "id" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Share Message</Label>
          <pre className="rounded-lg border bg-muted/40 p-2.5 text-xs font-mono whitespace-pre-wrap">
            {shareMessage}
          </pre>
        </div>

        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => copy("message", shareMessage)} className="flex-1">
            {copied === "message" ? (
              <><Check className="h-3.5 w-3.5 mr-1.5" /> Copied</>
            ) : (
              <><Copy className="h-3.5 w-3.5 mr-1.5" /> Copy Message</>
            )}
          </Button>
          <Button
            size="sm"
            onClick={handleSystemShare}
            className="flex-1"
            title={canSystemShare ? "Open native share sheet" : "Browser has no share sheet — falls back to copy"}
          >
            <Share2 className="h-3.5 w-3.5 mr-1.5" />
            {canSystemShare ? "Share…" : "Copy to Share"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Publish Section — list this agent in the public directory
// ---------------------------------------------------------------------------

const VISIBILITY_OPTIONS = ["public", "friends_only", "unlisted"] as const;
const PREDEFINED_CATEGORIES = [
  "coding", "research", "writing", "data-analysis", "devops", "qa", "design", "general",
];

function PublishSection({ agent }: { agent: Agent }) {
  const [existing, setExisting] = useState<DirectoryListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [listingName, setListingName] = useState(agent.displayName);
  const [description, setDescription] = useState(agent.description ?? "");
  const [visibility, setVisibility] = useState<(typeof VISIBILITY_OPTIONS)[number]>("public");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const found = await getListingByAgent(agent.id);
        if (!cancelled) setExisting(found);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load listing status");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [agent.id]);

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handlePublish = async () => {
    setError(null);
    const name = listingName.trim();
    if (!name) { setError("Listing name is required."); return; }
    setBusy(true);
    try {
      const tagsList = tags.split(",").map((t) => t.trim()).filter(Boolean);
      const listing = await createDirectoryListing({
        agentId: agent.id,
        listingName: name,
        listingDescription: description.trim() || undefined,
        visibility,
        categories: selectedCategories.length > 0 ? selectedCategories : undefined,
        tags: tagsList.length > 0 ? tagsList : undefined,
      });
      setExisting(listing);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to publish agent");
    } finally {
      setBusy(false);
    }
  };

  const handleUnpublish = async () => {
    if (!existing) return;
    if (!confirm("Remove this agent from the directory?")) return;
    setBusy(true);
    setError(null);
    try {
      await deleteDirectoryListing(existing.id);
      setExisting(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove listing");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading...
      </div>
    );
  }

  if (existing) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-green-500" />
            <h3 className="text-sm font-semibold">Listed in Directory</h3>
          </div>
          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Name</dt>
              <dd className="font-medium truncate">{existing.listingName}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Visibility</dt>
              <dd className="font-medium capitalize">{existing.visibility.replace("_", " ")}</dd>
            </div>
            {existing.categories.length > 0 && (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Categories</dt>
                <dd className="font-medium text-right">{existing.categories.join(", ")}</dd>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Rating</dt>
              <dd className="font-medium">
                {existing.ratingCount > 0
                  ? `${existing.ratingAvg.toFixed(1)} (${existing.ratingCount})`
                  : "Unrated"}
              </dd>
            </div>
          </dl>
          <Button
            size="sm"
            variant="outline"
            onClick={handleUnpublish}
            disabled={busy}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive w-full"
          >
            {busy ? (
              <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" />Removing...</>
            ) : (
              "Remove from Directory"
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 rounded-lg p-3">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />{error}
        </div>
      )}

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Globe2 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Publish to Directory</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Make this agent discoverable to other Agentgram users.
        </p>

        <div className="space-y-1.5">
          <Label className="text-xs">Listing Name *</Label>
          <Input value={listingName} onChange={(e) => setListingName(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Description</Label>
          <textarea
            className="flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this agent do?"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Visibility</Label>
          <div className="flex gap-1.5 flex-wrap">
            {VISIBILITY_OPTIONS.map((v) => (
              <button
                key={v}
                onClick={() => setVisibility(v)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium border capitalize transition-colors",
                  visibility === v
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent"
                )}
              >
                {v.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Categories</Label>
          <div className="flex gap-1.5 flex-wrap">
            {PREDEFINED_CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium border transition-colors",
                  selectedCategories.includes(cat)
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent"
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Tags (comma-separated)</Label>
          <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. python, async" />
        </div>

        <Button onClick={handlePublish} disabled={busy} className="w-full">
          {busy ? (
            <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" />Publishing...</>
          ) : (
            <><Globe2 className="mr-1.5 h-3.5 w-3.5" /> Publish</>
          )}
        </Button>
      </div>
    </div>
  );
}

function PulsePanel({ managed }: { managed: ManagedAgent }) {
  const [data, setData] = useState<PulseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Editable fields. intervalMinutes is a string so the input can hold
  // mid-typing values like "" or "1" without snapping to NaN — matches
  // the web/mobile pattern.
  const [pulseMd, setPulseMd] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState("30");
  const [activeStart, setActiveStart] = useState(8);
  const [activeEnd, setActiveEnd] = useState(22);
  const [timezone, setTimezone] = useState("Etc/UTC");
  const [dirty, setDirty] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const d = await getAgentPulse(managed.agent.id);
      setData(d);
      setPulseMd(d.pulseMd || "");
      setIntervalMinutes(String(d.pulseConfig?.intervalMinutes ?? 30));
      setActiveStart(d.pulseConfig?.activeHours?.start ?? 8);
      setActiveEnd(d.pulseConfig?.activeHours?.end ?? 22);
      setTimezone(d.pulseConfig?.timezone ?? "Etc/UTC");
      setDirty(false);
      setLoadError(null);
    } catch (e) {
      // 404 means the agent simply has no pulse row yet — that's a
      // valid "use defaults" state, not an error worth surfacing. Any
      // other failure we want the user to see so they don't silently
      // edit defaults that won't save.
      const msg = e instanceof Error ? e.message : String(e);
      const status = (e as { status?: number } | null)?.status;
      if (status !== 404 && !/\b404\b/.test(msg)) {
        setLoadError(msg || "Failed to load pulse config.");
      }
    } finally {
      setLoading(false);
    }
  }, [managed.agent.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const isEnabled = data?.pulseConfig?.enabled ?? false;
  const status = data?.pulseConfig?.status ?? "active";
  const runCount = data?.pulseConfig?.runCount ?? 0;
  const failures = data?.pulseConfig?.consecutiveFailures ?? 0;
  const lastRun = data?.pulseConfig?.lastRunAt;
  const nextRun = data?.pulseConfig?.nextRunAt;

  const [hbError, setHbError] = useState<string | null>(null);
  const [hbResult, setHbResult] = useState<string | null>(null);

  const handleToggle = async () => {
    setActionLoading("toggle");
    setHbError(null);
    setHbResult(null);
    try {
      if (isEnabled) {
        await disableAgentPulse(managed.agent.id);
      } else {
        await enableAgentPulse(managed.agent.id);
      }
      await fetchData();
    } catch (e) {
      setHbError(
        e instanceof Error ? e.message : "Failed to toggle pulse."
      );
    }
    setActionLoading(null);
  };

  const handleSave = async () => {
    // Match web + mobile validation so the user gets feedback before
    // the round-trip — backend enforces the same 5-1440 bound (the
    // scheduler cron only fires every 5 minutes, so anything below
    // that would be a UI lie).
    const parsed = Number(intervalMinutes);
    if (!Number.isInteger(parsed) || parsed < 5 || parsed > 1440) {
      setHbError("Interval must be a whole number between 5 and 1440 minutes.");
      return;
    }
    if (activeStart === activeEnd) {
      setHbError("Active hours: start and end must differ (zero-length window).");
      return;
    }
    setSaving(true);
    setHbError(null);
    setHbResult(null);
    try {
      await updateAgentPulse(managed.agent.id, {
        pulse_md: pulseMd,
        interval_minutes: parsed,
        active_hours: { start: activeStart, end: activeEnd },
        timezone,
      });
      await fetchData();
      setHbResult("Saved.");
      setTimeout(() => setHbResult(null), 1800);
    } catch (e) {
      setHbError(
        e instanceof Error ? e.message : "Failed to save pulse."
      );
    }
    setSaving(false);
  };

  const handleTrigger = async () => {
    setActionLoading("trigger");
    setHbError(null);
    setHbResult(null);
    try {
      await triggerAgentPulse(managed.agent.id);
      setHbResult("Pulse triggered.");
      setTimeout(() => setHbResult(null), 1800);
    } catch (e) {
      setHbError(
        e instanceof Error ? e.message : "Failed to trigger pulse."
      );
    }
    setActionLoading(null);
  };

  const formatTime = (iso: string | null | undefined) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        <div className="h-5 w-40 bg-muted/40 rounded animate-pulse" />
        <div className="h-24 bg-muted/30 rounded animate-pulse" />
        <div className="h-32 bg-muted/30 rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-5">
      {loadError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {loadError}
        </div>
      )}
      <Section title="Pulse">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">
              {isEnabled ? "Enabled" : "Disabled"}
            </p>
            <p className="text-xs text-muted-foreground">
              Periodic autonomous thinking
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isEnabled && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleTrigger}
                disabled={actionLoading === "trigger"}
              >
                <Play className="h-3 w-3 mr-1" />
                {actionLoading === "trigger" ? "..." : "Trigger Now"}
              </Button>
            )}
            <Switch
              checked={isEnabled}
              onCheckedChange={handleToggle}
              disabled={actionLoading === "toggle"}
            />
          </div>
        </div>

        {isEnabled && (
          <div className="space-y-1 text-xs text-muted-foreground mt-2">
            <FieldRow label="Status" value={
              <Badge variant={status === "active" ? "default" : "secondary"}>
                {status === "active" ? "Active" : status === "paused" ? "Paused (auto)" : status}
              </Badge>
            } />
            <FieldRow label="Runs" value={String(runCount)} />
            {failures > 0 && (
              <FieldRow label="Consecutive Failures" value={
                <span className="text-destructive">{failures}</span>
              } />
            )}
            <FieldRow label="Last Run" value={formatTime(lastRun)} />
            <FieldRow label="Next Run" value={formatTime(nextRun)} />
          </div>
        )}
      </Section>

      <Separator />

      <Section title="Schedule">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Interval (minutes)</Label>
            <Input
              type="number"
              min={5}
              max={1440}
              value={intervalMinutes}
              onChange={(e) => {
                setIntervalMinutes(e.target.value);
                setDirty(true);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Minimum 5 minutes — the scheduler runs every 5 minutes.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Active From</Label>
              <Select
                value={String(activeStart)}
                onValueChange={(v) => { setActiveStart(Number(v)); setDirty(true); }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {String(i).padStart(2, "0")}:00
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Active Until</Label>
              <Select
                value={String(activeEnd)}
                onValueChange={(v) => { setActiveEnd(Number(v)); setDirty(true); }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {String(i).padStart(2, "0")}:00
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Timezone</Label>
            <Select value={timezone} onValueChange={(v) => { if (v) { setTimezone(v); setDirty(true); } }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Etc/UTC", "Europe/Berlin", "Europe/London", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Asia/Tokyo", "Asia/Shanghai", "Australia/Sydney"].map((tz) => (
                  <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Section>

      <Separator />

      <Section title="Checklist">
        <p className="text-xs text-muted-foreground mb-2">
          What should the agent evaluate on each pulse? The agent will message you only if something needs attention.
        </p>
        <textarea
          className="w-full min-h-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-1 focus:ring-ring"
          value={pulseMd}
          onChange={(e) => { setPulseMd(e.target.value); setDirty(true); }}
          placeholder="e.g., Check if any reminders are due..."
        />
      </Section>

      {/* Toast-style feedback for enable/disable/trigger/save. Sits
          just above the save bar so the user sees outcomes inline
          instead of nothing (the previous catch-all swallowed errors). */}
      {(hbError || hbResult) && (
        <p
          className={cn(
            "text-xs",
            hbError ? "text-destructive" : "text-success"
          )}
        >
          {hbError ?? hbResult}
        </p>
      )}

      {dirty && (
        <div className="sticky bottom-0 bg-background border-t border-border pt-3 pb-1">
          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      )}
    </div>
  );
}

function HealthPanel({ managed }: { managed: ManagedAgent }) {
  const [detail, setDetail] = useState<AgentHealthDetail | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  // ALL hooks must run unconditionally on every render — the previous
  // version declared these two below the `if (!health) return` early
  // exit, which threw "Rendered fewer hooks than expected" the moment
  // the agent's health data flipped from null → present.
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Race protection: skip the auto-refresh tick while a user-triggered
  // action is in flight. Otherwise the background read can land after
  // the action's own post-mutation refetch and revert optimistic state
  // (same fix the web HealthSection got).
  const actionLoadingRef = useRef<string | null>(null);
  actionLoadingRef.current = actionLoading;

  const fetchDetail = useCallback(async () => {
    try {
      const data = await getAgentHealthDetail(managed.agent.id);
      setDetail(data);
    } catch {
      // Fleet health is still available via managed.health
    }
  }, [managed.agent.id]);

  useEffect(() => {
    fetchDetail();
    const interval = setInterval(() => {
      if (actionLoadingRef.current) return;
      fetchDetail();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchDetail]);

  const health = managed.health;
  if (!health) {
    return (
      <div className="text-center text-muted-foreground py-10 text-sm">
        No health data available
      </div>
    );
  }

  // Wrapper that gates destructive actions on a confirm() prompt,
  // surfaces success / error inline (no more silent console.error),
  // and produces a human-friendly summary on success.
  const handleAction = async (
    key: string,
    label: string,
    action: () => Promise<string>,
    confirmMsg?: string
  ) => {
    // Set loading first so other action buttons disable while the
    // confirm dialog is open. Clear if user cancels.
    setActionLoading(key);
    setActionResult(null);
    setActionError(null);
    if (confirmMsg && !window.confirm(confirmMsg)) {
      setActionLoading(null);
      return;
    }
    try {
      const summary = await action();
      setActionResult(`${label}: ${summary}`);
      await fetchDetail();
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : `Failed to run ${label}.`
      );
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-5">
      {/* Status Overview */}
      <Section title="Status">
        <FieldRow
          label="Health"
          value={
            <Badge
              variant="outline"
              className={cn(
                health.healthStatus === "healthy" && "border-success/30 text-success bg-success/10",
                health.healthStatus === "degraded" && "border-warning/30 text-warning bg-warning/10",
                (health.healthStatus === "stuck" || health.healthStatus === "offline") &&
                  "border-destructive/30 text-destructive bg-destructive/10"
              )}
            >
              {health.healthStatus}
            </Badge>
          }
        />
        <FieldRow
          label="Executors"
          value={`${health.onlineExecutorCount} / ${health.executorCount} online`}
        />
        <FieldRow label="Queued Tasks" value={String(health.queuedTasks)} />
        <FieldRow label="Queued Messages" value={String(health.queuedMessages)} />
        {health.stuckCount > 0 && (
          <FieldRow
            label="Stuck Items"
            value={
              <span className="text-destructive font-medium">{health.stuckCount}</span>
            }
          />
        )}
      </Section>

      {/* Quick Actions — always show Unstick, conditionally show others */}
      <Section title="Actions">
        <div className="flex flex-wrap gap-2 py-1">
          <Button
            size="sm"
            variant="outline"
            disabled={actionLoading !== null}
            onClick={() =>
              handleAction(
                "unstick",
                "Unstick",
                async () => {
                  const r = await unstickAgent(managed.agent.id);
                  if (
                    r.executorsReset === 0 &&
                    r.tasksExpired === 0 &&
                    r.messagesRequeued === 0
                  ) {
                    return "nothing to unstick";
                  }
                  return `reset ${r.executorsReset} executor(s), expired ${r.tasksExpired} task(s) and re-queued ${r.messagesRequeued} message(s)`;
                },
                "Re-enable disabled executors and re-queue any stuck tasks or messages. Safe to run any time the agent feels stalled."
              )
            }
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            {actionLoading === "unstick" ? "Unsticking..." : "Unstick Agent"}
          </Button>
          {(health.queuedMessages > 0 || (detail?.unackedMessages.length ?? 0) > 0) && (
            <Button
              size="sm"
              variant="outline"
              disabled={actionLoading !== null}
              onClick={() =>
                handleAction(
                  "clear-messages",
                  "Clear messages",
                  async () => {
                    const r = await clearAgentMessages(managed.agent.id);
                    if (r.expired === 0 && r.unclaimed === 0) return "nothing to clear";
                    return `expired ${r.expired}, unclaimed ${r.unclaimed}`;
                  },
                  "Expire every queued message for this agent. Use when a flood of stuck messages is blocking new work."
                )
              }
            >
              <Inbox className="w-3.5 h-3.5 mr-1.5" />
              {actionLoading === "clear-messages" ? "Clearing..." : "Clear Messages"}
            </Button>
          )}
          {(health.queuedTasks > 0 || (detail?.stuckTasks.length ?? 0) > 0) && (
            <Button
              size="sm"
              variant="outline"
              disabled={actionLoading !== null}
              onClick={() =>
                handleAction(
                  "clear-tasks",
                  "Clear tasks",
                  async () => {
                    const r = await clearAgentTasks(managed.agent.id);
                    if (r.expired === 0 && r.unclaimed === 0) return "nothing to clear";
                    return `expired ${r.expired}, unclaimed ${r.unclaimed}`;
                  },
                  "Expire every queued task for this agent. Use when stuck tasks are blocking new assignments."
                )
              }
            >
              <ListTodo className="w-3.5 h-3.5 mr-1.5" />
              {actionLoading === "clear-tasks" ? "Clearing..." : "Clear Tasks"}
            </Button>
          )}
          <Button
            size="sm"
            variant="destructive"
            disabled={actionLoading !== null}
            onClick={() =>
              handleAction(
                "reset",
                "Force reset",
                async () => {
                  const r = await forceResetAgent(managed.agent.id);
                  return `disabled ${r.disabledExecutors} executor(s), unclaimed ${r.unclaimedTasks} task(s) and ${r.unclaimedMessages} message(s)`;
                },
                "Shut down all executors and unclaim all pending work. The agent will need to be restarted manually."
              )
            }
          >
            <Zap className="w-3.5 h-3.5 mr-1.5" />
            {actionLoading === "reset" ? "Resetting..." : "Force Reset"}
          </Button>
        </div>
        {actionResult && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-success">
            <Check className="mt-0.5 w-3 h-3 flex-shrink-0" />
            {actionResult}
          </p>
        )}
        {actionError && (
          <p className="mt-2 text-xs text-destructive">{actionError}</p>
        )}
      </Section>

      {/* Executors */}
      {detail && detail.executors.length > 0 && (
        <Section title="Executors">
          <div className="space-y-2">
            {detail.executors.map((ex) => (
              <div
                key={ex.id}
                className="flex items-center justify-between py-1.5 px-2 rounded-md bg-muted/30"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Cpu className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm truncate">{ex.displayName || ex.executorKey}</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] px-1.5 py-0",
                      ex.status === "online" && "border-success/30 text-success",
                      ex.status === "offline" && "border-destructive/30 text-destructive",
                      ex.status === "disabled" && "border-muted-foreground/30 text-muted-foreground"
                    )}
                  >
                    {ex.status}
                  </Badge>
                  {ex.activeTaskCount > 0 && (
                    <span className="text-[10px] text-muted-foreground">{ex.activeTaskCount} active</span>
                  )}
                </div>
                {ex.status !== "disabled" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs text-destructive hover:text-destructive/90"
                    disabled={actionLoading !== null}
                    onClick={() => {
                      const name = ex.displayName || ex.executorKey;
                      handleAction(
                        `kill-${ex.id}`,
                        "Kill executor",
                        async () => {
                          await killExecutor(managed.agent.id, ex.id);
                          return `shut down "${name}"`;
                        },
                        `Kill executor "${name}"? It will stop processing tasks.`
                      );
                    }}
                  >
                    {actionLoading === `kill-${ex.id}` ? "..." : "Kill"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Stuck Tasks */}
      {detail && detail.stuckTasks.length > 0 && (
        <Section title={`Stuck Tasks (${detail.stuckTasks.length})`}>
          <div className="space-y-1.5">
            {detail.stuckTasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between py-1.5 px-2 rounded-md bg-destructive/5 border border-destructive/10"
              >
                <div className="min-w-0">
                  <div className="text-sm truncate">{task.title || "Untitled task"}</div>
                  <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {task.status} for {formatDuration(task.elapsedSeconds)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Stuck Messages */}
      {detail && detail.unackedMessages.length > 0 && (
        <Section title={`Unacknowledged Messages (${detail.unackedMessages.length})`}>
          <div className="space-y-1.5">
            {detail.unackedMessages.map((msg) => (
              <div
                key={msg.id}
                className="flex items-center justify-between py-1.5 px-2 rounded-md bg-warning/5 border border-warning/10"
              >
                <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Claimed for {formatDuration(msg.elapsedSeconds)}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function FieldRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

// --- Profile Section (full agent identity editor) ---
//
// All identity fields the mobile + web apps already let users edit:
// avatar, display name, description, agent type, capabilities, and
// wake URL. The always-visible AgentHeader at the top is now read-only
// — it just shows the current avatar + name + description as an
// across-tab anchor; editing happens here.

const AGENT_TYPES: Array<{ value: string; label: string; desc: string }> = [
  { value: "worker", label: "Worker", desc: "Does tasks when asked" },
  { value: "orchestrator", label: "Orchestrator", desc: "Coordinates other agents" },
  { value: "reviewer", label: "Reviewer", desc: "Reviews and validates work" },
  { value: "observer", label: "Observer", desc: "Monitors conversations" },
];

function ProfileSection({
  agent,
}: {
  agent: Agent;
}) {
  const { fetchAgents } = useAgentStore();
  const limits = useFieldLimits();
  const activeWorkspace = useActiveWorkspace();
  const [name, setName] = useState(agent.displayName);
  const [desc, setDesc] = useState(agent.description ?? "");
  const [agentType, setAgentType] = useState(agent.agentType || "worker");
  const [caps, setCaps] = useState((agent.capabilities ?? []).join(", "));
  const [wakeUrl, setWakeUrl] = useState((agent as { wakeUrl?: string }).wakeUrl ?? "");
  // Visibility: "personal" = organizationId null (cross-workspace),
  // "workspace" = pinned to the user's currently-active workspace.
  // Backend rejects pinning to any other workspace, so no picker.
  const [visibility, setVisibility] = useState<"personal" | "workspace">(
    agent.organizationId ? "workspace" : "personal"
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  const initialVisibility: "personal" | "workspace" = agent.organizationId
    ? "workspace"
    : "personal";

  const handleCopyId = useCallback(() => {
    navigator.clipboard.writeText(agent.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  }, [agent.id]);

  // Re-seed when the agent payload refreshes (e.g. an edit from
  // another window) so the form reflects current state.
  useEffect(() => {
    setName(agent.displayName);
    setDesc(agent.description ?? "");
    setAgentType(agent.agentType || "worker");
    setCaps((agent.capabilities ?? []).join(", "));
    setWakeUrl((agent as { wakeUrl?: string }).wakeUrl ?? "");
    setVisibility(agent.organizationId ? "workspace" : "personal");
  }, [
    agent.displayName,
    agent.description,
    agent.agentType,
    agent.capabilities,
    (agent as { wakeUrl?: string }).wakeUrl,
    agent.organizationId,
  ]);

  const dirty =
    name !== agent.displayName ||
    desc !== (agent.description ?? "") ||
    agentType !== (agent.agentType || "worker") ||
    caps !== (agent.capabilities ?? []).join(", ") ||
    wakeUrl !== ((agent as { wakeUrl?: string }).wakeUrl ?? "") ||
    visibility !== initialVisibility;

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Display name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const trimmedCaps = caps
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      const trimmedWake = wakeUrl.trim();
      const trimmedDesc = desc.trim();

      // Only send organizationId when the user actually changed visibility
      // — sending it on every save would either be a no-op or surface
      // 403 not_active_workspace if the user has switched workspaces
      // between visits.
      const visibilityPatch =
        visibility === initialVisibility
          ? {}
          : visibility === "personal"
          ? { organizationId: null as string | null }
          : { organizationId: activeWorkspace?.id ?? null };

      await updateAgent(agent.id, {
        displayName: trimmedName,
        description: trimmedDesc || null,
        agentType,
        capabilities: trimmedCaps,
        wakeUrl: trimmedWake || null,
        ...visibilityPatch,
      });
      await fetchAgents();
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save profile.");
    } finally {
      setSaving(false);
    }
  }, [agent.id, name, desc, agentType, caps, wakeUrl, visibility, initialVisibility, activeWorkspace?.id, fetchAgents]);

  const handleAvatarClick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      setCropImage(url);
    };
    input.click();
  };

  const handleCropConfirm = async (blob: Blob) => {
    setCropImage(null);
    setUploadingAvatar(true);
    try {
      const newUrl = await uploadProcessedBlob(blob, blob.type || "image/jpeg", `avatars/${agent.id}`);
      await updateAgent(agent.id, { avatarUrl: newUrl });
      await fetchAgents();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Avatar upload failed.");
    } finally {
      setUploadingAvatar(false);
    }
  };

  return (
    <>
      <Section title="Identity">
        {/* Avatar — own row at the top so it reads as the focal point. */}
        <div className="flex items-center gap-3 mb-5">
          <button
            onClick={handleAvatarClick}
            disabled={uploadingAvatar}
            className="relative flex-shrink-0"
            title="Change avatar"
          >
            <Avatar className="h-16 w-16 rounded-lg">
              {agent.avatarUrl && (
                <AvatarImage src={agent.avatarUrl} className="rounded-lg" displaySize={64} />
              )}
              <AvatarFallback className="rounded-lg bg-primary/10 text-primary text-lg font-semibold">
                {agent.displayName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-primary flex items-center justify-center border-2 border-card">
              {uploadingAvatar ? (
                <Loader2 className="w-3 h-3 text-primary-foreground animate-spin" />
              ) : (
                <Camera className="w-3 h-3 text-primary-foreground" />
              )}
            </div>
          </button>
          <p className="text-xs text-muted-foreground">
            Click the avatar to upload a new picture (square crop, JPEG/PNG/WebP).
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <Label className="text-xs">Display Name</Label>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {name.length}/{limits.agent.displayName}
            </span>
          </div>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Agent"
            className="text-sm"
            maxLength={limits.agent.displayName}
          />
        </div>

        <div className="space-y-1.5 mt-4">
          <div className="flex items-baseline justify-between">
            <Label className="text-xs">Description</Label>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {desc.length}/{limits.agent.description}
            </span>
          </div>
          <Input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="What this agent does"
            className="text-sm"
            maxLength={limits.agent.description}
          />
        </div>

        <div className="space-y-1.5 mt-4">
          <Label className="text-xs">Agent Role</Label>
          <Select
            value={agentType}
            onValueChange={(val: string | null) => {
              if (val) setAgentType(val);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AGENT_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {AGENT_TYPES.find((t) => t.value === agentType)?.desc ?? ""}
          </p>
        </div>

        <div className="space-y-1.5 mt-4">
          <Label className="text-xs">Capabilities</Label>
          <Input
            value={caps}
            onChange={(e) => setCaps(e.target.value)}
            placeholder="search, weather, calendar"
            className="text-xs"
          />
          <p className="text-[11px] text-muted-foreground">
            Comma-separated tags. Used by orchestrators to discover which
            sibling can handle a task.
          </p>
        </div>

        <div className="space-y-1.5 mt-4">
          <Label className="text-xs">Wake URL (optional)</Label>
          <Input
            value={wakeUrl}
            onChange={(e) => setWakeUrl(e.target.value)}
            placeholder="https://..."
            className="text-xs font-mono"
          />
          <p className="text-[11px] text-muted-foreground">
            Backend POSTs here when this agent receives messages while its
            bridge is offline. Leave blank if you don't run a custom wake
            endpoint.
          </p>
        </div>

        <div className="space-y-1.5 mt-4">
          <Label className="text-xs">Visibility</Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setVisibility("personal")}
              className={cn(
                "flex flex-col rounded-lg border p-2.5 text-left transition-colors",
                visibility === "personal"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-accent"
              )}
            >
              <span className="text-xs font-medium">Personal</span>
              <span className="text-[10px] text-muted-foreground">
                Visible in all your workspaces
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (activeWorkspace && !activeWorkspace.isPersonal) setVisibility("workspace");
              }}
              disabled={!activeWorkspace || activeWorkspace.isPersonal}
              className={cn(
                "flex flex-col rounded-lg border p-2.5 text-left transition-colors",
                visibility === "workspace"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-accent",
                (!activeWorkspace || activeWorkspace.isPersonal) &&
                  "cursor-not-allowed opacity-50"
              )}
            >
              <span className="text-xs font-medium">
                Pinned to{" "}
                {activeWorkspace && !activeWorkspace.isPersonal
                  ? activeWorkspace.name
                  : "this workspace"}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {activeWorkspace && !activeWorkspace.isPersonal
                  ? "Only visible in this workspace"
                  : "Switch to a shared workspace to pin"}
              </span>
            </button>
          </div>
        </div>

        {error && (
          <p className="text-xs text-destructive mt-2">{error}</p>
        )}

        <div className="flex items-center gap-2 mt-4">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!dirty || saving}
          >
            {saving ? (
              <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
            ) : saved ? (
              <Check className="w-3 h-3 mr-1.5" />
            ) : null}
            {saved ? "Saved" : "Save"}
          </Button>
          {dirty && !saving && (
            <span className="text-[11px] text-muted-foreground">Unsaved changes</span>
          )}
        </div>
      </Section>

      <Section title="Details">
        <div className="space-y-1.5">
          <Label className="text-xs">Agent ID</Label>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-muted px-2 py-1.5 font-mono text-xs">{agent.id}</code>
            <button
              onClick={handleCopyId}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Copy agent ID"
            >
              {copiedId ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {agent.ownerId && (
          <div className="space-y-1.5 mt-4">
            <Label className="text-xs">Owner</Label>
            <p className="text-sm text-muted-foreground font-mono">{agent.ownerId}</p>
          </div>
        )}

        {agent.insertedAt && (
          <div className="space-y-1.5 mt-4">
            <Label className="text-xs">Created</Label>
            <p className="text-sm text-muted-foreground">{new Date(agent.insertedAt).toLocaleDateString()}</p>
          </div>
        )}
      </Section>

      {cropImage && (
        <AvatarCropDialog
          open={!!cropImage}
          imageSrc={cropImage}
          onClose={() => {
            URL.revokeObjectURL(cropImage);
            setCropImage(null);
          }}
          onConfirm={(blob) => {
            URL.revokeObjectURL(cropImage);
            handleCropConfirm(blob);
          }}
        />
      )}
    </>
  );
}

// --- Agent Header (read-only anchor) ---
//
// All editing of name / avatar / description moved into the Profile
// tab. The header stays visible across every tab so users keep their
// "what agent am I configuring" context, but it's no longer a tap
// target.

function AgentHeader({
  agent,
}: {
  agent: { id: string; displayName: string; avatarUrl?: string; description?: string; agentType?: string };
}) {
  return (
    <div className="px-4 py-3 border-b border-border flex items-center gap-3 flex-shrink-0">
      <Avatar className="h-9 w-9 rounded-lg flex-shrink-0">
        {agent.avatarUrl && <AvatarImage src={agent.avatarUrl} className="rounded-lg" />}
        <AvatarFallback className="rounded-lg bg-primary/10 text-primary text-xs font-semibold">
          {agent.displayName.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{agent.displayName}</p>
        {agent.description && (
          <p className="text-[11px] text-muted-foreground truncate mt-0.5">
            {agent.description}
          </p>
        )}
      </div>
    </div>
  );
}

// --- Danger Zone ---

function DangerZone({
  agent,
  onDeleted,
}: {
  agent: { id: string; displayName: string; metadata?: Record<string, unknown> };
  onDeleted: () => void;
}) {
  const { fetchAgents, stopAgent } = useAgentStore();
  const [showDelete, setShowDelete] = useState(false);
  const [showConnections, setShowConnections] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loadingConns, setLoadingConns] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const handleDeactivate = async () => {
    setDeactivating(true);
    setError(null);
    try {
      await stopAgent(agent.id).catch((err) => {
        // Deactivation proceeds even if the process was already dead —
        // log so an orphaned bridge process doesn't vanish silently.
        console.warn(
          `[AgentConfig] stopAgent failed before deactivate (${agent.id}):`,
          err
        );
      });
      await deleteAgent(agent.id);
      await fetchAgents();
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to deactivate");
    } finally {
      setDeactivating(false);
    }
  };

  const handleDeletePermanently = async () => {
    if (confirmName !== agent.displayName) return;
    setDeleting(true);
    setError(null);
    try {
      await stopAgent(agent.id).catch((err) => {
        console.warn(
          `[AgentConfig] stopAgent failed before permanent delete (${agent.id}):`,
          err
        );
      });
      await deleteAgentPermanently(agent.id, confirmName);
      setShowDelete(false);
      await fetchAgents();
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  const fetchConnections = useCallback(async () => {
    setLoadingConns(true);
    try {
      const { connections: conns } = await listConnections();
      // Filter to connections involving this agent
      const relevant = conns.filter(
        (c) => c.agentId === agent.id || c.requesterId === agent.id
      );
      setConnections(relevant);
    } catch {
      setConnections([]);
    } finally {
      setLoadingConns(false);
    }
  }, [agent.id]);

  const handleRevoke = async (connId: string) => {
    setRevokingId(connId);
    try {
      await revokeConnection(connId);
      setConnections((prev) => prev.filter((c) => c.id !== connId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revoke");
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <>
      <Separator className="my-2" />
      <Section title="Danger Zone">
        <div className="space-y-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start text-muted-foreground"
            onClick={() => {
              setShowConnections(true);
              fetchConnections();
            }}
          >
            <Unlink className="w-3.5 h-3.5 mr-2" />
            Manage Connections
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start text-warning hover:text-warning/90"
            onClick={handleDeactivate}
            disabled={deactivating}
          >
            <AlertTriangle className="w-3.5 h-3.5 mr-2" />
            {deactivating ? "Deactivating..." : "Deactivate Agent"}
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start text-destructive hover:text-destructive/90"
            onClick={() => setShowDelete(true)}
          >
            <Trash2 className="w-3.5 h-3.5 mr-2" />
            Delete Permanently
          </Button>
        </div>
      </Section>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Agent Permanently</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This will permanently delete <strong>{agent.displayName}</strong> and all
              associated data. This action cannot be undone.
            </p>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">
                Type <strong>{agent.displayName}</strong> to confirm
              </label>
              <Input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={agent.displayName}
                className="font-mono text-sm"
              />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button
              variant="destructive"
              className="w-full"
              disabled={confirmName !== agent.displayName || deleting}
              onClick={handleDeletePermanently}
            >
              {deleting ? "Deleting..." : "Delete Permanently"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Connections Dialog */}
      <Dialog open={showConnections} onOpenChange={setShowConnections}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Connections</DialogTitle>
          </DialogHeader>
          {loadingConns ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Loading...
            </p>
          ) : connections.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No connections for this agent.
            </p>
          ) : (
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {connections.map((conn) => (
                <div
                  key={conn.id}
                  className="flex items-center justify-between p-2.5 rounded-lg border"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {conn.agentName || conn.requesterName || "Unknown"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {conn.status}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive/90"
                    disabled={revokingId === conn.id}
                    onClick={() => handleRevoke(conn.id)}
                  >
                    {revokingId === conn.id ? "..." : "Disconnect"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}


/**
 * Inline status row for the optional pyobjc + Pillow safety deps that
 * back computer-use's real perm probe, native Quartz drivers, and
 * terminal-window redaction. Rendered under "Allow computer use" when
 * that toggle is on. Reads from agentStore's `computerUseDeps`; the
 * store handles the Tauri commands + polling.
 */
function ComputerUseDepsRow() {
  const status = useAgentStore((s) => s.computerUseDeps);
  const refresh = useAgentStore((s) => s.refreshComputerUseDepsStatus);
  const install = useAgentStore((s) => s.installComputerUseDeps);

  // Check once when this row mounts so the user sees real state on
  // first opening AgentConfig. Cheap (~50ms invoke).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (status.state === "installed") {
    return (
      <p className="text-xs text-green-600 dark:text-green-500 mt-2 flex items-center gap-1">
        <Check className="w-3 h-3" />
        Safety features installed (real perm probe, native Quartz drivers,
        terminal redaction).
      </p>
    );
  }

  if (status.state === "installing") {
    const lastLine = status.logTail?.[status.logTail.length - 1];
    return (
      <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        Installing safety features (1–3 min, runs in background)…
        {lastLine && (
          <span className="ml-1 truncate font-mono opacity-70">{lastLine}</span>
        )}
      </p>
    );
  }

  if (status.state === "failed") {
    return (
      <div className="text-xs mt-2 space-y-1">
        <p className="text-destructive flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          Safety feature install failed.
        </p>
        {status.error && (
          <p className="text-muted-foreground font-mono break-all">{status.error}</p>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-xs"
          onClick={() => void install()}
        >
          Retry install
        </Button>
      </div>
    );
  }

  // "not_installed" or "unknown"
  return (
    <div className="text-xs mt-2 space-y-1">
      <p className="text-muted-foreground">
        Optional safety features not installed — currently using fallbacks
        (8KB perm-probe heuristic, cliclick for scroll/right-click, screenshot
        refusal when terminal is visible). Installing adds the real Screen
        Recording perm check, native Quartz drivers, and terminal redaction.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="h-6 text-xs"
        onClick={() => void install()}
      >
        Install safety features
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Runtime Panel — pick local vs org-host runtime for this agent
//
// When set to "org_host" the agent's bridge runs on a registered Linux
// VM owned by the user's org. The Tauri process_manager skips local
// subprocess spawn for these agents (see start_agent's runtime branch).
// ---------------------------------------------------------------------------

function RuntimePanel({ agent }: { agent: Agent }) {
  // Active workspace replaces the old single-org store. Personal
  // workspaces aren't valid host targets.
  const active = useActiveWorkspace();
  const organization = active && !active.isPersonal ? active : null;

  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const stopAgentLocally = useAgentStore((s) => s.stopAgent);

  // Hosts are fetched on demand keyed on the active workspace id.
  // Cancellation guard so a stale fetch from a previous workspace
  // doesn't overwrite the new one's result.
  const [hosts, setHosts] = useState<OrganizationHost[]>([]);
  const [hostsLoaded, setHostsLoaded] = useState(false);
  const [hostsLoading, setHostsLoading] = useState(false);

  useEffect(() => {
    if (!organization) {
      setHosts([]);
      setHostsLoaded(true);
      return;
    }
    let cancelled = false;
    setHostsLoading(true);
    setHostsLoaded(false);
    listOrganizationHosts(organization.id)
      .then((rows) => {
        if (!cancelled) setHosts(rows);
      })
      .catch(() => {
        if (!cancelled) setHosts([]);
      })
      .finally(() => {
        if (!cancelled) {
          setHostsLoading(false);
          setHostsLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [organization?.id]);

  const currentRuntime = agent.runtime ?? "local";
  const currentPresence = agent.presenceMode ?? "wake_on_demand";
  const currentIdle = agent.idleTimeoutSeconds ?? 600;
  const currentHostId = agent.assignedHostId ?? null;

  const [pendingRuntime, setPendingRuntime] = useState<"local" | "org_host">(
    currentRuntime
  );
  const [pendingHostId, setPendingHostId] = useState<string | null>(
    currentHostId ?? hosts[0]?.id ?? null
  );
  const [pendingPresence, setPendingPresence] = useState<
    "always_on" | "wake_on_demand" | "manual"
  >(currentPresence);
  const [pendingIdle, setPendingIdle] = useState<number>(currentIdle);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPendingRuntime(currentRuntime);
    setPendingHostId(currentHostId ?? hosts[0]?.id ?? null);
    setPendingPresence(currentPresence);
    setPendingIdle(currentIdle);
  }, [agent.id, currentRuntime, currentHostId, currentPresence, currentIdle, hosts]);

  const canSwitchToOrgHost =
    organization !== null && hosts.length > 0;

  const dirty =
    pendingRuntime !== currentRuntime ||
    (pendingRuntime === "org_host" &&
      (pendingHostId !== currentHostId ||
        pendingPresence !== currentPresence ||
        pendingIdle !== currentIdle));

  const save = async () => {
    if (!dirty) return;
    setError(null);
    setSaving(true);
    try {
      // Flipping local → org_host while a local subprocess is running
      // would leave an orphan bridge consuming a slot, talking to the
      // backend in parallel with the host's bridge, and producing
      // duplicate replies. Stop it before swapping runtimes so the
      // transition is clean. (markAgentOffline inside stopAgent skips
      // its API call for runtime=org_host agents, so we do this BEFORE
      // PATCHing the runtime field.)
      const flippingToOrgHost =
        currentRuntime !== "org_host" && pendingRuntime === "org_host";

      if (flippingToOrgHost) {
        try {
          await stopAgentLocally(agent.id);
        } catch {
          // Best-effort — if the local process was already dead this
          // is a no-op. The flip still proceeds.
        }
      }

      await updateAgentRuntime(agent.id, {
        runtime: pendingRuntime,
        organizationId:
          pendingRuntime === "org_host" ? organization?.id ?? null : null,
        assignedHostId:
          pendingRuntime === "org_host" ? pendingHostId : null,
        presenceMode:
          pendingRuntime === "org_host" ? pendingPresence : undefined,
        idleTimeoutSeconds:
          pendingRuntime === "org_host" && pendingPresence === "wake_on_demand"
            ? pendingIdle
            : null,
      });
      await fetchAgents();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update runtime");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold">Runtime</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Decide where this agent's bridge runs. Local keeps it on this
          machine (today's behavior). Org host runs it on a shared Linux
          VM your organization administers — the bridge stays alive even
          when your desktop is closed.
        </p>
      </div>

      <div className="space-y-3">
        <Label className="text-sm font-medium">Where it runs</Label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <RuntimeRadio
            label="Local (this device)"
            description="The desktop spawns agent_bridge.py here. Goes offline when the app quits."
            selected={pendingRuntime === "local"}
            onClick={() => setPendingRuntime("local")}
          />
          <RuntimeRadio
            label="Org host"
            description={
              organization
                ? `Runs on one of ${organization.name}'s hosts. Survives desktop close.`
                : "Switch to a shared workspace from the workspace switcher to use this option."
            }
            selected={pendingRuntime === "org_host"}
            onClick={() => canSwitchToOrgHost && setPendingRuntime("org_host")}
            disabled={!canSwitchToOrgHost}
          />
        </div>
        {hostsLoading && !hostsLoaded && (
          <div className="text-xs text-muted-foreground">Loading hosts…</div>
        )}
        {!organization && (
          <div className="text-xs text-muted-foreground">
            You&apos;re in your Personal workspace. Switch to a shared
            workspace (sidebar workspace switcher) to enable org hosting.
          </div>
        )}
        {organization && hostsLoaded && hosts.length === 0 && (
          <div className="text-xs text-muted-foreground">
            Your org has no hosts registered. Add one in Settings → Organization
            to enable this option.
          </div>
        )}
      </div>

      {pendingRuntime === "org_host" && organization && hosts.length > 0 && (
        <>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Host</Label>
            <Select
              value={pendingHostId ?? undefined}
              onValueChange={(v) => setPendingHostId(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick a host" />
              </SelectTrigger>
              <SelectContent>
                {hosts.map((h) => (
                  <SelectItem key={h.id} value={h.id}>
                    {h.name}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {h.status}
                      {h.hostname ? ` · ${h.hostname}` : ""}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Presence</Label>
            <Select
              value={pendingPresence}
              onValueChange={(v) =>
                setPendingPresence(v as typeof pendingPresence)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="always_on">
                  Always on — host keeps the bridge running whenever it's online
                </SelectItem>
                <SelectItem value="wake_on_demand">
                  Wake on demand — bridge spawns when activity arrives, idles after a quiet period
                </SelectItem>
                <SelectItem value="manual">
                  Manual — only spawn when you explicitly start the agent
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {pendingPresence === "wake_on_demand" && (
            <div className="space-y-2">
              <Label className="text-sm font-medium" htmlFor="idle-timeout">
                Idle timeout (seconds)
              </Label>
              <Input
                id="idle-timeout"
                type="number"
                min={30}
                value={pendingIdle}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n > 0) setPendingIdle(n);
                }}
              />
              <p className="text-xs text-muted-foreground">
                How long the bridge will idle (with no stderr activity) before
                the host stops it. Default 600s.
              </p>
            </div>
          )}
        </>
      )}

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        {dirty && (
          <Button
            variant="ghost"
            onClick={() => {
              setPendingRuntime(currentRuntime);
              setPendingHostId(currentHostId ?? hosts[0]?.id ?? null);
              setPendingPresence(currentPresence);
              setPendingIdle(currentIdle);
            }}
          >
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

function RuntimeRadio({
  label,
  description,
  selected,
  onClick,
  disabled,
}: {
  label: string;
  description: string;
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-lg border p-3 text-left transition-colors",
        selected
          ? "border-primary bg-primary/5"
          : "border-border hover:bg-accent",
        disabled && "opacity-50 cursor-not-allowed hover:bg-transparent"
      )}
    >
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "h-3 w-3 rounded-full border",
            selected ? "border-primary bg-primary" : "border-muted-foreground"
          )}
        />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="text-xs text-muted-foreground mt-1.5 ml-5">{description}</p>
    </button>
  );
}
