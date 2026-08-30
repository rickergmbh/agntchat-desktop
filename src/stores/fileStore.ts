import { create } from "zustand";
import { listOwnerArtifacts, listOwnerFiles } from "../lib/api";
import type { OwnerArtifact, OwnerFile } from "../lib/api";
import { isFresh } from "../lib/cache";

/** i18n key (files:errors.*) for the most recent failed load; FilesView
 *  renders it as inline copy. Stores never hold user-facing strings. */
export type FileErrorKey = "loadFailed" | null;

export const FILES_PAGE_SIZE = 100;

/**
 * Global "Files" view state — the owner-scoped file feed and the separate
 * artifact feed behind the Artifacts filter.
 *
 * Lives in a store rather than in FilesView's own state because AppShell
 * unmounts the view on every sidebar switch: held locally, a trip to Agents
 * and back re-fetched 100 files behind a full-page spinner. Neither feed is
 * pushed over WebSocket, so a TTL is the only staleness signal we have —
 * cached rows render immediately and a stale cache refreshes underneath them.
 */
interface FileState {
  files: OwnerFile[];
  filesLoadedAt: number;
  /** Only true when there is nothing cached to render behind the fetch. */
  filesLoading: boolean;
  filesErrorKey: FileErrorKey;
  /** False while the server may still have older pages (drives "load more"). */
  reachedEnd: boolean;
  loadingMore: boolean;

  artifacts: OwnerArtifact[];
  artifactsLoadedAt: number;
  artifactsLoading: boolean;
  artifactsErrorKey: FileErrorKey;

  /** @internal in-flight fetches, so two callers on the same tick share one request */
  _filesInflight: Promise<void> | null;
  _artifactsInflight: Promise<void> | null;

  fetchFiles: () => Promise<void>;
  fetchFilesIfStale: () => Promise<void>;
  loadMoreFiles: () => Promise<boolean>;
  fetchArtifactsIfStale: () => Promise<void>;
  /** Drop a deleted file from the cached page without a refetch. */
  removeFile: (id: string) => void;
  /** Wipe both feeds — workspace switches change what the account can see. */
  reset: () => void;
}

export const useFileStore = create<FileState>((set, get) => ({
  files: [],
  filesLoadedAt: 0,
  filesLoading: false,
  filesErrorKey: null,
  reachedEnd: false,
  loadingMore: false,

  artifacts: [],
  artifactsLoadedAt: 0,
  artifactsLoading: false,
  artifactsErrorKey: null,

  _filesInflight: null,
  _artifactsInflight: null,

  fetchFiles: async () => {
    set({ filesLoading: get().files.length === 0, filesErrorKey: null });
    try {
      const page = await listOwnerFiles({ limit: FILES_PAGE_SIZE });
      set({
        files: page,
        reachedEnd: page.length < FILES_PAGE_SIZE,
        filesLoadedAt: Date.now(),
      });
    } catch (e) {
      console.warn("[files] fetch failed", e);
      set({ filesErrorKey: "loadFailed" });
    } finally {
      set({ filesLoading: false });
    }
  },

  fetchFilesIfStale: async () => {
    const inflight = get()._filesInflight;
    if (inflight) return inflight;
    if (isFresh(get().filesLoadedAt)) return;
    const p = get()
      .fetchFiles()
      .finally(() => set({ _filesInflight: null }));
    set({ _filesInflight: p });
    return p;
  },

  loadMoreFiles: async () => {
    const { files, loadingMore } = get();
    const last = files[files.length - 1];
    if (!last || loadingMore) return true;
    set({ loadingMore: true });
    try {
      const page = await listOwnerFiles({
        limit: FILES_PAGE_SIZE,
        before: last.insertedAt,
      });
      const seen = new Set(files.map((f) => f.id));
      set({
        files: [...files, ...page.filter((f) => !seen.has(f.id))],
        reachedEnd: page.length < FILES_PAGE_SIZE,
      });
      return true;
    } catch (e) {
      console.warn("[files] load more failed", e);
      return false;
    } finally {
      set({ loadingMore: false });
    }
  },

  fetchArtifactsIfStale: async () => {
    const inflight = get()._artifactsInflight;
    if (inflight) return inflight;
    if (isFresh(get().artifactsLoadedAt)) return;

    const run = async () => {
      set({
        artifactsLoading: get().artifacts.length === 0,
        artifactsErrorKey: null,
      });
      try {
        const page = await listOwnerArtifacts({ limit: FILES_PAGE_SIZE });
        set({ artifacts: page, artifactsLoadedAt: Date.now() });
      } catch (e) {
        console.warn("[files] artifacts fetch failed", e);
        set({ artifactsErrorKey: "loadFailed" });
      } finally {
        set({ artifactsLoading: false });
      }
    };

    const p = run().finally(() => set({ _artifactsInflight: null }));
    set({ _artifactsInflight: p });
    return p;
  },

  removeFile: (id) => set((s) => ({ files: s.files.filter((f) => f.id !== id) })),

  reset: () =>
    set({
      files: [],
      filesLoadedAt: 0,
      filesErrorKey: null,
      reachedEnd: false,
      artifacts: [],
      artifactsLoadedAt: 0,
      artifactsErrorKey: null,
    }),
}));
