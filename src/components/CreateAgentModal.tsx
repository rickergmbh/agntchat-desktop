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

// i18n keys (agents namespace) — resolved with t() at render so language
// switches take effect live.
const STEP_TITLE_KEYS: Record<WizardStep, string> = {
  name: "create.steps.name.title",
  photo: "create.steps.photo.title",
  role: "create.steps.role.title",
  tone: "create.steps.tone.title",
  specialties: "create.steps.specialties.title",
  details: "create.steps.details.title",
  brain: "create.steps.brain.title",
  review: "create.steps.review.title",
};

const STEP_SUBTITLE_KEYS: Record<WizardStep, string> = {
  name: "create.steps.name.subtitle",
  photo: "create.steps.photo.subtitle",
  role: "create.steps.role.subtitle",
  tone: "create.steps.tone.subtitle",
  specialties: "create.steps.specialties.subtitle",
  details: "create.steps.details.subtitle",
  brain: "create.steps.brain.subtitle",
  review: "create.steps.review.subtitle",
};

export function CreateAgentModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("agents");
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
      setError(err instanceof Error ? err.message : t("create.errors.createFailed"));
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
                  text={t(STEP_TITLE_KEYS[step])}
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
                    placeholder={t("create.namePlaceholder")}
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
                      placeholder={t(
                        agentRole === "orchestrator"
                          ? "create.descPlaceholder.orchestrator"
                          : agentRole === "reviewer"
                            ? "create.descPlaceholder.reviewer"
                            : agentRole === "observer"
                              ? "create.descPlaceholder.observer"
                              : "create.descPlaceholder.worker"
                      )}
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
                          <div className="text-sm font-medium">☁️ {t("hosting.hosted")}</div>
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
                            {t("hosting.local")}{" "}
                            <span className="text-text-muted">{t("create.localAdvancedTag")}</span>
                          </div>
                          <div className="mt-0.5 text-xs text-text-muted">
                            {t("create.localDescription")}
                          </div>
                        </button>
                      </div>
                    </div>
                  )}

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
                      <Label>{t("common:model")}</Label>
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
                      <Label>{t("executionMode")}</Label>
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
                            <SelectValue />
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
                  </div>

                  {workspacesEnabled && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t("create.visibility.label")}</Label>
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
                        <span className="text-xs font-medium">{t("create.visibility.personal")}</span>
                        <span className="text-[10px] text-text-muted">
                          {t("create.visibility.personalDescription")}
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
                          {t("create.visibility.pinnedTo", {
                            workspace:
                              activeWorkspace && !activeWorkspace.isPersonal
                                ? activeWorkspace.name
                                : t("create.visibility.thisWorkspace"),
                          })}
                        </span>
                        <span className="text-[10px] text-text-muted">
                          {activeWorkspace && !activeWorkspace.isPersonal
                            ? t("create.visibility.onlyThisWorkspace")
                            : t("create.visibility.switchToShared")}
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
