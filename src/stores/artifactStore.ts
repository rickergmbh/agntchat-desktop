import { create } from "zustand";
import {
  listArtifacts,
  listArtifactComments,
  addArtifactComment,
  type Artifact,
  type ArtifactComment,
} from "../lib/api";
import { ws } from "../services/websocket";

/**
 * Artifact primitive client store (#59). Mirrors web/src/stores/artifactStore.ts.
 *
 * Holds artifacts per conversation and comments per artifact. Merges live WS
 * events (artifact_created / artifact_updated / artifact_comment_added)
 * dedup-by-id, exactly like chatStore does for messages — never replace,
 * always merge by ID so a REST load and a WS event can't clobber each other.
 *
 * Also owns the viewer open-state: cards in any pane call openViewer and the
 * single ArtifactViewer instance (rendered by MessagesView) reads it.
 */

// Newest-first (matches the REST list order + the stream anchor).
function sortArtifactsDesc(list: Artifact[]): Artifact[] {
  return [...list].sort(
    (a, b) => new Date(b.insertedAt).getTime() - new Date(a.insertedAt).getTime()
  );
}

function sortCommentsAsc(list: ArtifactComment[]): ArtifactComment[] {
  return [...list].sort(
    (a, b) => new Date(a.insertedAt).getTime() - new Date(b.insertedAt).getTime()
  );
}

interface ArtifactState {
  /** Artifacts by conversation id, newest first. */
  artifacts: Record<string, Artifact[]>;
  /** Comments by artifact id, oldest first. */
  comments: Record<string, ArtifactComment[]>;
  /** Open viewer target, or null when closed. */
  viewer: { artifactId: string; conversationId: string } | null;
  /** @internal per-conversation last successful fetch time */
  _loadedAt: Record<string, number>;

  fetchArtifacts: (conversationId: string) => Promise<void>;
  fetchArtifactsIfNeeded: (conversationId: string) => Promise<void>;
  /** Insert-or-replace an artifact by id (drives artifact_created +
   *  artifact_updated — a new version simply replaces the card in place). */
  upsertArtifact: (artifact: Artifact) => void;
  getArtifact: (conversationId: string, artifactId: string) => Artifact | undefined;

  fetchComments: (artifactId: string) => Promise<void>;
  /** Append a comment dedup-by-id (drives artifact_comment_added). */
  addCommentLocal: (artifactId: string, comment: ArtifactComment) => void;
  /** Post a comment via REST; the WS broadcast + local append render it. */
  postComment: (artifactId: string, body: string) => Promise<ArtifactComment>;

  openViewer: (artifactId: string, conversationId: string) => void;
  closeViewer: () => void;

  initWsListeners: () => () => void;
}

export const useArtifactStore = create<ArtifactState>((set, get) => ({
  artifacts: {},
  comments: {},
  viewer: null,
  _loadedAt: {},

  fetchArtifacts: async (conversationId) => {
    const fetched = await listArtifacts(conversationId, { limit: 100 });
    // Merge with any artifacts already added via WS (never drop a live one
    // the server list might not have caught yet), then replace by id.
    const existing = get().artifacts[conversationId] ?? [];
    const byId = new Map<string, Artifact>();
    for (const a of existing) byId.set(a.id, a);
    for (const a of fetched) byId.set(a.id, a);
    set({
      artifacts: {
        ...get().artifacts,
        [conversationId]: sortArtifactsDesc(Array.from(byId.values())),
      },
      _loadedAt: { ...get()._loadedAt, [conversationId]: Date.now() },
    });
  },

  fetchArtifactsIfNeeded: async (conversationId) => {
    const at = get()._loadedAt[conversationId];
    if (at && Date.now() - at < 10_000) return;
    await get().fetchArtifacts(conversationId);
  },

  upsertArtifact: (artifact) => {
    const cid = artifact.conversationId;
    if (!cid) return;
    const existing = get().artifacts[cid] ?? [];
    const idx = existing.findIndex((a) => a.id === artifact.id);
    let next: Artifact[];
    if (idx === -1) {
      next = sortArtifactsDesc([artifact, ...existing]);
    } else {
      // Replace in place. Preserve `current` if the incoming payload omits it
      // (shouldn't happen for create/update broadcasts, but be defensive).
      const merged: Artifact = {
        ...existing[idx],
        ...artifact,
        current: artifact.current ?? existing[idx]!.current,
      };
      next = [...existing];
      next[idx] = merged;
    }
    set({ artifacts: { ...get().artifacts, [cid]: next } });
  },

  getArtifact: (conversationId, artifactId) =>
    (get().artifacts[conversationId] ?? []).find((a) => a.id === artifactId),

  fetchComments: async (artifactId) => {
    const fetched = await listArtifactComments(artifactId);
    const existing = get().comments[artifactId] ?? [];
    const byId = new Map<string, ArtifactComment>();
    for (const c of existing) byId.set(c.id, c);
    for (const c of fetched) byId.set(c.id, c);
    set({
      comments: {
        ...get().comments,
        [artifactId]: sortCommentsAsc(Array.from(byId.values())),
      },
    });
  },

  addCommentLocal: (artifactId, comment) => {
    const existing = get().comments[artifactId] ?? [];
    if (existing.some((c) => c.id === comment.id)) return;
    set({
      comments: {
        ...get().comments,
        [artifactId]: sortCommentsAsc([...existing, comment]),
      },
    });
  },

  postComment: async (artifactId, body) => {
    const comment = await addArtifactComment(artifactId, body);
    // Append immediately; the WS echo is deduped by id.
    get().addCommentLocal(artifactId, comment);
    return comment;
  },

  openViewer: (artifactId, conversationId) =>
    set({ viewer: { artifactId, conversationId } }),
  closeViewer: () => set({ viewer: null }),

  initWsListeners: () => {
    const unsubs: (() => void)[] = [];

    const upsertFromEvent = (payload: Record<string, unknown>) => {
      // Strip the routing key the ws service merges in — keep store state
      // shaped exactly like the serializer payload.
      const { _conversationId, ...artifact } = payload as Record<string, unknown> & {
        _conversationId?: string;
      };
      void _conversationId;
      get().upsertArtifact(artifact as unknown as Artifact);
    };

    unsubs.push(ws.on("conv:artifact_created", upsertFromEvent));
    unsubs.push(ws.on("conv:artifact_updated", upsertFromEvent));
    unsubs.push(
      ws.on("conv:artifact_comment_added", (payload) => {
        const { artifactId, comment } = payload as unknown as {
          artifactId?: string;
          comment?: ArtifactComment;
        };
        if (artifactId && comment) get().addCommentLocal(artifactId, comment);
      })
    );

    return () => unsubs.forEach((u) => u());
  },
}));
