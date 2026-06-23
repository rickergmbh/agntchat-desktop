import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import { useAgentStore } from "../stores/agentStore";
import { useAuthStore } from "../stores/authStore";
import { useActiveWorkspace } from "../stores/workspaceStore";
import { updateAgentRuntime } from "../lib/api";
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
  "name",
  "photo",
  "role",
  "tone",
  "specialties",
  "details",
  "brain",
  "review",
] as const;
type WizardStep = (typeof STEPS)[number];

const STEP_TITLES: Record<WizardStep, string> = {
  name: "What should we call your agent?",
  photo: "Give them a face",
  role: "How should they work?",
  tone: "How should they talk?",
  specialties: "What are they good at?",
  details: "Any extra details?",
  brain: "Pick a brain",
  review: "Ready to launch?",
};

const STEP_SUBTITLES: Record<WizardStep, string> = {
  name: "Pick something memorable — you can always change it later.",
  photo: "Optional, but it makes them feel more real.",
  role: "Set the rhythm. You can change this later.",
  tone: "How they sound when they talk to you.",
  specialties: "The things they should be good at.",
  details: "Anything else worth telling them up front.",
  brain: "Which AI model powers them.",
  review: "Last look before we bring them online.",
};

export function CreateAgentModal({ onClose }: { onClose: () => void }) {
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

  // ---- Step state ----
  const [stepIndex, setStepIndex] = useState(0);
  const step: WizardStep = STEPS[stepIndex] ?? "name";

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
  // visibility — Personal (default) is cross-workspace, Workspace pins
  // to the user's currently-active workspace. Backend rejects pinning
  // anywhere else, so there's no picker.
  const [visibility, setVisibility] = useState<"personal" | "workspace">("personal");
  const activeWorkspace = useActiveWorkspace();
  // brain — backend / model / execution mode / effort / key / safety
  const [backend, setBackend] = useState("claude_cli");
  const [model, setModel] = useState("");
  const [executionMode, setExecutionMode] = useState("tool_use");
  const [effort, setEffort] = useState<string | null>(null);
  const [skipPermissions, setSkipPermissions] = useState(false);
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
  const workspacesEnabled = participant?.features?.workspaces === true;
  const subStatus = participant?.subscription?.status;
  const isPlan = subStatus === "active" || subStatus === "trialing";
  const hostedHostId = participant?.hostedHostId ?? null;
  const canHost = isPlan && !!hostedHostId;
  const [hosting, setHosting] = useState<"hosted" | "local">(
    canHost ? "hosted" : "local"
  );

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Once the catalog resolves, default backend/model to the first
  // option if the current backend isn't actually available. Keeps the
  // initial "claude_cli" guess if it IS in the catalog.
  useEffect(() => {
    if (PROVIDERS.length === 0) return;
    if (PROVIDERS.some((p) => p.id === backend)) {
      if (!model) {
        setModel(catalog.modelsFor(backend)[0]?.id ?? "");
      }
      return;
    }
    const first = PROVIDERS[0];
    if (!first) return;
    setBackend(first.id);
    setModel(catalog.modelsFor(first.id)[0]?.id ?? "");
  }, [PROVIDERS, backend, model, catalog]);

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
    const newModels = catalog.modelsFor(next);
    if (newModels.length > 0) {
      setModel(newModels[0]?.id ?? "");
    } else {
      setModel("");
    }
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

  const canNext = useMemo(() => {
    if (step === "name") return displayName.trim().length > 0;
    return true;
  }, [step, displayName]);

  const isLast = step === "review";
  const isFirst = step === "name";

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
      setError(e instanceof Error ? e.message : "Upload failed");
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
      setError("Name is required");
      setStepIndex(0);
      return;
    }
    // Hosted agents use the host's shared brain — no API key to enter.
    if (hosting === "local" && showApiKeyInput && !apiKey.trim()) {
      setError("API key is required for this provider");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      // Hosted agents run on the org host with its shared Claude seat, so we
      // pin sensible defaults (claude_cli) and skip per-agent key handling.
      const hosted = hosting === "hosted";
      const effBackend = hosted ? "claude_cli" : backend;
      // Default hosted agents to Opus 4.8 (not the catalog's first entry,
      // Fable 5) — fall back to the first available hosted model if Opus 4.8
      // isn't in the catalog for some reason.
      const hostedModels = catalog.modelsFor("claude_cli");
      const effModel = hosted
        ? hostedModels.find((m) => m.id === "claude-opus-4-8")?.id ??
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
            setError(e instanceof Error ? e.message : "Failed to save the API key");
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
        // Workspace pin (only when user explicitly picked it AND we're
        // in a non-Personal workspace — UI gates the toggle on this
        // already so backend's not_active_workspace guard shouldn't fire).
        ...(visibility === "workspace" && activeWorkspace && !activeWorkspace.isPersonal
          ? { organizationId: activeWorkspace.id }
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

      if (newId) await selectAgent(newId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setCreating(false);
    }
  }, [
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
    visibility,
  ]);

  const initials = displayName
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const providerLabel = PROVIDERS.find((p) => p.id === backend)?.label;

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
                  text={STEP_TITLES[step]}
                  delayPerChar={28}
                />
              </DialogTitle>
              <p className="text-sm text-text-muted min-h-[2.5em]">
                {STEP_SUBTITLES[step]}
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
              {step === "name" && (
                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between">
                    <Label htmlFor="agent-name">Name</Label>
                    <span className="text-xs text-text-muted tabular-nums">
                      {displayName.length}/{limits.agent.displayName}
                    </span>
                  </div>
                  <Input
                    id="agent-name"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Atlas, Kal, Finance Bro"
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
                    title="Choose avatar image"
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
                    {avatarUrl ? "Click to change" : "Click to choose a photo (optional)"}
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
                  {agentTypes.map((t) => {
                    const Icon = TYPE_ICONS[t.id] ?? Bot;
                    const selected = agentRole === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setAgentRole(t.id as AgentType);
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
                        <span className="text-xs font-medium">{t.label}</span>
                        <span className="text-[10px] leading-tight text-text-muted">
                          {t.description}
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
                      {TONES.map((t) => {
                        const selected = tone === t.key;
                        return (
                          <button
                            key={t.key}
                            type="button"
                            onClick={() => {
                              setTone(t.key);
                              setCustomTone(null);
                            }}
                            className={cn(
                              "rounded-full border px-3 py-1 text-xs transition-colors",
                              selected
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border hover:bg-accent"
                            )}
                          >
                            {t.label}
                          </button>
                        );
                      })}
                      {customTone && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary px-3 py-1 text-xs text-primary-foreground">
                          {customTone}
                          <button
                            type="button"
                            onClick={() => setCustomTone(null)}
                            aria-label="Remove custom tone"
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
                          <Plus className="h-3 w-3" /> Custom
                        </button>
                      )}
                    </div>
                    {toneAddOpen && (
                      <Input
                        autoFocus
                        value={customToneInput}
                        onChange={(e) => setCustomToneInput(e.target.value)}
                        placeholder="e.g. Sarcastic"
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
                      <Label htmlFor="agent-desc">Description (optional)</Label>
                      <span className="text-xs text-text-muted tabular-nums">
                        {description.length}/{limits.agent.description}
                      </span>
                    </div>
                    <Textarea
                      id="agent-desc"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={
                        agentRole === "orchestrator"
                          ? "What teams or workflows will they coordinate?"
                          : agentRole === "reviewer"
                            ? "What kind of work will they review?"
                            : agentRole === "observer"
                              ? "What are they monitoring, and when should they speak up?"
                              : "What kind of work will this agent handle?"
                      }
                      rows={3}
                      maxLength={limits.agent.description}
                      className="resize-none"
                    />
                  </div>
                </div>
              )}

              {step === "specialties" && (
                <div className="space-y-2">
                  <p className="text-xs text-text-muted">{specialtyCatalog.label}</p>
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
                          {s}
                        </button>
                      );
                    })}
                    {customSpecialties.map((s) => (
                      <span
                        key={s}
                        className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary px-3 py-1 text-xs text-primary-foreground"
                      >
                        {s}
                        <button
                          type="button"
                          onClick={() => removeCustomSpecialty(s)}
                          aria-label={`Remove ${s}`}
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
                      placeholder="Add a specialty"
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
                        Custom instructions (optional)
                      </Label>
                      <span className="text-xs text-text-muted tabular-nums">
                        {customInstructions.length}/2000
                      </span>
                    </div>
                    <Textarea
                      id="agent-instructions"
                      value={customInstructions}
                      onChange={(e) => setCustomInstructions(e.target.value)}
                      placeholder="Anything else this agent should know? Tools to prefer, things to avoid…"
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
                        <div className="text-xs font-medium">Location access</div>
                        <div className="text-[10px] text-text-muted">
                          Lets this agent use your location for local search and recommendations.
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

              {step === "brain" && (
                <div className="space-y-4">
                  {canHost && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setHosting("hosted")}
                          className={cn(
                            "rounded-lg border p-3 text-left transition-colors",
                            hosting === "hosted"
                              ? "border-primary ring-1 ring-primary"
                              : "border-border hover:border-foreground/30"
                          )}
                        >
                          <div className="text-sm font-medium">☁️ Hosted</div>
                          <div className="mt-0.5 text-xs text-text-muted">
                            Always on, powered by your plan. No setup.
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
                            Local{" "}
                            <span className="text-text-muted">(advanced)</span>
                          </div>
                          <div className="mt-0.5 text-xs text-text-muted">
                            Runs on this machine; pick your own model.
                          </div>
                        </button>
                      </div>
                    </div>
                  )}

                  {hosting === "hosted" && (
                    <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-text-muted">
                      Your agent runs always-on in the cloud using your plan's
                      shared brain — nothing else to set up. You can switch it to
                      a custom local model anytime in the agent's settings.
                    </div>
                  )}

                  {hosting === "local" && (
                  <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Provider</Label>
                      <Select
                        value={backend}
                        onValueChange={(v) => handleBackendChange(v ?? "")}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
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
                      <Label>Model</Label>
                      <Select
                        value={model}
                        onValueChange={(v) => v && setModel(v)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
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
                      <Label>Execution Mode</Label>
                      <Select
                        value={executionMode}
                        onValueChange={(v) => v && setExecutionMode(v)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EXECUTION_MODES.filter((m) =>
                            supportedModes.includes(m.id)
                          ).map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {showEffort && (
                      <div className="space-y-1.5">
                        <Label>Effort</Label>
                        <Select
                          value={effort || "high"}
                          onValueChange={(v) => v && setEffort(v)}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {EFFORT_LEVELS.map((e) => (
                              <SelectItem key={e.id} value={e.id}>
                                {e.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>

                  {needsApiKey && hasDefaultKey && (
                    <div className="space-y-1.5">
                      <Label>{providerLabel} API Key</Label>
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
                              if (v === "__default__") return "Provider Default";
                              if (v === "__custom__") return "Custom Key for this agent…";
                              return providerKeys.find((k) => k.id === v)?.label ?? v;
                            }}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__default__">Provider Default</SelectItem>
                          {providerKeys
                            .filter((k) => !k.isDefault)
                            .map((k) => (
                              <SelectItem key={k.id} value={k.id}>
                                {k.label}
                              </SelectItem>
                            ))}
                          <SelectItem value="__custom__">Custom Key for this agent…</SelectItem>
                        </SelectContent>
                      </Select>
                      {keySelection === "__default__" && (
                        <p className="text-xs text-text-muted">
                          Uses your saved default — won't be changed.
                        </p>
                      )}
                      {keySelection !== "__default__" && keySelection !== "__custom__" && (
                        <p className="text-xs text-text-muted">
                          This agent will use the selected key. Default unchanged.
                        </p>
                      )}
                    </div>
                  )}

                  {showApiKeyInput && (
                    <div className="space-y-1.5">
                      <Label htmlFor="llm-api-key">
                        {hasDefaultKey
                          ? "New API Key (this agent only)"
                          : `${providerLabel} API Key`}
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
                          ? "Saved for this agent only — your provider default stays as-is."
                          : `Saved as your default key for ${providerLabel}.`}
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
                          Skip permission prompts
                        </div>
                        <p className="text-xs text-text-muted mt-0.5">
                          Faster but less safe — agents won't ask before running tools.
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
                          Allow computer use
                        </div>
                        <p className="text-xs text-text-muted mt-0.5">
                          Screenshot / click / type / scroll on your Mac.
                          Requires Screen Recording &amp; Accessibility perms.
                          Touch <code>~/.agentgram/computer_use.paused</code> to
                          stop anytime. You can change this later in the
                          agent's Behavior settings.
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
                          {displayName || "Untitled"}
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
                                ? TONES.find((t) => t.key === tone)?.label
                                : customTone}
                            </span>
                          )}
                          {allSpecialties.slice(0, 4).map((s) => (
                            <span
                              key={s}
                              className="rounded-full bg-accent px-2 py-0.5 text-[10px] text-accent-foreground"
                            >
                              {s}
                            </span>
                          ))}
                          {allSpecialties.length > 4 && (
                            <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] text-accent-foreground">
                              +{allSpecialties.length - 4}
                            </span>
                          )}
                          {requiresLocation && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-accent px-2 py-0.5 text-[10px] text-accent-foreground">
                              <MapPin className="h-2.5 w-2.5" /> Location
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border p-3 space-y-1.5 text-xs">
                    <ReviewRow label="Brain" value={`${providerLabel ?? "—"} · ${models.find((m) => m.id === model)?.label ?? model ?? "—"}`} />
                    <ReviewRow
                      label="Mode"
                      value={
                        EXECUTION_MODES.find((m) => m.id === executionMode)
                          ?.label ?? executionMode
                      }
                    />
                    {showEffort && (
                      <ReviewRow
                        label="Effort"
                        value={
                          EFFORT_LEVELS.find((e) => e.id === (effort || "high"))
                            ?.label ?? effort ?? "high"
                        }
                      />
                    )}
                    <ReviewRow
                      label="Key"
                      value={
                        keySelection === "__custom__" || (showApiKeyInput && !hasDefaultKey)
                          ? "Custom (this agent)"
                          : keySelection === "__default__"
                            ? `${providerLabel ?? backend} default`
                            : providerKeys.find((k) => k.id === keySelection)?.label ??
                              "Pinned key"
                      }
                    />
                    {skipPermissions && (
                      <ReviewRow label="Safety" value="Skip permission prompts" />
                    )}
                    {computerUseEnabled && (
                      <ReviewRow
                        data-testid="review-computer-use"
                        label="Computer use"
                        value="Allowed (configure allowed-app list after creation)"
                      />
                    )}
                  </div>

                  {workspacesEnabled && (
                  <div className="space-y-1.5">
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
                        <span className="text-[10px] text-text-muted">
                          Visible in all your workspaces
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (activeWorkspace && !activeWorkspace.isPersonal)
                            setVisibility("workspace");
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
                        <span className="text-[10px] text-text-muted">
                          {activeWorkspace && !activeWorkspace.isPersonal
                            ? "Only visible in this workspace"
                            : "Switch to a shared workspace to pin"}
                        </span>
                      </button>
                    </div>
                  </div>
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
                Back
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                disabled={creating}
              >
                Cancel
              </Button>
            )}

            <Button
              type="button"
              onClick={handleNext}
              disabled={!canNext || creating || (isLast && PROVIDERS.length === 0)}
            >
              {creating && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              {isLast
                ? creating
                  ? "Bringing them to life..."
                  : "Create Agent"
                : "Next"}
              {!isLast && !creating && <ArrowRight className="ml-1 h-3 w-3" />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
