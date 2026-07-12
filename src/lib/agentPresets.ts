import { useEffect, useState } from "react";
import { request } from "./api";
import type { AgentType, ToneKey } from "./buildSoulMd";

/**
 * Preset starting points for the Create Agent wizard. A preset is nothing
 * more than a named bundle of the wizard's existing state fields — picking
 * one pre-seeds role/tone/specialties/description/instructions, and every
 * later step stays fully editable. `instructions` flows into the soul via
 * buildSoulMd's "Additional Instructions" block.
 *
 * The catalog is served by the backend (`GET /api/agents/presets`,
 * `Agentchat.AgentPresets`) — the single source of truth shared by web,
 * desktop, and mobile. Nothing here is hardcoded; we only fetch, cache, and
 * derive the i18n key names from each preset's `id`.
 *
 * UI copy (label/tagline/name placeholder) lives in the `agents` i18n
 * namespace under `create.presets.<id>.*`. The instruction/description
 * seeds are English on purpose: they're LLM prompt material (like every
 * soul in the system), not user-facing chrome.
 *
 * Google-backed presets don't need anything special ON the agent — the
 * Google tools resolve the OWNER's credential at call time — so
 * `requiresGoogle` only drives the post-create "connect Google" pane.
 */
export interface AgentPreset {
  id: "assistant" | "email" | "calendar" | "research";
  labelKey: string;
  taglineKey: string;
  namePlaceholderKey: string;
  role: AgentType;
  tone: ToneKey;
  /** Default model (claude_cli catalog id) — applied on preset pick, still
   *  changeable on the brain step. Absent → the wizard's scratch default. */
  model?: string;
  /** Mixed list — entries found in SPECIALTIES_BY_ROLE[role].options land in
   *  `specialties`, the rest in `customSpecialties`. */
  specialties: string[];
  description: string;
  instructions: string;
  requiresGoogle?: boolean;
  /** Platform integration tools (agent_tools rows, matched by name) to
   *  assign to the agent right after creation. Integration tools are
   *  scope "agent" — WITHOUT an assignment they never appear in the
   *  agent's tool list, no matter what the soul says or whether the
   *  owner connected the provider. */
  tools?: string[];
}

/** Raw wire shape from `GET /api/agents/presets` — camelCase, config only.
 *  UI key names are derived client-side from `id`. */
interface PresetWire {
  id: AgentPreset["id"];
  role: AgentType;
  tone: ToneKey;
  model?: string | null;
  specialties: string[];
  description: string;
  instructions: string;
  requiresGoogle: boolean;
  tools: string[];
}

function fromWire(p: PresetWire): AgentPreset {
  return {
    id: p.id,
    labelKey: `create.presets.${p.id}.label`,
    taglineKey: `create.presets.${p.id}.tagline`,
    namePlaceholderKey: `create.presets.${p.id}.namePlaceholder`,
    role: p.role,
    tone: p.tone,
    model: p.model ?? undefined,
    specialties: p.specialties,
    description: p.description,
    instructions: p.instructions,
    requiresGoogle: p.requiresGoogle,
    tools: p.tools,
  };
}

let cache: AgentPreset[] | null = null;
let pending: Promise<AgentPreset[]> | null = null;

export async function getAgentPresets(): Promise<AgentPreset[]> {
  if (cache) return cache;
  if (pending) return pending;

  pending = request<{ presets: PresetWire[] }>("/api/agents/presets")
    .then((res) => {
      cache = res.presets.map(fromWire);
      return cache;
    })
    .catch(() => {
      // No offline fallback: the presets are optional scaffolding for the
      // wizard, and the "Start from scratch" path always works. An empty
      // catalog simply hides the preset cards.
      cache = [];
      return cache;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

export function resetAgentPresetsCache(): void {
  cache = null;
  pending = null;
}

export function useAgentPresets(): AgentPreset[] {
  const [presets, setPresets] = useState<AgentPreset[]>(cache ?? []);

  useEffect(() => {
    if (cache) {
      if (cache !== presets) setPresets(cache);
      return;
    }
    getAgentPresets().then(setPresets);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return presets;
}
