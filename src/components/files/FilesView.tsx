import {
  File as FileIcon,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  FolderOpen,
  Loader2,
  MessageSquare,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getFileDownloadUrl, listOwnerFiles, type OwnerFile } from "../../lib/api";
import { formatConversationTime } from "../../lib/utils";
import { formatFileSize } from "../../services/fileUpload";

const PAGE_SIZE = 100;

type Category = "all" | "documents" | "images" | "media";

const FILTERS: { key: Category; label: string }[] = [
  { key: "all", label: "All" },
  { key: "documents", label: "Documents" },
  { key: "images", label: "Images" },
  { key: "media", label: "Media" },
];

/** Coarse bucket used by both the type-filter pills and the row icon. */
function categoryOf(contentType: string): Exclude<Category, "all"> {
  if (contentType.startsWith("image/")) return "images";
  if (contentType.startsWith("audio/") || contentType.startsWith("video/"))
    return "media";
  return "documents";
}

function iconFor(contentType: string) {
  if (contentType.startsWith("image/")) return <FileImage className="h-5 w-5" />;
  if (contentType.startsWith("audio/")) return <FileAudio className="h-5 w-5" />;
  if (contentType.startsWith("video/")) return <FileVideo className="h-5 w-5" />;
  if (
    contentType.startsWith("text/") ||
    contentType === "application/pdf" ||
    contentType === "application/json"
  )
    return <FileText className="h-5 w-5" />;
  return <FileIcon className="h-5 w-5" />;
}

interface Props {
  /** Jump to the conversation a file was shared in. */
  onOpenConversation: (conversationId: string) => void;
}

/**
 * Global "Files" view — a single home for every file the signed-in user and
 * their agents have created, no matter which conversation it lives in. Files
 * scatter across many threads; this gathers them in one searchable place.
 */
export function FilesView({ onOpenConversation }: Props) {
  const [files, setFiles] = useState<OwnerFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null until the first fetch settles; true once a page comes back short.
  const [reachedEnd, setReachedEnd] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const [opening, setOpening] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await listOwnerFiles({ limit: PAGE_SIZE });
      setFiles(page);
      setReachedEnd(page.length < PAGE_SIZE);
    } catch {
      setError("Couldn't load your files. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = useCallback(async () => {
    const last = files[files.length - 1];
    if (!last || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listOwnerFiles({
        limit: PAGE_SIZE,
        before: last.insertedAt,
      });
      setFiles((prev) => {
        // Guard against overlap on the cursor boundary.
        const seen = new Set(prev.map((f) => f.id));
        return [...prev, ...page.filter((f) => !seen.has(f.id))];
      });
      setReachedEnd(page.length < PAGE_SIZE);
    } catch {
      setError("Couldn't load more files.");
    } finally {
      setLoadingMore(false);
    }
  }, [files, loadingMore]);

  const counts = useMemo(() => {
    const c = { all: files.length, documents: 0, images: 0, media: 0 };
    for (const f of files) c[categoryOf(f.contentType)] += 1;
    return c;
  }, [files]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files.filter((f) => {
      if (category !== "all" && categoryOf(f.contentType) !== category)
        return false;
      if (q && !f.filename.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [files, query, category]);

  const openFile = async (file: OwnerFile) => {
    setOpening(file.id);
    try {
      const { url } = await getFileDownloadUrl(file.id);
      // Synthesized anchor click — Tauri's webview doesn't reliably forward
      // window.open to the OS browser. Mirrors FilesPanel / FileMessage.
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      // Silent no-op on auth/network errors; the row stays and can be retried.
    } finally {
      setOpening(null);
    }
  };

  return (
    <div className="flex h-full w-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border px-6 pt-5 pb-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <FolderOpen className="h-5 w-5 text-primary" />
              Files
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Everything you and your agents have created, across every chat.
            </p>
          </div>
          <div className="relative w-64 max-w-[40%] shrink-0">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search files…"
              className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        {/* Type filter pills */}
        <div className="mt-3 flex items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setCategory(f.key)}
              className={
                "rounded-full px-3 py-1 text-xs font-medium transition-colors " +
                (category === f.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground")
              }
            >
              {f.label}
              <span className="ml-1.5 opacity-60 tabular-nums">{counts[f.key]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            <button
              type="button"
              onClick={load}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Retry
            </button>
          </div>
        ) : files.length === 0 ? (
          <EmptyState
            title="No files yet"
            subtitle="Files you or your agents upload to any chat will collect here."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title="No matching files"
            subtitle="Try a different search or filter."
          />
        ) : (
          <div className="px-3 py-2">
            {visible.map((file) => (
              <div
                key={file.id}
                className="group flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-accent"
              >
                <button
                  type="button"
                  onClick={() => openFile(file)}
                  disabled={opening !== null}
                  title="Open file"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-50"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-primary">
                    {opening === file.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      iconFor(file.contentType)
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {file.filename}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {formatFileSize(file.sizeBytes)} ·{" "}
                      {file.uploader?.displayName ?? "Unknown"} ·{" "}
                      {formatConversationTime(file.insertedAt)}
                    </span>
                  </span>
                </button>

                {file.conversation && (
                  <button
                    type="button"
                    onClick={() => onOpenConversation(file.conversation!.id)}
                    title="Open the chat this file is in"
                    className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100 max-w-[200px]"
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                      {file.conversation.title || "Untitled chat"}
                    </span>
                  </button>
                )}
              </div>
            ))}

            {/* Load more — only when not searching/filtering, since the cursor
                paginates the full set, not the filtered view. */}
            {!reachedEnd && category === "all" && query.trim() === "" && (
              <div className="flex justify-center py-4">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="flex items-center gap-2 rounded-lg border border-border px-4 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Load more
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <FolderOpen className="h-10 w-10 text-muted-foreground/40" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-xs text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}
