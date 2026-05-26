import { create } from "zustand";
import * as api from "../lib/api";

export interface CatalogModel {
  id: string;
  label: string;
  /** Local-CLI-backend models (claude_cli/codex_cli) carry a whitelist of
   *  runtimes — "anthropic" / "bedrock" / "vertex" — where the underlying
   *  CLI install can actually call them. Absent on API-backend models;
   *  the dropdown filter is a no-op there. */
  cliConnections?: string[];
}

export interface CatalogProvider {
  id: string;
  label: string;
  requiresLlmKey: boolean;
  supportedModes: string[];
  models: CatalogModel[];
}

interface ModelCatalogState {
  providers: CatalogProvider[];
  loaded: boolean;
  loading: boolean;
  ensureLoaded: () => Promise<void>;
  modelsFor: (providerId: string) => CatalogModel[];
  /** Same as modelsFor but filtered to models supported on the given
   *  CLI runtime. Pass null/undefined to skip filtering. */
  modelsForConnection: (
    providerId: string,
    cliConnection: string | null | undefined,
  ) => CatalogModel[];
  supportedModesFor: (providerId: string) => string[];
  requiresLlmKey: (providerId: string) => boolean;
  providerLabel: (id: string) => string;
}

let inflight: Promise<void> | null = null;

export const useModelCatalog = create<ModelCatalogState>((set, get) => ({
  providers: [],
  loaded: false,
  loading: false,

  ensureLoaded: async () => {
    if (get().loaded || get().loading) {
      return inflight ?? Promise.resolve();
    }
    set({ loading: true });
    inflight = api
      .request<{ providers: CatalogProvider[] }>("/api/models/providers")
      .then((data) => {
        set({ providers: data.providers ?? [], loaded: true, loading: false });
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.warn("[modelCatalog] failed to load", e);
        set({ loading: false });
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  },

  modelsFor: (providerId) => {
    const p = get().providers.find((p) => p.id === providerId);
    return p?.models ?? [];
  },

  modelsForConnection: (providerId, cliConnection) => {
    const all = get().modelsFor(providerId);
    if (!cliConnection) return all;
    return all.filter((m) => {
      // Models without a whitelist (every API-backend model, plus any
      // CLI model we forgot to tag) stay — let the runtime call surface
      // a real error rather than silently hiding the option.
      if (!m.cliConnections || m.cliConnections.length === 0) return true;
      return m.cliConnections.includes(cliConnection);
    });
  },

  supportedModesFor: (providerId) => {
    const p = get().providers.find((p) => p.id === providerId);
    return p?.supportedModes ?? ["single_shot"];
  },

  requiresLlmKey: (providerId) => {
    const p = get().providers.find((p) => p.id === providerId);
    return p?.requiresLlmKey ?? true;
  },

  providerLabel: (id) => {
    const p = get().providers.find((p) => p.id === id);
    return p?.label ?? id;
  },
}));
