import { create } from "zustand";
import * as api from "../lib/api";

export interface CatalogModel {
  id: string;
  label: string;
  /** CLI-backend models carry per-runtime API IDs:
   *    { anthropic: "claude-opus-4-7",
   *      bedrock: "anthropic.claude-opus-4-7",
   *      vertex: "claude-opus-4-7" }
   *  Used by the org config UI for picking which runtimes a model is
   *  available on. The model dropdown is filtered server-side. */
  runtimes?: Record<string, string>;
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
