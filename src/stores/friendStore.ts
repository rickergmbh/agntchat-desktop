import { create } from "zustand";
import * as api from "../lib/api";
import { ws } from "../services/websocket";
import { useAuthStore } from "./authStore";

interface FriendState {
  connections: api.UserConnection[];
  loading: boolean;
  pendingCount: number;
  fetchConnections: () => Promise<void>;
  fetchPendingCount: () => Promise<void>;
  requestFriend: (participantId: string, message?: string) => Promise<api.UserConnection | undefined>;
  respondFriend: (id: string, decision: "accepted" | "rejected") => Promise<api.UserConnection | undefined>;
  revokeFriend: (id: string) => Promise<api.UserConnection | undefined>;
  blockFriend: (id: string) => Promise<api.UserConnection | undefined>;
  unblockFriend: (id: string) => Promise<api.UserConnection | undefined>;
  upsertConnection: (connection: api.UserConnection) => void;
  initWsListeners: () => () => void;
}

function upsert(list: api.UserConnection[], connection: api.UserConnection) {
  return [connection, ...list.filter((c) => c.id !== connection.id)];
}

function extractConnection(payload: Record<string, unknown>) {
  return payload.connection as api.UserConnection | undefined;
}

function isNotFoundError(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error
    && (error as { status?: number }).status === 404;
}

function incomingPendingCount(connections: api.UserConnection[]) {
  const currentUserId = useAuthStore.getState().participant?.id;
  if (!currentUserId) return 0;
  return connections.filter((c) => c.status === "pending" && c.addresseeId === currentUserId).length;
}

export const useFriendStore = create<FriendState>((set, get) => ({
  connections: [],
  loading: false,
  pendingCount: 0,

  fetchConnections: async () => {
    set({ loading: true });
    try {
      const response = await api.listFriends();
      const connections = response.connections ?? [];
      set({ connections, pendingCount: incomingPendingCount(connections) });
    } catch (e) {
      if (isNotFoundError(e)) {
        set({ connections: [], pendingCount: 0 });
      } else {
        console.warn("[friends] fetch connections failed", e);
      }
    } finally {
      set({ loading: false });
    }
  },

  fetchPendingCount: async () => {
    try {
      const response = await api.fetchFriendPendingCount();
      set({ pendingCount: response.count ?? 0 });
    } catch (e) {
      if (isNotFoundError(e)) {
        try {
          const response = await api.listFriends();
          const connections = response.connections ?? [];
          set({ connections, pendingCount: incomingPendingCount(connections) });
        } catch (fallbackError) {
          if (isNotFoundError(fallbackError)) {
            set({ pendingCount: incomingPendingCount(get().connections) });
          } else {
            console.warn("[friends] pending count fallback failed", fallbackError);
          }
        }
      } else {
        console.warn("[friends] pending count failed", e);
      }
    }
  },

  requestFriend: async (participantId, message) => {
    const response = await api.requestFriend(participantId, message);
    if (response.connection) {
      set((s) => ({ connections: upsert(s.connections, response.connection) }));
    }
    return response.connection;
  },

  respondFriend: async (id, decision) => {
    const response = await api.respondFriend(id, decision);
    if (response.connection) {
      set((s) => ({
        connections: upsert(s.connections, response.connection),
        pendingCount: Math.max(0, s.pendingCount - 1),
      }));
    }
    return response.connection;
  },

  revokeFriend: async (id) => {
    const response = await api.revokeFriend(id);
    if (response.connection) {
      set((s) => ({ connections: upsert(s.connections, response.connection) }));
    }
    return response.connection;
  },

  blockFriend: async (id) => {
    const response = await api.blockFriend(id);
    if (response.connection) {
      set((s) => ({ connections: upsert(s.connections, response.connection) }));
    }
    return response.connection;
  },

  unblockFriend: async (id) => {
    const response = await api.unblockFriend(id);
    if (response.connection) {
      set((s) => ({ connections: upsert(s.connections, response.connection) }));
    }
    return response.connection;
  },

  upsertConnection: (connection) => {
    set((s) => ({ connections: upsert(s.connections, connection) }));
    get().fetchPendingCount();
  },

  initWsListeners: () => {
    const handle = (payload: Record<string, unknown>) => {
      const connection = extractConnection(payload);
      if (connection) get().upsertConnection(connection);
    };
    const unsubs = [
      ws.on("friend_request", handle),
      ws.on("friend_request_responded", handle),
      ws.on("friend_connection_removed", handle),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  },
}));
