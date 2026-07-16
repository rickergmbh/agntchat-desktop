import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  X,
  ArrowLeft,
  ArrowRight,
  Bot,
  Workflow,
  ClipboardCheck,
  Eye,
  EyeOff,
  Camera,
  Plus,
  Loader2,
  MapPin,
  ShieldOff,
  Sparkles,
  Mail,
  CalendarDays,
  Telescope,
  PenLine,
  Check,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useAgentStore } from "../stores/agentStore";
import { useAuthStore } from "../stores/authStore";
import { useActiveWorkspace, useWorkspaces, useWorkspacesEnabled } from "../stores/workspaceStore";
import {
  updateAgentRuntime,
  authorizeProvider,
  getProviderStatus,
  listToolCatalog,
  assignToolToAgent,
  type PlatformToolSummary,
} from "../lib/api";
import { openExternal } from "../lib/openExternal";
import { useAgentPresets, type AgentPreset } from "../lib/agentPresets";
import { groupIntegrationTools, anyGoogleTool } from "../lib/toolGroups";
import { useLlmKeyStore } from "../stores/llmKeyStore";
import { useModelCatalog } from "../stores/modelCatalogStore";
import { useAgentTypes } from "../lib/agentTypes";
import { useFieldLimits } from "../lib/fieldLimits";
import { uploadAvatar } from "../lib/imageProcessor";
import { EXECUTION_MODES, EFFORT_LEVELS } from "../lib/models";
import {
  TONES,
  SPECIALTIES_BY_ROLE,
  buildSoulMd,
  specialtySlug,
  specialtyToCapability,
  type AgentType,
  type ToneKey,
} from "../lib/buildSoulMd";
import { cn } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BotMascot } from "./onboarding/BotMascot";
import { LetterReveal } from "./onboarding/LetterReveal";
import { AmbientParticles } from "./onboarding/AmbientParticles";

// Per-step icon for the role picker. Catalog data (id/label/description)
// comes from the backend via useAgentTypes(); only the icon stays in
// the UI layer.
const TYPE_ICONS: Record<string, typeof Bot> = {
  worker: Bot,
  orchestrator: Workflow,
  reviewer: ClipboardCheck,
  observer: Eye,
};

const STEPS = [
  "preset",
  "name",
  "photo",
  "role",
  "tone",
  "specialties",
  "details",
  "tools",
  "brain",
  "review",
] as const;
type WizardStep = (typeof STEPS)[number];

// Display names for credentialed providers on the tools step's Connect
// buttons (provider ids are lowercase machine keys).
const PROVIDER_LABELS: Record<"google" | "github", string> = {
  google: "Google",
  github: "GitHub",
};

// Icons for the preset picker stay UI-side, like TYPE_ICONS below.
const PRESET_ICONS: Record<AgentPreset["id"], typeof Bot> = {
  assistant: Sparkles,
  email: Mail,
  calendar: CalendarDays,
  research: Telescope,
};

// Step subtitles (agents namespace) — resolved with t() at render so
// language switches take effect live.
const STEP_SUBTITLE_KEYS: Record<WizardStep, string> = {
  preset: "create.presetHint",
  name: "create.nameHint",
  photo: "create.photoHint",
  role: "create.roleHint",
  tone: "create.toneHint",
  specialties: "create.specialtiesHint",
  details: "create.detailsHint",
  tools: "create.toolsHint",
  brain: "create.brainHint",
  review: "create.reviewHint",
};

