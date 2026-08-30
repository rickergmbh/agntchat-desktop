import { create } from "zustand";
import { request } from "../lib/api";
import type {
  DirectoryListing,
  AgentConnection,
  AgentRating,
  ConnectionMode,
  ListingConnectionMode,
} from "../lib/api";
import { isFresh } from "../lib/cache";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Stable empty-array references — Zustand selectors that fall back to a
// fresh `[]` literal would invalidate equality on every read, triggering
// re-render storms in components that depend on them.
const EMPTY_LISTINGS: DirectoryListing[] = [];
const EMPTY_CONNECTIONS: AgentConnection[] = [];

interface ListingsResponse {
  listings: DirectoryListing[];
}

interface ListingResponse {
  listing: DirectoryListing;
}

interface ConnectionResponse {
  connection?: AgentConnection;
  connectionMode?: ConnectionMode;
  clonedAgent?: {
    id: string;
    displayName: string;
    apiKey: string;
  };
}

interface RateResponse {
  rating: AgentRating;
  listing: { ratingAvg: number; ratingCount: number };
}

interface ConnectionsResponse {
  connections: AgentConnection[];
}

interface DirectoryState {
  listings: DirectoryListing[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  searchQuery: string;
  connections: AgentConnection[];
  connectionsLoading: boolean;

  fetchDirectory: (opts?: { q?: string }) => Promise<void>;
  fetchMore: () => Promise<void>;
  setSearchQuery: (q: string) => void;
  requestConnection: (
    agentId: string,
    opts?: { mode?: ConnectionMode }
  ) => Promise<ConnectionResponse>;
  revokeConnection: (id: string) => Promise<void>;
  rateAgent: (listingId: string, rating: number, review?: string) => Promise<void>;
  getListing: (id: string) => Promise<DirectoryListing | null>;
  connectionsLoadedAt: number;
  /** @internal in-flight fetch, so concurrent callers share one request */
  _connectionsInflight: Promise<void> | null;
  fetchConnections: () => Promise<void>;
  /** Serve the cached connections unless they've gone stale. The dashboard
   *  asks for these on every mount and it is remounted on every sidebar
   *  switch — the stamp is what stops that becoming a request each time. */
  fetchConnectionsIfStale: () => Promise<void>;
  createListing: (data: {
    agentId: string;
    listingName: string;
    listingDescription?: string;
    visibility?: "public" | "friends_only" | "unlisted";
    categories?: string[];
    tags?: string[];
    connectionMode?: ListingConnectionMode;
  }) => Promise<DirectoryListing>;
  getListingByAgent: (agentId: string) => Promise<DirectoryListing | null>;
  updateListing: (
    id: string,
    data: Partial<{
      listingName: string;
      listingDescription: string;
      visibility: "public" | "friends_only" | "unlisted";
      categories: string[];
      tags: string[];
      featured: boolean;
      connectionMode: ListingConnectionMode;
    }>
  ) => Promise<DirectoryListing>;
  deleteListing: (id: string) => Promise<void>;
}

export const useDirectoryStore = create<DirectoryState>((set, get) => ({
  listings: EMPTY_LISTINGS,
  loading: false,
  loadingMore: false,
  hasMore: true,
  searchQuery: "",
  connections: EMPTY_CONNECTIONS,
  connectionsLoading: false,
  connectionsLoadedAt: 0,
  _connectionsInflight: null,

  fetchDirectory: async (opts) => {
    set({ loading: true });
    try {
      const { searchQuery } = get();
      const params = new URLSearchParams();
      const q = opts?.q ?? searchQuery;
      if (q) params.set("q", q);
      params.set("limit", "20");

      const query = params.toString();
      const response = await request<ListingsResponse>(
        `/api/directory${query ? `?${query}` : ""}`
      );
      const listings = response.listings?.length
        ? response.listings
        : EMPTY_LISTINGS;
      set({ listings, hasMore: listings.length >= 20 });
    } catch {
      // ignore
    } finally {
      set({ loading: false });
    }
  },

  fetchMore: async () => {
    const { listings, loadingMore, hasMore, searchQuery } = get();
    if (loadingMore || !hasMore || listings.length === 0) return;

    set({ loadingMore: true });
    try {
      const lastId = listings[listings.length - 1]!.id;
      const params = new URLSearchParams();
      params.set("before", lastId);
      params.set("limit", "20");
      if (searchQuery) params.set("q", searchQuery);

      const response = await request<ListingsResponse>(
        `/api/directory?${params.toString()}`
      );
      const more = response.listings ?? [];
      set({
        listings: [...listings, ...more],
        hasMore: more.length >= 20,
      });
    } catch {
      // ignore
    } finally {
      set({ loadingMore: false });
    }
  },

  setSearchQuery: (q) => {
    set({ searchQuery: q, listings: EMPTY_LISTINGS, hasMore: true });
    get().fetchDirectory({ q });
  },

  requestConnection: async (agentId, opts) => {
    const body: Record<string, unknown> = { agentId };
    if (opts?.mode) body.mode = opts.mode;
    const response = await request<ConnectionResponse>("/api/connections", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (response.connection) {
      const existing = get().connections;
      const filtered = existing.filter((c) => c.agentId !== agentId);
      set({ connections: [response.connection, ...filtered] });
    }
    return response;
  },

  revokeConnection: async (id) => {
    const response = await request<ConnectionResponse>(
      `/api/connections/${id}`,
      { method: "DELETE" }
    );
    if (response?.connection) {
      set({
        connections: get().connections.map((c) =>
          c.id === id ? response.connection! : c
        ),
      });
    } else {
      set({ connections: get().connections.filter((c) => c.id !== id) });
    }
  },

  rateAgent: async (listingId, rating, review?) => {
    const body: Record<string, unknown> = { rating };
    if (review) body.review = review;
    const response = await request<RateResponse>(
      `/api/directory/${listingId}/rate`,
      { method: "POST", body: JSON.stringify(body) }
    );
    const { ratingAvg, ratingCount } = response.listing;
    set({
      listings: get().listings.map((l) =>
        l.id === listingId ? { ...l, ratingAvg, ratingCount } : l
      ),
    });
  },

  getListing: async (id) => {
    try {
      const response = await request<ListingResponse>(`/api/directory/${id}`);
      return response.listing;
    } catch {
      return null;
    }
  },

  fetchConnections: async () => {
    set({ connectionsLoading: true });
    try {
      const response = await request<ConnectionsResponse>("/api/connections");
      set({
        connections: response.connections?.length
          ? response.connections
          : EMPTY_CONNECTIONS,
        connectionsLoadedAt: Date.now(),
      });
    } catch {
      // ignore
    } finally {
      set({ connectionsLoading: false });
    }
  },

  fetchConnectionsIfStale: async () => {
    const inflight = get()._connectionsInflight;
    if (inflight) return inflight;
    if (isFresh(get().connectionsLoadedAt)) return;
    const p = get()
      .fetchConnections()
      .finally(() => set({ _connectionsInflight: null }));
    set({ _connectionsInflight: p });
    return p;
  },

  createListing: async (data) => {
    const response = await request<ListingResponse>("/api/directory", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return response.listing;
  },

  // GET /api/directory/:id falls back to lookup by agent_id when no
  // listing matches that UUID, and is NOT visibility-gated — returns
  // this agent's listing even when it's `unlisted` or `friends_only`.
  getListingByAgent: async (agentId) => {
    // Backend's `Repo.get(Listing, id)` raises Ecto.Query.CastError on
    // a non-UUID and Phoenix renders that as a 500. Guard here so a
    // malformed agent id doesn't surface as a fake "load failed" error.
    if (!UUID_RE.test(agentId)) return null;
    try {
      const response = await request<ListingResponse>(`/api/directory/${agentId}`);
      return response.listing;
    } catch (e) {
      // 404 = agent has no listing yet (the genuine "not published" case).
      // Anything else (auth, network) should propagate so callers can
      // distinguish "load failed" from "not listed."
      if ((e as { status?: number })?.status === 404) return null;
      throw e;
    }
  },

  updateListing: async (id, data) => {
    const response = await request<ListingResponse>(`/api/directory/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    set((s) => ({
      listings: s.listings.map((l) => (l.id === id ? response.listing : l)),
    }));
    return response.listing;
  },

  deleteListing: async (id) => {
    await request(`/api/directory/${id}`, { method: "DELETE" });
    set((s) => ({ listings: s.listings.filter((l) => l.id !== id) }));
  },
}));
