import { create } from "zustand";
import * as api from "../lib/api";
import { useAuthStore } from "./authStore";

interface OrgState {
  /** The user's current org. MVP: one human, one org. */
  organization: api.Organization | null;
  /** Hosts registered to the current org. Empty when the org has none yet. */
  hosts: api.OrganizationHost[];
  loading: boolean;
  error: string | null;
  /** True after the first successful fetch, regardless of whether the user
   *  is in an org. Lets UI gate "create org" vs "loading…" cleanly. */
  loaded: boolean;

  fetchCurrentOrg: () => Promise<void>;
  createOrg: (name: string, slug: string) => Promise<api.Organization>;
  fetchHosts: () => Promise<void>;
  /** Registers a new host on the current org and returns the plaintext
   *  API key. The caller is responsible for handing that key to the VM
   *  operator — it's only available once. */
  registerHost: (name: string) => Promise<api.CreateHostResult>;

  reset: () => void;
}

export const useOrgStore = create<OrgState>((set, get) => ({
  organization: null,
  hosts: [],
  loading: false,
  error: null,
  loaded: false,

  fetchCurrentOrg: async () => {
    // Capture the token now so a logout that fires while we're awaiting
    // doesn't write the previous user's org into the post-logout store.
    const startedFor = useAuthStore.getState().token;
    if (!startedFor) return;

    set({ loading: true, error: null });
    try {
      const orgs = await api.listOrganizations();
      if (useAuthStore.getState().token !== startedFor) return;

      const organization = orgs[0] ?? null;
      set({ organization, loaded: true, loading: false });
      if (organization) {
        await get().fetchHosts();
      } else {
        set({ hosts: [] });
      }
    } catch (e) {
      if (useAuthStore.getState().token !== startedFor) return;
      set({
        loading: false,
        loaded: true,
        error: e instanceof Error ? e.message : "Failed to load organization",
      });
    }
  },

  createOrg: async (name, slug) => {
    set({ loading: true, error: null });
    try {
      const organization = await api.createOrganization(name, slug);
      set({ organization, hosts: [], loading: false, loaded: true });
      return organization;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to create organization";
      set({ loading: false, error: message });
      throw e;
    }
  },

  fetchHosts: async () => {
    const org = get().organization;
    if (!org) {
      set({ hosts: [] });
      return;
    }
    try {
      const hosts = await api.listOrganizationHosts(org.id);
      set({ hosts });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "Failed to load hosts",
      });
    }
  },

  registerHost: async (name) => {
    const org = get().organization;
    if (!org) {
      throw new Error("No current organization");
    }
    const result = await api.createOrganizationHost(org.id, name);
    set({ hosts: [...get().hosts, result.host] });
    return result;
  },

  reset: () => set({
    organization: null,
    hosts: [],
    loading: false,
    error: null,
    loaded: false,
  }),
}));
