/**
 * Model & provider definitions — single source of truth.
 *
 * Mirrors mobile/lib/normalizeModelName.ts.
 * When adding models, update BOTH files (or extract to a shared package).
 */

export interface ModelOption {
  id: string;
  label: string;
}

export interface ProviderConfig {
  id: string;
  label: string;
  models: ModelOption[];
  /** Execution modes supported by this provider's SDK backend */
  supportedModes: string[];
  /** Whether this provider requires an LLM API key to run */
  requiresLlmKey: boolean;
}

export const PROVIDERS: ProviderConfig[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    requiresLlmKey: true,
    supportedModes: ["single_shot", "tool_use", "code_action"],
    models: [
      // Current (latest generation)
      { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
      { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
      // Previous generation
      { id: "claude-opus-4-5-20251101", label: "Claude Opus 4.5" },
      { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
      { id: "claude-opus-4-1-20250805", label: "Claude Opus 4.1" },
      { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
      { id: "claude-opus-4-20250514", label: "Claude Opus 4" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    requiresLlmKey: true,
    supportedModes: ["single_shot", "tool_use", "code_action"],
    models: [
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4o-mini", label: "GPT-4o Mini" },
      { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
      { id: "gpt-4", label: "GPT-4" },
      { id: "o4-mini", label: "o4 Mini" },
      { id: "o3", label: "o3" },
      { id: "o3-mini", label: "o3 Mini" },
      { id: "o1", label: "o1" },
      { id: "o1-mini", label: "o1 Mini" },
      { id: "o1-preview", label: "o1 Preview" },
    ],
  },
  {
    id: "claude_cli",
    label: "Claude Code",
    requiresLlmKey: false,
    supportedModes: ["single_shot", "tool_use", "code_action"],
    models: [
      { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
      { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    ],
  },
  {
    id: "codex_cli",
    label: "OpenAI Codex",
    requiresLlmKey: false,
    supportedModes: ["single_shot", "tool_use", "code_action"],
    models: [
      { id: "gpt-5.5", label: "GPT-5.5" },
      { id: "gpt-5.4", label: "GPT-5.4" },
      { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
    ],
  },
];

/** Known model ID patterns -> friendly display names.
 *  normalizeModelName() strips date suffixes before lookup,
 *  so "claude-opus-4-6" matches "claude-opus-4-6-20260101" too.
 */
const MODEL_DISPLAY_NAMES: Record<string, string> = {
  // Claude 4.7 (current)
  "claude-opus-4-7": "Claude Opus 4.7",
  // Claude 4.6
  "claude-opus-4-6": "Claude Opus 4.6",
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  // Claude 4.5
  "claude-sonnet-4-5": "Claude Sonnet 4.5",
  "claude-opus-4-5": "Claude Opus 4.5",
  "claude-haiku-4-5": "Claude Haiku 4.5",
  // Claude 4.1
  "claude-opus-4-1": "Claude Opus 4.1",
  // Claude 4.0
  "claude-sonnet-4": "Claude Sonnet 4",
  "claude-opus-4": "Claude Opus 4",
  // Claude 3.x (deprecated/legacy)
  "claude-3-opus": "Claude 3 Opus",
  "claude-3-5-sonnet": "Claude 3.5 Sonnet",
  "claude-3-5-haiku": "Claude 3.5 Haiku",
  "claude-3-haiku": "Claude 3 Haiku",
  "claude-3-sonnet": "Claude 3 Sonnet",
  // OpenAI
  "gpt-5.5": "GPT-5.5",
  "gpt-5.4": "GPT-5.4",
  "gpt-5.3-codex": "GPT-5.3 Codex",
  "gpt-4o": "GPT-4o",
  "gpt-4o-mini": "GPT-4o Mini",
  "gpt-4-turbo": "GPT-4 Turbo",
  "gpt-4": "GPT-4",
  "o1": "o1",
  "o1-mini": "o1 Mini",
  "o1-preview": "o1 Preview",
  "o3": "o3",
  "o3-mini": "o3 Mini",
  "o4-mini": "o4 Mini",
  // xAI
  "grok-3": "Grok 3",
  "grok-3-mini": "Grok 3 Mini",
  "grok-2": "Grok 2",
  // Google
  "gemini-2.0-flash": "Gemini 2.0 Flash",
  "gemini-2.5-pro": "Gemini 2.5 Pro",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "gemini-1.5-pro": "Gemini 1.5 Pro",
  "gemini-1.5-flash": "Gemini 1.5 Flash",
};

const BACKEND_DISPLAY_NAMES: Record<string, string> = {
  claude_cli: "Claude Code",
  codex_cli: "OpenAI Codex",
  openclaw: "OpenClaw",
  anthropic: "Anthropic API",
  openai: "OpenAI API",
  google: "Google AI",
};

export function normalizeModelName(raw: string): string | null {
  if (!raw) return null;
  let cleaned = raw.replace(/^(anthropic|openai|google|meta|mistral)\//i, "");
  cleaned = cleaned.replace(/-\d{4}-?\d{2}-?\d{2}$/, "");
  const friendly = MODEL_DISPLAY_NAMES[cleaned.toLowerCase()];
  if (friendly) return friendly;
  return cleaned;
}

export function formatModelLabel(
  rawModel: string | undefined | null,
  backend?: string | undefined | null,
): string | null {
  const model = normalizeModelName(rawModel || "");
  if (!model) return null;
  const prefix = backend ? BACKEND_DISPLAY_NAMES[backend] : null;
  if (prefix) {
    if (model === prefix) return prefix;
    return `${prefix} · ${model}`;
  }
  return model;
}

export function formatBackendLabel(
  backend: string | undefined | null,
): string | null {
  if (!backend) return null;
  return BACKEND_DISPLAY_NAMES[backend] || backend;
}

export function providerRequiresLlmKey(providerId: string): boolean {
  const provider = PROVIDERS.find((p) => p.id === providerId);
  return provider?.requiresLlmKey ?? true;
}

export function getSupportedModes(providerId: string): string[] {
  const provider = PROVIDERS.find((p) => p.id === providerId);
  return provider?.supportedModes || ["single_shot"];
}

export function getModelsForProvider(providerId: string): ModelOption[] {
  const provider = PROVIDERS.find((p) => p.id === providerId);
  return provider?.models || [];
}

export function getProviderLabel(providerId: string): string {
  const provider = PROVIDERS.find((p) => p.id === providerId);
  return provider?.label || providerId;
}

// Labels/descriptions are i18n KEYS (namespace-qualified), resolved with t()
// at render — never English literals. Ids are the canonical values stored on
// the agent's model_config and must not change.
export const EFFORT_LEVELS = [
  {
    id: "low",
    labelKey: "agents:effort.low.label",
    descriptionKey: "agents:effort.low.description",
  },
  {
    id: "medium",
    labelKey: "agents:effort.medium.label",
    descriptionKey: "agents:effort.medium.description",
  },
  {
    id: "high",
    labelKey: "agents:effort.high.label",
    descriptionKey: "agents:effort.high.description",
  },
  {
    id: "max",
    labelKey: "agents:effort.max.label",
    descriptionKey: "agents:effort.max.description",
  },
];

export const EXECUTION_MODES = [
  {
    id: "single_shot",
    labelKey: "agents:executionModes.single_shot.label",
    descriptionKey: "agents:executionModes.single_shot.description",
  },
  {
    id: "tool_use",
    labelKey: "agents:executionModes.tool_use.label",
    descriptionKey: "agents:executionModes.tool_use.description",
  },
  {
    id: "code_action",
    labelKey: "agents:executionModes.code_action.label",
    descriptionKey: "agents:executionModes.code_action.description",
  },
];