export function CreateAgentModal({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation("agents");
  const { createAgent, selectAgent } = useAgentStore();
  const limits = useFieldLimits();

  const llmKeyStore = useLlmKeyStore();
  const llmKeysLoaded = useLlmKeyStore((s) => s.loaded);
  const refreshLlmKeys = useLlmKeyStore((s) => s.refresh);
  useEffect(() => {
    if (!llmKeysLoaded) refreshLlmKeys();
  }, [llmKeysLoaded, refreshLlmKeys]);

  const catalog = useModelCatalog();
  useEffect(() => {
    void catalog.ensureLoaded();
  }, [catalog]);
  const PROVIDERS = catalog.providers;

  const agentTypes = useAgentTypes();
  const agentPresets = useAgentPresets();

  // ---- Step state ----
  const [stepIndex, setStepIndex] = useState(0);
  const step: WizardStep = STEPS[stepIndex] ?? "name";

  // preset — a chosen starting point pre-seeds role/tone/specialties/
  // description/instructions; everything stays editable in later steps.
  const [preset, setPreset] = useState<AgentPreset | null>(null);
  // Owner's Google connection, prefetched when a Google-backed preset is
  // picked so the create path doesn't await it. null = unknown.
  const googleConnectedRef = useRef<boolean | null>(null);
  // After creating a Google-backed preset without a connection, the modal
  // flips to a connect pane instead of closing.
  const [phase, setPhase] = useState<"wizard" | "connect">("wizard");
  const [connectStatus, setConnectStatus] = useState<
    "idle" | "waiting" | "connected"
  >("idle");
  const connectPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(
    () => () => {
      if (connectPollRef.current) clearInterval(connectPollRef.current);
    },
    []
  );

  // name
  const [displayName, setDisplayName] = useState("");
  // photo
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // role
  const [agentRole, setAgentRole] = useState<AgentType>("worker");
  // tone + description
  const [tone, setTone] = useState<ToneKey | null>(null);
  const [customTone, setCustomTone] = useState<string | null>(null);
  const [customToneInput, setCustomToneInput] = useState("");
  const [toneAddOpen, setToneAddOpen] = useState(false);
  const [description, setDescription] = useState("");
  // specialties
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [customSpecialties, setCustomSpecialties] = useState<string[]>([]);
  const [customSpecialtyInput, setCustomSpecialtyInput] = useState("");
  const [specialtyAddOpen, setSpecialtyAddOpen] = useState(false);
  // details
  const [customInstructions, setCustomInstructions] = useState("");
  const [requiresLocation, setRequiresLocation] = useState(false);
  // tools — integration tools (scope "agent") to assign after creation.
  // Pre-seeded by presets; the picker fetches the catalog on first render.
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [toolCatalog, setToolCatalog] = useState<PlatformToolSummary[]>([]);
  // Provider groups start collapsed; the header switch toggles the whole
  // group, the chevron reveals individual tools.
  const [expandedToolGroups, setExpandedToolGroups] = useState<Set<string>>(
    new Set()
  );
  // Connection status per credentialed provider, shown on the group headers
  // so users can connect right here instead of after creation. undefined =
  // unknown (no badge).
  const [wizardConnections, setWizardConnections] = useState<
    Record<string, boolean | undefined>
  >({});
  useEffect(() => {
    for (const provider of ["google", "github"] as const) {
      getProviderStatus(provider)
        .then((s) => {
          setWizardConnections((prev) => ({ ...prev, [provider]: s.connected }));
          if (provider === "google") googleConnectedRef.current = s.connected;
        })
        .catch(() => {
          // stays unknown
        });
    }
  }, []);
  const wizardConnPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(
    () => () => {
      if (wizardConnPollRef.current) clearInterval(wizardConnPollRef.current);
    },
    []
  );

  // Launch OAuth in the system browser and poll until the credential lands
  // (same mechanics as the post-create connect pane — there's no in-app
  // completion event).
  const handleWizardConnect = async (provider: "google" | "github") => {
    try {
      const { authorizeUrl } = await authorizeProvider(provider);
      openExternal(authorizeUrl);
      const startedAt = Date.now();
      if (wizardConnPollRef.current) clearInterval(wizardConnPollRef.current);
      wizardConnPollRef.current = setInterval(async () => {
        if (Date.now() - startedAt > 120_000) {
          if (wizardConnPollRef.current) clearInterval(wizardConnPollRef.current);
          wizardConnPollRef.current = null;
          return;
        }
        try {
          const s = await getProviderStatus(provider);
          if (s.connected) {
            if (wizardConnPollRef.current) clearInterval(wizardConnPollRef.current);
            wizardConnPollRef.current = null;
            setWizardConnections((prev) => ({ ...prev, [provider]: true }));
            if (provider === "google") googleConnectedRef.current = true;
          }
        } catch {
          // transient — keep polling
        }
      }, 3000);
    } catch {
      // authorize failed — badge stays; user can retry
    }
  };
  useEffect(() => {
    listToolCatalog()
      .then(setToolCatalog)
      .catch(() => {
        // picker shows an empty state; preset assignment still works by name
      });
  }, []);
  // Visibility pin set: null = all workspaces (organizationIds omitted,
  // the default), otherwise the workspace ids to pin the new agent to —
  // any workspaces the owner belongs to, Personal included.
  const [visibilityOrgIds, setVisibilityOrgIds] = useState<string[] | null>(null);
  const activeWorkspace = useActiveWorkspace();
  // brain — backend / model / execution mode / effort / key / safety
  const [backend, setBackend] = useState("claude_cli");
  const [model, setModel] = useState("");
  const [executionMode, setExecutionMode] = useState("tool_use");
  const [effort, setEffort] = useState<string | null>(null);
  // Default ON: agents run unattended, and permission prompts stall them
  // waiting for an operator. Skip-permissions is server-owned and only
  // applies to the CLI backends (claude_cli/codex_cli); the checkbox is
  // hidden for API backends, so this default is inert there.
  const [skipPermissions, setSkipPermissions] = useState(true);
  const [computerUseEnabled, setComputerUseEnabled] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  // Three-way: "__default__" = use provider default (no llmApiKeyId on
  // the agent), "__custom__" = a brand-new key entered below + saved
  // for this agent only, "<existing-id>" = pin to a saved non-default
  // key. Reset to "__default__" whenever the backend flips.
  const [keySelection, setKeySelection] = useState<string>("__default__");

  // Hosting — for plan users we default new agents to "hosted" (always-on,
  // runs on their host using the plan's shared brain) so they can create and
  // start talking with zero setup. Advanced users switch to "local".
  const participant = useAuthStore((s) => s.participant);
  const workspacesEnabled = useWorkspacesEnabled();
  const subStatus = participant?.subscription?.status;
  const isPlan = subStatus === "active" || subStatus === "trialing";
  const hostedHostId = participant?.hostedHostId ?? null;
  // Hosted runtime is behind the `org_hosts` flag. When off, no hosted option
  // is offered at creation and new agents run locally.
  const orgHostsEnabled = participant?.features?.org_hosts === true;
  const canHost = orgHostsEnabled && isPlan && !!hostedHostId;
  const [hosting, setHosting] = useState<"hosted" | "local">(
    canHost ? "hosted" : "local"
  );

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Once the catalog resolves, default backend/model to the first
  // option if the current backend isn't actually available. Keeps the
  // initial "claude_cli" guess if it IS in the catalog.
  // Default model for a provider: Opus 4.8 when the catalog has it (the
  // scratch default), else the catalog's first entry. Presets override this
  // with their own model in applyPreset.
  const defaultModelFor = useCallback(
    (backendId: string) => {
      const list = catalog.modelsFor(backendId);
      return (
        list.find((m) => m.id === "claude-opus-4-8")?.id ?? list[0]?.id ?? ""
      );
    },
    [catalog]
  );

  useEffect(() => {
    if (PROVIDERS.length === 0) return;
    if (PROVIDERS.some((p) => p.id === backend)) {
      if (!model) {
        setModel(defaultModelFor(backend));
      }
      return;
    }
    const first = PROVIDERS[0];
    if (!first) return;
    setBackend(first.id);
    setModel(defaultModelFor(first.id));
  }, [PROVIDERS, backend, model, catalog, defaultModelFor]);

  const models = useMemo(
    () => (backend ? catalog.modelsFor(backend) : []),
    [catalog, backend]
  );
  const supportedModes = useMemo(
    () => (backend ? catalog.supportedModesFor(backend) : []),
    [catalog, backend]
  );
  const needsApiKey = backend ? catalog.requiresLlmKey(backend) : false;
  const hasDefaultKey = useMemo(
    () => llmKeyStore.getDefaultKey(backend) !== null,
    [llmKeyStore, backend]
  );
  const providerKeys = useMemo(
    () => llmKeyStore.getKeysForProvider(backend),
    [llmKeyStore, backend]
  );
  // Show the raw API-key input either:
  //   - the user has no default for this provider (the entered key BECOMES the default), or
  //   - they explicitly chose "Custom Key for this agent" from the picker.
  const showApiKeyInput =
    needsApiKey && (!hasDefaultKey || keySelection === "__custom__");
  const showEffort = backend === "claude_cli";

  const handleBackendChange = (next: string) => {
    if (!next) return;
    setBackend(next);
    setModel(defaultModelFor(next));
    const newModes = catalog.supportedModesFor(next);
    if (!newModes.includes(executionMode)) {
      setExecutionMode(newModes.includes("tool_use") ? "tool_use" : newModes[0] ?? "");
    }
    if (next !== "claude_cli") {
      setEffort(null);
    }
    setApiKey("");
    setKeySelection("__default__");
  };

  const specialtyCatalog = SPECIALTIES_BY_ROLE[agentRole];
  const allSpecialties = useMemo(
    () => [...specialties, ...customSpecialties],
    [specialties, customSpecialties]
  );

  // Only some specialties have a tailored placeholder in the catalog, so the
  // first one that does wins and the rest fall back to the role's "default".
  // Specialties are picked after this step, so they're only set here when a
  // preset seeded them.
  const descPlaceholder = useMemo(() => {
    const match = specialties.find((s) =>
      i18n.exists(`agents:create.descPlaceholders.${agentRole}.${specialtySlug(s)}`)
    );
    const suffix = match ? specialtySlug(match) : "default";
    return t(`create.descPlaceholders.${agentRole}.${suffix}`);
  }, [agentRole, specialties, t, i18n]);

  // Apply a starting point (or "scratch" = null). Sets role FIRST and then
  // specialties in the same handler — the role step's own click handler
  // resets specialties on change, but this path bypasses it deliberately.
  const applyPreset = (p: AgentPreset | null) => {
    setPreset(p);
    if (p) {
      const options = SPECIALTIES_BY_ROLE[p.role].options;
      setAgentRole(p.role);
      setSpecialties(p.specialties.filter((s) => options.includes(s)));
      setCustomSpecialties(p.specialties.filter((s) => !options.includes(s)));
      setTone(p.tone);
      setCustomTone(null);
      // Prefill in the user's language — the server preset carries English
      // canonical text as the fallback. Both fields stay fully editable, so
      // whatever the user keeps (or rewrites) is what lands on the agent.
      setDescription(
        t(`create.presets.${p.id}.description`, { defaultValue: p.description })
      );
      setCustomInstructions(
        t(`create.presets.${p.id}.instructions`, { defaultValue: p.instructions })
      );
      setSelectedTools(p.tools ?? []);
      // Preset default model (only meaningful on the claude_cli backend the
      // wizard starts on; a later provider switch re-defaults it anyway).
      if (p.model && backend === "claude_cli") setModel(p.model);
      if (p.requiresGoogle && googleConnectedRef.current === null) {
        void getProviderStatus("google")
          .then((s) => {
            googleConnectedRef.current = s.connected;
          })
          .catch(() => {
            // stays null — re-checked at create time
          });
      }
    } else {
      // Scratch: return the seeded fields to pristine so switching from a
      // preset back to scratch doesn't silently keep its seed.
      setAgentRole("worker");
      setSpecialties([]);
      setCustomSpecialties([]);
      setTone(null);
      setCustomTone(null);
      setDescription("");
      setCustomInstructions("");
      setSelectedTools([]);
      if (backend === "claude_cli") setModel(defaultModelFor(backend));
    }
    setStepIndex(STEPS.indexOf("name"));
  };

  const canNext = useMemo(() => {
    // Preset step advances by picking a card, not the Next button.
    if (step === "preset") return false;
    if (step === "name") return displayName.trim().length > 0;
    return true;
  }, [step, displayName]);

  const isLast = step === "review";
  const isFirst = step === "preset";

  const handleBack = () => {
    if (isFirst) {
      onClose();
      return;
    }
    setStepIndex((i) => Math.max(0, i - 1));
  };

  const handleNext = () => {
    if (!canNext) return;
    if (isLast) {
      void handleCreate();
      return;
    }
    setStepIndex((i) => Math.min(STEPS.length - 1, i + 1));
  };

  const handleAvatarPick = () => fileInputRef.current?.click();

  const handleAvatarFile = async (file: File | undefined) => {
    if (!file) return;
    setUploadingAvatar(true);
    setError(null);
    try {
      const url = await uploadAvatar(file, `pending-${Date.now()}`);
      setAvatarUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("create.errors.uploadFailed"));
    } finally {
      setUploadingAvatar(false);
    }
  };

  const toggleSpecialty = (s: string) => {
    setSpecialties((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  };

  const addCustomSpecialty = () => {
    const v = customSpecialtyInput.trim();
    if (!v) {
      setSpecialtyAddOpen(false);
      return;
    }
    if (
      [...specialties, ...customSpecialties].some(
        (x) => x.toLowerCase() === v.toLowerCase()
      )
    ) {
      setCustomSpecialtyInput("");
      setSpecialtyAddOpen(false);
      return;
    }
    setCustomSpecialties((prev) => [...prev, v]);
    setCustomSpecialtyInput("");
    setSpecialtyAddOpen(false);
  };

  const removeCustomSpecialty = (s: string) => {
    setCustomSpecialties((prev) => prev.filter((x) => x !== s));
  };

  const commitCustomTone = () => {
    const v = customToneInput.trim();
    if (!v) {
      setToneAddOpen(false);
      return;
    }
    setTone(null);
    setCustomTone(v);
    setCustomToneInput("");
    setToneAddOpen(false);
  };

  const handleCreate = useCallback(async () => {
    if (!displayName.trim()) {
      setError(t("create.errors.nameRequired"));
      setStepIndex(0);
      return;
    }
    // Hosted agents use the host's shared brain — no API key to enter.
    if (hosting === "local" && showApiKeyInput && !apiKey.trim()) {
      setError(t("create.errors.apiKeyRequired"));
      return;
    }
    setCreating(true);
    setError(null);
    try {
      // Hosted agents run on the org host with its shared Claude seat, so we
      // pin sensible defaults (claude_cli) and skip per-agent key handling.
      // canHost guard: users without the hosted runtime can never create
      // hosted (the picker disables it, this backstops it).
      const hosted = hosting === "hosted" && canHost;
      const effBackend = hosted ? "claude_cli" : backend;
      // Hosted model: honor the wizard's chosen model (a preset default like
      // Sonnet 4.6, or whatever the user picked) when it's a valid claude_cli
      // model; otherwise fall back to Opus 4.8 (the scratch default), then the
      // catalog's first hosted entry.
      const hostedModels = catalog.modelsFor("claude_cli");
      const effModel = hosted
        ? hostedModels.find((m) => m.id === model)?.id ??
          hostedModels.find((m) => m.id === "claude-opus-4-8")?.id ??
          hostedModels[0]?.id ??
          model
        : model;
      const effExecutionMode = hosted ? "tool_use" : executionMode;

      // Resolve the key choice:
      //   * No default exists + key entered → save it AS the default.
      //   * Default exists + custom key entered → save as a non-default
      //     credential and pin this agent to it via llmApiKeyId.
      //   * "__default__" → use the provider default (no pin).
      //   * "<id>" → pin to an existing saved key.
      let llmApiKeyIdPin: string | null = null;
      if (!hosted) {
        if (apiKey.trim() && needsApiKey) {
          const provider = PROVIDERS.find((p) => p.id === backend);
          const label = `${provider?.label || backend} Key`;
          try {
            const newId = await llmKeyStore.addKey(backend, label, apiKey.trim(), {
              makeDefault: !hasDefaultKey,
            });
            if (hasDefaultKey) llmApiKeyIdPin = newId;
          } catch (e) {
            setError(e instanceof Error ? e.message : t("create.errors.saveKeyFailed"));
            setCreating(false);
            return;
          }
        } else if (
          keySelection !== "__default__" &&
          keySelection !== "__custom__"
        ) {
          // User picked an existing non-default saved key — pin to it.
          llmApiKeyIdPin = keySelection;
        }
      }

      const allSpecialtiesList = [...specialties, ...customSpecialties];
      const capabilities = allSpecialtiesList
        .map(specialtyToCapability)
        .filter(Boolean);

      const soulMd = buildSoulMd(
        displayName.trim(),
        tone,
        customTone,
        allSpecialtiesList,
        description,
        customInstructions
      );

      const newId = await createAgent({
        displayName: displayName.trim(),
        agentType: agentRole,
        // Local choice must be explicit — without it the backend auto-places
        // every new agent on the owner's org host when one exists.
        ...(!hosted ? { runtime: "local" as const } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(capabilities.length > 0 ? { capabilities } : {}),
        ...(avatarUrl ? { avatarUrl } : {}),
        ...(requiresLocation ? { requiresLocation: true } : {}),
        ...(soulMd ? { soulMd } : {}),
        ...(effBackend ? { backend: effBackend } : {}),
        ...(effModel ? { model: effModel } : {}),
        ...(effExecutionMode ? { executionMode: effExecutionMode } : {}),
        // Local-only brain knobs — hosted agents use the host's shared seat.
        ...(!hosted && effort ? { effort } : {}),
        ...(!hosted && skipPermissions ? { dangerouslySkipPermissions: true } : {}),
        // computer-use lives in agent.metadata (snake_case, backend-merged)
        // so it follows the agent across desktops. Allow-list is left
        // empty at create time — user can fill it in AgentConfig after.
        ...(!hosted && computerUseEnabled
          ? { metadata: { computer_use_enabled: true } }
          : {}),
        ...(llmApiKeyIdPin ? { llmApiKeyId: llmApiKeyIdPin } : {}),
        // Visibility: omit organizationIds (= all-workspaces default)
        // unless the user picked a pin set on the review step — any
        // workspaces they belong to, Personal included.
        ...(visibilityOrgIds && visibilityOrgIds.length > 0
          ? { organizationIds: visibilityOrgIds }
          : {}),
      });

      // Hosted: dedicate the agent to the user's host so it's always on.
      // Non-fatal — if it fails the agent still exists (just local for now).
      if (newId && hosted && hostedHostId) {
        try {
          await updateAgentRuntime(newId, {
            runtime: "org_host",
            organizationId: participant?.organizationId ?? activeWorkspace?.id ?? null,
            assignedHostId: hostedHostId,
            presenceMode: "always_on",
          });
        } catch {
          // leave as local; user can fix in the agent's Runtime settings
        }
      }

      // Selected integration tools: platform tools like Gmail/Calendar are
      // scope "agent" — they never appear in the agent's tool list without
      // an explicit assignment, regardless of the soul or the owner's
      // Google connection. Best-effort: a failed assignment shouldn't fail
      // the create (tools can be assigned later in the agent's Tools tab).
      if (newId && selectedTools.length > 0) {
        try {
          const catalogTools =
            toolCatalog.length > 0 ? toolCatalog : await listToolCatalog();
          const byName = new Map(catalogTools.map((tl) => [tl.name, tl.id]));
          await Promise.all(
            selectedTools.map((name) => {
              const toolId = byName.get(name);
              return toolId
                ? assignToolToAgent(toolId, newId).catch(() => undefined)
                : Promise.resolve(undefined);
            })
          );
        } catch {
          // catalog fetch failed — non-fatal
        }
      }

      if (newId) await selectAgent(newId);

      // Google-backed selection: if the owner hasn't connected Google, keep
      // the modal open on a connect pane instead of closing — the agent
      // exists either way, but its tools only work once connected. Covers
      // presets AND scratch agents that picked Google tools.
      const wantsGoogle =
        preset?.requiresGoogle || anyGoogleTool(toolCatalog, selectedTools);

      if (newId && wantsGoogle) {
        let connected = googleConnectedRef.current;
        if (connected === null) {
          try {
            connected = (await getProviderStatus("google")).connected;
          } catch {
            connected = false;
          }
        }
        if (!connected) {
          setPhase("connect");
          return;
        }
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("create.errors.createFailed"));
    } finally {
      setCreating(false);
    }
  }, [
    preset,
    selectedTools,
    toolCatalog,
    displayName,
    tone,
    customTone,
    description,
    specialties,
    customSpecialties,
    customInstructions,
    requiresLocation,
    avatarUrl,
    agentRole,
    backend,
    model,
    executionMode,
    effort,
    skipPermissions,
    computerUseEnabled,
    apiKey,
    keySelection,
    hasDefaultKey,
    needsApiKey,
    showApiKeyInput,
    PROVIDERS,
    llmKeyStore,
    createAgent,
    selectAgent,
    onClose,
    hosting,
    hostedHostId,
    participant,
    catalog,
    activeWorkspace,
    visibilityOrgIds,
    t,
  ]);

  const initials = displayName
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const providerLabel = PROVIDERS.find((p) => p.id === backend)?.label;

  // Step titles personalize once a name exists, and the specialties title
  // varies by the chosen role — so titles resolve here rather than via a
  // static key map.
  const stepTitle = (s: WizardStep): string => {
    const name = displayName.trim();
    switch (s) {
      case "preset":
        return t("create.presetTitle");
      case "name":
        return t("create.nameTitle");
      case "photo":
        return name
          ? t("create.photoTitleNamed", { name })
          : t("create.photoTitle");
      case "role":
        return name
          ? t("create.roleTitleNamed", { name })
          : t("create.roleTitle");
      case "tone":
        return t("create.toneTitle");
      case "specialties":
        return t(`create.specialtiesTitleByRole.${agentRole}`);
      case "details":
        return t("create.detailsTitle");
      case "tools":
        return t("create.toolsTitle");
      case "brain":
        return t("create.brainTitle");
      case "review":
        return t("create.reviewTitle");
    }
  };

  // Launch the Google OAuth in the system browser and poll for the
  // credential landing (the callback is handled server-side; there's no
  // in-app completion event).
  const handleConnectGoogle = async () => {
    setError(null);
    try {
      const { authorizeUrl } = await authorizeProvider("google");
      openExternal(authorizeUrl);
      setConnectStatus("waiting");
      const startedAt = Date.now();
      if (connectPollRef.current) clearInterval(connectPollRef.current);
      connectPollRef.current = setInterval(async () => {
        if (Date.now() - startedAt > 120_000) {
          if (connectPollRef.current) clearInterval(connectPollRef.current);
          connectPollRef.current = null;
          setConnectStatus("idle");
          return;
        }
        try {
          const s = await getProviderStatus("google");
          if (s.connected) {
            if (connectPollRef.current) clearInterval(connectPollRef.current);
            connectPollRef.current = null;
            setConnectStatus("connected");
          }
        } catch {
          // transient — keep polling
        }
      }, 3000);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t("create.errors.createFailed")
      );
    }
  };

  if (phase === "connect") {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-[480px] p-0 gap-0 overflow-hidden">
          <div className="relative">
            <AmbientParticles count={14} />
            <div className="relative px-6 pt-7 pb-6 flex flex-col items-center text-center gap-3">
              <BotMascot size={64} />
              <DialogTitle className="text-lg font-semibold text-foreground">
                {t("create.connect.title", { name: displayName.trim() })}
              </DialogTitle>
              <p className="text-sm text-text-muted max-w-sm">
                {t("create.connect.body", { name: displayName.trim() })}
              </p>
              {error && (
                <p className="text-xs text-destructive" role="alert">
                  {error}
                </p>
              )}
              <div className="mt-2 flex flex-col items-center gap-2">
                {connectStatus === "connected" ? (
                  <>
                    <span className="flex items-center gap-1.5 text-sm text-success">
                      <Check className="h-4 w-4" />
                      {t("create.connect.connected")}
                    </span>
                    <Button type="button" onClick={onClose}>
                      {t("create.connect.done")}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      onClick={() => void handleConnectGoogle()}
                      disabled={connectStatus === "waiting"}
                    >
                      {connectStatus === "waiting" ? (
                        <>
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          {t("create.connect.waiting")}
                        </>
                      ) : (
                        t("create.connect.cta")
                      )}
                    </Button>
                    <Button type="button" variant="ghost" onClick={onClose}>
                      {t("create.connect.skip")}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px] p-0 gap-0 overflow-hidden">
        <div className="relative">
          <AmbientParticles count={14} />

          {/* Header */}
          <div className="relative px-6 pt-7 pb-3 flex flex-col items-center text-center gap-3">
            <BotMascot size={64} />
            <div className="space-y-1">
              <DialogTitle className="text-lg font-semibold text-foreground">
                <LetterReveal
                  key={step}
                  text={stepTitle(step)}
                  delayPerChar={28}
                />
              </DialogTitle>
              <p className="text-sm text-text-muted min-h-[2.5em]">
                {t(STEP_SUBTITLE_KEYS[step])}
              </p>
            </div>

            {/* Step pips */}
            <div className="flex items-center gap-1.5">
              {STEPS.map((s, i) => (
                <span
                  key={s}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-300",
                    i === stepIndex
                      ? "w-6 bg-accent"
                      : i < stepIndex
                        ? "w-1.5 bg-accent/60"
                        : "w-1.5 bg-border"
                  )}
                />
              ))}
            </div>
          </div>

          {/* Step body */}
          <div className="relative px-6 pb-3 max-h-[55vh] overflow-y-auto">
            <form
              key={step}
              onSubmit={(e) => {
                e.preventDefault();
                handleNext();
              }}
              className="space-y-4 pt-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-300"
            >
              {step === "preset" && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    {agentPresets.map((p) => {
                      const Icon = PRESET_ICONS[p.id];
                      const selected = preset?.id === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => applyPreset(p)}
                          className={cn(
                            "relative flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-colors",
                            selected
                              ? "border-primary bg-primary/5"
                              : "border-border hover:bg-accent"
                          )}
                        >
                          <Icon
                            className={cn(
                              "h-5 w-5",
                              selected ? "text-primary" : "text-text-muted"
                            )}
                          />
                          <span className="text-xs font-medium">
                            {t(p.labelKey)}
                          </span>
                          <span className="text-[10px] leading-tight text-text-muted">
                            {t(p.taglineKey)}
                          </span>
                          {p.requiresGoogle && (
                            <span className="mt-0.5 rounded-full bg-muted px-1.5 py-px text-[9px] uppercase tracking-wide text-muted-foreground">
                              {t("create.presets.googleBadge")}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => applyPreset(null)}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border p-2.5 text-xs text-text-muted transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <PenLine className="h-3.5 w-3.5" />
                    <span className="font-medium">
                      {t("create.presets.scratchLabel")}
                    </span>
                    <span>· {t("create.presets.scratchTagline")}</span>
                  </button>
                </div>
              )}

              {step === "name" && (
                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between">
                    <Label htmlFor="agent-name">{t("common:name")}</Label>
                    <span className="text-xs text-text-muted tabular-nums">
                      {displayName.length}/{limits.agent.displayName}
                    </span>
                  </div>
                  <Input
                    id="agent-name"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={
                      preset
                        ? t(preset.namePlaceholderKey)
                        : t("create.namePlaceholder")
                    }
                    autoFocus
                    maxLength={limits.agent.displayName}
                  />
                </div>
              )}

              {step === "photo" && (
                <div className="flex flex-col items-center gap-3 py-2">
                  <button
                    type="button"
                    onClick={handleAvatarPick}
                    className="relative group"
                    title={t("create.chooseAvatar")}
                  >
                    <Avatar className="h-32 w-32 rounded-2xl border-2 border-dashed border-border group-hover:border-primary transition-colors">
                      {avatarUrl && (
                        <AvatarImage
                          src={avatarUrl}
                          className="rounded-2xl object-cover"
                        />
                      )}
                      <AvatarFallback className="rounded-2xl bg-primary/5 text-2xl font-semibold text-text-muted">
                        {initials || <Camera className="h-7 w-7" />}
                      </AvatarFallback>
                    </Avatar>
                    {uploadingAvatar && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-background/70">
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      </div>
                    )}
                  </button>
                  <p className="text-xs text-text-muted">
                    {avatarUrl ? t("create.clickToChange") : t("create.clickToChoosePhoto")}
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => handleAvatarFile(e.target.files?.[0])}
                  />
                </div>
              )}

              {step === "role" && (
                <div className="grid grid-cols-2 gap-2">
                  {agentTypes.map((type) => {
                    const Icon = TYPE_ICONS[type.id] ?? Bot;
                    const selected = agentRole === type.id;
                    return (
                      <button
                        key={type.id}
                        type="button"
                        onClick={() => {
                          setAgentRole(type.id as AgentType);
                          setSpecialties([]);
                          setCustomSpecialties([]);
                        }}
                        className={cn(
                          "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-colors",
                          selected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:bg-accent"
                        )}
                      >
                        <Icon
                          className={cn(
                            "h-5 w-5",
                            selected ? "text-primary" : "text-text-muted"
                          )}
                        />
                        <span className="text-xs font-medium">
                          {t(`roles.${type.id}.label`, { defaultValue: type.label })}
                        </span>
                        <span className="text-[10px] leading-tight text-text-muted">
                          {t(`roles.${type.id}.desc`, { defaultValue: type.description })}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {step === "tone" && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {TONES.map((tn) => {
                        const selected = tone === tn.key;
                        return (
                          <button
                            key={tn.key}
                            type="button"
                            onClick={() => {
                              setTone(tn.key);
                              setCustomTone(null);
                            }}
                            className={cn(
                              "rounded-full border px-3 py-1 text-xs transition-colors",
                              selected
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border hover:bg-accent"
                            )}
                          >
                            {t(`tones.${tn.key}`, { defaultValue: tn.label })}
                          </button>
                        );
                      })}
                      {customTone && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary px-3 py-1 text-xs text-primary-foreground">
                          {customTone}
                          <button
                            type="button"
                            onClick={() => setCustomTone(null)}
                            aria-label={t("create.removeCustomTone")}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      )}
                      {!toneAddOpen && (
                        <button
                          type="button"
                          onClick={() => setToneAddOpen(true)}
                          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-xs text-text-muted hover:bg-accent"
                        >
                          <Plus className="h-3 w-3" /> {t("common:custom")}
                        </button>
                      )}
                    </div>
                    {toneAddOpen && (
                      <Input
                        autoFocus
                        value={customToneInput}
                        onChange={(e) => setCustomToneInput(e.target.value)}
                        placeholder={t("create.customTonePlaceholder")}
                        maxLength={30}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitCustomTone();
                          }
                          if (e.key === "Escape") {
                            setCustomToneInput("");
                            commitCustomTone();
                          }
                        }}
                        onBlur={commitCustomTone}
                        className="h-8 text-xs"
                      />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between">
                      <Label htmlFor="agent-desc">{t("common:descriptionOptional")}</Label>
                      <span className="text-xs text-text-muted tabular-nums">
                        {description.length}/{limits.agent.description}
                      </span>
                    </div>
                    <Textarea
                      id="agent-desc"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={descPlaceholder}
                      rows={3}
                      maxLength={limits.agent.description}
                      className="resize-none"
                    />
                  </div>
                </div>
              )}

              {step === "specialties" && (
                <div className="space-y-2">
                  <p className="text-xs text-text-muted">
                    {t(`create.specialtiesTitleByRole.${agentRole}`)}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {specialtyCatalog.options.map((s) => {
                      const isOn = specialties.includes(s);
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => toggleSpecialty(s)}
                          className={cn(
                            "rounded-full border px-3 py-1 text-xs transition-colors",
                            isOn
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border hover:bg-accent"
                          )}
                        >
                          {t(`create.specialtyOptions.${specialtySlug(s)}`, {
                            defaultValue: s,
                          })}
                        </button>
                      );
                    })}
                    {customSpecialties.map((s) => (
                      <span
                        key={s}
                        className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary px-3 py-1 text-xs text-primary-foreground"
                      >
                        {t(`create.specialtyOptions.${specialtySlug(s)}`, {
                          defaultValue: s,
                        })}
                        <button
                          type="button"
                          onClick={() => removeCustomSpecialty(s)}
                          aria-label={t("create.removeSpecialty", { name: s })}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    {!specialtyAddOpen && (
                      <button
                        type="button"
                        onClick={() => setSpecialtyAddOpen(true)}
                        className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-xs text-text-muted hover:bg-accent"
                      >
                        <Plus className="h-3 w-3" /> Custom
                      </button>
                    )}
                  </div>
                  {specialtyAddOpen && (
                    <Input
                      autoFocus
                      value={customSpecialtyInput}
                      onChange={(e) => setCustomSpecialtyInput(e.target.value)}
                      placeholder={t("create.addSpecialtyPlaceholder")}
                      maxLength={40}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addCustomSpecialty();
                        }
                        if (e.key === "Escape") {
                          setCustomSpecialtyInput("");
                          setSpecialtyAddOpen(false);
                        }
                      }}
                      onBlur={addCustomSpecialty}
                      className="h-8 text-xs"
                    />
                  )}
                </div>
              )}

              {step === "details" && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between">
                      <Label htmlFor="agent-instructions">
                        {t("create.customInstructionsOptional")}
                      </Label>
                      <span className="text-xs text-text-muted tabular-nums">
                        {customInstructions.length}/2000
                      </span>
                    </div>
                    <Textarea
                      id="agent-instructions"
                      value={customInstructions}
                      onChange={(e) => setCustomInstructions(e.target.value)}
                      placeholder={t("create.instructionsPlaceholder")}
                      rows={4}
                      maxLength={2000}
                      className="resize-none"
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                    <div className="flex items-center gap-2">
                      <MapPin
                        className={cn(
                          "h-4 w-4",
                          requiresLocation ? "text-primary" : "text-text-muted"
                        )}
                      />
                      <div>
                        <div className="text-xs font-medium">{t("create.locationAccess")}</div>
                        <div className="text-[10px] text-text-muted">
                          {t("create.locationAccessDescription")}
                        </div>
                      </div>
                    </div>
                    <Switch
                      checked={requiresLocation}
                      onCheckedChange={setRequiresLocation}
                    />
                  </div>
                </div>
              )}

              {step === "tools" && (
                <TooltipProvider delay={300}>
                <div className="space-y-3">
                  {groupIntegrationTools(toolCatalog).length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      {t("toolsTab.empty")}
                    </p>
                  ) : (
                    groupIntegrationTools(toolCatalog).map((group) => {
                      const enabledCount = group.tools.filter((tool) =>
                        selectedTools.includes(tool.name)
                      ).length;
                      const allEnabled = enabledCount === group.tools.length;
                      const expanded = expandedToolGroups.has(group.key);
                      const groupNames = group.tools.map((tool) => tool.name);
                      return (
                        <div
                          key={group.key}
                          className="rounded-lg border border-border"
                        >
                          {/* Header is the control: one switch for the whole
                              group; the chevron expands per-tool switches. */}
                          <div className="flex items-center gap-2 px-3 py-2">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedToolGroups((prev) => {
                                  const copy = new Set(prev);
                                  if (copy.has(group.key)) copy.delete(group.key);
                                  else copy.add(group.key);
                                  return copy;
                                })
                              }
                              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                            >
                              {expanded ? (
                                <ChevronDown className="w-3 h-3 shrink-0 text-text-muted" />
                              ) : (
                                <ChevronRight className="w-3 h-3 shrink-0 text-text-muted" />
                              )}
                              <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
                                {t(group.labelKey)}
                              </span>
                              <span
                                className={cn(
                                  "text-[10px] tabular-nums",
                                  enabledCount > 0
                                    ? "text-primary"
                                    : "text-text-muted/70"
                                )}
                              >
                                {enabledCount}/{group.tools.length}
                              </span>
                            </button>
                            {group.credentialProvider &&
                              (wizardConnections[group.credentialProvider] ===
                              true ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-px text-[9px] uppercase tracking-wide text-muted-foreground">
                                  <Check className="w-2.5 h-2.5 text-success" />
                                  {t("toolsTab.connected")}
                                </span>
                              ) : wizardConnections[group.credentialProvider] ===
                                false ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-5 px-2 text-[9px]"
                                  onClick={() =>
                                    void handleWizardConnect(
                                      group.credentialProvider!
                                    )
                                  }
                                >
                                  {t("settings:connections.connectProvider", {
                                    provider: PROVIDER_LABELS[
                                      group.credentialProvider
                                    ],
                                  })}
                                </Button>
                              ) : null)}
                            <Switch
                              checked={allEnabled}
                              onCheckedChange={(next) =>
                                setSelectedTools((prev) =>
                                  next
                                    ? [
                                        ...prev,
                                        ...groupNames.filter(
                                          (n) => !prev.includes(n)
                                        ),
                                      ]
                                    : prev.filter((n) => !groupNames.includes(n))
                                )
                              }
                            />
                          </div>
                          {expanded && (
                            <div className="divide-y divide-border border-t border-border">
                              {group.tools.map((tool) => {
                                const checked = selectedTools.includes(tool.name);
                                return (
                                  <label
                                    key={tool.id}
                                    className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 hover:bg-accent/50 transition-colors"
                                  >
                                    <div className="min-w-0">
                                      <p className="text-xs font-medium">
                                        {tool.displayName || tool.name}
                                      </p>
                                      {tool.description && (
                                        <Tooltip>
                                          <TooltipTrigger
                                            render={
                                              <p className="text-[11px] text-text-muted line-clamp-1 cursor-default text-left">
                                                {tool.description}
                                              </p>
                                            }
                                          />
                                          <TooltipContent
                                            side="bottom"
                                            align="start"
                                            className="max-w-sm whitespace-normal text-left leading-snug"
                                          >
                                            {tool.description}
                                          </TooltipContent>
                                        </Tooltip>
                                      )}
                                    </div>
                                    <Switch
                                      checked={checked}
                                      onCheckedChange={(next) =>
                                        setSelectedTools((prev) =>
                                          next
                                            ? [...prev, tool.name]
                                            : prev.filter((n) => n !== tool.name)
                                        )
                                      }
                                    />
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
                </TooltipProvider>
              )}

              {step === "brain" && (
                <div className="space-y-4">
                  {/* Hosted/local picker is visible to everyone; without the
                      hosted runtime unlocked the hosted card is disabled with
                      a "coming soon" note and the agent runs locally. */}
                  <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={!canHost}
                          onClick={() => setHosting("hosted")}
                          className={cn(
                            "rounded-lg border p-3 text-left transition-colors",
                            !canHost
                              ? "cursor-not-allowed border-border opacity-60"
                              : hosting === "hosted"
                                ? "border-primary ring-1 ring-primary"
                                : "border-border hover:border-foreground/30"
                          )}
                        >
                          <div className="flex items-center gap-1.5 text-sm font-medium">
                            ☁️ {t("hosting.hosted")}
                            {!canHost && (
                              <span className="rounded-full bg-muted px-1.5 py-px text-[9px] uppercase tracking-wide text-muted-foreground">
                                {t("create.hostedComingSoon")}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-xs text-text-muted">
                            {t("create.hostedDescription")}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setHosting("local")}
                          className={cn(
                            "rounded-lg border p-3 text-left transition-colors",
                            hosting === "local"
                              ? "border-primary ring-1 ring-primary"
                              : "border-border hover:border-foreground/30"
                          )}
                        >
                          <div className="text-sm font-medium">
                            {t("hosting.local")}
                          </div>
                          <div className="mt-0.5 text-xs text-text-muted">
                            {t("create.localDescription")}
                          </div>
                        </button>
                      </div>
                  </div>

                  {hosting === "hosted" && (
                    <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-text-muted">
                      {t("create.hostedInfo")}
                    </div>
                  )}

                  {hosting === "local" && (
                  <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>{t("common:provider")}</Label>
                      <Select
                        value={backend}
                        onValueChange={(v) => handleBackendChange(v ?? "")}
                      >
                        <SelectTrigger className="w-full">
                          {/* Base UI renders the raw value unless given a
                              render fn — map back to the display label. */}
                          <SelectValue>
                            {(val: unknown) =>
                              PROVIDERS.find((p) => p.id === String(val))
                                ?.label ?? String(val ?? "")
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {PROVIDERS.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>{t("common:model")}</Label>
                      <Select
                        value={model}
                        onValueChange={(v) => v && setModel(v)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue>
                            {(val: unknown) =>
                              models.find((m) => m.id === String(val))?.label ??
                              String(val ?? "")
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {models.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div
                    className={cn(
                      "grid gap-3",
                      showEffort ? "grid-cols-2" : "grid-cols-1"
                    )}
                  >
                    <div className="space-y-1.5">
                      <Label>{t("executionMode")}</Label>
                      <Select
                        value={executionMode}
                        onValueChange={(v) => v && setExecutionMode(v)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue>
                            {(val: unknown) => {
                              const mode = EXECUTION_MODES.find(
                                (m) => m.id === String(val)
                              );
                              return mode ? t(mode.labelKey) : String(val ?? "");
                            }}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {EXECUTION_MODES.filter((m) =>
                            supportedModes.includes(m.id)
                          ).map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {t(m.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {showEffort && (
                      <div className="space-y-1.5">
                        <Label>{t("effortLabel")}</Label>
                        <Select
                          value={effort || "high"}
                          onValueChange={(v) => v && setEffort(v)}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue>
                              {(val: unknown) => {
                                const level = EFFORT_LEVELS.find(
                                  (e) => e.id === String(val)
                                );
                                return level
                                  ? t(level.labelKey)
                                  : String(val ?? "");
                              }}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {EFFORT_LEVELS.map((e) => (
                              <SelectItem key={e.id} value={e.id}>
                                {t(e.labelKey)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>

                  {needsApiKey && hasDefaultKey && (
                    <div className="space-y-1.5">
                      <Label>{t("create.providerApiKey", { provider: providerLabel })}</Label>
                      <Select
                        value={keySelection}
                        onValueChange={(v) => {
                          setKeySelection(String(v));
                          if (v !== "__custom__") setApiKey("");
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue>
                            {(val: unknown) => {
                              const v = String(val);
                              if (v === "__default__") return t("create.keyOptions.providerDefault");
                              if (v === "__custom__") return t("create.keyOptions.customForAgent");
                              return providerKeys.find((k) => k.id === v)?.label ?? v;
                            }}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__default__">{t("create.keyOptions.providerDefault")}</SelectItem>
                          {providerKeys
                            .filter((k) => !k.isDefault)
                            .map((k) => (
                              <SelectItem key={k.id} value={k.id}>
                                {k.label}
                              </SelectItem>
                            ))}
                          <SelectItem value="__custom__">{t("create.keyOptions.customForAgent")}</SelectItem>
                        </SelectContent>
                      </Select>
                      {keySelection === "__default__" && (
                        <p className="text-xs text-text-muted">
                          {t("create.keyOptions.usesDefaultHint")}
                        </p>
                      )}
                      {keySelection !== "__default__" && keySelection !== "__custom__" && (
                        <p className="text-xs text-text-muted">
                          {t("create.keyOptions.pinnedHint")}
                        </p>
                      )}
                    </div>
                  )}

                  {showApiKeyInput && (
                    <div className="space-y-1.5">
                      <Label htmlFor="llm-api-key">
                        {hasDefaultKey
                          ? t("create.newKeyThisAgent")
                          : t("create.providerApiKey", { provider: providerLabel })}
                      </Label>
                      <div className="relative">
                        <Input
                          id="llm-api-key"
                          type={showApiKey ? "text" : "password"}
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          placeholder="sk-..."
                          required
                          className="pr-10 font-mono text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => setShowApiKey((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-foreground"
                        >
                          {showApiKey ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                      <p className="text-xs text-text-muted">
                        {hasDefaultKey
                          ? t("create.keySavedThisAgentHint")
                          : t("create.keySavedAsDefaultHint", { provider: providerLabel })}
                      </p>
                    </div>
                  )}

                  {/* Skip-permissions is a CLI-backend feature
                      (Claude Code: --dangerously-skip-permissions,
                      Codex: --dangerously-bypass-approvals-and-sandbox).
                      The plain Anthropic/OpenAI APIs have no permission
                      prompts to skip. */}
                  {(backend === "claude_cli" || backend === "codex_cli") && (
                    <label className="flex items-start gap-2.5 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={skipPermissions}
                        onChange={(e) => setSkipPermissions(e.target.checked)}
                        className="mt-0.5 rounded border-border"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground group-hover:text-accent-hover transition-colors">
                          <ShieldOff className="w-3.5 h-3.5" />
                          {t("create.skipPermissions")}
                        </div>
                        <p className="text-xs text-text-muted mt-0.5">
                          {t("create.skipPermissionsDescription")}
                        </p>
                      </div>
                    </label>
                  )}

                  {/* Computer use is a claude_cli-only capability today.
                      Hosted (Anthropic API), OpenAI, and Codex backends
                      don't run through our local MCP server. */}
                  {backend === "claude_cli" && (
                    <label className="flex items-start gap-2.5 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={computerUseEnabled}
                        onChange={(e) => setComputerUseEnabled(e.target.checked)}
                        className="mt-0.5 rounded border-border"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground group-hover:text-accent-hover transition-colors">
                          <ShieldOff className="w-3.5 h-3.5" />
                          {t("create.computerUse")}
                        </div>
                        <p className="text-xs text-text-muted mt-0.5">
                          <Trans
                            t={t}
                            i18nKey="create.computerUseDescription"
                            components={{ code: <code /> }}
                          />
                        </p>
                      </div>
                    </label>
                  )}
                  </>
                  )}
                </div>
              )}

              {step === "review" && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-border p-3">
                    <div className="flex items-start gap-3">
                      <Avatar className="h-12 w-12 shrink-0 rounded-full border border-border">
                        {avatarUrl && (
                          <AvatarImage
                            src={avatarUrl}
                            className="rounded-full object-cover"
                          />
                        )}
                        <AvatarFallback className="rounded-full bg-primary/5 text-text-muted">
                          {initials || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">
                          {displayName || t("common:untitled")}
                        </div>
                        {description && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-text-muted">
                            {description}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-1">
                          {(tone || customTone) && (
                            <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] text-accent-foreground">
                              {tone
                                ? t(`tones.${tone}`, {
                                    defaultValue: TONES.find((tn) => tn.key === tone)?.label,
                                  })
                                : customTone}
                            </span>
                          )}
                          {allSpecialties.slice(0, 4).map((s) => (
                            <span
                              key={s}
                              className="rounded-full bg-accent px-2 py-0.5 text-[10px] text-accent-foreground"
                            >
                              {t(`create.specialtyOptions.${specialtySlug(s)}`, {
                                defaultValue: s,
                              })}
                            </span>
                          ))}
                          {allSpecialties.length > 4 && (
                            <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] text-accent-foreground">
                              +{allSpecialties.length - 4}
                            </span>
                          )}
                          {requiresLocation && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-accent px-2 py-0.5 text-[10px] text-accent-foreground">
                              <MapPin className="h-2.5 w-2.5" /> {t("nav:location")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border p-3 space-y-1.5 text-xs">
                    <ReviewRow label={t("create.review.brain")} value={`${providerLabel ?? "—"} · ${models.find((m) => m.id === model)?.label ?? model ?? "—"}`} />
                    <ReviewRow
                      label={t("create.review.mode")}
                      value={(() => {
                        const foundMode = EXECUTION_MODES.find(
                          (m) => m.id === executionMode
                        );
                        return foundMode ? t(foundMode.labelKey) : executionMode;
                      })()}
                    />
                    {showEffort && (
                      <ReviewRow
                        label={t("effortLabel")}
                        value={(() => {
                          const foundEffort = EFFORT_LEVELS.find(
                            (e) => e.id === (effort || "high")
                          );
                          return foundEffort
                            ? t(foundEffort.labelKey)
                            : effort ?? "high";
                        })()}
                      />
                    )}
                    <ReviewRow
                      label={t("create.review.key")}
                      value={
                        keySelection === "__custom__" || (showApiKeyInput && !hasDefaultKey)
                          ? t("create.review.customKeyThisAgent")
                          : keySelection === "__default__"
                            ? t("create.review.providerDefaultValue", { provider: providerLabel ?? backend })
                            : providerKeys.find((k) => k.id === keySelection)?.label ??
                              t("create.review.pinnedKey")
                      }
                    />
                    {skipPermissions && (
                      <ReviewRow label={t("create.review.safety")} value={t("create.skipPermissions")} />
                    )}
                    {computerUseEnabled && (
                      <ReviewRow
                        data-testid="review-computer-use"
                        label={t("create.review.computerUse")}
                        value={t("create.review.computerUseAllowed")}
                      />
                    )}
                    {selectedTools.length > 0 && (
                      <ReviewRow
                        label={t("create.review.toolsLabel")}
                        value={t("create.review.toolsCount", {
                          count: selectedTools.length,
                        })}
                      />
                    )}
                  </div>

                  {workspacesEnabled && (
                    <VisibilityChoice
                      value={visibilityOrgIds}
                      onChange={setVisibilityOrgIds}
                    />
                  )}
                </div>
              )}

              {error && (
                <p className="text-xs text-destructive" role="alert">
                  {error}
                </p>
              )}
            </form>
          </div>

          {/* Footer */}
          <div className="relative px-6 py-4 border-t border-border bg-background/80 backdrop-blur-sm flex items-center justify-between">
            {!isFirst ? (
              <Button
                type="button"
                variant="ghost"
                onClick={handleBack}
                disabled={creating}
              >
                <ArrowLeft className="w-4 h-4" />
                {t("common:back")}
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                disabled={creating}
              >
                {t("common:cancel")}
              </Button>
            )}

            {/* The preset step advances by picking a card, so no Next. */}
            {step !== "preset" && (
              <Button
                type="button"
                onClick={handleNext}
                disabled={!canNext || creating || (isLast && PROVIDERS.length === 0)}
              >
                {creating && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                {isLast
                  ? creating
                    ? t("create.creatingLabel")
                    : t("create.createAgent")
                  : t("common:next")}
                {!isLast && !creating && <ArrowRight className="ml-1 h-3 w-3" />}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Workspace visibility on the review step: All workspaces
 * (organizationIds omitted — the agent follows the owner everywhere,
 * the default) or a selected SET of workspaces. Mirrors the
 * VisibilityField on the agent config Profile tab.
 */
function VisibilityChoice({
  value,
  onChange,
}: {
  value: string[] | null;
  onChange: (v: string[] | null) => void;
}) {
  const { t } = useTranslation("agents");
  const allWorkspaces = useWorkspaces();
  const personal = allWorkspaces.find((w) => w.isPersonal);

  const toggle = (id: string) => {
    const current = value ?? [];
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id];
    onChange(next.length === 0 ? null : next);
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{t("visibility.label")}</Label>
      <div className="space-y-1.5 rounded-lg border border-border p-2.5">
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={value === null}
            onChange={() =>
              value === null
                ? onChange(personal ? [personal.id] : [])
                : onChange(null)
            }
            className="h-3.5 w-3.5 accent-primary"
          />
          {t("visibility.all")}
        </label>
        <div className="ml-5 space-y-1 border-l border-border pl-3">
          {allWorkspaces.map((w) => (
            <label
              key={w.id}
              className={cn(
                "flex items-center gap-2 text-xs",
                value === null ? "cursor-not-allowed opacity-50" : "cursor-pointer"
              )}
            >
              <input
                type="checkbox"
                disabled={value === null}
                checked={value !== null && value.includes(w.id)}
                onChange={() => toggle(w.id)}
                className="h-3.5 w-3.5 accent-primary"
              />
              {w.name}
            </label>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-text-muted">
        {value === null ? t("visibility.allHint") : t("visibility.selectedHint")}
      </p>
    </div>
  );
}

function ReviewRow({
  label,
  value,
  "data-testid": testId,
}: {
  label: string;
  value: string;
  "data-testid"?: string;
}) {
  return (
    <div className="flex items-center justify-between" data-testid={testId}>
      <span className="text-text-muted">{label}</span>
      <span className="font-medium truncate ml-3">{value}</span>
    </div>
  );
}
